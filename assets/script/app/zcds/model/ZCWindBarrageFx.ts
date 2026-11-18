/**
 * 第 16 批：风弹 + 命中留飓风（`wind_bolt`，风炮菇 101303「孢爆箭」）与
 * 连射抛物线炸弹（`missile_barrage`，风炮菇 101304「连射导弹」）的表现常量。
 *
 * 为什么路径要写在代码里：行为技能的参数全压在 `pvpSkillPlan.skillParamJson` 上，
 * 那张表只有数值槽、没有造型列（同 `ZCBlinkCastFx` / `ZCSelfAuraFx` / `ZCTrapFx` /
 * `ZCSplashShotFx` / `ZCBurstFx`）。硬编码路径必须同时进 `ZCVisualResourcePlan` 的清单，
 * 否则技能照常结算、屏幕上一次都不亮，而且一条错都不报。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 风弹 + 命中点留一块持续区域（101303）。*/
export const ZC_WIND_BOLT_BEHAVIOR_KEY = 'wind_bolt';

/** 累计 N 次普攻后连射 N 颗抛物线炸弹（101304）。*/
export const ZC_BARRAGE_BEHAVIOR_KEY = 'missile_barrage';

/**
 * 风弹弹体：`三叶小丑_普攻`（9 帧序列动画）。
 *
 * 设计原话是「发出**蓝色**的风弹」，但工程里没有任何蓝色风弹资源 ——
 * 只有绿色的 `风法师_绿风` 与这份风系弹体。2026-11-18 用户裁定先复用这一份：
 * 美术出蓝色风弹之后只改这一行（`ZCVisualResourcePlan` 与清单都从这里读）。
 *
 * 它在 `ZCAttackResolutionSystem` 的 `PROJECTILE_LIFT_BY_PREFAB_PATH` 里已经登记了
 * `+30` 的发射高度补偿（原本给三叶小丑普攻加的），风炮菇复用它时一并继承 —— 对射手来说
 * 「从身体中间飞出去」同样是想要的效果。
*/
export const ZC_WIND_BOLT_PREFAB_PATH = 'units/projectiles/三叶小丑_普攻/三叶小丑_普攻';

/**
 * 飓风：`风法师_龙卷风`（三叶小丑的强化那一击，即设计说的「三叶小丑的飓风」）。
 *
 * 🔴 尺寸口径必须与三叶小丑那条**同名同值**：`pvpSkill` 36251 的 `areaRadius = 30`（逻辑 px）
 * 与 `ZCCombatEffectScale.NODE_SCALE_BY_PREFAB_PATH` 的 `0.5` 是一对，只改一边就是
 * 「看着缩了、判定没缩」。本批的风弹用同一个 30 ⇒ 直接沿用那两条，不在本批另开倍率。
*/
export const ZC_WIND_HURRICANE_PREFAB_PATH = 'units/projectiles/风法师_龙卷风/风法师_龙卷风';

/**
 * 飓风的接触判定间隔（秒）。
 *
 * 区域系统的波次是「每 `waveInterval` 结算一波」，而这条技能要的是
 * 「站在里面就一直算接触、但每个敌人只挨一次」⇒ 用很小的间隔把波次压成
 * 「每逻辑步一次接触判定」，再用 `hitOncePerUnit` 保证同一敌人不重复。
 * 20Hz 模拟下 0.05s 恰好是「每步一波」，不会出现「一步跑过头、漏判」。
*/
export const ZC_WIND_HURRICANE_TOUCH_SECONDS = 0.05;

/**
 * 连射炸弹的落点散布半径（逻辑 px）。
 *
 * 设计：「落点在以目标为圆形 30px 为**直径**的区域内任意点位」⇒ 半径 15 逻辑 px
 * （世界 4.5px）。收成常量而不是配表项：它是「观感抖动」不是数值，改它不需要重跑平衡。
*/
export const ZC_BARRAGE_SCATTER_RADIUS = 15;

/**
 * 炸弹飞行段特效：镭射飞龙的追踪导弹弹体（设计 O 列「复用镭射飞龙的【追踪导弹】」）。
 *
 * 与镭射飞龙自己那条技能共用同一份 prefab，`NODE_SCALE_BY_PREFAB_PATH` 里的 `0.8`
 * 也是共用的一格 —— 不另开倍率，否则会把镭射飞龙的导弹一起改大。
*/
export const ZC_BARRAGE_MISSILE_PREFAB_PATH = 'units/projectiles/镭射飞龙_导弹技能/镭射飞龙_导弹技能';

/** 炸弹落地爆炸特效：镭射飞龙的导弹命中爆炸（与弹体成对的那一份）。*/
export const ZC_BARRAGE_IMPACT_PREFAB_PATH = 'units/projectiles/镭射飞龙_导弹技能命中/镭射飞龙_导弹技能命中';

/**
 * 炸弹飞行速度（逻辑 px/s）。
 *
 * 设计没给，取 300：一格世界 = 12.6 世界 px（42 逻辑 × 0.3），
 * 300 逻辑 = 90 世界 px/s ⇒ 跨 3 格约 0.42s。与「1.2 秒打三发、每发 0.4s」的节拍同量级，
 * 不会出现「第三发还没落地、第一发的爆炸已经散了」。
*/
export const ZC_BARRAGE_FLIGHT_SPEED = 300;

/**
 * 一轮连射里两颗炸弹的间隔（秒）。
 *
 * 设计：「1.2s 内发射 3 个」⇒ 首发即刻、之后每 0.4 秒一颗（0 / 0.4 / 0.8），
 * 整轮落在 1.2s 这条线以内。配表 `barrageInterval` 缺省时用它兜底。
*/
export const ZC_BARRAGE_DEFAULT_INTERVAL = 0.4;

/** 炸弹落地的最短飞行时间（秒）：贴脸时别让爆炸在出手那一帧就炸，观感上要看到东西飞过去。*/
export const ZC_BARRAGE_MIN_FLIGHT_SECONDS = 0.12;

/**
 * `镭射飞龙_导弹技能命中` 现用倍率（`NODE_SCALE_BY_PREFAB_PATH` 里的 `123 / 202`）
 * 是按「爆炸半径 80 逻辑 px」推出来的基准。事件级倍率就以它为 1.0 参照：
 * 输出 `round(logicRadius / 80, 4)`，`180` ⇒ `2.25`。
 *
 * 不这么做的后果：同一个 prefab 在镭射飞龙那条是 80 半径、在连射导弹这条是 180，
 * 全局路径倍率只能二选一 —— 必然出现「看着小、打得到」或「看着大、打不到」。
*/
export const ZC_BARRAGE_IMPACT_REFERENCE_RADIUS = 80;

/** 屏上 px = 逻辑 px × 0.76875（`combatDistanceScale` 0.3 × view/logical 2.5625）。*/
export const ZC_BARRAGE_SCREEN_PER_LOGIC = 0.76875;

const WIND_BARRAGE_BEHAVIOR_KEYS: ReadonlySet<string> = new Set([
    ZC_WIND_BOLT_BEHAVIOR_KEY, ZC_BARRAGE_BEHAVIOR_KEY,
]);

/** 这个行为键走不走第 16 批的这两条车道。*/
export function zcIsWindBarrageBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && WIND_BARRAGE_BEHAVIOR_KEYS.has(behaviorKey);
}

/**
 * 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。
 *
 * 收成一个函数是为了让「播不播」和「加不加载」用同一个判据，
 * 两处各写一遍字符串迟早会对不上（`ZCBlinkCastFx` / `ZCSplashShotFx` 同一条理由）。
*/
export function zcWindBarrageEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (behaviorKey === ZC_WIND_BOLT_BEHAVIOR_KEY) {
        return [ZC_WIND_BOLT_PREFAB_PATH, ZC_WIND_HURRICANE_PREFAB_PATH];
    }
    if (behaviorKey === ZC_BARRAGE_BEHAVIOR_KEY) {
        return [ZC_BARRAGE_MISSILE_PREFAB_PATH, ZC_BARRAGE_IMPACT_PREFAB_PATH];
    }
    return [];
}

/**
 * 爆炸特效的整体尺寸倍率：让爆炸的**屏上直径**等于判定直径。
 *
 * 与 `zcBurstEffectScale` 同一思路，区别是这里的分母不是 prefab 的原生宽度，
 * 而是「该 prefab 当前被标定到的判定半径」（80 逻辑 px，见
 * `ZC_BARRAGE_IMPACT_REFERENCE_RADIUS` 的推导）—— 因为路径倍率已经被镭射飞龙占住了。
 *
 * `logicRadius` 传**表值**（`barrageRadius`），不是乘过 `combatDistanceScale` 的世界值。
 * 非法值退回 1（宁可尺寸没改，也不能把节点缩成 0 让特效消失）。
*/
export function zcBarrageImpactScale(logicRadius: number): number {
    if (!Number.isFinite(logicRadius) || logicRadius <= 0) return 1;
    const scale = logicRadius / ZC_BARRAGE_IMPACT_REFERENCE_RADIUS;
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * 炸弹的飞行时长（秒）= 世界距离 ÷ 世界速度，保底 `ZC_BARRAGE_MIN_FLIGHT_SECONDS`。
 *
 * `worldDistance` 是世界坐标距离，`speedTable` 是表值逻辑 px/s ——
 * 换算系数由调用方传（`rules.combatDistanceScale`），这里不猜 0.3。
*/
export function zcBarrageFlightSeconds(worldDistance: number, speedTable: number, distanceScale: number): number {
    const speedWorld = Math.max(1e-6, speedTable * Math.max(1e-6, distanceScale));
    const seconds = Math.max(0, worldDistance) / speedWorld;
    return Math.max(ZC_BARRAGE_MIN_FLIGHT_SECONDS, seconds);
}
