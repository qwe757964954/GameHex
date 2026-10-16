/**
 * 战令（`LayerBattleToken`）全部文案 —— **改文案只动这一处**。
 *
 * 真源：老端 `client/assets/remoteRef/mL.json`（列式表 `k=["id","key","name"]`）。
 * 已核到的原文：
 *
 * | key | 原文 |
 * |---|---|
 * | `Client_NeedMoney` | `￥{0}` |
 * | `LayerBattleToken` | `指挥官已经开通该档位了，不能重复开通哦~` |
 * | `BATTLE_TOKEN_ALREADY_OPEN` | `该战令已购买` |
 * | `BATTLE_TOKEN_NOT_OPEN` | `战令未开启` |
 * | `BATTLE_TOKEN_NOT_MAX_LEVEL` | `战令未达最大等级` |
 * | `BATTLE_REWARD_NOT_TAKE_ALL` | `战令奖励未全部领取` |
 * | `BATTLE_TOKEN_ALREADY_REWARDED` | `战令奖励已领取` |
 * | `BATTLE_TOKEN_LEVEL_NOT_CONDITION` | `战令等级不满足条件` |
 *
 * 其余（页签按钮、页头说明、倒计时前缀）取自 FGUI「超值战令」包的组件内 `text` 属性，
 * 见各处注释。
 */

/** 战令文案表。 */
export const BT_TEXTS = {
    /** 面板标题（FGUI 底栏 4 个按钮的文案，按屏幕从左到右）。 */
    tabLevelFund: '等级基金',
    /**
     * ⚠️ 「七日登录」而不是「七日签到」—— FGUI 自己两处写法不一致，取值时**以可见的那个为准**：
     *   - `组件_战令.xml` 底栏 controller `标签页` 的页面名叫「七日签到」（**只是 controller 的页面名，
     *     底栏按钮的文案其实画在 27 张图标里**，`按钮_首页_菜单` 组件内一个 `text` 都没有）；
     *   - 而底栏按钮的图标由 controller `类型` 切换，`类型` 里 page 21 的名字是 **`七日登录`**
     *     （`组件_战令.xml` 里 `按钮_七日签到` 挂的正是 `controller="类型,21"`）；
     *   - 内容页 controller `标签` 也写 `七日登录`；效果图（`设计图/tt_通行战令2-标注.jpg`）底栏可见的
     *     也是「七日登录」。
     * ⇒ 按「七日签到」写会把 prefab 里已经摆好的「七日登录」在运行时**覆盖成另一个词**（不报错）。
     */
    tabSignIn: '七日登录',
    tabEnd: '通行证',
    tabPass: '过关令',

    /** 倒计时前缀（FGUI `文本_倒计时` 的初始 `text="活动倒计时:2天09:02:00"`）。 */
    countdownPrefix: '活动倒计时:',
    /** 结束时替换整句。 */
    activityEnd: '活动已结束',

    /** 通行证页「已消耗：」标签（FGUI `n138`）。 */
    consumedLabel: '已消耗：',
    /** 通行证页经验数字的最大值文案前缀（老端直接 `setText(vo.GetBattleTokenExp())`，无前缀）。 */
    expValuePrefix: '',

    /** 激活弹窗标题（FGUI `panel_bg` 的 `Label title="激活战令"`）。 */
    unlockTitle: '激活战令',
    /** 激活弹窗说明（FGUI `n9` 的 `gearText`：page 1 = 豪华）。 */
    unlockHintBasic: '激活基础战令，预计可以获得奖励:',
    unlockHintAdvanced: '激活豪华战令，预计可以获得奖励:',

    /** 免费档按钮文案（FGUI `按钮_购买_免费` 的 `title="今日福利"`，运行时被覆盖）。 */
    freeTitle: '今日福利',

    /** 付费按钮文案模板 —— 老端 `FW.G_W("Client_NeedMoney").replace("{0}", rmb)` ⇒ `￥6`。 */
    needMoney: '￥{0}',

    /** 重复开通提示（老端 `unlock()` 里 `FW.showTip(FW.G_W("LayerBattleToken"))`）。 */
    alreadyOpen: '指挥官已经开通该档位了，不能重复开通哦~',

    /** 协议错误码文案。 */
    errAlreadyOpen: '该战令已购买',
    errNotOpen: '战令未开启',
    errNotMaxLevel: '战令未达最大等级',
    errRewardNotAllTaken: '战令奖励未全部领取',
    errAlreadyRewarded: '战令奖励已领取',
    errLevelNotCondition: '战令等级不满足条件',

    /** 离线时的统一提示（Demo3.8 无支付 SDK，购买链路只到业务前置请求）。 */
    offlineTip: '网络未连接',
    /** 请求失败。 */
    failedTip: '操作失败，请稍后再试',
} as const;

/** 文案表的键类型。 */
export type BattleTokenTextKey = keyof typeof BT_TEXTS;

/**
 * 占位符替换（唯一入口）。
 *
 * 只支持 `{0}` / `{1}` 序号占位 —— 老端用的是同一个约定（`String.replace("{0}", x)`），
 * **注意 `String.replace` 只替换第一处**，所以这里也照做（多 `{0}` 的文案会留一个原样）。
 */
export function btFormat(template: string, ...args: readonly (string | number)[]): string {
    let out = template;
    for (let i = 0; i < args.length; i++) {
        out = out.replace(`{${i}}`, `${args[i]}`);
    }
    return out;
}

/** 付费按钮上的金额文案：`￥6`。 */
export function btMoneyText(rmb: number): string {
    return btFormat(BT_TEXTS.needMoney, rmb);
}

/** 倒计时整句。 */
export function btCountdownText(remainText: string): string {
    return `${BT_TEXTS.countdownPrefix}${remainText}`;
}

/** 激活弹窗的说明句：方案 3（豪华）走另一句。 */
export function btUnlockHint(isAdvanced: boolean): string {
    return isAdvanced ? BT_TEXTS.unlockHintAdvanced : BT_TEXTS.unlockHintBasic;
}

/** 底栏页签按钮文案（按类型号）。 */
export function btTabLabel(type: number): string {
    switch (type) {
        case 3: return BT_TEXTS.tabLevelFund;
        case 2: return BT_TEXTS.tabSignIn;
        case 4: return BT_TEXTS.tabPass;
        default: return BT_TEXTS.tabEnd;
    }
}
