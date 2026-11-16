/**
 * 退出联盟确认框，复用 CommonTips，不新建 prefab。
 * 只负责确认回调，发包由调用方 Repository 完成。
 */

import { CommonTips } from '../common/CommonTips';
import {
    LEAGUE_EXIT_CONFIRM_CANCEL,
    LEAGUE_EXIT_CONFIRM_CONTENT,
    LEAGUE_EXIT_CONFIRM_SURE,
} from './LeagueTexts';

/**
 * 弹一个「是否退出联盟」确认框。
 *
 * @param onSure 点「确定」后的回调（**在弹窗关闭之前**触发；抛错不影响弹窗关闭）。
 * 点「取消」/ 关闭按钮 / 点空白一律只是关掉，不回调。
 */
export function openLeagueExitConfirm(onSure: () => void): void {
    void CommonTips.open({
        userData: {
            content: LEAGUE_EXIT_CONFIRM_CONTENT,
            sureText: LEAGUE_EXIT_CONFIRM_SURE,
            cancelText: LEAGUE_EXIT_CONFIRM_CANCEL,
            onSure,
        },
    });
}
