/**
 * SLG 据点角色展示（`SlgGameCameRoleInfo` / `CmdSlgCampRoleInfosReqMsg`，协议 r879 + r880）的接线单测。
 *
 * 这条链路**错了不会报错**：`roleId`/`serverId`/`img` 是 `uint64`（运行时 `Long`），
 * 直接 `Number()` 会静默丢精度；`pos` 是格 id（0 合法），当成"没填"就会丢一格；
 * 而 `campId` 不校验就收包，会把 A 据点的角色画到 B 据点上。所以钉五件事：
 *   ① 真 proto 编解码（含 `Long` → 十进制字符串），证明字段号/类型对得上；
 *   ② 归一化的边界（uint64、pos=0、去重排序、坏条跳过、坏包整包拒绝）；
 *   ③ 仓库语义（超时不清空旧列表、迟到回包不覆盖、dispose 后全部失效）；
 *   ④ 网关真的发 `CmdSlgCampRoleInfosReqMsg` 且 body 只有 `campId`；
 *   ⑤ 文案四态（有数据时优先展示已有列表，不因一次失败变回"加载中"）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import ts from 'typescript';
import {
    BIGMAP_CAMP_ROLE_TEXT,
    formatBigMapCampRoleLines,
    normalizeBigMapCampRoleInfos,
} from '../assets/script/app/bigmap/model/BigMapCampRoleInfo';

const CMD = 'com.xkhy.tafang.cmd';

function loadRoot(): protobuf.Root {
    return protobuf.Root.fromJSON(JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8')));
}

const root = loadRoot();

function loadModule(path: string, require: (name: string) => unknown): Record<string, unknown> {
    const exports: Record<string, unknown> = {};
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    runInNewContext(code, { exports, require });
    return exports;
}

/** 用真 proto 编一遍再解，拿到运行时真实形状（`Long` 字段就是 `Long`）。 */
function decodeRoundTrip(payload: object): unknown {
    const type = root.lookupType(`${CMD}.CmdSlgCampRoleInfosRspMsg`);
    return type.toObject(type.decode(type.encode(type.create(payload)).finish()), { defaults: true, longs: String });
}

// ============================================================================
// ① 协议
// ============================================================================

test('★协议：SlgGameCameRoleInfo 字段号/类型与 proto 一致（pos 是 r880 补的 6 号）', () => {
    const role = root.lookupType(`${CMD}.SlgGameCameRoleInfo`);
    assert.deepEqual(Object.keys(role.fields), ['roleId', 'serverId', 'roleName', 'img', 'defenseHp', 'pos']);
    assert.equal(role.fields.roleId.id, 1);
    assert.equal(role.fields.roleId.type, 'uint64');
    assert.equal(role.fields.serverId.id, 2);
    assert.equal(role.fields.serverId.type, 'uint64');
    assert.equal(role.fields.roleName.id, 3);
    assert.equal(role.fields.roleName.type, 'string');
    assert.equal(role.fields.img.id, 4);
    assert.equal(role.fields.img.type, 'uint64');
    assert.equal(role.fields.defenseHp.id, 5);
    assert.equal(role.fields.defenseHp.type, 'uint32');
    assert.equal(role.fields.pos.id, 6);
    assert.equal(role.fields.pos.type, 'uint32');

    const rsp = root.lookupType(`${CMD}.CmdSlgCampRoleInfosRspMsg`);
    assert.equal(rsp.fields.campId.id, 1);
    assert.equal(rsp.fields.infos.id, 2);
    assert.equal(rsp.fields.infos.repeated, true);
    assert.equal(rsp.fields.infos.resolvedType, role);
});

test('★协议：请求/响应真能编解码（uint64 原样回来，pos=0 不被丢掉）', () => {
    const req = root.lookupType(`${CMD}.CmdSlgCampRoleInfosReqMsg`);
    const reqBytes = req.encode(req.create({ campId: 205 })).finish();
    assert.deepEqual({ ...req.decode(reqBytes) }, { campId: 205 });

    // roleId 超过 2^53，只有字符串口径不丢精度。
    const bigId = '9007199254740993';
    const decoded = decodeRoundTrip({
        campId: 205,
        infos: [{
            roleId: bigId, serverId: '3002', roleName: '山猫', img: '1234567890123456789', defenseHp: 4321, pos: 0,
        }],
    }) as { campId: number; infos: { roleId: string; pos: number }[] };
    assert.equal(decoded.campId, 205);
    assert.equal(decoded.infos[0].roleId, bigId, '★uint64 必须逐字回来（Number() 会变成 ...992）');
    assert.equal(decoded.infos[0].pos, 0, 'pos=0 是合法格子，编解码不能把它当缺省丢掉');
});

// ============================================================================
// ② 归一化
// ============================================================================

test('归一化：三个 uint64 走字符串，pos=0 保留，按 pos 升序去重', () => {
    const infos = normalizeBigMapCampRoleInfos({
        campId: 205,
        infos: [
            { roleId: '2', serverId: '3002', roleName: '乙', img: '2002', defenseHp: 20, pos: 9 },
            { roleId: '1', serverId: '3001', roleName: '甲', img: '2001', defenseHp: 10, pos: 0 },
            // 同 pos 后到覆盖先到（一格不可能站两个人）
            { roleId: '3', serverId: '3003', roleName: '丙', img: '2003', defenseHp: 30, pos: 9 },
        ],
    }, 205);
    assert.deepEqual(infos, [
        { roleId: '1', serverId: '3001', roleName: '甲', avatarId: '2001', defenseHp: 10, pos: 0 },
        { roleId: '3', serverId: '3003', roleName: '丙', avatarId: '2003', defenseHp: 30, pos: 9 },
    ]);
});

test('归一化边界：缺 roleId / pos 非法 / 血量非法都只丢该条，不拖垮整包', () => {
    const infos = normalizeBigMapCampRoleInfos({
        campId: 205,
        infos: [
            { roleId: '1', serverId: '1', roleName: 'ok', img: '1', defenseHp: 5, pos: 3 },
            { roleId: '', serverId: '1', roleName: '空id', img: '1', defenseHp: 5, pos: 4 },
            { serverId: '1', roleName: '缺id', img: '1', defenseHp: 5, pos: 5 },
            { roleId: '2', serverId: '1', roleName: '负格', img: '1', defenseHp: 5, pos: -1 },
            { roleId: '3', serverId: '1', roleName: '小数格', img: '1', defenseHp: 5, pos: 1.5 },
            { roleId: '4', serverId: '1', roleName: '超界格', img: '1', defenseHp: 5, pos: 0x100000000 },
            // 血量坏值收敛成 0，但这条角色还在（说明有记录、已破防）
            { roleId: '5', serverId: '1', roleName: '坏血', img: '1', defenseHp: -3, pos: 6 },
            null,
        ],
    }, 205);
    assert.deepEqual(infos?.map((info) => info.pos), [3, 6]);
    assert.equal(infos?.[1].defenseHp, 0);
});

test('★归一化坏包：campId 与请求不符 / 结构不对一律 null（交给调用方保留旧数据）', () => {
    const body = { infos: [{ roleId: '1', pos: 1, defenseHp: 1, serverId: '1', roleName: 'a', img: '1' }] };
    assert.equal(normalizeBigMapCampRoleInfos({ ...body, campId: 206 }, 205), null, '★串包必须拒收');
    assert.equal(normalizeBigMapCampRoleInfos({ ...body }, 205), null, '缺 campId 无法确认是这次请求的包');
    assert.equal(normalizeBigMapCampRoleInfos({ campId: 205 }, 205), null, 'infos 不是数组 = 坏包');
    assert.equal(normalizeBigMapCampRoleInfos(null, 205), null);
    // 空数组是**有效事实**：查过、据点里确实没人。
    assert.deepEqual(normalizeBigMapCampRoleInfos({ campId: 205, infos: [] }, 205), []);
});

test('归一化接受真解码结果（Long → 十进制字符串，不丢精度）', () => {
    const decoded = decodeRoundTrip({
        campId: 205,
        infos: [{ roleId: '9007199254740993', serverId: '3002', roleName: '山猫', img: '9007199254740995', defenseHp: 7, pos: 12 }],
    });
    const infos = normalizeBigMapCampRoleInfos(decoded, 205);
    assert.deepEqual(infos, [{
        roleId: '9007199254740993', serverId: '3002', roleName: '山猫', avatarId: '9007199254740995', defenseHp: 7, pos: 12,
    }]);
});

// ============================================================================
// ③ 仓库
// ============================================================================

function deferred() {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((ok, fail) => { resolve = ok; reject = fail; });
    return { promise, resolve, reject };
}

function harness() {
    const roles = new Map<number, ReturnType<typeof deferred>>();
    const calls: number[] = [];
    const gateway = {
        fetchSimple: async () => null,
        fetchDetail: async () => null,
        fetchRoles: (campId: number) => {
            calls.push(campId);
            const d = deferred();
            roles.set(campId, d);
            return d.promise;
        },
        requestMove: async () => null,
        subscribeRoleEvents: () => () => undefined,
    };
    let now = 1000;
    const mod = loadModule('assets/script/app/bigmap/application/BigMapCampRepository.ts', (name) => {
        if (name.endsWith('/RequestGuard')) return { withTimeout: async (promise: Promise<unknown>) => promise };
        if (name.endsWith('/BigMapCampInfo')) return {
            isBigMapCampId: (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 0xffffffff,
            normalizeBigMapCampInfos: () => null,
        };
        if (name.endsWith('/BigMapCampRoleInfo')) return { normalizeBigMapCampRoleInfos };
        return {};
    });
    const Repository = mod.BigMapCampRepository as new (gateway: unknown, now?: () => number) => {
        rolesOf(campId: number): readonly { pos: number; roleName: string }[] | null;
        refreshRoles(campId: number): Promise<boolean>;
        refreshDetail(ids: readonly number[]): Promise<boolean>;
        dispose(): void;
    };
    const repository = new Repository(gateway, () => now);
    return { repository, roles, calls, advance: (ms: number) => { now += ms; } };
}

test('仓库：成功回包进缓存，空数组也算有效结果', async () => {
    const h = harness();
    assert.equal(h.repository.rolesOf(205), null, '没查过是 null，不是空数组');
    const pending = h.repository.refreshRoles(205);
    h.roles.get(205)!.resolve({ campId: 205, infos: [{ roleId: '1', serverId: '1', roleName: 'a', img: '1', defenseHp: 1, pos: 0 }] });
    assert.equal(await pending, true);
    assert.deepEqual(h.repository.rolesOf(205)?.map((role) => role.pos), [0]);

    const empty = h.repository.refreshRoles(206);
    h.roles.get(206)!.resolve({ campId: 206, infos: [] });
    assert.equal(await empty, true);
    assert.deepEqual(h.repository.rolesOf(206), []);
});

test('★仓库：坏包/超时不清空已有列表（一次失败不该把画面抹空）', async () => {
    const h = harness();
    const first = h.repository.refreshRoles(205);
    h.roles.get(205)!.resolve({ campId: 205, infos: [{ roleId: '1', serverId: '1', roleName: 'a', img: '1', defenseHp: 1, pos: 2 }] });
    await first;

    const second = h.repository.refreshRoles(205);
    h.roles.get(205)!.resolve({ campId: 999, infos: [] });  // 串包
    assert.equal(await second, false);
    assert.equal(h.repository.rolesOf(205)?.length, 1, '★失败必须保留旧列表');

    const third = h.repository.refreshRoles(205);
    h.roles.get(205)!.reject(new Error('timeout'));
    assert.equal(await third, false);
    assert.equal(h.repository.rolesOf(205)?.length, 1);
});

test('仓库：同据点并发只发一次请求；迟到回包（更早的 revision）不覆盖新数据', async () => {
    const h = harness();
    const a = h.repository.refreshRoles(205);
    const b = h.repository.refreshRoles(205);
    assert.equal(a, b, '同一据点的并发请求必须合并');
    assert.deepEqual(h.calls, [205]);
    h.roles.get(205)!.resolve({ campId: 205, infos: [{ roleId: '1', serverId: '1', roleName: '旧', img: '1', defenseHp: 1, pos: 1 }] });
    await a;

    const slow = h.repository.refreshRoles(205);
    const fast = h.repository.refreshRoles(205);
    // 第二个请求先回（revision 更大），第一个后回 —— 后回的必须被丢掉。
    h.roles.get(205)!.resolve({ campId: 205, infos: [{ roleId: '2', serverId: '1', roleName: '新', img: '1', defenseHp: 2, pos: 2 }] });
    await Promise.resolve();
    assert.equal(await fast, true);
    h.roles.get(205)!.resolve({ campId: 205, infos: [{ roleId: '1', serverId: '1', roleName: '旧', img: '1', defenseHp: 1, pos: 1 }] });
    await slow;
    assert.equal(h.repository.rolesOf(205)?.[0].roleName, '新', '旧回包不许回滚');
});

test('仓库：dispose 后不再发请求，缓存清空', async () => {
    const h = harness();
    const first = h.repository.refreshRoles(205);
    h.roles.get(205)!.resolve({ campId: 205, infos: [] });
    await first;
    assert.deepEqual(h.repository.rolesOf(205), []);
    h.repository.dispose();
    assert.equal(h.repository.rolesOf(205), null);
    assert.equal(await h.repository.refreshRoles(206), false);
    assert.deepEqual(h.calls, [205], 'dispose 后不许再发请求');
});

test('仓库：非法 campId 直接拒绝，不发请求', async () => {
    const h = harness();
    for (const bad of [0, -1, 1.5, Number.NaN, 0x100000000]) {
        assert.equal(await h.repository.refreshRoles(bad), false);
    }
    assert.deepEqual(h.calls, []);
});

// ============================================================================
// ④ 网关
// ============================================================================

test('★网关：真的发 CmdSlgCampRoleInfosReqMsg，body 只有 campId', async () => {
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', () => ({
        RequestMsg: class {
            constructor(public cmdReqMsg: object, _caller: unknown, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    const sent: { name: string; body: Record<string, unknown> }[] = [];
    const net = {
        isConnected: true,
        async send(req: { getReqMsgProtoName(): string; cmdReqMsg: Record<string, unknown>; fCallback(rsp: unknown): void }) {
            sent.push({ name: req.getReqMsgProtoName(), body: req.cmdReqMsg });
            req.fCallback({ campId: 205, infos: [] });
            return true;
        },
    };
    const mod = loadModule('assets/script/app/bigmap/application/GameNetBigMapCampGateway.ts', (name) => {
        if (name.endsWith('/GameNet')) return { GameNet: { instance: net } };
        if (name === './RequestBigMapCampMsg') return requests;
        return {};
    });
    const Gateway = mod.GameNetBigMapCampGateway as new () => { fetchRoles(campId: number): Promise<unknown> };
    const response = await new Gateway().fetchRoles(205);
    // ⚠️ 逐字段断言：`cmdReqMsg` 是在 vm 的 realm 里创建的，`deepStrictEqual` 会因原型不同而失败（规则 167）。
    assert.equal(sent.length, 1);
    assert.equal(sent[0].name, 'CmdSlgCampRoleInfosReqMsg');
    assert.deepEqual(Object.keys(sent[0].body), ['campId'], '载荷只有 campId，别把别的字段捎过去');
    assert.equal(sent[0].body.campId, 205);
    assert.equal((response as { campId: number }).campId, 205);
});

test('网关：断线时返回 null（不发请求）', async () => {
    const requests = loadModule('assets/script/app/bigmap/application/RequestBigMapCampMsg.ts', () => ({
        RequestMsg: class {
            constructor(public cmdReqMsg: object, _caller: unknown, public fCallback: (rsp: unknown) => void) {}
        },
    }));
    let sent = 0;
    const mod = loadModule('assets/script/app/bigmap/application/GameNetBigMapCampGateway.ts', (name) => {
        if (name.endsWith('/GameNet')) return {
            GameNet: { instance: { isConnected: false, async send() { sent += 1; return true; } } },
        };
        if (name === './RequestBigMapCampMsg') return requests;
        return {};
    });
    const Gateway = mod.GameNetBigMapCampGateway as new () => { fetchRoles(campId: number): Promise<unknown> };
    assert.equal(await new Gateway().fetchRoles(205), null);
    assert.equal(sent, 0);
});

// ============================================================================
// ⑤ 文案
// ============================================================================

const role = { roleId: '1', serverId: '3001', roleName: '山猫', avatarId: '2001', defenseHp: 120, pos: 12 };

test('文案四态：没数据时才显示加载/失败/暂无', () => {
    assert.deepEqual(formatBigMapCampRoleLines([], 'idle'), [BIGMAP_CAMP_ROLE_TEXT.pending]);
    assert.deepEqual(formatBigMapCampRoleLines([], 'loading'), [BIGMAP_CAMP_ROLE_TEXT.pending]);
    assert.deepEqual(formatBigMapCampRoleLines([], 'failed'), [BIGMAP_CAMP_ROLE_TEXT.failed]);
    assert.deepEqual(formatBigMapCampRoleLines([], 'ready'), [BIGMAP_CAMP_ROLE_TEXT.empty]);
});

test('★文案：有数据时优先展示，失败态也不把列表变回"加载中"', () => {
    const ready = formatBigMapCampRoleLines([role], 'ready');
    assert.equal(ready[0], '据点角色：1 人');
    assert.match(ready[1], /山猫/);
    assert.match(ready[1], /HP 120/);
    assert.match(ready[1], /格 12/);
    assert.deepEqual(formatBigMapCampRoleLines([role], 'failed'), ready, '★有旧数据就继续显示旧数据');
});

test('文案：名字为空时退回玩家 id（SLG 守军允许空名，不能显示空白行）', () => {
    const lines = formatBigMapCampRoleLines([{ ...role, roleName: '' }], 'ready');
    assert.match(lines[1], /1/);
    assert.doesNotMatch(lines[1], /·\s*HP/, '不能只剩符号和血量');
});
