/**
 * LeagueClipboard —— 联盟模块的安全复制通道。
 *
 * 老端 `league_copyid` / `league_copywx` 两个按钮**压根没接线**，本端早期沿用
 * 「未开放」占位。现接通：复制联盟 ID / 微信号。
 *
 * 为什么不直接调 `WxUtil.Copy`：
 *   `WxUtil.Copy` 内部硬走 `wx.setClipboardData`（`window["wx"]`）。
 *   在**非微信环境**（浏览器 / 编辑器 / 真机非微信包）下 `WxUtil.wx` 为
 *   `undefined`，调用即抛 `TypeError`，点击复制按钮会直接崩。
 *   这里先判有没有微信环境，没有就退回 `navigator.clipboard`（Web 标准通道），
 *   再没有就提示「复制失败」—— 三种情况都不崩。
 *
 * 成功提示沿用项目约定 `FW.G_W("Func_1")`（与 `WxUtil.Copy` 一致）。
 */

import { FW } from '../../framework/FW';
import { WxUtil } from '../../framework/utils/WxUtil';

/**
 * 把文本复制到剪贴板。
 *
 * - 微信环境：走 `WxUtil.Copy`（含隐私授权流程 + 成功/失败 tip）。
 * - 非微信环境：走 `navigator.clipboard.writeText`，成功/失败各给一条 tip。
 * - 都不可用：提示「复制失败」。
 *
 * @param text 要复制的内容（空串直接提示，不发包/不调原生）。
 */
export function copyLeagueText(text: string): void {
    if (!text) {
        FW.showTip('复制内容为空');
        return;
    }

    const wx = WxUtil.wx;
    if (wx && typeof (wx as { setClipboardData?: unknown }).setClipboardData === 'function') {
        WxUtil.Copy(text);
        return;
    }

    const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (data: string) => Promise<unknown> } } }).navigator;
    const writeText = nav?.clipboard?.writeText;
    if (writeText && typeof writeText === 'function') {
        writeText.call(nav.clipboard, text).then(
            () => FW.showTip(FW.G_W('Func_1')),
            () => FW.showTip('复制失败'),
        );
        return;
    }

    FW.showTip('复制失败');
}
