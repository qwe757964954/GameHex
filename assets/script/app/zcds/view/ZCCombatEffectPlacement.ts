/**
 * 战斗特效的**播放锚点**（纯表现配置，刻意不进 `ZCSnapshot`）。
 *
 * 为什么单独一个模块：锚点只影响"画在哪"，不影响任何结算；混进模型 / 快照会牵动
 * `version` 与存档兼容（同 `floatTexts` / `hitFxs` / `buildingShakes` 的口径）。
 * 放在这里以后，`ZCCombatEffectView`（每帧定位）与 `ZCGameRenderWorld`（创建时初值）
 * **共用同一个函数**，不会出现"第一帧在 A、之后在 B"的跳变。
 *
 * ⚠️ 本文件必须保持**无 `cc` 依赖**：它是纯函数，`tests/zcds-combat-effect-placement.test.ts`
 * 直接 `import` 进来逐点断言（不需要视图夹具那套 vm 转译）。
 */
// `import type` 在编译后完全擦除 ⇒ 不影响本文件「无运行时依赖」的约束。
import type { ZCCombatEventType } from '../model/ZCCombatCatalog';
import type { ZCHitFxSurface } from '../model/ZCGameTypes';

/** 特效锚点：`caster` = 出手方（既有口径）、`midpoint` = 攻击者与受击目标的连线中点。 */
export type ZCCombatEffectAnchor = 'caster' | 'midpoint';

/** 特效层级：`ground` = 铺在地上（棋盘之上、所有动态对象之下）；`top` = 动态对象最上层。 */
export type ZCCombatEffectLayer = 'ground' | 'top';

/**
 * 按**特效 prefab 路径**配锚点；没配的一律 `caster`（既有行为，22 条近战特效全都走它）。
 *
 * 为什么用路径而不是技能 id：同一条技能在强化那一击会换成另一行特效（`empoweredProfile`），
 * 而**画出来的是哪张图**才是真正决定"该贴谁身上"的东西 —— 同一个 prefab 被两条技能行
 * 复用时（例如 30802 坚果重砸 / 30803 亡者护盾共用 `巨力坚果_普攻`），配一次就都对了。
 */
const ANCHOR_BY_PREFAB_PATH: Readonly<Record<string, ZCCombatEffectAnchor>> = {
    // 巨力坚果普攻（`pvpSkill` 30802「坚果重砸」/ 30803「亡者护盾」）。
    // 需求 2026-10-30：「巨力坚果的普通攻击特效…播放的位置改成巨力坚果和受击目标的坐标中点
    // （两个目标相连的中心点位置）」。改前近战特效一律贴出手点，坚果这一击看起来砸在自己身上。
    'units/projectiles/巨力坚果_普攻/巨力坚果_普攻': 'midpoint',
};

/** 特效路径 → 锚点。空路径 / 未登记 = `caster`。 */
export function zcCombatEffectAnchorOf(
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectAnchor {
    if (!effectPrefabPath) return 'caster';
    return ANCHOR_BY_PREFAB_PATH[effectPrefabPath] ?? 'caster';
}

/** 一次战斗事件里跟定位有关的两端（地图坐标，与 `mapToViewX/Y` 同一坐标系）。 */
export interface IZCombatEffectSpan {
    readonly fromX: number;
    readonly fromY: number;
    readonly toX: number;
    readonly toY: number;
}

/**
 * 锚点 → 逻辑坐标。
 *
 * `midpoint` 是**两端坐标的算术中点**（格心连线的中心），不做任何"再抬高多少"的补偿 ——
 * 高度补偿是美术摆位的事，留在 prefab 根节点的 `_lpos` 里（巨力坚果那一份已经归零）。
 *
 * 每次调用返回一个新对象：调用点是「每帧 × 屏上同时存在的特效数」（个位数），
 * 与 `unitPosition` 那种「46 单位 × 60 帧」的量级不同，不值得为此引入可变 scratch
 * 把纯函数弄脏（它是唯一能被无引擎用例逐点断言的形式）。
 */
export function zcCombatEffectAnchorPoint(
    span: Readonly<IZCombatEffectSpan>,
    anchor: ZCCombatEffectAnchor,
): { x: number; y: number } {
    if (anchor !== 'midpoint') return { x: span.fromX, y: span.fromY };
    return { x: (span.fromX + span.toX) * 0.5, y: (span.fromY + span.toY) * 0.5 };
}

/**
 * 弹道特效的**发射高度补偿**（视图 px，世界竖直、**不跟弹道旋转**）。
 *
 * ## 需求（2026-11-11）
 *
 * 原话：「部分射手/法师子弹的位置没有在角色中间发射出去，初始的发射位置调整：
 * 玉林好汉的飞镖上移 20px；三个小丑的子弹上移 30px」。
 *
 * ## 为什么要补偿
 *
 * `projectile` 分支把子弹节点摆在**弹道的逻辑坐标**上，而单位根节点是**逻辑脚点**
 * （`ZCUnitView` 口径：spine 骨架原点 ≈ 脚底，与 `ZCBeamEffect.muzzleLift` 注释同一结论）。
 * 脚点在地面，角色本体在它上方 30~70px ⇒ 子弹看起来「从脚下擦着地面飞出去」。
 *
 * ## 为什么是视图 px 而不是 prefab 的 `_lpos`
 *
 * 宿主节点每帧被 `setRotationFromEuler` 转到弹道方向，`_lpos` 是**子节点本地坐标**，
 * 会跟着转 —— 「上移」会变成「垂直于弹道的侧移」（往左打时反而往下掉）。
 * 这里加在 `mapToViewY(...)` 之后，就是屏幕竖直方向，与弹道光束的 `muzzleLift`
 * （注释原话「世界竖直、不跟弹道旋转」）完全同一口径。
 *
 * ## 数值口径
 *
 * 一格高 = 90 屏上 px，一个兵可见高 ≈ 67px ⇒ 20~30px 大约是「脚点 → 身体中心」的一半到全部。
 * 单位是**屏上 px**（`mapToViewY` 的输出已经是屏上 px），不需要再换算。
 *
 * ⚠️ 只登记需要偏离的 prefab，默认 `0`。光束类不在此表 —— 它们走 `ZCBeamEffect.muzzleLift`，
 *    两边同时开会叠成两笔。
 */
const PROJECTILE_LIFT_BY_PREFAB_PATH: Readonly<Record<string, number>> = {
    //  玉林好汉普攻（`pvpSkill` 30716）。强化那一击 30821 借的是**另一份 prefab**
    //  （`玉林好汉_飞镖普攻_强化`，同一套 256×254 画布、只是 `offset` 缩到 0.6125），
    //  两张都从同一个角色身上出手 ⇒ 高度必须一致，只改一张会让强化飞镖突然从脚下飞出去。
    'units/projectiles/玉林好汉_飞镖普攻/玉林好汉_飞镖普攻': 20,
    'units/projectiles/玉林好汉_飞镖普攻_强化/玉林好汉_飞镖普攻_强化': 20,
    //  三叶小丑普攻（`pvpSkill` 30714）。它的强化那一击是「飓风」（`area` 类地面区域），
    //  不走 `projectile` 分支，所以这里只有一条。
    'units/projectiles/三叶小丑_普攻/三叶小丑_普攻': 30,
};

/**
 * 特效路径 → 弹道竖直补偿（视图 px）。未登记 / 非法值 = `0`（贴原坐标，绝不把子弹甩飞）。
 */
export function zcCombatEffectLiftY(effectPrefabPath: string | null | undefined): number {
    if (!effectPrefabPath) return 0;
    const lift = PROJECTILE_LIFT_BY_PREFAB_PATH[effectPrefabPath];
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}

/**
 * 事件类型 → 特效层级（2026-10-30）。
 *
 *  需求原话：「火焰树妖_灼热地带技能的特效层级应该在角色类的下层，当角色走过会遮挡该火焰，
 *  形成火焰在脚底的视角」。
 *
 * 判据用**事件类型**而不是 prefab 路径：`area` 是「铺在地上的一片火」（`ZCGroundZoneSystem` 的地面
 * 持续区域 + 投射物落地的范围伤害），任何一条走的是同一个物理语义；而 `melee` / `projectile` 是
 * 「打在空中的一下」，必须在角色之上，否则刀光会被自己的身体挡住。
 */
export function zcCombatEffectLayerOf(type: ZCCombatEventType): ZCCombatEffectLayer {
    return type === 'area' ? 'ground' : 'top';
}

/**
 * 按**特效 prefab 路径**覆盖层级（2026-11-07）。
 *
 * 为什么需要：上面那条「`area` 一律铺地上」是按「一片火 / 一片雪」的物理语义定的，
 * 但 `area` 事件也可以是**一只会跑的生物**——鹿神守护 103405 的小鹿冲刺就是
 * 「小鹿 spine + 上层循环火特效」整段跟在区域上走。它按地面层插队会**压在所有单位之下**，
 * 冲刺撞进敌群里时小鹿会被敌兵盖住，而它显然不是「脚底的一摊火」。
 *
 * 判定用路径而不是技能 id：同一条技能强化那一击可以换行（`empoweredProfile`），
 * 画出来的是哪张图才决定它该在哪一层 —— 与 `ANCHOR_BY_PREFAB_PATH` 同一套口径。
 */
const LAYER_BY_PREFAB_PATH: Readonly<Record<string, ZCCombatEffectLayer>> = {
    'units/projectiles/鹿神守护/鹿神守护': 'top',
};

/** 特效路径 → 层级覆盖；未登记 = 走 `zcCombatEffectLayerOf(事件类型)`。 */
export function zcCombatEffectLayerOfPath(
    type: ZCCombatEventType,
    effectPrefabPath: string | null | undefined,
): ZCCombatEffectLayer {
    if (effectPrefabPath) {
        const override = LAYER_BY_PREFAB_PATH[effectPrefabPath];
        if (override) return override;
    }
    return zcCombatEffectLayerOf(type);
}

/**
 * 特效路径 → 预制体里「按阶段开关」的**叠层子节点名**（2026-11-12 鹿神守护改追踪弹）。
 *
 * 需求原话：「贴近目标后的移速快（140PX，**同步在小鹿身上覆盖火船特效**）」——
 * 火船只在提速扑击那一段烧起来，慢速赶路时身上是干净的。
 *
 * 为什么用「模型给语义、视图查表」而不是把节点名写进配表：`skillParamJson` 只有数值槽，
 * 而且模型层不该知道 prefab 内部结构。模型只推一个 `overlayFx` 布尔值，
 * 点哪个子节点由这张表决定 —— 换美术 / 改节点名只改这里一处。
 *
 * ⚠️ 节点必须在**预制体根节点**直下（视图用 `visualNode.getChildByName` 找）；
 *    鹿神守护那份的结构是 root → `spine` + `fx_火船`（见 `tools/build_deer_guard_fx.py`）。
 */
const OVERLAY_CHILD_BY_PREFAB_PATH: Readonly<Record<string, string>> = {
    'units/projectiles/鹿神守护/鹿神守护': 'fx_火船',
};

/** 特效路径 → 叠层子节点名；未登记 = `null`（视图一次都不碰 `active`）。 */
export function zcCombatEffectOverlayChild(effectPrefabPath: string | null | undefined): string | null {
    if (!effectPrefabPath) return null;
    return OVERLAY_CHILD_BY_PREFAB_PATH[effectPrefabPath] ?? null;
}

/**
 * 层级 → `mapLayer` 里的 `siblingIndex`。
 *
 * 🔴 `mapLayer`（`MapScrollView/view/content`）里**所有动态对象都是平铺的兄弟节点**，
 *   没有「单位层 / 特效层」这种容器。它们的规则是「新建就 `setSiblingIndex(children.length-1)`」，
 *   也就是**谁后创建谁在上** —— 特效一旦先建、角色后建，遮挡关系就反过来。
 *   所以地面的东西必须**显式插队到棋盘之后**，不能靠创建顺序。
 *
 * @param boardIndex `ZCGameBoard` 在 `mapLayer` 里的下标（地块全在它内部）
 * @param siblingCount **含自己**的兄弟数（节点已 `setParent` 到末尾）
 */
export function zcCombatEffectSiblingIndex(
    layer: ZCCombatEffectLayer,
    boardIndex: number,
    siblingCount: number,
): number {
    const last = Math.max(0, siblingCount - 1);
    if (layer === 'top') return last;
    // 棋盘之后第一个位置 = 地块之上、所有动态对象之下。
    return Math.max(0, Math.min(boardIndex + 1, last));
}

/**
 * 受击特效的**锚点纵向补偿**（视图 px）——按"这一下打在什么上"。
 *
 * 2026-11-06 需求：「建筑单位或城墙单位受到攻击时，也要播放对应的职业的受击特效，
 * 比如城墙被战士职业角色攻击，在**城墙图片的中心坐标点**播放战士受击」。
 *
 * 模型只给**格心**（`hexCenter`，与飘字同源），但三样东西在屏幕上并不都画在格心：
 *
 * | 打在哪 | 图在哪 | 补偿 |
 * | :-- | :-- | :-- |
 * | 单位 | 跟着 `freeX/freeY` 走 | 0（`ZCHitFx.x/y` 已经是单位本体坐标） |
 * | 城墙 | 铺在本格六条边上，整圈的中心 = 格心 | 0 |
 * | 建筑 | `ZCGameHex.prefab` 的 `BuildingIcon`，挂在 **(0, +15.651)** | +15.651 |
 *
 * 15.651 是那格 prefab 的**美术摆位**（`BuildingLayer` 在 +15.101，`BuildingIcon` 再 +0.55），
 * 不是代码算出来的 —— 所以 `tests/zcds-structure-hit-fx.test.ts` 有一条守卫**直接读 prefab**
 * 把这两个数对起来：美术挪了图、这里没跟着改，用例会红。
 */
const HIT_FX_SURFACE_LIFT_Y: Readonly<Record<ZCHitFxSurface, number>> = {
    unit: 0,
    wall: 0,
    building: 15.651,
};

/** 受击特效的纵向补偿（视图 px）；未知语义 / 非法值 = 0（贴格心，绝不把特效甩飞）。 */
export function zcHitFxSurfaceLiftY(surface: ZCHitFxSurface | null | undefined): number {
    if (!surface) return 0;
    const lift = HIT_FX_SURFACE_LIFT_Y[surface];
    return typeof lift === 'number' && Number.isFinite(lift) ? lift : 0;
}
