/**
 * 个人信息五弹窗 + 设置面板的**判定与格式化**（纯函数、零 `cc`）。
 *
 * 拆出这一层的理由与 `MainTaskTable` / `ItemDetailTable` 一致（规则 78）：
 * 判定逻辑一旦写在带 `cc` 的 import 链上，Node 用例就 `Cannot find module 'cc'` **静默失效**，
 * 整块逻辑永久脱离回归网。
 *
 * 老端对应实现：
 *   `LayerRenameUI.checkText` / `checkSensitiveName`（名字过滤与校验）
 *   `LayerPlayerInfoUI.UpdateView`（等级 / UID / 区服 / 经验进度）
 *   `LayerChangeHeadUI.CheckHasHead`（头像解锁判定）
 */
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';

// ============================================================
// 昵称
// ============================================================

/**
 * 昵称允许的字符集 —— 与老端 `LayerRenameUI.checkText` 的**同一条正则**：
 * `/[^A-Za-z0-9_\-\u4e00-\u9fa5]+/g`（中英文、数字、下划线、连字符，其余全删）。
 *
 * ⚠️ 老端是**静默删除**（`text.replace(...)` 后再 `setText` 回去）；本工程沿用同一口径
 * （不弹错、直接抹掉非法字符），只在旁边给一句说明文案。
 */
const NAME_ILLEGAL_PATTERN = /[^A-Za-z0-9_\-\u4e00-\u9fa5]+/g;

/**
 * 昵称长度上限。
 *
 * ⚠️ **老端没有做长度限制**（`checkText` 只过滤字符），长度由服务端校验兜底。
 * 本工程给 `cc.EditBox._maxLength` 一个上限 —— 不是为了替服务端校验，而是
 * `cc.EditBox` 的 `_maxLength` 默认 20 会允许完全不合法的长度；取 12 与「中文名 12 个字」
 * 的常见口径一致，超长时服务端仍会拒（那时走 `renameFailed` 提示）。
 */
export const PLAYER_NAME_MAX_LENGTH = 12;

/** 按老端正则过滤昵称输入。空输入 → `''`。 */
export function sanitizePlayerName(raw: unknown): string {
    if (typeof raw !== 'string' || raw.length === 0) return '';
    return raw.replace(NAME_ILLEGAL_PATTERN, '');
}

/** 改名输入的三态判定（页面对每种给不同提示）。 */
export const RenameInputState = {
    /** 通过，可以往下走「敏感词 → 发请求」。 */
    Ok: 'ok',
    /** 过滤后为空 ⇒ `LayerRename_2`。 */
    Empty: 'empty',
    /** 与当前名相同 ⇒ `LayerRename_3`。 */
    Unchanged: 'unchanged',
} as const;
export type RenameInputStateValue = typeof RenameInputState[keyof typeof RenameInputState];

/**
 * 判定改名输入。**先过滤再判** —— 老端 `按钮_免费` 的回调里也是先 `checkText` 再比空。
 */
export function checkRenameInput(raw: unknown, currentName: unknown): RenameInputStateValue {
    const name = sanitizePlayerName(raw);
    if (!name) return RenameInputState.Empty;
    const current = typeof currentName === 'string' ? currentName : '';
    if (current && name === current) return RenameInputState.Unchanged;
    return RenameInputState.Ok;
}

/**
 * 昵称长度是否超过 {@link PLAYER_NAME_MAX_LENGTH}。
 * 只用于提示，不阻止发送（服务端才是权威）。
 */
export function isPlayerNameTooLong(raw: unknown): boolean {
    return typeof raw === 'string' && raw.length > PLAYER_NAME_MAX_LENGTH;
}

// ============================================================
// 兑换码
// ============================================================

/** 兑换码是否非空（老端 `if (s != "" && s != null)`）。 */
export function isRedeemCodeUsable(raw: unknown): boolean {
    return typeof raw === 'string' && raw.trim().length > 0;
}

/** 兑换码规范化（去首尾空白；**不做大小写转换** —— 服务端按原样校验）。 */
export function normalizeRedeemCode(raw: unknown): string {
    return typeof raw === 'string' ? raw.trim() : '';
}

// ============================================================
// 个人信息展示
// ============================================================

/** 等级文案。老端 `GetLevel()` 有「取不到给 1」的兜底。 */
export function formatLevel(level: unknown): string {
    const n = Number(level);
    return String(Number.isFinite(n) && n > 0 ? Math.floor(n) : 1);
}

/**
 * UID 文案。
 *
 * ⚠️ `roleId` 是 `uint64` ⇒ 运行时是 **Long**，必须走 `toIdString` 那套（规则 23）——
 * 但那是 `cc` 层的事；本函数只吃**已经转好的字符串或数字**，不再做类型判断之外的加工。
 */
export function formatUid(roleId: unknown): string {
    if (roleId === null || roleId === undefined) return '';
    if (typeof roleId === 'string') return roleId;
    const n = Number(roleId);
    return Number.isFinite(n) ? String(n) : '';
}

/** 区服名（服务端表里读不到就是空串，不显示 `undefined`）。 */
export function formatServer(serverName: unknown): string {
    return typeof serverName === 'string' ? serverName : '';
}

/**
 * 等级表 `level` 行 → 升到下一级所需经验。
 *
 * 老端 `VORole.GetExpMax()` 先 `IsMaxLevel()` 判满级（满级返回 0），再取
 * `GetLevel() + 1` 那一级的经验。
 *
 * @param nextLevelRow `level` 表里 `lv === 当前等级 + 1` 的那一行（取不到传 `null`）
 * @returns 下一级所需经验；取不到 `0`
 */
export function resolveExpMax(nextLevelRow: Record<string, unknown> | null | undefined): number {
    if (!nextLevelRow) return 0;
    // `level` 表的经验列在老端叫 `exp`（与 `CmdRole.exp` 同名），另有 `roleExp` 之类的备用列名。
    for (const key of ['exp', 'roleExp', 'needExp']) {
        const v = Number(nextLevelRow[key]);
        if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
}

/**
 * 经验条进度文案（`123/456`）。与 `MainTaskTable.progressTextOf` 同款口径。
 *
 * ⚠️ 满级 / 表读不到 ⇒ `max = 0` ⇒ 进度条按 `max = 1, value = 0` 画（老端同样
 * `pr.max = expMax || 1`），文案给 `0/0` 而不是 `NaN`。
 */
export function formatExpRatio(exp: unknown, expMax: unknown): string {
    const cur = clampNonNegative(exp);
    const max = clampNonNegative(expMax);
    return `${cur}/${max}`;
}

function clampNonNegative(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** `cc.ProgressBar` 的进度值（0..1）。`max <= 0` ⇒ 0。 */
export function expProgressOf(exp: unknown, expMax: unknown): number {
    const cur = clampNonNegative(exp);
    const max = clampNonNegative(expMax);
    if (max <= 0) return 0;
    return Math.max(0, Math.min(1, cur / max));
}

// ============================================================
// 更换头像
// ============================================================

/** 平台头像（微信 / 抖音）在头像列表里的哨兵 id（老端 `id == 0` 分支）。 */
export const PLATFORM_HEAD_ID = 0;

/**
 * 头像是否已解锁。
 *
 * 老端 `LayerChangeHeadUI.CheckHasHead(img)`：
 *   `img == 0` ⇒ `true`（平台头像恒可选）；否则在背包的 `touxiang` 类道具里找 `resId`。
 *
 * @param img         头像 `resId`（`0` = 平台头像）
 * @param ownedResIds 背包里 `touxiang` 类道具的 `resId` 集合
 */
export function isHeadUnlocked(img: unknown, ownedResIds: ReadonlySet<number> | readonly number[]): boolean {
    const id = Number(img);
    if (!Number.isFinite(id)) return false;
    if (id === PLATFORM_HEAD_ID) return true;
    const has = typeof (ownedResIds as ReadonlySet<number>).has === 'function'
        ? (ownedResIds as ReadonlySet<number>).has(id)
        : (ownedResIds as readonly number[]).includes(id);
    return has;
}

/** 头像列表要展示的 id 序列：平台头像（有才加）+ 全部已配头像。 */
export function buildHeadIdList(platformImg: unknown, refHeadIds: readonly number[]): number[] {
    const out: number[] = [];
    if (typeof platformImg === 'string' && platformImg.length > 0) out.push(PLATFORM_HEAD_ID);
    for (const id of refHeadIds) {
        const n = Number(id);
        if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
    }
    return out;
}

/**
 * 换头像列表的每行格数。
 * 出处 = FGUI `组件_个人信息_更换头像界面` 的
 * `<list layout="flow_hz" lineItemCount="4" colGap="23" lineGap="20" scale="0.9,0.9">`。
 */
export const HEAD_ITEM_COLUMNS = 4;

/**
 * 表格实例把整个 list 缩了 `0.9`（`scale="0.9,0.9"`），而布局引擎把 scale **吸进了尺寸**
 * ⇒ prefab 里的坐标已经是**屏幕尺寸**，所以这里全部按 0.9 折算，别再乘一次。
 *
 * | 量 | FGUI 原值 | 折算（×0.9） |
 * |---|---|---|
 * | item 本体 | 123×123 | **110.7** |
 * | 横向步进 | 123 + colGap 23 = 146 | **131.4** |
 * | 纵向步进 | 123 + lineGap 20 = 143 | **128.7** |
 * | 视口 | 612×286 | **550.8 × 257.4** |
 */
export const HEAD_ITEM_SCALE = 0.9;
/** item 本体边长（123 × 0.9）。 */
export const HEAD_ITEM_SIZE = 110.7;
/** 横向步进（(123 + 23) × 0.9）。 */
export const HEAD_ITEM_STEP_X = 131.4;
/** 纵向步进（(123 + 20) × 0.9）。 */
export const HEAD_ITEM_STEP_Y = 128.7;
/** 视口宽（612 × 0.9）。 */
export const HEAD_VIEW_W = 550.8;
/** 视口高（286 × 0.9）。 */
export const HEAD_VIEW_H = 257.4;
/** 视口能完整放下的行数（`floor(257.4 / 128.7) = 2`）。 */
export const HEAD_ITEM_ROWS = 2;
/** 视口内的槽位数（4 列 × 2 行）—— prefab 里预置几个槽就铺几个（超出的靠拖动滚动）。 */
export const HEAD_ITEM_SLOT_COUNT = HEAD_ITEM_COLUMNS * HEAD_ITEM_ROWS;

/**
 * 列表内容的总高度（按行数算，**最后一行不留 lineGap**）。
 * @param total 头像总个数
 */
export function headContentHeight(total: unknown): number {
    const n = Math.max(0, Math.floor(Number(total) || 0));
    const rows = Math.max(1, Math.ceil(n / HEAD_ITEM_COLUMNS));
    return rows * HEAD_ITEM_STEP_Y - (HEAD_ITEM_STEP_Y - HEAD_ITEM_SIZE);
}

/**
 * 第 `index` 个格子在**内容容器**里的位置（内容容器左上角为原点，y 向下为正）。
 * 与 prefab 的静态摆位必须用同一个函数（`tmp/gen_playerinfo.mjs` 直接 import 不了 `.ts`，
 * 所以生成器里抄了同一组常量 —— 两侧的守卫是 `tests/playerinfo.test.ts` 的几何用例）。
 */
export function headSlotOffset(index: unknown): { x: number; y: number } {
    const i = Math.max(0, Math.floor(Number(index) || 0));
    return {
        x: (i % HEAD_ITEM_COLUMNS) * HEAD_ITEM_STEP_X,
        y: Math.floor(i / HEAD_ITEM_COLUMNS) * HEAD_ITEM_STEP_Y,
    };
}

// ============================================================
// 写请求失败文案
// ============================================================

/** `PlayerInfoRepository` 写请求的三态（与 `PlayerInfoRequestResult` 同构，**不 import 那个模块**）。 */
export type PlayerInfoWriteResult = 'ok' | 'offline' | 'failed';

/**
 * 写请求（换头像 / 改名 / 兑换码）失败时的提示文案 —— **`offline` 与 `failed` 必须分开**。
 *
 * 为什么单开一个函数：`PlayerInfoRepository.send()` 第一句就是
 * `if (!net.isConnected) return 'offline'` —— 断线时**包根本没发出去**。
 * 旧口径把两态都写成「更换头像失败 / 改名失败」，于是「没连上服务器」被读成「功能坏了」，
 * 排查方向直接被带偏。
 *
 * 实测（2026-09-28，`tmp/_changehead_two_client_probe.mjs`）：同一账号开第二个客户端登录，
 * 第一个客户端的 socket 立刻被关（`GameNet.isConnected === false`），此时点「确认」——
 * 请求层 `ms = 0` 返回 `'offline'`，界面弹出「更换头像失败，请稍后重试」，而服务端
 * **压根没收到这条请求**（`RoleChangeImgHandler` 反编译确认服务端无条件成功）。
 *
 * @param result     `PlayerInfoRepository` 返回的三态
 * @param failedText 非 `offline` 时用的原文案（各功能自己的「xx 失败」）
 */
export function writeFailText(result: PlayerInfoWriteResult, failedText: string): string {
    return result === 'offline' ? PLAYER_INFO_TEXTS.offlineTip : failedText;
}

// ============================================================
// 设置面板
// ============================================================

/**
 * 音量（0..100）→ 滑动条进度（0..1）。
 * 与 `AudioSettingTable.toVolumeScale` 的分母一致（100）。
 */
export function volumeToSlider(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n / 100));
}

/** 滑动条进度（0..1）→ 音量（0..100，向下取整）。 */
export function sliderToVolume(progress: unknown): number {
    const n = Number(progress);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.floor(n * 100)));
}

/** `数量` 文案（改名按钮上的 `x1` / `x200`）。 */
export function formatCostText(count: unknown): string {
    const n = Number(count);
    return `x${Number.isFinite(n) && n > 0 ? Math.floor(n) : 1}`;
}

/**
 * 二次确认正文 —— `StringUtil.format(模板, 金币数)` 的等价物（只替换 `{0}`）。
 *
 * 老端 `LayerShowTip.SetData({ context: StringUtil.format(FW.G_W("LayerRename_4"), renameCostGem) })`。
 * 本函数收模板参数而不是内部 import 文案表：文案表是**唯一出口**，
 * 这里再抄一遍整句就多了一个会失配的真源。
 */
export function formatRenameCostConfirm(template: string, gemCost: unknown): string {
    const n = Number(gemCost);
    const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return String(template).replace('{0}', String(safe));
}

/** 改名消耗的两种形态。 */
export const RenameCostMode = {
    /** 手上有改名卡 ⇒ 花 1 张（老端 `num > 0` 分支）。 */
    Free: 'free',
    /** 没有改名卡 ⇒ 花金币（老端 `else` 分支）。 */
    Paid: 'paid',
} as const;
export type RenameCostModeValue = typeof RenameCostMode[keyof typeof RenameCostMode];

/** 改名按钮上要显示的东西。 */
export interface IRenameCostDisplay {
    readonly mode: RenameCostModeValue;
    /** 按钮图标该用哪张：`'item'` = 改名卡、`'coin'` = 金币。 */
    readonly iconKind: 'item' | 'coin';
    /** 按钮上的数量文本（`x1` / `x500`）。 */
    readonly countText: string;
}

/**
 * 改名按钮的「图标 + 数量」。
 *
 * 老端 `LayerRenameUI.UpdateView`：
 * ```js
 * if (num > 0) { loader.SetUrlByIcon(goods.GetIconKey()); title.setText("x1") }          // 改名卡
 * else         { loader.SetUrlByIcon(coinGoods.GetIconKey()); title.setText("x" + renameCostGem) }
 * ```
 *
 * ⚠️ 判定用的是「手上有几张改名卡」（背包），**不是** `freeRenameCount`（服务端给的免费次数）——
 * 两者在老端是**两套独立的分流**：`UpdateView` 按改名卡数量切按钮外观，
 * `setSelectedPage("类型", renameNum > 0)` 按免费次数切「免费 / 付费」两个页面。
 * 本工程没有背包 getter（见 `PlayerInfoRepository` 文件头缺口 ②），所以
 * `ownedRenameItem` 传 `null` 表示「未知」，此时退回金币那一支（`renameCostGem` 是配置表常量，
 * 一定拿得到）——**不假装**知道玩家背包里有什么。
 */
export function renameCostDisplayOf(
    ownedRenameItem: number | null | undefined,
    gemCost: unknown,
): IRenameCostDisplay {
    const owned = Number(ownedRenameItem);
    const hasItem = Number.isFinite(owned) && owned > 0;
    return {
        mode: hasItem ? RenameCostMode.Free : RenameCostMode.Paid,
        iconKind: hasItem ? 'item' : 'coin',
        countText: hasItem ? formatCostText(1) : formatCostText(gemCost),
    };
}

/**
 * 「免费 / 付费」页的判定 —— 老端 `setSelectedPage("类型", renameNum > 0 && "免费" || "付费")`。
 * 免费次数来自 `CmdRole.freeRenameCount`（缓存里有，本工程拿得到）。
 */
export function isFreeRenamePage(freeRenameCount: unknown): boolean {
    const n = Number(freeRenameCount);
    return Number.isFinite(n) && n > 0;
}

/**
 * 改名面板底部「剩余免费次数：N」。
 *
 * 老端是 UBB 富文本 `剩余免费次数：[color=#00ff00]{count=1}[/color]`
 * （`ubb="true" vars="true"`）—— Cocos 的 `cc.Label` 不认 UBB/`{var}` 语法，
 * 直接烘原稿会**把标记当字面量显示**。本工程折算成纯文本，绿色那截不还原
 * （`cc.RichText` 才能做，而这一行只有一个数字需要着色，不值当再引一套富文本）。
 */
export function formatFreeRenameTips(count: unknown): string {
    const n = Number(count);
    const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return `剩余免费次数：${safe}`;
}

// ============================================================
// 他人信息
// ============================================================

/** 战力文案（`0` 也照显示 —— 老端 `power.toString()`）。 */
export function formatPower(power: unknown): string {
    const n = Number(power);
    return String(Number.isFinite(n) ? Math.floor(n) : 0);
}

/** 关卡进度文案。 */
export function formatBattleLevel(level: unknown): string {
    const n = Number(level);
    return String(Number.isFinite(n) ? Math.floor(n) : 0);
}

/**
 * 联盟名文案。
 * 老端 `playerInfoData.msg.unionInfo.name.toString()` —— `unionInfo` 为 `null` 时**会抛**，
 * 那是老端的隐患；这里收敛成空串（`PlayerInfoOtherPage` 也就不会因为别人没联盟而炸）。
 */
export function formatUnionName(unionName: unknown): string {
    return typeof unionName === 'string' ? unionName : '';
}

/** 他人信息里区服名带括号（老端 `"(" + serverName + ")"`）。 */
export function formatServerWithParen(serverName: unknown): string {
    const s = typeof serverName === 'string' ? serverName : '';
    return s ? `(${s})` : '';
}

/** 装备格位号 → prefab 里的节点名后缀（老端 `"equipType" + voEquip.GetEquipType()`）。 */
export function equipSlotName(slot: unknown): string {
    const n = Number(slot);
    return Number.isFinite(n) && n > 0 ? `EquipSlot${Math.floor(n)}` : '';
}

/** 他人信息最多渲染几个装备格（FGUI `equipType1..6`）。 */
export const OTHER_EQUIP_SLOT_COUNT = 6;

/**
 * 他人信息里一格装备。
 *
 * ⚠️ **图标显示不出来，这是已知缺口不是 bug**：`equip.icon` 存的是 FGUI 图标名
 * （如 `图标_装备_帽子6`），要经 `icon.json` 翻译成 `ui://图标/图标_装备_mz6`，
 * 而 `ArtPaths.ICON_PACKAGE_ART_ROOT` 把包名 `图标` 映到 **`icons/head`**
 * （那是给头像用的）；更要紧的是 `assets/resources/` 下**一张 `图标_装备_*` 都没有**
 * （`find assets/resources -name '图标_装备*'` = 0 条）。所以这一格只能画底框 + 部位名，
 * 数据层照样把 `icon` 带上来，等美术补齐后接 `loadEquipIcon` 就能显示。
 */
export interface IOtherEquipEntry {
    /** 部位号 1..6（`equip.equipType`）。 */
    readonly slot: number;
    readonly equipId: number;
    /** FGUI 图标名（未落盘 ⇒ 当前恒不显示）。 */
    readonly icon: string;
    readonly quality: number;
    /** 装备等级（`CmdEquipLook.level`）。 */
    readonly level: number;
    /** 已镶嵌宝石个数（`CmdEquipLook.tlCmdGemInfo.length`）。 */
    readonly gemCount: number;
}

/**
 * 他人信息底部列表的一行 —— 老端 `LayeroOtherPlayerInfoUI.UpdateView` 组装 `result` 的那几段。
 *
 * ⚠️ 老端**只推 2 / 3 / 4 三类**（类型 0 攻击力 + 1 联盟那两段被注释掉了，数据直接写在主面板上，
 * `组件_查看信息_项` 里也把 `联盟` group 标了 `visible="×"`）—— 这里照抄这个事实，
 * 不把注释掉的类型「补回来」。
 */
export const OtherListType = {
    /** 民兵皮肤（`tlArmySkin`）。 */
    ArmySkin: 2,
    /** 武将（`tlGeneral`）。 */
    General: 3,
    /** 军师（`tlAdvisor`）。 */
    Advisor: 4,
} as const;
export type OtherListTypeValue = typeof OtherListType[keyof typeof OtherListType];

/** 列表一行：类型 + 条数（item prefab 见 `PlayerInfoOtherPage` 文件头缺口 ③）。 */
export interface IOtherListEntry {
    readonly type: OtherListTypeValue;
    readonly count: number;
}

/**
 * 组装他人信息底部列表的**类型与条数**。
 *
 * 老端每类都是「数组非空才 push」（`if (msg.tlXxx && msg.tlXxx.length > 0)`），
 * 所以空数组这一行**整行不出现**，不是出现一个空行。
 */
export function buildOtherListData(input: {
    readonly armySkin?: readonly unknown[] | null;
    readonly general?: readonly unknown[] | null;
    readonly advisor?: readonly unknown[] | null;
}): IOtherListEntry[] {
    const out: IOtherListEntry[] = [];
    const push = (type: OtherListTypeValue, rows: readonly unknown[] | null | undefined): void => {
        const count = Array.isArray(rows) ? rows.length : 0;
        if (count > 0) out.push({ type, count });
    };
    push(OtherListType.ArmySkin, input.armySkin);
    push(OtherListType.General, input.general);
    push(OtherListType.Advisor, input.advisor);
    return out;
}
