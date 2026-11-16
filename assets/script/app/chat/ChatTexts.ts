/**
 * 「聊天」的全部文案 —— 唯一出口。
 *
 * 工程没有多语言系统，按 friend / gift / mail 的既有做法集中在本文件；
 * 键名与老端 `CHAT_*` 常量保持一致，方便对照检索。
 */

/** 频道页签名（下标 = `ChatChannel` 的数值）。 */
export const CHAT_TITLE: readonly string[] = [
    '招募',   // 0 Recruit
    '战区',   // 1 Theater
    '世界',   // 2 World
    '私聊',   // 3 Private
    '联盟',   // 4 Union
];

export const CHAT_TEXTS = {
    /** 弹窗标题（FGUI `LayerChat_Title`）。 */
    title: '聊天',
    /** 输入框占位（FGUI `prompt="点击输入聊天内容"`）。 */
    inputPrompt: '点击输入聊天内容',
    /** 发送按钮。 */
    send: '发送',
    /** 数据为空时的占位（FGUI `n63` 的静态文案）。 */
    empty: '暂无聊天',
    /** 招募频道不可发言（FGUI `n98` 的静态文案）。 */
    recruitSilent: '该频道不可发言',
    /** 招募项的加入按钮。 */
    joinTeam: '点击加入',
    /** `{0}` = 战力数值。 */
    powerTemplate: '战力：{0}',

    sensitiveWord: '输入内容包含敏感词',
    cannotJoinSelf: '不能加入自己的队伍',
    cannotJoinInBattle: '战斗状态下不能加入队伍',
    /** 点头像看资料：老端把 `roleId < 1e4` 当系统播报，不开放资料页。 */
    noPointAtMe: '该玩家不可查看',

    /** 老端走平台 SDK 校验敏感词；本工程没有 SDK 层，如实说明未接入。 */
    sensitiveCheckUnavailable: '（Demo3.8 无 SDK 层，敏感词校验未接入）',
    /** 老端入队要带战前属性快照（`CmdBattleRoleAttr`），本工程尚未接入 ⇒ 这一包发不出去。 */
    joinUnavailable: '战前属性尚未接入，暂不能加入队伍',
    joinFailed: '加入队伍失败',
    /** 点头像看资料：老端走 `CtrlPlayer.openOtherPlayerInfo`，本工程没有该界面。 */
    playerInfoUnavailable: '玩家资料界面尚未接入',
    emptyInput: '请输入内容',
    sendOk: '发送成功',
    offline: '当前未连接服务器',
    requestFailed: '请求失败，请稍后重试',
    deleteOk: '已删除',
} as const;

/** 富文本占位替换（`{0}` / `{1}` …）；同一占位出现多次要全部替换。 */
export function formatText(template: string, ...args: (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (_placeholder, index) => {
        const value = args[Number(index)];
        return value === undefined ? '' : String(value);
    });
}

/** 频道名；越界返回空串，不抛。 */
export function channelTitle(channel: number): string {
    return CHAT_TITLE[channel] ?? '';
}
