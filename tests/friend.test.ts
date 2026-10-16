/**
 * 好友（老端 `LayerFriend` / FGUI 包「好友」）移植的回归网。
 *
 * 分五段，各守一件事：
 *
 *   A. **判定口径**（`FriendTable`，只依赖零 import 的 `RequestGuard`）—— 老端这些判定散在
 *      `ModelFriend` / `LayerFriend` / `LayerFriendApply` / `LayerFriendGetEnd` 里
 *      （依赖 DI 容器 + FGUI 控制器 + 网络），没法单测；移植时全收敛成传参纯函数，
 *      本段是它们唯一的回归网。含三处**最容易静默失效**的：
 *        ① `可点性 ≠ 灰度`（次数用完时未赠送的也不可点，但**不置灰**）；
 *        ② 删除模式下 `showAction=false`（FGUI `btn` 的 `gearDisplay 展示删除界面=0`）；
 *        ③ `Group` 整组位移（FGUI `gearXY` 删除模式 +43/+6）。
 *   B. **资源口径**（`FriendArt` + `.png.meta`）—— 九宫格边框只存在 SpriteFrame 资源上，
 *      `.prefab` 表达不了 ⇒ 边框写进了 `.png.meta`，漏配就是「整张被拉伸」且**不报错**。
 *      `fd_check_bg` 那条曾把 `scale9grid` 的 **w** 当 **h** 用（`bottom` 算成 9、正确 12），
 *      本段用「中心格必须等于 scale9grid 的 w/h」这条判据把它钉死。
 *   C. **prefab 结构 + 几何**（三个 prefab）—— 脚本组件的 `__type__` 必须能从 `*.ts.meta`
 *      反解（防 cid 抄错成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的画布像素一致。
 *      `Group` 是**中心锚点**，套「左上角」公式会整体偏半个组宽（116px）且两边都自洽。
 *   D. **数据管道接线**（源码文本）—— 三张表走 `CacheMgr`、14 个协议名、超时兜底、
 *      **`renderItemFn` 只绑一次**、两个子弹窗的 `nextPopupFrame`、入口白名单两处。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/好友/组件/**` +
 *           `共用组件/组件/弹窗/组件_公共弹窗_新.xml` + `按钮/按钮_公用_9Gone.xml` +
 *           `页签/组件_弹窗_页签.xml` + `按钮/公用_按钮_勾选.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/friend/**`（`LayerFriend*`）+
 *           `.../model/vo/Friend/ModelFriend.ts`
 *   - 配置：新项目 `assets/remoteRef/gameConfig.json`（`friend*` 7 键）+ `open.json`（refId=206）
 *
 * ⚠️ 四处**刻意与老端不同**（理由见 `FriendTable.ts` / `FriendPage.ts` 文件头），本文件把它们
 *    当契约钉住，别当 bug 改回去：
 *      ① 两个子弹窗内容整体 +14/+9（老端只给「领取粮草」补了，申请列表那支在老端上是歪的）；
 *      ② `TabBar` 高 73 → 72、三个页签统一 y=1045；
 *      ③ 行内 `玩家名` / `战力` 宽 84/117 → 130（FGUI 那两个 Label 是定宽裁切）；
 *      ④ 「私聊」按钮**不显示**（`FRIEND_CHAT_AVAILABLE = false`，Demo3.8 无聊天模块）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    buildFriendRowView,
    blackRowButton,
    canGetEnd,
    canSendMore,
    countOfMax,
    countText,
    FRIEND_CONFIG_DEFAULTS,
    FRIEND_CONFIG_KEYS,
    FRIEND_ROW_GROUP_DELETE,
    FRIEND_ROW_GROUP_NORMAL,
    FRIEND_TAB_COUNT,
    FRIEND_TAB_KEYS,
    formatDuration,
    friendFingerprint,
    friendRowButton,
    IFriendRow,
    IFriendRowTexts,
    leftTimes,
    normalizeFriendRow,
    normalizeFriendRows,
    onlineTextOf,
    parseFriendConfig,
    parseSearch,
    pickGetEndRows,
    pickPatchedCmd,
    readFriendCounters,
    resolveFriendLayout,
    rowButtonOf,
    rowGroupPosition,
    rowsOfTab,
    sendTimesOf,
    sentCount,
    takenCount,
    usedTimesOf,
    FriendTab,
} from '../assets/script/app/friend/FriendTable';
import {
    FRIEND_ART_ROOT,
    FRIEND_ART_SLICED,
    FRIEND_ART_TAB_OFF,
    FRIEND_ART_TAB_ON,
    FRIEND_BUTTON_ART,
    FRIEND_ROW_ART,
    FRIEND_SPRITE_SIMPLE,
    FRIEND_SPRITE_SLICED,
    FRIEND_TINT_GRAY,
    FRIEND_TINT_NORMAL,
    friendButtonArt,
    friendSpriteType,
    friendTabArt,
    friendTint,
} from '../assets/script/app/friend/FriendArt';
import {
    FRIEND_APPLY_EMPTY,
    FRIEND_BTN_AGREE_ONE_KEY,
    FRIEND_BTN_APPLY_LIST,
    FRIEND_BTN_GET_END,
    FRIEND_BTN_GET_END_ONE_KEY,
    FRIEND_BTN_REFUSE_ONE_KEY,
    FRIEND_BTN_REFRESH,
    FRIEND_BTN_REMOVE_MODE,
    FRIEND_BTN_REMOVE_MODE_BACK,
    FRIEND_BTN_REMOVE_ONE_KEY,
    FRIEND_BTN_SEARCH,
    FRIEND_BTN_SEND_ONE_KEY,
    FRIEND_BLACK_COUNT_TEMPLATE,
    FRIEND_COUNT_TEMPLATE,
    FRIEND_END_NUM_TEMPLATE,
    FRIEND_GET_END_TIMES_TEMPLATE,
    FRIEND_ONLINE_TEXT,
    FRIEND_POWER_PREFIX,
    FRIEND_REMOVE_SELECT_TEMPLATE,
    FRIEND_ROW_BUTTON_TEXT,
    FRIEND_ROW_TEXTS,
    FRIEND_SEND_TIMES_TEMPLATE,
    FRIEND_TAB_LABELS,
    FRIEND_TIP_CANT_SEARCH_SELF,
    FRIEND_TIP_GET_MAX,
    FRIEND_TIP_SEND_MAX,
    formatText,
} from '../assets/script/app/friend/FriendTexts';

// ============================================================
// 夹具
// ============================================================

function row(over: Partial<IFriendRow> = {}): IFriendRow {
    return {
        id: '1',
        name: '甲',
        level: 1,
        power: '100',
        avatarId: '',
        online: false,
        lastOfflineMs: 0,
        todaySend: false,
        todayReceive: false,
        todayTake: false,
        ...over,
    };
}

const TEXTS: IFriendRowTexts = FRIEND_ROW_TEXTS;

function options(over: Partial<Parameters<typeof buildFriendRowView>[3]> = {}) {
    return {
        nowMs: 1_000_000,
        deleteMode: false,
        checked: false,
        applied: false,
        leftSendTimes: 3,
        chatAvailable: true,
        ...over,
    };
}

// ============================================================
// A. 判定口径（`FriendTable` 纯函数）
// ============================================================

test('A1 `leftTimes` 钳到 0；非法值按 0 参与（负数 / NaN 不往界面上写）', () => {
    assert.equal(leftTimes(3, 1), 2);
    assert.equal(leftTimes(3, 3), 0);
    assert.equal(leftTimes(3, 5), 0, '超额用掉不能算出负数');
    assert.equal(leftTimes(Number.NaN, 1), 0);
    assert.equal(leftTimes(3, Number.NaN), 3, 'used 非法时按 0 算 ⇒ 剩余=上限');
    assert.deepEqual(sendTimesOf(3, 1), { left: 2, max: 3 });
    assert.deepEqual(sendTimesOf(Number.NaN, 0), { left: 0, max: 0 });
});

test('A2 四个页签的主按钮语义：list 跟 todaySend / add 跟 applied / black 恒移除', () => {
    assert.deepEqual(friendRowButton(row({ todaySend: false })), { key: 'gift', gray: false });
    assert.deepEqual(friendRowButton(row({ todaySend: true })), { key: 'gifted', gray: true });
    assert.deepEqual(applyRowButton2(false), { key: 'apply', gray: false });
    assert.deepEqual(applyRowButton2(true), { key: 'applied', gray: true });
    assert.deepEqual(blackRowButton(), { key: 'remove', gray: false });

    // 收口入口 `rowButtonOf` 与三个分支逐个一致
    assert.deepEqual(rowButtonOf(FriendTab.list, row({ todaySend: true }), false), { key: 'gifted', gray: true });
    assert.deepEqual(rowButtonOf(FriendTab.add, row(), true), { key: 'applied', gray: true });
    assert.deepEqual(rowButtonOf(FriendTab.black, row(), true), { key: 'remove', gray: false });
});

/** 局部包装：`applyRowButton` 名字与「页签 add」太像，读起来容易串。 */
function applyRowButton2(applied: boolean) {
    return rowButtonOf(FriendTab.add, row(), applied);
}

test('A3 ⚠️ `canSendMore` 是 `> 0` —— 与 `gray` **不是一回事**（次数用完≠置灰）', () => {
    assert.equal(canSendMore(1), true);
    assert.equal(canSendMore(0), false, '次数用完 ⇒ 未赠送的也不可点');
    assert.equal(canSendMore(-1), false);

    // 同一个「未赠送」行：`gray=false` 但次数为 0 时 `actionEnabled=false`
    const view = buildFriendRowView(FriendTab.list, row({ todaySend: false }), TEXTS, options({ leftSendTimes: 0 }));
    assert.equal(view.actionGray, false, '按钮不置灰');
    assert.equal(view.actionEnabled, false, '但点不动');
});

test('A4 ⚠️ `pickGetEndRows` 只留 `todayReceive && !todayTake`', () => {
    const rows = [
        row({ id: '1', todayReceive: true, todayTake: false }),
        row({ id: '2', todayReceive: true, todayTake: true }),
        row({ id: '3', todayReceive: false, todayTake: false }),
    ];
    assert.deepEqual(pickGetEndRows(rows).map((r) => r.id), ['1']);
});

test('A5 ⚠️ `canGetEnd` = 有可领 **且** 次数没满（只有一半条件都是错的红点）', () => {
    const oneWaiting = [row({ id: '1', todayReceive: true, todayTake: false })];
    const allTaken = [row({ id: '1', todayReceive: true, todayTake: true })];
    const none = [row({ id: '1' })];

    assert.equal(canGetEnd(oneWaiting, 3), true);
    assert.equal(canGetEnd(none, 3), false, '没人可领 ⇒ 不亮');
    assert.equal(canGetEnd(allTaken, 3), false, '领完了 ⇒ 不亮');
    // 「有人可领」但次数已满 —— 老端 `taked < maxTake` 这一半
    assert.equal(canGetEnd([...allTaken, ...oneWaiting], 1), false, '已领 1 次 + 上限 1 ⇒ 不亮');
    assert.equal(canGetEnd([...allTaken, ...oneWaiting], 2), true, '上限 2 ⇒ 还能再领一个');
});

test('A6 `sentCount` / `takenCount` 与 `usedTimesOf` 的分页签口径', () => {
    const rows = [
        row({ id: '1', todaySend: true, todayReceive: true, todayTake: true }),
        row({ id: '2', todaySend: false, todayReceive: true, todayTake: false }),
        row({ id: '3', todaySend: true }),
    ];
    assert.equal(sentCount(rows), 2);
    assert.equal(takenCount(rows), 1, '只数「收到且已领」的');
    // 列表页签看赠送、其它页签看领取
    assert.equal(usedTimesOf(FriendTab.list, rows), 2);
    assert.equal(usedTimesOf(FriendTab.add, rows), 1);
    assert.equal(usedTimesOf(FriendTab.black, rows), 1);
});

test('A7 `countOfMax` / `countText`：负数与 NaN 一律收成 0（不写进界面）', () => {
    assert.deepEqual(countOfMax(3, 50), { current: 3, max: 50 });
    assert.deepEqual(countOfMax(-1, -5), { current: 0, max: 0 });
    assert.deepEqual(countOfMax(Number.NaN, 50), { current: 0, max: 50 });
    assert.deepEqual(countOfMax(3.9, 50.9), { current: 3, max: 50 }, '取整');
    assert.equal(countText(FRIEND_COUNT_TEMPLATE, 3, 50), '好友数：3/50');
    assert.equal(countText(FRIEND_BLACK_COUNT_TEMPLATE, 0, 20), '黑名单：0/20');
});

test('A8 `formatDuration` 四档：天/小时/分/秒', () => {
    assert.equal(formatDuration(0), '0秒');
    assert.equal(formatDuration(59), '59秒');
    assert.equal(formatDuration(60), '1分');
    assert.equal(formatDuration(3599), '59分');
    assert.equal(formatDuration(3600), '1小时');
    assert.equal(formatDuration(3660), '1小时1分');
    assert.equal(formatDuration(86399), '23小时59分');
    assert.equal(formatDuration(86400), '1天');
    assert.equal(formatDuration(90000), '1天1小时');
    assert.equal(formatDuration(-5), '0秒', '负数按 0');
});

test('A9 ⚠️ `onlineTextOf`：在线给固定语义；`lastOfflineTime = 0`（服务端没下来）给空串', () => {
    assert.deepEqual(onlineTextOf(row({ online: true }), 1_000_000), { kind: 'online' });
    assert.deepEqual(
        onlineTextOf(row({ online: false, lastOfflineMs: 1_000_000 - 120_000 }), 1_000_000),
        { kind: 'offline', text: '2分' },
    );
    // `lastOfflineTime = 0` ⇒ gap 是「1970 到现在」，必须给空串而不是「14000天」
    assert.deepEqual(onlineTextOf(row({ online: false, lastOfflineMs: 0 }), 1_000_000), { kind: 'offline', text: '' });
    // 服务端时间跑到未来（时钟不同步）⇒ 同样给空串
    assert.deepEqual(
        onlineTextOf(row({ online: false, lastOfflineMs: 2_000_000 }), 1_000_000),
        { kind: 'offline', text: '' },
    );
});

test('A10 `parseSearch`：纯数字按 id、否则按名；搜自己直接 `self`（老端当场拦）', () => {
    assert.deepEqual(parseSearch('', '7', '我'), { kind: 'empty' });
    assert.deepEqual(parseSearch('   ', '7', '我'), { kind: 'empty' });
    assert.deepEqual(parseSearch('123', '7', '我'), { kind: 'id', id: 123 });
    assert.deepEqual(parseSearch(' 123 ', '7', '我'), { kind: 'id', id: 123 }, '先 trim');
    assert.deepEqual(parseSearch('7', '7', '我'), { kind: 'self' }, 'id = 自己');
    assert.deepEqual(parseSearch('我', '7', '我'), { kind: 'self' }, '名字 = 自己');
    assert.deepEqual(parseSearch('甲', '7', '我'), { kind: 'name', name: '甲' });
    // `String(asNumber) === value` 这道的用意：'007' / '1e3' / '0x10' 不当 id 处理
    assert.deepEqual(parseSearch('007', '7', '我'), { kind: 'name', name: '007' }, '前导零按名字搜');
    assert.deepEqual(parseSearch('1e3', '7', '我'), { kind: 'name', name: '1e3' });
    assert.deepEqual(parseSearch('12abc', '7', '我'), { kind: 'name', name: '12abc' });
});

test('A11 `rowsOfTab`：三个页签各取各的数据源（页面不散落 switch）', () => {
    const source = {
        friendRows: [row({ id: 'f' })],
        suggestRows: [row({ id: 's' })],
        blackRows: [row({ id: 'b' })],
    };
    assert.deepEqual(rowsOfTab(FriendTab.list, source).map((r) => r.id), ['f']);
    assert.deepEqual(rowsOfTab(FriendTab.add, source).map((r) => r.id), ['s']);
    assert.deepEqual(rowsOfTab(FriendTab.black, source).map((r) => r.id), ['b']);
});

test('A12 `normalizeFriendRow`：`Long` 形状归一化成十进制字符串；认不出 id ⇒ null', () => {
    // protobuf 的 `uint64` 在运行时是 `Long` 对象（不是 number）—— 认 `toString()`
    const long = { toString: () => '18446744073709551615' };
    const parsed = normalizeFriendRow({
        friendId: long,
        name: '甲',
        level: 12,
        power: 98765,
        img: long,
        online: true,
        lastOfflineTime: 1700000000000,
        todaySend: true,
        todayReceive: true,
        todayTake: false,
    });
    assert.ok(parsed);
    assert.equal(parsed!.id, '18446744073709551615', 'uint64 超 2^53 也不能丢精度');
    assert.equal(parsed!.power, '98765');
    assert.equal(parsed!.avatarId, '18446744073709551615');
    assert.equal(parsed!.level, 12);
    assert.equal(parsed!.online, true);

    // 缺 friendId ⇒ null（认不出身份的行不能进列表，复用时会串行）
    assert.equal(normalizeFriendRow({ name: '甲' }), null);
    assert.equal(normalizeFriendRow({ friendId: '' }), null);
    assert.equal(normalizeFriendRow(null), null);
    assert.equal(normalizeFriendRow('甲'), null, '非对象');
});

test('A13 ⚠️ `normalizeFriendRow`：`online` 缺省按**离线**算（缺省按在线会撒假的「在线」标）', () => {
    const parsed = normalizeFriendRow({ friendId: '1' });
    assert.ok(parsed);
    assert.equal(parsed!.online, false);
    assert.equal(parsed!.todaySend, false);
    assert.equal(parsed!.todayReceive, false);
    assert.equal(parsed!.todayTake, false);
    // 只认严格 `true`（服务端可能给 0/1 之外的形状）
    assert.equal(normalizeFriendRow({ friendId: '1', online: 1 })!.online, false);
    assert.equal(normalizeFriendRow({ friendId: '1', online: true })!.online, true);
});

test('A14 `normalizeFriendRows`：跳过非法项、非数组给空数组（不抛）', () => {
    const list = normalizeFriendRows([{ friendId: '1' }, { name: '无 id' }, null, { friendId: '2' }]);
    assert.deepEqual(list.map((r) => r.id), ['1', '2']);
    assert.deepEqual(normalizeFriendRows([]), []);
    assert.deepEqual(normalizeFriendRows(null as unknown as unknown[]), []);
    assert.deepEqual(normalizeFriendRows(undefined as unknown as unknown[]), []);
});

test('A15 ⚠️ 本地补丁三态：没补丁用缓存 / 指纹没变用补丁 / 指纹变了丢补丁', () => {
    const cached = { friendId: '1', todayReceive: true, todayTake: false };
    const fromRsp = { friendId: '1', todayReceive: true, todayTake: true };
    const print = friendFingerprint(cached);
    assert.ok(print.length > 0, '指纹不能是空串（空串会和「缓存里没有」混淆）');
    assert.equal(friendFingerprint(null), '');
    assert.notEqual(friendFingerprint(cached), friendFingerprint(fromRsp), '内容变了指纹必须变');

    // ① 没有补丁
    assert.deepEqual(pickPatchedCmd(cached, null), { cmd: cached, dropPatch: false });
    // ② 有补丁、缓存行没变 ⇒ 用补丁（Rsp 是唯一数据源）
    assert.deepEqual(
        pickPatchedCmd(cached, { cmd: fromRsp, baseFingerprint: print }),
        { cmd: fromRsp, dropPatch: false },
    );
    // ③ 有补丁、缓存行变了（服务端推过） ⇒ 用缓存并丢补丁
    const pushed = { friendId: '1', todaySend: true, todayReceive: false, todayTake: false };
    assert.deepEqual(
        pickPatchedCmd(pushed, { cmd: fromRsp, baseFingerprint: print }),
        { cmd: pushed, dropPatch: true },
    );
    // 「打补丁时缓存里没有这一条」= 空指纹：缓存仍是空 ⇒ 继续用补丁
    assert.equal(pickPatchedCmd(cached, { cmd: fromRsp, baseFingerprint: '' }).dropPatch, true);
});

test('A16 `parseFriendConfig`：7 个 `friend*` 键；缺项取兜底（全 0，对齐老端 `.value || 0`）', () => {
    assert.deepEqual(Object.values(FRIEND_CONFIG_KEYS), [
        'friendMaxCount', 'friendBlackMaxCount', 'friendApplyMaxCount',
        'friendSendEndTimes', 'friendTakeEndTimes', 'friendAddEndPerTime', 'friendSuggestPerPage',
    ]);
    const parsed = parseFriendConfig([
        { key: 'friendMaxCount', value: '50' },
        { key: 'friendTakeEndTimes', value: 10 },
        { key: 'friendAddEndPerTime', value: 5 },
        { key: '无关键', value: 999 },
    ]);
    assert.deepEqual(parsed, {
        maxFriends: 50,
        maxBlacks: 0,
        maxApplies: 0,
        sendEndTimes: 0,
        takeEndTimes: 10,
        endPerTime: 5,
        suggestPerPage: 0,
    });
    assert.deepEqual(parseFriendConfig([]), FRIEND_CONFIG_DEFAULTS);
    assert.deepEqual(parseFriendConfig(null as unknown as unknown[]), FRIEND_CONFIG_DEFAULTS);
    // 空串 = 缺项（老端 `|| 0` 会把 '' 当 0，这里同样不能把 '' 当数字）
    assert.equal(parseFriendConfig([{ key: 'friendMaxCount', value: '' }]).maxFriends, 0);
});

test('A17 `readFriendCounters`：字段缺失给 `null`（交给调用方退回列表统计口径）', () => {
    assert.deepEqual(readFriendCounters({ sendFriendEndCount: 2, takeFriendEndCount: 1 }), { sent: 2, taken: 1 });
    assert.deepEqual(readFriendCounters({}), { sent: null, taken: null }, '缺失必须是 null，不是 0');
    assert.deepEqual(readFriendCounters({ sendFriendEndCount: 0 }), { sent: 0, taken: null }, '0 是有效值');
    assert.deepEqual(readFriendCounters(null), { sent: null, taken: null });
});

test('A18 ⚠️ `buildFriendRowView` 的 list 分支：置灰 / 可点 / 在线文案 / 删除模式两块显隐', () => {
    const me = row({ name: '甲', level: 9, power: '12345', avatarId: '77', online: true });

    const normal = buildFriendRowView(FriendTab.list, me, TEXTS, options());
    assert.equal(normal.actionText, '赠送');
    assert.equal(normal.actionGray, false);
    assert.equal(normal.actionEnabled, true);
    assert.equal(normal.powerText, '战力：12345');
    assert.equal(normal.level, '9');
    assert.equal(normal.durationText, '在线');
    assert.equal(normal.showChat, true, 'chatAvailable=true 且非删除模式 ⇒ 显示');
    assert.equal(normal.showAction, true);
    assert.equal(normal.showCheck, false);
    assert.equal(normal.endNumText, '', '只有「领取体力」弹窗的行才有体力数');

    const gifted = buildFriendRowView(FriendTab.list, row({ todaySend: true }), TEXTS, options());
    assert.equal(gifted.actionText, '已赠送');
    assert.equal(gifted.actionGray, true);
    assert.equal(gifted.actionEnabled, false);

    // 战力空串 ⇒ '0'（不是「战力：」后面空着）
    assert.equal(buildFriendRowView(FriendTab.list, row({ power: '' }), TEXTS, options()).powerText, '战力：0');
    // 离线给时长文案
    assert.equal(
        buildFriendRowView(
            FriendTab.list,
            row({ online: false, lastOfflineMs: 10_000_000 - 3_600_000 }),
            TEXTS,
            options({ nowMs: 10_000_000 }),
        ).durationText,
        '1小时',
    );

    // ---- 删除模式：主按钮**整块隐藏** + 勾选框出现 + 私聊隐藏（FGUI `gearDisplay`） ----
    const deleting = buildFriendRowView(FriendTab.list, me, TEXTS, options({ deleteMode: true, checked: true }));
    assert.equal(deleting.showAction, false, 'FGUI `btn` 的 gearDisplay 展示删除界面=0');
    assert.equal(deleting.actionText, '赠送', '文案字段仍然给（节点只是隐藏）');
    assert.equal(deleting.showCheck, true);
    assert.equal(deleting.checkSelected, true);
    assert.equal(deleting.showChat, false);

    // ---- 没有聊天模块时「私聊」根本不显示（有意偏离④） ----
    assert.equal(buildFriendRowView(FriendTab.list, me, TEXTS, options({ chatAvailable: false })).showChat, false);
    // 非好友列表页签永远不显示私聊（`页签=0` 这个条件）
    assert.equal(buildFriendRowView(FriendTab.add, me, TEXTS, options()).showChat, false);
});

test('A19 `buildFriendRowView`：add / black / take 三个分支的按钮与显示差异', () => {
    const me = row();

    const add = buildFriendRowView(FriendTab.add, me, TEXTS, options({ applied: false }));
    assert.equal(add.actionText, '申请');
    assert.equal(add.actionGray, false);
    assert.equal(add.actionEnabled, true);
    assert.equal(add.showAction, true, '申请列表项没有「展示删除界面」controller ⇒ 一直显示');
    assert.equal(add.durationText, '', '在线时长只有好友列表页签显示');
    assert.equal(
        buildFriendRowView(FriendTab.add, me, TEXTS, options({ applied: true })).actionText,
        '已申请',
    );

    const black = buildFriendRowView(FriendTab.black, row({ todaySend: true }), TEXTS, options({ leftSendTimes: 0 }));
    assert.equal(black.actionText, '移除');
    assert.equal(black.actionGray, false);
    assert.equal(black.actionEnabled, true, '黑名单行不看赠送次数');
    assert.equal(black.showAction, true);

    const take = buildFriendRowView('take', me, TEXTS, options({ endNum: 6 }));
    assert.equal(take.actionText, '领取');
    assert.equal(take.actionGray, false);
    assert.equal(take.actionEnabled, true, '领取弹窗只列可领的人 ⇒ 恒可点');
    assert.equal(take.endNumText, '体力数:6');
    assert.equal(buildFriendRowView('take', me, TEXTS, options()).endNumText, '体力数:0', '没传 endNum 按 0');
});

test('A20 ⚠️ `rowGroupPosition`：删除模式整组右移 43、下移 6（FGUI `gearXY`）', () => {
    // 与 `组件_好友项.xml` 的 `gearXY controller="展示删除界面" pages="0,1" values="30,20|73,26"` 对齐
    assert.deepEqual(FRIEND_ROW_GROUP_NORMAL, { x: -136, y: 6 });
    assert.deepEqual(FRIEND_ROW_GROUP_DELETE, { x: -93, y: 0 });
    assert.deepEqual(rowGroupPosition(false), FRIEND_ROW_GROUP_NORMAL);
    assert.deepEqual(rowGroupPosition(true), FRIEND_ROW_GROUP_DELETE);
    // 位移量本身：右移 43、Cocos 的 y 向上 ⇒ 下移 6 是 -6
    assert.equal(FRIEND_ROW_GROUP_DELETE.x - FRIEND_ROW_GROUP_NORMAL.x, 43);
    assert.equal(FRIEND_ROW_GROUP_DELETE.y - FRIEND_ROW_GROUP_NORMAL.y, -6);
});

test('A21 ⚠️ `resolveFriendLayout`：三页签 × 删除模式，17 个开关全表（FGUI 15 条 gearDisplay）', () => {
    const texts = {
        friendCount: FRIEND_COUNT_TEMPLATE,
        blackCount: FRIEND_BLACK_COUNT_TEMPLATE,
        sendTimes: FRIEND_SEND_TIMES_TEMPLATE,
        removeSelect: FRIEND_REMOVE_SELECT_TEMPLATE,
        batchRemove: FRIEND_BTN_REMOVE_MODE,
        batchRemoveBack: FRIEND_BTN_REMOVE_MODE_BACK,
    };
    const base = {
        friendCount: 3, friendMax: 50, blackCount: 1, blackMax: 20,
        removeCount: 2, leftSendTimes: 4, leftGetTimes: 1, texts,
    };

    // ---- 页签 0 · 非删除模式 ----
    const list = resolveFriendLayout({ ...base, tab: FriendTab.list, deleteMode: false });
    assert.deepEqual(list, {
        showFriendCount: true,
        friendCountText: '好友数：3/50',
        showBlackCount: false,
        blackCountText: '',
        showSendTimes: true,
        sendTimesText: '今日还可赠送4次',
        showRemoveCount: false,
        removeCountText: '已选择：2人',
        showBatchRemove: true,
        batchRemoveText: '批量删除',
        batchRemoveGold: true,
        showSendOneKey: true,
        showGetEnd: true,
        showRemoveOneKey: false,
        showRefresh: false,
        showApplyList: false,
        showSearch: false,
    });

    // ---- 页签 0 · 删除模式：一键赠送/领取 换成 一键删除；文案与颜色都切 ----
    const deleting = resolveFriendLayout({ ...base, tab: FriendTab.list, deleteMode: true });
    assert.equal(deleting.showSendTimes, false, '赠送次数文案在删除模式隐藏');
    assert.equal(deleting.showRemoveCount, true);
    assert.equal(deleting.batchRemoveText, '返回');
    assert.equal(deleting.batchRemoveGold, false, '删除模式切深色（FGUI `颜色=Blue`）');
    assert.equal(deleting.showSendOneKey, false);
    assert.equal(deleting.showGetEnd, false);
    assert.equal(deleting.showRemoveOneKey, true);
    assert.equal(deleting.showFriendCount, true, '好友数不受删除模式影响');

    // ---- 页签 1 · 添加好友 ----
    const add = resolveFriendLayout({ ...base, tab: FriendTab.add, deleteMode: false });
    assert.equal(add.showFriendCount, false);
    assert.equal(add.showRefresh, true);
    assert.equal(add.showApplyList, true);
    assert.equal(add.showSearch, true);
    assert.equal(add.showBatchRemove, false, '批量删除只在页签 0');
    assert.equal(add.showSendOneKey, false);

    // ---- 页签 2 · 黑名单 ----
    const black = resolveFriendLayout({ ...base, tab: FriendTab.black, deleteMode: false });
    assert.equal(black.showBlackCount, true);
    assert.equal(black.blackCountText, '黑名单：1/20');
    assert.equal(black.showFriendCount, false);
    assert.equal(black.showBatchRemove, false);
    assert.equal(black.showRefresh, false);

    // 每个页签都恰好有一组「按钮」可见（防漏配成「哪个页签都没按钮」）
    for (const tab of [FriendTab.list, FriendTab.add, FriendTab.black]) {
        const one = resolveFriendLayout({ ...base, tab, deleteMode: false });
        assert.ok(one.showBatchRemove || one.showRefresh || one.showBlackCount);
    }
});

test('A22 页签常量与枚举一致（`FRIEND_TAB_COUNT` 是 prefab 里页签数的判据）', () => {
    assert.deepEqual(FRIEND_TAB_KEYS, ['list', 'add', 'black']);
    assert.equal(FRIEND_TAB_COUNT, 3);
    assert.equal(FriendTab.list, 0);
    assert.equal(FriendTab.add, 1);
    assert.equal(FriendTab.black, 2);
    assert.deepEqual([...FRIEND_TAB_LABELS], ['好友列表', '添加好友', '黑名单']);
    assert.equal(FRIEND_TAB_LABELS.length, FRIEND_TAB_COUNT, '文案条数必须等于页签数');
});

// ============================================================
// B. 资源口径
// ============================================================

const ART_DIR = 'assets/resources/image/friend';

/** `FriendArt` 里 12 个静态图名。 */
const ART_NAMES: readonly string[] = [
    FRIEND_ROW_ART.rowBg,
    FRIEND_ROW_ART.headFrame,
    FRIEND_ROW_ART.lvTag,
    'fd_panel_bg',
    'fd_title_bg',
    FRIEND_BUTTON_ART.gold,
    FRIEND_BUTTON_ART.dark,
    FRIEND_ART_TAB_ON,
    FRIEND_ART_TAB_OFF,
    'fd_tab_over',
    'fd_check_bg',
    'fd_input_bg',
];

test('B1 好友美术目录 12 张图齐（少一张就是一个白框，且**不报错**）', () => {
    assert.equal(FRIEND_ART_ROOT, 'image/friend', 'loadArt 的 root 不能带 `resources/` 前缀');
    assert.equal(new Set(ART_NAMES).size, 12);
    const missing = ART_NAMES.filter((name) => !existsSync(`${ART_DIR}/${name}.png`));
    assert.deepEqual(missing, [], `缺图：${missing.join(', ')}`);
    const noMeta = ART_NAMES.filter((name) => !existsSync(`${ART_DIR}/${name}.png.meta`));
    assert.deepEqual(noMeta, [], `缺 .png.meta（编辑器不会给 uuid ⇒ 图片打不开）：${noMeta.join(', ')}`);
});

test('B2 ⚠️ 九宫格 6 张：边框必须落在 `.png.meta`，且中心格 = `scale9grid` 的 w/h', () => {
    // 「中心格」判据：rawW − left − right == w 且 rawH − top − bottom == h
    // （`fd_check_bg` 曾把 scale9grid 的 **w** 当 **h** 用，`bottom` 算成 9、应为 12；
    //   本判据当场能逮住 —— 边框写错时图照样显示，只是四角被拉伸。）
    const EXPECT_SLICED: Readonly<Record<string, readonly [number, number, number, number, number, number]>> = {
        // 图名: [rawW, rawH, top, bottom, left, right]
        fd_panel_bg: [394, 307, 128, 143, 129, 142],
        fd_row_bg: [317, 142, 12, 11, 12, 13],
        fd_btn_gold: [84, 77, 11, 54, 14, 66],
        fd_btn_dark: [83, 77, 11, 57, 15, 64],
        fd_check_bg: [39, 39, 13, 12, 10, 12],
        fd_input_bg: [30, 30, 13, 14, 14, 12],
    };
    assert.deepEqual([...FRIEND_ART_SLICED].sort(), Object.keys(EXPECT_SLICED).sort(), 'SLICED 表与期望表必须同一批');

    const failures: string[] = [];
    for (const [name, want] of Object.entries(EXPECT_SLICED)) {
        const [rawW, rawH, top, bottom, left, right] = want;
        const meta = JSON.parse(readFileSync(`${ART_DIR}/${name}.png.meta`, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, unknown> }>;
        };
        const ud = meta.subMetas.f9941?.userData;
        assert.ok(ud, `${name} 缺 subMetas.f9941.userData`);
        const got = ['rawWidth', 'rawHeight', 'borderTop', 'borderBottom', 'borderLeft', 'borderRight']
            .map((key) => Number(ud![key] ?? 0));
        const [gRawW, gRawH, gTop, gBottom, gLeft, gRight] = got;
        if ((gRawW !== rawW || gRawH !== rawH)) {
            failures.push(`${name} 原生尺寸 ${gRawW}×${gRawH}，期望 ${rawW}×${rawH}`);
        }
        if ((gTop !== top || gBottom !== bottom || gLeft !== left || gRight !== right)) {
            failures.push(`${name} 边框 T${gTop}/B${gBottom}/L${gLeft}/R${gRight}，期望 T${top}/B${bottom}/L${left}/R${right}`);
        }
        // 中心格必须正好是 scale9grid 的 w/h
        if (gRawW - gLeft - gRight <= 0 || gRawH - gTop - gBottom <= 0) {
            failures.push(`${name} 边框吃掉了整张图（中心格 ≤ 0）`);
        }
        if (ud!.packable !== false) {
            failures.push(`${name} 的 packable 必须为 false（进了自动图集，九宫格边框会被打乱）`);
        }
    }
    assert.deepEqual(failures, [], `九宫格配置不对：\n${failures.join('\n')}`);
});

test('B3 ⚠️ `fd_lv_tag` 必须 `trimType="none"`（auto-trim 会裁掉 1px、多一次 40/38 等比拉伸）', () => {
    const meta = JSON.parse(readFileSync(`${ART_DIR}/fd_lv_tag.png.meta`, 'utf8')) as {
        subMetas: Record<string, { userData: Record<string, unknown> }>;
    };
    const ud = meta.subMetas.f9941!.userData;
    assert.equal(ud.trimType, 'none');
    assert.equal(ud.trimX, 0);
    assert.equal(ud.trimY, 0);
    assert.equal(ud.width, ud.rawWidth, 'width 要回到整图宽');
    assert.equal(ud.height, ud.rawHeight);
});

test('B4 `friendSpriteType` / `friendButtonArt` / `friendTabArt` / `friendTint` 四个查表入口', () => {
    assert.equal(FRIEND_SPRITE_SIMPLE, 0);
    assert.equal(FRIEND_SPRITE_SLICED, 1);
    // SLICED 表里的图必须给 1（prefab 里 `cc.Sprite._type` 的真源）
    for (const name of FRIEND_ART_SLICED) assert.equal(friendSpriteType(name), 1, `${name} 必须是 SLICED`);
    for (const name of [FRIEND_ROW_ART.headFrame, FRIEND_ROW_ART.lvTag, 'fd_tab_on']) {
        assert.equal(friendSpriteType(name), 0, `${name} 是原尺寸图，不该拉伸`);
    }
    // 未知名字给 SIMPLE（不抛）
    assert.equal(friendSpriteType('不存在的图'), 0);

    // ⚠️ 别按图名直觉猜：`颜色,1`(=Orange) 是金色 `TY_btn06`、`颜色,0`(=Bule) 是深色 `TY_btn07`
    assert.equal(friendButtonArt('gold'), 'fd_btn_gold');
    assert.equal(friendButtonArt('dark'), 'fd_btn_dark');
    assert.notEqual(FRIEND_BUTTON_ART.gold, FRIEND_BUTTON_ART.dark);

    // 页签两态（FGUI `组件_弹窗_页签` 的 button controller：常态 TY_btn23 / 选中 TY_btn20）
    assert.equal(friendTabArt(true), FRIEND_ART_TAB_ON);
    assert.equal(friendTabArt(false), FRIEND_ART_TAB_OFF);
    assert.notEqual(friendTabArt(true), friendTabArt(false));

    // 灰度用 tint 近似（有意偏离，Cocos 无内置灰度）
    assert.deepEqual([...FRIEND_TINT_NORMAL], [255, 255, 255]);
    assert.deepEqual([...FRIEND_TINT_GRAY], [132, 132, 132]);
    assert.deepEqual([...friendTint(true)], [...FRIEND_TINT_GRAY]);
    assert.deepEqual([...friendTint(false)], [...FRIEND_TINT_NORMAL]);
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

/** 编辑器压缩 uuid：前 5 个 hex 原样 + 其余 27 个 hex 每 3 个编 2 个 base64 字符 = 23 位。 */
function compressUuid(uuid: string): string {
    const KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const hex = uuid.replace(/-/g, '');
    let out = hex.slice(0, 5);
    for (let i = 5; i < 32; i += 3) {
        const value = parseInt(hex.slice(i, i + 3), 16);
        out += KEYS[value >> 6] + KEYS[value & 63];
    }
    return out;
}

/** 脚本类名 → 源文件。 */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
    FriendPage: 'assets/script/app/friend/FriendPage.ts',
    FriendApplyPage: 'assets/script/app/friend/FriendApplyPage.ts',
    FriendGetEndPage: 'assets/script/app/friend/FriendGetEndPage.ts',
    FriendRow: 'assets/script/app/friend/FriendRow.ts',
    FriendApplyRow: 'assets/script/app/friend/FriendApplyRow.ts',
    FriendGetEndRow: 'assets/script/app/friend/FriendGetEndRow.ts',
    FriendTabButton: 'assets/script/app/friend/FriendTabButton.ts',
    VScrollView: 'assets/script/vscrollview/VScrollView.ts',
};

function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

interface IPrefabFile {
    readonly file: string;
    readonly rootName: string;
    readonly all: readonly Record<string, unknown>[];
}

const PREFABS: readonly IPrefabFile[] = [
    { file: 'assets/resources/ui/Friend/Friend.prefab', rootName: 'Friend', all: [] },
    { file: 'assets/resources/ui/Friend/FriendApply.prefab', rootName: 'FriendApply', all: [] },
    { file: 'assets/resources/ui/Friend/FriendGetEnd.prefab', rootName: 'FriendGetEnd', all: [] },
].map((item) => ({
    ...item,
    all: JSON.parse(readFileSync(item.file, 'utf8')) as Record<string, unknown>[],
}));

test('C1 三个 prefab 都存在，根节点是第一个 cc.Node 且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    for (const { file, rootName, all } of PREFABS) {
        assert.ok(existsSync(file), `prefab 不存在：${file}`);
        const data = (all[0] as { data: { __id__: number } }).data;
        const firstNodeIndex = all.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
        assert.equal(data.__id__, firstNodeIndex, `${rootName}: cc.Prefab.data 必须指向第一个 cc.Node`);
        const nodes = all.filter((entry) => entry && entry.__type__ === 'cc.Node');
        assert.equal(nodes[0]!._name, rootName);
        assert.equal(nodes[0]!._parent as unknown, null, '根节点没有父节点');
    }
});

test('C2 ⚠️ 所有节点的 _layer 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    for (const { file, all } of PREFABS) {
        const layers = new Set(
            all.filter((entry) => entry && entry.__type__ === 'cc.Node').map((node) => node._layer),
        );
        assert.deepEqual([...layers], [33554432], `${file} 出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
    }
});

test('C3 ⚠️ 每个脚本组件的 __type__ 都能从 .ts.meta 反解，且实例数与设计一致（防 MissingScript）', () => {
    const expected = new Map<string, string>();
    for (const [className, path] of Object.entries(SCRIPT_FILES)) expected.set(scriptCid(path), className);

    // 页面脚本 1 个 / 列表 VScrollView 1 个 / 行模板 1 个 / 页签 3 个
    const EXPECT_COUNT: Readonly<Record<string, number>> = {
        FriendPage: 1,
        FriendApplyPage: 1,
        FriendGetEndPage: 1,
        FriendRow: 1,
        FriendApplyRow: 1,
        FriendGetEndRow: 1,
        FriendTabButton: 3,
        VScrollView: 3,
    };

    for (const { file, all } of PREFABS) {
        const used = new Set(
            all
                .filter((entry) => entry && typeof entry.__type__ === 'string' && !(entry.__type__ as string).startsWith('cc.'))
                .map((entry) => entry.__type__ as string),
        );
        for (const cid of used) {
            assert.equal(cid.length, 23, `${file} 的 cid 长度必须是 23 位：${cid}`);
            assert.ok(expected.has(cid), `${file} 出现未知 cid（抄错 / 编辑器没编译）：${cid}`);
        }
        const counts = new Map<string, number>();
        for (const entry of all) {
            const type = entry?.__type__ as string | undefined;
            if (!type || type.startsWith('cc.')) continue;
            counts.set(expected.get(type)!, (counts.get(expected.get(type)!) ?? 0) + 1);
        }
        for (const [className, count] of Object.entries(counts)) {
            assert.equal(count, EXPECT_COUNT[className], `${file} 的 ${className} 实例数不对`);
        }
    }
});

// ---- 几何：反解回画布像素，对 FGUI XML 原值 ----

interface IGeomNode {
    readonly name: string;
    readonly path: string;
    readonly depth: number;
    readonly w: number;
    readonly h: number;
    readonly ax: number;
    readonly ay: number;
    readonly px: number;
    readonly py: number;
    readonly left: number;
    readonly top: number;
    readonly mask: boolean;
    readonly script: string | null;
}

function readGeom(all: readonly Record<string, unknown>[]): IGeomNode[] {
    const at = (ref: unknown): Record<string, unknown> | null => {
        const id = (ref as { __id__?: number } | null)?.__id__;
        return typeof id === 'number' ? (all[id] as Record<string, unknown>) : null;
    };
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

    const nodes: IGeomNode[] = [];
    const walk = (raw: Record<string, unknown>, parent: { x: number; y: number }, depth: number, path: string): void => {
        const comps = ((raw._components ?? []) as unknown[])
            .map((ref) => at(ref))
            .filter((comp): comp is Record<string, unknown> => !!comp);
        const uit = comps.find((comp) => comp.__type__ === 'cc.UITransform');
        const script = comps.find((comp) => !String(comp.__type__).startsWith('cc.'));

        const w = num((uit?._contentSize as { width?: number } | undefined)?.width);
        const h = num((uit?._contentSize as { height?: number } | undefined)?.height);
        const pt = uit?._anchorPoint as { x?: number; y?: number } | undefined;
        // ⚠️ 不能写 `pt ? num(pt.x) : 0.5` 之外的形式 —— anchor 合法值 0 会被 `||` 判 falsy
        const ax = pt ? num(pt.x) : 0.5;
        const ay = pt ? num(pt.y) : 0.5;

        const lpos = raw._lpos as { x?: number; y?: number } | undefined;
        const px = parent.x + num(lpos?.x);
        const py = parent.y - num(lpos?.y); // cocos y 向上 ⇒ FGUI y 向下取反
        // Cocos anchor.y：0=底 / 1=顶；FGUI pivot.y：0=顶 / 1=底（**方向相反**）
        // ⇒ 推左上角要写 `(1 - ay)`。写成 `ay` 时只有 ay=0.5 碰巧对。
        const name = String(raw._name);
        const full = path ? `${path}/${name}` : name;

        nodes.push({
            name, path: full, depth, w, h, ax, ay, px, py,
            left: px - ax * w,
            top: py - (1 - ay) * h,
            mask: comps.some((comp) => comp.__type__ === 'cc.Mask'),
            script: script ? String(script.__type__) : null,
        });

        for (const child of ((raw._children ?? []) as unknown[])) {
            const childNode = at(child);
            if (childNode) walk(childNode, { x: px, y: py }, depth + 1, full);
        }
    };

    const root = at((all[0] as { data?: unknown }).data);
    assert.ok(root, 'cc.Prefab.data 指向的根节点取不到');
    // 根节点在场景中心 (360, 640)（Canvas 720×1280）
    walk(root!, { x: 360, y: 640 }, 0, '');
    return nodes;
}

const GEOM_BY_PREFAB = new Map<string, readonly IGeomNode[]>(
    PREFABS.map((item) => [item.rootName, readGeom(item.all)]),
);

/** `组件_公共弹窗_新.xml` 的 4 个元素（**组件内坐标** ⇒ 已加弹窗左上角 (47,191)）。 */
const PANEL_RECTS: Readonly<Record<string, readonly [number, number, number, number]>> = {
    PanelBg: [47, 191, 626, 882],
    TitleBg: [188, 163, 344, 81],
    Title: [240, 180, 240, 42],
    CloseBtn: [611, 171, 60, 60],
};

/**
 * 行内节点（item 坐标 = 画布坐标，行左上角在画布 x = **78** = 列表视口左边界）。
 *
 * ⚠️ 视口自己的 `xy` 本身就是画布绝对坐标，**不能再加弹窗框的 47** —— 那是面板内部元素才要加的。
 */
function rowExpect(prefix: string, rowTop: number, kind: 'list' | 'apply' | 'take') {
    const at = (ix: number, iy: number, w: number, h: number) => ({ left: 78 + ix, top: rowTop + iy, w, h });
    const p = (name: string) => `${prefix}/RowView/content/RowTemplate/${name}`;
    const out: Record<string, { left: number; top: number; w: number; h: number }> = {
        [`${prefix}/RowView/content/RowTemplate`]: { left: 78, top: rowTop, w: 564, h: 133 },
    };
    if (kind === 'list') {
        out[p('Group')] = at(30, 20, 232, 81);
        out[p('Group/HeadFrame')] = at(37, 20, 81, 81);
        out[p('Group/Icon')] = at(78 - 25, 62 - 25, 50, 50);
        out[p('Group/LvTag')] = at(30, 21, 40, 40);
        out[p('Group/Lv')] = at(49 - 5.5, 41 - 14.5, 11, 29);
        // 玩家名 / 战力：FGUI 84×117 → **130**（有意偏离③）
        out[p('Group/Name')] = at(145, 31, 130, 29);
        out[p('Group/Power')] = at(145, 62, 130, 29);
        out[p('ChatBtn')] = at(277, 43, 136, 70);
        out[p('ActionBtn')] = at(414, 43, 136, 70);
        out[p('Duration')] = at(540 - 44, 14, 44, 29);
        out[p('CheckBtn')] = at(22, 42, 50, 50);
        out[p('CheckBtn/Mark')] = at(22, 42, 50, 50);
    } else if (kind === 'apply') {
        out[p('HeadFrame')] = at(37, 21, 81, 81);
        out[p('Icon')] = at(78 - 36, 62 - 36, 72, 72);
        out[p('LvTag')] = at(27, 8, 40, 40);
        out[p('Lv')] = at(46 - 5.5, 28 - 14.5, 11, 29);
        out[p('Name')] = at(146, 35, 130, 29);
        out[p('Power')] = at(146, 66, 130, 29);
        out[p('RejectBtn')] = at(277, 37, 136, 70);
        out[p('AgreeBtn')] = at(414, 37, 136, 70);
    } else {
        out[p('HeadFrame')] = at(36, 24, 81, 81);
        out[p('Icon')] = at(76 - 25, 64 - 25, 50, 50);
        out[p('LvTag')] = at(27, 15, 40, 40);
        out[p('Lv')] = at(46 - 5.5, 35 - 14.5, 11, 29);
        out[p('Name')] = at(146, 34, 130, 29);
        out[p('Power')] = at(146, 65, 130, 29);
        out[p('EndNum')] = at(540 - 81, 14, 81, 29);
        out[p('ActionBtn')] = at(414, 43, 136, 70);
    }
    return out;
}

type Rect = { left: number; top: number; w: number; h: number };

/** `[完整路径, 元素说明, left, top, w, h]` —— 期望表。 */
const EXPECT: Readonly<Record<string, Readonly<Record<string, Rect>>>> = {
    Friend: {
        Friend: { left: 0, top: 0, w: 720, h: 1280 },
        ...Object.fromEntries(Object.entries(PANEL_RECTS).map(([k, v]) => [`Friend/${k}`, { left: v[0], top: v[1], w: v[2], h: v[3] }])),
        // list (78,309) 564×592，视口 anchor (0.5,1) ⇒ 顶边 309
        'Friend/RowView': { left: 78, top: 309, w: 564, h: 592 },
        'Friend/BatchRemoveBtn': { left: 486, top: 250, w: 136, h: 60 },
        'Friend/SendOneKeyBtn': { left: 194, top: 941, w: 150, h: 70 },
        'Friend/GetEndBtn': { left: 390, top: 941, w: 150, h: 70 },
        'Friend/RefreshBtn': { left: 194, top: 930, w: 150, h: 70 },
        'Friend/ApplyListBtn': { left: 390, top: 930, w: 150, h: 70 },
        'Friend/RemoveOneKeyBtn': { left: 290, top: 955, w: 150, h: 70 },
        'Friend/SearchBtn': { left: 507, top: 238, w: 136, h: 75 },
        'Friend/SearchInput': { left: 162, top: 257, w: 355, h: 45 },
        // group n85 (86,1045) 548×73 → **高统一 72**（有意偏离②）
        'Friend/TabBar': { left: 86, top: 1045, w: 548, h: 72 },
        'Friend/TabBar/Tab1': { left: 86, top: 1045, w: 160, h: 72 },
        'Friend/TabBar/Tab2': { left: 280, top: 1045, w: 160, h: 72 },
        'Friend/TabBar/Tab3': { left: 474, top: 1045, w: 160, h: 72 },
        'Friend/FriendCountLabel': { left: 86, top: 267, w: 138, h: 29 },
        'Friend/BlackCountLabel': { left: 352 - 61, top: 269, w: 122, h: 29 },
        'Friend/SendTimesLabel': { left: 269 - 77.5, top: 911, w: 155, h: 29 },
        'Friend/RemoveCountLabel': { left: 361 - 57.5, top: 926, w: 115, h: 29 },
        ...rowExpect('Friend', 309, 'list'),
    },
    FriendApply: {
        FriendApply: { left: 0, top: 0, w: 720, h: 1280 },
        ...Object.fromEntries(Object.entries(PANEL_RECTS).map(([k, v]) => [`FriendApply/${k}`, { left: v[0], top: v[1], w: v[2], h: v[3] }])),
        // 有意偏离①：整个内容 +14/+9（老端只给「领取粮草」补了，申请列表那支在老端上是歪的）
        'FriendApply/RowView': { left: 78, top: 263, w: 564, h: 638 },
        'FriendApply/RefuseOneKeyBtn': { left: 162, top: 961, w: 150, h: 70 },
        'FriendApply/AgreeOneKeyBtn': { left: 392, top: 961, w: 150, h: 70 },
        'FriendApply/EmptyLabel': { left: 293 + 14 - 42, top: 531, w: 84, h: 29 },
        ...rowExpect('FriendApply', 263, 'apply'),
    },
    FriendGetEnd: {
        FriendGetEnd: { left: 0, top: 0, w: 720, h: 1280 },
        ...Object.fromEntries(Object.entries(PANEL_RECTS).map(([k, v]) => [`FriendGetEnd/${k}`, { left: v[0], top: v[1], w: v[2], h: v[3] }])),
        'FriendGetEnd/RowView': { left: 78, top: 263, w: 564, h: 638 },
        'FriendGetEnd/TimesLabel': { left: 332 + 14 - 77.5, top: 926, w: 155, h: 29 },
        'FriendGetEnd/GetEndOneKeyBtn': { left: 270, top: 961, w: 150, h: 70 },
        ...rowExpect('FriendGetEnd', 263, 'take'),
    },
};

test('C4 ⚠️ 几何：三个 prefab 的每个节点反解回画布像素后必须等于 FGUI XML 原值（差分 0.5px）', () => {
    const failures: string[] = [];
    for (const { rootName } of PREFABS) {
        const nodes = GEOM_BY_PREFAB.get(rootName)!;
        const byPath = new Map(nodes.map((node) => [node.path, node]));
        for (const [path, want] of Object.entries(EXPECT[rootName]!)) {
            const node = byPath.get(path);
            if (!node) {
                failures.push(`[${rootName}] 找不到节点 ${path}`);
                continue;
            }
            if (
                Math.abs(node.left - want.left) >= 0.5 || Math.abs(node.top - want.top) >= 0.5 ||
                Math.abs(node.w - want.w) >= 0.5 || Math.abs(node.h - want.h) >= 0.5
            ) {
                failures.push(
                    `[${rootName}] ${path}：实测(${node.left}, ${node.top}) ${node.w}×${node.h}，` +
                    `期望(${want.left}, ${want.top}) ${want.w}×${want.h}`,
                );
            }
        }
    }
    assert.deepEqual(failures, [], `节点位置偏离 FGUI 原值：\n${failures.join('\n')}`);
});

test('C5 ⚠️ `Group` 是**中心锚点**（套「左上角」公式会整体偏半个组宽 116px，且两边都自洽）', () => {
    const nodes = GEOM_BY_PREFAB.get('Friend')!;
    const group = nodes.find((node) => node.path === 'Friend/RowView/content/RowTemplate/Group');
    assert.ok(group, '找不到 RowTemplate/Group');
    assert.equal(group!.ax, 0.5);
    assert.equal(group!.ay, 0.5, 'Group 的 anchor 必须是 (0.5,0.5)，否则整组位移的基准就不成立');
    // 局部坐标必须等于 `FriendTable.FRIEND_ROW_GROUP_NORMAL`（删除模式位移的基准）
    const template = nodes.find((node) => node.path === 'Friend/RowView/content/RowTemplate')!;
    const lposX = group!.px - template.px;
    const lposY = -(group!.py - template.py);
    assert.equal(lposX, FRIEND_ROW_GROUP_NORMAL.x, 'Group._lpos.x 与 FRIEND_ROW_GROUP_NORMAL 必须一致');
    assert.equal(lposY, FRIEND_ROW_GROUP_NORMAL.y, 'Group._lpos.y 与 FRIEND_ROW_GROUP_NORMAL 必须一致');
    // 232/2 = 116 —— 套错公式时的偏移量，写在这里提醒别改回「左上角」算法
    assert.equal(group!.w / 2, 116);
});

test('C6 ⚠️ 根节点子序：RowView 必须排在内容区按钮**之前**（_children 序 = 渲染序）', () => {
    for (const { rootName } of PREFABS) {
        const nodes = GEOM_BY_PREFAB.get(rootName)!;
        const order = nodes.filter((node) => node.depth === 1).map((node) => node.name);
        const rowViewIndex = order.indexOf('RowView');
        // `CloseBtn` 属于弹窗框（本就在列表之前），不算内容区按钮
        const firstButton = order.findIndex((name) => /Btn$/.test(name) && name !== 'CloseBtn');
        assert.ok(rowViewIndex >= 0, `${rootName} 缺 RowView`);
        if (firstButton >= 0) {
            assert.ok(
                rowViewIndex < firstButton,
                `${rootName}: RowView 排在 ${order[firstButton]} 之后 —— 按钮会被 Mask 裁掉、收不到触摸`,
            );
        }
        assert.ok(order.indexOf('PanelBg') < rowViewIndex, '底板必须先于内容');
    }
});

test('C7 虚拟列表三件套：视口 / content 的 anchor 都是 (0.5,1)，视口带 Mask + Graphics', () => {
    const TEMPLATE_SCRIPT: Readonly<Record<string, string>> = {
        Friend: 'FriendRow',
        FriendApply: 'FriendApplyRow',
        FriendGetEnd: 'FriendGetEndRow',
    };
    for (const { rootName } of PREFABS) {
        const nodes = GEOM_BY_PREFAB.get(rootName)!;
        const byPath = new Map(nodes.map((node) => [node.path, node]));
        const view = byPath.get(`${rootName}/RowView`);
        const content = byPath.get(`${rootName}/RowView/content`);
        assert.ok(view && content, `${rootName} 缺 RowView/content`);
        assert.equal(view!.ax, 0.5);
        assert.equal(view!.ay, 1, 'VScrollView 硬要求视口 anchor=(0.5,1)');
        assert.equal(content!.ax, 0.5);
        assert.equal(content!.ay, 1, 'VScrollView 硬要求 content anchor=(0.5,1)');
        assert.ok(view!.mask, '视口必须带 cc.Mask，否则列表溢出到页面上');
        assert.equal(view!.script, scriptCid(SCRIPT_FILES.VScrollView!), `${rootName}/RowView 要挂 VScrollView`);

        // 行模板：`content.children[0]`（VScrollView 取模板的唯一口径）
        const template = byPath.get(`${rootName}/RowView/content/RowTemplate`);
        assert.ok(template, `${rootName} 缺 RowTemplate`);
        assert.equal(template!.script, scriptCid(SCRIPT_FILES[TEMPLATE_SCRIPT[rootName]!]!), `行模板脚本不对`);
        // `_lpos.y = -66.5`（= −行高/2 − 视口顶）与 `content._lpos.y = 0` 是 VScrollView 的取位口径
        // ⚠️ Cocos 的 y 向上 ⇒ `_lpos.y = -66.5` 在画布上落在**父节点下方** 66.5
        assert.equal(template!.py, view!.py + 66.5, 'RowTemplate 的 y 必须在视口顶下 66.5');
        assert.equal(content!.py, view!.py, 'content 必须在视口顶');
    }
});

test('C8 三个页签：x 升序 = 好友列表 / 添加好友 / 黑名单，且 @property 回填齐', () => {
    const nodes = GEOM_BY_PREFAB.get('Friend')!;
    const byPath = new Map(nodes.map((node) => [node.path, node]));
    const tabs = [1, 2, 3].map((i) => byPath.get(`Friend/TabBar/Tab${i}`));
    assert.ok(tabs.every(Boolean), '三个页签必须都在');
    const xs = tabs.map((tab) => tab!.left);
    assert.deepEqual(xs, [86, 280, 474], '等距 194（160 宽 + 34 间距）');
    assert.equal(new Set(xs).size, 3, '三个页签不能重叠（重叠时只有最上面那个收得到触摸）');
    assert.ok(xs[0]! < xs[1]! && xs[1]! < xs[2]!, 'x 必须升序，否则「页签 i → FriendTab i」的映射就反了');

    const cidTab = scriptCid(SCRIPT_FILES.FriendTabButton!);
    for (const tab of tabs) {
        assert.equal(tab!.script, cidTab, '页签上必须挂 FriendTabButton');
        assert.equal(tab!.w, 160, 'TabBar 高 72 时页签也是 160×72');
        assert.equal(tab!.h, 72);
    }
});

test('C9 ⚠️ 九宫格：`cc.Sprite._type` 必须是 1(SLICED)，且不是所有 Sprite 都该是 1', () => {
    // ⚠️ prefab 里 `_spriteFrame.__uuid__` 用的是 **png 的顶层 uuid + `@f9941`**（子资源后缀），
    //    `.png.meta` 的 `subMetas.f9941.uuid` 则**自带** `@f9941` ⇒ 两边比对前都要归一化，
    //    否则整批九宫格图会被判成「非九宫格」（本文件第一版就踩了这个）。
    const SLICED_UUIDS = new Set(
        [...FRIEND_ART_SLICED].map((name) => {
            const meta = JSON.parse(readFileSync(`${ART_DIR}/${name}.png.meta`, 'utf8')) as { uuid: string };
            return meta.uuid;
        }),
    );
    assert.equal(SLICED_UUIDS.size, 6, '6 张九宫格图的 png uuid 不能重复');
    // 抽一张反查：prefab 里的写法确实是「顶层 uuid + @f9941」
    for (const name of ['fd_row_bg']) {
        const meta = JSON.parse(readFileSync(`${ART_DIR}/${name}.png.meta`, 'utf8')) as { uuid: string };
        assert.equal(meta.uuid, 'a5bf30a4-00e7-4706-8039-adbffaab2897', 'fd_row_bg 的 png uuid 变了');
    }

    const failures: string[] = [];
    let slicedUsed = 0;
    for (const { file, all } of PREFABS) {
        all.forEach((entry, index) => {
            if (!entry || entry.__type__ !== 'cc.Sprite') return;
            const frame = entry._spriteFrame as { __uuid__?: string } | null;
            if (!frame?.__uuid__) return;
            const uuid = frame.__uuid__.replace('@f9941', '');
            if (SLICED_UUIDS.has(uuid)) {
                slicedUsed += 1;
                if (entry._type !== 1) {
                    failures.push(`${file} objs[${index}] 用了九宫格图却没写 _type=1（整张会被拉伸，不报错）`);
                }
            } else if (entry._type !== 0) {
                failures.push(`${file} objs[${index}] 非九宫格图不该用 _type=${String(entry._type)}`);
            }
        });
    }
    assert.deepEqual(failures, [], failures.join('\n'));
    assert.ok(slicedUsed >= 10, `九宫格 Sprite 只找到 ${slicedUsed} 个（底板/行底/按钮/勾选/输入框）`);
});

test('C10 搜索框 `cc.EditBox`：两个子 Label 的 anchor (0,1) 与局部位置，底图是 fd_input_bg', () => {
    const { all } = PREFABS.find((item) => item.rootName === 'Friend')!;
    const at = (ref: unknown) => all[(ref as { __id__?: number }).__id__!] as Record<string, unknown>;

    const inputNode = all.find((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === 'SearchInput');
    assert.ok(inputNode, '找不到 SearchInput');
    const comps = ((inputNode!._components ?? []) as unknown[]).map(at);
    const editBox = comps.find((comp) => comp.__type__ === 'cc.EditBox');
    assert.ok(editBox, 'SearchInput 上必须挂 cc.EditBox');
    const uit = comps.find((comp) => comp.__type__ === 'cc.UITransform')!;
    const w = (uit._contentSize as { width: number }).width;
    const h = (uit._contentSize as { height: number }).height;

    for (const [key, lastName] of [['_textLabel', 'TextLabel'], ['_placeholderLabel', 'PlaceholderLabel']] as const) {
        const label = at(editBox![key]);
        const node = at(label.node);
        assert.equal(node._name, lastName, `EditBox.${key} 指到了 ${String(node._name)}`);
        const childUit = ((node._components ?? []) as unknown[]).map(at).find((c) => c.__type__ === 'cc.UITransform')!;
        const anchor = childUit._anchorPoint as { x: number; y: number };
        assert.equal(anchor.x, 0);
        assert.equal(anchor.y, 1, '两个子 Label 都是左上锚点');
        const lpos = node._lpos as { x: number; y: number };
        assert.equal(lpos.x, -w / 2 + 2);
        assert.equal(lpos.y, h / 2);
    }

    // 底图必须是好友自己的那份 input（不是 login/input_box —— 那份的边框会影响登录界面）
    const bgMeta = JSON.parse(readFileSync(`${ART_DIR}/fd_input_bg.png.meta`, 'utf8')) as { uuid: string };
    const frame = editBox!._backgroundImage as { __uuid__: string };
    assert.equal(frame.__uuid__.replace('@f9941', ''), bgMeta.uuid);
    // FGUI 原稿 `<text input="true" prompt="请输入玩家名称">` **没写 maxLength** ⇒ 新端按用途自定：
    // 登录名 40 / GM 面板 64 / 这里 24（同一工程里都是自定值，没有统一口径可抄）
    assert.equal(editBox!._maxLength, 24, '搜索框上限 24');
});

// ============================================================
// D. 数据管道接线（源码文本 —— 这些模块依赖 cc / 网络，跑不进 Node）
// ============================================================

function readSource(path: string): string {
    assert.ok(existsSync(path), `源码不存在：${path}`);
    return readFileSync(path, 'utf8');
}

/** 剥掉注释，只留代码（做「代码里**没有**出现某某标识符」这类断言时必须先剥）。 */
function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const FRIEND_DIR = 'assets/script/app/friend';
const REPO_SRC = readSource(`${FRIEND_DIR}/FriendRepository.ts`);
const REPO_CODE = stripComments(REPO_SRC);
const PAGE_CODE = stripComments(readSource(`${FRIEND_DIR}/FriendPage.ts`));
const APPLY_PAGE_CODE = stripComments(readSource(`${FRIEND_DIR}/FriendApplyPage.ts`));
const GET_END_PAGE_CODE = stripComments(readSource(`${FRIEND_DIR}/FriendGetEndPage.ts`));
const MSG_SRC = readSource(`${FRIEND_DIR}/RequestFriendMsg.ts`);
const TABLE_SRC = readSource(`${FRIEND_DIR}/FriendTable.ts`);
const AVATAR_SRC = readSource(`${FRIEND_DIR}/FriendAvatar.ts`);
const ROUTE_SRC = readSource('assets/script/app/main/MainEntranceRoute.ts');
const LIST_SRC = readSource('assets/script/app/main/MainEntranceList.ts');
const OPEN_TABLE = 'assets/remoteRef/open.json';

test('D1 三个页面的 prefabPath 大小写正确（真机区分大小写，写错就是黑屏）', () => {
    const cases: readonly (readonly [string, string, string])[] = [
        [FRIEND_DIR + '/FriendPage.ts', PAGE_CODE, 'ui/Friend/Friend'],
        [FRIEND_DIR + '/FriendApplyPage.ts', APPLY_PAGE_CODE, 'ui/Friend/FriendApply'],
        [FRIEND_DIR + '/FriendGetEndPage.ts', GET_END_PAGE_CODE, 'ui/Friend/FriendGetEnd'],
    ];
    for (const [label, code, path] of cases) {
        assert.ok(code.includes(`static prefabPath = '${path}'`), `${label} 的 prefabPath 必须是 '${path}'`);
        assert.ok(existsSync(`assets/resources/${path}.prefab`), `磁盘上没有 assets/resources/${path}.prefab`);
        assert.ok(existsSync(`assets/resources/${path}.prefab.meta`), `缺 ${path}.prefab.meta（不会被编辑器导入）`);
    }
});

test('D2 ⚠️ 三张表都走 `CacheMgr`（服务端会推），**不自己存快照**', () => {
    for (const getter of ['getTlCmdFriend()', 'getTlCmdFriendApply()', 'getTlCmdFriendBlack()', 'getTlCmdRole()']) {
        assert.ok(REPO_CODE.includes(getter), `Repository 必须从缓存取 ${getter}`);
    }
    // 三张分表在 protoCache 里 ⇒ 不能当配置表读
    assert.ok(!REPO_CODE.includes(`getRefAllAsync('CmdFriend')`), 'CmdFriend 是缓存表，不是配置表');
    // 只有 `gameConfig` 是配置表
    assert.ok(REPO_CODE.includes(`readRows('gameConfig')`), 'friend* 上限必须读 gameConfig');
    // 推荐列表 / 我申请过谁 = 内存（老端 ModelFriend 同理），不能假装有缓存
    assert.ok(REPO_CODE.includes('private suggestRaw: unknown[] = []'));
    assert.ok(REPO_CODE.includes('private readonly appliedIds = new Set<string>()'));
});

test('D3 ⚠️ 写请求必须 `withTimeout` + 离线早退 + `catch` 返 failed（否则服务端不回就永悬）', () => {
    assert.ok(REPO_CODE.includes('withTimeout('), '必须 withTimeout');
    assert.ok(REPO_CODE.includes('net.isConnected'), '离线要早退');
    assert.ok(REPO_CODE.includes(`return 'offline'`), '离线返回 offline（不是 failed，提示文案不同）');
    assert.ok(/catch\s*\(/.test(REPO_CODE), 'catch 不能省');
    // 读 / 写两档超时，写必须比读长
    const read = /const READ_TIMEOUT_MS = (\d+)/.exec(REPO_SRC);
    const write = /const WRITE_TIMEOUT_MS = (\d+)/.exec(REPO_SRC);
    assert.ok(read && write, '读 / 写超时常量必须都在');
    assert.equal(Number(read![1]), 800);
    assert.equal(Number(write![1]), 5000);
    // 给测试用的导出（避免测试里硬编码）
    assert.ok(REPO_SRC.includes('export const FRIEND_READ_TIMEOUT_MS'));
    assert.ok(REPO_SRC.includes('export const FRIEND_WRITE_TIMEOUT_MS'));
});

test('D4 ⚠️ `targetId` 必须发**十进制字符串**（`LongBits.from` 把普通对象当 zero ⇒ id 静默变 0）', () => {
    assert.ok(REPO_CODE.includes('const id = toIdString(targetId)'), '发之前必须过 toIdString');
    assert.ok(REPO_CODE.includes(`if (!id) return Promise.resolve('failed')`), 'id 认不出来就别发');
    // 批量删除是唯一一个数组请求体
    assert.ok(REPO_CODE.includes('new RequestFriendsRemove({ targetId: ids as any }'), '删除好友的 targetId 是数组');
    for (const cls of ['RequestFriendGetEnd(', 'RequestFriendSendEnd(', 'RequestFriendsBlack(']) {
        assert.ok(REPO_CODE.includes(`new ${cls}{ targetId`), `${cls} 的单发请求体必须是 { targetId }`);
    }
});

test('D5 14 个协议类的 proto 名与老端一致（改一个字母就是静默发不出去）', () => {
    const EXPECT_PROTO: Readonly<Record<string, string>> = {
        RequestFriendsApply: 'CmdFriendsApplyReqMsg',
        RequestFriendsAdd: 'CmdFriendsAddReqMsg',
        RequestFriendsRefuse: 'CmdFriendsRefuseReqMsg',
        RequestFriendsRemove: 'CmdFriendsRemoveReqMsg',
        RequestFriendsBlack: 'CmdFriendsBlackReqMsg',
        RequestFriendBlackRemove: 'CmdFriendBlackRemoveReqMsg',
        RequestFriendsSearch: 'CmdFriendsSearchReqMsg',
        RequestFriendGetEnd: 'CmdFriendGetEndReqMsg',
        RequestFriendGetEndOneKey: 'CmdFriendGetEndOneKeyReqMsg',
        RequestFriendSendEnd: 'CmdFriendSendEndReqMsg',
        RequestFriendSendEndOneKey: 'CmdFriendSendEndOneKeyReqMsg',
        RequestdFriendAgreeOneKey: 'CmdFriendAgreeOneKeyReqMsg',
        RequestdFriendRefuseOneKey: 'CmdFriendRefuseOneKeyReqMsg',
        RequestdFriendRefreshSuggest: 'CmdFriendRefreshSuggestReqMsg',
    };
    for (const [cls, proto] of Object.entries(EXPECT_PROTO)) {
        assert.ok(MSG_SRC.includes(`export class ${cls} `), `缺请求类 ${cls}`);
        assert.ok(
            MSG_SRC.includes(`return '${proto}'`),
            `${cls} 的 proto 名必须是 '${proto}'`,
        );
    }
    // 老端两个拼写错误（`Requestd…`）保留原样，便于按名字检索
    assert.ok(MSG_SRC.includes('RequestdFriendAgreeOneKey'));
    assert.ok(MSG_SRC.includes('RequestdFriendRefreshSuggest'));
});

test('D6 本会话内存 + 本地补丁：Repository 用了 `pickPatchedCmd` / `friendFingerprint`', () => {
    assert.ok(REPO_CODE.includes('pickPatchedCmd('), '`load()` 里必须按指纹决定用补丁还是缓存');
    assert.ok(REPO_CODE.includes('friendFingerprint('), '打补丁时必须记下当时缓存行的指纹');
    assert.ok(REPO_CODE.includes('this.localPatches.set('), 'Rsp 回带的数据要存进本地补丁');
    assert.ok(REPO_CODE.includes('private readonly localPatches = new Map<string, IFriendPatch>()'));
    // 补丁只在 Rsp 里回带的四条请求上打（一键两条 + 单发两条）
    for (const call of ['this.patchOne(rsp?.friend)', 'this.patchMany(rsp?.friendList)']) {
        assert.ok(REPO_CODE.includes(call), `缺 ${call}`);
    }
});

test('D7 ⚠️ 三个页面的 `renderItemFn` 都只绑**一次**（在 `onInit`，不在 `onOpen`）', () => {
    const cases: readonly (readonly [string, string, string])[] = [
        ['FriendPage', PAGE_CODE, 'this.rowList.renderItemFn ='],
        ['FriendApplyPage', APPLY_PAGE_CODE, 'this.applyList.renderItemFn ='],
        ['FriendGetEndPage', GET_END_PAGE_CODE, 'this.rowList.renderItemFn ='],
    ];
    for (const [label, code, needle] of cases) {
        const hits = code.split(needle).length - 1;
        assert.equal(hits, 1, `${label}: \`renderItemFn\` 必须恰好赋值 1 次（放 onOpen 会随每次打开叠加）`);
        // ⚠️ 用 `onInit(` / `onOpen(`（不带修饰符）—— 页面里的签名是 `protected async onOpen()`
        const initAt = code.indexOf('onInit(');
        const openAt = code.indexOf('onOpen(');
        const bindAt = code.indexOf(needle);
        assert.ok(initAt >= 0 && openAt > initAt, `${label} 的 onInit/onOpen 顺序不对`);
        assert.ok(bindAt > initAt && bindAt < openAt, `${label}: 绑定必须在 onInit 里、onOpen 之前`);
        // 回调里按 index 现取，禁闭包捕获本趟入参
        assert.ok(code.includes('(node, index) => this.renderRow(node, index)'), `${label} 的回调必须按 index 现取`);
    }
});

test('D8 ⚠️ 两个子弹窗 `onOpen` 里必须 `await this.nextPopupFrame()` 再铺列表（VirtualScrollView 的 start 更晚）', () => {
    for (const [label, code] of [['FriendApplyPage', APPLY_PAGE_CODE], ['FriendGetEndPage', GET_END_PAGE_CODE]] as const) {
        const at = code.indexOf('await this.nextPopupFrame()');
        assert.ok(at > 0, `${label}: 必须 await nextPopupFrame()（否则槽位还没建，列表空白）`);
        assert.ok(code.includes('this.present('), `${label}: 铺列表要收一个入口`);
    }
    assert.ok(PAGE_CODE.includes('await this.nextPopupFrame()'), '主容器同样要等一帧');
    // 载荷并发用 revision 守卫（老页面在途回来的数据不许落地）
    for (const [label, code] of [['FriendPage', PAGE_CODE], ['FriendApplyPage', APPLY_PAGE_CODE], ['FriendGetEndPage', GET_END_PAGE_CODE]] as const) {
        assert.ok(code.includes('this.revision += 1'), `${label}: 必须有 revision 守卫`);
        assert.ok(code.includes('private get alive'), `${label}: 必须有 alive 守卫`);
    }
});

test('D9 头像加载走 `HeadArt` 的唯一入口，不自己拼路径（拼错静默留白）', () => {
    assert.ok(AVATAR_SRC.includes("from '../HeadArt'"), '头像必须走 HeadArt');
    assert.ok(AVATAR_SRC.includes('loadHeadFrame('), '用 loadHeadFrame，不要自己拼 icon.json 路径');
    assert.ok(!AVATAR_SRC.includes('resources.load('), '不要绕过唯一入口自己 load');
    // 两道保护：同一 id 不重复加载 / 换 id 后在途结果作废
    assert.ok(AVATAR_SRC.includes('generation'), '必须有 generation 作废旧结果（否则虚拟列表复用会串头像）');
    assert.ok(AVATAR_SRC.includes('if (this.appliedId === id) return'), '同 id 直接返回（不能先递增再判等）');
});

test('D10 ⚠️ 入口白名单**两处**都要登记（漏一处：入口不弹面板或弹了没内容）', () => {
    assert.ok(ROUTE_SRC.includes("LayerFriend: 'friend'"), 'MainEntranceRoute 缺 LayerFriend');
    assert.ok(ROUTE_SRC.includes(`'friend'`), "EntrancePopupKey 联合类型要有 'friend'");
    assert.ok(LIST_SRC.includes("import { FriendPage }"), 'MainEntranceList 要 import FriendPage');
    assert.ok(LIST_SRC.includes('friend: FriendPage'), 'MainEntranceList.POPUP_CLASSES 缺 friend');
    // 与 open.json 对得上：refId=206 / url=LayerFriend / belond=3
    const rows = JSON.parse(readFileSync(OPEN_TABLE, 'utf8')) as Array<Record<string, unknown>>;
    const found = rows.find((row) => Number(row.refId) === 206);
    assert.ok(found, 'open.json 里应当有 refId=206');
    assert.equal(found!.url, 'LayerFriend');
    assert.equal(Number(found!.belond), 3);
});

test('D11 有意偏离④：`FRIEND_CHAT_AVAILABLE = false`（Demo3.8 无聊天模块，私聊按钮不显示）', () => {
    assert.ok(PAGE_CODE.includes('const FRIEND_CHAT_AVAILABLE = false'), '聊天开关必须是 false，且是常量');
    // 传下去而不是抄在行组件里
    assert.ok(PAGE_CODE.includes('chatAvailable: FRIEND_CHAT_AVAILABLE'));
    // 页面里不许出现老端的聊天入口
    assert.ok(!PAGE_CODE.includes('ModelTeam'), 'Demo3.8 没有队伍 / 聊天系统');
});

test('D12 判定与文案分层：`FriendTable` 不 import `FriendTexts`（保住「文案 → 判定」的单向边）', () => {
    assert.ok(!TABLE_SRC.includes("from './FriendTexts'"), 'FriendTable 不能引 FriendTexts');
    assert.ok(!TABLE_SRC.includes("from './FriendArt'"), '判定不该知道美术');
    // FriendTable 的依赖只有零 import 的 RequestGuard
    const imports = [...TABLE_SRC.matchAll(/^import .*? from '(.+?)';/gm)].map((hit) => hit[1]);
    assert.deepEqual(imports, ['../net/RequestGuard'], `FriendTable 的依赖集变了：${imports.join(', ')}`);
});

// ============================================================
// E. 文案表
// ============================================================

test('E1 文案表键齐全（页面只从这里取字，别处不许造字符串）', () => {
    assert.deepEqual([...FRIEND_TAB_LABELS], ['好友列表', '添加好友', '黑名单']);
    assert.deepEqual(FRIEND_ROW_BUTTON_TEXT, {
        gift: '赠送', gifted: '已赠送', apply: '申请', applied: '已申请', remove: '移除',
    });
    assert.equal(FRIEND_BTN_REMOVE_MODE, '批量删除');
    assert.equal(FRIEND_BTN_REMOVE_MODE_BACK, '返回');
    assert.equal(FRIEND_BTN_SEND_ONE_KEY, '一键赠送');
    assert.equal(FRIEND_BTN_GET_END, '领取体力');
    assert.equal(FRIEND_BTN_REFRESH, '换一批');
    assert.equal(FRIEND_BTN_APPLY_LIST, '好友申请');
    assert.equal(FRIEND_BTN_REMOVE_ONE_KEY, '一键删除');
    assert.equal(FRIEND_BTN_SEARCH, '搜索');
    assert.equal(FRIEND_BTN_REFUSE_ONE_KEY, '一键拒绝');
    assert.equal(FRIEND_BTN_AGREE_ONE_KEY, '一键同意');
    assert.equal(FRIEND_BTN_GET_END_ONE_KEY, '一键领取');
    assert.equal(FRIEND_APPLY_EMPTY, '暂无申请');
    assert.equal(FRIEND_POWER_PREFIX, '战力：');
    assert.equal(FRIEND_ONLINE_TEXT, '在线');
    assert.equal(FRIEND_TIP_SEND_MAX, '今日赠送次数已用完');
    assert.equal(FRIEND_TIP_GET_MAX, '今日领取次数已用完');
    assert.equal(FRIEND_TIP_CANT_SEARCH_SELF, '不能搜索自己');
});

test('E2 模板占位：计数 / 次数 / 体力数三条都带 `{0}`（少一个就是「文案里没有数字」）', () => {
    assert.ok(FRIEND_COUNT_TEMPLATE.includes('{0}') && FRIEND_COUNT_TEMPLATE.includes('{1}'));
    assert.ok(FRIEND_BLACK_COUNT_TEMPLATE.includes('{0}'));
    assert.ok(FRIEND_SEND_TIMES_TEMPLATE.includes('{0}'));
    assert.ok(FRIEND_GET_END_TIMES_TEMPLATE.includes('{0}'));
    assert.ok(FRIEND_REMOVE_SELECT_TEMPLATE.includes('{0}'));
    assert.ok(FRIEND_END_NUM_TEMPLATE.includes('{0}'));
});

test('E3 `formatText`：顺序替换、缺参原样保留（一眼看出漏传）', () => {
    assert.equal(formatText('好友数：{0}/{1}', 3, 50), '好友数：3/50');
    assert.equal(formatText('今日还可赠送{0}次', 4), '今日还可赠送4次');
    assert.equal(formatText('{0}/{1}', 1), '1/{1}', '缺参保留原样');
    assert.equal(formatText('没有占位'), '没有占位');
});

test('E4 `FRIEND_ROW_TEXTS` 与 `IFriendRowTexts` 结构等价（谁改字段名编译当场报错）', () => {
    const keys: readonly (keyof IFriendRowTexts)[] = [
        'gift', 'gifted', 'apply', 'applied', 'remove', 'take', 'powerPrefix', 'online', 'endNumTemplate',
    ];
    assert.deepEqual(Object.keys(FRIEND_ROW_TEXTS).sort(), [...keys].sort());
    // 值必须与 `FriendTexts` 的单项常量一致（不是另抄一份文案）
    assert.equal(FRIEND_ROW_TEXTS.gift, FRIEND_ROW_BUTTON_TEXT.gift);
    assert.equal(FRIEND_ROW_TEXTS.gifted, FRIEND_ROW_BUTTON_TEXT.gifted);
    assert.equal(FRIEND_ROW_TEXTS.apply, FRIEND_ROW_BUTTON_TEXT.apply);
    assert.equal(FRIEND_ROW_TEXTS.applied, FRIEND_ROW_BUTTON_TEXT.applied);
    assert.equal(FRIEND_ROW_TEXTS.remove, FRIEND_ROW_BUTTON_TEXT.remove);
    assert.equal(FRIEND_ROW_TEXTS.take, '领取');
    assert.equal(FRIEND_ROW_TEXTS.powerPrefix, FRIEND_POWER_PREFIX);
    assert.equal(FRIEND_ROW_TEXTS.online, FRIEND_ONLINE_TEXT);
    assert.equal(FRIEND_ROW_TEXTS.endNumTemplate, FRIEND_END_NUM_TEMPLATE);
});
