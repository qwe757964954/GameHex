import {
    _decorator, Button, Color, Component, EventMouse, EventTouch, Graphics, instantiate,
    Node, Prefab, Sprite, SpriteFrame, UITransform, Vec2, Vec3,
} from 'cc';
import type { IHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import type { BigMapPresenter } from '../application/BigMapPresenter';
import { BIGMAP_CAMP_REFRESH_SECONDS } from '../application/BigMapCampRepository';
import { bigMapHexDistance, bigMapOccupantOf } from '../model/BigMapWorld';
import { assignTerritoryColorSlots } from '../model/BigMapTerritoryColor';
import type { BigMapCityState, BigMapTerrain } from '../model/BigMapTypes';
import {
    BIGMAP_TILE_WIDTH, BIGMAP_TILE_HEIGHT, BIGMAP_COLUMN_STEP, BIGMAP_ROW_STEP,
    bigMapGroundIndex, buildBigMapTerritoryEdges, buildBigMapWorldLayout, pickBigMapHex, pickBigMapMarker, visibleBigMapHexes,
    type IBigMapTerritoryEdge,
} from './BigMapWorldLayout';
import {
    BIGMAP_COLORS, BIGMAP_TERRITORY_COLORS, BIGMAP_TERRITORY_FILL_ALPHA, BIGMAP_TERRITORY_STROKE_ALPHA,
    BIGMAP_TERRITORY_NEIGHBOR_GAP,
} from './BigMapTheme';
import { BigMapWorldMarker } from './BigMapWorldMarker';
import { BigMapWorldTemplates } from './BigMapWorldTemplates';

const { ccclass, property } = _decorator;
export const WORLD_HEX_SIZE = BIGMAP_TILE_WIDTH / 2;
export const WORLD_COL_STEP = BIGMAP_COLUMN_STEP;
export const WORLD_ROW_STEP = BIGMAP_ROW_STEP;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.6;
/**
 * 地形色（**乘算**叠在 `grounds/ground_0x.png` 上，所以只能压暗、不能提亮）。
 *
 * 口径（2026-10-21 用户口径：「地块默认颜色如图 2」）：默认**一律是沙地本色**，
 * 地形只保留极轻的冷暖差异。之前森林是 `(210,225,195)`、水面是 `(166,210,221)`，
 * 乘在沙色上分别变成土黄和苔绿，整片地图花成迷彩 —— 玩家根本看不出哪块地属于哪个势力。
 * 现在颜色让给势力染色（`BIGMAP_TERRITORY_COLORS`），地形退成"近看才分得出"的细节。
 */
const TERRAIN_TINT: Readonly<Record<BigMapTerrain, Color>> = {
    plain: Color.WHITE,
    forest: new Color(248, 244, 226),
    rock: new Color(240, 238, 234),
    water: new Color(228, 240, 244),
};
/**
 * 没有地块美术时的兜底填色（`paintTerrain`）。
 *
 * 注意这一套是**直接填充**、不是乘算，所以要给实色 —— 直接拿 `TERRAIN_TINT` 去填
 * 会得到一片惨白（那是乘数不是颜色）。
 */
const TERRAIN_FILL: Readonly<Record<BigMapTerrain, Color>> = {
    plain: new Color(206, 175, 138),
    forest: new Color(190, 198, 152),
    rock: new Color(190, 186, 178),
    water: new Color(152, 190, 202),
};
interface IWorldMarker {
    readonly hexId: number;
    readonly kind: 'city' | 'monster' | 'base';
    readonly id: number | string;
    readonly node: Node;
    readonly icon: Sprite;
    readonly view: BigMapWorldMarker;
}

/** JSON 世界的表现：地块按视口复用，规则和落位只读 Presenter。 */
@ccclass('BigMapWorldView')
export class BigMapWorldView extends Component {
    private presenter: BigMapPresenter | null = null;
    @property({ type: UITransform, group: '布局' }) private rootTransform: UITransform = null!;
    @property({ type: Node, group: '布局' }) private viewport: Node = null!;
    @property({ type: UITransform, group: '布局' }) private viewportTransform: UITransform = null!;
    @property({ type: Node, group: '地图图层' }) private content: Node = null!;
    @property({ type: Sprite, group: '背景' }) private background: Sprite = null!;
    @property({ type: Sprite, group: '背景' }) private sand: Sprite = null!;
    @property({ type: UITransform, group: '背景' }) private sandTransform: UITransform = null!;
    @property({ type: Graphics, group: '地图图层' }) private terrainLayer: Graphics = null!;
    @property({ type: Node, group: '地图图层' }) private tileLayer: Node = null!;
    @property({ type: Node, group: '地图图层' }) private decorLayer: Node = null!;
    @property({ type: Graphics, group: '地图图层' }) private markerLayer: Graphics = null!;
    @property({ type: Node, group: '地图图层' }) private iconLayer: Node = null!;
    @property({ type: Prefab, group: '模板资源' }) private templatesPrefab: Prefab = null!;
    private templateRoot: Node | null = null;
    private groundTemplate: Node = null!;
    private decorTemplate: Node = null!;
    private markerTemplate: Node = null!;
    @property({ type: Button, group: '操作按钮' }) private zoomInButton: Button = null!;
    @property({ type: Button, group: '操作按钮' }) private zoomOutButton: Button = null!;
    @property({ type: Button, group: '操作按钮' }) private focusButton: Button = null!;
    private layout: IHexGridLayout = buildBigMapWorldLayout(0, 0);
    private art: IBigMapArt | null = null;
    private readonly tilePool: Sprite[] = [];
    private readonly decorPool: Sprite[] = [];
    private readonly markers: IWorldMarker[] = [];
    private contentKey = '';
    private zoom = 1;
    private selectedHexId = -1;
    /** 城池 id → 势力色板下标（相邻势力不同色，见 `assignTerritoryColorSlots`）。 */
    private territorySlots: ReadonlyMap<number, number> = new Map();
    private readonly territoryEdges = new Map<number, readonly IBigMapTerritoryEdge[]>();
    private readonly baseTerritoryEdges = new Map<number, readonly IBigMapTerritoryEdge[]>();
    private dragStart: Vec2 | null = null;
    private dragMoved = 0;
    private pinchDistance = 0;
    private gesturePinched = false;
    private campRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    onTap: ((hexId: number) => void) | null = null;

    build(presenter: BigMapPresenter, width: number, height: number): void {
        this.ensureTemplates();
        this.unbindInput();
        for (const marker of this.markers) marker.node.destroy();
        for (const sprite of this.tilePool) sprite.node.destroy();
        for (const sprite of this.decorPool) sprite.node.destroy();
        this.presenter = presenter;
        this.markers.length = 0;
        this.tilePool.length = 0;
        this.decorPool.length = 0;
        this.contentKey = '';
        this.selectedHexId = -1;
        this.layout = buildBigMapWorldLayout(presenter.world.rows, presenter.world.cols);
        this.rootTransform.setContentSize(width, height);
        this.viewportTransform.setContentSize(width, height);
        this.sandTransform.setContentSize(width, height);
        this.buildMarkers();
        this.rebuildTerritorySlots();
        this.paintTerrain();
        this.refresh();
        this.resetCamera();
        this.viewport.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.viewport.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.viewport.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.viewport.on(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.viewport.on(Node.EventType.MOUSE_WHEEL, this.onWheel, this);
        this.zoomInButton.node.on(Button.EventType.CLICK, this.onZoomIn, this);
        this.zoomOutButton.node.on(Button.EventType.CLICK, this.onZoomOut, this);
        this.focusButton.node.on(Button.EventType.CLICK, this.onFocus, this);
    }

    private ensureTemplates(): void {
        if (this.templateRoot) return;
        // 模板实例不挂入页面层级；只将它的原型克隆到实际显示图层。
        const root = instantiate(this.templatesPrefab);
        root.active = false;
        const templates = root.getComponent(BigMapWorldTemplates) as BigMapWorldTemplates;
        this.groundTemplate = templates.groundTemplate;
        this.decorTemplate = templates.decorTemplate;
        this.markerTemplate = templates.markerTemplate;
        this.templateRoot = root;
    }

    private unbindInput(): void {
        if (this.viewport) {
            this.viewport.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
            this.viewport.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
            this.viewport.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
            this.viewport.off(Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
            this.viewport.off(Node.EventType.MOUSE_WHEEL, this.onWheel, this);
        }
        if (this.zoomInButton) this.zoomInButton.node.off(Button.EventType.CLICK, this.onZoomIn, this);
        if (this.zoomOutButton) this.zoomOutButton.node.off(Button.EventType.CLICK, this.onZoomOut, this);
        if (this.focusButton) this.focusButton.node.off(Button.EventType.CLICK, this.onFocus, this);
    }

    private onZoomIn(): void { this.zoomBy(1.2); }
    private onZoomOut(): void { this.zoomBy(1 / 1.2); }
    private onFocus(): void {
        if (this.presenter) this.focusOn(this.presenter.world.playerBase.hexId);
    }

    setArt(art: IBigMapArt): void {
        this.art = art;
        this.background.spriteFrame = art.background;
        this.background.node.active = !!art.background;
        if (art.background) {
            const rect = art.background.originalSize;
            const scale = Math.max(this.viewportTransform.width / rect.width, this.viewportTransform.height / rect.height);
            this.background.node.setScale(scale, scale, 1);
        }
        this.paintTerrain();
        this.contentKey = '';
        this.refresh();
        this.syncVisibleTiles();
    }

    private centerOf(hexId: number): Vec2 {
        const point = this.layout.points.get(hexId);
        return point ? new Vec2(point.x, point.y) : new Vec2();
    }

    pickHexAt(local: Vec2): number {
        const world = this.presenter?.world;
        return world ? pickBigMapHex(this.layout, world.rows, world.cols, local.x, local.y) : -1;
    }

    private hexPath(g: Graphics, hexId: number): void {
        const center = this.centerOf(hexId);
        const w = BIGMAP_TILE_WIDTH / 2;
        const h = BIGMAP_TILE_HEIGHT / 2;
        g.moveTo(center.x + w, center.y);
        g.lineTo(center.x + w / 2, center.y + h);
        g.lineTo(center.x - w / 2, center.y + h);
        g.lineTo(center.x - w, center.y);
        g.lineTo(center.x - w / 2, center.y - h);
        g.lineTo(center.x + w / 2, center.y - h);
        g.close();
    }

    private paintTerrain(): void {
        const world = this.presenter?.world;
        const g = this.terrainLayer;
        g.clear();
        if (!world || this.art?.ground) return;
        for (const tile of world.tiles) {
            g.fillColor = TERRAIN_FILL[tile.terrain];
            this.hexPath(g, tile.id);
            g.fill();
        }
        g.lineWidth = 2;
        g.strokeColor = new Color(101, 79, 58);
        for (const tile of world.tiles) this.hexPath(g, tile.id);
        g.stroke();
    }

    /**
     * 算一次势力配色（世界是只读快照，城池占格不会变，所以只在 `build` 时跑）。
     *
     * 「相邻」的判定距离见 `BIGMAP_TERRITORY_NEIGHBOR_GAP`（10 格）—— 城池最近也相距 4 格，
     * 按「贴身」判会让 25 座城全用同一个颜色。
     */
    private rebuildTerritorySlots(): void {
        const presenter = this.presenter;
        if (!presenter) return;
        const world = presenter.world;
        const regions = presenter.territoryRegions();
        this.territoryEdges.clear();
        for (const region of regions) this.territoryEdges.set(region.id, buildBigMapTerritoryEdges(this.layout, region.hexIds));
        this.baseTerritoryEdges.clear();
        for (const base of world.bases) this.baseTerritoryEdges.set(base.hexId,
            buildBigMapTerritoryEdges(this.layout, [base.hexId]));
        this.territorySlots = assignTerritoryColorSlots(
            regions,
            (a, b) => bigMapHexDistance(world.rows, world.cols, a, b),
            BIGMAP_TERRITORY_COLORS.length,
            BIGMAP_TERRITORY_NEIGHBOR_GAP,
        );
    }

    /** 城池 → 势力色。没配到（理论上不会）就退回苔绿，绝不返回 null 让上面的调用点判空。 */
    private territoryColor(cityId: number): Color {
        const slot = this.territorySlots.get(cityId) ?? 0;
        return BIGMAP_TERRITORY_COLORS[slot % BIGMAP_TERRITORY_COLORS.length];
    }

    /** 相机变化时复用可见槽位，避免为百行地图创建一万个 Sprite。 */
    private syncVisibleTiles(): void {
        const world = this.presenter?.world;
        if (!world || !this.art?.ground) return;
        const position = this.content.position;
        const halfWidth = this.viewportTransform.width / 2;
        const halfHeight = this.viewportTransform.height / 2;
        const ids = visibleBigMapHexes(this.layout, world.rows, world.cols, {
            left: (-halfWidth - position.x) / this.zoom, right: (halfWidth - position.x) / this.zoom,
            bottom: (-halfHeight - position.y) / this.zoom, top: (halfHeight - position.y) / this.zoom,
        });
        for (let i = 0; i < ids.length; i += 1) {
            const point = this.layout.points.get(ids[i]);
            const tile = world.tileById.get(ids[i]);
            if (!point || !tile) continue;
            const sprite = this.tilePool[i] ?? this.createTileSlot();
            sprite.node.active = true;
            const variant = bigMapGroundIndex(world.seed, ids[i], this.art.groundVariants.length);
            sprite.spriteFrame = this.art.groundVariants[variant] ?? this.art.ground;
            sprite.color = TERRAIN_TINT[tile.terrain];
            sprite.node.setPosition(point.x, point.y, 0);
            sprite.node.getComponent(UITransform)!.setContentSize(BIGMAP_TILE_WIDTH, BIGMAP_TILE_HEIGHT);
            const decor = this.decorPool[i];
            const frame = tile.terrain === 'rock' ? this.art.rock : tile.terrain === 'forest' ? this.art.grass : null;
            decor.node.active = !!frame;
            decor.spriteFrame = frame;
            decor.color = Color.WHITE;
            decor.node.setPosition(point.x + 24, point.y - 16, 0);
            if (frame) decor.node.setScale(32 / frame.rect.width, 32 / frame.rect.width, 1);
        }
        for (let i = ids.length; i < this.tilePool.length; i += 1) {
            this.tilePool[i].node.active = false;
            this.decorPool[i].node.active = false;
        }
    }

    private createTileSlot(): Sprite {
        const node = instantiate(this.groundTemplate);
        node.setParent(this.tileLayer);
        const sprite = node.getComponent(Sprite);
        if (!sprite) throw new Error('[BigMapWorldView] 地块模板缺少 Sprite');
        const decorNode = instantiate(this.decorTemplate);
        decorNode.setParent(this.decorLayer);
        const decor = decorNode.getComponent(Sprite);
        if (!decor) throw new Error('[BigMapWorldView] 装饰模板缺少 Sprite');
        this.tilePool.push(sprite);
        this.decorPool.push(decor);
        return sprite;
    }

    private buildMarkers(): void {
        const presenter = this.presenter;
        if (!presenter) return;
        for (const city of presenter.allCityViews()) this.addMarker('city', city.cityId, city.hexId);
        for (const monster of presenter.world.monsters) this.addMarker('monster', monster.instanceId, monster.anchorHexId);
        for (const base of presenter.world.bases) this.addMarker('base', base.baseId, base.hexId);
        if (!presenter.world.baseByHex.has(presenter.world.playerBase.hexId)) {
            const base = presenter.world.playerBase;
            this.addMarker('base', base.baseId, base.hexId);
        }
        this.markers.sort((a, b) => this.centerOf(b.hexId).y - this.centerOf(a.hexId).y);
        this.markers.forEach((marker, index) => marker.node.setSiblingIndex(index));
    }

    private addMarker(kind: IWorldMarker['kind'], id: number | string, hexId: number): void {
        const center = this.centerOf(hexId);
        const node = instantiate(this.markerTemplate);
        node.name = `${kind}_${id}`;
        node.setParent(this.iconLayer);
        node.setPosition(center.x, center.y, 0);
        const marker = node.getComponent(BigMapWorldMarker);
        if (!marker) throw new Error('[BigMapWorldView] 标记模板缺少 BigMapWorldMarker');
        this.markers.push({ kind, id, hexId, node, icon: marker.icon, view: marker });
    }

    private applyMarker(marker: IWorldMarker, frame: SpriteFrame | null, title: string, tint: Color, width: number): void {
        marker.view.render(frame, title, tint, width);
    }

    private paintTerritory(hexIds: readonly number[], tint: Color, edges: readonly IBigMapTerritoryEdge[]): void {
        const g = this.markerLayer;
        const fill = new Color(tint.r, tint.g, tint.b, BIGMAP_TERRITORY_FILL_ALPHA);
        for (const hexId of hexIds) {
            g.fillColor = fill;
            this.hexPath(g, hexId);
            g.fill();
        }
        this.strokeTerritory(edges, new Color(tint.r, tint.g, tint.b, 45), 16);
        this.strokeTerritory(edges, new Color(tint.r, tint.g, tint.b, BIGMAP_TERRITORY_STROKE_ALPHA), 6);
        this.strokeTerritory(edges, new Color((tint.r + 255) / 2, (tint.g + 255) / 2, (tint.b + 255) / 2, 245), 2);
    }

    private strokeTerritory(edges: readonly IBigMapTerritoryEdge[], color: Color, width: number): void {
        const graphics = this.markerLayer;
        graphics.strokeColor = color;
        graphics.lineWidth = width;
        for (const edge of edges) {
            graphics.moveTo(edge.start.x, edge.start.y);
            graphics.lineTo(edge.end.x, edge.end.y);
        }
        graphics.stroke();
    }

    refresh(): void {
        const presenter = this.presenter;
        if (!presenter) return;
        const cities = presenter.allCityViews();
        const monsters = presenter.world.monsters.map((site) => presenter.monsterView(site.instanceId));
        const key = `${this.selectedHexId}|${cities.map((c) => `${c.cityId}:${c.state}:${c.campInfo?.opType}:${c.campInfo?.state}`).join(',')}|`
            + monsters.map((m) => m ? `${m.instanceId}:${m.unlocked}:${m.respawnInSeconds > 0}` : '').join(',');
        if (key === this.contentKey) return;
        this.contentKey = key;
        this.markerLayer.clear();
        for (const region of presenter.territoryRegions()) {
            this.paintTerritory(region.hexIds, this.territoryColor(region.id), this.territoryEdges.get(region.id) ?? []);
        }
        for (const marker of this.markers) {
            if (marker.kind === 'city') {
                const city = cities.find((entry) => entry.cityId === marker.id);
                if (!city) continue;
                // 地块叠势力色（相邻不同色），角标仍用状态色 —— 两套信息各走各的通道。
                const tint = city.isServerCamp
                    ? (city.campInfo ? (city.campInfo.opType === 1 ? BIGMAP_COLORS.campOccupied : BIGMAP_COLORS.campUnoccupied)
                        : BIGMAP_COLORS.locked)
                    : this.cityTint(city.state);
                this.applyMarker(marker, this.art?.city ?? null, `${city.name} ${city.level}`, tint, 86 + city.level * 3);
                marker.icon.color = city.state === 'unavailable' ? new Color(130, 130, 130) : Color.WHITE;
            } else if (marker.kind === 'monster') {
                const monster = monsters.find((entry) => entry?.instanceId === marker.id);
                if (!monster) continue;
                this.applyMarker(marker, this.art?.monster ?? null,
                    monster.respawnInSeconds > 0 ? '等待刷新' : `${monster.name} ${monster.level}`,
                    monster.unlocked ? BIGMAP_COLORS.danger : BIGMAP_COLORS.locked, 72);
                marker.icon.color = monster.respawnInSeconds > 0 ? new Color(100, 100, 100) : Color.WHITE;
            } else {
                const base = presenter.world.bases.find((entry) => entry.baseId === marker.id) ?? presenter.world.playerBase;
                const tint = base.isPlayer ? BIGMAP_COLORS.open : BIGMAP_COLORS.danger;
                this.paintTerritory([base.hexId], tint,
                    this.baseTerritoryEdges.get(base.hexId) ?? []);
                this.applyMarker(marker, this.art?.home ?? null, base.isPlayer ? '我的基地' : base.name, tint, base.isPlayer ? 110 : 88);
            }
        }
        if (this.selectedHexId >= 0) {
            this.markerLayer.strokeColor = BIGMAP_COLORS.gold;
            this.markerLayer.lineWidth = 5;
            this.hexPath(this.markerLayer, this.selectedHexId);
            this.markerLayer.stroke();
        }
        this.cullMarkers();
    }

    private cityTint(state: BigMapCityState): Color {
        if (state === 'occupied') return BIGMAP_COLORS.open;
        if (state === 'unavailable' || state === 'locked') return BIGMAP_COLORS.locked;
        return BIGMAP_COLORS.danger;
    }

    private cullMarkers(): void {
        const position = this.content.position;
        const halfWidth = this.viewportTransform.width / 2 + 130 * this.zoom;
        const halfHeight = this.viewportTransform.height / 2 + 150 * this.zoom;
        for (const marker of this.markers) {
            marker.node.active = Math.abs(marker.node.position.x * this.zoom + position.x) < halfWidth
                && Math.abs(marker.node.position.y * this.zoom + position.y) < halfHeight;
        }
    }

    /** 平移和缩放共用入口，同步可见地块；没有逐帧重建。 */
    private applyCamera(scale: number, x: number, y: number): void {
        this.zoom = scale;
        this.content.setScale(scale, scale, 1);
        this.content.setPosition(x, y, 0);
        this.syncVisibleTiles();
        this.cullMarkers();
        this.queueCampRefresh();
    }

    private queueCampRefresh(): void {
        if (this.campRefreshTimer !== null) clearTimeout(this.campRefreshTimer);
        this.campRefreshTimer = setTimeout(() => {
            this.campRefreshTimer = null;
            this.refreshVisibleCamps();
        }, 150);
    }

    private refreshVisibleCamps(): void {
        if (!this.isValid || !this.node.activeInHierarchy || !this.presenter) return;
        const ids = this.markers.filter((marker) => marker.kind === 'city' && marker.node.active)
            .map((marker) => Number(marker.id));
        void this.presenter.refreshVisibleCamps(ids);
    }

    protected onEnable(): void {
        this.queueCampRefresh();
        this.schedule(this.refreshVisibleCamps, BIGMAP_CAMP_REFRESH_SECONDS);
    }

    protected onDisable(): void {
        this.unschedule(this.refreshVisibleCamps);
        if (this.campRefreshTimer !== null) clearTimeout(this.campRefreshTimer);
        this.campRefreshTimer = null;
    }

    protected onDestroy(): void {
        this.onDisable();
        // 子节点的事件处理器此时已被引擎销毁，不再对它们调用 off。
        if (this.templateRoot) {
            this.templateRoot.destroy();
            this.templateRoot = null;
        }
    }

    resetCamera(): void {
        if (!this.presenter) return;
        const base = this.centerOf(this.presenter.world.playerBase.hexId);
        const scale = Math.min(1, Math.max(0.55, this.viewportTransform.width / 720));
        this.applyCamera(scale, -base.x * scale, -base.y * scale - 100);
    }

    zoomBy(factor: number, anchor = new Vec2()): void {
        const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
        if (scale === this.zoom) return;
        const ratio = scale / this.zoom;
        const position = this.content.position;
        this.applyCamera(scale, anchor.x - (anchor.x - position.x) * ratio, anchor.y - (anchor.y - position.y) * ratio);
    }

    focusOn(hexId: number): void {
        const center = this.centerOf(hexId);
        this.applyCamera(this.zoom, -center.x * this.zoom, -center.y * this.zoom - 100);
    }

    get currentZoom(): number { return this.zoom; }

    private onTouchStart(event: EventTouch): void {
        this.dragStart = event.getUILocation();
        const touches = event.getAllTouches();
        if (touches.length < 2) {
            this.dragMoved = 0;
            this.gesturePinched = false;
            return;
        }
        this.gesturePinched = true;
        const a = touches[0].getUILocation();
        const b = touches[1].getUILocation();
        this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    }

    private onTouchMove(event: EventTouch): void {
        const touches = event.getAllTouches();
        if (touches.length >= 2) {
            this.gesturePinched = true;
            const a = touches[0].getUILocation();
            const b = touches[1].getUILocation();
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            const anchor = this.toViewportSpace(new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2));
            if (this.pinchDistance > 0) this.zoomBy(distance / this.pinchDistance, anchor);
            this.pinchDistance = distance;
            return;
        }
        if (!this.dragStart || this.gesturePinched) return;
        const current = event.getUILocation();
        const previous = this.toViewportSpace(this.dragStart);
        const local = this.toViewportSpace(current);
        this.dragMoved += Math.abs(current.x - this.dragStart.x) + Math.abs(current.y - this.dragStart.y);
        const position = this.content.position;
        this.applyCamera(this.zoom, position.x + local.x - previous.x, position.y + local.y - previous.y);
        this.dragStart = current;
    }

    private onTouchEnd(event: EventTouch): void {
        const canSelect = this.dragStart !== null && this.dragMoved <= 12 && !this.gesturePinched;
        this.dragStart = null;
        this.pinchDistance = 0;
        if (!canSelect) return;
        const local = this.toViewportSpace(event.getUILocation());
        const position = this.content.position;
        const x = (local.x - position.x) / this.zoom;
        const y = (local.y - position.y) / this.zoom;
        const hitAreas = this.markers.filter((marker) => marker.node.active).map((marker) => ({
            hexId: marker.hexId,
            width: marker.icon.spriteFrame ? marker.icon.spriteFrame.rect.width * marker.icon.node.scale.x : 0,
            height: marker.icon.spriteFrame ? marker.icon.spriteFrame.rect.height * marker.icon.node.scale.y : 0,
        }));
        const markerHex = pickBigMapMarker(this.layout, hitAreas, x, y);
        const hexId = markerHex >= 0 ? markerHex : this.pickHexAt(new Vec2(x, y));
        if (hexId < 0) return;
        this.selectedHexId = hexId;
        this.refresh();
        this.onTap?.(hexId);
    }

    private onTouchCancel(): void {
        this.dragStart = null;
        this.pinchDistance = 0;
        this.gesturePinched = false;
    }

    private onWheel(event: EventMouse): void {
        const delta = event.getScrollY();
        if (delta !== 0) this.zoomBy(delta > 0 ? 1.12 : 1 / 1.12, this.toViewportSpace(event.getUILocation()));
    }

    private toViewportSpace(point: Vec2): Vec2 {
        const local = this.viewportTransform.convertToNodeSpaceAR(new Vec3(point.x, point.y, 0));
        return new Vec2(local.x, local.y);
    }

    get selected(): number { return this.selectedHexId; }

    occupantAt(hexId: number) {
        return this.presenter ? bigMapOccupantOf(this.presenter.world, hexId) : { kind: 'empty' as const };
    }
}
