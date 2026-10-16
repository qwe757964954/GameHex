import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { readFileSync } from 'node:fs';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

/** `ZCGameHex.prefab` 根节点尺寸 —— 资源图标的缩放目标就是它（格子边长）。 */
const HEX_SIZE = 128;

/** 与 `tests/zcds-progress.test.ts` 同款：补齐 prefab 上全部必填引用，缺一个就是空指针。 */
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
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

function resourceScaleOf(load: (name: string) => any): (frame: unknown) => number {
    return load('./ZCHexView').resourceIconScale as (frame: unknown) => number;
}

test('资源图标缩放：神器这类大图按最大边缩到格子边长，小图不放大', () => {
    const { load } = loadViews();
    const scale = resourceScaleOf(load);

    // 三张 map-resource 是统一 128×128 ⇒ 原尺寸合身，不动。
    assert.equal(scale({ originalSize: { width: 128, height: 128 } }), 1);
    // 神器图实测 230×230 ⇒ 缩到 128（这正是截图里那把剑溢出格子的量）。
    assert.equal(scale({ originalSize: { width: 230, height: 230 } }), HEX_SIZE / 230);
    // 非正方：按**最大边**取系数 ⇒ 三边同值、等比不变形。
    assert.equal(scale({ originalSize: { width: 400, height: 100 } }), HEX_SIZE / 400);
    // 只缩不放：美术出小图时不放大成糊的。
    assert.equal(scale({ originalSize: { width: 64, height: 64 } }), 1);
    // 尺寸缺失 / 非法⇒ 不缩放，且绝不能产出 NaN（NaN 缩放会把图标缩没）。
    assert.equal(scale(null), 1);
    assert.equal(scale(undefined), 1);
    assert.equal(scale({}), 1);
    assert.equal(scale({ originalSize: { width: 0, height: 0 } }), 1);
    assert.equal(scale({ originalSize: { width: NaN, height: 10 } }), 1);
});

test('资源点图标等比缩到格子边长；地块类型图标不被资源图的系数带走', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 神器图：230×230 的帧。
    const artifactFrame = { originalSize: { width: 230, height: 230 } };
    view.setArtifactChargeFrame(artifactFrame);

    const iconNode = view.iconSprite.node;
    view.render({
        state: {
            id: 1, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: null, developmentResolved: false,
            neutralResourceId: 'artifact_charge', cardId: null,
        } as never,
        canDevelop: false,
        playerGold: 0,
        cooldown: null,
        now: 0,
    });

    assert.equal(view.iconSprite.spriteFrame, artifactFrame, '资源点应显示神器图标');
    const scale = iconNode.scale.x;
    assert.ok(scale > 0 && scale < 1, `230×230 的图必须被缩小，实际 scale=${scale}`);
    // 缩放后最长边正好等于格子边长 —— 这就是「兼容格子大小」的判据。
    assert.equal(230 * scale, HEX_SIZE);
    // 等比：两轴同值，不变形。
    assert.equal(iconNode.scale.y, scale);
    assert.equal(iconNode.scale.z, 1);

    // 同一格换成普通地块类型图标 ⇒ 缩放必须回到**地块图标基准 0.8**：
    // 既不能把 230×230 算出来的 0.5565 留在原地，也不能停在 1。
    // 这里钉的是 0.8 而不是 1 —— `TILE_ICON_SCALE` 才是那一句写入的值（见同目录
    // `zcds-tile-icon-scale.test.ts`；只改 prefab 会被覆写成 1）。
    view.render({
        state: {
            id: 1, owner: 'neutral', state: 'developable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: 1, developmentResolved: false,
            neutralResourceId: null, cardId: null,
        } as never,
        canDevelop: true,
        playerGold: 100,
        cooldown: null,
        now: 0,
    });
    assert.equal(iconNode.scale.x, 0.8, '离开资源点后缩放要回到地块类型图标基准 0.8');
});
