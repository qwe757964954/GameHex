/**
 * 邮件（老端 `LayerMail` / `LayerMailVerbose` / `ModelMail` / FGUI 包「邮件」）移植的回归网。
 *
 * 分五段：
 *
 *   A. **判定口径**（`MailTable`，零 `cc` 依赖的纯函数）—— 老端这些判定散在 `ModelMail` +
 *      `LayerMail` + `LayerMailVerbose` + `TimeUtil` 里（依赖 DI 容器 / FGUI 控制器 / 网络），
 *      没法单测；移植时收敛成传参纯函数，本段是它们唯一的回归网。含三处最容易静默失效的：
 *        ① **排序** `up = !take || !read`（有未领或未读的置顶，同组按 `sendTime` 降序）；
 *        ② **一键领取收 `!take` / 一键删除收 `read && take`**（两者互不包含，别想当然合并）；
 *        ③ **行的三态** `take ? 2 : read ? 1 : 0` 与「文本只给已读、印章只给已领取」两套显隐。
 *   B. **美术口径**（`MailArt` + `.png.meta` + 新增 6 张的全额校验）—— 九宫边框只存在 SpriteFrame
 *      资源上、`.prefab` 表达不了，漏配就是「整张被拉伸」且**不报错**。
 *   C. **prefab 结构 + 几何**（两个 prefab）—— 脚本组件 `__type__` 必须能从 `*.ts.meta` 反解
 *      （防 cid 抄错成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的画布像素一致（0.5px）。
 *      ⚠️ 本模块**不加整体偏移**（原稿 `popBg xy=13,128` 就是画布坐标，不是 706×1202 居中）。
 *   D. **数据管道接线**（源码文本）—— 4 个协议名 + `MessageId` 登记、`withTimeout` / 离线早退、
 *      **不走 `GameCache`**、`renderItemFn` 只绑一次、`onOpen` 里 `nextPopupFrame`、入口白名单两处。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/邮件/组件/**` +
 *           `共用组件/组件/弹窗/组件_公共弹窗_新.xml`
 *   - 老端：`client/assets/script/app/game/ctrl/main/Xiulian/LayerMail*.ts` +
 *           `.../model/mail/ModelMail.ts` + `.../utils/TimeUtil.ts`
 *   - 配置：新项目 `assets/remoteRef/gameConfig.json`（`maxMailNum=50` / `mailValid=40`）
 *           + `open.json`（refId=301）+ `item.json` / `roleProperty.json`（奖励图标两支）
 *
 * ⚠️ 四处**刻意与老端不同**（理由见 `MailDetailPage.ts` 文件头），本文件当契约钉住：
 *      ① 长文本不做滚动列表（统一走多行 Label）；
 *      ② 正文框固定 400、无奖励拉到 580（原稿靠 `gearSize` 切）；
 *      ③ 正文不带富文本样式（原稿是 `richtext ubb`）；
 *      ④ 奖励列表不做横向滚动（原稿 `overflow="scroll"`）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    MAIL_QUALITY_FRAME_ROOT,
    MAIL_ART_NAMES,
    MAIL_ART_ROOT,
    MAIL_ROW_BG_READ_NAME,
    MAIL_ROW_BG_UNREAD_NAME,
    mailArtPath,
    mailRowArt,
    mailStampVisible,
    mailStateTextVisible,
} from '../assets/script/app/mail/MailArt';
import {
    MAIL_CONTENT_HEIGHT_NO_REWARD,
    MAIL_CONTENT_HEIGHT_WITH_REWARD,
    MAIL_MAX_NUM_DEFAULT,
    MAIL_REWARD_LIST_HEIGHT,
    MAIL_REWARD_LIST_WIDTH,
    MAIL_REWARD_SLOT_COUNT,
    MAIL_REWARD_SLOT_GAP,
    MAIL_REWARD_SLOT_SIZE,
    MAIL_STATE_READ,
    MAIL_STATE_TAKEN,
    MAIL_STATE_UNREAD,
    MAIL_VALID_DAYS_DEFAULT,
    autoDeleteArgs,
    buildMailRowView,
    detailButtonText,
    isLongText,
    mailRewardsOf,
    mailRewardsOfArray,
    mailStateOf,
    mailTimeText,
    nextDayStart,
    dayStart,
    normalizeMailDetail,
    normalizeMailRow,
    normalizeMailRows,
    parseMailConfig,
    pickDeletableIds,
    pickTakeIds,
    plainMailContent,
    sortMails,
    splitMailLines,
} from '../assets/script/app/mail/MailTable';
import {
    MAIL_AUTO_DELETE_TEMPLATE,
    MAIL_BTN_DELETE,
    MAIL_BTN_DELETE_ONE_KEY,
    MAIL_BTN_TAKE,
    MAIL_BTN_TAKE_ONE_KEY,
    MAIL_DELETE_CONFIRM,
    MAIL_DETAIL_TITLE,
    MAIL_EMPTY,
    MAIL_STATE_READ as MAIL_STATE_READ_TEXT,
    MAIL_STATE_TAKEN as MAIL_STATE_TAKEN_TEXT,
    MAIL_TIME_DAYS,
    MAIL_TIME_HOURS,
    MAIL_TIME_JUST_NOW,
    MAIL_TIME_MINUTES,
    MAIL_TITLE,
    formatText,
} from '../assets/script/app/mail/MailTexts';

const MAIL_DIR = 'assets/resources/ui/Mail';
const PREFAB_MAIN = `${MAIL_DIR}/Mail.prefab`;
const PREFAB_DETAIL = `${MAIL_DIR}/MailDetail.prefab`;
/** 槽位组件的 cid（`MailRewardSlot.ts.meta` 的 uuid 压缩形；C3 会逐个反解核一遍）。 */
const SLOT_CID = 'b0e99pgWGhJdaYFY7VNPNqA';
/** `VirtualScrollView` 的 cid（同上）。 */
const LIST_CID = '544earF5qRLB4JTuTnSr11+';

/**
 * 行视图的文案模板 —— **真源是 `MailTexts`**。
 * `MailTable` 不 import `MailTexts`（D14），四档模板由页面传参 ⇒ 这里用真常量喂进去，
 * `mailTimeText` 一旦和文案表分叉（各写一套），A10 / E4 立刻红。
 */
const ROW_TEXTS = {
    readText: MAIL_STATE_READ_TEXT,
    timeDays: MAIL_TIME_DAYS,
    timeHours: MAIL_TIME_HOURS,
    timeMinutes: MAIL_TIME_MINUTES,
    timeJustNow: MAIL_TIME_JUST_NOW,
};

// ============================================================
// 夹具
// ============================================================

const row = (over: Partial<{ id: string; read: boolean; take: boolean; sendTime: number; title: string }> = {}) => ({
    id: '1',
    read: false,
    take: false,
    sendTime: 0,
    title: '',
    ...over,
});

/** 反向断言前先剥注释（规则 104：注释里会写反例）。 */
function stripSourceComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** 读 prefab 的扁平数组，给节点补 `__id__`。 */
function loadPrefab(file: string) {
    const objs = JSON.parse(readFileSync(file, 'utf8')) as any[];
    objs.forEach((o, i) => { if (o && o.__type__ === 'cc.Node') o.__id__ = i; });
    const byId = (id: number) => (id == null ? null : objs[id]);
    const root = objs.find((o) => o && o.__type__ === 'cc.Node' && o._parent == null);
    const comp = (node: any, type: string) => node == null ? null : (node._components ?? [])
        .map((c: any) => byId(c.__id__))
        .find((c: any) => c && c.__type__ === type) ?? null;
    const pick = (path: string) => {
        let cur: any = root;
        for (const seg of path.split('/')) {
            cur = (cur?._children ?? []).map((c: any) => byId(c.__id__)).find((c: any) => c && c._name === seg);
            if (!cur) return null;
        }
        return cur;
    };
    return { objs, root, byId, comp, pick };
}

/** 反解画布包围盒：只信 `contentSize + anchorPoint`（禁 `getBoundingBoxToWorld`，会并上子节点）。 */
function canvasBox(P: ReturnType<typeof loadPrefab>, path: string) {
    const node = P.pick(path);
    assert.ok(node, `${path} 不存在`);
    const ut = P.comp(node, 'cc.UITransform');
    let dx = 0, dy = 0, cur: any = node;
    while (cur && cur !== P.root && cur._parent != null) {
        dx += cur._lpos.x;
        dy += cur._lpos.y;
        cur = P.byId(cur._parent.__id__);
    }
    const w = ut ? ut._contentSize.width : 0;
    const h = ut ? ut._contentSize.height : 0;
    const a = ut ? ut._anchorPoint : { x: 0.5, y: 0.5 };
    const ax = 360 + dx;
    const ay = 640 - dy;
    return { cx: ax, cy: ay, left: ax - a.x * w, top: ay - (1 - a.y) * h, w, h, ax: a.x, ay: a.y };
}

/** 画布坐标断言（容差 0.5px）。 */
function assertCanvas(P: ReturnType<typeof loadPrefab>, path: string, want: Record<string, number>) {
    const b = canvasBox(P, path) as unknown as Record<string, number>;
    for (const [key, value] of Object.entries(want)) {
        assert.ok(Math.abs(b[key] - value) <= 0.5, `${path}.${key} = ${b[key]}，应为 ${value}`);
    }
}

/** `*.ts.meta` 的 uuid 集合（cid 反解用）。 */
function classIdsOfTagged(...files: string[]): Set<string> {
    const out = new Set<string>();
    for (const file of files) {
        const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8')) as { uuid: string; subMetas?: Record<string, { uuid: string }> };
        out.add(meta.uuid);
        for (const sub of Object.values(meta.subMetas ?? {})) out.add(sub.uuid);
    }
    return out;
}

/** 直接从 PNG 的 IHDR 读宽高（不依赖任何图像库）—— 核对 `.png.meta` 记的尺寸没配错图。 */
function pngSize(file: string): { w: number; h: number } {
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(12), 0x49484452, `${file} 不是 PNG（缺 IHDR）`);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ============================================================
// A. 判定口径（MailTable）
// ============================================================

test('A1 `mailStateOf`：take 优先于 read（三态 = 0 未读 / 1 已读 / 2 已领取）', () => {
    assert.equal(mailStateOf({ read: false, take: false }), MAIL_STATE_UNREAD);
    assert.equal(mailStateOf({ read: true, take: false }), MAIL_STATE_READ);
    assert.equal(mailStateOf({ read: false, take: true }), MAIL_STATE_TAKEN);
    // ⚠️ 已领取但 read=false（服务端没回写已读）仍算已领取 —— 顺序不能反
    assert.equal(mailStateOf({ read: true, take: true }), MAIL_STATE_TAKEN);
});

test('A2 ⚠️ `sortMails`：`up = !take || !read` 置顶，同组按 `sendTime` 降序（逐字对 ModelMail）', () => {
    const rows = [
        row({ id: 'done-old', read: true, take: true, sendTime: 100 }),
        row({ id: 'unread-new', read: false, take: false, sendTime: 300 }),
        row({ id: 'done-new', read: true, take: true, sendTime: 200 }),
        row({ id: 'read-no-take', read: true, take: false, sendTime: 50 }),
    ];
    assert.deepEqual(sortMails(rows).map((r) => r.id), ['unread-new', 'read-no-take', 'done-new', 'done-old']);
});

test('A3 `sortMails` 不改入参（`Array.from` 复制，禁 `[...x]`）', () => {
    const rows = [row({ id: '1', sendTime: 1 }), row({ id: '2', sendTime: 9 })];
    const before = rows.map((r) => r.id);
    sortMails(rows);
    assert.deepEqual(rows.map((r) => r.id), before);
});

test('A4 ⚠️ `pickTakeIds` 收 `!take`、`pickDeletableIds` 收「已读且已领」（两个集合不重叠、不互补）', () => {
    const rows = [
        row({ id: 'a', read: false, take: false }),   // 领取 ✓ / 删除 ✗
        row({ id: 'b', read: true, take: false }),    // 领取 ✓ / 删除 ✗
        row({ id: 'c', read: true, take: true }),     // 领取 ✗ / 删除 ✓
        row({ id: 'd', read: false, take: true }),    // 领取 ✗ / 删除 ✗（已领但没读）
    ];
    assert.deepEqual(pickTakeIds(rows), ['a', 'b']);
    assert.deepEqual(pickDeletableIds(rows), ['c']);
    // 「已领但没读」不进任何一支 —— 老端 `read + take == 0` 也收不到它
    assert.equal(pickTakeIds(rows).includes('d'), false);
    assert.equal(pickDeletableIds(rows).includes('d'), false);
});

test('A5 空列表 / 全已读已领 ⇒ 删除集合为空（调用方据此给提示、不发请求）', () => {
    assert.deepEqual(pickDeletableIds([]), []);
    assert.deepEqual(pickTakeIds([]), []);
    assert.deepEqual(pickDeletableIds([row({ id: 'x', read: true, take: true })]), ['x']);
});

test('A6 ⚠️ `normalizeMailRow`：`read` / `take` 是 boolean —— 不能用 `toIdString`（`toIdString(true) === ""`）', () => {
    const parsed = normalizeMailRow({ id: '7', read: true, take: false, sendTime: '60', title: 't' });
    assert.ok(parsed);
    assert.equal(parsed!.read, true);
    assert.equal(parsed!.take, false);
    assert.equal(parsed!.sendTime, 60000, 'sendTime 是秒 ⇒ 必须 ×1000');
    // 非 true 一律按 false（`1` / `'1'` / 缺失都不能变成 true）
    assert.equal(normalizeMailRow({ id: '1', read: 1, take: '1' })!.read, false);
    assert.equal(normalizeMailRow({ id: '1', read: 1, take: '1' })!.take, false);
});

test('A7 `normalizeMailRow`：id 认不出 ⇒ null（不抛）；`Long` 形状归一化成十进制字符串', () => {
    assert.equal(normalizeMailRow(null), null);
    assert.equal(normalizeMailRow(undefined), null);
    assert.equal(normalizeMailRow({}), null);
    assert.equal(normalizeMailRow({ id: '' }), null);
    // Long 形状（protobufjs 的 Long 有 low/high/unsigned）
    const long = normalizeMailRow({ id: { low: 42, high: 0, unsigned: false } });
    assert.equal(long?.id, '42');
});

test('A8 `normalizeMailRows`：丢 null、丢重复 id、非数组给空数组（不抛）', () => {
    assert.deepEqual(normalizeMailRows(null), []);
    assert.deepEqual(normalizeMailRows(undefined as unknown as []), []);
    assert.deepEqual(normalizeMailRows('nope' as unknown as []), []);
    const rows = normalizeMailRows([{ id: '1' }, null, { id: '1' }, { id: '2' }, 'x']);
    assert.deepEqual(rows.map((r) => r.id), ['1', '2']);
});

test('A9 ⚠️ `nextDayStart` 是「次日 **0 点**」—— 老端函数名叫 `getNextDay12` 但实现是 0 点', () => {
    const t = new Date(2026, 8, 23, 15, 30, 45, 0).getTime();
    const next = new Date(nextDayStart(t));
    assert.equal(next.getFullYear(), 2026);
    assert.equal(next.getMonth(), 8);
    assert.equal(next.getDate(), 24);
    assert.equal(next.getHours(), 0);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getSeconds(), 0);
    assert.equal(dayStart(t), new Date(2026, 8, 23).getTime());
});

test('A10 `mailTimeText` 四档 + 「跨过次日后按天算」的基准切换（老端 TimeUtil）', () => {
    const now = new Date(2026, 8, 23, 10, 0, 0, 0).getTime();
    // 刚刚（< 1 分钟）
    assert.equal(mailTimeText(now - 30 * 1000, now, ROW_TEXTS), '刚刚');
    // 分钟档
    assert.equal(mailTimeText(now - 5 * 60 * 1000, now, ROW_TEXTS), '5分钟前');
    // 小时档（同一天，未跨日）
    assert.equal(mailTimeText(new Date(2026, 8, 23, 8, 0, 0, 0).getTime(), now, ROW_TEXTS), '2小时前');
    // 跨日 ⇒ 基准切到「发送当天 0 点」⇒ 天数
    assert.equal(mailTimeText(new Date(2026, 8, 22, 9, 0, 0, 0).getTime(), now, ROW_TEXTS), '1天前');
    // ⚠️ 昨天 23:00 的邮件，今天 00:10 看到 → 也是「1天前」（不是「10分钟前」）
    assert.equal(
        mailTimeText(new Date(2026, 8, 22, 23, 0, 0, 0).getTime(), new Date(2026, 8, 23, 0, 10, 0, 0).getTime(), ROW_TEXTS),
        '1天前',
    );
    // ⚠️ 天数是 `floor(总小时数 / 24)`（老端 `timeSec2HMS.h = floor(time/3600)` 是**总**小时）
    //    ⇒ 09-20 12:00 在 09-23 10:00 看到 = 82 小时 = **3** 天，不是「2天前」。
    assert.equal(mailTimeText(new Date(2026, 8, 20, 12, 0, 0, 0).getTime(), now, ROW_TEXTS), '3天前');
    // 非法入参给空串（不把 `NaN天前` 写到 Label 上）
    assert.equal(mailTimeText(0, now, ROW_TEXTS), '');
    assert.equal(mailTimeText(now - 1000, 0, ROW_TEXTS), '');
});

test('A11 `parseMailConfig` + `autoDeleteArgs`：`gameConfig` 两个键，缺项取兜底 50 / 40', () => {
    assert.deepEqual(parseMailConfig([{ key: 'maxMailNum', value: 50 }, { key: 'mailValid', value: 40 }]),
        { maxNum: 50, validDays: 40 });
    assert.deepEqual(parseMailConfig([]), { maxNum: MAIL_MAX_NUM_DEFAULT, validDays: MAIL_VALID_DAYS_DEFAULT });
    assert.deepEqual(autoDeleteArgs({ maxNum: 50, validDays: 40 }), [40, 50]);
});

test('A12 ⚠️ `gameConfig` 现值就是 50 / 40 —— 与 FGUI 文案「超过40天…总数超出50」对上', () => {
    const rows = JSON.parse(readFileSync('assets/remoteRef/gameConfig.json', 'utf8')) as { key: string; value: unknown }[];
    const config = parseMailConfig(rows);
    assert.equal(config.validDays, 40);
    assert.equal(config.maxNum, 50);
    assert.equal(formatText(MAIL_AUTO_DELETE_TEMPLATE, ...autoDeleteArgs(config)),
        '超过40天未领取或未领取总数超出50的将会自动删除');
});

test('A13 `plainMailContent` / `splitMailLines`：`<br/>` 是换行（普通 Label 不认，必须换掉）', () => {
    assert.equal(plainMailContent('a<br/>b'), 'a\nb');
    assert.equal(plainMailContent('<br/>a<br/><br/>b'), '\na\n\nb');
    assert.deepEqual(splitMailLines('a<br/>b'), ['a', 'b']);
    assert.equal(plainMailContent(undefined as unknown as string), '');
    assert.equal(isLongText('一二三'), false);
    assert.equal(isLongText('一二三<br/>四'), true);
});

test('A14 `mailRewardsOf`：`CmdGoodsList.tlCmdGoods`；`number` 是字符串的 Long', () => {
    const list = { tlCmdGoods: [{ resId: 10001, number: '3', quality: 3 }, { resId: 7, number: '100' }] };
    const out = mailRewardsOf(list);
    assert.equal(out.length, 2);
    assert.deepEqual({ resId: out[0].resId, number: out[0].number, quality: out[0].quality }, { resId: 10001, number: 3, quality: 3 });
    assert.equal(out[1].number, 100);
    // 空 / 坏形状都返 []，不抛
    assert.deepEqual(mailRewardsOf(null), []);
    assert.deepEqual(mailRewardsOf({}), []);
    assert.deepEqual(mailRewardsOf({ tlCmdGoods: 'x' }), []);
});

test('A15 `mailRewardsOfArray`：裸 `CmdGoods[]`（`CmdMailTakeRewardRspMsg.tlReward`）', () => {
    const out = mailRewardsOfArray([{ resId: 1, number: '2' }, null, { resId: 2, number: '1' }]);
    assert.deepEqual(out.map((r) => r.resId), [1, 2]);
    assert.deepEqual(mailRewardsOfArray(null), []);
});

test('A16 ⚠️ `normalizeMailDetail`：`id` 归一化 + 奖励来自 `cmdGoodsList`（不是 `tlReward`）', () => {
    const detail = normalizeMailDetail({
        id: '9', title: '开服体力补偿', content: 'a<br/>b', read: true, take: false,
        sendTime: 60, cmdGoodsList: { tlCmdGoods: [{ resId: 10001, number: '1' }] },
    });
    assert.ok(detail);
    assert.equal(detail!.id, '9');
    assert.equal(detail!.sendTime, 60000);
    assert.equal(detail!.rewards.length, 1);
    // 没有奖励的邮件：`cmdGoodsList` 缺省 ⇒ 空数组（决定正文框高度与底框显隐）
    const plain = normalizeMailDetail({ id: '1', title: 't', content: 'c' });
    assert.deepEqual(plain!.rewards, []);
    assert.equal(normalizeMailDetail(null), null);
    assert.equal(normalizeMailDetail({ title: 'no id' }), null);
});

test('A17 `detailButtonText`：没领 ⇒ 领取；已领 ⇒ 删除（FGUI `gearText controller="是否领取"`）', () => {
    assert.equal(detailButtonText(false, MAIL_BTN_TAKE, MAIL_BTN_DELETE), MAIL_BTN_TAKE);
    assert.equal(detailButtonText(true, MAIL_BTN_TAKE, MAIL_BTN_DELETE), MAIL_BTN_DELETE);
});

test('A18 `buildMailRowView`：标题 / 时间 / 状态一起给出（三态两处显隐都对）', () => {
    const now = new Date(2026, 8, 23, 10, 0, 0, 0).getTime();
    const unread = buildMailRowView(row({ id: '1', title: 'T', sendTime: now - 30_000 }), ROW_TEXTS, now);
    assert.equal(unread.id, '1');
    assert.equal(unread.title, 'T');
    assert.equal(unread.timeText, MAIL_TIME_JUST_NOW);
    assert.equal(unread.state, MAIL_STATE_UNREAD);
    assert.equal(unread.stateText, '', '未读：不给状态文本');
    assert.equal(mailStateTextVisible(unread.state), false);
    assert.equal(mailStampVisible(unread.state), false);

    const read = buildMailRowView(row({ id: '2', read: true, sendTime: now - 30_000 }), ROW_TEXTS, now);
    assert.equal(read.state, MAIL_STATE_READ);
    assert.equal(read.stateText, MAIL_STATE_READ_TEXT);
    assert.equal(mailStateTextVisible(read.state), true);
    assert.equal(mailStampVisible(read.state), false);

    const taken = buildMailRowView(row({ id: '3', read: true, take: true, sendTime: now - 30_000 }), ROW_TEXTS, now);
    assert.equal(taken.state, MAIL_STATE_TAKEN);
    assert.equal(taken.stateText, '', '已领取：文本**不**显示（由印章表达）');
    assert.equal(mailStateTextVisible(taken.state), false);
    assert.equal(mailStampVisible(taken.state), true);
});

test('A19 `buildMailRowView` 的标题缺省给空串（不把 undefined 写进 Label）', () => {
    const now = Date.now();
    const view = buildMailRowView(row({ id: '1', title: undefined as unknown as string }), ROW_TEXTS, now);
    assert.equal(typeof view.title, 'string');
    assert.equal(view.title, '');
});

test('A20 奖励列表的四个几何口径值（容器 515×100 / 一格 90 / colGap 10）', () => {
    assert.equal(MAIL_REWARD_SLOT_SIZE, 90);
    assert.equal(MAIL_REWARD_SLOT_GAP, 10);
    assert.equal(MAIL_REWARD_LIST_WIDTH, 515);
    assert.equal(MAIL_REWARD_LIST_HEIGHT, 100);
});

test('A21 ⚠️ 居中的**唯一真源**是 `VirtualScrollView.autoCenter` —— 宿主不许再算一遍（两套口径会一起推歪）', () => {
    // FGUI `GList.handleAlign` 的 `(viewWidth − contentWidth)/2`（**只在装得下时**生效）
    // 2026-09-29 从宿主搬进组件：`RewardList.autoCenter`。宿主旧的 `mailRewardRowOffsetX`
    // 逐格写坐标已经删掉 —— 留一份就是两套口径，两边同时生效会把整行推歪（且不报错）。
    const page = stripSourceComments(readFileSync('assets/script/app/mail/MailDetailPage.ts', 'utf8'));
    assert.doesNotMatch(page, /mailRewardRowOffsetX/, '宿主不该再引用已删除的偏移函数');
    assert.doesNotMatch(page, /\.setPosition\(/, '宿主不该再逐格写坐标（格子位置归列表）');
    assert.doesNotMatch(page, /rewardSlots/, '宿主不该再有预摆的格子数组');
    // 口径函数本身也该从表里退场（删了就别留死代码）
    const table = stripSourceComments(readFileSync('assets/script/app/mail/MailTable.ts', 'utf8'));
    assert.doesNotMatch(table, /mailRewardRowOffsetX/, 'MailTable 里不该再留 mailRewardRowOffsetX');
    assert.equal(MAIL_REWARD_SLOT_COUNT, 8, 'FGUI 预摆 8 个 item —— 现在只用来在超出时告警');
});

// ============================================================
// B. 美术口径
// ============================================================

test('B1 邮件新增 6 张图都在 `image/mail/`（少一张就是一个白框，且**不报错**）', () => {
    for (const [key, name] of Object.entries(MAIL_ART_NAMES)) {
        const file = `assets/resources/${MAIL_ART_ROOT}/${name}.png`;
        assert.ok(existsSync(file), `缺图：${file}（逻辑名 ${key}）`);
        assert.ok(existsSync(`${file}.meta`), `缺 .meta：${file}.meta`);
    }
    assert.equal(Object.keys(MAIL_ART_NAMES).length, 6);
});

test('B2 复用的 6 张公共图确实存在（与 friend / login 同源，不另存第二份）', () => {
    for (const path of [
        'image/friend/fd_panel_bg', 'image/friend/fd_title_bg', 'image/friend/fd_row_bg',
        'image/friend/fd_btn_gold', 'image/friend/fd_btn_dark', 'image/login/公用_按钮_关闭01',
    ]) {
        assert.ok(existsSync(`assets/resources/${path}.png`), `公共图缺失：${path}`);
    }
});

test('B3 ⚠️ 九宫 3 张：边框必须落在 `.png.meta`，且 `rawW − left − right === 中心格宽`', () => {
    // FGUI `scale9grid`（x,y,w,h）= **中间格**矩形 ⇒ border(L,T,R,B) = (x, y, rawW−x−w, rawH−y−h)。
    // 期望值从 FGUI `package.xml` 的 scale9grid 反推；`rawW/rawH` 同时与 PNG 的 IHDR 对账。
    const want: Record<string, { grid: [number, number, number, number]; raw: [number, number] }> = {
        // frame_Zhikuang06_b / 共用组件里的行底：scale9grid 12,12,292,119 @ 317×142
        ml_row_bg_read: { grid: [12, 12, 292, 119], raw: [317, 142] },
        // 公用_九宫_分割线01：scale9grid 46,0,16,14 @ 110×14（左右才切，上下不切）
        ml_split_line: { grid: [46, 0, 16, 14], raw: [110, 14] },
        // 公用_九宫_内容底框01：scale9grid 14,13,5,5 @ 30×30
        ml_content_box: { grid: [14, 13, 5, 5], raw: [30, 30] },
    };
    for (const [name, { grid, raw }] of Object.entries(want)) {
        const [gx, gy, gw, gh] = grid;
        const [rawW, rawH] = raw;
        const file = `assets/resources/${MAIL_ART_ROOT}/${name}.png`;
        const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8')) as any;
        const user = meta.subMetas.f9941.userData;
        // ① 边框顺序是 L / T / R / B（不是 FGUI 的 x,y,w,h）
        assert.equal(user.borderLeft, gx, `${name}.borderLeft`);
        assert.equal(user.borderTop, gy, `${name}.borderTop`);
        assert.equal(user.borderRight, rawW - gx - gw, `${name}.borderRight`);
        assert.equal(user.borderBottom, rawH - gy - gh, `${name}.borderBottom`);
        assert.equal(user.packable, false, `${name} 必须 packable=false（进图集会改 uv，九宫错位）`);
        // ② meta 记的原始尺寸必须等于 PNG 真实尺寸（配错图这里会红）
        const size = pngSize(file);
        assert.equal(size.w, rawW, `${name} 的 PNG 实际宽`);
        assert.equal(size.h, rawH, `${name} 的 PNG 实际高`);
        assert.equal(user.rawWidth, rawW, `${name}.rawWidth`);
        assert.equal(user.rawHeight, rawH, `${name}.rawHeight`);
        // ③ 中心格 = rawW − left − right，必须正好是 FGUI 的 scale9grid 宽高
        assert.equal(user.rawWidth - user.borderLeft - user.borderRight, gw, `${name} 中心格宽`);
        assert.equal(user.rawHeight - user.borderTop - user.borderBottom, gh, `${name} 中心格高`);
    }
});

test('B4 行底图 `mailRowArt` 三态两张 + 状态文本 / 印章的显隐口径', () => {
    const ref = (state: number) => {
        const art = mailRowArt(state);
        return `${art.root}/${art.name}`;
    };
    assert.equal(ref(MAIL_STATE_UNREAD), `image/friend/${MAIL_ROW_BG_UNREAD_NAME}`, '未读复用好友那张');
    assert.equal(ref(MAIL_STATE_READ), `image/mail/${MAIL_ROW_BG_READ_NAME}`);
    assert.equal(ref(MAIL_STATE_TAKEN), `image/mail/${MAIL_ROW_BG_READ_NAME}`, '已领取与已读共用 `_b` 版底图');
    // 两个分支必须是同一种形状（`{root, name}` 可直接喂 `loadArt`），
    // 早期一个返「装配路径」一个返「资源名」⇒ 静默拼出两张不同的图
    for (const state of [MAIL_STATE_UNREAD, MAIL_STATE_READ, MAIL_STATE_TAKEN]) {
        const art = mailRowArt(state) as { root: unknown; name: unknown };
        assert.equal(typeof art.root, 'string', `${state} 的 root`);
        assert.equal(typeof art.name, 'string', `${state} 的 name`);
        assert.equal(String(art.root).includes('/spriteFrame'), false, '这里给的是 root + name，不是装配路径');
    }
    assert.equal(mailStateTextVisible(MAIL_STATE_UNREAD), false);
    assert.equal(mailStateTextVisible(MAIL_STATE_READ), true);
    assert.equal(mailStateTextVisible(MAIL_STATE_TAKEN), false, '已领取：文本不显示（由印章表达）');
    assert.equal(mailStampVisible(MAIL_STATE_TAKEN), true);
    assert.equal(mailStampVisible(MAIL_STATE_READ), false);
    assert.equal(mailStampVisible(MAIL_STATE_UNREAD), false);
});

test('B5 `mailArtPath`：未知 key 返 null（不抛）；已知 key 给**装配路径**（带 `/spriteFrame`）', () => {
    assert.equal(mailArtPath('nope'), null);
    // 记忆规则 57：`resources` 索引里只登记 `<path>/spriteFrame`，裸路径 load 不到
    assert.equal(mailArtPath('takenStamp'), `${MAIL_ART_ROOT}/ml_taken_stamp/spriteFrame`);
    for (const [key, name] of Object.entries(MAIL_ART_NAMES)) {
        assert.equal(mailArtPath(key), `${MAIL_ART_ROOT}/${name}/spriteFrame`, `逻辑名 ${key}`);
    }
});

test('B6 品质框目录与活动 / 七日共用（`image/frame`），别自己另存一份', () => {
    assert.equal(MAIL_QUALITY_FRAME_ROOT, 'image/frame');
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

test('C1 两个 prefab 都在，且根节点子序 = 渲染序（`RowView` 必须在按钮**之前**）', () => {
    for (const file of [PREFAB_MAIN, PREFAB_DETAIL]) assert.ok(existsSync(file), `缺 ${file}`);
    const M = loadPrefab(PREFAB_MAIN);
    const order = (M.root._children as any[]).map((c) => M.byId(c.__id__)._name);
    assert.deepEqual(order, ['PanelBg', 'TitleBg', 'Title', 'CloseBtn', 'RowView',
        'BatchRemoveBtn', 'GetOneKeyBtn', 'EmptyLabel', 'AutoDeleteLabel']);
    // Mask 会裁掉排在它之后的兄弟 ⇒ 按钮收不到触摸
    assert.ok(order.indexOf('RowView') < order.indexOf('BatchRemoveBtn'),
        'RowView 排在按钮之后 ⇒ Mask 会裁掉按钮、收不到触摸（单测测不出，端到端才现）');

    const D = loadPrefab(PREFAB_DETAIL);
    assert.deepEqual((D.root._children as any[]).map((c) => D.byId(c.__id__)._name), [
        'PanelBg', 'TitleBg', 'Title', 'CloseBtn', 'MailTitle', 'SplitLine', 'ContentView', 'RewardBox',
        'TakeBtn', 'TakenStamp',
    ]);
    // ⚠️ 反向回归：`RewardSlot1..8` 是**旧形态**（预摆 8 个格子直挂根下）—— 现在格子在
    //   `RewardBox/RewardList/content/RewardSlotTemplate` 里、由列表池化。加回来就是 8 个
    //   不渲染的死节点（零报错）。
    assert.deepEqual(
        (D.root._children as any[]).map((c) => D.byId(c.__id__)._name).filter((n: string) => /^RewardSlot\d+$/.test(n)),
        [],
        '根节点下不该再有预摆的奖励格',
    );
});

test('C2 ⚠️ 所有节点的 `_layer` 都是 UI_2D（落 DEFAULT 会让整棵子树不渲染）', () => {
    for (const file of [PREFAB_MAIN, PREFAB_DETAIL]) {
        const P = loadPrefab(file);
        const wrong = P.objs.filter((o: any) => o && o.__type__ === 'cc.Node' && o._layer !== 33554432);
        assert.deepEqual(wrong.map((n: any) => n._name), [], `${file} 有节点 layer ≠ 33554432`);
    }
});

test('C3 ⚠️ 脚本组件的 `__type__` 都能从对应 `.ts.meta` 的 uuid 反解（防 cid 抄错成 MissingScript）', () => {
    const cids = new Set<string>();
    for (const file of [PREFAB_MAIN, PREFAB_DETAIL]) {
        for (const o of loadPrefab(file).objs) {
            if (o && typeof o.__type__ === 'string' && !o.__type__.startsWith('cc.')) cids.add(o.__type__);
        }
    }
    /**
     * cid → uuid：Cocos `compressUuid(uuid, false)` 的口径 ——
     * **保留前 5 个 hex 字符**，其余 27 个 hex 按「3 hex → 2 base64」压缩 ⇒ 5 + 18 = **23 位**。
     * （`min = true` 那一支保留前 2 位、得 22 位，是资源 fileId 的口径，别混用。）
     */
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const HEX = '0123456789abcdef';
    const toUuid = (cid: string): string => {
        let out = cid.slice(0, 5);
        for (let i = 5; i + 1 < cid.length; i += 2) {
            const lhs = B64.indexOf(cid[i]);
            const rhs = B64.indexOf(cid[i + 1]);
            assert.ok(lhs >= 0 && rhs >= 0, `cid ${cid} 里有非 base64 字符`);
            out += HEX[lhs >> 2];
            out += HEX[((lhs & 3) << 2) | (rhs >> 4)];
            out += HEX[rhs & 0xf];
        }
        assert.equal(out.length, 32, `cid ${cid} 解出来不是 32 个 hex 字符`);
        return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20, 32)}`;
    };
    // 解码器自检：拿 MailPage 的 cid 对它的 `.ts.meta` uuid（写错算法这条就先红）
    const pageUuid = JSON.parse(readFileSync('assets/script/app/mail/MailPage.ts.meta', 'utf8')).uuid as string;
    assert.equal(toUuid('cf025DjtgJO2oaObZr3vHUQ'), pageUuid,
        'cid 解码器自检失败 ⇒ 下面的断言全部不可信');
    assert.equal(pageUuid, 'cf0250e3-b602-4eda-868e-6d9af7bc7510');

    const known = classIdsOfTagged(
        'assets/script/app/mail/MailPage.ts',
        'assets/script/app/mail/MailDetailPage.ts',
        'assets/script/app/mail/MailRow.ts',
        'assets/script/app/mail/MailRewardSlot.ts',
    );
    // VScrollView 是工程内的公共类，单独放行
    known.add(JSON.parse(readFileSync('assets/script/vscrollview/VScrollView.ts.meta', 'utf8')).uuid as string);
    for (const cid of cids) {
        assert.ok(known.has(toUuid(cid)), `cid ${cid} 反解成 ${toUuid(cid)}，不在任何 mail 脚本的 meta uuid 里（抄错 = MissingScript）`);
    }
});

test('C4 ⚠️ 几何：反解回画布像素后必须等于 FGUI XML 原值（差分 0.5px，**不加整体偏移**）', () => {
    const P = loadPrefab(PREFAB_MAIN);
    // popBg `13,128 size 680,946`（无 pivot ⇒ 左上角）
    assertCanvas(P, 'PanelBg', { left: 13, top: 128, w: 680, h: 946 });
    // 弹窗组件的三个子件由 relation 定位：n6 `center-center`、title `center-center,top-top`、
    // 按钮_关闭 `right-right,top-top`（右边距 2 ⇒ 右边 678）
    assertCanvas(P, 'TitleBg', { cx: 353, cy: 140.5, w: 344, h: 81 });
    assertCanvas(P, 'Title', { cx: 353, cy: 138, w: 240, h: 42 });
    assertCanvas(P, 'CloseBtn', { cx: 661, cy: 138, w: 60, h: 60 });
    // 列表 `351,195 pivot .5,0 size 575,666`
    assertCanvas(P, 'RowView', { cx: 351, top: 195, w: 575, h: 666 });
    // 两个按钮（无 pivot ⇒ 左上角）
    assertCanvas(P, 'BatchRemoveBtn', { left: 114, top: 877, w: 210, h: 82 });
    assertCanvas(P, 'GetOneKeyBtn', { left: 377, top: 877, w: 210, h: 82 });
    // 两个提示（pivot .5,.5 ⇒ 中心）
    assertCanvas(P, 'EmptyLabel', { cx: 351, cy: 559, w: 202, h: 32 });
    assertCanvas(P, 'AutoDeleteLabel', { cx: 351, cy: 986, w: 491, h: 32 });

    const D = loadPrefab(PREFAB_DETAIL);
    assertCanvas(D, 'PanelBg', { left: 47, top: 243, w: 626, h: 791 });        // popBg `360,243 pivot .5,0`
    assertCanvas(D, 'TitleBg', { cx: 360, cy: 255.5, w: 344, h: 81 });
    assertCanvas(D, 'Title', { cx: 360, cy: 253, w: 240, h: 42 });
    assertCanvas(D, 'CloseBtn', { cx: 641, cy: 253, w: 60, h: 60 });
    assertCanvas(D, 'MailTitle', { cx: 360, cy: 330, w: 300, h: 34 });
    assertCanvas(D, 'SplitLine', { left: 93, top: 337, w: 534, h: 14 });
    assertCanvas(D, 'ContentView', { left: 98, top: 361, w: 524, h: 400 });
    assertCanvas(D, 'RewardBox', { left: 83, top: 775, w: 554, h: 102 });
    assertCanvas(D, 'TakeBtn', { cx: 360, cy: 923, w: 170, h: 82 });
    assertCanvas(D, 'TakenStamp', { cx: 558.5, cy: 689, w: 119, h: 74 });
    // 奖励列表 = FGUI `列表_奖励列表`（`102,775 size 515,100`）：视口 anchor 是 **(0,0.5)**
    // （横向那套，见 `gen_mail.mjs buildRewardList` 的注释）⇒ 盒左 = lpos.x 直接就是画布左缘
    assertCanvas(D, 'RewardBox/RewardList', { left: 102, top: 775, w: 515, h: 100 });
    // content 与视口同锚点、`_lpos = (0,0)` ⇒ 它的左边缘就是视口左边缘（横向列表的 x=0）
    assertCanvas(D, 'RewardBox/RewardList/content', { left: 102, top: 775, w: 515, h: 100 });
    // item 模板：90×90，落在 content 局部 x=45（= itemW/2，横向公式第一格的中心）
    assertCanvas(D, 'RewardBox/RewardList/content/RewardSlotTemplate', {
        cx: 102 + 45, cy: 825, w: MAIL_REWARD_SLOT_SIZE, h: MAIL_REWARD_SLOT_SIZE,
    });
    // 一格 = 90 + colGap 10 ⇒ 步进 100：第 n 格中心（未居中时）= 102 + 45 + (n−1)*100。
    // 这串世界坐标以前是直接量 8 个预摆节点，现在由「视口 515 + spacing 10 + item 90 + autoCenter」
    // 四个 prefab 配置跟引擎的横向公式**复合**出来（`VirtualScrollView._updateVisible` 横向那支：
    // `x = i*stride + itemW*anchorX + globalOffset`，`globalOffset = (515 − 内容宽)/2` 且只在装得下时非 0）
    // ⇒ 配置项在下面逐条钉死、真机位置由端到端探针 `tmp/_mail_probe.mjs` 量。
    const contentWidth = (n: number): number =>
        n * MAIL_REWARD_SLOT_SIZE + (n - 1) * MAIL_REWARD_SLOT_GAP;
    // 「装得下」的边界与 FGUI 判据同一条：5 格 490 < 515（居中）、6 格 590 > 515（从左边排起）
    assert.ok(contentWidth(5) < MAIL_REWARD_LIST_WIDTH, '5 格应当装得下（居中那支）');
    assert.ok(contentWidth(6) > MAIL_REWARD_LIST_WIDTH, '6 格应当装不下（offset 0 那支）');
    // 5 格居中偏移：引擎 autoCenter 用 12.5，FGUI `Math.floor` 出 12 —— 差 0.5px（引擎再按
    // `pixelAlign` 取整 ⇒ 实机差 1px）。这一档**接受**，写在注释里免得后人当成 bug 去追。
    assert.equal((MAIL_REWARD_LIST_WIDTH - contentWidth(5)) / 2, 12.5);
});

test('C5 ⚠️ 行模板：`_lpos.y = −85`、尺寸 575×170，行内 6 个节点按 item 局部坐标落位', () => {
    const P = loadPrefab(PREFAB_MAIN);
    const T = 'RowView/content/RowTemplate';
    const template = canvasBox(P, T);
    assert.equal(P.pick(T)!._lpos.y, -85, 'VScrollView 的模板高度约定：_lpos.y 必须是 −h/2');
    assert.equal(P.pick(T)!._lpos.x, 0);
    assert.equal(template.w, 575);
    assert.equal(template.h, 170);

    const tLeft = template.left;
    const tTop = template.top;
    /** item 局部的 (对应边 x, 中心 y)。 */
    const local = (name: string) => {
        const b = canvasBox(P, `${T}/${name}`);
        return { b, left: b.left - tLeft, right: b.left + b.w - tLeft, cx: b.cx - tLeft, cy: b.cy - tTop };
    };
    // n25 信封 (40,50) 100×72 ⇒ 中心 (90,86)
    assert.deepEqual([local('MailIcon').cx, local('MailIcon').cy], [90, 86]);
    // n24 装饰 (19,17) 140×130 ⇒ 中心 (89,82)
    assert.deepEqual([local('Deco').cx, local('Deco').cy], [89, 82]);
    // 文本_标题 `164,32 pivot 0,.5` ⇒ 左边缘 164、中心 y 32（原稿 52 宽 autoSize ⇒ 放宽 300）
    assert.deepEqual([local('Title').left, local('Title').cy], [164, 32]);
    assert.equal(local('Title').b.w, 300);
    // 文本_时间 `164,80 pivot 0,.5`
    assert.deepEqual([local('Time').left, local('Time').cy], [164, 80]);
    assert.equal(local('Time').b.w, 95);
    // n26 印章 (409,40) 119×74 ⇒ 中心 (468.5,77)
    assert.deepEqual([local('TakenStamp').cx, local('TakenStamp').cy], [468.5, 77]);
    // ⚠️ 状态 `501,71 pivot 1,.5` ⇒ **右边缘 501**（当左边缘用会整体右偏一个格宽 52）
    assert.deepEqual([local('State').right, local('State').cy], [501, 71]);
    assert.equal(local('State').b.ax, 1, 'State 的 anchor.x 必须是 1（FGUI pivot 1,.5）');
    // 三个 pivot 0/.5 的必须真的是 (0,0.5)
    for (const name of ['Title', 'Time']) assert.equal(local(name).b.ax, 0);
    for (const name of ['Title', 'Time']) assert.equal(local(name).b.ay, 0.5);
});

test('C6 虚拟列表三件套：视口 / content 的 anchor 都是 (0.5,1)，且 `content` 指到 content 节点', () => {
    const P = loadPrefab(PREFAB_MAIN);
    for (const path of ['RowView', 'RowView/content']) {
        const ut = P.comp(P.pick(path), 'cc.UITransform');
        assert.equal(ut._anchorPoint.x, 0.5, `${path}.anchor.x`);
        assert.equal(ut._anchorPoint.y, 1, `${path}.anchor.y`);
    }
    const list = P.comp(P.pick('RowView'), '544earF5qRLB4JTuTnSr11+');
    assert.ok(list, 'RowView 必须挂 VirtualScrollView');
    assert.equal(P.byId(list.content.__id__)._name, 'content');
});

test('C7 ⚠️ 九宫格：`cc.Sprite._type` = 1(SLICED) + `_sizeMode` = 0(CUSTOM)，且不是所有 Sprite 都该是 1', () => {
    const P = loadPrefab(PREFAB_MAIN);
    for (const path of ['RowView/content/RowTemplate', 'PanelBg']) {
        const sp = P.comp(P.pick(path), 'cc.Sprite');
        assert.equal(sp._type, 1, `${path} 必须是 SLICED`);
        assert.equal(sp._sizeMode, 0, `${path} 的 sizeMode 必须是 CUSTOM（否则 spriteFrame 回写尺寸）`);
    }
    // `fd_title_bg` 的九宫边框是 (0,0,0,0) ⇒ 切九宫是空操作，保持 SIMPLE
    assert.equal(P.comp(P.pick('TitleBg'), 'cc.Sprite')._type, 0);
});

test('C8 行模板的 8 个 `@property` 全回填，`button` 指向**本节点**上的 `cc.Button`', () => {
    const P = loadPrefab(PREFAB_MAIN);
    const row = P.comp(P.pick('RowView/content/RowTemplate'), '4c02aMqNlBBr60ZNNLUy7Zt');
    assert.ok(row, 'RowTemplate 必须挂 MailRow');
    for (const key of ['background', 'deco', 'mailIcon', 'titleLabel', 'timeLabel', 'stateLabel', 'takenStamp', 'button']) {
        assert.ok(row[key], `MailRow.${key} 未回填（漏了就是运行时 undefined，不报错）`);
    }
    assert.equal(P.byId(P.byId(row.button.__id__).node.__id__)._name, 'RowTemplate');
    assert.equal(P.byId(P.byId(row.deco.__id__).node.__id__)._name, 'Deco');
    assert.equal(P.byId(P.byId(row.mailIcon.__id__).node.__id__)._name, 'MailIcon');
    // 默认行底是**未读**那张（已读由代码换）
    assert.equal(P.comp(P.pick('RowView/content/RowTemplate'), 'cc.Sprite')._spriteFrame.__uuid__,
        'a5bf30a4-00e7-4706-8039-adbffaab2897@f9941');
});

test('C9 ⚠️ 奖励列表：`RewardBox > RewardList(横向 VirtualScrollView + Mask) > content > 模板`，只有一颗槽组件', () => {
    const P = loadPrefab(PREFAB_DETAIL);
    const box = P.pick('RewardBox');
    assert.ok(box, '没有 RewardBox');
    // ① RewardBox 是**纯容器**：只有一个子节点（列表）—— 这才能「一处开关关整块」
    assert.deepEqual((box._children as any[]).map((c) => P.byId(c.__id__)._name), ['RewardList']);
    assert.equal(box._active, false, 'RewardBox 出厂必须 active=false（无奖励态，由页面按数据打开）');

    const list = P.pick('RewardBox/RewardList');
    const listScript = P.comp(list, LIST_CID);
    assert.ok(listScript, 'RewardList 必须挂 VirtualScrollView');
    // ② 横向那套口径（锚点写反 ⇒ 整行偏出半个视口，且不报错）
    assert.equal(P.comp(list, 'cc.UITransform')._anchorPoint.x, 0);
    assert.equal(P.comp(list, 'cc.UITransform')._anchorPoint.y, 0.5);
    assert.equal(listScript.direction, 1, 'direction 必须是 1(HORIZONTAL)');
    assert.equal(listScript.itemCreationMode, 0, 'itemCreationMode 必须是 0(NODE：模板取 content 首子节点)');
    assert.equal(listScript.gridCount, 1, '一行');
    assert.equal(listScript.spacing, MAIL_REWARD_SLOT_GAP, 'spacing 必须 = FGUI colGap');
    assert.equal(listScript.autoCenter, true, 'autoCenter 必须开 —— 它就是 FGUI 的 align="center"');
    assert.ok(listScript.content, 'RewardList.content 未回填 ⇒ 列表整块不渲染（零报错）');
    // ③ 没有 Mask ⇒ ≥6 格会实打实画到弹窗外面（原稿 `overflow="scroll"` 的裁剪等价物）
    assert.ok(P.comp(list, 'cc.Mask'), 'RewardList 必须有 cc.Mask');

    // ④ content 与视口同锚点、lpos(0,0)、挂 Widget
    const content = P.pick('RewardBox/RewardList/content');
    assert.equal(P.comp(content, 'cc.UITransform')._anchorPoint.x, 0);
    assert.equal(P.comp(content, 'cc.UITransform')._anchorPoint.y, 0.5);
    assert.equal(content._lpos.x, 0);
    assert.equal(content._lpos.y, 0);
    assert.ok(P.comp(content, 'cc.Widget'), 'content 必须挂 cc.Widget（跟着视口高度）');
    assert.equal(listScript.content.__id__, P.objs.indexOf(content), 'RewardList.content 应指向 content 节点');

    // ⑤ 模板：一颗，挂槽组件，`frame`/`icon` 指对节点；列表按 content 的**首子节点**取模板
    assert.deepEqual((content._children as any[]).map((c) => P.byId(c.__id__)._name), ['RewardSlotTemplate']);
    const template = P.objs[content._children[0].__id__];
    assert.equal(template._lpos.x, MAIL_REWARD_SLOT_SIZE / 2, '模板 x = itemW/2（横向公式第一格的中心）');
    const slot = P.comp(template, SLOT_CID);
    assert.ok(slot, '模板必须挂 MailRewardSlot');
    assert.equal(P.byId(P.byId(slot.frame.__id__).node.__id__)._name, 'RewardSlotTemplate');
    assert.equal(P.byId(P.byId(slot.icon.__id__).node.__id__)._name, 'Icon');
    // 图标默认空（运行时填）；品质框默认第 1 档
    assert.equal(P.comp(P.pick('RewardBox/RewardList/content/RewardSlotTemplate/Icon'), 'cc.Sprite')._spriteFrame ?? null, null);
    assert.ok(P.comp(template, 'cc.Sprite')._spriteFrame.__uuid__, '模板必须有品质框底图（不然没奖励时是一块空白）');

    // ⑥ 全文档**只许一颗** MailRewardSlot：多出来就是又走回「预摆 N 格」
    const slotCids = P.objs.filter((o: any) => o && o.__type__ === SLOT_CID);
    assert.equal(slotCids.length, 1, `MailRewardSlot 只该有 1 个（模板），实得 ${slotCids.length} 个`);
});

test('C10 两个页面的 `@property` 全部回填（详情页认一个 `rewardList`，不再认 `rewardSlots`）', () => {
    const M = loadPrefab(PREFAB_MAIN);
    const page = M.comp(M.root, 'cf025DjtgJO2oaObZr3vHUQ');
    assert.ok(page, 'Mail.prefab 根节点必须挂 MailPage');
    for (const key of ['closeButton', 'rowList', 'batchRemoveButton', 'batchRemoveLabel',
        'getOneKeyButton', 'getOneKeyLabel', 'emptyLabel', 'autoDeleteLabel']) {
        assert.ok(page[key], `MailPage.${key} 未回填`);
    }
    const D = loadPrefab(PREFAB_DETAIL);
    const detail = D.comp(D.root, '54fddGoKqFDFpu5l+bMmWND');
    assert.ok(detail, 'MailDetail.prefab 根节点必须挂 MailDetailPage');
    for (const key of ['closeButton', 'titleLabel', 'contentNode', 'contentLabel',
        'rewardBox', 'rewardList', 'takeButton', 'takeLabel', 'takenStamp']) {
        assert.ok(detail[key], `MailDetailPage.${key} 未回填`);
    }
    // `rewardSlots` 已经从脚本上退场（出生时写的 `rewardSlots: []` 必须跟着改成 `rewardList: null`，
    // 否则 save 后脚本上会留一个孤儿数组字段 —— 下次有人照它去接货币，接出一个不渲染的死引用）
    assert.equal(detail.rewardSlots, undefined, 'MailDetailPage 上不该再有 rewardSlots（旧形态的孤儿字段）');
    assert.equal(D.byId(D.byId(detail.rewardList.__id__).node.__id__)._name, 'RewardList');
});

// ============================================================
// D. 数据管道接线（源码文本）
// ============================================================

const src = (rel: string) => readFileSync(`assets/script/app/mail/${rel}`, 'utf8');

test('D1 两个页面的 `prefabPath` 大小写正确，且文件真的存在（真机区分大小写）', () => {
    const main = src('MailPage.ts');
    const detail = src('MailDetailPage.ts');
    const m = main.match(/static prefabPath = ['"]([^'"]+)['"]/);
    const d = detail.match(/static prefabPath = ['"]([^'"]+)['"]/);
    assert.ok(m && d);
    assert.equal(m![1], 'ui/Mail/Mail');
    assert.equal(d![1], 'ui/Mail/MailDetail');
    for (const p of [m![1], d![1]]) assert.ok(existsSync(`assets/resources/${p}.prefab`), `缺 assets/resources/${p}.prefab`);
});

test('D2 ⚠️ 4 个协议类名与老端一致（改一个字母就是静默发不出去）', () => {
    const text = src('RequestMailMsg.ts');
    for (const name of ['CmdMailListReqMsg', 'CmdMailReadReqMsg', 'CmdMailDeleteReqMsg', 'CmdMailTakeRewardReqMsg']) {
        assert.ok(text.includes(`return '${name}'`), `RequestMailMsg 少了 proto 名 ${name}`);
    }
    // 4 个 `MessageId` 必须真的登记了对应的 RspMsg（否则「能发」是假的）
    const cmd = readFileSync('assets/script/app/generated/netProto/Cmd.d.ts', 'utf8');
    for (const [name, id] of Object.entries({
        CmdMailListRspMsg: 319013138, CmdMailReadRspMsg: 546189302,
        CmdMailDeleteRspMsg: 172353567, CmdMailTakeRewardRspMsg: 555367350,
    })) {
        assert.ok(cmd.includes(name), `Cmd.d.ts 里没有 ${name}`);
        assert.ok(text.includes(String(id)), `RequestMailMsg 文件头没记下 ${name} = ${id}`);
    }
});

test('D3 ⚠️ 写请求必须 `withTimeout` + 离线早退 + `catch` 收口（否则服务端不回就永悬）', () => {
    const text = src('MailRepository.ts');
    assert.ok(text.includes('withTimeout'), 'Repository 没有用 withTimeout');
    assert.ok(/MAIL_READ_TIMEOUT_MS\s*=\s*800/.test(text), '读超时口径 800ms');
    assert.ok(/MAIL_WRITE_TIMEOUT_MS\s*=\s*5000/.test(text), '写超时口径 5000ms');
    assert.ok(text.includes("'offline'"), '缺离线早退（返回 offline 态）');
    assert.ok(text.includes("'failed'"), '缺失败态');
    assert.ok(text.includes('reset()'), 'Repository 必须有 reset（换号 / 重登要清本地快照）');
});

test('D4 ⚠️ 邮件**不走 `GameCache`**：Repository 自己存快照（`CmdCache` 里没有 mail 条目）', () => {
    const text = src('MailRepository.ts');
    // 判据是「不 import / 不调用」（文件头说明「为什么不读 CacheMgr」会提到这个词，不算违规）
    assert.equal(/from '[^']*GameCache'/.test(text), false, '邮件不该 import GameCache（老端也是 ModelMail 自己 SetMailList）');
    assert.equal(/GameCache\s*\./.test(text), false, '邮件不该调 GameCache 的接口');
    assert.ok(text.includes('private rows'), 'Repository 必须自己持列表快照');
    assert.ok(text.includes('fetched'), '必须有 fetched 标记（避免重复发包）');
});

test('D5 ⚠️ `id` 一律走 `toIdString`；发包传**十进制字符串**（普通对象会被 `LongBits.from` 当 zero）', () => {
    const detail = src('MailDetailPage.ts');
    assert.ok(detail.includes('toIdString(userData?.id)'), '详情弹窗的 id 必须归一化');
    const repo = src('MailRepository.ts');
    assert.ok(repo.includes('toIdString'), 'id 归一化入口缺失');
    // 绝不把 id 直接 Number()（>2^53 会丢位）
    assert.equal(/Number\(\s*(?:row|mail|id)\.id\s*\)/.test(repo), false, '不能对 id 用 Number()');
});

test('D6 ⚠️ `renderItemFn` 只绑**一次**（在 `onInit`）—— 绑在 `onOpen` 会让复用行串数据', () => {
    const text = src('MailPage.ts');
    const onInit = text.slice(text.indexOf('protected onInit'));
    const onOpen = text.slice(text.indexOf('protected async onOpen'), text.indexOf('protected async onOpen') + 1200);
    assert.ok(onInit.includes('renderItemFn'), 'renderItemFn 应当在 onInit 里绑');
    assert.equal(onOpen.includes('renderItemFn ='), false, 'onOpen 里不许重绑 renderItemFn');
});

test('D7 ⚠️ `onOpen` 里先 `await this.nextPopupFrame()`（`VirtualScrollView` 在 `start()` 才建槽位）', () => {
    const text = src('MailPage.ts');
    const at = text.indexOf('protected async onOpen');
    assert.ok(at > 0);
    const onOpen = text.slice(at, at + 1200);
    assert.ok(onOpen.includes('nextPopupFrame'), 'MailPage.onOpen 缺 nextPopupFrame');
});

test('D8 回调里**按 index 现取**行数据（禁闭包捕获本趟入参 —— 复用行会串数据）', () => {
    const text = src('MailPage.ts');
    assert.ok(/renderRow\s*\(/.test(text), '应当有 renderRow(node, index)');
    assert.ok(/this\.rows\s*\[/.test(text) || /this\.rows\[/.test(text), 'renderRow 必须按 index 从 this.rows 现取');
});

test('D9 文案全在 `MailTexts`，页面不造字符串（自动删除提示走模板 + 表值）', () => {
    const main = src('MailPage.ts');
    assert.ok(main.includes("from './MailTexts'"));
    assert.ok(main.includes('MAIL_AUTO_DELETE_TEMPLATE'), '自动删除提示必须用模板');
    assert.ok(main.includes('formatText'), '模板必须过 formatText');
    assert.equal(/['"][\u4e00-\u9fa5]{2,}['"]/.test(main.replace(/\/\*\*?[\s\S]*?\*\//g, '').split('from \'./MailTexts\'')[0]), false,
        '页面头部之外不许出现中文字面量');
});

test('D10 ⚠️ 详情页奖励列表的接线：`renderItemFn` 只绑一次 + 开箱后等一帧再 `refreshList`', () => {
    const text = stripSourceComments(src('MailDetailPage.ts'));
    // ① item 回调：只绑一次，按 index 现取（同 MailPage 铁律 ①）
    assert.ok(text.includes('renderItemFn'), '详情页没接 renderItemFn');
    assert.ok(text.includes('rewardRendererBound'), 'renderItemFn 必须只绑一次（onInit 会重入）');
    assert.ok(/renderRewardSlot\(node, index\)/.test(text), '回调应转发到 renderRewardSlot(node, index)');
    // ② 图必须**先取完再铺**（renderItemFn 是同步的，里面现加载会闪上一份奖励的图）
    assert.ok(/this\.rewardFrames\[index\]/.test(text), 'renderRewardSlot 应只读预取好的 rewardFrames[index]');
    // ③ `RewardBox` 出厂 active=false ⇒ 列表的 start() 要等第一次激活才跑；
    //    `refreshList` 早于它就一个格子都不建（**不报错**，只是空白）⇒ 必须中间隔一帧。
    //    ⚠️ 按「开箱之后」找那一帧：`onOpen` 里也有一个 `nextPopupFrame()`（在开箱之前）。
    const boxAt = text.indexOf('this.rewardBox.active = hasReward');
    const frameAt = text.indexOf('await this.nextPopupFrame()', boxAt);
    const refreshAt = text.indexOf('this.rewardList.refreshList(count)', boxAt);
    assert.ok(boxAt >= 0 && frameAt >= 0 && refreshAt >= 0,
        `详情页缺步骤：开箱(${boxAt}) / 等帧(${frameAt}) / 刷列表(${refreshAt})`);
    assert.ok(frameAt < refreshAt,
        '顺序必须是「开箱 → await nextPopupFrame() → refreshList」，否则列表一片空白（不报错）');
});

test('D11 ⚠️ 入口白名单**两处**都要登记（漏一处：入口不弹面板或弹了没内容）', () => {
    const route = readFileSync('assets/script/app/main/MainEntranceRoute.ts', 'utf8');
    const list = readFileSync('assets/script/app/main/MainEntranceList.ts', 'utf8');
    assert.match(route, /LayerMail:\s*'mail'/, 'MainEntranceRoute 没登记 LayerMail');
    assert.match(list, /import \{ MailPage \} from '\.\.\/mail\/MailPage'/, 'MainEntranceList 没 import MailPage');
    assert.match(list, /mail:\s*MailPage/, 'MainEntranceList 的 POPUP_CLASSES 没登记 mail');
});

test('D12 `open.json` 里 `LayerMail` 已登记（refId=301 / belond=3 / order=7），可见性无条件', () => {
    const rows = JSON.parse(readFileSync('assets/remoteRef/open.json', 'utf8')) as any[];
    const row = rows.find((r) => r.url === 'LayerMail');
    assert.ok(row, 'open.json 没有 LayerMail');
    assert.equal(row.refId, 301);
    assert.equal(row.belond, 3);
    assert.equal(row.order, 7);
    assert.equal(row.icon, '图标_战斗选关_按钮_邮件');
    assert.equal(row.name, '邮件');
    // 红点走 RDExpr（新端无表达式引擎 ⇒ 本轮不接），与可见性无关
    assert.equal(row.RDExpr, '[RDMail]');
    // 可见性**无条件**：`visibleCondition` / `condition` 都是空数组（不是 `[{}]`）
    assert.deepEqual(row.visibleCondition, [], 'visibleCondition 应为空 ⇒ 无条件可见');
    assert.deepEqual(row.condition, [], 'condition 应为空');
});

test('D13 有意的四处偏离都写在文件头（正文高度 400/580、不做滚动、不带富文本）', () => {
    const text = src('MailDetailPage.ts');
    assert.ok(text.includes('长文本不做滚动列表'));
    assert.ok(text.includes('无奖励时拉到 580') || text.includes('无奖励时把它拉到 580') || text.includes('applyContentHeight'));
    assert.equal(MAIL_CONTENT_HEIGHT_WITH_REWARD, 400);
    assert.equal(MAIL_CONTENT_HEIGHT_NO_REWARD, 580);
});

test('D14 判定与美术 / 文案分层：`MailTable` 不 import `cc` / `MailArt` / `MailTexts`（保住可单测）', () => {
    const text = src('MailTable.ts');
    // 判据统一是「import 了没」——注释里提到这些名字不算违规（文件头就必须说明这件事）
    assert.equal(/from 'cc'/.test(text), false, 'MailTable 不许 import cc');
    assert.equal(/from '[^']*\/MailArt'/.test(text), false, 'MailTable 不许依赖 MailArt（判定 ↔ 美术 分层）');
    assert.equal(/from '[^']*\/MailTexts'/.test(text), false, 'MailTable 不许依赖 MailTexts（文案由调用方传参）');
    // 更进一步：一个中文字面量都不留（含四档时间模板），否则「改文案只动 MailTexts」会静默失效
    const code = text.replace(/\/\*\*?[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.equal(/['"`][^'"`]*[\u4e00-\u9fa5][^'"`]*['"`]/.test(code), false,
        'MailTable 里出现了中文字面量 ⇒ 文案没走 MailTexts 传参');
});

// ============================================================
// E. 文案表
// ============================================================

test('E1 文案表键齐全（值不许空串）', () => {
    for (const [name, value] of Object.entries({
        MAIL_TITLE, MAIL_DETAIL_TITLE, MAIL_BTN_DELETE_ONE_KEY, MAIL_BTN_TAKE_ONE_KEY,
        MAIL_BTN_TAKE, MAIL_BTN_DELETE, MAIL_EMPTY, MAIL_AUTO_DELETE_TEMPLATE,
        MAIL_STATE_READ_TEXT, MAIL_STATE_TAKEN_TEXT, MAIL_DELETE_CONFIRM,
    })) {
        assert.ok(typeof value === 'string' && value.length > 0, `${name} 是空文案`);
    }
    // 与截图文案一致
    assert.equal(MAIL_TITLE, '邮件');
    assert.equal(MAIL_EMPTY, '邮箱内没有任何信件');
    assert.equal(MAIL_BTN_DELETE_ONE_KEY, '一键删除');
    assert.equal(MAIL_BTN_TAKE_ONE_KEY, '一键领取');
    assert.equal(MAIL_DELETE_CONFIRM, '确定要删除已读邮件吗？');
});

test('E2 ⚠️ 自动删除提示带 `{0}`/`{1}` 两个占位（少一个就是「文案里没有数字」）', () => {
    assert.ok(MAIL_AUTO_DELETE_TEMPLATE.includes('{0}'));
    assert.ok(MAIL_AUTO_DELETE_TEMPLATE.includes('{1}'));
});

test('E3 `formatText`：顺序替换、缺参原样保留（一眼看出漏传）', () => {
    assert.equal(formatText('超过{0}天或超出{1}', 40, 50), '超过40天或超出50');
    assert.equal(formatText('{0}{1}', 'a'), 'a{1}');
    assert.equal(formatText('没有占位', 1), '没有占位');
    // 同一个占位出现两次都要换
    assert.equal(formatText('{0}/{0}', 7), '7/7');
});

test('E4 四档时间文案与 `mailTimeText` 拼出的结果一致（不是各写一套）', () => {
    const now = new Date(2026, 8, 23, 10, 0, 0, 0).getTime();
    assert.equal(mailTimeText(now - 30_000, now, ROW_TEXTS), MAIL_TIME_JUST_NOW);
    assert.equal(mailTimeText(now - 3 * 60_000, now, ROW_TEXTS), formatText(MAIL_TIME_MINUTES, 3));
    assert.equal(mailTimeText(new Date(2026, 8, 23, 8, 0, 0, 0).getTime(), now, ROW_TEXTS), formatText(MAIL_TIME_HOURS, 2));
    // ⚠️ 3 个自然日前（总 82 小时）⇒ `3天前`（见 A10 那条的推导）
    assert.equal(mailTimeText(new Date(2026, 8, 20, 12, 0, 0, 0).getTime(), now, ROW_TEXTS), formatText(MAIL_TIME_DAYS, 3));
});
