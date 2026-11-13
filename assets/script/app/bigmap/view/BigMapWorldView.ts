import {
    _decorator, Button, Color, Component, EventMouse, EventTouch, Graphics, instantiate,
    Node, Prefab, Sprite, SpriteFrame, UITransform, Vec2, Vec3,
} from 'cc';
import type { IHexGridLayout } from '../../../core/hex/HexGridLayout';
import type { IBigMapArt } from '../application/BigMapArtLoader';
import type { IBigMapViewState, IBigMapCityView } from '../application/BigMapViewState';
import { BIGMAP_CAMP_ROLE_TEXT, type IBigMapCampRoleInfo } from '../model/BigMapCampRoleInfo';
import { bigMapHexDistance, bigMapOccupantOf } from '../model/BigMapWorld';
import {
    assignTerritoryColorSlots, assignTerritoryColorSlotsFromAdjacency, bigMapPlayerBaseColorSlot,
} from '../model/BigMapTerritoryColor';
import type { BigMapCityState, BigMapTerrain } from '../model/BigMapTypes';
import {
    BIGMAP_TILE_WIDTH, BIGMAP_TILE_HEIGHT, BIGMAP_COLUMN_STEP, BIGMAP_ROW_STEP,
    BIGMAP_MARKER_CITY_WIDTH, BIGMAP_MARKER_BASE_WIDTH, BIGMAP_MARKER_MONSTER_WIDTH,
    bigMapGroundIndex, buildBigMapTerritoryEdges, buildBigMapWorldLayout, pickBigMapHex, pickBigMapMarker, visibleBigMapHexes,
    type IBigMapTerritoryEdge,
} from './BigMapWorldLayout';
import {
    BIGMAP_COLORS, BIGMAP_TERRITORY_COLORS, BIGMAP_TERRITORY_FILL_ALPHA, BIGMAP_TERRITORY_OWNED_FILL_ALPHA,
    BIGMAP_TERRITORY_SELF_COLOR, BIGMAP_TERRITORY_ENEMY_COLOR, BIGMAP_TERRITORY_STROKE_ALPHA,
    BIGMAP_TERRITORY_NEIGHBOR_GAP,
} from './BigMapTheme';
import { BigMapWorldMarker } from './BigMapWorldMarker';
import { BigMapWorldTemplates } from './BigMapWorldTemplates';
import { bigMapBackgroundLayout } from './BigMapBackgroundLayout';

import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent } from '../application/BigMapEvents';

const { ccclass, property } = _decorator;
export const WORLD_HEX_SIZE = BIGMAP_TILE_WIDTH / 2;
export const WORLD_COL_STEP = BIGMAP_COLUMN_STEP;
export const WORLD_ROW_STEP = BIGMAP_ROW_STEP;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 1.6;
/
 *选中城池据点后，相机额外上抬的量（内容系坐标，屏上是 `× zoom`）。
 *
 * 2026-11-03 用户口径（两轮）：
 * · 第一轮：*「城池据点连带着名称和等级的UI节点上移200px（底部与当前城主的上沿对齐即可）」*；
 * · 第二轮：*「还需要上移100px，并且是在地图放大到接近极限的85%的相机位置」*
 *   ⇒ 总量 300（`MIN_ZOOM=0.15`、`MAX_ZOOM=1.6`，85% ≈ zoom 1.38，即用户验收的机位）。
 *
 * 2026-11-11 用户口径：*「大地图点击查看城池据点，城池据点居中时，背景地图要同步移动」*
 *⇒ 抬的对象从标记节点换成相机。旧做法只挪 `marker.node`，城飞起来、脚下那块地和势力色
 *还在原处（截图里就是「城在上面、它原来的格子空着」）。现在抬 `content`（背景 / 地块 /
 *势力色 / 标记的共同父节点），整张图一起上移，城永远贴着自己的格子。
 *
 *数值不变：`content.y += 300 * zoom` 与旧版「标记在内容系 +300」算出同一个屏幕位置
 *（`300 * zoom - 100`，相对视口中心），所以「名条对齐弹窗『当前城主』那块」的观感原样保留。
 *要微调只改这一个值。
 */
const BIGMAP_FOCUSED_CITY_LIFT = 300;
/
 *玩家标记上「HP xxx」那行的 y（内容系坐标，标记原点 = 所在格中心）。
 *
 *没有建筑图 ⇒ 名条占 -70..-16、头像挂在 +44 附近，血量只能再往上让一层；
 *头像换尺寸时只调这一个值（`BigMapWorldMarker.setStatusLine`）。
 */
const BIGMAP_ROLE_HP_Y = 132;
/
 *地形色（乘算叠在 `grounds/ground_0x.png` 上，所以只能压暗、不能提亮）。
 *
 *口径（2026-10-21 用户口径：「地块默认颜色如图 2」）：默认一律是沙地本色，
 *地形只保留极轻的冷暖差异。之前森林是 `(210,225,195)`、水面是 `(166,210,221)`，
 *乘在沙色上分别变成土黄和苔绿，整片地图花成迷彩 —— 玩家根本看不出哪块地属于哪个势力。
 *现在颜色让给势力染色（`BIGMAP_TERRITORY_COLORS`），地形退成"近看才分得出"的细节。
 */
const TERRAIN_TINT: Readonly<Record<BigMapTerrain, Color>> = {
    plain: Color.WHITE,
    forest: new Color(248, 244, 226),
    rock: new Color(240, 238, 234),
    water: new Color(228, 240, 244),
};
/
 *没有地块美术时的兜底填色（`paintTerrain`）。
 *
 *注意这一套是直接填充、不是乘算，所以要给实色 —— 直接拿 `TERRAIN_TINT` 去填
 *会得到一片惨白（那是乘数不是颜色）。
 */
const TERRAIN_FILL: Readonly<Record<BigMapTerrain, Color>> = {
    plain: new Color(206, 175, 138),
    forest: new Color(190, 198, 152),
    rock: new Color(190, 186, 178),
    water: new Color(152, 190, 202),
};
/ 连续背景上的地形只留轻色；空地完全透出底图，势力颜色仍由 markerLayer 表达。 */
const TRANSPARENT_TERRAIN_FILL: Readonly<Record<BigMapTerrain, Color>> = {
    plain: new Color(0, 0, 0, 0),
    forest: new Color(96, 170, 104, 24),
    rock: new Color(120, 122, 132, 24),
    water: new Color(92, 138, 208, 40),
};
const TRANSPARENT_GRID_COLOR = new Color(70, 92, 74, 48);
interface IWorldMarker {
    readonly hexId: number;
    readonly kind: 'city' | 'monster' | 'base' | 'role';
    readonly id: number | string;
    readonly node: Node;
    readonly icon: Sprite;
    readonly view: BigMapWorldMarker;
    /
     *名单归属的据点 id（只有 `role` 标记有）。
     *
     *聚焦态靠它判「本城玩家」，绝不用 `pos` 反查 —— 同格可能站着别城的角色，
     *按坐标反推会把不相关的玩家一起留下（`tests/bigmap-focus-city.test.ts` 守着）。
     */
    readonly cityId?: number;
}

/ 一次标记绘制的全部显示数据（建筑图 + 名条 + 文案 + 兜底色）。 */
interface IBigMapMarkerArt {
    readonly frame: SpriteFrame | null;
    readonly plate: SpriteFrame | null;
    / 名条左端徽章位：等级 / 关卡号；空串 = 只留名字。 */
    readonly level: string;
    readonly name: string;
    / 占据者名字；空串 = 不挂旗、不显示。 */
    readonly occupant: string;
    readonly tint: Color;
    readonly width: number;
}

/ JSON 世界的表现：地块按视口复用，规则和落位只读 Presenter。 */
@ccclass('BigMapWorldView')
export class BigMapWorldView extends Component {
    private data: IBigMapViewState | null = null;
    @property({ type: UITransform, group: '布局' }) private rootTransform: UITransform = null;
    @property({ type: Node, group: '布局' }) private viewport: Node = null;
    @property({ type: UITransform, group: '布局' }) private viewportTransform: UITransform = null;
    @property({ type: Node, group: '地图图层' }) private content: Node = null;
    @property({ type: Sprite, group: '背景' }) private background: Sprite = null;
    @property({ type: Sprite, group: '背景' }) private sand: Sprite = null;
    @property({ type: UITransform, group: '背景' }) private sandTransform: UITransform = null;
    @property({ type: Graphics, group: '地图图层' }) private terrainLayer: Graphics = null;
    @property({ type: Node, group: '地图图层' }) private tileLayer: Node = null;
    @property({ type: Node, group: '地图图层' }) private decorLayer: Node = null;
    @property({ type: Graphics, group: '地图图层' }) private markerLayer: Graphics = null;
    @property({ type: Node, group: '地图图层' }) private iconLayer: Node = null;
    @property({ type: Prefab, group: '模板资源' }) private templatesPrefab: Prefab = null;
    private templateRoot: Node | null = null;
    private groundTemplate: Node = null;
    private decorTemplate: Node = null;
    private markerTemplate: Node = null;
    @property({ type: Button, group: '操作按钮' }) private zoomInButton: Button = null;
    @property({ type: Button, group: '操作按钮' }) private zoomOutButton: Button = null;
    @property({ type: Button, group: '操作按钮' }) private focusButton: Button = null;
    private layout: IHexGridLayout = buildBigMapWorldLayout(0, 0);
    private art: IBigMapArt | null = null;
    private backgroundTransform: UITransform | null = null;
    private playerPortrait: SpriteFrame | null = null;
    private readonly rolePortraits = new Map<string, SpriteFrame | null>();
    private readonly tilePool: Sprite[] = [];
    private readonly decorPool: Sprite[] = [];
    private readonly markers: IWorldMarker[] = [];
    / 名单角色标记（键 = `roleId@pos`）；随 `campRoles` 增删，和城池/野怪共用同一套模板。 */
    private readonly roleMarkers = new Map<string, IWorldMarker>();
    private roleMarkerKey = '';
    private contentKey = '';
    / 上次绘制时玩家基地所在的格（`data.playerBaseHexId`）；变化即重建标记。 */
    private markerAnchorHexId = -1;
    private zoom = 1;
    private selectedHexId = -1;
    / 已经为哪座城把相机抬起来过（-1 = 没抬）；聚焦态切换时用来幂等/可逆地补偿。 */
    private liftedFocusHexId = -1;
    / 城池 id → 势力色板下标（相邻势力不同色，见 `assignTerritoryColorSlots`）。 */
    private territorySlots: ReadonlyMap<number, number> = new Map();
    private readonly territoryEdges = new Map<number, readonly IBigMapTerritoryEdge[]>();
    private readonly baseTerritoryEdges = new Map<number, readonly IBigMapTerritoryEdge[]>();
    private dragStart: Vec2 | null = null;
    private dragMoved = 0;
    private pinchDistance = 0;
    private gesturePinched = false;
    private campRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    build(data: IBigMapViewState, width: number, height: number): void {
        this.ensureTemplates();
        this.unbindInput();
        for (const marker of this.markers) marker.node.destroy();
        for (const sprite of this.tilePool) sprite.node.destroy();
        for (const sprite of this.decorPool) sprite.node.destroy();
        this.data = data;
        this.markers.length = 0;
        this.roleMarkers.clear();
        this.roleMarkerKey = '';
        this.tilePool.length = 0;
        this.decorPool.length = 0;
        this.contentKey = '';
        this.selectedHexId = -1;
        this.layout = buildBigMapWorldLayout(data.world.rows, data.world.cols);
        this.rootTransform.setContentSize(width, height);
        this.viewportTransform.setContentSize(width, height);
        this.sandTransform.setContentSize(width, height);
        this.buildMarkers();
        this.markerAnchorHexId = data.playerBaseHexId;
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
        //模板实例不挂入页面层级；只将它的原型克隆到实际显示图层。
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
        if (this.data) this.focusOn(this.data.playerBaseHexId);
    }

    render(data: IBigMapViewState): void {
        this.data = data;
        this.selectedHexId = data.ui.selectedCityId > 0 ? data.cities.get(data.ui.selectedCityId)?.hexId ?? -1
            : data.ui.selectedMonsterId > 0 ? data.monsters.get(data.ui.selectedMonsterId)?.hexId ?? -1
            : data.ui.selectedBaseHexId;
        this.refresh();
    }

    setArt(art: IBigMapArt): void {
        this.art = art;
        const frame = art.tiledBackground ?? art.background;
        this.background.spriteFrame = frame;
        this.background.node.active = !!frame;
        const transform = this.background.node.getComponent(UITransform);
        if (!transform) throw new Error('[BigMapWorldView] 背景缺少 UITransform');
        this.backgroundTransform = transform;
        this.background.type = art.tiledBackground ? Sprite.Type.TILED : Sprite.Type.SIMPLE;
        this.background.sizeMode = Sprite.SizeMode.CUSTOM;
        this.background.trim = false;
        this.background.color = Color.WHITE;
        transform.setAnchorPoint(0.5, 0.5);
        this.background.node.setParent(art.tiledBackground ? this.content : this.viewport);
        this.background.node.setSiblingIndex(0);
        this.sand.node.active = !art.tiledBackground;
        this.syncBackground();
        this.paintTerrain();
        this.contentKey = '';
        this.refresh();
        this.syncVisibleTiles();
    }

    private syncBackground(): void {
        const tiled = this.art?.tiledBackground;
        const frame = tiled ?? this.art?.background;
        const transform = this.backgroundTransform;
        if (!frame || !transform) return;
        const position = this.content.position;
        const rect = frame.originalSize;
        //setArt 可能先于 build；始终按当前视口计算覆盖比例。
        const scale = tiled ? 1 : Math.max(this.viewportTransform.width / rect.width,
            this.viewportTransform.height / rect.height);
        this.background.node.setScale(scale, scale, 1);
        const layout = tiled
            ? bigMapBackgroundLayout(this.viewportTransform.width, this.viewportTransform.height,
                this.zoom, position.x, position.y, rect.width, rect.height)
            : { x: 0, y: 0, width: rect.width, height: rect.height };
        transform.setContentSize(layout.width, layout.height);
        this.background.node.setPosition(layout.x, layout.y, 0);
    }

    private centerOf(hexId: number): Vec2 {
        const point = this.layout.points.get(hexId);
        return point ? new Vec2(point.x, point.y) : new Vec2();
    }

    pickHexAt(local: Vec2): number {
        const world = this.data?.world;
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

    private paintTerrain(visibleIds: readonly number[] = []): void {
        const world = this.data?.world;
        const g = this.terrainLayer;
        g.clear();
        if (!world) return;
        if (this.art?.tiledBackground) {
            for (const id of visibleIds) {
                const tile = world.tileById.get(id);
                if (!tile) continue;
                const color = TRANSPARENT_TERRAIN_FILL[tile.terrain];
                if (color.a === 0) continue;
                g.fillColor = color;
                this.hexPath(g, id);
                g.fill();
            }
            if (visibleIds.length === 0) return;
            g.lineWidth = 1;
            g.strokeColor = TRANSPARENT_GRID_COLOR;
            for (const id of visibleIds) this.hexPath(g, id);
            g.stroke();
            return;
        }
        if (this.art?.ground) return;
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

    /
     *算一次势力配色（世界是只读快照，城池占格不会变，所以只在 `build` 时跑）。
     *
     *「相邻」优先信布局里的 `adjacentCityIds`（编辑器按范围真实相接推导）：
     *势力范围铺满地图后，两片地是真的贴在一起，只有沿边界一条线的邻居；
     *按锚点距离近似会把「隔着两格」的也算成邻居（见 `BIGMAP_TERRITORY_NEIGHBOR_GAP` = 10），
     *需要 7~8 色才够，色板一浅就撞色。种子世界没有邻接表时才退回距离判定。
     */
    private rebuildTerritorySlots(): void {
        const data = this.data;
        if (!data) return;
        const world = data.world;
        const regions = data.territories;
        this.territoryEdges.clear();
        for (const region of regions) this.territoryEdges.set(region.id, buildBigMapTerritoryEdges(this.layout, region.hexIds));
        this.baseTerritoryEdges.clear();
        //玩家基地画在 `playerBaseHexId`（`toCampId` 那座城的锚点），描边必须按实际绘制格算 ——
        //按布局档的 `isPlayer` 格算会在基地搬家后留下一圈错位的边线。
        for (const base of world.bases) {
            const hexId = base.isPlayer ? data.playerBaseHexId : base.hexId;
            this.baseTerritoryEdges.set(hexId, buildBigMapTerritoryEdges(this.layout, [hexId]));
        }
        const paletteSize = BIGMAP_TERRITORY_COLORS.length;
        const hasAdjacency = Array.from(world.cities.values()).some((city) => (city.adjacentCityIds?.length ?? 0) > 0);
        this.territorySlots = hasAdjacency
            ? assignTerritoryColorSlotsFromAdjacency(
                regions, (id) => world.cities.get(id)?.adjacentCityIds ?? [], paletteSize,
            )
            : assignTerritoryColorSlots(
                regions,
                (a, b) => bigMapHexDistance(world.rows, world.cols, a, b),
                paletteSize,
                BIGMAP_TERRITORY_NEIGHBOR_GAP,
            );
    }

    /
     *城池 → 势力范围该刷什么色、刷多实。
     *
     *口径（2026-10-28 用户要求）：
     *- 我占的城 = 绿；其他玩家占的城 = 红；这两种给更实的填充，压过中立的色板色；
     *- 其余（无主）= 色板色，相邻两片不同色（`rebuildTerritorySlots` 保证）。
     *
     *没查到这座城的视图（理论上不会）时按无主处理，绝不返回 null 让调用点判空。
     */
    private territoryPaint(cityId: number, city: IBigMapCityView | undefined): { color: Color; alpha: number } {
        if (city?.territoryOwner === 'self') {
            return { color: BIGMAP_TERRITORY_SELF_COLOR, alpha: BIGMAP_TERRITORY_OWNED_FILL_ALPHA };
        }
        if (city?.territoryOwner === 'other') {
            return { color: BIGMAP_TERRITORY_ENEMY_COLOR, alpha: BIGMAP_TERRITORY_OWNED_FILL_ALPHA };
        }
        const slot = this.territorySlots.get(cityId) ?? 0;
        return {
            color: BIGMAP_TERRITORY_COLORS[slot % BIGMAP_TERRITORY_COLORS.length],
            alpha: BIGMAP_TERRITORY_FILL_ALPHA,
        };
    }

    / 相机变化时复用可见槽位，避免为百行地图创建一万个 Sprite。 */
    private syncVisibleTiles(): void {
        const world = this.data?.world;
        const art = this.art;
        if (!world || !art || (!art.tiledBackground && !art.ground)) return;
        const transparent = !!art.tiledBackground;
        const position = this.content.position;
        const halfWidth = this.viewportTransform.width / 2;
        const halfHeight = this.viewportTransform.height / 2;
        const ids = visibleBigMapHexes(this.layout, world.rows, world.cols, {
            left: (-halfWidth - position.x) / this.zoom, right: (halfWidth - position.x) / this.zoom,
            bottom: (-halfHeight - position.y) / this.zoom, top: (halfHeight - position.y) / this.zoom,
        });
        this.paintTerrain(ids);
        for (let i = 0; i < ids.length; i += 1) {
            const point = this.layout.points.get(ids[i]);
            const tile = world.tileById.get(ids[i]);
            if (!point || !tile) continue;
            if (!transparent) {
                const sprite = this.tilePool[i] ?? this.createTileSlot();
                sprite.node.active = true;
                const variant = bigMapGroundIndex(world.seed, ids[i], art.groundVariants.length);
                sprite.spriteFrame = art.groundVariants[variant] ?? art.ground;
                sprite.color = TERRAIN_TINT[tile.terrain];
                sprite.node.setPosition(point.x, point.y, 0);
                sprite.node.getComponent(UITransform).setContentSize(BIGMAP_TILE_WIDTH, BIGMAP_TILE_HEIGHT);
            }
            const decor = this.decorPool[i] ?? this.createDecorSlot();
            const frame = tile.terrain === 'rock' ? art.rock : tile.terrain === 'forest' ? art.grass : null;
            decor.node.active = !!frame;
            decor.spriteFrame = frame;
            decor.color = Color.WHITE;
            decor.node.setPosition(point.x + 24, point.y - 16, 0);
            if (frame) decor.node.setScale(32 / frame.rect.width, 32 / frame.rect.width, 1);
        }
        for (let i = transparent ? 0 : ids.length; i < this.tilePool.length; i += 1) {
            this.tilePool[i].node.active = false;
            if (transparent) this.tilePool[i].spriteFrame = null;
        }
        for (let i = ids.length; i < this.decorPool.length; i += 1) {
            this.decorPool[i].node.active = false;
        }
    }

    private createTileSlot(): Sprite {
        const node = instantiate(this.groundTemplate);
        node.setParent(this.tileLayer);
        const sprite = node.getComponent(Sprite);
        if (!sprite) throw new Error('[BigMapWorldView] 地块模板缺少 Sprite');
        this.tilePool.push(sprite);
        return sprite;
    }

    private createDecorSlot(): Sprite {
        const decorNode = instantiate(this.decorTemplate);
        decorNode.setParent(this.decorLayer);
        const decor = decorNode.getComponent(Sprite);
        if (!decor) throw new Error('[BigMapWorldView] 装饰模板缺少 Sprite');
        this.decorPool.push(decor);
        return decor;
    }

    private buildMarkers(): void {
        const data = this.data;
        if (!data) return;
        for (const city of data.cities.values()) this.addMarker('city', city.cityId, city.hexId);
        for (const monster of data.world.monsters) this.addMarker('monster', monster.instanceId, monster.anchorHexId);
        //NPC 基地按布局档落位；玩家基地只认 playerBaseHexId，不额外绘制布局档的旧位置。
        for (const base of data.world.bases) {
            if (!data.isServerBase && !base.isPlayer) this.addMarker('base', base.baseId, base.hexId);
        }
        //基地落在城池锚点时复用城池标记，保留城池查询与点击，避免同格叠两套建筑和名条。
        const playerCity = Array.from(data.cities.values()).find((city) => city.hexId === data.playerBaseHexId);
        if (!playerCity) this.addMarker('base', data.world.playerBase.baseId, data.playerBaseHexId);
        this.markers.sort((a, b) => this.centerOf(b.hexId).y - this.centerOf(a.hexId).y);
        this.markers.forEach((marker, index) => marker.node.setSiblingIndex(index));
    }

    / 基地位置会随 `toCampId` 到达而变化：清掉旧标记整套重建（只在格真的变了时跑）。 */
    private rebuildMarkers(): void {
        for (const marker of this.markers) marker.node.destroy();
        this.markers.length = 0;
        //角色标记也在 `markers` 里，跟着一起销毁 ⇒ 指针与结构 key 都要清，
        //否则 `syncRoleMarkers` 认为「集合没变」而不重建，地图上就再没有玩家标记了。
        this.roleMarkers.clear();
        this.roleMarkerKey = '';
        this.buildMarkers();
    }

    private addMarker(kind: IWorldMarker['kind'], id: number | string, hexId: number,
        cityId = 0): IWorldMarker {
        const center = this.centerOf(hexId);
        const node = instantiate(this.markerTemplate);
        node.name = `${kind}_${id}`;
        node.setParent(this.iconLayer);
        node.setPosition(center.x, center.y, 0);
        const marker = node.getComponent(BigMapWorldMarker);
        if (!marker) throw new Error('[BigMapWorldView] 标记模板缺少 BigMapWorldMarker');
        const entry: IWorldMarker = {
            kind, id, hexId, node, icon: marker.icon, view: marker,
            ...(cityId > 0 ? { cityId } : {}),
        };
        this.markers.push(entry);
        return entry;
    }

    private applyMarker(marker: IWorldMarker, view: IBigMapMarkerArt): void {
        marker.view.render(view.frame, view.plate, view.level, view.name, view.occupant, view.tint, view.width);
        marker.view.setOccupantFlag(view.occupant ? this.art?.plateFlag ?? null : null);
    }

    /
     *名单角色标记与当前名单对齐：每个角色落在自己的 `pos` 格（`SlgGameCameRoleInfo.pos`）。
     *
     *口径（2026-11-11 山猫）：*「把玩家摆放在对应的 pos」*。
     *
     *· 增删只按 `roleId@pos` 集合 —— 只改血 / 等级 / 头像时不动节点（重建会让标记闪一下）；
     *· `pos` 不在本图点位上（异常包）直接跳过，绝不落到原点堆成一坨；
     *· 归属（`cityId`）随标记一起记，聚焦态按它判「本城玩家」，不用 `pos` 反推。
     *
     *@returns 内容 key：血 / 等级 / 头像 / 归属任一变化都要重绘
     */
    private syncRoleMarkers(): string {
        const data = this.data;
        if (!data) return '';
        const desired = new Map<string, { cityId: number; role: IBigMapCampRoleInfo }>();
        const parts: string[] = [];
        for (const city of data.cities.values()) {
            const self = city.territoryOwner === 'self' ? 's' : 'o';
            for (const role of city.campRoles) {
                const id = `${role.roleId}@${role.pos}`;
                desired.set(id, { cityId: city.cityId, role });
                parts.push(`${id}:${role.defenseHp}:${role.buildLevel ?? 0}:${role.avatarId}:${self}`);
            }
        }
        parts.sort();
        const structure = Array.from(desired.keys()).sort().join(',');
        if (structure !== this.roleMarkerKey) {
            this.roleMarkerKey = structure;
            for (const [id, marker] of this.roleMarkers) {
                if (desired.has(id)) continue;
                this.removeMarker(marker);
                this.roleMarkers.delete(id);
            }
            for (const [id, entry] of desired) {
                if (this.roleMarkers.has(id) || !this.layout.points.has(entry.role.pos)) continue;
                this.roleMarkers.set(id, this.addMarker('role', id, entry.role.pos, entry.cityId));
            }
            //标记集合变了 ⇒ 按 y 重排一次，上下遮挡与点击顺序（取反序先命中靠下的）保持稳定。
            this.markers.sort((a, b) => this.centerOf(b.hexId).y - this.centerOf(a.hexId).y);
            this.markers.forEach((marker, index) => marker.node.setSiblingIndex(index));
        }
        return parts.join(',');
    }

    private removeMarker(marker: IWorldMarker): void {
        marker.node.destroy();
        const index = this.markers.indexOf(marker);
        if (index >= 0) this.markers.splice(index, 1);
    }

    / 标记对应的当前名单条目；角色跨城 / 被顶掉后返回 `null`（本轮不画，等结构同步摘节点）。 */
    private roleOf(marker: IWorldMarker): IBigMapCampRoleInfo | null {
        const city = marker.cityId ? this.data?.cities.get(marker.cityId) : undefined;
        if (!city) return null;
        return city.campRoles.find((role) => `${role.roleId}@${role.pos}` === marker.id) ?? null;
    }

    /
     *玩家标记：头像 + 名条（建筑等级徽章 + 角色名）+ 血量，落在自己的 `pos` 格。
     *
     *复用据点标记模板（`BigMapWorldMarker`），所以没有建筑图：`icon` 隐藏，名条落在
     *建筑位、头像挂在名条上方，血量走「占据者」那行（没有旗帜 ⇒ 只剩文字，见 `setStatusLine`）。
     *名条颜色仍按归属四选一：己方据点里的玩家走己方绿，其余走他人灰。
     */
    private renderRoleMarker(marker: IWorldMarker, role: IBigMapCampRoleInfo): void {
        const self = marker.cityId ? this.data?.cities.get(marker.cityId)?.territoryOwner === 'self' : false;
        this.applyMarker(marker, {
            frame: null,
            plate: this.art?.plates.get(self ? 'self' : 'other') ?? null,
            level: role.buildLevel ? String(role.buildLevel) : '',
            name: role.roleName || role.roleId,
            //名条下方已经是名条自己的位置，血量改走独立一行（`setStatusLine`），这里不占。
            occupant: '',
            tint: self ? BIGMAP_TERRITORY_SELF_COLOR : BIGMAP_COLORS.locked,
            width: 0,
        });
        marker.view.setPortrait(this.rolePortraits.get(role.avatarId) ?? null);
        marker.view.setStatusLine(BIGMAP_CAMP_ROLE_TEXT.hp(role.defenseHp), BIGMAP_ROLE_HP_Y);
    }

    setPlayerPortrait(frame: SpriteFrame | null): void {
        this.playerPortrait = frame;
        this.contentKey = '';
        this.refresh();
    }

    setRolePortrait(avatarId: string, frame: SpriteFrame | null): void {
        this.rolePortraits.set(avatarId, frame);
        this.contentKey = '';
        this.refresh();
    }

    private paintTerritory(
        hexIds: readonly number[],
        tint: Color,
        edges: readonly IBigMapTerritoryEdge[],
        fillAlpha = BIGMAP_TERRITORY_FILL_ALPHA,
    ): void {
        const g = this.markerLayer;
        const fill = new Color(tint.r, tint.g, tint.b, fillAlpha);
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
        const data = this.data;
        if (!data) return;
        //基地格 = `toCampId` 那座城的锚点，它可能在页面打开之后才从 game 包到达。
        //位置变了必须先重建标记并作废内容 key，否则下面的早退会让基地图标停在上一个格。
        const anchorHexId = data.playerBaseHexId;
        if (anchorHexId !== this.markerAnchorHexId) {
            this.markerAnchorHexId = anchorHexId;
            this.rebuildMarkers();
            this.contentKey = '';
        }
        //名单角色标记先跟上当前名单（`CmdSlgCampRoleInfosRspMsg` 是异步到的），
        //它同时算出一份内容 key：血/等级/头像变化要重绘，只增删角色要重建节点。
        const roleKey = this.syncRoleMarkers();
        const cities = Array.from(data.cities.values());
        const monsters = data.world.monsters.map((site) => data.monsters.get(site.instanceId));
        //`playerCampId` 必须进 key：game 包到达后基地要换成所属城池的势力色，
        //不带上它就会因为「其它内容没变」而早退，染色永远停在上一次。
        //`territoryOwner` 与 `occupyRoleName` 同理：名条贴图按归属四选一、占据者名字写在名条上方，
        //少任一字段都会出现「详情包已到、名字却停在空」的静默不刷新。
        const key = `${this.selectedHexId}|${data.playerCampId}|${this.focusedCityHexId}|`
            + cities.map((c) => `${c.cityId}:${c.state}:${c.territoryOwner}:${c.campInfo?.opType}:${c.campInfo?.occupyRoleName}:`
                + (c.rankEntries ?? []).filter((row) => row.rank === 1).map((row) => `${row.roleId}:${row.avatarId}`).join(';')).join(',')
            + '|' + monsters.map((m) => m ? `${m.instanceId}:${m.unlocked}:${m.respawnInSeconds > 0}` : '').join(',')
            + '|' + roleKey;
        if (key === this.contentKey) return;
        this.contentKey = key;
        this.markerLayer.clear();
        //每片势力范围整片铺色：无主走色板（相邻不同色），己方绿、他人红（见 `territoryPaint`）。
        for (const region of data.territories) {
            const paint = this.territoryPaint(region.id, data.cities.get(region.id));
            this.paintTerritory(region.hexIds, paint.color,
                this.territoryEdges.get(region.id) ?? [], paint.alpha);
        }
        for (const marker of this.markers) {
            if (marker.kind === 'city') {
                const city = data.cities.get(Number(marker.id));
                if (!city) continue;
                const isPlayerBase = marker.hexId === data.playerBaseHexId;
                //地块叠势力色（相邻不同色），角标仍用状态色 —— 两套信息各走各的通道。
                //唯一例外：己方占据的城角标也跟着变绿（2026-10-28 口径「我占了这座城，
                //城池的颜色变成绿色」），否则会出现「一整片绿地里插着个红城头」。
                const tint = isPlayerBase || city.territoryOwner === 'self'
                    ? BIGMAP_TERRITORY_SELF_COLOR
                    : city.isServerCamp
                        ? (city.campInfo ? (city.campInfo.opType === 1 ? BIGMAP_COLORS.campOccupied : BIGMAP_COLORS.campUnoccupied)
                            : BIGMAP_COLORS.locked)
                        : this.cityTint(city.state);
                //名条按归属四选一（蓝湖「大地图3」）：己方绿 / 他人灰 / 其余走红色关卡条。
                // 贴图自带颜色 ⇒ 不再承载「可攻打 / 锁定 / 未开放」的状态色，
                //   那几态现在只由建筑图灰度（`icon.color`）表达 —— 两套信息别混。
                const plateKey = isPlayerBase || city.territoryOwner === 'self' ? 'self'
                    : city.territoryOwner === 'other' ? 'other' : 'city';
                this.applyMarker(marker, {
                    frame: isPlayerBase ? this.art?.home ?? null : this.art?.camps.get(city.cityId) ?? this.art?.city ?? null,
                    plate: this.art?.plates.get(plateKey) ?? null,
                    level: !isPlayerBase && city.level > 0 ? String(city.level) : '',
                    name: isPlayerBase ? '主城' : city.name,
                    //只有详情包才带得到占领者名字（`detailed=false` 的简略包恒空串，
                    //见 `BigMapCampInfo`），拿不到就不挂旗，绝不显示「已占领 · 空名字」。
                    occupant: city.campInfo?.opType === 1 ? city.campInfo.occupyRoleName : '',
                    tint, width: isPlayerBase ? BIGMAP_MARKER_BASE_WIDTH : BIGMAP_MARKER_CITY_WIDTH,
                });
                marker.icon.color = !isPlayerBase && city.state === 'unavailable' ? new Color(130, 130, 130) : Color.WHITE;
                const champion = city.rankEntries?.find((row) => row.rank === 1);
                marker.view.setPortrait(champion?.avatarId
                    ? this.rolePortraits.get(champion.avatarId) ?? null
                    : isPlayerBase ? this.playerPortrait : null);
            } else if (marker.kind === 'monster') {
                const monster = data.monsters.get(Number(marker.id));
                if (!monster) continue;
                this.applyMarker(marker, {
                    frame: this.art?.monster ?? null,
                    //名条跟关卡据点同一条红底（2026-11-03 用户口径：
                    //*「野怪的标识和城池据点的保持一样的红色」*）。
                    //原来走 `plate_monster`（设计稿 `title_01` 那张蓝底），本意是用颜色区分「野怪 / 关卡」，
                    //实机看下来红底更醒目、也和「据点 = 要去打的东西」这个语义一致 ⇒ 统一到 `city`（红）。
                    // `plate_monster` 那张图还留在 `BIGMAP_PLATE_KEYS` 里（照样加载、随时可切回来），
                    //   只是本视图不再引用它 —— 别当成漏改又「修」回蓝色。
                    plate: this.art?.plates.get('city') ?? null,
                    level: String(monster.level),
                    //刷新中没得打：把「刷新中」放进名字位（徽章位留给等级，别让数字位忽大忽小）。
                    name: monster.respawnInSeconds > 0 ? '刷新中' : monster.name,
                    occupant: '',
                    tint: monster.unlocked ? BIGMAP_COLORS.campOccupied : BIGMAP_COLORS.locked,
                    width: BIGMAP_MARKER_MONSTER_WIDTH,
                });
                marker.icon.color = monster.respawnInSeconds > 0 ? new Color(100, 100, 100) : Color.WHITE;
            } else if (marker.kind === 'role') {
                //名单里已经没这条（跨城 / 被顶掉）⇒ 本轮不画，等 `syncRoleMarkers` 摘掉节点。
                const role = this.roleOf(marker);
                if (!role) continue;
                this.renderRoleMarker(marker, role);
            } else {
                const base = data.world.bases.find((entry) => entry.baseId === marker.id) ?? data.world.playerBase;
                //玩家基地的势力 = 服务器 `SlgGameInfo.toCampId` 指向的那座城（2026-10-23 山猫口径：
                //「从地图查找到的城池就是大地图的基地」）⇒ 那座城的范围已经是己方绿，
                //基地格必须同色（2026-10-28 口径：我占的城整片绿），不再从色板里挑一档。
                //未收到包 / 未归属 / 该城不在地图上 ⇒ 回退原来的绿色标记。
                const mineSlot = base.isPlayer
                    ? bigMapPlayerBaseColorSlot(data.playerCampId, this.territorySlots)
                    : null;
                const tint = base.isPlayer
                    ? (mineSlot !== null ? BIGMAP_TERRITORY_SELF_COLOR : BIGMAP_COLORS.open)
                    : BIGMAP_COLORS.campOccupied;
                //用标记自己的格（= `playerBaseHexId`），不能再用 `base.hexId`（那是布局档的旧位置）。
                this.paintTerritory([marker.hexId], tint,
                    this.baseTerritoryEdges.get(marker.hexId) ?? [],
                    base.isPlayer ? BIGMAP_TERRITORY_OWNED_FILL_ALPHA : BIGMAP_TERRITORY_FILL_ALPHA);
                this.applyMarker(marker, {
                    frame: this.art?.home ?? null,
                    //玩家主城 = 己方（绿），NPC 基地走关卡条（红）—— 名条颜色只表达归属。
                    plate: this.art?.plates.get(base.isPlayer ? 'self' : 'city') ?? null,
                    level: '',
                    name: base.isPlayer ? '主城' : base.name,
                    occupant: '',
                    tint, width: BIGMAP_MARKER_BASE_WIDTH,
                });
                if (base.isPlayer) marker.view.setPortrait(this.playerPortrait);
            }
        }
        if (this.selectedHexId >= 0) {
            this.markerLayer.strokeColor = BIGMAP_COLORS.gold;
            this.markerLayer.lineWidth = 5;
            this.hexPath(this.markerLayer, this.selectedHexId);
            this.markerLayer.stroke();
        }
        this.applyFocusCamera();
        this.cullMarkers();
    }

    /
     *是否处于「城池聚焦」态：选中格是某座城池的锚点才算。
     *选野怪 / 玩家基地不聚焦（2026-11-03 口径只提了城池据点）；没选中也不聚焦。
     */
    private get focusedCityHexId(): number {
        if (this.data?.ui.campRolesVisible || this.data?.ui.pendingCampMoveId > 0) return -1;
        if (this.selectedHexId < 0 || !this.data) return -1;
        for (const city of this.data.cities.values()) {
            if (city.hexId === this.selectedHexId) return this.selectedHexId;
        }
        return -1;
    }

    /
     *城池聚焦的两件事（2026-11-03 用户：*「在大地图点击城池据点后，隐藏其他的城池据点和
     *玩家基地以及野怪模型，只展示该城池据点，城池据点连带着名称和等级的UI节点上移200px」*）：
     *
     *1. 保留选中城与本城名单玩家：隐藏走 `cullMarkers`（平移 / 缩放共用）；
     *2. 把相机连同整张地图一起上抬：2026-11-11 用户口径
     *   *「城池据点居中时，背景地图要同步移动」*。
     *
     *2026-11-03 那版抬的是 `marker.node`：城飞到半空，脚下那块地和势力色留在原处，
     *背景自然不会跟 —— 截图上就是「城在上面、它原来的格子空着」。
     *现在抬 `content`（背景 / 地块 / 势力色 / 标记的共同父节点）⇒ 城永远贴着自己的格子。
     *
     *只在聚焦态切换那一拍做一次，两个方向都可逆、重复跑不叠加：
     *· 聚焦建立 → `centerOnHex(居中 + 上抬)`，与随后的 `focusWorld` 命令（`focusOn`）
     *  算出同一个绝对位置，所以先 `refresh` 后收命令也不会抬两次；
     *· 聚焦解除 → 增量落回 `LIFT * zoom`（保留用户在这期间平移过的位置，不强行重定位）。
     *
     *选中态在 `contentKey` 里，选中一变 `refresh` 必然重跑，不需要另挂事件。
     */
    private applyFocusCamera(): void {
        const focus = this.focusedCityHexId;
        if (focus === this.liftedFocusHexId) return;
        const wasLifted = this.liftedFocusHexId >= 0;
        this.liftedFocusHexId = focus;
        if (focus >= 0) {
            this.centerOnHex(focus, BIGMAP_FOCUSED_CITY_LIFT);
            return;
        }
        if (!wasLifted) return;
        const position = this.content.position;
        this.applyCamera(this.zoom, position.x, position.y - BIGMAP_FOCUSED_CITY_LIFT * this.zoom);
    }

    private cityTint(state: BigMapCityState): Color {
        if (state === 'occupied') return BIGMAP_COLORS.open;
        if (state === 'unavailable' || state === 'locked') return BIGMAP_COLORS.locked;
        return BIGMAP_COLORS.danger;
    }

    private cullMarkers(): void {
        const position = this.content.position;
        const halfWidth = this.viewportTransform.width / 2 + 130 * this.zoom;
        //城池聚焦时只显示选中的城池和这座城名单里的玩家（玩家是按 `pos` 摆在地图上的，
        //一起隐藏就等于「点了据点，人全没了」）。归属按标记创建时记下的 `cityId` 判，
        //不用 `pos` 反推：同格可能站着别城的角色。
        //隐藏 = active false ⇒ 同一帧内不可点（hitAreas 按 active 过滤）、不进可见城池上报
        //（`reportVisibleCamps`），聚焦解除后由 refresh → cullMarkers 恢复。
        const focus = this.focusedCityHexId;
        const focusedCityId = focus >= 0 && this.data
            ? Array.from(this.data.cities.values()).find((city) => city.hexId === focus)?.cityId ?? 0
            : 0;
        for (const marker of this.markers) {
            if (focus >= 0 && !this.isMarkerInFocus(marker, focus, focusedCityId)) {
                marker.node.active = false;
                continue;
            }
            const hitArea = marker.view.hitArea;
            //名条已挪到建筑下方（`badgeY` 为负），裁剪余量要同时吃上下两头：
            //上 = 建筑顶（主城还要算头像），下 = 名条底。只算一头会让贴边的标记提前消失。
            const iconTop = (hitArea.iconY ?? 0) + (hitArea.height ?? 0) / 2;
            const plateBottom = (hitArea.badgeY ?? 0) - (hitArea.badgeHeight ?? 30) / 2;
            const halfHeight = this.viewportTransform.height / 2 + Math.max(150, iconTop, -plateBottom) * this.zoom;
            marker.node.active = Math.abs(marker.node.position.x * this.zoom + position.x) < halfWidth
                && Math.abs(marker.node.position.y * this.zoom + position.y) < halfHeight;
        }
    }

    / 聚焦态下这条标记该不该留：选中城本体 + 选中城名单里的玩家。 */
    private isMarkerInFocus(marker: IWorldMarker, focusHexId: number, focusedCityId: number): boolean {
        if (marker.kind === 'city') return marker.hexId === focusHexId;
        return marker.kind === 'role' && focusedCityId > 0 && marker.cityId === focusedCityId;
    }

    / 平移和缩放共用入口，同步可见地块；没有逐帧重建。 */
    private applyCamera(scale: number, x: number, y: number): void {
        this.zoom = scale;
        this.content.setScale(scale, scale, 1);
        this.content.setPosition(x, y, 0);
        this.syncBackground();
        this.syncVisibleTiles();
        this.cullMarkers();
        this.queueCampRefresh();
    }

    private queueCampRefresh(): void {
        if (this.campRefreshTimer !== null) clearTimeout(this.campRefreshTimer);
        this.campRefreshTimer = setTimeout(() => {
            this.campRefreshTimer = null;
            this.reportVisibleCamps();
        }, 150);
    }

    private reportVisibleCamps(): void {
        if (!this.isValid || !this.node.activeInHierarchy || !this.data) return;
        const ids = this.markers.filter((marker) => marker.kind === 'city' && marker.node.active)
            .map((marker) => Number(marker.id));
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'visibleCamps', campIds: ids } });
    }

    protected onEnable(): void {
        this.queueCampRefresh();
    }

    protected onDisable(): void {
        if (this.campRefreshTimer !== null) clearTimeout(this.campRefreshTimer);
        this.campRefreshTimer = null;
    }

    protected onDestroy(): void {
        this.onDisable();
        //子节点的事件处理器此时已被引擎销毁，不再对它们调用 off。
        if (this.templateRoot) {
            this.templateRoot.destroy();
            this.templateRoot = null;
        }
    }

    resetCamera(): void {
        if (!this.data) return;
        //绝对重定位 ⇒ 之前为城池聚焦抬过的那段已被覆盖，标记作废，免得解除选中时再落一次。
        this.liftedFocusHexId = -1;
        const base = this.centerOf(this.data.playerBaseHexId);
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

    /
     *把某格挪到视口中央（`-100` = 略低于正中，给顶部 HUD 留位）。
     *
     *城池据点额外上抬 `BIGMAP_FOCUSED_CITY_LIFT`（2026-11-11：抬的是相机，背景跟着一起动）。
     *只有「这一格正是当前选中的城池」才抬 ⇒「回家」（选中的是玩家基地、没有城池选中态）
     *和野怪定位都不抬，口径与 `focusedCityHexId` 完全一致。
     */
    focusOn(hexId: number): void {
        this.centerOnHex(hexId, hexId === this.focusedCityHexId ? BIGMAP_FOCUSED_CITY_LIFT : 0);
    }

    / 相机绝对定位到某格：`lift > 0` 时额外上抬（屏幕位移 = `lift * zoom`）。 */
    private centerOnHex(hexId: number, lift: number): void {
        const center = this.centerOf(hexId);
        this.applyCamera(this.zoom, -center.x * this.zoom, -center.y * this.zoom - 100 + lift * this.zoom);
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
            ...marker.view.hitArea,
        }));
        const markerHex = pickBigMapMarker(this.layout, hitAreas, x, y);
        const hexId = markerHex >= 0 ? markerHex : this.pickHexAt(new Vec2(x, y));
        if (hexId < 0) return;
        this.selectedHexId = hexId;
        this.refresh();
        EventMgr.instance.emit(BigMapUiEvent.Intent, { intent: { kind: 'worldTap', hexId } });
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
        return this.data
            ? bigMapOccupantOf(this.data.world, hexId, this.data.playerBaseHexId)
            : { kind: 'empty' as const };
    }
}
