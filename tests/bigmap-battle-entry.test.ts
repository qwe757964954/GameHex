import { createControllerResources } from './helpers/controller-context';
import { resolveZCBattlePlayerCount, buildZCBattleReturnParams } from '../assets/script/app/zcds/application/ZCBattleEntryBuilder';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { componentControllerModule } from './helpers/controller-context';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { BIGMAP_TABLE, decompressBigMapRows, parseBigMapConfig } from '../assets/script/app/bigmap/model/BigMapConfig';
import { createBigMapSave, serializeBigMapSave } from '../assets/script/app/bigmap/model/BigMapSaveData';
import { BigMapModel } from '../assets/script/app/bigmap/application/BigMapModel';
import { BigMapCampRepository } from '../assets/script/app/bigmap/application/BigMapCampRepository';
import { createMemoryBigMapStorage } from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import { loadBigMapConfig } from './helpers/bigmap-fixtures';

function tables(): Record<string, unknown> {
    return Object.fromEntries(Object.values(BIGMAP_TABLE).map((name) => [name,
        JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'))]));
}

test('据点战斗配置来自 bigMapCamp，严格保留 campId 与 campBattleId 两种身份', () => {
    const config = loadBigMapConfig();
    const rows = decompressBigMapRows(JSON.parse(readFileSync('assets/remoteRef/bigMapCamp.json', 'utf8')));
    assert.equal(config.camps.size, rows.length);
    assert.equal(config.camps.get(101)?.battleId, 50001);
    for (const row of rows) {
        assert.equal(config.camps.get(Number(row.campId))?.battleId, row.campBattleId);
    }
    for (const value of [0, -1, 1.5, '50001', undefined]) {
        assert.throws(() => parseBigMapConfig({ ...tables(), bigMapCamp: [{ ...rows[0], campBattleId: value }] }), /campBattleId/);
    }
    assert.throws(() => parseBigMapConfig({ ...tables(), bigMapCamp: [rows[0], rows[0]] }), /重复/);
});

function fixture(start?: (type: number, id: number, isCurrent: () => boolean) => Promise<{ ok: boolean; message: string }>,
    campResponse: unknown = { infos: [{ campId: 101, opType: 0 }] }, clearedMonsterLevel=0) {
    const repository = new BigMapCampRepository({
        fetchSimple: async () => campResponse,
        fetchDetail: async () => campResponse,
        // 角色列表是另一条协议，这里给「空据点」——这些用例只关心据点状态与开战。
        fetchRoles: async (campId: number) => ({ campId, infos: [] }),
        // 迁城是写操作，这批用例用不到；给「明确失败」避免误判成功。
        requestMove: async () => null,
    });
    const storage = createMemoryBigMapStorage();
    if(clearedMonsterLevel>0){const save=createBigMapSave(loadBigMapConfig(),957600);storage.write('battle-entry',serializeBigMapSave({...save,battle:{...save.battle,clearedMonsterLevel}}));}
    const presenter = new BigMapModel({ config: loadBigMapConfig(), storage, saveKey: 'battle-entry',
        adventureChapter: () => 0, now: () => 957600, campRepository: repository, startBattle: start });
    return { presenter, storage, setCampResponse(response: unknown) { campResponse = response; } };
}

test('服务端据点开放后用 1004 + campId 开战，不走本地伤害和存档结算', async () => {
    const calls: number[][] = [];
    const { presenter, storage } = fixture(async (type, id) => { calls.push([type, id]); return { ok: true, message: '' }; });
    assert.equal(presenter.cityView(101)?.canAttack, false, '查询未返回不能先开放');
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.canAttack, true, '服务端开放不能被离线章节和日程挡住');
    const original = storage.read('battle-entry');
    const stamina = presenter.base.stamina;
    assert.equal((await presenter.requestAttackCity(101)).ok, true);
    assert.deepEqual(calls, [[1004, 101]]);
    assert.equal(presenter.base.stamina, stamina);
    assert.equal(storage.read('battle-entry'), original);
    assert.deepEqual(presenter.battle.occupiedCityIds, []);
    presenter.dispose();
});

test('野怪用 1003 + monsterId 开战，不传 monsterBattle 或地图实例 ID', async () => {
    const calls: number[][] = [];
    const { presenter, storage } = fixture(async (type, id) => { calls.push([type, id]); return { ok: true, message: '' }; },undefined,99);
    const original = storage.read('battle-entry');
    for (const site of presenter.world.monsters) {
        assert.equal(presenter.monsterView(site.instanceId)?.canAttack, true);
        assert.equal((await presenter.requestAttackMonster(site.instanceId)).ok, true);
    }
    assert.deepEqual(calls, presenter.world.monsters.map((site) => [1003, site.monsterId]));
    assert.ok(calls.some(([, id]) => id === 8013), '原先传30013的野怪应发送怪物配置ID 8013');
    assert.equal(storage.read('battle-entry'), original);
    presenter.dispose();
});

test('雾隐堡详情获取失败后仍可请求 1004，使用 campId 并由开战回包确认资格', async () => {
    for (const response of [null, { infos: [] }]) {
        const calls: number[][] = [];
        const { presenter, storage } = fixture(async (type, id) => {
            calls.push([type, id]);
            return { ok: false, message: '服务器拒绝开战' };
        }, response);
        const original = storage.read('battle-entry');
        await presenter.refreshCampDetail(201);
        const view = presenter.cityView(201);
        assert.equal(view?.name, '雾隐堡');
        assert.equal(view?.campDetailStatus, 'failed');
        assert.equal(view?.campInfo, null, '不能把查询失败伪造成已开放');
        assert.equal(view?.canAttack, true, '查询失败不能锁死独立的开战入口');
        assert.equal(view?.attackReason, '');
        assert.equal((await presenter.requestAttackCity(201)).message, '服务器拒绝开战');
        assert.deepEqual(calls, [[1004, 201]]);
        assert.equal(storage.read('battle-entry'), original);
        presenter.dispose();
    }
});

test('雾隐堡 205 的 1004 参数使用城池配置 ID 205，不传关联战斗 50027', async () => {
    const calls: number[][] = [];
    const { presenter } = fixture(async (type, id) => {
        calls.push([type, id]);
        return { ok: true, message: '' };
    }, { infos: [{ campId: 205, opType: 0 }] });
    assert.equal(loadBigMapConfig().camps.get(205)?.battleId, 50027);
    await presenter.refreshCampDetail(205);
    assert.equal((await presenter.requestAttackCity(205)).ok, true);
    assert.deepEqual(calls, [[1004, 205]]);
    presenter.dispose();
});

test('已占领的据点详情查询后仍禁止开战', async () => {
    let calls = 0;
    const { presenter, setCampResponse } = fixture(async () => { calls += 1; return { ok: true, message: '' }; },
        { infos: [{ campId: 101, opType: 1 }] });
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.state, 'occupied');
    assert.equal(presenter.cityView(101)?.canAttack, false);
    assert.match(presenter.cityView(101)?.attackReason ?? '', /已被占领/);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 0);
    setCampResponse(null);
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'failed');
    assert.equal(presenter.cityView(101)?.canAttack, false, '查询失败不能绕过已知的禁止攻击状态');
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 0);
    presenter.dispose();
});

test('非攻城时段即使已开放也不许开战（协议不再下发「开放/攻城中」，由日程兜住）', async () => {
    let calls = 0;
    const repository = new BigMapCampRepository({
        fetchSimple: async () => ({ infos: [{ campId: 101, opType: 0 }] }),
        fetchDetail: async () => ({ infos: [{ campId: 101, opType: 0 }] }),
        fetchRoles: async (campId: number) => ({ campId, infos: [] }),
        requestMove: async () => null,
    });
    // 957600 = 11 天又 02:00（UTC），+8 时区 = 10:00 本地（可打）；拨到 14:00 UTC = 22:00 本地（休战）。
    const presenter = new BigMapModel({
        config: loadBigMapConfig(), storage: createMemoryBigMapStorage(), saveKey: 'battle-entry-night',
        adventureChapter: () => 3, now: () => 957600 + 12 * 3600, campRepository: repository,
        startBattle: async () => { calls += 1; return { ok: true, message: '' }; },
    });
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.state, 'open', '未占领就是已开放');
    assert.equal(presenter.cityView(101)?.canAttack, false);
    assert.match(presenter.cityView(101)?.attackReason ?? '', /休战/);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 0);
    presenter.dispose();
});

test('开战拒绝重复点击；关页后校验失效，迟到结果不能报告开战成功', async () => {
    let complete: (value: { ok: boolean; message: string }) => void = () => {};
    let isCurrent: () => boolean = () => false;
    let calls = 0;
    const { presenter } = fixture(async (_type, _id, guard) => {
        calls += 1;
        isCurrent = guard;
        return new Promise((resolve) => { complete = resolve; });
    });
    await presenter.refreshCampDetail(101);
    const first = presenter.requestAttackCity(101);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 1);
    assert.equal(isCurrent(), true);
    presenter.dispose();
    assert.equal(isCurrent(), false);
    complete({ ok: true, message: '' });
    assert.equal((await first).ok, false);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
});

test('开战失败可重试，未配置入口的预览仍拒绝新版战斗', async () => {
    let calls = 0;
    const { presenter } = fixture(async () => { calls += 1; throw new Error('offline'); });
    await presenter.refreshCampDetail(101);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal((await presenter.requestAttackCity(101)).ok, false);
    assert.equal(calls, 2);
    presenter.dispose();
    const preview = fixture();
    const site = preview.presenter.world.monsters[0];
    assert.equal((await preview.presenter.requestAttackMonster(site.instanceId)).ok, false);
    preview.presenter.dispose();
});

test('SLG 结算返回世界页，领地返回单次章节与格子焦点', () => {
    for (const slgBattleType of [1003, 1004] as const) assert.deepEqual(buildZCBattleReturnParams({ slgBattleType, pveContext: null }), { initialTab: 'world' });
    assert.deepEqual(buildZCBattleReturnParams({ pveContext: { chapterId: 2, levelId: 3, territoryCellId: 44 } }), { initialTab: 'territory', focusChapterId: 2, focusCellId: 44 });
    assert.equal(buildZCBattleReturnParams({ pveContext: null }), undefined);
});

test('SLG 预加载按服务端参战人数挑选地图，缺失战斗或非法人数拒绝进入本地假局', () => {
    for (const count of [2, 3, 4]) {
        assert.equal(resolveZCBattlePlayerCount({ slgBattleType: 1004, battle: { units: Array.from({ length: count }, () => ({})) } } as Parameters<typeof resolveZCBattlePlayerCount>[0]), count);
    }
    assert.throws(() => resolveZCBattlePlayerCount({ slgBattleType: 1004 }), /SLG/);
    for (const count of [0, 1, 5]) {
        assert.throws(() => resolveZCBattlePlayerCount({ slgBattleType: 1004, battle: { units: Array(count).fill({}) } } as Parameters<typeof resolveZCBattlePlayerCount>[0]), /SLG/);
    }
});
