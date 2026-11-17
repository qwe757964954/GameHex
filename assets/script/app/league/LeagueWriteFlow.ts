import { FW } from '../../framework/FW';
import type { LeagueRequestResult } from './LeagueRepository';
import { LEAGUE_TIP_FAILED, LEAGUE_TIP_OFFLINE } from './LeagueTexts';

/**
 * 联盟写请求的统一收口：成功重读、失败提示。
 *
 * 只统一六页共同的“写后流程”，不接管页面生命周期；`alive` 由调用方在 await 前取。
 * 返回请求结果，页面仍可据此做局部后处理。
 */
export async function settleLeagueWrite(
    result: LeagueRequestResult,
    alive: boolean,
    reload: () => Promise<void>,
): Promise<LeagueRequestResult> {
    if (!alive) return result;
    if (result === 'ok') {
        await reload();
    } else {
        FW.showTip(result === 'offline' ? LEAGUE_TIP_OFFLINE : LEAGUE_TIP_FAILED);
    }
    return result;
}
