/**
 * 个人信息五弹窗 + 设置面板的文案**唯一出口**（零 `cc`）。
 *
 * 中文值全部来自老端 `assets/remoteRef/mL.json`（`{k:['id','key','name'], v:[[…]]}`
 * 列式表，607 行）—— 每条的 key 写在注释里，便于日后与老端逐条对账。
 * 界面上的**静态标签**（"等级：" 这类）直接取 FGUI 原稿的 `text=`（不是 mL 文案）。
 *
 * 本工程沿用 `MainTaskTexts` / `ItemDetailTexts` 的口径：不引文案表服务、硬编常量。
 */
export const PLAYER_INFO_TEXTS = {
    // ============================================================
    // 面板标题（FGUI 原稿 `<component name="popBg">` 上的 `<Label title="…"/>`）
    // ============================================================
    /** 老端 `mL.PLAYER_TITLE`，`LayerPlayerInfo` 里再 `setText` 一次。 */
    playerTitle: '个人信息',
    /** FGUI `组件_查看信息_界面` 的 `<Label title="玩家信息"/>`。 */
    otherTitle: '玩家信息',
    /** FGUI `组件_个人信息_更换头像界面` 的 `<Label title="更换头像"/>`。 */
    changeHeadTitle: '更换头像',
    /** FGUI `组件_个人信息_更换昵称界面` 的 `<Label title="改名"/>`。 */
    renameTitle: '改名',
    /** FGUI `组件_设置` 的 `<Label title="设置"/>`。 */
    settingTitle: '设置',
    /** FGUI `组件_设置` 里小标题条（`组件_公共标签_黄`）的 `<Label title="声音"/>`。 */
    settingSoundSection: '声音',

    // ============================================================
    // 个人信息面板（静态标签 = FGUI 原稿 text）
    // ============================================================
    changeHeadButton: '更换头像',
    settingButton: '设置',
    levelKey: '等级：',
    uidKey: 'uid：',
    serverKey: '区服：',
    redeemButton: '确定',
    logoutButton: '切换角色',
    /** 等级/UID 取不到时的占位。 */
    emptyValue: '',
    /** 头像图加载失败时的兜底（不弹字，只是不设图 —— 保持底框可见）。 */
    headPlaceholderHint: '点击选择头像',
    /** 「切换角色」—— 老端走 `SDKMgr.switchRole()`，本工程登录链路未接（与跳转同一处置）。 */
    logoutNotWired: '切换角色未接入',
    /** 改名红点/入口在加载中时的兜底提示（头像列表还没回来）。 */
    headListEmpty: '暂无可选头像',

    /**
     * 断线 —— 客户端**压根没连上服务器**，请求根本没发出去
     * （`PlayerInfoRepository.send()` 第一句 `if (!net.isConnected) return 'offline'`）。
     *
     * ⚠️ 与 `xxxFailed`（发出去了、超时或服务端拒）**必须分开**。
     * 2026-09-28 山猫报「更换头像的时候，显示更换头像失败」：实测根因是**同一账号第二端登录
     * 把这一端的 socket 顶掉**（`GameNet.isConnected === false`），客户端连包都没发，
     * 但因为两态共用一句「更换头像失败，请稍后重试」，被读成「这个功能坏了」。
     */
    offlineTip: '网络未连接，请稍后重试',

    // ============================================================
    // 兑换码（老端 `mL.LayerSetting_1`）
    // ============================================================
    redeemEmpty: '兑换码不能为空',
    redeemPlaceholder: '输入兑换码',
    /** 兑换成功（老端没有这条文案，服务端直发奖励；本工程给个明确反馈）。 */
    redeemSuccess: '兑换成功',
    redeemFailed: '兑换失败',

    // ============================================================
    // 改名（老端 `mL.LayerRename_*`、`mL.ROLE_NAME_CONTAIN_SENSITIVE_WORD`）
    // ============================================================
    /** `LayerRename_1`。 */
    renameSuccess: '修改成功',
    /** `LayerRename_2` —— 输入为空（含被过滤成空）。 */
    renameEmpty: '昵称不能为空哦~',
    /** `LayerRename_3` —— 与当前名相同。 */
    renameSame: '请填写新的昵称~',
    /** `LayerRename_4`，`{0}` 是金币数（`StringUtil.format` 口径）。 */
    renameCostConfirm: '本次改名需要花费{0}金币，是否确认修改？',
    /** `LayerRename_5`。 */
    renameNotEnough: '改名所需金币不足',
    /** `ROLE_NAME_CONTAIN_SENSITIVE_WORD`。 */
    renameSensitive: '玩家名称包含敏感字',
    /** 发请求失败 / 离线（老端服务端直发提示，本工程给个明确反馈）。 */
    renameRequestFailed: '改名失败，请稍后重试',
    /** FGUI `按钮_免费` 的 `<Button title="免费"/>`。 */
    renameFreeButton: '免费',
    /** FGUI `text_tips`（老端是 UBB 富文本 `剩余免费次数：[color=#00ff00]{count=1}[/color]`）。 */
    renameFreeTipsPrefix: '剩余免费次数：',
    /** 敏感词命中后把输入框替换成的占位串（老端 `showSensitiveNameTip` 的 `***`）。 */
    renameSensitiveMask: '***',
    /** 输入框提示（FGUI `prompt="请输入新的名称"`）。 */
    renamePlaceholder: '请输入新的名称',
    /** 输入合法字符的说明（老端是静默过滤，本工程额外给一句提示）。 */
    renameInputHint: '仅支持中英文、数字、下划线与连字符',

    // ============================================================
    // 更换头像（老端 `mL.LayerChangeHead_1` / `_2`）
    // ============================================================
    /** `LayerChangeHead_1` —— 该头像还没解锁。 */
    changeHeadLocked: '还没获得该头像哦~',
    /** `LayerChangeHead_2` —— 选中平台头像时的描述。 */
    changeHeadPlatformDesc: '自定义头像',
    /** FGUI `btn_confirm` 的 `<Button title="确认"/>`。 */
    changeHeadConfirm: '确认',
    /** 发请求失败 / 离线。 */
    changeHeadFailed: '更换头像失败，请稍后重试',
    /** 头像名为空时的兜底。 */
    changeHeadNoName: '',

    // ============================================================
    // 他人信息（FGUI 原稿 text）
    // ============================================================
    otherSearchPlaceholder: '输入玩家名 / ID',
    otherAttackKey: '攻击力：',
    otherUidKey: '玩家ID：',
    otherBattleLevelKey: '关卡进度：',
    otherUnionKey: '联盟信息：',
    otherBlackButton: '拉黑',
    otherBlackButtonActive: '解除拉黑',
    otherFriendButton: '添加好友',
    otherFriendButtonActive: '删除好友',
    otherChatButton: '私聊',
    /** `CmdRoleInfoViewReqMsg` 请求失败 / 离线（本工程给个明确提示，老端直接 `unload()`）。 */
    otherLoadFailed: '玩家信息获取失败',
    /** `mL.NOT_CHAT_SELF`。 */
    otherNotChatSelf: '不能私聊自己',
    /** `mL.NOT_PRIVATE_CHAT`。 */
    otherNotPrivateChat: '请先添加对方为好友',
    /**
     * `mL.BLACK_TARGET_FRIEND`。
     * ⚠️ 语义是「**我**已把对方拉黑，想加好友得先解除」，不是「对方拉黑了我」。
     */
    otherBlackTargetFriend: '您已拉黑对方，请先从黑名单移除',
    /** 好友 / 拉黑 / 私聊请求失败。 */
    otherActionFailed: '操作失败，请稍后重试',
    /** 跳转链路未接（与主线任务 / 礼包同一处置：留接线口 + 提示）。 */
    jumpNotWired: '跳转未接入',

    // ============================================================
    // 设置面板（FGUI 原稿 text）
    // ============================================================
    settingMusicSwitch: '音乐开关',
    settingMusicVolume: '音乐音量',
    settingSoundSwitch: '音效开关',
    settingSoundVolume: '音效音量',
} as const;

export type PlayerInfoTexts = typeof PLAYER_INFO_TEXTS;
