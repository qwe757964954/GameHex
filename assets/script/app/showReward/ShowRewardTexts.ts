/**
 * 「获得奖励」弹窗文案 + 音效 key（纯数据、零 `cc`）。
 * 文案照抄 FGUI 原稿（`mL` 表无覆写条目）。
 */

/** 界面固定文案。 */
export const SHOW_REWARD_TEXTS = {
    /** 底部提示（FGUI `n11`）。 */
    hint: '点击空白区域继续',
} as const;

/** 音效 key，与老端逐字一致（均已登记、文件存在）；播放走 `FW.playSound`。 */
export const SHOW_REWARD_SOUNDS = {
    /** 普通奖励（`isGold` 为假）。 */
    reward: '获得奖励音效',
    /** 铜钱 / 金币奖励（`isGold` 为真）。 */
    coin: '获得铜钱音效',
} as const;

/** 按 `isGold` 选音效（真值判断，`undefined` / `0` / `''` 走普通奖励）。 */
export function showRewardSoundKey(isGold: unknown): string {
    return isGold ? SHOW_REWARD_SOUNDS.coin : SHOW_REWARD_SOUNDS.reward;
}
