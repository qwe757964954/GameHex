/**
 * 据点角色事件广播（`CmdSlgGameRoleInfoBroMsg`，协议 r883）的接线单测。
 *
 * 这条广播**带完整角色信息**，所以走增量更新而不是"失效重拉"。四类静默错误要钉住：
 *   ① `eventType` 认不出来还硬套某个已知事件 ⇒ 把血量/位置写坏（只认 1~4）；
 *   ② 按 `pos` 匹配旧记录 ⇒ `Move` 之后旧格上留一条幽灵角色（必须按 `roleId` 覆盖）；
 *   ③ 从没查过的据点被塞进一条 ⇒ 详情面板凭空显示"1 人"（无缓存则不写）；
 *   ④ 广播不带 `campId`，`pos` 反查不到据点时乱归属（反查为空就丢弃）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import protobuf from 'protobufjs/light.js';
import {
    BIGMAP_ROLE_EVENT_TYPE,
    normalizeBigMapCampRoleInfo,
    normalizeBigMapCampRoleInfos,
    normalizeBigMapRoleEvent,
    type BigMapRoleEventType,
    type IBigMapRoleEvent,
} from '../assets/script/app/bigmap/model/BigMapCampRoleInfo';
import { BigMapCampRepository, type IBigMapCampGateway } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { BigMapPresenter } from '../assets/script/app/bigmap/application/BigMapPresenter';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

const CMD = 'com.xkhy.tafang.cmd';

const root = protobuf.Root.fromJSON(JSON.parse(readFileSync('assets/resources/config/protoCompiled.json', 'utf8')));

function role(patch: Partial<{ roleId: string; serverId: string; roleName: string; img: string; defenseHp: number; pos: number }> = {}) {
    return { roleId: '1', serverId: '3001', roleName: '山猫', img: '2001', defenseHp: 100, pos: 5, ...patch };
}

// ============================================================================
// ① 协议
// ============================================================================

test('协议：eventType 是 uint32，info 就是 SlgGameCameRoleInfo 本体', () => {
    const bro = root.lookupType(`${CMD}.CmdSlgGameRoleInfoBroMsg`);
    assert.deepEqual(Object.keys(bro.fields), ['eventType', 'info']);
    assert.equal(bro.fields.eventType.id, 1);
    assert.equal(bro.fields.eventType.type, 'uint32');
    assert.equal(bro.fields.info.id, 2);
    assert.equal(bro.fields.info.resolvedType, root.lookupType(`${CMD}.SlgGameCameRoleInfo`));
});

test('★协议：MessageId 已登记（BroMsg 靠它分发）', () => {
    const ids = root.lookupEnum(`${CMD}.MessageId`);
    assert.equal(ids.values.CmdSlgGameRoleInfoBroMsg, 582176172);
});

test('编码往返：四种事件都能编解，pos=0 不丢', () => {
    const bro = root.lookupType(`${CMD}.CmdSlgGameRoleInfoBroMsg`);
    for (const eventType of [1, 2, 3, 4]) {
        const decoded = bro.toObject(bro.decode(bro.encode(bro.create({ eventType, info: role({ pos: 0 }) })).finish()));
        const event = normalizeBigMapRoleEvent(decoded);
        assert.ok(event, `eventType=${eventType} 应能归一化`);
        assert.equal(event.eventType, eventType);
        assert.equal(event.role.pos, 0);
    }
});

// ============================================================================
// ② 事件归一化
// ============================================================================

test('★归一化：eventType 只认 1~4，其它值整条丢弃', () => {
    assert.deepEqual(BIGMAP_ROLE_EVENT_TYPE, { Attack: 1, Revive: 2, Move: 3, Spawn: 4 });
    for (const eventType of [1, 2, 3, 4]) {
        assert.equal(normalizeBigMapRoleEvent({ eventType, info: role() })?.eventType, eventType);
    }
    // 服务端以后加 5，老客户端不许把它当成某个已知事件去改数据。
    for (const eventType of [0, 5, -1, 1.5, undefined, 'abc']) {
        assert.equal(normalizeBigMapRoleEvent({ eventType, info: role() }), null, `eventType=${String(eventType)} 应丢`);
    }
    // 纯数字字符串按数字收（`toCount` 口径），不算错。
    assert.equal(normalizeBigMapRoleEvent({ eventType: '3', info: role() })?.eventType, 3);
});

test('归一化：缺 info / roleId 空 / pos 非法都丢整条', () => {
    assert.equal(normalizeBigMapRoleEvent({ eventType: 1 }), null);
    assert.equal(normalizeBigMapRoleEvent({ eventType: 1, info: role({ roleId: '' }) }), null);
    assert.equal(normalizeBigMapRoleEvent({ eventType: 1, info: role({ pos: -1 }) }), null);
    assert.equal(normalizeBigMapRoleEvent(null), null);
});

test('单条归一化与列表归一化同口径（uint64 走字符串）', () => {
    const one = normalizeBigMapCampRoleInfo(role({ roleId: '9007199254740993', img: '9007199254740995' }));
    assert.equal(one?.roleId, '9007199254740993');
    assert.equal(one?.avatarId, '9007199254740995');
    const list = normalizeBigMapCampRoleInfos({ campId: 205, infos: [role()] }, 205);
    assert.deepEqual(list?.[0], normalizeBigMapCampRoleInfo(role()));
});

// ============================================================================
// ③ 仓库合并
// ============================================================================

/** 造一条角色事件（默认攻击、pos 5）。 */
const event = (
    patch: Partial<{ roleId: string; pos: number; defenseHp: number }> = {},
    eventType: BigMapRoleEventType = BIGMAP_ROLE_EVENT_TYPE.Attack,
): IBigMapRoleEvent => ({
    eventType,
    role: { roleId: '1', serverId: '3001', roleName: '山猫', avatarId: '2001', defenseHp: 100, pos: 5, ...patch },
});

/** 网关桩：`rosters` 决定 `fetchRoles` 返回什么；`emit` 用来模拟服务端推广播。 */
function makeGateway(rosters: ReadonlyMap<number, readonly ReturnType<typeof role>[]> = new Map()) {
    let listener: ((event: IBigMapRoleEvent) => void) | null = null;
    let unsubscribed = 0;
    const gateway: IBigMapCampGateway = {
        fetchSimple: async () => null,
        fetchDetail: async (ids) => ({ infos: ids.map((campId) => ({ campId, opType: 0, state: 1 })) }),
        fetchRoles: async (campId) => ({ campId, infos: [...(rosters.get(campId) ?? [])] }),
        requestMove: async () => null,
        subscribeRoleEvents: (fn) => {
            listener = fn;
            return () => { unsubscribed += 1; listener = null; };
        },
    };
    return {
        gateway,
        emit: (evt: IBigMapRoleEvent) => listener?.(evt),
        get unsubscribed() { return unsubscribed; },
    };
}

/** 建一个「已拉到 205 据点角色 + 已订阅广播」的仓库；`pos <= 20` 都算 205 的格。 */
async function withRoles(roster: readonly ReturnType<typeof role>[]) {
    const h = makeGateway(new Map([[205, roster]]));
    const repository = new BigMapCampRepository(h.gateway);
    await repository.refreshRoles(205);
    repository.subscribeRoleEvents((pos) => (pos <= 20 ? 205 : 0));
    return { h, repository };
}

test('★仓库：没查过的据点不许凭空塞角色（面板会凭空出现「1 人」）', () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    assert.equal(repository.applyRoleEvent(205, event()), false);
    assert.equal(repository.rolesOf(205), null);
    repository.dispose();
});

test('★仓库：攻击改血量、移动换格不留幽灵、出生顶掉同格原有角色', async () => {
    const { h, repository } = await withRoles([role({ roleId: '1', pos: 5 }), role({ roleId: '2', pos: 9 })]);
    assert.deepEqual(repository.rolesOf(205)?.map((item) => item.roleId), ['1', '2']);
    let notifies = 0;
    repository.onChanged(() => { notifies += 1; });

    // 攻击：只改血量
    h.emit(event({ pos: 5, defenseHp: 40 }, BIGMAP_ROLE_EVENT_TYPE.Attack));
    assert.equal(repository.rolesOf(205)?.find((item) => item.roleId === '1')?.defenseHp, 40);
    assert.equal(notifies, 1, '合进缓存后要通知视图');

    // 移动：5 → 12，旧格不能留记录
    h.emit(event({ pos: 12, defenseHp: 40 }, BIGMAP_ROLE_EVENT_TYPE.Move));
    assert.deepEqual(repository.rolesOf(205)?.map((item) => item.pos), [9, 12], '★Move 是覆盖不是新增');

    // 出生：新角色站到 9 号格 ⇒ 原来那个必须让位（一格一人，查询回包也是按 pos 去重）
    h.emit({ eventType: BIGMAP_ROLE_EVENT_TYPE.Spawn, role: {
        roleId: '3', serverId: '3001', roleName: '新来的', avatarId: '', defenseHp: 100, pos: 9,
    } });
    assert.deepEqual(repository.rolesOf(205)?.map((item) => item.roleId), ['3', '1'], '★同格后到顶掉前一个');
    assert.deepEqual(repository.rolesOf(205)?.map((item) => item.pos), [9, 12]);
    repository.dispose();
});

test('★仓库：pos 反查不到据点（campIdOf 返 0）就丢弃，不乱归属', async () => {
    const { h, repository } = await withRoles([role({ roleId: '1', pos: 5 })]);
    const before = repository.rolesOf(205);
    h.emit(event({ roleId: '9', pos: 999, defenseHp: 1 }));
    assert.equal(repository.rolesOf(205), before, '反查不到就不动任何据点');
    repository.dispose();
});

test('仓库：dispose 会摘掉广播订阅', () => {
    const h = makeGateway();
    const repository = new BigMapCampRepository(h.gateway);
    repository.subscribeRoleEvents(() => 205);
    assert.equal(h.unsubscribed, 0);
    repository.dispose();
    assert.equal(h.unsubscribed, 1, '★页面关了必须退订，否则监听器一直持有 Presenter');
});

// ============================================================================
// ④ Presenter 接线
// ============================================================================

test('★Presenter：广播按 pos 反查据点，详情面板角色列表实时更新', async () => {
    const config = loadBigMapConfig();
    let listener: ((event: IBigMapRoleEvent) => void) | null = null;
    const roster = { campId: 0, infos: [] as ReturnType<typeof role>[] };
    const gateway: IBigMapCampGateway = {
        fetchSimple: async () => null,
        fetchDetail: async (ids) => ({ infos: ids.map((campId) => ({ campId, opType: 0, state: 1 })) }),
        fetchRoles: async (campId) => {
            roster.campId = campId;
            return { campId, infos: roster.infos };
        },
        requestMove: async () => null,
        subscribeRoleEvents: (fn) => { listener = fn; return () => { listener = null; }; },
    };
    const repository = new BigMapCampRepository(gateway);
    const presenter = new BigMapPresenter({
        config, storage: createMemoryBigMapStorage(), saveKey: 'role-broadcast',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository,
    });
    const campId = presenter.territoryRegions()[0].id;
    const hexId = presenter.territoryRegions()[0].hexIds[0];
    assert.ok(campId > 0 && hexId >= 0, '夹具：地图上至少有一座城带格');

    // 面板打开（拉一次详情 + 角色）
    roster.infos = [{ roleId: '1', serverId: '3001', roleName: '山猫', img: '2001', defenseHp: 100, pos: hexId }];
    await presenter.refreshCampDetail(campId);
    assert.equal(presenter.cityView(campId)?.campRoles.length, 1, '初始列表到位');

    let notifies = 0;
    presenter.onChanged(() => { notifies += 1; });
    // 服务端推一条攻击事件：血量掉到 30
    listener?.({ eventType: BIGMAP_ROLE_EVENT_TYPE.Attack, role: {
        roleId: '1', serverId: '3001', roleName: '山猫', avatarId: '2001', defenseHp: 30, pos: hexId,
    } });
    assert.equal(presenter.cityView(campId)?.campRoles[0].defenseHp, 30, '★广播要实时落到面板上');
    assert.ok(notifies >= 1, '要通知视图重绘');
    presenter.dispose();
});
