import * as requestGuard from '../assets/script/app/net/RequestGuard';
/**
 * PVP 英雄**技能**协议（r621）的接线护栏。
 *
 * 后端这次更新给 `CmdPvpHeroInfo` 加了 `repeated CmdPvpHeroSkillInfo skills = 3`，
 * 并新增 `CmdPvpHeroUpSkillReqMsg / RspMsg`（消息号 473853329）。
 *
 * ⚠️ 本文件**不能**直接 import `PvpHeroService` / `CardRepository` —— 它们经 `GameNet`
 * 拉进 `cc`，在 Node 里 import 就炸（同 `territory-cell-protocol.test.ts` 的理由）。
 * 因此分两段：
 *   A. **协议层**直接 import 静态模块 + 反射 JSON，真跑一遍编解码。
 *   B. **接线层**读源码文本，断言「确实发了新请求 / 确实把技能写回了缓存」。
 *
 * 判据要钉的坑（都是这轮真踩到的）：
 *   ① proto 源更新了但**生成产物没重生成** —— 请求会被 `ProtoCoder` 拦掉，
 *      日志是「不存在协议…MessageId 中没定义」，零堆栈（见 territory 那条 ★★ 用例）。
 *   ② `applyPvpHeroLevel` 若照旧**整条替换** `{heroId, level}`，升个英雄等级就会把
 *      技能等级悄悄清空 —— 而技能页读的就是这份缓存。
 *   ③ 技能等级**不能猜 `skillId + 1`**：服务端可能不满级跳级或连升，必须从响应里取。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import protobufRoot from '../assets/script/lib/protobuf/protoCompiledStatic';
import { assetPath } from './helpers/asset-paths';
import { loadTsModule } from './helpers/cc-sandbox';
import { TMap } from '../assets/script/framework/collection/TMap';

const PROTO_SRC = 'client_proto/protoCompiled.proto';
const STATIC_SRC = 'assets/script/lib/protobuf/protoCompiledStatic.ts';
const REFLECT_JSON = assetPath('config/protoCompiled.json');

const SERVICE_SRC = 'assets/script/app/card/PvpHeroService.ts';
const REPO_SRC = 'assets/script/app/card/CardRepository.ts';
const REQUEST_SRC = 'assets/script/app/generated/requestMsg/RequestPvpMsg.ts';

function sessionFixture() {
    class ScriptObject {
        destroyed = false;
        assert(value: unknown): void {
            assert.ok(value);
        }
    }
    const proxy = loadTsModule<typeof import('../assets/script/framework/event/EventProxy')>('assets/script/framework/event/EventProxy.ts', {
        modules: { '/ScriptObject': { ScriptObject }, '/TMap': { TMap }, '/Utils': {} },
    });
    const network = loadTsModule<typeof import('../assets/script/framework/net/NetworkRequest')>('assets/script/framework/net/NetworkRequest.ts', {
        modules: { '/ScriptObject': { ScriptObject } }, globals: { window: {} },
    });
    const module = loadTsModule<typeof import('../assets/script/app/card/PvpHeroService')>(SERVICE_SRC, {
        modules: { '/RequestGuard': requestGuard, '/RequestPvpMsg': { RequestPvpHeroInfoList: class {
            constructor(readonly cmdReqMsg: object, readonly caller: object, readonly fCallback: (rsp: object) => void) {}
            getReqMsgProtoName(): string {
                return 'CmdPvpHeroInfoListReqMsg';
            }
        } } },
    });
    for (const result of [proxy, network, module]) assert.deepEqual(result.unresolved, []);
    const owners = new proxy.exports.EventProxy();
    const requests: InstanceType<typeof network.exports.NetworkRequest>[] = [];
    const callers: object[] = [];
    const net: ConstructorParameters<typeof module.exports.PvpHeroService>[0] = {
        isConnected: true,
        send: request => {
            callers.push(request.caller);
            const operation = new network.exports.NetworkRequest();
            operation.packageRequest(requests.length, new Uint8Array(), request, false, owners);
            requests.push(operation);
            return operation.promise;
        },
        removeCaller: owner => owners.removeCallerListener(owner),
    };
    return { Service: module.exports.PvpHeroService, net, requests, callers };
}

// ============================================================
// A. 协议层：产物里真的有、且真的编得解得
// ============================================================

test('★★ 技能协议三件套都在运行时静态模块里，且消息号与 proto 源一致', () => {
    const game = (protobufRoot as any).com.xkhy.tafang.cmd;
    for (const name of ['CmdPvpHeroSkillInfo', 'CmdPvpHeroUpSkillReqMsg', 'CmdPvpHeroUpSkillRspMsg']) {
        assert.equal(typeof game[name]?.encode, 'function', `静态模块缺 ${name} —— 重跑 gen_static_module.mjs`);
    }

    const protoSrc = readFileSync(PROTO_SRC, 'utf8');
    const idInProto = /CmdPvpHeroUpSkillRspMsg\s*=\s*(\d+)/.exec(protoSrc);
    assert.ok(idInProto, 'proto 源里找不到 CmdPvpHeroUpSkillRspMsg 的消息号');
    // ProtoCoder 是靠 `…RspMsg` 的 key 反推请求名的，消息号必须真的登记在枚举里。
    assert.equal(game.MessageId.CmdPvpHeroUpSkillRspMsg, Number(idInProto[1]));
});

test('★★ CmdPvpHeroInfo.skills 真的能编解码（字段号 3 / repeated 子消息）', () => {
    const game = (protobufRoot as any).com.xkhy.tafang.cmd;
    const source = game.CmdPvpHeroInfo.create({
        heroId: 68003,
        level: 12,
        skills: [{ id: 68003, level: 4 }, { id: 68004, level: 2 }],
    });
    const decoded = game.CmdPvpHeroInfo.decode(game.CmdPvpHeroInfo.encode(source).finish());
    assert.equal(decoded.heroId, 68003);
    assert.equal(decoded.level, 12);
    assert.deepEqual(
        decoded.skills.map((skill: any) => [skill.id, skill.level]),
        [[68003, 4], [68004, 2]],
    );

    // skills 缺省（老服务端 / 老数据）必须能解出空表，而不是抛。
    const bare = game.CmdPvpHeroInfo.decode(game.CmdPvpHeroInfo.encode({ heroId: 1, level: 1 }).finish());
    assert.deepEqual(bare.skills, []);
});

test('★★ 技能升级请求/响应走真实编解码，字段号与 proto 源一致', () => {
    const game = (protobufRoot as any).com.xkhy.tafang.cmd;
    const protoSrc = readFileSync(PROTO_SRC, 'utf8');
    const fieldOf = (message: string, field: string): number => {
        const body = new RegExp(`message ${message} \\{([^}]*)\\}`).exec(protoSrc);
        assert.ok(body, `proto 源里找不到 message ${message}`);
        const m = new RegExp(`${field}\\s*=\\s*(\\d+)`).exec(body[1]);
        assert.ok(m, `${message} 里找不到字段 ${field}`);
        return Number(m[1]);
    };

    assert.equal(fieldOf('CmdPvpHeroUpSkillReqMsg', 'heroId'), 1);
    assert.equal(fieldOf('CmdPvpHeroUpSkillReqMsg', 'skillId'), 2);
    assert.equal(fieldOf('CmdPvpHeroSkillInfo', 'id'), 1);
    assert.equal(fieldOf('CmdPvpHeroSkillInfo', 'level'), 2);

    const req = game.CmdPvpHeroUpSkillReqMsg.create({ heroId: 68003, skillId: 91001012 });
    // ⚠️ `create()` 的返回值是**实例**，encode/decode 挂在**类型**上 ——
    //    写成 `req.encode(...)` 会得到 `req.encode is not a function`。
    // ⚠️ decode 出来的是 Message 实例，与 plain object 的 deepEqual 会因原型不同而失败，
    //    所以逐字段断言。
    const reqBack = game.CmdPvpHeroUpSkillReqMsg.decode(game.CmdPvpHeroUpSkillReqMsg.encode(req).finish());
    assert.equal(reqBack.heroId, 68003);
    assert.equal(reqBack.skillId, 91001012);

    const rsp = game.CmdPvpHeroUpSkillRspMsg.create({
        info: { heroId: 68003, level: 12, skills: [{ id: 91001012, level: 3 }] },
    });
    const back = game.CmdPvpHeroUpSkillRspMsg.decode(game.CmdPvpHeroUpSkillRspMsg.encode(rsp).finish());
    assert.equal(back.info.heroId, 68003);
    assert.equal(back.info.level, 12);
    assert.deepEqual(back.info.skills.map((s: any) => [s.id, s.level]), [[91001012, 3]]);
});

test('反射 JSON 与静态模块口径一致（protoCompiled.json 也要重生成）', () => {
    const root = protobuf.Root.fromJSON(JSON.parse(readFileSync(REFLECT_JSON, 'utf8')));
    const info = root.lookupType('com.xkhy.tafang.cmd.CmdPvpHeroInfo');
    const skill = root.lookupType('com.xkhy.tafang.cmd.CmdPvpHeroSkillInfo');
    assert.ok(info, '反射 JSON 里缺 CmdPvpHeroInfo');
    assert.ok(skill, '反射 JSON 里缺 CmdPvpHeroSkillInfo');
    assert.equal(skill.fields.id.id, 1);
    assert.equal(skill.fields.level.id, 2);
    assert.equal(root.lookupEnum('com.xkhy.tafang.cmd.MessageId').values.CmdPvpHeroUpSkillRspMsg, 473853329);

    const bytes = info.encode(info.create({ heroId: 1, level: 2, skills: [{ id: 7, level: 3 }] })).finish();
    assert.deepEqual((info.decode(bytes) as any).skills.map((s: any) => [s.id, s.level]), [[7, 3]]);
});

// ============================================================
// B. 接线层：请求封装 + 缓存回写语义
// ============================================================

test('★★ 请求封装走协议名反查（名字错了 GameNet 直接拦）', () => {
    const src = readFileSync(REQUEST_SRC, 'utf8');
    assert.match(src, /class RequestPvpHeroUpSkill extends RequestMsg<CmdPvpHeroUpSkillReqMsg, CmdPvpHeroUpSkillRspMsg>/);
    assert.match(src, /return 'CmdPvpHeroUpSkillReqMsg'/);
});

/**
 * 反向断言（`doesNotMatch`）必须**先剥注释**，否则注释里写「不猜 `skillId + 1`」
 * 这类说明文字会让用例假红（rule 104：反向断言先剥注释）。
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
        .join('\n');
}

test('★★ Repository 发的是新请求，且技能等级从响应取而不是 skillId + 1', () => {
    const src = readFileSync(REPO_SRC, 'utf8');
    assert.match(src, /new RequestPvpHeroUpSkill\(\{ heroId, skillId \}/);
    assert.match(src, /CmdPvpHeroUpSkillRspMsg/);
    // 服务端可能连升/不满级跳级 ⇒ 必须 find 响应里的那条，不能自己 +1。
    assert.match(src, /skills\.find\(\(skill\) => skill\.skillId === skillId\)/);
    assert.doesNotMatch(stripComments(src), /skillId \+ 1/);
});

test('★★ 升英雄等级不能顺手清空技能等级', () => {
    const src = readFileSync(SERVICE_SRC, 'utf8');
    // applyPvpHeroLevel 不传 skills 时必须**保留**缓存里的那份。
    assert.match(src, /skills: skills \?\? info\.skills/);
    assert.match(src, /if \(!replaced\) next\.push\(\{ heroId, level, skills: skills \?\? \[\] \}\)/);
});

test('★★ 技能表归一化：去重 / 按 id 升序，且不返回服务端数组本身', () => {
    const src = readFileSync(SERVICE_SRC, 'utf8');
    assert.match(src, /function normalizeHeroSkills/);
    assert.match(src, /result\.set\(skillId, \{ skillId, level \}\)/);
    assert.match(src, /\.sort\(\(a, b\) => a\.skillId - b\.skillId\)/);
    // 返回 Array.from(...) 而非原数组：外部改到会影响缓存。
    assert.match(src, /return Array\.from\(result\.values\(\)\)\.sort/);
});

test('★★ 技能升级也要回写缓存（响应只回一条英雄信息，不刷列表）', () => {
    const src = readFileSync(SERVICE_SRC, 'utf8');
    assert.match(src, /applyPvpHeroSkillLevel\(/);
    // 缓存里没有这条技能 → 追加，不能丢（服务端新开的技能）。
    assert.match(src, /\[\.\.\.info\.skills, \{ skillId, level \}\]/);
});

test('英雄列表按协议数值归一化，升级写回保留技能并支持追加', async () => {
    const { exports: module, unresolved } = loadTsModule<typeof import('../assets/script/app/card/PvpHeroService')>(SERVICE_SRC, {
        modules: {
            '/RequestGuard': requestGuard,
            '/RequestPvpMsg': {
                RequestPvpHeroInfoList: class {
                    constructor(_body: object, _caller: object, readonly fCallback: (rsp: object) => void) {}
                },
            },

        },
        globals: { console: { warn() {} } },
    });
    assert.deepEqual(unresolved, []);
    const infos = module.normalizePvpHeroInfos([
        { heroId: 1, level: 1 },
        { heroId: 0, level: 1 },
        { heroId: 2, level: -1 },
        { heroId: 1, level: 2, skills: [
            { id: 9, level: 1 }, { id: 7, level: 1 }, { id: 7, level: 3 },
        ] },
        { heroId: 3, level: 0 },
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(infos)), [
        { heroId: 1, level: 2, skills: [{ skillId: 7, level: 3 }, { skillId: 9, level: 1 }] },
        { heroId: 3, level: 0, skills: [] },
    ]);

    const service = new module.PvpHeroService({
        isConnected: true,
        send: async request => {
            request.fCallback({ infos: [{ heroId: 1, level: 2, skills: [{ id: 7, level: 3 }] }] } as never);
            return true;
        },
        removeCaller() {},
    });
    await service.fetchPvpHeroInfos();
    service.applyPvpHeroLevel(1, 4);
    assert.equal(service.getCachedPvpHeroInfo(1).skills[0].level, 3);
    service.applyPvpHeroSkillLevel(1, 7, 5);
    service.applyPvpHeroSkillLevel(1, 9, 0);
    service.applyPvpHeroLevel(2, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(service.getCachedPvpHeroInfos())), [
        { heroId: 1, level: 4, skills: [{ skillId: 7, level: 5 }, { skillId: 9, level: 0 }] },
        { heroId: 2, level: 0, skills: [] },
    ]);
});

test('英雄缓存按会话隔离：合并请求，释放取消等待且迟到响应不污染新会话', async () => {
    const { Service, net, requests, callers } = sessionFixture();
    const first = new Service(net);
    const pending = first.fetchPvpHeroInfos();
    assert.equal(first.fetchPvpHeroInfos(), pending);
    assert.equal(requests.length, 1);
    assert.equal(callers[0], first);
    const cancelled = requests[0].promise;
    const lateReply = requests[0].resolve;
    first.dispose();
    first.dispose();
    assert.equal(await cancelled, false);
    assert.equal(await pending, null);

    const second = new Service(net);
    const current = second.fetchPvpHeroInfos();
    lateReply({ infos: [{ heroId: 1, level: 99 }] });
    assert.equal(first.getCachedPvpHeroInfos(), null);
    assert.equal(second.getCachedPvpHeroInfos(), null);
    requests[1].resolve({ infos: [{ heroId: 2, level: 0 }] });
    await current;
    assert.equal(second.getCachedPvpHeroInfo(2).level, 0);
    assert.equal(second.getCachedPvpHeroInfo(1), null);
    assert.equal(await first.fetchPvpHeroInfos(), null);
    assert.equal(requests.length, 2);
    second.dispose();
    assert.equal(second.getCachedPvpHeroInfos(), null);
});

test('响应已落定但 await 尚未恢复时释放，也不能重新写入旧会话缓存', async () => {
    const { Service, net, requests } = sessionFixture();
    const service = new Service(net);
    const pending = service.fetchPvpHeroInfos();
    requests[0].resolve({ infos: [{ heroId: 1, level: 9 }] });
    service.dispose();
    assert.equal(await pending, null);
    assert.equal(service.getCachedPvpHeroInfos(), null);
});
