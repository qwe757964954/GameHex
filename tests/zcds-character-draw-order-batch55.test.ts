/**
 * 角色前后关系（2026-11-26 第 55 批）。
 *
 * 用户四条口径：
 * 1. 血条**不**独立于单位（跟着自己单位被挡，不做单独一层）；
 * 2. 地面一层按 y 排；**飞行单位与中立资源野怪整体压在地面之上**；
 * 3. 分身（召出来的）强制排在**所有**普通单位之下；
 * 4. 与墙砖同口径 —— **y 大的先画**。
 *
 * 起因（用户原话）：「当角色重叠在一起时，更底下的角色模型在上层，包括他的描边层和血条」。
 * 病根是单位平铺在 `mapLayer` 上、顺序 = **出生先后**，与屏幕位置毫无关系。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    ZC_CHARACTER_TIER_AIR,
    ZC_CHARACTER_TIER_GROUND,
    ZC_CHARACTER_TIER_SUMMON,
    zcCharacterDrawOrder,
    zcCharacterTierOf,
} from '../assets/script/app/zcds/model/ZCCharacterDrawOrder';

const RENDER_WORLD = 'assets/script/app/zcds/view/ZCGameRenderWorld.ts';
const HEX_VIEW = 'assets/script/app/zcds/view/ZCHexView.ts';
const WALL_RENDERER = 'assets/script/app/zcds/view/ZCWallRenderer.ts';
const codeOf = (path: string) => readFileSync(path, 'utf8');

/**
 * ① 层次判据：三层且次序固定 —— 分身（0）< 地面（1）< 空中（2）。
 * 小 = 先画 = 更靠后，所以「分身垫底」与「飞行 / 野怪压在地面之上」都是这一条。
 */
test('① 层次：分身垫底、地面居中、飞行与野怪压在地面之上', () => {
    assert.equal(ZC_CHARACTER_TIER_SUMMON, 0);
    assert.equal(ZC_CHARACTER_TIER_GROUND, 1);
    assert.equal(ZC_CHARACTER_TIER_AIR, 2);

    assert.equal(zcCharacterTierOf({}), ZC_CHARACTER_TIER_GROUND, '普通地面单位');
    assert.equal(zcCharacterTierOf({ flying: true }), ZC_CHARACTER_TIER_AIR, '卡表 flying ⇒ 空中');
    assert.equal(zcCharacterTierOf({ monster: true }), ZC_CHARACTER_TIER_AIR, '中立资源野怪 ⇒ 空中');
    assert.equal(zcCharacterTierOf({ summon: true }), ZC_CHARACTER_TIER_SUMMON);

    //  ⚠️ 分身优先于飞行：用户要的是「分身整体在**所有**普通单位之下」，
    //  一只会飞的分身也必须垫底，否则 tier 判定顺序反过来就会漏掉这一档。
    assert.equal(zcCharacterTierOf({ summon: true, flying: true }), ZC_CHARACTER_TIER_SUMMON,
        '分身优先于飞行：会飞的分身照样垫底');
    assert.equal(zcCharacterTierOf({ summon: true, monster: true }), ZC_CHARACTER_TIER_SUMMON);

    // 不传 / undefined 一律当地面 —— 老快照 / 桩缺字段不能把单位排到天上或地下。
    assert.equal(zcCharacterTierOf({ flying: undefined, summon: undefined }), ZC_CHARACTER_TIER_GROUND);
});

/** ② 比较器：层优先 → y 大的先画 → id 稳定兜底（防每帧抖动让描边 / 血条闪）。*/
test('② 比较器：层小的先画、同层 y 大的先画、同 y 用 id 兜底', () => {
    // 层是第一位，压过 y：一只垫底的分身 y 再大也在最下面。
    assert.ok(zcCharacterDrawOrder({ tier: ZC_CHARACTER_TIER_SUMMON, y: 9999, id: 1 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 0, id: 2 }) < 0);
    assert.ok(zcCharacterDrawOrder({ tier: ZC_CHARACTER_TIER_GROUND, y: 0, id: 1 },
        { tier: ZC_CHARACTER_TIER_AIR, y: 0, id: 2 }) < 0, '飞行 / 野怪整体压在地面之上');

    // y 大的先画 ⇒ 排序结果从大到小。
    const sorted = [
        { tier: ZC_CHARACTER_TIER_GROUND, y: 100, id: 1 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 300, id: 2 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 200, id: 3 },
    ].sort(zcCharacterDrawOrder);
    assert.deepEqual(sorted.map((entry) => entry.y), [300, 200, 100], 'y 大的先画');

    // 同层同 y：id 小的先画，结果稳定（不依赖 sort 的内部实现）。
    const tied = [
        { tier: ZC_CHARACTER_TIER_GROUND, y: 50, id: 9 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 50, id: 3 },
    ];
    assert.deepEqual([...tied].sort(zcCharacterDrawOrder).map((entry) => entry.id), [3, 9]);
    assert.deepEqual([...tied].reverse().sort(zcCharacterDrawOrder).map((entry) => entry.id), [3, 9],
        '输入顺序不影响结果：同 y 必须有确定的先后，否则每帧抖一下');

    // `y` 可能是 NaN（首帧插值还没跑过）：当 0 处理，别让比较器返回 NaN 把 sort 搅乱。
    assert.equal(zcCharacterDrawOrder({ tier: ZC_CHARACTER_TIER_GROUND, y: Number.NaN, id: 1 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 0, id: 1 }), 0);
    assert.ok(Number.isFinite(zcCharacterDrawOrder({ tier: ZC_CHARACTER_TIER_GROUND, y: Number.NaN, id: 1 },
        { tier: ZC_CHARACTER_TIER_GROUND, y: 60, id: 2 })), 'NaN 不许让比较器跟着变 NaN');

    // ④ 与墙砖同口径：墙砖是 `b.segment.y - a.segment.y`，单位这边必须是同一条式子。
    const wall = codeOf(WALL_RENDERER);
    assert.match(wall, /sort\(\(a, b\) => b\.segment\.y - a\.segment\.y\)/,
        '墙砖口径：y 大的先画');
    const order = codeOf('assets/script/app/zcds/model/ZCCharacterDrawOrder.ts');
    assert.match(order, /return by - ay;/, '单位沿用墙砖同一条式子（y 大的先画）');
});

/**
 * ③ 渲染层接线：角色层贴在棋盘之后、单位挂在角色层里、每帧按「层 + y」重排。
 */
test('③ 角色层：贴在棋盘之后第一位，单位挂进去而不是平铺在 mapLayer', () => {
    const { load, cc } = loadViews();
    const mapLayer = new cc.Node('MapLayer');
    const board = new cc.Node('Board');
    mapLayer.addChild(board);
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer, board });
    const layer = world.ensureCharacterLayer();
    assert.ok(layer, '有 board + mapLayer 就必须建出角色层');
    assert.equal(layer.parent, mapLayer);
    assert.equal(layer.getSiblingIndex(), board.getSiblingIndex() + 1,
        '贴棋盘之后第一位：地块之上、地面特效与其它动态对象之下');

    //  地面特效走 `zcCombatEffectSiblingIndex('ground')` = `boardIndex + 1`，插进来把
    //  角色层顶到 +2 —— 火圈仍然画在角色脚底（第 30 批的层序不能被这批改坏）。
    const groundFx = new cc.Node('GroundFx');
    groundFx.setParent(mapLayer);
    groundFx.setSiblingIndex(board.getSiblingIndex() + 1);
    assert.ok(groundFx.getSiblingIndex() < layer.getSiblingIndex(), '地面特效仍在角色之下');

    const unit = new cc.Node('Unit_1');
    world.attachToCharacterLayer(unit);
    assert.equal(unit.parent, layer, '单位必须挂角色层（否则没法跟野怪比兄弟序）');

    //  没建出角色层（单测桩没走 initialize）⇒ 退回 mapLayer，不按猜的父节点乱挂。
    const bare = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer });
    const orphan = new cc.Node('Unit_2');
    bare.attachToCharacterLayer(orphan);
    assert.equal(orphan.parent, mapLayer, '角色层不可用时退回 mapLayer');
});

/** ③ 排序本体：分身垫底 → 地面 y 降序 → 飞行 / 野怪在上；顺序没变就一个下标都不写。*/
test('③ 每帧重排：分身垫底、地面按 y 降序、飞行与野怪压在上面', () => {
    const { load, cc } = loadViews();
    const mapLayer = new cc.Node('MapLayer');
    const board = new cc.Node('Board');
    mapLayer.addChild(board);
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer, board });
    const layer = world.ensureCharacterLayer();

    const makeNode = (name: string, y: number) => {
        const node = new cc.Node(name);
        layer.addChild(node);
        node.setPosition(0, y, 0);
        return node;
    };
    //  故意按「错的出生顺序」摆：后出生的反而更靠上（y 大）= 正是用户的原始症状。
    const groundNear = makeNode('Unit_near', 100);
    const groundFar = makeNode('Unit_far', 300);
    const summon = makeNode('Unit_summon', 999);
    const flying = makeNode('Unit_flying', -50);
    const monsterBody = makeNode('Monster_body', 1500);
    const monsterBar = makeNode('Monster_bar', 1560);
    const monsterFocus = makeNode('Monster_focus', 1600);

    const bind = (entityId: number, unitId: number, node: any) => {
        world.scene.set(entityId, { node });
        world.unitEntityBySource.set(unitId, entityId);
    };
    bind(1, 1, groundNear);
    bind(2, 2, groundFar);
    bind(3, 3, summon);
    bind(4, 4, flying);

    // 野怪：一格 = 一个角色，身体是主节点、血条与按钮跟在后面（组内层序见 ④）。
    world.hexEntityBySource.set(7, 1);
    world.hexViews.set(1, { monsterBodyNode: monsterBody, monsterTrailingNodes: [monsterBar, monsterFocus] });
    world.neutralFeatureHexStates.set(7, { id: 7 });

    const definitions = new Map<number, any>([
        [1, {}], [2, {}], [3, { summonSlot: 1 }], [4, { flying: true }],
    ]);
    const units = [
        { id: 1, unitId: 1 }, { id: 2, unitId: 2 },
        { id: 3, unitId: 3, summonMasterId: 1 }, { id: 4, unitId: 4 },
    ];
    const frame = { snapshot: { units }, unitDefinitionsById: definitions };
    world.renderCharacterOrder(frame);

    //  空中层内部仍按 y 排：野怪 y=1500 > 飞行单位 y=-50 ⇒ 野怪先画（飞行兵压在前面）。
    //  这一条容易被误读成「野怪永远在飞行之上」—— 用户的原话是「整体压在地面之上」，
    //  空中层内部谁是前后照旧看 y。
    assert.deepEqual(layer.children.map((node: any) => node.name),
        ['Unit_summon', 'Unit_far', 'Unit_near', 'Monster_body', 'Monster_bar', 'Monster_focus', 'Unit_flying'],
        '分身垫底 → 地面 y 降序 → 空中层按 y（野怪一整组，血条与按钮跟在身体之后）');

    //  顺序没变就一个 `setSiblingIndex` 都不写：写一次会让 cc 重建这份渲染数据，
    //  46 个单位每帧全量写等于白扔一半帧。
    let writes = 0;
    for (const node of layer.children as any[]) {
        const original = node.setSiblingIndex.bind(node);
        node.setSiblingIndex = (index: number) => { writes += 1; original(index); };
    }
    world.renderCharacterOrder(frame);
    assert.equal(writes, 0, '同一帧再排一次不许再动兄弟序（幂等）');

    //  真的变了才写：让近处的单位走到比远处的更下面去。
    (units[0] as any).unitId = 1;
    groundNear.setPosition(0, 900, 0);
    world.renderCharacterOrder(frame);
    assert.ok(writes > 0, 'y 变了必须重排');
    assert.deepEqual(layer.children.map((node: any) => node.name),
        ['Unit_summon', 'Unit_near', 'Unit_far', 'Monster_body', 'Monster_bar', 'Monster_focus', 'Unit_flying'],
        'y 大的先画：near 走到 900 之后必须先画');

    //  野怪整体在「空中层」：哪怕地面单位 y 更大，也压不过它（用户口径 2）。
    groundNear.setPosition(0, 99999, 0);
    world.renderCharacterOrder(frame);
    const names = layer.children.map((node: any) => node.name);
    assert.ok(names.indexOf('Monster_body') > names.indexOf('Unit_near'),
        '野怪整体压在地面之上，不跟地面单位混排 y');
});

/**
 * ④ 野怪成组：身体 → 血条 → 按钮，**不**按各自的 y 单独排。
 *
 * 若让血条自己参与排序，它画在头顶、y 比身体大 ⇒ 会被判成「更远先画」，
 * 结果反过来被自己的身体盖住（用户口径 1：血条不独立于单位）。
 */
test('④ 野怪：身体 / 血条 / 按钮作为一组搬进角色层，退出时原样还回去', () => {
    const { load, cc } = loadViews();
    const view = new (load('./ZCHexView').ZCHexView)();
    const hex = new cc.Node('Hex_7');
    const barNode = new cc.Node('HealthBar');
    const focusNode = new cc.Node('MonsterFocus');
    const body = new cc.Node('ResourceUnit_0');
    // 真实层级：血条 / 按钮在棋盘状态层（`attachCooldownOverlay` 抬上去的），身体在资源层。
    const overlay = new cc.Node('CooldownOverlay');
    const resourceLayer = new cc.Node('ResourceLayer');
    overlay.addChild(barNode);
    overlay.addChild(focusNode);
    resourceLayer.addChild(body);
    view.healthBar = { node: barNode, progress: 0, totalLength: 24, barSprite: { node: new cc.Node(), color: null, spriteFrame: null } };
    view.monsterFocusButton = { node: focusNode, interactable: true };
    view.monsterFocusLabel = { node: new cc.Node(), string: '', color: null };
    view.resourceUnitNodes.push(body);
    view.monsterDefinition = { prefabSize: 1, attackDuration: 1 };
    const layer = new cc.Node('CharacterLayer');
    view.setCharacterLayer(layer);

    // `claimed = true` ⇒ 走到「先搬层、再判显示」那一步就早退，桩不用铺按钮的全部状态。
    view.renderMonsterFocus({ neutralFeature: { awake: true, claimed: true } }, 0);
    assert.equal(body.parent, layer, '身体搬进角色层');
    assert.equal(barNode.parent, layer, '血条跟着身体走（血条不独立于单位）');
    assert.equal(focusNode.parent, layer, '集火按钮也在这组里');
    assert.deepEqual(layer.children, [body, barNode, focusNode], '组内层序：身体 → 血条 → 按钮');
    assert.deepEqual([...view.monsterTrailingNodes], [barNode, focusNode],
        '渲染层只把「身体之后」的节点当 extras，别把身体重复排一次');

    //  幂等：每帧都会调，已经在层里就不许再搬（`setParent` 会让 cc 重置兄弟序）。
    view.renderMonsterFocus({ neutralFeature: { awake: true, claimed: true } }, 0.1);
    assert.deepEqual(layer.children, [body, barNode, focusNode]);

    //  退出野怪态：血条与按钮还给原来的父节点 —— 城墙和建筑共用同一根血条。
    (view as any).restoreMonsterHeader();
    assert.equal(barNode.parent, overlay, '血条必须还给 CooldownOverlay');
    assert.equal(focusNode.parent, overlay, '按钮同理');
    assert.equal(view.monsterTrailingNodes.length, 0, '不是野怪了就不参与排序');

    // 没注入角色层时一律不搬（宁可不排，也不按猜的父节点乱挂）。
    const bare = new (load('./ZCHexView').ZCHexView)();
    const bareBar = new cc.Node('HealthBar');
    const bareBody = new cc.Node('ResourceUnit_0');
    const home = new cc.Node('Hex');
    home.addChild(bareBar);
    home.addChild(bareBody);
    bare.healthBar = { node: bareBar, progress: 0, totalLength: 24, barSprite: { node: new cc.Node(), color: null, spriteFrame: null } };
    bare.monsterFocusButton = { node: new cc.Node(), interactable: true };
    bare.monsterFocusLabel = { node: new cc.Node(), string: '', color: null };
    bare.resourceUnitNodes.push(bareBody);
    bare.monsterDefinition = { prefabSize: 1, attackDuration: 1 };
    bare.renderMonsterFocus({ neutralFeature: { awake: true, claimed: true } }, 0);
    assert.equal(bareBody.parent, home, '没注入角色层 ⇒ 身体留在原地');
    assert.equal(bareBar.parent, home, '没注入角色层 ⇒ 血条留在原地');
    assert.equal(bare.monsterTrailingNodes.length, 0);
});

/** ③ 源码守卫：旧的两套「靠出生顺序排」的机制必须彻底消失。*/
test('④ 源码守卫：旧的出生顺序排序 / 独立按钮层已拆除', () => {
    const world = codeOf(RENDER_WORLD);
    assert.doesNotMatch(world, /applyUnitDrawOrder/, '旧的「出生时挪队尾 / 插队」必须删掉');
    assert.doesNotMatch(world, /summonEntityIds/, '分身集合被 tier 0 取代，别再留一份会漂的状态');
    assert.doesNotMatch(world, /MonsterFocusLayer/, '集火按钮不再单独抬到顶层（它属于野怪那一组）');

    // 单位挂角色层、野怪组由视图给。
    assert.match(world, /this\.attachToCharacterLayer\(node\);/, '单位必须挂角色层');
    assert.match(world, /view\.monsterBodyNode/, '野怪身体从视图取');
    assert.match(world, /view\.monsterTrailingNodes/, '野怪的血条 / 按钮从视图取');
    assert.match(world, /monster: true/, '野怪按「空中层」算');

    // 排序必须挂在动态渲染的最后一步：单位和野怪这一帧的位置都写完了才排。
    const dynamic = world.slice(world.indexOf('renderDynamic(frame'));
    const body = dynamic.slice(0, dynamic.indexOf('\n    }\n'));
    assert.ok(body.indexOf('this.renderNeutralFeatures(frame)') < body.indexOf('this.renderCharacterOrder(frame)'),
        '排序要排在单位与野怪渲染之后（否则读到的是上一帧的 y）');

    const hex = codeOf(HEX_VIEW);
    const sync = hex.slice(hex.indexOf('private syncMonsterTrailingNodes'));
    const syncBody = sync.slice(0, sync.indexOf('\n    }\n'));
    assert.ok(syncBody.indexOf('this.monsterTrailing.push(bar, focus)') > 0, '组内层序：血条在按钮之前');
    const focus = hex.slice(hex.indexOf('renderMonsterFocus('));
    const focusBody = focus.slice(0, focus.indexOf('if (!visible'));
    assert.match(focusBody, /this\.syncMonsterTrailingNodes\(\);/, '搬层必须在「不可见就早退」之前');
});
