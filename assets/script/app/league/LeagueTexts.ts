/**
 * 「联盟」文案的**唯一来源**（纯数据，不 import `cc`）。
 *
 * 约定（同 `FriendTexts` / `GiftTexts`）：页面类里**不出现中文字面量**，
 * 一律从这里取；这样文案调整只改一处，也让单测能直接断言。
 */

/** 入口尚未开放时的统一提示。 */
export const LEAGUE_TIP_NOT_OPEN = '该功能尚未开放，敬请期待';

/** 联盟数据还没取回来时点入口的提示。 */
export const LEAGUE_TIP_LOADING = '联盟数据加载中，请稍候';

/**
 * 请求三态的降级文案（口径同 `GiftTexts` 的 `offline` / `failed`）。
 *
 * 大厅里的写操作（踢人 / 任命 / 卸任）都是「发出去、随推送刷新界面」，
 * 三态里只有 `'ok'` 是静默的，另外两态要明确告知 —— 不静默吞。
 */
export const LEAGUE_TIP_OFFLINE = '网络未连接，请稍后再试';
export const LEAGUE_TIP_FAILED = '操作失败，请稍后再试';

// ============================================================
// 大厅（`ui/League/LeagueHall`）
// ============================================================

/** 三个页签文案（顺序 = FGUI `标签` controller 的页序：详情 / 动态 / 全服联盟）。 */
export const LEAGUE_HALL_TABS = ['详情', '动态', '全服联盟'] as const;

/** 联盟名为空时的兜底（FGUI `lab_notice` 的默认串）。 */
export const LEAGUE_HALL_DEFAULT_NOTICE = '暂无公告';

/** 等级后缀（老端 `FW.G_W("LV_TEXT")`）。 */
export const LEAGUE_HALL_LV_SUFFIX = '级';
/** 联盟 ID 前缀（老端 `ID:${cmd.id}`）。 */
export const LEAGUE_HALL_ID_PREFIX = 'ID:';
/**
 * 联系微信号前缀（老端 `FW.G_W("CONTACT_WAY")`）。
 *
 * ⚠️ 冒号是**全角** `：`（U+FF1A）—— 老端运行时取的是 `mL.json` 的 `CONTACT_WAY` = 「微信号：」。
 *    FGUI 设计稿 `组件_联盟_大厅.xml` 的 `league_wx` 写的是半角 `微信号:`（U+003A），
 *    那只是**设计期占位串**（运行时会整条被老端覆盖），不能当运行时真值。
 *    两处逐字节差异见 `tests/league-hall.test.ts` 的 D1 段（该段连同 U+FF1A 一起断言）。
 */
export const LEAGUE_HALL_WX_PREFIX = '微信号：';
/** 管理按钮文案（FGUI `按钮_联盟_管理` 的 `<text title="管理">`）。 */
export const LEAGUE_HALL_MGR_LABEL = '管理';

/** 详情页签表头三列（真源 = FGUI 组件_联盟_大厅详情.xml 的 `<text>`）。 */
export const LEAGUE_HALL_DETAIL_HEADERS = {
    memberCount: '联盟成员',
    lastLogin: '上次登陆',
    contribution: '今日/历史贡献',
} as const;

/** 全服页签查询框的输入提示（FGUI `lab_input` 的 `prompt`）。 */
export const LEAGUE_HALL_SEARCH_PROMPT = '点击输入ID';

/** 数据未就绪时大厅头部用的占位（与主页信息条同源）。 */
export const LEAGUE_HALL_PLACEHOLDER = {
    name: '北伐中原',
    level: 4,
    notice: '暂无公告',
    id: 2115228,
    wxChat: 'lianmeng_888',
    exp: 199,
    maxExp: 299,
    memberCount: 26,
    maxMemberCount: 46,
} as const;

// ============================================================
// 子面板：退出提示（`组件_联盟_大厅_退出提示`）
// ============================================================

/**
 * 退出联盟的二次确认正文。
 *
 * 真源 = FGUI `大厅/组件_联盟_大厅_退出提示.xml` 的 `<text>`（FGUI **写死了这句**，
 * 老端没有走 `FW.G_W`），所以这里逐字照搬 —— **含原文的「推出后」**（应为「退出后」，
 * 属老端文案笔误）。移植保真优先，不改字。
 */
export const LEAGUE_EXIT_CONFIRM_CONTENT =
    '是否退出联盟?推出后1小时内不能再加入联盟,盟主职位将自动给本联盟内个人累计贡献值最高的玩家';

/** 退出提示的两个按钮（FGUI `<Button title=…>`）。 */
export const LEAGUE_EXIT_CONFIRM_SURE = '确定';
export const LEAGUE_EXIT_CONFIRM_CANCEL = '取消';

// ============================================================
// 子面板：等级预览（`组件_联盟_大厅_等级预览`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="等级预览"/>`）。 */
export const LEAGUE_LEVEL_PREVIEW_TITLE = '等级预览';

/**
 * 等级行的标题前缀（老端 `FW.G_W("LV_TEXT_0")`）。
 *
 * `mL.json`（`id=444`）里 `LV_TEXT_0` = **「等级」** ⇒ 行标题渲染成「等级4」。
 */
export const LEAGUE_LEVEL_ROW_TITLE_PREFIX = '等级';

/**
 * 等级行的副文案前缀（老端 `FW.G_W("UNION_LEVEL_PREVIEW_TEXT")`）。
 *
 * `mL.json`（`id=445`）里 = **「最大可加入人数：+」**，后面紧跟本级**新增**上限
 * （第 1 级 = 上限本身，之后 = 本级上限 − 上一级上限）。
 */
export const LEAGUE_LEVEL_ROW_CTX_PREFIX = '最大可加入人数：+';

// ============================================================
// 子面板：申请列表（`组件_联盟_大厅_申请列表`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="申请管理"/>`）。 */
export const LEAGUE_APPLY_TITLE = '申请管理';

/** 面板底部两个批量按钮（FGUI `<Button title=… titleFontSize="30">`）。 */
export const LEAGUE_APPLY_ALL_AGREE = '全部同意';
export const LEAGUE_APPLY_ALL_REJECT = '全部拒绝';

/**
 * 申请行内两个按钮（FGUI `组件_联盟_联盟角色申请` 的 `<Button title=… titleFontSize="28">`）。
 *
 * ⚠️ 两个按钮的**语义与底图要对上**：`btn_kick`（文案「拒绝」）用 `TY_btn09`、
 *    `btn_sure`（文案「同意」）用 `TY_btn10` —— 老端 `renderApply` 里
 *    `btn_kick → RequestLeagueApproveJoin(applyId, **false**)`、
 *    `btn_sure → …(applyId, **true**)`。名字里的 kick 是设计稿复用笔误，别按名字接。
 */
export const LEAGUE_APPLY_ROW_REJECT = '拒绝';
export const LEAGUE_APPLY_ROW_AGREE = '同意';

// ============================================================
// 子面板：编辑信息（`组件_联盟_大厅_编辑信息`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="编辑信息"/>`）。 */
export const LEAGUE_EDIT_TITLE = '编辑信息';

/** 两个按钮（FGUI `<Button title=… titleFontSize="30">`）。 */
export const LEAGUE_EDIT_SURE = '确定';
export const LEAGUE_EDIT_CANCEL = '取消';

/**
 * 编辑框里「被判为违禁词」的占位串 —— 老端 `showSensitiveTip` 的 `input.setText("***")`。
 *
 * 老端 `onBtnOk` 的第一句守卫就是 `if (!content || content == "***") return`：
 * 也就是说**只要输入框里是 `***` 就当作「没填」直接早退**（不发包）。移植照搬这条。
 */
export const LEAGUE_EDIT_REJECTED_PLACEHOLDER = '***';

/**
 * 违禁词提示（老端 `FW.G_W("CHAT_SENSITIVE_WORD")`，`mL.json`）。
 *
 * ⚠️ 目前**发不出来**：老端的违禁词校验走 `SDKMgr.checkMessage`，而 Demo3.8
 *    **没有 SDK 层**（同 `app/chat/ChatTexts.sensitiveWord` 处的说明）⇒ 编辑信息面板
 *    暂不做校验（见 `LeagueEditPage` 的类头第 4 条）。留着这条文案是为了将来补上校验时
 *    不用再回老端查字 —— 那时把 `checkMessage` 的失败分支接上即可。
 */
export const LEAGUE_EDIT_SENSITIVE_TIP = '聊天：有违禁词';

// ============================================================
// 子面板：管理（`组件_联盟_大厅_管理`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="联盟管理"/>`）。 */
export const LEAGUE_MGR_TITLE = '联盟管理';

/** 宣言 / 公告两个「告示」块的标题（FGUI 实例用 `<property target="title" …/>` 覆盖组件默认值）。 */
export const LEAGUE_MGR_DECLARATION_TITLE = '联盟宣言';
export const LEAGUE_MGR_NOTICE_TITLE = '联盟公告';

/**
 * 底部两颗按钮（FGUI `<Button title=…>`）。
 *
 * ⚠️ 「退出联盟」在 FGUI 里是**两颗同名按钮**（`btn_quit` / `btn_quit1`）挂在 `管理`
 *    controller 的**互斥**两页上：能审批时显示「申请管理 + 退出联盟」，
 *    不能审批时只显示**居中那颗** `btn_quit1`。文案一样，落地时共用本常量。
 */
export const LEAGUE_MGR_APPLY = '申请管理';
export const LEAGUE_MGR_QUIT = '退出联盟';

/** 「允许快速加入」勾选框右侧的说明文字（FGUI `n23`，`管理` controller 第 1 页才显示）。 */
export const LEAGUE_MGR_QUICK_JOIN = '允许快速加入';

// ============================================================
// 子面板：联盟信息（`组件_联盟_大厅_联盟信息`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="联盟信息"/>`）。 */
export const LEAGUE_INFO_TITLE = '联盟信息';

/** 宣言块标题（FGUI `comp_dec` 的实例覆盖值）。 */
export const LEAGUE_INFO_DECLARATION_TITLE = '联盟宣言';

/** 唯一的按钮（FGUI `<Button title="加入">`）。 */
export const LEAGUE_INFO_JOIN = '加入';

/**
 * 联盟数据取不到时的提示（老端 `FW.G_W("LEAGUE_INFO_NOT_FOUND")`，`mL.json`）。
 *
 * 老端 `LayerLeagueInfoUI.updateView()` 的 `else` 分支：`showTip` 之后**立刻 `unload()`**
 * ⇒ 本端照搬（`LeagueInfoPage` 里提示 + `close()`）。
 */
export const LEAGUE_INFO_NOT_FOUND = '未找到联盟信息';

// ============================================================
// 加入联盟（`ui/League/LeagueJoin`）—— 「未入盟」态的整页
// ============================================================

/**
 * 底部两颗按钮的文案（FGUI `组件_联盟_加入联盟` 的
 * `btn_creat` / `btn_join`，`<Button title=… titleFontSize="35">`）。
 */
export const LEAGUE_JOIN_BTN_CREATE = '创建联盟';
export const LEAGUE_JOIN_BTN_QUICK = '快速加入';

/**
 * 「没有可加入的联盟」—— 老端 `FW.G_W("LEAGUE_NO_JOINABLE")`。
 *
 * `mL.json`（**`id=553`**，key 列 `LEAGUE_NO_JOINABLE`）里 = **「没有可加入的联盟」**。
 * 触发点：老端 `TabLeagueJoin.onClickJoin()` 取「可快速加入」列表为空时 `showTip` 后**不发包**。
 *
 * ⚠️ id 是**逐行核对 `assets/remoteRef/mL.json` 的 `[id, key, name]` 三列**得出的
 *    （`id=554` 是 `LEAGUE_EXPEDITION_DRUM_LIMIT`「今日擂鼓次数已用尽」，差一位就串了）。
 */
export const LEAGUE_NO_JOINABLE = '没有可加入的联盟';

// ============================================================
// 创建联盟（`ui/League/LeagueCreate`）
// ============================================================

/** 弹窗标题（FGUI `popBg` 的 `<Label title="创建联盟"/>`）。 */
export const LEAGUE_CREATE_TITLE = '创建联盟';

/** 联盟名输入框的占位（FGUI `lab_leagueName` 的 `prompt`）。 */
export const LEAGUE_CREATE_NAME_PROMPT = '点击输入联盟名称';

/** 「允许快速加入」勾选框右侧说明（FGUI `n10` 的静态 `text`）。 */
export const LEAGUE_CREATE_QUICK_JOIN = '允许快速加入';

/** 消耗按钮里的「创建」二字（FGUI `按钮_联盟_消耗按钮` 的 `n4` 静态 `text`）。 */
export const LEAGUE_CREATE_SUBMIT = '创建';

/**
 * 消耗项里「持有量 / 需要量」之间的分隔符（FGUI `组件_公用_消耗_单个` 的 `lab_has`
 * 静态 `text="10/"`，运行期只覆盖数字、`/` 是拼上去的）。
 */
export const LEAGUE_COST_HAS_SUFFIX = '/';

/**
 * 联盟名为空时的提示 —— 用服务端的 `UNION_NAME_EMPTY`（`mL.json` **`id=597`** = 「联盟名字为空」）。
 *
 * ⚠️ 老端 `LayerLeagueCreat.onClickCreat()` 对空名是**静默 `return`**（不发包、不提示）；
 *    本端补一句提示是**有意偏离** —— 点「创建」毫无反应会让玩家以为卡了。
 *    文案本身取自服务端的同类错误码，不是新造的词。
 * ⚠️ id 是逐行核对 `mL.json` 的 `[id, key, name]` 得出的（`id=598` 是 `UNION_NAME_TOO_LONG`）。
 */
export const LEAGUE_TIP_UNION_NAME_EMPTY = '联盟名字为空';

/**
 * 消耗不足的提示模板 —— 老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert()`
 * 走 `FW.G_W("ModelGoods_1")` 再 `StringUtil.format(tipsStr, GetGoodsNameByRefId(resId))`。
 *
 * `mL.json`（**`id=188`**）= **`{0}不足`** ⇒ 金币就是「金币不足」。
 * `{0}` 由调用方（`LeagueCreatePage`）用 `ILeagueCostView.name` 填；
 * 表里 `roleProperty.unenoughTips` 有值时优先用它（现网 `resId=10` 恰好也写着「金币不足」）。
 */
export const LEAGUE_COST_NOT_ENOUGH_TEMPLATE = '{0}不足';

/** `roleProperty.name` 也取不到时的兜底（退化成老端另一条通用提示，`mL.json id=532`）。 */
export const LEAGUE_COST_NOT_ENOUGH_FALLBACK = '未达到购买条件';

// ============================================================
// 大厅三个页签的行文案（`mL.json` 的 key → 值，逐字照搬）
// ============================================================

/**
 * 成员「在线」（老端 `FW.G_W("ONLINE_TEXT")`，`mL.json` id=416）。
 *
 * 详情行的 `lab_time` 只会是这两种之一：「在线」或「{N}分/小时/天前」。
 */
export const LEAGUE_MEMBER_ONLINE = '在线';

/** 成员数的列名前缀（老端 `FW.G_W("ALLIANCE_MEMBER")`，`mL.json` id=384）。 */
export const LEAGUE_MEMBER_COUNT_PREFIX = '联盟成员';

/**
 * 详情行里压在贡献值前面的固定小字（FGUI `组件_联盟_联盟角色item.xml` 的 `n18`，
 * 静态 `text="成员:"`）。
 *
 * ⚠️ 老端 `render()` **没有**给 `n18` 赋值 ⇒ 它是写死的静态文本 ——
 * 这一列的表头是「今日/历史贡献」而前缀却写着「成员:」，属设计稿的复用笔误。
 * 移植保真优先，照搬。
 */
export const LEAGUE_MEMBER_ROW_PREFIX = '成员:';

/** 全服行「盟主:」前缀（老端 `FW.G_W("UNION_MENBER_0")`，`mL.json` id=436）。 */
export const LEAGUE_UNION_LEADER_PREFIX = '盟主:';

/** 全服行「成员:」前缀（老端 `FW.G_W("UNION_MENBER_1")`，`mL.json` id=437）。 */
export const LEAGUE_UNION_MEMBER_PREFIX = '成员:';

/**
 * 详情行的职务标文字（FGUI `组件_联盟_联盟角色item.xml` 的 `n15`）。
 *
 * 真源是 FGUI 的 `gearText controller="盟主" pages="2" values="副盟主" default="盟主"`
 * ⇒ 控制器第 2 页（副盟主）渲染「副盟主」，其余页（含盟主）渲染「盟主」。
 * 老端 `ModelLeague` 只把 position 归一成「盟主(1) / 副盟主(2) / 普通成员(3)」三档，
 * 而 `n15` 的 `gearDisplay` 只在 1、2 两页可见 ⇒ 普通成员行整个标都不显示。
 */
export const LEAGUE_POSITION_LEADER = '盟主';
export const LEAGUE_POSITION_ADMIN = '副盟主';

/**
 * 动态行的三句文案 —— 老端 `StringUtil.format(FW.G_W(...), …)` 的模板。
 *
 * `mL.json`：385 / 386 / 387。`{0}` = 被操作成员名，`{1}` = 操作人名。
 */
export const LEAGUE_LOG_JOIN = '欢迎新成员{0}加入联盟';
export const LEAGUE_LOG_KICK = '成员{0}被{1}请出联盟';
export const LEAGUE_LOG_QUIT = '成员{0}退出联盟';

/** 角色操作浮层：点「查看」看自己时的提示（老端 `FW.G_W("CLICK_TIP_0")`，`mL.json` id=473）。 */
export const LEAGUE_TIP_VIEW_SELF = '您无法查看自己哦';

/** 全服页签查询框空输入时的提示（老端 `FW.G_W("INPUT_LEAGUE_ID")`，`mL.json` id=511）。 */
export const LEAGUE_TIP_INPUT_UNION_ID = '请输入联盟ID';

/** 角色操作浮层的 5 个按钮（FGUI `组件_联盟_联盟操作.xml` 的 `<Button title=…>`）。 */
export const LEAGUE_OPS_LABELS = {
    show: '查看',
    toLeader: '任命盟主',
    toAdmin: '任命副盟主',
    unAdmin: '卸任副盟主',
    kick: '踢出联盟',
} as const;

/** 离线时长文案的三档（老端 `TimeUtil.timeSec2HMSStr3` 的 `StringUtil.format` 模板）。 */
export const LEAGUE_OFFLINE_DAYS = '{0}天{1}小时{2}分前';
export const LEAGUE_OFFLINE_HOURS = '{0}小时{1}分前';
export const LEAGUE_OFFLINE_MINUTES = '{0}分前';

/** `{0}` / `{1}` / `{2}` 顺序替换（与老端 `StringUtil.format` 同口径；本文件不 import 它）。 */
export function fillLeagueText(template: string, ...values: readonly (string | number)[]): string {
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const value = values[Number(index)];
        return value === undefined || value === null ? whole : String(value);
    });
}

// ============================================================
// P4 公用
// ============================================================

/**
 * 「道具名 * 数量」之间的分隔符（老端三处都是裸拼 `FW.G_W("…") + "*" + number`）。
 *
 * ⚠️ 是**半角星号**，不是 `×`（`LayerLeagueDonate` / `LayerLeagueStore` 逐字如此）。
 */
export const LEAGUE_GOODS_COUNT_SEP = '*';

/**
 * 广告**播放**能力是否可用 —— 与 `HangPage.HJ_AD_PLAYBACK_AVAILABLE` 同一件事。
 *
 * 老端 `ModelRole.RequestWatchAdvert` 是两步：先 `CtrlPay.PayforAdVideo(type)` 真放广告，
 * 拿到凭据再发请求。Demo3.8 没有广告 SDK，但**播放这一步已由 `LeagueAd.playLeagueAd()`
 * 承接（Mock）**，次数来源也补上了 ⇒ 本开关翻 `true`，两条链路按老端口径接通：
 * - 「免费捐献」：播完广告再发 `RequestUnionDonate(true)`（**先播后发**）；
 * - 「任务看广告」：播完广告再发 `RequestRoleWatchAdvert { type: 14, id: resId }`；
 * - 次数不再编不出来 —— `ad` 表 `limit` − `CmdRole.tlCmdAdvert` 已用（`unionTask=14` /
 *   `unionDonate=15`，与 `HangRepository` 对 `sweep=11` 同一算法）⇒ 底部行与
 *   「免费：N/M」都显示**真值**，不是假的 `0/0`。
 *
 * ⚠️ `playLeagueAd()` 是 **Mock**（模拟播放后成功返回），真机接微信
 *    `wx.createRewardedVideoAd()` 时替换其函数体即可，调用方不用改 —— 见 `LeagueAd.ts`。
 */
export const LEAGUE_AD_PLAYBACK_AVAILABLE = true;

// ============================================================
// 联盟商店（`ui/League/LeagueStore`）
// ============================================================

/** 弹窗标题（FGUI `组件_联盟_商店` 的 `popBg` → `<Label title="联盟商店"/>`）。 */
export const LEAGUE_STORE_TITLE = '联盟商店';

/**
 * 售罄提示 —— 老端 `FW.G_W("SOLD_OUT")`（`mL.json` **`id=563`** = 「已售罄」）。
 *
 * ⚠️ `id=558` 是 `SPIN_SOLD_OUT`（转盘的「已售罄」），值恰好一样但**不是同一个 key**；
 *    移植按 `SOLD_OUT` 取。
 */
export const LEAGUE_STORE_SOLD_OUT = '已售罄';

/**
 * 限购进度文案 —— 老端 `item.tm("labCount").setText(\`${ref.limitDesc}:${ref.limit - buyTimes}/${ref.limit}\`)`。
 *
 * ⚠️ 分隔符是**半角冒号**（模板串直写 `:`），别写成全角 —— 全服/管理那几处用的是全角，
 *    两处口径**故意不同**（各自照抄自己的老端代码）。
 */
export const LEAGUE_STORE_LIMIT_TEMPLATE = '{0}:{1}/{2}';

// ============================================================
// 联盟捐献（`ui/League/LeagueDonate`）
// ============================================================

/** 弹窗标题（FGUI `组件_联盟_捐献` 的 `popBg` → `<Label title="联盟捐献"/>`）。 */
export const LEAGUE_DONATE_TITLE = '联盟捐献';

/** 铜币奖励项的道具名前缀（老端 `FW.G_W("ALLIANCE_GOLD_COIN")`，`mL.json` **id=382** = 「联盟金币」）。 */
export const LEAGUE_DONATE_COIN_PREFIX = '联盟金币';

/** 贡献奖励项的道具名前缀（老端 `FW.G_W("ALLIANCE_EXP")`，`mL.json` **id=383** = 「联盟贡献」）。 */
export const LEAGUE_DONATE_EXP_PREFIX = '联盟贡献';

/** 剩余次数前缀（老端 `FW.G_W("REMAINING_DONATION_TIMES")`，`mL.json` **id=440** = 「剩余捐献次数：」）。 */
export const LEAGUE_DONATE_COUNT_PREFIX = '剩余捐献次数：';

/**
 * 「免费捐献」按钮的文案。
 *
 * FGUI `按钮_联盟_广告` 的静态 `text="免费"`；老端运行期会覆盖成
 * `FW.G_W("FREE_COUNT") + \`${adTime}/${limit}\``（「免费：1/1」）。
 * 本端**照老端覆盖**（`adTime` = `donateAdvCount − todayDonateAdvTimes`，`limit` = `donateAdvCount`）
 * —— 次数来自服务端 `CmdRoleUnion` + `gameConfig`，是真值，不显示假数字。
 */
export const LEAGUE_DONATE_FREE_LABEL = '免费';

/**
 * 「免费」按钮带次数的文案（老端 `FW.G_W("FREE_COUNT") + \`${adTime}/${limit}\`` ⇒ 「免费：1/1」）。
 *
 * `{0}` = 剩余广告捐献次数（`donateAdvCount − todayDonateAdvTimes`）、`{1}` = 上限 `donateAdvCount`
 * —— 两个数都来自服务端 `CmdRoleUnion` 与 `gameConfig`，是真值。
 */
export const LEAGUE_DONATE_FREE_COUNT_TEMPLATE = '免费：{0}/{1}';

/** 今日捐献次数用完（老端 `FW.G_W("LEAGUE_DONATE_LIMIT")`，`mL.json` **id=548**）。 */
export const LEAGUE_TIP_DONATE_LIMIT = '今日捐献次数已用完';

/**
 * 捐献成功提示（老端 `ModelLeague.RequestLeagueDonate` 的 `FW.G_W("DONATE_SUCCESS")`，
 * `mL.json` **id=507** = 「捐献成功」）。
 *
 * ⚠️ 只在响应 `rsp.ret === true` 时才弹 —— `CmdUnionDonateRspMsg` 里**只有 `ret`**，
 *    奖励不在响应里（老端 `showCommonDonateReward` 是**本地**按 `gameConfig` 算的）。
 */
export const LEAGUE_DONATE_SUCCESS = '捐献成功';

/** 今日广告捐献次数用完（老端 `FW.G_W("LEAGUE_AD_DONATE_LIMIT")`，`mL.json` **id=547**）。 */
export const LEAGUE_TIP_AD_DONATE_LIMIT = '今日广告捐献次数已用完';

/** 广告能力未接入时的提示（与 `HangTexts.adUnavailable` 逐字一致）。 */
export const LEAGUE_TIP_AD_NOT_READY = '广告暂未接入';

/**
 * 金币捐献的二次确认 —— 老端**硬编码** `"是否花费10金币进行联盟捐献？"`。
 *
 * ⚠️ **有意偏离**：老端把 `unionDonateCost` 的字面值 `10` 写死在文案里（改配置文案不会跟着变）。
 *    本端改成模板、由页面填 `gameConfig.unionDonateCost` —— 措辞一字不改，只把数字变成活的。
 */
export const LEAGUE_DONATE_CONFIRM = '是否花费{0}金币进行联盟捐献？';

// ============================================================
// 每日砍价（`ui/League/LeagueDiscount`）
// ============================================================

/** FGUI `状态` controller 的三个页名（`pages="0,砍价,1,购买,2,已购买"`）。 */
export const LEAGUE_DISCOUNT_PAGES = ['砍价', '购买', '已购买'] as const;

/** 「砍价」按钮文案（FGUI `btn_sale` 的 `<Button title="砍价" titleFontSize="42">`）。 */
export const LEAGUE_DISCOUNT_BTN_SALE = '砍价';

/** 「购买」按钮文案（FGUI `btn_buy` 的 `<Button title="购买" titleFontSize="42">`）。 */
export const LEAGUE_DISCOUNT_BTN_BUY = '购买';

/**
 * 砍价行里「砍价」二字（FGUI `组件_联盟_砍价Item` 的 `n43` 静态 `text="砍价"`）。
 *
 * ⚠️ 与按钮文案**同字不同源**：老端 `render()` 只覆盖 `lab_who` / `lab_price`，
 *    `n43` 从没被赋值 ⇒ 是设计稿的静态文本。两处都保留各自来源，别合并成一个常量。
 */
export const LEAGUE_DISCOUNT_ROW_ACTION = '砍价';

/** 面板底部的规则说明（FGUI `n38` 静态 `text`）。 */
export const LEAGUE_DISCOUNT_HINT = '每次砍价会随机获得金币和银币';

/** 倒计时文案（老端 `FW.G_W("Client_RemainTime")`，`mL.json` **id=114** = 「剩余时间：{0}」）。 */
export const LEAGUE_DISCOUNT_TIME_TEMPLATE = '剩余时间：{0}';

/** 参与人数文案（老端 `FW.G_W("UNION_ACTIVE_COUNT")`，`mL.json` **id=438** = 「当前累计{0}人砍价」）。 */
export const LEAGUE_DISCOUNT_COUNT_TEMPLATE = '当前累计{0}人砍价';

/** 购买次数已达上限（老端 `FW.G_W("LEAGUE_BUY_TIMES_LIMIT")`，`mL.json` **id=546**）。 */
export const LEAGUE_TIP_BUY_TIMES_LIMIT = '购买次数已达上限';

/**
 * 购买砍价商品的二次确认 —— 老端 `FW.G_W("UNION_BUY_BAR_COMFORM")`。
 *
 * ⚠️ **这个 key 在新端的 `mL.json` 里已经没有了**（老端 `mL.json` 里在 **id=600**）。
 *    文案逐字取自老端：`是否花费{0}金币购买该礼包？`（措辞里确实写的是「礼包」，属原稿措辞，
 *    移植保真照搬，不"顺手改对"）。
 */
export const LEAGUE_DISCOUNT_BUY_CONFIRM = '是否花费{0}金币购买该礼包？';

/** 砍价最低价（服务端错误码 `UNION_BARGAIN_MIN_COST`，`mL.json` id=318）—— 老端没主动提示，本端备着。 */
export const LEAGUE_TIP_BARGAIN_MIN_COST = '已经达到砍价最低价格';

/** 已购买（`状态` 第 3 页）时的兜底提示 —— 老端走 `LEAGUE_BUY_TIMES_LIMIT`，这里同口径。 */
export const LEAGUE_TIP_DISCOUNT_DONE = LEAGUE_TIP_BUY_TIMES_LIMIT;

// ============================================================
// P4 公用：货币不足
// ============================================================

/**
 * 货币不足提示 —— 老端 `ModelGoods.CheckHaveEnoughCostAndOpenAlert`：
 *
 * ```ts
 * let name = this.GetGoodsNameByRefId(cost.resId);          // roleProperty.name
 * FW.showTip(StringUtil.format(FW.G_W("ModelGoods_1"), name));
 * ```
 *
 * `mL.json` **id=188** = `'{0}不足'`（`{0}` = 货币名，如「金币」/「联盟银币」）。
 *
 * ⚠️ 老端那条链还会先弹一个「道具不足」详情面板（`openDetail`，联盟这几处**都传了 `false`**
 *    —— 商店是 `CheckHaveEnoughCostAndOpenAlert([cost], false)`，所以联盟这边只有 tip、
 *    没有详情面板）。⇒ 本端只做 `showTip`。
 */
export const LEAGUE_TIP_NOT_ENOUGH_TEMPLATE = '{0}不足';

// ============================================================
// 联盟任务（`ui/League/LeagueTask`）
// ============================================================

/** 弹窗标题（FGUI `组件_联盟_任务` 的 `popBg` → `<Label title="联盟任务"/>`）。 */
export const LEAGUE_TASK_TITLE = '联盟任务';

/**
 * 任务行两颗按钮的文案（FGUI `组件_联盟_任务item.xml` 的
 * `<Button title="领取" titleFontSize="24">` / `<Button title="前往" …>`）。
 *
 * ⚠️ 两颗按钮是**互斥**的两页（`gearDisplay 状态 pages="1"` / `pages="0"`）：
 *    可领取 ⇒ 「领取」；未完成 ⇒ 「前往」；已领取 ⇒ 两颗都不显示（改显示 `n35` 那块「已领取」标）。
 */
export const LEAGUE_TASK_BTN_GET = '领取';
export const LEAGUE_TASK_BTN_GO = '前往';

/**
 * 进度百分比（老端 `LayerLeagueTask.initList()` 的 `render`）：
 *
 * ```ts
 * pro_title.setText(Math.floor(now / taskVo.GetMaxValue() * 100) + "%");
 * ```
 *
 * `{0}` 由 `ILeagueTaskRowView.percentText` 算好整数部分填进来（分母为 0 时是空串，见那儿）。
 */
export const LEAGUE_TASK_PERCENT_TEMPLATE = '{0}%';

/**
 * 底部「跳过广告」文案 —— 老端 `FW.G_W("VIEW_AD_SKIP_TEXT")`，
 * `mL.json` **id=446** = `每日观看广告跳过剩余次数{0}/{1}`（`{0}` = 剩余次数 / `{1}` = 上限）。
 *
 * ⚠️ **FGUI 设计稿里那串不是运行时真值**：`组件_联盟_任务.xml` 的 `lab_jump` 写的是
 *    `每日观看广告跳过剩余次数:1/1`（**半角冒号**），而 `mL.json` 的模板**没有冒号**。
 *    老端 `updateView()` 每次都整条覆盖 ⇒ 运行期真值以 `mL.json` 为准（同大厅微信号前缀那条教训）。
 * ⚠️ 剩余次数 / 上限老端来自广告子系统（`ModelRole.GetAdvertRestTimes/GetAdvertLimit`），
 *    本端改用同源算法自己算：`ad` 表 `type=14`（unionTask）的 `limit`
 *    − `CmdRole.tlCmdAdvert` 里同 type 的已用 `num`（见 `LeagueRepository.loadTask`）
 *    ⇒ 这一行现在显示**真值**（`LEAGUE_AD_PLAYBACK_AVAILABLE` 翻 `true` 后整行显形）。
 */
export const LEAGUE_TASK_AD_TEXT_TEMPLATE = '每日观看广告跳过剩余次数{0}/{1}';

/**
 * 点「前往」但跳转链路还没接时的提示。
 *
 * 老端 `btn_go.onClick` 是 `CtrlMgr.CtrlJumpView.JumpType(ref.goto)` 然后 `unload()`；
 * Demo3.8 **没有 `CtrlJumpView`**（同 `SevenDayTexts.gotoMissing` / `GiftTexts.gotoMissing`
 * 处的说明：全工程跳转路由未接）⇒ 明确给提示而不是让按钮点了没反应（规则：不静默失败）。
 * 措辞逐字取自 `SevenDayTexts.gotoMissing`（同一件事，不另造词）。
 */
export const LEAGUE_TASK_GOTO_MISSING = '该功能暂未开放';

// ============================================================
// 北伐中原（`ui/League/LeagueNorthExpedition` + 排行 / 奖励子页）
// ============================================================
//
// 真源两处，**取运行期的那个**：
//   ① FGUI XML 的 `text="…"`（设计稿占位串，会用半角冒号 / 写死的假数字）；
//   ② 老端 `FW.G_W("<key>")`（`mL.json` 的 `name` 列）—— 每条都是 `updateView()` 里**整条覆盖**的。
// 老端覆盖过的那几条一律用 ②（同 P5 的 `lab_jump` 教训：设计稿的半角冒号不是真值）。

/** 主面板标题栏上的小字（FGUI `组件_联盟_北伐中原.xml` 的 `n7`，运行时**不**被覆盖）。 */
export const LEAGUE_NORTH_SECTION_TITLE = '战况';

/** 「英雄共鸣」小标题（FGUI `n21`，运行时不被覆盖）。 */
export const LEAGUE_NORTH_BUFF_TITLE = '英雄共鸣';

/** 「今日挑战奖励」小标题（FGUI `n9`，运行时不被覆盖）。 */
export const LEAGUE_NORTH_DAILY_TITLE = '今日挑战奖励';

/**
 * 属性加成的前缀 —— `mL.json` **id=423** `ATTR_ATTACK` = `攻击`。
 *
 * 老端：`FW.G_W("ATTR_ATTACK") + formatNumberToZH(value[0] * addBuffTimes)` —— **裸拼、无加号**。
 */
export const LEAGUE_NORTH_ATTR_ATTACK = '攻击';

/** 挑战次数前缀 —— `mL.json` **id=445** `DUNGEON_ENTER_COUNT_TEXT` = `挑战次数:`（**半角冒号**）。 */
export const LEAGUE_NORTH_ENTER_COUNT_PREFIX = '挑战次数:';

/**
 * 活动剩余时间 —— `mL.json` **id=114** `Client_RemainTime` = `剩余时间：{0}`。
 *
 * ⚠️ FGUI 设计稿写的是 `活动剩余时间:08:15:38`（半角冒号 + 三组假数字），
 *    而老端每次 `updateTime()` 都用 `FW.G_W("Client_RemainTime")` **整条覆盖**
 *    ⇒ 运行期真值是 `剩余时间：08:15:38`（**全角冒号**）。这里取运行期那个。
 */
export const LEAGUE_NORTH_REMAIN_TIME_TEMPLATE = '剩余时间：{0}';

/**
 * 活动未开放时的提示 —— `mL.json` **id=388** `LayerRank_10_NOT_OPEN` = `{0}点到{1}点开启`。
 *
 * ⚠️ 老端**两处**（「挑战」与「扫荡」）都用了同一个 key，本端也共用这一条
 *    （`LeagueTable.leagueNorthOpenHourText()` 直接填好 `{0}` / `{1}`）。
 */
export const LEAGUE_NORTH_OPEN_HOUR_TEMPLATE = '{0}点到{1}点开启';

/** 擂鼓次数用尽 —— `mL.json` **id=554** `LEAGUE_EXPEDITION_DRUM_LIMIT` = `今日擂鼓次数已用尽`。 */
export const LEAGUE_NORTH_DRUM_LIMIT = '今日擂鼓次数已用尽';

/**
 * 主面板三颗按钮的文案（FGUI `组件_联盟_北伐中原.xml` 的
 * `<Button title="擂鼓">` / `<Button title="挑战">` / `<Button title="扫荡">`；运行时不被覆盖）。
 */
export const LEAGUE_NORTH_BTN_DRUM = '擂鼓';
export const LEAGUE_NORTH_BTN_CHALLENGE = '挑战';
export const LEAGUE_NORTH_BTN_SWEEP = '扫荡';

/** 「英雄共鸣」行右侧那颗帮助按钮要打开的帮助页 id（老端 `CtrlAlert.OpenHelpe("leaguefb01")`）。 */
export const LEAGUE_NORTH_HELP_ID = 'leaguefb01';

/**
 * 帮助入口在 Demo3.8 还没接时的提示 —— 措辞与 `LEAGUE_TASK_GOTO_MISSING` 一致。
 *
 * ⚠️ 老端那颗按钮走 `CtrlMgr.CtrlAlert.OpenHelpe(id)`；本工程**没有** `CtrlAlert`
 *    （联盟 P1 的主页帮助按钮 `BtnHelp` 也是同样处置）⇒ 统一提示，不静默失败。
 */
export const LEAGUE_NORTH_HELP_MISSING = LEAGUE_TASK_GOTO_MISSING;

/**
 * 点「挑战」时本端接不了的那一段 —— 老端是
 * `CtrlMgr.CtrlJumpView.GotoSingleFight(selectChapter, TF_BattleType.unionHurtInstance)`。
 *
 * Demo3.8 的战斗入口是**另一套**（`battle/` 模块），没有「按 chapter + 战斗类型直接开一局」
 * 这条路由（同 P4/P5 两处跳转的处置）⇒ 提示而不发任何包。
 */
export const LEAGUE_NORTH_FIGHT_MISSING = LEAGUE_TASK_GOTO_MISSING;

/**
 * 排行页页签 + 表头（FGUI `组件_联盟_北伐中原_排行.xml`；运行时不被覆盖）。
 *
 * | 常量 | FGUI 节点 | 文案 |
 * |---|---|---|
 * | `..._TAB_RANK` / `..._TAB_PROGRESS` | `tab_rank` / `tab_progress` | 联盟排名 / 盟内进度 |
 * | `..._COL_RANK` | `n6` | 排名 |
 * | `..._COL_LEAGUE` | `n7` | 联盟及伤害 |
 * | `..._COL_COUNT` | `n8` | 人数 |
 * | `..._COL_REWARD` | `n9` | 奖励 |
 * | `..._COL_DAMAGE` | `n10` | 伤害总量 |
 * | `..._COL_PLAYER` | `n11` | 玩家信息 |
 */
export const LEAGUE_NORTH_TAB_RANK = '联盟排名';
export const LEAGUE_NORTH_TAB_PROGRESS = '盟内进度';
export const LEAGUE_NORTH_COL_RANK = '排名';
export const LEAGUE_NORTH_COL_LEAGUE = '联盟及伤害';
export const LEAGUE_NORTH_COL_COUNT = '人数';
export const LEAGUE_NORTH_COL_REWARD = '奖励';
export const LEAGUE_NORTH_COL_DAMAGE = '伤害总量';
export const LEAGUE_NORTH_COL_PLAYER = '玩家信息';

/** 排行页底部那行说明（FGUI `n12`，运行时不被覆盖；**周一 00:00 发奖**）。 */
export const LEAGUE_NORTH_RANK_AWARD_TIP = '排名奖励将在周一00:00以邮件形式发放';

/** 排行/奖励两个弹窗的标题（FGUI `popBg` 的 `<Label title="…"/>`）。 */
export const LEAGUE_NORTH_RANK_TITLE = '排名';
export const LEAGUE_NORTH_REWARD_TITLE = '联合战线奖励';

/** 奖励页页签（FGUI `tab_league` / `tab_role`；运行时不被覆盖）。 */
export const LEAGUE_NORTH_TAB_REWARD_LEAGUE = '联盟奖励';
export const LEAGUE_NORTH_TAB_REWARD_ROLE = '个人奖励';

/**
 * 奖励行那颗按钮的**两种**文案（FGUI `组件_联盟_北伐中原_奖励Item.xml` 的
 * `gearText controller="标签" pages="0,1" values="未完成|领取"`）。
 *
 * 与「已领取」那页（`pages="2"`，按钮整个隐藏、改显示 `n7` 的印章）三态互斥。
 */
export const LEAGUE_NORTH_REWARD_BTN_UNDONE = '未完成';
export const LEAGUE_NORTH_REWARD_BTN_CLAIM = '领取';

/** 「未上榜」—— FGUI `组件_联盟_北伐中原_排名.xml` 的 `n10`（`标签` 控制器第 4 页）。 */
export const LEAGUE_NORTH_RANK_UNRANKED = '未上榜';
