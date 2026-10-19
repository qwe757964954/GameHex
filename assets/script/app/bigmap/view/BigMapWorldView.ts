import { _decorator, Color, Component, EventMouse, EventTouch, Graphics, Label, Node, UITransform, Vec2, Vec3 } from 'cc';
import type { BigMapPresenter } from '../application/BigMapPresenter';
import { bigMapOccupantOf } from '../model/BigMapWorld';
import type { BigMapCityState } from '../model/BigMapTypes';
import { BIGMAP_COLORS, createLabel, createUiNode } from './BigMapTheme';

const { ccclass } = _decorator;

/** 大地图单个六边形的外接圆半径（线框尺寸，纯表现参数，不影响任何规则）。 */
export const WORLD_HEX_SIZE = 15;
/** 平顶六边：列距 = 1.5r，行距 = √3r，奇偶列再做半行错位。 */
export const WORLD_COL_STEP = WORLD_HEX_SIZE * 1.5;
export const WORLD_ROW_STEP = WORLD_HEX_SIZE * Math.sqrt(3);
const WORLD_PHASE = WORLD_ROW_STEP / 2;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 1.6;

/**
 * 大世界地图视图（线框图）：一张 40×40 六边格大地图 + 城池 / 野怪 / 基地标记。
 *
 * 为什么全部用 `Graphics` 现画：本期美术未出（见 `BigMapTheme` 头注），
 * 而地图有 1600 个格子，用 Sprite 拼会先卡在「没有图」上。
 *
 * 绘制分三层（各自一个 `Graphics`，避免每次刷新都重画静态内容）：
 * 1. `terrainLayer` —— 地形底色 + 网格线，**只在 build 时画一次**；
 * 2. `markerLayer` —— 城池 / 野怪 / 基地 / 选中高亮，状态变化时重画；
 * 3. `labelLayer` —— 城池名与「我的基地」，随标记一起更新位置。
 *
 * 交互：单指拖动平移、滚轮/按钮缩放、点击拾取格子。拾取用「候选列 + 最近中心」反算，
 * 不遍历 1600 格。
 */
@ccclass('BigMapWorldView')
export class BigMapWorldView extends Component {
    private presenter: BigMapPresenter | null = null;
    private viewport: Node = null!;
    private content: Node = null!;
    private terrainLayer: Graphics = null!;
    private markerLayer: Graphics = null!;
    private labelLayer: Node = null!;
    private readonly cityLabels = new Map<number, Label>();
    private playerLabel: Label = null!;

    private zoom = 1;
    private selectedHexId = -1;
    private dragStart: Vec2 | null = null;
    private dragMoved = 0;

    /** 点击某格（页面据此弹详情面板）。 */
    onTap: ((hexId: number) => void) | null = null;

    /** 构建（可重复调用，内部先清空旧节点）。 */
    build(presenter: BigMapPresenter, width: number, height: number): void {
        this.presenter = presenter;
        this.node.removeAllChildren();
        this.cityLabels.clear();

        const root = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
        root.setContentSize(width, height);
        // 视口底色必须自己画：既挡住背后的页面底色，也让整块区域能吃触摸事件。
        const bg = createUiNode('Viewport', this.node, width, height);
        bg.addComponent(Graphics).fillColor = BIGMAP_COLORS.pageBg;
        bg.getComponent(Graphics)!.rect(-width / 2, -height / 2, width, height);
        bg.getComponent(Graphics)!.fill();

        this.viewport = bg;
        this.content = createUiNode('Content', bg, 0, 0);
        this.terrainLayer = createUiNode('Terrain', this.content, 0, 0).addComponent(Graphics);
        this.markerLayer = createUiNode('Marker', this.content, 0, 0).addComponent(Graphics);
        this.labelLayer = createUiNode('Labels', this.content, 0, 0);

        this.buildLabels();
        this.paintTerrain();
        this.refresh();
        this.resetCamera(width, height);
        this.bindTouch();
    }

    /** 视口尺寸变化时调用（页面切布局 / 屏幕旋转）。 */
    resize(width: number, height: number): void {
        const root = this.node.getComponent(UITransform);
        root?.setContentSize(width, height);
        if (!this.viewport) return;
        this.viewport.getComponent(UITransform)?.setContentSize(width, height);
        const graphics = this.viewport.getComponent(Graphics);
        if (graphics) {
            graphics.clear();
            graphics.fillColor = BIGMAP_COLORS.pageBg;
            graphics.rect(-width / 2, -height / 2, width, height);
            graphics.fill();
        }
    }

    // -------------------------------------------------------------- 几何

    /** 逻辑列号 → 该列的垂直相位（奇偶列半行错位）。 */
    private columnPhase(column: number): number {
        return column % 2 === 0 ? -WORLD_PHASE : WORLD_PHASE;
    }

    private hexCenter(row: number, column: number): Vec2 {
        const world = this.presenter!.world;
        return new Vec2(
            (column - (world.cols - 1) / 2) * WORLD_COL_STEP,
            ((world.rows - 1) / 2 - row) * WORLD_ROW_STEP + this.columnPhase(column),
        );
    }

    private centerOf(hexId: number): Vec2 {
        const world = this.presenter!.world;
        return this.hexCenter(Math.floor(hexId / world.cols), hexId % world.cols);
    }

    /** 局部坐标 → 格子 id；越界返回 -1。 */
    pickHexAt(local: Vec2): number {
        const world = this.presenter?.world;
        if (!world) return -1;
        const baseColumn = Math.round(local.x / WORLD_COL_STEP);
        let bestId = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let column = baseColumn - 1; column <= baseColumn + 1; column += 1) {
            if (column < 0 || column >= world.cols) continue;
            const offsetY = local.y - this.columnPhase(column);
            const row = Math.round((world.rows - 1) / 2 - offsetY / WORLD_ROW_STEP);
            if (row < 0 || row >= world.rows) continue;
            const center = this.hexCenter(row, column);
            const distance = (center.x - local.x) ** 2 + (center.y - local.y) ** 2;
            if (distance < bestDistance) {
                bestDistance = distance;
                bestId = row * world.cols + column;
            }
        }
        return bestId;
    }

    // -------------------------------------------------------------- 绘制

    private hexPath(graphics: Graphics, center: Vec2): void {
        const r = WORLD_HEX_SIZE;
        const h = WORLD_HEX_SIZE * Math.sqrt(3) / 2;
        graphics.moveTo(center.x + r, center.y);
        graphics.lineTo(center.x + r / 2, center.y + h);
        graphics.lineTo(center.x - r / 2, center.y + h);
        graphics.lineTo(center.x - r, center.y);
        graphics.lineTo(center.x - r / 2, center.y - h);
        graphics.lineTo(center.x + r / 2, center.y - h);
        graphics.close();
    }

    /** 地形 + 网格：只在 build 时画一次（1600 格，别放进每帧/每次刷新的路径）。 */
    private paintTerrain(): void {
        const presentWorld = this.presenter!.world;
        const g = this.terrainLayer;
        g.clear();
        // 1) 非平原地形单独填色（平原由视口底色承担，少 60% 的填充路径）。
        const terrainColors: [string, Color][] = [
            ['forest', BIGMAP_COLORS.forest],
            ['rock', BIGMAP_COLORS.rock],
            ['water', BIGMAP_COLORS.water],
        ];
        for (const [terrain, color] of terrainColors) {
            g.fillColor = color;
            let painted = false;
            for (const tile of presentWorld.tiles) {
                if (tile.terrain !== terrain) continue;
                this.hexPath(g, this.centerOf(tile.id));
                painted = true;
            }
            if (painted) g.fill();
        }
        // 2) 网格线：所有格子走一条路径一次描边（比逐格 stroke 快一个数量级）。
        g.strokeColor = BIGMAP_COLORS.gridLine;
        g.lineWidth = 1;
        for (const tile of presentWorld.tiles) this.hexPath(g, this.centerOf(tile.id));
        g.stroke();
    }

    /** 标记层：城池 / 野怪 / 基地 / 选中。 */
    refresh(): void {
        const presenter = this.presenter;
        if (!presenter) return;
        const world = presenter.world;
        const g = this.markerLayer;
        g.clear();

        // 野怪：按等级给半径与颜色
        for (const site of world.monsters) {
            const center = this.centerOf(site.anchorHexId);
            const view = presenter.monsterView(site.instanceId);
            const radius = 3 + site.level;
            g.fillColor = view && view.respawnInSeconds > 0
                ? new Color(90, 90, 90, 200)
                : new Color(196, 118, 96, 235);
            g.circle(center.x, center.y, radius);
            g.fill();
            if (view && !view.unlocked) {
                g.strokeColor = BIGMAP_COLORS.danger;
                g.lineWidth = 1.5;
                g.circle(center.x, center.y, radius + 2);
                g.stroke();
            }
        }

        // NPC 基地：小方块
        for (const base of world.bases) {
            if (base.isPlayer) continue;
            const center = this.centerOf(base.hexId);
            g.fillColor = BIGMAP_COLORS.npc;
            g.rect(center.x - 4, center.y - 4, 8, 8);
            g.fill();
        }

        // 城池：菱形块，颜色 = 解锁状态
        for (const city of presenter.allCityViews()) {
            const center = this.centerOf(city.hexId);
            const tint = this.cityTint(city.state);
            const size = 7 + city.level * 2;
            g.fillColor = tint;
            g.moveTo(center.x, center.y + size);
            g.lineTo(center.x + size, center.y);
            g.lineTo(center.x, center.y - size);
            g.lineTo(center.x - size, center.y);
            g.close();
            g.fill();
            g.strokeColor = new Color(12, 16, 14, 220);
            g.lineWidth = 1.5;
            g.stroke();
            // 已占领的城加一圈金边，跟「可打」区分开。
            if (city.state === 'occupied') {
                g.strokeColor = BIGMAP_COLORS.gold;
                g.lineWidth = 2;
                g.moveTo(center.x, center.y + size + 3);
                g.lineTo(center.x + size + 3, center.y);
                g.lineTo(center.x, center.y - size - 3);
                g.lineTo(center.x - size - 3, center.y);
                g.close();
                g.stroke();
            }
        }

        // 玩家基地：六边形 + 白边（最显眼的那一个）
        const playerBase = world.playerBase;
        const playerCenter = this.centerOf(playerBase.hexId);
        g.fillColor = BIGMAP_COLORS.player;
        this.hexPath(g, playerCenter);
        g.fill();
        g.strokeColor = BIGMAP_COLORS.text;
        g.lineWidth = 2;
        this.hexPath(g, playerCenter);
        g.stroke();

        // 选中格高亮
        if (this.selectedHexId >= 0) {
            const center = this.centerOf(this.selectedHexId);
            g.strokeColor = BIGMAP_COLORS.gold;
            g.lineWidth = 3;
            this.hexPath(g, center);
            g.stroke();
        }

        this.updateLabels();
    }

    private cityTint(state: BigMapCityState): Color {
        switch (state) {
            case 'open': return BIGMAP_COLORS.open;
            case 'occupied': return BIGMAP_COLORS.occupied;
            case 'unavailable': return BIGMAP_COLORS.unavailable;
            default: return BIGMAP_COLORS.locked;
        }
    }

    private buildLabels(): void {
        const presenter = this.presenter!;
        for (const city of presenter.allCityViews()) {
            const label = createLabel(this.labelLayer, city.name, 11, BIGMAP_COLORS.text, 0, 0);
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            this.cityLabels.set(city.cityId, label);
        }
        this.playerLabel = createLabel(this.labelLayer, '我的基地', 12, BIGMAP_COLORS.player, 0, 0);
        this.playerLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
    }

    private updateLabels(): void {
        const presenter = this.presenter!;
        for (const city of presenter.allCityViews()) {
            const label = this.cityLabels.get(city.cityId);
            if (!label) continue;
            const center = this.centerOf(city.hexId);
            label.node.setPosition(new Vec3(center.x, center.y - (10 + city.level * 2), 0));
            // 未开放的层只留灰点，不显示名字，避免内圈 12 个「军团壁垒」糊成一团。
            label.node.active = city.state !== 'unavailable';
            label.color = city.state === 'locked' ? BIGMAP_COLORS.muted : BIGMAP_COLORS.text;
        }
        const center = this.centerOf(presenter.world.playerBase.hexId);
        this.playerLabel.node.setPosition(new Vec3(center.x, center.y - 13, 0));
    }

    // -------------------------------------------------------------- 相机

    resetCamera(width?: number, height?: number): void {
        const world = this.presenter!.world;
        const viewWidth = width ?? this.node.getComponent(UITransform)?.width ?? 800;
        const viewHeight = height ?? this.node.getComponent(UITransform)?.height ?? 600;
        const mapWidth = world.cols * WORLD_COL_STEP + WORLD_HEX_SIZE;
        const mapHeight = world.rows * WORLD_ROW_STEP + WORLD_HEX_SIZE;
        const fit = Math.min(viewWidth / mapWidth, viewHeight / mapHeight) * 0.96;
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fit));
        this.content.setScale(new Vec3(this.zoom, this.zoom, 1));
        // 相机对准玩家基地：进页面第一眼就看到自己的家。
        const base = this.centerOf(world.playerBase.hexId);
        this.content.setPosition(new Vec3(-base.x * this.zoom, -base.y * this.zoom, 0));
    }

    zoomBy(factor: number): void {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
        if (next === this.zoom) return;
        // 以视口中心为锚点缩放：只动 content 的位移与缩放，标记不用重画。
        const ratio = next / this.zoom;
        this.zoom = next;
        const position = this.content.position;
        this.content.setScale(new Vec3(this.zoom, this.zoom, 1));
        this.content.setPosition(new Vec3(position.x * ratio, position.y * ratio, 0));
    }

    focusOn(hexId: number): void {
        const center = this.centerOf(hexId);
        this.content.setPosition(new Vec3(-center.x * this.zoom, -center.y * this.zoom, 0));
    }

    get currentZoom(): number {
        return this.zoom;
    }

    // -------------------------------------------------------------- 交互

    private bindTouch(): void {
        const viewport = this.viewport;
        viewport.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        viewport.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        viewport.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        viewport.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        viewport.on(Node.EventType.MOUSE_WHEEL, this.onWheel, this);
    }

    private onTouchStart(event: EventTouch): void {
        this.dragStart = event.getUILocation();
        this.dragMoved = 0;
    }

    private onTouchMove(event: EventTouch): void {
        if (!this.dragStart) return;
        const current = event.getUILocation();
        const deltaX = current.x - this.dragStart.x;
        const deltaY = current.y - this.dragStart.y;
        this.dragMoved += Math.abs(deltaX) + Math.abs(deltaY);
        const position = this.content.position;
        this.content.setPosition(new Vec3(position.x + deltaX, position.y + deltaY, 0));
        this.dragStart = current;
    }

    private onTouchEnd(event: EventTouch): void {
        const moved = this.dragMoved;
        this.dragStart = null;
        this.dragMoved = 0;
        // 拖动超过阈值算平移，不触发选中（否则地图拖一下就乱弹面板）。
        if (moved > 12) return;
        const hexId = this.pickHexAt(this.toContentSpace(event.getUILocation()));
        if (hexId < 0) return;
        this.selectedHexId = hexId;
        this.refresh();
        this.onTap?.(hexId);
    }

    private onWheel(event: EventMouse): void {
        const delta = event.getScrollY();
        if (delta === 0) return;
        this.zoomBy(delta > 0 ? 1.12 : 1 / 1.12);
    }

    /** UI 坐标 → content 本地坐标（考虑 content 自己的位移与缩放）。 */
    private toContentSpace(uiPoint: Vec2): Vec2 {
        const transform = this.viewport.getComponent(UITransform)!;
        const local = transform.convertToNodeSpaceAR(new Vec3(uiPoint.x, uiPoint.y, 0));
        const position = this.content.position;
        return new Vec2((local.x - position.x) / this.zoom, (local.y - position.y) / this.zoom);
    }

    get selected(): number {
        return this.selectedHexId;
    }

    /** 当前选中格上的东西（页面据此决定弹城池面板 / 野怪面板 / 空）。 */
    occupantAt(hexId: number) {
        return this.presenter ? bigMapOccupantOf(this.presenter.world, hexId) : { kind: 'empty' as const };
    }
}
