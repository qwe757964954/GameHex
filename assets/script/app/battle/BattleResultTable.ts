import { toCount } from '../net/RequestGuard';
import { parseCmdGoodsList } from '../showReward/ShowRewardTable';
import type { ICmdGoodsLike } from '../showReward/ShowRewardTable';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_BATTLE_TYPE_SLG_CAMP, ZC_BATTLE_TYPE_SLG_MONSTER } from './BattleStartModel';

/**
 * 结算广播的纯口径层，零引擎、零网络，Node 单测可直接 import。
 * dataBytes 按 battleType 解成不同结算信息：1001 PVP、1002 章节、
 * 1003 野怪、1004 据点。
 */

/** 章节战斗结算归一化结果。 */
export interface IZCChapterBattleResult {
    /** 道具奖励，resId <= 0 的行已丢弃。 */
    readonly goods: readonly ICmdGoodsLike[];
    /** 宝箱 id；界面暂不显示。 */
    readonly treasureId: number;
    /** 仅据点结算可下发；缺省保持未知，不用本地公式补造。 */
    readonly warScore?: number;
}

/**
 * 等结算广播的超时。超时是正常兜底：服务端没推时结算页照样弹，只是奖励区空着。
 */
export const BATTLE_RESULT_WAIT_MS = 1500;

/** 这条广播是不是章节战斗的结算。 */
export function isChapterBattleResult(battleType: number): boolean {
    return toCount(battleType) === ZC_BATTLE_TYPE_CHAPTER;
}

export function battleResultMessageName(battleType: number): string | null {
    switch (battleType) {
        case ZC_BATTLE_TYPE_CHAPTER: return 'CmdChapterBattleResultInfo';
        case ZC_BATTLE_TYPE_SLG_MONSTER: return 'CmdSlgMonsterBattleResultInfo';
        case ZC_BATTLE_TYPE_SLG_CAMP: return 'CmdSlgCampBattleResultInfo';
        default: return null;
    }
}

export function battleResultOf(battleType: number, raw: unknown): IZCChapterBattleResult {
    if (isChapterBattleResult(battleType)) return chapterBattleResultOf(raw);
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const warScore = row.warScore;
    return {
        goods: parseCmdGoodsList(row.cmdGoods),
        treasureId: 0,
        ...(battleType === ZC_BATTLE_TYPE_SLG_CAMP && Object.prototype.hasOwnProperty.call(row, 'warScore') && typeof warScore === 'number'
            && Number.isInteger(warScore) && warScore >= 0 && warScore <= 0xFFFFFFFF ? { warScore } : {}),
    };
}

/**
 * 章节结算对象转归一化结果。形状不对时返回空奖励，不用 null，
 * 让上层对「广播没内容」和「广播没到」走同一条降级路径。
 */
export function chapterBattleResultOf(raw: unknown): IZCChapterBattleResult {
    if (!raw || typeof raw !== 'object') return { goods: [], treasureId: 0 };
    const row = raw as Record<string, unknown>;
    return {
        goods: parseCmdGoodsList(row.cmdGoods),
        treasureId: toCount(row.treasureId),
    };
}
