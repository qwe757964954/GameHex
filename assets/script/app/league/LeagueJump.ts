/**
 * 联盟任务「前往」跳转路由。
 *
 * 老端 `CtrlJumpView.JumpType(ref.goto)` 按 `JUMP_TYPE` 枚举开对应系统页；Demo3.8 没有
 * `JumpType`（活动 / 赠送 / 七日 / 征收 / 联盟都标注「本工程还没接跳转链路」）⇒ 这里建一份
 * **联盟任务专用**的最小映射：把 `goto` 数值路由到 Demo3.8 里**确实存在且有 `open` 入口**的
 * 页面，其余目标优雅兜底（提示「该功能暂未开放」），不假装跳转成功。
 *
 * 已接线：`LeagueTaskPage.jump(goto)`。
 */
import { FW } from '../../framework/FW';
import { HangPage } from '../hang/HangPage';
import { LayerActivityPage } from '../activity/LayerActivityPage';
import { LeagueStorePage } from './LeagueStorePage';
import { LeagueDonatePage } from './LeagueDonatePage';
import { LEAGUE_TASK_GOTO_MISSING } from './LeagueTexts';

/**
 * 老端 `JUMP_TYPE` 枚举里本端**已经能开**的目标（其余一律兜底提示）。
 * 仅收纳联盟任务「前往」实际会用到、且 Demo3.8 确有页面的几项：
 *   9=征收 / 11=联盟商店 / 12=联盟捐献 / 13=每日挑战（活动）。
 */
const LEAGUE_TASK_JUMP_TARGETS: Readonly<Record<number, () => void>> = {
    9: () => { void HangPage.open({}); },            // 征收
    11: () => { void LeagueStorePage.open({}); },    // 联盟商店
    12: () => { void LeagueDonatePage.open({}); },   // 联盟捐献
    13: () => { void LayerActivityPage.open({}); },  // 每日挑战 / 活动
};

/**
 * 任务「前往」：按 `goto` 打开对应系统页。
 *
 * `goto <= 0` 或不在已知目标里 ⇒ 提示「该功能暂未开放」。本端用「叠层打开目标页、
 * 保留任务页」近似老端 `JumpType` 后 `unload()` 的口径（不关当前面板）。
 */
export function gotoLeagueTask(goto: number): void {
    const open = LEAGUE_TASK_JUMP_TARGETS[goto];
    if (goto > 0 && open) {
        open();
        return;
    }
    FW.showTip(LEAGUE_TASK_GOTO_MISSING);
}
