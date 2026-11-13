import { _decorator, Color, Component, EventMouse, EventTouch, Graphics, instantiate, Label, Node, Sprite, UITransform, UIOpacity, Vec2, Vec3, type SpriteFrame } from 'cc';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapPlotCellView, IBigMapViewState } from '../application/BigMapViewState';
import {
    bigMapNearestPlot, buildBigMapBaseLayout, clampBigMapBaseCamera, pickBigMapBasePlot, zoomBigMapBaseCamera,
    type IBigMapBaseCamera, type IBigMapBaseLayout,
} from './BigMapBasePresentation';
import { BIGMAP_PRESENTATION_TEXT, bigMapHexCorners, buildBigMapProgressPolyline, formatBigMapDuration } from './BigMapPresentationText';
import { BIGMAP_SKIN_COLORS, fitBigMapSprite, requireBigMapTransform } from './BigMapSkin';

import { BigMapBasePlot } from './BigMapBasePlot';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent } from '../application/BigMapEvents';

const { ccclass, property } = _decorator;

/** 长按触发时长（秒）：按住不动 0.4s 进入移建拖拽。 */
const LONG_PRESS_SECONDS = 0.4;
/** 长按判定的手指移动上限（px）：与「点选 vs 平移」共用同一 12px 阈值。 */
const LONG_PRESS_MOVE_LIMIT = 12;

interface IBigMapPlotArt {
    readonly root: Node;
    readonly selection: Graphics;
    readonly glow: Graphics;
    readonly progressRing: Graphics;
    readonly icon: Sprite;
    readonly badge: Sprite;
    readonly badgeTransform: UITransform;
    readonly name: Label;
    readonly status: Label;
    readonly resource: Sprite;
}

@ccclass('BigMapBaseView')
export class BigMapBaseView extends Component {
    private data: IBigMapViewState | null = null;
    private art: IBigMapArt | null = null;
    @property(UITransform) private viewport: UITransform = null;
    @property(Sprite) private background: Sprite = null;
    @property(Node) private content: Node = null;
    @property(UITransform) private contentTransform: UITransform = null;
    @property(UITransform) private fallback: UITransform = null;
    @property(Node) private plots: Node = null;
    @property(Node) private plotTemplate: Node = null;
    /**
     *摆放预览（半透明建筑图，跟着手指走）。
     *
     *原先选完建筑只有一句 Toast + 所有空格画同一道细边，玩家不知道"放下去长什么样、
     *这格到底能不能放"。ghost 把这两件事一次说清：图长什么样、绿还是红。
     *
     *挂在 `BaseContent` 下（与 `BasePlots` 同级）—— 它要跟着地图坐标系动，
     *不能挂在视口上，否则拖动镜头时 ghost 会飘。
     */
    @property(Sprite) private plotGhost: Sprite = null;
    @property(UIOpacity) private plotGhostOpacity: UIOpacity = null;
    private camera: IBigMapBaseCamera = { zoom: 1, x: 0, y: 0 };
    private dragStart: Vec2 | null = null;
    private dragMoved = 0;
    private pinched = false;
    private pinchDistance = 0;
    private moving = false;
    private readonly slots = new Map<number, IBigMapPlotArt>();
    private cells: readonly IBigMapPlotCellView[] = [];
    private layout: IBigMapBaseLayout = buildBigMapBaseLayout([]);
    private currentWidth = 720;
    private currentHeight = 900;
    private selectedHexId = -1;
    private pendingBuildingId = 0;
    /** 摆放态下放得下的格子（红绿预判；`pendingBuildingId === 0` 时恒空）。 */
    private placeable: ReadonlySet<number> = new Set();
    /** ghost 当前吸附的格子；`-1` = 还没指过任何格（回落到选中格）。 */
    private ghostHexId = -1;

    /** 手势状态：idle（无按下）/ press（按下等长按判定）/ dragging（长按触发的移建拖拽）。 */
    private gesture: 'idle' | 'press' | 'dragging' = 'idle';
    /** press 态累计时间（秒），由 update 推进（不依赖 Date.now，测试可注入）。 */
    private pressElapsed = 0;
    /** 按下时命中的候选建筑实例（配置 canMove）；`0` = 没命中可移动建筑。 */
    private pressInstanceId = 0;
    /** dragging 态被拖动建筑的 buildingId（ghost 取图用）。 */
    private dragBuildingId = 0;
    /** 移建态落得下的格子（红绿预判；非移建态恒空）。 */
    private moveable: ReadonlySet<number> = new Set();


    protected onLoad(): void {
        const viewport = this.viewport.node;
        viewport.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        viewport.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        viewport.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        viewport.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        viewport.on(Node.EventType.MOUSE_WHEEL, this.onWheel, this);
    }

    /**
     *长按检测心跳：手指不动时没有 touch 事件，只能靠 update 累计 pressElapsed。
     *
     *非 press 态直接返回，不做逐帧空转。到点且候选建筑可移动才触发拖拽。
     */
    update(dt: number): void {
        if (this.gesture !== 'press') return;
        this.pressElapsed += Number.isFinite(dt) && dt > 0 ? dt : 0;
        if (this.pressElapsed >= LONG_PRESS_SECONDS && this.pressInstanceId !== 0) this.triggerDragging();
    }

    /** 非摆放态单指按下：起一个长按候选，命中可移动建筑才记录实例。 */
    private beginPress(screen: Vec3): void {
        this.gesture = 'press';
        this.pressElapsed = 0;
        this.pressInstanceId = this.pressCandidateAt(screen);
    }

    /** 从最上方建筑向下拾取 icon，只把配置 canMove 的建筑当长按候选。 */
    private pressCandidateAt(screen: Vec3): number {
        if (this.moving) return 0;
        for (let i = this.layout.paintOrder.length - 1; i >= 0; i -= 1) {
            const hexId = this.layout.paintOrder[i];
            const slot = this.slots.get(hexId);
            const cell = this.cells.find((item) => item.hexId === hexId);
            if (!slot || !cell || !slot.root.active || cell.slot === 'empty') continue;
            if (!this.hitSprite(slot.icon, screen)) continue;
            const config = this.data?.buildingConfigs.get(cell.buildingId);
            if (config?.canMove) return cell.instanceId;
        }
        return 0;
    }

    /** 长按到点：乐观进拖拽态并通知 controller 进移建态（moveBegin）。 */
    private triggerDragging(): void {
        const instanceId = this.pressInstanceId;
        //移动的是建筑实例：限定非空格，避免不规范数据里空格带了同 instanceId 时找错格。
        const cell = this.cells.find((item) => item.instanceId === instanceId && item.slot !== 'empty');
        this.gesture = 'dragging';
        this.dragBuildingId = cell?.buildingId ?? 0;
        this.ghostHexId = cell?.hexId ?? -1;
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'moveBegin', instanceId } });
        //乐观窗口先用现有数据画一帧，controller 回 render（moveable 下发）后再精确红绿。
        this.refreshGhost();
    }

    /** 按下后移动超 12px（仲裁为平移）或双指介入时取消长按；已触发的拖拽不受影响。 */
    private cancelPress(): void {
        if (this.gesture === 'dragging') return;
        this.gesture = 'idle';
        this.pressInstanceId = 0;
        this.pressElapsed = 0;
    }

    /** 拖拽松手：落点在 moveable 内才发 plotTap（controller 的 move 分支 requestMove），否则不动。 */
    private finishDragging(screen: Vec3): void {
        const target = this.placingHexAt(screen);
        this.gesture = 'idle';
        this.dragBuildingId = 0;
        if (target >= 0 && this.moveable.has(target)) this.tapPlot(target);
    }

    build(data: IBigMapViewState, width: number, height: number): void {
        this.data = data;
        this.placeable = new Set(data.placeableHexIds);
        this.moveable = new Set(data.moveableHexIds);
        this.currentWidth = width;
        this.currentHeight = height;
        for (const slot of this.slots.values()) slot.root.destroy();
        this.slots.clear();
        this.cells = data.plots;
        requireBigMapTransform(this.node).setContentSize(width, height);
        for (const cell of this.cells) {
            const plot = instantiate(this.plotTemplate);
            plot.name = `Plot_${cell.hexId}`;
            plot.setParent(this.plots);
            plot.active = true;
            const bindings = plot.getComponent(BigMapBasePlot);
            if (!bindings) throw new Error('[BigMapBaseView] 地块模板缺少 BigMapBasePlot');
            //光效层级由代码定，不依赖 prefab 的 `_children` 顺序：
            //底光要压在建筑图下面（index 1），进度环要盖在建筑图上面（index 3）。
            //（MCP 保存 prefab 时 `_children` 未必按编辑器里看到的重排，实测踩过。）
            bindings.glow.node.setSiblingIndex(1);
            bindings.progressRing.node.setSiblingIndex(3);
            //名字牌描边：`cc.LabelOutline` 组件在 3.8 已废弃（`LabelOutline.width` 会刷 deprecated 警告），
            //直接用 `Label` 自带的 `outlineWidth` / `outlineColor`。参考图是明显的白字深边，2px 才压得住。
            bindings.nameLabel.outlineWidth = 2;
            bindings.nameLabel.outlineColor = BIGMAP_SKIN_COLORS.nameOutline;
            this.slots.set(cell.hexId, {
                root: plot, selection: bindings.selection, glow: bindings.glow,
                progressRing: bindings.progressRing, icon: bindings.icon, badge: bindings.badge,
                badgeTransform: bindings.badgeTransform, name: bindings.nameLabel,
                status: bindings.status, resource: bindings.resource,
            });
        }
        this.resize(width, height);
        this.camera = { zoom: Math.min(1, width / 600), x: 0, y: 0 };
        const main = this.cells.find((cell) => cell.buildingId === data.mainBuildingId);
        this.focusOn(main?.hexId ?? -1);
    }

    render(data: IBigMapViewState): void {
        this.data = data;
        this.selectedHexId = data.ui.selectedPlotHexId;
        this.pendingBuildingId = data.ui.pendingBuildingId;
        this.moving = data.ui.pendingMoveInstanceId !== 0;
        this.placeable = new Set(data.placeableHexIds);
        this.moveable = new Set(data.moveableHexIds);
        //退出摆放态就把 ghost 的"指过哪格"忘掉，否则下次选建筑会先闪一下上次的位置。
        if (this.pendingBuildingId === 0) this.ghostHexId = -1;
        this.refresh();
    }

    setArt(art: IBigMapArt): void {
        this.art = art;
        this.background.spriteFrame = art.baseBackground;
        this.background.node.active = !!art.baseBackground;
        this.resize(this.currentWidth, this.currentHeight);
    }

    resize(width: number, height: number): void {
        this.currentWidth = width;
        this.currentHeight = height;
        this.viewport.setContentSize(width, height);
        this.fallback.setContentSize(width, height);
        this.layout = buildBigMapBaseLayout(this.cells);
        this.contentTransform.setContentSize(this.layout.mapSize, this.layout.mapSize);
        requireBigMapTransform(this.background.node).setContentSize(this.layout.mapSize, this.layout.mapSize);
        for (const [index, hexId] of this.layout.paintOrder.entries()) {
            const slot = this.slots.get(hexId);
            if (slot) slot.root.setSiblingIndex(index);
        }
        this.refresh();
        this.applyCamera(this.camera);
    }

    setMoving(moving: boolean): void {
        this.moving = moving;
        this.refresh();
    }

    setPendingBuilding(buildingId: number): void {
        //换建筑就重选位置：沿用上一座的落点会让 ghost 先闪一下错的图。
        if (this.pendingBuildingId !== buildingId) this.ghostHexId = -1;
        this.pendingBuildingId = buildingId;
        this.refresh();
    }

    get pending(): number { return this.pendingBuildingId; }
    get selected(): number { return this.selectedHexId; }

    select(hexId: number): void {
        this.selectedHexId = hexId;
        this.refresh();
    }

    refresh(): void {
        const data = this.data;
        if (!data) return;
        this.cells = data.plots;
        for (const cell of this.cells) {
            const slot = this.slots.get(cell.hexId);
            const point = this.layout.points.get(cell.hexId);
            if (!slot || !point) continue;
            slot.root.setPosition(point.x, point.y, 0);
            const width = this.layout.tileWidth;
            const height = this.layout.tileHeight;
            const isEmpty = cell.slot === 'empty';
            const isSelected = cell.hexId === this.selectedHexId;
            slot.selection.clear();
            if (isSelected) {
                //双环：深色外环撑对比（对沙地 8.96:1），暖金内环给「选中」语感。
                //单环亮色在沙地上做不出 3:1（纯白也只有 2.09:1），这是唯一可靠的画法。
                this.strokeHex(slot.selection, width, height, BIGMAP_SKIN_COLORS.selectOuter, 6);
                this.strokeHex(slot.selection, width, height, BIGMAP_SKIN_COLORS.selectInner, 2);
            } else if (isEmpty && (this.pendingBuildingId !== 0 || this.moving)) {
                //摆放态：逐格判「放得下 / 放不下」；移建态：逐格判 bigMapCanMove 落点。
                //绿边 vs 红边（对沙地 3.87:1 / 5.06:1），两种模式各用各的预判集合。
                const blocked = this.pendingBuildingId !== 0
                    ? !this.placeable.has(cell.hexId)
                    : !this.moveable.has(cell.hexId);
                this.strokeHex(slot.selection, width, height,
                    blocked ? BIGMAP_SKIN_COLORS.placeBad : BIGMAP_SKIN_COLORS.placeOk, 2);
            }
            this.renderGlow(slot.glow, isSelected, width, height);
            this.renderProgressRing(slot.progressRing, cell, width, height);
            //建造中也要用这座建筑自己的图（2026-11-11 用户口径：那张通用脚手架概念图可以去掉）。
            // 建造中的格拿不到 `buildingId`：`projectBigMapServerBase` 只把 `state !== 1` 的建筑
            //放进 `base.buildings`，在建的那座在 `queues` 里 ⇒ 从队列按 `anchorHexId` 反查。
            //实在查不到（旧存档 / 本地态）才退回脚手架图，别让格子空着。
            const iconBuildingId = cell.buildingId !== 0
                ? cell.buildingId : data.queueBuildingIds.get(cell.hexId) ?? 0;
            const frame = this.art?.buildings.get(iconBuildingId)
                ?? (cell.buildingId === data.mainBuildingId ? this.art?.home : null)
                ?? (cell.slot === 'constructing' ? this.art?.construction : null);
            //建筑高度撑满一格（主城略高一点，压住视觉重心）；
            //水平居中、底部略沉 `-height * 0.04` —— 正方图直接居中会在等距视角下发飘。
            const iconHeight = this.fitPlotIcon(slot.icon, frame,
                height * (cell.buildingId === data.mainBuildingId ? 1.06 : 1), -height * 0.04);
            const labelScale = Math.min(1, this.layout.scale);
            slot.name.node.setScale(labelScale, labelScale, 1);
            slot.status.node.setScale(labelScale, labelScale, 1);
            //名字牌：只在选中时出，且不带底板。
            //2026-11-11 用户口径（参考图）：建筑上方两行白字「科研中心 / 等级21」，
            //平时什么都不挂；摆 / 搬移的引导态仍然要显示，否则玩家不知道点哪。
            const showName = isSelected || this.pendingBuildingId !== 0 || this.moving;
            slot.name.node.active = showName && (!isEmpty || this.pendingBuildingId !== 0);
            slot.name.string = isEmpty ? BIGMAP_PRESENTATION_TEXT.emptyPlot
                : cell.slot === 'constructing' ? (data.queueNames.get(cell.hexId) ?? '')
                    : `${cell.name}\n${BIGMAP_PRESENTATION_TEXT.buildingLevel}${cell.level}`;
            //无底板 ⇒ 必须米白字，深棕字在沙地上直接糊成一片。
            slot.name.color = BIGMAP_SKIN_COLORS.text;
            //放到建筑头顶，而不是压在脚下（参考图就是浮在上方）。
            slot.name.node.setPosition(0, isEmpty ? 0 : iconHeight / 2 + height * 0.16, 0);
            //底板彻底停用：保留 prefab 绑定与 `badgeTransform`，但永不显示。
            slot.badge.node.active = false;
            slot.badgeTransform.setContentSize(width * 0.98, 28 * labelScale);
            slot.badge.node.setPosition(0, -height * 0.44, 0);
            //建造中也走「02:00」而不是裸 `120s`：超过一小时要玩家自己换算。
            slot.status.string = cell.remainSeconds > 0 ? formatBigMapDuration(cell.remainSeconds)
                : cell.stored > 0 ? `${BIGMAP_PRESENTATION_TEXT.stored} ${cell.stored}` : '';
            slot.status.node.active = slot.status.string.length > 0;
            slot.status.node.setPosition(0, iconHeight / 2 + height * 0.08, 0);
            const resourceType = cell.resType;
            fitBigMapSprite(slot.resource, cell.stored > 0 && resourceType ? this.art?.resources.get(resourceType) ?? null : null,
                26 * this.layout.scale, 0, iconHeight / 2 + height * 0.3);
        }
        this.refreshGhost();
        this.syncVisibility();
    }

    /**
     *摆放预览：半透明建筑图吸在当前格上。
     *
     *没指过格时落在选中格（点完建造目录、还没动手指的那一帧就有东西可看）；
     *指过就跟着手指。可放 = 原色 + 150 不透明，不可放 = 染红 + 90。
     */
    private refreshGhost(): void {
        //允许未绑定：ghost 是「体验增强」，缺了应该退回旧行为（只有红绿边），
        //而不是整个基地页崩掉。绑定完整时行为见下。
        if (!this.plotGhost || !this.plotGhostOpacity) return;
        const isPlacing = this.pendingBuildingId !== 0;
        //长按拖拽（含 moveBegin 已发、controller 尚未回 render 的乐观窗口）。
        const isDragging = this.gesture === 'dragging';
        const ghostBuildingId = isPlacing ? this.pendingBuildingId : this.dragBuildingId;
        const frame = ghostBuildingId !== 0 ? this.art?.buildings.get(ghostBuildingId) ?? null : null;
        const hexId = this.ghostHexId >= 0 ? this.ghostHexId : this.selectedHexId;
        const point = hexId >= 0 ? this.layout.points.get(hexId) : undefined;
        if (!isPlacing && !isDragging) {
            this.plotGhost.node.active = false;
            return;
        }
        if (!frame || !point) {
            this.plotGhost.node.active = false;
            return;
        }
        this.plotGhost.node.active = true;
        //与真正落位后的建筑同一套尺寸口径，否则 ghost 和建成的图对不上（看起来"放歪了"）。
        this.fitPlotIcon(this.plotGhost, frame, this.layout.tileHeight, 0);
        this.plotGhost.node.setPosition(point.x, point.y - this.layout.tileHeight * 0.04, 0);
        //两种模式各用各的落点集合：摆放 placeable，拖拽 moveable。
        const ok = isPlacing ? this.placeable.has(hexId) : this.moveable.has(hexId);
        this.plotGhost.color = ok ? Color.WHITE : BIGMAP_SKIN_COLORS.placeBad;
        this.plotGhostOpacity.opacity = ok ? 150 : 90;
    }

    /**
     *把建筑图钉成「高度 = 指定高度、水平居中、底边贴 `y`」。
     *
     *为什么按高度而不是宽度约束：格子是扁六边形（`tileWidth : tileHeight ≈ 147 : 96`），
     *建筑图是正方形。按宽度撑（147）会让图高 147，上下各溢出相邻格 25px；
     *按高度撑，建筑的视觉体量才和格子一致 —— 这也是等距视角下「一格一建筑」的正常读法。
     *
     *不复用 `fitBigMapSprite`：那个函数靠 `setScale`，而缩放的是节点自身 contentSize。
     *`PlotTemplate/Building` 的 Sprite 是 RAW 模式，设 `spriteFrame` 时引擎会把 contentSize
     *改成图片原始尺寸 ⇒ 换一张图（212 的新图 / 279 的旧兜底图）尺寸就漂，
     *表现为「建筑忽然变小、还偏出格子中心」。
     *
     *@returns 实际占高（调用方用它排状态文字 / 收取图标）
     */
    private fitPlotIcon(sprite: Sprite, frame: SpriteFrame | null, height: number, y: number): number {
        sprite.spriteFrame = frame;
        sprite.node.active = !!frame;
        if (!frame) return 0;
        //顺序要紧：先给 frame，再改 sizeMode/尺寸 —— RAW 的尺寸纠正发生在 frame setter 里。
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        const frameHeight = Math.max(1, frame.rect.height);
        const width = frame.rect.width * height / frameHeight;
        requireBigMapTransform(sprite.node).setContentSize(width, height);
        sprite.node.setScale(1, 1, 1);
        sprite.node.setPosition(0, y, 0);
        return height;
    }

    /** 屏幕坐标 → 格 id（ghost 与放置共用同一条换算，避免「看到的」和「放下去的」不是一格）。 */
    private hexAt(screen: Vec3): number {
        const local = this.contentTransform.convertToNodeSpaceAR(screen);
        return pickBigMapBasePlot(this.layout, local.x, local.y);
    }

    /**
     *摆放态用最近格吸附，而不是精确命中六边形。
     *
     *六边形之间天生有空隙，`pickBigMapBasePlot` 点偏一点就返回 -1：
     *玩家明明"点了那个格子"，界面却什么都没发生，也没提示 —— 就是那次
     *「我找了放置位置放置，但没发 CmdSlgBuildReqMsg」的现场。
     *放置是"选落点"，不需要像素级精度，吸到最近格更符合直觉（也是 SLG 的普遍做法）。
     */
    private nearestHex(screen: Vec3, tolerance: number): number {
        const local = this.contentTransform.convertToNodeSpaceAR(screen);
        return bigMapNearestPlot(this.layout, local.x, local.y, tolerance);
    }

    /** 摆放态取格：先精确命中，再按 `tileHeight * 1.1` 吸附（覆盖六边形之间的空隙）。 */
    private placingHexAt(screen: Vec3): number {
        const hit = this.hexAt(screen);
        return hit >= 0 ? hit : this.nearestHex(screen, this.layout.tileHeight * 1.1);
    }

    private moveGhostTo(point: Vec2): void {
        const hexId = this.placingHexAt(new Vec3(point.x, point.y, 0));
        if (hexId === this.ghostHexId) return;
        this.ghostHexId = hexId;
        this.refreshGhost();
    }

    /** 选中底光：一格暖金椭圆，压在建筑图下面。不选中时清空（不隐藏节点，省一次 active 切换）。 */
    private renderGlow(glow: Graphics, selected: boolean, width: number, height: number): void {
        glow.clear();
        if (!selected) return;
        glow.fillColor = BIGMAP_SKIN_COLORS.glowFill;
        glow.ellipse(0, -height * 0.08, width * 0.42, height * 0.30);
        glow.fill();
    }

    /**
     *建造进度环：底圈 + 已建部分。
     *
     *二十几格同屏时，「哪几格在施工」原先只能靠一行 `120s` 小字找，等于没有；
     *进度环把状态搬到格子轮廓上，扫一眼就能定位。
     */
    private renderProgressRing(ring: Graphics, cell: IBigMapPlotCellView, width: number, height: number): void {
        ring.clear();
        //用 `!(x > 0)` 而不是 `x <= 0`：老夹具 / 老存档里可能没有 `progress` 字段，
        //`undefined <= 0` 是 false，会一路走到 `points[0]` 上炸掉。
        if (!(cell.progress > 0)) return;
        const inner = 0.94;
        const w = width * inner;
        const h = height * inner;
        //底圈：让「还剩多少」有参照，否则半圈进度看起来像满圈。
        const corners = bigMapHexCorners(w, h);
        ring.strokeColor = BIGMAP_SKIN_COLORS.ringUnder;
        ring.lineWidth = 3;
        ring.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) ring.lineTo(corners[i].x, corners[i].y);
        ring.close();
        ring.stroke();
        //已建部分：剩余不足 1 分钟转暖橙，提示「马上好」。
        const points = buildBigMapProgressPolyline(w, h, cell.progress);
        ring.strokeColor = cell.remainSeconds > 0 && cell.remainSeconds <= 60
            ? BIGMAP_SKIN_COLORS.ringUrgent : BIGMAP_SKIN_COLORS.ringDone;
        ring.lineWidth = 3;
        ring.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i += 1) ring.lineTo(points[i].x, points[i].y);
        ring.stroke();
    }

    /** 描一个六边格轮廓 —— 选中双环 / 放置候选共用同一条路径，避免两处各画一遍。 */
    private strokeHex(graphics: Graphics, width: number, height: number, color: Color, lineWidth: number): void {
        graphics.strokeColor = color;
        graphics.lineWidth = lineWidth;
        const corners = bigMapHexCorners(width, height);
        graphics.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i += 1) graphics.lineTo(corners[i].x, corners[i].y);
        graphics.close();
        graphics.stroke();
    }

    focusOn(hexId: number): void {
        const point = this.layout.points.get(hexId);
        this.applyCamera({ ...this.camera, x: -(point?.x ?? 0) * this.camera.zoom, y: -(point?.y ?? 0) * this.camera.zoom });
    }

    zoomBy(factor: number, anchor = new Vec2()): void {
        if (!Number.isFinite(factor) || factor <= 0) return;
        this.applyCamera(zoomBigMapBaseCamera(this.layout, this.currentWidth, this.currentHeight, this.camera, factor, anchor));
    }

    private applyCamera(camera: IBigMapBaseCamera): void {
        this.camera = clampBigMapBaseCamera(this.layout, this.currentWidth, this.currentHeight, camera);
        this.content.setScale(this.camera.zoom, this.camera.zoom, 1);
        this.content.setPosition(this.camera.x, this.camera.y, 0);
        this.syncVisibility();
    }

    private syncVisibility(): void {
        const { zoom, x, y } = this.camera;
        for (const [hexId, slot] of this.slots) {
            const point = this.layout.points.get(hexId);
            if (!point) continue;
            const iconTop = slot.icon.node.position.y + requireBigMapTransform(slot.icon.node).height * Math.abs(slot.icon.node.scale.y) / 2;
            const margin = Math.max(200, iconTop + 100) * zoom;
            const visible = Math.abs(point.x * zoom + x) < this.currentWidth / 2 + margin
                && Math.abs(point.y * zoom + y) < this.currentHeight / 2 + margin;
            if (slot.root.active !== visible) slot.root.active = visible;
        }
    }

    private toViewport(point: Vec2): Vec3 {
        return this.viewport.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
    }

    private onTouchStart(event: EventTouch): void {
        this.dragStart = event.getUILocation();
        const touches = event.getAllTouches();
        if (touches.length < 2) {
            this.dragMoved = 0;
            this.pinched = false;
            //摆放态下从按下就开始预览，别等手指抬起来才看得见。
            if (this.pendingBuildingId !== 0) {
                this.moveGhostTo(event.getUILocation());
                return;
            }
            //非摆放态：起长按候选（内部判断是否命中可移动建筑、是否已在移建态）。
            this.beginPress(new Vec3(event.getUILocation().x, event.getUILocation().y, 0));
            return;
        }
        this.pinched = true;
        this.cancelPress();
        const first = touches[0].getUILocation();
        const second = touches[1].getUILocation();
        this.pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
    }

    private onTouchMove(event: EventTouch): void {
        const touches = event.getAllTouches();
        if (touches.length >= 2) {
            this.pinched = true;
            this.cancelPress();
            const first = touches[0].getUILocation();
            const second = touches[1].getUILocation();
            const distance = Math.hypot(first.x - second.x, first.y - second.y);
            const anchor = this.toViewport(new Vec2((first.x + second.x) / 2, (first.y + second.y) / 2));
            if (this.pinchDistance > 0) this.zoomBy(distance / this.pinchDistance, new Vec2(anchor.x, anchor.y));
            this.pinchDistance = distance;
            return;
        }
        if (!this.dragStart || this.pinched) return;
        const current = event.getUILocation();
        //摆放态：单指在「选落点」，不是平移镜头 —— 否则手指一动地图跟着跑，ghost 永远对不准。
        //双指缩放仍然可用（上面那条 `touches.length >= 2` 分支）。
        if (this.pendingBuildingId !== 0) {
            this.moveGhostTo(current);
            return;
        }
        //长按已触发：单指在拖 ghost 跟手，不平移镜头。
        if (this.gesture === 'dragging') {
            this.moveGhostTo(current);
            return;
        }
        const previous = this.toViewport(this.dragStart);
        const local = this.toViewport(current);
        this.dragMoved += Math.hypot(current.x - this.dragStart.x, current.y - this.dragStart.y);
        //长按候选还在等：累计移动超过 12px 即仲裁为平移，收起长按（之后正常拖镜头）。
        if (this.gesture === 'press' && this.dragMoved > LONG_PRESS_MOVE_LIMIT) this.cancelPress();
        this.applyCamera({ ...this.camera, x: this.camera.x + local.x - previous.x, y: this.camera.y + local.y - previous.y });
        this.dragStart = current;
    }

    private hitSprite(sprite: Sprite, point: Vec3): boolean {
        if (!sprite.node.active || !sprite.spriteFrame) return false;
        const transform = requireBigMapTransform(sprite.node);
        const local = transform.convertToNodeSpaceAR(point);
        return local.x >= -transform.width * transform.anchorX && local.x <= transform.width * (1 - transform.anchorX)
            && local.y >= -transform.height * transform.anchorY && local.y <= transform.height * (1 - transform.anchorY);
    }

    private onTouchEnd(event: EventTouch): void {
        const point = event.getUILocation();
        const screen = new Vec3(point.x, point.y, 0);
        //摆放态：松手位置就是落点。拖动在这里是"选位置"，所以不受 12px 防误触阈值约束
        //（那个阈值是给"平移镜头 vs 点选"用的，摆放态本来就不平移）。
        if (this.pendingBuildingId !== 0 && !this.pinched) {
            this.onTouchCancel();
            const target = this.placingHexAt(screen);
            //吸附后仍为 -1 = 点在整张基地图外，明确不当作"放在这里"。
            if (target >= 0) this.tapPlot(target);
            return;
        }
        //长按拖拽态松手：落点合法才 requestMove，拖回原位/非法格不动作（等同取消）。
        if (this.gesture === 'dragging' && !this.pinched) {
            this.finishDragging(screen);
            this.onTouchCancel();
            return;
        }
        const canSelect = this.dragStart !== null && this.dragMoved <= 12 && !this.pinched;
        this.onTouchCancel();
        if (!canSelect) return;
        //从最上方建筑向下拾取，收取图标也走同一手势判定，避免拖动松手时误收取。
        for (let i = this.layout.paintOrder.length - 1; i >= 0; i -= 1) {
            const hexId = this.layout.paintOrder[i];
            const slot = this.slots.get(hexId);
            if (!slot || !slot.root.active) continue;
            if (this.hitSprite(slot.resource, screen)) {
                const cell = this.cells.find((item) => item.hexId === hexId);
                if (cell && cell.stored > 0) EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'harvest', instanceId: cell.instanceId } });
                return;
            }
            if (this.hitSprite(slot.icon, screen) || this.hitSprite(slot.badge, screen)) {
                this.tapPlot(hexId);
                return;
            }
        }
        const hexId = this.hexAt(screen);
        if (hexId >= 0) {
            this.tapPlot(hexId);
            return;
        }
        //点到格子外 = 点空地：非模态建筑卡没有"点空白关闭"的天然时机，
        //这里补上 —— 否则选中态和卡片会一直挂着。摆放 / 搬移态不打断（那两手势还没结束）。
        if (this.selectedHexId >= 0 && this.pendingBuildingId === 0 && !this.moving) {
            EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'clear' } });
        }
    }

    private tapPlot(hexId: number): void {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'plotTap', hexId } });
    }

    private onTouchCancel(): void {
        this.dragStart = null;
        this.pinchDistance = 0;
        this.pinched = false;
        this.gesture = 'idle';
        this.pressInstanceId = 0;
        this.pressElapsed = 0;
        this.dragBuildingId = 0;
    }

    private onWheel(event: EventMouse): void {
        const delta = event.getScrollY();
        if (delta === 0) return;
        const anchor = this.toViewport(event.getUILocation());
        this.zoomBy(delta > 0 ? 1.12 : 1 / 1.12, new Vec2(anchor.x, anchor.y));
    }

    protected onDisable(): void { this.onTouchCancel(); }

    protected onDestroy(): void {
        this.data = null;
        this.art = null;
        this.slots.clear();
    }
}
