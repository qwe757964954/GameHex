import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';
import type { ZCCombatTarget, ZCProjectileState, ZCUnitState } from '../ZCGameTypes';
import type { IZCModelServices } from './ZCModelServices';

interface Point { x: number; y: number }

export interface ZCProjectileContext extends Pick<IZCModelServices, 'effectiveDefinition'> {
    now: number;
    units: readonly ZCUnitState[];
    distanceScale: number;
    /**
     * 本轮扫掠段（`from…to`）可能碰到的墙体/建筑，写进 `out`（调用方每轮清空）。
     * 一帧可能跨格，给多个候选，谁先被碰到由命中比例 `t` 最小者决定。
    */
    structureTargets(
        projectile: ZCProjectileState,
        fromX: number, fromY: number, toX: number, toY: number,
        out: ZCCombatTarget[],
    ): void;
    hit(projectile: ZCProjectileState, target: ZCCombatTarget): void;
    /**
     * 弹道本帧扫掠段「穿过」了一个己方单位（2026-11-17 急冻瓜「贯穿滋养」102401）。
     *
     * 与 `hit` 是两条互斥的通道：友军不参与碰撞、不消耗穿透次数、不扣伤害，
     * 只是被路过一次。额度（`allyHealLeft`）与去重（`allyHealIds`）已经由本系统扣好/记好，
     * 回调只负责「真的把血加上去」。不传 ⇒ 这条弹道对友军完全透明（存量行为）。
    */
    allyPass?(projectile: ZCProjectileState, unit: ZCUnitState): void;
    /**
     * 弹道本帧消失（命中或被丢弃）时的回调；可选，目前用于定格光束与导弹爆炸。*/
    linger?(projectile: ZCProjectileState): void;
    /**
     * 弹体**飞到落点**那一刻的回调（2026-11-18 第 16 批「连射导弹」101304）。
     *
     * 与 `hit` 的分工：`hit` 是「半路撞到谁就结算给谁」，这个只给
     * `ignoresMidAirCollision` 的弹体用 —— 它整段不碰撞，只在 `startedAt + durationSeconds`
     * 的那一刻落在 `to` 上，由调用方在落点做范围结算。
     * 不传 ⇒ 到点即消失（存量「打空续飞」逐字不变）。
    */
    arrive?(projectile: ZCProjectileState): void;
}

/** 线段扫掠圆：返回第一次接触的位置比例，双方重叠时为 0。保留原导出签名给 ZCUnitTargeting 与测试用。*/
export function sweptCircleHit(from: Point, to: Point, center: Point, radius: number): number | null {
    return sweptCircleHitScalars(to.x - from.x, to.y - from.y, from.x - center.x, from.y - center.y, radius);
}

/**
 * 零分配标量版：热路径直接调用，避免每个候选新建 3 个 Point。
 * 运算顺序与 `sweptCircleHit` 一致，保证浮点结果不变。
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

/** 每局独占；空间网格先过滤候选，再做双方相对运动的连续碰撞。*/
export class ZCProjectileSystem {
    private step = 0;
    private readonly starts = new Map<number, Point & { step: number }>();
    /** 数值 key（zigzag + Cantor 配对，单射），替代原来的 `${x}:${y}` 字符串。*/
    private readonly cells = new Map<number, ZCUnitState[]>();
    /** 空桶回收池：每帧把上一帧的桶还回来复用，Map 只保留本帧活跃格子。*/
    private readonly bucketPool: ZCUnitState[][] = [];
    private readonly candidates = new Set<ZCUnitState>();
    /** 每弹道复用，替代 `new Set(projectile.hitUnitIds ?? [])`。*/
    private readonly hitIds = new Set<number>();
    /** 每弹道复用：这颗弹道已经治疗过的友军（`projectile.allyHealIds` 的临时镜像）。*/
    private readonly allyIds = new Set<number>();
    private readonly wideUnits: ZCUnitState[] = [];
    /** 每轮复用的结构候选（墙体 / 建筑），由 `context.structureTargets` 填。*/
    private readonly structures: ZCCombatTarget[] = [];
    private readonly cellSize = HEX_GRID_LOGICAL_ROW_STEP;

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
        // 原来的实现只清空桶、不删 key，格子 key 会随单位移动无界增长；这里清空 Map 并回收桶。
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

            //  ── 只走落点引爆的弹体（2026-11-18 第 16 批「连射导弹」101304）──
            //  设计原话：「炸弹只有达到落点才会爆炸，行径过程不会提前触碰其他目标」。
            //  所以整段跳过扫掠（单位、墙体、建筑都不收），只按速度推进；
            //  走到 `startedAt + durationSeconds` 那一拍把弹体钉在 `to` 上（`travelDt` 已被
            //  钳到剩余时间，`to` 就是落点），然后交给唯一回收出口 `settleProjectile`
            //  —— 它先 `arrive`（结算落点范围伤害）再 `linger`（爆炸表现）。
            if (projectile.ignoresMidAirCollision === true) {
                projectile.x = to.x; projectile.y = to.y;
                if (context.now + 1e-9 < projectile.startedAt + projectile.durationSeconds) {
                    projectiles[kept++] = projectile;
                } else {
                    this.settleProjectile(projectile, context);
                }
                continue;
            }

            this.candidates.clear();
            const indexed = this.collectCellCandidates(from.x, from.y, to.x, to.y, projectile.collisionRadius);
            const fallback = indexed ? this.wideUnits : units;
            for (const unit of fallback) this.candidates.add(unit);

            // 复用成员 Set，替代每弹道 new Set(...)（以及 `?? []` 的空数组）。
            this.hitIds.clear();
            const knownIds = projectile.hitUnitIds;
            if (knownIds) for (let i = 0; i < knownIds.length; i++) this.hitIds.add(knownIds[i]);

            const fraction = travelDt / dt; // 与 unit 无关，提到循环外，原来是每候选算一次
            //  ── 穿过己方单位（102401「贯穿滋养」）──
            //  先于敌军扫掠做：友军完全不参与碰撞（不消耗 `remainingPierces`、不改 `baseDamage`），
            //  只是「被路过」一次，给它回一次血并把这一颗弹道的额度减一。
            if (context.allyPass && (projectile.allyHealPct ?? 0) > 0 && (projectile.allyHealLeft ?? 0) > 0) {
                this.healAllySweep(projectile, from, to, fraction, context);
            }
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
                this.structures.length = 0;
                context.structureTargets(projectile, from.x, from.y, to.x, to.y, this.structures);
                for (let index = 0; index < this.structures.length; index += 1) {
                    const structure = this.structures[index];
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
                        const hitUnitIds = projectile.hitUnitIds ?? (projectile.hitUnitIds = []);
                        hitUnitIds.length = 0;
                        for (const id of this.hitIds) hitUnitIds.push(id);
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
                this.settleProjectile(projectile, context);
            }
        }
        projectiles.length = kept;
    }

    /**
     * 弹体的**唯一**回收出口：命中消耗、寿命到点、飞到落点，三条路径都从这里走。
     *
     *  ⚠️ 别在别处再写一遍 `context.arrive?.() / context.linger?.()`：
     *   - 只在「命中 / 到点」两处各写一份的写法，穿透弹会被定格两次、打空的弹会漏掉渐隐；
     *   - 只走落点的弹体（`ignoresMidAirCollision`）到点时必须先 `arrive` 结算再 `linger`，
     *     顺序反了就是「特效先炸、伤害后到」，联机两端还会在这一帧分叉。
     */
    private settleProjectile(projectile: ZCProjectileState, context: ZCProjectileContext): void {
        if (projectile.ignoresMidAirCollision === true) context.arrive?.(projectile);
        context.linger?.(projectile);
    }

    reset(): void {
        this.starts.clear();
        for (const bucket of this.cells.values()) bucket.length = 0;
        this.cells.clear();
        this.bucketPool.length = 0;
        this.candidates.clear();
        this.hitIds.clear();
        this.allyIds.clear();
        this.wideUnits.length = 0;
        this.structures.length = 0;
        this.step = 0;
    }

    /**
     * 一颗弹道本帧扫掠段穿过的己方单位，逐个回血（102401「贯穿滋养」）。
     *
     * 三条约束，缺一条就会跑出设计口径：
     *  · **排除施法者本人**：子弹从自己体内出发，不排除的话每一发都白送一次自愈，
     *    「穿过己方单位」会退化成「普攻自带吸血」；
     *  · **同一颗弹道对同一个单位只回一次**（`allyHealIds` 去重）：穿透弹在友军身上
     *    多帧掠过不能连着回；
     *  · **额度用完立刻停**（`allyHealLeft` 从 3 / 4 / 5 自减到 0）—— 额度是**每颗弹道**的，
     *    多弹幕的每一颗各算各的。
     *
     * 判定与敌军命中用同一套「相对运动连续碰撞」（调用方已把本帧线段算好），
     * 因此「子弹从谁身上擦过去」与「打中谁」是同一个物理口径，不会出现「看着穿过了却没回血」。
    */
    private healAllySweep(projectile: ZCProjectileState, from: Point, to: Point,
        fraction: number, context: ZCProjectileContext): void {
        const pass = context.allyPass;
        if (!pass) return;
        this.allyIds.clear();
        const known = projectile.allyHealIds;
        if (known) for (let i = 0; i < known.length; i++) this.allyIds.add(known[i]);
        let left = projectile.allyHealLeft ?? 0;
        for (const unit of this.candidates) {
            if (left <= 0) break;
            if (unit.owner !== projectile.owner) continue;
            if (unit.id === projectile.sourceUnitId) continue;
            if (unit.hp <= 0 || unit.battleState === 'dead') continue;
            if (this.allyIds.has(unit.id)) continue;
            const definition = context.effectiveDefinition(unit);
            //  与敌军扫掠同一套插值：单位在这一帧内是连续移动的，用帧末位置会让擦边判定偏一格。
            const start = this.starts.get(unit.id);
            const startX = start ? start.x : unit.freeX;
            const startY = start ? start.y : unit.freeY;
            const unitX = startX + (unit.freeX - startX) * fraction;
            const unitY = startY + (unit.freeY - startY) * fraction;
            const contact = sweptCircleHitScalars(
                (to.x - unitX) - (from.x - startX),
                (to.y - unitY) - (from.y - startY),
                from.x - startX,
                from.y - startY,
                projectile.collisionRadius + definition.bodyRadius * context.distanceScale,
            );
            if (contact === null) continue;
            this.allyIds.add(unit.id);
            const ids = projectile.allyHealIds ?? (projectile.allyHealIds = []);
            ids.push(unit.id);
            left -= 1;
            projectile.allyHealLeft = left;
            pass(projectile, unit);
        }
    }

    /** 计算并缓存本帧格子范围；用 4 个标量判断替代 `[...].every(...)` 的临时数组。*/
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

    /** 索引阶段：把单位放进它扫过的每个格子。内联双层循环，零闭包、零字符串。*/
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

    /** 候选阶段：把弹道扫过格子里的单位收进 candidates。桶不存在时直接跳过，不再 `?? []`。*/
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
