/**
 * 技能描述的数字着色：把 `armySkillLevelUp.desc` 转成 RichText 标记串。
 * 不 import cc，可单测。
 *
 * 规则（2026-11-11 策划口径）：
 *   1. 数字前面的词是「提高 / 增加 / 提升 / 增强」这类增益动词，且数字带百分号 → 绿色；
 *   2. 其余所有数字（`每3次`、`半径60`、`0.5秒`、`造成30%`）→ 蓝色；
 *   3. 非数字文案保持 RichText 的 `fontColor`（由视图按解锁态给）。
 *
 * 判据只看动词是否紧贴数字（`提高22%`），不跨标点回看 —— 描述里所有增益数值都是这个写法，
 * 放宽反而会把「造成30%溅射伤害，攻击速度提高14%」这种句子里的 `30%` 误判成增益。
 */

/** 增益动词白名单：出现在数字正前方时，该数字的百分比用绿色。 */
export const SKILL_DESC_BOOST_VERBS: readonly string[] = ['提高', '增加', '提升', '增强'];

/** 数字（可带小数与百分号）：`3`、`0.5`、`22%`、`12.5%`。 */
const NUMBER_PATTERN = /\d+(?:\.\d+)?%?/g;

/** RichText 标记用的颜色表（`#RRGGBB`）。 */
export interface SkillDescColors {
    /** 增益百分比（提高/增加/提升 + %）。 */
    readonly boost: string;
    /** 其余数字。 */
    readonly plain: string;
}

/** 默认配色：绿色沿用卡牌页 `GainLabel` 的 `24,115,30`，蓝色取同深度的 `28,74,168`。 */
export const DEFAULT_SKILL_DESC_COLORS: SkillDescColors = { boost: '#18731E', plain: '#1C4AA8' };

/** `cc.Color` 形状的只读值 → `#RRGGBB`（钳到 0~255，非法值按 0）。 */
export function hexOfColor(color: { readonly r: number; readonly g: number; readonly b: number } | null | undefined): string {
    const channel = (value: number): string => {
        const clamped = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
        return clamped.toString(16).padStart(2, '0').toUpperCase();
    };
    return `#${channel(color?.r ?? 0)}${channel(color?.g ?? 0)}${channel(color?.b ?? 0)}`;
}

/** 数字正前方是否紧贴增益动词（`暴击率提高22%` → true；`造成30%` → false）。 */
function boostedBefore(text: string): boolean {
    for (const verb of SKILL_DESC_BOOST_VERBS) {
        if (text.endsWith(verb)) return true;
    }
    return false;
}

/**
 * 描述原文 → RichText 标记串。数字逐个包裹 `<color=#xxxxxx>`，其余原样输出。
 *
 * `bold` 为真时整段包一层 `<b>`：技能详情弹窗那一档描述原来是 `cc.Label(_isBold = true)`，
 * RichText 组件本身没有加粗开关，只能靠标签（解析器会把父标签样式合并进嵌套的 `<color>`）。
 *
 * 不含数字且不需要加粗时原样返回（RichText 只在文本或样式变化时才重排）。
 */
export function formatSkillDescMarkup(
    desc: string,
    colors: SkillDescColors = DEFAULT_SKILL_DESC_COLORS,
    bold = false,
): string {
    const text = String(desc ?? '');
    if (!text) return '';
    const body = /\d/.test(text)
        ? text.replace(NUMBER_PATTERN, (match: string, offset: number) => {
            const isPercent = match.endsWith('%');
            const color = isPercent && boostedBefore(text.slice(0, offset)) ? colors.boost : colors.plain;
            return `<color=${color}>${match}</color>`;
        })
        : text;
    return bold ? `<b>${body}</b>` : body;
}
