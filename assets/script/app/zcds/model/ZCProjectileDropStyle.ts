/**
 * 「区域洒弹」的表现口径：子弹从区域**上方垂直落下**（零 `cc` 运行时依赖）。
 *
 * 2026-11-25 用户需求（第 52 批）：
 * 「篮球天才，急冻瓜，杰克藕这种在指定区域内发射子弹的都需要，让子弹呈弧线飞行到区域的任意
 * 坐标内……或者选择方案 2 在区域的上方垂直往下掉，哪个方案实行快就用哪个」。
 *
 * 选了**方案 2**（垂直下落），原因写在这里免得以后有人问「为什么不是弧线」：
 *
 * | 方案 | 要动的地方 | 代价 |
 * | :-- | :-- | :-- |
 * | 1 弧线飞入 + 触碰判定 | 弹体飞行 + 碰撞检测 + 把「区域 tick / 锁定目标」改成「命中判定」 | 改**战斗结算**，三张卡的数值模型全变（区域 3 秒 × 每 0.5 秒 tick → 单发命中） |
 * | 2 上方垂直下落 | 表现事件多一个竖直起始偏移，视图按进度递减 | **纯表现**，结算与数值一个字节不动 |
 *
 * 所以这一批只改「子弹怎么落到那一点」，不改「落到之后伤谁、伤多少」。
 * 真要「没碰到就没伤害」，那是另一批的战斗结算改造。
 *
 * ## 第 53 批（2026-11-25）拆成两种口径
 *
 * 用户对**篮球火**另有口径：「子弹从本地移动到命中区域去」。于是本文件同时提供
 * 两条互相独立的纯表现通道，按单位名单分流：
 *
 * - {@link ZC_BULLET_DROP_UNITS} 上方垂直落下（杰克藕 / 急冻瓜）
 * - {@link ZC_BULLET_FLY_UNITS} 从施法者飞向圆心（篮球天才）
 *
 * 两张表**故意分开**，也都没有语义重叠：同一张卡要么掉、要么飞。
 *
 * ## 复用范围圈的名单，但语义独立
 *
 * 名单与 `ZCSkillRangeRingFx.ZC_SKILL_RANGE_RING_UNITS` 相同（就是这三张卡），
 * 但两张表**故意分开**：范围圈是「这个技能有区域判定」，落下是「这个技能的子弹从天上掉」。
 * 哪天出现「要圈但不要掉」的卡，改这张表就行，不用连带把圈关掉。
 */

/**
 * 走「上方垂直落下」的单位。
 *
 * - `68008` 杰克藕：戈壁箭雨（`random_strike`，每波 5 支箭分别落到 5 个目标头上）
 * - `68024` 急冻瓜：冰山陨落（`self_aura` 的落地那一击，冰弹砸进圈里）
 *
 * 🔴 `68030` 篮球天才**不在这张表**里（2026-11-25 第 53 批）。用户原话：
 * 「篮球少年的【篮球火】…子弹从本地移动到命中区域去」—— 篮球是**手里扔出去的**，
 * 从天上掉下来读成「凭空砸」。它改走 {@link ZC_BULLET_FLY_UNITS}。
 */
export const ZC_BULLET_DROP_UNITS: readonly string[] = ['68008', '68024'];

/**
 * 起始竖直高度（**屏幕 px**，不是世界坐标）。
 *
 * 84 ≈ 0.93 个格面高（`HEX_GRID_FACE_HEIGHT = 90`）：够看出「从上面掉下来」，
 * 又不会飞到屏幕外。它加在 `mapToViewY` 之后 ⇒ 是屏幕竖直方向，
 * 与 `visualLiftPx` 同一口径（写进 prefab 的 `_lpos` 会被转角转成侧移）。
 */
export const ZC_BULLET_DROP_HEIGHT_PX = 84;

/** 这个单位要不要「从上方落下」；不在名单里返回 0（= 保持原地播，存量逐字不变）。*/
export function zcBulletDropHeightOf(unitId: string | null | undefined): number {
    if (unitId == null || !ZC_BULLET_DROP_UNITS.includes(unitId)) return 0;
    return ZC_BULLET_DROP_HEIGHT_PX;
}

/**
 * 某一帧的竖直偏移 = `height × (1 − progress)`：开头在上方，落地那一刻归 0。
 *
 * `progress` 越界 / 非数字一律夹到 `[0, 1]` —— `NaN` 泄进 `setPosition` 会让整层矩阵变 `NaN`。
 */
export function zcBulletDropOffsetPx(heightPx: number, progress: number): number {
    if (!(heightPx > 0) || !Number.isFinite(heightPx)) return 0;
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
    return heightPx * (1 - p);
}

/* ────────────────────────── 飞入段（第 53 批） ────────────────────────── */

/**
 * 走「**从施法者飞向区域圆心**」的单位。
 *
 * - `68030` 篮球天才：篮球火（`mode: area`，`areaRadius 110 / durationSeconds 3 / waves 1`）
 *
 * 用户口径（2026-11-25）：
 * 「以敌方为目标，在目标坐标释放命中区域，**子弹从本地移动到命中区域去**，没有目标就不释放」。
 *
 * ## 与「垂直下落」的区别只在一件事：起点
 *
 * | | 起点 | 观感 |
 * | :-- | :-- | :-- |
 * | 垂直下落（`dropFromPx`） | 圆心正上方 `84` 屏 px | 天上砸下来 |
 * | 飞入段（本节） | **施法者当时的坐标** | 手里扔出去 |
 *
 * 两者都**只动表现位置**：区域的 `zone.x/zone.y`、命中判定、伤害结算一个字节都不改
 * （`resolveWave` 只把这些数写进事件，视图拿来做插值）。
 *
 * ## 为什么不做成「让区域真的飞过去」
 *
 * 区域自带 `flightSeconds`（投掷陷阱 101704 那一套，`settleFlight` 每帧推 `zone.x/y`）。
 * 但篮球火是 `waves: 1`、波次间隔就 3 秒，区域一旦真的位移，第一波伤害要么落在施法者
 * 脚下结算、要么得把 `nextWaveAt` 往后推 —— 两种都是**改战斗节奏**。用户要的是
 * 「命中区域在目标坐标」，判定就该从第一拍起钉在那里。
 */
export const ZC_BULLET_FLY_UNITS: readonly string[] = ['68030'];

/**
 * 飞入段的**世界 px / 秒**。取 600 ≈ 普攻弹道那一档（篮球天才 30702 的
 * `projectileSpeed` 是 500），飞一个格子大约 0.1 秒，看得出过程又不拖沓。
 */
export const ZC_BULLET_FLY_SPEED = 600;

/**
 * 飞入段时长夹取范围（秒）。
 *
 * 下限 0.15：贴脸时也别一帧到位（`0.02s` 看起来就是「直接出现在那」）；
 * 上限 0.55：远距离也别飞太久，区域寿命只有 3 秒，飞太长得占掉三分之一。
 */
export const ZC_BULLET_FLY_MIN_SECONDS = 0.15;
export const ZC_BULLET_FLY_MAX_SECONDS = 0.55;

/**
 * 飞入段的**弧线峰高**（屏幕 px）。与投掷陷阱那一格同值（`ZC_TRAP_FLIGHT_ARC_PX = 92`）：
 * 一格地砖差不多高，起飞与落地都是 0、中途最高（`4h·p·(1−p)`）。
 *
 * 加在 `mapToViewY` 之后 ⇒ 屏幕竖直方向，不跟弹道转角走。
 */
export const ZC_BULLET_FLY_ARC_PX = 92;

/** 这个单位的区域表现要不要「从施法者飞过来」。不在名单里返回 0 ⇒ 保持原地播。*/
export function zcBulletFlySecondsFor(unitId: string | null | undefined, distance: number): number {
    if (unitId == null || !ZC_BULLET_FLY_UNITS.includes(unitId)) return 0;
    const d = Number.isFinite(distance) ? Math.max(0, distance) : 0;
    const raw = d / ZC_BULLET_FLY_SPEED;
    if (!Number.isFinite(raw)) return ZC_BULLET_FLY_MIN_SECONDS;
    return Math.min(ZC_BULLET_FLY_MAX_SECONDS, Math.max(ZC_BULLET_FLY_MIN_SECONDS, raw));
}

/** 这个单位的飞入弧线峰高；不在名单里返回 0（= 直线飞，不加抬升）。*/
export function zcBulletFlyArcPx(unitId: string | null | undefined): number {
    return unitId != null && ZC_BULLET_FLY_UNITS.includes(unitId) ? ZC_BULLET_FLY_ARC_PX : 0;
}

/**
 * 飞入进度 `[0, 1]`：`elapsed` 秒经过 `seconds` 秒后到 1（之后一直停在 1 = 钉在圆心）。
 *
 * 非数字 / 非正时长一律退 1（= 已经落地），避免 `NaN` 泄进插值。
 */
export function zcBulletFlyProgress(elapsed: number, seconds: number): number {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return 1;
    const t = Number.isFinite(elapsed) ? elapsed : seconds;
    return Math.max(0, Math.min(1, t / seconds));
}

/**
 * 飞入段的竖直抬升：抛物线 `arc × 4p(1−p)` —— 起飞 0、正中最高、落地 0。
 *
 * ⚠️ 2026-11-26 第 55 批起视图**不再调它**：飞入段改走二次贝塞尔（{@link zcBulletBezierOffsetPx}），
 * 抛物线只有峰高一个自由度，一批子弹会重叠成同一条线。留着是因为它是「峰高」的一维口径对照
 * （用例 `zcds-basketball-fly-batch53` 拿它钉峰高定义）。新代码用贝塞尔那一对。
 */
export function zcBulletFlyArcOffsetPx(arcPx: number, progress: number): number {
    if (!(arcPx > 0) || !Number.isFinite(arcPx)) return 0;
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
    return arcPx * 4 * p * (1 - p);
}

/* ────────────────────────── 弹道雨（第 55 批） ────────────────────────── */

/**
 * 「从施法者抛出一批子弹、各自沿贝塞尔弧线落到区域内任意点」的口径。
 *
 * 2026-11-26 用户需求（第 55 批），原话：
 * 「杰克藕的戈壁箭雨、急冻瓜的冰山陨落、篮球天才的篮球火，三个卡牌的技能都是
 * 从自身发射多个技能子弹到区域的任意落点，**子弹呈贝塞尔曲线飞行**」。
 *
 * 与第 52/53 批那两条通道的关系：
 *
 * | 通道 | 起点 | 落点 | 颗数 | 轨迹 |
 * | :-- | :-- | :-- | :-- | :-- |
 * | `dropFromPx`（第 52 批） | 区域正上方 | `to` | 1 | 竖直直落 |
 * | `fly*`（第 53 批） | 施法者 | `to` | 1 | 对称抛物线 |
 * | **本批 `ZC_BULLET_RAIN_UNITS`** | 施法者 | **区域内随机点** | **N** | **二次贝塞尔** |
 *
 * ## 为什么「落点」要另起一对字段
 *
 * `to` 是区域判定圆心，改它等于改战斗结算（`zcGroundZoneReaches` 会跟着挪）。
 * 所以本批新增 {@link ZCCombatEvent.flyToX} / `flyToY` 专门承载**表现落点**：
 * `to` 一动不动、`flyTo*` 只决定子弹看起来落在哪。两者解耦，纯表现。
 *
 * ## 为什么是贝塞尔而不是抛物线
 *
 * 抛物线 `4h·p(1−p)` 只有「峰高」一个自由度，多条弹道只能重叠成同一条线。
 * 二次贝塞尔多一个**横向控制点** ⇒ 每颗子弹能给出不同的侧摆（{@link ZCBulletRainStyle.swayPx}），
 * 一批子弹散开成扇形，也才能做出「先斜冲上去、再兜下来」的手感（用户参考图 3）。
 *
 * 数学上：控制点取「连线中点 + (2·sway, 2·arc)」时，
 * `B(0.5) = 中点 + (sway, arc)` ⇒ `arcPx` / `swayPx` 就是**中点处的抬升与侧摆**，
 * 与旧 `flyArcPx` 的「峰高」同口径，换算关系见 {@link zcBulletBezierOffsetPx}。
 */
/**
 * 弹道雨跑在哪条行为通道上。
 *
 * 🔴 必须按通道分流，不能只按单位：同一张卡的不同技能可能落在不同通道上，
 * 而 `random_strike` 上有**两个**属于 68024 的技能 —— 冰山陨落（`self_aura`，本需求要改）
 * 与急冻光线（`random_strike`，本需求没提）。只看 `unitId` 会把急冻光线也改成三颗弧线。
 */
export type ZCBulletRainChannel = 'strike' | 'aura' | 'zone';

export interface ZCBulletRainStyle {
    /** 这份口径作用在哪几条通道上（见 {@link ZCBulletRainChannel}）。 */
    channels: readonly ZCBulletRainChannel[];
    /**
     * 每次技能发几颗。
     *
     * `strike` 通道（戈壁箭雨）**以配表 `strikeCount` 为准**（5/6/8 三档），这里的值只是
     * 缺省与锚点；`aura` / `zone` 两条通道配表里没有对应字段 ⇒ 只认这里的值。
     */
    count: number;
    /** 弧线峰高（屏幕 px）：控制点高度的**一半**，即中点处的抬升量。逐颗会在它上下浮动，见 {@link zcBulletRainArcPx}。 */
    arcPx: number;
    /** 单侧最大横向摆动（屏幕 px）：按颗序号摊开 + 确定性抖动，让同批弹道不重叠且各不相同。 */
    swayPx: number;
    /** 落点散布半径 ÷ 区域半径。1 = 铺满整圈，>1 会飞出圈外。 */
    spreadRatio: number;
    /** 子弹姿态是否跟着弹道转（`true`）还是固定用事件 `angleDegrees`（`false`）。 */
    faceAlongPath: boolean;
    /**
     * **命中特效**：子弹到达落点后消失，在原地播这一个 prefab（2026-11-26 第 56 批）。
     *
     * 用户原话：「子弹命中指定坐标消失，在坐标处播放受击特效」。
     * 为什么必须在这里登记而不是复用 `pvpSkill.impactEffectPrefabPath`：
     * 三张卡的**弹体**走的是三套完全不同的来源（`attackProfile` / `SELF_AURA_LANDING_FX` /
     * `zone.effectPrefabPath`），配置行里也没有一个统一的「这一发砸下去算什么」槽位。
     */
    impactPrefabPath: string;
    /** 命中特效播多久（与 prefab 序列帧等长；`普攻爆炸` 31 帧 ≈ 1.0s、冰爆 13 帧 1.08s）。 */
    impactSeconds: number;
}

/**
 * 走「弹道雨」的单位表。
 *
 * - `68008` 杰克藕：【戈壁箭雨】`random_strike`。`count` 只是缺省 —— 实际按配表
 *   `strikeCount`（三档 5/6/8）发，见 {@link zcBulletRainFieldsAt} 的 `count` 参数。
 * - `68024` 急冻瓜：【冰山陨落】`self_aura` 的落地那一击，3 颗冰锥。
 * - `68030` 篮球天才：【篮球火】`area`，3 颗火球。
 *
 * 🔴 `68008` 走 `strike` 通道时颗数**必须**取配表那一个（`strikeTargets` 传 `options.count`），
 * 否则「配表说 8 支箭、画面上 5 支」。另外两条通道没有对应字段，改这里就是改全部。
 *
 * 数值口径（2026-11-26 第 56 批调整）：`arcPx` 从 120/130/110 抬到 170/180/150、
 * `swayPx` 从 34/30/28 抬到 46/40/38 —— 用户口径「子弹的弧线不够明显」。
 * 再加上逐颗 ±45% 的峰高浮动（见 {@link zcBulletRainArcPx}），一批子弹就是几条**明显不同**的弧。
 */
export const ZC_BULLET_RAIN_UNITS: Readonly<Record<string, ZCBulletRainStyle>> = {
    //  arcPx 170：一格地砖高 90 屏 px，近两格高的弧才看得出「抛」；镜头半高约 360，
    //  再高（尤其 ×1.45 的那颗）会顶出画面。
    '68008': {
        channels: ['strike'], count: 5, arcPx: 170, swayPx: 46, spreadRatio: 0.85, faceAlongPath: true,
        impactPrefabPath: 'units/projectiles/磁电菇_子弹命中/磁电菇_子弹命中', impactSeconds: 0.5,
    },
    '68024': {
        channels: ['aura'], count: 3, arcPx: 180, swayPx: 40, spreadRatio: 0.8, faceAlongPath: true,
        impactPrefabPath: 'units/projectiles/冰法师通用子弹命中/冰法师通用子弹命中', impactSeconds: 1.05,
    },
    '68030': {
        channels: ['zone'], count: 3, arcPx: 150, swayPx: 38, spreadRatio: 0.75, faceAlongPath: true,
        //  🔴 不能用 `普攻爆炸`：那是**这张卡自己的武将技美术**（`empoweredSkillId` 指向的行自带它），
        //  2026-11-19 定案 A 明令「任何一张卡都不许再出现武将技专属美术」，`zcds-model` 的
        //  「强化那一击的表现口径」那条守卫会对着这个单位的所有事件扫 —— 用了就红。
        //  取导弹命中那份爆炸：它是 wind_bolt / missile_barrage 共用的通用命中，不专属任何卡。
        impactPrefabPath: 'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中', impactSeconds: 0.7,
    },
};

/** 这一批命中特效要加载的 prefab（缺了它就会「子弹消失、原地什么都没有」且不报错）。 */
export function zcBulletRainImpactPathsForUnit(unitId: string | null | undefined): readonly string[] {
    if (unitId == null) return [];
    const style = ZC_BULLET_RAIN_UNITS[unitId];
    return style ? [style.impactPrefabPath] : [];
}

/**
 * 这个单位在指定通道上走不走弹道雨；不在表里 / 通道对不上返回 `null`
 * ⇒ 调用点保持原有通道（存量逐字不变）。
 */
export function zcBulletRainStyleOf(
    unitId: string | null | undefined, channel: ZCBulletRainChannel,
): ZCBulletRainStyle | null {
    if (unitId == null) return null;
    const style = ZC_BULLET_RAIN_UNITS[unitId];
    if (!style || !style.channels.includes(channel)) return null;
    return style;
}

/**
 * 二次贝塞尔的一维偏移：控制点在 `ctrlOffset` 处时，进度 `t` 的位移。
 *
 * `B(t) = 2(1−t)t·ctrlOffset`（两端都归 0）。中点 `t = 0.5` 时正好是 `ctrlOffset / 2`
 * —— 所以调用点传的是**峰高**，内部按 `2 × 峰高` 反推控制点，观感与旧抛物线一致。
 *
 * 非数字一律按端点处理：`NaN` 泄进 `setPosition` 会让整层矩阵变 `NaN`。
 */
export function zcBulletBezierOffsetPx(apexPx: number, progress: number): number {
    if (!Number.isFinite(apexPx) || apexPx === 0) return 0;
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 1;
    //  控制点高度 = 2 × 峰高：`B(t) = 2(1−t)t·ctrl`，中点 `t=0.5` 正好抬到 `ctrl/2 = 峰高`
    const controlPx = 2 * apexPx;
    return controlPx * 2 * p * (1 - p);
}

/**
 * 一条**屏幕空间**的二次贝塞尔：起点、唯一控制点、终点。
 *
 * 为什么放在 model 层而不是视图里：轨迹求值是可测的纯函数，
 * 用例要能直接断言「t=0.5 时抬到峰高、t=0/1 时正好在端点」，
 * 而不用起一整个 Cocos 节点。视图只负责 `mapToView` 与 `setPosition`。
 */
export interface ZCBezierPx {
    fromX: number;
    fromY: number;
    ctrlX: number;
    ctrlY: number;
    toX: number;
    toY: number;
}

/**
 * 由「起点 / 终点 / 峰高 / 侧摆」构造贝塞尔（全部是**屏幕 px**）。
 *
 * 控制点 = 连线中点 + `(2·swayPx, 2·apexPx)`：二次贝塞尔在 `t=0.5` 处正好走过
 * 控制点与弦中点的连线中点，所以中点处的实际抬升 / 侧摆就是 `apexPx` / `swayPx`
 * —— 调用点写「峰高 120」，屏幕上量到的峰高就是 120。
 */
export function zcBulletRainPath(
    fromX: number, fromY: number, toX: number, toY: number, apexPx: number, swayPx: number,
): ZCBezierPx {
    const safeApex = Number.isFinite(apexPx) ? apexPx : 0;
    const safeSway = Number.isFinite(swayPx) ? swayPx : 0;
    return {
        fromX, fromY, toX, toY,
        ctrlX: (fromX + toX) / 2 + 2 * safeSway,
        ctrlY: (fromY + toY) / 2 + 2 * safeApex,
    };
}

/** 进度 `t` 处的 x；`t` 越界夹到 `[0,1]`、非数字退 1（= 已落地）。 */
export function zcBezierXAt(path: ZCBezierPx, t: number): number {
    const p = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
    const u = 1 - p;
    return u * u * path.fromX + 2 * u * p * path.ctrlX + p * p * path.toX;
}

/** 进度 `t` 处的 y；规则同 {@link zcBezierXAt}。 */
export function zcBezierYAt(path: ZCBezierPx, t: number): number {
    const p = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
    const u = 1 - p;
    return u * u * path.fromY + 2 * u * p * path.ctrlY + p * p * path.toY;
}

/**
 * 进度 `t` 处的**切线方向角**（度，逆时针，0 = +X）—— 子弹头朝飞行方向。
 *
 * 用解析导数而不是「取 t 与 t+ε 两点求差」：ε 在 `t` 接近 1 时会跑出曲线外，
 * 且导数在端点不退化成 0（`B'(1) = 2(P1 − C)`），朝向不会在落地那一帧突然归零。
 */
export function zcBezierTangentDegrees(path: ZCBezierPx, t: number): number {
    const p = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 1;
    const dx = 2 * (1 - p) * (path.ctrlX - path.fromX) + 2 * p * (path.toX - path.ctrlX);
    const dy = 2 * (1 - p) * (path.ctrlY - path.fromY) + 2 * p * (path.toY - path.ctrlY);
    if (dx === 0 && dy === 0) return 0;
    return Math.atan2(dy, dx) * 180 / Math.PI;
}

/**
 * 一颗弹道雨子弹的**表现参数**（直接摊平进 `ZCCombatEvent`，见 {@link zcBulletRainFieldsAt}）。
 */
export interface ZCBulletRainFields {
    flyFromX: number;
    flyFromY: number;
    flyToX: number;
    flyToY: number;
    flyInSeconds: number;
    flyArcPx: number;
    flySwayPx: number;
}

/**
 * 弹道雨的**世界 px / 秒**。单位与配表 `projectileSpeed` 同一档
 * （`ZCCombatSystem.attackTravelSeconds` 直接拿它除世界距离，不乘 `combatDistanceScale`）。
 *
 * 2026-11-26 第 56 批：用户口径「释放这种技能的子弹速度改成 150px」⇒ 520 → 150。
 * 慢 3.5 倍，配合抬高的弧线才看得出「抛出去」这一路；改这一个数就是改三张卡的全部弹速。
 */
export const ZC_BULLET_RAIN_SPEED = 150;

/**
 * 一批子弹**逐颗**出手的间隔（秒），2026-11-26 第 58 批。
 *
 * 用户口径：「这类技能的子弹是逐个射出去的，不是逐轮的齐射，不停的发射，
 * 每个子弹有 0.1s 左右的间隔」。原来一批 N 颗的 `startedAt` 全是同一拍 ⇒ 屏幕上
 * 一次冒出一整排箭，读不出「连发」。
 *
 * 🔴 只错开**表现时刻**（`startedAt` / 命中特效的 `startedAt`），伤害仍在调用这一拍
 * 一次性结算 —— 改成逐颗结算等于把技能 DPS 拉长到 N × 0.1 秒，与配表倍率对不上。
 */
export const ZC_BULLET_RAIN_SHOT_INTERVAL_SECONDS = 0.1;

/**
 * 子弹起点相对「单位脚点」的抬升（**屏幕 px**，2026-11-26 第 58 批）。
 *
 * 单位根节点是逻辑脚点（见 `view/ZCCombatEffectPlacement.zcCombatEffectLiftY` 的注释），
 * 弹道雨原来直接从这个点出发，实机看就是「贴着地面飞出去」。用户口径：
 * 「发射子弹的位置要在角色图片的中心位置往上 5px」。
 *
 * 20 = 既有「脚点 → 身体中心」的补偿（`yulinDart` / `yulinDartEmpowered` 用的就是 20），
 * 再 +5 就是用户要的那个高度。单位是视图 px，与 `liftY` / `visualLiftPx` 同一档。
 */
export const ZC_BULLET_RAIN_ORIGIN_LIFT_PX = 25;

/**
 * 弹道雨的飞行时长上下限（**独立于** {@link ZC_BULLET_FLY_MAX_SECONDS} 的 0.55）。
 *
 * 🔴 那条 0.55 是给「600 px/s 飞一段 40px」的单颗飞入用的；150 px/s 下 0.55 会把
 * 大半颗子弹**夹短**，慢速改成面条：时长被截断 ⇒ 同一段时间要走完更长的距离 ⇒ 弧线被抹平，
 * 用户看到的还是「一条线」。
 */
export const ZC_BULLET_RAIN_MIN_SECONDS = 0.35;
export const ZC_BULLET_RAIN_MAX_SECONDS = 1.6;

/**
 * 逐颗峰高的浮动幅度：`arcPx × (1 ± 0.45)`。
 *
 * 用户口径「每个子弹的弧线差异可以再大点，多条不同的贝塞尔曲线行进路线」——
 * 只改 `swayPx`（横向）时所有弧的**高度**还是同一个，眼睛读出来仍是「一批同样的弧斜着撒」。
 * 高度也错开之后才是几条真正不同的曲线。
 */
export const ZC_BULLET_RAIN_ARC_SPREAD = 0.45;

/**
 * 逐颗峰高的浮动阶梯（乘以 {@link ZC_BULLET_RAIN_ARC_SPREAD}）：**固定的一组分档**，不是散列。
 *
 * 为什么不用散列：两个序号散出同一个值（哪怕只是取整后相同）就会出现两条一模一样的弧，
 * 而「每颗弹道都不一样」正是用户这一条要求的全部意义。分档互不相同 ⇒ 一批里条条不一样；
 * 起始下标随种子轮转 ⇒ 换一波时「哪颗最高」也跟着换，不会每波都是同一颗最高。
 */
const ZC_BULLET_RAIN_ARC_STEPS: readonly number[] = [0, 0.8, -0.53, 1, -1, 0.33, -0.8, 0.53];

/**
 * 确定性散列 `[0, 1)`。
 *
 * 不用 `Math.random()`：同一场战斗回放、同一份快照重算必须给出同一组落点 / 同一条曲线，
 * 否则「录像对不上」这类问题永远查不清。`salt` 取不同值让半径、角度、峰高、侧摆互不相关。
 */
function zcBulletRainHash(seed: number, index: number, salt: number): number {
    const base = Number.isFinite(seed) ? Math.abs(Math.round(seed)) : 0;
    const slot = Number.isFinite(index) ? Math.round(index) : 0;
    const raw = (base * 9301 + slot * 49297 + salt * 233) % 233280;
    return (raw < 0 ? raw + 233280 : raw) / 233280;
}

/**
 * 生成第 `index` 颗子弹的表现参数：起点 = 施法者、落点 = 散布圆内的确定性随机点。
 *
 * @param style 该单位的弹道雨口径（颗数 / 弧高 / 侧摆 / 散布）
 * @param index 第几颗（0 起；第 0 颗固定落在散布中心）
 * @param placement 施法者坐标 + 散布圆心 + 散布半径（**全部是世界坐标**）
 * @param seed 本波唯一整数种子（同一波的所有颗共用，保证同波落点稳定可复算）
 * @param count 本波实际发几颗（缺省取 `style.count`）。`strike` 通道传配表 `strikeCount`：
 *   侧摆要按**实际颗数**归一，传错了五颗会当成三颗摊 ⇒ 有一半弹道重叠。
 */
export function zcBulletRainFieldsAt(
    style: ZCBulletRainStyle, index: number,
    placement: { originX: number; originY: number; centerX: number; centerY: number; radiusWorld: number },
    seed: number,
    count: number = style.count,
): ZCBulletRainFields {
    const offset = zcBulletRainOffset(seed, index, placement.radiusWorld, style.spreadRatio);
    const toX = placement.centerX + offset.dx;
    const toY = placement.centerY + offset.dy;
    const distance = Math.hypot(toX - placement.originX, toY - placement.originY);
    const seconds = Math.min(
        ZC_BULLET_RAIN_MAX_SECONDS,
        Math.max(ZC_BULLET_RAIN_MIN_SECONDS, distance / ZC_BULLET_RAIN_SPEED),
    );
    return {
        flyFromX: placement.originX,
        flyFromY: placement.originY,
        flyToX: toX,
        flyToY: toY,
        flyInSeconds: seconds,
        flyArcPx: zcBulletRainArcPx(style, index, count, seed),
        flySwayPx: zcBulletRainSwayPx(style, index, count, seed),
    };
}

/**
 * 第 `index` 颗子弹的峰高（屏幕 px）：基准 `arcPx` 上按 {@link ZC_BULLET_RAIN_ARC_STEPS} 分档。
 *
 * 第 0 颗固定走基准弧（用例与「圈心那一发」都有稳定锚点）；其余各吃一档不同的偏移，
 * 于是同一批里既有「高抛」也有「贴地平推」的，且**两两不同**。
 */
export function zcBulletRainArcPx(
    style: ZCBulletRainStyle, index: number, count: number = style.count, seed = 0,
): number {
    if (!(style.arcPx > 0)) return 0;
    const slot = Number.isFinite(index) ? Math.round(index) : 0;
    if (slot <= 0) return style.arcPx;
    const total = Number.isFinite(count) ? Math.round(count) : style.count;
    //  轮转起点随种子走：换一波，最高/最低落在哪一颗也跟着换
    const steps = ZC_BULLET_RAIN_ARC_STEPS.length - 1;
    const rotation = Math.floor(zcBulletRainHash(seed, total * 53, 5) * steps) % steps;
    const step = 1 + ((slot - 1 + rotation) % steps);
    return Math.round(style.arcPx * (1 + ZC_BULLET_RAIN_ARC_STEPS[step] * ZC_BULLET_RAIN_ARC_SPREAD));
}

/**
 * 第 `index` 颗子弹的横向摆动（屏幕 px）。
 *
 * 两层叠加：① 把颗序号摊到 `[-1, 1]`（保证相邻两颗不重叠）；
 * ② 再叠一段 `±0.55 × (1 − |分摊值|)` 的确定性抖动（保证「每条弧都不一样」，
 *    而不是一片整齐的扇形；边缘那颗抖 0，免得被 clamp 掉撞上旁边那颗）。
 *
 * 单颗时恒 0（一颗子弹没必要歪）。
 *
 * @param count 本波实际颗数（缺省 `style.count`）—— 归一化按**实际**颗数走，
 *   传错了会出现「八颗箭按五颗摊」⇒ 有两颗弧度完全重叠。
 */
export function zcBulletRainSwayPx(
    style: ZCBulletRainStyle, index: number, count: number = style.count, seed = 0,
): number {
    const total = Number.isFinite(count) ? Math.round(count) : style.count;
    if (total <= 1 || !(style.swayPx > 0)) return 0;
    const slot = Number.isFinite(index) ? Math.round(index) : 0;
    const spread = (2 * slot) / (total - 1) - 1;
    //  抖动的幅度按「离边缘还剩多少」收缩：贴边那颗本来就该走满宽度，
    //  再往外抖只会被 clamp 掉、和旁边那颗撞成同一条弧。
    const room = Math.max(0, 1 - Math.abs(spread));
    const jitter = (zcBulletRainHash(seed, total * 31 + slot, 4) * 2 - 1) * 0.55 * room;
    return style.swayPx * Math.max(-1, Math.min(1, spread + jitter));
}

/**
 * 第 `index` 颗子弹的落点偏移（**世界坐标**，相对区域圆心）。
 *
 * 用确定性散列而不是 `Math.random()`：同一场战斗回放、同一份快照重算必须给出同一组落点，
 * 否则「录像对不上」这类问题永远查不清。第 0 颗固定落在圆心（`dx = dy = 0`）——
 * 保证「区域正中心一定挨了一下」，也让用例有个稳定的锚点。
 *
 * @param seed 每波唯一的整数种子（调用点用事件 id 或波次序号）
 * @param index 第几颗（0 起）
 * @param radiusWorld 区域半径（世界 px）
 * @param spreadRatio 散布比例，见 {@link ZCBulletRainStyle.spreadRatio}
 */
export function zcBulletRainOffset(
    seed: number, index: number, radiusWorld: number, spreadRatio: number,
): { dx: number; dy: number } {
    //  `Number.isFinite` 不只是洁癖：`random_strike` 的 `strikeTargetMode === 2` 会把
    //  搜索半径算成 `Infinity`，乘进去会得到 `±Infinity` 落点 ⇒ 节点坐标变 `NaN`、整层不渲染。
    if (index <= 0 || !(radiusWorld > 0) || !Number.isFinite(radiusWorld)) return { dx: 0, dy: 0 };
    const ratio = Number.isFinite(spreadRatio) ? Math.max(0, spreadRatio) : 1;
    //  开方让落点在圆面上均匀分布；不开方会全挤在圆心附近
    const reach = Math.sqrt(zcBulletRainHash(seed, index, 1)) * radiusWorld * ratio;
    const theta = zcBulletRainHash(seed, index, 2) * Math.PI * 2;
    return { dx: Math.cos(theta) * reach, dy: Math.sin(theta) * reach };
}

/**
 * 一颗子弹**落地那一拍**的命中特效参数（2026-11-26 第 56 批）。
 *
 * 用户原话：「子弹命中指定坐标消失，在坐标处播放受击特效」。
 *
 * 做法上它是一条**独立的 `area` 事件**，`startedAt` 排在这一颗子弹的到达时刻：
 *  - 渲染层对 `startedAt` 在未来的事件直接不建节点（`zcCombatEffectEntered`），
 *    所以命中特效天然是「子弹到了才出现」，不需要任何延时逻辑；
 *  - 子弹那条事件的 `durationSeconds` 就截到 `flyInSeconds`（见调用点），到点即摘 ⇒
 *    「命中指定坐标消失」，不会像原来那样停在落点上继续播到整段区域寿命结束。
 */
export interface ZCBulletRainImpactFields {
    effectPrefabPath: string;
    x: number;
    y: number;
    startedAt: number;
    durationSeconds: number;
}

/**
 * 由「这一颗子弹的表现参数 + 起手时刻」推出命中特效事件的时间与位置。
 *
 * @param style 该单位的弹道雨口径（命中特效 prefab 与时长在这里）
 * @param fields 这一颗子弹的飞行参数（{@link zcBulletRainFieldsAt} 的返回值）
 * @param castAt 起手时刻（`state.elapsedSeconds`）
 */
export function zcBulletRainImpactAt(
    style: ZCBulletRainStyle, fields: ZCBulletRainFields, castAt: number,
): ZCBulletRainImpactFields {
    const seconds = Number.isFinite(fields.flyInSeconds) ? Math.max(0, fields.flyInSeconds) : 0;
    return {
        effectPrefabPath: style.impactPrefabPath,
        x: fields.flyToX,
        y: fields.flyToY,
        startedAt: (Number.isFinite(castAt) ? castAt : 0) + seconds,
        durationSeconds: style.impactSeconds > 0 ? style.impactSeconds : ZC_BULLET_RAIN_IMPACT_FALLBACK_SECONDS,
    };
}

/** 命中特效时长缺失时的兜底：短一点比「永远不消失」好。 */
export const ZC_BULLET_RAIN_IMPACT_FALLBACK_SECONDS = 0.5;
