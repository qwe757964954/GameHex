import { _decorator, Color, Component, EventTouch, Graphics, Label, Node, UITransform, Vec2, Vec3 } from 'cc';
import type { BigMapPresenter, IBigMapPlotCellView } from '../application/BigMapPresenter';
import { BIGMAP_COLORS, createLabel, createUiNode } from './BigMapTheme';

const { ccclass } = _decorator;

/** 建造区六边格外接圆半径。5×5 的场地在这个尺寸下正好铺满中间区域。 */
const PLOT_HEX_SIZE = 52;
const PLOT_COL_STEP = PLOT_HEX_SIZE * 1.5;
const PLOT_ROW_STEP = PLOT_HEX_SIZE * Math.sqrt(3);
const PLOT_PHASE = PLOT_ROW_STEP / 2;

/**
 * 基地建造区视图（线框图）：5×5 六边格场地 + 建筑名/等级。
 *
 * 规则全在 model（`BigMapBase`），这里只负责「长什么样」：空位 / 已建 / 建造中三种底色，
 * 点击把格 id 交回页面，由页面决定是「摆放」还是「升级 / 取消」。
 */
@ccclass('BigMapBaseView')
export class BigMapBaseView extends Component {
    private presenter: BigMapPresenter | null = null;
    private gridLayer: Graphics = null!;
    private labelLayer: Node = null!;
    private readonly cellLabels = new Map<number, { name: Label; level: Label }>();
    private cells: readonly IBigMapPlotCellView[] = [];
    private currentWidth = 800;
    private currentHeight = 500;
    private selectedHexId = -1;
    /** 摆放模式下要高亮的格（页面把「手上拿着的建筑」传进来）。 */
    private pendingBuildingId = 0;

    onTap: ((hexId: number) => void) | null = null;

    build(presenter: BigMapPresenter, width: number, height: number): void {
        this.presenter = presenter;
        this.currentWidth = width;
        this.currentHeight = height;
        this.node.removeAllChildren();
        this.cellLabels.clear();

        const root = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        root.setContentSize(width, height);

        const bg = createUiNode('PlotBg', this.node, width, height);
        bg.addComponent(Graphics).fillColor = BIGMAP_COLORS.pageBg;
        bg.getComponent(Graphics)!.rect(-width / 2, -height / 2, width, height);
        bg.getComponent(Graphics)!.fill();
        this.gridLayer = createUiNode('PlotGrid', bg, 0, 0).addComponent(Graphics);
        this.labelLayer = createUiNode('PlotLabels', bg, 0, 0);

        this.cells = presenter.plotCells();
        for (const cell of this.cells) {
            const name = createLabel(this.labelLayer, '', 16, BIGMAP_COLORS.text, 0, 0);
            name.horizontalAlign = Label.HorizontalAlign.CENTER;
            const level = createLabel(this.labelLayer, '', 13, BIGMAP_COLORS.gold, 0, 0);
            level.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.cellLabels.set(cell.hexId, { name, level });
        }

        this.refresh();
        bg.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    resize(width: number, height: number): void {
        this.currentWidth = width;
        this.currentHeight = height;
        this.node.getComponent(UITransform)?.setContentSize(width, height);
    }

    /** 摆放模式：高亮空格 + 显示「将要建造」的提示。传 0 退出摆放模式。 */
    setPendingBuilding(buildingId: number): void {
        this.pendingBuildingId = buildingId;
        this.refresh();
    }

    get pending(): number {
        return this.pendingBuildingId;
    }

    select(hexId: number): void {
        this.selectedHexId = hexId;
        this.refresh();
    }

    // -------------------------------------------------------------- 几何

    private centerOf(row: number, column: number): Vec2 {
        const rows = Math.max(1, Math.round(this.cells.length ** 0.5));
        const cols = rows;
        return new Vec2(
            (column - (cols - 1) / 2) * PLOT_COL_STEP,
            ((rows - 1) / 2 - row) * PLOT_ROW_STEP + (column % 2 === 0 ? -PLOT_PHASE : PLOT_PHASE),
        );
    }

    private hexPath(graphics: Graphics, center: Vec2, size: number): void {
        const h = size * Math.sqrt(3) / 2;
        graphics.moveTo(center.x + size, center.y);
        graphics.lineTo(center.x + size / 2, center.y + h);
        graphics.lineTo(center.x - size / 2, center.y + h);
        graphics.lineTo(center.x - size, center.y);
        graphics.lineTo(center.x - size / 2, center.y - h);
        graphics.lineTo(center.x + size / 2, center.y - h);
        graphics.close();
    }

    private cellTint(cell: IBigMapPlotCellView): Color {
        if (cell.hexId === this.selectedHexId) return BIGMAP_COLORS.panelLight;
        if (cell.slot === 'constructing') return new Color(196, 152, 72, 235);
        if (cell.slot === 'building') {
            // 主城用金色、其他建筑用绿色：一眼能认出基地中心。
            return cell.buildingId === this.presenter?.mainBuildingId
                ? new Color(120, 96, 40, 240)
                : new Color(52, 84, 60, 240);
        }
        return this.pendingBuildingId !== 0 ? new Color(44, 66, 50, 235) : new Color(34, 44, 38, 235);
    }

    // -------------------------------------------------------------- 绘制

    refresh(): void {
        const presenter = this.presenter;
        if (!presenter) return;
        this.cells = presenter.plotCells();
        const g = this.gridLayer;
        g.clear();

        for (const cell of this.cells) {
            const center = this.centerOf(cell.row, cell.column);
            g.fillColor = this.cellTint(cell);
            this.hexPath(g, center, PLOT_HEX_SIZE - 3);
            g.fill();
            g.strokeColor = cell.slot === 'empty' ? BIGMAP_COLORS.gridLine : BIGMAP_COLORS.border;
            g.lineWidth = cell.slot === 'empty' ? 1 : 2;
            this.hexPath(g, center, PLOT_HEX_SIZE - 3);
            g.stroke();

            const labels = this.cellLabels.get(cell.hexId);
            if (!labels) continue;
            if (cell.slot === 'empty') {
                labels.name.node.active = false;
                labels.level.node.active = false;
                continue;
            }
            labels.name.node.active = true;
            labels.level.node.active = true;
            if (cell.slot === 'constructing') {
                // 建造中的格子还没有建筑实例，名字取队列里的建筑名。
                labels.name.string = presenter.buildingNameOfQueueAt(cell.hexId) || '建造中';
                labels.level.string = '建造中';
            } else {
                labels.name.string = cell.name;
                labels.level.string = cell.stored > 0 ? `Lv.${cell.level} · ${cell.stored}` : `Lv.${cell.level}`;
            }
            labels.name.node.setPosition(new Vec3(center.x, center.y + 10, 0));
            labels.level.node.setPosition(new Vec3(center.x, center.y - 14, 0));
        }
    }

    private onTouchEnd(event: EventTouch): void {
        const transform = this.node.getComponent(UITransform)!;
        const local = transform.convertToNodeSpaceAR(new Vec3(event.getUILocation().x, event.getUILocation().y, 0));
        // 反算行列：列取最近的一列，行再按该列相位求（与大地图同一套算法）。
        const rows = Math.max(1, Math.round(this.cells.length ** 0.5));
        const baseColumn = Math.round(local.x / PLOT_COL_STEP + (rows - 1) / 2);
        let bestHex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let column = baseColumn - 1; column <= baseColumn + 1; column += 1) {
            if (column < 0 || column >= rows) continue;
            const offsetY = local.y - (column % 2 === 0 ? -PLOT_PHASE : PLOT_PHASE);
            const row = Math.round((rows - 1) / 2 - offsetY / PLOT_ROW_STEP);
            if (row < 0 || row >= rows) continue;
            const center = this.centerOf(row, column);
            const distance = (center.x - local.x) ** 2 + (center.y - local.y) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestHex = row * rows + column;
            }
        }
        if (bestHex < 0) return;
        this.selectedHexId = bestHex;
        this.refresh();
        this.onTap?.(bestHex);
    }

    get selected(): number {
        return this.selectedHexId;
    }
}
