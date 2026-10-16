/**
 * 每日任务「前往」的执行层（cc 侧）—— 把 `ActivityJumpTable` 的 `target` 换成真实打开动作。
 *
 * 老端「前往」= `this.CtrlMgr.CtrlJumpView.JumpType(ref.goto)`，分发在
 * `client/assets/script/app/game/ctrl/jump/ViewJump.ts`。Demo3.8 没有 `JumpType`
 * （活动 / 赠送 / 七日 / 征收 / 联盟都各自标着「本工程还没接跳转链路」）
 * ⇒ 这里建一份**活动任务专用**的最小映射。
 *
 * ## 与老端的两条差异，都是有意的
 *
 *  ① **本端没有的目标一律兜底提示**（`ACTIVITY_TEXTS.gotoMissing`），不假装跳转成功。
 *     表里加了新类型、本端还没接，用户看到的是「该功能暂未开放」，而不是「点了没反应」。
 *  ② **切 tab / 切流程的目标要先把发起页关掉**（`kind === 'switch'`）。本端弹窗走
 *     `PopupManager` 的独立层（`Canvas/Popup`），切 tab 只换 `MainRoot/Content` 下的页面
 *     —— 弹窗会**原样盖在上面**，看上去和「点了没反应」一模一样。老端是整层 `unload()`，
 *     没有这个坑。弹窗类目标（征收 / 联盟商店 / 联盟捐献 / 战令）反过来**保留发起页**：
 *     关掉目标就回到每日任务，用户不用重新找入口（老端也是「叠层打开」）。
 *
 * 「怎么路由」（枚举值 / 每个目标的 `kind`）全在 `ActivityJumpTable.ts`（零 import、可单测）；
 * 本文件只负责「按 target 调 opener」。
 *
 * 已接线：`LayerActivityPage.onRowAction` 的 `goto` 分支。
 *
 * ⚠️ `league/LeagueJump.ts` 是同一套枚举的**联盟子集**（只登记 9/11/12/13，
 *    且口径是「一律不关当前面板」）。两份表目前有意各留一份：联盟那边有它自己的
 *    「不关面板」测试守着，合并属于另一次重构。**改这里时记得看一眼那边有没有同名的 target。**
 */
import { director } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { BattleTokenPage } from '../battletoken/BattleTokenPage';
import { HangPage } from '../hang/HangPage';
import { LeagueDonatePage } from '../league/LeagueDonatePage';
import { LeagueStorePage } from '../league/LeagueStorePage';
import { MainTab, MainTabHost } from '../main/MainTabHost';
import { ACTIVITY_TEXTS } from './LayerActivityTexts';
import { resolveActivityJump } from './ActivityJumpTable';
import type { ActivityJumpTarget } from './ActivityJumpTable';

export {
    ACTIVITY_JUMP_ROUTES,
    JUMP_TYPE,
    activityJumpLabel,
    activityJumpTargets,
    hasActivityJumpRoute,
    resolveActivityJump,
} from './ActivityJumpTable';
export type {
    ActivityJumpKind,
    ActivityJumpTarget,
    IActivityJumpRoute,
    JumpType,
} from './ActivityJumpTable';

/** 取当前场景里的 `MainTabHost`（取不到返回 `null`，由 opener 内部判空）。 */
function findTabHost(): MainTabHost | null {
    return director.getScene()?.getComponentInChildren(MainTabHost) ?? null;
}

/**
 * `target` → 真实打开动作。
 *
 * ⚠️ 键必须与 `ActivityJumpTable.ACTIVITY_JUMP_ROUTES` 里出现过的 target **完全覆盖**
 *    （单测 `activityJumpTargetIds()` 逐项查这张表，缺一个就红）。
 *    用 `Record<ActivityJumpTarget, ...>` 类型强制穷尽，漏了编译期就报错。
 */
const ACTIVITY_JUMP_OPENERS: Readonly<Record<ActivityJumpTarget, () => void>> = {
    // 老端 `LayerMainMenu` 的 `case JUMP_TYPE.HERO: switchTab2(TabRoleMain)`。
    // 本端「角色主界面」就是领地 tab（`ui/Role/Role`），与 `open.json` 的 `TabRoleMain` 同一条路。
    roleMain: () => { findTabHost()?.switchToRoleMain(); },
    // 老端 `case JUMP_TYPE.FIGHT: switchTab2(TabFight)`。本端对应格是竞技 tab（`ArenaRoot`）。
    arenaTab: () => { findTabHost()?.switchToTab(MainTab.Arena); },
    // 本端唯一的战斗流程；同主界面「开始游戏」按钮（`MainPage.onStartGame`）。
    matching: () => { ProcedureManager.navigate(GameRoute.Matching); },
    hang: () => { void HangPage.open({}); },
    leagueShop: () => { void LeagueStorePage.open({}); },
    leagueDonate: () => { void LeagueDonatePage.open({}); },
    battleToken: () => { void BattleTokenPage.open({}); },
    // 已经在目标页（`LayerActivityPage` 本身就是每日挑战），什么都不做。
    self: () => { /* 已在目标页 */ },
};

/**
 * 每日任务「前往」：按 `goto` 打开对应系统页。
 *
 * @param goto    配置表里的 `goto`（`JUMP_TYPE` 数值）。
 * @param dismiss 关掉**发起跳转的那个弹窗**。只有在目标是 `switch`（切 tab / 切流程）时
 *                才会被调用 —— 那时不关就完全看不到跳转结果（见文件头差异 ②）。
 *                目标是弹窗（`stack`）或本页（`self`）时**不关**。
 *
 * 未登记 / `goto <= 0` / 非法值 ⇒ 提示「该功能暂未开放」（不静默失败）。
 */
export function gotoActivityTask(goto: number, dismiss?: () => void): void {
    const route = resolveActivityJump(goto);
    if (!route) {
        FW.showTip(ACTIVITY_TEXTS.gotoMissing);
        return;
    }
    // `switch` 目标必须先关发起页：弹窗挂在独立层上，不关就盖住新页面（差异 ②）。
    // ⚠️ 关窗要在 `open()` **之前** —— `matching` 那条会切流程，之后 `this` 已经销毁。
    if (route.kind === 'switch') dismiss?.();
    ACTIVITY_JUMP_OPENERS[route.target]();
}
