import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { hexGridViewPoint } from '../assets/script/core/hex/HexGridLayout';
import { configureZCMap, ZC_HEX_CONFIG, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);

test('对局旧快照格心保持整数坐标口径', () => {
    assert.equal(ZC_HEX_CONFIG[0].y, 389);
    assert.ok(ZC_HEX_CONFIG.every((hex) => Number.isInteger(hex.x) && Number.isInteger(hex.y)));
});

test('对局与共享布局逐格一致，旧坐标只保留固定原点偏移', () => {
    const { load } = loadViews();
    const { mapToViewX, mapToViewY } = load('./ZCGameViewUtil');
    const rows = Math.max(...ZC_HEX_CONFIG.map((hex) => hex.row)) + 1;
    const columns = Math.max(...ZC_HEX_CONFIG.map((hex) => hex.column)) + 1;
    const originY = 0.5 * 90 / 42;
    for (const hex of ZC_HEX_CONFIG) {
        const point = hexGridViewPoint(hex.row, hex.column, rows, columns);
        assert.ok(Math.abs(mapToViewX(hex.x) - point.x) < 1e-9, `格 ${hex.id} 的 x`);
        assert.ok(Math.abs(mapToViewY(hex.y) - point.y - originY) < 1e-9, `格 ${hex.id} 的 y`);
    }
});

/**
 * ZCHexView 的桩：补齐 ZCGameHex.prefab 上全部必填引用。
 * 视图脚本已按「Inspector 绑定即必填」去判空（去掉 `| null` 与 `if (this.x)`），
 * 所以桩也要给全 —— 缺一个就是空指针，这正好是那类改动的回归网。
 */
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

/** ZCUnitView 的桩：补齐 ZCGameUnit.prefab 上全部必填引用（口径同 stubHexView）。 */
function stubUnitView(load: (name: string) => any, bar: () => any): any {
    const view = new (load('./ZCUnitView').ZCUnitView)();
    const node = bar().node;
    view.rootTransform = { setContentSize: () => {} };
    view.visualRoot = bar().node;
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node, clear: () => {}, circle: () => {}, fill: () => {} };
    view.fallbackLabel = { node, enabled: true, string: '' };
    view.healthBar = bar();
    return view;
}

/**
 * `ZCCardRevealView` 的最小桩：prefab 上 `Frame` / `Icon` / `LuckSprite` / `NameLabel` 四个引用，
 * 外加根节点懒取的 UIOpacity（整卡淡出走它）。
 *
 * `luckSprite` 还必须有**带 getComponent / addComponent 的节点**：评语是一条独立的 UIOpacity
 * （只承担「延迟 0.13s 出现」，淡出仍随根级联），视图会往它的节点上懒挂。
 */
function stubCardRevealView(load: (name: string) => any, cc: any): any {
    const view = new (load('./ZCCardRevealView').ZCCardRevealView)();
    const sprite = () => ({ enabled: true, spriteFrame: null, color: new cc.Color(255, 255, 255, 255) });
    const nodeWithComponents = () => {
        const components: any[] = [];
        return {
            components,
            getComponent: (type: unknown) => components.find((c) => c instanceof (type as any)) ?? null,
            addComponent: (type: any) => { const component = new type(); components.push(component); return component; },
        };
    };
    view.frameSprite = sprite();
    view.iconSprite = sprite();
    view.luckSprite = { ...sprite(), node: nodeWithComponents() };
    view.nameLabel = { string: '', enabled: true, color: new cc.Color(255, 255, 255, 255) };
    view.cardOpacity = { opacity: 255 };
    view.greenFrame = { name: 'green-frame' };
    return view;
}

/** 一条问号地块弹出的小卡牌（默认参数按需覆盖）。 */
function revealOf(over: Record<string, unknown> = {}): any {
    return {
        id: 1, cardId: '68001', owner: 'player', building: 'barracks', tier: 1,
        cardName: '豌豆游侠', unitId: null, luckText: '', hexId: 1,
        x: 0, y: 0, startedAt: 0, durationSeconds: 2.4,
        ...over,
    };
}

/** 抓 `console.warn`；返回 [记录, 还原函数]。视图打的是「卡面图缺失」这类开发日志。 */
function captureWarn(): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    return { lines, restore: () => { console.warn = original; } };
}

test('小卡牌卡面用角色卡牌图，不再用这张卡产出的兵种立绘', () => {
    const { load, cc, procedureGame } = loadViews();
    const view = stubCardRevealView(load, cc);
    const cardArt = { name: 'card-head-julijianguo' };
    const unitArt = { name: 'unit-idle-peashooter' };
    let unitResolverCalls = 0;
    // 即便注入器还在（横幅回退链仍用），小卡牌也**不许**去问它。
    (view as any).unitFrameResolver = () => { unitResolverCalls += 1; return unitArt; };
    //  卡面图由控制器按 id 现取（原先是被渲染层注入 resolver）。
    procedureGame.current = {
        resolveCardArt: (cardId: string) => (cardId === '68001' ? cardArt : null),
        resolveBuildingFrame: () => null,
    };
    view.render(revealOf({ unitId: '68011' }), 0);
    assert.equal(view.iconSprite.spriteFrame, cardArt, '卡面必须是角色卡牌图');
    assert.equal(unitResolverCalls, 0, '不能回退去问兵种立绘解析器');
    assert.equal(view.iconSprite.enabled, true);
});

test('卡面图取不到才回退建筑图，并打出能回查卡表的日志', () => {
    const { load, cc, procedureGame } = loadViews();
    const view = stubCardRevealView(load, cc);
    const configuredFrame = { name: 'barracks-peashooter' };
    let resolved: unknown[] = [];
    //  卡面图 / 建筑帧由控制器按 id 现取（原先是被渲染层注入 resolver）。
    procedureGame.current = {
        resolveCardArt: () => null,
        resolveBuildingFrame: (cardId: string, building: string) => {
            resolved = [cardId, building];
            return configuredFrame;
        },
    };
    const warn = captureWarn();
    try {
        // 多渲几帧。日志**不该按帧刷屏**：`renderContent` 有 `contentKey` 短路，
        // 同一张卡只选一次图 —— 所以视图里不需要额外的去重集合（红/绿自证时验证过：
        // 去掉 contentKey 短路，本条的次数断言就会红）。
        for (const now of [0, 0.5, 1, 1.5, 2]) view.render(revealOf({ unitId: '68011' }), now);
    } finally {
        warn.restore();
    }
    assert.deepEqual(resolved, ['68001', 'barracks'], '回退要走 buildIcon 解析器（建筑帧由控制器按 cardId 查）');
    assert.equal(view.iconSprite.spriteFrame, configuredFrame);
    assert.equal(view.iconSprite.enabled, true);
    assert.equal(warn.lines.length, 1, `同一张卡只应打一次日志（contentKey 短路），实际 ${warn.lines.length} 次`);
    assert.match(warn.lines[0], /68001/, '日志要带上卡牌 id，便于回查卡表');
    assert.match(warn.lines[0], /豌豆游侠/, '日志要带上卡名');
    assert.match(warn.lines[0], /headIcon/, '日志要指明是卡表 headIcon 缺失');
});

test('卡面图晚到：invalidateArt 要作废内容键，已经弹出的卡下一帧换成卡面图', () => {
    const { load, cc, procedureGame } = loadViews();
    const view = stubCardRevealView(load, cc);
    const buildingFrame = { name: 'barracks-peashooter' };
    const cardArt = { name: 'card-head-julijianguo' };
    procedureGame.current = { resolveCardArt: () => null, resolveBuildingFrame: () => buildingFrame };
    const warn = captureWarn();
    try {
        view.render(revealOf({ unitId: '68011' }), 0);
        assert.equal(view.iconSprite.spriteFrame, buildingFrame, '图还没到时先显示回退图');
        // 异步资源到位（横幅那条链就是这个时序）。
        procedureGame.current = { resolveCardArt: () => cardArt, resolveBuildingFrame: () => buildingFrame };
        // 帧到齐后由渲染世界调 `invalidateArt()`（原先是 setCardArtResolver 里顺手作废 contentKey）。
        view.invalidateArt();
        view.render(revealOf({ unitId: '68011' }), 0.1);
    } finally {
        warn.restore();
    }
    assert.equal(view.iconSprite.spriteFrame, cardArt,
        '图后到必须补刷：不作废 contentKey 的话这条卡会一直停在回退图上');
});

test('弹卡建筑图按 cardId 走 buildIcon 解析器，不再依赖 prefab 固定兵营图', () => {
    const { load, cc, procedureGame } = loadViews();
    const view = stubCardRevealView(load, cc);
    const configuredFrame = { name: 'barracks-peashooter' };
    let resolved: unknown[] = [];
    // 这条钉的是**回退链**：注入一个恒返回 null 的卡面解析器，逼它落到建筑图。
    //  卡面图 / 建筑帧由控制器按 id 现取（原先是被渲染层注入 resolver）。
    procedureGame.current = {
        resolveCardArt: () => null,
        resolveBuildingFrame: (cardId: string, building: string) => {
            resolved = [cardId, building];
            return configuredFrame;
        },
    };
    const warn = captureWarn();
    try {
        view.render(revealOf({ unitId: null }), 0);
    } finally {
        warn.restore();
    }
    assert.deepEqual(resolved, ['68001', 'barracks']);
    assert.equal(view.iconSprite.spriteFrame, configuredFrame);
    assert.equal(view.iconSprite.enabled, true);
});


test('小兵切换到攻击时保持移动中的连续坐标', () => {
    const { load } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
    const source = ZC_HEX_CONFIG.find((hex) => hex.row === 10 && hex.column === 4)!;
    const target = ZC_HEX_CONFIG[source.neighbors[0]];
    const freeX = source.x + (target.x - source.x) * 0.72;
    const freeY = source.y + (target.y - source.y) * 0.72;
    const unit = {
        id: 4, sourceHexId: source.id, targetHexId: target.id,
        progress: 0.3, marchAngle: null, freeX, freeY,
    };
    const moving = world.unitPosition(unit);
    assert.equal(moving.x, freeX);
    assert.equal(moving.y, freeY);
    unit.targetHexId = null;
    unit.progress = 0;
    const attacking = world.unitPosition(unit);
    assert.equal(attacking.x, moving.x);
    assert.equal(attacking.y, moving.y);
});

test('img_land_01 的 92.25 x 90 蜂窝间距同步单位位置，保持逻辑坐标和镜像对称', () => {
    const { load } = loadViews();
    const { mapToViewX, mapToViewY, ZC_MAP_PRESENTATION_SCALE } = load('./ZCGameViewUtil');
    assert.equal(ZC_MAP_PRESENTATION_SCALE, 1);
    const source = ZC_HEX_CONFIG.find(hex => hex.row === 0 && hex.column === 0)!;
    const column = ZC_HEX_CONFIG.find(hex => hex.row === 0 && hex.column === 1)!;
    const row = ZC_HEX_CONFIG.find(hex => hex.row === 1 && hex.column === 0)!;
    // 92.25 = 1.5×顶面半宽（斜邻居方向）；90 = 行距 = 顶面高（标准蜂窝）——
    // 行距**不能**加大到露侧壁，否则每格都凸起、整片不平整。
    assert.equal(mapToViewX(column.x) - mapToViewX(source.x), 92.25);
    assert.ok(Math.abs(mapToViewY(source.y) - mapToViewY(row.y) - 90) < 1e-9);
    const mirrorCenterY = mapToViewY(source.y) + mapToViewY(ZC_HEX_CONFIG[source.mirrorId].y);
    for (const hex of ZC_HEX_CONFIG) {
        const mirror = ZC_HEX_CONFIG[hex.mirrorId];
        assert.ok(Math.abs(mapToViewX(hex.x) + mapToViewX(mirror.x)) < 1e-9);
        assert.ok(Math.abs(mapToViewY(hex.y) + mapToViewY(mirror.y) - mirrorCenterY) < 1e-9);
    }
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
    let rendered: any;
    world.unitEntityBySource.set(4, 1);
    world.unitViews.set(1, { render: (value: unknown) => { rendered = value; } });
    // id=4 has no formation offset; both movement paths should reach the tile center.
    const unit = { id: 4, kind: 'test', sourceHexId: source.id, targetHexId: column.id, progress: 1, marchAngle: null, freeX: column.x, freeY: column.y };
    world.renderUnitEntity(unit);
    assert.equal(rendered.x, mapToViewX(column.x));
    assert.equal(rendered.y, mapToViewY(column.y));
    unit.marchAngle = 0;
    world.renderUnitEntity(unit);
    assert.equal(rendered.x, mapToViewX(column.x));
    assert.equal(rendered.y, mapToViewY(column.y));
    assert.equal(column.x - source.x, 36);
    assert.equal(source.y - row.y, 42);
});

test('占领地只保留外轮廓，中立共享线只绘制一次', () => {
    const { buildTerritoryBoundaryMasks } = loadViews().load('./ZCGameViewUtil');
    const first = ZC_HEX_CONFIG.find((hex) => hex.playable
        && hex.neighbors.filter((id) => ZC_HEX_CONFIG[id]?.playable).length === 6)!;
    const second = ZC_HEX_CONFIG[first.neighbors.find((id) => ZC_HEX_CONFIG[id]?.playable)!];
    const edgeToward = (from: typeof first, to: typeof first) => {
        let edge = 0;
        let best = -Infinity;
        for (let index = 0; index < 6; index += 1) {
            const normal = Math.PI / 3 * index + Math.PI / 6;
            const score = ((to.x - from.x) * Math.cos(normal) + (to.y - from.y) * Math.sin(normal))
                / Math.hypot(to.x - from.x, to.y - from.y);
            if (score > best) { best = score; edge = index; }
        }
        return edge;
    };
    const firstEdge = edgeToward(first, second);
    const secondEdge = edgeToward(second, first);
    const owners = new Map<number, string>();
    const masks = () => buildTerritoryBoundaryMasks(
        ZC_HEX_CONFIG,
        (id: number) => owners.get(id) ?? 'neutral',
    );

    let result = masks();
    assert.equal(Number(Boolean(result.get(first.id)! & (1 << firstEdge)))
        + Number(Boolean(result.get(second.id)! & (1 << secondEdge))), 1);
    owners.set(first.id, 'player'); owners.set(second.id, 'player');
    result = masks();
    assert.equal(result.get(first.id)! & (1 << firstEdge), 0);
    assert.equal(result.get(second.id)! & (1 << secondEdge), 0);
    owners.set(second.id, 'enemy');
    result = masks();
    assert.ok(result.get(first.id)! & (1 << firstEdge));
    assert.ok(result.get(second.id)! & (1 << secondEdge));
});

test('TileBackground 为阵营色 60%；轮廓不再由地块自己画（已并到 OutlineLayer 共享 Graphics）', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    // TerritoryOutline 上的 Graphics 是 prefab 预挂 + Inspector 绑定（不再运行时 addComponent），
    // stubHexView 已按同一形态给了一份；initialize() 现在只负责挂触摸监听 + 关掉这份 Graphics。
    view.initialize(() => {});
    view.tileFrame = { name: 'img_land_01_gray' };
    const state = { owner: 'player', state: 'occupied', building: 'none', tileType: ZCPvpTileType.Mine, developmentCost: 0, developmentResolved: true, hp: 0, maxHp: 0, tier: 1 };
    const factionColors = {
        player: [126, 130, 255],
        enemy: [251, 73, 105],
        enemy2: [251, 204, 73],
        enemy3: [189, 73, 251],
    } as const;

    // 2026-10-08：领地轮廓合并到 `ZCGameBoard.prefab` 的 `OutlineLayer`（整盘一个 Graphics）。
    // 逐边描线的判据与配色**没有变**，只是搬家 —— 迁移后的等价性由
    // `tests/zcds-outline-layer.test.ts` 逐条比对线段集合来钉。
    // 这里改成钉「搬家后最容易破的那条」：这份 per-cell Graphics 必须被关掉，
    // 否则漏网调用路径会画出与共享层重叠的第二份轮廓（同色叠线 = 颜色加深 / 边界变粗）。
    assert.equal(view.outlineGraphics.enabled, false, 'per-cell 轮廓 Graphics 必须停用，否则会与共享层叠线');
    assert.deepEqual(view.outlineGraphics.commands, [], '停用前先 clear 干净，别留上一局的路径');

    for (const [owner, rgb] of Object.entries(factionColors)) {
        state.owner = owner;
        // boundaryMask=1：低 6 bit=1（edge0 是外边界），高 6 bit=0（无内部线）。
        view.render({ state, canDevelop: false, playerGold: 0, cooldown: null, now: 0, boundaryMask: 1 });
        assert.deepEqual(
            [view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a],
            [...rgb, 150],
            `${owner} TileBackground 应使用阵营色、60% 透明度`,
        );
        // 换了 5 次 mask 也不能多出一条线 —— 轮廓已经不由这一格负责了。
        assert.deepEqual(view.outlineGraphics.commands, [], `${owner}：地块视图不该再画轮廓`);
    }

    // 🔴 2026-10-16 口径（山猫）：「局内地图中立没有任何显示」。
    // 中立格的 TileBackground 直接**停用**（alpha 0），露出棋盘底图 ——
    // 不是"染得更淡"，是"根本不画"；格子感由 `OutlineLayer` 的矢量格线提供。
    state.owner = 'neutral';
    view.render({ state, canDevelop: false, playerGold: 0, cooldown: null, now: 0, boundaryMask: 2 });
    assert.equal(view.tileSprite.enabled, false, '中立格不做任何显示：连 Sprite 都不启用');
    assert.equal(view.tileSprite.color.a, 0,
        `中立格填充 alpha 应为 0（2026-10-16 起），实际 alpha=${view.tileSprite.color.a}`);
    view.render({ state, canDevelop: false, playerGold: 0, cooldown: null, now: 0, boundaryMask: 0 });
    assert.deepEqual(view.outlineGraphics.commands, [], '中立格同样不自己画轮廓');
});

test('血条使用 ProgressBar，裁切非法比例并按阵营换填充图', () => {
    const { load, bar } = loadViews();
    const { updateHealthBar, pickHealthBarFill } = load('./ZCGameViewUtil');
    const health = bar();
    // 四张填充图用可辨识的占位对象替代（渲染层只做「是不是同一张」的比较）。
    const fillPlayer = { name: 'jindutiao_b' } as any;
    const fillEnemy = { name: 'jindutiao_r' } as any;
    const fillEnemy2 = { name: 'jindutiao_y' } as any;
    const fillEnemy3 = { name: 'jindutiao_p' } as any;
    for (const [hp, maxHp, expected, visible] of [[100, 100, 1, true], [150, 100, 1, true], [-5, 100, 0, true], [50, 0, 0, false], [NaN, 100, 0, true], [50, Infinity, 0, false]]) {
        updateHealthBar(health, hp, maxHp, fillPlayer);
        assert.equal(health.progress, expected);
        assert.equal(health.node.active, visible);
    }
    // 阵营 → 图：我方蓝、敌红、敌2 黄、敌3 紫（R25「不同阵营区分不同的血条」四项各不相同）。
    const four = [fillPlayer, fillEnemy, fillEnemy2, fillEnemy3];
    const of = (owner: string) => pickHealthBarFill(owner, fillPlayer, fillEnemy, fillEnemy2, fillEnemy3);
    assert.equal(of('player'), fillPlayer);
    assert.equal(of('enemy'), fillEnemy);
    assert.equal(of('enemy2'), fillEnemy2);
    assert.equal(of('enemy3'), fillEnemy3,
        '第 4 家要拿到自己的紫条，不能再和敌方共用红色');
    assert.equal(new Set(four.map((fill) => fill.name)).size, 4, '四家的血条图必须两两不同');
    // neutral（以及未来新增的非玩家席位）没有阵营色，兜底走敌方红。
    assert.equal(of('neutral'), fillEnemy);
    // 换阵营真的写进了填充条（不再走 color 染色）。
    updateHealthBar(health, 50, 100, fillEnemy2);
    assert.equal(health.barSprite.spriteFrame, fillEnemy2, '阵营变了要换填充图');
    assert.doesNotThrow(() => updateHealthBar(null, 1, 1, fillPlayer));
});

test('Old Client 战斗飘字按轨道下落，金币保持上浮', () => {
    const { load, bar } = loadViews();
    const util = load('./ZCGameViewUtil');
    const mapToView = util;
    const view = new (load('./ZCFloatTextView').ZCFloatTextView)();
    const root: any = view.node;   // 根节点 = 世界定位
    const node = bar().node;       // Text 子节点 = 只在父节点内做偏移
    view.textLabel = { node, string: '', enabled: true, color: null as any };
    const base = { id: 1, kind: 'damage', owner: 'player', value: 25, x: 126, y: 117, startedAt: 10, durationSeconds: 1 };

    view.render(base, 10);
    // 2026-10-17：伤害数值**不再带负号**（`-25` → `25`）—— 飘字就在挨打的目标身上，
    // 负号只是多占一个字符宽度，和「克制」前缀挤在一起还会被读成一整串。
    assert.equal(view.textLabel.string, '25');
    assert.deepEqual([view.textLabel.color.r, view.textLabel.color.g, view.textLabel.color.b, view.textLabel.color.a], [255, 255, 255, 255]);
    // 目标坐标只写在根节点上；子节点写的是局部偏移（两处都写绝对坐标 → 实际位置翻倍）。
    assert.equal(root.position.x, mapToView.mapToViewX(126));
    assert.equal(root.position.y, mapToView.mapToViewY(117));
    assert.equal(node.position.x, 0);
    const damageStartY = view.damageTargetSize * 0.5 + view.damageHeadPadding;
    assert.equal(view.damageTargetSize, 98, '伤害起点按 98×98 兵种视觉画布计算');
    assert.equal(node.position.y, damageStartY);
    assert.equal(node.scale.x, view.popScale);
    assert.equal(view.textLabel.enabled, true);

    // 「快进慢出」（2026-10-15）：位移 + 缩放收在**前 entranceProgress 段**，之后整段只淡出。
    // 判据一律从 `ZCGameViewUtil` 的真曲线取，不在用例里另写一份数字 —— 曲线改了用例必须跟着变。
    const entrance = view.entranceProgress;
    assert.equal(entrance, util.FLOAT_TEXT_ENTRANCE_PROGRESS,
        '入场占比应与 ZCGameViewUtil 的同源常量一致（两个数字各写一份迟早对不上）');
    assert.ok(entrance > 0 && entrance < 0.5, `入场要「快进」：占比应小于一半（实际 ${entrance}）`);

    // 入场中途：easeOutCubic 的手感体现在「半程已过半」。
    view.render(base, 10 + entrance * 0.5);
    const midEnter = util.floatTextEntrance(entrance * 0.5, entrance);
    assert.ok(midEnter > 0.5, `半程就该走完过半位移（实际 ${midEnter}）`);
    assert.ok(Math.abs(node.position.y - (damageStartY - midEnter * view.damageDropDistance)) < 1e-6,
        '中途的下坠量应正好等于入场进度 × 总下坠距离');

    // 入场段结束：缩放到位、下坠走满（之后只剩慢出段的像素级收尾漂移，见下一条用例）。
    view.render(base, 10 + entrance);
    assert.equal(node.scale.x, 1);
    assert.equal(root.position.y, mapToView.mapToViewY(117), '根节点位置不随飘字动画变化');
    assert.ok(Math.abs(node.position.y - (damageStartY - view.damageDropDistance)) < 1e-6,
        '入场段一结束，下坠就已走满全程');

    // 淡出段：入场结束的那一刻才开始变透明，剩下的时长里线性淡到 0。
    view.render(base, 10 + entrance);
    assert.equal(view.textLabel.color.a, 255, '入场段不许同时变淡');
    // 期望值按真曲线算，且**用与视图同一条 progress 表达式**：`(10 + x) - 10` 的浮点尾数
    // 与直接算 `x` 差 1 ulp，会让 `255 × 0.5` 的取整在 127/128 之间跳（写死 128 会偶发红）。
    const fadeMid = entrance + (1 - entrance) * 0.5;
    const fadeMidProgress = (10 + fadeMid - 10) / 1;
    view.render(base, 10 + fadeMid);
    assert.equal(view.textLabel.color.a, Math.round(255 * util.floatTextFade(fadeMidProgress, entrance)),
        '淡出段中点约半透明（线性淡出）');
    assert.ok(Math.abs(view.textLabel.color.a - 128) <= 1, `中点应约半透明（实际 ${view.textLabel.color.a}）`);
    view.render(base, 11);
    assert.equal(view.textLabel.color.a, 0);
    assert.equal(view.textLabel.enabled, false);

    // Old Client 普通伤害使用白色位图字，不按阵营换色；金币固定用金色并带 + 号。
    view.render({ ...base, owner: 'enemy' }, 10);
    assert.deepEqual([view.textLabel.color.r, view.textLabel.color.g, view.textLabel.color.b], [255, 255, 255]);
    view.render({ ...base, kind: 'gold', value: 7, owner: 'enemy' }, 10);
    assert.equal(view.textLabel.string, '+7');
    assert.deepEqual([view.textLabel.color.r, view.textLabel.color.g, view.textLabel.color.b], [255, 198, 45]);
    assert.equal(node.position.y, view.offsetY);
});

test('慢出段带 5~10px 同向收尾漂移：伤害继续下沉、金币继续上飘（2026-10-15）', () => {
    const { load, bar } = loadViews();
    const util = load('./ZCGameViewUtil');
    const view = new (load('./ZCFloatTextView').ZCFloatTextView)();
    const node = bar().node;
    view.textLabel = { node, string: '', enabled: true, color: null as any };
    const base = { id: 1, kind: 'damage', owner: 'player', value: 25, x: 0, y: 0, startedAt: 0, durationSeconds: 1 };
    const entrance = view.entranceProgress;

    // 幅度压在 5~10px（2026-10-15 由 3~5 上调）：只用来抵消「入场结束后完全静止地淡出」的死板感。
    // 几十像素就会变回「一直在飘」，等于把「快进慢出」退回去。
    assert.ok(view.driftDistance >= 5 && view.driftDistance <= 10,
        `收尾漂移应压在 5~10px（实际 ${view.driftDistance}）`);

    // 入场段**不许**漂移 —— 那段位移由入场曲线自己走完，两段叠加会打架。
    for (const p of [0, 0.1, entrance * 0.5, entrance]) {
        assert.equal(util.floatTextDrift(p, entrance), 0, `入场段（p=${p}）不应有漂移`);
    }

    // 伤害：慢出段继续**下沉**，总量正好 = driftDistance。
    const damageY = (p: number) => { view.render(base, p); return node.position.y; };
    const yStart = damageY(entrance);
    const yEnd = damageY(1);
    assert.ok(Math.abs((yStart - yEnd) - view.driftDistance) < 1e-6,
        `伤害慢出段应继续下沉 ${view.driftDistance}px（实际 ${(yStart - yEnd).toFixed(4)}）`);
    // easeOutQuad：前半段就该走完过半，越往后越慢（最后几乎停住）。
    const yHalf = damageY(entrance + (1 - entrance) * 0.5);
    assert.ok(yStart - yHalf > view.driftDistance * 0.5,
        `漂移应递减收尾：半程已走过半（实际 ${(yStart - yHalf).toFixed(4)}/${view.driftDistance}）`);
    assert.ok(yHalf - yEnd < yStart - yHalf,
        '后半程比前半程走得少 —— 越飘越慢，不是匀速');

    // 金币：慢出段沿**相反方向**（继续上飘）收尾，与伤害的下沉同量反向。
    const gold = { ...base, kind: 'gold', value: 7 };
    view.render(gold, entrance);
    const gStart = node.position.y;
    view.render(gold, 1);
    assert.ok(Math.abs((node.position.y - gStart) - view.driftDistance) < 1e-6,
        `金币慢出段应继续上飘 ${view.driftDistance}px（实际 ${(node.position.y - gStart).toFixed(4)}）`);
});

test('Old Client 技能飘字覆盖暴击、回复、MISS、秒杀、克制和抵抗', () => {
    const { load, bar } = loadViews();
    const view = new (load('./ZCFloatTextView').ZCFloatTextView)();
    const node = bar().node;
    // 2026-10-17：前缀（暴击 / 克制 / 抵抗 / 秒杀）拆成**独立的小字号 Label**，
    // 数值 Label 只留数字本身、且不带负号。
    const prefixNode = bar().node;
    view.textLabel = { node, string: '', enabled: true, color: null as any, fontSize: 30 };
    view.prefixLabel = { node: prefixNode, string: '', enabled: true, color: null as any, fontSize: 15 };
    const base = { id: 1, owner: 'player', value: 25, x: 0, y: 0, startedAt: 0, durationSeconds: 1 };
    const cases = [
        ['critical', '暴击', '25', [255, 198, 45], 34],
        ['heal', '', '+25', [91, 255, 49], 30],
        ['miss', '', 'MISS', [120, 205, 255], 30],
        ['execute', '秒杀', '25', [255, 105, 72], 34],
        ['restraint', '克制', '25', [255, 72, 62], 30],
        ['resisted', '抵抗', '25', [150, 150, 150], 30],
    ] as const;
    for (const [kind, prefix, expected, color, fontSize] of cases) {
        view.render({ ...base, kind, value: kind === 'miss' ? 0 : 25 }, 0);
        assert.equal(view.textLabel.string, expected, `${kind} 的数值文案`);
        assert.deepEqual([view.textLabel.color.r, view.textLabel.color.g, view.textLabel.color.b], color);
        assert.equal(view.textLabel.fontSize, fontSize);
        assert.ok(node.position.y > view.offsetY, `${kind} 应从目标头顶的战斗文字轨道开始`);

        // 前缀：只有这四种有；字号取数字的一半（34 → 17、30 → 15）。
        assert.equal(prefixNode.active, prefix.length > 0, `${kind} 的前缀显隐`);
        if (prefix.length === 0) continue;
        assert.equal(view.prefixLabel.string, prefix);
        assert.equal(view.prefixLabel.fontSize, Math.round(fontSize * 0.5), '前缀字号 = 数字字号的一半');
        assert.deepEqual([view.prefixLabel.color.r, view.prefixLabel.color.g, view.prefixLabel.color.b],
            color, '前缀与数字同色（克制就是那支红）');
        // 位置按数字实际宽度反推；桩里读不到 UITransform ⇒ 走兜底宽 40。
        assert.equal(prefixNode.position.x, -((40 / 2) + 6 + (prefix.length * view.prefixLabel.fontSize) / 2),
            '前缀整块落在数字左侧，不压字');
    }
});

test('ZCGameFloatText prefab 预绑 Text 节点的 Label：textLabel 是必填引用', () => {
    const data = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameFloatText.prefab', 'utf8'));
    const root = data[1];
    const view = data[root._components.at(-1).__id__];
    assert.ok(view.textLabel && typeof view.textLabel.__id__ === 'number',
        'textLabel 必须在 prefab 绑定（字段是 null! 必填引用，不允许运行时判空静默返回）');
    const label = data[view.textLabel.__id__];
    assert.equal(label.__type__, 'cc.Label');
    const labelNode = data[label.node.__id__];
    assert.equal(labelNode._name, 'Text');
    assert.equal(labelNode._parent.__id__, 1, 'Label 必须挂在根节点的 Text 子节点上');
});

test('同一位置连续伤害左右分散并错开高度，轨迹稳定不随机抖动', () => {
    const { load, bar } = loadViews();
    const view = new (load('./ZCFloatTextView').ZCFloatTextView)();
    const node = bar().node;
    view.textLabel = { node, string: '', enabled: true, color: null as any };
    const base = { kind: 'damage', owner: 'player', value: 25, x: 0, y: 0, startedAt: 0, durationSeconds: 1 };
    const positions = [1, 2, 3, 4, 5, 6].map((id) => {
        view.render({ ...base, id }, 0);
        return [node.position.x, node.position.y];
    });
    assert.equal(positions[0][0], 0, '第一条位于中轨');
    assert.ok(positions[1][0] < 0 && positions[2][0] > 0, '后续伤害向左右交替散开');
    assert.ok(Math.max(...positions.slice(0, 5).map((position) => position[0]))
        - Math.min(...positions.slice(0, 5).map((position) => position[0])) <= view.damageTargetSize,
    '首轮横向散落范围不超过 98px 兵种宽度');
    assert.equal(positions[5][1] - positions[0][1], 30, '轨道循环后错开一行文字高度');
    view.render({ ...base, id: 2 }, 0.5);
    const first = [node.position.x, node.position.y];
    view.render({ ...base, id: 2 }, 0.5);
    assert.deepEqual([node.position.x, node.position.y], first, '同一飘字每帧轨迹必须稳定');
});

test('飘字节点按 id 对齐：过期停用，新飘字复用，退出场景销毁', () => {
    const { load, FakeNode } = loadViews();
    const created: InstanceType<typeof FakeNode>[] = [];
    const views: any[] = [];
    const prefab = {
        make: () => {
            const node = new FakeNode('ZCGameFloatText');
            const view = { rendered: [] as any[], render(text: any) { this.rendered.push(text.id); } };
            node.getComponent = (() => view) as any;
            created.push(node);
            views.push(view);
            return node;
        },
    };
    const mapLayer = new FakeNode('MapLayer');
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer, floatTextPrefab: prefab });
    const texts = [{ id: 1 }, { id: 2 }];
    const model = { floatTexts: texts, snapshot: { elapsedSeconds: 1 } };

    world.renderFloatTexts(model);
    assert.equal(mapLayer.children.length, 2);
    assert.deepEqual(mapLayer.children.map((node) => node.name), ['FloatText_1', 'FloatText_2']);
    assert.deepEqual(views.map((view) => view.rendered), [[1], [2]]);

    // 第二帧不会重复建节点，只重渲染。
    world.renderFloatTexts(model);
    assert.equal(created.length, 2);
    assert.deepEqual(views.map((view) => view.rendered), [[1, 1], [2, 2]]);

    // 模型侧清掉一条，节点停用并等待复用。
    model.floatTexts = [{ id: 2 }];
    world.renderFloatTexts(model);
    assert.equal(created[0].isValid, true);
    assert.equal(created[0].active, false);
    assert.equal(created[1].isValid, true);
    assert.equal(mapLayer.children.filter(node => node.active).length, 1);
    model.floatTexts = [{ id: 2 }, { id: 3 }];
    world.renderFloatTexts(model);
    assert.equal(created.length, 2);
    assert.equal(created[0].active, true);
    assert.equal(created[0].name, 'FloatText_3');
    world.destroy();
    assert.ok(created.every(node => !node.isValid));

    // 没有配 prefab 时静默返回，不崩。
    const bare = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer: new FakeNode('L'), floatTextPrefab: null });
    assert.doesNotThrow(() => bare.renderFloatTexts(model));
});

test('飘字整链：节点世界位置就是目标格坐标，不因子节点偏移翻倍', () => {
    const { load, FakeNode } = loadViews();
    const mapToView = load('./ZCGameViewUtil');
    const mapLayer = new FakeNode('MapLayer');
    const prefab = {
        make: () => {
            const node = new FakeNode('ZCGameFloatText');
            const label = new FakeNode('Text');
            label.setParent(node);
            const view = new (load('./ZCFloatTextView').ZCFloatTextView)();
            (view as any).node = node;
            view.textLabel = { node: label, string: '', enabled: true, color: null } as any;
            node.getComponent = (() => view) as any;
            return node;
        },
    };
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer, floatTextPrefab: prefab });
    const model = {
        floatTexts: [{ id: 1, kind: 'gold', owner: 'player', value: 2, x: 126, y: 117, startedAt: 0, durationSeconds: 1 }],
        snapshot: { elapsedSeconds: 0 },
    };

    world.renderFloatTexts(model);

    const node = mapLayer.children[0];
    const label = node.children[0];
    assert.equal(node.parent, mapLayer, '飘字要和单位/地块挂在同一个 mapLayer 下，否则地图平移缩放时会错位');
    assert.equal(node.layer, mapLayer.layer);
    assert.equal(node.position.x, mapToView.mapToViewX(126));
    assert.equal(node.position.y, mapToView.mapToViewY(117));
    assert.equal(label.position.x, 0, '子节点不能再写一遍世界 x，否则飘字落在两倍远处');
    assert.equal(label.position.y, 26, '子节点只负责基准上移');
});

test('建筑圆环沿用建筑冷却，建造/工作周期切换，废墟和空地隐藏', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const prefabTint = { r: 255, g: 255, b: 255, a: 255 };
    view.cooldownBar.barSprite.color = prefabTint;
    const state = { hp: 80, maxHp: 100, state: 'developed', building: 'barracks', owner: 'player' };
    const cooldown = { phase: 'construction', progress: .25 };
    view.render({ state, cooldown, canDevelop: false, playerGold: 0 });
    assert.equal(view.healthBar.progress, .8);
    assert.equal(view.cooldownBar.progress, .25);
    assert.equal(view.cooldownBar.barSprite.color, prefabTint);
    cooldown.phase = 'spawn'; cooldown.progress = 1.2;
    view.render({ state, cooldown, canDevelop: false, playerGold: 0 });
    assert.equal(view.cooldownBar.progress, 1);
    assert.equal(view.cooldownBar.barSprite.color, prefabTint);
    for (const change of [{ state: 'ruins' }, { building: 'none' }]) {
        view.render({ state: { ...state, ...change }, cooldown, canDevelop: false, playerGold: 0 });
        assert.equal(view.cooldownBar.node.active, false);
        assert.equal(view.cooldownBar.progress, 0);
    }
    view.render({ state, cooldown: null, canDevelop: false, playerGold: 0 });
    assert.equal(view.cooldownBar.node.active, false);
});

test('building cooldown prefab matches the jindu_02 ring size and visual', () => {
    const data = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8'));
    const cooldown = data.find((item: any) => item.__type__ === 'cc.Node' && item._name === 'Cooldown');
    const children = cooldown._children.map((ref: any) => data[ref.__id__]);
    assert.deepEqual(children.map((node: any) => node._name), ['Fill']);
    const sprite = (node: any) => data[node._components.map((ref: any) => ref.__id__).find((id: number) => data[id].__type__ === 'cc.Sprite')];
    const track = sprite(cooldown);
    const fill = sprite(children[0]);
    const meta = JSON.parse(readFileSync('assets/resources/image/buildings/jindu_02.png.meta', 'utf8'));
    const frame = `${meta.uuid}@f9941`;
    assert.equal(track._spriteFrame.__uuid__, frame);
    assert.equal(fill._spriteFrame.__uuid__, frame);
    assert.deepEqual([track._color.r, track._color.g, track._color.b, track._color.a], [0, 0, 0, 220]);
    assert.deepEqual([fill._color.r, fill._color.g, fill._color.b, fill._color.a], [255, 255, 255, 255]);
    assert.equal(fill._type, 3);
    assert.equal(fill._fillType, 2);
    const size = (node: any) => data[node._components.map((ref: any) => ref.__id__).find((id: number) => data[id].__type__ === 'cc.UITransform')]._contentSize;
    assert.deepEqual([size(cooldown).width, size(cooldown).height], [39, 40]);
    assert.deepEqual([size(children[0]).width, size(children[0]).height], [39, 40]);
    assert.equal(meta.subMetas.f9941.userData.rawWidth, 39);
    assert.equal(meta.subMetas.f9941.userData.rawHeight, 40);
});

test('棋盘图层顺序声明在 ZCGameBoard.prefab 里，代码不再用 siblingIndex 现算', () => {
    const data = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameBoard.prefab', 'utf8'));
    const root = data[data[0].data.__id__];
    const order = root._children.map((ref: any) => data[ref.__id__]._name);
    // 子节点顺序 = 渲染顺序（后画的压在上面）：水面垫底，状态条最上。
    // `OutlineLayer` 是 2026-10-08 加的**共享轮廓 Graphics**（原先每格一个，见规则 180）：
    // 必须在 HexLayer 之上（轮廓要盖住地块底图），且在装饰之下。
    // `ResourceLayer` 是 2026-10-14 加的**中立资源图标专属层**：地块整图 130×119、格距只有
    // 92.25×90 ⇒ 相邻格整图互相重叠、后画的整格盖先画的；资源图标节点 128×128 比顶面 123×90
    // 还大，压在格节点里必然被邻格沿**格边线**切掉 —— 所以必须抬到轮廓层之上单独画。
    assert.deepEqual(order, [
        'MapWater', 'HexLayer', 'OutlineLayer', 'ResourceLayer',
        'DecorLayer', 'BuildingOverlay', 'CooldownOverlay',
    ]);
    // 城墙砖层不在这个 prefab 里（它来自 ZCGameWallLayer.prefab），由 initialize 插到
    // **轮廓层之后** —— 所以「墙压在轮廓之上、建筑 / 状态条压在城墙之上」由这三条同时保证。
    // ⚠️ 锚点不能是 `HexLayer + 1`：那会把城墙塞到轮廓**之下**，轮廓线从墙砖里穿出来。
    assert.ok(order.indexOf('OutlineLayer') > order.indexOf('HexLayer'));
    // 资源图标要盖住地块整图与轮廓（否则会被邻格整图沿格边线切一半）。
    assert.ok(order.indexOf('ResourceLayer') > order.indexOf('OutlineLayer'),
        'ResourceLayer 必须在 OutlineLayer 之上');
    // 但仍在装饰 / 建筑 / 状态条之下：资源图标是格内内容，不该盖住装饰与建筑本体。
    assert.ok(order.indexOf('DecorLayer') > order.indexOf('ResourceLayer'));
    assert.ok(order.indexOf('BuildingOverlay') > order.indexOf('HexLayer'));
    assert.ok(order.indexOf('CooldownOverlay') > order.indexOf('BuildingOverlay'));
    for (const ref of root._children) {
        // 漏了 UI_2D 的症状是整棵子树不渲染，且一条报错都没有。
        assert.equal(data[ref.__id__]._layer, 33554432, `${data[ref.__id__]._name} 的 layer`);
    }
    // 水面原本是代码 `addComponent(Graphics)` 补的，现在烘在 prefab 上。
    const water = data[root._children[0].__id__];
    const waterTypes = water._components.map((ref: any) => data[ref.__id__].__type__);
    assert.ok(waterTypes.includes('cc.UITransform'));
    assert.ok(waterTypes.includes('cc.Graphics'));
    // 共享轮廓层必须真的挂着一个 Graphics —— 没有它整盘轮廓会完全不画（且零报错）。
    const outline = data[root._children[order.indexOf('OutlineLayer')].__id__];
    const outlineTypes = outline._components.map((ref: any) => data[ref.__id__].__type__);
    assert.ok(outlineTypes.includes('cc.UITransform'), 'OutlineLayer 需要 UITransform');
    assert.ok(outlineTypes.includes('cc.Graphics'), 'OutlineLayer 必须挂 cc.Graphics');
    // 资源图标层是**纯容器**（图标节点由 `ZCHexView.setResourceIconRaised` 搬进来）：
    // 只要 UITransform，不该挂 Graphics —— 挂了反而会平白多一个断批点。
    const resource = data[root._children[order.indexOf('ResourceLayer')].__id__];
    const resourceTypes = resource._components.map((ref: any) => data[ref.__id__].__type__);
    assert.ok(resourceTypes.includes('cc.UITransform'), 'ResourceLayer 需要 UITransform');
    assert.ok(!resourceTypes.includes('cc.Graphics'), 'ResourceLayer 是纯容器，不需要 Graphics');
    assert.equal(root._layer, 33554432);
});

test('城墙砖层锚在共享轮廓层之后，不落在轮廓之下', () => {
    // 纯源码断言：`initialize` 里那行 setSiblingIndex 用的是哪个层的下标。
    // 静态读 prefab 看不出运行期插入位置，而插错的表现是「轮廓从墙砖里穿出来」（不报错）。
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const line = source.split('\n').find((l) => /wallLayer\.setSiblingIndex\(/.test(l));
    assert.ok(line, 'initialize 里应有 wallLayer.setSiblingIndex');
    assert.match(line, /outlineLayer\.getSiblingIndex\(\) \+ 1/,
        '城墙必须插在 OutlineLayer 之后；用 hexLayer 会让城墙压到轮廓之下');
    assert.doesNotMatch(line, /hexLayer\.getSiblingIndex\(\)/,
        '不能按 HexLayer 下标插 —— OutlineLayer 现在就夹在 HexLayer 之后');
});

test('building and status overlays stay above the wall while keeping tile positions', () => {
    const { load, FakeNode } = loadViews();
    const board = new FakeNode('ZCGameBoard');
    const hexLayer = new FakeNode('HexLayer');
    hexLayer.setParent(board);
    const buildingOverlay = new FakeNode('BuildingOverlay');
    buildingOverlay.setParent(board);
    const cooldownOverlay = new FakeNode('CooldownOverlay');
    cooldownOverlay.setParent(board);
    const tile = new FakeNode('Hex');
    tile.setParent(hexLayer);
    const cooldown = new FakeNode('Cooldown');
    cooldown.setPosition(.793, -20.104, 0);
    cooldown.setParent(tile);
    const building = new FakeNode('BuildingIcon');
    building.setPosition(0, 21.599, 0);
    building.setParent(tile);
    const health = new FakeNode('HealthBar');
    health.setPosition(0, -40.239, 0);
    health.setParent(tile);
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ board });
    const placed = [{ x: 126, y: 117, view: {
        buildingSprite: { node: building }, healthBar: { node: health }, cooldownBar: { node: cooldown },
    } }];
    world.attachBuildingOverlay(placed, buildingOverlay);
    world.attachCooldownOverlay(placed, cooldownOverlay);
    assert.equal(building.parent?.name, 'BuildingOverlay');
    assert.equal(building.position.x, 126);
    assert.equal(building.position.y, 138.599);
    assert.equal(health.parent?.name, 'CooldownOverlay');
    assert.equal(health.position.x, 126);
    assert.equal(health.position.y, 76.761);
    assert.equal(cooldown.parent?.name, 'CooldownOverlay');
    assert.equal(cooldown.position.x, 126.793);
    assert.equal(cooldown.position.y, 96.896);
    // 层序不变式换成 board 内部：建筑层与状态条层都排在地块层之后（城墙层紧随地块层），
    // 所以两者仍然压在城墙与地块之上。
    assert.ok(board.children.indexOf(buildingOverlay) > board.children.indexOf(hexLayer));
    assert.ok(board.children.indexOf(cooldownOverlay) > board.children.indexOf(buildingOverlay));
    // 两个层归 board 所有 —— destroy() 只摘实体与装饰，不许拆它们（随 HUD 一起销毁）。
    world.destroy();
    assert.equal(buildingOverlay.isValid, true);
    assert.equal(cooldownOverlay.isValid, true);
});

test('城墙被击破后只隐藏命中的单条六边形边', () => {
    const { load } = loadViews();
    const { shouldRenderWallEdge } = load('./ZCWallGeometry');
    assert.equal(Array.from({ length: 6 }, (_, edge) => shouldRenderWallEdge({ wallHp: 100 }, edge)).filter(Boolean).length, 6);
    assert.deepEqual(
        Array.from({ length: 6 }, (_, edge) => shouldRenderWallEdge({ wallHp: 0, wallBreachedEdge: 2 }, edge)),
        [true, true, false, true, true, true],
    );
    // 没有缺口字段的旧快照继续沿用“整墙已毁”，不会凭空恢复五条墙。
    assert.equal(Array.from({ length: 6 }, (_, edge) => shouldRenderWallEdge({ wallHp: 0 }, edge)).some(Boolean), false);
});

test('新地块节点独立切换阵营、开发图标和建筑，保留 prefab 布局', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    view.priceIcon.spriteFrame = { name: 'coin' };
    view.enemyDevelopFrame = { name: 'icon_em' };
    const configuredBarracksFrame = { name: 'configured-barracks' };
    view.setBuildingFrameResolver((_cardId: string | null, building: string) => building === 'barracks' ? configuredBarracksFrame : null);
    view.iconLabel.node.setPosition(10.404, -26.528, 0);
    const state = { owner: 'player', state: 'developable', building: 'none', cardId: null, tileType: ZCPvpTileType.Mine, developmentCost: 25, developmentResolved: false, hp: 0, maxHp: 0, tier: 1 };
    const render = (canDevelop = true, playerGold = 999) => view.render({ state, canDevelop, playerGold, cooldown: null });
    render();
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);
    assert.deepEqual([view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a], [126, 130, 255, 150]);
    assert.equal(view.iconSprite.spriteFrame, view.mineIconFrame);
    assert.equal(view.iconLabel.string, '25');
    assert.equal(view.priceIcon.enabled, true);
    assert.equal(view.buildingSprite.enabled, false);
    for (const type of ['barracks-common', 'barracks-medium', 'barracks-advanced']) {
        state.tileType = type; render();
        assert.equal(view.iconSprite.spriteFrame, view.barracksIconFrame);
    }
    state.tileType = ZCPvpTileType.AllRandom; render();
    assert.equal(view.iconSprite.spriteFrame, view.mysteryFrame);
    assert.equal(view.iconLabel.node.position.x, 10.404);
    assert.equal(view.iconLabel.node.position.y, -26.528);
    state.owner = 'enemy'; state.state = 'developable'; render(false);
    assert.equal(view.iconSprite.spriteFrame, view.enemyDevelopFrame);
    assert.equal(view.iconSprite.enabled, true);
    assert.equal(view.buildingLayer.active, true);
    assert.equal(view.priceIcon.enabled, false);
    assert.equal(view.iconLabel.enabled, false);
    state.state = 'occupied'; render(false);
    assert.equal(view.iconSprite.enabled, false);
    assert.equal(view.buildingLayer.active, false);
    state.state = 'developed'; state.building = 'barracks'; render(false);
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);
    assert.deepEqual([view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a], [251, 73, 105, 150]);
    assert.equal(view.buildingSprite.spriteFrame, configuredBarracksFrame);
    assert.equal(view.buildingSprite.enabled, true);
    assert.equal(view.buildingLayer.active, false);
    assert.equal(view.priceIcon.enabled, false);
    assert.equal(view.iconSprite.enabled, false);
    // 主城外观**只由注入的解析器给**（对局里是 `hq-base`），不再有「我方/敌方」两张通用图兜底：
    // 解析器给不出图时那一格留空，而不是显示另一套主城。
    const injectedHqFrame = { name: 'hq-base' };
    view.setBuildingFrameResolver((_cardId: string | null, building: string) => (
        building === 'barracks' ? configuredBarracksFrame
            : building === 'hq' ? injectedHqFrame : null));
    // ⚠️ 换了解析器但 `contentKey` 没变 ⇒ `render` 会短路不重绘。
    // `developmentResolved` 参与 contentKey（见 `contentSignature`），拿它逼一次重算。
    state.developmentResolved = !state.developmentResolved;
    state.owner = 'player'; state.building = 'hq'; render(false);
    assert.equal(view.buildingSprite.spriteFrame, injectedHqFrame);
    assert.equal(view.buildingSprite.enabled, true);
    // 解析器给不出图（未加载 / 桩是普通对象）时留空，不回退任何通用主城图。
    view.setBuildingFrameResolver((_cardId: string | null, building: string) => (
        building === 'barracks' ? configuredBarracksFrame : null));
    state.developmentResolved = !state.developmentResolved;
    render(false);
    assert.equal(view.buildingSprite.enabled, false);
    // 废墟走外观图（fx）：特效图保持原色，不叠阵营色。
    // ruinsFrame=null（资源缺失）时不再回退「废」字，整格留白。
    view.ruinsFrame = null;
    state.state = 'ruins'; render(false);
    assert.equal(view.buildingSprite.enabled, false);
    assert.equal(view.iconLabel.enabled, false);
    assert.equal(view.iconLabel.string, '');
    view.ruinsFrame = { name: 'ruinsFrame' };
    // developmentResolved 只参与 contentKey，改它逼 render 重算（state 其余字段与断言无关）。
    state.developmentResolved = true;
    render(false);
    assert.equal(view.buildingSprite.spriteFrame, view.ruinsFrame);
    assert.equal(view.buildingSprite.enabled, true);
    assert.equal(view.buildingSprite.color.g, 255);
    assert.equal(view.buildingLayer.active, false);
    assert.equal(view.iconLabel.string, '');
    state.owner = 'neutral'; state.state = 'developable'; state.building = 'none'; render(false);
    assert.equal(view.tileSprite.enabled, false,
        '中立格（不可开发）不做任何显示 —— 口径见 2026-10-16「中立没有任何显示」');
    assert.equal(view.iconLabel.string, '');
    assert.equal(view.buildingLayer.active, false);
    // 中立格被己方「建立」点亮后玩家就能买它：价格与地块图标照常显示（这是唯一的可点提示），
    // 面要染玩家色 60%，视觉上提示「这块地归你了，可以拿下」；模型上仍是中立，不给外框粗线。
    state.tileType = ZCPvpTileType.Mine; state.developmentCost = 25; render(true);
    assert.deepEqual([view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a], [126, 130, 255, 150], '我方可开发的中立格染玩家色 60%');
    assert.equal(view.iconSprite.spriteFrame, view.mineIconFrame);
    assert.equal(view.iconLabel.string, '25');
    assert.equal(view.priceIcon.enabled, true);
    assert.equal(view.buildingLayer.active, true);
    state.owner = 'player'; render();
    assert.equal(view.tileSprite.color.a, 150);
    assert.equal(view.priceIcon.enabled, true);
    state.developmentCost = 250; render();
    assert.equal(view.iconLabel.string, '250');
    assert.equal(view.iconLabel.color.g, 255);
    // 价格标红只看金币够不够，和价格高低无关。
    render(true, 249);
    assert.equal(view.iconLabel.color.r, 255);
    assert.equal(view.iconLabel.color.g, 91);
    render(true, 250);
    assert.equal(view.iconLabel.color.g, 255);
    state.developmentCost = 25; render(true, 0);
    assert.equal(view.iconLabel.color.g, 91);
    // 废墟格走图不出字：图保持原色（不叠敌方红），字层白字不吃金币判定。
    state.owner = 'enemy'; state.state = 'ruins'; render(false, 0);
    assert.equal(view.buildingSprite.spriteFrame, view.ruinsFrame);
    assert.equal(view.buildingSprite.color.g, 255);
    assert.equal(view.iconLabel.string, '');
    assert.equal(view.iconLabel.color.g, 255);
});

test('ZCGameHex 使用 hex_flat 扁平底图，TerritoryOutline 的 Graphics 由 prefab 预挂并绑定', () => {
    const data = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8'));
    const root = data[1];
    const view = data[root._components.at(-1).__id__];
    const nodeOf = (key: string) => data[data[view[key].__id__].node.__id__];
    assert.equal(nodeOf('buildingSprite')._name, 'BuildingIcon');
    assert.equal(nodeOf('buildingSprite')._parent.__id__, 1);
    assert.equal(nodeOf('iconSprite')._parent.__id__, view.buildingLayer.__id__);
    const tileNode = nodeOf('tileSprite');
    const outline = data.find((item: any) => item.__type__ === 'cc.Node' && item._name === 'TerritoryOutline');
    const outlineCompTypes = outline._components.map((ref: any) => data[ref.__id__].__type__ as string);
    const sizeOf = (node: any) => data[node._components.map((ref: any) => ref.__id__).find((id: number) => data[id].__type__ === 'cc.UITransform')]._contentSize;
    // 地块图 2026-10-14 换成**扁平纯白蒙版** `hex_flat`（同画布 130×119 / 面 123×90，去掉立体侧壁与明暗）。
    // TileBackground 的 CUSTOM 尺寸必须等于整图，否则图会被非等比拉伸。
    // 根节点与 TerritoryOutline 仍按整图 128×128（点击热区 / 描边画布）。
    assert.deepEqual([sizeOf(tileNode).width, sizeOf(tileNode).height], [130, 119]);
    assert.deepEqual([sizeOf(root).width, sizeOf(root).height], [128, 128]);
    assert.deepEqual([sizeOf(outline).width, sizeOf(outline).height], [128, 128]);
    // 轮廓线由 TerritoryOutline 上**预挂并绑定**的 Graphics 逐边画。
    // 2026-09-30：原来是运行时 `getComponent(Graphics) ?? addComponent(Graphics)` —— 组件引用一律走
    // Inspector 绑定（`outlineGraphics`），代码不再拼结构；同时删掉了那个永远取不到的 Sprite 兜底
    // （prefab 上本来就只有 UITransform，`fullOutline` 恒为 null）。
    const outlineComp = data[view.outlineGraphics.__id__];
    assert.equal(outlineComp.__type__, 'cc.Graphics');
    assert.equal(data[outlineComp.node.__id__], outline, 'outlineGraphics 必须指向 TerritoryOutline 自己身上的 Graphics');
    assert.ok(outlineCompTypes.includes('cc.Graphics'), 'TerritoryOutline 必须预挂 Graphics');
    // 也不能预挂完整六边形 Sprite：Sprite 与 Graphics 同为渲染组件，引擎直接报
    // 「Can't add renderable component... already have one」；而且那张地块图还会画出
    // 同阵营地块之间的内部重复边。
    assert.ok(!outlineCompTypes.includes('cc.Sprite'), 'TerritoryOutline 不能预挂完整六边形 Sprite（与 Graphics 同为渲染组件）');
    for (const [key, name] of Object.entries({ tileFrame: 'hex_flat', mineIconFrame: 'icon_jk', barracksIconFrame: 'icon_by', mysteryFrame: 'icon_wh', ruinsFrame: 'fx' })) {
        const meta = JSON.parse(readFileSync(`assets/resources/image/buildings/${name}.png.meta`, 'utf8'));
        assert.equal(view[key].__uuid__, meta.subMetas.f9941.uuid, key);
    }
    // 主城外观统一由 `buildingFrameResolver` 提供（对局与选点阶段同源，都是 `hq-base`）；
    // 旧的「我方 icon_ymp / 敌方 icon_m」两张通用图已下线 —— prefab 上不许再有这两个字段。
    assert.equal(view.playerHqFrame, undefined, 'ZCHexView 不该再有 playerHqFrame');
    assert.equal(view.enemyHqFrame, undefined, 'ZCHexView 不该再有 enemyHqFrame');
    assert.ok(!readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8').includes('2ef681ff-cd7e-4e50-b7ae-6a2d21ae18e5'),
        'ZCGameHex.prefab 不该再引用 icon_ymp');
    assert.ok(!readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8').includes('24b4f17f-6ddd-46b3-af9b-8a10fe9d6101'),
        'ZCGameHex.prefab 不该再引用 icon_m');
});

test('单位血条按兵种尺寸摆到头顶之上，填充左侧对齐，没挨打不显示、死亡隐藏、重用可恢复', () => {
    const { load, bar } = loadViews();
    const view = stubUnitView(load, bar);
    const unit = { hp: 100, maxHp: 100, battleState: 'idle' };
    const definition = { hero: true };
    // 满血静置：第一次渲染只记基线，不该把「满血」当成「刚被打」而亮出血条。
    view.render({ unit, definition, x: 0, y: 0, now: 0 });
    assert.equal(view.healthBar.node.active, false);
    // 挨一下（100 → 60）才点亮。
    unit.hp = 60;
    view.render({ unit, definition, x: 0, y: 0, now: 0.1 });
    assert.equal(view.healthBar.node.active, true);
    // 外框（槽）与填充是两套尺寸：外框 86×17，填充窄一圈（左右各内缩 4）且只有 8 高。
    const heroFillWidth = view.barWidthHero - view.barFillInset * 2;
    assert.equal(view.healthBar.totalLength, heroFillWidth);
    assert.equal(view.healthBar.barSprite.node.position.x, -view.barWidthHero / 2 + view.barFillInset);
    assert.equal(view.healthBar.node.position.y, view.barOffsetY);
    assert.deepEqual(view.healthBar.node.size, { width: view.barWidthHero, height: view.barHeight });
    // 填充条高度必须自己写进去：ProgressBar 只按 progress 改宽度，高度沿用填充条当时的 contentSize。
    assert.deepEqual(view.healthBar.barSprite.node.size, { width: heroFillWidth, height: view.barFillHeight });
    unit.battleState = 'dead';
    view.render({ unit, definition, x: 0, y: 0, now: 0.2 });
    assert.equal(view.healthBar.node.active, false);
    unit.battleState = 'idle'; definition.hero = false;
    view.render({ unit, definition, x: 0, y: 0, now: 0.3 });
    assert.equal(view.healthBar.node.active, true);
    const unitFillWidth = view.barWidth - view.barFillInset * 2;
    assert.equal(view.healthBar.totalLength, unitFillWidth);
    assert.equal(view.healthBar.barSprite.node.position.x, -view.barWidth / 2 + view.barFillInset);
});

test('血条只在被攻击后显示，3 秒无伤害自动隐藏', () => {
    const { isHealthBarVisible, HEALTH_BAR_VISIBLE_SECONDS } = loadViews().load('./ZCGameViewUtil');
    assert.equal(HEALTH_BAR_VISIBLE_SECONDS, 3);
    // 「从没挨过打」必须是独立状态：折成「0 秒前刚挨打」会让开局前 3 秒满屏血条。
    assert.equal(isHealthBarVisible(null, 0), false);
    assert.equal(isHealthBarVisible(null, 1.5), false);
    assert.equal(isHealthBarVisible(null, 99), false);
    assert.equal(isHealthBarVisible(10, 10), true);
    assert.equal(isHealthBarVisible(10, 12.99), true);
    assert.equal(isHealthBarVisible(10, 13), false, '窗口是左闭右开：满 3 秒即隐藏');
    assert.equal(isHealthBarVisible(10, 20), false);
    // 表现时间缺失（旧调用点 / 坏时钟）时一律隐藏，不能退化成常显。
    assert.equal(isHealthBarVisible(10, NaN), false);
    assert.equal(isHealthBarVisible(10, undefined as unknown as number), false);
});

test('地块血条：城墙挨打显示城墙耐久，墙破后跟随建筑，3 秒无伤害隐藏', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const state: Record<string, unknown> = {
        owner: 'player', state: 'developed', building: 'mine', developmentResolved: true,
        tier: 1, hp: 500, maxHp: 500, wallHp: 100, wallMaxHp: 100,
    };
    const render = (now: number) => view.render({ state, cooldown: null, canDevelop: false, playerGold: 0, now } as any);
    // 满耐久：没挨过打，血条不出现（每个已开发地块都带满耐久城墙，常显会糊满棋盘）。
    render(0);
    assert.equal(view.healthBar.node.active, false);
    // 城墙挨一刀：血条出来，读的是城墙耐久而不是建筑耐久。
    state.wallHp = 60;
    render(1);
    assert.equal(view.healthBar.node.active, true);
    assert.equal(view.healthBar.progress, 0.6);
    // 窗口内继续显示，最后一刀之后满 3 秒熄灭。
    render(3.9);
    assert.equal(view.healthBar.node.active, true);
    render(4);
    assert.equal(view.healthBar.node.active, false);
    // 墙被击破（wallHp 归零）→ 血条改为跟随建筑耐久（墙破了建筑才打得到）。
    state.wallHp = 0;
    render(5);
    assert.equal(view.healthBar.node.active, true);
    assert.equal(view.healthBar.progress, 1);
    state.hp = 250;
    render(5.5);
    assert.equal(view.healthBar.node.active, true);
    assert.equal(view.healthBar.progress, 0.5);
    render(8.5);
    assert.equal(view.healthBar.node.active, false, '建筑也一样：3 秒无伤害就隐藏');
    // 没有任何血量的格子（城墙耐久字段缺失的旧存档 / 空地）永不显示。
    state.wallHp = 0; state.hp = 0; state.maxHp = 0;
    render(9);
    assert.equal(view.healthBar.node.active, false);
});

test('单位与地块的表现时间取自模型时钟，血条窗口才按真实时间过期', () => {
    const { load } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
    let seen: any;
    world.unitEntityBySource.set(7, 1);
    world.unitViews.set(1, { render: (value: unknown) => { seen = value; } });
    const unit = {
        id: 7, hp: 10, maxHp: 100, sourceHexId: 0, targetHexId: null,
        progress: 0, marchAngle: null, freeX: 0, freeY: 0,
    };
    const model = {
        snapshot: { elapsedSeconds: 12, pendingSeconds: 0.25, status: 'playing' },
        definitionForUnit: () => ({}),
    };
    world.renderUnitEntity(unit, model);
    assert.equal(seen.now, 12.25, 'now 必须是 elapsedSeconds + pendingSeconds');
});

test('血条填充宽度只由 totalLength × progress 决定，血量没变的帧不会把扣掉的血抹回满条', () => {
    // 回归守卫：真实引擎 ProgressBar 有两个陷阱 ——
    //   ① totalLength / progress 的 setter 在「值没变」时直接 return，不重算；
    //   ② 重算时 宽度 = totalLength × progress，高度取填充条**当时**的 contentSize。
    // 老代码每次 render 都先把填充条 contentSize 写回 (width, height)（本意只想同步高度），
    // 于是血量没变的帧里宽度先被抹成满条、紧接着 progress 又早退不重算 →
    // 表现就是「小兵挨一下血条先短一下（低血还带红），下一帧又变回满血」。
    // loadViews 里那个哑 bar() 没有 ①② 语义，锁不住这个 bug，所以这里按引擎语义造一个假的。
    const { load, FakeNode, bar } = loadViews();
    const engineBar = () => {
        const sprite = new FakeNode('Bar');
        const node = new FakeNode('HealthBar');
        const fill = { width: 68, height: 8 }; // 填充条「当前」contentSize（外框 76，左右各内缩 4）
        const bar: any = {
            node,
            _totalLength: 68, // 与 prefab 一致
            _progress: 1,
            barSprite: { node: sprite, color: null },
            refresh() { fill.width = bar._totalLength * bar._progress; },
        };
        Object.defineProperty(bar, 'totalLength', {
            get: () => bar._totalLength,
            set: (value: number) => { if (bar._totalLength === value) return; bar._totalLength = value; bar.refresh(); },
        });
        Object.defineProperty(bar, 'progress', {
            get: () => bar._progress,
            set: (value: number) => { if (bar._progress === value) return; bar._progress = value; bar.refresh(); },
        });
        // 覆盖 FakeNode 的默认桩：任何对填充条 contentSize 的写入都反映到 fill 上。
        sprite.getComponent = () => ({ setContentSize: (w: number, h: number) => { fill.width = w; fill.height = h; } });
        return { bar, fill };
    };

    const view = stubUnitView(load, bar);
    const fixture = engineBar();
    view.healthBar = fixture.bar;
    const unit = { hp: 100, maxHp: 100, battleState: 'idle' };
    const definition = { hero: false };
    const render = () => view.render({ unit, definition, x: 0, y: 0 });

    const fillWidth = view.barWidth - view.barFillInset * 2; // 满血填充宽（外框左右各内缩 4）
    render();
    assert.equal(fixture.bar.totalLength, fillWidth);
    assert.equal(fixture.fill.width, fillWidth);
    assert.equal(fixture.fill.height, view.barFillHeight);
    // 挨一下：填充宽度按比例缩短
    unit.hp = 40;
    render();
    assert.equal(fixture.fill.width, fillWidth * 0.4);
    // 关键：血量不变的后续帧（0.15s 一次，一直刷）不许把宽度写回满条
    render();
    render();
    assert.equal(fixture.fill.width, fillWidth * 0.4);
    assert.equal(fixture.fill.height, view.barFillHeight);
});

test('兵种视觉 prefab 关闭 Sprite 裁剪模式，画布统一 256 使各兵种同比例、共用同一血条偏移', () => {
    // 扫整个 units 目录，**不写死名单**：兵种会增删（2026-09-30 有 5 个换成 spine 后删了目录），
    // 硬编码名单在删目录时只会抛 ENOENT —— 而这条用例真正要守的是「渲染比例统一」。
    // 只认「有同名 prefab + 有 atlas 目录」的序列帧单位（`projectiles` 这类目录自然被排除）。
    const unitsRoot = 'assets/resources/units';
    const units = readdirSync(unitsRoot).filter((name) =>
        existsSync(`${unitsRoot}/${name}/${name}.prefab`) && existsSync(`${unitsRoot}/${name}/atlas`));
    assert.ok(units.length > 0, '至少要扫到一个序列帧兵种');
    const canvasSizes = new Set<string>();
    for (const unit of units) {
        const dir = `${unitsRoot}/${unit}`;
        const data = JSON.parse(readFileSync(`${dir}/${unit}.prefab`, 'utf8'));
        const rootNode = data.find((o: any) => o.__type__ === 'cc.Node' && o._parent === null);
        const comps = rootNode._components.map((r: any) => data[r.__id__]);
        const sprite = comps.find((c: any) => c.__type__ === 'cc.Sprite');
        // 开着裁剪模式时 Sprite 会把「每一帧自己的裁剪框」拉伸铺满节点尺寸：
        // 民兵（裁剪框 193×180）渲染 98×98，亡灵法师（未裁剪）只有 56×69，
        // 且攻击帧裁剪框 188→240 会让角色横向被压扁 —— 血条偏移不可能同时对上。
        assert.equal(sprite._isTrimmedMode, false, unit);
        for (const file of readdirSync(`${dir}/atlas`).filter((n) => n.endsWith('.png.meta'))) {
            const meta = JSON.parse(readFileSync(`${dir}/atlas/${file}`, 'utf8'));
            const sf = (Object.values(meta.subMetas) as any[]).find((s) => s.importer === 'sprite-frame')!;
            canvasSizes.add(`${sf.userData.rawWidth}x${sf.userData.rawHeight}`);
        }
    }
    // 裁剪关闭后渲染比例只由画布尺寸决定，所以必须全项目统一，否则又得给每个兵种单独配偏移。
    assert.deepEqual([...canvasSizes], ['256x256']);
});

test('RunAwayPlayerItem 刷新两列统计，处理零上限并在复用时清空旧头像', () => {
    const { load, bar } = loadViews();
    const view = new (load('./RunAwayPlayerItem').RunAwayPlayerItem)();
    view.avatar = { spriteFrame: {} };
    view.nameLabel = { string: '' };
    view.damageLabel = { string: '' }; view.damageTakenLabel = { string: '' };
    view.damageProgress = bar(); view.damageTakenProgress = bar();
    view.refresh({ name: '主公', headSpriteFrame: null, damage: 120.5, damageTaken: 30, maxDamage: 240, maxDamageTaken: 0 });
    assert.equal(view.avatar.spriteFrame, null);
    assert.equal(view.damageLabel.string, '120');
    assert.equal(view.damageProgress.progress, .5);
    assert.equal(view.damageTakenProgress.progress, 0);
    view.clear();
    assert.equal(view.nameLabel.string, '');
    assert.equal(view.damageTakenLabel.string, '0');
    assert.equal(view.damageProgress.progress, 0);
});

test('两份 HealthBar 预制体为横向进度条，建筑内置径向 Cooldown，无独立冷却资源', () => {
    const read = (name: string) => JSON.parse(readFileSync(`assets/resources/ui/game/${name}.prefab`, 'utf8'));
    for (const name of ['ZCGameHex', 'ZCGameUnit']) {
        const data = read(name);
        const nodes = data.filter((o: any) => o.__type__ === 'cc.Node' && o._name === 'HealthBar');
        assert.equal(nodes.length, 1);
        const components = nodes[0]._components.map((r: any) => data[r.__id__]);
        assert.ok(!components.some((c: any) => c.__type__ === 'cc.Graphics'));
        const health = components.find((c: any) => c.__type__ === 'cc.ProgressBar');
        assert.equal(health._mode, 0);
        assert.equal(data[health._barSprite.__id__].__type__, 'cc.Sprite');
        const view = data[data[1]._components.at(-1).__id__];
        assert.equal(data[view.healthBar.__id__], health);
        if (name === 'ZCGameHex') {
            const cooldown = data[view.cooldownBar.__id__];
            assert.equal(cooldown._mode, 2);
            assert.equal(cooldown._totalLength, 1);
            const fill = data[cooldown._barSprite.__id__];
            assert.equal(fill._type, 3);
            assert.equal(fill._fillType, 2);
            assert.deepEqual(fill._fillCenter, { __type__: 'cc.Vec2', x: .5, y: .5 });
        } else assert.ok(!data.some((o: any) => o._name === 'Cooldown'));
    }
    assert.equal(existsSync('assets/resources/ui/game/ZCGameCooldown.prefab'), false);
    const players = read('RunAwayPlayerItem');
    const view = players[players[1]._components.at(-1).__id__];
    for (const key of ['avatarFrame', 'avatar', 'nameLabel', 'damageProgress', 'damageTakenProgress', 'damageLabel', 'damageTakenLabel']) assert.ok(players[view[key].__id__], key);
});


test('结算扫场整行同亮：贴着胜利方的行先整行亮起，再推下一行', () => {
    const { load } = loadViews();
    const {
        buildVictorySweepPlan, victorySweepDuration, victorySweepLitStep, ZC_VICTORY_SWEEP_STEP_SECONDS,
    } = load('./ZCGameViewUtil');
    const map = ZC_HEX_CONFIG;
    const playable = map.filter((hex) => hex.playable);
    const minRow = Math.min(...playable.map((hex) => hex.row));
    const maxRow = Math.max(...playable.map((hex) => hex.row));
    const rowSpan = maxRow - minRow + 1;
    assert.ok(rowSpan >= 4, '夹具行数太少，验不出分行');
    // 方向口径（2026-10-15 row8）：**我方从下往上**（`maxRow - row`）、
    // **其他玩家从上往下**（`row - minRow`）——判据是 `winner === 'player'`，不是旧版的 `=== 'enemy'`。
    const layerOf = (hex: { row: number }, winner: string): number =>
        (winner === 'player' ? maxRow - hex.row : hex.row - minRow);

    const ours = buildVictorySweepPlan(map, 'player');
    assert.equal(ours.stepCount, rowSpan, 'stepCount = 行数');
    const stepValues = new Set(ours.steps.values());
    assert.equal(stepValues.size, rowSpan, '每个行一个步号');
    for (let row = minRow; row <= maxRow; row += 1) {
        const line = playable.filter((hex) => hex.row === row);
        if (!line.length) continue;
        const steps = line.map((hex) => ours.steps.get(hex.id)!);
        assert.equal(new Set(steps).size, 1, `第 ${row} 行没有整行同亮`);
    }
    let previousMax = -1;
    for (let layer = 0; layer < rowSpan; layer += 1) {
        const line = playable.filter((hex) => layerOf(hex, 'player') === layer);
        if (!line.length) continue;
        const step = ours.steps.get(line[0].id)!;
        assert.ok(step > previousMax, `第 ${layer} 行与上一行步号交叠`);
        previousMax = step;
    }
    const firstOurs = playable.find((hex) => ours.steps.get(hex.id) === 0)!;
    assert.equal(firstOurs.row, maxRow, '起手行不在最下面一行');

    const theirs = buildVictorySweepPlan(map, 'enemy');
    assert.equal(theirs.stepCount, rowSpan);
    for (const hex of playable) {
        assert.equal(layerOf(hex, 'player') + layerOf(hex, 'enemy'), rowSpan - 1, `hex ${hex.id}`);
    }
    const firstTheirs = playable.find((hex) => theirs.steps.get(hex.id) === 0)!;
    assert.equal(firstTheirs.row, minRow, '敌方胜的起手行不在最上面一行');

    // 🔴 row8：「**其他玩家**从最上方的格子往下填充」——3 / 4 号席也得从最上面那行起，
    // 旧写法（`winner === 'enemy'`）会把它们误判成我方、从下往上推。
    for (const other of ['enemy2', 'enemy3'] as const) {
        const plan = buildVictorySweepPlan(map, other);
        const first = playable.find((hex) => plan.steps.get(hex.id) === 0)!;
        assert.equal(first.row, minRow, `${other} 的起手行不在最上面一行`);
        for (const hex of playable) {
            assert.equal(plan.steps.get(hex.id), theirs.steps.get(hex.id), `${other} 与 enemy 的步号应完全一致`);
        }
    }

    const voids = map.filter((hex) => !hex.playable);
    assert.ok(voids.every((hex) => !ours.steps.has(hex.id)));
    assert.equal(buildVictorySweepPlan([], 'player').stepCount, 0);
    assert.equal(victorySweepLitStep(0, 0), -1);

    let previous = -1;
    const marks = [0, ZC_VICTORY_SWEEP_STEP_SECONDS, ZC_VICTORY_SWEEP_STEP_SECONDS * 3.5, victorySweepDuration(ours.stepCount)];
    for (const elapsed of marks) {
        const lit = victorySweepLitStep(elapsed, ours.stepCount);
        assert.ok(lit >= previous, `elapsed=${elapsed} 点亮步号倒退：${previous} → ${lit}`);
        previous = lit;
    }
    assert.equal(victorySweepLitStep(0, ours.stepCount), 0);
    assert.equal(victorySweepLitStep(victorySweepDuration(ours.stepCount), ours.stepCount), ours.stepCount - 1);
    assert.equal(victorySweepLitStep(ZC_VICTORY_SWEEP_STEP_SECONDS * 0.99, ours.stepCount), 0);
    assert.equal(victorySweepLitStep(ZC_VICTORY_SWEEP_STEP_SECONDS * 1.01, ours.stepCount), 1);
});

test('结算扫场铺深饱和阵营色、回正到当前色，收起覆盖后立刻回到真实归属', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const state = { owner: 'enemy', state: 'developed', building: 'none', tileType: ZCPvpTileType.Mine, developmentCost: 25, developmentResolved: false, hp: 0, maxHp: 0, tier: 1 };
    const render = () => view.render({ state, canDevelop: false, playerGold: 0, cooldown: null });
    const rgb = (): number[] => [
        view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a,
    ];

    render();
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);

    // 我方的扫场扫到这一格：底图与选框都换成我方，且**刚铺上时是深饱和色**（row8
    //「用和阵营颜色一致，但饱和度更深的颜色填充格子」）—— #7e82ff → #6a70e6。
    // ⚠️ 2026-10-16 追加需求「铺场动画的颜色要偏亮」把压暗比例从 0.78 提到 0.9
    //（`ZC_DEEP_DARKEN`），所以这一组数字是**当前档位下的定值**，改档位就得同步改这里。
    view.setSweepOwner('player'); render();
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);
    assert.deepEqual(rgb(), [106, 112, 230, 150], '刚铺上应是深饱和的我方色');

    // 回正到 1：回到阵营**当前色**（与常规渲染逐位同值 ⇒ 摘覆盖不跳色）。
    view.setSweepOwner('player', 1); render();
    assert.deepEqual(rgb(), [126, 130, 255, 150], '回正完应是阵营当前色');
    // 回正到一半：两端之间的线性中值（不是任一端）。
    view.setSweepOwner('player', 0.5); render();
    assert.deepEqual(rgb(), [116, 121, 243, 150], '回正中应是两端线性插值');

    // 中立格：不做任何显示（2026-10-16 口径：alpha 0 ⇒ Sprite 停用）；
    // 被结算扫过就该给上阵营色（同样是深饱和版：#fb4969 → #e62b54）。
    view.setSweepOwner(null);
    state.owner = 'neutral'; state.state = 'occupiable';
    render();
    assert.equal(view.tileSprite.enabled, false, '中立格不做任何显示（2026-10-16 起）');
    view.setSweepOwner('enemy'); render();
    assert.deepEqual(rgb(), [230, 43, 84, 150]);
    view.setSweepOwner('enemy', 1); render();
    assert.deepEqual(rgb(), [251, 73, 105, 150]);
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);

    // 废墟格平时叠灰调；扫过之后要回到胜利方色系，否则"归了自己"的格子还带灰。
    view.setSweepOwner(null);
    state.owner = 'player'; state.state = 'ruins'; state.developmentResolved = true;
    render();
    assert.ok(view.tileSprite.color.r < 200, `废墟格应叠灰调，实际 r=${view.tileSprite.color.r}`);
    view.setSweepOwner('player'); render();
    assert.equal(view.tileSprite.color.r, 106);
    assert.equal(view.tileSprite.color.g, 112);
    view.setSweepOwner('player', 1); render();
    assert.equal(view.tileSprite.color.r, 126);
    assert.equal(view.tileSprite.color.g, 130);

    // 收起覆盖（重开一局 / 退出对局）：立刻回到模型里的真实归属，不留上一局的颜色。
    view.setSweepOwner(null); render();
    assert.equal(view.tileSprite.spriteFrame, view.tileFrame);
    assert.ok(view.tileSprite.color.r < 200, '收起覆盖后废墟格应恢复灰调');
});

test('结算扫场是「先铺深色、再回正」：铺过 2 行即起跑，混合比单调不减', () => {
    const { load } = loadViews();
    const {
        buildVictorySweepPlan, victorySweepDuration, victorySweepFillSeconds,
        victorySweepLitStep, victorySweepRevertCursor, victorySweepRevertMix,
        victorySweepRevertStartSeconds, ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS,
        victorySweepRevertEndSeconds,
        ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS, ZC_VICTORY_SWEEP_STEP_SECONDS,
    } = load('./ZCGameViewUtil');
    const plan = buildVictorySweepPlan(ZC_HEX_CONFIG, 'player');
    const stepCount = plan.stepCount;
    assert.ok(stepCount >= 4, '夹具行数太少');
    const fill = victorySweepFillSeconds(stepCount);
    const revertStart = victorySweepRevertStartSeconds(stepCount);

    // ① 回正在**刚铺过两行**时就起跑。需求两轮演进（都在 row8）：
    //    2026-10-16 第一轮「播了 3、4 行格子时马上播放回正动画」⇒ 取 3；
    //    第二轮「铺场动画播了 **1~3 行**，就播放回正动画」⇒ **取 2**，落在需求区间中间。
    assert.equal(ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS, 2, '起跑时机按行数给，取 2');
    assert.ok(ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS > 0, '必须真的提前');
    assert.ok(revertStart > 0, '不能从第 0 帧就开始回正（那会整盘一起回正）');
    // 🔴 起跑时刻**与整盘行数无关**：恰好是 LEAD_ROWS 个填充步。
    assert.ok(Math.abs(revertStart - ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS * ZC_VICTORY_SWEEP_STEP_SECONDS) < 1e-9,
        `起跑时刻应 = ${ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS} × 填充步长，实际 ${revertStart}`);
    assert.ok(revertStart < fill, '回正不能等到铺满才开始');
    // 起跑那一瞬屏幕上已经铺出 `LEAD_ROWS ~ LEAD_ROWS+1` 行 —— 区间下界留给浮点
    // （`LEAD_ROWS × STEP / STEP` 可能算出 2.9999999999999996，`floor` 就少一行）。
    const litAtStart = victorySweepLitStep(revertStart, stepCount);
    assert.ok(litAtStart >= ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS
        && litAtStart <= ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS + 1,
        `起跑时应已铺 ${ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS}~${ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS + 1} 行，实际 step=${litAtStart}`);
    assert.ok(victorySweepRevertCursor(revertStart - 1e-6, stepCount) < 0, '回正起点之前不该已经开始回正');
    assert.equal(victorySweepRevertCursor(revertStart, stepCount), 0);

    // ①' 行数比 LEAD_ROWS 还少的盘退化成「铺满即起跑」，不会算出负的起跑时刻。
    for (const tiny of [1, 2]) {
        assert.equal(victorySweepRevertStartSeconds(tiny), victorySweepFillSeconds(tiny),
            `${tiny} 行的盘应退化成铺满即起跑`);
        assert.ok(victorySweepRevertStartSeconds(tiny) >= 0);
    }

    // ② 起手没回正（整盘都是深色），回正段收手时整盘已回正（游标 = 行数）。
    assert.equal(victorySweepRevertCursor(0, stepCount), -1);
    // ⚠️ 这里必须用 `victorySweepRevertEndSeconds` 而不是 `victorySweepDuration`：
    // 后者 2026-10-16 起**含线条脉冲段**，拿它当"回正收手时刻"会多等一整段脉冲。
    // ⚠️ 也不能写 `=== stepCount`：收手时刻是 `起点 + 行数 × 步长` 累加出来的，浮点会落在
    // 19.999999999999996 这种地方（旧参数下恰好整除只是运气）。
    const revertEndCursor = victorySweepRevertCursor(victorySweepRevertEndSeconds(stepCount), stepCount);
    assert.ok(Math.abs(revertEndCursor - stepCount) < 1e-9,
        `回正收手时游标应 = 行数 ${stepCount}，实际 ${revertEndCursor}`);
    assert.ok(victorySweepDuration(stepCount) > victorySweepRevertEndSeconds(stepCount),
        '整段总长必须比回正收手时刻长（后面还有脉冲段）');
    const midCursor = victorySweepRevertCursor(revertStart + ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS * 2.5, stepCount);
    assert.ok(Math.abs(midCursor - 2.5) < 1e-9, '游标 = 已回正行数 + 行内过渡比例');

    // ③ 中间恒定留一条「深色带」：填到第 n 行时，游标恰好落后 LEAD_ROWS 行
    //    （两段同速 ⇒ 带子不会被追上、也不会越拉越宽）。
    //    ⚠️ 填充步是 `floor` 出来的整数、游标是连续的，所以差落在 `(LEAD_ROWS - 1, LEAD_ROWS]`
    //    这半开区间里 —— 写死等号只在 `elapsed / STEP` 恰好是整数时成立（浮点一抖就差 1）。
    for (const step of [1, 5, 12]) {
        const elapsed = revertStart + ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS * step;
        const band = victorySweepLitStep(elapsed, stepCount)
            - victorySweepRevertCursor(elapsed, stepCount);
        assert.ok(band > ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS - 1 - 1e-9
            && band <= ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS + 1e-9,
            `第 ${step} 步时深色带应恒为 ${ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS} 行上下，实际 ${band}`);
    }

    // ④ 混合比随游标单调不减；没轮到的行恒 0，推过的行恒 1，正推的那一行取小数位。
    const at = (cursor: number, step: number): number => victorySweepRevertMix(cursor, step);
    assert.equal(at(-1, 0), 0, '回正没开始时整盘都是深色');
    assert.equal(at(0, 0), 0);
    assert.equal(at(2.5, 2), 0.5, '正推的那一行取行内比例');
    assert.equal(at(2.5, 1), 1, '推过的行已是当前色');
    assert.equal(at(2.5, 3), 0, '还没推到的行仍是深色');
    assert.equal(at(stepCount, stepCount - 1), 1, '收手时最后一行也回正了');
    let previous = -1;
    for (let elapsed = 0; elapsed <= victorySweepDuration(stepCount) + 0.5; elapsed += 0.02) {
        const cursor = victorySweepRevertCursor(elapsed, stepCount);
        const mixed = at(cursor, Math.max(0, stepCount - 1));
        assert.ok(mixed >= previous, `elapsed=${elapsed} 混合比倒退：${previous} → ${mixed}`);
        previous = mixed;
    }
    assert.equal(previous, 1, '整段播完后最后一行必须已经完全回正');

    // ⑤ 空盘 / 无行时两个函数都退化，不产出 NaN。
    assert.equal(victorySweepRevertCursor(0, 0), -1);
    assert.equal(victorySweepRevertMix(-1, 0), 0);
    assert.equal(victorySweepDuration(0), 0);
    assert.equal(victorySweepRevertEndSeconds(0), 0);
    assert.equal(victorySweepFillSeconds(0), 0);
    assert.equal(victorySweepRevertStartSeconds(0), 0);
});

test('★铺场闪烁：三角波在同色系偏白的一端快速来回，恒非负、相邻行错相位', () => {
    const { load } = loadViews();
    const {
        victorySweepShimmer, victorySweepShimmerTick,
        ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS, ZC_VICTORY_SWEEP_SHIMMER_MAX,
        ZC_VICTORY_SWEEP_SHIMMER_ROW_PHASE, ZC_VICTORY_SWEEP_SHIMMER_STEPS,
    } = load('./ZCGameViewUtil');

    // 档位常量本身要合理：比 60fps 慢一个量级（真的每帧换相位）、又比填充步长（0.06s/行）长，
    // 才不会和「铺过去」这件事混起来。
    assert.ok(ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS > 1 / 60, '周期不能短到肉眼看不见');
    assert.ok(ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS > 0.06, '周期要比一行的填充步长长');
    assert.ok(ZC_VICTORY_SWEEP_SHIMMER_MAX > 0 && ZC_VICTORY_SWEEP_SHIMMER_MAX <= 1, '偏白幅度要在 (0, 1]');
    assert.ok(ZC_VICTORY_SWEEP_SHIMMER_ROW_PHASE > 0, '相邻行必须错开相位，否则是整盘呼吸');

    const half = ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS / 2;

    // ① 起手是**纯深色**（不是先白一下）：三角波从 0 起跑。
    assert.equal(victorySweepShimmer(0, 0), 0, '起手不能先白一下');
    // ② 半周期到峰，整周期回 0。
    assert.ok(Math.abs(victorySweepShimmer(half, 0) - ZC_VICTORY_SWEEP_SHIMMER_MAX) < 1e-9,
        '半周期应到最白');
    assert.ok(Math.abs(victorySweepShimmer(ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS, 0)) < 1e-9,
        '一个整周期应回到纯深色');
    // ③ 整个周期内恒在 [0, MAX]，且**真的在动**（不是一条平线）。
    let sawLow = false;
    let sawHigh = false;
    for (let t = 0; t < ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS; t += ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS / 64) {
        const value = victorySweepShimmer(t, 0);
        assert.ok(value >= 0 && value <= ZC_VICTORY_SWEEP_SHIMMER_MAX + 1e-12,
            `t=${t} 越界：${value}`);
        if (value < ZC_VICTORY_SWEEP_SHIMMER_MAX * 0.1) sawLow = true;
        if (value > ZC_VICTORY_SWEEP_SHIMMER_MAX * 0.9) sawHigh = true;
    }
    assert.ok(sawLow && sawHigh, '一个周期内必须走遍「深 → 白 → 深」');
    // ④ 快速：一个周期内至少跨过 SHIMMER_STEPS 个相位档（档位是「要不要重画」的闸门）。
    let ticks = new Set<number>();
    for (let i = 0; i <= ZC_VICTORY_SWEEP_SHIMMER_STEPS; i += 1) {
        ticks.add(victorySweepShimmerTick(ZC_VICTORY_SWEEP_SHIMMER_CYCLE_SECONDS * i / ZC_VICTORY_SWEEP_SHIMMER_STEPS));
    }
    assert.ok(ticks.size >= ZC_VICTORY_SWEEP_SHIMMER_STEPS,
        `一个周期应跨过 ${ZC_VICTORY_SWEEP_SHIMMER_STEPS} 个相位档，实际 ${ticks.size}`);
    // ⑤ 相邻行错相位：同一时刻两行的取值不同（错开 1/3 周期）。
    assert.notEqual(victorySweepShimmer(half * 0.5, 0), victorySweepShimmer(half * 0.5, 1),
        '相邻两行同一时刻不该同值');
    assert.ok(Math.abs(victorySweepShimmer(half * 0.5, 0) - victorySweepShimmer(half * 0.5, 3)) < 1e-9,
        '隔 3 行相位正好转满一圈，取值应相同');
    // ⑥ 非法输入退化，不产出 NaN。
    assert.equal(victorySweepShimmer(-1, 0), 0);
    assert.equal(victorySweepShimmer(Number.NaN, 0), 0);
    assert.equal(victorySweepShimmerTick(0), 0);
    assert.equal(victorySweepShimmerTick(-1), 0);
});

test('★线条脉冲：回正收手后从起点再扫一遍，三角波带、档位量化、整段恰好归零', () => {
    const { load } = loadViews();
    const {
        buildVictorySweepPlan, victorySweepDuration, victorySweepRevertEndSeconds,
        victorySweepPulseSeconds, victorySweepPulseCursor, victorySweepPulseMix,
        victorySweepPulseLevel,
        ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS, ZC_VICTORY_SWEEP_PULSE_BAND_ROWS,
        ZC_VICTORY_SWEEP_PULSE_LEVELS,
    } = load('./ZCGameViewUtil');

    // 常量本身的合理性：波带必须窄（窄 = 共享层的桶数可控）、档位必须够少、速度必须比铺场快。
    assert.ok(ZC_VICTORY_SWEEP_PULSE_BAND_ROWS >= 1, '波带不能是 0 宽');
    assert.ok(ZC_VICTORY_SWEEP_PULSE_LEVELS >= 2, `档位太少（1 档）就没有"亮起来又暗下去"`);
    assert.ok(ZC_VICTORY_SWEEP_PULSE_LEVELS <= 8, `档位不能太多：共享轮廓层按同色同宽分桶，桶数会爆`);
    assert.ok(ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS > 0, '波前必须真的在动');

    // 用一张 20 行的盘当夹具（真地图的行数就在这个量级）。
    const plan = buildVictorySweepPlan(
        Array.from({ length: 20 }, (_, row) => ({ id: row + 1, row, x: 0, playable: true })), 'player');
    const stepCount = plan.stepCount;
    assert.equal(stepCount, 20);
    const start = victorySweepRevertEndSeconds(stepCount);
    const pulseSeconds = victorySweepPulseSeconds(stepCount);
    const end = victorySweepDuration(stepCount);

    // ① 起跑时刻**就是回正收手那一刻**（需求：「回正动画结束**再**增加」），两段不重叠。
    assert.ok(pulseSeconds > 0, '脉冲段必须有长度');
    assert.ok(Math.abs(end - start - pulseSeconds) < 1e-9, '总长 = 回正收手 + 脉冲段长');
    assert.equal(victorySweepPulseCursor(start - 1e-6, stepCount), -1, '回正还没收手时脉冲不该起跑');
    assert.equal(victorySweepPulseCursor(start, stepCount), 0, '起跑时波前正压在起点那一行（0 基）');

    // ② 起跑那一刻起点行**满亮**：这里判 `cursor >= 0` 而不是 `> 0` 的全部意义。
    assert.equal(victorySweepPulseMix(0, 0), 1, '起跑那一帧起点行必须满亮（写成 cursor > 0 会漏掉它）');
    assert.equal(victorySweepPulseLevel(victorySweepPulseMix(0, 0)), ZC_VICTORY_SWEEP_PULSE_LEVELS);

    // ③ 三角：峰在波前正压过那一行，两侧对称下降，出带（≥ BAND_ROWS）后恒 0。
    const centre = 7;
    assert.equal(victorySweepPulseMix(centre, centre), 1, '峰在波前压过的那一行');
    for (const offset of [0.25, 0.5, 0.75]) {
        const ahead = victorySweepPulseMix(centre + offset, centre);
        const behind = victorySweepPulseMix(centre - offset, centre);
        assert.ok(Math.abs(ahead - behind) < 1e-9, `波前两侧必须对称（offset=${offset}）`);
        assert.ok(ahead < 1 && ahead > 0, `带内取值应在 (0,1)，实际 ${ahead}`);
    }
    assert.equal(victorySweepPulseMix(centre + ZC_VICTORY_SWEEP_PULSE_BAND_ROWS, centre), 0,
        '刚好出带应是 0');
    assert.equal(victorySweepPulseMix(centre + ZC_VICTORY_SWEEP_PULSE_BAND_ROWS + 3, centre), 0,
        '远在带外必须是 0（否则整盘一起亮，就不是"一道波"了）');
    assert.equal(victorySweepPulseMix(-1, 0), 0, '脉冲没起跑时恒 0');

    // ④ 波带**窄**：任意时刻亮着的行数不超过 `2 × BAND_ROWS` 行
    //    （波前落在两行之间时两侧各占一行，所以上界是 2×BAND 而不是 BAND）。
    let maxLitRows = 0;
    for (let t = start; t <= end; t += ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS / 8) {
        const cursor = victorySweepPulseCursor(t, stepCount);
        let lit = 0;
        for (let step = 0; step < stepCount; step += 1) {
            if (victorySweepPulseMix(cursor, step) > 0) lit += 1;
        }
        maxLitRows = Math.max(maxLitRows, lit);
    }
    assert.ok(maxLitRows <= 2 * ZC_VICTORY_SWEEP_PULSE_BAND_ROWS,
        `同时在亮的行数应 ≤ ${2 * ZC_VICTORY_SWEEP_PULSE_BAND_ROWS}，实际 ${maxLitRows}`);

    // ⑤ 档位单调、有界、归零：`0` 强度必须是 `0` 档，满亮必须是最高档。
    assert.equal(victorySweepPulseLevel(0), 0, '强度 0 必须是不亮（否则整盘永远糊着一层亮线）');
    assert.equal(victorySweepPulseLevel(1), ZC_VICTORY_SWEEP_PULSE_LEVELS);
    assert.equal(victorySweepPulseLevel(1.5), ZC_VICTORY_SWEEP_PULSE_LEVELS, '超过 1 要夹住');
    let previousLevel = -1;
    for (let mix = 0; mix <= 1.0001; mix += 1 / 64) {
        const level = victorySweepPulseLevel(mix);
        assert.ok(level >= 0 && level <= ZC_VICTORY_SWEEP_PULSE_LEVELS, `档位越界：${level}`);
        assert.ok(level >= previousLevel, `档位必须随强度单调不减，${previousLevel} → ${level}`);
        previousLevel = level;
    }
    assert.equal(previousLevel, ZC_VICTORY_SWEEP_PULSE_LEVELS, '强度走到 1 必须到最高档');

    // ⑥ 🔴 **整段末尾必须恰好归零**：波前走到最后一行之外，所有行都出带。
    //    这是"最后一帧还要再刷一次轮廓"的原因 —— 少了那一帧，亮线会永久留在盘上。
    const finalCursor = victorySweepPulseCursor(end, stepCount);
    for (let step = 0; step < stepCount; step += 1) {
        assert.equal(victorySweepPulseMix(finalCursor, step), 0, `收手时第 ${step} 行不该还亮着`);
    }
    // 波前走出最后一行所需的那个距离，恰好是 `PULSE_BAND_ROWS`。
    assert.ok(Math.abs(finalCursor - (stepCount - 1 + ZC_VICTORY_SWEEP_PULSE_BAND_ROWS)) < 1e-9,
        `收手时波前应停在最后一行再过 ${ZC_VICTORY_SWEEP_PULSE_BAND_ROWS} 行处，实际 ${finalCursor}`);

    // ⑦ 退化：空盘不产出 NaN / 负数；单行盘（波前一步就出带）也不能是负长度。
    assert.equal(victorySweepPulseSeconds(0), 0);
    assert.equal(victorySweepPulseCursor(0, 0), -1);
    assert.equal(victorySweepDuration(0), 0);
    assert.ok(victorySweepPulseSeconds(1) > 0, '单行盘也得有一段脉冲（不能是 0 长）');
    assert.ok(victorySweepPulseSeconds(1) < victorySweepPulseSeconds(2), '行数越多脉冲段越长');
});

test('结算扫场整行推进、播完才收手，且不读模型的地块归属', () => {
    const { load, cc } = loadViews();
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld');
    const {
        buildVictorySweepPlan, ZC_VICTORY_SWEEP_STEP_SECONDS, ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS,
        ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS, victorySweepDuration, victorySweepRevertStartSeconds,
        victorySweepRevertCursor, victorySweepRevertEndSeconds, victorySweepPulseSeconds,
        victorySweepPulseCursor, victorySweepPulseLevel, victorySweepPulseMix,
        ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS, ZC_VICTORY_SWEEP_PULSE_BAND_ROWS,
        ZC_VICTORY_SWEEP_PULSE_LEVELS,
    } = load('./ZCGameViewUtil');
    // ⚠️ 这个 render world 默认**不初始化**（`outlineGraphics` 为 null ⇒ `redrawSharedOutline`
    // 一进来就 return），所以下面那段脉冲断言要先把共享轮廓层与 `mapLayer` 补上 ——
    // `redrawSharedOutline` 的探针会把棋盘缩放并进去，缺了 `mapLayer` 会直接抛。
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } } });
    world.outlineGraphics = new cc.Graphics();
    const map = ZC_HEX_CONFIG;
    const playable = map.filter((hex) => hex.playable);
    const minRow = Math.min(...playable.map((hex) => hex.row));
    const plan = buildVictorySweepPlan(map, 'player');
    const stepCount = plan.stepCount;
    const halfStep = Math.floor(stepCount / 3);
    assert.ok(halfStep >= 1, '夹具行数太少，验不出分行推进');
    assert.ok(halfStep > ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS,
        '半程要落在「头部已回正」的那一侧，才能同时验到两段');

    const painted = new Map<number, string | null>();
    const mixOf = new Map<number, number>();
    const shimmerOf = new Map<number, number>();
    for (const hex of playable) {
        world.hexEntityBySource.set(hex.id, hex.id);
        world.hexViews.set(hex.id, {
            setSweepOwner: (owner: string | null, mix = 0, shimmer = 0) => {
                painted.set(hex.id, owner);
                mixOf.set(hex.id, mix);
                shimmerOf.set(hex.id, shimmer);
            },
        });
    }
    const model = { snapshot: { hexes: [], elapsedSeconds: 0, status: 'victory', pendingSeconds: 0 } };
    const litIds = (): number[] => playable.filter((hex) => painted.get(hex.id) === 'player').map((hex) => hex.id);
    // 扫场是**累加式**推进（`elapsed += dt`），所以用例自己记进度、按绝对时刻推进 ——
    // 否则一旦回正起跑时刻前移，前后两次推进的差值就可能变成负数而被 `Math.max(0, dt)` 吃掉。
    let elapsed = 0;
    const advanceTo = (target: number): boolean => {
        assert.ok(target >= elapsed - 1e-9, `用例只能向前推进（${elapsed} → ${target}）`);
        const playing = world.advanceVictorySweep(model, target - elapsed);
        elapsed = target;
        return playing;
    };

    assert.equal(world.startVictorySweep(model, 'player'), true);
    assert.deepEqual(litIds(), []);
    // 第一次推进亮第一整行（同一步号的所有格）。
    advanceTo(0);
    const firstRowIds = playable.filter((hex) => plan.steps.get(hex.id) === 0).map((hex) => hex.id).sort((a, b) => a - b);
    assert.deepEqual(litIds().sort((a, b) => a - b), firstRowIds);
    assert.ok(firstRowIds.length > 1, '第一行应该有多格同时亮');
    // 最靠敌方那一行这会儿一格都还没动。
    assert.ok(playable.filter((hex) => hex.row === minRow).every((hex) => painted.get(hex.id) === null));

    // 推进到第 halfStep 步：亮起的正好是步号 ≤ halfStep 的那些行。
    advanceTo(ZC_VICTORY_SWEEP_STEP_SECONDS * halfStep);
    const expectedLit = playable
        .filter((hex) => plan.steps.get(hex.id)! <= halfStep)
        .map((hex) => hex.id)
        .sort((a, b) => a - b);
    assert.deepEqual(litIds().sort((a, b) => a - b), expectedLit);
    assert.ok(expectedLit.length < playable.length, '半程就全亮了，验不出"播完才收手"');
    // 🔴 两段同时在屏幕上：头部那几行已经回正，**尾部仍是纯深色**。
    // 这才是「回正往前移」没被写成「一口气全回正」的判据（旧口径下这句是「全都还是深色」）。
    assert.ok(litIds().every((id) => mixOf.get(id) === 0 || mixOf.get(id) === 1),
        '半程时每一行要么已回正、要么还是深色，没有中间态之外的第三种');
    const deepTail = litIds().filter((id) => mixOf.get(id) === 0);
    const revertedHead = litIds().filter((id) => mixOf.get(id) === 1);
    assert.ok(deepTail.length > 0, '尾部应还有未回正的深色行');
    assert.ok(revertedHead.length > 0, '头部应已经回正（回正真的提前起跑了）');
    assert.equal(deepTail.length + revertedHead.length, litIds().length,
        '每一行要么已回正、要么还是深色，不许漏行');
    // 🔴 边界必须对着**当时的游标**判，不能对着 `LEAD_ROWS`：
    // 半程那一刻游标 = `halfStep - LEAD_ROWS`，只在 `halfStep === 2 × LEAD_ROWS` 时才恰好
    // 等于 `LEAD_ROWS`（2026-10-16 取 2 行后夹具就不满足了）。写死 LEAD_ROWS 的旧断言
    // 是「旧参数下的巧合」，不是不变量。
    const cursorHere = victorySweepRevertCursor(
        ZC_VICTORY_SWEEP_STEP_SECONDS * halfStep, stepCount);
    assert.ok(Number.isInteger(cursorHere) && cursorHere >= 1,
        `半程游标应落在整数行上且已回正若干行，实际 ${cursorHere}`);
    assert.ok(revertedHead.every((id) => plan.steps.get(id)! < cursorHere),
        '已回正的行号必须都在游标之前');
    assert.ok(deepTail.every((id) => plan.steps.get(id)! >= cursorHere),
        '仍是深色的行号必须从游标那一行起');
    // 深色带宽度（**按行算**）：`[cursor, litStep]` 闭区间 = `LEAD_ROWS + 1` 行
    // （差值是半开区间 `(LEAD_ROWS - 1, LEAD_ROWS]`，整数行数要多 1 —— 别把两者混了）。
    const deepRows = new Set(deepTail.map((id) => plan.steps.get(id)!));
    assert.equal(deepRows.size, ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS + 1,
        `深色带应恒为 ${ZC_VICTORY_SWEEP_REVERT_LEAD_ROWS + 1} 行，实际 ${deepRows.size}`);
    const revertedRows = new Set(revertedHead.map((id) => plan.steps.get(id)!));
    assert.equal(revertedRows.size, cursorHere, '已回正的行数应等于游标的整数部分');

    // 闪烁在铺场段已经开着（只在回正包里？不：`mix = 1` 的格子闪烁已不参与配色，
    // 但视图拿到的仍是同一个值 —— 真正「闪不闪」由 `sweepFill` 的权重决定，见视图用例）。
    assert.ok(litIds().every((id) => (shimmerOf.get(id) ?? 0) >= 0));

    // 重开一趟，直接推进到「回正起点 + 两步」，逐行核对精确的 mix：
    // 头部两行已经回正（mix 1）、第 2 行取行内比例 0.5、再往后仍是纯深色。
    assert.equal(world.advanceVictorySweep(model, 0), true);
    world.clearVictorySweep();
    assert.equal(world.startVictorySweep(model, 'player'), true);
    elapsed = 0;
    advanceTo(victorySweepRevertStartSeconds(stepCount) + ZC_VICTORY_SWEEP_REVERT_STEP_SECONDS * 2.5);
    for (const hex of playable) {
        const step = plan.steps.get(hex.id)!;
        if (step <= 1) assert.equal(mixOf.get(hex.id), 1, `第 ${step} 行应已回正`);
        // `dt` 是逐次累加的，游标带了 1e-15 量级的浮点误差，按容差判。
        if (step === 2) assert.ok(Math.abs(mixOf.get(hex.id)! - 0.5) < 1e-9, '正推的那一行取行内比例');
        if (step > 3) assert.equal(mixOf.get(hex.id), 0, `第 ${step} 行不该已经回正`);
    }

    // ── ③ 线条脉冲段（2026-10-16 需求：「回正动画结束再增加一个线条波动的脉冲效果，
    //    类似回正动画的」）────────────────────────────────────────────────────────
    //
    //  它和 ①② 的观察面**不同**：①② 改的是每格底色（`setSweepOwner`），③ 一格底色都不改，
    //  动的是**共享轮廓层**上的亮线 —— 所以判据从 `world.sweep.pulseLevelOf` 取
    //  （轮廓层就是读它），顺带核对探针真的把这个档位记进去了（不记 ⇒ 亮带会定格不动）。
    const pulseStart = victorySweepRevertEndSeconds(stepCount);
    assert.ok(pulseStart < victorySweepDuration(stepCount), '脉冲段必须排在回正之后');
    assert.ok(Math.abs(victorySweepDuration(stepCount) - pulseStart - victorySweepPulseSeconds(stepCount)) < 1e-9,
        '整段总长 = 回正收手时刻 + 脉冲段长');
    const probeLevelOf = (hexId: number): number => {
        const drawn: number[] = world.outlineDrawn;
        // 探针每格压 4 个数：id / 阵营序号 / mask / 脉冲档位（见 `redrawSharedOutline`）。
        for (let cursor = 3; cursor + 3 < drawn.length; cursor += 4) {
            if (drawn[cursor] === hexId) return drawn[cursor + 3];
        }
        return -1;
    };
    const startRowIds = firstRowIds;
    const lastRowIds = playable.filter((hex) => plan.steps.get(hex.id) === stepCount - 1).map((hex) => hex.id);

    // 回正还没收手：一格都不该脉冲。
    advanceTo(pulseStart - 1e-6);
    assert.ok(playable.every((hex) => world.sweep.pulseLevelOf(hex.id) === 0),
        '回正段期间不该有脉冲（它是"回正结束后"才开始的一段）');
    // 起跑那一刻波前正压在**起点那一行**上 ⇒ 那一行最亮、终点那一行还是 0。
    assert.equal(advanceTo(pulseStart), true, '脉冲段还没播完，调用方要继续等');
    assert.equal(world.sweep.pulseLevelOf(startRowIds[0]), ZC_VICTORY_SWEEP_PULSE_LEVELS,
        '波前压在起点行时该行应到最亮档');
    assert.equal(world.sweep.pulseLevelOf(lastRowIds[0]), 0, '波前还没走到终点行，它不该亮');
    assert.equal(probeLevelOf(startRowIds[0]), ZC_VICTORY_SWEEP_PULSE_LEVELS,
        '共享轮廓层的探针必须记下脉冲档位，否则亮带会定格在那一帧不动');

    // 推进到波前压过中间某一行：那一行到最亮，起点行已经灭掉（带子扫过去了）。
    const midRow = Math.floor(stepCount / 2);
    const midRowIds = playable.filter((hex) => plan.steps.get(hex.id) === midRow).map((hex) => hex.id);
    advanceTo(pulseStart + ZC_VICTORY_SWEEP_PULSE_STEP_SECONDS * midRow);
    assert.equal(world.sweep.pulseLevelOf(midRowIds[0]), ZC_VICTORY_SWEEP_PULSE_LEVELS, '波前压过的那一行最亮');
    assert.equal(world.sweep.pulseLevelOf(startRowIds[0]), 0,
        `起点行离波前已超过 ${ZC_VICTORY_SWEEP_PULSE_BAND_ROWS} 行，必须已经暗回去`);
    // 波带很**窄**：离波前超过 `PULSE_BAND_ROWS` 的行一格都不亮。这正是它敢画在共享层的理由
    // —— 任何时刻只有 1~2 行在亮，配色种数被压在个位数，`Graphics` 的桶数不会爆炸。
    for (const hex of playable) {
        const step = plan.steps.get(hex.id)!;
        if (Math.abs(step - midRow) > ZC_VICTORY_SWEEP_PULSE_BAND_ROWS + 1e-9) {
            assert.equal(world.sweep.pulseLevelOf(hex.id), 0, `第 ${step} 行离波前太远，不该亮`);
        }
    }
    // 底色全程一格都不再变（脉冲只动描边，不碰填充）——这是③和①②的区别。
    assert.ok(playable.every((hex) => mixOf.get(hex.id) === 1), '脉冲段不该改动任何一格的底色');

    // 走到终点：整盘归零，`advance` 恰好在这里收手。
    assert.equal(advanceTo(victorySweepDuration(stepCount)), false, '播完就不该再让调用方等');
    assert.ok(playable.every((hex) => world.sweep.pulseLevelOf(hex.id) === 0),
        '收手时整盘脉冲必须归零（留一档亮线会永久糊在轮廓上）');
    assert.ok(playable.every((hex) => probeLevelOf(hex.id) === 0),
        '最后一帧也要把"档位归零"写进探针，否则轮廓会停在最后一次有亮带的样子');
    assert.ok(victorySweepPulseCursor(victorySweepDuration(stepCount), stepCount) >= stepCount - 1,
        '收手时波前应已走出最后一行');

    assert.equal(litIds().length, playable.length);
    // 收手时整盘都已经回正到阵营当前色（否则摘掉覆盖会看到一次跳色）。
    assert.ok(playable.every((hex) => mixOf.get(hex.id) === 1), '播完必须整盘回正');

    world.clearVictorySweep();
    assert.ok(playable.every((hex) => painted.get(hex.id) === null));
    world.clearVictorySweep();
    assert.equal(world.advanceVictorySweep(model, ZC_VICTORY_SWEEP_STEP_SECONDS), false);
    assert.ok(playable.every((hex) => painted.get(hex.id) === null));
    const empty = new ZCGameRenderWorld({});
    empty.map = [];
    assert.equal(empty.startVictorySweep(model, 'player'), false);
});

test('★闪烁只偏深色那一端：mix = 1 时与不闪逐位同值，中间态按 1 - mix 自动淡出', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const state = { owner: 'enemy', state: 'developed', building: 'none', tileType: ZCPvpTileType.Mine, developmentCost: 25, developmentResolved: false, hp: 0, maxHp: 0, tier: 1 };
    const render = () => view.render({ state, canDevelop: false, playerGold: 0, cooldown: null });
    const rgb = (): number[] => [
        view.tileSprite.color.r, view.tileSprite.color.g, view.tileSprite.color.b, view.tileSprite.color.a,
    ];

    // 基准：不闪的深色（#7e82ff → #6a70e6，`ZC_DEEP_DARKEN = 0.9`）与阵营当前色。
    view.setSweepOwner('player'); render();
    const deep = rgb();
    assert.deepEqual(deep, [106, 112, 230, 150]);
    view.setSweepOwner('player', 1); render();
    const current = rgb();
    assert.deepEqual(current, [126, 130, 255, 150]);

    // ① 全闪：深色端往白里偏 `ZC_VICTORY_SWEEP_SHIMMER_MAX = 0.5` ⇒ 每通道到深色与 255 的中点。
    //    ⚠️ 下面的推导一律从 `deep` 取基准，**别再抄一遍字面量** —— 改 `ZC_DEEP_DARKEN`
    //    时只有上面那一行 `deepEqual` 需要跟着改，抄散了就必然漏掉一处。
    view.setSweepOwner('player', 0, 0.5); render();
    const sparkling = rgb();
    const half = (channel: number): number => Math.round(channel + (255 - channel) * 0.5);
    assert.deepEqual(sparkling, [half(deep[0]), half(deep[1]), half(deep[2]), 150], '闪烁应把深色往白里偏');
    for (let i = 0; i < 3; i += 1) {
        assert.ok(sparkling[i] >= deep[i], `偏白后第 ${i} 通道不该变暗`);
    }
    // ⚠️ 别断言「闪烁后的颜色一定比阵营当前色暗」—— 往白里推是把**每个**通道都抬上去，
    // 而阵营当前色是饱和靛蓝（126,130,255），红绿两通道反而比偏白的深色低。
    assert.ok(sparkling[0] > deep[0] && sparkling[1] > deep[1],
        '偏白必须真的把暗通道抬起来');
    assert.equal(sparkling[3], deep[3], '闪烁只改颜色不改透明度');

    // ② 闪烁幅度是连续的：0.25 落在纯深色与全闪的中间。
    view.setSweepOwner('player', 0, 0.25); render();
    assert.deepEqual(rgb(), [
        Math.round(deep[0] + (255 - deep[0]) * 0.25),
        Math.round(deep[1] + (255 - deep[1]) * 0.25),
        Math.round(deep[2] + (255 - deep[2]) * 0.25),
        150,
    ]);

    // ③ 🔴 `mix = 1`（已回正）时闪烁**完全不参与**：与不闪的同一时刻逐位同值。
    view.setSweepOwner('player', 1, 0); render();
    const settledPlain = rgb();
    view.setSweepOwner('player', 1, 0.5); render();
    assert.deepEqual(rgb(), settledPlain, '回正完之后闪烁不该再影响配色');
    assert.deepEqual(rgb(), current);

    // ④ 中间态按 `1 - mix` 淡出：mix = 0.5 加闪烁，等于「闪后深色」与「当前色」的中值，
    //    闪烁的贡献正好被压掉一半。
    const midNoFlash = [116, 121, 243, 150];
    view.setSweepOwner('player', 0.5, 0); render();
    assert.deepEqual(rgb(), midNoFlash);
    view.setSweepOwner('player', 0.5, 0.5); render();
    const midWithFlash = rgb();
    const deepFlashDelta = sparkling.map((value, index) => value - deep[index]);
    for (let i = 0; i < 3; i += 1) {
        assert.ok(Math.abs((midWithFlash[i] - midNoFlash[i]) - deepFlashDelta[i] / 2) <= 1,
            `第 ${i} 通道的闪烁贡献应只剩一半，实际 ${midWithFlash[i] - midNoFlash[i]}`);
    }

    // ⑤ 收起覆盖后回到真实归属，不留闪烁色。
    view.setSweepOwner(null);
    render();
    assert.ok(view.tileSprite.color.b < 240, '收起覆盖后应回到真实归属的颜色');
});

test('血条四色在 prefab 上绑齐：敌3 用紫色 jindutiao_p，四张两两不同', () => {
    const uuidOf = (pngPath: string): string => {
        const meta = JSON.parse(readFileSync(`${pngPath}.meta`, 'utf8')) as { uuid: string };
        return meta.uuid;
    };
    const expected: Record<string, string> = {
        barFillPlayer: uuidOf('assets/resources/image/gameui/jindutiao_b.png'),
        barFillEnemy: uuidOf('assets/resources/image/gameui/jindutiao_r.png'),
        barFillEnemy2: uuidOf('assets/resources/image/gameui/jindutiao_y.png'),
        barFillEnemy3: uuidOf('assets/resources/image/buildings/jindutiao_p.png'),
    };
    assert.equal(new Set(Object.values(expected)).size, 4, '四家的填充图必须两两不同');
    for (const prefab of ['ZCGameUnit', 'ZCGameHex']) {
        const data = JSON.parse(
            readFileSync(`assets/resources/ui/game/${prefab}.prefab`, 'utf8'),
        ) as Array<Record<string, unknown>>;
        const holder = data.find((row) => row !== null && typeof row === 'object' && 'barFillEnemy3' in row);
        assert.ok(holder, `${prefab}.prefab 必须绑 barFillEnemy3`);
        for (const [key, uuid] of Object.entries(expected)) {
            const frame = holder[key] as { __uuid__?: string } | undefined;
            assert.equal(frame?.__uuid__, `${uuid}@f9941`, `${prefab}.prefab 的 ${key} 应指向 ${uuid}`);
        }
    }
});
