/**
 * 商城的提示文案。FW.G_W 在本端是空实现，mL 表也没有概率说明用的键，
 * 所以文案放在这里，与 gift / hang 等模块的 *Texts.ts 保持一致。
 * 「不足」类提示优先读 roleProperty.unenoughTips，读不到时才用这里的兜底。
 */

/** 商城动作的通用提示。 */
export const STORE_TEXTS = {
    offline: '尚未连接服务器，请先登录游戏',
    requestFailed: '操作失败，请稍后再试',
    keyNotEnough: '金钥匙不足',
    costNotEnough: '货币不足',
    soldOut: '已售罄',
    coolingDown: '冷却中，请稍后再试',
    gachaTip: '是否花费{0}金币进行抽奖？',
    probabilityTitle: '概率说明',
    adNotReady: '广告暂不可用，请稍后再试',
    adUsedUp: '今日观看次数已用完',
} as const;

/** 免费领奖协议尚未生成，按钮只能如实提示不可用。 */
export const STORE_GIFT_FREE_UNAVAILABLE =
    '免费领奖需要 RequestRoleGuanKaGiftGetFree 协议，本端尚未生成该协议';

/** 礼包翻页尚未接入，当前礼包段只上架 1 档。 */
export const STORE_GIFT_PAGING_UNAVAILABLE = '礼包翻页尚未接入（本端礼包段目前只落了 1 档）';

/** 百分比文案，保留 4 位小数并去掉尾随 0。 */
export function formatRate(rate: number): string {
    const value = Number.isFinite(rate) ? rate : 0;
    const text = value.toFixed(4).replace(/\.?0+$/, '');
    return `${text === '' ? '0' : text}%`;
}
