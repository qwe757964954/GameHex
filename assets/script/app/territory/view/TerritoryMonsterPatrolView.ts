import { Color, instantiate, Node, Prefab, sp, UITransform } from 'cc';
import type { Material } from 'cc';
import { HEX_GRID_CONTENT_LIFT, HEX_GRID_FACE_HEIGHT } from '../../../core/hex/HexGridLayout';
import {
    TERRITORY_MONSTER_PATROL_STEP_MS,
    TERRITORY_PATROL_DIM_RGB,
    TERRITORY_PATROL_EDGE_RGB,
    TERRITORY_PATROL_OUTLINE_SCALE,
    type ITerritoryMonsterPatrol,
} from '../model/TerritoryMonsterPatrol';
import type { ITerritoryMapLayout } from '../model/TerritoryMapLayout';

/**
 * 「没挑战成功」的暗色叠加：与 `ZCUnitView.OTHER_PLAYER_TINT` 同源的 `#828282`。
 * 走 `sp.Skeleton.color`（顶点色相乘），不是给节点盖一层黑 Sprite —— 后者会把
 * 怪外面的透明区域也涂黑，读成一块黑板而不是「这只怪暗下来了」。
 */
const PATROL_DIM = new Color(
    TERRITORY_PATROL_DIM_RGB[0], TERRITORY_PATROL_DIM_RGB[1], TERRITORY_PATROL_DIM_RGB[2], 255);
/** 已挑战成功 / 正常态：原色。每次 sync 都写绝对值，不依赖「建节点时染过一次」。 */
const PATROL_NORMAL = new Color(255, 255, 255, 255);
/** 描边副本染红：与 `ZC_CLIENT_COLORS.enemyEdge` 同源。 */
const PATROL_EDGE = new Color(
    TERRITORY_PATROL_EDGE_RGB[0], TERRITORY_PATROL_EDGE_RGB[1], TERRITORY_PATROL_EDGE_RGB[2], 255);

/** 「整体外轮廓」放大副本：同一份 prefab 的第二个实例，挂 `unit-outline-copy` shader。 */
interface ITerritoryPatrolOutline {
    readonly node: Node;
    readonly skeleton: sp.Skeleton;
}

interface ITerritoryPatrolVisual {
    readonly node: Node;
    readonly skeleton: sp.Skeleton;
    readonly outline: ITerritoryPatrolOutline | null;
    readonly monsterId: number;
    /** `monsterCard.prefabSize`（体型系数），建节点时按它算 `scale`；同一只怪不会中途变。 */
    readonly prefabSize: number;
    readonly scale: number;
    readonly route: readonly number[];
    readonly startedAt: number;
}

/** 由页面把「发布帧」的表现参数一次传进来；老调用方不传 = 不描边、无已通过片区、体型按 1。 */
export interface ITerritoryPatrolRenderOptions {
    /** `null` = shader 没加载到 ⇒ 只压暗、不画描边（别退化成一只放大的红怪）。 */
    readonly outlineMaterial?: Material | null;
    /**
     * 巡逻野怪的体型系数（`monsterCard.prefabSize`，键 = `monsterCard.id`）。
     *
     * 缺项 ⇒ 1。它与 `HEX_GRID_FACE_HEIGHT / runtime.height` 的技术归一是**相乘**关系
     * （同 `ZCUnitView.applyVisualSize`）：归一负责「塞进格子」，它负责「策划要多大」。
     */
    readonly prefabSizes?: ReadonlyMap<number, number>;
    /** 巡逻区「已挑战成功」的格子；命中的怪取消暗色与红描边。 */
    readonly clearedCells?: ReadonlySet<number>;
}

/** 页面持有的巡逻模型展示；资源在章节加载阶段就绪，帧循环只写位置和朝向。 */
export class TerritoryMonsterPatrolView {
    private readonly visuals = new Map<number, ITerritoryPatrolVisual>();
    private map: object | null = null;
    private layout: ITerritoryMapLayout | null = null;

    constructor(private readonly parent: Node) {}

    sync(map: object, layout: ITerritoryMapLayout, patrols: readonly ITerritoryMonsterPatrol[],
        prefabs: ReadonlyMap<number, Prefab>, now: number,
        options: ITerritoryPatrolRenderOptions = {}): void {
        if (this.map !== map) this.clear();
        this.map = map;
        this.layout = layout;
        const clearedCells = options.clearedCells;
        const material = options.outlineMaterial ?? null;
        const prefabSizes = options.prefabSizes;
        const seen = new Set<number>();
        for (const patrol of patrols) {
            seen.add(patrol.cellId);
            const prefabSize = prefabSizes?.get(patrol.monsterId) ?? 1;
            let visual = this.visuals.get(patrol.cellId);
            // 体型系数也参与「能不能复用」：同一格换成另一只怪要重建，
            // 同一只怪但表里改了 prefabSize（热更 / 重新发布章节）同样要按新值长。
            if (visual && (visual.monsterId !== patrol.monsterId || visual.prefabSize !== prefabSize)) {
                visual.node.destroy();
                this.visuals.delete(patrol.cellId);
                visual = undefined;
            }
            if (!visual) {
                const prefab = prefabs.get(patrol.monsterId);
                if (!prefab) continue;
                const node = instantiate(prefab);
                const skeleton = node.getComponentInChildren(sp.Skeleton);
                if (!skeleton || !skeleton.skeletonData) {
                    node.destroy();
                    throw new Error(`[Territory] 巡逻野怪 ${patrol.monsterId} 缺少骨骼`);
                }
                const runtime = skeleton.skeletonData.getRuntimeData(true);
                let hasIdle = false;
                let hasMove = false;
                if (runtime && runtime.animations) {
                    for (let i = 0; i < runtime.animations.length; i++) {
                        const name = runtime.animations[i].name;
                        if (name === 'idle') hasIdle = true;
                        else if (name === 'move') hasMove = true;
                    }
                }
                if (!(runtime.height > 0) || !hasIdle || !hasMove) {
                    node.destroy();
                    throw new Error(`[Territory] 巡逻野怪 ${patrol.monsterId} 缺少 idle/move 动画或有效尺寸`);
                }
                this.prepare(node);
                node.setParent(this.parent);
                // 技术归一（塞进六边格）之后再乘策划的体型系数 —— 顺序不能反：
                // 反了等于让「格子多大」跟着美术体量走，巨型怪的格子会撑爆。
                const scale = HEX_GRID_FACE_HEIGHT * 0.8 / runtime.height * prefabSize;
                const clip = patrol.route.length > 1 ? 'move' : 'idle';
                skeleton.setAnimation(0, clip, true);
                visual = {
                    node, skeleton, monsterId: patrol.monsterId, prefabSize, scale,
                    outline: this.attachOutline(node, prefab, material, clip),
                    route: patrol.route, startedAt: now,
                };
                this.visuals.set(patrol.cellId, visual);
            }
            // 未通关为暗色与红描边，通关后恢复原色并收起副本轮廓；全量写回防状态残留。
            this.applyLook(visual, clearedCells?.has(patrol.cellId) ?? false);
        }
        for (const [id, visual] of this.visuals) {
            if (seen.has(id)) continue;
            visual.node.destroy();
            this.visuals.delete(id);
        }
        this.step(now);
    }

    /** 每个子节点都要有 UITransform，否则 spine 在 UI 层不渲染（怪物 prefab 未必带）。 */
    private prepare(child: Node): void {
        child.layer = this.parent.layer;
        if (!child.getComponent(UITransform)) child.addComponent(UITransform);
        for (const item of child.children) this.prepare(item);
    }

    /**
     * 建「整体外轮廓」副本 —— 与 `ZCUnitView.attachOutlineCopy` 同一形式：
     * 同一份 prefab 的第二个实例、放大 1.08、只画不透明像素、排在本体后面。
     *
     * 子序：Cocos 2D 按树深度优先画，副本插到本体子节点第 0 位 ⇒ 先画副本、
     * 后画原骨架，大出来的那一圈才是「边」；顺序反了整只怪会变成一个红色块。
     */
    private attachOutline(
        node: Node, prefab: Prefab, material: Material | null, clip: string,
    ): ITerritoryPatrolOutline | null {
        if (!material) return null;
        const copy = instantiate(prefab);
        const skeleton = copy.getComponentInChildren(sp.Skeleton);
        if (!skeleton) {
            copy.destroy();
            return null;
        }
        this.prepare(copy);
        copy.setParent(node);
        copy.setSiblingIndex(0);
        copy.setPosition(0, 0, 0);
        copy.setScale(TERRITORY_PATROL_OUTLINE_SCALE, TERRITORY_PATROL_OUTLINE_SCALE, 1);
        skeleton.customMaterial = material;
        // shader 按预乘口径输出（见 effect 顶部注释）；钉死，别依赖美术 prefab 上的勾选。
        skeleton.premultipliedAlpha = true;
        skeleton.color = PATROL_EDGE;
        skeleton.setAnimation(0, clip, true);
        return { node: copy, skeleton };
    }

    private applyLook(visual: ITerritoryPatrolVisual, cleared: boolean): void {
        visual.skeleton.color = cleared ? PATROL_NORMAL : PATROL_DIM;
        if (visual.outline) visual.outline.node.active = !cleared;
    }

    /** 当前是否有在渲染的巡逻怪（供更新循环判断是否需要推进）。 */
    get hasVisuals(): boolean {
        return this.visuals.size > 0;
    }

    step(now: number): void {
        if (this.visuals.size === 0) return;
        for (const visual of this.visuals.values()) {
            const elapsed = Math.max(0, now - visual.startedAt);
            const index = Math.floor(elapsed / TERRITORY_MONSTER_PATROL_STEP_MS) % visual.route.length;
            const from = this.layout.points.get(visual.route[index]);
            const to = this.layout.points.get(visual.route[(index + 1) % visual.route.length]);
            const progress = elapsed % TERRITORY_MONSTER_PATROL_STEP_MS / TERRITORY_MONSTER_PATROL_STEP_MS;
            visual.node.setPosition(from.x + (to.x - from.x) * progress,
                from.y + (to.y - from.y) * progress + HEX_GRID_CONTENT_LIFT, 0);
            visual.node.setScale(to.x < from.x ? -visual.scale : visual.scale, visual.scale, visual.scale);
            // 副本与本体锁相：两套 spine 各自按 dt 推进，隐藏 / 补建过一帧就会错拍，
            // 看起来像「红边慢半拍跟着怪跑」。`getCurrent?.` 兼容骨架尚未起播。
            const outline = visual.outline;
            if (!outline || !outline.node.active) continue;
            const mainEntry = visual.skeleton.getCurrent?.(0);
            const copyEntry = outline.skeleton.getCurrent?.(0);
            if (mainEntry && copyEntry) copyEntry.trackTime = mainEntry.trackTime;
        }
    }

    clear(): void {
        // 副本是本体子节点，destroy 本体时一并收掉，不要在这里再 destroy 一次。
        for (const visual of this.visuals.values()) visual.node.destroy();
        this.visuals.clear();
        this.map = null;
        this.layout = null;
    }
}
