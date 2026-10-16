/**
 * 主界面入口「点击 → 打开界面」路由的单测。
 *
 * 覆盖的事：`open.url` 里写的是**老端的界面类名**（`LayerFirstRecharge` / `LayerGift` / …），
 * 老端靠 `__cname` 反射查类；本工程没有那套注册表，改用 `MainEntranceRoute` 的**显式白名单**。
 * 所以真正要钉住的是三件事：
 *
 *   1. 已落地的 url 解得对（含 trim / 大小写敏感性口径）；
 *   2. 未落地的 url 一律 `none` —— **不能"看起来支持"**；
 *   3. 白名单里的每个 url 都**真的出现在 `open.json` 里** —— 这一条专治「url 拼错一个字母、
 *      白名单永远匹配不上、点了还是没反应」这类静默失效（只测白名单自己是测不出来的）。
 *
 * 顺带用真实表把「belond=2/3 的 12 个入口 url 里只有 8 个已接线（首充 + 礼包 + 战令 + 七日狂欢 + 豪华月卡 + 活动 + 好友 + 邮件）」
 * 钉死，免得以后有人顺手把整张表都登记进来。
 * ⚠️ 2026-09-23：礼包（`LayerGift`，refId=103）接线，从 3 个变 4 个 —— 这次更新就是这条守卫
 *    在起作用（它逼着接线的人显式改期望，而不是悄悄扩白名单）。
 * ⚠️ 2026-09-23（同日第二轮）：活动（`LayerActivity`，refId=102）接线，从 4 个变 5 个 ——
 *    同样是这条守卫逼出来的显式改动。
 * ⚠️ 2026-09-23（同日第三轮）：好友（`LayerFriend`，refId=206）接线，从 5 个变 6 个 ——
 *    同样是这条守卫逼出来的显式改动。
 * ⚠️ 2026-09-23（同日第四轮）：邮件（`LayerMail`，refId=301）接线，从 6 个变 7 个 ——
 *    同样是这条守卫逼出来的显式改动。
 * ⚠️ 2026-09-24：聊天（`LayerChat`，refId=13）登记，白名单 7→8；但它 `belond = 0`
 *    （右下角固定悬浮按钮），**不进左右列** ⇒ 左右列那 7 条不动。规模守卫因此拆成两个数。
 * ⚠️ 2026-09-24（同日第二轮）：战令（`LayerBattleToken`，refId=104，**左列** order=3）
 *    接线，左右列 7→8、白名单总数 8→9。
 * ⚠️ 2026-09-26：限时活动（`LayerLimitTimeBuy`，refId=421）接线，白名单总数 9→10；但它
 *    `belond = 0`（固定按钮，不进左右列）⇒ 左右列那 8 条不动。同样是这条守卫逼出的显式改动。
 * ⚠️ 2026-09-26（同日第二轮）：角色主界面（`TabRoleMain`，refId=2，`role`）登记，白名单总数
 *    10→11；同样 `belond=1` 不进左右列 ⇒ 左右列 8 仍不动。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    isEntranceUrlRouted,
    resolveEntranceRoute,
    routedEntranceUrls,
} from '../assets/script/app/main/MainEntranceRoute';
import { collectEntranceItems, EntranceBelond, type OpenRowLike } from '../assets/script/app/main/MainEntranceTypes';

const OPEN_TABLE = 'assets/remoteRef/open.json';

/** 入口列表两侧的 `belond`（`2` 左 / `3` 右）。 */
const BELOND_LEFT = 2;
const BELOND_RIGHT = 3;

/** 真实 `open` 全表（顶层就是行数组）。 */
const OPEN_ROWS: OpenRowLike[] = JSON.parse(readFileSync(OPEN_TABLE, 'utf8')) as OpenRowLike[];

/** 入口列表会用到的两侧 url（`belond=2` 左 / `3` 右，且该行有 url）。 */
const ENTRANCE_URLS = OPEN_ROWS
    .filter((row) => (row.belond === BELOND_LEFT || row.belond === BELOND_RIGHT) && row.url)
    .map((row) => String(row.url));

test('已落地的入口 url 解析成 popup 路由', () => {
    assert.deepEqual(resolveEntranceRoute('LayerFirstRecharge'), { kind: 'popup', key: 'firstRecharge' });
    assert.deepEqual(resolveEntranceRoute('LayerSevenDay'), { kind: 'popup', key: 'sevenDay' });
    assert.deepEqual(resolveEntranceRoute('LayerGiftMonth'), { kind: 'popup', key: 'monthCardGift' });
    assert.deepEqual(resolveEntranceRoute('LayerGift'), { kind: 'popup', key: 'gift' });
    assert.deepEqual(resolveEntranceRoute('LayerActivity'), { kind: 'popup', key: 'activity' });
    assert.deepEqual(resolveEntranceRoute('LayerFriend'), { kind: 'popup', key: 'friend' });
    assert.deepEqual(resolveEntranceRoute('LayerMail'), { kind: 'popup', key: 'mail' });
    // 聊天：`belond = 0`，不进左右列，但同样登记在同一张白名单里（见下面那条规模守卫）。
    assert.deepEqual(resolveEntranceRoute('LayerChat'), { kind: 'popup', key: 'chat' });
});

test('url 先 trim 再匹配（表里可能有首尾空格）', () => {
    assert.deepEqual(resolveEntranceRoute('  LayerFirstRecharge  '), { kind: 'popup', key: 'firstRecharge' });
    assert.deepEqual(resolveEntranceRoute('\tLayerSevenDay\n'), { kind: 'popup', key: 'sevenDay' });
});

test('匹配是大小写敏感的 —— 老端拿 url 当类名直接查，没有别名容错', () => {
    assert.equal(resolveEntranceRoute('layerfirstrecharge').kind, 'none');
    assert.equal(resolveEntranceRoute('LAYERFIRSTRECHARGE').kind, 'none');
    assert.equal(resolveEntranceRoute('layersevenday').kind, 'none');
    assert.equal(resolveEntranceRoute('layergiftmonth').kind, 'none');
    assert.equal(resolveEntranceRoute('layeractivity').kind, 'none');
    assert.equal(resolveEntranceRoute('layerfriend').kind, 'none');
    assert.equal(resolveEntranceRoute('layermail').kind, 'none');
    assert.equal(resolveEntranceRoute('layerchat').kind, 'none');
    assert.equal(resolveEntranceRoute('LayerSevenDay').kind, 'popup');
    assert.equal(resolveEntranceRoute('LayerGiftMonth').kind, 'popup');
    assert.equal(resolveEntranceRoute('LayerActivity').kind, 'popup');
    assert.equal(resolveEntranceRoute('LayerFriend').kind, 'popup');
    assert.equal(resolveEntranceRoute('LayerMail').kind, 'popup');
    assert.equal(resolveEntranceRoute('LayerChat').kind, 'popup');
});

test('空 / 非字符串 / 未登记的 url 一律 none，且不抛', () => {
    const inputs = [undefined, null, '', '   ', 'LayerSpinActivity', 'TabStore', 0 as unknown as string];
    for (const input of inputs) {
        assert.equal(resolveEntranceRoute(input).kind, 'none', `url=${String(input)} 应当未接线`);
    }
});

test('isEntranceUrlRouted 与 resolveEntranceRoute 口径一致', () => {
    assert.equal(isEntranceUrlRouted('LayerFirstRecharge'), true);
    assert.equal(isEntranceUrlRouted('LayerSevenDay'), true);
    assert.equal(isEntranceUrlRouted('LayerGift'), true);
    assert.equal(isEntranceUrlRouted('LayerActivity'), true);
    assert.equal(isEntranceUrlRouted('LayerFriend'), true);
    assert.equal(isEntranceUrlRouted('LayerMail'), true);
    assert.equal(isEntranceUrlRouted('LayerChat'), true);
    assert.equal(isEntranceUrlRouted('LayerBattleToken'), true);
    assert.equal(isEntranceUrlRouted(''), false);
    assert.equal(isEntranceUrlRouted(undefined), false);
});

test('⚠️ 白名单里每个 url 都必须真的出现在 open.json 里（专治拼错导致的静默失效）', () => {
    const allUrls = new Set(OPEN_ROWS.map((row) => String(row.url ?? '')));
    const missing = routedEntranceUrls().filter((url) => !allUrls.has(url));
    assert.deepEqual(missing, [], `白名单里的这些 url 在 open.json 里不存在（拼错了？）：${missing.join(', ')}`);
});

test('白名单规模受控 —— belond=2/3 的入口 url 里只有 8 个已接线', () => {
    // 12 条里有 4 条还没落地。这条断言的作用是「新增接线必须是有意识的动作」：
    // 一旦顺手多登记了几个，这里会红，提醒去补真正的界面而不是只加白名单。
    const routed = ENTRANCE_URLS.filter((url) => isEntranceUrlRouted(url));
    assert.equal(ENTRANCE_URLS.length, 12, `入口 url 条数变了（${ENTRANCE_URLS.length}），先确认 open.json 是不是改过`);
    // 顺序 = open.json 的表序（ENTRANCE_URLS 由表序过滤而来，不是白名单声明序）。
    assert.deepEqual(routed, ['LayerFirstRecharge', 'LayerActivity', 'LayerGift', 'LayerBattleToken', 'LayerSevenDay', 'LayerFriend', 'LayerMail', 'LayerGiftMonth']);
    // ⚠️ 2026-09-24：白名单**总条数** ≠ 左右列已接线条数，两个数要分别钉。
    //    `LayerChat`（refId=13）在表里是 `belond = 0`，**不属左右列**（老端就是当右下角固定
    //    悬浮按钮用的，见 `ArenaRoot.prefab/ChatEntry`）⇒ 左右列 7→8（多了战令 refId=104），
    //    白名单总数 8→9。
    // ⚠️ 2026-09-26：限时活动（`LayerLimitTimeBuy`，refId=421）同为 `belond = 0` 固定按钮 ⇒
    //    左右列 8 不动、白名单总数 9→10。同日角色主界面 `TabRoleMain`（refId=2，belond=1）
    //    也登记 ⇒ 白名单总数 10→11，左右列 8 仍不动。
    assert.equal(routed.length, 8, '左右列（belond 2/3）的已接线条数');
    assert.equal(routedEntranceUrls().length, 11, '白名单总条数（含不进左右列的固定按钮 url）');
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=101 能走到 popup', () => {
    // 把「读表 → 过滤成条目 → 点它」这条链一次性串起来，避免只测白名单自说自话。
    const left = collectEntranceItems(OPEN_ROWS, EntranceBelond.left);
    const item = left.find((entry) => entry.refId === 101);
    assert.ok(item, 'open.json 左侧应当有 refId=101');
    assert.equal(item!.url, 'LayerFirstRecharge');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'firstRecharge' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=202（七日狂欢）能走到 popup', () => {
    const right = collectEntranceItems(OPEN_ROWS, EntranceBelond.right);
    const item = right.find((entry) => entry.refId === 202);
    assert.ok(item, 'open.json 右侧应当有 refId=202');
    assert.equal(item!.url, 'LayerSevenDay');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'sevenDay' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=410（豪华月卡）能走到 popup', () => {
    // 月卡入口在**左列**（belond=2，order=5），老端界面类名 `LayerGiftMonth`。
    // ⚠️ `MainEntranceItem` 里没有 `name`（那列不入条目，只用于调试），能断言的是 `iconKey`。
    const left = collectEntranceItems(OPEN_ROWS, EntranceBelond.left);
    const item = left.find((entry) => entry.refId === 410);
    assert.ok(item, 'open.json 左侧应当有 refId=410');
    assert.equal(item!.url, 'LayerGiftMonth');
    assert.equal(item!.iconKey, '图标_主界面_月卡');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'monthCardGift' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=103（礼包）能走到 popup', () => {
    // 礼包入口在**左列**（belond=2，order=2），老端界面类名 `LayerGift`。
    const left = collectEntranceItems(OPEN_ROWS, EntranceBelond.left);
    const item = left.find((entry) => entry.refId === 103);
    assert.ok(item, 'open.json 左侧应当有 refId=103');
    assert.equal(item!.url, 'LayerGift');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'gift' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=102（活动）能走到 popup', () => {
    // 活动入口在**右列**（belond=3，order=2），老端界面类名 `LayerActivity`。
    // 可见条件是 `battleLevel(resId=1)` + `notTiShen` —— 都落在 MainEntranceVisible 已支持的类型里
    // （若哪天条件类型改了，这里不会红，得靠 MainEntranceVisible 自己的用例兜）。
    const right = collectEntranceItems(OPEN_ROWS, EntranceBelond.right);
    const item = right.find((entry) => entry.refId === 102);
    assert.ok(item, 'open.json 右侧应当有 refId=102');
    assert.equal(item!.url, 'LayerActivity');
    assert.equal(item!.iconKey, '图标_战斗选关_按钮_活动');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'activity' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=206（好友）能走到 popup', () => {
    // 好友入口在**右列**（belond=3，order=6），老端界面类名 `LayerFriend`。
    // `visibleCondition = [{}]` 无条件，所以不带条件类型依赖。
    const right = collectEntranceItems(OPEN_ROWS, EntranceBelond.right);
    const item = right.find((entry) => entry.refId === 206);
    assert.ok(item, 'open.json 右侧应当有 refId=206');
    assert.equal(item!.url, 'LayerFriend');
    assert.equal(item!.iconKey, '图标_主界面_好友');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'friend' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=104（战令）能走到 popup', () => {
    // 战令入口在**左列**（belond=2，order=3），老端界面类名 `LayerBattleToken`。
    // 条件是 `battleLevel(resId=1)` + `notTiShen`，都落在 MainEntranceVisible 已支持的类型里。
    const left = collectEntranceItems(OPEN_ROWS, EntranceBelond.left);
    const item = left.find((entry) => entry.refId === 104);
    assert.ok(item, 'open.json 左侧应当有 refId=104');
    assert.equal(item!.url, 'LayerBattleToken');
    assert.equal(item!.iconKey, '图标_战斗选关_按钮_战令');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'battleToken' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=301（邮件）能走到 popup', () => {
    // 邮件入口在**右列**（belond=3，order=7），老端界面类名 `LayerMail`。
    // `visibleCondition = [{}]` 无条件（红点走 `RDExpr = "[RDMail]"`，与可见性无关）。
    const right = collectEntranceItems(OPEN_ROWS, EntranceBelond.right);
    const item = right.find((entry) => entry.refId === 301);
    assert.ok(item, 'open.json 右侧应当有 refId=301');
    assert.equal(item!.url, 'LayerMail');
    assert.equal(item!.iconKey, '图标_战斗选关_按钮_邮件');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'mail' });
});

test('端到端：open 表 → collectEntranceItems → resolveEntranceRoute，refId=421（限时活动）能走到 popup', () => {
    // 限时活动入口是 `belond = 0` 的固定按钮（不进左右列，老端挂在主界面右侧动态入口区），
    // 老端界面类名 `LayerLimitTimeBuy`，本工程路由到限时活动三页签（每日任务/每日礼包/限购）。
    const item = OPEN_ROWS.find((row) => row.refId === 421);
    assert.ok(item, 'open.json 应当有 refId=421');
    assert.equal(item!.url, 'LayerLimitTimeBuy');
    assert.deepEqual(resolveEntranceRoute(item!.url), { kind: 'popup', key: 'limitTimeBuy' });
});

test('端到端：未接线的入口（转盘 4 条）都还停在 none', () => {
    // ⚠️ 右列（belond=3）4 条**已全部接线**（活动 / 七日狂欢 / 好友 / 邮件）；
    //    左列 8 条已接线 4 条（首充 / 礼包 / 战令 / 豪华月卡）⇒ 未接线的只剩 4 条转盘战令。
    //    所以这里不能再按「每列都还剩几条」断言，改成全局收集 + 显式钉住右列构成。
    const ROUTED_REF_IDS = new Set([101, 102, 103, 104, 202, 206, 301, 410]);
    const others = [EntranceBelond.left, EntranceBelond.right]
        .flatMap((belond) => collectEntranceItems(OPEN_ROWS, belond))
        .filter((entry) => !ROUTED_REF_IDS.has(entry.refId));

    assert.ok(others.length > 0, '应当还有未接线的入口');
    for (const entry of others) {
        assert.equal(
            resolveEntranceRoute(entry.url).kind,
            'none',
            `refId=${entry.refId} url=${entry.url} 不该已接线`,
        );
    }

    // 右列构成（`collectEntranceItems` 按 `order` 排序，非表序）：
    // 七日狂欢(order=1) → 活动(2) → 好友(6) → 邮件(7)。
    // 变了说明 open.json 加了右列入口 —— 要么去补界面、要么显式更新这条期望。
    const right = collectEntranceItems(OPEN_ROWS, EntranceBelond.right);
    assert.deepEqual(right.map((entry) => entry.refId), [202, 102, 206, 301]);
});
