/**
 * 战斗特效的**飞行段与朝向**（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * 本文件目前管两件互不相干的事，各自一张表：
 *
 * | 表 | 影响 | 由谁消费 |
 * | :-- | :-- | :-- |
 * | `FLIGHT_BY_PREFAB_PATH` | 位置（跟着飞）+ 事件寿命（`durationSeconds`）+ 转角 | `ZCAttackResolutionSystem` / `ZCCombatEffectView` |
 * | `FACING_BY_PREFAB_PATH` | **只影响转角**（原地播、不飞） | `ZCCombatEffectView` |
 *
 * ## 为什么需要飞行段
 *
 * 2026-11-02 需求：「猎头者的攻击特效需要匹配射程，特效改成像子弹一样飞向目标」。
 *
 * 猎头者（`pvpCard` 68012）射程 **500**，但它的普攻走 `pvpSkill` 30271 —— 一条
 * `mode: 'melee'` 的近战行（名字还叫「斧盾兵普攻」，特效是 `斧盾兵_反击气刃` 的月牙气刃）。
 * `melee` 的表现有两条硬伤：
 *
 *  1. `ZCCombatSystem.attackTravelSeconds` 对 melee 返回**固定 0.32s**，与出手距离无关
 *     ⇒ 隔着半个屏幕打，和贴脸打，气刃的节奏一模一样，「特效和射程对不上」；
 *  2. `ZCCombatEffectView` 的 melee 分支把特效**钉在锚点上播一次**
 *     ⇒ 月牙凭空出现在出手点（或连线中点），没有「飞过去」的过程。
 *
 * ## 为什么按 **prefab 路径** 登记，而不是技能 id
 *
 * 与 `ZCCombatEffectPlacement`（锚点）同一条口径：真正决定「该不该飞」的是**画出来的是哪张图**。
 * `斧盾兵_反击气刃` 目前只被 30271 一条技能行引用，配一次就够；将来若被别的行复用，
 * 「月牙气刃该飞」这个判断依然成立。
 *
 * ## 为什么它住在 `model/`
 *
 * 表现时长要由**逻辑层**算：事件在 `elapsedSeconds >= startedAt + durationSeconds` 时被
 * `ZCGameModel.advance` 剔除，视图自己拉长会被中途回收。而 melee 的伤害是
 * **`state.combatEvents.push(event)` 之后立刻 `context.damageUnit(...)`** 结算的
 * （见 `ZCAttackResolutionSystem.resolveAttack`），`durationSeconds` **纯表现**、不影响任何结算 ——
 * 所以在这里改时长是安全的。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**：它是纯函数，`tests/zcds-combat-effect-flight.test.ts`
 * 直接 `import` 进来逐点断言（不需要视图夹具那套 vm 转译）。
 */
import { ZCCombatEventType } from './ZCCombatCatalog';

/** 一条「先飞过去再炸」的配置。 */
export interface IZCCombatEffectFlight {
    /**
     * 飞行速度（**世界坐标 px/秒**，与 `attackRange × combatDistanceScale` 同一套数）。
     *
     * 取 420：猎头者射程 500（逻辑）⇒ `× combatDistanceScale 0.3` ⇒ 150 世界 px
     * ⇒ 空气刃飞完全程约 **0.36s**，比原来的固定 0.32s 略慢一点，
     * 但近距离（贴脸 30px）只飞 0.07s，会被 `minSeconds` 兜到 0.14s。
     */
    readonly speed: number;
    /** 最短飞行秒数：贴脸时别瞬移（0 秒会变成「原地闪一下」）。 */
    readonly minSeconds: number;
    /** 最长飞行秒数：射程再远也不能飞太久，否则同一发气刃会盖住下一次普攻。 */
    readonly maxSeconds: number;
    /**
     * 朝向偏移（度，**逆时针为正** ⇒ 要顺时针转就填负数）：美术的「正前方」与飞行方向之间的夹角。
     *
     * 取值只有一个含义：**让箭头的正面（亮弧顶那一头）沿弹道指向目标**。
     * - 美术正面画在 `+X`（朝右）⇒ 填 `0`，转角就等于弹道方向；
     * - 美术正面画在 `+Y`（朝上）⇒ 填 `-90`（顺时针 90° 才把「朝上」掰成「朝右」）。
     *
     * 2026-11-02 两轮口径：先是按「长轴的法线朝目标」登记了 `90`，实战截图看下来
     * 箭头是「侧着飞」（正面朝上、敌人却在右边），用户要求**顺时针再转 90°** ⇒ 改回 `0`。
     *
     * ⚠️ 只影响转角，不影响位置与时长；同一个 prefab 的所有持有者共用这一个值。
     */
    readonly facingOffsetDegrees: number;
}

/**
 * 按特效 prefab 路径登记飞行段。没登记的一律保持既有行为（melee 固定 0.32s、原地播）。
 *
 * 新增一条之前先确认三件事：① 这只是**表现**，伤害已在出手那一拍结算；
 * ② 美术本身得是「可以朝着目标飞的形状」（月牙 / 箭矢 / 飞镖），正面砸地的爆炸类不要登记；
 * ③ 它被哪几条技能行引用 —— 同一张图的所有持有者都会开始飞。
 */
const FLIGHT_BY_PREFAB_PATH: Readonly<Record<string, IZCCombatEffectFlight>> = {
    // 30271「斧盾兵普攻」—— 实际持有者是猎头者（68012，射程 500）、
    // 饥饿战士（50030）、艺术家（50033）、怪物猎头者（50014）。
    // 美术：150×61，**亮白弧顶在右、速度线拖在左** ⇒ 正面（箭头）就是 `+X`，偏移取 `0`：
    // 转角 = 飞行方向，弧顶始终冲着目标飞。
    // ⚠️ 别改回 90：那是「长轴的法线朝目标」的口径，实战里箭头会侧着飞
    // （正面朝上、敌人在右边），2026-11-02 用户要求顺时针转 90° 修掉的正是这一版。
    'units/projectiles/斧盾兵_反击气刃/斧盾兵_反击气刃': {
        speed: 420,
        minSeconds: 0.14,
        maxSeconds: 0.6,
        facingOffsetDegrees: 0,
    },
};

/** 特效路径 → 飞行配置；空路径 / 未登记 = `null`（不飞）。 */
export function zcCombatEffectFlightOf(
    effectPrefabPath: string | null | undefined,
): IZCCombatEffectFlight | null {
    if (!effectPrefabPath) return null;
    return FLIGHT_BY_PREFAB_PATH[effectPrefabPath] ?? null;
}

/**
 * 只调**朝向**、不飞的登记表：值 = 美术的「正前方」相对节点 `+X` 的夹角（度，逆时针为正）。
 *
 * ## 为什么与飞行段分两张表
 *
 * 飞行段的记录里塞着 `speed / minSeconds / maxSeconds` —— 它同时决定**事件寿命**
 * （`zcCombatEffectTravelSeconds` 会把它喂给 `durationSeconds`，改错了会让特效应活多久跟着变）。
 * 而「这张图有方向、该转身对着目标」只是一件转角的事。两类需求混在一张表里，
 * 以后想知道「这张图会不会改时长」就得把整个对象读完。
 *
 * ## 为什么需要它
 *
 * 2026-11-02 需求：「运动霸技能特效没有朝向目标，现在的朝向是反的」。
 *
 * `ZCCombatEffectView` 原本对 melee / area 一律 `setRotationFromEuler(0,0,0)` ——
 * 转角恒 0 意味着「美术朝哪边，屏上就朝哪边」。运动霸普攻的美术（`消灭学霸_普攻`）
 * 是一把**朝右**（`+X`）扇开的绿色气刃，汇聚点在画布左侧；目标站在左边时它就正好朝反了，
 * 目标在上/下时则是「横着扫」。登记之后转角 = 弹道方向，这张图就始终朝着目标喷。
 *
 * ⚠️ 只登记**美术本身有明确正前方**的效果。左右镜像对称的（`重骑兵_践踏` 那种横向冲击波）
 * 转不转都一样，登记了只是多一次 `atan2`；原地爆的（`from === to`）也没有朝向可言 ——
 * 视图侧会按「两端同点」直接跳过。
 */
const FACING_BY_PREFAB_PATH: Readonly<Record<string, number>> = {
    // 30713「运动霸普攻」（melee）与 30852「能量光束」（area）共用这一张图，两边都要转身。
    // 美术：228×256、15 帧的绿色气刃，汇聚点（亮白那撮）在画布**左侧**、刃口朝**右**扇开
    // ⇒ 正前方就是 `+X`，偏移 **0°**（转角 = 弹道方向本身）。
    'units/projectiles/消灭学霸_普攻/消灭学霸_普攻': 0,
};

/**
 * 特效的朝向偏移（度）；`null` = 不登记，保持 `0°`。
 *
 * 飞行段自带的 `facingOffsetDegrees` 优先 —— 同一个 prefab 不允许两张表给出两个不同的答案。
 */
export function zcCombatEffectFacingOffsetOf(
    effectPrefabPath: string | null | undefined,
): number | null {
    if (!effectPrefabPath) return null;
    const flight = FLIGHT_BY_PREFAB_PATH[effectPrefabPath];
    if (flight) return flight.facingOffsetDegrees;
    return FACING_BY_PREFAB_PATH[effectPrefabPath] ?? null;
}

/**
 * 「原地播」的特效这一帧该转多少度；`null` = 保持 0°。
 *
 * 入参是**视图坐标**的位移（`mapToViewX / mapToViewY` 的 x / y 缩放比不同，
 * 拿逻辑坐标直接 `atan2` 会算歪 —— 与 `projectile` 分支同一条口径）。
 *
 * 三个 `null` 出口，各有各的理由：
 *  - 没登记 ⇒ 与改前逐字一致（22 条近战特效不能因为加了这张表就集体转向）；
 *  - 两端同点 ⇒ 原地爆（气浪 / 扇形技 / 多点落点），没有「朝向目标」可言；
 *  - 位移非有限值 ⇒ 宁可不转，也不能把 `NaN` 泄进 `setRotationFromEuler`
 *    （那会让整个节点的矩阵变 `NaN`，特效静默消失且不报错）。
 */
export function zcCombatEffectHeadingDegrees(
    viewDeltaX: number,
    viewDeltaY: number,
    effectPrefabPath: string | null | undefined,
): number | null {
    const offset = zcCombatEffectFacingOffsetOf(effectPrefabPath);
    if (offset === null) return null;
    if (!Number.isFinite(viewDeltaX) || !Number.isFinite(viewDeltaY)) return null;
    if (Math.abs(viewDeltaX) < 1e-6 && Math.abs(viewDeltaY) < 1e-6) return null;
    return Math.atan2(viewDeltaY, viewDeltaX) * 180 / Math.PI + offset;
}

/**
 * 屏上转角（度，逆时针为正）= 弹道方向 + 登记的朝向偏移。
 *
 * 弹道方向由**视图坐标**算出后传进来（`mapToViewX/Y` 的 x / y 缩放比不同，
 * 用逻辑坐标直接 `atan2` 会算歪，所以这一步留在视图层）。
 */
export function zcCombatEffectFacingDegrees(
    flightAngleDegrees: number,
    flight: IZCCombatEffectFlight | null | undefined,
): number {
    const base = Number.isFinite(flightAngleDegrees) ? flightAngleDegrees : 0;
    return base + (flight?.facingOffsetDegrees ?? 0);
}

/**
 * 一次攻击事件的**表现时长**（秒）—— 事件的寿命，不是结算时刻。
 *
 * | 情况 | 时长 |
 * | :-- | :-- |
 * | 登记了飞行段的 melee | `距离 / speed`，夹在 `[minSeconds, maxSeconds]` |
 * | 其它 melee / area | 沿用 `ZCCombatSystem.attackTravelSeconds` 的固定 0.32s |
 * | projectile | `距离 / projectileSpeed`（随距离变，本来就已经匹配射程） |
 *
 * `distance` 必须是**世界坐标**距离（调用点用 `distance(from.x, from.y, target.x, target.y)`），
 * 与 `speed` 的单位配对；乘 `combatDistanceScale` 的事在调用点之前已经做完了。
 */
export function zcCombatEffectTravelSeconds(
    mode: ZCCombatEventType,
    distance: number,
    projectileSpeed: number | undefined,
    effectPrefabPath: string | null | undefined,
): number {
    const flight = zcCombatEffectFlightOf(effectPrefabPath);
    if (mode === ZCCombatEventType.Melee && flight) {
        const raw = (Number.isFinite(distance) && distance > 0 ? distance : 0) / flight.speed;
        if (!Number.isFinite(raw)) return flight.minSeconds;
        return Math.min(flight.maxSeconds, Math.max(flight.minSeconds, raw));
    }
    // 未登记 ⇒ 逐字沿用 `ZCCombatSystem.attackTravelSeconds` 的两条分支，不另立口径。
    return mode === ZCCombatEventType.Projectile
        ? Math.max(1e-6, (Number.isFinite(distance) ? distance : 0) / (projectileSpeed || 500))
        : 0.32;
}
