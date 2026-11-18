/**
 * 菌丝突刺（`single_strike`，分裂菇 101403）的表现常量与两个状态 id。
 *
 * 「扑向最近敌人，造成 150% 伤害并眩晕」—— 与既有的两条位移车道的关系：
 *  · `blink_strike`（魔术师 103404「移形换影」）是**闪现到落点再打一发**，还要往返 / 留分身 / 搜索半径封顶；
 *  · `legacy_dash`（待研发：102303 冲锋 / 102703 尖刺冲锋）是**沿路径撞人**，命中集合是一整条线；
 *  · 这一条是**贴上去打一个**：落点固定为目标身边、只结算一个目标、附带硬控。
 * 三者都要「挪过去」，所以复用同一个位移原语（`context.blinkTo` → `movement.placeAt`），
 * 但**不共用车道**：103404 那条有它自己的往返与分身语义，混进来等于把两套参数塞进一格。
 *
 * 设计案 O 列写「长戟兵_撕裂(8帧) 贴目标播 0.3s，不新增序列帧」——
 * 这个 prefab 已经在工程里（此前没有任何技能在用），本批第一次接进来。
 * 硬路径必须同时进 `ZCVisualResourcePlan` 的清单，否则技能照常结算、屏幕上不播撕裂，不报错。
 *
 * 本文件不能引 cc：用例要在没有引擎的环境里直接读这些常量。
*/

/** 菌丝突刺的行为键。*/
export const ZC_SINGLE_STRIKE_BEHAVIOR_KEY = 'single_strike';

/** 命中表现：长戟兵_撕裂。*/
export const ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH = 'units/projectiles/长戟兵_撕裂/长戟兵_撕裂';

/**
 * 命中表现播多久（秒）= 序列帧张数 ÷ 采样率 = 8 ÷ 12。
 *
 * 🔴 设计案 O 列写的是「播 0.3s」，但这条序列帧按 12fps 走完要 0.667s；
 * 截到 0.3s 会把后 4 张帧整段砍掉（观感是「砍一半就消失」）。
 * 与五雷轰顶 `ZC_BOLT_EFFECT_SECONDS` 同一条口径：**帧数 ÷ 采样率**，不拍脑袋定时长。
*/
export const ZC_SINGLE_STRIKE_EFFECT_SECONDS = 8 / 12;

/** 这个行为键走不走「突进单体」这条车道。*/
export function zcIsSingleStrikeBehavior(behaviorKey: string | null | undefined): boolean {
    return behaviorKey != null && behaviorKey === ZC_SINGLE_STRIKE_BEHAVIOR_KEY;
}

/** 行为键 → 这条车道需要的 prefab 路径；不是这条车道返回空数组。*/
export function zcSingleStrikeEffectPaths(behaviorKey: string | null | undefined): readonly string[] {
    if (!zcIsSingleStrikeBehavior(behaviorKey)) return [];
    return [ZC_SINGLE_STRIKE_EFFECT_PREFAB_PATH];
}

/**
 * 眩晕状态的 id：`__stunstrike:<秒>__`。
 *
 * 为什么不用 `pvpStatus` 里现成的 `stun_1` / `stun_1_5` / `stun_2`：
 * 那三行是**固定时长档**，与三档 1 / 1.5 / 2 秒正好同值纯属巧合 ——
 * 哪天有人把配表的眩晕时长改成 1.2 秒，状态还是老的 1 秒，谁都看不出来。
 * 这里按需生成，`control: 'stun'` 才是「硬控」的唯一开关（`numb` 那种软控 2026-11-17 已按设计删除）。
*/
export function singleStrikeStunStatusId(seconds: number): string {
    return `__stunstrike:${seconds.toFixed(2)}__`;
}

/**
 * III 级「命中后自身攻击速度提高 30%，持续 4 秒」的状态 id：`__strikehaste:<百分点>:<秒>__`。
 *
 * 与 `__selfcast:`（自身施法增益）分开是因为触发时机不同：那个是「施法就加」，
 * 这个是「**命中之后**才加，空放不给」—— 合成一条会让「空挥也涨攻速」。
 * `attackIntervalPct` 是「间隔缩短」口径（正值 = 攻速提升，30 = 攻速 +30%）。
*/
export function singleStrikeHasteStatusId(pct: number, seconds: number): string {
    return `__strikehaste:${pct.toFixed(4)}:${seconds.toFixed(2)}__`;
}
