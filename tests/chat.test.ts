/**
 * 「聊天」（老端 `LayerChat` / FGUI 包「聊天」）移植的回归网。
 *
 * 分五段，各守一件事：
 *
 *   A. **判定口径**（`ChatTable`，零 import 的纯函数）—— 老端这些判定散在 `LayerChat` /
 *      `ModelChat` / `ModelTeam` 里（依赖 DI 容器 + FGUI 控制器 + 网络），没法单测；
 *      移植时收敛成传参纯函数，本段是它们唯一的回归网。含三处**最容易静默失效**的：
 *        ① `uint64` 字段（`chatId` / `sendTime` / `img`）在 proto 里解出来是 **`Long` 对象**
 *           （`typeof === 'object'`）—— 只判 `'number'` 会让它们**静默变 0**（未读恒假、排序错乱）；
 *        ② 私聊对象列表要**同时**过滤「自己」和 `roleId < 1e4` 的系统播报；
 *        ③ 招募列表按 `sendTime` **升序**（照抄老端，越新的越靠下）。
 *   B. **资源口径**（`ChatArt` + `.png.meta`）—— 九宫格边框只存在 SpriteFrame 资源上，
 *      `.prefab` 表达不了 ⇒ 边框写进了 `.png.meta`，漏配就是「整张被拉伸」且**不报错**。
 *      本段还钉住「图名 → 该用哪种 `_type`」的 9 项清单（少列一项 `chatSpriteType` 就返 SIMPLE）。
 *   C. **prefab 结构 + 几何** —— 脚本组件的 `__type__` 必须能从 `*.ts.meta` 反解（防 cid
 *      抄错成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的**画布像素**一致。
 *   D. **数据管道接线**（源码文本 —— 这些模块依赖 `cc` / 网络，跑不进 Node）——
 *      `CacheMgr` 三张缓存、4 个协议名、超时兜底、**7 个 `renderItemFn` 只绑一次**、入口白名单两处。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/聊天/组件/组件_聊天_界面.xml` +
 *           同行录下的 `组件_聊天_*.xml`（气泡 / 私聊气泡 / 招募项 / 私聊头像项 / 艾特项 / 表情项）
 *           + `共用组件/组件/弹窗/组件_公共弹窗_新.xml` + `共用组件/组件/页签/组件_弹窗_页签.xml`
 *   - 老端：`client/assets/script/app/**` 下的 `LayerChat*` + `ModelChat` + `ModelTeam.RequestRecruitList`
 *   - 生成器：`tmp/gen_chat.mjs`（从 XML 直接算几何，自带 109 条画布盒断言）
 *
 * ⚠️ 三处**刻意与老端不同**（理由见 `ChatTable.ts` / `ChatTexts.ts` / `ChatPage.ts` 文件头），
 *    本文件把它们当契约钉住，别当 bug 改回去：
 *      ① 招募「点击加入」**发不出包** —— 老端要 `CmdBattleRoleAttr`（战前属性快照），
 *         Demo3.8 没有任何地方构造过它 ⇒ 如实提示「战前属性尚未接入」，不假装加入成功；
 *      ② 敏感词校验**未接入**（老端走平台 SDK，Demo3.8 无 SDK 层）—— `checkMessageUnavailable` 如实说明；
 *      ③ 联盟页签的显隐判据退化：老端走 `ModelLeague.IsJoinedLeague()`，Demo3.8 无联盟业务模块
 *         ⇒ 退化成「`CmdUnion` 缓存有行就显示」。
 *
 * ⚠️ 两处**本轮实测踩到的坑**，已修，本文件是它的回归网：
 *      ① **`group` 节点的子件原点**（C5）—— FGUI `<group>` 的子元素坐标是**父组件坐标系**，
 *         而 group 在 Cocos 里是**真实节点**；生成器一度把「父框 + group 锚点比例」当原点，
 *         于是 5 棵子树（`InfoGroup` / `InputBar` / `PrivateInputBar` / `EmojiPopup` / `AtPopup`）
 *         在画布上被平移了 **group 自身的 `_lpos`**：输入条子件下沉 314px 直接掉出 720×1280 画布、
 *         招募项「点击加入」右移 74.5px 被 Mask 裁掉。**这种偏差在「frame 空间自比」里完全看不出**。
 *      ② `cc.RichText` 的 `contentSize` 会被编辑器按实际文本**重新量**（实测 328×32 → 0×27.72）
 *         ⇒ C4 的几何表**不含**那 4 个 `Msg` 节点（它们的盒尺寸不是稳定契约，位置另有断言）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    atTag,
    ChatChannel,
    CHAT_CHANNEL_ORDER,
    CHAT_DEFAULT_CHANNEL,
    CHAT_THEATER_HEAD_ID,
    chatKey,
    channelsFor,
    canSpeak,
    emojiTags,
    EMOJI_COUNT,
    fallbackStageName,
    filterPrivateHeads,
    formatStageName,
    hasUnread,
    isPrivateChannel,
    isReadonlyChannel,
    isSelfMessage,
    isSelfRecruit,
    isSystemRoleId,
    needsAtButton,
    nextPrivateRoleId,
    normalizeChatRole,
    normalizeFriendAsRole,
    normalizeFriends,
    normalizeMessage,
    normalizeMessages,
    normalizeRecruit,
    normalizeRecruits,
    normalizeSpeaker,
    parseEmoji,
    recruitLayout,
    TF_BATTLE_TYPE_CHAPTER,
    toIdString,
    type IChatMessage,
    type IChatRole,
} from '../assets/script/app/chat/ChatTable';
import {
    chatSpriteType,
    chatTint,
    CHAT_ART_BLACK_BOX,
    CHAT_ART_BUBBLE_BG,
    CHAT_ART_DIRS,
    CHAT_ART_INPUT_BG,
    CHAT_ART_MAIN_CHAT,
    CHAT_ART_ROOT,
    CHAT_ART_SLICED,
    CHAT_EMOJI_PREFIX,
    CHAT_HEAD_ART,
    CHAT_SHARED_HEAD_BOX_NAME,
    CHAT_SHARED_HEAD_BOX_ROOT,
    CHAT_SHARED_POPUP_BG_NAME,
    CHAT_SHARED_POPUP_BG_ROOT,
    CHAT_SHARED_SEND_NAME,
    CHAT_SPRITE_SIMPLE,
    CHAT_SPRITE_SLICED,
    CHAT_TINT_GRAY,
    CHAT_TINT_NORMAL,
    emojiArtName,
    emojiRichSrc,
} from '../assets/script/app/chat/ChatArt';
import { channelTitle, CHAT_TEXTS, CHAT_TITLE, formatText } from '../assets/script/app/chat/ChatTexts';

// ============================================================
// 夹具
// ============================================================

/** 模拟 protobuf 解出来的 `Long`（`uint64` 运行时就是这个形状）。 */
function longLike(value: string) {
    return { low: 0, high: 0, unsigned: true, toString: () => value };
}

function speaker(over: Record<string, unknown> = {}) {
    return { roleId: '10001', name: '甲', img: '201', serverId: 1, selectServerId: 1, ...over };
}

function message(over: Record<string, unknown> = {}): IChatMessage {
    return normalizeMessage({ channel: 2, id: 0, chatId: 1, content: '正文', sendTime: 1000, speaker: speaker(), ...over })!;
}

function role(over: Partial<IChatRole> = {}): IChatRole {
    return { roleId: '10001', name: '甲', img: '201', serverId: 1, selectServerId: 1, ...over };
}

// ============================================================
// A. 判定口径（`ChatTable` 纯函数）
// ============================================================

test('A1 频道枚举与 proto 逐值一致；基础 4 个 + 联盟动态追加', () => {
    assert.equal(ChatChannel.Recruit, 0);
    assert.equal(ChatChannel.Theater, 1);
    assert.equal(ChatChannel.World, 2);
    assert.equal(ChatChannel.Private, 3);
    assert.equal(ChatChannel.Union, 4);
    assert.deepEqual([...CHAT_CHANNEL_ORDER], [0, 1, 2, 3], '基础顺序不含联盟');
    assert.equal(CHAT_DEFAULT_CHANNEL, ChatChannel.Recruit);

    assert.deepEqual(channelsFor(false), [0, 1, 2, 3]);
    assert.deepEqual(channelsFor(true), [0, 1, 2, 3, 4], '入盟才追加联盟');
    // 返回的是新数组，改它不能污染常量
    const once = channelsFor(true);
    once.pop();
    assert.equal(CHAT_CHANNEL_ORDER.length, 4, 'CHAT_CHANNEL_ORDER 不能被就地改');
});

test('A2 ⚠️ 发言 / 不可发言 / 艾特 三个判据全表（战区没有输入条，但**有艾特按钮**）', () => {
    // canSpeak：世界(2) / 联盟(4) / 私聊(3)；招募(0) 与战区(1) **不能发言**
    assert.deepEqual([0, 1, 2, 3, 4].map(canSpeak), [false, false, true, true, true]);
    // isReadonlyChannel：只有招募整块显示「该频道不可发言」
    assert.deepEqual([0, 1, 2, 3, 4].map(isReadonlyChannel), [true, false, false, false, false]);
    // needsAtButton：FGUI `按钮_艾特` 的 gearDisplay pages="1,2,4"
    assert.deepEqual([0, 1, 2, 3, 4].map(needsAtButton), [false, true, true, false, true]);
    // 私聊走 privateList + headList，且发言用第二个输入框
    assert.deepEqual([0, 1, 2, 3, 4].map(isPrivateChannel), [false, false, false, true, false]);

    // ⚠️ 战区（1）：不能发言、不是只读提示，但**有艾特按钮**
    //    —— FGUI `按钮_艾特` 的 gearDisplay pages="1,2,4"（含 1）⇒ 底部只剩一枚艾特按钮，
    //    不是整块空白。回查 `组件_聊天_界面.xml:61-62` 实测。
    assert.equal(canSpeak(1), false);
    assert.equal(isReadonlyChannel(1), false);
    assert.equal(needsAtButton(1), true);

    // 越界频道号不抛
    for (const fn of [canSpeak, isReadonlyChannel, isPrivateChannel, needsAtButton]) {
        assert.equal(typeof (fn as (n: number) => boolean)(99), 'boolean');
    }
});

test('A3 ⚠️ `toIdString`：`Long` 对象 / number / string 都收，取不到给空串（不能 NaN、不能丢精度）', () => {
    assert.equal(toIdString(longLike('18446744073709551615')), '18446744073709551615', 'uint64 超 2^53 也不能丢精度');
    assert.equal(toIdString(123), '123');
    assert.equal(toIdString('123'), '123');
    assert.equal(toIdString(123.9), '123', '取整');
    // 认不出来的形状
    assert.equal(toIdString(null), '');
    assert.equal(toIdString(undefined), '');
    assert.equal(toIdString(''), '');
    assert.equal(toIdString('abc'), '');
    assert.equal(toIdString('12abc'), '');
    assert.equal(toIdString(Number.NaN), '');
    assert.equal(toIdString(Number.POSITIVE_INFINITY), '');
    assert.equal(toIdString({}), '');
    assert.equal(toIdString({ toString: () => 'x' }), '');
    // -1 不是合法 id（正则只认数字）
    assert.equal(toIdString(-1), '-1');
});

test('A4 ⚠️ `normalizeMessage`：`chatId` / `sendTime` 是 `Long` ⇒ 不能变 0（未读恒假、排序错乱）', () => {
    const msg = normalizeMessage({
        channel: longLike('2'),
        id: longLike('0'),
        chatId: longLike('123456789012345678'),
        content: '你好',
        sendTime: longLike('1700000000000'),
        speaker: { roleId: longLike('10001'), name: '甲', img: longLike('201'), serverId: longLike('1') },
    });
    assert.ok(msg);
    // ⚠️ `Long.toNumber()` 走 IEEE754 双精度 ⇒ `'123456789012345678'` 的真实结果是
    //    `123456789012345680`（不是 …670）。期望值必须按**真实浮点结果**写，
    //    按"看着像"写会得到一条假失败。
    assert.equal(msg!.chatId, 123456789012345680, '数字字段只判 number 会静默变 0');
    assert.notEqual(msg!.chatId, 0);
    assert.equal(msg!.sendTime, 1700000000000);
    assert.equal(msg!.channel, 2);
    assert.equal(msg!.speaker.img, '201', 'img 也是 uint64');
    assert.equal(msg!.speaker.roleId, '10001');
    assert.equal(msg!.speaker.serverId, 1);
});

test('A5 `normalizeMessage` / `normalizeSpeaker`：缺 id 即无效（认不出身份的行不能进列表）', () => {
    assert.equal(normalizeMessage(null), null);
    assert.equal(normalizeMessage('甲'), null);
    assert.equal(normalizeMessage({ content: '没有 speaker' }), null);
    assert.equal(normalizeMessage({ speaker: { name: '甲' } }), null, 'speaker 缺 roleId ⇒ 整条无效');
    assert.equal(normalizeSpeaker({ name: '甲' }), null);
    assert.equal(normalizeSpeaker('甲'), null);
    assert.equal(normalizeSpeaker(null), null);
    // 缺省值收敛：字符串字段给 ''、数字字段给 0
    const speakerless = normalizeSpeaker({ roleId: '1' })!;
    assert.equal(speakerless.name, '');
    assert.equal(speakerless.img, '');
    assert.equal(speakerless.serverId, 0);
    assert.equal(speakerless.selectServerId, 0);
    const bare = normalizeMessage({ speaker: { roleId: '1' } })!;
    assert.equal(bare.content, '');
    assert.equal(bare.sendTime, 0);
});

test('A6 `normalizeMessages`：跳过无效项、非数组给空数组（不抛）', () => {
    const list = normalizeMessages([
        { speaker: { roleId: '1' }, sendTime: 1 },
        null,
        { speaker: { name: '无 id' } },
        { speaker: { roleId: '2' }, sendTime: 2 },
    ]);
    assert.deepEqual(list.map((m) => m.speaker.roleId), ['1', '2']);
    assert.deepEqual(normalizeMessages([]), []);
    assert.deepEqual(normalizeMessages(null), []);
    assert.deepEqual(normalizeMessages(undefined), []);
    assert.deepEqual(normalizeMessages({ length: 2 }), [], '类数组不算数组');
});

test('A7 `isSelfMessage`：`selfId` 为空时**一律不算自己**（不能因空串相等而整列右对齐）', () => {
    const mine = message({ speaker: speaker({ roleId: '10001' }) });
    const other = message({ speaker: speaker({ roleId: '10002' }) });
    assert.equal(isSelfMessage(mine, '10001'), true);
    assert.equal(isSelfMessage(other, '10001'), false);
    assert.equal(isSelfMessage(mine, ''), false, 'selfId 未知时不能把「空 == 空」判成自己');
});

test('A8 `chatKey`：招募/战区/世界/联盟只按频道算，私聊追加对象 id', () => {
    assert.equal(chatKey(0), '0');
    assert.equal(chatKey(1), '1');
    assert.equal(chatKey(2), '2');
    assert.equal(chatKey(4), '4');
    // 四个广播频道忽略 id（传了也不进 key）
    assert.equal(chatKey(2, 999), '2');
    assert.equal(chatKey(4, 999), '4');
    // 私聊每个对象一条独立消息流
    assert.equal(chatKey(3, 10001), '3_10001');
    assert.equal(chatKey(3, 10002), '3_10002');
    assert.notEqual(chatKey(3, 1), chatKey(3, 2));
    assert.equal(chatKey(3), '3_0', '私聊不传 id 时的默认值');
});

test('A9 ⚠️ `isSystemRoleId`：纯字符串比较，`1e4` 为界（含前导零）', () => {
    assert.equal(isSystemRoleId('1'), true);
    assert.equal(isSystemRoleId('0'), true);
    assert.equal(isSystemRoleId('9999'), true);
    assert.equal(isSystemRoleId('10000'), false);
    assert.equal(isSystemRoleId('10001'), false);
    assert.equal(isSystemRoleId('100000'), false);
    // 前导零：'09999' 数值上是 9999 ⇒ 系统；'099990' 是 5 位以上且 > '09999'
    assert.equal(isSystemRoleId('09999'), true);
    assert.equal(isSystemRoleId('00001'), true);
    assert.equal(isSystemRoleId('099990'), false);
    // 全零串归一成 '0'
    assert.equal(isSystemRoleId('0000'), true);
    // 超长 id（uint64）不能因精度丢失而误判
    assert.equal(isSystemRoleId('18446744073709551615'), false);
});

test('A10 ⚠️ `filterPrivateHeads`：同时剔「自己」和系统播报，且**保持服务端顺序**', () => {
    const rows = [
        // ⚠️ 判据是「数值 < 1e4」，`isSmallRoleId` 用**纯字符串比**实现
        //    ⇒ '70003'（5 位、> '09999'）**不是**系统 id（那是战区系统头像的 id，
        //    见 `CHAT_THEATER_HEAD_ID`）；真正 < 1e4 的长这样：
        { roleId: '9999', name: '系统播报' },   // 4 位 ⇒ 剔
        { roleId: '10003', name: '丙' },
        { roleId: '10001', name: '我' },        // 自己 ⇒ 剔（服务端可能把自己塞进来）
        { roleId: '10002', name: '乙' },
    ];
    assert.deepEqual(filterPrivateHeads(rows, '10001').map((r) => r.roleId), ['10003', '10002']);
    // selfId 未知时只按系统播报过滤
    assert.deepEqual(filterPrivateHeads(rows, '').map((r) => r.roleId), ['10003', '10001', '10002']);
    // `Long` 形状的自己同样要认出来
    assert.deepEqual(
        filterPrivateHeads([{ roleId: longLike('10001') }, { roleId: '10002' }], '10001').map((r) => r.roleId),
        ['10002'],
    );
    assert.deepEqual(filterPrivateHeads([], '1'), []);
    assert.deepEqual(filterPrivateHeads([null, '甲', { name: '无 id' }], '1'), []);
});

test('A11 `nextPrivateRoleId`：当前项还在就保留，否则退回第一个；空列表给空串', () => {
    const rows = [role({ roleId: '10001' }), role({ roleId: '10002' })];
    assert.equal(nextPrivateRoleId(rows, '10002'), '10002', '仍有效 ⇒ 不动');
    assert.equal(nextPrivateRoleId(rows, '19999'), '10001', '失效 ⇒ 拿第一个');
    assert.equal(nextPrivateRoleId(rows, ''), '10001');
    assert.equal(nextPrivateRoleId([], '10001'), '');
});

test('A12 `normalizeChatRole`：`roleId` 走 `toIdString`，缺 id 返 null', () => {
    const parsed = normalizeChatRole({ roleId: longLike('10001'), name: '甲', img: longLike('201'), serverId: longLike('3') });
    assert.ok(parsed);
    assert.equal(parsed!.roleId, '10001');
    assert.equal(parsed!.img, '201');
    assert.equal(parsed!.serverId, 3);
    assert.equal(normalizeChatRole({ name: '甲' }), null);
    assert.equal(normalizeChatRole(null), null);
});

test('A13 ⚠️ `normalizeFriendAsRole`：好友行的主键叫 `friendId`（不是 `roleId`）', () => {
    const parsed = normalizeFriendAsRole({ friendId: longLike('10009'), name: '丁', img: '205' });
    assert.ok(parsed);
    assert.equal(parsed!.roleId, '10009', '好友行主键 = friendId');
    assert.equal(parsed!.name, '丁');
    // 拿 roleId 形状喂进来必须认不出（否则会拿 undefined 当 id）
    assert.equal(normalizeFriendAsRole({ roleId: '10009', name: '丁' }), null);
    assert.equal(normalizeFriendAsRole({ friendId: '' }), null);

    assert.deepEqual(
        normalizeFriends([{ friendId: '10002' }, null, { name: '无 id' }, { friendId: '10001' }]).map((r) => r.roleId),
        ['10002', '10001'],
        '保持服务端顺序，不重排',
    );
    assert.deepEqual(normalizeFriends(null), []);
});

test('A14 ⚠️ `normalizeRecruits`：按 `sendTime` **升序**（照抄老端，别改成降序）', () => {
    const list = normalizeRecruits([
        { roleId: '10002', sendTime: 300 },
        { roleId: '10001', sendTime: 100 },
        { roleId: '10003', sendTime: 200 },
    ]);
    assert.deepEqual(list.map((r) => r.sendTime), [100, 200, 300]);
    assert.deepEqual(list.map((r) => r.roleId), ['10001', '10003', '10002']);

    // 全部字段缺省时收敛成 0 / ''
    const bare = normalizeRecruit({ roleId: '1' })!;
    assert.equal(bare.level, 0);
    assert.equal(bare.power, 0);
    assert.equal(bare.battleType, 0);
    assert.equal(bare.battleId, 0);
    assert.equal(bare.sendTime, 0);
    assert.equal(bare.name, '');
    assert.equal(normalizeRecruit({ name: '无 id' }), null);
    assert.deepEqual(normalizeRecruits('不是数组'), []);
});

test('A15 `isSelfRecruit`：自己发的招募（点击加入要当场拦）', () => {
    const mine = normalizeRecruit({ roleId: '10001' })!;
    assert.equal(isSelfRecruit(mine, '10001'), true);
    assert.equal(isSelfRecruit(mine, '10002'), false);
    assert.equal(isSelfRecruit(mine, ''), false, 'selfId 未知时不算自己');
});

test('A16 ⚠️ `formatStageName` 是**替换**第一处 `-`（不是插入）；`fallbackStageName` 取模 10000', () => {
    // 老端 `LayerChat.ts:291` = `.replace("-", `-${stage}`)` —— **替换**而非插入
    // ⇒ 原章节名里那个 `-` 被吃掉：'1-藏宝海湾' + 3 ⇒ '1-3藏宝海湾'（不是 '1-3-藏宝海湾'）。
    // 同一写法另有 `LayerBeinvited.ts:89` 可交叉印证。
    assert.equal(formatStageName('1-藏宝海湾', 3), '1-3藏宝海湾');
    assert.equal(formatStageName('藏宝海湾', 3), '藏宝海湾', '没有 `-` 时原样');
    assert.equal(formatStageName('', 3), '');
    assert.equal(formatStageName('a-b-c', 9), 'a-9b-c', '`String.replace` 只换第一处、且是替换，照抄老端');
    assert.equal(fallbackStageName(1), '第1层');
    assert.equal(fallbackStageName(10001), '第1层', '取模 10000');
    assert.equal(fallbackStageName(0), '第0层');
    assert.equal(TF_BATTLE_TYPE_CHAPTER, 1);
});

test('A17 ⚠️ `recruitLayout`：招募项「自己 / 别人」两档，4 个元素逐值（FGUI gearXY）', () => {
    const other = recruitLayout(false);
    assert.deepEqual(other.background, { x: 62, y: -16 });
    assert.deepEqual(other.head, { x: -204, y: 31.5 });
    assert.deepEqual(other.name, { x: -97, y: 111 });
    assert.deepEqual(other.infoGroup, { x: 74.5, y: 5 });
    assert.equal(other.nameAlign, 'left');

    const self = recruitLayout(true);
    assert.deepEqual(self.background, { x: -61, y: -16 });
    assert.deepEqual(self.head, { x: 202, y: 31.5 });
    assert.deepEqual(self.name, { x: 103, y: 111 });
    assert.deepEqual(self.infoGroup, { x: -50.5, y: 5 });
    assert.equal(self.nameAlign, 'right');

    // 底板 / 名字整体左右互换（组内 4 件不动，只有「组」位移）
    assert.equal(self.background.x - other.background.x, -123);
    assert.equal(self.head.x - other.head.x, 406);
    assert.equal(self.infoGroup.x - other.infoGroup.x, -125);
});

test('A18 ⚠️ `hasUnread`：首**尾**两条都看（中间可能有补拉的历史）', () => {
    const msgs = [message({ sendTime: 100 }), message({ sendTime: 500 }), message({ sendTime: 300 })];
    assert.equal(hasUnread(msgs, 0), true);
    assert.equal(hasUnread(msgs, 99), true);
    assert.equal(hasUnread(msgs, 500), false, '已读到末条 ⇒ 无未读');
    // 首尾**都**落后于已读 ⇒ 无未读（老端 `ModelChat.hasNewChat`：两个 compare 都得 false）
    assert.equal(hasUnread(msgs, 400), false, '首 100 / 尾 300 都 ≤ 400 ⇒ 无未读');
    // 末条落后于已读、但**首条**更新（补拉的历史排在最前）⇒ 仍算未读
    const patchLater = [message({ sendTime: 600 }), message({ sendTime: 500 }), message({ sendTime: 300 })];
    assert.equal(hasUnread(patchLater, 400), true, '末条 300 ≤ 400，但首条 600 > 400');
    assert.equal(hasUnread([], 0), false, '空流恒无未读');

    // 只有首条新：末条旧、首条新 ⇒ 仍算未读（老端特意同时看首尾）
    const firstOnly = [message({ sendTime: 900 }), message({ sendTime: 100 })];
    assert.equal(hasUnread(firstOnly, 500), true);
});

test('A19 ⚠️ `parseEmoji`：`[:N]` → `<img>`；越界原样保留；`srcOf` 给空则不动', () => {
    const srcOf = (i: number) => `image/chat/ct_emoji_${i}/spriteFrame`;
    assert.equal(parseEmoji('笑[:0]', srcOf), "笑<img src='image/chat/ct_emoji_0/spriteFrame'/>");
    assert.equal(
        parseEmoji('[:1][:43]', srcOf),
        "<img src='image/chat/ct_emoji_1/spriteFrame'/><img src='image/chat/ct_emoji_43/spriteFrame'/>",
        '最后一个合法下标是 43',
    );
    assert.equal(parseEmoji('[:44]', srcOf), '[:44]', '越界原样保留（服务端自己忽略）');
    assert.equal(parseEmoji('[:999]', srcOf), '[:999]');
    assert.equal(parseEmoji('[:]', srcOf), '[:]', '没有数字不匹配');
    assert.equal(parseEmoji('普通文本', srcOf), '普通文本');
    assert.equal(parseEmoji('', srcOf), '');
    assert.equal(parseEmoji('[:0]', () => ''), '[:0]', 'srcOf 给空串 ⇒ 不替换（不留半个 img 标签）');
});

test('A20 `emojiTags` / `EMOJI_COUNT`：0..43 共 44 个', () => {
    assert.equal(EMOJI_COUNT, 44);
    const tags = emojiTags();
    assert.equal(tags.length, EMOJI_COUNT);
    assert.equal(tags[0], '0');
    assert.equal(tags[EMOJI_COUNT - 1], '43');
    assert.equal(new Set(tags).size, EMOJI_COUNT, '不能有重复下标');
});

test('A21 `atTag`：富文本标签逐字对上老端', () => {
    assert.equal(atTag('甲'), '[color=#00ff00]@甲[/color]');
    assert.equal(atTag(''), '[color=#00ff00]@[/color]');
});

test('A22 战区消息统一换系统头像（老端 `headIcon = 70003`）', () => {
    assert.equal(CHAT_THEATER_HEAD_ID, '70003');
    assert.equal(toIdString(CHAT_THEATER_HEAD_ID), CHAT_THEATER_HEAD_ID);
});

// ============================================================
// B. 资源口径
// ============================================================

const ART_DIR = 'assets/resources/image/chat';

/** `ChatArt` 里 chat 自有（`ct_`）的 8 个单图名（emoji 另有 44 张）。 */
const CHAT_OWN_ART: readonly string[] = [
    CHAT_ART_BLACK_BOX,
    CHAT_ART_INPUT_BG,
    CHAT_ART_BUBBLE_BG,
    'ct_recruit_bg',
    'ct_at_btn',
    'ct_bq_btn',
    'ct_join_btn',
    'ct_close_02',
    CHAT_ART_MAIN_CHAT,
];

test('B1 chat 自有美术 9 张 + 44 张表情齐（少一张就是一个白框，且**不报错**）', () => {
    assert.equal(CHAT_ART_ROOT, 'image/chat', 'loadArt 的 root 不能带 `resources/` 前缀');
    assert.equal(CHAT_EMOJI_PREFIX, 'ct_emoji_');
    assert.equal(CHAT_OWN_ART.length, 9);
    assert.equal(new Set(CHAT_OWN_ART).size, 9, '图名不能重复');

    const all = [...CHAT_OWN_ART, ...emojiTags().map((t) => emojiArtName(Number(t)))];
    assert.equal(all.length, 53, '9 张自有单图 + 44 张表情');

    const missing = all.filter((name) => !existsSync(`${ART_DIR}/${name}.png`));
    assert.deepEqual(missing, [], `缺图：${missing.join(', ')}`);
    const noMeta = all.filter((name) => !existsSync(`${ART_DIR}/${name}.png.meta`));
    assert.deepEqual(noMeta, [], `缺 .png.meta（编辑器不会给 uuid ⇒ 图片打不开）：${noMeta.join(', ')}`);

    // emoji 图名必须是连续的 ct_emoji_0..43（parseEmoji 的 `[:N]` 直接按 N 取）
    const emoji = emojiTags().map((t) => emojiArtName(Number(t)));
    assert.equal(emoji[0], 'ct_emoji_0');
    assert.equal(emoji[43], 'ct_emoji_43');
});

test('B2 ⚠️ 九宫格 **9 项**：边框必须落在 `.png.meta`，且中心格必须 > 0', () => {
    // 「中心格」判据：rawW − left − right > 0 且 rawH − top − bottom > 0
    // 边框写错时图照样显示，只是四角被拉伸 / 整张被拉 —— 不报错。
    // 期望值 = 生成器 `tmp/gen_chat.mjs` 里 `U.blackBox … U.titleBg` 那 9 项（逐字对上）。
    assert.equal(CHAT_ART_SLICED.size, 9, '九宫格清单是 9 项（少列一项 chatSpriteType 就返 SIMPLE）');
    assert.deepEqual([...CHAT_ART_SLICED].sort(), Object.keys(CHAT_ART_DIRS).sort(), '两个表必须同一批图名');

    const failures: string[] = [];
    for (const name of CHAT_ART_SLICED) {
        const dir = `${ART_DIR}/../../${CHAT_ART_DIRS[name]}`.replace(/\/[^/]+\/\.\.\//, '/');
        const metaPath = `assets/resources/${CHAT_ART_DIRS[name]}/${name}.png.meta`;
        assert.ok(existsSync(metaPath), `CHAT_ART_DIRS 指错了：${name} → ${metaPath}（${dir}）`);
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, unknown> }>;
        };
        const ud = meta.subMetas?.f9941?.userData;
        if (!ud) { failures.push(`${name} 缺 subMetas.f9941.userData`); continue; }
        const l = Number(ud.borderLeft ?? 0);
        const r = Number(ud.borderRight ?? 0);
        const t = Number(ud.borderTop ?? 0);
        const b = Number(ud.borderBottom ?? 0);
        const rawW = Number(ud.rawWidth ?? 0);
        const rawH = Number(ud.rawHeight ?? 0);
        if (l + r + t + b === 0) failures.push(`${name} 四边边框全 0 ⇒ 九宫格不生效（整张被拉伸）`);
        if (rawW - l - r <= 0) failures.push(`${name} 左右边框吃掉了整张图宽（${l}+${r} ≥ ${rawW}）`);
        if (rawH - t - b <= 0) failures.push(`${name} 上下边框吃掉了整张图高（${t}+${b} ≥ ${rawH}）`);
    }
    assert.deepEqual(failures, [], `九宫格配置不对：\n${failures.join('\n')}`);
});

test('B3 ⚠️ `chatSpriteType`：9 张给 1(SLICED)，其余给 0(SIMPLE)，未知名不抛', () => {
    assert.equal(CHAT_SPRITE_SIMPLE, 0);
    assert.equal(CHAT_SPRITE_SLICED, 1);
    for (const name of CHAT_ART_SLICED) assert.equal(chatSpriteType(name), 1, `${name} 必须是 SLICED`);
    for (const name of [CHAT_ART_MAIN_CHAT, 'ct_at_btn', 'ct_bq_btn', 'ct_close_02', 'ct_emoji_0', CHAT_HEAD_ART.frame]) {
        assert.equal(chatSpriteType(name), 0, `${name} 是原尺寸图，不该拉伸`);
    }
    assert.equal(chatSpriteType('不存在的图'), 0);
});

test('B4 `emojiRichSrc` 必须是**完整资源路径 + /spriteFrame**（裸名会让 RichText 静默不渲染）', () => {
    assert.equal(emojiRichSrc(0), 'image/chat/ct_emoji_0/spriteFrame');
    assert.equal(emojiRichSrc(43), 'image/chat/ct_emoji_43/spriteFrame');
    for (const i of [0, 7, 43]) {
        const src = emojiRichSrc(i);
        assert.ok(src.startsWith(`${CHAT_ART_ROOT}/`), '必须带目录，不能是裸图名');
        assert.ok(src.endsWith('/spriteFrame'), '必须带 /spriteFrame 后缀（否则静默留白）');
        assert.ok(!src.includes('resources/'), 'root 不带 `resources/` 前缀');
    }
    // 与 ChatTable.parseEmoji 的配合：srcOf 就是它
    assert.equal(parseEmoji('[:7]', emojiRichSrc), "<img src='image/chat/ct_emoji_7/spriteFrame'/>");
});

test('B5 复用的外模块图：目录 + 图名都在磁盘上（引错目录 = 白框 + 一条 warn）', () => {
    // [资源根（相对 `assets/resources/`）、图名]
    // ⚠️ 原写法两处错，产出的全是**假失败**：
    //    ① 送花按钮那行先拼上了 `assets/resources/`，循环里又加一次（双前缀）；
    //    ② 把「目录名 / 图名」当成路径直接喂给 `existsSync`（`existsSync('image/friend')`）。
    const SHARED: readonly (readonly [string, string])[] = [
        [CHAT_SHARED_HEAD_BOX_ROOT, CHAT_SHARED_HEAD_BOX_NAME],
        [CHAT_SHARED_POPUP_BG_ROOT, CHAT_SHARED_POPUP_BG_NAME],
        [CHAT_ART_DIRS[CHAT_SHARED_SEND_NAME], CHAT_SHARED_SEND_NAME],
        ['image/gameui', CHAT_HEAD_ART.frame],
        ['image/firstRecharge', 'title_brown'],
        ['image/login', '公用_按钮_关闭01'],
    ];
    const failures: string[] = [];
    for (const [root, name] of SHARED) {
        const rel = `${root}/${name}.png`;
        if (!existsSync(`assets/resources/${rel}`)) failures.push(`assets/resources/${rel} 不存在`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));
    // 送花按钮跨模块复用 `image/friend`（与头像框同目录）
    assert.equal(CHAT_ART_DIRS[CHAT_SHARED_SEND_NAME], CHAT_SHARED_HEAD_BOX_ROOT, '送花按钮的目录必须由 CHAT_ART_DIRS 给出');
});

test('B6 `chatTint`：灰度用 tint 近似（Cocos 无内置灰度滤镜，口径同 `FriendArt`）', () => {
    assert.deepEqual([...CHAT_TINT_NORMAL], [255, 255, 255]);
    assert.deepEqual([...CHAT_TINT_GRAY], [132, 132, 132]);
    assert.deepEqual([...chatTint(true)], [...CHAT_TINT_GRAY]);
    assert.deepEqual([...chatTint(false)], [...CHAT_TINT_NORMAL]);
});

test('B7 ⚠️ 主界面入口图标 = `ct_main_chat`，且 `ArenaRoot` 的 `ChatEntry/Btn` 引的正是它', () => {
    assert.equal(CHAT_ART_MAIN_CHAT, 'ct_main_chat');
    const meta = JSON.parse(readFileSync(`${ART_DIR}/ct_main_chat.png.meta`, 'utf8')) as { uuid: string };
    assert.ok(meta.uuid, 'ct_main_chat 必须有 uuid');
    assert.equal(chatSpriteType(CHAT_ART_MAIN_CHAT), 0, '入口图标不是九宫格');

    const mainRoot = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8')) as Record<string, unknown>[];
    const hits = mainRoot.filter((entry) => {
        const frame = (entry as { _spriteFrame?: { __uuid__?: string } })._spriteFrame;
        return !!frame?.__uuid__ && frame.__uuid__.replace('@f9941', '') === meta.uuid;
    });
    assert.equal(hits.length, 1, 'ArenaRoot 里应当**恰好一处**引用入口图标');
    assert.equal((hits[0] as { _type: number })._type, 0, '入口图标按原图渲染');
    assert.equal((hits[0] as { _sizeMode: number })._sizeMode, 0, '必须 CUSTOM（RAW 会被渲染组件回写尺寸）');
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

const PREFAB = 'assets/resources/ui/Chat/Chat.prefab';
const ALL = JSON.parse(readFileSync(PREFAB, 'utf8')) as Record<string, unknown>[];

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
    ChatPage: 'assets/script/app/chat/ChatPage.ts',
    ChatBubble: 'assets/script/app/chat/ChatBubble.ts',
    ChatPrivateBubble: 'assets/script/app/chat/ChatPrivateBubble.ts',
    ChatRecruitRow: 'assets/script/app/chat/ChatRecruitRow.ts',
    ChatPrivateHead: 'assets/script/app/chat/ChatPrivateHead.ts',
    ChatAtRow: 'assets/script/app/chat/ChatAtRow.ts',
    ChatEmojiItem: 'assets/script/app/chat/ChatEmojiItem.ts',
    FriendTabButton: 'assets/script/app/friend/FriendTabButton.ts',
    VScrollView: 'assets/script/vscrollview/VScrollView.ts',
};

function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

const CID_OF: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(SCRIPT_FILES).map(([name, path]) => [name, scriptCid(path)]),
);
const CID_TO_NAME: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(CID_OF).map(([name, cid]) => [cid, name]),
);

interface IGeomNode {
    readonly name: string;
    readonly path: string;
    readonly depth: number;
    readonly w: number;
    readonly h: number;
    readonly ax: number;
    readonly ay: number;
    /** 节点自身的**原始** `_lpos`（相对父节点锚点；代码 `setPosition` 覆盖的就是它）。 */
    readonly lpos: { readonly x: number; readonly y: number };
    readonly px: number;
    readonly py: number;
    readonly left: number;
    readonly top: number;
    readonly comps: readonly string[];
    readonly script: string | null;
    readonly rich: boolean;
}

/**
 * 反解回**画布像素**：`_lpos` 相对父节点锚点、逐级累积（每级按父自身 scale 放大），y 翻转；
 * 渲染尺寸 = `contentSize × 自身 scale × 祖先 scale`（= 该节点在画布上的真实覆盖）。
 */
function readGeom(): IGeomNode[] {
    const at = (ref: unknown) => ALL[(ref as { __id__?: number }).__id__!] as Record<string, unknown> | undefined;
    const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    const out: IGeomNode[] = [];

    const walk = (ni: number, parent: { x: number; y: number; s: number }, depth: number, path: string): void => {
        const raw = ALL[ni];
        const comps = ((raw._components ?? []) as unknown[]).map(at).filter((c): c is Record<string, unknown> => !!c);
        const types = comps.map((c) => String(c.__type__));
        const uit = comps.find((c) => c.__type__ === 'cc.UITransform');
        const lsca = raw._lscale as { x?: number } | undefined;
        const own = lsca ? num(lsca.x) : 1;
        const scale = parent.s * own;
        const w = num((uit?._contentSize as { width?: number } | undefined)?.width) * scale;
        const h = num((uit?._contentSize as { height?: number } | undefined)?.height) * scale;
        const pt = uit?._anchorPoint as { x?: number; y?: number } | undefined;
        // ⚠️ 不能写 `pt ? num(pt.x) : 0.5` 之外的形式 —— anchor 合法值 0 会被 `||` 判 falsy
        const ax = pt ? num(pt.x) : 0.5;
        const ay = pt ? num(pt.y) : 0.5;
        const lpos = raw._lpos as { x?: number; y?: number } | undefined;
        const name = String(raw._name);
        const px = depth === 0 ? 360 : parent.x + num(lpos?.x) * parent.s;
        const py = depth === 0 ? 640 : parent.y - num(lpos?.y) * parent.s;

        out.push({
            name, path, depth, w, h, ax, ay,
            lpos: { x: num(lpos?.x), y: num(lpos?.y) },
            px, py,
            left: px - ax * w,
            top: py - (1 - ay) * h,
            comps: types,
            script: types.find((t) => !t.startsWith('cc.')) ?? null,
            rich: types.includes('cc.RichText'),
        });
        for (const ref of (raw._children ?? []) as unknown[]) {
            const id = (ref as { __id__?: number }).__id__;
            if (typeof id === 'number') walk(id, { x: px, y: py, s: scale }, depth + 1, `${path}/${String(ALL[id]._name)}`);
        }
    };

    const root = at((ALL[0] as { data?: unknown }).data)!;
    walk((ALL[0] as { data: { __id__: number } }).data.__id__, { x: 0, y: 0, s: 1 }, 0, String(root._name));
    return out;
}

const GEOM = readGeom();
const BY_PATH = new Map(GEOM.map((node) => [node.path, node]));

test('C1 根节点 = 第一个 cc.Node 且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    assert.ok(existsSync(PREFAB));
    const firstNode = ALL.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.equal((ALL[0] as { data: { __id__: number } }).data.__id__, firstNode);
    const root = ALL[firstNode] as Record<string, unknown>;
    assert.equal(root._name, 'Chat');
    assert.equal(root._parent as unknown, null, '根节点没有父节点');
    assert.equal((root._children as unknown[]).length, 18, '根直下 18 个节点');
    // 规模：109 节点 / 543 组件（与编辑器 `prefab_browse validate` 的读数一致）
    assert.equal(GEOM.length, 109);
    assert.equal(ALL.filter((entry) => entry && entry.__type__ === 'cc.Node').length, 109);
});

test('C2 ⚠️ 所有节点的 `_layer` 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    const layers = new Set(GEOM.map((_, i) => (ALL.filter((e) => e && e.__type__ === 'cc.Node')[i] as { _layer: number })._layer));
    assert.deepEqual([...layers], [33554432], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('C3 ⚠️ 每个脚本组件的 `__type__` 都能从 `.ts.meta` 反解，且实例数与设计一致（防 MissingScript）', () => {
    const used = new Set(
        GEOM.map((n) => n.script).filter((cid): cid is string => !!cid),
    );
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须是 23 位：${cid}`);
        assert.ok(CID_TO_NAME[cid], `出现未知 cid（抄错 / 编辑器没编译）：${cid}`);
    }
    const counts = new Map<string, number>();
    for (const cid of used) {
        const name = CID_TO_NAME[cid];
        counts.set(name, GEOM.filter((n) => n.script === cid).length);
    }
    // 7 个列表各挂 1 个 VScrollView；8 个模板各 1 份（运行时克隆出 5 个页签 / N 行）
    assert.deepEqual(
        Object.fromEntries([...counts.entries()].sort()),
        {
            ChatAtRow: 1, ChatBubble: 1, ChatEmojiItem: 1, ChatPage: 1, ChatPrivateBubble: 1,
            ChatPrivateHead: 1, ChatRecruitRow: 1, FriendTabButton: 1, VScrollView: 7,
        },
    );
    // 页面脚本挂在根上
    assert.equal(BY_PATH.get('Chat')!.script, CID_OF.ChatPage);
});

/**
 * 画布像素期望表 —— 由 `tmp/gen_chat.mjs` 从 FGUI XML 反解（该生成器自带 109 条画布盒断言）。
 *
 * ⚠️ **不含** `RowView/…/Left|Right/Msg` 与 `PrivateList/…/Msg` 那 4 个 `cc.RichText`：
 *    编辑器会按实际文本重量它们的 `contentSize`（实测 328×32 → 0×27.72），盒尺寸不是稳定契约
 *    （位置已在 C5 单列断言）。
 */
const EXPECT_BOX: readonly (readonly [string, number, number, number, number])[] = [
    ['Chat', 0, 0, 720, 1280],
    // ---- 弹窗框（组件_公共弹窗_新 实例 626×882 @ (47,160)）----
    ['Chat/PanelBg', 47, 160, 626, 882],
    ['Chat/TitleBg', 188, 132, 344, 81],
    ['Chat/Title', 240, 149, 240, 42],
    ['Chat/CloseBtn', 611, 140, 60, 60],
    ['Chat/BottomBg', 71, 921, 577, 70],
    ['Chat/Empty', 298, 532, 124, 42],
    ['Chat/SilentLabel', 157, 927, 402, 51],
    ['Chat/PrivateBottomBg', 71, 918, 577, 70],
    ['Chat/Mask', 0, 0, 720, 1280],
    // ---- 消息列表（视口 540×692 @ (90,231)，条目 530×114）----
    ['Chat/RowView', 90, 231, 540, 692],
    ['Chat/RowView/content', 90, 231, 540, 692],
    ['Chat/RowView/content/RowTemplate', 95, 231, 530, 114],
    ['Chat/RowView/content/RowTemplate/Left', 95, 231, 530, 112],
    ['Chat/RowView/content/RowTemplate/Left/Head', 95, 239, 81, 81],
    ['Chat/RowView/content/RowTemplate/Left/Head/Icon', 102.36, 244.15, 66.27, 66.27],
    ['Chat/RowView/content/RowTemplate/Left/Bg', 182, 278, 373, 53],
    ['Chat/RowView/content/RowTemplate/Left/Name', 185, 239, 100, 34],
    ['Chat/RowView/content/RowTemplate/Right/Head', 542, 239, 81, 81],
    ['Chat/RowView/content/RowTemplate/Right/Head/Icon', 549.36, 244.15, 66.27, 66.27],
    // ---- 页签（TabBar 高 71→72；5×160 = 800 > 564 ⇒ 横向滚动）----
    ['Chat/TabBar', 69, 1016, 564, 72],
    ['Chat/TabBar/content', 69, 1016, 564, 72],
    ['Chat/TabBar/content/RowTemplate', 69, 1016, 160, 72],
    ['Chat/TabBar/content/RowTemplate/Label', 81, 1032, 136, 42],
    // ---- 招募列表（视口 564×736 @ (78,232)，条目 530×259）----
    ['Chat/ApplyList', 78, 232, 564, 736],
    ['Chat/ApplyList/content/RowTemplate', 95, 232, 530, 259],
    ['Chat/ApplyList/content/RowTemplate/Bg', 212, 263, 420, 229],
    ['Chat/ApplyList/content/RowTemplate/Head', 101, 275, 110, 110],
    ['Chat/ApplyList/content/RowTemplate/Name', 221, 236, 84, 29],
    ['Chat/ApplyList/content/RowTemplate/InfoGroup', 284, 276, 301, 161],
    ['Chat/ApplyList/content/RowTemplate/InfoGroup/Stage', 389, 276, 88, 39],
    ['Chat/ApplyList/content/RowTemplate/InfoGroup/JoinBtn', 473, 391, 112, 46],
    // ---- 私聊（视口 425×692 @ (208,232)）----
    ['Chat/PrivateList', 208, 232, 425, 692],
    ['Chat/PrivateList/content/RowTemplate/Left/Head', 209, 246, 81, 81],
    ['Chat/PrivateList/content/RowTemplate/Left/Bg', 295, 275, 320, 84],
    ['Chat/PrivateList/content/RowTemplate/Left/Name', 301, 240, 100, 34],
    ['Chat/PrivateList/content/RowTemplate/Right/Bg', 456, 275, 89, 54],
    // ---- 私聊联系人（视口 117×692 @ (84,232)）----
    ['Chat/HeadList', 84, 232, 117, 692],
    ['Chat/HeadList/content/RowTemplate', 84, 232, 117, 146],
    ['Chat/HeadList/content/RowTemplate/Bg', 85, 241, 107, 137],
    ['Chat/HeadList/content/RowTemplate/Head', 100, 255, 77, 77],
    ['Chat/HeadList/content/RowTemplate/Name', 96, 330, 84, 29],
    ['Chat/HeadList/content/RowTemplate/RemoveBtn', 154, 219, 30, 32],
    // ---- 输入条（FGUI `n75`/`n105` 组 547×70 @ (85,919)，子件坐标是**界面绝对坐标**）----
    ['Chat/InputBar', 85, 919, 547, 70],
    ['Chat/InputBar/InputBg', 85, 931, 312, 45],
    ['Chat/InputBar/Input', 88, 930, 307, 46],
    ['Chat/InputBar/EmojiBtn', 400, 925.5, 50, 50],
    ['Chat/InputBar/AtBtn', 457, 926.5, 50, 50],
    ['Chat/InputBar/SendBtn', 514, 919, 118, 70],
    ['Chat/PrivateInputBar', 85, 919, 547, 70],
    ['Chat/PrivateInputBar/InputBg', 85, 931, 312, 45],
    ['Chat/PrivateInputBar/Input', 88, 930, 307, 46],
    ['Chat/PrivateInputBar/EmojiBtn', 400, 925.5, 50, 50],
    ['Chat/PrivateInputBar/SendBtn', 514, 919, 118, 70],
    // ---- 表情弹窗（group 529×292 @ (95,621)）----
    ['Chat/EmojiPopup', 95, 621, 529, 292],
    ['Chat/EmojiPopup/EmojiBg', 95, 621, 529, 292],
    ['Chat/EmojiPopup/EmojiList', 120, 656, 480, 208],
    ['Chat/EmojiPopup/EmojiList/content', 120, 656, 480, 208],
    ['Chat/EmojiPopup/EmojiList/content/RowTemplate', 120, 656, 60, 61],
    // ---- 艾特弹窗（group 541×301 @ (89,619)，2 列）----
    ['Chat/AtPopup', 89, 619, 541, 301],
    ['Chat/AtPopup/AtBg', 89, 619, 541, 301],
    ['Chat/AtPopup/RoleList', 119, 648, 481, 223],
    ['Chat/AtPopup/RoleList/content', 119, 648, 481, 223],
    ['Chat/AtPopup/RoleList/content/RowTemplate', 119.5, 648, 240, 116],
    ['Chat/AtPopup/RoleList/content/RowTemplate/Bg', 119.5, 648, 229, 113],
    ['Chat/AtPopup/RoleList/content/RowTemplate/Head', 136.5, 664, 77, 77],
];

test('C4 ⚠️ 几何：每个节点反解回画布像素后必须等于 FGUI XML 原值（差分 0.5px）', () => {
    const failures: string[] = [];
    for (const [path, left, top, w, h] of EXPECT_BOX) {
        const node = BY_PATH.get(path);
        if (!node) { failures.push(`找不到节点 ${path}`); continue; }
        if (
            Math.abs(node.left - left) >= 0.5 || Math.abs(node.top - top) >= 0.5 ||
            Math.abs(node.w - w) >= 0.5 || Math.abs(node.h - h) >= 0.5
        ) {
            failures.push(`${path}：实测(${node.left.toFixed(2)}, ${node.top.toFixed(2)}) ${node.w.toFixed(2)}×${node.h.toFixed(2)}，期望(${left}, ${top}) ${w}×${h}`);
        }
    }
    assert.deepEqual(failures, [], `节点位置偏离 FGUI 原值：\n${failures.join('\n')}`);
});

test('C5 ⚠️ `group` 节点的子件**不能**被平移 group 自身的 `_lpos`（本轮修掉的真 bug）', () => {
    // FGUI `<group>` 只是逻辑分组：子元素坐标是**父组件坐标系**（= 界面绝对坐标）。
    // 生成器一度把「父框 + group 锚点比例」当子件 lpos 的原点 ⇒ 5 棵子树整体
    // 平移了 group 自己的 `_lpos`：输入条子件下沉 314px（直接掉出 720×1280 画布）、
    // 招募项「点击加入」右移 74.5px（被视口 Mask 裁掉）、两个弹窗子件各下移 127/129.5px。
    //
    // 本用例把「group 的子件落在 group 自己的锚点附近」钉死（**用局部 lpos 判，不吃画布换算**）：
    const cases: readonly (readonly [string, string, number, number])[] = [
        // [group 路径, 子件名, 期望 _lpos.x, 期望 _lpos.y]
        ['Chat/ApplyList/content/RowTemplate/InfoGroup', 'Stage', -1.5, 61],
        ['Chat/ApplyList/content/RowTemplate/InfoGroup', 'Declare', -136.5, 2],
        ['Chat/ApplyList/content/RowTemplate/InfoGroup', 'Power', -95.5, -56],
        ['Chat/ApplyList/content/RowTemplate/InfoGroup', 'JoinBtn', 94.5, -57.5],
        ['Chat/InputBar', 'InputBg', -117.5, 0.5],
        ['Chat/InputBar', 'Input', -117, 1],
        ['Chat/InputBar', 'EmojiBtn', 66.5, 3.5],
        ['Chat/InputBar', 'AtBtn', 123.5, 2.5],
        ['Chat/InputBar', 'SendBtn', 214.5, 0],
        ['Chat/EmojiPopup', 'EmojiBg', 0, 0],
        ['Chat/AtPopup', 'AtBg', 0, 0],
    ];
    const at = (ref: unknown) => ALL[(ref as { __id__?: number }).__id__!] as Record<string, unknown>;
    const failures: string[] = [];
    for (const [groupPath, childName, wantX, wantY] of cases) {
        const group = BY_PATH.get(groupPath);
        assert.ok(group, `找不到 group：${groupPath}`);
        const gi = ALL.findIndex((entry) => entry && entry.__type__ === 'cc.Node' && entry._name === group!.name && (entry._parent as unknown) !== null);
        const groupNode = ALL[gi];
        const childRef = ((groupNode._children ?? []) as unknown[]).find((ref) => String(at(ref)._name) === childName);
        assert.ok(childRef, `${groupPath} 下找不到子件 ${childName}`);
        const lpos = at(childRef)._lpos as { x: number; y: number };
        if (Math.abs(lpos.x - wantX) > 0.02 || Math.abs(lpos.y - wantY) > 0.02) {
            failures.push(`${groupPath}/${childName}：_lpos=(${lpos.x}, ${lpos.y})，期望(${wantX}, ${wantY})`);
        }
    }
    assert.deepEqual(failures, [], `group 子件被平移了：\n${failures.join('\n')}`);

    // 反证：把「父框 + group 锚点比例」当原点算出来的错值长这样（差的就是 group 的 `_lpos`）
    const infoGroup = BY_PATH.get('Chat/ApplyList/content/RowTemplate/InfoGroup')!;
    const stage = BY_PATH.get('Chat/ApplyList/content/RowTemplate/InfoGroup/Stage')!;
    assert.equal(infoGroup.left, 284);
    assert.equal(stage.left, 389, '关卡名必须落在 FGUI 的 294（+95）而不是 363.5');
    // 输入条：整条必须落在 720×1280 画布内（修前 y=1245、盒底 1290 出界）
    for (const bar of ['Chat/InputBar', 'Chat/PrivateInputBar']) {
        const node = BY_PATH.get(`${bar}/InputBg`)!;
        assert.ok(node.top > 900 && node.top + node.h < 1280, `${bar}/InputBg 落在画布内（top=${node.top}）`);
    }
});

test('C6 7 个虚拟列表：视口带 Mask + Graphics，content 锚点对，Widget 只在纵向列表上', () => {
    const LISTS = ['RowView', 'TabBar', 'ApplyList', 'PrivateList', 'HeadList', 'EmojiPopup/EmojiList', 'AtPopup/RoleList'];
    const HORIZONTAL = new Set(['TabBar']);
    for (const name of LISTS) {
        const path = `Chat/${name}`;
        const view = BY_PATH.get(path);
        const content = BY_PATH.get(`${path}/content`);
        assert.ok(view && content, `缺 ${path}/content`);
        assert.ok(view!.comps.includes('cc.Mask'), `${path} 视口必须带 cc.Mask（否则列表溢出到页面上）`);
        assert.ok(view!.comps.includes('cc.Graphics'), `${path} 视口带 Graphics（VScrollView 画滚动条）`);
        assert.equal(view!.script, CID_OF.VScrollView, `${path} 要挂 VScrollView`);

        if (HORIZONTAL.has(name)) {
            assert.equal(view!.ax, 0, `${path} 横向列表视口锚点 (0,0.5)`);
            assert.equal(view!.ay, 0.5);
            assert.equal(content!.ax, 0);
            assert.equal(content!.ay, 0.5);
            // ⚠️ 横向列表的 content **不能**带 Widget（会跟组件重算的宽度打架）
            assert.ok(!content!.comps.includes('cc.Widget'), `${path}/content 不该带 Widget`);
        } else {
            assert.equal(view!.ax, 0.5, `${path} 纵向列表视口锚点 (0.5,1)`);
            assert.equal(view!.ay, 1, 'VScrollView 硬要求视口 anchor=(0.5,1)');
            assert.equal(content!.ax, 0.5);
            assert.equal(content!.ay, 1, 'VScrollView 硬要求 content anchor=(0.5,1)');
            assert.ok(content!.comps.includes('cc.Widget'), `${path}/content 必须带 Widget(LEFT|RIGHT)`);
        }
        // 模板 = `content.children[0]`（`content: null` 时 VScrollView 按名字兜底取）
        assert.equal(BY_PATH.get(`${path}/content`)!.name, 'content');
    }

    // 行模板脚本逐一对上
    const TEMPLATE_SCRIPT: Readonly<Record<string, string>> = {
        'Chat/RowView': 'ChatBubble',
        'Chat/TabBar': 'FriendTabButton',
        'Chat/ApplyList': 'ChatRecruitRow',
        'Chat/PrivateList': 'ChatPrivateBubble',
        'Chat/HeadList': 'ChatPrivateHead',
        'Chat/EmojiPopup/EmojiList': 'ChatEmojiItem',
        'Chat/AtPopup/RoleList': 'ChatAtRow',
    };
    for (const [path, script] of Object.entries(TEMPLATE_SCRIPT)) {
        assert.equal(BY_PATH.get(`${path}/content/RowTemplate`)!.script, CID_OF[script], `${path} 的行模板脚本不对`);
    }
});

test('C7 根节点子序 = 渲染序：底板在前、Mask 与两个弹窗在最后', () => {
    const order = GEOM.filter((n) => n.depth === 1).map((n) => n.name);
    assert.deepEqual(order, [
        'PanelBg', 'TitleBg', 'Title', 'CloseBtn', 'BottomBg',
        'RowView', 'Empty', 'TabBar', 'ApplyList', 'PrivateList', 'HeadList', 'SilentLabel',
        'PrivateBottomBg', 'InputBar', 'PrivateInputBar', 'Mask', 'EmojiPopup', 'AtPopup',
    ]);
    // 底板必须先于内容；Mask 与两个弹窗必须最后（否则遮不住 / 被别的节点盖住）
    assert.ok(order.indexOf('PanelBg') < order.indexOf('RowView'), '底板必须先于列表');
    assert.deepEqual(order.slice(-3), ['Mask', 'EmojiPopup', 'AtPopup'], 'Mask 与两个弹窗必须在最后');
    // 输入条排在两个列表之后（列表是 `(0.5,1)` 锚点、不带 Widget，改成按钮会被裁掉）
    assert.ok(order.indexOf('RowView') < order.indexOf('InputBar'));
    assert.ok(order.indexOf('BottomBg') < order.indexOf('InputBar'), '底部黑底要先于输入条');
});

test('C8 ⚠️ 九宫格：`_type` 必须是 1(SLICED)，非九宫给 0，且 `_sizeMode` 恒为 0(CUSTOM)', () => {
    const slicedUuids = new Map<string, string>();
    for (const name of CHAT_ART_SLICED) {
        const meta = JSON.parse(readFileSync(`assets/resources/${CHAT_ART_DIRS[name]}/${name}.png.meta`, 'utf8')) as { uuid: string };
        slicedUuids.set(meta.uuid, name);
    }
    assert.equal(slicedUuids.size, 9, '9 张九宫格图的 png uuid 不能重复');

    const failures: string[] = [];
    let slicedUsed = 0;
    let simpleUsed = 0;
    ALL.forEach((entry, index) => {
        if (!entry || entry.__type__ !== 'cc.Sprite') return;
        const frame = entry._spriteFrame as { __uuid__?: string } | null;
        if (!frame?.__uuid__) return;
        const uuid = frame.__uuid__.replace('@f9941', '');
        const name = slicedUuids.get(uuid);
        if (name) {
            slicedUsed += 1;
            if (entry._type !== 1) failures.push(`objs[${index}] 用了九宫格图 ${name} 却没写 _type=1（整张会被拉伸，不报错）`);
        } else {
            simpleUsed += 1;
            if (entry._type !== 0) failures.push(`objs[${index}] 非九宫格图不该用 _type=${String(entry._type)}`);
        }
        if (entry._sizeMode !== 0) failures.push(`objs[${index}] _sizeMode 必须 CUSTOM(0)（RAW 会被渲染组件回写 contentSize）`);
    });
    assert.deepEqual(failures, [], failures.join('\n'));
    assert.ok(slicedUsed >= 9, `九宫格 Sprite 只找到 ${slicedUsed} 个`);
    assert.ok(simpleUsed >= 10, `普通 Sprite 只找到 ${simpleUsed} 个`);
});

test('C9 ⚠️ 4 个正文节点必须是 `cc.RichText`（表情与艾特靠它；Label 就渲染不出 `<img>`）', () => {
    const msgs = GEOM.filter((n) => n.name === 'Msg');
    assert.equal(msgs.length, 4, '两个气泡各左右一条 = 4');
    for (const node of msgs) {
        assert.ok(node.rich, `${node.path} 必须是 cc.RichText`);
        assert.ok(!node.comps.includes('cc.Label'), `${node.path} 不能同时挂 cc.Label（会抢渲染）`);
    }
    assert.deepEqual(
        msgs.map((n) => n.path).sort(),
        [
            'Chat/PrivateList/content/RowTemplate/Left/Msg',
            'Chat/PrivateList/content/RowTemplate/Right/Msg',
            'Chat/RowView/content/RowTemplate/Left/Msg',
            'Chat/RowView/content/RowTemplate/Right/Msg',
        ].sort(),
    );
    // 两个气泡脚本都要把 RichText 绑上（左/右各一）
    for (const [script, path] of [['ChatBubble', 'Chat/RowView/content/RowTemplate'], ['ChatPrivateBubble', 'Chat/PrivateList/content/RowTemplate']] as const) {
        assert.equal(BY_PATH.get(path)!.script, CID_OF[script]);
    }
});

test('C10 `ChatPage` 的 24 个 `@property` 全部解析（漏绑 = 运行时 `null` 崩）', () => {
    const EXPECT_PROPS: readonly string[] = [
        'closeButton',
        'tabList', 'rowList', 'applyList', 'privateList', 'headList', 'emojiList', 'roleList',
        'bottomBg', 'emptyLabel', 'silentLabel',
        'inputBar', 'inputBox', 'emojiButton', 'sendButton', 'atButton',
        'privateBottomBg', 'privateInputBar', 'privateInputBox', 'privateEmojiButton', 'privateSendButton',
        'maskButton', 'emojiPopup', 'atPopup',
    ];
    assert.equal(EXPECT_PROPS.length, 24);

    const page = ALL.find((entry) => entry && (entry.__type__ as string) === CID_OF.ChatPage) as Record<string, unknown>;
    assert.ok(page, '找不到 ChatPage 组件');
    const failures: string[] = [];
    for (const key of EXPECT_PROPS) {
        const value = page[key];
        if (value === undefined) { failures.push(`${key} 在 prefab 里不存在`); continue; }
        if (value === null) { failures.push(`${key} 是 null（@property 没绑）`); continue; }
        const id = (value as { __id__?: number }).__id__;
        if (typeof id !== 'number') { failures.push(`${key} 不是引用`); continue; }
        const target = ALL[id] as Record<string, unknown>;
        const type = String(target.__type__);
        // 合法的引用目标有两类：引擎类型（`cc.*`）与**脚本组件**（23 位压缩 cid）
        // ⚠️ 原判据只认 `cc.*` ⇒ 7 个列表字段（都指 `VScrollView` 组件）被误判成「非引擎对象」。
        const isEngine = type.startsWith('cc.');
        const isScript = Object.values(CID_OF).includes(type);
        if (!isEngine && !isScript) failures.push(`${key} 指到了非引擎对象（${type}）`);
    }
    assert.deepEqual(failures, [], failures.join('\n'));

    // 三类关键绑定的目标类型必须对
    const typeOf = (key: string) => String((ALL[(page[key] as { __id__: number }).__id__] as Record<string, unknown>).__type__);
    assert.equal(typeOf('emptyLabel'), 'cc.Label');
    assert.equal(typeOf('inputBox'), 'cc.EditBox');
    assert.equal(typeOf('privateInputBox'), 'cc.EditBox');
    assert.equal(typeOf('closeButton'), 'cc.Node');
    assert.equal(typeOf('emojiPopup'), 'cc.Node');
    // 7 个列表都指向带 VScrollView 的节点
    for (const key of ['tabList', 'rowList', 'applyList', 'privateList', 'headList', 'emojiList', 'roleList']) {
        assert.equal(typeOf(key), CID_OF.VScrollView, `${key} 必须指向 VScrollView 组件`);
    }
});

test('C11 两个输入框：EditBox 的两个子 Label 是左上锚点，位置 = 输入盒左上角（实测值，不是 (0,0)）', () => {
    for (const bar of ['InputBar', 'PrivateInputBar']) {
        const input = BY_PATH.get(`Chat/${bar}/Input`)!;
        assert.ok(input.comps.includes('cc.EditBox'), `Chat/${bar}/Input 必须挂 cc.EditBox`);
        for (const label of ['TextLabel', 'PlaceholderLabel']) {
            const node = BY_PATH.get(`Chat/${bar}/Input/${label}`)!;
            assert.ok(node, `缺 ${bar}/Input/${label}`);
            assert.equal(node.ax, 0, `${label} 是左上锚点`);
            assert.equal(node.ay, 1);
            // ⚠️ 实测**不是** (0,0)：锚点 (0,1) 的节点要落在**父节点左上角**，`_lpos` 就得写
            //    `(-w/2, +h/2)`（`Input` 是中心锚点、307×46）—— 这是 Cocos 的 `EditBox` 自己
            //    摆的（它接管两个子 Label 的锚点与位置）。期望值由 `Input` 自身尺寸推出来，
            //    手写常量改尺寸时会静默过期。
            assert.equal(node.lpos.x, -input.w / 2, `${label} 落在输入盒左边缘`);
            assert.equal(node.lpos.y, input.h / 2, `${label} 落在输入盒上边缘`);
        }
    }
    // 两个输入框的占位文案来自 `CHAT_TEXTS.inputPrompt`
    assert.equal(CHAT_TEXTS.inputPrompt, '点击输入聊天内容');
});

test('C12 `EmojiPopup` / `AtPopup` 默认隐藏（点开才显示；Mask 同理）', () => {
    for (const name of ['EmojiPopup', 'AtPopup', 'Mask', 'BottomBg', 'SilentLabel', 'PrivateBottomBg', 'InputBar', 'PrivateInputBar']) {
        const node = ALL.find((e) => e && e.__type__ === 'cc.Node' && e._name === name) as { _active: boolean };
        assert.equal(node._active, false, `${name} 必须默认隐藏`);
    }
    // 常显的几块
    for (const name of ['PanelBg', 'TabBar', 'RowView', 'Empty']) {
        const node = ALL.find((e) => e && e.__type__ === 'cc.Node' && e._name === name) as { _active: boolean };
        assert.equal(node._active, true, `${name} 应当默认显示`);
    }
});

test('C13 `recruitLayout(false)` 的 4 个点位 = prefab 里存的 `_lpos`（样式在 prefab、状态变的位置进表）', () => {
    const want = recruitLayout(false);
    const T = 'Chat/ApplyList/content/RowTemplate';
    const at = (name: string) => BY_PATH.get(`${T}/${name}`)!;
    // ⚠️ **直接比 `_lpos`**（= 代码 `setPosition` 覆盖的那个值，相对父节点锚点），
    //    不要用「子件画布矩形 − 模板画布矩形」反推：本文件实测反推给 8.5（那是
    //    `RowView/.../Left/Bg` 的值），原因是 `content` 的 anchor 是 `(0.5,1)`、
    //    模板盒的画布 left/top 与「父中心」不是同一个原点。`_lpos` 才是契约本身。
    assert.deepEqual(at('Bg').lpos, { x: want.background.x, y: want.background.y });
    assert.deepEqual(at('Head').lpos, { x: want.head.x, y: want.head.y });
    assert.deepEqual(at('Name').lpos, { x: want.name.x, y: want.name.y });
    assert.deepEqual(at('InfoGroup').lpos, { x: want.infoGroup.x, y: want.infoGroup.y });
    // 前提：模板是**中心锚点**，`_lpos` 才等于「相对父中心」
    const tpl = BY_PATH.get(T)!;
    assert.equal(tpl.ax, 0.5, '模板必须中心锚点，否则 `_lpos` 与表里口径不同');
    assert.equal(tpl.ay, 0.5);
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

const CHAT_DIR = 'assets/script/app/chat';
const REPO_SRC = readSource(`${CHAT_DIR}/ChatRepository.ts`);
const REPO_CODE = stripComments(REPO_SRC);
const PAGE_SRC = readSource(`${CHAT_DIR}/ChatPage.ts`);
const PAGE_CODE = stripComments(PAGE_SRC);
const ENTRY_SRC = readSource(`${CHAT_DIR}/ChatEntryButton.ts`);
const ENTRY_CODE = stripComments(ENTRY_SRC);
const MSG_SRC = readSource(`${CHAT_DIR}/RequestChatMsg.ts`);
const TABLE_SRC = readSource(`${CHAT_DIR}/ChatTable.ts`);
const ROUTE_SRC = readSource('assets/script/app/main/MainEntranceRoute.ts');
const LIST_SRC = readSource('assets/script/app/main/MainEntranceList.ts');
const OPEN_TABLE = 'assets/remoteRef/open.json';

test('D1 页面 `prefabPath` 大小写正确（真机区分大小写，写错就是黑屏）', () => {
    assert.ok(PAGE_CODE.includes(`static prefabPath = 'ui/Chat/Chat'`), "prefabPath 必须是 'ui/Chat/Chat'");
    assert.ok(existsSync('assets/resources/ui/Chat/Chat.prefab'), '磁盘上没有 assets/resources/ui/Chat/Chat.prefab');
    assert.ok(existsSync('assets/resources/ui/Chat/Chat.prefab.meta'), '缺 Chat.prefab.meta（不会被编辑器导入）');
});

test('D2 ⚠️ 三张缓存都走 `CacheMgr`（服务端会推），**不自己存快照**', () => {
    for (const getter of ['getTlCmdRole()', 'getTlCmdChatRole()', 'getTlCmdUnion()']) {
        assert.ok(REPO_CODE.includes(getter), `Repository 必须从缓存取 ${getter}`);
    }
    // 聊天**没有**配置表（全工程 `gameConfig` 里没有 chat* 键）⇒ 不许假装有
    assert.ok(!REPO_CODE.includes(`readRows(`), '聊天没有配置表，不该出现 readRows');
    // 拉到的消息进内存（老端 `ModelChat` 同理）
    assert.ok(/private\s+(readonly\s+)?messages|chatStore|Map<string/.test(REPO_CODE), '消息要存在内存里');
});

test('D3 ⚠️ 写请求必须 `withTimeout` + 离线早退 + `catch` 返 failed（否则服务端不回就永悬）', () => {
    assert.ok(REPO_CODE.includes('withTimeout('), '必须 withTimeout');
    assert.ok(REPO_CODE.includes('net.isConnected'), '离线要早退');
    assert.ok(REPO_CODE.includes(`return 'offline'`), '离线返回 offline（不是 failed，提示文案不同）');
    assert.ok(/catch\s*\(/.test(REPO_CODE), 'catch 不能省');
    const read = /const READ_TIMEOUT_MS = (\d+)/.exec(REPO_SRC);
    const write = /const WRITE_TIMEOUT_MS = (\d+)/.exec(REPO_SRC);
    assert.ok(read && write, '读 / 写超时常量必须都在');
    assert.equal(Number(read![1]), 800);
    assert.equal(Number(write![1]), 5000);
    // 给测试用的导出（避免测试里硬编码）
    assert.ok(REPO_SRC.includes('export const CHAT_READ_TIMEOUT_MS'));
    assert.ok(REPO_SRC.includes('export const CHAT_WRITE_TIMEOUT_MS'));
});

test('D4 ⚠️ 发请求前必须过 `toIdString`（`LongBits.from` 把普通对象当 zero ⇒ id 静默变 0）', () => {
    assert.ok(REPO_CODE.includes('toIdString('), '发之前必须过 toIdString');
    for (const cls of ['RequestChatInit(', 'RequestChatSend(', 'RequestChatDelTarget(']) {
        assert.ok(REPO_CODE.includes(`new ${cls}`), `缺 ${cls}`);
    }
    assert.ok(REPO_CODE.includes('new RequestTeamRecruitInit('), '招募列表走组队模块的 Init');
    // 招募只有 Init 能发 —— 加入那一步要 `CmdBattleRoleAttr`（Demo3.8 造不出来）
    assert.ok(!REPO_CODE.includes('RequestTeamRecruitJoin('), '加入队伍发不出包，不该出现');
    assert.ok(!REPO_CODE.includes('RequestTeamRecruitSend('), '发招募也带 attr，同样发不出');
});

test('D5 4 个协议类的 proto 名与 `Cmd.d.ts` 一致（改一个字母就是静默发不出去）', () => {
    const EXPECT_PROTO: Readonly<Record<string, string>> = {
        RequestChatInit: 'CmdChatInitReqMsg',
        RequestChatSend: 'CmdChatSendReqMsg',
        RequestChatDelTarget: 'CmdChatDelTargetReqMsg',
        RequestTeamRecruitInit: 'CmdTeamRecruitInitReqMsg',
    };
    for (const [cls, proto] of Object.entries(EXPECT_PROTO)) {
        assert.ok(MSG_SRC.includes(`export class ${cls} `), `缺请求类 ${cls}`);
        assert.ok(MSG_SRC.includes(`return '${proto}'`), `${cls} 的 proto 名必须是 '${proto}'`);
    }
    // 三个都登记了 Rsp（能不能发的唯一判据）
    for (const rsp of ['CmdChatInitRspMsg', 'CmdChatSendRspMsg', 'CmdChatDelTargetRspMsg']) {
        assert.ok(MSG_SRC.includes(rsp), `缺 Rsp 说明：${rsp}`);
    }
});

test('D6 ⚠️ 广播 `CmdChatBroMsg` 走 `addEvent`（服务端推的新消息），且退订要对上', () => {
    assert.ok(REPO_CODE.includes(`addEvent('CmdChatBroMsg'`), '广播必须监听 CmdChatBroMsg');
    // ⚠️ 退订方法名是 `GameNet.removeCallerEvent(caller)`（按 caller 对象解绑），
    //    不是 `removeEvent` / `off` —— 只认后三者会把「已经退订了」误判成泄漏。
    assert.ok(/removeCallerEvent\(|removeEvent\(|removeEventListener\(|off\(/.test(REPO_CODE), '必须能退订（否则页面重开会叠加）');
});

test('D7 ⚠️ 7 个 `renderItemFn` 都只绑**一次**（在 `onInit`，不在 `onOpen`）', () => {
    const NEEDLES = [
        'this.tabList.renderItemFn =',
        'this.rowList.renderItemFn =',
        'this.applyList.renderItemFn =',
        'this.privateList.renderItemFn =',
        'this.headList.renderItemFn =',
        'this.emojiList.renderItemFn =',
        'this.roleList.renderItemFn =',
    ];
    const initAt = PAGE_CODE.indexOf('onInit(');
    const openAt = PAGE_CODE.indexOf('onOpen(');
    assert.ok(initAt >= 0 && openAt > initAt, 'onInit/onOpen 顺序不对');
    for (const needle of NEEDLES) {
        const hits = PAGE_CODE.split(needle).length - 1;
        assert.equal(hits, 1, `${needle} 必须恰好赋值 1 次（放 onOpen 会随每次打开叠加）`);
        const bindAt = PAGE_CODE.indexOf(needle);
        assert.ok(bindAt > initAt && bindAt < openAt, `${needle} 必须在 onInit 里、onOpen 之前`);
    }
    // 回调按 index 现取，禁闭包捕获本趟入参
    for (const method of ['renderTabNode', 'renderMessageNode', 'renderRecruitNode', 'renderPrivateNode', 'renderHeadNode', 'renderEmojiNode', 'renderAtNode']) {
        assert.ok(PAGE_CODE.includes(`(node, index) => this.${method}(node, index)`), `${method} 的绑定必须按 index 现取`);
    }
});

test('D8 页面必须有 `revision` + `alive` 守卫（老页面在途回来的数据不许落地）', () => {
    assert.ok(PAGE_CODE.includes('this.revision += 1'), '必须有 revision 守卫');
    assert.ok(PAGE_CODE.includes('private get alive'), '必须有 alive 守卫');
    assert.ok(/revision !== this\.revision/.test(PAGE_CODE), '在途结果回来要核对 revision');
    assert.ok(PAGE_CODE.includes('nextPopupFrame()'), 'VirtualScrollView 的 start 更晚 ⇒ 铺列表前要等一帧');
});

test('D9 ⚠️ 美术走 `ChatArt` 唯一入口（裸图名 / 手拼路径漏 `/spriteFrame` 都是**静默留白**）', () => {
    assert.ok(PAGE_CODE.includes(`from './ChatArt'`), 'ChatPage 必须从 ChatArt 取图名');
    assert.ok(PAGE_CODE.includes('loadArt('), '用统一加载入口');
    // 全模块不许出现硬编码的 `image/` 路径（除 ChatArt 自己）
    for (const file of ['ChatPage', 'ChatBubble', 'ChatPrivateBubble', 'ChatRecruitRow', 'ChatPrivateHead', 'ChatAtRow', 'ChatEmojiItem', 'ChatRepository']) {
        const code = stripComments(readSource(`${CHAT_DIR}/${file}.ts`));
        assert.ok(!code.includes(`'image/`) && !code.includes(`"image/`), `${file} 里不该硬编码 image/ 路径`);
        assert.ok(!code.includes('resources.load('), `${file} 不该绕过唯一入口自己 load`);
    }
    // emoji 的 img src 必须带 `/spriteFrame`
    assert.ok(PAGE_CODE.includes('emojiRichSrc(') || PAGE_CODE.includes('emojiArtName('));
});

test('D10 ⚠️ 入口白名单**两处**都要登记（漏一处：入口不弹面板或弹了没内容）', () => {
    assert.ok(ROUTE_SRC.includes(`LayerChat: 'chat'`), 'MainEntranceRoute 缺 LayerChat');
    assert.ok(ROUTE_SRC.includes(`'chat'`), "EntrancePopupKey 联合类型要有 'chat'");
    assert.ok(LIST_SRC.includes('import { ChatPage }'), 'MainEntranceList 要 import ChatPage');
    assert.ok(LIST_SRC.includes('chat: ChatPage'), 'MainEntranceList.POPUP_CLASSES 缺 chat');
    // 与 open.json 对得上：refId=13 / url=LayerChat / **belond=0**
    const rows = JSON.parse(readFileSync(OPEN_TABLE, 'utf8')) as Array<Record<string, unknown>>;
    const found = rows.find((row) => Number(row.refId) === 13);
    assert.ok(found, 'open.json 里应当有 refId=13');
    assert.equal(found!.url, 'LayerChat');
    assert.equal(found!.name, '聊天');
    // ⚠️ `belond=0`（底部功能栏/其他）⇒ 聊天**不会**进 `MainEntranceList` 的左右列
    //    （那个列表只收 belond ∈ {2,3}）⇒ 入口按钮必须自己在 ArenaRoot 里落一个
    assert.equal(Number(found!.belond), 0, '聊天入口不在左右列');
    assert.ok(ROUTE_SRC.includes('belond'), '路由文件要说明 belond 口径');
});

test('D11 ⚠️ 主界面入口按钮：点开 `ChatPage`，红点占位但**本轮不接**', () => {
    assert.ok(ENTRY_CODE.includes('PopupManager'), '按钮要经弹窗管理器打开');
    assert.ok(ENTRY_CODE.includes('ChatPage'), '必须打开 ChatPage');
    assert.ok(/openAsync\s*\(/.test(ENTRY_CODE), '用 openAsync');
    assert.ok(ENTRY_CODE.includes('redDot'), '红点占位字段要在');
    assert.ok(ENTRY_CODE.includes('setRedDot('), '红点的唯一写入口要留好');
    // 红点在 prefab 里必须是隐藏的（本轮不接数据源）
    const redDot = ALL.find((e) => e && e.__type__ === 'cc.Node' && e._name === 'RedDot') as { _active: boolean } | undefined;
    assert.ok(!redDot, '红点占位只在 ArenaRoot 的 ChatEntry 里；Chat.prefab 里若也有同名节点说明重复落了一份');
    const main = JSON.parse(readFileSync('assets/resources/ui/main/ArenaRoot.prefab', 'utf8')) as Record<string, unknown>[];
    const mainRedDot = main.find((e) => e && e.__type__ === 'cc.Node' && e._name === 'RedDot') as { _active: boolean } | undefined;
    assert.ok(mainRedDot, 'ArenaRoot 里必须有 RedDot 占位节点');
    assert.equal(mainRedDot!._active, false, '红点本轮不接 ⇒ 必须保持隐藏');
    const chatEntry = main.find((e) => e && e.__type__ === 'cc.Node' && e._name === 'ChatEntry') as { _active: boolean } | undefined;
    assert.ok(chatEntry, 'ArenaRoot 里必须有 ChatEntry 节点（保留结构，脚本仍挂在上面）');
    // 🔴 2026-10-19：按蓝湖「塔防主界面-1」效果图，右下圆钮撤掉、聊天入口改成**底部聊天条**
    //    ⇒ `ChatEntry` 烘 `_active=false`（节点留着，`ChatEntryButton` 脚本还在，随时可复用）；
    //    可见性判据挪到 `BottomHud/ChatBar`。
    assert.equal(chatEntry!._active, false, '右下聊天圆钮已撤（效果图改底部聊天条）');
    const chatBar = main.find((e) => e && e.__type__ === 'cc.Node' && e._name === 'ChatBar') as { _active: boolean } | undefined;
    assert.ok(chatBar, 'ArenaRoot 里必须有底部聊天条 ChatBar（新的聊天入口）');
    assert.equal(chatBar!._active, true, '聊天入口（底部条）默认显示');
});

test('D12 判定与文案分层：`ChatTable` 零 import（保住「文案 / 美术 / 引擎」都不进判定层）', () => {
    const imports = [...TABLE_SRC.matchAll(/^import .*?from '(.+?)';/gm)].map((hit) => hit[1]);
    assert.deepEqual(imports, [], `ChatTable 必须零 import，实际：${imports.join(', ')}`);
    assert.ok(!TABLE_SRC.includes(`from './ChatTexts'`), 'ChatTable 不能引 ChatTexts');
    assert.ok(!TABLE_SRC.includes(`from './ChatArt'`), '判定不该知道美术');
});

// ============================================================
// E. 文案表
// ============================================================

test('E1 频道名 5 个，下标 = `ChatChannel` 数值；越界给空串', () => {
    assert.deepEqual([...CHAT_TITLE], ['招募', '战区', '世界', '私聊', '联盟']);
    assert.equal(CHAT_TITLE.length, 5);
    assert.equal(channelTitle(0), '招募');
    assert.equal(channelTitle(1), '战区');
    assert.equal(channelTitle(2), '世界');
    assert.equal(channelTitle(3), '私聊');
    assert.equal(channelTitle(4), '联盟');
    assert.equal(channelTitle(5), '', '越界给空串（不抛）');
    assert.equal(channelTitle(-1), '');
    // 下标必须与枚举一致
    for (const [name, value] of Object.entries(ChatChannel)) {
        if (typeof value === 'number') assert.equal(channelTitle(value), CHAT_TITLE[value]);
        void name;
    }
});

test('E2 文案表键齐全（页面只从这里取字）', () => {
    assert.equal(CHAT_TEXTS.title, '聊天');
    assert.equal(CHAT_TEXTS.inputPrompt, '点击输入聊天内容');
    assert.equal(CHAT_TEXTS.send, '发送');
    assert.equal(CHAT_TEXTS.empty, '暂无聊天');
    assert.equal(CHAT_TEXTS.recruitSilent, '该频道不可发言');
    assert.equal(CHAT_TEXTS.joinTeam, '点击加入');
    assert.equal(CHAT_TEXTS.powerTemplate, '战力：{0}');
    assert.equal(CHAT_TEXTS.sensitiveWord, '输入内容包含敏感词');
    assert.equal(CHAT_TEXTS.cannotJoinSelf, '不能加入自己的队伍');
    assert.equal(CHAT_TEXTS.cannotJoinInBattle, '战斗状态下不能加入队伍');
    assert.equal(CHAT_TEXTS.noPointAtMe, '该玩家不可查看');
    assert.equal(CHAT_TEXTS.emptyInput, '请输入内容');
    assert.equal(CHAT_TEXTS.sendOk, '发送成功');
    assert.equal(CHAT_TEXTS.offline, '当前未连接服务器');
    assert.equal(CHAT_TEXTS.requestFailed, '请求失败，请稍后重试');
    assert.equal(CHAT_TEXTS.deleteOk, '已删除');
});

test('E3 ⚠️ 三处「如实说明、不假装做到」的文案必须在（老端靠 SDK / 战前属性 / 玩家资料界面）', () => {
    assert.ok(CHAT_TEXTS.sensitiveCheckUnavailable.includes('Demo3.8'), '敏感词校验未接入要如实说明');
    assert.ok(CHAT_TEXTS.joinUnavailable.includes('战前属性'), '加入队伍发不出包要如实说明');
    assert.ok(CHAT_TEXTS.playerInfoUnavailable.includes('尚未接入'), '玩家资料界面未接入要如实说明');
    // 这三句不能是「成功」语气
    assert.ok(!CHAT_TEXTS.joinUnavailable.includes('成功'));
});

test('E4 `formatText`：**全局**替换、缺参补空串', () => {
    assert.equal(formatText('战力：{0}', 1234), '战力：1234');
    assert.equal(formatText('{0}/{1}', 1, 2), '1/2');
    // 同一个占位出现两次必须都换（礼包轮的 `totalRowTitle` 踩过）
    assert.equal(formatText('{0}+{0}', 7), '7+7');
    assert.equal(formatText('没有占位'), '没有占位');
    assert.equal(formatText('{0}{1}', 1), '1', '缺参补空串（与 Friend 的「保留原样」不同，这里更干净）');
    assert.equal(formatText(CHAT_TEXTS.powerTemplate, 0), '战力：0');
});
