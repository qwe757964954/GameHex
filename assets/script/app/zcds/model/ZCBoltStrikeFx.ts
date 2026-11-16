/**
 * 落雷（bolt_strike，磁电菇 101603 五雷轰顶）的表现常量。
 *
 * 和 ZCBlinkCastFx / ZCSelfAuraFx 同理：pvpSkill 按 unitId 挂的是普攻行，装不下这条主动技能的造型，
 * 路径只能写在代码里。硬编码路径必须进 ZCVisualResourcePlan 的清单，否则结算了却没有雷。
 * 本文件不能引 cc。
*/

/**
 * 落雷 prefab 路径。美术 2026-11-11 补齐散帧后由 tools/build_magdi_strike_fx.py 生成，
 * 之前挂的是「雷法师_武将闪电」占位。
*/
export const ZC_BOLT_EFFECT_PREFAB_PATH = 'units/projectiles/磁电菇_劈雷技能/磁电菇_劈雷技能';

/**
 * 动画总时长 = 20 帧 / sample 30。
 *
 * sample 取 30 是设计口径：101603 要求「每道闪电在第 5 帧判伤」。第 5 帧占 4/30 ~ 5/30
 * = 0.1333~0.1667s，配表 boltDelay = 0.15 正好落在中间，一个数都不用改。
 * 换成项目里常用的 sample 12，第 5 帧跑到 0.333s，看起来就是雷还没落地血先掉了。
 *
 * 表现事件的 durationSeconds 不能短于它，否则模型会在动画播完前把节点摘掉，看不到雷尾消散。
*/
export const ZC_BOLT_EFFECT_SECONDS = 20 / 30;

/** 触发这条表现的行为键。*/
export const ZC_BOLT_STRIKE_BEHAVIOR_KEY = 'bolt_strike';

/**
 * 落雷命中后挂的状态：麻痹。
 *
 * 为什么写死：skillParamJson 只有数值槽，boltNumbChance 只能给概率，给不了状态 id。
 * 用 numb 不是 paralysis —— 后者是 3 秒硬控，连移动都停；磁电菇的口径是只禁攻击、移速 -50%。
*/
export const ZC_BOLT_NUMB_STATUS_ID = 'numb';

/** 行为键 → 落雷特效路径；不是落雷返回 null。*/
export function zcBoltStrikeEffectPath(behaviorKey: string | null | undefined): string | null {
    return behaviorKey === ZC_BOLT_STRIKE_BEHAVIOR_KEY ? ZC_BOLT_EFFECT_PREFAB_PATH : null;
}
