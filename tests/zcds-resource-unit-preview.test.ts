import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);
installZCNeutralTestCatalog();

test('野怪地表在阵营底色下方，重复设置和池化清理不改变图层顺序', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const root = new cc.Node('hex');
    const tile = view.tileSprite.node;
    const ground = new cc.Node('MonsterGround');
    tile.setParent(root);
    ground.setParent(root);
    view.monsterGround = { node: ground, spriteFrame: null };
    const frame = { name: 'monster_ground' };
    view.setMonsterGround(frame);
    view.setMonsterGround(frame);
    assert.deepEqual(root.children, [ground, tile]);
    assert.equal(ground.active, true);
    assert.equal(view.monsterGround.spriteFrame, frame);
    view.setMonsterGround(null);
    assert.equal(ground.active, false);
    assert.equal(view.monsterGround.spriteFrame, null);
});

test('野怪按钮显示我方独立解锁、集火与小数冷却状态，归属后隐藏', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const frames = { locked: { name: 'frame_01' }, focus: { name: 'frame_02' }, cancel: { name: 'frame_03' } };
    const placeholder = { name: 'frame_01' };
    view.monsterFocusButton = { node: bar().node, interactable: true };
    view.monsterFocusLabel = { string: '', color: null };
    view.monsterFocusBackground = { color: null, spriteFrame: placeholder, type: cc.Sprite.Type.SLICED };
    view.onLoad();
    view.setMonsterFocusFrames(frames);
    const textColor = () => [view.monsterFocusLabel.color.r, view.monsterFocusLabel.color.g, view.monsterFocusLabel.color.b];
    const feature = { awake: false, claimed: false, unlockedOwners: ['enemy'], focusOwners: [], focusReadyAt: {} };
    const state = { neutralFeature: feature };
    view.renderMonsterFocus(state, 0);
    assert.equal(view.monsterFocusButton.node.active, true);
    assert.equal(view.monsterFocusButton.interactable, false);
    assert.equal(view.monsterFocusLabel.string, '未解锁');
    assert.deepEqual(textColor(), [130, 140, 150]);
    assert.equal(view.monsterFocusBackground.spriteFrame, frames.locked);
    assert.equal(view.monsterFocusBackground.color.r, 255, '底图不染色，状态色只上文字');
    feature.unlockedOwners.push('player');
    view.renderMonsterFocus(state, 0);
    assert.equal(view.monsterFocusLabel.string, '集火野怪');
    assert.equal(view.monsterFocusButton.interactable, true);
    assert.deepEqual(textColor(), [45, 120, 225]);
    assert.equal(view.monsterFocusBackground.spriteFrame, frames.focus);
    Object.assign(feature, { focusOwners: ['player'], focusReadyAt: { player: 0.5 } });
    view.renderMonsterFocus(state, 0.25);
    assert.match(view.monsterFocusLabel.string, /^取消集火 0\.3s$/);
    assert.deepEqual(textColor(), [235, 145, 55]);
    assert.equal(view.monsterFocusBackground.spriteFrame, frames.cancel);
    assert.equal(view.monsterFocusButton.interactable, false);
    view.renderMonsterFocus(state, 0.5);
    assert.equal(view.monsterFocusButton.interactable, true);
    // 缺图（加载失败 / 未注入）时底图停在 prefab 默认的 locked 帧，不能空着。
    view.setMonsterFocusFrames(null);
    view.renderMonsterFocus(state, 0.5);
    assert.equal(view.monsterFocusBackground.spriteFrame, placeholder, '缺图时沿用 prefab 的 frame_01，不许刷成 null');
    assert.deepEqual(
        [view.monsterFocusBackground.color.r, view.monsterFocusBackground.color.g, view.monsterFocusBackground.color.b],
        [255, 255, 255],
        '底图恒为白色，缺图也不按状态染色',
    );
    feature.claimed = true;
    view.renderMonsterFocus(state, 1);
    assert.equal(view.monsterFocusButton.node.active, false);
});

test('集火按钮随地图缩放并压在后生成的单位上方，归属后隐藏', () => {
    const { load, cc, bar } = loadViews();
    const mapLayer = new cc.Node('Map');
    const board = new cc.Node('Board');
    mapLayer.addChild(board);
    const view = stubHexView(load, cc, bar);
    const button = view.monsterFocusButton.node;
    board.addChild(button);
    button.setPosition(-110, 240, 0);
    view.monsterFocusLabel = {};
    view.monsterFocusBackground = {};
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer });
    world.hexEntityBySource.set(7, 1);
    world.hexViews.set(1, view);
    const feature = { awake: true, claimed: false, unlockedOwners: ['player'] };
    const frame = { mapConfig: { cityMode: 'fixed' }, snapshot: { status: 'playing', elapsedSeconds: 1,
        hexes: [{ id: 7, neutralFeature: feature }] } };
    world.renderNeutralFeatures(frame);
    const unit = new cc.Node('NewUnit');
    world.attachToMapLayer(unit);
    world.renderNeutralFeatures(frame);
    assert.equal(button.parent.parent, mapLayer);
    assert.ok(button.parent.getSiblingIndex() > unit.getSiblingIndex());
    assert.deepEqual([button.position.x, button.position.y], [-110, 240]);
    assert.equal(view.monsterFocusButton.interactable, true);
    feature.claimed = true;
    world.renderNeutralFeatures(frame);
    assert.equal(button.active, false);
});

test('集火按钮在 prefab 上按气泡排版：150×42、九宫、默认 locked 帧', () => {
    const prefab = JSON.parse(readFileSync('assets/bundles/battle/ui/game/ZCGameHex.prefab', 'utf8')) as any[];
    const nodeIndex = prefab.findIndex((o: any) => o?.__type__ === 'cc.Node' && o._name === 'MonsterFocus');
    assert.ok(nodeIndex >= 0, 'prefab 里要有 MonsterFocus 节点');
    const node = prefab[nodeIndex];
    const components = (node._components as any[]).map((ref: any) => prefab[ref.__id__]);
    const transform = components.find((c: any) => c.__type__ === 'cc.UITransform');
    const sprite = components.find((c: any) => c.__type__ === 'cc.Sprite');
    const text = prefab[node._children[0].__id__];
    assert.deepEqual([transform._contentSize.width, transform._contentSize.height], [150, 42],
        '气泡原图 94×45：九宫要 42 高才不会被上下边距吃掉中段');
    assert.equal(text._lpos.y, 5, '文字上移，落在气泡主体里、避开底部箭头');
    assert.equal(sprite._type, 1, 'SLICED：三张 frame 都带九宫边距');
    assert.deepEqual([sprite._color.r, sprite._color.g, sprite._color.b], [255, 255, 255], '底图不染色');
    const frameMeta = JSON.parse(readFileSync('assets/bundles/battle/image/spawn-region/frame_01.png.meta', 'utf8'));
    const lockedFrame = Object.values(frameMeta.subMetas).find((meta: any) => meta.name === 'spriteFrame') as any;
    assert.equal(sprite._spriteFrame.__uuid__, lockedFrame.uuid, '默认帧 = locked 的 spawn-region/frame_01');
});

test('强化门缩小图标，各阶段及缺图时都不显示资源文字', () => {
    installZCNeutralTestCatalog([{ groupId: 14001, id: 1400101, groupName: '门', resourceType: 7, weight: 1,
        param: { gateIds: [102] } }], [{ id: 102, name: '乘法', effectType: 2, value: 2, cooldownSeconds: 10,
            windowSeconds: 0.3, scale: 0, hpRate: 0, moveMultiplier: 0, attackSpeedMultiplier: 0, damageMultiplier: 0 }]);
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        const gateFrame = { name: 'gate', originalSize: { width: 256, height: 256 } };
        const frames = new Map(['gate', 'gate_add', 'gate_multiply', 'gate_shrink', 'gate_enlarge'].map(name =>
            [name, { name, originalSize: { width: 256, height: 256 } }]));
        frames.set('gate', gateFrame);
        view.setNeutralResourceFrames(frames);
        const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
        world.hexEntityBySource.set(7, 1);
        world.hexViews.set(1, view);
        world.syncResolvedResources([{ hexId: 7, itemId: 1400101 }]);
        const feature = { claimed: false, effect: 'multiply', readyAt: 0, windowUntil: 0, insideUnitIds: [] };
        const presentation = { state: resourceHexState(1400101, { neutralFeature: feature }),
            canDevelop: false, playerGold: 0, cooldown: null, now: 0 };
        view.render(presentation);
        for (const effect of ['add', 'multiply', 'shrink', 'enlarge', 'multiply']) {
            feature.effect = effect;
            view.render(presentation);
            assert.equal(view.iconSprite.spriteFrame, frames.get(`gate_${effect}`), '随机门效果变化必须切换图形，不能被内容缓存拦住');
        }
        assert.ok(view.iconSprite.node.scale.x < load('./ZCHexView').resourceIconScale(gateFrame), '趣味图标比普通资源缩小一档');
        assert.equal(view.iconLabel.string, '');
        assert.equal(view.iconLabel.enabled, false);
        feature.windowUntil = 0.3;
        view.render(presentation);
        assert.equal(view.iconLabel.string, '');
        assert.equal(view.cooldownBar.node.active, true);
        assert.equal(view.cooldownBar.progress, 1);
        assert.equal(view.cooldownBar.node.scale.x, 2);
        feature.windowUntil = 0;
        feature.readyAt = 10.3;
        presentation.now = 1;
        view.render(presentation);
        assert.equal(view.iconLabel.string, '');
        assert.equal(view.iconSprite.color.r, 105);
        assert.equal(view.cooldownBar.node.scale.x, 1);
        presentation.now = 5.3;
        view.render(presentation);
        assert.ok(Math.abs(view.cooldownBar.progress - 0.5) < 1e-9, '冷却环依据配置总时长与快照截止时间计算');
        view.render(presentation);
        assert.ok(Math.abs(view.cooldownBar.progress - 0.5) < 1e-9, '重复渲染不重置冷却进度');
        presentation.now = 10.3;
        view.render(presentation);
        assert.equal(view.cooldownBar.node.active, false);
        assert.equal(view.iconSprite.color.r, 255);
        view.setNeutralResourceFrames(null);
        view.render(presentation);
        assert.equal(view.iconSprite.spriteFrame, null, '清空注入后不残留旧图标');
        assert.equal(view.iconLabel.string, '');
        presentation.state = resourceHexState(null);
        view.render(presentation);
        assert.equal(view.cooldownBar.node.active, false);
        assert.equal(view.cooldownBar.node.scale.x, 1);
    } finally { installZCNeutralTestCatalog(); }
});

test('衍生、传送与号角显示对应图形，池化换格不会沿用上一种资源', () => {
    const visuals = ['extension', 'portal', 'horn'];
    installZCNeutralTestCatalog(visuals.map((visual, index) => ({
        groupId: 14006 + index, id: 1400601 + index, groupName: visual,
        resourceType: 8 + index, weight: 1, param: index === 0 ? { damageRate: 1, speed: 2 }
            : index === 1 ? { range: 6, uses: 3, cooldownSeconds: 10 } : {},
    })));
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        const frames = new Map(visuals.map(name => [name, { name, originalSize: { width: 256, height: 256 } }]));
        view.setNeutralResourceFrames(frames);
        for (let index = 0; index < visuals.length; index++) {
            view.render({ state: resourceHexState(1400601 + index, { neutralFeature: { claimed: false } }),
                canDevelop: false, playerGold: 0, cooldown: null, now: 0 });
            assert.equal(view.iconSprite.spriteFrame, frames.get(visuals[index]));
            assert.equal(view.iconLabel.enabled, false);
            assert.equal(view.iconLabel.string, '');
        }
        view.render({ state: resourceHexState(null), canDevelop: false, playerGold: 0, cooldown: null, now: 0 });
        assert.equal(view.iconSprite.spriteFrame, null);
    } finally { installZCNeutralTestCatalog(); }
});

test('野怪通过模型表现沉睡与攻击，转身不影响头顶按钮和血条', () => {
    installZCNeutralTestCatalog([{ groupId: 14009, id: 1400901, groupName: '野怪', resourceType: 11, weight: 1,
        param: { resId: '68001', wakeRange: 2, reviveRate: 1 } }]);
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        const sleep = { name: 'monster_sleep', originalSize: { width: 256, height: 256 } };
        const awake = { name: 'monster_awake', originalSize: { width: 256, height: 256 } };
        view.setNeutralResourceFrames(new Map([['monster_sleep', sleep], ['monster_awake', awake]]));
        const prefab = spinePrefab(load, cc);
        load('../model/ZCCombatCatalog').resolveUnitDefinition = () => ({ prefabSize: 1.5, attackDuration: 2 });
        const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ unitVisualPrefabs: new Map([['68001', prefab]]) });
        world.hexEntityBySource.set(7, 1);
        world.hexViews.set(1, view);
        world.syncResolvedResources([{ hexId: 7, itemId: 1400901 }]);
        view.healthBar.node.setPosition(0, -40, 0);
        view.healthBar.node.size = { width: 56, height: 19 };
        view.monsterFocusButton.node.size = { width: 150, height: 42 };
        view.monsterFocusButton.node.setPosition(0, 120, 0);
        view.node.setPosition(-240, 170, 0);
        const overlay = bar().node;
        world.attachCooldownOverlay([{ x: -240, y: 170, view }], overlay);
        const feature = { claimed: false, awake: false };
        const presentation = { state: resourceHexState(1400901, { neutralFeature: feature }),
            canDevelop: false, playerGold: 0, cooldown: null, now: 0 };
        view.render(presentation);
        assert.equal(view.resourceUnitNodes.length, 1);
        assert.equal(view.iconLabel.string, '');
        const body = view.resourceUnitNodes[0];
        assert.equal(view.iconSprite.spriteFrame, null);
        assert.equal(body.__skeleton.timeScale, 0.35);
        const unitHeight = load('./ZCUnitView').ZC_SPINE_CANVAS_TARGET_HEIGHT;
        assert.equal(body.scale.y, unitHeight / 916.29 * 1.5);
        assert.ok(Math.abs(body.position.y - 90 * body.scale.y + 5) < 1e-6);
        const head = 170 + body.position.y + (916.29 - 90) * body.scale.y;
        assert.equal(view.healthBar.node.position.x, -240);
        assert.equal(view.monsterFocusButton.node.position.x, -240);
        assert.ok(view.healthBar.node.position.y - 19 / 2 > head);
        assert.ok(view.monsterFocusButton.node.position.y - 42 / 2 > view.healthBar.node.position.y + 19 / 2);
        assert.ok(body.__skeleton.color.r < 255);
        feature.awake = true;
        view.render(presentation);
        assert.equal(view.iconLabel.string, '');
        assert.equal(view.iconSprite.spriteFrame, null);
        assert.equal(view.resourceUnitNodes[0], body);
        assert.equal(body.__skeleton.timeScale, 1);
        assert.equal(body.__skeleton.color.r, 255);
        view.setResourceUnits('68001', prefab, 1, { prefabSize: 1.5, attackDuration: 2 });
        view.render(presentation);
        const centered = view.resourceUnitNodes[0];
        const factor = unitHeight * 1.5 / 916.29;
        assert.ok(Math.abs(centered.scale.x - factor) < 1e-9);
        assert.ok(Math.abs(centered.position.x + 90 * factor) < 1e-9);
        assert.ok(Math.abs(centered.position.y - 90 * factor + 5) < 1e-9);
        view.renderMonsterAttack(0, 0.5, -1);
        assert.equal(centered.scale.x, -centered.scale.y);
        assert.ok(Math.abs(centered.position.x - 90 * factor) < 1e-9);
        view.render({ ...presentation, state: resourceHexState(1400901, { owner: 'player', neutralFeature: feature }) });
        view.renderMonsterAttack(0, 1, -1);
        assert.deepEqual(prefab.played.slice(-2), [{ clip: 'idle', loop: true }, { clip: 'attack', loop: false }]);
        assert.equal(centered.__skeleton.timeScale, 0.4);
        assert.equal(centered.__skeleton.track.trackTime, 0.2);
        view.renderMonsterAttack(0, 2, -1);
        assert.deepEqual(prefab.played.at(-1), { clip: 'idle', loop: true });
        assert.equal(centered.__skeleton.timeScale, 1);
        view.renderMonsterAttack(3, 3, 1);
        assert.equal(centered.scale.x, centered.scale.y);
        presentation.state = resourceHexState(null, { neutralFeature: { claimed: true, awake: true } });
        view.render(presentation);
        assert.ok(view.resourceUnitNodes.every((node: { active: boolean }) => !node.active));
        assert.equal(view.iconSprite.spriteFrame, null);
        assert.equal(view.healthBar.node.position.y, 170 - 40);
        assert.equal(view.monsterFocusButton.node.position.y, 170 + 120);
    } finally { installZCNeutralTestCatalog(); }
});

/** 与 `zcds-progress.test.ts` 同款：补齐 prefab 必填引用。 */
function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.healthBar = bar();
    view.monsterFocusButton = { node: bar().node };
    view.cooldownBar = bar();
    return view;
}

/** 造一个「骨骼 prefab」：根节点 + 固定子节点 `spine`，带假骨架（动画名默认 idle/move/attack，canvas 高 916.29）。 */
function spinePrefab(load: (name: string) => any, cc: any, name = '豌豆射手', canvasHeight = 916.29,
    animationNames = ['idle', 'move', 'attack']) {
    const played: Array<{ clip: string; loop: boolean }> = [];
    const track = { trackTime: 0 };
    const skeleton = {
        skeletonData: { getRuntimeData: () => ({ y: -90, height: canvasHeight, animations: animationNames.map((name) => ({ name })) }) },
        findAnimation(name: string) {
            return name === 'attack' ? { duration: 0.8 } : null;
        },
        track: { trackTime: 0 },
        setAnimation(_track: number, clip: string, loop: boolean) {
            played.push({ clip, loop });
            this.track = { trackTime: 0 };
            return this.track;
        },
    };
    const make = () => {
        const node = new (cc.Node as any)();
        const spine = new (cc.Node as any)('spine');
        spine.setParent(node);
        // 桩组件要挂在固定子节点上才能被 getComponent 找到；根节点保留 __skeleton 供用例读状态。
        const sk = { ...skeleton, skeletonData: skeleton.skeletonData, setAnimation: skeleton.setAnimation };
        sk.node = spine;
        node.__skeleton = sk;
        spine.getComponent = (type: any) => {
            if (type === cc.sp?.Skeleton || type?.name === 'Skeleton') return sk;
            if (type === cc.UITransform) return { width: 900, height: canvasHeight, anchorX: 0.4, anchorY: 0.1 };
            return null;
        };
        node.getComponent = () => null;
        node.name = name;
        node.componentName = name;
        return node;
    };
    return { name, make, played, track };
}

function resourceHexState(id: number | null, extra: Record<string, unknown> = {}): never {
    return {
        id: 7, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
        hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
        developmentCost: 25, tileType: null, developmentResolved: false,
        neutralResourceId: id, cardId: null, ...extra,
    } as never;
}

test('选点后同步抽签结果，为已有资源格补上兵团模型并清除文字回退', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc);
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({
        unitVisualPrefabs: new Map([['68001', prefab]]),
    });
    world.hexEntityBySource.set(7, 1);
    world.hexViews.set(1, view);
    const presentation = {
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    };
    view.render(presentation);
    assert.equal(view.iconLabel.string, '兵力', '复现选点时尚未注入骨骼');
    world.syncResolvedResources([{ hexId: 7, itemId: ZC_TEST_ITEM.Unit }]);
    view.render(presentation);
    assert.equal(view.resourceUnitNodes.length, 3);
    assert.ok(view.resourceUnitNodes.every((node: { active: boolean }) => node.active));
    assert.equal(view.iconLabel.string, '');
    assert.equal(view.iconLabel.enabled, false);
    const nodes = [...view.resourceUnitNodes];
    world.syncResolvedResources([{ hexId: 7, itemId: ZC_TEST_ITEM.Unit }]);
    view.render(presentation);
    assert.ok(nodes.every((node, index) => node === view.resourceUnitNodes[index]), '重复同步不重建骨骼');
    world.syncResolvedResources([]);
    assert.equal(view.resourceUnitCount, 0, '清空抽签结果时移除旧兵团绑定');
});

test('选点结束必须在首次战斗渲染前同步资源抽签结果', () => {
    const source = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const finish = source.slice(source.indexOf('startPlaying('), source.indexOf('private presentationResources'));
    const sync = finish.indexOf('this.renderWorld.syncResolvedResources(config.map.resolvedResources ?? []);');
    assert.ok(sync >= 0 && sync < finish.indexOf('this.renderWorld.render('));
});

test('unit_cap 不再写中文「兵力」：按配置站N 个中立待机兵，播idle', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc, '豌豆射手');
    view.setResourceUnits('68001', prefab as never, 3);

    view.render({
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });

    // ① 站了 3 个（表里 `rewardUnitCount = 3`）。
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3, `应站 3 个中立兵，实际 ${nodes.length}`);
    assert.ok(nodes.every((n) => n.active), '未领取时三个兵都该可见');

    // ② 播的是 idle 且循环。
    assert.equal(prefab.played.length, 3, '每个兵都要起一次待机动作');
    assert.ok(prefab.played.every((p) => p.clip === 'idle' && p.loop), `应播 idle 循环，实际 ${JSON.stringify(prefab.played)}`);

    // ③ **不再有中文「兵力」字**：标签不启用、字符串为空。
    assert.equal(view.iconLabel.enabled, false, '有骨骼时不该再显示文字');
    assert.equal(view.iconLabel.string, '', `不该写中文兜底，实际 "${view.iconLabel.string}"`);

    // ④ 缩到格内：豌豆射手骨架 canvas 916.29 高，按格内目标高度 48.6 归一。
    const factor = 48.6 / 916.29;
    assert.ok(Math.abs(nodes[0].scale.x - factor) < 1e-9, `缩放应按 canvas 高归一，实际 ${nodes[0].scale.x}`);
    assert.equal(nodes[0].scale.y, nodes[0].scale.x, '等比：两轴同值');

    // ⑤ 并排且都在格内：偏移以格心对称，间距 16 ⇒ 三个占 [-16, 0, 16]。
    // ⚠️ 逐项断言而不是 deepEqual：桩对象来自 `runInNewContext` 的另一个 realm，
    // 跨 realm 的 Array 原型不同，deepEqual 必红（规则 167 同族坑）。
    assert.deepEqual(Array.from(nodes, (n) => n.position.x), [-16, 0, 16]);

    const y = 12 + load('./ZCHexView').NEUTRAL_RESOURCE_LIFT;
    assert.deepEqual(Array.from(nodes, (n) => n.position.y), [y, y, y],
        '兵团预览与中立资源图标共用整体上移量');
});

test('资源点单位缺少 idle 动画时直接抛错，不播空动画或降级', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc, '坏兵', 916.29, ['move']);
    view.setResourceUnits('68001', prefab as never, 1);
    assert.throws(() => view.render({
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    }), /缺少动画 idle/);
});

test('领取后（neutralResourceId 清空）骨���收掉，不残留', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc) as never, 3);
    view.render({
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3);

    // 领取后：资源标识清空（`claimAdjacentNeutralResources` 的行为）。
    view.render({
        state: resourceHexState('', { neutralResourceId: null }),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    assert.ok(nodes.every((n) => !n.active), '领取后三个兵都该隐藏');
});

test('没注入骨骼 prefab 时退回中文兜底，不留空格', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 表里 rewardCardId 为空、或该卡没单位 prefab ⇒ 渲染层会喂 null。
    view.setResourceUnits('', null, 3);
    view.render({
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    });
    assert.equal(view.iconLabel.enabled, true, '兜底要显示文字');
    assert.equal(view.iconLabel.string, '兵力');
    assert.equal(((view as any).resourceUnitNodes as any[]).length, 0, '不该凭空造节点');
});

test('同一个 prefab 每帧 render 不会反复重建节点（否则节点无限增长）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc);
    view.setResourceUnits('68001', prefab as never, 2);
    const presentation = {
        state: resourceHexState(ZC_TEST_ITEM.Unit),
        canDevelop: false, playerGold: 0, cooldown: null, now: 0,
    };
    view.render(presentation);
    const first = ((view as any).resourceUnitNodes as any[]).slice();
    for (let i = 0; i < 10; i += 1) view.render(presentation);
    const after = (view as any).resourceUnitNodes as any[];
    assert.equal(after.length, first.length, '不该每帧重建');
    assert.ok(after.every((n, i) => n === first[i]), '节点实例应被复用，不是重建的');
    assert.equal(prefab.played.length, 2, '待机只播一次，不重复 setAnimation');
});

test('换兵种（cardId / prefab 变了）必须重建节点', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc, '豌豆射手') as never, 2);
    view.render({ state: resourceHexState(ZC_TEST_ITEM.Unit), canDevelop: false, playerGold: 0, cooldown: null, now: 0 });
    const before = ((view as any).resourceUnitNodes as any[]).slice();

    const nutPrefab = spinePrefab(load, cc, '坚果');
    view.setResourceUnits('68002', nutPrefab as never, 2);
    view.render({ state: resourceHexState(ZC_TEST_ITEM.Unit), canDevelop: false, playerGold: 0, cooldown: null, now: 0 });

    const after = (view as any).resourceUnitNodes as any[];
    assert.equal(after.length, 2);
    assert.ok(after.every((n) => !before.includes(n)), '换兵种后应是全新节点，不能沿用旧的骨架');
    assert.equal(nutPrefab.played.length, 2, '新兵种要起自己的待机动作');
});

test('数量变化按配置走：改成 1 个只留 1 个可见', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setResourceUnits('68001', spinePrefab(load, cc) as never, 3);
    const presentation = { state: resourceHexState(ZC_TEST_ITEM.Unit), canDevelop: false, playerGold: 0, cooldown: null, now: 0 };
    view.render(presentation);
    assert.equal(((view as any).resourceUnitNodes as any[]).filter((n) => n.active).length, 3);

    // 策划把 rewardUnitCount 改成 1。
    // ⚠️ 必须重新取 `resourceUnitNodes`：数量变化会**重建**节点（旧数组里的已被 destroy），
    // 拿旧数组断言会看到过期的 [-16,0,16]，误判成「位置没重算」。
    view.setResourceUnits('68001', ((view as any).resourceUnitPrefab as any), 1);
    view.render(presentation);
    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 1, '数量改成 1 后应只剩 1 个节点');
    assert.equal(nodes.filter((n) => n.active).length, 1, '只剩 1 个可见');
    assert.deepEqual(Array.from(nodes, (n) => n.position.x), [0],
        '并排位置要按新数量重算：1 个时正中那只 offset 必须为 0');
});

test('★自选出生点阶段：兵力资源点与对局一致（站待机兵、不画兵营图标、不写文字）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefab = spinePrefab(load, cc, '豌豆射手');
    view.setResourceUnits('68001', prefab as never, 3);
    // 给一个区名，验「站了骨骼的格子一个字都不写」——包括本来会画上去的区名。
    view.renderSpawnSelection({
        sectionOwner: 'player', selectedBy: null, confirmed: false, blocked: false,
        resourcePoint: true, resourceItemId: ZC_TEST_ITEM.Unit, unlocksResource: false,
    } as never);

    const nodes = (view as any).resourceUnitNodes as any[];
    assert.equal(nodes.length, 3, `选点阶段该站 3 个待机兵，实际 ${nodes.length}`);
    assert.ok(nodes.every((n) => n.active), '三个兵都该可见');
    assert.equal(prefab.played.length, 3, '每个兵都要起待机动作');
    assert.ok(prefab.played.every((p) => p.clip === 'idle' && p.loop), '播 idle 循环');
    // ① 不再画兵营图标（这正是用户报的那一处）。
    assert.equal(view.iconSprite.enabled, false, '★兵力点不该再画兵营图标');
    assert.equal(view.iconSprite.spriteFrame, null, '★图标帧该被清掉（对象池复用的节点也是）');
    // ② 一个字都不写（区名 / × / 锁 都让位给兵）。
    assert.equal(view.iconLabel.enabled, false, '★兵力点不该有任何文字');
    assert.equal(view.iconLabel.string, '', `不该写文字，实际 "${view.iconLabel.string}"`);
    assert.equal(view.buildingLayer.active, false, '骨骼模式下 buildingLayer 该关（那是「可开发」的语义）');

    // 反例：骨骼建不出来（表没配 rewardCardId / 没单位 prefab）才退回兵营图标兜底，不留空格。
    const fallback = stubHexView(load, cc, bar);
    fallback.renderSpawnSelection({
        sectionOwner: 'player', selectedBy: null, confirmed: false, blocked: false,
        resourcePoint: true, resourceItemId: ZC_TEST_ITEM.Unit, unlocksResource: false,
    } as never);
    assert.equal((fallback as any).resourceUnitNodes.length, 0, '没喂骨骼时不该凭空造兵');
    assert.equal(fallback.iconSprite.spriteFrame, fallback.barracksIconFrame,
        '骨骼缺失时才退回兵营图标（保住「这一格是兵力点」的信息）');
});


test('割草机静态朝左下，触发后六向切图，刷新与复用不残留方向', () => {
    installZCNeutralTestCatalog([{ groupId: 1, id: 1, groupName: '割草机', resourceType: 8, weight: 1,
        param: { damageRate: 1, speed: 2 } }]);
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        const frames = new Map(['extension', 'extension_right_up', 'extension_up', 'extension_down']
            .map(name => [name, { name, originalSize: { width: 150, height: 150 } }]));
        view.setNeutralResourceFrames(frames);
        const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
        world.hexEntityBySource.set(7, 1);
        world.hexEntityBySource.set(8, 2);
        world.hexViews.set(1, view);
        view.setMowerSpeed(1);
        const p = { state: resourceHexState(1, { neutralFeature: { claimed: true } }),
            canDevelop: false, playerGold: 0, cooldown: null, now: 1 };
        view.render(p);
        assert.equal(view.iconSprite.spriteFrame, frames.get('extension'));
        assert.ok(view.iconSprite.node.scale.x < 0);
        for (const [dx, dy, key, flip] of [
            [1, 1, 'extension_right_up', 1], [-1, 1, 'extension_right_up', -1],
            [1, -1, 'extension', 1], [-1, -1, 'extension', -1],
            [0, 1, 'extension_up', 1], [0, -1, 'extension_down', 1],
        ] as const) {
            view.setNeutralResourceFrames(frames);
            view.render(p);
            // 启动帧位移为零，方向仍取路线；末段和静态刷新后也必须一致。
            for (const distance of [0, 100, 200]) {
                view.renderMower(dx * distance, dy * distance, true, dx, dy);
                assert.equal(view.iconSprite.spriteFrame, frames.get(key));
                assert.equal(Math.sign(view.iconSprite.node.scale.x), flip);
                assert.equal(Math.abs(view.iconSprite.node.scale.x), view.iconSprite.node.scale.y);
            }
            const origin = view.node.position;
            world.scene.get = (entity: number) => ({ node: { position: entity === 1 ? origin
                : { x: origin.x + dx * 100, y: origin.y + dy * 100, z: 0 } } });
            for (const elapsedSeconds of [0, 0.5, 1.5]) {
                view.setNeutralResourceFrames(frames);
                view.render(p);
                world.renderNeutralFeatures({ mapConfig: { cityMode: 'fixed' }, snapshot: {
                    elapsedSeconds, status: 'playing', hexes: [{ id: 7, neutralFeature: {
                        claimed: true, startedAt: 0, lineHexIds: [7, 8],
                    } }],
                } });
                assert.equal(view.iconSprite.spriteFrame, frames.get(key));
                assert.equal(Math.sign(view.iconSprite.node.scale.x), flip);
            }
        }
        view.initialize(() => {});
        view.render(p);
        assert.equal(view.iconSprite.spriteFrame, frames.get('extension'));
        assert.ok(view.iconSprite.node.scale.x < 0);
        view.render({ ...p, state: resourceHexState(null) });
        assert.ok(view.iconSprite.node.scale.x > 0, '换成普通格后解除镜像');
    } finally { installZCNeutralTestCatalog(); }
});

test('割草机结束后刷新、地块动画和换层均不回显，复用后恢复', () => {
    installZCNeutralTestCatalog([{ groupId: 1, id: 1, groupName: '割草机', resourceType: 8, weight: 1,
        param: { damageRate: 1, speed: 2 } }]);
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        const frames = new Map([['extension', { name: 'extension', originalSize: { width: 256, height: 256 } }]]);
        view.setNeutralResourceFrames(frames);
        view.setResourceIconLayer(new cc.Node());
        const p = { state: resourceHexState(1, { neutralFeature: { claimed: true } }),
            canDevelop: false, playerGold: 0, cooldown: null, now: 10 };
        view.render(p);
        view.renderMower(100, 20, false);
        view.render(p);
        assert.equal(view.iconSprite.node.active, false, '静态刷新不能重新显示已结束的割草机');
        const fx = { hidden: false, tileFlip: 1, tileScale: 1, tileLift: 0, buildingPopScale: 1, glowRadius: 0 };
        view.applyActivationFx({ ...fx, hidden: true });
        view.applyActivationFx(fx);
        assert.equal(view.iconSprite.node.active, false, '激活动画结束也不能回显');
        view.setResourceIconLayer(new cc.Node());
        view.setNeutralResourceFrames(frames);
        view.render(p);
        assert.equal(view.iconSprite.node.active, false, '换层不能回显');
        view.initialize(() => {});
        view.render(p);
        assert.equal(view.iconSprite.node.active, true, '复用时恢复正常资源图标');
        view.applyActivationFx({ ...fx, hidden: true });
        view.renderMower(100, 20, true);
        assert.equal(view.iconSprite.node.active, false, '移动刷新不能覆盖地块动画的隐藏段');
        view.applyActivationFx(fx);
        assert.equal(view.iconSprite.node.active, true);
    } finally { installZCNeutralTestCatalog(); }
});

test('传送圆环按批次扣除、冷却恢复；割草机时间轴与坐标幂等', () => {
    installZCNeutralTestCatalog([{ groupId: 1, id: 1, groupName: '传送', resourceType: 9, weight: 1,
        param: { range: 6, uses: 3, cooldownSeconds: 10 } }]);
    try {
        const { load, cc, bar } = loadViews();
        const view = stubHexView(load, cc, bar);
        view.setPortalUses(3);
        const feature = { claimed: true, usesRemaining: 2, readyAt: 0, cooldownSeconds: 10 };
        const p = { state: resourceHexState(1, { neutralFeature: feature }), canDevelop: false, playerGold: 0, cooldown: null, now: 0 };
        view.render(p);
        assert.equal(view.cooldownBar.progress, 2 / 3);
        feature.usesRemaining = 0; feature.readyAt = 10; p.now = 5;
        view.render(p);
        assert.equal(view.cooldownBar.progress, 0.5);
        feature.usesRemaining = 3; p.now = 10;
        view.render(p);
        assert.equal(view.cooldownBar.progress, 1);
        view.setMowerSpeed(2);
        assert.equal(view.mowerProgress(1, 1.25), 0.5);
        view.renderMower(100, 20, true);
        const x = view.iconSprite.node.position.x;
        view.renderMower(100, 20, true);
        assert.equal(view.iconSprite.node.position.x, x);
        view.renderMower(0, 0, false);
        assert.equal(view.iconSprite.node.active, false);
        view.initialize(() => {});
        assert.equal(view.iconSprite.node.active, true, '复用地块时恢复已消失的割草机图标节点');
    } finally { installZCNeutralTestCatalog(); }
});
