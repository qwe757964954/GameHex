import { toCount } from '../net/RequestGuard';
import { parseCmdGoodsList } from '../showReward/ShowRewardTable';
import type { ICmdGoodsLike } from '../showReward/ShowRewardTable';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_BATTLE_TYPE_SLG_CAMP, ZC_BATTLE_TYPE_SLG_MONSTER } from './BattleStartModel';

/**
 * 战斗结算广播（`CmdBattleResultBroMsg`）的**纯口径层**：零 `cc`、零网络，Node 单测可直接 import。
 *
 * 服务端在战斗结束后推 `CmdBattleResultBroMsg { battleType, code, dataBytes }`，
 * `dataBytes` 按 `battleType` **解成不同的结算信息**（proto 注释：
 * `1001 -> CmdPveBattleResultInfo`）。编号就是 `BattleStartModel` 里那套私有段：
 *
 * | battleType | 常量 | 结算信息 |
 * |---|---|---|
 * | 1001 | `ZC_BATTLE_TYPE_PVP` | `CmdPveBattleResultInfo`（段位 / 积分 / 奖励） |
 * | 1002 | `ZC_BATTLE_TYPE_CHAPTER` | `CmdChapterBattleResultInfo`（道具奖励 + 宝箱 id） |
 *
 * 1003 野怪解 CmdSlgMonsterBattleResultInfo，1004 据点解 CmdSlgCampBattleResultInfo。
 */

/** 章节战斗结算（`CmdChapterBattleResultInfo` 归一化）。 */
export interface IZCChapterBattleResult {
    /** 道具奖励（已归一化：`resId <= 0` 的行被丢掉）。 */
    readonly goods: readonly ICmdGoodsLike[];
    /** 宝箱 id（协议有；界面暂不显示 —— 等美术/展示口径）。 */
    readonly treasureId: number;
    /** 仅据点结算可下发；缺省保持未知，不用本地公式补造。 */
    readonly warScore?: number;
}

/**
 * 等结算广播的超时（毫秒）。
 *
 * 超时不是错误路径而是**正常兜底**：服务端没推（非章节局 / 网络抖 / 老版本后端）时，
 * 结算页照样要弹，只是奖励区空着 —— 不能把结算卡死在这里。
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
 * `CmdChapterBattleResultInfo`（已解出的 proto 对象）→ 归一化结果。
 *
 * 形状不对（`null` / 不是对象）⇒ 返回「空奖励」而不是 `null`：
 * 广播到了但内容为空，和「广播没到」对上层是同一件事（奖励区空着），不必让调用方分两支。
 */
export function chapterBattleResultOf(raw: unknown): IZCChapterBattleResult {
    if (!raw || typeof raw !== 'object') return { goods: [], treasureId: 0 };
    const row = raw as Record<string, unknown>;
    return {
        goods: parseCmdGoodsList(row.cmdGoods),
        treasureId: toCount(row.treasureId),
    };
}
