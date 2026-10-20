import { Color, instantiate, Material, Node, Prefab, Sprite, SpriteFrame, UITransform, Vec3, Vec4 } from 'cc';
import { ZCOwner } from '../model/ZCMapConfig';
import type { ZCGameRenderFrame } from '../model/ZCGameRenderFrame';
import {
    shouldRenderWallEdge,
    wallEndpointOwnerKey,
    wallAxisTransform,
    WALL_TILE_EDGES,
    ZCWallGeometry,
    type ZCWallSegmentGeometry,
} from './ZCWallGeometry';

/**
 * Sprite 顶点色 alpha 给 wall-tile.effect 传 2-bit 连接标记：bit0=局部左端、bit1=局部右端。
 * 四个状态正好落在 0/85/170/255，shader 用 `round(alpha * 3)` 无损还原。
 * blue 同样用四档编码墙砖帧槽位；阵营染色保留在 red/green，shader 用 green 还原 blue。
 */
const WALL_JOIN_ALPHA_STEP = 85;
/** 一面墙最多共享几张墙砖图的 UV 变换（材质 uniform 槽位上限）。 */
const WALL_MAX_FRAME_SLOTS = 4;

/** 资源在构造前准备好；墙层和资源的所有权归调用方。 */
export interface IZCWallRendererDeps {
    /** 城墙每格六边几何（地图真源，生命周期由渲染世界管）。 */
    readonly wallGeometry: ZCWallGeometry;
    readonly wallPrefab: Prefab | null;
    readonly wallLayer: Node;
    readonly wallMaterial: Material | null;
    readonly wallFrames: ReadonlyMap<string, SpriteFrame>;
}

type ZCWallState = ZCGameRenderFrame['snapshot']['hexes'][number];

interface ZCVisibleWallSegment {
    wallState: ZCWallState;
    edge: number;
    segment: ZCWallSegmentGeometry;
    startKey: string;
    endKey: string;
}

/**
 * 城墙渲染器：把每个已开发领地的外墙按「砖沿六边形边、全盘按屏幕 y 排序」铺成节点。
 *
 * 墙砖是**渲染派生**的固定下标池（没有对应 model 实体，不参与 ECS 快照对账），所以本类
 * 自己持有 `wallSprites` 节点池，而不是塞进渲染世界的 scene：
 *  - 重绘（terrainRevision 变化）时先把整池 `enabled=false`，再按可见段逐块取/建并启用；
 *  - 多出的池节点保持隐藏；`destroy()` 时显式销毁（墙层由调用方持有，这里不销毁 layer）。
 */
export class ZCWallRenderer {
    /** 墙砖节点池，按可见段下标（y 降序）索引；空洞为 undefined（某段缺 prefab 时不挤位）。 */
    private readonly wallSprites: Array<Sprite | undefined> = [];
    /** 共享材质里每张墙砖图的 UV 变换帧槽（frame → slot）。 */
    private readonly wallFrameIndices = new Map<SpriteFrame, number>();
    private wallRevision = -1;

    constructor(private readonly deps: IZCWallRendererDeps) {}

    /**
     * 重铺城墙。地形版本（`terrainRevision`）没变就直接复用现有节点；耐久减少不触发重绘。
     */
    render(frame: ZCGameRenderFrame): void {
        if (this.wallRevision === frame.terrainRevision) return;
        this.wallRevision = frame.terrainRevision;
        for (const sprite of this.wallSprites) {
            if (sprite) sprite.enabled = false;
        }
        let segmentIndex = 0;
        const visited = new Set<number>();
        const visibleSegments: ZCVisibleWallSegment[] = [];
        const endpointCounts = new Map<string, number>();
        // 城墙沿**格面**的实际六边轮廓走（`ZC_HEX_TOP_VERTICES`，面 123×90 居中上移 12.5），
        // 不沿整图 130×119 的透明画布走。
        for (const state of frame.snapshot.hexes) {
            if (!state.developmentResolved && state.building === 'none') continue;
            if (visited.has(state.id)) continue;
            const connected = new Set(frame.hexesById.get(state.id)?.connectedDevelopedHexIds ?? []);
            for (const id of connected) {
                visited.add(id);
            }
            for (const hexId of connected) {
                const wallState = frame.snapshot.hexes[hexId];
                if (wallState.wallHp <= 0 && !Number.isInteger(wallState.wallBreachedEdge)) continue;
                const geometry = this.deps.wallGeometry.edges(hexId);
                for (let edge = 0; edge < 6; edge += 1) {
                    if (!shouldRenderWallEdge(wallState, edge)) continue;
                    const seg = geometry[edge];
                    if (seg.adjacentId !== null && connected.has(seg.adjacentId)) {
                        const adjacentWall = frame.snapshot.hexes[seg.adjacentId];
                        const adjacentEdge = this.deps.wallGeometry.edges(seg.adjacentId)
                            .findIndex((candidate) => candidate.adjacentId === wallState.id);
                        if (adjacentWall && adjacentEdge >= 0
                            && shouldRenderWallEdge(adjacentWall, adjacentEdge)) {
                            continue;
                        }
                    }
                    // 同阵营领地即使只在一个顶点相接，视觉上仍是一处城墙接缝；
                    // 不同阵营必须隔离，避免把彼此相邻的裸露端错误淡化。
                    const startKey = wallEndpointOwnerKey(wallState.owner, seg.startX, seg.startY);
                    const endKey = wallEndpointOwnerKey(wallState.owner, seg.endX, seg.endY);
                    visibleSegments.push({ wallState, edge, segment: seg, startKey, endKey });
                    endpointCounts.set(startKey, (endpointCounts.get(startKey) ?? 0) + 1);
                    endpointCounts.set(endKey, (endpointCounts.get(endKey) ?? 0) + 1);
                }
            }
        }
        // 城墙遮挡顺序（2026-10-14）：2.5D 俯视下「离镜头更近」= 屏幕更下方 = 世界 y **更小**。
        // 统一按 y **降序**布局（y 大的先画、y 小的后画），于是**越下方的城墙层级越高**，
        // 恒盖住上方的城墙。整盘一起排，不是按格/按簇分段排 —— 跨格的墙才能和格内的墙
        // 用同一条规则，否则「墙环绕一圈」时接角处的上下关系还是随簇遍历顺序漂。
        //
        // 不排会怎样：单格 6 边按 edge 0→5 铺，落点 y 是 edge1 > edge0/edge2 > edge3/edge5 > edge4，
        // 于是顶点 v1(右上，edge0×edge1) 与 v5(右下，edge4×edge5) 是「后画的砖更高」⇒ 上方砖压住
        // 下方砖，另外 4 个顶点却是下方砖压上方砖 —— 表现就是「有的角对齐、有的角带台阶」。
        //  排序必须放在 `endpointCounts` 统计**之后**：接缝判定与顺序无关，但重排会打乱
        // `segmentIndex` 与边的对应关系，所以下面的布局循环只能靠 `segment` 自身的数据算坐标
        //（现在正是如此，`segmentIndex` 仅用于从池里取节点）。
        visibleSegments.sort((a, b) => b.segment.y - a.segment.y);
        for (const { wallState, edge, segment, startKey, endKey } of visibleSegments) {
            const sprite = this.segment(segmentIndex);
            if (!sprite) continue;
            const tile = this.tileForEdge(edge);
            // 图中心相对边中点做法向偏移（让砖顶面中线对齐六边形边），否则砖在边的法向错位。
            sprite.node.setPosition(
                segment.x + (tile?.offsetX ?? 0),
                segment.y + (tile?.offsetY ?? 0),
                0,
            );
            let wallMaterial: Material | null = null;
            let wallFrameIndex = 0;
            if (tile) {
                // 按方向贴专属墙砖：RAW 取原图尺寸再等比缩放（不拉伸，保留斜墙透视）。
                sprite.spriteFrame = tile.frame;
                // shader 的局部 x 由 SpriteFrame.uv 缓存；墙图已有静态 auto-atlas，禁止运行时
                // Dynamic Atlas 再次搬移 UV，既避免端带错位，也不影响现有静态合批。
                tile.frame.packable = false;
                sprite.sizeMode = Sprite.SizeMode.RAW;
                sprite.node.setScale(tile.flip ? -tile.scale : tile.scale, tile.scale, 1);
                sprite.node.angle = tile.angle;
                const preparedFrameIndex = this.prepareMaterialFrame(
                    tile.frame,
                    tile.axisX,
                    tile.axisY,
                    tile.joinProfile,
                );
                if (preparedFrameIndex !== null) {
                    wallMaterial = this.deps.wallMaterial;
                    wallFrameIndex = preparedFrameIndex;
                }
            } else {
                // 墙砖帧缺失：回退 wall prefab 通用墙砖，按边长拉伸 + 旋转。
                sprite.node.setScale(1, 1, 1);
                sprite.node.angle = segment.angle;
                const transform = sprite.getComponent(UITransform);
                transform?.setContentSize(segment.length, transform.height);
            }
            sprite.customMaterial = wallMaterial;
            const startJoined = (endpointCounts.get(startKey) ?? 0) > 1;
            const endJoined = (endpointCounts.get(endKey) ?? 0) > 1;
            let joinMask = 0;
            if (wallMaterial && tile) {
                // shader 的局部 x 正方向经节点旋转/镜像后若与几何 start→end 同向，左/右即 start/end；
                // 反向时交换。这样断墙裸露端不会被误当成接缝淡化。
                const localAxisX = tile.axisX * (tile.flip ? -1 : 1);
                const localAxisY = tile.axisY;
                const localAngle = tile.angle * Math.PI / 180;
                const localX = Math.cos(localAngle) * localAxisX - Math.sin(localAngle) * localAxisY;
                const localY = Math.sin(localAngle) * localAxisX + Math.cos(localAngle) * localAxisY;
                const segmentX = segment.endX - segment.startX;
                const segmentY = segment.endY - segment.startY;
                const isLocalRightAtEnd = localX * segmentX + localY * segmentY >= 0;
                const leftJoined = isLocalRightAtEnd ? startJoined : endJoined;
                const rightJoined = isLocalRightAtEnd ? endJoined : startJoined;
                joinMask = (leftJoined ? 1 : 0) | (rightJoined ? 2 : 0);
            }
            const isEnemyWall = wallState.owner !== ZCOwner.Player && wallState.owner !== 'neutral';
            const greenBlue = isEnemyWall ? 190 : 255;
            sprite.color = new Color(255, greenBlue, wallMaterial
                ? wallFrameIndex * WALL_JOIN_ALPHA_STEP
                : greenBlue, wallMaterial
                ? joinMask * WALL_JOIN_ALPHA_STEP
                : 255);
            // [ZCWall] wall-tile shader 在线时 alpha 是 2-bit 接缝信号（0 也不透明）；
            // 一旦 shader 实际失效/被替换成默认材质，alpha=0 的孤立段会整段消失。
            sprite.enabled = true;
            segmentIndex += 1;
        }
    }

    /**
     * 销毁所有墙砖节点（渲染世界 `destroy()` 时调用）。
     *
     * 墙砖不进 ECS scene，scene 遍历收不到它，必须在这里显式销毁。
     * 墙层容器本身由调用方持有、随 HUD 一起销毁，这里不碰。
     */
    destroy(): void {
        for (const sprite of this.wallSprites) {
            if (sprite?.node.isValid) sprite.node.destroy();
        }
        this.wallSprites.length = 0;
        this.wallFrameIndices.clear();
        this.wallRevision = -1;
    }

    invalidate(): void {
        this.wallRevision = -1;
    }

    /**
     * 解析某条边的墙砖放置（图 + 缩放/镜像/旋转）。wallFrames 未加载或该图缺失时返回 null，
     * 由调用方回退到通用墙砖拉伸。与 resolveBuildingFrame 同一防护，绝不抛错。
     */
    private tileForEdge(edge: number): {
        frame: SpriteFrame;
        scale: number;
        flip: boolean;
        angle: number;
        axisX: number;
        axisY: number;
        offsetX: number;
        offsetY: number;
        joinProfile: readonly [number, number, number, number];
    } | null {
        const spec = WALL_TILE_EDGES[edge];
        const frames = this.deps.wallFrames;
        if (!spec || typeof (frames as { get?: unknown })?.get !== 'function') return null;
        const frame = (frames as ReadonlyMap<string, SpriteFrame>).get(spec.art) ?? null;
        if (!frame) return null;
        return {
            frame,
            scale: spec.scale,
            flip: spec.flip,
            angle: spec.angle,
            axisX: spec.axisX,
            axisY: spec.axisY,
            offsetX: spec.offsetX,
            offsetY: spec.offsetY,
            joinProfile: spec.joinProfile,
        };
    }

    private prepareMaterialFrame(
        frame: SpriteFrame,
        axisX: number,
        axisY: number,
        joinProfile: readonly [number, number, number, number],
    ): number | null {
        const baseMaterial = this.deps.wallMaterial;
        if (!baseMaterial) return null;
        const cached = this.wallFrameIndices.get(frame);
        if (cached !== undefined) return cached;
        if (this.wallFrameIndices.size >= WALL_MAX_FRAME_SLOTS) return null;
        const axisTransform = wallAxisTransform(frame, axisX, axisY);
        if (!axisTransform) return null;
        const index = this.wallFrameIndices.size;
        baseMaterial.setProperty(`wallAxisTransform${index}`, new Vec4(...axisTransform));
        baseMaterial.setProperty(`wallJoinProfile${index}`, new Vec4(...joinProfile));
        this.wallFrameIndices.set(frame, index);
        return index;
    }

    /**
     * 取第 index 块墙砖（复用池节点，没有则按 wallPrefab 实例化并挂到墙层）。
     * wallPrefab / wallLayer 缺失时返回 null（整盘墙都不画，不抛错）。
     */
    private segment(index: number): Sprite | null {
        const existing = this.wallSprites[index];
        if (existing) return existing.node.isValid ? existing : null;
        const prefab = this.deps.wallPrefab;
        const layer = this.deps.wallLayer;
        if (!prefab || !layer) return null;
        const node = instantiate(prefab);
        node.setParent(layer);
        node.layer = layer.layer;
        node.setPosition(Vec3.ZERO);
        node.name = `WallSegment_${index}`;
        const sprite = node.getComponent(Sprite);
        if (!sprite) return null;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        // 用直接下标（而非 push）：某段缺资源失败时不挤占后续下标，避免 index 与边错位。
        this.wallSprites[index] = sprite;
        return sprite;
    }
}
