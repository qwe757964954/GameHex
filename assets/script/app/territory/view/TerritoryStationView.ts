import { _decorator, Button, Color, Component, Label, Sprite, UITransform } from 'cc';
import type { Node, SpriteFrame, Vec3 } from 'cc';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../../../core/hex/ShakePresentation';
import type { TerritorySite } from '../model/TerritoryMapConfig';
import { TERRITORY_EVENTS } from './TerritoryEvents';

export interface ITerritoryRandomResourceTarget {
    readonly kind: 'randomResource';
    readonly cellId: number;
}

export type TerritoryStationTarget = TerritorySite | ITerritoryRandomResourceTarget;

const { ccclass, property } = _decorator;

/**
 * 未解锁格「银币图标」的缩放（需求：**icon 放大 1.1 倍**）。
 *
 *  写的是**节点缩放**而不是改 `contentSize`：`CaptionBg` 是 `sizeMode = CUSTOM(0)`，
 *  条件模式下 `type` 被切成 `SIMPLE` ⇒ 引擎把整帧铺满节点 ⇒ 节点宽就是图标可见宽。
 *  改 `contentSize` 会让「名称底条」分支（同一个节点、`SLICED`）跟着变形，缩放不会。
 */
const CONDITION_ICON_SCALE = 1.1;

/** 未解锁格「数值」的缩放（需求：**数字放大 1.5 倍**）。 */
const CONDITION_VALUE_SCALE = 1.5;

/** 数值左缘与银币图标右缘之间的间距（像素）——需求：**间隔 2 个像素**。 */
const CONDITION_GAP = 2;

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

/** `CaptionBg` 节点的出厂边长（拿不到 `UITransform` 时用来兜底）。 */
const CONDITION_ICON_WIDTH_FALLBACK = 40;

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
 */
const BUILDING_VISIBLE_WIDTH = 84;

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
    /** 站点建筑图标；地图不显示建筑名称及状态角标。 */
    readonly icon: SpriteFrame | null;
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
    /** 仅条件模式显示银币消耗数值。 */
    readonly caption: string;
    /** 站点状态色。 */
    readonly tint: Color;
    /** 站点角标已停用，调用方传空串。 */
    readonly badge: string;
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
    button: Button = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：站点图标（主城 / 前哨 / 首领）' })
    iconSprite: Sprite = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'CaptionBg：未解锁时显示消耗图标，缺少建筑图时作为名称底条' })
    captionSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'CaptionLabel：未解锁时显示消耗数值，缺少建筑图时显示名称' })
    captionLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'BadgeLabel：缺少建筑图时显示角标' })
    badgeLabel: Label = null!;

    /** `Icon` 的 `UITransform`（面板拖拽绑定，勿 `getComponent`）：固定 128×128，供可见宽度归一。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'Icon 的 UITransform（128×128）' })
    iconTransform: UITransform = null!;

    /** `CaptionBg`（银币图标）的 `UITransform`：条件格排布读宽（40×40）。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'CaptionBg 的 UITransform（40×40）' })
    captionIconTransform: UITransform = null!;

    /** `CaptionLabel`（数值）的 `UITransform`：条件模式读实测文本宽（`readConditionValueWidth`）；名称底条模式 92×28。 */
    @property({ type: UITransform, group: '尺寸绑定', tooltip: 'CaptionLabel 的 UITransform（条件格实测文本宽）' })
    captionTextTransform: UITransform = null!;

    /** 当前节点代表的站点；点击时读它，不读闭包。起始格为 `null`。 */
    private site: TerritoryStationTarget | null = null;
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
    /**
    /**
     * 上一次 `render` 是否走「未解锁条件」分支。
     *
     *  `setMapPosition` 每秒对全部站点跑一遍，必须按**同一口径**重新摆位（条件格是「成对居中」，
     *  规则格是 prefab 偏移），所以要记住当前处在哪一支。
     */
    private conditionMode = false;

    /**
     * `Icon` 的**基准**缩放 —— `applyIconPlacement` 算出的「可见宽度归一化」系数。
     *
     *  抖动的因子（见 {@link buildingShakeX}）乘在它上面而不是替换它，
     *  所以「归一化」与「抖动」互不干扰：抖完落回的就是这张建筑图该有的尺寸。
     */
    private iconBaseScale = 1;
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
        this.badgeLabel.node.setPosition(x + offsets.badge.x, y + offsets.badge.y, z + offsets.badge.z);
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
            node.setPosition(this.mapX + offsets.icon.x, this.mapY + offsets.icon.y, this.mapZ + offsets.icon.z);
            return;
        }
        const canvas = frame?.originalSize;
        const trimmed = frame?.rect;
        // 帧缺失 / 画布或 trim 区尺寸非法（0）时，退回「只摆位置、不缩放」，不产出 NaN。
        if (!frame || !canvas || !trimmed || !(canvas.width > 0) || !(trimmed.width > 0)) {
            this.applyIconScale(1);
            node.setPosition(this.mapX + offsets.icon.x, this.mapY + offsets.icon.y, this.mapZ + offsets.icon.z);
            return;
        }
        const canvasScaleX = nodeSize.width / canvas.width;
        const canvasScaleY = nodeSize.height / canvas.height;
        const visibleWidth = trimmed.width * canvasScaleX;
        const scale = visibleWidth > 0 ? BUILDING_VISIBLE_WIDTH / visibleWidth : 1;
        // 抵消 trim 偏移：可见区中心 = 节点中心 + offset * canvasScale * k
        const shiftX = frame.offset.x * canvasScaleX * scale;
        const shiftY = frame.offset.y * canvasScaleY * scale;
        this.applyIconScale(scale);
        node.setPosition(
            this.mapX + offsets.icon.x - shiftX,
            this.mapY + offsets.icon.y - shiftY,
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
    private applyIconScale(scale: number): void {
        this.iconBaseScale = scale;
        this.writeIconScale();
    }

    /**
     * 把「基准缩放 × 抖动因子」写进 `Icon` 节点（**唯一落到引擎的出口**）。
     */
    private writeIconScale(): void {
        const node = this.iconSprite.node;
        const scaleX = this.iconBaseScale * this.buildingShakeX;
        const scaleY = this.iconBaseScale * this.buildingShakeY;
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
     * 逐帧推进建筑抖动。没在抖时只做一次数值比较（一张地图上百个站点，早退必须便宜）。
     *
     *  播完**显式复位**到 1：否则建筑会停在被拉长的姿态 —— 没有别的地方会把它改回来。
     */
    update(deltaTime: number): void {
        // ⚠️ `isDisposed` 也要挡：`dispose()` 会把四个视觉节点当场 `destroy()`，
        //    而站点根节点是**帧末**才销毁的 ⇒ 不挡就会对已销毁的节点写缩放。
        if (this.isDisposed || this.buildingShakeElapsed < 0) return;
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

    /**
     * 未解锁格「银币图标 + 数值」的成对排布（**唯一写入口**，`render` 与 `setMapPosition` 都走它）。
     *
     * 需求（2026-10-16 冒险模块 UI 优化）：**图标放大 1.1 倍、数字放大 1.5 倍、两者间隔 2 像素**。
     *
     * ## 为什么间距不能再写成两个「固定偏移」
     *
     * 旧实现是两个常量（图标中心 `−24`、数值中心 `+22`，见 git 历史）：间距由**两者的实际宽度
     * 隐式决定**，而数字从「9」变到「1200」时框宽不变、字数变多 ⇒ 间距自己会漂，钉不住 2px。
     * 要精确到像素就必须按**实测文本宽**算 —— 这与 `ZCFloatTextView.renderGoldIcon` 是同一套口径
     * （那边是 `GOLD_ICON_GAP`），本文件只是把「图标在数字左侧」搬到了领地站点上。
     *
     * ## 排布公式（两个节点的锚点都是 `(0.5, 0.5)`）
     *
     * ```
     * 图标可见宽 = CaptionBg 节点宽 × 1.1    // SIMPLE + CUSTOM ⇒ 帧铺满节点，节点宽就是可见宽
     * 数值可见宽 = Label 实测文本宽 × 1.5    // 见 readConditionValueWidth
     * 总宽       = 图标宽 + 2 + 数值宽
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
            this.applyCaptionScale(this.captionSprite.node, 1);
            this.applyCaptionScale(this.captionLabel.node, 1);
            this.captionSprite.node.setPosition(x + offsets.caption.x, y + offsets.caption.y, z + offsets.caption.z);
            this.captionLabel.node.setPosition(x + offsets.text.x, y + offsets.text.y, z + offsets.text.z);
            return;
        }
        const iconWidth = this.readCaptionIconWidth() * CONDITION_ICON_SCALE;
        this.refreshCaptionTextLayout();
        const valueWidth = this.readConditionValueWidth() * CONDITION_VALUE_SCALE;
        const total = iconWidth + CONDITION_GAP + valueWidth;
        this.applyCaptionScale(this.captionSprite.node, CONDITION_ICON_SCALE);
        this.applyCaptionScale(this.captionLabel.node, CONDITION_VALUE_SCALE);
        this.captionSprite.node.setPosition(x - total / 2 + iconWidth / 2, y, z + offsets.caption.z);
        this.captionLabel.node.setPosition(x + total / 2 - valueWidth / 2, y, z + offsets.text.z);
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
        this.conditionMode = isCondition;
        this.setIcon(content.icon);
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
        this.applyCaptionPlacement();
        this.captionLabel.node.active = !isHidden && !isLoading && isCondition;
        const textColor = isCondition ? content.conditionTextColor ?? defaultTextColor : defaultTextColor;
        if (!this.captionLabel.color.equals(textColor)) this.captionLabel.color = textColor;
        this.badgeLabel.string = '';
        this.badgeLabel.node.active = false;
        this.button.interactable = content.interactive && !isLoading && !isHidden;
    }

    private readonly handleClick = (): void => {
        if (this.clickable && this.site) this.node.emit(TERRITORY_EVENTS.STATION_CLICK, this.site);
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
        this.button.node.off(Button.EventType.CLICK, this.handleClick, this);
        for (const visual of [
            this.iconSprite.node,
            this.captionSprite.node,
            this.captionLabel.node,
            this.badgeLabel.node,
        ]) {
            if (visual.isValid && visual.parent !== this.node) visual.destroy();
        }
        this.site = null;
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
