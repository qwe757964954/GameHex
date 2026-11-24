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

function fixture(canRequestBattle = true, campResponse: unknown = { infos: [{ campId: 101, opType: 0 }] },
    clearedMonsterLevel = 0, seconds = 957600) {
    const repository = new BigMapCampRepository({
        fetchSimple: async () => campResponse,
        fetchDetail: async () => campResponse,
        fetchRoles: async (campId: number) => ({ campId, infos: [] }),
        requestMove: async () => null,
    });
    const storage = createMemoryBigMapStorage();
    if (clearedMonsterLevel > 0) {
        const save = createBigMapSave(loadBigMapConfig(), seconds);
        storage.write('battle-entry', serializeBigMapSave({ ...save, battle: { ...save.battle, clearedMonsterLevel } }));
    }
    const presenter = new BigMapModel({ config: loadBigMapConfig(), storage, saveKey: 'battle-entry',
        adventureChapter: () => 0, now: () => seconds, campRepository: repository, canRequestBattle });
    return { presenter, storage, setCampResponse(response: unknown) { campResponse = response; } };
}

test('服务端据点开放后产出 1004 + campId，存档和体力保持原值', async () => {
    const { presenter, storage } = fixture();
    assert.equal(presenter.cityView(101)?.canAttack, false);
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.canAttack, true);
    const original = storage.read('battle-entry');
    const stamina = presenter.base.stamina;
    assert.deepEqual(presenter.requestAttackCity(101).battle, { battleType: 1004, targetConfigId: 101 });
    assert.equal(presenter.base.stamina, stamina);
    assert.equal(storage.read('battle-entry'), original);
    assert.deepEqual(presenter.battle.occupiedCityIds, []);
    presenter.dispose();
});

test('野怪开战计划使用 1003 + monsterId', () => {
    const { presenter, storage } = fixture(true, undefined, 99);
    const original = storage.read('battle-entry');
    for (const site of presenter.world.monsters) {
        assert.equal(presenter.monsterView(site.instanceId)?.canAttack, true);
        assert.deepEqual(presenter.requestAttackMonster(site.instanceId).battle, { battleType: 1003, targetConfigId: site.monsterId });
        presenter.finishBattleRequest();
    }
    assert.ok(presenter.world.monsters.some(site => site.monsterId === 8013));
    assert.equal(storage.read('battle-entry'), original);
    presenter.dispose();
});

test('据点详情获取失败后仍可申请开战，传据点 ID 205 而非战斗配置 50027', async () => {
    for (const response of [null, { infos: [] }]) {
        const { presenter, storage } = fixture(true, response);
        assert.equal(loadBigMapConfig().camps.get(205)?.battleId, 50027);
        const original = storage.read('battle-entry');
        await presenter.refreshCampDetail(205);
        const view = presenter.cityView(205);
        assert.equal(view?.campDetailStatus, 'failed');
        assert.equal(view?.campInfo, null);
        assert.equal(view?.canAttack, true);
        assert.deepEqual(presenter.requestAttackCity(205).battle, { battleType: 1004, targetConfigId: 205 });
        assert.equal(storage.read('battle-entry'), original);
        presenter.dispose();
    }
});

test('占领状态和休战日程都可拒绝开战', async () => {
    const { presenter, setCampResponse } = fixture(true, { infos: [{ campId: 101, opType: 1 }] });
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.state, 'occupied');
    assert.equal(presenter.requestAttackCity(101).ok, false);
    setCampResponse(null);
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.cityView(101)?.campDetailStatus, 'failed');
    assert.equal(presenter.requestAttackCity(101).ok, false);
    presenter.dispose();

    const night = fixture(true, undefined, 0, 957600 + 12 * 3600);
    await night.presenter.refreshCampDetail(101);
    assert.equal(night.presenter.cityView(101)?.state, 'open');
    assert.match(night.presenter.requestAttackCity(101).message, /休战/);
    night.presenter.dispose();
});

test('开战在途时拒绝重复攻击，结果落定后可重试，预览入口拒绝联机开战', async () => {
    const { presenter } = fixture();
    await presenter.refreshCampDetail(101);
    assert.equal(presenter.requestAttackCity(101).ok, true);
    assert.equal(presenter.requestAttackCity(101).ok, false);
    presenter.finishBattleRequest();
    assert.equal(presenter.requestAttackCity(101).ok, true);
    presenter.dispose();
    assert.equal(presenter.requestAttackCity(101).ok, false);

    const preview = fixture(false);
    const site = preview.presenter.world.monsters[0];
    assert.equal(preview.presenter.requestAttackMonster(site.instanceId).ok, false);
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
