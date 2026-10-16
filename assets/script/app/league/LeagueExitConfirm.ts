/**
 * 「退出联盟」二次确认 —— **本模块不新建 prefab**，直接复用工程既有的通用提示弹窗
 * `app/common/CommonTips`（`ui/common/CommonTips.prefab`）。
 *
 * ## 为什么不是新面板
 *
 * 老端 `play/LayerLeagueExitConfirm` 的真身就是一个「文案 + 确定 + 取消」的确认框：
 *
 * ```ts
 * init() { this.com.tm('btn_sure').onClick(this.onSure, this);
 *          this.com.tm('btn_cancel').onClick(this.unload, this); }
 * onSure() { this.unload(); proxy.ClickConfirmCallBack?.(); await RequestLeagueQuit(); }
 * ```
 *
 * FGUI 那边它是**一个独立面板**（`组件_联盟_大厅_退出提示.xml`），但那只是因为 FGUI 没有
 * 通用确认框。Demo3.8 有 —— `CommonTips` 已经是 `PopupBase` + 居中弹窗 + 空白可关 + 单按钮模式，
 * 与老端这个「提示框」逐项对齐。**再造一份就是重复实现**，而且会多出一份没人维护的 prefab。
 *
 * 这也解释了为什么它不占 P2 的「9 个面板」额度里的 1 个 prefab：
 * 真源是一处**调用**，不是一张版式。
 *
 * ## 调用方
 *
 * 退出按钮在**联盟管理**面板（`组件_联盟_大厅_管理.xml` 的 `btn_quit` / `btn_quit1`，
 * 属 P2 的 `LeagueMgr` 切片，尚未落地）。`LeagueMgr` 落地时：
 *
 * ```ts
 * openLeagueExitConfirm(() => { void this.repo.quit(this); });
 * ```
 *
 * ## 为什么「确定」只回调、不发包
 *
 * 老端在确认回调里直接 `RequestLeagueQuit()`。新端的网络层收在 `LeagueRepository`（未建），
 * 所以这里**只负责「问一句、把确定回调转出去」**，发包由调用方决定
 * —— 免得在 UI 里硬编码一条协议的调用方式（同 `FriendApplyPage` 把请求收在 Repository 的口径）。
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
 *               点「取消」/ 关闭按钮 / 点空白一律只是关掉，不回调。
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
