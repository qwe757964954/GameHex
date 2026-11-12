import { EventMgr } from '../../../framework/event/EventMgr';
import { _decorator, Button, Color, Component, Label, Node, Sprite, UIOpacity, UITransform } from 'cc';
import type { SpriteFrame, Vec3 } from 'cc';
import {
    MAP_MARKER_BADGE_BOLD, MAP_MARKER_BADGE_FONT_SIZE, MAP_MARKER_BADGE_HEIGHT, MAP_MARKER_BADGE_LINE_HEIGHT,
    MAP_MARKER_BADGE_SPACING_X, MAP_MARKER_BADGE_TEXT_Y, MAP_MARKER_BADGE_WIDTH, MAP_MARKER_BUBBLE_HEIGHT,
    MAP_MARKER_BADGE_OUTLINE_WIDTH,
    mapMarkerBadgeY,
} from '../../common/MapMarkerBadge';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../../../core/hex/ShakePresentation';
import type { TerritorySite } from '../model/TerritoryMapConfig';
import { territoryChestBubbleLayout } from '../model/TerritoryChestBubble';
import type { ITerritoryChestBubbleLayout } from '../model/TerritoryChestBubble';
import { TERRITORY_CONDITION_CHEST_SCALE, territoryConditionBlockLayout } from '../model/TerritoryConditionBadge';
import {
    TERRITORY_SILVER_CHEST_POP_SECONDS,
    territorySilverChestIconPop,
} from '../model/TerritorySilverChestOpen';
import { TERRITORY_EVENTS } from './TerritoryEvents';
import { TerritoryUiEvent } from '../application/TerritoryEvents';

export interface ITerritoryRandomResourceTarget {
    readonly kind: 'randomResource';
    readonly cellId: number;
}

export type TerritoryStationTarget = TerritorySite | ITerritoryRandomResourceTarget;

const { ccclass, property } = _decorator;

/**
 * 未解锁格「银币图标」的缩放。
 *
 *  写的是**节点缩放**而不是改 `contentSize`：`CaptionBg` 是 `sizeMode = CUSTOM(0)`，
 *  条件模式下 `type` 被切成 `SIMPLE` ⇒ 引擎把整帧铺满节点 ⇒ 节点宽就是图标可见宽。
 *  改 `contentSize` 会让「名称底条」分支（同一个节点、`SLICED`）跟着变形，缩放不会。
 *
 *  1.1（2026-10-16「icon 放大 1.1 倍」）→ **0.85**（2026-11-10 第二轮）：
 *  固定宝箱格要在价格行之上再放一颗宝箱，两行合起来必须**整块塞进格面 123×90**
 *  并留 1px 以上的边（用户：「保证所有 icon 和 UI 都在格子内」）。
 *  缩到 0.85 后价格行 34 高、宝箱 42.75、间距 1 ⇒ 块高 77.75，上下各留 6.1px。
 */
// 气泡内图标的尺寸 / 位置**全部**读 `model/TerritoryChestBubble`（新底图 frame_04 是
// 77×87 竖向水滴，icon 在上、数字在下）。以前这里有一对 `LEVEL_BUBBLE_ICON_SIZE/GAP`
// 给「图标 + 数字并排」用 —— 水滴气泡没有横向空间，2026-11-02 已随排版一起删掉。

export const CONDITION_ICON_SCALE = 0.85;

/** 未解锁格「数值」的缩放（1.5 → **1.2**，2026-11-10 第二轮：与银币图标一起缩，别让数字比 icon 还抢眼）。 */
export const CONDITION_VALUE_SCALE = 1.2;

/**
 * 数值左缘与银币图标右缘之间的间距（像素）。2 → **1**（2026-11-10 第二轮，缩了 icon 之后
 * 2px 会显得松，1px 正好"贴住但不叠"）。
 */
export const CONDITION_GAP = 1;

/**
 * 数值宽度的**采纳上限** —— 必须**严格小于** prefab 里 `CaptionLabel` 的出厂宽 `92`。
 *
 *  ⚠️ 引擎按文本刷新 `contentSize` 有**一帧延迟**：刚 `render` 的那一帧读到的还是出厂宽
 *  `92`（= 本上限 + 1）。真数字最长 5~6 位（`fontSize 17` 下 ≈ 50px），不可能到 91
 *  ⇒ 读到 ≥ 92 一律按「还没刷新」处理、走位数估算。
 *
 *  这套判据与 `ZCFloatTextView` 的 `TEXT_WIDTH_MAX`（出厂 240 / 上限 200）是同一套，
 *  只是那两个数换成本 prefab 的出厂宽。
 */
const CONDITION_VALUE_WIDTH_MAX = 91;

/**
 * 系统字体（`Arial`，`fontSize 17`）下**一个数字**的水平步进 —— 只兜一种情况：
 * 引擎还没把实测文本宽写回来（见 `readConditionValueWidth`）时按**位数**估一个。
 *
 *  Arial 的数字是等宽的（`0.556 em`）⇒ `17 × 0.556 ≈ 9.45`，取 9.5。
 *  ⚠️ 这**不是**第二套「文本宽真源」：能量到就用量的，这里只兜住「第一次 `render` 那一帧」
 *  （以及单测桩上没有 `UITransform` 的情况）。条件格的文案恒是 `String(silverCost)`，
 *  所以按 `string.length` 当位数是成立的。
 */
const CONDITION_DIGIT_WIDTH = 9.5;

/** `CaptionBg` 节点的出厂边长（拿不到 `UITransform` 时用来兜底；用例按它算几何）。 */
export const CONDITION_ICON_WIDTH_FALLBACK = 40;

/**
 * 建筑图标的目标**可见宽度**（美术单位）。
 *
 * 🔴 为什么需要它：`Icon` 节点是 128×128 + `sizeMode = CUSTOM(0)`，引擎把整帧铺满节点
 * ⇒ 不同画布尺寸的图**等比缩放系数不同**。实测这批美术两种规格混用：
 * `home/boss/outpost/async_pvp` 是 128×128（系数 1.0，可见 98~113px），
 * `bonus/fixed_resource/random_resource` 是 212×212（系数 0.604，可见 86~89px）
 * ⇒ 不归一则同屏建筑大小差约 25%。
 *
 * 取值历史（都按「归一后的可见宽」记）：
 *  · 100 —— 最初的值，可见高 78~89，**几乎与台面等高、顶满格子**，截图读作「建筑撑满格子 / 偏下」；
 *  · **70** —— 2026-10-15 山猫看截图压回来的值，可见高 54~63（台面高 90 的 69%），上下留呼吸；
 *  · **84** —— 2026-10-19 用户要求「当前尺寸调大 120%」（70 × 1.2 = 84）：可见高 65~75
 *    （最高的是 `async_pvp` 75.0 = 台面高的 83%），同屏所有建筑**等比**放大，比例关系不变。
 *
 * ⚠️ **判据钉的是「归一后可见宽 = 本常量」且「可见高 ≤ 台面高的 0.85」**
 * （护栏随 84 从 0.75 上调，见 `tests/territory-cell-center-align.test.ts`），
 * 换美术图只要重新量 `.meta` 的 `trimX/width` 即可，代码不用改。
 *
 * ⚠️ **导出**：开箱表演（`TerritoryChestView`）按同一个宽归一它的补帧美术 ——
 *   那是「表演里那只箱子要与地图上静止的那只同大」的唯一做法。改这里 = 同时改两处，是刻意的。
 */
export const BUILDING_VISIBLE_WIDTH = 84;

/**
 * 这一档建筑图**按「可见底边」对齐格面中心**（其余仍是「可见中心」压格面中心）。
 *
 * ## 为什么只有这批
 *
 * 归一后的对齐点默认是**透明包围盒中心** —— 那对"方块状"的东西没问题，但装饰物是**站在地上**的：
 * 树 / 树桩该有"落脚点"。用包围盒居中对齐时，高的东西会有一半沉到台面前沿以外，读起来像浮在格子上。
 *
 * ## 2026-10-27 的两次收敛（用户逐图验收，见 `docs/章节地图装饰建筑对位-69008-69015对比.png`）
 *
 *  1. 先按「69008~69015 全部底部对齐」落地；
 *  2. 用户看了逐图对位图后只留 **69010~69013 四棵棕榈树**（打勾的四张）：
 *     `69008 / 69009`（宝箱屋 / 圆顶哨站）与 `69014 / 69015`（树桩）**打叉，退回居中**
 *     —— 它们本来"重心就在中间"，底边对齐反而把本体抬高了。
 *
 * ⚠️ 这批 id 来自**随机站点抽取池**（见 `tools/map-editor/randomize_random_sites.py`），
 *    所以"只有这一批"不是随手圈的：地图上真正会出现的装饰就是它们。
 *    `decor_09…12`（草丛 / 树桩花 / 宝箱）一直是居中口径。
 *
 * ⚠️ 只影响**落点**，不影响缩放：底部对齐 = 在原有的 `trim` 补偿之上再加
 *    `可见高 × scale ÷ 2`（见 `applyIconPlacement` 的 `anchorLiftY`），
 *    再按 {@link TERRITORY_BOTTOM_ANCHOR_DROP_PX} 往下修一点。
 */
export const TERRITORY_BOTTOM_ANCHOR_BUILD_IDS: readonly number[] = [
    69010, 69011, 69012, 69013,
];

/**
 * 底部对齐那一档再**整体往下**偏的像素（`+` 是往下）。
 *
 * 三笔叠加，都是**地图像素**（= 1:1 缩放下的屏幕像素），不乘 `buildSize`：
 *  · **4px**（2026-10-27 逐图验收）：树干底下还有一圈**落地影子**，影子算进包围盒 ⇒
 *    按"可见底边"对齐时本体被抬起约 4px，用户原话「对齐中心点往下偏移 4px」；
 *  · **10px**（2026-11-12 用户，附截图圈出红框里的树）：「装饰节点是树这一类的
 *    建筑id 69010~69013 统一往下挪动10px」⇒ 在已有 4px 之上**再**整体下移 10px；
 *  · **4px**（2026-11-12 用户追加）：「还可以再往下挪4个像素」⇒ 再叠加 4px。
 * ⇒ 合计 **18px**。
 *
 * ⚠️ 位置写在父节点（地图）空间里，与 `Icon` 自身的缩放无关。改它只需要改这一个数：
 *    `applyIconPlacement`（实心建筑 + 虚影）与 `applyLevelBubblePosition`（气泡抬升）同源，
 *    站点 / 随机格 / 虚影三条渲染路径一起生效。
 */
export const TERRITORY_BOTTOM_ANCHOR_DROP_PX = 18;

/** `buildId` 是否走「底部对齐格心」那一档（非有限值一律 `false`）。 */
export function territoryUsesBottomAnchor(buildId: number): boolean {
    if (!Number.isFinite(buildId)) return false;
    return TERRITORY_BOTTOM_ANCHOR_BUILD_IDS.includes(buildId);
}

/** 站点名称底条的圆角半径（设计稿口径）。 */

/**
 * 一个站点要画出来的全部信息 —— 由 `TerritoryMapView` 把「地图数据 + 进度」算成这份**纯数据**后喂进来。
 *
 *  视图不碰 `TerritoryProgress` / `TerritoryCampaignStage`，只认这份结构 ⇒ 状态判定（是否占领 /
 *  可挑战 / 探索中）的唯一真源留在渲染层，视图可以单独测。
 */
export interface ITerritoryStationRender {
    /**
     * 这个格子对应的站点。**起始格没有站点**（地图的 `startCellId` 不是 `sites` 里的一项），
     * 传 `null` —— 它也不可点，视图不会去读。
     */
    readonly site: TerritoryStationTarget | null;
    /** 站点建筑图标；关卡编号由 levelBubble 单独传入。 */
    readonly icon: SpriteFrame | null;
    /**
     * 建筑表 `buildSize` 的大小倍率（缺省 / ≤0 一律当 1）。
     *
     *  乘在「可见宽度归一」系数**之上**，所以它只改这一张建筑相对其它建筑的体量，
     *  不影响归一化本身（`buildSize = 1` 与旧行为完全一致）。
     *  🔴 与「抖动倍率」是两个独立因子：抖动只在自己那 0.24s 内非 1，两者相乘写进节点缩放。
     */
    readonly iconScale?: number;
    /**
     * **底部对齐**：把建筑图「可见底边」抬到格面中心，而不是默认的「可见中心」压格面中心。
     *
     * 为什么需要：默认那套对齐的是**透明包围盒中心**，而装饰物（树 / 树桩 / 小屋）本来是
     * "站在地上"的 —— 用包围盒居中对齐，高的东西就有一半沉到台面前沿以外，看着像浮着。
     * 按底边对齐后，它的落脚点正好落在 2.5D 台面的中心，读作"站在格子中间"。
     *
     * 哪些建筑用这一档由 {@link territoryUsesBottomAnchor} 决定（产品口径，别散在调用方）。
     */
    readonly bottomAnchor?: boolean;
    /**
     * 未解锁格在格心显示消耗条件（银币图标 + 数值），复用底条 Sprite 与文字节点。
     *
     *  ⚠️ 条件模式会**改两个节点的缩放**（图标 ×1.1、数值 ×1.5）并把数值的 `overflow` 切成
     *  `NONE`；退出时必须还原（站点节点是池化复用的），还原在 `applyCaptionPlacement` 里，
     *  排布公式与理由也写在那儿。
     */
    readonly isCondition?: boolean;
    readonly conditionIcon?: SpriteFrame | null;
    readonly conditionTextColor?: Color;
    /**
     * 条件模式下**额外**画在价格行之上的一颗图标（2026-11-10：固定宝箱格的 `icon_baoxiang`）。
     *
     *  缺省 / `null` ⇒ 不画，排版退回「只有价格行一行」—— 非宝箱格全部走这一支，
     *  所以这里缺省时**不许**产生任何位移（见 `model/TerritoryConditionBadge`）。
     *  未解锁（前置没满足 / 还没开）的宝箱格也不传：用户口径「仍然只显示锁 icon」。
     */
    readonly conditionChestIcon?: SpriteFrame | null;
    /** 仅条件模式显示银币消耗数值。 */
    readonly caption: string;
    /** 站点状态色。 */
    readonly tint: Color;
    /** 站点角标已停用，调用方传空串。 */
    readonly badge: string;
    /**
     * 已解锁关卡的短编号气泡，缺省不显示。
     *
     * 2026-11-02 起同一个气泡还有**第二种用法**：固定奖励宝箱的「体力 icon + 消耗数」提示
     * （此时 {@link levelBubbleIcon} 非空，文字就是消耗数，如 `'1'`）。
     */
    readonly levelBubble?: string;
    /**
     * 气泡内**上方的图标**（2026-11-02：固定宝箱提示 = 体力 icon + 数量值）。
     *
     * 缺省 / `null` ⇒ 退回纯文字气泡（关卡编号那套，文字居中）；给了图 ⇒ 换成
     * **竖向两行**：icon 在上、数字在下，各自水平居中（位置见 `model/TerritoryChestBubble`，
     * 由 `applyLevelBubbleLayout` 落位）。2026-11-02 用户定稿：宝箱气泡底图换 `frame_04`，
     * 内部按美术稿改成这种上下排版 —— 旧的「图标 + 数字并排」在 77 宽的水滴里放不下。
     */
    readonly levelBubbleIcon?: SpriteFrame | null;
    readonly levelBubbleFrame?: SpriteFrame | null;
    /**
     * **预告关卡**的编号气泡（2026-11-11）。这一格仍是「未解锁」画法（`icon: null` +
     * `isCondition: true`），但气泡要照常显示 ⇒ `renderLevelBubble` 对这一支放宽
     * 「必须有实心建筑 / 不能是条件格」两道门槛。**只有承载格**会传 true
     * （判据在 `TerritoryMapView.stationRenderOf`，整关 footprint 只挂一颗）。
     */
    readonly previewBubble?: boolean;
    /**
     * 预告气泡的**锚点帧** = 35% 虚影用的那张建筑图。
     *
     * `icon` 是 null（不画实心建筑），`applyLevelBubblePosition` 原本按「没有建筑」把
     * 气泡压在格心，会盖住虚影和价格。传这张帧给视图按虚影的可见高抬起，
     * 与 `syncGhosts` / `renderGhost` 用的是同一个 `stationIconOf` 结果。
     */
    readonly levelBubbleAnchorFrame?: SpriteFrame | null;
    /**
     * 气泡文字的**覆盖色**（缺省 = 按底图那套默认色：宝箱深棕 / 编号白）。
     *
     * 目前只有一个用途：体力不够时把宝箱气泡里的消耗数染红（用户 2026-11-03
     * 「体力不足或银币不足时，**对应的**数字 UI 显示红色」）。
     *
     * ⚠️ 每帧都要重新判：`themeLevelBubbleLabel` 每次都会把颜色写回默认值
     * （气泡是同一个 Label 复用，宝箱/编号两套来回切），所以覆盖必须排在它**之后**。
     */
    readonly levelBubbleTextColor?: Color;
    /**
     * 这一格是**章节入口**（地图起始格的章节建筑 + 它头上那颗「章节」气泡）。
     *
     * 需求 2026-11-03：点它打开「章节选择」弹窗（原来挂在快速寻敌两侧的三角上）。
     * `site` 恒为 `null`（起始格不属于任何站点）⇒ 点击走 `TerritoryUiEvent.ChapterSelect`，
     * 不进 `STATION_TAP` 那条链。
     */
    readonly chapterEntry?: boolean;
    readonly interactive: boolean;
    readonly isLoading?: boolean;
    /**
     * 本帧**整站不显示**（照常摆位、照常算缩放，只是没有可见的节点）。
     *
     * 需求（2026-10-16 row14）：「建筑展示的时间需要**滞后**，等待地块反转结束」
     * —— 随机资源格翻开的**那一帧**数据上就已经是「已开启」，但地块还在翻转；
     * 建筑必须等翻转播完才冒出来（何时解除由 `TerritoryMapView` 决定）。
     *
     * ⚠️ 也不能靠 `this.node.active = false`：四个视觉节点在 `initialize` 里被
     *  **reparent 到共享 layer** 上了（站点根节点只剩命中区），关根节点只关掉点击、
     *  视觉照旧留在屏幕上。
     */
    readonly hidden?: boolean;
}

/** Shared render layers keep identical station materials contiguous for UI batching. */
export interface ITerritoryStationLayers {
    readonly icon: Node;
    readonly caption: Node;
    readonly text: Node;
    readonly badge: Node;
    readonly hit: Node;
}

/**
 * 领地地图上的一个站点条目，由 `ui/territory/TerritoryStation.prefab` 拥有。
 *
 *  节点树 / 尺寸 / 锚点全在 prefab 里（旧实现是 `TerritoryPage.stationNode()` 用
 *  `new Node` + `addComponent` 现搭）；本类只负责「换图 + 写文案 + 上色 + 交互开关」。
 *
 *  ⚠️ **站点节点是池化复用的**（`TerritoryMapView` 按 cellId 借还）⇒ 两条硬约束：
 *  1. 点击回调里**不能闭包捕获本趟的 site**，必须读 `this.site`（每次 render 更新）——
 *     否则槽位复用到别的站点后，点它会打开上一个站点的详情（且不报错）。
 *  2. `render` 必须**全量幂等赋值**，不能依赖上一次的状态（同一个节点会被不同站点复用）。
 */
@ccclass('TerritoryStationView')
export class TerritoryStationView extends Component {
    @property({ type: Button, group: '节点引用', tooltip: '根节点上的 Button（过渡用 SCALE，命中即整个站点）' })
    button: Button = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：站点图标（主城 / 前哨 / 首领）' })
    iconSprite: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'CaptionBg：未解锁时显示消耗图标，缺少建筑图时作为名称底条' })
    captionSprite: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'CaptionLabel：未解锁时显示消耗数值，缺少建筑图时显示名称' })
    captionLabel: Label = null;

    @property({ type: Label, group: '节点引用', tooltip: 'BadgeLabel：已解锁关卡编号气泡文字' })
    badgeLabel: Label = null;

    /** `Icon` 的 `UITransform`（面板拖拽绑定，勿 `getComponent`）：固定 128×128，供可见宽度归一。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'Icon 的 UITransform（128×128）' })
    iconTransform: UITransform = null;

    /** `CaptionBg`（银币图标）的 `UITransform`：条件格排布读宽（40×40）。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'CaptionBg 的 UITransform（40×40）' })
    captionIconTransform: UITransform = null;

    /** `CaptionLabel`（数值）的 `UITransform`：条件模式读实测文本宽（`readConditionValueWidth`）；名称底条模式 92×28。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'CaptionLabel 的 UITransform（条件格实测文本宽）' })
    captionTextTransform: UITransform = null;

    /** 当前节点代表的站点；点击时读它，不读闭包。起始格为 `null`。 */
    private site: TerritoryStationTarget | null = null;
    /**
     * 这一格是「章节」入口（地图上的章节建筑，以及它头上那颗「章节」气泡）。
     *
     * 需求 2026-11-03：章节选择弹窗的打开按钮改成它（原来挂在快速寻敌两侧的三角上）。
     * 它与 `site` 互斥 —— 起始格不属于任何站点（`site === null`），所以点击要走另一条事件。
     */
    private chapterEntry = false;
    /** 起始格 `false`（不可点，不发点击事件）；常规站点 `true`。 */
    private clickable = true;
    private localOffsets: Readonly<{
        icon: Vec3;
        caption: Vec3;
        text: Vec3;
        badge: Vec3;
    }> | null = null;
    private defaultCaptionFrame: SpriteFrame | null = null;
    private defaultCaptionType = Sprite.Type.SLICED;
    /** `CaptionLabel` 的出厂 `overflow`（`initialize` 里抄下来，退出条件模式时要还回去）。 */
    private defaultCaptionOverflow = 0;
    private defaultCaptionTextColor: Color | null = null;
    private isDisposed = false;
    /** 地图格心（`TerritoryMapView.cellCenter` 的返回值）；建筑图标要对着它居中，故存在这里。 */
    private mapX = 0;
    private mapY = 0;
    private mapZ = 0;
    private levelBubble: { readonly node: Node; readonly sprite: Sprite; readonly button: Button } | null = null;
    /** 气泡里的那个图标节点（`levelBubbleIcon` 有值时惰性创建；复用同一个节点）。 */
    private levelBubbleIcon: { readonly node: Node; readonly sprite: Sprite } | null = null;
    /**
     * 上一次 `render` 的入参 —— 只给「气泡抑制解除后按原样重画」用。
     *
     *  ⚠️ 站点每秒才被 `syncStations` 刷一次，而跳跳动只有 1.5s：不存这一份，
     *  动画播完的气泡要等下一轮刷新才回来（最长 1s 的空窗，看着像"气泡被动画吃掉了"）。
     */
    private lastContent: ITerritoryStationRender | null = null;
    /**
     * 宝箱「还没点我」跳动的**纵向偏移**（地图像素，正数向上）。
     *
     *  由 `TerritoryMapView` 每帧推进曲线后写进来（视图不认识曲线，也不持有秒表 ——
     *  一张图上百个站点，每个都挂一根时钟没必要）。
     */
    private chestHintOffsetY = 0;
    /** 跳动期间**抑制提示气泡**（需求 2026-11-02 第 3 条）。 */
    private hintBubbleSuppressed = false;
    /** 本帧预告气泡的锚点帧（`renderLevelBubble` 每帧写入；池化复用时不许留上一格的值）。 */
    private levelBubbleAnchorFrame: SpriteFrame | null = null;
    /** `Icon` 节点**未叠加跳动偏移**时的位置（`applyIconPlacement` 写，`writeIconPosition` 加偏移）。 */
    private iconBaseX = 0;
    private iconBaseY = 0;
    private iconBaseZ = 0;
    private spawnOpacity = 1;
    /**
    /**
     * 上一次 `render` 是否走「未解锁条件」分支。
     *
     *  `setMapPosition` 每秒对全部站点跑一遍，必须按**同一口径**重新摆位（条件格是「成对居中」，
     *  规则格是 prefab 偏移），所以要记住当前处在哪一支。
     */
    private conditionMode = false;
    /**
     * 「银币图标 + 数字」的**生成缩放系数**（`0 ~ 1` 之外还能过冲，见
     * `model/TerritoryUnlockTransition`）—— 给「未解锁 → 可激活」那 1s 过渡用（2026-11-09）。
     *
     *  缺省 1 = 完全展开。由 `TerritoryMapView` 每帧经 {@link setConditionSpawnScale} 推进；
     *  视图自己不认识曲线、也不持有秒表（同 `chestHintOffsetY` 那套分工）。
     *
     *  ⚠️ 与两个基准缩放是**乘法**关系（`CONDITION_ICON_SCALE × 本值`），不是替换 ——
     *  否则动画结束时会落在错误尺寸上。退出条件模式时强制回 1（见 `render`）：
     *  站点节点池化复用，别把 0.3 倍的缩放带给下一格。
     */
    private conditionSpawnScale = 1;
    /**
     * 条件模式下价格行**之上**的那颗图标节点（`icon_baoxiang`，2026-11-10）。
     *
     *  惰性创建、复用同一个节点（同 `levelBubble` 那套）：不是每个站点格都有它，
     *  而站点节点是**池化复用**的 ⇒ 建一次就够，换格只换帧 / 改显隐。
     *
     *  挂在 `StationCaptionLayer`（= 银币图标的父层）：视觉上压在建筑 / 虚影之上，
     *  又在关卡编号气泡与锁标之下，与价格行同一层。
     */
    private conditionChest: {
        readonly node: Node;
        readonly sprite: Sprite;
        readonly transform: UITransform;
    } | null = null;
    /**
     * 上面那颗宝箱图标的**未缩放**高度（这一格没有宝箱时为 0）。
     *
     *  `applyCaptionPlacement` 用它算竖直块的高度；写 0 就等于告诉排版函数「按单行摆」
     *  —— 这正是非宝箱格与旧版逐像素一致的原因。
     */
    private conditionChestHeight = 0;

    /**
     * `Icon` 的**基准**缩放 —— `applyIconPlacement` 算出的「可见宽度归一化」系数。
     *
     *  抖动的因子（见 {@link buildingShakeX}）乘在它上面而不是替换它，
     *  所以「归一化」与「抖动」互不干扰：抖完落回的就是这张建筑图该有的尺寸。
     */
    private iconBaseScale = 1;
    /**
     * 建筑表 `buildSize` 的大小倍率（`render` 每帧从 `content.iconScale` 写入，缺省 1）。
     *
     *  乘进 {@link iconBaseScale}（`applyIconScale` 的入参），所以在抖动与归一化之外，
     *  只表达「这个建筑本身该比标准大/小多少」。
     */
    private iconSizeScale = 1;
    /**
     * 这一格是否走**底部对齐**（`render` 每帧从 `content.bottomAnchor` 写入，缺省 `false`）。
     *
     * 与非 `null` 的 `iconSizeScale` 一样：站点节点是池化复用的，**每帧都必须重写** ——
     * 漏写就会让上一格的"底部对齐"留在这一格上（表现为这一格的建筑莫名往上跳）。
     */
    private bottomAnchored = false;
    /**
     * 建筑生成抖动对缩放的**倍率**（x / y 分开）—— 需求要「先 Y 后 X」两段，所以不能合成一个数。
     *
     *  非抖动期恒 1（写出来的就是纯基准缩放）。曲线真源见 `core/hex/ShakePresentation`
     *  （与对局 `ZCHexView.playBuildingShake` 同一条脉冲、同一档 120%）。
     */
    private buildingShakeX = 1;
    private buildingShakeY = 1;
    /**
     * 抖动的「已用时（秒）」；`< 0` = 当前没在抖。
     *
     * 🔴 用**负数当停表标记**而不是 `null`：`update` 每帧都要读它，`null` 会多一次判定分支，
     * 且这个类每张地图会有上百个实例（早退分支只做一次数值比较）。
     * ⚠️ 「已用时」是**自己累加 `dt`** 的，不是时间戳 —— 站点视图没有对局那套
     *  `presentation.now`，也没必要为了一个 0.24s 的抖动再引一条时钟。
     */
    private buildingShakeElapsed = -1;

    /**
     * 「银币宝箱」独立打开动画的**已用时（秒）**；`< 0` = 没在播（与抖动同一套停表标记）。
     *
     * 2026-11-10：银币宝箱（`rewardId=1023` / `coinBox` 蓝银箱）不复用卡牌宝箱的
     * `chest_seq_*` 开盖表演，改为让**地图上这颗 icon 自己**放大 → 缩小 → 消失。
     * 曲线真源在 `model/TerritorySilverChestOpen`（纯函数），这里只按帧写缩放。
     */
    private silverChestPopElapsed = -1;
    /**
     * 退场期间的**帧快照**。
     *
     * 🔴 领取回包一到，`stationRenderOf` 立刻把这一格的 `icon` 置 `null`（宝箱从地图消失）。
     *    不快照就会「动画还没起手，箱子先没了」。退场期间 `render` 用这张快照顶替 `content.icon`。
     */
    private silverChestPopFrame: SpriteFrame | null = null;
    /** 起播那一刻的 `cellId`：站点节点池化复用，换格必须立刻收掉动画（见 `render`）。 */
    private silverChestPopCellId: number | null = null;
    /** 本帧的 pop 系数，乘进 `Icon` 的基准缩放（非退场期恒 1）。 */
    private silverChestPopScale = 1;

    /**
     * 「新地块生成」期间整站乘透明度用的四个 `UIOpacity`（`Icon` / `CaptionBg` / `CaptionLabel` /
     * `Badge`）。惰性创建：只有真播过生成动画的格子才会有，没播过的格子零开销。
     */
    private spawnOpacities: UIOpacity[] | null = null;

    /**
     * 绑一次点击（`TerritoryMapView` 在借出节点时调；起始格不传 `clickable`）。
     *
     * 点击不再经回调转发：`handleClick` 在**本站点节点**上发 `TERRITORY_EVENTS.STATION_CLICK`，
     * 由 `TerritoryMapView` 监听后转发到 `mapView.node`（监听随站点节点销毁自动清理）。
     * 起始格（`clickable = false`）不发事件 —— 且其 `render` 里 `interactive: false`
     * 双保险关掉 `cc.Button` 的点击。
     */
    initialize(layers: ITerritoryStationLayers, clickable = true): void {
        this.clickable = clickable;
        if (this.isDisposed) return;
        this.localOffsets = {
            icon: this.iconSprite.node.position.clone(),
            caption: this.captionSprite.node.position.clone(),
            text: this.captionLabel.node.position.clone(),
            badge: this.badgeLabel.node.position.clone(),
        };
        this.defaultCaptionFrame = this.captionSprite.spriteFrame;
        this.defaultCaptionType = this.captionSprite.type;
        this.defaultCaptionOverflow = this.captionLabel.overflow;
        this.defaultCaptionTextColor = this.captionLabel.color.clone();
        // 三个 `UITransform` 都是**面板拖拽绑定**的 `@property`（prefab 序列化），不在这里 getComponent。
        this.node.setParent(layers.hit);
        this.iconSprite.node.setParent(layers.icon);
        this.captionSprite.node.setParent(layers.caption);
        this.captionLabel.node.setParent(layers.text);
        this.badgeLabel.node.setParent(layers.badge);
        this.button.node.on(Button.EventType.CLICK, this.handleClick, this);
    }

    setMapPosition(x: number, y: number, z = 0): void {
        this.mapX = x;
        this.mapY = y;
        this.mapZ = z;
        this.node.setPosition(x, y, z);
        const offsets = this.localOffsets;
        if (!offsets) return;
        this.applyIconPlacement();
        this.applyCaptionPlacement();
        if (this.levelBubble) this.applyLevelBubblePosition();
        else this.badgeLabel.node.setPosition(x + offsets.badge.x, y + offsets.badge.y, z + offsets.badge.z);
    }

    /**
     * 整站统一透明度（`0 ~ 1`）—— 给「新地块生成」动画用（2026-10-22）。
     *
     * 为什么不能靠格节点上的 `UIOpacity`：这四个视觉节点在 `initialize` 里被挂到了
     * **四个不同的层**（`StationIconLayer` / `CaptionLayer` / `TextLayer` / `BadgeLayer`），
     * 都不在格节点底下 ⇒ 格节点淡多少都管不到它们。而层节点是**多格共享**的容器，
     * 也不能在层上写透明度（会连累同层其它站点）。
     * 所以只能一格一份：每个节点各自懒加一个 `UIOpacity`（一格最多 5 个 —— 第 5 个是
     * 宝箱图标，2026-11-10 起才有，且只有真正播过生成动画的格子才会有）。
     *
     * ⚠️ 与 `render` 的显隐（`active`）正交：不透明度管「淡」，`active` 管「有没有」，
     *    两者互不覆盖，所以每秒一次的全量 `render` 不会把淡入状态顶掉。
     */
    setSpawnOpacity(value: number): void {
        if (this.isDisposed) return;
        const raw = Number.isFinite(value) ? value : 1;
        const target = Math.round((raw > 1 ? 1 : raw < 0 ? 0 : raw) * 255);
        this.spawnOpacity = target / 255;
        const nodes = [
            this.iconSprite.node,
            this.captionSprite.node,
            this.captionLabel.node,
            this.levelBubble?.node ?? this.badgeLabel.node,
            // 宝箱图标（2026-11-10）惰性建 ⇒ 建的时候会把 `spawnOpacities` 置空重建，顺序不能挪到后面。
            ...(this.conditionChest ? [this.conditionChest.node] : []),
        ];
        if (!this.spawnOpacities) {
            this.spawnOpacities = nodes.map((node) => node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity));
        }
        for (const opacity of this.spawnOpacities) {
            if (opacity.opacity !== target) opacity.opacity = target;
        }
    }

    /**
     * 「建筑虚影」透明度（`0 ~ 1`，只写 `Icon` 节点）—— 给**提前披露**关卡的虚影视图用（2026-11-09）。
     *
     * 需求：`未解锁 = 地块 + 锁 + 虚影`、`可激活 = 虚影 + 价格`、`已激活 = 实心建筑`，
     * 虚影恒为 **35%**；已激活那一下 0.2s 淡出（底下那层实心建筑自有生成淡入，合成即「淡入」）。
     *
     * 与 {@link setSpawnOpacity} 分工，互不覆盖：
     *  · 那个是**生成动画**的逐帧整站淡入，每帧被 `hexSpawn` 回调重写，管四个节点；
     *  · 这个只管 `Icon` 一颗，且只作用在**独立的虚影视图**上 —— 虚影视图不在 `stationViews`
     *    里，永远收不到生成回调，所以两者不会抢同一个 `UIOpacity`。
     */
    setGhostOpacity(value: number): void {
        if (this.isDisposed) return;
        const node = this.iconSprite.node;
        const opacity = node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity);
        const raw = Number.isFinite(value) ? value : 1;
        const target = Math.round((raw > 1 ? 1 : raw < 0 ? 0 : raw) * 255);
        if (opacity.opacity !== target) opacity.opacity = target;
    }

    /**
     * 「银币图标 + 数字」的**生成缩放**（`0 ~ 1.15 ~ 1`，见 `model/TerritoryUnlockTransition`）。
     *
     * 需求（2026-11-09）：「银币和数字 UI 生成动画，总时间 1s」—— 与锁那 1s **同时起手**。
     *
     * 为什么缩放而不是透明度：两颗节点的**位置**是按实测文本宽算出来的（见
     * `applyCaptionPlacement`），改透明度只会淡入、读不出"生成"；而绕各自中心缩放
     * 不动排版，也不会撞上 `setSpawnOpacity` 的语义（那个是"地块还在长"的半透明态）。
     *
     * ⚠️ 只在条件模式生效：非条件模式的这两颗节点是**名称底条**，缩放由
     *    `applyCaptionPlacement` 钉死成 1（那里会先把系数写回 1，见 `render`）。
     * ⚠️ 位置**不跟着缩**：两颗各自绕中心长大，合起来的观感就是"整条价格从中间长出来"；
     *    按缩放后的宽度重排位置反而会让它在放大时左右乱窜。
     */
    setConditionSpawnScale(scale: number): void {
        if (this.isDisposed) return;
        const next = Number.isFinite(scale) && scale > 0 ? scale : 0;
        if (this.conditionSpawnScale === next) return;
        this.conditionSpawnScale = next;
        if (!this.conditionMode) return;
        this.applyCaptionScale(this.captionSprite.node, CONDITION_ICON_SCALE * next);
        this.applyCaptionScale(this.captionLabel.node, CONDITION_VALUE_SCALE * next);
        // 宝箱图标同属这块条件标注 ⇒ 一起"生成"，基准缩放是 0.95（不是 1）。
        const chest = this.conditionChest;
        if (chest) this.applyCaptionScale(chest.node, TERRITORY_CONDITION_CHEST_SCALE * next);
    }

    /**
     * 建筑图标的**缩放 + 落点**（唯一写入口，`setMapPosition` 与 `render` 都走它）。
     *
     * ## 要解决两件事
     *
     * 1. **可见宽度归一**：`Icon` 节点固定 128×128 且 `sizeMode = CUSTOM` ⇒ 引擎按
     *    「节点尺寸 ÷ 帧画布尺寸」等比铺满（`simple.ts` 的 `updateVertexData`
     *    用 `cw / frame.originalSize.width`）。这批美术画布有 128 与 212 两种
     *    ⇒ 212 的被压到 0.604，同屏建筑大小差 25%。这里按 **trim 后可见宽度**
     *    反算缩放，让所有建筑实际显示宽度一致。
     *
     * 2. **trim 偏移补偿**：美术留白不对称时，可见区的中心并不在画布中心。
     *    引擎把整块画布居中于节点，可见区就跟着偏（实测 `outpost_v1` 偏上 5px、
     *    `bonus_v1` 偏上 9px）⇒ 同类建筑高低不齐。这里把偏移量抵消掉。
     *
     * ## 公式（与引擎 `updateVertexData` 对齐，trim = false 分支）
     *
     * ```
     * scaleX = nodeW / frame.originalSize.width     // 引擎的画布→节点映射
     * 可见宽 = frame.rect.width * scaleX
     * 目标缩放 k = BUILDING_VISIBLE_WIDTH / 可见宽
     * 可见中心偏移 = frame.offset * scaleX * k
     * ```
     *
     * ⚠️ **进动态合批安全**：合批只改写 `rect.x/y` 与 `texture`
     * （见引擎 `_resetDynamicAtlasFrame`，它只还原 `_rect.x/_rect.y/_texture`），
     * `rect.width/height`、`originalSize`、`offset` 全程不变 ⇒ 这里读的值前后一致。
     */
    private applyIconPlacement(): void {
        const offsets = this.localOffsets;
        const node = this.iconSprite.node;
        const frame = this.iconSprite.spriteFrame;
        if (!offsets) return;
        const nodeSize = this.iconTransform.contentSize;
        if (!(nodeSize.width > 0) || !(nodeSize.height > 0)) {
            this.setIconBase(this.mapX + offsets.icon.x, this.mapY + offsets.icon.y, this.mapZ + offsets.icon.z);
            return;
        }
        const canvas = frame?.originalSize;
        const trimmed = frame?.rect;
        // 帧缺失 / 画布或 trim 区尺寸非法（0）时，退回「只摆位置、不缩放」，不产出 NaN。
        if (!frame || !canvas || !trimmed || !(canvas.width > 0) || !(trimmed.width > 0)) {
            this.applyIconScale(1);
            this.setIconBase(this.mapX + offsets.icon.x, this.mapY + offsets.icon.y, this.mapZ + offsets.icon.z);
            return;
        }
        const canvasScaleX = nodeSize.width / canvas.width;
        const canvasScaleY = nodeSize.height / canvas.height;
        const visibleWidth = trimmed.width * canvasScaleX;
        // 归一系数（所有建筑可见宽一致）× `buildSize`（表里「模型大小」，这张图本身的体量倍率）。
        // 两者相乘：`buildSize = 1` 时与旧行为逐像素一致，>1 变大、<1 变小。
        const scale = (visibleWidth > 0 ? BUILDING_VISIBLE_WIDTH / visibleWidth : 1) * this.iconSizeScale;
        // 抵消 trim 偏移：可见区中心 = 节点中心 + offset * canvasScale * k
        const shiftX = frame.offset.x * canvasScaleX * scale;
        const shiftY = frame.offset.y * canvasScaleY * scale;
        // 底部对齐那一档：把可见区**整体上抬半个可见高** ⇒ 可见底边从"格心下方半步"变成"正好落在格心"。
        // 推导：可见中心原本被摆在格心，底边就在 格心 − 可见高/2；
        //       要让底边 = 格心，节点得再上抬 可见高/2（缩放后）。
        // 再减 `TERRITORY_BOTTOM_ANCHOR_DROP_PX`（4px 影子补偿 + 10px + 4px = 18px）：
        // 三笔都是地图像素，不乘 scale / buildSize。
        const visibleHeight = trimmed.height * canvasScaleY;
        const anchorLiftY = this.bottomAnchored
            ? visibleHeight * scale * 0.5 - TERRITORY_BOTTOM_ANCHOR_DROP_PX
            : 0;
        this.applyIconScale(scale);
        this.setIconBase(
            this.mapX + offsets.icon.x - shiftX,
            this.mapY + offsets.icon.y - shiftY + anchorLiftY,
            this.mapZ + offsets.icon.z,
        );
    }

    /**
     * 写 `Icon` 的**基准**缩放（`applyIconPlacement` 的唯一出口，与它的位置写入同源）。
     *
     *  ⚠️ 这里只**记账**，真正落到节点的是 {@link writeIconScale} —— 最终写进去的是
     *  `基准 × 抖动因子`。拆成两步是因为抖动因子按帧变、基准只在换帧 / 摆位时变，
     *  两条路径都要能各自触发一次写入。
     */
    /**
     * 记录 `Icon` 的**基准位置**并落到节点上（跳动偏移叠在基准之上）。
     *
     *  ⚠️ 这是 `Icon` 位置的**唯一出口**：`applyIconPlacement` 的三条分支只负责算出基准，
     *  真正 `setPosition` 只在这里发生 —— 否则跳动期间随便一次重排位（每秒都会来一次）
     *  就会把偏移抹掉，表现为「宝箱跳一下、被刷新一按就停在地上」。
     */
    private setIconBase(x: number, y: number, z: number): void {
        this.iconBaseX = x;
        this.iconBaseY = y;
        this.iconBaseZ = z;
        this.writeIconPosition();
    }

    /** 基准位置 + 跳动偏移 ⇒ 节点位置（同值不写，避免整层标脏）。 */
    private writeIconPosition(): void {
        const node = this.iconSprite.node;
        const y = this.iconBaseY + this.chestHintOffsetY;
        const current = node.position;
        if (current && current.x === this.iconBaseX && current.y === y && current.z === this.iconBaseZ) return;
        node.setPosition(this.iconBaseX, y, this.iconBaseZ);
    }

    /**
     * 宝箱「还没点我」的跳动偏移（需求 2026-11-02 第 3 条）—— 由 `TerritoryMapView` 每帧推。
     *
     *  曲线在 `model/TerritoryChestHint.territoryChestHintBounceOffset`（纯函数、可单测），
     *  视图只负责把这一帧的偏移写到节点上。非法值（NaN）按 0 处理：写进坐标就是整只宝箱消失，
     *  而且零报错。
     */
    setChestHintOffset(offsetY: number): void {
        const next = Number.isFinite(offsetY) ? offsetY : 0;
        if (this.chestHintOffsetY === next) return;
        this.chestHintOffsetY = next;
        this.writeIconPosition();
    }

    /**
     * 跳动期间**隐藏提示气泡**（需求 2026-11-02 第 3 条：「播放动画时隐藏宝箱的提示气泡」）。
     *
     *  ⚠️ 必须走开关而不是直接把气泡 `node.active = false`：站点每秒会被 `syncStations` 重画一次，
     *  直接关节点会在下一轮刷新时被**重新打开**（动画还在播，气泡却回来了）。
     */
    setHintBubbleSuppressed(suppressed: boolean): void {
        if (this.hintBubbleSuppressed === suppressed) return;
        this.hintBubbleSuppressed = suppressed;
        if (this.lastContent) this.renderLevelBubble(this.lastContent);
    }

    private applyIconScale(scale: number): void {
        this.iconBaseScale = scale;
        this.writeIconScale();
    }

    /**
     * 把「基准缩放 × 抖动因子」写进 `Icon` 节点（**唯一落到引擎的出口**）。
     */
    private writeIconScale(): void {
        const node = this.iconSprite.node;
        // 三个独立因子，互不覆盖：归一基准 × 建筑生成抖动 × 银币宝箱退场 pop。
        // pop 只在这里落节点，退场期间 `render` 每来一次都会重算一遍，系数不会丢。
        const pop = this.silverChestPopScale;
        const scaleX = this.iconBaseScale * this.buildingShakeX * pop;
        const scaleY = this.iconBaseScale * this.buildingShakeY * pop;
        // 同值不写：站点每秒刷新一次，避免把整棵 layer 标脏（领地滑动的性能口径）。
        const current = node.scale;
        if (current && current.x === scaleX && current.y === scaleY) return;
        node.setScale(scaleX, scaleY, 1);
    }

    /**
     * 登记一次**建筑生成抖动**（需求 2026-10-16 row14：「建筑生成增加**类似战斗系统**的
     * 建筑抖动效果」）。
     *
     *  与对局 `ZCHexView.playBuildingShake` 是**同一条脉冲**（`core/hex/ShakePresentation`）、
     *  同一档拉伸量 `BUILDING_SHAKE_STRETCH`（120%）—— 区别只在推进方式：
     *  对局由渲染世界每帧调 `advanceBuildingShake(now)`（对局的静态渲染是 0.15s 节流，
     *  播不出 0.24s 的抖动），这里由本组件自己的 `update(dt)` 推进（站点视图本来就是每帧的）。
     *
     *  只记起点 + 清因子；曲线与推进都在 `update` 里，不建 tween。
     *  ⚠️ **起点重置为 0 号相位**：连续两次触发离得近时，后一次要从头播，不能接着上一段的尾巴
     *  （与对局那句「起点重置为 1 号相位」同义）。
     */
    playBuildingShake(): void {
        this.buildingShakeElapsed = 0;
        this.buildingShakeX = 1;
        this.buildingShakeY = 1;
    }

    /**
     * 起播「**银币宝箱**」的独立打开动画（icon 放大 → 缩小 → 消失，2026-11-10）。
     *
     *  🔴 必须**在领取回包重绘之前**调：回包一到 `stationRenderOf` 就把 `icon` 置 `null`，
     *    这里会快照当前帧，退场期间 `render` 用快照顶替 `content.icon`，动画才有东西可缩。
     *
     * @returns `false` = 这一刻没有可播的宝箱图（视图还没建 / 已销毁 / 格子已空）。
     *          ⚠️ 调用方只把它当「表演没播起来」，**奖励结算绝不能挂在这个返回值上**。
     */
    playSilverChestIconPop(): boolean {
        if (this.isDisposed) return false;
        const frame = this.iconSprite.spriteFrame;
        const cellId = this.site ? this.site.cellId : null;
        // 没有宝箱图 / 这一格还没绑 `cellId`（单测桩 / 站点刚建）⇒ 不演，也不留半套状态。
        if (!frame || !Number.isFinite(cellId)) return false;
        this.silverChestPopFrame = frame;
        this.silverChestPopCellId = cellId;
        this.silverChestPopElapsed = 0;
        this.silverChestPopScale = territorySilverChestIconPop(0);
        this.writeIconScale();
        return true;
    }

    /**
     * 逐帧推进建筑抖动 + 银币宝箱退场。两条秒表各自独立，共用一次 `isDisposed` 早退
     * （一张地图上百个站点，没在播时总开销只是一次判断 + 两次数值比较）。
     *
     *  播完都**显式复位**到 1：否则节点会停在拉长 / 缩到 0 的姿态 —— 没有别的地方会把它改回来，
     *  池化复用时会把 0 尺寸带给下一格。
     */
    update(deltaTime: number): void {
        // ⚠️ `isDisposed` 也要挡：`dispose()` 会把四个视觉节点当场 `destroy()`，
        //    而站点根节点是**帧末**才销毁的 ⇒ 不挡就会对已销毁的节点写缩放。
        if (this.isDisposed) return;
        this.stepSilverChestPop(deltaTime);
        if (this.buildingShakeElapsed < 0) return;
        const elapsed = this.buildingShakeElapsed + deltaTime;
        if (elapsed >= SPAWN_SHAKE_TOTAL_SECONDS) {
            this.buildingShakeElapsed = -1;
            this.buildingShakeX = 1;
            this.buildingShakeY = 1;
            this.writeIconScale();
            return;
        }
        this.buildingShakeElapsed = elapsed;
        this.buildingShakeX = spawnShakeScaleX(elapsed, BUILDING_SHAKE_STRETCH);
        this.buildingShakeY = spawnShakeScaleY(elapsed, BUILDING_SHAKE_STRETCH);
        this.writeIconScale();
    }

    /** 银币宝箱退场的逐帧推进；没在播时一次数值比较就早退。 */
    private stepSilverChestPop(deltaTime: number): void {
        if (this.silverChestPopElapsed < 0) return;
        const step = Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;
        const elapsed = this.silverChestPopElapsed + step;
        if (elapsed >= TERRITORY_SILVER_CHEST_POP_SECONDS) {
            // 🔴 先停表再重绘：顺序反了 `render` 又会把快照帧贴回去，节点永远收不掉。
            this.resetSilverChestPop();
            // 最后一帧的 `content.icon` 已是 `null`（已领取）⇒ 这次重绘才是真正让宝箱消失。
            if (this.lastContent) this.render(this.lastContent);
            return;
        }
        this.silverChestPopElapsed = elapsed;
        this.silverChestPopScale = territorySilverChestIconPop(elapsed);
        this.writeIconScale();
    }

    /** pop 停表 + 复位（播完 / 换格 / 销毁共用）。只清数值，节点由随后那次 `render` 写回。 */
    private resetSilverChestPop(): void {
        this.silverChestPopElapsed = -1;
        this.silverChestPopFrame = null;
        this.silverChestPopCellId = null;
        this.silverChestPopScale = 1;
    }

    /**
     * 未解锁格「银币图标 + 数值」的成对排布（**唯一写入口**，`render` 与 `setMapPosition` 都走它）。
     *
     * 需求（2026-10-16 冒险模块 UI 优化）：**图标放大 1.1 倍、数字放大 1.5 倍、两者间隔 2 像素**。
     * ⚠️ 2026-11-10 用户第二轮整体缩小（图标 0.85 / 数字 1.2 / 间距 1）—— 以 `CONDITION_*` 常量为准，
     * 下面公式里的数字只是举例，别照着写死。
     *
     * ## 为什么间距不能再写成两个「固定偏移」
     *
     * 旧实现是两个常量（图标中心 `−24`、数值中心 `+22`，见 git 历史）：间距由**两者的实际宽度
     * 隐式决定**，而数字从「9」变到「1200」时框宽不变、字数变多 ⇒ 间距自己会漂，钉不住常量间距。
     * 要精确到像素就必须按**实测文本宽**算 —— 这与 `ZCFloatTextView.renderGoldIcon` 是同一套口径
     * （那边是 `GOLD_ICON_GAP`），本文件只是把「图标在数字左侧」搬到了领地站点上。
     *
     * ## 排布公式（两个节点的锚点都是 `(0.5, 0.5)`）
     *
     * ```
     * 图标可见宽 = CaptionBg 节点宽 × CONDITION_ICON_SCALE    // SIMPLE + CUSTOM ⇒ 帧铺满节点，节点宽就是可见宽
     * 数值可见宽 = Label 实测文本宽 × CONDITION_VALUE_SCALE    // 见 readConditionValueWidth
     * 总宽       = 图标宽 + CONDITION_GAP + 数值宽
     * 图标中心 x = −总宽 / 2 + 图标宽 / 2
     * 数值中心 x = +总宽 / 2 − 数值宽 / 2
     * ```
     *
     * ⇒ 图标右缘与数值左缘正好相距 `CONDITION_GAP`，且这一对**以格心为中心** ——
     * 数字多一位是往左长、不是整体右漂。y 仍取格心 `0`（与旧口径一致）。
     *
     * ## 数值必须切到 `overflow = NONE`
     *
     * prefab 里 `CaptionLabel` 是 `SHRINK` + 固定 `92` 宽，文本在框里**居中**、框宽与文本宽无关
     * ⇒ 量出来永远是 92，量不到文本（也就钉不住 2px）。切成 `NONE` 后引擎把 `contentSize`
     * 重写成**实测文本尺寸**，这正是「盒子永远紧贴文本」的行为（与 `LayerActivityLayout`
     * 的数量框同口径）。
     *
     * ⚠️ **量到的宽必须和用来摆位的宽是同一帧的**，所以切完 `overflow`、写完字符串之后要紧接着
     * 调 `refreshCaptionTextLayout()` 把布局逼出来 —— 否则「按 A 宽度摆、按 B 宽度画」，间距偏掉。
     *
     * ⚠️ **退出条件模式必须把 `overflow` 还原成 prefab 原值**：`CaptionLabel` 同时承担
     * 「名称底条」文案（`关卡 1` / `首领 3` / `待配置`…），那边靠 `SHRINK` 防超宽换行，
     * 而站点节点是**池化复用**的，不还原就会把条件格的 `NONE` 带到名称格上。
     * 同理两个缩放也要还原成 1（否则下一个借到这个节点的站点会莫名放大）。
     */
    private applyCaptionPlacement(): void {
        const offsets = this.localOffsets;
        if (!offsets) return;
        const isCondition = this.conditionMode;
        const { x, y, z } = this.node.position;
        // 条件格的宽度依赖「盒子随文本自适应」，其余分支回到 prefab 的固定框。
        const overflow = isCondition ? Label.Overflow.NONE : this.defaultCaptionOverflow;
        if (this.captionLabel.overflow !== overflow) this.captionLabel.overflow = overflow;
        if (!isCondition) {
            // 退出条件模式 ⇒「生成缩放」一并归位：站点节点池化复用，留着 0.3 倍会把
            // 下一格的**名称底条**画小（这句同时兜住 `setMapPosition` 与 `render` 两个调用方）。
            this.conditionSpawnScale = 1;
            this.applyCaptionScale(this.captionSprite.node, 1);
            this.applyCaptionScale(this.captionLabel.node, 1);
            this.captionSprite.node.setPosition(x + offsets.caption.x, y + offsets.caption.y, z + offsets.caption.z);
            this.captionLabel.node.setPosition(x + offsets.text.x, y + offsets.text.y, z + offsets.text.z);
            return;
        }
        const iconWidth = this.readCaptionIconWidth() * CONDITION_ICON_SCALE;
        const iconHeight = this.readCaptionIconHeight() * CONDITION_ICON_SCALE;
        this.refreshCaptionTextLayout();
        const valueWidth = this.readConditionValueWidth() * CONDITION_VALUE_SCALE;
        const total = iconWidth + CONDITION_GAP + valueWidth;
        // 有宝箱图标 ⇒ **两行**（宝箱在上、价格行在下）合成一块、整块在格心居中；
        // 没有 ⇒ `rowY = 0`，与旧版逐像素一致（公式与理由见 `model/TerritoryConditionBadge`）。
        // 宝箱高度要乘显示缩放（0.95）再进排版：`conditionChestHeight` 存的是**未缩放**高，
        // 与价格行「未缩放 40 × 0.85」是同一条口径，两行才按同一把尺子算块高。
        const chestHeight = this.conditionChestHeight > 0
            ? this.conditionChestHeight * TERRITORY_CONDITION_CHEST_SCALE
            : 0;
        const block = territoryConditionBlockLayout(iconHeight, chestHeight);
        // 「生成缩放」乘在两个基准上（见 `conditionSpawnScale`）：1 = 完全展开，0 = 还没长出来。
        // ⚠️ 只有缩放乘、`total` 不乘 —— 位置永远按**展开后**的宽度摆，动画期间不动版。
        const spawn = this.conditionSpawnScale;
        this.applyCaptionScale(this.captionSprite.node, CONDITION_ICON_SCALE * spawn);
        this.applyCaptionScale(this.captionLabel.node, CONDITION_VALUE_SCALE * spawn);
        const rowY = y + block.rowY;
        this.captionSprite.node.setPosition(x - total / 2 + iconWidth / 2, rowY, z + offsets.caption.z);
        this.captionLabel.node.setPosition(x + total / 2 - valueWidth / 2, rowY, z + offsets.text.z);
        const chest = this.conditionChest;
        if (chest && block.chestY !== 0 && chest.node.active) {
            this.applyCaptionScale(chest.node, TERRITORY_CONDITION_CHEST_SCALE * spawn);
            chest.node.setPosition(x, y + block.chestY, z + offsets.caption.z);
        }
    }

    /**
     * 同一帧把 Label 的文本布局**逼出来**，好让 `contentSize` 当场变成实测文本尺寸。
     *
     *  ⚠️ 不这么做的话，`overflow = NONE` 下的 `contentSize` 要等下一帧才刷新 ⇒ 第一次
     *  `render` 的那一帧量到的是**出厂宽 92**（这正是 `CONDITION_VALUE_WIDTH_MAX` 要挡的东西）。
     *  量宽必须和位置同帧，否则「按 A 宽度摆、按 B 宽度画」会让间距偏掉。
     *
     *  防御式调用（方法存在 + 可选调用）：`territory-station-batching` 的 `FakeLabel` 桩上没有它；
     *  就算引擎版本把它变成 no-op，也只影响**第一帧** —— `readConditionValueWidth` 会退回
     *  按位数估的宽度（误差 1px 内），下一帧自动用真实宽重算。
     */
    private refreshCaptionTextLayout(): void {
        const update = this.captionLabel.updateRenderData;
        if (typeof update !== 'function') return;
        update.call(this.captionLabel, true);
    }

    /**
     * 银币图标节点**未缩放**时的可见宽（`CaptionBg` 的 `contentSize.width`，prefab 里是 40）。
     *
     *  `CaptionBg` 是 `sizeMode = CUSTOM(0)` + 条件模式下 `type = SIMPLE` ⇒ 引擎把整帧铺满节点
     *  ⇒ **节点宽就是可见宽**（与 `Icon` 那套「画布尺寸决定系数」不同，这里没有 trim 偏移问题）。
     */
    private readCaptionIconWidth(): number {
        const width = this.captionIconTransform.contentSize.width;
        return width > 0 ? width : CONDITION_ICON_WIDTH_FALLBACK;
    }

    /**
     * 银币图标节点**未缩放**时的高（`CaptionBg` 的 `contentSize.height`，prefab 里 40×40）。
     *
     *  只给「宝箱 + 价格」两行排版的竖直块算高度用（见 `model/TerritoryConditionBadge`）。
     *  `CaptionBg` 是 `CUSTOM` + `SIMPLE` ⇒ 节点高就是可见高，没有 trim 偏移问题；
     *  量不到（单测桩 / 还没绑定）时按出厂 40 兜底，与宽度兜底同值。
     */
    private readCaptionIconHeight(): number {
        const height = this.captionIconTransform.contentSize.height;
        return height > 0 ? height : CONDITION_ICON_WIDTH_FALLBACK;
    }

    /**
     * 数值 Label 的**实测文本宽**（未乘缩放）。
     *
     * ⚠️ 判据见 `CONDITION_VALUE_WIDTH_MAX`：读到的宽 ≥ 92（prefab 出厂宽）说明引擎还没量过
     * 这一帧 ⇒ 按**位数**估（`CONDITION_DIGIT_WIDTH`）。空串也要给正值，否则总宽会把图标
     * 推到格心右边去（那时文字本身是隐藏的，位置无所谓，但别产出退化几何）。
     */
    private readConditionValueWidth(): number {
        const measured = this.captionTextTransform.contentSize.width;
        if (measured > 0 && measured <= CONDITION_VALUE_WIDTH_MAX) return measured;
        return Math.max(1, this.captionLabel.string.length) * CONDITION_DIGIT_WIDTH;
    }

    /**
     * 写条件格两个节点的缩放（**唯一写入口**，与 `applyIconScale` 同款节流）。
     */
    private applyCaptionScale(node: Node, scale: number): void {
        const current = node.scale;
        if (current && current.x === scale && current.y === scale) return;
        node.setScale(scale, scale, 1);
    }

    /**
     * 落条件模式上方那颗**宝箱图标**的帧与显隐，并记下它的高度给排布用（2026-11-10）。
     *
     * 需求：`fixedResource` 格处于**可激活**状态时，除了银币 icon + 数字，上面再加一颗
     * `icon_baoxiang`；**未解锁（只显示锁）时不画**（那时 `isCondition = false`，`visible` 直接是 false）。
     *
     * @param frame `null` = 这一格不该有宝箱图标（非宝箱格 / 锁着 / 加载中）
     * @param visible 状态上该不该显示（与 `captionSprite` / `captionLabel` 同一条判据）
     *
     * ⚠️ 帧尺寸变化要**每帧**对一遍：站点节点池化复用，上一格留下的 58×45 不能带给下一个站点。
     * ⚠️ `conditionChestHeight` 写的是**未缩放**高：生成缩放由 `applyCaptionPlacement` 单独乘，
     *    若把缩放后的高写进来，两行块会在动画期间自己变高变矮（版式抖）。
     */
    private applyConditionChest(frame: SpriteFrame | null, visible: boolean): void {
        if (this.isDisposed) return;
        const hide = (): void => {
            if (this.conditionChest && this.conditionChest.node.active) this.conditionChest.node.active = false;
            this.conditionChestHeight = 0;
        };
        if (!visible || !frame) {
            hide();
            return;
        }
        // 取不到原始尺寸（桩 / 坏图）⇒ 当没有这张图，宁可少一颗也不能让排版按 0 高算。
        const size = frame.originalSize as { readonly width?: number; readonly height?: number } | undefined;
        const width = size && Number.isFinite(size.width) ? size.width! : 0;
        const height = size && Number.isFinite(size.height) ? size.height! : 0;
        if (width <= 0 || height <= 0) {
            hide();
            return;
        }
        let chest = this.conditionChest;
        if (!chest) {
            const parent = this.captionSprite.node.parent;
            if (!parent) {
                hide();
                return;
            }
            const node = new Node('ConditionChest');
            node.layer = this.captionSprite.node.layer;
            const transform = node.addComponent(UITransform);
            node.setParent(parent);
            const sprite = node.addComponent(Sprite);
            // 与 `levelBubble` 同一套：整帧铺满节点（`CUSTOM` + `trim = false`），
            // `icon_baoxiang` 是 58×45 的成品图，没有九宫格切边。
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.trim = false;
            sprite.type = Sprite.Type.SIMPLE;
            sprite.color = Color.WHITE;
            chest = { node, sprite, transform };
            this.conditionChest = chest;
            // 多了一个要跟着淡入的视觉节点 ⇒ 重建 `setSpawnOpacity` 的缓存（它只建一次）。
            this.spawnOpacities = null;
        }
        if (chest.sprite.spriteFrame !== frame) chest.sprite.spriteFrame = frame;
        const current = chest.transform.contentSize;
        if (current.width !== width || current.height !== height) chest.transform.setContentSize(width, height);
        chest.node.active = true;
        this.conditionChestHeight = height;
    }

    render(content: ITerritoryStationRender): void {
        const offsets = this.localOffsets;
        const defaultTextColor = this.defaultCaptionTextColor;
        if (!offsets || !defaultTextColor) throw new Error('TerritoryStationView 尚未初始化');
        const isCondition = content.isCondition === true;
        const isLoading = content.isLoading === true;
        // 「整站不显示」（需求 row14：建筑展示滞后到地块翻转结束）—— 见 `ITerritoryStationRender.hidden`。
        // ⚠️ 只写四个视觉节点的 active：它们在 `initialize` 里已被 reparent 到共享 layer，
        //   关站点根节点只会关掉命中区，视觉照旧留在屏幕上。
        const isHidden = content.hidden === true;
        this.site = content.site;
        // 🔴 池化复用：银币宝箱的 pop 还没播完，节点已被借给别的格 ⇒ 立刻停表，
        //    否则下一格会凭空闪出一只不属于它的宝箱（与「抖动 / 生成缩放归位」同一族约束）。
        const contentCellId = content.site ? content.site.cellId : null;
        if (this.silverChestPopCellId !== null && contentCellId !== this.silverChestPopCellId) {
            this.resetSilverChestPop();
        }
        // ⚠️ 每帧都写：站点节点是池化复用的，不写就会带着上一格的"能点进章节"或反过来。
        this.chapterEntry = content.chapterEntry === true;
        // 存一份：跳跳动结束 / 气泡抑制解除时按它重画气泡，不用等下一轮 `syncStations`。
        this.lastContent = content;
        this.conditionMode = isCondition;
        // `buildSize` 必须在 `applyIconPlacement` 之前写进来 —— 它是归一系数的第二个因子。
        this.iconSizeScale = content.iconScale && content.iconScale > 0 ? content.iconScale : 1;
        // 同上：底部对齐也是 `applyIconPlacement` 的入参，晚写就晚一帧（池化复用时是"用上一格的口径"）。
        this.bottomAnchored = content.bottomAnchor === true;
        // 银币宝箱退场期间用**帧快照**顶替 `content.icon`：领取回包一到，
        // `stationRenderOf` 就把这格的 icon 置 `null`（claimed ⇒ 宝箱从地图消失），
        // 不顶替的话动画还没起手箱子就已经没了。非退场期 `popFrame` 恒 null ⇒ 逐像素同旧版。
        const popFrame = this.silverChestPopElapsed >= 0 ? this.silverChestPopFrame : null;
        this.setIcon(popFrame ?? content.icon);
        if (this.iconSprite.node.active === isHidden) this.iconSprite.node.active = !isHidden;
        // 🔴 换帧后必须重算：不同建筑的 trim 偏移与画布尺寸都不同（见 applyIconPlacement），
        // 不重算就会出现「同一张图上有的高有的低」，且池化复用时残留上一张的缩放。
        this.applyIconPlacement();
        if (!this.iconSprite.color.equals(Color.WHITE)) this.iconSprite.color = Color.WHITE;
        const captionFrame = isCondition ? content.conditionIcon ?? null : this.defaultCaptionFrame;
        if (this.captionSprite.spriteFrame !== captionFrame) this.captionSprite.spriteFrame = captionFrame;
        this.captionSprite.enabled = captionFrame !== null;
        this.captionSprite.node.active = !isHidden && !isLoading && isCondition && captionFrame !== null;
        const captionType = isCondition ? Sprite.Type.SIMPLE : this.defaultCaptionType;
        if (this.captionSprite.type !== captionType) this.captionSprite.type = captionType;
        const captionTint = isCondition ? Color.WHITE : content.tint;
        if (!this.captionSprite.color.equals(captionTint)) this.captionSprite.color = captionTint;
        // ⚠️ 顺序有讲究：先写字符串，再排布 —— 条件格的位置是**按实测文本宽**算出来的
        // （`applyCaptionPlacement` 的第一步就是把 `overflow` 切到 `NONE` 让引擎量文本）。
        // 反过来的话这一帧量到的还是上一个字符串的宽度，整对图标会先错一拍。
        if (this.captionLabel.string !== content.caption) this.captionLabel.string = content.caption;
        // 宝箱图标（2026-11-10）：只有「固定宝箱格 + 可激活」才有图 ⇒ 必须先落帧 / 量高，
        // 再排布（`applyCaptionPlacement` 要用 `conditionChestHeight` 决定整块怎么居中）。
        this.applyConditionChest(content.conditionChestIcon ?? null, isCondition && !isHidden && !isLoading);
        this.applyCaptionPlacement();
        this.captionLabel.node.active = !isHidden && !isLoading && isCondition;
        const textColor = isCondition ? content.conditionTextColor ?? defaultTextColor : defaultTextColor;
        if (!this.captionLabel.color.equals(textColor)) this.captionLabel.color = textColor;
        this.renderLevelBubble(content);
        this.button.interactable = content.interactive && !isLoading && !isHidden;
    }

    private renderLevelBubble(content: ITerritoryStationRender): void {
        const text = content.levelBubble ?? '';
        const frame = content.levelBubbleFrame ?? null;
        const iconFrame = content.levelBubbleIcon ?? null;
        this.levelBubbleAnchorFrame = content.levelBubbleAnchorFrame ?? null;
        // 需求 2026-11-02 第 3 条：播放「宝箱还没点我」跳动时**隐藏**它的提示气泡。
        // 判据走开关（`setHintBubbleSuppressed`），不是直接关节点 —— 站点每秒会被重画一次。
        // 🔴 预告关卡（2026-11-11）：格子未解锁 ⇒ `icon: null` + `isCondition: true`，
        //    按老门槛两颗都过不了。这一支**只放宽这两条**，hidden / loading / suppressed
        //    与气泡形状、点击、层级全部照旧，不另起一套渲染路径。
        const preview = content.previewBubble === true;
        const visible = text !== '' && frame !== null
            && (preview || (content.icon !== null && !content.isCondition))
            && !content.hidden && !content.isLoading && !this.hintBubbleSuppressed;
        /**
         * 两套排版，按**有没有体力图标**分流（2026-11-02 需求）：
         *  · 有 icon ⇒ 宝箱提示气泡，底图 `frame_04` 77×87 竖向水滴，**icon 在上、数字在下**；
         *  · 没 icon ⇒ 关卡编号 / 「章节」，94×45 胶囊，只有一行字。
         *
         * 尺寸与位置全读 `model/TerritoryChestBubble`，这里不许再写数字：
         * 换图时只要那张图的自然尺寸变了，`UITransform` / 图标 / 文字位置会一起跟着走。
         */
        const chest = iconFrame ? territoryChestBubbleLayout() : null;
        const bubbleWidth = chest ? chest.width : MAP_MARKER_BADGE_WIDTH;
        const bubbleHeight = chest ? chest.height : MAP_MARKER_BUBBLE_HEIGHT;
        if (visible && !this.levelBubble) {
            const parent = this.badgeLabel.node.parent;
            if (!parent) throw new Error('关卡气泡缺少角标层');
            const node = new Node('LevelBubble');
            node.layer = this.badgeLabel.node.layer;
            node.addComponent(UITransform).setContentSize(bubbleWidth, bubbleHeight);
            node.setParent(parent);
            const sprite = node.addComponent(Sprite);
            sprite.sizeMode = Sprite.SizeMode.CUSTOM;
            sprite.trim = false;
            sprite.type = Sprite.Type.SLICED;
            sprite.color = Color.WHITE;
            const button = node.addComponent(Button);
            button.transition = Button.Transition.NONE;
            node.on(Button.EventType.CLICK, this.handleClick, this);
            this.badgeLabel.node.setParent(node);
            this.themeLevelBubbleLabel(chest);
            this.levelBubble = { node, sprite, button };
            this.spawnOpacities = null;
            this.setSpawnOpacity(this.spawnOpacity);
        }
        this.badgeLabel.string = text;
        const bubble = this.levelBubble;
        if (bubble) {
            // 尺寸与 sprite 类型**每帧**都对一遍：同一格的状态可能从「编号气泡」变成
            // 「宝箱提示」（换图 / 换章复用视图），创建时定死就会留下错尺寸。
            const nodeTransform = bubble.node.getComponent(UITransform);
            if (nodeTransform) nodeTransform.setContentSize(bubbleWidth, bubbleHeight);
            // 水滴是一整张成品图（没有九宫格切边）⇒ `SIMPLE` 按节点尺寸铺满；
            // 胶囊靠九宫格保圆角不变形 ⇒ `SLICED`。
            const spriteType = chest ? Sprite.Type.SIMPLE : Sprite.Type.SLICED;
            if (bubble.sprite.type !== spriteType) bubble.sprite.type = spriteType;
        }
        this.themeLevelBubbleLabel(chest);
        // 🔴 覆盖色必须**排在 `themeLevelBubbleLabel` 之后**：那一支每帧都会把颜色写回
        //    「宝箱深棕 / 编号白」，写在前面等于被它盖掉（表现：体力不足但数字仍是深棕）。
        const bubbleTextColor = content.levelBubbleTextColor;
        if (bubbleTextColor && !this.badgeLabel.color.equals(bubbleTextColor)) {
            this.badgeLabel.color = bubbleTextColor;
        }
        this.badgeLabel.node.active = visible;
        if (!bubble) return;
        bubble.node.active = visible;
        bubble.button.interactable = visible && content.interactive;
        if (!visible) return;
        if (bubble.sprite.spriteFrame !== frame) bubble.sprite.spriteFrame = frame;
        this.applyLevelBubbleLayout(iconFrame);
        this.applyLevelBubblePosition();
    }

    /**
     * 气泡文字样式（**唯一写入口**，创建与复用都走这里）。
     *
     * 两套口径差别很大，别混着改：
     *  · **宝箱气泡**：深棕数字（底图是奶白，白字等于没字）、字号/行高按水滴尺寸给，
     *    字重靠 `isBold + 同色系深描边`补（2026-11-02 第二轮：要匹配美术稿的「大小和粗细」，
     *    光 `isBold` 补不满 —— 见 `model/TerritoryChestBubble` 的 `OUTLINE_WIDTH` 注释），
     *    文字框 = 整个气泡宽（水平居中就靠它），数字不参与测宽；
     *  · **编号气泡**：白字压黑描边（美术稿的 `1-1` 是「超粗 + 三字紧贴」），
     *    prefab 里的 12/16/常规体是给旧角标用的 ⇒ 必须整组覆盖（见 `MapMarkerBadge` 注释）。
     */
    private themeLevelBubbleLabel(chest: ITerritoryChestBubbleLayout | null): void {
        const transform = this.badgeLabel.node.getComponent(UITransform);
        if (chest) {
            this.badgeLabel.fontSize = chest.fontSize;
            this.badgeLabel.lineHeight = chest.lineHeight;
            this.badgeLabel.isBold = true;
            this.badgeLabel.spacingX = 0;
            // 字重：`isBold` + 同色系深描边（描边色比文字色深一档，不是黑色 —— 奶白底上黑边会显硬）。
            this.badgeLabel.enableOutline = chest.outlineWidth > 0;
            this.badgeLabel.outlineWidth = chest.outlineWidth;
            this.badgeLabel.outlineColor = new Color(
                chest.outlineColor[0], chest.outlineColor[1], chest.outlineColor[2], 255);
            this.badgeLabel.color = new Color(chest.textColor[0], chest.textColor[1], chest.textColor[2], 255);
            if (transform) transform.setContentSize(chest.width, chest.lineHeight);
        } else {
            this.badgeLabel.fontSize = MAP_MARKER_BADGE_FONT_SIZE;
            this.badgeLabel.lineHeight = MAP_MARKER_BADGE_LINE_HEIGHT;
            this.badgeLabel.isBold = MAP_MARKER_BADGE_BOLD;
            this.badgeLabel.spacingX = MAP_MARKER_BADGE_SPACING_X;
            // 字重：系统字体只有常规/加粗两档，`isBold` 到顶后再加厚描边（见 MapMarkerBadge 注释）。
            this.badgeLabel.enableOutline = true;
            this.badgeLabel.outlineWidth = MAP_MARKER_BADGE_OUTLINE_WIDTH;
            // 描边色显式写回黑色：宝箱分支会把 `outlineColor` 改成深棕，共用同一个 Label
            // ⇒ 不写回来，切到编号气泡时会带着上一轮的棕色描边。
            this.badgeLabel.outlineColor = Color.BLACK;
            this.badgeLabel.color = Color.WHITE;
            if (transform) transform.setContentSize(MAP_MARKER_BADGE_WIDTH, MAP_MARKER_BADGE_HEIGHT);
        }
        this.badgeLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        this.badgeLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.badgeLabel.overflow = Label.Overflow.SHRINK;
        // 旧角标可能已参与生成淡入，改由新根统一承接，避免文字透明度被乘两次。
        const opacity = this.badgeLabel.node.getComponent(UIOpacity);
        if (opacity) opacity.opacity = 255;
    }

    /**
     * 气泡内容排布（**唯一写入口**）。
     *
     *  · **宝箱气泡**（有体力图标）：icon 在上、数字在下，两者**各自水平居中**（x = 0）。
     *    位置与尺寸全来自 `model/TerritoryChestBubble`：
     *    ```
     *    icon  中心 = (0, +iconY)      // 落在水滴最宽那一段，不顶圆顶
     *    数字  中心 = (0, +textY)      // textY 为负；再往下就压到尖端
     *    ```
     *    ⚠️ 水滴**没有横向空间**：77 宽的气泡里并排放 36 的图标 + 两位数会顶到描边，
     *       所以这里不能沿用「图标 + 数字并排」那套（旧实现，已随本次换图删掉）。
     *  · **编号气泡**（无图标）：文字居中在 94×45 胶囊里，`MAP_MARKER_BADGE_TEXT_Y` 抬一点给小尾巴让位。
     *
     * ⚠️ 图标取不到时（美术没到）**退回纯数字**：宁可少个图标，也不能让宝箱没有提示。
     */
    private applyLevelBubbleLayout(iconFrame: SpriteFrame | null): void {
        const bubble = this.levelBubble;
        if (!bubble) return;
        const icon = iconFrame ? this.ensureLevelBubbleIcon() : this.levelBubbleIcon;
        if (!icon || !iconFrame) {
            if (this.levelBubbleIcon) this.levelBubbleIcon.node.active = false;
            this.badgeLabel.node.setPosition(0, MAP_MARKER_BADGE_TEXT_Y, 0);
            return;
        }
        if (icon.sprite.spriteFrame !== iconFrame) icon.sprite.spriteFrame = iconFrame;
        icon.node.active = true;
        const chest = territoryChestBubbleLayout();
        const iconTransform = icon.node.getComponent(UITransform);
        if (iconTransform) iconTransform.setContentSize(chest.iconSize, chest.iconSize);
        icon.node.setPosition(0, chest.iconY, 0);
        this.badgeLabel.node.setPosition(0, chest.textY, 0);
    }

    /** 惰性创建气泡里的图标节点（挂在气泡根上，和文字同层）。 */
    private ensureLevelBubbleIcon(): { readonly node: Node; readonly sprite: Sprite } | null {
        if (this.levelBubbleIcon) return this.levelBubbleIcon;
        const bubble = this.levelBubble;
        if (!bubble) return null;
        const chest = territoryChestBubbleLayout();
        const node = new Node('LevelBubbleIcon');
        node.layer = bubble.node.layer;
        node.addComponent(UITransform).setContentSize(chest.iconSize, chest.iconSize);
        node.setParent(bubble.node);
        const sprite = node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        sprite.type = Sprite.Type.SIMPLE;
        sprite.color = Color.WHITE;
        this.levelBubbleIcon = { node, sprite };
        return this.levelBubbleIcon;
    }

    private applyLevelBubblePosition(): void {
        const bubble = this.levelBubble;
        const offsets = this.localOffsets;
        if (!bubble || !offsets) return;
        // 气泡高度按**当前底图**取（胶囊 45 / 水滴 87）：`mapMarkerBadgeY` 是把气泡中心抬到
        // 「可见顶部 + 半高 + 3」，用错高度会让水滴的尖扎进地块、或整体飘高一截。
        const bubbleTransform = bubble.node.getComponent(UITransform);
        const bubbleHeight = bubbleTransform && bubbleTransform.contentSize.height > 0
            ? bubbleTransform.contentSize.height : MAP_MARKER_BUBBLE_HEIGHT;
        // 🔴 预告格：站点自身没有实心建筑（`icon: null`），改按虚影那张帧算可见高，
        //    否则气泡会落回格心、压住价格与 35% 建筑。缩放也换成对应的归一系数
        //    （`previewAnchorScale` 逐字复刻 `applyIconPlacement`），两者必须同源才不飘。
        const anchorFrame = this.levelBubbleAnchorFrame ?? this.iconSprite.spriteFrame;
        const anchorScale = this.levelBubbleAnchorFrame
            ? this.previewAnchorScale() : this.iconBaseScale;
        const height = anchorFrame && anchorFrame.originalSize.height > 0
            ? anchorFrame.rect.height * this.iconTransform.contentSize.height
                / anchorFrame.originalSize.height * anchorScale : 0;
        const lift = this.bottomAnchored ? height / 2 - TERRITORY_BOTTOM_ANCHOR_DROP_PX : 0;
        bubble.node.setPosition(this.mapX + offsets.icon.x,
            mapMarkerBadgeY(this.mapY + offsets.icon.y + lift + height / 2, bubbleHeight), this.mapZ + offsets.icon.z);
    }

    /**
     * 预告气泡锚点帧的缩放：**逐字复刻 `applyIconPlacement` 的归一系数**，只是把帧换成虚影那张。
     *
     * `iconSizeScale` 与虚影同源（`syncStations` 和 `renderGhost` 都传 `buildScaleOf`），
     * 所以这里算出的可见高与虚影 View 的 `anchorLiftY` / 可见高逐像素一致。
     */
    private previewAnchorScale(): number {
        const frame = this.levelBubbleAnchorFrame;
        const nodeSize = this.iconTransform.contentSize;
        const canvas = frame?.originalSize;
        const trimmed = frame?.rect;
        if (!frame || !canvas || !trimmed || !(canvas.width > 0) || !(trimmed.width > 0)
            || !(nodeSize.width > 0)) return 1;
        const visibleWidth = trimmed.width * nodeSize.width / canvas.width;
        return (visibleWidth > 0 ? BUILDING_VISIBLE_WIDTH / visibleWidth : 1) * this.iconSizeScale;
    }

    private readonly handleClick = (): void => {
        if (!this.clickable) return;
        // 章节入口（起始格的建筑 / 气泡）：没有 `site` 可带，单独发一条 UI 事件给宿主页开弹窗。
        // ⚠️ 不能塞进 `STATION_TAP` —— 那一条的下游（`TerritoryMapView.onStationClick`）要
        //    真站点去算 `cellId`、播点击反馈、发解锁 intent，拿 `null` 会整条链空转。
        if (this.chapterEntry) {
            EventMgr.instance.emit(TerritoryUiEvent.ChapterSelect);
            return;
        }
        if (this.site) EventMgr.instance.emit(TERRITORY_EVENTS.STATION_TAP, { target: this.site });
    };

    private setIcon(frame: SpriteFrame | null): void {
        if (this.iconSprite.spriteFrame !== frame) this.iconSprite.spriteFrame = frame;
        this.iconSprite.enabled = frame !== null;
    }

    /**
     * 回收站点（**只能在节点仍存活时调** —— 换章时 `TerritoryMapView` 淘汰旧格子走这条路）。
     *
     *  detach 出去的视觉节点挂在共享 layer 上、不在本站点根节点子树里，所以页面还活着时
     *  必须由这里显式 `destroy`，否则它们会残留在 layer 上。
     */
    dispose(): void {
        if (this.isDisposed) return;
        this.isDisposed = true;
        // 抖动一并停表（同「池化复用要还原」那一族约束：别把缩放因子留给下一个借到本槽位的站点）。
        this.buildingShakeElapsed = -1;
        this.buildingShakeX = 1;
        this.buildingShakeY = 1;
        // 同上：价格生成缩放的系数也不许跟着池化槽位走。
        this.conditionSpawnScale = 1;
        // 银币宝箱退场也要停表：节点马上被 destroy，不能留着一条会写已销毁节点的秒表。
        this.resetSilverChestPop();
        // 预告气泡锚点帧同理：池化槽位借给下一格时，别把上一格的虚影高度带过去。
        this.levelBubbleAnchorFrame = null;
        this.button.node.off(Button.EventType.CLICK, this.handleClick, this);
        for (const visual of [
            this.iconSprite.node,
            this.captionSprite.node,
            this.captionLabel.node,
            this.levelBubble?.node ?? this.badgeLabel.node,
        ]) {
            if (visual.isValid && visual.parent !== this.node) visual.destroy();
        }
        // 宝箱图标同样挂在共享的 `StationCaptionLayer` 上（不在根节点底下）⇒ 也要手动销毁。
        const chest = this.conditionChest;
        if (chest && chest.node.isValid) chest.node.destroy();
        this.conditionChest = null;
        this.conditionChestHeight = 0;
        this.site = null;
        this.levelBubble = null;
        // 图标节点挂在气泡根上（随它一起销毁），这里只清引用；跳动两项也要复位，
        // 否则池化复用时会带着上一格的偏移 / 抑制状态借给下一个站点。
        this.levelBubbleIcon = null;
        this.lastContent = null;
        this.chestHintOffsetY = 0;
        this.hintBubbleSuppressed = false;
    }

    /**
     * ⚠️ 这里**只能清业务字段，绝不能**碰监听或 `destroy()`。
     *
     *  节点销毁时 `cc.Button` 排在 `TerritoryStationView` **之前**被销毁
     *  （prefab `_components` 数组序：UITransform → Sprite → **cc.Button** → 本脚本），
     *  `CCObject._destruct()` 把 `Button.node` 置 `null` ⇒ 此处再 `this.button.node.off(...)`
     *  必抛 `TypeError: Cannot read properties of null (reading 'off')`。
     *  而异常从组件销毁循环里抛出 ⇒ `object.ts` 的 `_objFlags |= Destroyed` 执行不到
     *  ⇒ 节点卡在 Destroying 却未 Destroyed ⇒ 之后重复销毁刷
     *  「You are trying to destroy a object twice or more」。
     *
     *  视觉节点此时也不用手动 `destroy`：它们已被 reparent 到 `TerritoryMapView` 的共享 layer 上，
     *  属于页面子树的一部分，会随页面一起销毁；监听同样随节点的 `_eventProcessor.destroy()` 清空。
     *
     *  同族规则见 `MEMORY.md` 176、`app/chat/ChatEntryButton.ts` 文件头。
     */
    protected onDestroy(): void {
        this.site = null;
    }
}
