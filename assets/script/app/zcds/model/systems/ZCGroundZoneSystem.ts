import type { ZCFloatText, ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCStatusApplyOptions, ZCStatusSystemSnapshot } from '../ZCStatusEffect';
import type { IZCModelServices } from './ZCModelServices';

/** 判定形状只关心这几列，抽出签名好测。*/
type IZCZoneShape = Pick<ZCGroundZoneState,
    'x' | 'y' | 'radius' | 'rectHalfLength' | 'rectHalfHeight' | 'angleDegrees'>;

/**
 * 区域是否覆盖世界坐标 (x, y)：圆用半径，矩形用半长/半宽（rectHalfHeight > 0 才启用）。
 * 有 angleDegrees 时先把点转回区域本地系；旋转只对矩形有意义。
*/
export function zcGroundZoneReaches(zone: IZCZoneShape, x: number, y: number): boolean {
    const halfHeight = zone.rectHalfHeight ?? 0;
    if (halfHeight > 0) {
        const halfLength = (zone.rectHalfLength ?? 0) > 0 ? (zone.rectHalfLength as number) : zone.radius;
        let dx = x - zone.x;
        let dy = y - zone.y;
        const radians = (zone.angleDegrees ?? 0) * Math.PI / 180;
        if (radians !== 0) {
            //  逆时针旋转 `-angle`：cos(-a)=cos a，sin(-a)=-sin a。
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            const localX = dx * cos + dy * sin;
            const localY = -dx * sin + dy * cos;
            dx = localX;
            dy = localY;
        }
        return Math.abs(dx) <= halfLength && Math.abs(dy) <= halfHeight;
    }
    return Math.hypot(zone.x - x, zone.y - y) <= zone.radius;
}

/**
 * 粗筛半径（走格子索引 `unitsInRadius(hexId, radiusHex)` 那一层）。
 *
 * 矩形取外接圆半径：粗筛只负责别漏人，真正的形状由 `zcGroundZoneReaches` 收口。
 * 漏了这一步的话，横向 360 的矩形会被当成半径 180 的圆去筛 —— 正好够用；但 L3 的
 * 半长仍是 `radius`（200）时也对，所以这里是保险而不是必需。
*/
export function zcGroundZoneBroadRadius(zone: IZCZoneShape): number {
    const halfHeight = zone.rectHalfHeight ?? 0;
    if (!(halfHeight > 0)) return zone.radius;
    const halfLength = (zone.rectHalfLength ?? 0) > 0 ? (zone.rectHalfLength as number) : zone.radius;
    return Math.hypot(halfLength, halfHeight);
}

export interface IZCGroundZoneContext extends Pick<IZCModelServices, 'unitPosition' | 'damageUnit'> {
    readonly hexStep: number;
    hexIdAt(x: number, y: number): number | null;
    unitsInRadius(hexId: number, radiusHex: number): ZCUnitState[];
    ensureSlowStatus(id: string, speedPct: number, durationSeconds: number): void;
    applyStatus(unit: ZCUnitState, id: string, options: ZCStatusApplyOptions): void;
    exportStatusEffects(): ZCStatusSystemSnapshot | undefined;
    /**
     * 概率掷骰（0~1，2026-11-11 磁电菇「五雷轰顶」的 30% 麻痹）。
     *
     * 必须用对局种子随机（`services.random`），不能用 `Math.random` —— 否则回放/快照
     * 重算会在同一拍给出不同的控制结果。声明成可选：只跑区域结算的轻量上下文
     * （单测 / 工具）不掷骰，缺省按「没中」处理。
    */
    random?(): number;
    /**
     * 区域伤害的吸血回调：把「源单位 + 这一跳实际掉血」丢回模型，比例与普攻同源。
     * `hitText` 为 damageUnit 返回值（护盾全吃/溢出/已死时为 0 或 null，不回血）。
     * 可选：轻量上下文（单测/工具）可不给，缺了只是不吸血。
    */
    lifestealFromHit?(sourceUnitId: number, hitText: ZCFloatText | null): void;
    /**
     * 按 `unit.id` 取单位（2026-11-07 鹿神守护的两段式移动：接近阶段要追着目标走）。
     *
     * 声明成可选：只跑区域结算的轻量上下文（单测 / 工具）不必凑一个单位索引。
     * 缺了的表现是「追不到目标 ⇒ 就地转冲刺」，不会抛，也不会把区域卡在接近段。
    */
    unitById?(id: number): ZCUnitState | undefined;
    /**
     * 强制位移（世界 px 的增量，2026-11-18 第 17 批 102004 飓风的牵引）。
     *
     * 与 `ZCStatusResolutionSystem` 的那个同名成员是同一条通道（`ZCGameModel.displaceUnit`：
     * 落在不可走格上会减半重试、成功后清掉 `targetHexId` 让单位重新寻路）。
     * 可选：轻量上下文不给 ⇒ 牵引整段不执行。
    */
    displaceUnit?(unit: ZCUnitState, dx: number, dy: number): void;
    /** 表值 → 世界坐标的换算（牵引最小距离 `20 × scale` 要用）。缺省按 1 处理。*/
    combatDistanceScale?: number;
}

/**
 * 赶路档播放的骨架动画名。`魔术师召唤鹿` 骨架只有 idle/move/attack，`move` 就是那段走。
 * 名字写死在这里，因为 skillParamJson 只装数值。
*/
const ZONE_APPROACH_ANIMATION = 'move';
/** 快档（提速扑击）播的骨架动画名（同上）。*/
const ZONE_SPRINT_ANIMATION = 'attack';

/**
 * 换目标时的搜索半径（世界 px，2026-11-12 鹿神守护改追踪弹）。
 *
 * 只在「原目标阵亡 / 丢失」那几帧用一次，结果按 `(格, 半径)` 缓存（`unitsInRadius` 自己缓存），
 * 所以这里可以给得宽松些：600 世界 px = 2000 表值 px ≈ 4.4 个格高，够跨过整条战线。
 * 与 `sprintRange` 取大值 —— 快档转段距离本来就更远时不能被换目标半径卡住。
*/
const ZONE_RETARGET_RANGE = 600;

/**
 * 游走每一段转过的角度（弧度，2026-11-20 S 型口径）。
 *
 * 60° / 段：配合 `wanderTurnSeconds`（配表 1 秒）就是 60°/秒 的转向率，一左一右走成蛇形。
 * 取值口径：太小（< 20°）看着还是直线，太大（> 90°）会绕成圈、走不出位移。
 * 与「固定直线」的区别就在这里 —— 老实现是每段**整段重掷**随机角，画出来是折线。
*/
const ZC_ZONE_WANDER_SWING_RADIANS = Math.PI / 3;

type IZCGroundZoneStepState = Pick<ZCSnapshot,
    'elapsedSeconds' | 'groundZones' | 'combatEvents' | 'nextCombatEventId' | 'statusEffects'>;

/** 持续区域只处理已创建的 zone；模型保留技能出手与创建 zone 的编排。*/
export class ZCGroundZoneSystem {
    static tick(state: IZCGroundZoneStepState, dt: number, context: IZCGroundZoneContext): void {
        const zones = state.groundZones;
        if (!zones.length) return;
        const now = state.elapsedSeconds;
        // 原地压缩（write 索引）复用现有数组，避免每逻辑步新建 keep 数组产生 GC；
        // write 恒 <= read，写入的都是已处理槽位，不会覆盖尚未读取的元素。
        let write = 0;
        for (let read = 0; read < zones.length; read++) {
            const zone = zones[read];
            // 追踪推进：返回 true = 位移由追踪接管，不能再按 moveVelocity 推一遍。
            const chased = this.advanceChase(zone, dt, now, context);
            if (!chased) {
                // 随机游走：换方向后写回 moveVelocity，位移统一在下方推进。
                this.advanceWander(zone, now, context, dt);
                // 移动区域：先推进位置再结算当前波次，避免伤害落后一帧。
                const vx = zone.moveVelocityX ?? 0;
                const vy = zone.moveVelocityY ?? 0;
                if (vx !== 0 || vy !== 0) {
                    zone.x += vx * dt;
                    zone.y += vy * dt;
                }
            }
            // 投掷段到点落地：飞满后归零速度，剩余时间转为原地停留。
            this.settleFlight(state, zone, dt);
            // 读秒：赶路阶段不读秒，提速后才开始读秒。
            const approaching = this.isApproaching(zone);
            if (!approaching) zone.remainingSeconds -= dt;
            // 跟随本体光环：每帧将圆心对齐施法者位置。
            this.followCaster(zone, context);
            // 牵引：在圆心位置确定后计算对周围敌人的牵引位移。
            this.pullEnemies(zone, dt, context);
            // 整段持有视觉：将持续事件同步至新坐标。
            this.syncHoldVisual(state, zone);
            // 触碰触发：敌方踩进 contactRadius 时触发触碰伤害，并在同帧引爆。
            if (this.resolveContact(state, zone, context)) zone.remainingSeconds = 0;
            const maxHits = zone.maxHits ?? 0;
            while (!approaching && zone.wavesLeft > 0 && now >= zone.nextWaveAt) {
                this.resolveWave(state, zone, context);
                zone.wavesLeft -= 1;
                zone.nextWaveAt += zone.waveInterval;
                // 命中名额打满即提前消散。
                if (maxHits > 0 && zone.hitUnitIds && zone.hitUnitIds.length >= maxHits) {
                    zone.remainingSeconds = 0;
                    break;
                }
            }
            if (zone.remainingSeconds > 0.0001) {
                zones[write++] = zone;
            } else {
                // 区域消散：同步清除长效事件，触发到期爆炸表现与结算。
                this.dropHoldVisual(state, zone);
                const detonate = zone.expireRequiresContact !== true || zone.contactTriggered === true;
                if (detonate) this.pushExpireVisual(state, zone);
                if (detonate && (zone.expireDamage ?? 0) > 0) this.resolveExpiry(state, zone, context);
            }
        }
        zones.length = write;
    }

    /**
     * 投掷段读秒（2026-11-18 第 17 批 101704；2026-11-19 加「落地换挡」）：飞满就把速度清零，
     * 原地转成「停留」，并把飞行段的持有表现换成常驻那一份（见下面的 `flightVisualPath`）。
     *
     * 归零 `moveVelocityX/Y` 而不是留一个标记位让 tick 每次都判 —— 位移那一段是
     * 「有速度就推」，清了才是真的停住，也不会在落地后继续每帧算一次乘法。
     * 缺省（`flightSeconds` 未定义 / 已是 0）⇒ 整段不执行，存量区域一次都不碰。
     */
    private static settleFlight(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, dt: number): void {
        const left = zone.flightSeconds;
        if (left === undefined || !(left > 0)) return;
        const next = left - dt;
        //  ── 抛掷弧线（2026-11-20 用户口径「蘑菇爆炸要有弧线飞行落地的过程」）──
        //  位移本身仍是直线（判定 / 触碰都按地面坐标算），弧线只加在**表现**的竖直抬升上：
        //  把 `visualLiftPx` 按抛物线 `4h·p·(1-p)` 每帧刷一次 —— 起飞和落地都是 0、
        //  正中间最高，看起来就是「丢出去、落下来」。
        //  不能直接改 `zone.y`：那是世界坐标，改了接触判定和牵引就全歪了。
        const arc = Math.max(0, zone.flightArcPx ?? 0);
        const total = Math.max(1e-6, zone.flightTotalSeconds ?? 0);
        if (arc > 0) {
            const progress = Math.min(1, Math.max(0, 1 - Math.max(0, next) / total));
            zone.visualLiftPx = Math.round(arc * 4 * progress * (1 - progress));
        }
        if (next > 0.0001) {
            zone.flightSeconds = next;
            return;
        }
        zone.flightSeconds = 0;
        zone.moveVelocityX = 0;
        zone.moveVelocityY = 0;
        //  落地把抬升清掉：留着的话常驻陷阱会飘在半空。
        if (arc > 0) zone.visualLiftPx = undefined;
        //  落地换挡（2026-11-19 蘑菇爆炸 101704）：飞行段播的是「生成」，落地要换成常驻的
        //  「陷阱」。做法是把飞行段那条持有事件**就地摘掉**（`durationSeconds` 压到「已活时长」，
        //  下一拍就到了），再清掉 `visualEventId` —— 紧接着这一帧的 `syncHoldVisual` 会按
        //  `effectPrefabPath` 在新的落点重建一条。视图侧不需要任何「换图」逻辑。
        if (zone.flightVisualPath === undefined && zone.visualEventId === undefined) return;
        const live = zone.visualEventId === undefined
            ? undefined : state.combatEvents.find((event) => event.id === zone.visualEventId);
        if (live) {
            live.durationSeconds = Math.max(0, state.elapsedSeconds - live.startedAt);
        }
        zone.visualEventId = undefined;
        zone.flightVisualPath = undefined;
    }

    /**
     * 追踪推进：两档速度的追踪弹。慢档出生用 approachSpeed + move 动画，不结算；
     * 距目标 ≤ sprintRange 切快档 sprintSpeed + attack 动画，每 waveInterval 结算一波。
     * 每帧重算方向，目标走位不会让弹道飞到空地。
     * 返回 true = 位移已由本方法推进，调用方不要再按 moveVelocity 推第二遍。
    */
    private static advanceChase(
        zone: ZCGroundZoneState,
        dt: number,
        now: number,
        context: IZCGroundZoneContext,
    ): boolean {
        const slowSpeed = Math.max(0, zone.approachSpeed ?? 0);
        if (!(slowSpeed > 0)) return false;
        //  赶路段已耗时（2026-11-20 102004 飓风）：落地时按「总时长含赶路」从剩余寿命里扣，
        //  见 `releaseToWander`。只累计真在追的帧 ⇒ 中途没追就不该算它。
        zone.approachSeconds = (zone.approachSeconds ?? 0) + dt;
        //  兜底：赶路已经耗尽整段寿命 ⇒ 当场落地（扣完就散场）。不设这道闸的话，
        //  「目标一直在跑、追不上」会让这片风永远在飞、永远不读秒 —— 一片不散场也不打人的风。
        if (zone.arriveWander === true && zone.approachSeconds >= zone.remainingSeconds) {
            this.releaseToWander(zone, now);
            return false;
        }

        // 目标：原目标存活则继续追踪，失效则重选最近敌人。
        let target: ZCUnitState | undefined;
        if (zone.approachTargetId !== undefined && context.unitById) {
            target = context.unitById(zone.approachTargetId);
        }
        if (!this.isChaseable(target)) {
            target = this.nearestChaseTarget(zone, context);
            zone.approachTargetId = target ? target.id : undefined;
        }
        //  最后已知落点（2026-11-20 第 31 批）：目标活着的每一帧刷一次。目标全丢之后
        //  就靠它继续飞 —— 用户口径「没有目标继续往旧的目标坐标移动，不会静止」。
        if (target) {
            const known = context.unitPosition(target);
            zone.chaseGoalX = known.x;
            zone.chaseGoalY = known.y;
        }

        // 档位：切快档只发生一次，之后 sprinting 恒为 true。
        let fast = zone.sprinting === true;
        zone.visualAnimation = fast ? ZONE_SPRINT_ANIMATION : ZONE_APPROACH_ANIMATION;

        if (!target) {
            //  ── 没有可追的活目标（2026-11-20 第 31 批）──
            //  口径：「锁定目标 → 移动 → 目标丢失 → 切换目标 → 没有目标继续往**旧的目标坐标**
            //  移动，不会静止」。换目标已由上面的 `nearestChaseTarget` 做过；这里负责最后一段：
            //  先朝 `chaseGoalX/Y`（最后已知坐标）飞，飞到了才按车道收尾。
            const goalX = zone.chaseGoalX;
            const goalY = zone.chaseGoalY;
            //  🔴 速度必须有兜底：飓风的投送段只配了 `approachSpeed`、没有 `sprintSpeed`，
            //  老代码在这里取 `sprintSpeed ?? 0` ⇒ 整片风定在原地「不会动」。
            const chaseSpeed = Math.max(0, zone.sprintSpeed ?? 0) || slowSpeed;
            const goalDx = goalX === undefined ? 0 : goalX - zone.x;
            const goalDy = goalY === undefined ? 0 : goalY - zone.y;
            const goalDistance = Math.hypot(goalDx, goalDy);
            if (goalX !== undefined && goalY !== undefined
                && goalDistance > Math.max(0, zone.sprintRange ?? 0)) {
                //  还在飞往旧坐标：位移归追踪段。带 `arriveWander` 的车道（飓风）此时**不**提速、
                //  也不读秒 —— 它还在路上，读秒会把「含赶路共 N 秒」的账提前花掉。
                if (zone.arriveWander !== true && !fast) {
                    fast = true;
                    this.enterSprint(zone, now);
                    zone.visualAnimation = ZONE_SPRINT_ANIMATION;
                }
                const nx = goalDx / goalDistance;
                const ny = goalDy / goalDistance;
                const step = Math.min(chaseSpeed * dt, goalDistance);
                zone.moveVelocityX = nx * chaseSpeed;
                zone.moveVelocityY = ny * chaseSpeed;
                zone.x += nx * step;
                zone.y += ny * step;
                return true;
            }
            //  到点交还（2026-11-20 102004 飓风）：目标半路死光不该让风定在半空 ——
            //  交给随机游走，落地照样打完剩下的波次。
            if (zone.arriveWander === true) {
                this.releaseToWander(zone, now);
                return false;
            }
            //  连最后坐标都没有（出生就没目标）或已经飞到旧坐标：沿当前速度方向继续移动直至自然到期。
            const vx = zone.moveVelocityX ?? 0;
            const vy = zone.moveVelocityY ?? 0;
            const length = Math.hypot(vx, vy);
            const dirX = length > 1e-9 ? vx / length : 1;
            const dirY = length > 1e-9 ? vy / length : 0;
            if (!fast) {
                fast = true;
                this.enterSprint(zone, now);
                zone.visualAnimation = ZONE_SPRINT_ANIMATION;
            }
            const speed = chaseSpeed;
            zone.moveVelocityX = dirX * speed;
            zone.moveVelocityY = dirY * speed;
            zone.x += dirX * speed * dt;
            zone.y += dirY * speed * dt;
            return true;
        }

        const goal = context.unitPosition(target);
        const dx = goal.x - zone.x;
        const dy = goal.y - zone.y;
        const distance = Math.hypot(dx, dy);
        if (!fast && distance <= Math.max(0, zone.sprintRange ?? 0)) {
            if (zone.arriveWander === true) {
                this.releaseToWander(zone, now);
                return false;
            }
            fast = true;
            this.enterSprint(zone, now);
            zone.visualAnimation = ZONE_SPRINT_ANIMATION;
        }
        //  快档速度同样不许掉到 0（见上面「没有可追的活目标」那段）：`sprintSpeed` 缺省时
        //  退回慢档速度，否则追到目标那一刻会「贴上去就定住」。
        const speed = fast ? (Math.max(0, zone.sprintSpeed ?? 0) || slowSpeed) : slowSpeed;
        const nx = distance > 1e-9 ? dx / distance : 1;
        const ny = distance > 1e-9 ? dy / distance : 0;
        zone.moveVelocityX = nx * speed;
        zone.moveVelocityY = ny * speed;
        const step = Math.min(speed * dt, distance);
        if (distance > 1e-9) {
            zone.x += nx * step;
            zone.y += ny * step;
        }
        return true;
    }

    /** 这个单位还值得追吗（活着、还没死透）。*/
    private static isChaseable(unit: ZCUnitState | undefined | null): unit is ZCUnitState {
        return !!unit && unit.hp > 0 && unit.battleState !== 'dead';
    }

    /**
     * 换目标：在区域当前位置附近找最近的活敌人，找不到返回 undefined。
     * 搜索半径取 max(sprintRange, ZONE_RETARGET_RANGE)，避免快档转段时漏目标。
    */
    private static nearestChaseTarget(
        zone: ZCGroundZoneState,
        context: IZCGroundZoneContext,
    ): ZCUnitState | undefined {
        if (!(context.hexStep > 0)) return undefined;
        const hexId = context.hexIdAt(zone.x, zone.y);
        if (hexId === null) return undefined;
        const range = Math.max(0, zone.sprintRange ?? 0) || ZONE_RETARGET_RANGE;
        const radiusHex = Math.ceil(Math.max(range, ZONE_RETARGET_RANGE) / context.hexStep) + 1;
        let best: ZCUnitState | undefined;
        let bestDistance = Infinity;
        for (const candidate of context.unitsInRadius(hexId, radiusHex)) {
            if (candidate.owner === zone.owner || !this.isChaseable(candidate)) continue;
            const pos = context.unitPosition(candidate);
            const distance = Math.hypot(pos.x - zone.x, pos.y - zone.y);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = candidate;
            }
        }
        return best;
    }

    /** 现在是不是还在慢档赶路（配了追踪且尚未提速）。*/
    private static isApproaching(zone: ZCGroundZoneState): boolean {
        return Math.max(0, zone.approachSpeed ?? 0) > 0 && zone.sprinting !== true;
    }

    /**
     * 切入快档：开始读秒 + 第一波立刻结算。
     *
     * `nextWaveAt` 必须重置成 now：慢档一个波次都没结算，它可能停在出生那一刻，
     * 重置之前那个 `while (now >= nextWaveAt)` 会在切换的这一帧把攒下的波次一口气全打出来。
     * 速度 / 方向由 `advanceChase` 每帧写，这里不碰 —— 追踪弹换目标后方向要跟着变。
    */
    private static enterSprint(zone: ZCGroundZoneState, now: number): void {
        zone.sprinting = true;
        zone.nextWaveAt = now;
    }

    /**
     * 到点下车：把移动权从追踪交回随机游走（2026-11-20 第 28 批 102004 飓风）。
     *
     * 四件事缺一不可：
     *  1. **按已耗时扣寿命**（`approachSeconds`）：赶路期不读秒，而口径是「总共活 N 秒
     *     （含赶路）」⇒ 这段账只能在这里一次结清。同时按剩余时间**重算 `wavesLeft`** ——
     *     它是照整段 N 秒算的，不重算就会把 12 波塞进剩下的几秒里（落地后每 0.17 秒打一下）。
     *  2. 清 `approachSpeed` —— 它同时是 `advanceChase` 的入口判据（> 0 就恒接管位移）
     *     和 `isApproaching` 的判据（> 0 且未提速就**不读秒**）。不清就是「飞到目标后原地
     *     定住、剩余寿命一直不减、一波都不结算」—— 画面上一片永不消散也不打人的风。
     *  3. 走一次 `enterSprint` —— 它把 `nextWaveAt` 重置到此刻。赶路期攒着的 `nextWaveAt`
     *     还停在施法那一刻，不重置的话落地第一帧 `while (now >= nextWaveAt)` 会把
     *     赶路期间「本该打、但没打」的波次一口气全打出来。
     *  4. 清 `sprintSpeed` 与旧速度 —— 交还给 `advanceWander` 之前别留下一帧的旧方向位移。
     *
     * `sprinting` 保持真（阶段标记「已经到过点了」）：它已经写进快照，读档回来不能又变成
     * 「还在赶路」；`advanceChase` 下一帧因为 `approachSpeed` 已清而直接返回 false。
    */
    private static releaseToWander(zone: ZCGroundZoneState, now: number): void {
        const travelled = Math.max(0, zone.approachSeconds ?? 0);
        if (travelled > 0) {
            zone.remainingSeconds = Math.max(0, zone.remainingSeconds - travelled);
            const interval = Math.max(0.05, zone.waveInterval);
            zone.wavesLeft = Math.max(0, Math.round(zone.remainingSeconds / interval));
        }
        this.enterSprint(zone, now);
        zone.approachSpeed = undefined;
        zone.approachTargetId = undefined;
        zone.sprintSpeed = undefined;
        //  「最后已知坐标」也要一起清：留着它，游走接管后一旦再走一次 `advanceChase`
        //  （比如读档回来 `approachSpeed` 又被写回）就会朝那个旧点飞回去。
        zone.chaseGoalX = undefined;
        zone.chaseGoalY = undefined;
        zone.visualAnimation = undefined;
        zone.moveVelocityX = 0;
        zone.moveVelocityY = 0;
    }

    /**
     * 跟随本体：把圆心拍回施法者当前坐标；给了 followForward 就落到「本体 + 朝向前移」，
     * 并同时刷新 angleDegrees，避免矩形还朝旧角度。
     * 施法者阵亡或上下文缺 unitById 时保持最后位置，剩余波次照常打完。
    */
    private static followCaster(zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        const unitId = zone.followUnitId;
        if (unitId === undefined || !context.unitById) return;
        const caster = context.unitById(unitId);
        if (!caster || caster.battleState === 'dead' || caster.hp <= 0) return;
        const pos = context.unitPosition(caster);
        const forward = Math.max(0, zone.followForward ?? 0);
        if (!(forward > 0)) {
            zone.x = pos.x;
            zone.y = pos.y;
            return;
        }
        const radians = caster.facingRadians;
        zone.x = pos.x + Math.cos(radians) * forward;
        zone.y = pos.y + Math.sin(radians) * forward;
        zone.angleDegrees = radians * 180 / Math.PI;
    }

    /** 随机游走：定期更新朝向写入 moveVelocityX/Y。*/
    /**
     * 随机游走：把当前朝向写回 `moveVelocity`，位移由调用方统一推进。
     *
     * 🔴 S 型（2026-11-20 用户口径「飓风类技能的移动要类似 S 型的行走方式，不要固定的直线」）：
     * 老实现每 `wanderTurnSeconds` 把角度**整段重掷**成 `random × 2π` —— 那是折线，甚至可能
     * 原地掉头。现在改成**连续转向 + 按段翻号**：每帧按固定角速度累加，每 `wanderTurnSeconds`
     * 把角速度取反 ⇒ 一左一右，走出来就是蛇形（S）。起点方向仍由对局种子决定，可重演。
     *
     * 配了 `wanderSpeed = 0` 的区域（明确标识不能移动的飓风）在第一行就返回，一步都不挪。
     *
     * 首帧只定方向、不积分旋转：初始朝向就是 `random × 2π` 那一格，行为与改动前逐字一致
     * （存量用例按角度断言过这一拍）。
    */
    private static advanceWander(zone: ZCGroundZoneState, now: number,
        context: IZCGroundZoneContext, dt: number): void {
        const speed = Math.max(0, zone.wanderSpeed ?? 0);
        if (!(speed > 0)) return;
        const turnSeconds = Math.max(0.05, zone.wanderTurnSeconds ?? 1);
        //  首帧：定一个种子方向，这一段先不转（保持「第一拍方向 = random × 2π」）。
        if (zone.wanderAngleRadians === undefined) {
            const rnd = context.random ? context.random() : 0;
            zone.wanderAngleRadians = rnd * Math.PI * 2;
            zone.wanderTurnRate = ZC_ZONE_WANDER_SWING_RADIANS / turnSeconds;
            zone.wanderNextTurnAt = now + turnSeconds;
            zone.moveVelocityX = Math.cos(zone.wanderAngleRadians) * speed;
            zone.moveVelocityY = Math.sin(zone.wanderAngleRadians) * speed;
            return;
        }
        //  到点翻号：同一个角速度只换方向，幅值不变 ⇒ 左右对称的 S。
        let rate = zone.wanderTurnRate;
        if (rate === undefined) {
            rate = ZC_ZONE_WANDER_SWING_RADIANS / turnSeconds;
        } else if (zone.wanderNextTurnAt === undefined || now >= zone.wanderNextTurnAt) {
            rate = -rate;
            zone.wanderNextTurnAt = now + turnSeconds;
        }
        zone.wanderTurnRate = rate;
        zone.wanderAngleRadians = (zone.wanderAngleRadians as number) + rate * dt;
        const angle = zone.wanderAngleRadians;
        zone.moveVelocityX = Math.cos(angle) * speed;
        zone.moveVelocityY = Math.sin(angle) * speed;
    }

    /** 牵引：将范围内的存活敌方单位向区域中心牵引。*/
    private static pullEnemies(zone: ZCGroundZoneState, dt: number,
        context: IZCGroundZoneContext): void {
        const speed = Math.max(0, zone.pullSpeed ?? 0);
        const range = Math.max(0, zone.pullRadius ?? 0);
        if (!(speed > 0) || !(range > 0) || !context.displaceUnit) return;
        const hexId = context.hexIdAt(zone.x, zone.y);
        if (hexId === null) return;
        const radiusHex = Math.ceil(range / context.hexStep) + 1;
        const minimum = 20 * Math.max(0, context.combatDistanceScale ?? 1);
        for (const target of context.unitsInRadius(hexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead' || target.hp <= 0) continue;
            const pos = context.unitPosition(target);
            const dx = zone.x - pos.x;
            const dy = zone.y - pos.y;
            const current = Math.hypot(dx, dy);
            if (current <= 1e-9 || current < minimum || current > range) continue;
            const step = Math.min(speed * dt, current - minimum);
            context.displaceUnit(target, dx / current * step, dy / current * step);
        }
    }

    /**
     * 把「整段持有」的表现事件搬到区域当前位置（2026-11-07 鹿神守护）。
     *
     * 事件在区域的第一拍建出来，`durationSeconds` 直接取区域当时的剩余寿命 ——
     * 两边之后按同一个 dt 往回收，所以到点必然同拍消失，不需要在 tick 里再对时。
     * 早期退化（事件被外部裁掉 / 快照还原后 id 失效）直接重建一条，不抛。
    */
    private static syncHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        //  飞行段与落地段是两段美术（2026-11-19 蘑菇爆炸 101704）：空中播「生成」，
        //  落地播常驻的 `effectPrefabPath`。`settleFlight` 落地那一拍会清掉 `flightVisualPath`
        //  并作废旧事件，于是下一句就自动按落地路径重建一条 —— 这里只要挑对路径即可。
        const flying = (zone.flightSeconds ?? 0) > 0.0001;
        const holdPath = (flying ? (zone.flightVisualPath ?? zone.effectPrefabPath) : zone.effectPrefabPath);
        if (!zone.holdVisual || !holdPath) return;
        if (!(zone.remainingSeconds > 0.0001)) return;
        if (zone.visualEventId !== undefined) {
            const live = state.combatEvents.find((event) => event.id === zone.visualEventId);
            if (live) {
                live.fromX = zone.x; live.toX = zone.x;
                live.fromY = zone.y; live.toY = zone.y;
                //  朝向与抬升也跟着区域走：区域本身不转向，但快照还原 / 事件重建之后必须一致。
                live.angleDegrees = zone.angleDegrees;
                live.visualLiftPx = zone.visualLiftPx;
                //  接近段可能走好几秒，而事件出生时的时长只有「冲刺 durationSeconds」——
                //  不续的话小鹿会在半路（2 秒后）凭空消失。每帧续成「已活时间 + 区域剩余」，
                //  两边就永远同拍到期（区域散掉时 `dropHoldVisual` 还会兜一次底）。
                live.durationSeconds = Math.max(
                    live.durationSeconds,
                    state.elapsedSeconds - live.startedAt + Math.max(0, zone.remainingSeconds),
                );
                //  阶段动画：只在名字变化时改字段，视图据此决定要不要真的 `setAnimation`。
                if (zone.visualAnimation) live.spineAnimation = zone.visualAnimation;
                //  叠层（火船）只在快档亮（2026-11-12）：慢档赶路时身上是干净的。
                //  派生自 `sprinting` 而不是另存一份状态 —— 它必须与「档位」永远同拍。
                live.overlayFx = zone.sprinting === true ? true : undefined;
                return;
            }
            zone.visualEventId = undefined;
        }
        const id = state.nextCombatEventId++;
        //  常驻表现推后出场（2026-11-12 精密陷阱）：`start` 与 `idle` 是两段独立美术，
        //  同帧出场会双影。把 `startedAt` 推到未来、`durationSeconds` 同步加上这段延迟，
        //  视图侧的 `zcCombatEffectEntered`（docs §14.9）就会等到点了才建节点 ——
        //  不需要任何「播完切下一段」的接龙代码。缺省 0 ⇒ 立刻出现，既有区域一字不变。
        const delay = Math.max(0, zone.visualDelaySeconds ?? 0);
        state.combatEvents.push({
            id,
            type: 'area',
            owner: zone.owner,
            sourceUnitId: zone.sourceUnitId,
            targetUnitId: null,
            skillId: zone.skillId,
            skillName: zone.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: holdPath,
            fromX: zone.x,
            fromY: zone.y,
            toX: zone.x,
            toY: zone.y,
            radius: zone.radius,
            //  纯表现事件：伤害由 `resolveWave` 各自结算，这里给 0 免得任何按 `damage` 取值的
            //  下游误以为「区域每帧都在打人」。
            damage: 0,
            empowered: true,
            startedAt: state.elapsedSeconds + delay,
            durationSeconds: delay + zone.remainingSeconds,
            //  入场「由小变大」：视图从 0 缓出到 1 再乘 prefab 烘焙缩放，
            //  所以「最终大小」仍然由 prefab 说了算，这里只补一段入场。
            growSeconds: zone.growSeconds,
            //  入场起点占比（2026-11-20 102004 飓风「初始只有 10%」）：缺省不写 ⇒ 视图按 0 处理。
            growFrom: zone.growFrom,
            //  阶段动画（接近 `move` / 快档 `attack`）：视图只在名字变化时 setAnimation。
            spineAnimation: zone.visualAnimation,
            //  叠层（火船）只在快档亮（2026-11-12 追踪弹口径）。
            overlayFx: zone.sprinting === true ? true : undefined,
            //  朝向（`area` 事件两端同点，视图算不出方向 ⇒ 由模型给）与竖直抬升。
            angleDegrees: zone.angleDegrees,
            visualLiftPx: zone.visualLiftPx,
            //  事件级缩放（2026-11-19 射线集束 103503）：`area` 不按 `radius` 缩放，
            //  「同一条光束、长度由表值驱动」只能靠这一格。缺省不写 ⇒ 存量区域逐字不变。
            effectScale: zone.effectScale,
        });
        zone.visualEventId = id;
    }

    /** 摘掉「整段持有」的表现事件（区域消散时调一次）。*/
    private static dropHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        const id = zone.visualEventId;
        if (id === undefined) return;
        const index = state.combatEvents.findIndex((event) => event.id === id);
        if (index >= 0) state.combatEvents.splice(index, 1);
        zone.visualEventId = undefined;
    }

    /**
     * 区域消失当拍的一次性表现（如陷阱爆炸）；爆炸时刻由踩中决定，只能在这时推事件。
     * 先摘常驻光环再炸，避免爆炸与完整光环同帧并存。没配路径的区域不碰。
    */
    private static pushExpireVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        const path = zone.expirePrefabPath;
        if (!path) return;
        state.combatEvents.push({
            id: state.nextCombatEventId++,
            type: 'area',
            owner: zone.owner,
            sourceUnitId: zone.sourceUnitId,
            targetUnitId: null,
            skillId: zone.skillId,
            skillName: zone.skillName,
            effectKey: null,
            projectileKey: null,
            effectPrefabPath: path,
            fromX: zone.x,
            fromY: zone.y,
            toX: zone.x,
            toY: zone.y,
            radius: zone.radius,
            //  纯表现：伤害由紧随其后的 `resolveExpiry` 结算。
            damage: 0,
            empowered: true,
            startedAt: state.elapsedSeconds,
            durationSeconds: Math.max(0.05, zone.expireFxSeconds ?? 0.5),
            angleDegrees: zone.angleDegrees,
            visualLiftPx: zone.visualLiftPx,
            effectScale: zone.effectScale,
        });
    }

    /**
     * 触碰判定：半径内出现敌方单位就打一下，整片区域随即清零，由到期通道结算爆炸。
     * 只取第一个踩进来的目标（同帧多人也只算先到的那个），按中心点判定。
     * contactRadius 缺省/0 ⇒ 直接返回 false，既有区域不变。
    */
    private static resolveContact(state: IZCGroundZoneStepState, zone: ZCGroundZoneState,
        context: IZCGroundZoneContext): boolean {
        const contact = Math.max(0, zone.contactRadius ?? 0);
        if (!(contact > 0)) return false;
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return false;
        const radiusHex = Math.ceil(contact / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead' || target.hp <= 0) continue;
            const pos = context.unitPosition(target);
            if (Math.hypot(pos.x - zone.x, pos.y - zone.y) > contact) continue;
            const contactDamage = Math.max(0, zone.contactDamage ?? 0);
            if (contactDamage > 0) {
                const hitText = context.damageUnit(target, contactDamage, {
                    owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                    floatTextKind: zone.floatTextKind,
                });
                if (context.lifestealFromHit) {
                    context.lifestealFromHit(zone.sourceUnitId, hitText);
                }
            }
            zone.contactTriggered = true;
            return true;
        }
        return false;
    }

    /** 本波第 `hitIndex` 个目标的伤害：`damage × (1 - falloff)^hitIndex`（取整，与直伤同口径）。*/
    private static waveDamage(zone: ZCGroundZoneState, falloff: number, hitIndex: number): number {
        if (!(falloff > 0) || hitIndex <= 0) return zone.damage;
        return Math.max(1, Math.round(zone.damage * Math.pow(1 - falloff, hitIndex)));
    }

    private static resolveWave(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        let statusChanged = false;
        if (!zone.holdVisual) {
            state.combatEvents.push({
                id: state.nextCombatEventId++,
                type: 'area',
                owner: zone.owner,
                sourceUnitId: zone.sourceUnitId,
                targetUnitId: null,
                skillId: zone.skillId,
                skillName: zone.skillName,
                effectKey: null,
                projectileKey: null,
                effectPrefabPath: zone.effectPrefabPath ?? null,
                fromX: zone.x,
                fromY: zone.y,
                toX: zone.x,
                toY: zone.y,
                radius: zone.radius,
                damage: zone.damage,
                empowered: true,
                startedAt: state.elapsedSeconds,
                durationSeconds: zone.waveInterval,
                angleDegrees: zone.angleDegrees,
                visualLiftPx: zone.visualLiftPx,
                effectScale: zone.effectScale,
            });
        }
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        const maxHits = Math.max(0, zone.maxHits ?? 0);
        const hitUnitIds = zone.hitUnitIds;
        if (maxHits > 0 && hitUnitIds && hitUnitIds.length >= maxHits) return;
        const radiusHex = Math.ceil(zcGroundZoneBroadRadius(zone) / context.hexStep) + 1;
        const falloff = Math.max(0, Math.min(1, zone.damageFalloff ?? 0));
        const waveCap = Math.max(0, Math.round(zone.waveMaxTargets ?? 0));
        const hitOnce = zone.hitOncePerUnit === true;
        const onceIds = hitOnce ? (zone.hitUnitIds ?? (zone.hitUnitIds = [])) : null;
        let hitIndex = 0;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (!zcGroundZoneReaches(zone, pos.x, pos.y)) continue;
            if (waveCap > 0 && hitIndex >= waveCap) break;
            if (onceIds) {
                if (onceIds.includes(target.id)) continue;
                onceIds.push(target.id);
            }
            if (maxHits > 0 && hitUnitIds) {
                if (hitUnitIds.includes(target.id)) continue;
                if (hitUnitIds.length >= maxHits) break;
                hitUnitIds.push(target.id);
            }
            const hitText = context.damageUnit(target, this.waveDamage(zone, falloff, hitIndex), {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            hitIndex += 1;
            if (context.lifestealFromHit) {
                context.lifestealFromHit(zone.sourceUnitId, hitText);
            }
            if (zone.slowRatio > 0) {
                const id = `__slow:${zone.slowRatio}__`;
                context.ensureSlowStatus(id, -zone.slowRatio * 100, 1);
                context.applyStatus(target, id, { at: state.elapsedSeconds, durationSeconds: 1 });
            }
            const statusChance = Math.max(0, Math.min(1, zone.hitStatusChance ?? 0));
            if (zone.hitStatusId && statusChance > 0) {
                const roll = context.random ? context.random() : 1;
                if (roll < statusChance) {
                    context.applyStatus(target, zone.hitStatusId, {
                        at: state.elapsedSeconds,
                        durationSeconds: zone.hitStatusSeconds,
                    });
                    statusChanged = true;
                }
            }
        }
        if (zone.slowRatio > 0 || statusChanged) state.statusEffects = context.exportStatusEffects();
    }

    private static resolveExpiry(state: IZCGroundZoneStepState, zone: ZCGroundZoneState,
        context: IZCGroundZoneContext): void {
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        const radiusHex = Math.ceil(zcGroundZoneBroadRadius(zone) / context.hexStep) + 1;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (!zcGroundZoneReaches(zone, pos.x, pos.y)) continue;
            const hitText = context.damageUnit(target, zone.expireDamage ?? 0, {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            if (context.lifestealFromHit) {
                context.lifestealFromHit(zone.sourceUnitId, hitText);
            }
            if (target.hp <= 0 || !zone.expireStatusId || !zone.expireStatusDuration || !(zone.expireStatusDuration > 0)) continue;
            context.applyStatus(target, zone.expireStatusId, {
                at: state.elapsedSeconds,
                sourceUnitId: String(zone.sourceUnitId),
                durationSeconds: zone.expireStatusDuration,
            });
        }
        state.statusEffects = context.exportStatusEffects();
    }
}

