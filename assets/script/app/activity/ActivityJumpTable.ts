/**
 * 每日任务「前往」的跳转表 —— **纯数据 + 纯函数，零 import**（连 `cc` 都没有）。
 *
 * 拆出来的理由与 `LayerActivityTable` / `LayerActivityLayout` 一致：把「怎么路由」的
 * 版面级别数字（`JUMP_TYPE` 数值、每个目标的打开方式）钉在可单测的模块里，
 * 让 `ActivityJump.ts` 只剩「按 target 调 opener」这一层机械代码。
 *
 * 真源：老端 `client/assets/script/app/game/model/jump/ModelJump.ts` 的 `JUMP_TYPE`
 *      + `client/assets/script/app/game/ctrl/jump/ViewJump.ts` 的 `switch (type)`
 *      + `client/assets/script/app/game/ctrl/main/LayerMainMenu.ts` 的 `"Jump"` 事件处理
 *      （`HERO` / `FIGHT` / `ARMY` / `SHOP` / `LEAGUE` 这五个是切**主界面底栏**页，
 *        不直接进 `ViewJump` 的 `switch`，而是走 `default` → 事件代理）。
 */

/**
 * 老端 `ModelJump.JUMP_TYPE`（逐字照抄，从 `NONE = 0` 起）。
 *
 * ⚠️ 写成 `as const` 对象而**不是** `const enum`：本表要被单测直接 `import`，
 *    `tsx`（esbuild）跨模块不支持 `const enum` 的内联展开，只会在运行时拿到 `undefined`。
 *    数值本身**不要重排** —— 它是配置表里的数字（`dayChallengeActTask.goto` /
 *    `taskUnion.goto`），改了就得同步改表。
 */
export const JUMP_TYPE = {
    NONE: 0,
    /** 英雄 / 角色 —— 老端切底栏「角色」页（`TabRoleMain`）。 */
    HERO: 1,
    /** 战斗 —— 老端切底栏「战斗」页（`TabFight`）。 */
    FIGHT: 2,
    /** 装备强化 —— 老端 `CtrlAlert.OpenLayerEquipEvolve(0)`（装备进化浮层）。 */
    EQUIP_BUILD: 3,
    /** 民兵天赋 */
    MILTIAATTR: 4,
    /** 兵营 —— 老端切底栏「兵营」页。 */
    ARMY: 5,
    /** 装备升品 —— 老端 `CtrlAlert.OpenLayerEquipEvolve(1)`。 */
    EQUIP_UPLV: 6,
    /** 快速战斗 —— 老端 `GotoFight(chapter, stage)` 直接进战斗。 */
    FAST_FIGHT: 7,
    /** 商店 —— 老端切底栏「商店」页（`TabStoreMain`）。 */
    SHOP: 8,
    /** 征收（挂机）—— 老端 `CtrlHang.openLayerHang()`。 */
    HANG: 9,
    /** 联盟 —— 老端切底栏「仙盟」页（`TabLeague`）。 */
    LEAGUE: 10,
    /** 联盟商店 —— 老端 `CtrlLeague.OpenLayerLeagueStore()`。 */
    LEAGUE_SHOP: 11,
    /** 联盟捐献 —— 老端 `CtrlLeague.OpenLayerLeagueDonate()`。 */
    LEAGUE_DONATE: 12,
    /** 每日挑战 —— 老端 `CtrlActivity.openLayerActivity()`（就是本页）。 */
    DAY_CHALLENGE: 13,
    /** 神源 —— 老端 `CtrlInstance.openLayerShenYuan()`。 */
    SHEN_YUAN: 14,
    /** 装备分解 —— 老端 `CtrlAlert.OpenLayerEquipBreak()`。 */
    EQUIP_DESTROY: 15,
    /** 装备副本 —— 老端 `CtrlInstance.openLayerEquipInstance()`。 */
    EQUIP_INSTANCE: 16,
    /** 主城建造 —— 老端 `CtrlMainCity.openLayerMainWalledCity()`。 */
    CITY_BUILD: 17,
    /** 武将 —— 老端 `CtrlArmy.openGeneeralMain()`。 */
    GENERAL: 18,
    /** 军师 —— 老端 `CtrlArmy.openLayerAdvisorMain()`。 */
    ADVISOR: 19,
    /** 守卫剑阁 —— 老端**空实现**（代码被注释掉了）。 */
    GUARD_JIAN_GE: 20,
    /** 祈神 —— 老端 `CtrlPleaseGod.openPleaseGod()`。 */
    PLEASGOD: 21,
    /** 排行榜 —— 老端 `CtrlRank.openLayerMainRank()`。 */
    RANK: 22,
    /** 首充 —— 老端 `CtrlFirstRecharge.openLayerFirstRecharge()`。 */
    FIRST_CHARGE: 23,
    /** 战令 —— 老端 `CtrlBattleToken.openLayerBattleToken()`。 */
    BattleToken: 24,
    /** 守卫 —— 老端 `CtrlGuards.openLayerGuards()`。 */
    GUARDS: 25,
    /** 转盘活动 —— 老端 `CtrlActivity.openSpinActivity(args)`。 */
    SPIN_ACTIVITY: 26,
} as const;

/** `JUMP_TYPE` 的数值联合。 */
export type JumpType = (typeof JUMP_TYPE)[keyof typeof JUMP_TYPE];

/**
 * 跳转的「打开方式」。
 *
 * - `stack`  目标是个弹窗，**叠在发起页之上**，不关发起页（关掉目标就回到这里）。
 * - `switch` 目标是主界面 tab 页 / 另一条流程，**必须先关掉发起页** ——
 *            本端弹窗挂在 `Canvas/Popup` 独立层上，切 tab 只换 `MainRoot/Content`
 *            下的页面，不关的话弹窗原样盖住新页面，看上去和「点了没反应」一样。
 * - `self`   目标就是发起页本身 ⇒ 已经在目标页，不关窗、不做动作。
 */
export type ActivityJumpKind = 'stack' | 'switch' | 'self';

/**
 * 本端**确实能到**的目标标识。`ActivityJump.ts` 里有一张同名的 opener 表；
 * 两边靠 `activityJumpTargets()` / 单测钉住一一对应。
 */
export type ActivityJumpTarget =
    /** 角色主界面（领地 tab，`MainTabHost.switchToRoleMain()`） */
    | 'roleMain'
    /** 战斗主界面（竞技 tab，`ArenaRoot`） */
    | 'arenaTab'
    /** 战斗流程（`ProcedureManager.navigate(GameRoute.Matching)`） */
    | 'matching'
    /** 征收（`HangPage`） */
    | 'hang'
    /** 联盟商店（`LeagueStorePage`） */
    | 'leagueShop'
    /** 联盟捐献（`LeagueDonatePage`） */
    | 'leagueDonate'
    /** 战令（`BattleTokenPage`） */
    | 'battleToken'
    /** 本页（每天挑战 = `LayerActivityPage`） */
    | 'self';

/** 一条跳转目标。 */
export interface IActivityJumpRoute {
    /** 目标页的可读名（测试 / 日志用，不面向玩家）。 */
    readonly label: string;
    readonly kind: ActivityJumpKind;
    readonly target: ActivityJumpTarget;
}

/**
 * `goto` → 目标。**只登记本端确实能到的地方**，其余一律兜底提示
 * （`ACTIVITY_TEXTS.gotoMissing`），不假装跳转成功。
 *
 * 表宽有意收得很窄：`dayChallengeActTask.goto` 实测只出现 `1 / 2 / 3 / 7 / 7`，
 * 这里多登记的几项（9 / 11 / 12 / 13 / 24）都是「老端同名、本端也确实有同名页」的稳妥项，
 * 方便策划改表后直接生效。
 */
export const ACTIVITY_JUMP_ROUTES: Readonly<Record<number, IActivityJumpRoute>> = {
    // 本端 `open.json` 的 `TabRoleMain`（老端「角色主界面」）已经映射成
    // `MainEntranceRoute` → `MainTabHost.switchToRoleMain()` ⇒ 复用同一条路，不另起一套。
    [JUMP_TYPE.HERO]: { label: '角色主界面（领地 tab）', kind: 'switch', target: 'roleMain' },
    // 本端底栏第 2 格「竞技」挂的是 `ui/main/ArenaRoot`，它**就是战斗选关主界面**
    // （`BeginGame`「开始游戏」+ 左右入口列 + 聊天 / 排行榜入口），不是 PvP 天梯页。
    [JUMP_TYPE.FIGHT]: { label: '战斗主界面（竞技 tab / ArenaRoot）', kind: 'switch', target: 'arenaTab' },
    // 老端的「装备进化」浮层本端没有；但它的**常规入口就是角色主界面**
    // （`client/.../main/role/TabRoleMain.ts:224` 是唯一一处非跳转调用）
    // ⇒ 降级成「带你到放装备的那一页」。
    //   不接 `CardUpgradePage`（本端唯一的升级弹窗）的原因：它要一张**卡牌实例**
    //   （`onOpen(userData)`），凭空打开拿不到数据 ⇒ 那不是跳转，是崩溃。
    [JUMP_TYPE.EQUIP_BUILD]: { label: '角色主界面（装备栏所在页）', kind: 'switch', target: 'roleMain' },
    // 本端只有一条战斗流程（`ProcedureMatching`），也是主界面「开始游戏」按钮的目标
    // （`MainPage.onStartGame()`）⇒ 走同一条路。
    [JUMP_TYPE.FAST_FIGHT]: { label: '战斗流程（GameRoute.Matching）', kind: 'switch', target: 'matching' },
    [JUMP_TYPE.HANG]: { label: '征收（HangPage）', kind: 'stack', target: 'hang' },
    [JUMP_TYPE.LEAGUE_SHOP]: { label: '联盟商店（LeagueStorePage）', kind: 'stack', target: 'leagueShop' },
    [JUMP_TYPE.LEAGUE_DONATE]: { label: '联盟捐献（LeagueDonatePage）', kind: 'stack', target: 'leagueDonate' },
    [JUMP_TYPE.BattleToken]: { label: '战令（BattleTokenPage）', kind: 'stack', target: 'battleToken' },
    // 老端 `CtrlActivity.openLayerActivity()` —— 就是本页（每日挑战 = `LayerActivityPage`）。
    [JUMP_TYPE.DAY_CHALLENGE]: { label: '每日挑战（本页）', kind: 'self', target: 'self' },
};

/** 解析一个 `goto`；未登记 / `0` / 非法值都返回 `null`（**不抛**）。 */
export function resolveActivityJump(goto: number): IActivityJumpRoute | null {
    if (!Number.isFinite(goto)) return null;
    return ACTIVITY_JUMP_ROUTES[Math.floor(goto)] ?? null;
}

/** `goto` 有没有登记目标。 */
export function hasActivityJumpRoute(goto: number): boolean {
    return resolveActivityJump(goto) !== null;
}

/** `goto` 对应目标的可读名；未登记返回空串。 */
export function activityJumpLabel(goto: number): string {
    return resolveActivityJump(goto)?.label ?? '';
}

/** 已登记目标的全部 `goto` 值（升序），供测试钉表宽。 */
export function activityJumpTargets(): readonly number[] {
    return Object.keys(ACTIVITY_JUMP_ROUTES).map(Number).sort((a, b) => a - b);
}

/** 表里出现过的全部 target（去重、按首次出现序）。 */
export function activityJumpTargetIds(): readonly ActivityJumpTarget[] {
    const seen: ActivityJumpTarget[] = [];
    for (const key of activityJumpTargets()) {
        const target = ACTIVITY_JUMP_ROUTES[key].target;
        if (!seen.includes(target)) seen.push(target);
    }
    return seen;
}
