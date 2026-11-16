/**
 * 技能描述的数字着色：把 armySkillLevelUp.desc 转成 RichText 标记串。不 import cc，可单测。
 *
 * 规则：紧跟增益动词的百分比数字用绿色，其余数字用蓝色，非数字保持视图给的 fontColor。
 * 只看动词是否紧贴数字，不跨标点回看，避免把「造成30%溅射伤害，攻击速度提高14%」
 * 里的 30% 误判成增益。
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
 * 描述原文转 RichText 标记串。数字逐个包 color 标签，其余原样输出。
 * bold 为真时整段包 b 标签；RichText 没有加粗开关，只能靠标签。
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
