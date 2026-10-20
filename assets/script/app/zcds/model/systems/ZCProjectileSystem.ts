import type { ZCCombatTarget, ZCProjectileState, ZCUnitState } from '../ZCGameTypes';
import type { ZCUnitDefinition } from '../ZCCombatCatalog';

interface Point { x: number; y: number }
export interface ZCProjectileContext {
    now: number;
    units: readonly ZCUnitState[];
    distanceScale: number;
    effectiveDefinition(unit: ZCUnitState): ZCUnitDefinition;
    structureTarget(projectile: ZCProjectileState): ZCCombatTarget | null;
    hit(projectile: ZCProjectileState, target: ZCCombatTarget): void;
}

/** 线段扫掠圆：返回第一次接触的位置比例，双方重叠时为 0。 */
export function sweptCircleHit(from: Point, to: Point, center: Point, radius: number): number | null {
    const dx = to.x - from.x, dy = to.y - from.y;
    const fx = from.x - center.x, fy = from.y - center.y;
    const c = fx * fx + fy * fy - radius * radius;
    if (c <= 0) return 0;
    const a = dx * dx + dy * dy;
    if (a === 0) return null;
    const b = fx * dx + fy * dy;
    const discriminant = b * b - a * c;
    if (discriminant < 0) return null;
    const t = (-b - Math.sqrt(discriminant)) / a;
    return t >= 0 && t <= 1 ? t : null;
}

/** 每局独占；空间网格先过滤候选，再做双方相对运动的连续碰撞。 */
export class ZCProjectileSystem {
    private step = 0;
    private readonly starts = new Map<number, Point & { step: number }>();
    private readonly cells = new Map<string, ZCUnitState[]>();
    private readonly candidates = new Set<ZCUnitState>();
    private readonly wideUnits: ZCUnitState[] = [];
    private readonly cellSize = 42;

    beginStep(units: readonly ZCUnitState[]): void {
        this.step++;
        for (const unit of units) {
            let start = this.starts.get(unit.id);
            if (!start) { start = { x: 0, y: 0, step: 0 }; this.starts.set(unit.id, start); }
            start.x = unit.freeX; start.y = unit.freeY; start.step = this.step;
        }
        for (const [id, start] of this.starts) if (start.step !== this.step) this.starts.delete(id);
    }

    update(projectiles: ZCProjectileState[], dt: number, context: ZCProjectileContext): void {
        if (!projectiles.length || !projectiles.some(projectile => projectile.startedAt < context.now)) return;
        this.wideUnits.length = 0;
        for (const bucket of this.cells.values()) bucket.length = 0;
        for (const unit of context.units) {
            if (unit.hp <= 0 || unit.battleState === 'dead') continue;
            const start = this.starts.get(unit.id) ?? { x: unit.freeX, y: unit.freeY };
            const radius = context.effectiveDefinition(unit).bodyRadius * context.distanceScale;
            const indexed = this.visitCells(start.x, start.y, unit.freeX, unit.freeY, radius, key => {
                let bucket = this.cells.get(key);
                if (!bucket) { bucket = []; this.cells.set(key, bucket); }
                bucket.push(unit);
            });
            if (!indexed) this.wideUnits.push(unit);
        }
        let kept = 0;
        for (const projectile of projectiles) {
            // 出手发生在当前步的末端，新子弹从下一逻辑步开始飞行。
            if (projectile.startedAt >= context.now) { projectiles[kept++] = projectile; continue; }
            const travelDt = Math.max(0, Math.min(dt, projectile.startedAt + projectile.durationSeconds - (context.now - dt)));
            const from = { x: projectile.x, y: projectile.y };
            const to = { x: from.x + projectile.velocityX * travelDt, y: from.y + projectile.velocityY * travelDt };
            projectile.previousX = from.x; projectile.previousY = from.y;
            this.candidates.clear();
            const indexed = this.visitCells(from.x, from.y, to.x, to.y, projectile.collisionRadius, key => {
                for (const unit of this.cells.get(key) ?? []) this.candidates.add(unit);
            });
            for (const unit of indexed ? this.wideUnits : context.units) this.candidates.add(unit);
            let target: ZCCombatTarget | null = null;
            let first = Infinity;
            const hitUnitIds = new Set(projectile.hitUnitIds ?? []);
            for (const unit of this.candidates) {
                if (unit.owner === projectile.owner || unit.hp <= 0 || unit.battleState === 'dead') continue;
                if (hitUnitIds.has(unit.id)) continue;
                const definition = context.effectiveDefinition(unit);
                if (definition.flying && !projectile.canHitAir) continue;
                const start = this.starts.get(unit.id) ?? { x: unit.freeX, y: unit.freeY };
                const fraction = travelDt / dt;
                const unitX = start.x + (unit.freeX - start.x) * fraction;
                const unitY = start.y + (unit.freeY - start.y) * fraction;
                const t = sweptCircleHit(
                    { x: from.x - start.x, y: from.y - start.y },
                    { x: to.x - unitX, y: to.y - unitY },
                    { x: 0, y: 0 }, projectile.collisionRadius + definition.bodyRadius * context.distanceScale,
                );
                if (t !== null && (t < first || t === first && unit.id < (target?.id ?? Infinity))) {
                    first = t;
                    target = { kind: 'unit', id: unit.id, x: unit.freeX, y: unit.freeY, bodyRadius: definition.bodyRadius, cardId: unit.cardId };
                }
            }
            const structure = context.structureTarget(projectile);
            if (structure) {
                const t = sweptCircleHit(from, to, structure, projectile.collisionRadius + structure.bodyRadius * context.distanceScale);
                if (t !== null && t < first) { first = t; target = structure; }
            }
            if (target) {
                projectile.x = from.x + (to.x - from.x) * first;
                projectile.y = from.y + (to.y - from.y) * first;
                context.hit(projectile, target);
                if (target.kind === 'unit' && (projectile.remainingPierces ?? 0) > 0
                    && context.now + 1e-9 < projectile.startedAt + projectile.durationSeconds) {
                    projectile.hitUnitIds = [...hitUnitIds, target.id];
                    projectile.remainingPierces = Math.max(0, (projectile.remainingPierces ?? 0) - 1);
                    projectiles[kept++] = projectile;
                }
            } else {
                projectile.x = to.x; projectile.y = to.y;
                if (context.now + 1e-9 < projectile.startedAt + projectile.durationSeconds) projectiles[kept++] = projectile;
            }
        }
        projectiles.length = kept;
    }

    reset(): void { this.starts.clear(); this.cells.clear(); this.candidates.clear(); this.wideUnits.length = 0; this.step = 0; }

    private visitCells(x1: number, y1: number, x2: number, y2: number, radius: number, visit: (key: string) => void): boolean {
        const minX = Math.floor((Math.min(x1, x2) - radius) / this.cellSize);
        const maxX = Math.floor((Math.max(x1, x2) + radius) / this.cellSize);
        const minY = Math.floor((Math.min(y1, y2) - radius) / this.cellSize);
        const maxY = Math.floor((Math.max(y1, y2) + radius) / this.cellSize);
        if (![minX, maxX, minY, maxY].every(Number.isSafeInteger) || (maxX - minX + 1) * (maxY - minY + 1) > 4096) return false;
        for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) visit(`${x}:${y}`);
        return true;
    }
}
