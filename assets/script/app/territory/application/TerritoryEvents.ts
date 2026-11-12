import type { TerritoryModelOutput } from './TerritoryModel';
import type { ITerritoryRenderState } from './TerritoryViewState';

export const TerritoryUiEvent = {
    Intent: 'territory:ui-intent', Ready: 'territory:view-ready', Disposed: 'territory:view-disposed',
    /**
     * 章节入口（地图起始格的章节建筑 / 它头上的「章节」气泡）点了 ⇒ 宿主页开章节选择弹窗。
     *
     * 🔴 这一条**必须有名字**：`TerritoryStationView` 发它、`MainPage` 订阅它，谁都不知道对方。
     *    少了这个键两边都拿 `undefined` 当事件名 —— `emit` / `on` 恰好都落在同一个空键上，
     *    功能看着还能用，实际是「两条无关的 undefined 撞在一起」，加任何第三个事件就崩。
     */
    ChapterSelect: 'territory:chapter-select',
} as const;
export const TerritoryViewEvent = { Render: 'territory:render', Command: 'territory:view-command' } as const;
export type TerritoryIntent =
    | { readonly kind: 'siteTap' | 'randomTap'; readonly cellId: number }
    | { readonly kind: 'enterBattle'; readonly payload: import('./TerritoryModel').ITerritoryNavigateBattlePayload }
    | { readonly kind: 'chapter'; readonly offset: number }
    /**
     * 章节选择弹窗里点了某一行 ⇒ 按 `chapterId` 直接切（`chapter` 只够「翻一页」）。
     *
     * 🔴 2026-11-04 补：这条一直是**运行时**在用（`ChapterSelectPanel` 发、
     *    `TerritoryController` 收），但没写进联合类型 —— 结果控制器那个 `case` 是死分支，
     *    TS 也帮不上忙。加回来之后「回到已通过的章节」这条路才有类型保障。
     */
    | { readonly kind: 'selectChapter'; readonly chapterId: number }
    | { readonly kind: 'battle' | 'closeDetail' | 'openLevelTip' | 'closeLevelTip' | 'scout' | 'focusLevel'
        /** 金币车征收：领取当前章节已占领据点的累计产出并展示奖励。 */
        | 'claimIdleRewards'
        /** 整页过场接手开战：此后程序关掉详情不作废在途开战请求（见 `TerritoryModel.battleHandoff`）。 */
        | 'keepBattleRequest'
        /** 战斗流程没接手 ⇒ 复位在途开战态，别让「开始战斗」变成死按钮。 */
        | 'cancelBattleStart' }
    /**
     * 征收弹窗的「快速征收」：对当前进度关卡格发 `CmdCityChapterSweepReqMsg`。
     *
     * `times` = 扫荡倍率（协议 `optional uint32 times = 3`，缺省 1），来自弹窗的
     * `GearSwitch` 档位（1/5/10/20/50）。**必须随意图一起带到 Model** ——
     * 只在视图里改角标文案、请求仍发 1 倍，是最难发现的那种「界面变了但没生效」。
     */
    | { readonly kind: 'sweepChapter'; readonly times?: number };
export interface ITerritoryIntentEvent { readonly intent: TerritoryIntent }
export type TerritoryViewCommand = Exclude<TerritoryModelOutput, { readonly kind: 'changed' | 'navigate' }>
    | { readonly kind: 'navigate'; readonly payload: import('./TerritoryModel').ITerritoryNavigateBattlePayload; readonly ready?: Promise<unknown> }
    | { readonly kind: 'focusCell'; readonly cellId: number }
    | { readonly kind: 'prepareBattle' };
export interface ITerritoryCommandEvent { readonly command: TerritoryViewCommand }
export interface ITerritoryRenderEvent { readonly state: ITerritoryRenderState }

export type { ITerritoryRewardPresentation, ITerritoryDetailState, ITerritoryLevelInfoContent,
    ITerritoryLevelTipContent, ITerritoryNavigateBattlePayload, ITerritoryPlayerStageContent,
    ITerritoryShowRewardsPayload, ITerritoryShowTipPayload, ITerritorySetBusyPayload } from './TerritoryModel';
