import { createControllerContext } from './helpers/controller-context';
import { loadBattlePreparation } from './helpers/battle-composition';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ZC_BATTLE_COMMON_PREFABS } from '../assets/script/app/zcds/model/ZCGameResourcePlan';

test('主界面实际绘制后统一预下载，世界和详情不额外解析预热', () => {
    for (const path of ['units/effects/出生特效/出生特效', 'units/effects/死亡特效/死亡特效',
        'units/effects/建筑死亡特效/建筑死亡特效', 'units/effects/受击特效/法师受击/法师受击']) {
        assert.ok((ZC_BATTLE_COMMON_PREFABS as readonly string[]).includes(path), path);
    }
    const host = readFileSync('assets/script/app/bootstrap/main/MainTabsComposition.ts', 'utf8');
    const world = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    assert.match(host, /director\.once\(Director\.EVENT_AFTER_DRAW/);
    assert.ok(!world.includes('warmupBattle'));
});

test('领地组合层和大地图移交同一会话，View 不创建或持有业务控制器', () => {
    const territory = readFileSync('assets/script/app/territory/application/TerritoryEntry.ts', 'utf8');
    const view = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    const bigmap = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    assert.match(territory, /createZCBattleSession/);
    assert.match(bigmap, /createZCBattleSession/);
    assert.match(bigmap, /slgBattleType: battleType,[\s\S]*?session/);
    assert.doesNotMatch(view, /createZCBattleSession|ZCBattleController|ZCGamePreload|battleSession/);
    assert.match(view, /kind: 'enterBattle'/);
});

test('统一会话等待回包，使用注入资源和本关波次、人数，不创建运行节点', async () => {
    const context = createControllerContext(), owner = new ResourceScope('entry');
    const calls: unknown[][] = [];
    let reply: (value: null) => void = () => {};
    const battle = new Promise<null>(resolve => { reply = resolve; });
    const preparation = loadBattlePreparation({
        '../ZCGame': { MAP_DIRECTORY: 'config/maps' },
        './ZCBattleEntryBuilder': { buildZCBattleEntry() { throw new Error('提前构筑'); }, resolveZCBattlePlayerCount: (params: any) => params.pve.playerCount },
        '../../territory/application/TerritorySaveStoreAdapter': { createTerritorySaveStore() {} },
        './ZCGameLoader': { ZCGameLoader: class {
            constructor(...args: unknown[]) { calls.push(args); }
            async prepare(...args: unknown[]) { calls.push(args); return {}; }
        } },
    });
    const session = preparation.createZCBattleSession(context, { owner, battle, params: { pve: { playerCount: 2, waves: [{ pvpCardId: 91001 }] } } });
    assert.equal(calls.length, 0);
    reply(null); await session.ready;
    assert.equal(calls[0][0], session.resources);
    assert.equal(calls[0][1], 'config/maps');
    assert.equal(calls[0][3], 2);
    assert.equal(calls[1][0], session.scope);
    assert.deepEqual(Array.from(calls[1][2] as number[]), [91001]);
    assert.equal(session.current, null);
    owner.dispose();
});
