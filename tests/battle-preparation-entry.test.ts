import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('领地与大地图都移交统一预加载，所有战斗入口使用会话复用资产', () => {
    const territory = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    const bigmap = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    const game = readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8');
    assert.match(territory, /createZCBattlePreload/);
    assert.match(bigmap, /createZCBattlePreload/);
    assert.match(bigmap, /slgBattleType: battleType,[\s\S]*?preload/);
    for (const source of [territory, bigmap, game]) assert.match(source, /reusableAssets/);
    assert.match(territory, /warmupBattle/);
    assert.match(bigmap, /warmupBattle/);
});

test('统一预加载原样传递战斗 Promise、波次与地图人数，不提前构筑', async () => {
    const calls: unknown[] = [];
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCBattlePreparation.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, Date, console: { info() {} }, require(name: string) {
        if (name === '../ZCGame') return { MAP_DIRECTORY: 'config/maps' };
        if (name === './ZCGameLoader') return { ZCGameLoader: class { constructor(...args: unknown[]) { calls.push(args); } } };
        if (name === './ZCGamePreload') return { ZCGamePreload: class { ready = Promise.resolve({}); constructor(...args: unknown[]) { calls.push(args); } } };
        return {};
    } });
    const assets = {}, configs = {}, battle = Promise.resolve(null);
    const preload = exports.createZCBattlePreload(assets, configs, battle, { playerCount: 2, waveCardIds: [91001] });
    await preload.ready;
    const loaderArgs = calls[0] as unknown[], preloadArgs = calls[1] as unknown[];
    assert.equal(loaderArgs[0], assets); assert.equal(loaderArgs[1], configs); assert.equal(loaderArgs[2], 'config/maps');
    assert.equal(loaderArgs[4], 2); assert.equal(preloadArgs[1], battle);
    assert.deepEqual(Array.from(preloadArgs[2] as number[]), [91001]);
});
