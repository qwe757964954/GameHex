import type { sp, SpriteFrame } from 'cc';

/**
 * 大招通报的样式与曲线（零 `cc` 运行时依赖，只有类型 import）。
 *
 * 与 `ZCSettlementStyle` / `TerritoryMonsterBoxFx` 同构：把「数值口径 + 纯函数」从视图里
 * 拆出来，视图只剩节点组装。这样比例 / 描边 / 出入场曲线都能被单测直接 import 断言，
 * 不必为看一眼数字去搭整套 `cc` 沙箱。
 *
 * 需求原文（用户 2026-11-25）：「战斗中，玩家方的橙色品质的卡首次释放任意的主动技能时
 * 播放通报特效。在特效上叠加卡牌的形象图片…伴随特效出来的还有技能名字，在形象的下方，
 * 使用白色粗体字 + 黑色描边 2px，整个特效的比例贴近参考图」。
 */

/**
 * 卡面形象的目标高度（逻辑 px）。
 *
 * 取自参考图比例：323×691 的手机截图上形象约 90×73（原图 px），按 720 宽设计稿归一
 * ⇒ 高约 165、占屏高约 13%。别再放大：通报挂在全屏演出层（`overlayLayer`），
 * 不跟棋盘缩放走，改大就会压住左侧玩家列表。
 */
export const ZC_SKILL_ANNOUNCE_ART_HEIGHT = 165;

/** 技能名字号（逻辑 px，参考图约 30）。 */
export const ZC_SKILL_ANNOUNCE_NAME_SIZE = 30;

/** 名字顶边离形象底边的间距（逻辑 px）。 */
export const ZC_SKILL_ANNOUNCE_NAME_GAP = 6;

/** 名字描边宽度（用户口径「黑色描边 2px」）。 */
export const ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH = 2;

/** 入场缩放的起始比例（0.72 → 1，弹出感，不遮挡过多棋盘）。 */
export const ZC_SKILL_ANNOUNCE_POP_FROM = 0.72;

/** 入场段在整条时间轴上的占比（2.3s × 0.14 ≈ 0.32s）。 */
export const ZC_SKILL_ANNOUNCE_POP_RATIO = 0.14;

/** 淡出段占比（尾部 28% ≈ 0.64s，与队列生命周期同步收尾）。 */
export const ZC_SKILL_ANNOUNCE_FADE_RATIO = 0.28;

/** 底光目标高度相对形象高度的倍率：比形象略大一圈，露出光晕边。 */
export const ZC_SKILL_ANNOUNCE_SPINE_SCALE = 1.35;

/**
 * 时长缺省值（秒），与 `ZCBattlePresentationQueue.ZC_SKILL_ANNOUNCE_SECONDS` 同值。
 *
 * 刻意**不 import** 那个常量：本文件会被 `ZCGameRenderWorld` 值导入，而视图单测的夹具
 * （`tests/helpers/zcds-view-fixtures.ts` 的 `load()`）只按 `zcds/view|ui` 两个目录解析
 * 相对模块名，反过来引 model 会让整组渲染用例报「Missing view fixture module」一起红
 * （2026-11-25 实测：render-performance 一组 7 条全红）。一致性由
 * `tests/zcds-skill-announce.test.ts` 直接断言两者相等来兜住，改一处另一方漏改会立刻红。
 */
export const ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS = 2.3;

/**
 * 一条通报的整块高度（形象 + 间距 + 名字含描边）。
 *
 * 纵向排队按这个高度算步进，所以它必须是**唯一**口径 —— 视图里 `createZCSkillAnnounceNode`
 * 的 `UITransform` 高度与排队步进都取这里，改字号/形象高不会让两条叠在一起。
 */
export const ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT = ZC_SKILL_ANNOUNCE_ART_HEIGHT
    + ZC_SKILL_ANNOUNCE_NAME_GAP
    + ZC_SKILL_ANNOUNCE_NAME_SIZE + ZC_SKILL_ANNOUNCE_OUTLINE_WIDTH * 2;

/**
 * 纵向排队的项间距（逻辑 px）—— 用户口径 2026-11-25：「往下依次排队不重叠，间隔 3px」。
 *
 * 量的是**上一块的底边到下一块的顶边**，不是中心距（中心距 = 块高 + 本值）。
 */
export const ZC_SKILL_ANNOUNCE_STACK_GAP = 3;

/**
 * 同时最多展示几条（用户口径 2026-11-25：「超过 3 个时，后面的不展示了」）。
 *
 * 超出直接**不播**（不是排队等空位）：通报是「这一下放了什么技能」的即时反馈，
 * 晚两秒再弹出来反而让人对不上是谁放的。
 */
export const ZC_SKILL_ANNOUNCE_STACK_MAX = 3;

/**
 * 拿不到玩家列表节点时的兜底锚点（全屏演出层局部坐标）。
 *
 * 720×1280 设计稿里玩家列表占左上角约 280 高 ⇒ 顶边 y ≈ 360。
 * 只有 HUD 还没建好（或单测桩）时才会走到这里，正常局一律按列表真实底边算。
 */
export const ZC_SKILL_ANNOUNCE_STACK_FALLBACK_TOP_Y = 360;
/** 兜底锚点的横向中心：与玩家列表（设计稿 308 宽、左贴 24）大致对齐。 */
export const ZC_SKILL_ANNOUNCE_STACK_FALLBACK_X = 178;

/**
 * 第 `slot` 条（0 起）的**中心** y —— 锚点是列表底边（第一条的顶边）。
 *
 * 顶边 = 锚点 − slot × (块高 + 间距)，中心再往下半个块高。
 */
export function zcSkillAnnounceSlotCenterY(anchorTopY: number, slot: number): number {
    const step = ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT + ZC_SKILL_ANNOUNCE_STACK_GAP;
    return anchorTopY - (ZC_SKILL_ANNOUNCE_BLOCK_HEIGHT / 2) - Math.max(0, slot) * step;
}

/**
 * 会触发通报的技能类型（`pvpSkillPlan.skillKind`）。
 *
 * 用户口径 2026-11-25：「只报主动技能名字，普通攻击和特效名字不需要；触发类型是
 * 『主动冷却』或『主动累计普攻』的都播报 1 次」。
 *
 * | 表里的值 | 中文 | 播报 |
 * | :--- | :--- | :--- |
 * | `active_cd` | 主动冷却 | ✅ |
 * | `active_attack` | 主动累计普攻（武将技那一击） | ✅ |
 * | `passive_stat` | 被动（属性 / 常驻光环 / 子链） | ❌ |
 *
 * `passive_stat` 占了全表 2311 行里的 2137 行（子链、尾巴、owner 级加成都在里面），
 * 不按类型筛就等于「只要事件带 skillId 就报」，普攻行与被动表现全都会弹。
 */
export const ZC_ANNOUNCE_SKILL_KINDS: readonly string[] = ['active_cd', 'active_attack'];

/** 这条技能类型该不该通报（见 {@link ZC_ANNOUNCE_SKILL_KINDS}）。*/
export function zcIsAnnounceSkillKind(kind: string | undefined | null): boolean {
    if (typeof kind !== 'string') return false;
    return ZC_ANNOUNCE_SKILL_KINDS.includes(kind.trim());
}

function clamp01(value: number): number {
    if (!(value > 0)) return 0;
    return value >= 1 ? 1 : value;
}

/**
 * 入场缩放（0→1 进度 → 缩放倍率）。
 *
 * 取 easeOutCubic：与 `ZCGameLegendBannerView` 的立绘生成段同族，出手快、落位稳。
 * 非有限值一律按「还没开始」处理 —— `NaN` 会让 `setScale` 把整节点弄没（且不报错）。
 */
export function zcSkillAnnouncePopScale(progress: number): number {
    const k = clamp01(progress / ZC_SKILL_ANNOUNCE_POP_RATIO);
    const eased = 1 - (1 - k) ** 3;
    return ZC_SKILL_ANNOUNCE_POP_FROM + (1 - ZC_SKILL_ANNOUNCE_POP_FROM) * eased;
}

/**
 * 整条通报的透明度（0~1）。
 *
 * 入场线性淡入、中段恒 1、尾部线性淡出；三段都按占比算，改时长不用改这里。
 */
export function zcSkillAnnounceOpacity(progress: number): number {
    const fadeStart = 1 - ZC_SKILL_ANNOUNCE_FADE_RATIO;
    const fadeIn = clamp01(progress / ZC_SKILL_ANNOUNCE_POP_RATIO);
    const fadeOut = clamp01((progress - fadeStart) / ZC_SKILL_ANNOUNCE_FADE_RATIO);
    return Math.max(0, Math.min(fadeIn, 1 - fadeOut));
}

/**
 * 通报的进度（0~1）：起点之前 0、超时 1、时长非法按缺省值。
 *
 * 起点由模型给（`startedAt`），视图只负责折算 —— 与飘字 / 受击特效同一套时间口径。
 */
export function zcSkillAnnounceProgress(now: number, startedAt: number, durationSeconds: number): number {
    const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : ZC_SKILL_ANNOUNCE_FALLBACK_SECONDS;
    const elapsed = now - startedAt;
    if (!(elapsed > 0)) return 0;
    return elapsed >= duration ? 1 : elapsed / duration;
}

/**
 * 形象在目标高度下的宽度。
 *
 * `cardHead` 那批是 256×256 方图，但自动图集切出来的 frame 不一定等宽，所以按
 * `originalSize` 等比算；拿不到尺寸时退回正方形（= 目标高），不返回 0（0 尺寸看不到）。
 */
export function zcSkillAnnounceArtWidth(
    frame: SpriteFrame | null | undefined,
    targetHeight = ZC_SKILL_ANNOUNCE_ART_HEIGHT,
): number {
    const baseHeight = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : ZC_SKILL_ANNOUNCE_ART_HEIGHT;
    if (!frame) return baseHeight;
    const size = frame.originalSize ?? frame.rect;
    const height = size && size.height > 0 ? size.height : 0;
    const width = size && size.width > 0 ? size.width : 0;
    if (!height || !width) return baseHeight;
    return baseHeight * (width / height);
}

/**
 * 骨架里的第一条动画名。
 *
 * `sp.SkeletonData` 本身不带动画列表（3.8.8 里 `animations` 不在公开字段上），必须走
 * `getRuntimeData(true)` —— 与 `ZCTestKapaiStage` 读骨架高度是同一条公开出口。
 * 取不到返回空串，调用方就不播（底光停在第 0 帧，仍可见），不抛错。
 */
export function zcSkillAnnounceAnimationOf(data: sp.SkeletonData | null | undefined): string {
    if (!data) return '';
    try {
        const runtime = data.getRuntimeData(true) as { animations?: readonly { name?: string }[] } | null;
        const name = runtime?.animations?.[0]?.name;
        return typeof name === 'string' ? name : '';
    } catch {
        return '';
    }
}

/**
 * 底光节点的缩放：把骨架的**画布高**折算到「形象高 × {@link ZC_SKILL_ANNOUNCE_SPINE_SCALE}」。
 *
 * 不能直接 `setScale(1.35)`：`landscape_tab_anim` 的画布是 352×352，而卡面只有 165 高，
 * 照抄倍率会把底光放大到 475 高、把形象整个盖住（而且不报错，只是"看起来不对"）。
 * 画布高度走 `getRuntimeData(true).height`（`ZCUnitView.spineCanvasHeight` /
 * `CardUnitPreview` 同一条路）；拿不到就退回 1 —— 宁可按原尺寸，也不能返回 0（0 缩放在屏上就是没有）。
 */
export function zcSkillAnnounceGlowScale(
    data: sp.SkeletonData | null | undefined,
    targetHeight = ZC_SKILL_ANNOUNCE_ART_HEIGHT,
): number {
    if (!data) return 1;
    const baseHeight = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : ZC_SKILL_ANNOUNCE_ART_HEIGHT;
    let canvasHeight = 0;
    try {
        const runtime = data.getRuntimeData(true) as { height?: number } | null;
        canvasHeight = typeof runtime?.height === 'number' ? runtime.height : 0;
    } catch {
        canvasHeight = 0;
    }
    if (!(canvasHeight > 0)) return 1;
    return baseHeight * ZC_SKILL_ANNOUNCE_SPINE_SCALE / canvasHeight;
}

/**
 * 行为车道的一次「真施法」→ 通报要写的技能名。
 *
 * 🔴 为什么需要这张表（2026-11-25 用户报「新加的橙卡播报不展示」）
 *
 * 通报原本只看战斗事件：`empowered`（武将技）或 `skillId ∈ activeSkillIds`
 * （普攻行上的 `empoweredSkillId` / `secondarySkillId`）。这套判据对
 * 「武将技 = 累计普攻第 N 次的那一击」成立（大威天芦「天降神拳」就是这么播的），
 * 但**新加的橙卡（吉他手 / 运动霸 / 魔术师 / 科学家）的主动技根本不在那条链上**：
 *
 * | 卡 | 主动技（`pvpSkillPlan.skillKind=active_cd`） | `pvpSkill` 里有行吗 |
 * | :--- | :--- | :--- |
 * | 68035 科学家 | 精密陷阱 `trap_place`（射线集束已补 30856 行，走事件路径） | **没有**（精密陷阱） |
 * | 68034 魔术师 | 移形换影 `blink_strike` | **没有** |
 * | 68032 吉他手 | 声波扫射 / 死亡摇滚 | 有（`secondarySkillId` 那条腿能播） |
 *
 * 这些车道在 `ZCSkillResolutionSystem` 里一律拿 `definition.attackProfile` 结算伤害 ⇒
 * 事件的 `skillId` 就是**本卡普攻行**、`skillName` 是「科学家普攻」，`isActiveSkillCast`
 * 第一道排除条件直接把它当普攻丢掉；`empoweredEvery` 又是 0 ⇒ 连 `empowered` 那条腿也没有。
 * 表现就是「怎么放都不播」，而且一条错都不报。
 *
 * ⇒ 通报改从「施法成功那一拍」发起（`ZCGameModel` 包住 `ZC_*` 车道回调），
 * 名字到这张索引里按 `unitId:behaviorKey` 查。查不到就不播 —— 宁可没有，也不能拿
 * 「XX普攻」/`blink_strike` 这种键名冒充技能名（`ZCSkillTriggerSystem` 的闪现事件
 * 就是这么把 `behaviorKey` 写进 `skillName` 的）。
 */
export interface IZCAnnounceSkillPlanLike {
    readonly unitId: string;
    readonly behaviorKey?: string;
    readonly skillName?: string;
    /** `pvpSkillPlan.skillKind`（`active_cd` / `active_attack` / `passive_stat`）。*/
    readonly skillKind?: string;
}

/**
 * `unitId:behaviorKey` → 技能名（车道技取名，**只收主动技能**）。
 *
 * 同名多级行（Lv1~3）取先出现的那个（名字本来就一样）。`skillKind` 不是
 * `active_cd` / `active_attack` 的行一律不进索引 —— 用户口径「只报主动技能名字，
 * 普通攻击和特效名字不需要」（判据见 {@link zcIsAnnounceSkillKind}）。
 *
 * 同一 `unitId:behaviorKey` 既有被动又有主动行时（如 `skill_params` 被
 * 穿甲苔刺 / 苔针双连两条被动与豌豆机关枪这条主动共用），先过滤类型就不会被被动那条抢走。
 */
export function zcAnnounceSkillNameIndex(
    plans: Iterable<IZCAnnounceSkillPlanLike> | null | undefined,
): ReadonlyMap<string, string> {
    const index = new Map<string, string>();
    if (!plans) return index;
    for (const plan of plans) {
        if (!plan || !zcIsAnnounceSkillKind(plan.skillKind)) continue;
        const behavior = typeof plan.behaviorKey === 'string' ? plan.behaviorKey.trim() : '';
        const name = typeof plan.skillName === 'string' ? plan.skillName.trim() : '';
        const unitId = typeof plan.unitId === 'string' ? plan.unitId : '';
        if (!unitId || !behavior || !name) continue;
        const key = `${unitId}:${behavior}`;
        if (!index.has(key)) index.set(key, name);
    }
    return index;
}

/**
 * **全表**主动技能名字集合（事件路径的放行名单）。
 *
 * 事件路径（`empowered` 武将技那一击 / `activeSkillIds`）只拿得到事件上写的名字，
 * 而那名字可能是「豌豆普攻」「·强化」变体，甚至是 `behaviorKey` 原文
 * （`ZCSkillTriggerSystem` 的闪现事件就这么写）。用名单判一次，普攻名与被动/特效名进不来。
 *
 * 🔴 **不按 `unitId` 分桶**：`pvpSkill` 里副轨是跨卡借用的 —— 科学家普攻行
 * （`30709`）的 `secondarySkillId` 就是 30856「射线集束」，而「射线集束」的计划行登记在
 * 机甲菇 68015 名下（`101504`）。按 unitId 分桶会把科学家这一发挡掉（真机上它确实放得出来）。
 * 反过来按名字查也不会误放普攻名：`pvpSkillPlan` 里**没有任何**行叫「XX普攻」（普攻行不在
 * 这张表里），所以「普攻」两个字根本不在名单中。
 */
export function zcAnnounceActiveNames(
    plans: Iterable<IZCAnnounceSkillPlanLike> | null | undefined,
): ReadonlySet<string> {
    const out = new Set<string>();
    if (!plans) return out;
    for (const plan of plans) {
        if (!plan || !zcIsAnnounceSkillKind(plan.skillKind)) continue;
        const name = typeof plan.skillName === 'string' ? plan.skillName.trim() : '';
        if (name) out.add(name);
    }
    return out;
}
