/**
 * 地块类型图标（`icon_wh` / `icon_jk` / `icon_by` / `icon_em`，都挂在 `iconSprite` 上）的基准缩放 = 0.8。
 *
 * 判据钉三件事，缺一件就会退回「改了 prefab 却不生效」的静默失效：
 *  1. 我方 / 敌方可开发格的图标都落在 0.8，且**由代码写** —— `renderContent` 是 `iconSprite.node.scale`
 *     的唯一写入口；prefab 里那个 0.8 只是编辑器里的手写值，会被它覆盖，所以断言里必须出现 0.8、
 *     且必须能证伪「停在 1」；
 *  2. 金币图标（`priceIcon`）与数字（`iconLabel`）**不被连带缩放** —— 需求明说这两样大小不变；
 *  3. 资源点格仍按 `resourceIconScale` 按图缩，不被 0.8 覆盖（两条分支共用一个节点）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

/** 需求值：地块类型图标缩到 80%。与 `ZCGameHex.prefab` 里的 `_lscale` 同值，但运行时真源是代码。 */
const TILE_ICON_SCALE = 0.8;
/** ⚠️ 必须带容差：0.8 与 `setScale` 写回的值在 IEEE754 下可能差 1 ULP。 */
const EPS = 1e-9;
const near = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= EPS;
/** `ZCGameHex.prefab` 上 `BuildingLayer/PriceIcon` 的 `_lscale`。 */
const PREFAB_PRICE_ICON_SCALE = 0.65;
/** `ZCGameHex.prefab` 上 `BuildingLayer/IconLabel` 的 `_lscale`。 */
const PREFAB_ICON_LABEL_SCALE = 1;

/** 与 `tests/zcds-building-icon-scale.test.ts` 同款：补齐 prefab 上全部必填引用，缺一个就是空指针。 */
function stubHexView(load: (name: string) => any, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView').ZCHexView)();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    // 把金币 / 数字的缩放还原成 prefab 值：桩默认给 1，不还原的话「保持不变」这条判据恒真、
    // 等于没测（真机上是 0.65 与 1，混进来一眼能看出来）。
    view.priceIcon.node.scale.x = PREFAB_PRICE_ICON_SCALE;
    view.priceIcon.node.scale.y = PREFAB_PRICE_ICON_SCALE;
    view.iconLabel.node.scale.x = PREFAB_ICON_LABEL_SCALE;
    view.iconLabel.node.scale.y = PREFAB_ICON_LABEL_SCALE;
    return view;
}

/** 可开发格：我方走 `frameForTileType`（`icon_jk/by/wh`），敌方走 `enemyDevelopFrame`（`icon_em`）。 */
function developablePresentation(owner: string, tileType: number, canDevelop: boolean): any {
    return {
        state: {
            id: 3, owner, state: 'developable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType, developmentResolved: false,
            neutralResourceId: null, cardId: null,
        },
        canDevelop,
        playerGold: 999,
        cooldown: null,
        now: 0,
    };
}

test('地块类型图标缩放：我方可开发格落在 0.8，不是被覆写掉的 1', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);

    view.render(developablePresentation('player', ZCPvpTileType.AllRandom, true));

    const node = view.iconSprite.node;
    assert.equal(view.iconSprite.spriteFrame, view.mysteryFrame, '判据前提：这格确实画了地块类型图标');
    assert.ok(near(node.scale.x, TILE_ICON_SCALE), `地块类型图标必须是 0.8，实际 ${node.scale.x}`);
    assert.equal(node.scale.y, node.scale.x, '两轴同值，等比不变形');
    assert.equal(node.scale.z, 1, '2D 图标不在 z 轴上缩放');
    // 反向判据：老代码把非资源图标一律写回 1 ⇒ 只改 prefab 会被静默覆盖。
    assert.ok(!near(node.scale.x, 1), '不能停在 1（那说明又被 renderContent 覆写了）');
});

test('地块类型图标缩放：敌方可开发格的 icon_em 用同一基准，三类兵营图标也一致', () => {
    const { load, cc, bar } = loadViews();

    const enemyView = stubHexView(load, cc, bar);
    enemyView.render(developablePresentation('enemy', null, false));
    assert.equal(enemyView.iconSprite.spriteFrame, enemyView.enemyDevelopFrame,
        '判据前提：敌方可开发格画的是 icon_em');
    assert.ok(near(enemyView.iconSprite.node.scale.x, TILE_ICON_SCALE),
        `icon_em 也要缩到 0.8，实际 ${enemyView.iconSprite.node.scale.x}`);

    // 三种兵营地块共用 `barracksIconFrame`，「统一调小」意味着它们不能各自为政。
    for (const tileType of [
        ZCPvpTileType.BarracksCommon,
        ZCPvpTileType.BarracksMedium,
        ZCPvpTileType.BarracksAdvanced,
    ]) {
        const view = stubHexView(load, cc, bar);
        view.render(developablePresentation('player', tileType, true));
        assert.equal(view.iconSprite.spriteFrame, view.barracksIconFrame);
        assert.ok(near(view.iconSprite.node.scale.x, TILE_ICON_SCALE),
            `tileType=${tileType} 的兵营图标也必须是 0.8，实际 ${view.iconSprite.node.scale.x}`);
    }
});

test('地块类型图标缩放：金币图标与数字不被连带缩放', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // 桩默认给 `spriteFrame: null` ⇒ 「可开发」时金币会被判定为没有帧而关掉，这格就测不到它。
    view.priceIcon.spriteFrame = { name: 'gold-coin' };

    view.render(developablePresentation('player', ZCPvpTileType.Mine, true));

    assert.ok(view.priceIcon.enabled, '判据前提：可开发格确实显示了金币图标');
    assert.equal(view.priceIcon.node.scale.x, PREFAB_PRICE_ICON_SCALE,
        `金币图标要保持 prefab 的 ${PREFAB_PRICE_ICON_SCALE}，实际 ${view.priceIcon.node.scale.x}`);
    assert.equal(view.priceIcon.node.scale.y, PREFAB_PRICE_ICON_SCALE);
    assert.equal(view.iconLabel.node.scale.x, PREFAB_ICON_LABEL_SCALE,
        `数字 UI 要保持 prefab 的 ${PREFAB_ICON_LABEL_SCALE}，实际 ${view.iconLabel.node.scale.x}`);
    assert.equal(view.iconLabel.string, '25', '判据前提：这格确实写了价格数字');
});

test('地块类型图标缩放：资源点格仍按图缩到格子边长，不被 0.8 覆盖', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.setArtifactChargeFrame({ originalSize: { width: 230, height: 230 } });

    view.render({
        state: {
            id: 1, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
            hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
            developmentCost: 25, tileType: null, developmentResolved: false,
            neutralResourceId: 'artifact_charge', cardId: null,
        },
        canDevelop: false,
        playerGold: 0,
        cooldown: null,
        now: 0,
    });

    const scale = view.iconSprite.node.scale.x;
    assert.equal(230 * scale, 128, `资源点图标最长边要正好等于格子边长，实际 ${230 * scale}`);
    assert.ok(!near(scale, TILE_ICON_SCALE), '资源点这条分支不能被地块图标的 0.8 顶掉');
});
