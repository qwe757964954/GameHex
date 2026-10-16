/**
 * 「聊天」的全部文案 —— **唯一出口**。
 *
 * 老端走 `FW.G_W("CHAT_TITLE_" + channel)` 的多语言表；Demo3.8 没有多语言系统
 * （`assets/remoteRef` 下没有任何 lang/text 表），所以按 friend / gift / mail 的既有做法
 * 把文案集中在本文件。
 *
 * 键名保持与老端一致，方便「老端有没有这句」的检索。
 */

/** 频道页签名（下标 = `ChatChannel` 的数值）。 */
export const CHAT_TITLE: readonly string[] = [
    '招募',   // 0 CHAT_CHANNEL_RECRUIT
    '战区',   // 1 CHAT_CHANNEL_THEATER
    '世界',   // 2 CHAT_CHANNEL_WORLD
    '私聊',   // 3 CHAT_CHANNEL_PRIVATE
    '联盟',   // 4 CHAT_CHANNEL_UNION
];

export const CHAT_TEXTS = {
    /** `LayerChat_Title`：弹窗标题。 */
    title: '聊天',
    /** 输入框占位（FGUI `prompt="点击输入聊天内容"`）。 */
    inputPrompt: '点击输入聊天内容',
    /** 发送按钮。 */
    send: '发送',
    /** `数据=空` 时的占位文案（FGUI `n63` 的 `text="暂无聊天"`）。 */
    empty: '暂无聊天',
    /** 招募频道不可发言（FGUI `n98` 的 `text="该频道不可发言"`）。 */
    recruitSilent: '该频道不可发言',
    /** 招募项按钮（FGUI `Button title="点击加入"`）。 */
    joinTeam: '点击加入',
    /** 招募项的「战力」文案（`{0}` = 战力数值）。 */
    powerTemplate: '战力：{0}',

    /** `CHAT_SENSITIVE_WORD`：敏感词提示。 */
    sensitiveWord: '输入内容包含敏感词',
    /** `CHAT_CANNOT_JOIN_SELF_TEAM`。 */
    cannotJoinSelf: '不能加入自己的队伍',
    /** `CHAT_CANNOT_JOIN_IN_BATTLE`。 */
    cannotJoinInBattle: '战斗状态下不能加入队伍',
    /** `CHAT_NO_POINT_AT_ME`：老端点低 id 头像时的提示（`roleId < 1e4` 视为系统播报）。 */
    noPointAtMe: '该玩家不可查看',

    /**
     * 发送前的敏感词校验。
     *
     * 老端走 `SDKMgr.checkMessage(content, true)`（平台侧 SDK）；**Demo3.8 没有 SDK 层**
     * ⇒ 这里不做任何过滤，如实说明，不假装校验过。
     */
    sensitiveCheckUnavailable: '（Demo3.8 无 SDK 层，敏感词校验未接入）',
    /**
     * 招募「点击加入」。
     *
     * 老端 `ModelTeam.RequestTeamJoin(roleId, true)` 最终发的是
     * `CmdTeamReplyInviteReqMsg{ inviteId, agree, attr }`，**`attr` 是战前属性快照**
     * （`ModelTeam.GetBattleAttr()` → `CmdBattleRoleAttr`：卡组 / 属性 / 改造列表）。
     * Demo3.8 **没有任何地方构造过 `CmdBattleRoleAttr`**（卡牌养成 + 战力结算体系尚未接入，
     * 全工程 grep 只有 proto 声明本身）⇒ 发不出这一包。**如实说明，不假装加入了。**
     */
    joinUnavailable: '战前属性尚未接入，暂不能加入队伍',
    /** 加入失败（服务端回 `ret=0`）。 */
    joinFailed: '加入队伍失败',
    /** 点头像看资料：老端走 `CtrlPlayer.openOtherPlayerInfo`，Demo3.8 无该界面 ⇒ 明确提示。 */
    playerInfoUnavailable: '玩家资料界面尚未接入',
    /** 招募频道不可发言（输入条整块隐藏）时的兜底。 */
    channelReadonly: '该频道不可发言',
    /** 空输入。 */
    emptyInput: '请输入内容',
    /** 发送成功。 */
    sendOk: '发送成功',
    /** 请求三态。 */
    offline: '当前未连接服务器',
    requestFailed: '请求失败，请稍后重试',
    /** 删私聊对象成功。 */
    deleteOk: '已删除',
} as const;

/**
 * 富文本占位替换（`{0}` / `{1}` …）。
 *
 * ⚠️ 必须**全局**替换：模板里同一个 `{0}` 可能出现两次（上轮礼包的 `totalRowTitle` 就是这样）。
 */
export function formatText(template: string, ...args: (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (_m, i) => {
        const v = args[Number(i)];
        return v === undefined ? '' : String(v);
    });
}

/** 频道名（越界返回空串，不抛）。 */
export function channelTitle(channel: number): string {
    return CHAT_TITLE[channel] ?? '';
}
