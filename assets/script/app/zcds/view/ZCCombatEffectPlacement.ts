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
