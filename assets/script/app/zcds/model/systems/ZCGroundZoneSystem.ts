import type { ZCFloatText, ZCGroundZoneState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import type { ZCStatusApplyOptions, ZCStatusSystemSnapshot } from '../ZCStatusEffect';
import type { IZCModelServices } from './ZCModelServices';

/** 判定形状只关心这几列，抽出签名好测。 */
type IZCZoneShape = Pick<ZCGroundZoneState,
    'x' | 'y' | 'radius' | 'rectHalfLength' | 'rectHalfHeight' | 'angleDegrees'>;

/**
 * 区域是否覆盖到世界坐标 `(x, y)`。
 *
 * 两种形状，二选一：
 * - **圆**（缺省）：`hypot(dx, dy) <= radius`，所有既有区域逐字不变；
 * - **矩形**（`rectHalfHeight > 0` 才启用，2026-11-11 磁电冲击 101604）：
 *   `|dx| <= 半长 && |dy| <= 半宽`。半长缺省跟随 `radius`。
 *
 * 有 `angleDegrees` 时先把点**转回区域本地系**再判（旋转对圆没意义，所以只在矩形分支做）。
 * 矩形与美术用同一个角度：`area` 事件 `from == to`，视图自己算不出朝向，角度由模型给。
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
 * 矩形取**外接圆**半径：粗筛只负责别漏人，真正的形状由 `zcGroundZoneReaches` 收口。
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
     * 必须用**对局种子随机**（`services.random`），不能用 `Math.random` —— 否则回放/快照
     * 重算会在同一拍给出不同的控制结果。声明成可选：只跑区域结算的轻量上下文
     * （单测 / 工具）不掷骰，缺省按「没中」处理。
     */
    random?(): number;
    /**
     * 区域伤害的吸血（2026-11-04 椰蛋战士「生命汲取」100503）。
     *
     * 区域结算这一步拿不到 `IZCAttackResolutionContext`（没有 skillRuntime / statPatches /
     * effectiveDefinition），所以只把「谁打的 + 这一跳实际掉多少」丢回去，让模型找回源单位、
     * 转给 `ZCAttackResolutionSystem.applyLifesteal` —— 比例取法与普攻完全同源，
     * 不在这里另算一套。
     *
     * `hitText` 是 `damageUnit` 的返回值（`value` = `result.applied`），
     * 护盾全吃 / 溢出 / 已死都会是 0 或 null，此时不回血。
     * **源单位已经阵亡时模型侧直接跳过**：区域还在天上飞、人已经没了，不该继续吸。
     *
     * 声明成可选是为了「只跑区域结算」的轻量上下文（单测、工具）不必凭空凑一个攻击上下文；
     * 正式对局里 `ZCGameModel.buildGroundZoneContext` 一定会给，缺了只是不吸血、不会报错。
     */
    lifestealFromHit?(sourceUnitId: number, hitText: ZCFloatText | null): void;
    /**
     * 按 `unit.id` 取单位（2026-11-07 鹿神守护的两段式移动：接近阶段要追着目标走）。
     *
     * 声明成可选：只跑区域结算的轻量上下文（单测 / 工具）不必凑一个单位索引。
     * 缺了的表现是「追不到目标 ⇒ 就地转冲刺」，不会抛，也不会把区域卡在接近段。
     */
    unitById?(id: number): ZCUnitState | undefined;
}

/**
 * 慢档（赶路）播的骨架动画名（2026-11-07 鹿神守护 103405）。
 *
 * `魔术师召唤鹿` 这份骨架里只有三段动画：`idle` / `move` / `attack`（Spine 3.8 二进制里
 * 三个长度前缀串直接可读）。美术那一段「走」就叫 `move`，**没有单独的 `walk`** ——
 * 需求里的「播放 walk 动画」落到这份资源上就是它。名字写在这里而不是配表：
 * `skillParamJson` 只有数值槽，装不下字符串。
 */
const ZONE_APPROACH_ANIMATION = 'move';
/** 快档（提速扑击）播的骨架动画名（同上）。 */
const ZONE_SPRINT_ANIMATION = 'attack';

/**
 * 换目标时的搜索半径（世界 px，2026-11-12 鹿神守护改追踪弹）。
 *
 * 只在「原目标阵亡 / 丢失」那几帧用一次，结果按 `(格, 半径)` 缓存（`unitsInRadius` 自己缓存），
 * 所以这里可以给得宽松些：600 世界 px = 2000 表值 px ≈ 4.4 个格高，够跨过整条战线。
 * 与 `sprintRange` 取大值 —— 快档转段距离本来就更远时不能被换目标半径卡住。
 */
const ZONE_RETARGET_RANGE = 600;

type IZCGroundZoneStepState = Pick<ZCSnapshot,
    'elapsedSeconds' | 'groundZones' | 'combatEvents' | 'nextCombatEventId' | 'statusEffects'>;

/** 持续区域只处理已创建的 zone；模型保留技能出手与创建 zone 的编排。 */
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
            //  ① 追踪推进（2026-11-12 鹿神守护改成「会追踪的子弹」）。
            //  返回 true = 位移已经由追踪逻辑接管，这里不能再按 `moveVelocity` 推一遍。
            const chased = this.advanceChase(zone, dt, now, context);
            if (!chased) {
                //  移动区域（暴风 / 冲刺段）：先推进位置再结算这一波，否则伤害会永远落在上一帧的格子上。
                if (zone.moveVelocityX || zone.moveVelocityY) {
                    zone.x += (zone.moveVelocityX ?? 0) * dt;
                    zone.y += (zone.moveVelocityY ?? 0) * dt;
                }
            }
            //  ② 读秒：只有**过了慢档**才开始。
            //  小鹿走过去的那几秒是「赶路」不是「技能在读秒」，否则走 4 秒 > 存活 2 秒，
            //  人还没到区域就没了。
            const approaching = this.isApproaching(zone);
            if (!approaching) zone.remainingSeconds -= dt;
            //  「跟随本体」的光环（2026-11-09 无尘禁土 102503）：每帧把圆心拍回施法者身上。
            //  放在位移之后 —— 同时配了速度和跟随的话，跟随是**绝对落点**，
            //  应当盖掉这一帧的位移（否则会「一边跟着人走、一边还在往外飘」）。
            this.followCaster(zone, context);
            //  整段持有视觉：位置推完就把那条长效事件搬到新位置（必须在结算之前，
            //  这样「这一波伤害」和「画面上的小鹿」在同一拍、同一个坐标）。
            this.syncHoldVisual(state, zone);
            //  ③ 触碰触发（2026-11-12 科学家「精密陷阱」103504）：敌方单位踩进 `contactRadius`
            //  ⇒ 吃一次触碰伤害，整片区域**当场清零**，走下面既有的到期通道（爆炸 + 表现）。
            //  放在波次结算之前：陷阱只有「踩响」和「到点自爆」两个时刻，没有周期性波次
            //  （`wavesLeft = 0`），所以这个 `while` 对它本来是空转。
            if (this.resolveContact(state, zone, context)) zone.remainingSeconds = 0;
            while (!approaching && zone.wavesLeft > 0 && now >= zone.nextWaveAt) {
                this.resolveWave(state, zone, context);
                zone.wavesLeft -= 1;
                zone.nextWaveAt += zone.waveInterval;
                //  命中名额打满 ⇒ 立刻散（追踪弹口径：`maxHits = 1` ⇒ 撞到第一个目标就消失）。
                if ((zone.maxHits ?? 0) > 0 && (zone.hitUnitIds?.length ?? 0) >= (zone.maxHits ?? 0)) {
                    zone.remainingSeconds = 0;
                    break;
                }
            }
            if (zone.remainingSeconds > 0.0001) {
                zones[write++] = zone;
            } else {
                //  区域这一拍就没了（自然到点 / 打满名额提前散）⇒ 表现事件同步摘掉，
                //  「冲刺结束后所有特效一起消失」不靠下一帧的事件裁剪兜底。
                this.dropHoldVisual(state, zone);
                //  死亡那一拍的一次性表现（2026-11-12 精密陷阱的「陷阱爆炸」）：必须在
                //  `resolveExpiry` 之前推 —— 同一拍里「画面炸开」和「血条掉一截」才对得上。
                this.pushExpireVisual(state, zone);
                if ((zone.expireDamage ?? 0) > 0) this.resolveExpiry(state, zone, context);
            }
        }
        zones.length = write;
    }

    /**
     * 「追踪」推进（2026-11-12 魔术师「鹿神守护」103405 改成「会追踪的子弹」）。
     *
     * 需求原话：「小鹿应该是类似子弹一样的效果，只是一个会追踪目标的子弹……前半段移速慢（70px），
     * 贴近目标后的移速快（140PX，同步在小鹿身上覆盖火船特效），当原目标死亡后，小鹿会转向新目标，
     * 接触到任意目标后造成伤害，子弹消失」。
     *
     * 所以它**不是**「锁定方向撞出去的冲刺」，而是一颗两档速度的追踪弹：
     *
     * | 档位 | 触发 | 速度 | 动画 | 叠层 | 读秒 / 结算 |
     * | :-- | :-- | :-- | :-- | :-- | :-- |
     * | 慢档 | 出生 | `approachSpeed` | `move` | 灭 | 不读秒、不结算 |
     * | 快档 | 距目标 ≤ `sprintRange` | `sprintSpeed` | `attack` | **亮（火船）** | 每 `waveInterval` 一波 |
     *
     * 两档都**每帧重算方向**：目标会走位，锁死出生朝向就会出现「小鹿沿着直线飞到空地上」。
     *
     * 返回 `true` = **位移已由本方法推进**（调用方不能再按 `moveVelocity` 推第二遍）。
     * 没有配 `approachSpeed` 的区域直接返回 `false`，行为与改前逐字相同。
     */
    private static advanceChase(
        zone: ZCGroundZoneState,
        dt: number,
        now: number,
        context: IZCGroundZoneContext,
    ): boolean {
        const slowSpeed = Math.max(0, zone.approachSpeed ?? 0);
        if (!(slowSpeed > 0)) return false;

        //  ① 目标：原目标还活着就继续追，死了 / 丢了就改追最近的敌人（追踪弹的核心行为）。
        let target = zone.approachTargetId === undefined
            ? undefined : context.unitById?.(zone.approachTargetId);
        if (!this.isChaseable(target)) {
            target = this.nearestChaseTarget(zone, context);
            zone.approachTargetId = target ? target.id : undefined;
        }

        //  ② 档位：切快档只发生一次，之后 `sprinting` 恒 true（主循环据此开始读秒）。
        let fast = zone.sprinting === true;
        zone.visualAnimation = fast ? ZONE_SPRINT_ANIMATION : ZONE_APPROACH_ANIMATION;

        if (!target) {
            //  视野里一个活敌人都没有：沿当前速度方向继续飞，别原地卡住等人（它会自然读秒到期）。
            //  连速度都没有（出生即无目标）⇒ 朝 +x 兜底，至少别站着。
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
            const speed = Math.max(0, zone.sprintSpeed ?? 0);
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
            //  进入 `sprintRange` ⇒ 提速：换速度、开始读秒，并在表现上点亮叠层（火船）。
            fast = true;
            this.enterSprint(zone, now);
            zone.visualAnimation = ZONE_SPRINT_ANIMATION;
        }
        const speed = fast ? Math.max(0, zone.sprintSpeed ?? 0) : slowSpeed;
        //  方向每帧刷新：目标走位 / 换目标都能立刻拐过去。
        const nx = distance > 1e-9 ? dx / distance : 1;
        const ny = distance > 1e-9 ? dy / distance : 0;
        zone.moveVelocityX = nx * speed;
        zone.moveVelocityY = ny * speed;
        //  别越过目标：这一步最多走到目标身上为止（贴脸时 `distance` 可能小于一步）。
        const step = Math.min(speed * dt, distance);
        if (distance > 1e-9) {
            zone.x += nx * step;
            zone.y += ny * step;
        }
        return true;
    }

    /** 这个单位还值得追吗（活着、还没死透）。 */
    private static isChaseable(unit: ZCUnitState | undefined | null): unit is ZCUnitState {
        return !!unit && unit.hp > 0 && unit.battleState !== 'dead';
    }

    /**
     * 换目标：在区域当前位置附近找**最近的活着的敌人**（2026-11-12 鹿神守护）。
     *
     * 只用上下文已有的格子索引（`hexIdAt` + `unitsInRadius`），不线性扫全表 ——
     * 与 `resolveWave` 的粗筛同一套路径。找不到就返回 `undefined`，由调用方走「沿原方向飞」。
     *
     * 搜索半径取 `max(sprintRange, ZONE_RETARGET_RANGE)`：快档转段距离比默认搜索半径更远时，
     * 不能因为半径不够就漏掉本该能追上的目标。
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

    /** 现在是不是还在慢档赶路（配了追踪且尚未提速）。 */
    private static isApproaching(zone: ZCGroundZoneState): boolean {
        return Math.max(0, zone.approachSpeed ?? 0) > 0 && zone.sprinting !== true;
    }

    /**
     * 切入快档：开始读秒 + 第一波立刻结算。
     *
     * `nextWaveAt` 必须**重置成 now**：慢档一个波次都没结算，它可能停在出生那一刻，
     * 重置之前那个 `while (now >= nextWaveAt)` 会在切换的这一帧把攒下的波次一口气全打出来。
     * 速度 / 方向由 `advanceChase` 每帧写，这里不碰 —— 追踪弹换目标后方向要跟着变。
     */
    private static enterSprint(zone: ZCGroundZoneState, now: number): void {
        zone.sprinting = true;
        zone.nextWaveAt = now;
    }

    /**
     * 「跟随本体」：把区域圆心拍回施法者的当前坐标（2026-11-09 大威天芦「无尘禁土」102503）。
     *
     * 判定与表现都吃区域自己的 `x/y`（`resolveWave` 用 `hexIdAt`、`syncHoldVisual` 抄进事件），
     * 所以**只改这两个数**就够，不需要额外维护「光环跟谁走」的第二份状态。
     *
     * 2026-11-12 追加（磁电菇「磁电冲击」101604「跟随角色一起移动，固定在角色身前」）：
     * 给了 `followForward` 就落到「本体 + 朝向前移」，并且**同时刷新 `angleDegrees`** ——
     * 落点沿朝向偏、矩形却朝旧角度的话，中心与光束方向会立刻错开。`followForward` 缺省 0
     * ⇒ 圆心跳回本体，无尘禁土那一类行为逐字不变。
     *
     * 三种退化都保持「把剩下的波次在原地打完」：
     * · `followUnitId` 缺省 —— 整段不执行（全部既有区域行为逐字不变）；
     * · 上下文没给 `unitById`（只跑结算的单测 / 工具）—— 保持最后位置；
     * · 施法者已阵亡 —— 光环是「本体携带」的，人没了不该继续输出，但也没必要提前掐掉
     *   已经放出来的这一片（它自己会按 `remainingSeconds` 到期）。
     */
    private static followCaster(zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        const unitId = zone.followUnitId;
        if (unitId === undefined) return;
        const caster = context.unitById?.(unitId);
        if (!caster || caster.battleState === 'dead' || caster.hp <= 0) return;
        const pos = context.unitPosition(caster);
        const forward = Math.max(0, zone.followForward ?? 0);
        if (!(forward > 0)) {
            zone.x = pos.x;
            zone.y = pos.y;
            return;
        }
        //  朝前固定距离：朝向取**美术朝向**（`facingRadians` 在每次 `startAttack` 时对齐当前目标），
        //  不是「指向目标」——目标可能在背后、也可能中途换人，玩家看到的「身前」是角色的正面。
        const radians = caster.facingRadians;
        zone.x = pos.x + Math.cos(radians) * forward;
        zone.y = pos.y + Math.sin(radians) * forward;
        zone.angleDegrees = radians * 180 / Math.PI;
    }

    /**
     * 把「整段持有」的表现事件搬到区域当前位置（2026-11-07 鹿神守护）。
     *
     * 事件在区域的第一拍建出来，`durationSeconds` 直接取区域**当时的剩余寿命** ——
     * 两边之后按同一个 dt 往回收，所以到点必然同拍消失，不需要在 tick 里再对时。
     * 早期退化（事件被外部裁掉 / 快照还原后 id 失效）直接重建一条，不抛。
     */
    private static syncHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        if (!zone.holdVisual || !zone.effectPrefabPath) return;
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
            effectPrefabPath: zone.effectPrefabPath,
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
            //  阶段动画（接近 `move` / 快档 `attack`）：视图只在名字变化时 setAnimation。
            spineAnimation: zone.visualAnimation,
            //  叠层（火船）只在快档亮（2026-11-12 追踪弹口径）。
            overlayFx: zone.sprinting === true ? true : undefined,
            //  朝向（`area` 事件两端同点，视图算不出方向 ⇒ 由模型给）与竖直抬升。
            angleDegrees: zone.angleDegrees,
            visualLiftPx: zone.visualLiftPx,
        });
        zone.visualEventId = id;
    }

    /** 摘掉「整段持有」的表现事件（区域消散时调一次）。 */
    private static dropHoldVisual(state: IZCGroundZoneStepState, zone: ZCGroundZoneState): void {
        const id = zone.visualEventId;
        if (id === undefined) return;
        const index = state.combatEvents.findIndex((event) => event.id === id);
        if (index >= 0) state.combatEvents.splice(index, 1);
        zone.visualEventId = undefined;
    }

    /**
     * 区域消失那一拍的一次性表现（2026-11-12 科学家「精密陷阱」103504 的「陷阱爆炸」）。
     *
     * 为什么只能在这里推：爆炸时刻由**踩上去的那一脚**决定，施法那一刻根本不知道，
     * 所以「要播哪个预制体」只能存在区域上、死亡这一帧现推一条事件。
     * 与 `dropHoldVisual` 的顺序不能反：先摘常驻光环、再炸，屏幕上不会出现
     * 「爆炸和完整光环同帧并存」的那一帧。
     *
     * 没有配 `expirePrefabPath` 的区域（既有全部区域）在这里**一次都不碰**。
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
        });
    }

    /**
     * 触碰判定（2026-11-12 科学家「精密陷阱」103504）：半径内出现敌方单位 ⇒ 打他一下。
     *
     * 口径与设计案原文一致：「目标触碰到该陷阱会收到 1 次伤害」，**一次**、**单目标**，
     * 随后整片区域当场清零（由调用方做）⇒ 既有的到期通道负责爆炸均摊伤害与表现。
     *
     * 为什么取「第一个踩进来的」而不是全部打一遍：踩响就是踩响，同一帧里两个人一起进来，
     * 也只该由**先到的那个**引爆 —— 全打一遍等于白送一份额外伤害，与设计案不符。
     *
     * 取中心点判定（与 `zcGroundZoneReaches` 同口径），不加受击者体积：
     * 陷阱的可见光环就是它的判定圈（`trapRadius` 与预制的屏上直径同源，见 `ZCTrapFx`）。
     *
     * 缺省（`contactRadius` undefined / 0）⇒ 直接返回 false，既有区域逐字不变。
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
            const hitText = context.damageUnit(target, Math.max(0, zone.contactDamage ?? 0), {
                owner: zone.owner, kind: 'unit', unitId: zone.sourceUnitId,
                floatTextKind: zone.floatTextKind,
            });
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
            return true;
        }
        return false;
    }

    /** 本波第 `hitIndex` 个目标的伤害：`damage × (1 - falloff)^hitIndex`（取整，与直伤同口径）。 */
    private static waveDamage(zone: ZCGroundZoneState, falloff: number, hitIndex: number): number {
        if (!(falloff > 0) || hitIndex <= 0) return zone.damage;
        return Math.max(1, Math.round(zone.damage * Math.pow(1 - falloff, hitIndex)));
    }

    private static resolveWave(state: IZCGroundZoneStepState, zone: ZCGroundZoneState, context: IZCGroundZoneContext): void {
        let statusChanged = false;
        //  「整段持有视觉」的区域已经有一条跟着自己走的长效事件，这里**不再**逐波推视觉 ——
        //  否则同一只小鹿身后会再叠出一串 0.15s 的残影（2026-11-07 鹿神守护）。
        //  伤害结算照旧走下面整段，一条都不少。
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
            });
        }
        const targetHexId = context.hexIdAt(zone.x, zone.y);
        if (targetHexId === null) return;
        //  命中名额（移动区域）：同一个敌人只算一次，满额就这一波直接收工。
        const maxHits = Math.max(0, zone.maxHits ?? 0);
        const hitUnitIds = zone.hitUnitIds;
        if (maxHits > 0 && (hitUnitIds?.length ?? 0) >= maxHits) return;
        const radiusHex = Math.ceil(zcGroundZoneBroadRadius(zone) / context.hexStep) + 1;
        //  逐目标递减（2026-11-06「鹿神守护」103405）：第 k 个被命中的目标吃
        //  `damage × (1 - damageFalloff)^k`，k 从 0 起。缺省 0 ⇒ 恒等于原伤害。
        //  递减**只按本波内的命中顺序**算，不跨波累计 —— 移动区域的 `hitUnitIds` 保证
        //  同一个敌人只会出现在一波里，跨波累计没有意义。
        const falloff = Math.max(0, Math.min(1, zone.damageFalloff ?? 0));
        //  每波目标上限（2026-11-11 磁电冲击：每波最多打 5 个）。与 `maxHits` 不同 ——
        //  这个**每波重新计数**，同一个敌人下一波照样能再吃，区域也不会提前散场。
        const waveCap = Math.max(0, Math.round(zone.waveMaxTargets ?? 0));
        let hitIndex = 0;
        for (const target of context.unitsInRadius(targetHexId, radiusHex)) {
            if (target.owner === zone.owner || target.battleState === 'dead') continue;
            const pos = context.unitPosition(target);
            if (!zcGroundZoneReaches(zone, pos.x, pos.y)) continue;
            if (waveCap > 0 && hitIndex >= waveCap) break;
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
            //  每一跳各自回血：命中 N 人就回 N 次，各按「自身实际掉血 × 比例」。
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
            if (zone.slowRatio > 0) {
                const id = `__slow:${zone.slowRatio}__`;
                context.ensureSlowStatus(id, -zone.slowRatio * 100, 1);
                context.applyStatus(target, id, { at: state.elapsedSeconds, durationSeconds: 1 });
            }
            //  命中挂状态（2026-11-11 磁电菇「五雷轰顶」101603）：每波**每个**被打到的敌人
            //  各自判一次概率。`random` 缺省 ⇒ 一律不挂（轻量上下文 / 单测里不掷骰）。
            const statusChance = Math.max(0, Math.min(1, zone.hitStatusChance ?? 0));
            if (zone.hitStatusId && statusChance > 0 && (context.random?.() ?? 1) < statusChance) {
                context.applyStatus(target, zone.hitStatusId, {
                    at: state.elapsedSeconds,
                    durationSeconds: zone.hitStatusSeconds,
                });
                statusChanged = true;
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
            context.lifestealFromHit?.(zone.sourceUnitId, hitText);
            if (target.hp <= 0 || !zone.expireStatusId || !(zone.expireStatusDuration && zone.expireStatusDuration > 0)) continue;
            context.applyStatus(target, zone.expireStatusId, {
                at: state.elapsedSeconds,
                sourceUnitId: String(zone.sourceUnitId),
                durationSeconds: zone.expireStatusDuration,
            });
        }
        state.statusEffects = context.exportStatusEffects();
    }
}

