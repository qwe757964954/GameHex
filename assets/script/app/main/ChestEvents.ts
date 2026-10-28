/**
 * 宝箱域的全部意图事件（**纯 TS、不 import `cc`**，可被单测直接 require）。
 *
 * 视图只 `emit`，由页面（`MainPage`）订阅后转给 `NewTreasureRepository`。
 * 口径见 `docs/AI架构与代码规范.md` §2.1：视图**不持有控制器入口**
 * —— 原来 `ChestSlotView.bindAction(handler)` / `ChestBar.bindCollapse(handler)`
 * 那种「把回调塞进视图」的写法，漏接一个就是「点了没反应且零报错」。
 */
export const CHEST_EVENTS = {
    // ── 宝箱栏（`ChestBar` / `ChestSlotView`）──
    /** 点了某一格的按钮。载荷：界面数组下标 `0~3`（不是服务端 1~4 的 `item.index`）。 */
    SLOT_ACTION: 'chest:slot-action',
    /** 宝箱栏收起（点折叠箭头 / 领奖后自动收）。无载荷。 */
    COLLAPSE: 'chest:collapse',
    /** 翻页。载荷：`-1` 上一页 / `1` 下一页。 */
    PAGE: 'chest:page',

    // ── 宝箱详情弹窗（`ChestDetailPanel`）──
    /** 关闭（×、暗底）。无载荷。 */
    CLOSE: 'chest-detail:close',
    /** 「立即打开」= 花银币跳过倒计时（`NewTreasureRepository.fastOpen`）。无载荷。 */
    FAST_OPEN: 'chest-detail:fast-open',
    /** 「打开」= 倒计时到点后开箱（`NewTreasureRepository.open`）。无载荷。 */
    OPEN: 'chest-detail:open',
} as const;
