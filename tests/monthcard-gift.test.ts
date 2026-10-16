/**
 * 「豪华月卡」（老端 `LayerGiftMonth` / FGUI `组件_礼包_月卡礼包`）数据口径 + 版面口径的纯逻辑单测。
 *
 * 覆盖 `assets/script/app/monthcard/` 里**不依赖 `cc`** 的三个文件：
 *   `MonthCardGiftTable`（判定与解析）、`MonthCardGiftArt`（资源名口径）、`MonthCardGiftLayout`（FGUI→Cocos 坐标）。
 *
 * 这段被单测盯住的原因：老客户端的判定散在 `ModelMonthCard` / `ModelActivity` / `VOMonthCardBag` /
 * DI 容器里，没法单测，只能靠手点；而且这个界面有**三处会骗人的命名**（见 `MonthCardGiftTable` 文件头），
 * 一旦有人"顺手修正"，界面上会表现为「价格显示 9 元」或者「点购买没反应」这类不报错的错。
 *
 * 所以这里的重点不是覆盖率，而是**钉住口径**：
 *   ① `monthCardActPlan.rmb` 是 `payChannel.id`，价格只能来自 `payChannel.rmb`（= 30）；
 *   ② 领奖的 id 是活动缓存的 `openResId`，买入的 id 是 `monthCardActPlan.type` —— 两个口径；
 *   ③ `MONTHCARD_IMPORTED_CURRENCY_ART` 必须与 `MainResBarTypes.RES_BAR_ICON_ART` 的取值集合一致
 *      （单边改了就会红，避免"资源栏有图、月卡这边静默留白"）。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { MONTHCARD_ART_ROOT, spriteFramePath } from '../assets/script/app/ArtPaths';
import {
    MONTHCARD_ART,
    MONTHCARD_FRAME_NAMES,
    backgroundArtForType,
    monthCardFramePath,
} from '../assets/script/app/monthcard/MonthCardGiftArt';
import {
    MONTHCARD_BOUGHT_TAG_POS,
    MONTHCARD_BUY_POS,
    MONTHCARD_DESC_POS,
    MONTHCARD_ENTRY_HEIGHT,
    MONTHCARD_ENTRY_STRIDE,
    MONTHCARD_ENTRY_WIDTH,
    MONTHCARD_LIST_HEIGHT,
    MONTHCARD_LIST_WIDTH,
    MONTHCARD_MAX_DAY_REWARD_SLOTS,
    MONTHCARD_MAX_PRIVILEGE_ROWS,
    MONTHCARD_RENEW_POS,
    MONTHCARD_SLOT_STRIDE,
    MONTHCARD_SP_BBOX,
    MONTHCARD_SP_SCALE,
    MONTHCARD_SP_SIZE,
    MONTHCARD_TIME_POS,
    MONTHCARD_TITLE_POS,
    dayRewardSlotPosition,
    entryPosition,
    fguiAnchorToCocos,
    fguiTopLeftToCocos,
    privilegeRowPosition,
} from '../assets/script/app/monthcard/MonthCardGiftLayout';
import {
    MONTHCARD_BOUGHT_TAG_DY,
    MONTHCARD_IMPORTED_CURRENCY_ART,
    MONTHCARD_LAYOUT_DY,
    MONTH_CARD_TYPE_PREMIUM,
    MONTH_CARD_TYPE_WELFARE,
    buildGifts,
    buildPriceResolver,
    buildRewardMeta,
    buildStates,
    buildView,
    buildViews,
    boughtTagDyOf,
    currencyRewardFramePath,
    formatRemain,
    layoutDyOf,
    mustTakeDailyRewardFirst,
    phaseOf,
    startOfDay,
    toMillis,
} from '../assets/script/app/monthcard/MonthCardGiftTable';
import type { IMonthCardGift } from '../assets/script/app/monthcard/MonthCardGiftTable';
import { MONTHCARD_TEXTS } from '../assets/script/app/monthcard/MonthCardGiftTexts';
import { RES_BAR_ICON_ART } from '../assets/script/app/main/MainResBarTypes';
import { resIconRoot } from '../assets/script/app/common/ResTypes';

const RESOURCES = 'assets/resources';
const DAY_MS = 86400000;

/** 读一张 remoteRef 分表（都是「对象数组」形态）。 */
function readTable(name: string): unknown[] {
    return JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as unknown[];
}

/** 断言 `<root>/<name>.png` 真实存在。 */
function assertSpriteExists(root: string, name: string, hint: string): void {
    assert.ok(name, `${hint}：资源名为空`);
    const file = `${RESOURCES}/${root}/${name}.png`;
    assert.ok(existsSync(file), `${hint}：缺少美术 ${file}（根目录来自 ArtPaths，别在别处另写一份）`);
}

// ============================================================
// 时间
// ============================================================

test('formatRemain 在「整 1 天」处切换单位：> 86400 秒给天数，否则给 hh:mm:ss', () => {
    // 老端 `TabGiftMonth.ts:120` 判据是 `lastTime > 86400`（**秒**，且是严格大于）
    assert.deepEqual(formatRemain(2 * DAY_MS), { day: '2', isDayUnit: true });
    assert.deepEqual(formatRemain(DAY_MS + 1000), { day: '1', isDayUnit: true });

    // 刚好 1 天**不算**「> 1 天」⇒ 走时分秒（这是老端的原样，别改成 >=）
    assert.deepEqual(formatRemain(DAY_MS), { day: '24:00:00', isDayUnit: false });
    assert.deepEqual(formatRemain(3599000), { day: '00:59:59', isDayUnit: false });
    assert.deepEqual(formatRemain(0), { day: '00:00:00', isDayUnit: false });

    // 已过期（负数）按 0 处理，不出现 "-1" 这种文案
    assert.deepEqual(formatRemain(-5000), { day: '00:00:00', isDayUnit: false });
});

test('startOfDay 取本地时区当天 0 点', () => {
    const noon = new Date(2026, 8, 23, 12, 34, 56, 789).getTime();
    const start = startOfDay(noon);
    const date = new Date(start);
    assert.equal(date.getHours(), 0);
    assert.equal(date.getMinutes(), 0);
    assert.equal(date.getSeconds(), 0);
    assert.equal(date.getMilliseconds(), 0);
    assert.equal(start, new Date(2026, 8, 23).getTime());
    // 同一天的两个时刻必须落到同一个 0 点
    assert.equal(startOfDay(new Date(2026, 8, 23, 0, 0, 1).getTime()), start);
    assert.equal(startOfDay(new Date(2026, 8, 23, 23, 59, 59).getTime()), start);
});

test('toMillis 吃 number / 数字串 / protobufjs Long，非法值一律 0', () => {
    assert.equal(toMillis(1700000000000), 1700000000000);
    assert.equal(toMillis('1700000000000'), 1700000000000);
    assert.equal(toMillis({ toNumber: () => 12345 }), 12345);
    assert.equal(toMillis({ low: 1000, high: 0 }), 1000);
    for (const bad of [NaN, Infinity, 'abc', null, undefined, true, {}]) {
        assert.equal(toMillis(bad), 0, `toMillis(${String(bad)}) 应当是 0`);
    }
});

// ============================================================
// 真实配置表 → 界面口径（这一组是核心：口径错了不报错，只是显示错）
// ============================================================

test('⚠️ 真实表：价格取 payChannel.rmb（= 30），不是 monthCardActPlan.rmb（= 9 / 10）', () => {
    const planRows = readTable('monthCardActPlan');
    const payRows = readTable('payChannel');
    const priceOf = buildPriceResolver(payRows);
    const gifts = buildGifts(planRows, priceOf, new Map());

    assert.equal(gifts.length, 2, `monthCardActPlan 应当是 2 行，实际 ${gifts.length}`);

    for (const gift of gifts) {
        // 老端 `monthCardActPlan.rmb` 存的是 **payChannel.id**（TabGiftMonth.ts:173 按 id 查）
        assert.ok(priceOf(gift.payId) > 0, `type=${gift.type} 的 payId=${gift.payId} 在 payChannel 里查不到`);
        assert.equal(gift.price, 30, `月卡价格应当来自 payChannel.rmb = 30（type=${gift.type}）`);
        // 这条就是"口径被改坏"的报警点：把 monthCardActPlan.rmb 当价格会得到 9 / 10
        assert.notEqual(gift.price, gift.payId, '价格不该等于 payId —— 那说明又把 rmb 当价格了');
        // `plan` 与 `limitTimeCardResId` 是两套 id（本仓库恰好都是 1/2，所以只能断言存在）
        assert.ok(gift.plan > 0 && gift.type > 0);
        assert.ok(gift.continueDays > 0);
        assert.ok(gift.title.length > 0);
    }

    // 类型与文案 / 点图一一对应（type 是**配置口径**：1 是福利月卡、2 是超值月卡）
    const welfare = gifts.find((gift) => gift.type === MONTH_CARD_TYPE_WELFARE)!;
    const premium = gifts.find((gift) => gift.type === MONTH_CARD_TYPE_PREMIUM)!;
    assert.equal(welfare.title, '福利月卡');
    assert.equal(premium.title, '超值月卡');
    assert.equal(welfare.dotArt, MONTHCARD_ART.dotNormal);
    assert.equal(premium.dotArt, MONTHCARD_ART.dotRich);
    assert.notEqual(welfare.dotArt, premium.dotArt, '两张卡的特权行点图必须是两张图');
    assert.ok(welfare.plan < premium.plan, 'buildGifts 要按 plan 升序，列表顺序跟它走');
});

test('⚠️ 真实表：福利月卡没有每日奖励 / 购买奖励，超值月卡两者都有', () => {
    const gifts = buildGifts(
        readTable('monthCardActPlan'),
        buildPriceResolver(readTable('payChannel')),
        buildRewardMeta(readTable('roleProperty'), readTable('item')),
    );
    const welfare = gifts.find((gift) => gift.type === MONTH_CARD_TYPE_WELFARE)!;
    const premium = gifts.find((gift) => gift.type === MONTH_CARD_TYPE_PREMIUM)!;

    // 这两条决定「每日获得」「显示获得」两个控制器的页面 ⇒ 决定界面上两块区域显不显示
    assert.equal(welfare.dayRewards.length, 0, '福利月卡不该有每日奖励');
    assert.equal(welfare.buyReward, null, '福利月卡不该有购买奖励');
    assert.equal(premium.dayRewards.length, 4);
    assert.ok(premium.buyReward, '超值月卡应当有购买奖励');

    // 特权条数（`list_desc` 的行数来源）；超过 prebaf 里烘焙的行数就会显示不全
    assert.equal(welfare.privileges.length, 4);
    assert.equal(premium.privileges.length, 4);
    assert.ok(
        premium.privileges.length <= MONTHCARD_MAX_PRIVILEGE_ROWS,
        '特权行数超过了 prefab 里烘焙的行数，要加节点',
    );
    assert.ok(
        premium.dayRewards.length <= MONTHCARD_MAX_DAY_REWARD_SLOTS,
        '每日奖励格数超过了 prefab 里烘焙的格子数，要加节点',
    );
});

test('⚠️ 真实表：物品图标一律空串（本工程一张物品图都没导），货币只认 5 张白名单', () => {
    const meta = buildRewardMeta(readTable('roleProperty'), readTable('item'));
    const gifts = buildGifts(readTable('monthCardActPlan'), buildPriceResolver(readTable('payChannel')), meta);
    const premium = gifts.find((gift) => gift.type === MONTH_CARD_TYPE_PREMIUM)!;

    // 购买奖励 1000 金币（roleProperty 10 → 图标_幻灵玉）：有图
    assert.ok(premium.buyReward);
    assert.equal(premium.buyReward!.resId, 10);
    assert.equal(premium.buyReward!.iconArt, '图标_幻灵玉');
    assert.ok(premium.buyReward!.name.length > 0, 'roleProperty 里有名字就该带上');

    // 每日奖励：银币（有图）+ 3 个物品（没图）
    const withIcon = premium.dayRewards.filter((reward) => reward.iconArt.length > 0);
    const withoutIcon = premium.dayRewards.filter((reward) => reward.iconArt.length === 0);
    assert.equal(withIcon.length, 1, '只有银币那一格的图标导进来了');
    assert.equal(withIcon[0].iconArt, '图标_铜币');
    assert.equal(withoutIcon.length, 3, '金钥匙 / 图纸 / 兵书这三张物品图本工程没有');

    // 没图的那几个仍然要有名字（`item.json` 里有），但 `iconArt` 必须是空串
    for (const reward of withoutIcon) {
        assert.ok(reward.resId >= 10000, `resId=${reward.resId} 应当落在 item 表区间`);
        assert.ok(reward.number > 0);
    }
    // 图标名不许出现"没导进来却写上了"的情况
    for (const reward of premium.dayRewards) {
        if (reward.iconArt.length > 0) {
            assert.ok(MONTHCARD_IMPORTED_CURRENCY_ART.includes(reward.iconArt), `${reward.iconArt} 不在已导入白名单里`);
        }
    }
    // `buildGifts` 默认（无 meta）时也必须是空串，而不是别的兜底
    const noMeta = buildGifts(readTable('monthCardActPlan'), buildPriceResolver(readTable('payChannel')), new Map());
    assert.equal(noMeta[1].buyReward!.iconArt, '');
});

test('⚠️ 月卡的货币白名单必须与资源栏的取值集合一致（单边改了就会红）', () => {
    const fromResBar = Array.from(new Set(Object.values(RES_BAR_ICON_ART))).sort();
    const fromMonthCard = Array.from(new Set(MONTHCARD_IMPORTED_CURRENCY_ART)).sort();
    assert.deepEqual(
        fromMonthCard,
        fromResBar,
        'MonthCardGiftTable.MONTHCARD_IMPORTED_CURRENCY_ART 与 MainResBarTypes.RES_BAR_ICON_ART 的取值集合必须一致',
    );
    // 而且每张图都得真的在磁盘上（否则就是"代码说能加载、实际静默留白"）
    // 目录走 `resIconRoot`（默认 `icons/resource`，`图标_经验值` 这类例外查覆盖表）——
    // 与 `currencyRewardFramePath` 同口径，别在这里写死 `icons/resource`。
    for (const name of fromMonthCard) {
        assertSpriteExists(resIconRoot(name), name, `月卡奖励图标（${name}）`);
        assert.equal(currencyRewardFramePath(name), spritePath(resIconRoot(name), name));
    }
    // 空串 = 不加载（契约：调用方据此跳过 `resources.load`）
    assert.equal(currencyRewardFramePath(''), '');
});

/** 与 `ArtPaths.spriteFramePath` 同口径，独立写一份以免"两边一起改坏"。 */
function spritePath(root: string, name: string): string {
    return `${root}/${name}/spriteFrame`;
}

// ============================================================
// 服务器状态
// ============================================================

test('buildStates 按 activity.type 读对应的 detail 字段，未知 ref / 非月卡类型一律跳过', () => {
    const activityRows = [
        { resId: 100201, type: 1002, plan: 1 },
        { resId: 100202, type: 1006, plan: 2 },
        { resId: 100101, type: 1001, plan: 9 }, // 不是月卡类型
    ];
    const cmds = [
        // type=1002 ⇒ 读 `monthCardActDetail`
        { activityRefId: 100201, openResId: 41005, detail: { monthCardActDetail: { todayTake: false } } },
        // type=1006 ⇒ 读 `monthCardActDetail2`。这里故意让 detail 那个字段是 true，
        // 若实现读错字段就会拿到 true ⇒ 断言 false 会红。
        {
            activityRefId: 100202,
            openResId: 41002,
            detail: { monthCardActDetail: { todayTake: true }, monthCardActDetail2: { todayTake: false } },
        },
        // refId 查不到 ⇒ 跳过
        { activityRefId: 777777, openResId: 41004, detail: {} },
        // 非月卡类型 ⇒ 跳过
        { activityRefId: 100101, openResId: 41003, detail: {} },
    ];

    const states = buildStates(cmds, activityRows);
    assert.equal(states.size, 2, '只应当有 plan=1 / plan=2 两条状态');

    assert.deepEqual(states.get(1), { claimedToday: false, activityResId: 41005 });
    assert.deepEqual(states.get(2), { claimedToday: false, activityResId: 41002 });
    assert.equal(states.has(9), false, '非月卡类型不该产出状态');
});

test('buildStates 对缺失 / 畸形数据不抛异常（离线是正常情况）', () => {
    const activityRows = [{ resId: 100201, type: 1002, plan: 1 }];
    const cases: unknown[][] = [
        [],
        [null, undefined, 0, 'x'],
        [{ activityRefId: 100201, openResId: 1, detail: null }],
        [{ activityRefId: 100201, openResId: 1, detail: { monthCardActDetail: null } }],
    ];
    for (const cmds of cases) {
        const states = buildStates(cmds, activityRows);
        assert.ok(states instanceof Map);
    }
    // `detail` 缺失时 `todayTake` 按未领取（`undefined !== true`）
    const states = buildStates([{ activityRefId: 100201, openResId: 7, detail: null }], activityRows);
    assert.deepEqual(states.get(1), { claimedToday: false, activityResId: 7 });
    // 缓存整体为空 ⇒ 空 Map，而不是 "全部未购买" 之外的什么特殊态
    assert.equal(buildStates([], []).size, 0);
});

// ============================================================
// 三态与位移
// ============================================================

test('phaseOf 的分支顺序照抄老端 updateItemLayout', () => {
    assert.equal(phaseOf(false, true, false), 'unbought');
    // 未购买时哪怕"今天没领"也不是可领取 —— `bought` 是第一判据
    assert.equal(phaseOf(false, true, true), 'unbought');
    // 没有每日奖励的卡（福利月卡）永远不走 claimable
    assert.equal(phaseOf(true, false, false), 'renew');
    assert.equal(phaseOf(true, true, true), 'renew');
    assert.equal(phaseOf(true, true, false), 'claimable');
});

test('buildView：过期等价于未购买（老端 lastTime > 0 才算已购买）', () => {
    const gift = fakeGift({ type: MONTH_CARD_TYPE_PREMIUM }, 1);
    const now = 1_700_000_000_000;

    const notBought = buildView(gift, 0, undefined, now);
    assert.equal(notBought.bought, false);
    assert.equal(notBought.remainMs, 0);
    assert.equal(notBought.endTimeMs, 0);
    assert.equal(notBought.phase, 'unbought');

    // 刚好到期（endTime === now）也算未购买
    const justExpired = buildView(gift, now, undefined, now);
    assert.equal(justExpired.bought, false);
    assert.equal(justExpired.phase, 'unbought');

    const alive = buildView(gift, now + 3 * DAY_MS, { claimedToday: false, activityResId: 5 }, now);
    assert.equal(alive.bought, true);
    assert.equal(alive.remainMs, 3 * DAY_MS);
    assert.equal(alive.endTimeMs, now + 3 * DAY_MS, '倒计时要按绝对时刻重算，所以 view 里必须带 endTimeMs');
    assert.equal(alive.phase, 'claimable');
});

test('两张卡的整块位移不同，别把位移"统一"掉', () => {
    assert.equal(layoutDyOf(MONTH_CARD_TYPE_WELFARE), -28);
    assert.equal(layoutDyOf(MONTH_CARD_TYPE_PREMIUM), -5);
    assert.equal(boughtTagDyOf(MONTH_CARD_TYPE_WELFARE), -2);
    assert.equal(boughtTagDyOf(MONTH_CARD_TYPE_PREMIUM), 0);
    assert.equal(layoutDyOf(99), 0, '未登记的类型回落到 0');
    assert.equal(boughtTagDyOf(99), 0);
    // 两张卡的位移必须不同 —— 相等就说明有人把它们合并了
    assert.notEqual(MONTHCARD_LAYOUT_DY[1], MONTHCARD_LAYOUT_DY[2]);

    const now = 1_700_000_000_000;
    for (const [type, dy] of Object.entries(MONTHCARD_LAYOUT_DY)) {
        const view = buildView(fakeGift({ type: Number(type) }), now + DAY_MS, undefined, now);
        assert.equal(view.layoutDy, dy);
    }
    assert.equal(buildView(fakeGift({ type: MONTH_CARD_TYPE_WELFARE }), 0, undefined, now).boughtTagDy, MONTHCARD_BOUGHT_TAG_DY[1]);
});

test('buildViews 保持 gifts 的顺序，并按 plan 取各自的 endTime / state', () => {
    const gifts = [
        fakeGift({ plan: 1, type: MONTH_CARD_TYPE_WELFARE }),
        fakeGift({ plan: 2, type: MONTH_CARD_TYPE_PREMIUM }, 1),
    ];
    const now = 1_700_000_000_000;
    const views = buildViews({
        gifts,
        states: new Map([[2, { claimedToday: true, activityResId: 9 }]]),
        endTimes: new Map([[1, 0], [2, now + DAY_MS]]),
        now,
    });

    assert.deepEqual(views.map((view) => view.phase), ['unbought', 'renew']);
    assert.deepEqual(views.map((view) => view.gift.plan), [1, 2]);
    assert.equal(views[1].claimedToday, true);
});

test('mustTakeDailyRewardFirst：三个前置条件缺一不可', () => {
    const now = 1_700_000_000_000;
    const alive = now + DAY_MS;

    // 有效期内 + 有每日奖励 + 今天没领 ⇒ 拦
    assert.equal(mustTakeDailyRewardFirst(alive, true, false, now), true);
    // 今天已经领了 ⇒ 放行（可以续费）
    assert.equal(mustTakeDailyRewardFirst(alive, true, true, now), false);
    // 已过期 = 首次购买 ⇒ 不校验
    assert.equal(mustTakeDailyRewardFirst(now, true, false, now), false);
    assert.equal(mustTakeDailyRewardFirst(0, true, false, now), false);
    // 这张卡没有每日奖励（福利月卡）⇒ 不校验
    assert.equal(mustTakeDailyRewardFirst(alive, false, false, now), false);
});

// ============================================================
// 文案
// ============================================================

test('文案常量与老端 key 对得上（续费 / 每日奖励提示）', () => {
    assert.equal(MONTHCARD_TEXTS.renewPrefix, '续费');
    assert.equal(MONTHCARD_TEXTS.buyPrefix, '￥');
    assert.equal(MONTHCARD_TEXTS.claim, '领取');
    assert.equal(MONTHCARD_TEXTS.taken, '已领取');
    // `mL` 表 id=479
    assert.equal(MONTHCARD_TEXTS.dailyNotTaken, '请先领取每日奖励');
    assert.ok(MONTHCARD_TEXTS.entryLoadFailed.length > 0);
});

// ============================================================
// 美术
// ============================================================

test('月卡的每张图都在 image/monthcard 下，且两张卡面是两张不同的图', () => {
    assert.equal(MONTHCARD_FRAME_NAMES.length, 12, `应当预加载 12 张月卡图，实际 ${MONTHCARD_FRAME_NAMES.length}`);
    assert.equal(new Set(MONTHCARD_FRAME_NAMES).size, MONTHCARD_FRAME_NAMES.length, '预加载清单里有重复项');
    for (const name of MONTHCARD_FRAME_NAMES) {
        assertSpriteExists(MONTHCARD_ART_ROOT, name, `月卡图（${name}）`);
        assert.equal(monthCardFramePath(name), spritePath(MONTHCARD_ART_ROOT, name));
    }

    // 卡面按类型分流：两张卡是两套图（不是染色）
    assert.equal(backgroundArtForType(MONTH_CARD_TYPE_WELFARE), MONTHCARD_ART.bgNormal);
    assert.equal(backgroundArtForType(MONTH_CARD_TYPE_PREMIUM), MONTHCARD_ART.bgRich);
    assert.notEqual(backgroundArtForType(1), backgroundArtForType(2));
    // 未登记的类型回落到普通卡面，而不是 undefined 让 `spriteFrame` 变空
    assert.equal(backgroundArtForType(99), MONTHCARD_ART.bgNormal);

    // `bg`（外层面板底）与 `yueka.png` 是两回事：后者在 skel/yueka 且不能改名
    assert.ok(existsSync(`${RESOURCES}/skel/yueka/yueka.atlas.txt`), 'spine atlas 文本必须叫 <名字>.atlas.txt');
    assert.ok(existsSync(`${RESOURCES}/skel/yueka/yueka.skel`));
    assert.ok(existsSync(`${RESOURCES}/skel/yueka/yueka.png`));
});

// ============================================================
// 版面（FGUI 左上原点 → Cocos 中心原点）
// ============================================================

test('fgui 坐标换算：左上原点 → 中心原点', () => {
    // 633×353 的卡面放到 633×380 的条目里、XML 写 `xy="0,0"` ⇒ 水平居中、垂直偏上
    assert.deepEqual(fguiTopLeftToCocos(0, 0, 633, 353, 633, 380), { x: 0, y: 13.5 });
    // 满屏元素必然落在原点
    assert.deepEqual(fguiTopLeftToCocos(0, 0, 720, 1280, 720, 1280), { x: 0, y: 0 });
    // 右下贴边（720×1280 里的 100×50，贴右下角）
    assert.deepEqual(fguiTopLeftToCocos(620, 1230, 100, 50, 720, 1280), { x: 310, y: -615 });
    // 带 anchor 的元素：xy 已经是枢轴点，不再加半个宽高
    assert.deepEqual(fguiAnchorToCocos(360, 640, 720, 1280), { x: 0, y: 0 });
});

test('条目内各元素的坐标 = XML 原值换算，且随类型 / 状态位移', () => {
    // XML: bg `0,0 633,353`
    assert.deepEqual(MONTHCARD_BUY_POS, { x: 168.5, y: -99.5 });   // XML `402,259 166,61`
    assert.deepEqual(MONTHCARD_RENEW_POS, { x: 172.5, y: -132.5 }); // XML `406,292`，尺寸仍是 166×61
    assert.deepEqual(MONTHCARD_TIME_POS, { x: 166.5, y: -73 });     // XML `483,263` anchor 中心
    assert.deepEqual(MONTHCARD_DESC_POS, { x: 167.5, y: -41.5 });   // XML `377,215 214,33`
    assert.deepEqual(MONTHCARD_BOUGHT_TAG_POS, { x: -280, y: 139 }); // XML `-23,14`，图 119×74

    // 两张卡的卡名各有各的 gearXY
    assert.deepEqual(MONTHCARD_TITLE_POS[MONTH_CARD_TYPE_WELFARE], { x: -4, y: 153 });  // XML `199,3`
    assert.deepEqual(MONTHCARD_TITLE_POS[MONTH_CARD_TYPE_PREMIUM], { x: -1, y: 147 });  // XML `202,9`
    assert.notDeepEqual(MONTHCARD_TITLE_POS[1], MONTHCARD_TITLE_POS[2]);
});

test('列表与格子的排布：步进取 XML 原值，且都在容器范围内', () => {
    // 条目：633×380，容器 711×756 ⇒ 版心 78 平分两侧，全部 380 步进
    assert.equal(MONTHCARD_ENTRY_WIDTH, 633);
    assert.equal(MONTHCARD_ENTRY_HEIGHT, 380);
    assert.equal(MONTHCARD_ENTRY_STRIDE, 380);
    const entry0 = entryPosition(0);
    const entry1 = entryPosition(1);
    assert.equal(entry0.x, 0, '条目在容器里水平居中');
    assert.equal(entry0.y - entry1.y, MONTHCARD_ENTRY_STRIDE);
    // 首行顶到容器上沿（FGUI 的 `vAlign="middle"` 在内容比视口高时不加偏移）
    assert.equal(entry0.y, 756 / 2 - 380 / 2);

    // 每日奖励格：`list_reward` 的 `colGap="10"` + 格宽 80
    assert.equal(MONTHCARD_SLOT_STRIDE, 90);
    const slots = [0, 1, 2, 3].map(dayRewardSlotPosition);
    assert.deepEqual(slots.map((slot) => slot.x), [-135, -45, 45, 135]);
    for (const slot of slots) {
        assert.ok(Math.abs(slot.x) + 40 <= 350 / 2, '格子必须落在 350 宽的容器里');
        assert.equal(slot.y, 0);
    }

    // 特权行：34 高 + `lineGap="6"`
    const rows = [0, 1, 2, 3, 4].map(privilegeRowPosition);
    assert.equal(rows[0].y - rows[1].y, 40);
    assert.equal(rows[4].y, 60.5 - 160);
    for (const row of rows) {
        assert.equal(row.x, -30, 'FGUI 这个 list 没写 align ⇒ 靠左，120 宽一半减 150');
        assert.ok(row.y + 17 <= 155 / 2, '行必须落在 155 高的容器里');
    }

    // spine 的缩放：**恒为 1**。老端那个 loader 写着 `fill="scaleNoBorder"`，但同一个 loader
    // 上还有 `autoSize="true"` —— FGUI 的 autoSize 分支 `setSize(...)` 之后直接 return，
    // fill 执行不到；装配路径 `UpdateNodeSize()` 又被恒为 0×0 的 `_modelSize` 卡住。
    // 详见 `MonthCardGiftLayout` 里那段推导 + `tmp/probe_yueka_pixels.mjs` 的实测量。
    assert.equal(MONTHCARD_SP_SCALE, 1, 'spine 不缩放（老端 autoSize 短路了 fill）');
    // 骨架 setup bounds 是 4 个附件的并集，**必须远大于**可见内容 —— 若它小于占位框，
    // 说明又把 `spineData.width` 当成渲染尺寸了（那正是被推翻的那版推导）。
    assert.ok(
        MONTHCARD_SP_BBOX > MONTHCARD_SP_SIZE.width * 3,
        `骨架 bounds ${MONTHCARD_SP_BBOX} 应远大于占位框 ${MONTHCARD_SP_SIZE.width}`,
    );
});

// ============================================================
// 条目预制体的静态结构（读 prefab JSON，本项目的 house style）
// ============================================================

const ENTRY_PREFAB = 'assets/resources/ui/MonthCardGift/MonthCardGiftEntry.prefab';
const SHELL_PREFAB = 'assets/resources/ui/MonthCardGift/MonthCardGift.prefab';

interface PrefabNode {
    readonly __type__?: string;
    readonly _name?: string;
    readonly _layer?: number;
    readonly _children?: readonly { __id__: number }[];
    readonly _components?: readonly { __id__: number }[];
    readonly _string?: string;
    readonly _contentSize?: { width: number; height: number };
    readonly _anchorPoint?: { x: number; y: number };
    readonly _sizeMode?: number;
    readonly _overflow?: number;
    readonly _enableWrapText?: boolean;
    readonly _target?: unknown;
    readonly _transition?: number;
    readonly _zoomScale?: number;
    readonly [k: string]: unknown;
}

function readPrefab(path: string): readonly PrefabNode[] {
    return JSON.parse(readFileSync(path, 'utf8')) as readonly PrefabNode[];
}

/** 节点名 → 它在数组里的下标（本 prefab 里节点名唯一）。 */
function nodeIndexByName(o: readonly PrefabNode[], name: string): number {
    return o.findIndex((x) => x?.__type__ === 'cc.Node' && x._name === name);
}

function componentsOf(o: readonly PrefabNode[], nodeIndex: number): readonly PrefabNode[] {
    return (o[nodeIndex]._components ?? []).map((c) => o[c.__id__]);
}

function childrenOf(o: readonly PrefabNode[], nodeIndex: number): readonly PrefabNode[] {
    return (o[nodeIndex]._children ?? []).map((c) => o[c.__id__]);
}

test('月卡条目 prefab：按钮底图是纯色、文案必须在子 Label 上（漏了就是一个空按钮）', () => {
    const o = readPrefab(ENTRY_PREFAB);

    // 老端 `按钮_公共_通用` = `<Button icon=底图 title=文案>`，而 `btn_icon_claim.png` /
    // `btn_icon_taken.png` 上**没有任何字**（实测 alpha 满幅的纯色块）⇒ 少一个 Label，
    // 界面上就是个空的黄/绿按钮，而且**不报任何错**。这条用例就是防这个。
    const want: ReadonlyArray<readonly [string, RegExp]> = [
        ['BtnBuy', /^￥/],
        ['BtnReward', /^领取$/],
        ['BtnTaken', /^已领取$/],
    ];
    for (const [name, pattern] of want) {
        const idx = nodeIndexByName(o, name);
        assert.notEqual(idx, -1, `找不到按钮节点 ${name}`);
        const labels = childrenOf(o, idx).flatMap((c) => {
            const childIndex = o.indexOf(c);
            return componentsOf(o, childIndex);
        }).filter((c) => c?.__type__ === 'cc.Label');
        assert.equal(labels.length, 1, `${name} 的 Label 子节点数应为 1，实际 ${labels.length}`);
        assert.match(String(labels[0]._string), pattern, `${name} 的按钮文案不符 ${pattern}`);
    }

    // 文案真源在 `MonthCardGiftTexts`（静态度那两个），prefab 里写的就是同一份值
    assert.equal(MONTHCARD_TEXTS.claim, '领取');
    assert.equal(MONTHCARD_TEXTS.taken, '已领取');
});

test('月卡条目 prefab：领取按钮的文案压在红点**下面**（`_children` 序 = 渲染序）', () => {
    const o = readPrefab(ENTRY_PREFAB);
    const names = childrenOf(o, nodeIndexByName(o, 'BtnReward')).map((c) => c._name);
    // 老端按钮组件的 displayList 是 icon → title → 红点；写反了红点会被 Label 盖住
    assert.deepEqual(names, ['Label', 'RedDot'], `BtnReward 的子节点顺序是 ${JSON.stringify(names)}`);
});

test('月卡条目 prefab：按钮用 SCALE 过渡 + 0.9 缩放（对齐老端 `downEffect="scale"`）', () => {
    const o = readPrefab(ENTRY_PREFAB);
    for (const name of ['BtnBuy', 'BtnReward', 'BtnTaken']) {
        const button = componentsOf(o, nodeIndexByName(o, name)).find((c) => c?.__type__ === 'cc.Button');
        assert.ok(button, `${name} 上没有 cc.Button`);
        assert.equal(button._transition, 3, `${name} 的 transition 应为 SCALE(3)`);
        assert.equal(button._zoomScale, 0.9, `${name} 的 zoomScale 应为 0.9`);
        // `_target` 留 null ⇒ 引擎自己取 this.node，缩放的 `_originalScale` 才不会丢符号
        assert.equal(button._target, null, `${name} 的 _target 应留 null`);
    }
});

test('月卡 prefab：所有节点 layer 都是 UI_2D，且 fileId 长度为 22 且唯一', () => {
    for (const path of [ENTRY_PREFAB, SHELL_PREFAB]) {
        const o = readPrefab(path);
        const nodes = o.filter((x) => x?.__type__ === 'cc.Node');
        assert.ok(nodes.length > 0, `${path} 里没有节点`);
        assert.deepEqual(
            Array.from(new Set(nodes.map((n) => n._layer))),
            [33554432],
            `${path} 的节点 layer 应全是 UI_2D(33554432)`,
        );

        // 22 位是 `compressUuid` 的形态；长度写错会让编辑器的资源库查询整个炸掉，
        // 而且报错完全不指向文件（见 `cocos-mcp-build-prefab` 铁律 11）。
        const ids = o.map((x) => x.fileId).filter((v): v is string => typeof v === 'string');
        assert.deepEqual(Array.from(new Set(ids.map((s) => s.length))), [22], `${path} 的 fileId 长度必须全为 22`);
        assert.equal(new Set(ids).size, ids.length, `${path} 的 fileId 有重复`);

        // 根必须落在数组里第一个 cc.Node，且 `cc.Prefab.data` 指向它（§10.1 天条）
        const firstNode = o.findIndex((x) => x?.__type__ === 'cc.Node');
        assert.equal(firstNode, 1, `${path} 的根节点应落在 #1`);
        assert.equal((o[0].data as { __id__?: number } | undefined)?.__id__, 1, `${path} 的 cc.Prefab.data 未指向根节点`);
    }
});

test('月卡外壳 prefab：List 的锚点与尺寸是 `entryPosition` 的参照系', () => {
    const o = readPrefab(SHELL_PREFAB);
    const list = nodeIndexByName(o, 'List');
    const [uiTransform] = componentsOf(o, list).filter((c) => c?.__type__ === 'cc.UITransform');
    assert.ok(uiTransform, 'List 上没有 UITransform');
    // `entryPosition(i)` 算的是**相对 List 中心**的坐标 ⇒ List 锚点必须是 (0.5, 0.5)，
    // 否则每张卡都会整体偏半个列表高（技能 §4.1 的「参照系」陷阱）。
    // ⚠️ 别对 `_anchorPoint` / `_contentSize` 整个对象做 deepEqual —— 序列化里还带 `__type__`。
    assert.equal(uiTransform._anchorPoint?.x, 0.5, 'List 锚点 x 必须是 0.5');
    assert.equal(uiTransform._anchorPoint?.y, 0.5, 'List 锚点 y 必须是 0.5');
    assert.equal(uiTransform._contentSize?.width, MONTHCARD_LIST_WIDTH);
    assert.equal(uiTransform._contentSize?.height, MONTHCARD_LIST_HEIGHT);
    // 两张卡叠起来是 760，比列表的 756 多 4 —— 这是**老端本来就有的**溢出：
    // 外层 XML 里 `list` 写的是 `overflow="scroll"`（可滚 4px），条目高 380 是美术定的。
    // 本工程没做虚拟列表（条目数由配置决定、仓库里就 2 条），所以这 4px 直接画在列表矩形外；
    // 因为 `List` 上**没有 Mask**，视觉上无影响（与老端静止态一致）。
    // 这条断言是**故意钉住那个 4**：数值一变就说明条目高或列表高被改过，得回去核对 XML。
    const contentHeight = MONTHCARD_ENTRY_HEIGHT + MONTHCARD_ENTRY_STRIDE;
    assert.equal(contentHeight - MONTHCARD_LIST_HEIGHT, 4, '两张卡比列表高 4（老端 overflow="scroll" 的那一段）');
    assert.equal(entryPosition(1).y, 188 - MONTHCARD_ENTRY_STRIDE, '纵向步进只有一个（条目高 380、lineGap 0）');
});

// ============================================================
// Repository 购买链路（读源码守护：Repository / Page 依赖 cc / GameNet，纯 Node 单测跑不起来）
// ============================================================

/** 读 `assets/script/app/monthcard/` 下某个文件的源码文本。 */
function src(file: string): string {
    return readFileSync(`assets/script/app/monthcard/${file}`, 'utf8');
}

test('月卡购买：rsp.ret 为真后必须触发支付（FW.pay(payId, "common", 0)），别停在「只开单」', () => {
    const repository = src('MonthCardGiftRepository.ts');
    // 老端 `TabGiftMonth.onClickBuyMonth`：`if (rsp.ret) SDKMgr.pay(payRef.id, "common", 0)`。
    // Demo3.8 的支付走可注入出口 `FW.pay`（组合根接真实现），Repository 里必须调用它。
    assert.match(repository, /FW\.pay\(payId, 'common', 0\)/);
    // buy 的签名要带上 `payId`（= payChannel.id = monthCardActPlan.rmb），否则支付不知道收多少钱
    assert.match(repository, /async buy\(type: number, payId: number, caller\?: unknown\)/);
    // 支付出口 `FW.pay` 在 framework 层定义（可注入空实现，同 showReward 口径）
    const fw = readFileSync('assets/script/framework/FW.ts', 'utf8');
    assert.match(fw, /static pay: \(payChannelId: number, fromType: string, fromId: number\) => void = \(\) => \{ \};/);
});

test('月卡购买成功：靠 CmdCardBuyBroMsg 广播弹奖励（不是 rsp.ret 弹，那只是「受理」）', () => {
    const repository = src('MonthCardGiftRepository.ts');
    // 老端 `ModelMonthCard.enter()` 挂 `CmdCardBuyBroMsg`：服务端真发货（endTime 已加、buyReward 已发）
    // 后才广播；rsp.ret 只代表「受理了请求」（还没付款）。所以奖励弹窗必须挂广播，不能挂在 rsp 回调里。
    assert.match(repository, /addEvent\('CmdCardBuyBroMsg'/);
    assert.match(repository, /msg\?\.tlRewards/);

    // 广播回调在 Page 里：飘字 + 弹奖励 + 重刷（老端 `FW.showTip` + `FW.ShowReward(broMsg.tlRewards)`）
    const page = src('MonthCardGiftPage.ts');
    assert.match(page, /FW\.showTip\(MONTHCARD_TEXTS\.buySuccess\)/);
    assert.match(page, /if \(goods\.length > 0\) FW\.ShowReward\(goods\)/);
    assert.match(page, /this\.repo\.listen\(this, this\.onBuySettled\)/);
});

test('月卡领取每日奖励：响应里的 tlReward 要弹奖励（老端 ModelActivity 直接 FW.ShowReward）', () => {
    const repository = src('MonthCardGiftRepository.ts');
    // 老端 `ModelActivity.RequestTakeMonthCardActReward`：`FW.ShowReward(rsp.tlReward)`。
    // `CmdTakeMonthCardActRewardRspMsg` 只有 `tlReward` 一个字段、没有 ret，成功判据是「响应到达」。
    assert.match(repository, /responded = true;/);
    assert.match(repository, /if \(goods && goods\.length > 0\) FW\.ShowReward\(goods\)/);
});

// ============================================================
// 辅助
// ============================================================

/** 造一张最小的月卡（只填本组用例关心的字段）；`dayRewardCount` = 造几条每日奖励。 */
function fakeGift(overrides: Partial<IMonthCardGift> = {}, dayRewardCount = 0): IMonthCardGift {
    const dayRewards = [];
    for (let index = 0; index < dayRewardCount; index++) {
        dayRewards.push({ resId: 7, number: 1, name: '银币', iconArt: '图标_铜币' });
    }
    return {
        plan: overrides.plan ?? 1,
        type: overrides.type ?? MONTH_CARD_TYPE_WELFARE,
        title: overrides.title ?? '福利月卡',
        price: overrides.price ?? 30,
        payId: overrides.payId ?? 9,
        continueDays: overrides.continueDays ?? 30,
        privileges: overrides.privileges ?? [],
        buyReward: overrides.buyReward ?? null,
        dayRewards,
        dotArt: overrides.dotArt ?? MONTHCARD_ART.dotNormal,
    };
}
