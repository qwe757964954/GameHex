import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

test('通用弹道显式启用；池化后拿到专属 Prefab 清空通用图形', () => {
    const { load, cc, FakeNode } = loadViews();
    const view = new (load('./ZCCombatEffectView').ZCCombatEffectView)();
    view.sprite = { enabled: true, spriteFrame: {} };
    view.spriteNode = new FakeNode(); view.graphics = new cc.Graphics();
    const event = { id: 1, type: 'projectile', startedAt: 0, durationSeconds: 1, fromX: 0, fromY: 0, toX: 100, toY: 0 };
    view.initialize(null); view.render(event, .5);
    assert.equal(view.graphics.commands.length, 0, '旧模式缺配置仍不猜表现');
    view.initialize(null, true); view.render(event, .5);
    assert.ok(view.graphics.commands.some((c: any) => c.kind === 'stroke'));
    const prefab = { make: () => new FakeNode('specific') };
    view.initialize(prefab, true); view.render({ ...event, id: 2 }, .5);
    assert.equal(view.graphics.commands.length, 0);
    assert.equal(view.node.children.length, 1);
});

test('通用命中只播 0.15s；补载后新命中采用职业特效，旧通用节点正常回池', () => {
    const { load, FakeNode } = loadViews();
    const pool = new (load('./ZCNodePool').ZCNodePool)();
    const mapLayer = new FakeNode();
    const effects = new (load('./ZCEffectPool').ZCEffectPool)({ pool, mapLayer, allowGenericHitFx: true,
        spawnFxPrefab: null, deathFxPrefab: null, buildingDestroyFxPrefab: null, hitFxPrefabs: new Map(),
        mapToViewX: (x: number) => x, mapToViewY: (y: number) => y });
    effects.playHitFx({ trait: '射手', id: 1, x: 10, y: 20, durationSeconds: .15 }, 0);
    assert.equal(mapLayer.children.length, 1);
    effects.setArt({ spawnFxPrefab: null, deathFxPrefab: null, buildingDestroyFxPrefab: null,
        hitFxPrefabs: new Map([['射手', { make: () => new FakeNode('specific') }]]) });
    effects.playHitFx({ trait: '射手', id: 2, x: 10, y: 20, durationSeconds: .15 }, .1);
    assert.equal(mapLayer.children.length, 2);
    effects.update(.15);
    assert.equal(mapLayer.children.filter(n => n.active).length, 1);
    effects.update(.25);
    assert.equal(mapLayer.children.filter(n => n.active).length, 0);
});


test('后补等真实 after-draw，离场或换局后不派发和刷新', async () => {
    const ts = (await import('typescript')).default;
    const { readFileSync } = await import('node:fs');
    const { runInNewContext } = await import('node:vm');
    const source = ts.createSourceFile('ZCGame.ts', readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ZCGame') as import('typescript').ClassDeclaration;
    const method = declaration.members.find(n => ts.isMethodDeclaration(n) && n.name.getText(source) === 'scheduleDeferredArt')!;
    let afterDraw!: () => void;
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(`export class Harness { ${method.getText(source)} }`, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText, { exports, console, Director: { EVENT_AFTER_DRAW: 'draw' }, director: {
        once(event: string, callback: () => void) { assert.equal(event, 'draw'); afterDraw = callback; },
    } });
    for (const closeBeforeDraw of [false, true]) {
        let loads = 0, updates = 0; let publish!: (art: unknown) => void;
        const game = new exports.Harness(); game.leaving = false; game.isValid = true;
        game.renderWorld = { applyDeferredArt: () => updates++ };
        game.installMapDecor = () => {};
        const frames = new Map();
        const prepared = { decorFrames: frames, loadDeferredArt: (callback: (art: unknown) => void) => {
            loads++; publish = callback; return Promise.resolve();
        } };
        game.preparedResources = prepared; game.scheduleDeferredArt(prepared, {});
        assert.equal(loads, 0);
        if (closeBeforeDraw) game.leaving = true;
        afterDraw();
        assert.equal(loads, closeBeforeDraw ? 0 : 1);
        if (!closeBeforeDraw) {
            publish({ decorFrames: frames }); assert.equal(updates, 1);
            game.preparedResources = {}; publish({ decorFrames: frames }); assert.equal(updates, 1);
        }
    }
});


test('补载序列帧显式刷新已有地块，同一快照不重置动画或重复写入', () => {
    const { load, FakeNode } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer: new FakeNode(), effectVisualPrefabs: new Map() });
    const pulses: unknown[] = [], glows: unknown[] = [], bursts: unknown[] = [];
    world.hexViews.set(1, { setHexPulseFrames: (frames: unknown) => pulses.push(frames), setGroundGlowFrames: (frames: unknown) => glows.push(frames) });
    world.neutralRewardFx.setBurstFrames = (frames: unknown) => bursts.push(frames);
    const art = { effectVisualPrefabs: new Map(), hitFxPrefabs: new Map(), spawnFxPrefab: null, deathFxPrefab: null, buildingDestroyFxPrefab: null,
        hexPulseFrames: [{ name: 'pulse' }], hexGroundGlowFrames: [{ name: 'glow' }], artifactClaimBurstFrames: [{ name: 'burst' }] };
    world.applyDeferredArt(art); world.applyDeferredArt(art);
    assert.equal(pulses.length, 1); assert.equal(glows.length, 1); assert.equal(bursts.length, 1);
    assert.equal(pulses[0], art.hexPulseFrames); assert.equal(bursts[0], art.artifactClaimBurstFrames);
});
