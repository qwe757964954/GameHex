import {
    Color,
    Graphics,
    Label,
    LabelOutline,
    Node,
    Sprite,
    SpriteFrame,
    UIOpacity,
    UITransform,
    Vec3,
} from 'cc';
import {
    territoryChestBeamAlpha,
    territoryChestBodyFx,
    territoryChestCameraFx,
    territoryChestCameraZoomOf,
    territoryChestEndSeconds,
    territoryChestFlyCount,
    territoryChestFlyFx,
    territoryChestFountainFx,
    territoryChestOpenFrame,
    territoryChestPlacement,
    territoryChestRainbowFx,
    territoryChestRayFx,
    territoryChestStarFx,
    territoryChestTailFade,
    TERRITORY_CHEST_ART_METRICS,
    TERRITORY_CHEST_SPECS,
    type ITerritoryChestSpec,
} from '../model/TerritoryChestAnimation';
import type { TerritoryChestTier } from '../model/TerritoryChestTier';
// 建筑归一宽度（唯一真源）：表演里那只箱子必须与地图上静止的那只**同宽**，见 `CHEST_VISIBLE_WIDTH`。
import { BUILDING_VISIBLE_WIDTH } from './TerritoryStationView';

/**
 * 章节宝箱开箱的**表现层**（三档共用一套节点，参数走 `model/TerritoryChestAnimation`）。
 *
 * ## 为什么不是 prefab
 *
 *  · 宝箱本身是**一组补帧图换帧**（闭合 → 开盖，`ITerritoryChestArt`）；
 *  · 光柱 / 彩虹 / 放射光条 / 星光全是 `Graphics` 现画（用户口径：「星光特效、粒子可以使用新的」）；
 *  · 唯一需要美术的是**资源图标**，而它按 `resId` 由页面注入（与飘字 `setGainIcons` 同一口径）。
 *
 * 三样都不适合塞进 prefab 序列化 ⇒ 与 `TerritoryGainBurst` 一样用代码建节点。
 *
 * ## 层级（后建的在上面，顺序 = 渲染序）
 *
 * ```
 * Root                      页面坐标系（不随地图滚动）
 * ├── Backdrop   暗角 / 压暗（只有强档会亮；弱 / 中档推镜但不压暗）
 * ├── Stage      镜头层（倍率按奖励总量 1.08 / 1.35 / 2.3 ⇒ 推近不影响飞向栏位的图标）
 * │   ├── Beam     光柱（只有中档）——2026-10-23 起放进镜头层，跟着一起放大
 * │   ├── Rainbow  彩虹光束（只有强档）
 * │   ├── Stars    星光（Graphics 一批画完，不用 40 个节点）
 * │   ├── Rays     金色放射光条
 * │   ├── Glow     箱口光晕
 * │   ├── Chest    宝箱（Chest 收动画缩放 / ChestArt 收基准缩放，两张一张图换帧）
 * │   └── Fountain 喷泉图标（复用资源图，池化）
 * └── Fly        飞向顶部栏的奖励图标 + 数量（页面坐标系 ⇒ 不跟着镜头缩放）
 * ```
 *
 * ⚠️ 2026-10-23 起**镜头是"真镜头"**（用户：「相机推进的实际效果应该是地块和宝箱同时放大，
 *   而不是只有宝箱放大，且放大的同时需要保证宝箱的坐标点在屏幕的中央」）：
 *   · 本类只负责**覆盖层这一半**（缩放 + 把宝箱挪到屏幕中心，见 `applyCamera` 的 `focus`）；
 *   · **地图那一半**由 `TerritoryMapView` 通过 `setCameraHook` 每帧收 `(scale, focus)`
 *     自己缩放 `MapLayer` —— 两边必须同帧同值，否则地块和宝箱会"各走各的"；
 *   · 光柱 / 彩虹因此必须挂在 `Stage` 下（挂 Root 的话宝箱挪到中央后，光柱还留在原格）。
 *
 * ⚠️ 2026-10-23 起**没有「白光爆点」这一层**（用户：「移除宝箱打开的圆形闪光特效」）：
 *   原来的 `Flash` 是 12 个同心圆叠出来的径向白闪（峰值半径 204px，等于半个屏幕的白），
 *   开箱的"亮"现在只由**放射光条 + 箱口光晕 + 星光**承担。
 *   别再把它加回来 —— 单测 `territory-chest-animation` 有一条反向断言盯着视图里不许出现 `Flash`。
 *
 * ## 坐标
 *
 * `play(origin)` 的 `origin` 是**页面坐标系**里「被点格子的台面中心」——
 * 由 `TerritoryMapView` 用 `UITransform.convertToNodeSpaceAR` 从格子的世界坐标换算，
 * 本类不碰 ScrollView、不自己推算布局。
 *
 * ⚠️ **origin 对着的是箱子的「视觉中心」**，不是补帧图那块 142×156 画布的中心：
 *   画布上方留了箱盖张开的 44px，画布中心比箱子中心高 21px，补偿见
 *   `TERRITORY_CHEST_ART_METRICS` 与 `chestAnchorX/Y`。少这一下就会和地图上静止那只错位。
 *
 * ⚠️ 全程不建 tween：本类被页面复用，`step(dt)` 由 `TerritoryMapView.update` 推进；
 *   `stop()` 只把时钟置 -1 并收起节点（同 `TerritoryGainBurst` 的池化契约）。
 */

/**
 * 表演里的宝箱**可见宽**（像素）—— 与地图格子上那只静止宝箱**同宽**。
 *
 * ## 口径（2026-10-22 用户：「动画的节点大小需要与原宝箱静止状态的大小相近，坐标点保持一致」）
 *
 *   · 静止态（`territory_fixed_resource_v1`，可见 `143×113` 画布归一后）= **84 × 66.4**；
 *   · 表演用补帧图闭合帧（可见 `138×110`）按本常量归一 = **84 × 67.0**。
 *   两者差 0.6px ⇒ 点击那一刻箱子「原地变身」，看不出换过图。
 *
 *  ⚠️ 别再按「比地块建筑大一圈」取值。曾经是**可见高 132**（≈ 可见宽 117），
 *    比静止态大 1.4 倍，实机读作「点一下箱子突然弹大一圈」—— 那正是这次要修的问题。
 *
 *  ⚠️ 复用的是 `TerritoryStationView.BUILDING_VISIBLE_WIDTH`（不是抄一个 84）：
 *    以后调建筑大小，宝箱跟着一起变，两者不会飘。**这里的"轻微放大"不由常量承担**，
 *    由弹出过冲（`TERRITORY_CHEST_POP_OVERSHOOT = 1.15`）承担 —— 静止帧严格 1:1。
 */
const CHEST_VISIBLE_WIDTH = BUILDING_VISIBLE_WIDTH;

/**
 * 飞向资源栏的粒子**基准边长**（像素，放大前）。
 *
 *  与下面的 `FLY_ICON_SCALE` 一起决定实际边长：`44 × 1.35 = 59.4`。
 */
const FLY_ICON_BASE_SIZE = 44;

/**
 * 飞行粒子的放大倍数 —— **1.35**（2026-10-23 用户：「奖励飞向资源栏：粒子大小放大 1.35 倍」）。
 *
 * ## 为什么只改 `setContentSize`、不改 `applyFly` 里的 `setScale`
 *
 *  `applyFly` 每帧写的是 `slot.node.setScale(fx.scale, fx.scale, 1)` —— 那是**飞行过程的**缩放
 *  （起飞 1:1、到终点前收到 0.3 假装被吸入）。基准尺寸只能写在节点的 `UITransform` 上，
 *  两者相乘才是屏幕上的真实大小；把 1.35 混进 `fx.scale` 里，飞行的"收小"就会被一起放大。
 */
const FLY_ICON_SCALE = 1.35;

/** 金色放射光条的颜色（越靠外的条越淡，靠数量与 alpha 叠出体积感）。 */
const RAY_COLOR = new Color(255, 226, 138);
/** 星光颜色（规格：青 / 紫 / 黄 / 绿 / 粉随机）。 */
const STAR_COLORS: readonly Color[] = [
    new Color(126, 232, 255),
    new Color(196, 156, 255),
    new Color(255, 226, 128),
    new Color(150, 240, 168),
    new Color(255, 168, 208),
];
/** 彩虹光束的六段配色（紫→蓝→青→绿→黄→粉，规格 §3.3）。 */
const RAINBOW_COLORS: readonly Color[] = [
    new Color(178, 118, 255),
    new Color(96, 158, 255),
    new Color(96, 232, 236),
    new Color(122, 232, 132),
    new Color(255, 226, 110),
    new Color(255, 150, 200),
];

/** 一条奖励的图标输入（页面按 `resId` 查表后喂进来；查不到就是 `null`，只是没有图标）。 */
export interface ITerritoryChestIconEntry {
    readonly resId: number;
    readonly amount: number;
    readonly frame: SpriteFrame | null;
}

/**
 * 宝箱**补帧序列**（`chest_seq_0 … chest_seq_N-1`，同为 142×156）。
 *
 *  第 0 张 = 完全闭合（就是地图格子上显示的那只宝箱），最后一张 = 完全开盖（`zw_0005`）。
 *  中间帧由 `tools/gen_chest_open_frames.py` 离线烘焙 —— 两张成品图之间没有可插值的姿态参数。
 */
export interface ITerritoryChestArt {
    /** 按 `0 … N-1` 排好的帧；空数组 / 长度 1 都合法（长度 1 = 只有一张，等于不换帧）。 */
    readonly frames: readonly (SpriteFrame | null)[];
}

interface IChestParticleSlot {
    readonly node: Node;
    readonly sprite: Sprite;
    readonly opacity: UIOpacity;
    readonly transform: UITransform;
}

interface IFlySlot extends IChestParticleSlot {
    readonly label: Label;
}

function makeNode(name: string, parent: Node): Node {
    const node = new Node(name);
    node.layer = parent.layer;
    node.setParent(parent);
    node.addComponent(UITransform);
    return node;
}

function makeGraphics(name: string, parent: Node, size?: { width: number; height: number }): Graphics {
    const node = makeNode(name, parent);
    if (size) node.getComponent(UITransform)!.setContentSize(size.width, size.height);
    return node.addComponent(Graphics);
}

export class TerritoryChestView {
    /** 页面坐标系的根节点（`active = false` = 整套收起）。 */
    readonly node: Node;

    private readonly backdrop: Graphics;
    private readonly beam: Graphics;
    private readonly rainbow: Graphics;
    private readonly stage: Node;
    private readonly stars: Graphics;
    private readonly rays: Graphics;
    private readonly glow: Graphics;
    private readonly chest: Node;
    /** 宝箱美术（**一张图换帧**：闭合 → 开盖，见 `ITerritoryChestArt`）。 */
    private readonly chestArt: Node;
    private readonly chestSprite: Sprite;
    private readonly chestTransform: UITransform;
    /** 收尾淡出（与所有光效共用一个系数，见 `territoryChestTailFade`）。 */
    private readonly chestOpacity: UIOpacity;
    private readonly fountain: Node;
    private readonly flyLayer: Node;

    private readonly fountainSlots: IChestParticleSlot[] = [];
    private readonly flySlots: IFlySlot[] = [];

    private readonly size: { width: number; height: number };
    /** 飞向的落点（页面坐标系）。页面可改；默认屏幕顶部中央。 */
    private catchX = 0;
    private catchY = 0;

    private art: ITerritoryChestArt = { frames: [] };
    /** 上一次真正写进 Sprite 的帧号（同帧不重复写，站点每秒刷新也标不脏）。 */
    private appliedFrame = -1;
    /**
     * 可见区中心 → 画布中心的落位补偿（屏幕像素，由 `applyChestFrames` 按缩放算好）。
     *
     *  补帧图的画布比闭合箱子高出「箱盖张开的那截」，画布中心因此比箱子的视觉中心高 21px
     *  （见 `TERRITORY_CHEST_ART_METRICS`）。不补就会看到箱子沉在格子里、和静止态错位。
     */
    private chestAnchorX = 0;
    private chestAnchorY = 0;

    private spec: ITerritoryChestSpec | null = null;
    private rewards: readonly ITerritoryChestIconEntry[] = [];
    private origin = new Vec3();
    private seed = 0;
    private elapsed = -1;
    private onDone: (() => void) | null = null;
    /**
     * 本帧的**收尾淡出系数**（`1` = 正常，`0` = 全灭）。
     *
     * 用字段而不是逐层传参：`apply()` 内部 9 个 apply* 都要用它，
     * 而它每帧只算一次（`territoryChestTailFade`），传参会把 9 个签名都污染一遍。
     */
    private tailFade = 1;
    /**
     * 本帧的**对焦进度**（`0` = 宝箱在原格，`1` = 已到屏幕中央）。
     *
     * 只有 `Fly` 层用得到它：飞向资源栏的图标活在 Root（不跟镜头缩放），
     * 起点得自己按宝箱当前屏幕位置算（`origin × (1 - cameraFocus)`）。
     */
    private cameraFocus = 0;
    /**
     * 镜头**地图侧**的出口（由 `TerritoryMapView` 注入）。
     *
     *  本类只管覆盖层这一半（宝箱 + 光效），地块归地图 —— 两边必须同帧同值，
     *  否则就是 2026-10-23 用户看到的问题：「只有宝箱放大、地块不动」。
     *  每帧 `applyCamera` 调一次；`stop()` 额外调 `(1, 0)` 把地图还原。
     */
    private cameraHook: ((scale: number, focus: number) => void) | null = null;
    /**
     * 本次表演实际飞行的粒子数（按**奖励总量**分三档：≤50 → 5、≤500 → 15、>500 → 30）。
     *
     * 真源是 `territoryChestFlyCount`；这里只存一份给逐帧渲染与停播判据用
     * （`territoryChestEndSeconds` 必须收到同一个数，否则 30 枚里后面的会被硬切）。
     */
    private flyCount = 0;
    /**
     * 本次表演的**镜头推近倍率**（按奖励总量 1.08 / 1.35 / 2.3）。
     *
     * 真源是 `territoryChestCameraZoomOf`，在 `play()` 里与 `flyCount` 用**同一个 `total`** 算出来
     * （两个函数各判各的档，但输入必须是同一个值 —— 分成两次累加迟早会飘）。
     *
     * ⚠️ 这不是参数表里的 `spec.cameraZoom`（那三档都是 2.3，现在只是上限 / 兜底）。
     *   每帧必须把它传给 `territoryChestCameraFx` 的第三个参数，否则弱档也会按 2.3 推。
     */
    private cameraZoom = 1;

    constructor(layer: Node, size: { width: number; height: number }) {
        this.size = { width: Math.max(1, size.width), height: Math.max(1, size.height) };
        this.node = makeNode('TerritoryChest', layer);
        this.node.getComponent(UITransform)!.setContentSize(this.size.width, this.size.height);
        this.node.active = false;
        this.catchX = 0;
        this.catchY = this.size.height / 2 - 40;

        this.backdrop = makeGraphics('Backdrop', this.node, this.size);
        this.stage = makeNode('Stage', this.node);
        // 光柱 / 彩虹挂在**镜头层**里（2026-10-23）：镜头推近时宝箱会被挪到屏幕中央，
        // 这两样要是留在 Root，就会与箱子脱开、杵在原格上。它们本来就是"从箱口射出来"的，
        // 跟着箱子一起放大才对。
        this.beam = makeGraphics('Beam', this.stage, this.size);
        this.rainbow = makeGraphics('Rainbow', this.stage);
        this.stars = makeGraphics('Stars', this.stage);
        this.rays = makeGraphics('Rays', this.stage);
        this.glow = makeGraphics('Glow', this.stage);
        this.chest = makeNode('Chest', this.stage);
        // 宝箱本体的透明度：只在**收尾淡出**时被写（`territoryChestTailFade`）。
        // 挂在 `Chest` 而不是 `ChestArt` 上：光晕/爆点这些兄弟节点各自算 alpha，
        // 分成两层写会出现「箱子已经没了、光晕还亮着」。
        this.chestOpacity = this.chest.addComponent(UIOpacity);
        // 一张图换帧（2026-10-22）：不再拆箱体/箱盖 —— 闭合与开盖是两张成品图，
        // 中间帧由 `tools/gen_chest_open_frames.py` 烘焙，运行时只按帧号换 `spriteFrame`。
        //
        // ⚠️ 缩放要分两层：`Chest` 收**动画**缩放（弹出 / 蓄力挤压），`ChestArt` 收**基准**缩放
        //   （把美术缩到 `CHEST_VISIBLE_WIDTH`）。合成一层的话 `applyChest` 每帧写死
        //   `setScale(fx.scale, …)` 会把基准覆盖掉，宝箱瞬间缩成 1:1 像素。
        this.chestArt = makeNode('ChestArt', this.chest);
        this.chestSprite = this.chestArt.addComponent(Sprite);
        this.chestSprite.trim = false;
        this.chestSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.chestTransform = this.chestArt.getComponent(UITransform)!;
        this.fountain = makeNode('Fountain', this.stage);
        this.flyLayer = makeNode('Fly', this.node);
    }

    /** 注入宝箱美术（页面在资源就绪后调一次）。 */
    setArt(art: ITerritoryChestArt): void {
        this.art = art;
        this.applyChestFrames();
    }

    /**
     * 飞向的落点（页面坐标系）。默认「屏幕顶部中央偏上 40px」。
     *
     * 领地页自身没有资源栏（钱包在主页顶栏），所以默认值只是「飞向顶部并消失」；
     * 页面将来能拿到真实栏位坐标时调这个接口即可，本类不用改。
     */
    setCatchPoint(x: number, y: number): void {
        this.catchX = x;
        this.catchY = y;
    }

    /** 是否正在播（页面据此决定要不要等它结束再弹奖励窗）。 */
    get isPlaying(): boolean {
        return this.elapsed >= 0;
    }

    /** 本次飞行粒子数（页面/单测可读；按奖励总量分档，见 `territoryChestFlyCount`）。 */
    get flyingCount(): number {
        return this.flyCount;
    }

    /**
     * 注入**镜头地图侧**的出口（`TerritoryMapView` 在建本视图时调一次）。
     *
     *  每帧收到 `(scale, focus)`，收到就要把地图摆到与宝箱一致的位置 ——
     *  具体怎么摆由地图自己决定（它才知道 ScrollView 与 `MapLayer` 的关系）。
     *  传 `null` 解绑（页面销毁时）。
     */
    setCameraHook(hook: ((scale: number, focus: number) => void) | null): void {
        this.cameraHook = hook;
    }

    /**
     * 播一次开箱。
     *
     * @param tier   档位（由 `territoryChestTierOfRewards` 判出来，本类不判）
     * @param origin 页面坐标系里的**箱口位置**（被点格子的台面中心）
     * @param rewards 这一批奖励（用于喷泉 / 飞出的图标与数量）
     * @param onDone 播完回调（页面用它接奖励弹窗；被 `stop()` 打断时**不回调**）
     */
    play(
        tier: TerritoryChestTier,
        origin: Vec3,
        rewards: readonly ITerritoryChestIconEntry[],
        onDone?: () => void,
    ): void {
        this.spec = TERRITORY_CHEST_SPECS[tier];
        this.rewards = rewards;
        // 累计**这批奖励的总量**（脏值跳过），下面两条都只吃它：
        //  · 飞行粒子数：≤50 → 5、≤500 → 15、>500 → 30（2026-10-23）
        //  · 镜头推近倍率：≤50 → 1.08、≤500 → 1.35、>500 → 2.3（2026-10-23 同日追加）
        // 两者与档位无关 —— 档位管"演多大"，这两个管"拿了多少"。
        let total = 0;
        for (const reward of rewards) {
            const amount = reward?.amount;
            if (Number.isFinite(amount) && amount > 0) total += amount;
        }
        this.flyCount = territoryChestFlyCount(total);
        this.cameraZoom = territoryChestCameraZoomOf(total);
        this.origin = new Vec3(origin.x, origin.y, 0);
        this.seed = (this.seed + 1) | 0;
        this.elapsed = 0;
        this.onDone = onDone ?? null;
        this.node.active = true;
        this.applyChestFrames();
        if (this.chest.active !== true) this.chest.active = true;
        this.apply(0);
    }

    /** 立刻收尾（换章 / 页面销毁前调）。**不触发** `onDone` —— 打断不是"播完了"。 */
    stop(): void {
        this.elapsed = -1;
        this.onDone = null;
        if (this.node.active) this.node.active = false;
        for (const slot of this.fountainSlots) if (slot.node.active) slot.node.active = false;
        for (const slot of this.flySlots) if (slot.node.active) slot.node.active = false;
        // 地图侧必须还原：中途打断时镜头还怼着、地图还是放大 + 平移过的，不还原就"定住了"。
        this.cameraFocus = 0;
        this.cameraZoom = 1;
        this.cameraHook?.(1, 0);
    }

    /** 逐帧推进。由页面/地图视图的 `update` 调（本类不长在组件树上）。 */
    step(dt: number): void {
        if (this.elapsed < 0 || !this.spec) return;
        const spec = this.spec;
        this.elapsed += dt;
        // ⚠️ 停播看 `territoryChestEndSeconds` 而不是 `totalSeconds`：
        //   那个数 = 最后一枚奖励落袋 + settleSeconds + fadeOutSeconds。
        //   用 `totalSeconds` 的话，参数表一旦比这条线长，屏幕上就多一段
        //   「奖励拿完了、开着的空箱子还杵着」（2026-10-22 用户：停止的时间太长）。
        //   ⚠️ 必须带上 `flyCount`：粒子数按奖励总量能到 30，用表里的 4/6/8 会把后面那串切掉。
        if (this.elapsed >= territoryChestEndSeconds(spec, this.flyCount)) {
            const done = this.onDone;
            this.stop();
            done?.();
            return;
        }
        this.apply(this.elapsed);
    }

    // ============================================================
    // 每帧写入
    // ============================================================

    private apply(t: number): void {
        const spec = this.spec;
        if (!spec) return;
        // 收尾系数先算：后面每个 apply* 都乘它 ⇒ 宝箱与所有光效只有一个"灭"的时刻。
        this.tailFade = territoryChestTailFade(spec, t);
        this.applyChest(spec, t);
        this.applyCamera(spec, t);
        this.applyBeam(spec, t);
        this.applyRainbow(spec, t);
        this.applyRays(spec, t);
        this.applyGlow(spec, t);
        this.applyFountain(spec, t);
        this.applyStars(spec, t);
        this.applyFly(spec, t);
    }

    private applyChest(spec: ITerritoryChestSpec, t: number): void {
        const fx = territoryChestBodyFx(spec, t);
        this.chest.active = fx.visible;
        if (!fx.visible) return;
        // 收尾时宝箱与光效一起淡 —— 不是 `stop()` 里一刀切掉（那样会「啪」地消失）。
        const alpha = Math.round(Math.max(0, Math.min(1, this.tailFade)) * 255);
        if (this.chestOpacity.opacity !== alpha) this.chestOpacity.opacity = alpha;
        // 落位补偿按**当前缩放**乘一次：让「可见区中心」恒在 origin 上 ⇒
        // 弹出 / 蓄力是绕箱子自身的视觉中心缩放，任何一帧都不相对静止态上下漂。
        // （不乘的话缩放一变，可见区中心就会在 origin 上下滑 ~2px。）
        this.chest.setPosition(
            this.origin.x + this.chestAnchorX * fx.scale,
            this.origin.y + this.chestAnchorY * fx.scale + fx.offsetY,
            0,
        );
        this.chest.setScale(fx.scale, fx.scale * fx.scaleY, 1);
        // 「开盖」= 换帧（需求 2026-10-22 §2）：第 0 张闭合 → 最后一张全开。
        this.applyChestFrame(territoryChestOpenFrame(spec, t));
    }

    /** 把第 `index` 帧写进 Sprite（同帧不重复写：站点每秒刷新，别把整棵树标脏）。 */
    private applyChestFrame(index: number): void {
        const frames = this.art.frames;
        if (!frames.length) return;
        const clamped = index < 0 ? 0 : index > frames.length - 1 ? frames.length - 1 : index;
        if (clamped === this.appliedFrame) return;
        this.appliedFrame = clamped;
        this.chestSprite.spriteFrame = frames[clamped] ?? null;
    }

    private applyCamera(spec: ITerritoryChestSpec, t: number): void {
        // 第三参数是**本次的倍率**（按奖励总量 1.08 / 1.35 / 2.3）—— 不传就会按参数表的 2.3 推，
        // 弱档那一份"轻微凑近"直接作废。`focus` 的分母也用的是这个值（见 model 里的说明）。
        const fx = territoryChestCameraFx(spec, t, this.cameraZoom);
        this.cameraFocus = fx.focus;
        // 缩放要绕「箱口」而不是屏幕中心，否则推镜时宝箱会漂走；**同时**视角中心要从格心
        // 挪到屏幕中心（2026-10-23 用户：「放大的同时需要保证宝箱的坐标点在屏幕的中央」）。
        //
        //  宝箱在 stage 里位于 `origin`，所以它的页面坐标 = `k × origin + stagePos`。
        //  要求它等于 `origin × (1 - focus)`（focus 0 → 原位，1 → 屏幕中心 0,0），解得：
        //      stagePos = origin × (1 - focus - k)
        //  校验：focus=0/k=1 ⇒ stagePos=0（与改动前完全一致）；focus=1/k=本次倍率 ⇒ 宝箱落在 (0,0)。
        const shift = 1 - fx.focus - fx.scale;
        this.stage.setScale(fx.scale, fx.scale, 1);
        this.stage.setPosition(this.origin.x * shift, this.origin.y * shift, 0);
        // 地图那一半交给 `TerritoryMapView`（同帧同值，否则地块和宝箱各走各的）。
        this.cameraHook?.(fx.scale, fx.focus);
        this.drawVignette(fx.vignette * this.tailFade);
    }

    private applyBeam(spec: ITerritoryChestSpec, t: number): void {
        const raw = territoryChestBeamAlpha(spec, t);
        const alpha = raw === null ? null : raw * this.tailFade;
        const g = this.beam;
        g.clear();
        if (alpha === null || alpha <= 0.004) return;
        const topY = this.size.height / 2;
        const mouthY = this.origin.y;
        const topHalf = 74;
        const bottomHalf = 18;
        g.fillColor = new Color(255, 250, 226, Math.round(Math.min(1, alpha) * 235));
        g.moveTo(this.origin.x - bottomHalf, mouthY - 26);
        g.lineTo(this.origin.x + bottomHalf, mouthY - 26);
        g.lineTo(this.origin.x + topHalf, topY);
        g.lineTo(this.origin.x - topHalf, topY);
        g.close();
        g.fill();
        // 落地光环：光柱砸到箱口时炸开的一圈横向环（规格 §3.2）。
        const ring = territoryChestBeamRing(spec, t) * this.tailFade;
        if (ring > 0) {
            g.strokeColor = new Color(255, 246, 210, Math.round(ring * 220));
            g.lineWidth = 5;
            const rx = 34 + 86 * (1 - ring);
            const ry = rx * 0.32;
            for (let step = 0; step < 28; step += 1) {
                const a = (step / 28) * Math.PI * 2;
                const b = ((step + 1) / 28) * Math.PI * 2;
                g.moveTo(this.origin.x + Math.cos(a) * rx, mouthY + Math.sin(a) * ry);
                g.lineTo(this.origin.x + Math.cos(b) * rx, mouthY + Math.sin(b) * ry);
            }
            g.stroke();
        }
    }

    private applyRainbow(spec: ITerritoryChestSpec, t: number): void {
        const raw = territoryChestRainbowFx(spec, t);
        const fx = raw ? { alpha: raw.alpha * this.tailFade, spinDeg: raw.spinDeg } : null;
        const g = this.rainbow;
        g.clear();
        if (!fx || fx.alpha <= 0.004) return;
        const mouthY = this.origin.y;
        const length = this.size.height * 0.9;
        const bandAngle = 7;
        for (let index = 0; index < RAINBOW_COLORS.length; index += 1) {
            const color = RAINBOW_COLORS[index];
            const center = fx.spinDeg + index * bandAngle - (RAINBOW_COLORS.length - 1) * bandAngle / 2;
            const rad = (center * Math.PI) / 180;
            const spread = (bandAngle / 2) * (Math.PI / 180);
            const x1 = this.origin.x + Math.sin(rad - spread) * 16;
            const y1 = mouthY + Math.cos(rad - spread) * 16;
            const x2 = this.origin.x + Math.sin(rad + spread) * 16;
            const y2 = mouthY + Math.cos(rad + spread) * 16;
            const x3 = this.origin.x + Math.sin(rad + spread) * length;
            const y3 = mouthY + Math.cos(rad + spread) * length;
            const x4 = this.origin.x + Math.sin(rad - spread) * length;
            const y4 = mouthY + Math.cos(rad - spread) * length;
            g.fillColor = new Color(color.r, color.g, color.b, Math.round(fx.alpha * 168));
            g.moveTo(x1, y1);
            g.lineTo(x2, y2);
            g.lineTo(x3, y3);
            g.lineTo(x4, y4);
            g.close();
            g.fill();
        }
    }

    private applyRays(spec: ITerritoryChestSpec, t: number): void {
        const raw = territoryChestRayFx(spec, t);
        const fx = raw ? { scale: raw.scale, alpha: raw.alpha * this.tailFade } : null;
        const g = this.rays;
        g.clear();
        if (!fx || fx.alpha <= 0.004) return;
        const mouthY = this.origin.y;
        const count = spec.rayCount;
        g.fillColor = new Color(RAY_COLOR.r, RAY_COLOR.g, RAY_COLOR.b, Math.round(fx.alpha * 210));
        for (let index = 0; index < count; index += 1) {
            // 均匀铺开但长短交错：偶数条长、奇数条短，读起来更像"放射"而不是"扇子"。
            const angle = (index / count) * Math.PI * 2 + (index % 2 ? 0.11 : 0);
            const length = (74 + (index % 2 ? 26 : 0)) * fx.scale;
            const halfWidth = 3.2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            g.moveTo(this.origin.x + cos * halfWidth, mouthY + sin * halfWidth);
            g.lineTo(this.origin.x - cos * halfWidth, mouthY - sin * halfWidth);
            g.lineTo(this.origin.x + cos * length, mouthY + sin * length);
            g.close();
            g.fill();
        }
    }

    // ⚠️ 原本这里还有一个 `applyFlash`（白光爆点：12 个同心白圆叠出的径向闪光）。
    //   2026-10-23 用户「移除宝箱打开的圆形闪光特效」⇒ 整层摘掉，连同 model 的
    //   `flashStart / flashSeconds / flashPeak` 与 `territoryChestFlashAlpha` 一起删了，
    //   不是把 alpha 调 0（留个 0 的窗口以后一定会被人"顺手改回来"）。

    private applyGlow(spec: ITerritoryChestSpec, t: number): void {
        const g = this.glow;
        g.clear();
        // 光晕跟着「开盖之后」走：开盖前没有，甩开的过程中亮起，之后一直亮到收尾。
        // ⚠️ 判据是**时间**不是箱盖角度：箱盖现在是「甩一下再回正到 0°」，
        //   拿角度当判据会在回正那一刻把光晕关掉（等于开完箱箱口就暗了）。
        const openRatio = spec.lidSeconds > 0
            ? Math.max(0, Math.min(1, (t - spec.lidStart) / spec.lidSeconds))
            : (t >= spec.lidStart ? 1 : 0);
        if (openRatio <= 0.01) return;
        // 收尾不再单独算一条「总时长前 0.6s 开始变暗」的曲线：那是一条**独立于奖励**的时间线，
        // 与 `tailFade` 叠在一起会让光晕比宝箱早灭（正好违反「同步关闭」）。
        // 现在只乘 `tailFade` —— 什么时候灭由「最后一枚奖励落袋」决定，和宝箱同一帧。
        const alpha = openRatio * this.tailFade;
        for (let step = 7; step >= 1; step -= 1) {
            const radius = 10 + step * 9;
            g.fillColor = new Color(255, 224, 150, Math.round(alpha * 26));
            g.circle(this.origin.x, this.origin.y + 6, radius);
            g.fill();
        }
    }

    private applyFountain(spec: ITerritoryChestSpec, t: number): void {
        const count = spec.fountainCount;
        if (count <= 0) {
            for (const slot of this.fountainSlots) if (slot.node.active) slot.node.active = false;
            return;
        }
        this.ensureFountainSlots(count);
        for (let index = 0; index < this.fountainSlots.length; index += 1) {
            const slot = this.fountainSlots[index];
            const fx = index < count ? territoryChestFountainFx(spec, this.seed, index, t) : null;
            if (!fx) {
                if (slot.node.active) slot.node.active = false;
                continue;
            }
            if (!slot.node.active) slot.node.active = true;
            slot.node.setPosition(this.origin.x + fx.x, this.origin.y + 10 + fx.y, 0);
            slot.node.setScale(fx.scale, fx.scale, 1);
            slot.node.angle = fx.rotationDeg;
            const alpha = Math.round(Math.max(0, Math.min(1, fx.opacity * this.tailFade)) * 255);
            if (slot.opacity.opacity !== alpha) slot.opacity.opacity = alpha;
        }
    }

    private applyStars(spec: ITerritoryChestSpec, t: number): void {
        const g = this.stars;
        g.clear();
        const count = spec.starCount;
        if (count <= 0) return;
        for (let index = 0; index < count; index += 1) {
            const fx = territoryChestStarFx(spec, this.seed, index, t);
            if (!fx || fx.opacity <= 0.02) continue;
            const color = STAR_COLORS[index % STAR_COLORS.length];
            const x = this.origin.x + fx.x;
            const y = this.origin.y + fx.y;
            const size = 5 * fx.scale;
            const alpha = Math.round(fx.opacity * this.tailFade * 230);
            // 四角星：两个细长菱形交叉（不用贴图，也不会被合批改 rect）。
            g.fillColor = new Color(color.r, color.g, color.b, alpha);
            const rad = (fx.rotationDeg * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            for (const [ax, ay] of [[1, 0], [0, 1]] as const) {
                const px = ax * cos - ay * sin;
                const py = ax * sin + ay * cos;
                g.moveTo(x + px * size, y + py * size);
                g.lineTo(x - py * size * 0.32, y + px * size * 0.32);
                g.lineTo(x - px * size, y - py * size);
                g.lineTo(x + py * size * 0.32, y - px * size * 0.32);
                g.close();
                g.fill();
            }
        }
    }

    private applyFly(spec: ITerritoryChestSpec, t: number): void {
        // 粒子数由 `play()` 按**奖励总量**算好（5 / 15 / 30），不再受 `rewards.length` 限制 ——
        // 30 枚只有 2 种资源时按 `rewards` **轮流取**图标与数量（与喷泉同一口径）。
        const count = this.flyCount;
        if (count <= 0 || this.rewards.length === 0) {
            for (const slot of this.flySlots) if (slot.node.active) slot.node.active = false;
            return;
        }
        this.ensureFlySlots(count);
        // 宝箱可能已被镜头挪到屏幕中央 ⇒ 飞行起点要跟着走（Fly 层不跟镜头缩放，
        // 所以只能按 `origin × (1 - focus)` 自己算；否则 30 枚会从原来那格凭空冒出来）。
        const originX = this.origin.x * (1 - this.cameraFocus);
        const originY = this.origin.y * (1 - this.cameraFocus);
        for (let index = 0; index < this.flySlots.length; index += 1) {
            const slot = this.flySlots[index];
            const fx = index < count ? territoryChestFlyFx(spec, index, t, count) : null;
            if (!fx) {
                if (slot.node.active) slot.node.active = false;
                continue;
            }
            if (!slot.node.active) slot.node.active = true;
            // 错峰让每枚的起点略微抖开，免得几十枚从同一个点起跳（规格 §0.3 多枚错峰）。
            // 抖动取模而不是按 index 线性增长：30 枚时线性会让起点飘到 170px 开外。
            const jitterX = (index % 2 === 0 ? -1 : 1) * (6 + (index % 5) * 2.5);
            const startX = originX + jitterX;
            const startY = originY + 16 + (index % 6) * 5;
            // 二次贝塞尔：控制点 = 起点向上抬（拱高）× 朝终点方向偏 30%。
            const dx = this.catchX - startX;
            const dy = this.catchY - startY;
            const controlX = startX + dx * 0.3;
            const controlY = startY + Math.abs(dy) * fx.arcRatio;
            const inv = 1 - fx.progress;
            const x = inv * inv * startX + 2 * inv * fx.progress * controlX + fx.progress * fx.progress * this.catchX;
            const y = inv * inv * startY + 2 * inv * fx.progress * controlY + fx.progress * fx.progress * this.catchY;
            slot.node.setPosition(x, y, 0);
            slot.node.setScale(fx.scale, fx.scale, 1);
            const alpha = Math.round(Math.max(0, Math.min(1, fx.opacity * this.tailFade)) * 255);
            if (slot.opacity.opacity !== alpha) slot.opacity.opacity = alpha;
            const amount = this.rewards[index % this.rewards.length]?.amount ?? 0;
            const text = `+${Math.max(0, Math.round(amount))}`;
            if (slot.label.string !== text) slot.label.string = text;
        }
    }

    // ============================================================
    // 节点装配
    // ============================================================

    /** 箱盖底边（铰链）在 `Chest` 局部坐标系里的位置。 */
    private lidBaseX = 0;
    private lidBaseY = 0;

    /**
     * 把宝箱美术裁成「箱体 + 箱盖」两片并对齐。
     *
     * 两片共享同一张纹理、只改 `rect` ⇒ 拼起来与整图**逐像素一致**（不会出现接缝错位）；
     * 箱盖的锚点定在**底边中点**，`angle` 一转就是绕铰链掀开。
     */
    /**
     * 注入帧后量一次尺寸（所有帧同画布，只用第一张有图的帧量）。
     *
     *  ⚠️ 缺图不是错误：`frames` 为空时只是 `chestSprite` 没图（光效照常播），
     *  与「资源加载失败只少一项」的既有口径一致。
     */
    private applyChestFrames(): void {
        const frames = this.art.frames;
        let width = 0;
        let height = 0;
        for (const frame of frames) {
            const size = frame?.rect;
            if (size && size.width > 0 && size.height > 0) {
                width = size.width;
                height = size.height;
                break;
            }
        }
        this.appliedFrame = -1;
        if (!(width > 0 && height > 0)) {
            this.chestSprite.spriteFrame = null;
            this.chestSprite.enabled = false;
            this.chestAnchorX = 0;
            this.chestAnchorY = 0;
            return;
        }
        this.chestSprite.enabled = true;
        // 基准缩放只在 `ChestArt` 上写一次（`Chest` 那层留给每帧的动画缩放）。
        // ⚠️ 归一用**可见宽**（不是画布高）：画布高随箱盖张开的空间变化，按它归一
        //   会把箱子算大 1.4 倍（见 `CHEST_VISIBLE_WIDTH` 的口径说明）。
        const placement = territoryChestPlacement(TERRITORY_CHEST_ART_METRICS, CHEST_VISIBLE_WIDTH, width, height);
        this.chestTransform.setContentSize(width, height);
        this.chestArt.setScale(placement.scale, placement.scale, 1);
        this.chestAnchorX = placement.offsetX;
        this.chestAnchorY = placement.offsetY;
        this.applyChestFrame(0);
    }

    private ensureFountainSlots(count: number): void {
        while (this.fountainSlots.length < count) {
            const index = this.fountainSlots.length;
            const node = makeNode(`FountainSlot_${index}`, this.fountain);
            node.active = false;
            const size = 46;
            node.getComponent(UITransform)!.setContentSize(size, size);
            const sprite = node.addComponent(Sprite);
            sprite.trim = false;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            this.fountainSlots.push({
                node,
                sprite,
                opacity: node.addComponent(UIOpacity),
                transform: node.getComponent(UITransform)!,
            });
        }
        // 图标按奖励条目**轮流取**（与飘字喷发同一口径）：一批里既有银币又有道具时两种图标都出现。
        for (let index = 0; index < this.fountainSlots.length; index += 1) {
            const entry = this.rewards.length ? this.rewards[index % this.rewards.length] : null;
            const frame = entry?.frame ?? null;
            const sprite = this.fountainSlots[index].sprite;
            if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        }
    }

    private ensureFlySlots(count: number): void {
        // 粒子边长 = 基准 × 1.35（2026-10-23 用户：「粒子大小放大 1.35 倍」）⇒ 44 → 59.4。
        // 只写在这里（UITransform），不碰 `applyFly` 的 `setScale` —— 那是飞行过程的收小。
        const size = FLY_ICON_BASE_SIZE * FLY_ICON_SCALE;
        while (this.flySlots.length < count) {
            const index = this.flySlots.length;
            const node = makeNode(`FlySlot_${index}`, this.flyLayer);
            node.active = false;
            node.getComponent(UITransform)!.setContentSize(size, size);
            const sprite = node.addComponent(Sprite);
            sprite.trim = false;
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            const labelNode = makeNode('Amount', node);
            labelNode.getComponent(UITransform)!.setContentSize(120, 26);
            // 数量文字挂在粒子**底边之下**：图标变大后（44 → 59.4）固定 -30 会被压住，
            // 所以按当前边长推到 `size/2 + 12`，放大前后都留 12px 间隙。
            labelNode.setPosition(0, -(size / 2 + 12), 0);
            const label = labelNode.addComponent(Label);
            label.fontSize = 20;
            label.lineHeight = 22;
            label.color = new Color(255, 246, 214);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            const outline = labelNode.addComponent(LabelOutline);
            outline.color = new Color(46, 32, 22);
            outline.width = 2;
            this.flySlots.push({
                node,
                sprite,
                opacity: node.addComponent(UIOpacity),
                transform: node.getComponent(UITransform)!,
                label,
            });
        }
        // 图标按奖励条目**轮流取**（与 `applyFly` / 喷发同一口径）：粒子数可能多于奖励条目数
        // （三档最多 30 枚，而奖励往往只有 2 条），按下标直取会让大部分粒子变成空图标。
        for (let index = 0; index < this.flySlots.length; index += 1) {
            const entry = this.rewards.length ? this.rewards[index % this.rewards.length] : null;
            const frame = entry?.frame ?? null;
            const sprite = this.flySlots[index].sprite;
            if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        }
    }

    /**
     * 暗角 / 压暗（只有强档会传非 0）。
     *
     * 没有渐变贴图：画**一圈圈由外向内变淡的矩形描边**近似径向暗角。
     * ⚠️ 必须用 `stroke`（环带）而不是 `fill`（实心矩形）：实心矩形层层叠加时
     *   **越靠中心叠得越多**，结果是中心最黑、边缘最亮 —— 正好相反。
     */
    private drawVignette(alpha: number): void {
        const g = this.backdrop;
        g.clear();
        if (alpha <= 0.004) return;
        const halfW = this.size.width / 2;
        const halfH = this.size.height / 2;
        const steps = 22;
        const band = Math.min(halfW, halfH) * 1.2 / steps;
        g.lineWidth = band + 1;
        for (let step = 0; step < steps; step += 1) {
            const inset = step * band;
            const strength = alpha * (1 - step / steps) * 0.9;
            if (strength <= 0.004) continue;
            g.strokeColor = new Color(10, 7, 5, Math.round(strength * 255));
            g.rect(-halfW + inset, -halfH + inset, (halfW - inset) * 2, (halfH - inset) * 2);
            g.stroke();
        }
    }
}

/**
 * 光柱落点光环的**剩余强度**（`0` = 不画）。
 *
 * 与光柱本体分开写：环是「砸下来那一下」的冲击波，`0.35s` 走完，
 * 而光柱还要持续照射半秒（规格 §3.2 里它们是两条并行的时间线）。
 */
function territoryChestBeamRing(spec: ITerritoryChestSpec, t: number): number {
    if (!(spec.beamDownSeconds > 0)) return 0;
    const start = spec.beamStart + spec.beamDownSeconds;
    const seconds = 0.35;
    if (t < start || t > start + seconds) return 0;
    return 1 - (t - start) / seconds;
}
