import { _decorator, Button, Color, Component, Label, Sprite, UITransform } from 'cc';
import type { Node, SpriteFrame, Vec3 } from 'cc';
import type { TerritorySite } from '../model/TerritoryMapConfig';

export interface ITerritoryRandomResourceTarget {
    readonly kind: 'randomResource';
    readonly cellId: number;
}

export type TerritoryStationTarget = TerritorySite | ITerritoryRandomResourceTarget;

const { ccclass, property } = _decorator;
const CONDITION_ICON_OFFSET_X = -24;
const CONDITION_VALUE_OFFSET_X = 22;

/**
 * 建筑图标的目标**可见宽度**（美术单位）。
 *
 * 🔴 为什么需要它：`Icon` 节点是 128×128 + `sizeMode = CUSTOM(0)`，引擎把整帧铺满节点
 * ⇒ 不同画布尺寸的图**等比缩放系数不同**。实测这批美术两种规格混用：
 * `home/boss/outpost/async_pvp` 是 128×128（系数 1.0，可见 98~113px），
 * `bonus/fixed_resource/random_resource` 是 212×212（系数 0.604，可见 86~89px）
 * ⇒ 不归一则同屏建筑大小差约 25%。
 *
 * 取 **70** 的依据（山猫 2026-10-15 看截图定）：可见宽 70 ⇒ 可见高 **54~63**，
 * 占地块台面高（`HEX_GRID_FACE_HEIGHT = 90`）的 **69%**，上下留出呼吸空间。
 * ⚠️ 早先取 100 是错的 —— 那让可见高到 78~89，**几乎与台面等高、顶满格子**，
 * 截图上读作「建筑撑满格子 / 偏下」，其实是尺寸问题不是居中问题。
 *
 * ⚠️ **判据钉的是「归一后可见宽 = 本常量」且「可见高 ≤ 台面高的 0.75」**，
 * 换美术图只要重新量 `.meta` 的 `trimX/width` 即可，代码不用改。
 */
const BUILDING_VISIBLE_WIDTH = 70;

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
    /** 站点建筑图标；有图时隐藏名称底条、名称和角标。 */
    readonly icon: SpriteFrame | null;
    /** 未解锁格在格心显示消耗条件，复用底条 Sprite 与文字节点。 */
    readonly isCondition?: boolean;
    readonly conditionIcon?: SpriteFrame | null;
    readonly conditionTextColor?: Color;
    readonly caption: string;
    /** 名称底条的颜色：状态色（已占领 / 可挑战 / 探索中 / 未解锁）。 */
    readonly tint: Color;
    /** 角标文案：未解锁给「锁」、策划没配关卡的据点给「待配置」；空串表示不显示。 */
    readonly badge: string;
    readonly interactive: boolean;
    readonly isLoading?: boolean;
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

    /** 当前节点代表的站点；点击回调读它，不读闭包。起始格为 `null`。 */
    private site: TerritoryStationTarget | null = null;
    private onClick: ((site: TerritoryStationTarget) => void) | null = null;
    private localOffsets: Readonly<{
        icon: Vec3;
        caption: Vec3;
        text: Vec3;
        badge: Vec3;
    }> | null = null;
    private defaultCaptionFrame: SpriteFrame | null = null;
    private defaultCaptionType = Sprite.Type.SLICED;
    private defaultCaptionTextColor: Color | null = null;
    private isInitialized = false;
    private isDisposed = false;
    /** 地图格心（`TerritoryMapView.cellCenter` 的返回值）；建筑图标要对着它居中，故存在这里。 */
    private mapX = 0;
    private mapY = 0;
    private mapZ = 0;
    /**
     * `Icon` 节点的 `UITransform`，**在 `initialize` 里取一次**。
     *
     * ⚠️ 不要在 `applyIconPlacement` 里现取：`setMapPosition` 每秒对全部站点跑一遍，
     * 现取等于每格每帧一次组件查找；而节点尺寸由 prefab 固定，取一次就够。
     */
    private iconSize: UITransform | null = null;

    /** 绑一次点击（`TerritoryMapView` 在借出节点时调）；起始格不传回调。 */
    initialize(layers: ITerritoryStationLayers, onClick?: (site: TerritoryStationTarget) => void): void {
        this.onClick = onClick ?? null;
        if (this.isInitialized || this.isDisposed) return;
        this.isInitialized = true;
        this.localOffsets = {
            icon: this.iconSprite.node.position.clone(),
            caption: this.captionSprite.node.position.clone(),
            text: this.captionLabel.node.position.clone(),
            badge: this.badgeLabel.node.position.clone(),
        };
        this.defaultCaptionFrame = this.captionSprite.spriteFrame;
        this.defaultCaptionType = this.captionSprite.type;
        this.defaultCaptionTextColor = this.captionLabel.color.clone();
        // ⚠️ 用「方法存在 + 可选调用」取 `UITransform`：`Node.getComponent` 在引擎里一定有，
        // 但本类的单测（`territory-station-batching`）用的是自建 `FakeNode` 桩，桩上没有这个方法。
        // 直接调会让那条既有用例崩；这里取的是**纯附加信息**（取不到就退回不缩放，见
        // `applyIconPlacement`），不是必需依赖。
        const getComponent = this.iconSprite.node.getComponent;
        this.iconSize = typeof getComponent === 'function'
            ? (getComponent.call(this.iconSprite.node, UITransform) ?? null)
            : null;
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
        this.captionSprite.node.setPosition(
            x + offsets.caption.x,
            y + offsets.caption.y,
            z + offsets.caption.z,
        );
        this.captionLabel.node.setPosition(x + offsets.text.x, y + offsets.text.y, z + offsets.text.z);
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
        const nodeSize = this.iconSize?.contentSize;
        if (!nodeSize || !(nodeSize.width > 0) || !(nodeSize.height > 0)) {
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
     * 写 `Icon` 节点的缩放（**唯一写入口**，与 `applyIconPlacement` 的位置写入同源）。
     *
     * ⚠️ `setScale` 在真实引擎的 `Node` 上必定存在；这里做存在性判断是因为
     * `territory-station-batching` 的 `FakeNode` 桩没有它，而那条用例只验位置与 prefab 偏移。
     * 取不到就跳过 —— 缩放缺失只影响归一，不影响其余行为。
     */
    private applyIconScale(scale: number): void {
        const node = this.iconSprite.node;
        const setScale = node.setScale;
        if (typeof setScale !== 'function') return;
        // 同值不写：站点每秒刷新一次，避免把整棵 layer 标脏（领地滑动的性能口径）。
        const current = node.scale;
        if (current && current.x === scale && current.y === scale) return;
        setScale.call(node, scale, scale, 1);
    }

    render(content: ITerritoryStationRender): void {
        const offsets = this.localOffsets;
        const defaultTextColor = this.defaultCaptionTextColor;
        if (!offsets || !defaultTextColor) throw new Error('TerritoryStationView 尚未初始化');
        const isCondition = content.isCondition === true;
        const isLoading = content.isLoading === true;
        const hasBuilding = !isCondition && content.icon !== null;
        const position = this.node.position;
        this.site = content.site;
        this.setIcon(content.icon);
        // 🔴 换帧后必须重算：不同建筑的 trim 偏移与画布尺寸都不同（见 applyIconPlacement），
        // 不重算就会出现「同一张图上有的高有的低」，且池化复用时残留上一张的缩放。
        this.applyIconPlacement();
        if (!this.iconSprite.color.equals(Color.WHITE)) this.iconSprite.color = Color.WHITE;
        const captionFrame = isCondition ? content.conditionIcon ?? null : this.defaultCaptionFrame;
        if (this.captionSprite.spriteFrame !== captionFrame) this.captionSprite.spriteFrame = captionFrame;
        this.captionSprite.enabled = captionFrame !== null;
        this.captionSprite.node.active = !isLoading && !hasBuilding && captionFrame !== null;
        const captionType = isCondition ? Sprite.Type.SIMPLE : this.defaultCaptionType;
        if (this.captionSprite.type !== captionType) this.captionSprite.type = captionType;
        const captionTint = isCondition ? Color.WHITE : content.tint;
        if (!this.captionSprite.color.equals(captionTint)) this.captionSprite.color = captionTint;
        this.captionSprite.node.setPosition(
            position.x + (isCondition ? CONDITION_ICON_OFFSET_X : offsets.caption.x),
            position.y + (isCondition ? 0 : offsets.caption.y),
            position.z + offsets.caption.z,
        );
        this.captionLabel.node.setPosition(
            position.x + (isCondition ? CONDITION_VALUE_OFFSET_X : offsets.text.x),
            position.y + (isCondition ? 0 : offsets.text.y),
            position.z + offsets.text.z,
        );
        if (this.captionLabel.string !== content.caption) this.captionLabel.string = content.caption;
        this.captionLabel.node.active = !isLoading && !hasBuilding;
        const textColor = isCondition ? content.conditionTextColor ?? defaultTextColor : defaultTextColor;
        if (!this.captionLabel.color.equals(textColor)) this.captionLabel.color = textColor;
        if (this.badgeLabel.string !== content.badge) this.badgeLabel.string = content.badge;
        this.badgeLabel.node.active = !isLoading && !hasBuilding && content.badge !== '';
        this.button.interactable = content.interactive && !isLoading;
    }

    private readonly handleClick = (): void => {
        if (this.site) this.onClick?.(this.site);
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
        if (this.isInitialized) this.button.node.off(Button.EventType.CLICK, this.handleClick, this);
        for (const visual of [
            this.iconSprite.node,
            this.captionSprite.node,
            this.captionLabel.node,
            this.badgeLabel.node,
        ]) {
            if (visual.isValid && visual.parent !== this.node) visual.destroy();
        }
        this.site = null;
        this.onClick = null;
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
        this.onClick = null;
    }
}
