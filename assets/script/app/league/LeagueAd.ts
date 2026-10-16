/**
 * 联盟广告：**播放**与**广告位类型**。
 *
 * 老端是两步：先 `CtrlPay.PayforAdVideo(type)` 真把广告放完、拿到凭据，再发
 * `RequestRoleWatchAdvert`（`CmdRoleWatchAdvertReqMsg { type, id? }`）记为「看过一次」。
 *
 * Demo3.8 **没有广告 SDK** ⇒ `playLeagueAd()` 目前是 **Mock**：模拟一次播放并成功返回，
 * 让「捐献免费」与「任务看广告」两条链路能真正跑通 —— 关键是**先播后发**，
 * 绝不裸发（`adv=true` / `RequestWatchAdvert` 本身就是发奖凭据，裸发等于白拿）。
 *
 * ⚠️ 真接入点：微信小游戏走 `wx.createRewardedVideoAd()`，`onClose(res)` 里
 *    `res && res.isEnded` 为 true 才算「看完」。届时只需把 `playLeagueAd` 的函数体
 *    换成真调用，**调用方一行都不用改**。
 */
import { AdType } from '../generated/refGen/RefEnum';
import { CacheMgr } from '../net/CacheMgr';

/** 广告位类型（对齐 `RefEnum.AdType`，避免各处写魔数）。 */
export const LEAGUE_AD_TYPE_UNION_TASK = AdType.unionTask;     // 14
export const LEAGUE_AD_TYPE_UNION_DONATE = AdType.unionDonate; // 15

/** Mock 一次广告播放的时长（ms）。真 SDK 接入后随本函数一起删掉。 */
const MOCK_AD_PLAY_MS = 800;

/**
 * 播一次广告。
 *
 * @returns `true` = 完整看完（调用方才发奖励请求）；`false` = 未看完 / 播放失败（**不要发包**）。
 */
export async function playLeagueAd(): Promise<boolean> {
    // Mock：没有 SDK，短暂模拟一次播放后按「看完」返回。
    await new Promise<void>((resolve) => {
        setTimeout(resolve, MOCK_AD_PLAY_MS);
    });
    return true;
}

// ============================================================
// 广告次数（`ad` 表 limit − `CmdRole.tlCmdAdvert` 已用）
// ============================================================
//
// 与 `HangRepository` 对 `sweep = 11` 的算法同源，但**按 type 参数化**
// （那边是硬编码 11 的两个私有函数，这边要同时服务 `unionTask = 14` 与 `unionDonate = 15`）。

/**
 * `ad` 表里某 `type` 的**上限**（老端 `ModelRole.GetAdvertLimit(type)`）。
 *
 * 表缺失 / 没有这一行时退到 **1**（与老端同一兜底），而不是 0 —— 0 会让文案变成 `1/0`。
 */
export function leagueAdLimit(adRows: readonly unknown[], type: number): number {
    for (const raw of adRows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (Number(r.type) !== type) continue;
        const limit = Number(r.limit);
        return Number.isFinite(limit) && limit > 0 ? limit : 1;
    }
    return 1;
}

/**
 * 今日**已用**的看广告次数（`CmdRole.tlCmdAdvert` 里某 `type` 的 `num`）。
 *
 * ⚠️ `CmdAdvert.num` 是「已用次数」不是「剩余次数」—— 剩余要自己拿上限去减。
 * ⚠️ 该表**只在有记录时才存在**（`tlCmdAdvert?: (CmdAdvert[]|null)`）⇒ 读不到按 0 算。
 */
export function leagueAdUsed(type: number): number {
    try {
        const rows = (CacheMgr.instance as { getTlCmdRole?: () => unknown[] })?.getTlCmdRole?.() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const list = (row as Record<string, unknown>).tlCmdAdvert;
            if (!Array.isArray(list)) return 0;
            for (const entry of list) {
                if (!entry || typeof entry !== 'object') continue;
                const e = entry as Record<string, unknown>;
                if (Number(e.type) === type) return Number(e.num) || 0;
            }
            return 0;
        }
    } catch (error) {
        console.warn('[League] 读 CmdAdvert 缓存失败', error);
    }
    return 0;
}

/** 今日**剩余**次数 = `max(0, 上限 − 已用)`（老端 `GetAdvertRestTimes`）。 */
export function leagueAdRest(adRows: readonly unknown[], type: number): number {
    return Math.max(0, leagueAdLimit(adRows, type) - leagueAdUsed(type));
}
