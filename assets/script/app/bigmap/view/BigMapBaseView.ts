import { _decorator, Color, Component, EventMouse, EventTouch, Graphics, instantiate, isValid, Label, Node, Sprite, UITransform, Vec2, Vec3 } from 'cc';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapViewState, IBigMapPlotCellView } from '../application/BigMapViewState';
import {
    buildBigMapBaseLayout, clampBigMapBaseCamera, pickBigMapBasePlot, zoomBigMapBaseCamera,
    type IBigMapBaseCamera, type IBigMapBaseLayout,
} from './BigMapBasePresentation';
import { BIGMAP_SKIN_COLORS, fitBigMapSprite, requireBigMapTransform } from './BigMapSkin';
import { BIGMAP_COLORS } from './BigMapTheme';
import { BIGMAP_PRESENTATION_TEXT } from './BigMapPresentationText';

import { BigMapBasePlot } from './BigMapBasePlot';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent } from '../application/BigMapEvents';

const { ccclass, property } = _decorator;

interface IBigMapPlotArt {
    readonly root: Node;
    readonly selection: Graphics;
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


    build(data: IBigMapViewState, width: number, height: number): void {
        this.data = data;
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
            this.slots.set(cell.hexId, {
                root: plot, selection: bindings.selection, icon: bindings.icon, badge: bindings.badge,
                badgeTransform: bindings.badgeTransform, name: bindings.nameLabel,
                status: bindings.status, resource: bindings.resource,
            });
        }
        const viewport = this.viewport.node;
        viewport.targetOff(this);
        viewport.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        viewport.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        viewport.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        viewport.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        viewport.on(Node.EventType.MOUSE_WHEEL, this.onWheel, this);
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
            if (isSelected || (isEmpty && (this.pendingBuildingId !== 0 || this.moving))) {
                const graphics = slot.selection;
                graphics.strokeColor = BIGMAP_SKIN_COLORS.cyan;
                graphics.lineWidth = isSelected ? 3 : 1;
                graphics.moveTo(width / 2, 0);
                graphics.lineTo(width / 4, height / 2);
                graphics.lineTo(-width / 4, height / 2);
                graphics.lineTo(-width / 2, 0);
                graphics.lineTo(-width / 4, -height / 2);
                graphics.lineTo(width / 4, -height / 2);
                graphics.close();
                graphics.stroke();
            }
            const frame = cell.slot === 'constructing' ? this.art?.construction ?? null
                : this.art?.buildings.get(cell.buildingId) ?? (cell.buildingId === data.mainBuildingId ? this.art?.home ?? null : null);
            const iconWidth = width * (cell.buildingId === data.mainBuildingId ? 0.95 : 0.82);
            const iconHeight = frame ? frame.rect.height * iconWidth / frame.rect.width : 0;
            fitBigMapSprite(slot.icon, frame, iconWidth, 0, iconHeight / 2 - height * 0.12);
            const labelScale = Math.min(1, this.layout.scale);
            slot.name.node.setScale(labelScale, labelScale, 1);
            slot.status.node.setScale(labelScale, labelScale, 1);
            slot.name.string = isEmpty ? BIGMAP_PRESENTATION_TEXT.emptyPlot : cell.slot === 'constructing'
                ? (data.queueNames.get(cell.hexId) ?? '') : `${cell.name}  Lv.${cell.level}`;
            slot.name.node.active = !isEmpty || this.pendingBuildingId !== 0 || this.moving;
            slot.name.color = isEmpty ? BIGMAP_COLORS.text : BIGMAP_SKIN_COLORS.text;
            slot.name.node.setPosition(0, isEmpty ? 0 : -height * 0.25, 0);
            slot.badge.spriteFrame = this.art?.ui.get('badge') ?? null;
            slot.badge.node.active = !isEmpty && !!slot.badge.spriteFrame;
            slot.badgeTransform.setContentSize(width * 0.98, 28 * labelScale);
            slot.badge.node.setPosition(0, -height * 0.25, 0);
            slot.status.string = cell.remainSeconds > 0 ? `${cell.remainSeconds}s`
                : cell.stored > 0 ? `${BIGMAP_PRESENTATION_TEXT.stored} ${cell.stored}` : '';
            slot.status.node.active = slot.status.string.length > 0;
            slot.status.node.setPosition(0, iconHeight + height * 0.05, 0);
            const resourceType = cell.resType;
            fitBigMapSprite(slot.resource, cell.stored > 0 && resourceType ? this.art?.resources.get(resourceType) ?? null : null,
                26 * this.layout.scale, 0, iconHeight + height * 0.35);
        }
        this.syncVisibility();
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
            return;
        }
        this.pinched = true;
        const first = touches[0].getUILocation();
        const second = touches[1].getUILocation();
        this.pinchDistance = Math.hypot(first.x - second.x, first.y - second.y);
    }

    private onTouchMove(event: EventTouch): void {
        const touches = event.getAllTouches();
        if (touches.length >= 2) {
            this.pinched = true;
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
        const previous = this.toViewport(this.dragStart);
        const local = this.toViewport(current);
        this.dragMoved += Math.hypot(current.x - this.dragStart.x, current.y - this.dragStart.y);
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
        const canSelect = this.dragStart !== null && this.dragMoved <= 12 && !this.pinched;
        this.onTouchCancel();
        if (!canSelect) return;
        const point = event.getUILocation();
        const screen = new Vec3(point.x, point.y, 0);
        // 从最上方建筑向下拾取，收取图标也走同一手势判定，避免拖动松手时误收取。
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
        const local = this.contentTransform.convertToNodeSpaceAR(screen);
        const hexId = pickBigMapBasePlot(this.layout, local.x, local.y);
        if (hexId >= 0) this.tapPlot(hexId);
    }

    private tapPlot(hexId: number): void {
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'plotTap', hexId } });
    }

    private onTouchCancel(): void {
        this.dragStart = null;
        this.pinchDistance = 0;
        this.pinched = false;
    }

    private onWheel(event: EventMouse): void {
        const delta = event.getScrollY();
        if (delta === 0) return;
        const anchor = this.toViewport(event.getUILocation());
        this.zoomBy(delta > 0 ? 1.12 : 1 / 1.12, new Vec2(anchor.x, anchor.y));
    }

    protected onDisable(): void { this.onTouchCancel(); }

    protected onDestroy(): void {
        // viewport 是本节点的子节点，引擎销毁顺序是「子节点 → 自身组件」，走到这里它已销毁，
        // `viewport.node` 已被 `_destruct` 置 null；`if (this.viewport)` 挡不住已销毁对象，必须用 isValid。
        if (isValid(this.viewport)) this.viewport.node.targetOff(this);
        this.data = null;
        this.art = null;
        this.slots.clear();
    }
}
