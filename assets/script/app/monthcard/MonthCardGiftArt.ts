/**
 * 月卡礼包美术路径。
 * resources.load 由页面统一做（先预加载，再铺界面）。
 */

import { MONTHCARD_ART_ROOT, spriteFramePath } from '../ArtPaths';
import { MONTH_CARD_TYPE_PREMIUM } from './MonthCardGiftTable';

/** `image/monthcard` 下的资源名。 */
export const MONTHCARD_ART = {
    panelBg: 'bg',
    bgNormal: 'yueka_bg_normal',
    bgRich: 'yueka_bg_rich',
    dayRewardBg: 'day_reward_bg',
    gainBubble: 'gain_bubble',
    dotNormal: 'priv_dot_normal',
    dotRich: 'priv_dot_rich',
    boughtTag: 'bought_tag',
    btnBase: 'btn_base',
    btnClaim: 'btn_icon_claim',
    btnTaken: 'btn_icon_taken',
    redDot: 'red_dot',
} as const;

/** 需要预加载的全部月卡图。 */
export const MONTHCARD_FRAME_NAMES: readonly string[] = [
    MONTHCARD_ART.panelBg,
    MONTHCARD_ART.bgNormal,
    MONTHCARD_ART.bgRich,
    MONTHCARD_ART.dayRewardBg,
    MONTHCARD_ART.gainBubble,
    MONTHCARD_ART.dotNormal,
    MONTHCARD_ART.dotRich,
    MONTHCARD_ART.boughtTag,
    MONTHCARD_ART.btnBase,
    MONTHCARD_ART.btnClaim,
    MONTHCARD_ART.btnTaken,
    MONTHCARD_ART.redDot,
];

/** 卡面资源名。 */
export function backgroundArtForType(type: number): string {
    return type === MONTH_CARD_TYPE_PREMIUM ? MONTHCARD_ART.bgRich : MONTHCARD_ART.bgNormal;
}

/** 月卡图装配路径。 */
export function monthCardFramePath(name: string): string {
    return spriteFramePath(MONTHCARD_ART_ROOT, name);
}

/** 条目子预制体路径。 */
export const MONTHCARD_ENTRY_PREFAB_PATH = 'ui/MonthCardGift/MonthCardGiftEntry';
