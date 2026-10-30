import { componentControllerModule } from './helpers/controller-context';
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
    const host = readFileSync('assets/script/app/main/MainTabHost.ts', 'utf8');
    const world = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    assert.match(host, /director\.once\(Director\.EVENT_AFTER_DRAW/);
    assert.ok(!world.includes('warmupBattle'));
});

test('领地与大地图都移交统一预加载，所有战斗入口使用会话复用资产', () => {
    const territory = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    const bigmap = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    const game = readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8');
    assert.match(territory, /createZCBattlePreload/);
    assert.match(bigmap, /createZCBattlePreload/);
    assert.match(bigmap, /slgBattleType: battleType,[\s\S]*?preload/);
    assert.match(game, /controller.resources/);
    for (const source of [territory, bigmap]) assert.doesNotMatch(source, /createZCBattlePreload\([^)]*reusableAssets/);
    assert.ok(!territory.includes('warmupBattle'));
    assert.ok(!bigmap.includes('warmupBattle'));
});

test('统一预加载原样传递战斗 Promise、波次与地图人数，不提前构筑', async () => {
    const calls: unknown[] = [];
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCBattlePreparation.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, Date, console: { info() {} }, require(name: string) {
        if (name.endsWith('/ComponentController')) return componentControllerModule();
        if (name === '../ZCGame') return { MAP_DIRECTORY: 'config/maps' };
        if (name === './ZCGameLoader') return { ZCGameLoader: class { constructor(...args: unknown[]) { calls.push(args); } } };
        if (name === './ZCGamePreload') return { ZCGamePreload: class { ready = Promise.resolve({}); constructor(...args: unknown[]) { calls.push(args); } } };
        return {};
    } });
    const assets = {}, configs = {}, battle = Promise.resolve(null);
    const preload = exports.createZCBattlePreload(battle, { playerCount: 2, waveCardIds: [91001] });
    await preload.ready;
    const loaderArgs = calls[0] as unknown[], preloadArgs = calls[1] as unknown[];
    assert.ok((loaderArgs[0] as { assets: unknown }).assets); assert.equal(loaderArgs[1], 'config/maps');
    assert.equal(loaderArgs[3], 2); assert.equal(preloadArgs[1], battle);
    assert.deepEqual(Array.from(preloadArgs[2] as number[]), [91001]);
});
