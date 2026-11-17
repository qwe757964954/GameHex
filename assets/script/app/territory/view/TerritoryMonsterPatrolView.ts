import { instantiate, Node, Prefab, sp, UITransform } from 'cc';
import { HEX_GRID_CONTENT_LIFT, HEX_GRID_FACE_HEIGHT } from '../../../core/hex/HexGridLayout';
import { TERRITORY_MONSTER_PATROL_STEP_MS, type ITerritoryMonsterPatrol } from '../model/TerritoryMonsterPatrol';
import type { ITerritoryMapLayout } from '../model/TerritoryMapLayout';

interface ITerritoryPatrolVisual {
    readonly node: Node;
    readonly monsterId: number;
    readonly scale: number;
    readonly route: readonly number[];
    readonly startedAt: number;
}

/** 页面持有的巡逻模型展示；资源在章节加载阶段就绪，帧循环只写位置和朝向。 */
export class TerritoryMonsterPatrolView {
    private readonly visuals = new Map<number, ITerritoryPatrolVisual>();
    private map: object | null = null;
    private layout: ITerritoryMapLayout | null = null;

    constructor(private readonly parent: Node) {}

    sync(map: object, layout: ITerritoryMapLayout, patrols: readonly ITerritoryMonsterPatrol[],
        prefabs: ReadonlyMap<number, Prefab>, now: number): void {
        if (this.map !== map) this.clear();
        this.map = map;
        this.layout = layout;
        const seen = new Set<number>();
        for (const patrol of patrols) {
            seen.add(patrol.cellId);
            let visual = this.visuals.get(patrol.cellId);
            if (visual && visual.monsterId !== patrol.monsterId) {
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
                if (!(runtime.height > 0) || !['idle', 'move'].every(name => runtime.animations.some(clip => clip.name === name))) {
                    node.destroy();
                    throw new Error(`[Territory] 巡逻野怪 ${patrol.monsterId} 缺少 idle/move 动画或有效尺寸`);
                }
                const prepare = (child: Node): void => {
                    child.layer = this.parent.layer;
                    if (!child.getComponent(UITransform)) child.addComponent(UITransform);
                    for (const item of child.children) prepare(item);
                };
                prepare(node);
                node.setParent(this.parent);
                const scale = HEX_GRID_FACE_HEIGHT * 0.8 / runtime.height;
                visual = { node, monsterId: patrol.monsterId, scale,
                    route: patrol.route, startedAt: now };
                skeleton.setAnimation(0, patrol.route.length > 1 ? 'move' : 'idle', true);
                this.visuals.set(patrol.cellId, visual);
            }
        }
        for (const [id, visual] of this.visuals) {
            if (seen.has(id)) continue;
            visual.node.destroy();
            this.visuals.delete(id);
        }
        this.step(now);
    }

    step(now: number): void {
        for (const visual of this.visuals.values()) {
            const elapsed = Math.max(0, now - visual.startedAt);
            const index = Math.floor(elapsed / TERRITORY_MONSTER_PATROL_STEP_MS) % visual.route.length;
            const from = this.layout.points.get(visual.route[index]);
            const to = this.layout.points.get(visual.route[(index + 1) % visual.route.length]);
            const progress = elapsed % TERRITORY_MONSTER_PATROL_STEP_MS / TERRITORY_MONSTER_PATROL_STEP_MS;
            visual.node.setPosition(from.x + (to.x - from.x) * progress,
                from.y + (to.y - from.y) * progress + HEX_GRID_CONTENT_LIFT, 0);
            visual.node.setScale(to.x < from.x ? -visual.scale : visual.scale, visual.scale, visual.scale);
        }
    }

    clear(): void {
        for (const visual of this.visuals.values()) visual.node.destroy();
        this.visuals.clear();
        this.map = null;
        this.layout = null;
    }
}
