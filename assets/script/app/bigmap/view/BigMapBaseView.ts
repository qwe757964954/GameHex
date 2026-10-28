import { _decorator, Color, Component, EventTouch, Graphics, Label, Mask, Node, Sprite, UITransform, Vec3 } from 'cc';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import type { BigMapPresenter, IBigMapPlotCellView } from '../application/BigMapPresenter';
import { buildBigMapBaseLayout, pickBigMapBasePlot, type IBigMapBaseLayout } from './BigMapBasePresentation';
import { bigMapGroundIndex } from './BigMapWorldLayout';
import { BIGMAP_SKIN_COLORS, createBigMapSprite, fitBigMapSprite, requireBigMapTransform } from './BigMapSkin';
import { BIGMAP_COLORS, createLabel, createUiNode } from './BigMapTheme';
import { BIGMAP_PRESENTATION_TEXT } from './BigMapPresentationText';

const { ccclass } = _decorator;

interface IBigMapPlotArt {
    readonly root: Node;
    readonly pad: Sprite;
    readonly padTransform: UITransform;
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
    private presenter: BigMapPresenter | null = null;
    private art: IBigMapArt | null = null;
    private viewport: UITransform = null!;
    private background: Sprite = null!;
    private readonly slots = new Map<number, IBigMapPlotArt>();
    private cells: readonly IBigMapPlotCellView[] = [];
    private layout: IBigMapBaseLayout = buildBigMapBaseLayout([], 720, 900);
    private currentWidth = 720;
    private currentHeight = 900;
    private selectedHexId = -1;
    private pendingBuildingId = 0;

    onTap: ((hexId: number) => void) | null = null;
    onHarvest: ((instanceId: number) => void) | null = null;

    build(presenter: BigMapPresenter, width: number, height: number): void {
        this.presenter = presenter;
        this.currentWidth = width;
        this.currentHeight = height;
        this.node.destroyAllChildren();
        this.slots.clear();
        this.cells = presenter.plotCells();
        const root = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        root.setContentSize(width, height);
        const viewport = createUiNode('BaseViewport', this.node, width, height);
        this.viewport = requireBigMapTransform(viewport);
        viewport.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
        const fallback = createUiNode('BaseFallback', viewport, width, height).addComponent(Graphics);
        fallback.fillColor = new Color(189, 149, 99);
        fallback.rect(-width / 2, -height / 2, width, height);
        fallback.fill();
        this.background = createBigMapSprite('BaseGround', viewport);
        const plots = createUiNode('BasePlots', viewport);
        for (const cell of this.cells) {
            const plot = createUiNode(`Plot_${cell.hexId}`, plots);
            const pad = createBigMapSprite('Foundation', plots);
            pad.sizeMode = Sprite.SizeMode.CUSTOM;
            pad.trim = false;
            const padTransform = requireBigMapTransform(pad.node);
            const selection = createUiNode('Selection', plot).addComponent(Graphics);
            const icon = createBigMapSprite('Building', plot);
            const badge = createBigMapSprite('Nameplate', plot);
            badge.type = Sprite.Type.SLICED;
            badge.sizeMode = Sprite.SizeMode.CUSTOM;
            const badgeTransform = requireBigMapTransform(badge.node);
            const name = createLabel(plot, '', 16, BIGMAP_SKIN_COLORS.text, 140, 24);
            name.horizontalAlign = Label.HorizontalAlign.CENTER;
            name.overflow = Label.Overflow.SHRINK;
            const status = createLabel(plot, '', 14, BIGMAP_SKIN_COLORS.gold, 140, 23);
            status.horizontalAlign = Label.HorizontalAlign.CENTER;
            status.overflow = Label.Overflow.SHRINK;
            status.enableOutline = true;
            status.outlineColor = BIGMAP_SKIN_COLORS.dark;
            status.outlineWidth = 2;
            const resource = createBigMapSprite('Harvest', plot);
            const select = (event: EventTouch): void => {
                event.propagationStopped = true;
                this.select(cell.hexId);
                this.onTap?.(cell.hexId);
            };
            icon.node.on(Node.EventType.TOUCH_END, select);
            badge.node.on(Node.EventType.TOUCH_END, select);
            name.node.on(Node.EventType.TOUCH_END, select);
            resource.node.on(Node.EventType.TOUCH_END, (event: EventTouch) => {
                event.propagationStopped = true;
                const current = this.cells.find((item) => item.hexId === cell.hexId);
                if (current && current.stored > 0) this.onHarvest?.(current.instanceId);
            });
            this.slots.set(cell.hexId, { root: plot, pad, padTransform, selection, icon, badge, badgeTransform, name, status, resource });
        }
        viewport.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.resize(width, height);
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
        this.layout = buildBigMapBaseLayout(this.cells, width, height);
        const frame = this.art?.baseBackground;
        if (frame) {
            const scale = Math.max(width / frame.originalSize.width, height / frame.originalSize.height);
            this.background.node.setScale(scale, scale, 1);
        }
        for (const [index, hexId] of this.layout.paintOrder.entries()) {
            const slot = this.slots.get(hexId);
            if (slot) slot.pad.node.setSiblingIndex(index);
        }
        // 地面先铺完整盘，再画建筑，避免下方邻格地面覆盖上方建筑。
        for (const [index, hexId] of this.layout.paintOrder.entries()) {
            const slot = this.slots.get(hexId);
            if (slot) slot.root.setSiblingIndex(this.layout.paintOrder.length + index);
        }
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
        const presenter = this.presenter;
        if (!presenter) return;
        this.cells = presenter.plotCells();
        for (const cell of this.cells) {
            const slot = this.slots.get(cell.hexId);
            const point = this.layout.points.get(cell.hexId);
            if (!slot || !point) continue;
            slot.root.setPosition(point.x, point.y, 0);
            const width = this.layout.tileWidth;
            const height = this.layout.tileHeight;
            const isEmpty = cell.slot === 'empty';
            const isSelected = cell.hexId === this.selectedHexId;
            const groundIndex = bigMapGroundIndex(presenter.world.seed, cell.hexId, this.art?.groundVariants.length ?? 0);
            const groundFrame = this.art?.groundVariants[groundIndex] ?? this.art?.ground ?? null;
            slot.pad.spriteFrame = groundFrame;
            slot.pad.node.active = !!groundFrame;
            slot.pad.node.setPosition(point.x, point.y, 0);
            slot.pad.node.setScale(1, 1, 1);
            slot.padTransform.setContentSize(width, height);
            slot.pad.color = Color.WHITE;
            slot.selection.clear();
            if (isSelected || (isEmpty && this.pendingBuildingId !== 0)) {
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
                : this.art?.buildings.get(cell.buildingId) ?? (cell.buildingId === presenter.mainBuildingId ? this.art?.home ?? null : null);
            const iconWidth = width * (cell.buildingId === presenter.mainBuildingId ? 0.95 : 0.82);
            const iconHeight = frame ? frame.rect.height * iconWidth / frame.rect.width : 0;
            fitBigMapSprite(slot.icon, frame, iconWidth, 0, iconHeight / 2 - height * 0.12);
            const labelScale = Math.min(1, this.layout.scale);
            slot.name.node.setScale(labelScale, labelScale, 1);
            slot.status.node.setScale(labelScale, labelScale, 1);
            slot.name.string = isEmpty ? BIGMAP_PRESENTATION_TEXT.emptyPlot : cell.slot === 'constructing'
                ? presenter.buildingNameOfQueueAt(cell.hexId) : `${cell.name}  Lv.${cell.level}`;
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
    }

    private onTouchEnd(event: EventTouch): void {
        const point = event.getUILocation();
        const local = this.viewport.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
        const hexId = pickBigMapBasePlot(this.layout, local.x, local.y);
        if (hexId < 0) return;
        this.select(hexId);
        this.onTap?.(hexId);
    }
}
