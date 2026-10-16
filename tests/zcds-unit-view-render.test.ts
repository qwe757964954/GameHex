import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';

test('静止帧不重复写位置、血条和染色，受伤与死亡仍即时更新', () => {
    const { load, bar, cc, FakeNode } = loadViews();
    const view = new (load('./ZCUnitView').ZCUnitView)();
    const writes = { root: 0, barPosition: 0, progress: 0, barFrame: 0, active: 0, tint: 0 };
    const rootPosition = view.node.setPosition.bind(view.node);
    view.node.setPosition = (...args: Parameters<typeof view.node.setPosition>) => {
        writes.root++;
        rootPosition(...args);
    };
    view.rootTransform = { setContentSize() {} };
    view.visualRoot = new FakeNode();
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: new FakeNode(), clear() {}, circle() {}, fill() {} };
    view.fallbackLabel = { node: new FakeNode(), enabled: true, string: '' };
    view.healthBar = bar();
    // 血条阵营不再走 `color` 染色，改成换填充图 —— 这里统计的是 `spriteFrame` 的写入次数。
    view.barFillPlayer = { name: 'jindutiao_b' } as any;
    view.barFillEnemy = { name: 'jindutiao_r' } as any;
    view.barFillEnemy2 = { name: 'jindutiao_y' } as any;
    const barPosition = view.healthBar.node.setPosition.bind(view.healthBar.node);
    view.healthBar.node.setPosition = (...args: Parameters<typeof view.healthBar.node.setPosition>) => {
        writes.barPosition++;
        barPosition(...args);
    };
    let progress = 0;
    Object.defineProperty(view.healthBar, 'progress', {
        get: () => progress,
        set: (value: number) => { writes.progress++; progress = value; },
    });
    let barFrame: unknown = null;
    Object.defineProperty(view.healthBar.barSprite, 'spriteFrame', {
        get: () => barFrame,
        set: (value: unknown) => { writes.barFrame++; barFrame = value; },
    });
    let active = true;
    Object.defineProperty(view.healthBar.node, 'active', {
        get: () => active,
        set: (value: boolean) => { writes.active++; active = value; },
    });
    const visualSprite = { color: null as unknown };
    Object.defineProperty(visualSprite, 'color', {
        get: () => null,
        set: () => { writes.tint++; },
    });
    const animation = { clips: [{ name: 'unit-idle' }], defaultClip: null, play() {}, stop() {} };
    const prefab = { make: () => {
        const node = new FakeNode();
        node.getComponent = ((type: unknown) => type === cc.Sprite ? visualSprite
            : type === cc.Animation ? animation : null) as typeof node.getComponent;
        return node;
    } };
    view.initialize(prefab, 1);
    const unit = { hp: 100, maxHp: 100, owner: 'player', battleState: 'idle', facingRadians: 0, completedAttackCount: 0 };
    const definition = { hero: false, attackRange: 20 };
    const render = (now: number, x = 10) => view.render({ unit, definition, x, y: 20, now });
    render(0);
    const first = { ...writes };
    for (let frame = 1; frame <= 5; frame++) render(frame / 60);
    assert.deepEqual(writes, first);
    unit.hp = 80;
    render(.1);
    assert.equal(view.healthBar.progress, .8);
    assert.equal(view.healthBar.node.active, true);
    assert.equal(writes.progress, first.progress + 1);
    unit.owner = 'enemy';
    render(.2, 11);
    // 只加 1：render(.1) 那次只是掉血、阵营没变 ⇒ 填充图不变、不重复写；
    // 只有 render(.2) 切到敌方才换图写一次（比原来「每次刷 color」少写一次）。
    assert.equal(writes.barFrame, first.barFrame + 1);
    assert.equal(view.healthBar.barSprite.spriteFrame, view.barFillEnemy, '切到敌方要换成红色填充图');
    assert.equal(writes.root, first.root + 1);
    // 2026-10-14：非我方席位的单位要叠一层 #828282 灰（顶点色相乘）⇒ 阵营从 player 切到 enemy
    // 时顶点色多写一次。灰色与阵亡灰共用同一条通道，所以「切阵营」和「阵亡」各算一次写入。
    assert.equal(writes.tint, first.tint + 1, '切到其他玩家要写一次灰');
    unit.battleState = 'dead';
    render(.3, 11);
    assert.equal(view.healthBar.node.active, false);
    // 阵亡灰**优先于**其他玩家灰（阵亡那条 alpha 190 已在表达状态，再叠灰没有额外信息），
    // 但仍然是同一条通道的又一次写入 ⇒ 相对首帧共 +2。
    assert.equal(writes.tint, first.tint + 2, '阵亡要再写一次阵亡灰');
    const dead = { ...writes };
    render(.4, 11);
    assert.deepEqual(writes, dead);
});

test('对象池复用同一美术或切到无美术时，重置受伤窗口、染色与血条偏移', () => {
    const { load, bar, cc, FakeNode } = loadViews();
    const view = new (load('./ZCUnitView').ZCUnitView)();
    view.rootTransform = { setContentSize() {} };
    view.visualRoot = new FakeNode();
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: new FakeNode(), clear() {}, circle() {}, fill() {} };
    view.fallbackLabel = { node: new FakeNode(), enabled: true, string: '' };
    view.healthBar = bar();
    const visualSprite = { color: null as unknown };
    const prefab = { make: () => {
        const node = new FakeNode();
        node.getComponent = ((type: unknown) => type === cc.Sprite ? visualSprite : null) as typeof node.getComponent;
        return node;
    } };
    const unit = { hp: 100, maxHp: 100, owner: 'player', battleState: 'idle', facingRadians: 0, completedAttackCount: 0 };
    const definition = { hero: false, attackRange: 20 };
    const render = (now: number) => view.render({ unit, definition, x: 0, y: 0, now });
    view.initialize(prefab, 1);
    render(0);
    unit.hp = 50;
    unit.battleState = 'dead';
    render(.1);
    assert.equal(view.healthBar.node.active, false);
    view.initialize(prefab, 1.2);
    unit.hp = 100;
    unit.battleState = 'idle';
    render(.2);
    assert.equal(view.healthBar.node.active, false);
    assert.equal(view.healthBar.node.position.y, view.barOffsetY * 1.2);
    assert.equal(visualSprite.color, cc.Color.WHITE);
    view.initialize(null, .8);
    render(.3);
    assert.equal(view.healthBar.node.active, false);
    assert.equal(view.healthBar.node.position.y, view.barOffsetY * .8);
});

test('Spine 尚未就绪时下一帧重试 idle，保持脚点和画布缩放', () => {
    const { load, bar, cc, FakeNode } = loadViews();
    const view = new (load('./ZCUnitView').ZCUnitView)();
    view.rootTransform = { setContentSize() {} };
    view.visualRoot = new FakeNode();
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node: new FakeNode(), clear() {}, circle() {}, fill() {} };
    view.fallbackLabel = { node: new FakeNode(), enabled: true, string: '' };
    view.healthBar = bar();
    let attempts = 0;
    const skeleton = {
        color: null,
        skeletonData: { getRuntimeData: () => ({ height: 916, animations: [{ name: 'idle' }, { name: 'move' }, { name: 'attack' }] }) },
        setAnimation: () => { attempts++; return attempts === 1 ? null : {}; },
    };
    const prefab = { make: () => {
        const node = new FakeNode();
        node.getComponent = ((type: unknown) => type === cc.sp.Skeleton ? skeleton : null) as typeof node.getComponent;
        return node;
    } };
    view.initialize(prefab, 1.2);
    assert.equal(view.visualRoot.position.y, 0);
    assert.ok(Math.abs(view.visualNode.scale.y - 69.4 / 916 * 1.2) < 1e-9);
    assert.equal(attempts, 1);
    const presentation = {
        unit: { hp: 100, maxHp: 100, owner: 'player', battleState: 'idle', facingRadians: 0, completedAttackCount: 0 },
        definition: { hero: false, attackRange: 20 }, x: 0, y: 0, now: 0,
    };
    view.render(presentation);
    assert.equal(attempts, 2);
    view.render(presentation);
    assert.equal(attempts, 2);
});
