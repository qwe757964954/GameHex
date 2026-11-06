import type { ZCCombatTarget, ZCProjectileState, ZCUnitState } from '../ZCGameTypes';
import type { IZCModelServices } from './ZCModelServices';

interface Point { x: number; y: number }

export interface ZCProjectileContext extends Pick<IZCModelServices, 'effectiveDefinition'> {
    now: number;
    units: readonly ZCUnitState[];
    distanceScale: number;
    structureTarget(projectile: ZCProjectileState): ZCCombatTarget | null;
    hit(projectile: ZCProjectileState, target: ZCCombatTarget): void;
    /**
     * 这颗弹道**这一帧就要消失**（命中后被丢弃 / 到点没打到东西）时的回调。
     * 可选：不接就与改前逐字一致。目前唯一的消费者是「定格光束」。
     */
    linger?(projectile: ZCProjectileState): void;
}

/** 线段扫掠圆：返回第一次接触的位置比例，双方重叠时为 0。保留原导出签名给 ZCUnitTargeting 与测试用。 */
export function sweptCircleHit(from: Point, to: Point, center: Point, radius: number): number | null {
    return sweptCircleHitScalars(to.x - from.x, to.y - from.y, from.x - center.x, from.y - center.y, radius);
}

/**
 * 零分配标量版：把 3 个 Point 入参摊成 4 个 number。
 * 热路径（每弹道 × 每候选 × 每穿透轮）直接调它，不再每候选新建 3 个对象。
 * 运算顺序与 sweptCircleHit 逐字一致，保证不同帧率下的浮点结果不变。
 */
export function sweptCircleHitScalars(dx: number, dy: number, fx: number, fy: number, radius: number): number | null {
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
    /** 数值 key（zigzag + Cantor 配对，单射），替代原来的 `${x}:${y}` 字符串。 */
    private readonly cells = new Map<number, ZCUnitState[]>();
    /** 空桶回收池：每帧把上一帧的桶还回来复用，Map 只保留本帧活跃格子。 */
    private readonly bucketPool: ZCUnitState[][] = [];
    private readonly candidates = new Set<ZCUnitState>();
    /** 每弹道复用，替代 `new Set(projectile.hitUnitIds ?? [])`。 */
    private readonly hitIds = new Set<number>();
    private readonly wideUnits: ZCUnitState[] = [];
    private readonly cellSize = 42;

    // ---- 每帧/每弹道复用的临时量：只读字段引用，写其内部成员，不产生 GC ----
    private readonly fromPoint: Point = { x: 0, y: 0 };
    private readonly toPoint: Point = { x: 0, y: 0 };
    private boundMinX = 0;
    private boundMaxX = 0;
    private boundMinY = 0;
    private boundMaxY = 0;

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
        if (projectiles.length === 0) return;
        // 手写短路扫描：去掉 `.some(箭头函数)` 每帧一个闭包 + 一次全量遍历。
        let hasActive = false;
        for (let i = 0; i < projectiles.length; i++) {
            if (projectiles[i].startedAt < context.now) { hasActive = true; break; }
        }
        if (!hasActive) return;

        this.wideUnits.length = 0;
        // 【泄漏修复】原实现只 `bucket.length = 0`、从不删 key：格子 key 随单位移动单调累积，
        // 长对局里 cells 无界增长，且每帧还要遍历全部历史桶。这里清空 Map + 桶回池复用。
        for (const bucket of this.cells.values()) {
            bucket.length = 0;
            this.bucketPool.push(bucket);
        }
        this.cells.clear();

        const units = context.units;
        for (const unit of units) {
            if (unit.hp <= 0 || unit.battleState === 'dead') continue;
            const start = this.starts.get(unit.id);
            const startX = start ? start.x : unit.freeX;
            const startY = start ? start.y : unit.freeY;
            const radius = context.effectiveDefinition(unit).bodyRadius * context.distanceScale;
            if (!this.indexUnitCells(unit, startX, startY, unit.freeX, unit.freeY, radius)) {
                this.wideUnits.push(unit);
            }
        }

        let kept = 0;
        for (const projectile of projectiles) {
            // 出手发生在当前步的末端，新子弹从下一逻辑步开始飞行。
            if (projectile.startedAt >= context.now) { projectiles[kept++] = projectile; continue; }
            const travelDt = Math.max(0, Math.min(dt, projectile.startedAt + projectile.durationSeconds - (context.now - dt)));
            const from = this.fromPoint;
            const to = this.toPoint;
            from.x = projectile.x; from.y = projectile.y;
            to.x = from.x + projectile.velocityX * travelDt;
            to.y = from.y + projectile.velocityY * travelDt;
            projectile.previousX = from.x; projectile.previousY = from.y;

            this.candidates.clear();
            const indexed = this.collectCellCandidates(from.x, from.y, to.x, to.y, projectile.collisionRadius);
            const fallback = indexed ? this.wideUnits : units;
            for (const unit of fallback) this.candidates.add(unit);

            // 复用成员 Set，替代每弹道 new Set(...)（以及 `?? []` 的空数组）。
            this.hitIds.clear();
            const knownIds = projectile.hitUnitIds;
            if (knownIds) for (let i = 0; i < knownIds.length; i++) this.hitIds.add(knownIds[i]);

            const fraction = travelDt / dt; // 与 unit 无关，提到循环外，原来是每候选算一次
            let passed = 0;
            let consumed = false;
            // 穿透只消耗命中名额；本拍剩余的飞行段仍须结算，最后一拍也不能跳过。
            while (true) {
                // 循环里只记标量/引用，最终命中时再构造一次 target 对象。
                // 原实现每找到一个更优候选就 new 一个 target，绝大多数立刻被丢弃。
                let first = Infinity;
                let bestId = Infinity;
                let bestUnit: ZCUnitState | null = null;
                let bestBodyRadius = 0;

                for (const unit of this.candidates) {
                    if (unit.owner === projectile.owner || unit.hp <= 0 || unit.battleState === 'dead') continue;
                    if (this.hitIds.has(unit.id)) continue;
                    const definition = context.effectiveDefinition(unit);
                    if (definition.flying && !projectile.canHitAir) continue;
                    const start = this.starts.get(unit.id);
                    const startX = start ? start.x : unit.freeX;
                    const startY = start ? start.y : unit.freeY;
                    const unitX = startX + (unit.freeX - startX) * fraction;
                    const unitY = startY + (unit.freeY - startY) * fraction;
                    const t = sweptCircleHitScalars(
                        (to.x - unitX) - (from.x - startX),
                        (to.y - unitY) - (from.y - startY),
                        from.x - startX,
                        from.y - startY,
                        projectile.collisionRadius + definition.bodyRadius * context.distanceScale,
                    );
                    if (t !== null && t >= passed && (t < first || (t === first && unit.id < bestId))) {
                        first = t;
                        bestId = unit.id;
                        bestUnit = unit;
                        bestBodyRadius = definition.bodyRadius;
                    }
                }

                let target: ZCCombatTarget | null = null;
                if (bestUnit) {
                    target = {
                        kind: 'unit', id: bestUnit.id, x: bestUnit.freeX, y: bestUnit.freeY,
                        bodyRadius: bestBodyRadius, cardId: bestUnit.cardId,
                    };
                }
                // 保留每轮重新查询：hit 可能破墙，结构目标会在同拍内变化，不能提到 while 外。
                const structure = context.structureTarget(projectile);
                if (structure) {
                    const t = sweptCircleHitScalars(
                        to.x - from.x, to.y - from.y,
                        from.x - structure.x, from.y - structure.y,
                        projectile.collisionRadius + structure.bodyRadius * context.distanceScale,
                    );
                    if (t !== null && t >= passed && t < first) { first = t; target = structure; }
                }

                if (target) {
                    //  2026-11-03 表现：光柱/弹体末端落到目标模型中心，而不是边界接触点。
                    projectile.x = target.x;
                    projectile.y = target.y;
                    context.hit(projectile, target);
                    if (target.kind === 'unit' && (projectile.remainingPierces ?? 0) > 0) {
                        this.hitIds.add(target.id);
                        projectile.hitUnitIds = [...this.hitIds];
                        projectile.remainingPierces = Math.max(0, (projectile.remainingPierces ?? 0) - 1);
                        //  穿透衰减（2026-10-30 玉林好汉「精英猎手」：每穿一人伤害 -20%）。
                        const falloff = projectile.pierceFalloff ?? 0;
                        if (falloff > 0) {
                            projectile.baseDamage *= Math.max(0, 1 - Math.min(1, falloff));
                        }
                        passed = first;
                    } else {
                        consumed = true;
                        break;
                    }
                } else {
                    projectile.x = to.x; projectile.y = to.y;
                    break;
                }
            }
            if (!consumed && context.now + 1e-9 < projectile.startedAt + projectile.durationSeconds) {
                projectiles[kept++] = projectile;
            } else {
                context.linger?.(projectile);
            }
        }
        projectiles.length = kept;
    }

    reset(): void {
        this.starts.clear();
        for (const bucket of this.cells.values()) bucket.length = 0;
        this.cells.clear();
        this.bucketPool.length = 0;
        this.candidates.clear();
        this.hitIds.clear();
        this.wideUnits.length = 0;
        this.step = 0;
    }

    /** 计算并缓存本帧格子范围；用 4 个标量判断替代 `[...].every(...)` 的临时数组。 */
    private cellBounds(x1: number, y1: number, x2: number, y2: number, radius: number): boolean {
        const minX = Math.floor((Math.min(x1, x2) - radius) / this.cellSize);
        const maxX = Math.floor((Math.max(x1, x2) + radius) / this.cellSize);
        const minY = Math.floor((Math.min(y1, y2) - radius) / this.cellSize);
        const maxY = Math.floor((Math.max(y1, y2) + radius) / this.cellSize);
        if (!Number.isSafeInteger(minX) || !Number.isSafeInteger(maxX)
            || !Number.isSafeInteger(minY) || !Number.isSafeInteger(maxY)) return false;
        if ((maxX - minX + 1) * (maxY - minY + 1) > 4096) return false;
        // 位打包要求格坐标落在 int16 内；越界则回退成全量候选（命中结果与索引路径一致）。
        if (minX < -32768 || maxX > 32767 || minY < -32768 || maxY > 32767) return false;
        this.boundMinX = minX; this.boundMaxX = maxX;
        this.boundMinY = minY; this.boundMaxY = maxY;
        return true;
    }

    /**
     * 两个 int16 格坐标打包进一个 int32：结果恒为 V8 小整数（Smi），不产生堆对象。
     * 用位运算而非算术乘除，避免 `/` 结果被装箱成 HeapNumber 反而制造 GC 垃圾。
     */
    private cellKey(x: number, y: number): number {
        return ((x & 0xffff) << 16) | (y & 0xffff);
    }

    /** 索引阶段：把单位放进它扫过的每个格子。内联双层循环，零闭包、零字符串。 */
    private indexUnitCells(unit: ZCUnitState, x1: number, y1: number, x2: number, y2: number, radius: number): boolean {
        if (!this.cellBounds(x1, y1, x2, y2, radius)) return false;
        for (let x = this.boundMinX; x <= this.boundMaxX; x++) {
            for (let y = this.boundMinY; y <= this.boundMaxY; y++) {
                const key = this.cellKey(x, y);
                let bucket = this.cells.get(key);
                if (!bucket) {
                    bucket = this.bucketPool.pop();
                    if (!bucket) bucket = [];
                    this.cells.set(key, bucket);
                }
                bucket.push(unit);
            }
        }
        return true;
    }

    /** 候选阶段：把弹道扫过格子里的单位收进 candidates。桶不存在时直接跳过，不再 `?? []`。 */
    private collectCellCandidates(x1: number, y1: number, x2: number, y2: number, radius: number): boolean {
        if (!this.cellBounds(x1, y1, x2, y2, radius)) return false;
        for (let x = this.boundMinX; x <= this.boundMaxX; x++) {
            for (let y = this.boundMinY; y <= this.boundMaxY; y++) {
                const bucket = this.cells.get(this.cellKey(x, y));
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) this.candidates.add(bucket[i]);
            }
        }
        return true;
    }
}
