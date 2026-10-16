/**
 * 战令（老端 `LayerBattleToken` / FGUI 包「超值战令」）移植的回归网。
 *
 * 分五段，各守一件事：
 *
 *   A. **判定口径**（`BattleTokenTable`，零 import 纯函数）—— 老端这些判定散在
 *      `ModelBattleToken` / `VOBattleToken` / `BattleTokenCodeSharing` / `TabBattleTokenPage`
 *      里（依赖 DI 容器 + FGUI 控制器），没法单测；移植时全收敛成传参纯函数，本段是唯一回归网。
 *   B. **资源口径**（`BattleTokenArt`）—— 三处「查不到就静默不出图」的坑：`resources.load`
 *      少 `/spriteFrame`、`trimType` 裁掉透明边让九宫 border 偏、`BT_ART_SLICED` 漏一张
 *      导致「图照样显示、只是整张被拉伸」。
 *   C. **prefab 结构 + 几何** —— 脚本组件的 `__type__` 必须能从 `*.ts.meta` 反解（防 cid 抄错
 *      成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的画布像素一致。
 *   D. **数据管道接线**（源码文本）—— 三个协议名、缓存读法、超时兜底、入口白名单。
 *   E. **文案表**。
 *
 * 口径真源：
 *   - 配置：`assets/remoteRef/battleToken{Config,Plan,Reward}.json` / `payChannel.json`
 *   - 老端：`client/assets/script/app/game/ctrl/main/battleToken/**`
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/超值战令/**`
 *   - 入口：新项目 `assets/remoteRef/open.json`（`refId = 104`，左列 `belond = 2`，`order = 3`）
 *
 * ⚠️ 两套页签编号（**本模块最大的坑**，见 `BattleTokenTable` 文件头）：
 *   - FGUI `组件_战令.xml` 的 `标签页` 用 **page id**
 *   - FGUI `组件_超值战令.xml` 的 `标签` 用**声明序 index**
 *   而 `CmdBattleTokenType`（1~4）恰好等于「内容页 index + 1」。三套编号一起改才不出错。
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    BT_ART_SLICED,
    BT_ART_NAMES,
    BT_PAGE_ART,
    BT_QUALITY_FRAME_NAMES,
    BT_SPRITE_SIMPLE,
    BT_SPRITE_SLICED,
    btArtPath,
    btPageArtName,
    btPageArtPath,
    btSharedPath,
    BT_SHARED_BACK,
    BT_SHARED_BOTTOM_BAR,
    BT_SHARED_CHECK,
    BT_SHARED_LOCK_MASK,
    btSpriteType,
    qualityFrameLevel,
    qualityFrameName,
} from '../assets/script/app/battletoken/BattleTokenArt';
import {
    BT_BUY_BTN_H,
    BT_BUY_BTN_W,
    BT_BUY_ROW_H,
    BT_BUY_ROW_W,
    BT_CFG_LEVEL_UP_COST,
    BT_CFG_MAX_LEVEL,
    BT_CFG_RESET_COST,
    BT_DEFAULT_TYPE,
    BT_EXP_COST_RES_ID,
    BT_FALLBACK_MAX_LEVEL,
    BT_MAX_LEVEL_EXP,
    BT_PLAN_ADVANCED,
    BT_PLAN_FREE,
    BT_PLAN_NORMAL,
    BT_QIPAO_H,
    BT_SUPPORTED_TYPES,
    BT_TABS,
    BT_TYPE_END,
    BT_TYPE_LEVEL_FUND,
    BT_TYPE_LOTTERY1,
    BT_TYPE_PASS,
    BT_TYPE_SIGN_IN,
    artKeyOf,
    buildLevelRows,
    buyButtonLayout,
    buyButtonPos,
    configNum,
    countdownText,
    currentClaimLv,
    endSecondsOf,
    expMaxOf,
    formatCountdown,
    hasClaimableRedDot,
    hintBoxOf,
    isMaxLevel,
    isSupportedTab,
    isThreePlan,
    jointState,
    pageHintOf,
    parseConfigRows,
    parsePlanRows,
    parseRewardRows,
    planResId,
    planRow,
    plansOfType,
    priceOf,
    qipaoBoxOf,
    remainSeconds,
    rewardSlotState,
    rewardTotals,
    scrollTargetIndex,
    slotCountOf,
    tabIndexOf,
    tabPageIndex,
} from '../assets/script/app/battletoken/BattleTokenTable';
import type { ILevelRow } from '../assets/script/app/battletoken/BattleTokenTable';
import { BT_TEXTS, btCountdownText, btFormat, btMoneyText, btTabLabel, btUnlockHint } from '../assets/script/app/battletoken/BattleTokenTexts';
import { qualityFrameLevel as sevenDayQualityFrameLevel } from '../assets/script/app/sevenDay/SevenDayArt';

/** 读一张 `remoteRef` 表（顶层就是行数组）。 */
function table(name: string): Array<Record<string, unknown>> {
    return JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as Array<Record<string, unknown>>;
}

const PLAN_ROWS = parsePlanRows(table('battleTokenPlan'));
const REWARD_ROWS = parseRewardRows(table('battleTokenReward'));
const CONFIG = parseConfigRows(table('battleTokenConfig'));

const MAX_LEVEL = configNum(CONFIG, BT_CFG_MAX_LEVEL, BT_FALLBACK_MAX_LEVEL);
const LEVEL_UP_COST = configNum(CONFIG, BT_CFG_LEVEL_UP_COST, 0);

/** 每个类型一张奖励表可能被反复取；缓存一下省解析。 */
const ROWS_CACHE = new Map<number, ILevelRow[]>();
function rowsOf(type: number): ILevelRow[] {
    let rows = ROWS_CACHE.get(type);
    if (!rows) {
        rows = buildLevelRows(PLAN_ROWS, REWARD_ROWS, type, MAX_LEVEL);
        ROWS_CACHE.set(type, rows);
    }
    return rows;
}

// ============================================================
// A. 判定口径
// ============================================================

test('类型号常量 = `CmdBattleTokenType`；本轮只做 4 个页签（转盘 5/6 不做）', () => {
    assert.equal(BT_TYPE_END, 1);
    assert.equal(BT_TYPE_SIGN_IN, 2);
    assert.equal(BT_TYPE_LEVEL_FUND, 3);
    assert.equal(BT_TYPE_PASS, 4);
    assert.equal(BT_TYPE_LOTTERY1, 5);
    assert.deepEqual([...BT_SUPPORTED_TYPES], [3, 2, 1, 4], '底栏 4 个页签的屏幕序是 3,2,1,4');
    assert.equal(isSupportedTab(BT_TYPE_END), true);
    assert.equal(isSupportedTab(BT_TYPE_SIGN_IN), true);
    assert.equal(isSupportedTab(BT_TYPE_LEVEL_FUND), true);
    assert.equal(isSupportedTab(BT_TYPE_PASS), true);
    assert.equal(isSupportedTab(BT_TYPE_LOTTERY1), false, '转盘战令走独立 LayerBattleTokenSpin，本轮不做');
    assert.equal(isSupportedTab(6), false);
    assert.equal(isSupportedTab(0), false);
});

test('默认页是通行证（FGUI `按钮_通行证` 带 `checked="true"`，老端第一个 addTab 也是它）', () => {
    assert.equal(BT_DEFAULT_TYPE, BT_TYPE_END);
    assert.equal(tabIndexOf(BT_DEFAULT_TYPE), 2, '通行证在底栏是第 3 个（下标 2）');
    assert.equal(tabIndexOf(BT_TYPE_LOTTERY1), -1, '不支持的类型返回 -1');
});

test('页签的 FGUI 画布 xy = 240/360/480/600（等级基金 / 七日登录 / 通行证 / 过关令）', () => {
    // 真源：`组件_战令.xml` 里 4 个 `按钮_首页_菜单` 的 `xy`。
    assert.deepEqual(
        BT_TABS.map((t) => [t.type, t.x, t.artKey]),
        [[3, 240, 'djjj'], [2, 360, 'qrdl'], [1, 480, 'txz'], [4, 600, 'ggl']],
    );
    assert.deepEqual(BT_TABS.map((t) => t.label), ['等级基金', '七日登录', '通行证', '过关令']);
});

test('⚠️ 两处文案表必须同源：`btTabLabel(type)` 恒等于 `BT_TABS` 的 `label`', () => {
    // 底栏文案有两个来源 —— prefab 上摆的 Label 初值，与运行时 `BattleTokenPage._wireStatic`
    // 用 `btTabLabel(tabType)` 覆写的值。两者写岔了**不报错**，只是运行后悄悄换了个词。
    // 本轮的实例：`BT_TEXTS.tabSignIn` 曾写成「七日签到」（抄了 FGUI 底栏 controller 的页面名），
    // 而真正可见的是「七日登录」（底栏按钮的图标 `类型,21` + 内容页 `标签` + 效果图）。
    for (const tab of BT_TABS) {
        assert.equal(
            btTabLabel(tab.type),
            tab.label,
            `type=${tab.type} 的底栏文案两处不一致（prefab/runtime 会显示不同的字）`,
        );
    }
    assert.equal(btTabLabel(BT_TYPE_SIGN_IN), '七日登录');
    assert.equal(btTabLabel(999), BT_TEXTS.tabEnd, '未知类型退回通行证');
});

test('tabPageIndex：内容页 `标签` 控制器的声明序（转盘 5/6 共用最后一页）', () => {
    // 声明序：通行证(0) / 七日登录(1) / 等级基金(2) / 过关令(3) / 抽奖(4)
    assert.equal(tabPageIndex(BT_TYPE_END), 0);
    assert.equal(tabPageIndex(BT_TYPE_SIGN_IN), 1);
    assert.equal(tabPageIndex(BT_TYPE_LEVEL_FUND), 2);
    assert.equal(tabPageIndex(BT_TYPE_PASS), 3);
    assert.equal(tabPageIndex(BT_TYPE_LOTTERY1), 4);
    assert.equal(tabPageIndex(6), 4);
    // ⚠️ 用断言把「不等于底栏 page id / 不等于 BT_TABS 下标」钉住
    assert.equal(tabPageIndex(3), 2, '等级基金的内容页下标是 2，底栏下标是 0 —— 两套编号别混');
    assert.notEqual(tabPageIndex(BT_TYPE_LEVEL_FUND), tabIndexOf(BT_TYPE_LEVEL_FUND));
});

test('isThreePlan 只有通行证（type=1）为 true —— 表口径印证', () => {
    assert.equal(isThreePlan(BT_TYPE_END), true);
    for (const type of [BT_TYPE_SIGN_IN, BT_TYPE_LEVEL_FUND, BT_TYPE_PASS, BT_TYPE_LOTTERY1, 6]) {
        assert.equal(isThreePlan(type), false, `type=${type} 不该是三个方案`);
    }
    assert.equal(slotCountOf(BT_TYPE_END), 3);
    assert.equal(slotCountOf(BT_TYPE_SIGN_IN), 2);
    // 真源印证：`battleTokenPlan` 里只有 type=1 有 3 个 order
    const ordersOf = (type: number) => plansOfType(PLAN_ROWS, type).map((p) => p.order);
    assert.deepEqual(ordersOf(BT_TYPE_END), [1, 2, 3]);
    assert.deepEqual(ordersOf(BT_TYPE_SIGN_IN), [1, 2]);
    assert.deepEqual(ordersOf(BT_TYPE_LEVEL_FUND), [1, 2]);
    assert.deepEqual(ordersOf(BT_TYPE_PASS), [1, 2]);
});

test('artKeyOf：未知类型退回默认页（通行证 txz），不返回 undefined', () => {
    assert.equal(artKeyOf(BT_TYPE_END), 'txz');
    assert.equal(artKeyOf(BT_TYPE_SIGN_IN), 'qrdl');
    assert.equal(artKeyOf(BT_TYPE_LEVEL_FUND), 'djjj');
    assert.equal(artKeyOf(BT_TYPE_PASS), 'ggl');
    assert.equal(artKeyOf(999), 'txz');
});

test('方案解析：`planResId` 找不到时返回 **1**（照抄老端的怪癖），`planRow` 返回 null', () => {
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_END, BT_PLAN_FREE), 1);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_END, BT_PLAN_NORMAL), 2);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_END, BT_PLAN_ADVANCED), 3);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_SIGN_IN, BT_PLAN_NORMAL), 5);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_LEVEL_FUND, BT_PLAN_NORMAL), 7);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_PASS, BT_PLAN_NORMAL), 9);
    // 找不到 ⇒ 1（不是 0 / -1）；下游 `getRef("resId", 1)` 会命中免费档，不至于崩
    assert.equal(planResId(PLAN_ROWS, 999, 1), 1);
    assert.equal(planResId(PLAN_ROWS, BT_TYPE_END, 9), 1);
    assert.equal(planRow(PLAN_ROWS, 999, 1), null);
    assert.equal(planRow(PLAN_ROWS, BT_TYPE_END, BT_PLAN_ADVANCED)?.rmb, 8);
});

test('`plansOfType` 按 order 升序；未知类型返回空数组（不是 undefined）', () => {
    assert.deepEqual(plansOfType(PLAN_ROWS, BT_TYPE_END).map((p) => p.order), [1, 2, 3]);
    assert.deepEqual(plansOfType(PLAN_ROWS, 999), []);
});

test('priceOf 三态：`rmb>0` → rmb；`rmb=0` 且带道具 → item；其余 free', () => {
    // 通行证方案 1 = 免费
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_END, BT_PLAN_FREE)), { kind: 'free', rmb: 0, resId: 0, num: 0 });
    // 通行证方案 2：`rmb = 7` ⇒ 走 payChannel 查金额（不是直接显示 7）
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_END, BT_PLAN_NORMAL)), { kind: 'rmb', rmb: 7, resId: 0, num: 0 });
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_END, BT_PLAN_ADVANCED)), { kind: 'rmb', rmb: 8, resId: 0, num: 0 });
    // 七日登录 / 等级基金
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_SIGN_IN, BT_PLAN_NORMAL)), { kind: 'rmb', rmb: 15, resId: 0, num: 0 });
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_LEVEL_FUND, BT_PLAN_NORMAL)), { kind: 'rmb', rmb: 16, resId: 0, num: 0 });
    // ⚠️ 过关令方案 2 是**道具支付**：680 个 resId=10（金币）
    assert.deepEqual(priceOf(planRow(PLAN_ROWS, BT_TYPE_PASS, BT_PLAN_NORMAL)), { kind: 'item', rmb: 0, resId: 10, num: 680 });
    assert.deepEqual(priceOf(null), { kind: 'free', rmb: 0, resId: 0, num: 0 });
    // 只有一半的字段（有 resId 没数量）也算 free —— 老端也不会去扣 0 个道具
    assert.deepEqual(priceOf({ resId: 1, type: 1, order: 1, rmb: 0, openCostItemResId: 10, openCostItemNum: 0, rewardPlan: 1 }), { kind: 'free', rmb: 0, resId: 0, num: 0 });
});

test('`battleTokenPlan.rmb` 是 `payChannel.id`，必须过表才能拿到金额', () => {
    const pay = new Map(table('payChannel').map((r) => [Number(r.id), r]));
    const expect: ReadonlyArray<readonly [number, number, string]> = [
        [7, 30, '战令1档'],
        [8, 98, '战令2档'],
        [15, 12, '七日签到战令'],
        [16, 68, '等级基金'],
    ];
    for (const [id, rmb, name] of expect) {
        const row = plansOfType(PLAN_ROWS, BT_TYPE_END).concat(plansOfType(PLAN_ROWS, BT_TYPE_SIGN_IN), plansOfType(PLAN_ROWS, BT_TYPE_LEVEL_FUND))
            .find((p) => p.rmb === id);
        assert.ok(row, `battleTokenPlan 里应当有 rmb=${id} 的方案`);
        const channel = pay.get(id);
        assert.ok(channel, `payChannel 里没有 id=${id}`);
        assert.equal(Number(channel!.rmb), rmb, `${name} 的人民币档位`);
    }
    // 过关令两个方案都不花钱（rmb = 0），方案 2 用道具
    assert.deepEqual(plansOfType(PLAN_ROWS, BT_TYPE_PASS).map((p) => p.rmb), [0, 0]);
});

test('等级 / 经验口径：满级写死 1000，其余读配置（本次表实测 50）', () => {
    assert.equal(MAX_LEVEL, 50, 'battleTokenConfig.maxLevel');
    assert.equal(LEVEL_UP_COST, 50, 'battleTokenConfig.levelUpCostEnd');
    assert.equal(configNum(CONFIG, BT_CFG_RESET_COST, 0), 1000, 'battleTokenConfig.resetNeedCostEnd');
    assert.equal(BT_MAX_LEVEL_EXP, 1000);
    assert.equal(BT_FALLBACK_MAX_LEVEL, 50);

    assert.equal(isMaxLevel(49, 50), false);
    assert.equal(isMaxLevel(50, 50), true);
    assert.equal(isMaxLevel(51, 50), true);
    // 没满级 ⇒ 读表里的 50；满级 ⇒ 写死 1000（老端 `VOBattleToken.GetExpMax()`）
    assert.equal(expMaxOf(49, 50, 50), 50);
    assert.equal(expMaxOf(50, 50, 50), BT_MAX_LEVEL_EXP);
});

test('`parseConfigRows` 保留原始类型 —— `lotterylevelUpCostEnd` 的 value 是字符串 "10"', () => {
    assert.equal(CONFIG.get('lotterylevelUpCostEnd'), '10');
    assert.equal(typeof CONFIG.get('lotterylevelUpCostEnd'), 'string');
    assert.equal(configNum(CONFIG, 'lotterylevelUpCostEnd', 0), 10, 'configNum 要能吃字符串');
    // 缺失 / 非数字一律用兜底，不返回 NaN
    assert.equal(configNum(CONFIG, 'noSuchKey', 42), 42);
    assert.equal(configNum(parseConfigRows([{ key: 'x', value: 'abc' }]), 'x', 7), 7);
    assert.equal(configNum(parseConfigRows([{ key: '', value: 1 }]), '', 7), 7, '空 key 不入表');
});

test('`parsePlanRows` 丢掉没有 resId 的行并排序；`parseRewardRows` 只读 `reward[0]`', () => {
    const plans = parsePlanRows([
        { resId: 0, type: 1, order: 1 },
        { resId: 5, type: 2, order: 2, rmb: '7' },
        { resId: 2, type: 1, order: 3 },
        null,
        'nope',
        { resId: 3, type: 1, order: 1 },
    ]);
    assert.deepEqual(plans.map((p) => p.resId), [3, 2, 5], '按 type 再按 order 排序');
    assert.equal(plans[2]!.rmb, 7, '字符串数字要转成 number');

    const rewards = parseRewardRows([
        { plan: 1, level: 2, reward: [{ resId: 7, number: 100 }, { resId: 8, number: 1 }] },
        { plan: 1, level: 0, reward: [{ resId: 7, number: 1 }] },
        { plan: 0, level: 1, reward: [{ resId: 7, number: 1 }] },
        { plan: 1, level: 3 },
        null,
    ]);
    assert.deepEqual(rewards, [
        { plan: 1, level: 2, resId: 7, number: 100 },
        // ⚠️ `reward` 整个缺失的行**照样入表**，只是 resId/number 都取 0
        // ⇒ 下游 `_iconPathOf(0)` 返回 null ⇒ 该格静默只剩品质框（真实表里不会出现，
        //    但别把它当「会被丢掉」来写逻辑）
        { plan: 1, level: 3, resId: 0, number: 0 },
    ], '老端也只读 reward[0]');
    // 真实表：`reward` 是单元素数组
    const real = table('battleTokenReward');
    assert.equal(Array.isArray(real[0]!.reward), true);
    assert.equal((real[0]!.reward as unknown[]).length, 1);
});

test('buildLevelRows：行数 = min(该类型各方案奖励表最短行数, maxLevel)', () => {
    // 真实表行数：通行证 / 等级基金 / 过关令 = 50，七日登录 = 7
    assert.equal(rowsOf(BT_TYPE_END).length, 50);
    assert.equal(rowsOf(BT_TYPE_LEVEL_FUND).length, 50);
    assert.equal(rowsOf(BT_TYPE_PASS).length, 50);
    assert.equal(rowsOf(BT_TYPE_SIGN_IN).length, 7, '七日登录只有 7 级');

    const rows = rowsOf(BT_TYPE_END);
    assert.equal(rows[0]!.index, 0);
    assert.equal(rows[0]!.max, 50);
    assert.deepEqual(rows[0]!.resIds.length, 3, '通行证每行 3 个格子');
    assert.deepEqual(rowsOf(BT_TYPE_SIGN_IN)[0]!.resIds.length, 2);

    // `maxLevel` 压得过奖励表行数时以 maxLevel 为准
    assert.equal(buildLevelRows(PLAN_ROWS, REWARD_ROWS, BT_TYPE_END, 10).length, 10);
    // 没有方案的类型返回空数组
    assert.deepEqual(buildLevelRows(PLAN_ROWS, REWARD_ROWS, 999, 50), []);
    assert.deepEqual(buildLevelRows(PLAN_ROWS, [], BT_TYPE_END, 50), []);
});

test('`resIds[order-1]` 才是该方案在这一级的奖励（老端按方案循环填充）', () => {
    const rows = rowsOf(BT_TYPE_END);
    const lv1 = rows[0]!;
    // 逐方案从原表核对
    for (const plan of plansOfType(PLAN_ROWS, BT_TYPE_END)) {
        const src = REWARD_ROWS.find((r) => r.plan === plan.rewardPlan && r.level === 1);
        assert.ok(src, `rewardPlan=${plan.rewardPlan} 缺 level=1`);
        assert.equal(lv1.resIds[plan.order - 1], src!.resId, `order=${plan.order} 的 resId 位置不对`);
        assert.equal(lv1.numbers[plan.order - 1], src!.number);
    }
});

test('rewardSlotState：五个布尔 + 「`tlTakeLevel` 缺失」与「空数组」语义不同', () => {
    // ① 未开（cmd.open=false）⇒ 全部不可点、按等级压暗
    assert.deepEqual(rewardSlotState(false, null, 5, 0), {
        unlocked: false, taken: false, claimable: false, canTake: false, masked: false,
    });
    // ② 开了 + 等级到 + 有 tlTakeLevel 且不含本行 ⇒ 可领取（红点）
    assert.deepEqual(rewardSlotState(true, [1, 2], 3, 2), {
        unlocked: true, taken: false, claimable: true, canTake: true, masked: false,
    });
    // ③ 开了 + 等级到 + tlTakeLevel 含本行 ⇒ 已领取，不能点
    assert.deepEqual(rewardSlotState(true, [1, 2, 3], 3, 2), {
        unlocked: true, taken: true, claimable: false, canTake: false, masked: false,
    });
    // ④ 老端那个「看着多余」的分支：`tlTakeLevel` 字段缺失 ⇒ 能点但**没有红点**
    assert.deepEqual(rewardSlotState(true, null, 3, 2), {
        unlocked: true, taken: false, claimable: false, canTake: true, masked: false,
    });
    // ⑤ 等级没到 ⇒ 压暗，且即使开了也不能点
    assert.deepEqual(rewardSlotState(true, [], 1, 2), {
        unlocked: true, taken: false, claimable: false, canTake: false, masked: true,
    });
    // 「空数组」与「null」不同：空数组 ⇒ 有字段 ⇒ 可领且有红点
    assert.equal(rewardSlotState(true, [], 3, 0).claimable, true);
    assert.equal(rewardSlotState(true, null, 3, 0).claimable, false);
    // 边界：level == index 不算到（`level > index`）
    assert.equal(rewardSlotState(true, [], 2, 2).masked, true);
    assert.equal(rewardSlotState(true, [], 3, 2).masked, false);
});

test('jointState：`topExist/bottomExist` = 「上面/下面还有行」；`topLit/bottomLit` = 已达成', () => {
    // 老端 `renderItem`：index==0 ⇒ 「尾=是」；index==max-1 ⇒ 「头=是」；否则两个都「是」
    // （见 `BattleTokenCodeSharing.renderItem` 全段）
    assert.deepEqual(jointState(0, 5, 0), { topExist: false, bottomExist: true, topLit: false, bottomLit: false, unlocked: false });
    assert.deepEqual(jointState(2, 5, 3), { topExist: true, bottomExist: true, topLit: true, bottomLit: true, unlocked: true });
    assert.deepEqual(jointState(4, 5, 5), { topExist: true, bottomExist: false, topLit: true, bottomLit: false, unlocked: true });
    // 单行：两头都没有
    assert.deepEqual(jointState(0, 1, 0), { topExist: false, bottomExist: false, topLit: false, bottomLit: false, unlocked: false });
    // 点亮条件恒为 `level > index`；没达成时「存在但不亮」
    const notReached = jointState(2, 5, 2);
    assert.equal(notReached.topExist && notReached.bottomExist, true);
    assert.equal(notReached.topLit, false);
    assert.equal(notReached.bottomLit, false);
});

test('currentClaimLv / scrollTargetIndex / hasClaimableRedDot 三处口径一致', () => {
    const rows = rowsOf(BT_TYPE_END).slice(0, 5);
    // 等级 3、方案 1 开、已领 1/2 ⇒ 第 3 级可领 ⇒ 返回 3
    assert.equal(currentClaimLv(rows, 3, [true, false, false], [[1, 2], null, null]), 3);
    // 全领完 ⇒ 找不到可领取的，退回 `level`
    assert.equal(currentClaimLv(rows, 3, [true, false, false], [[1, 2, 3], null, null]), 3);
    // 没有方案开着 ⇒ 退回 `level`
    assert.equal(currentClaimLv(rows, 3, [false, false, false], [[], null, null]), 3);
    // ⚠️ `tlTakeLevel` **字段缺失**（`null`）时两个函数**故意不同**，别把它当 bug 改齐：
    //    - `currentClaimLv` 把「缺字段」当成可领 ⇒ 返回第 1 行（它是「该滚到哪一行」的目标，
    //      宁可多滚一格也不能不动；老端这里直接 `tlTakeLevel.includes(...)`，字段缺了会**抛错**）；
    //    - `hasClaimableRedDot` 要求「有字段」才算红点 ⇒ false（与 `rewardSlotState` 的
    //      「能点但没红点」一致：`canTake=true` / `claimable=false`）。
    assert.equal(currentClaimLv(rows, 3, [true], [null]), 1);
    assert.equal(hasClaimableRedDot(rows, 3, [true], [null]), false);
    // 有 `tlTakeLevel` 字段时它才是第 4 行（已领 1~3 ⇒ 下一个是 level 4，但 level=3 没到 ⇒ 退回 level）
    assert.equal(currentClaimLv(rows, 3, [true], [[1, 2, 3]]), 3);
    assert.equal(currentClaimLv(rows, 4, [true], [[1, 2, 3]]), 4, '等级到 4 后第 4 行可领');
    assert.equal(currentClaimLv(rows, 3, [true], [[]]), 1);

    // 滚动目标：`level < 3` 归 0（老端界面层 `UpdateList`），且不超过 `max-1`
    assert.equal(scrollTargetIndex(0, 50), 0);
    assert.equal(scrollTargetIndex(2, 50), 0);
    assert.equal(scrollTargetIndex(3, 50), 3);
    assert.equal(scrollTargetIndex(999, 50), 49);
    assert.equal(scrollTargetIndex(999, 0), -1);

    // 红点：只认「有 tlTakeLevel 字段且不含本行」的那些
    assert.equal(hasClaimableRedDot(rows.slice(0, 1), 1, [true], [[]]), true);
    assert.equal(hasClaimableRedDot(rows.slice(0, 1), 1, [true], [[1]]), false);
    assert.equal(hasClaimableRedDot(rows.slice(0, 1), 1, [true], [null]), false, '缺字段不算红点');
    assert.equal(hasClaimableRedDot(rows.slice(0, 1), 0, [true], [[]]), false, '等级没到不算红点');
    assert.equal(hasClaimableRedDot(rows.slice(0, 1), 1, [false], [[]]), false, '方案没开不算红点');
    // 三个函数的判据必须一致（改一个忘一个就会「有红点但点不动」）。
    // 只跑**非 null** 的情形 —— null 那条分叉上面已单独钉住。
    for (const [level, opened, taken] of [
        [3, [true], [[]]],
        [3, [true], [[1, 2, 3]]],
        [3, [false], [[]]],
        [0, [true], [[]]],
        [4, [true], [[1, 2, 3]]],
        [4, [true], [[1]]],
    ] as const) {
        const flags = opened as readonly boolean[];
        const takens = taken as readonly (readonly number[])[];
        // 独立算一遍「有没有可领的」——不复用被测函数
        const expectedRed = rows.some(
            (row) => flags[0]! && level > row.index && !takens[0]!.includes(row.index + 1),
        );
        const label = `level=${level} opened=${JSON.stringify(opened)} taken=${JSON.stringify(taken)}`;
        assert.equal(hasClaimableRedDot(rows, level, opened, taken), expectedRed, `${label}：红点判据`);
        const claimLv = currentClaimLv(rows, level, opened, taken);
        if (expectedRed) {
            assert.ok(claimLv >= 1 && claimLv <= level, `${label}：claimLv=${claimLv} 应落在 [1, level]`);
            assert.equal(takens[0]!.includes(claimLv), false, `${label}：claimLv 指向的那一级已领过`);
        } else {
            assert.equal(claimLv, level, `${label}：找不到可领的应退回 level`);
        }
    }
});

test('rewardTotals：按 resId 汇总某个方案前 `maxLevel` 级的奖励', () => {
    // 七日登录方案 1（免费档）
    const plan = planRow(PLAN_ROWS, BT_TYPE_SIGN_IN, BT_PLAN_FREE)!;
    const totals = rewardTotals(REWARD_ROWS, plan.rewardPlan, MAX_LEVEL);
    const expected = new Map<number, number>();
    for (const r of REWARD_ROWS) {
        if (r.plan !== plan.rewardPlan || r.level > MAX_LEVEL) continue;
        expected.set(r.resId, (expected.get(r.resId) ?? 0) + r.number);
    }
    assert.deepEqual(
        totals,
        [...expected.entries()].map(([resId, number]) => ({ resId, number })),
    );
    // maxLevel 截断
    const half = rewardTotals(REWARD_ROWS, plan.rewardPlan, 3);
    assert.ok(half.length > 0 && half.length <= totals.length);
    assert.deepEqual(rewardTotals(REWARD_ROWS, 999, 50), [], '没有的方案返回空数组');
});

test('购买行：按钮尺寸 193×74 落在 720×71 的容器里（会向上溢出 3px，照抄 FGUI）', () => {
    assert.equal(BT_BUY_BTN_W, 193);
    assert.equal(BT_BUY_BTN_H, 74);
    assert.equal(BT_BUY_ROW_W, 720);
    assert.equal(BT_BUY_ROW_H, 71);
    assert.ok(BT_BUY_BTN_H > BT_BUY_ROW_H, '按钮比容器高 —— 这是 FGUI 原稿的溢出，不是笔误');
});

test('buyButtonLayout：两组 `gearXY` 的**值序是「两个 | 三个」**，且都整体居中', () => {
    // FGUI `组件_战令_标签组合.xml`：
    //   免费  gearXY pages="0,1" values="109,-3|58,-1"
    //   方案1 gearXY pages="0,1" values="440,-4|287,-2"
    //   方案2 gearDisplay pages="1"（只在三个时出现）+ xy="496,-2"
    const three = buyButtonLayout(true);
    const two = buyButtonLayout(false);
    assert.deepEqual(
        three.map((b) => (b ? [b.left, b.top, b.w, b.h] : null)),
        [[58, -1, 193, 74], [287, -2, 193, 74], [496, -2, 193, 74]],
    );
    assert.deepEqual(
        two.map((b) => (b ? [b.left, b.top, b.w, b.h] : null)),
        [[109, -3, 193, 74], [440, -4, 193, 74], null],
        '两个方案的形态下第三个按钮是 null（隐藏），不是坐标 0',
    );
    // 两组都整体居中：两个时 109..633、三个时 58..689
    const span = (list: readonly ({ left: number; w: number } | null)[]) => {
        const live = list.filter((b): b is { left: number; w: number } => !!b);
        return [live[0]!.left, live[live.length - 1]!.left + live[live.length - 1]!.w];
    };
    assert.deepEqual(span(three), [58, 689]);
    assert.deepEqual(span(two), [109, 633]);
});

test('buyButtonPos：容器与按钮同为 (0.5,0.5) ⇒ `pos = 子中心 − 父中心`（四组整数解）', () => {
    // 与 `tmp/gen_battletoken.mjs` 里的硬编码期望值对账（两套实现必须同结果）
    assert.deepEqual([0, 1, 2].map((i) => buyButtonPos(true, i)), [
        { x: -205.5, y: -0.5 },
        { x: 23.5, y: 0.5 },
        { x: 232.5, y: 0.5 },
    ]);
    assert.deepEqual([0, 1].map((i) => buyButtonPos(false, i)), [
        { x: -154.5, y: 1.5 },
        { x: 176.5, y: 2.5 },
    ]);
    // 三个方案时的第 3 个按钮在「两个方案」下不存在
    assert.equal(buyButtonPos(false, 2), null);
    assert.equal(buyButtonPos(true, 3), null);
    // 反解回画布：三个时 58/287/496，两个时 109/440（中心 371 附近）
    for (const three of [true, false]) {
        buyButtonLayout(three).forEach((box, i) => {
            if (!box) return;
            const pos = buyButtonPos(three, i)!;
            assert.equal(pos.x + BT_BUY_ROW_W / 2 - box.w / 2, box.left, '反解回左边缘必须等于 FGUI 原值');
            assert.equal(BT_BUY_ROW_H / 2 - pos.y - box.h / 2, box.top, '反解回上边缘必须等于 FGUI 原值');
        });
    }
});

test('formatCountdown / remainSeconds / countdownText 口径', () => {
    assert.equal(formatCountdown(0), '00:00:00');
    assert.equal(formatCountdown(59), '00:00:59');
    assert.equal(formatCountdown(3600), '01:00:00');
    assert.equal(formatCountdown(9000), '02:30:00');
    // 老端 `TimeUtil.timeSec2HMSStr2` 的「有天才带天数」
    assert.equal(formatCountdown(86400 + 9000), '1天02:30:00');
    assert.equal(formatCountdown(2 * 86400 + 9 * 3600 + 2 * 60), '2天09:02:00');
    assert.equal(formatCountdown(-1), '活动已结束');
    assert.equal(formatCountdown(Number.NaN), '活动已结束');
    assert.equal(formatCountdown(12.9), '00:00:12', '小数向下取整');

    assert.equal(remainSeconds(1000, 900), 100);
    assert.equal(remainSeconds(0, 900), 0, 'endSeconds = 0（读不到）时返回 0，不是负数');
    assert.equal(remainSeconds(Number.NaN, 1), 0);

    assert.equal(countdownText(1000, 900), '活动倒计时:00:01:40');
    assert.equal(countdownText(900, 1000), '活动已结束', '已过期时整句替换');
    assert.equal(countdownText(0, 0), '活动倒计时:00:00:00');
});

test('`endSecondsOf`：`endTime` 是 Long（毫秒）⇒ 必须走字符串再除 1000，禁 `Number(Long)`', () => {
    assert.equal(endSecondsOf(1_700_000_000_000), 1_700_000_000);
    assert.equal(endSecondsOf('1700000000000'), 1_700_000_000);
    assert.equal(endSecondsOf(null), 0);
    assert.equal(endSecondsOf(undefined), 0);
    assert.equal(endSecondsOf('abc'), 0);
    // 伪 Long（真实 `Long` 的 `toString()` 返回十进制字符串）
    assert.equal(endSecondsOf({ toString: () => '1700000000000' }), 1_700_000_000);
    assert.equal(endSecondsOf({}), 0, '`[object Object]` 要当读不到处理，不能变 NaN');
    // ⚠️ 超过 2^53 的毫秒值：走 number 会丢精度，走字符串不会
    const big = '9007199254740993'; // 2^53 + 1
    assert.notEqual(String(Number(big)), big, '`Number(big)` 在这里已经丢精度');
    assert.equal(endSecondsOf(big), 9007199254740992 / 1000);
});

test('页头说明文案：`gearText` 只给了 3 页 + default（default 落在通行证）', () => {
    assert.equal(pageHintOf(BT_TYPE_SIGN_IN), '持续登录 每日领取丰厚奖励');
    assert.equal(pageHintOf(BT_TYPE_LEVEL_FUND), '努力提升角色等级 \n解锁丰厚奖励');
    assert.equal(pageHintOf(BT_TYPE_PASS), '努力通过更多层 \n解锁丰厚奖励');
    assert.equal(pageHintOf(BT_TYPE_END), '消耗体力来提升战令等级！', 'default ⇒ 通行证');
    assert.equal(pageHintOf(999), '消耗体力来提升战令等级！');
});

test('⚠️ hintBoxOf：说明文字框按页签变尺寸，**七日登录走 `gearSize` 的 default `425,42`**', () => {
    // FGUI `n13` 的 `gearSize controller="标签" pages="1,2,0,5"` ⇒ 只列了
    // 通行证(1) / 等级基金(2) / 过关令(0) / 抽奖(5)，**七日登录(3) 不在里面**。
    // 不跟着改的症状：把「持续登录 每日领取丰厚奖励」折进 230 宽 ⇒ 静默变两行 / 缩小字号。
    assert.deepEqual(hintBoxOf(BT_TYPE_END), { w: 230, h: 71 });
    assert.deepEqual(hintBoxOf(BT_TYPE_LEVEL_FUND), { w: 251, h: 79 });
    assert.deepEqual(hintBoxOf(BT_TYPE_PASS), { w: 221, h: 79 });
    assert.deepEqual(hintBoxOf(BT_TYPE_SIGN_IN), { w: 425, h: 42 }, '七日登录是 default，不是 230×71');
    assert.notDeepEqual(hintBoxOf(BT_TYPE_SIGN_IN), hintBoxOf(BT_TYPE_END));
    assert.equal(hintBoxOf(999).w, 425, '未知类型也退回 default');
});

test('⚠️ qipaoBoxOf：气泡只有七日登录是 378 宽；高度恒 195（`scale (1,0.6)` 由 prefab 承担）', () => {
    // FGUI `n141` 的 `gearSize pages="1,3" values="330,195,1,0.6|378,195,1,0.6" default="330,195,1,0.6"`
    assert.equal(BT_QIPAO_H, 195);
    assert.deepEqual(qipaoBoxOf(BT_TYPE_SIGN_IN), { w: 378, h: 195 });
    for (const type of [BT_TYPE_END, BT_TYPE_LEVEL_FUND, BT_TYPE_PASS, 999]) {
        assert.deepEqual(qipaoBoxOf(type), { w: 330, h: 195 });
    }
    // ⚠️ 别把 195 改成 117（那是 `195 × 0.6` 的显示高）—— prefab 上的 `scale.y = 0.6` 会再压一次
    assert.notEqual(BT_QIPAO_H, 117);
    // 气泡必须装得下说明文字 —— **三个「有列在 gearSize 里」的页成立**。
    // ⚠️ 七日登录那页**故意不成立**：说明文字框是 `default 425,42`（比其它页宽得多），
    //    而气泡是 378 —— 文字框是布局框、`align=center` 且实际字形远窄于 425，FGUI 原稿就这样，
    //    别为了「装得下」把 378 改成 425（那会让气泡横向撑开 47px）。
    for (const type of [BT_TYPE_END, BT_TYPE_LEVEL_FUND, BT_TYPE_PASS]) {
        const bubble = qipaoBoxOf(type);
        const hint = hintBoxOf(type);
        assert.ok(bubble.w >= hint.w, `type=${type}：气泡比说明文字还窄`);
        assert.ok(bubble.h * 0.6 >= hint.h, `type=${type}：气泡显示高装不下说明文字`);
    }
    assert.ok(qipaoBoxOf(BT_TYPE_SIGN_IN).w < hintBoxOf(BT_TYPE_SIGN_IN).w, '七日登录的例外是 FGUI 原样');
});

// ============================================================
// B. 资源口径
// ============================================================

const BT_ART_DIR = 'assets/resources/image/battletoken';

/** 战令自有图是否在磁盘上（`.png` / `.jpg` 都算 —— `bt_bg` 是 jpg）。 */
function artExists(name: string): boolean {
    return ['png', 'jpg', 'jpeg'].some((ext) => existsSync(`${BT_ART_DIR}/${name}.${ext}`));
}

/** 读一张图的 `subMetas.f9941.userData`（spriteFrame 的 border / trim 都写在这儿）。 */
function spriteUserData(dir: string, name: string): Record<string, unknown> {
    for (const ext of ['png', 'jpg', 'jpeg']) {
        const file = `${dir}/${name}.${ext}.meta`;
        if (!existsSync(file)) continue;
        const meta = JSON.parse(readFileSync(file, 'utf8')) as {
            subMetas: Record<string, { userData: Record<string, unknown> }>;
        };
        return meta.subMetas.f9941!.userData;
    }
    throw new Error(`找不到 ${dir}/${name}.*.meta`);
}

test('`BT_ART_NAMES` 里的每张图都在磁盘上（名字写错 = 静默留白）', () => {
    const missing = Object.entries(BT_ART_NAMES)
        .filter(([, name]) => !artExists(name))
        .map(([key, name]) => `${key}→${name}`);
    assert.deepEqual(missing, [], `这些战令自有图没落盘：${missing.join(', ')}`);
    // 数量受控：改表的人得显式改这里
    assert.equal(Object.keys(BT_ART_NAMES).length, 15);
});

test('`bt_bg` 在磁盘上是 **`.jpg`**（FGUI 源扩展名骗人，文件头是 `ffd8ffe1`）', () => {
    assert.equal(BT_ART_NAMES.bg, 'bt_bg');
    assert.equal(existsSync(`${BT_ART_DIR}/bt_bg.jpg`), true);
    assert.equal(existsSync(`${BT_ART_DIR}/bt_bg.png`), false, '别把它当 png 再存一份');
    // `resources.load` 按不带扩展名的资源名找，所以调用方不受影响
    assert.equal(btArtPath('bg'), 'image/battletoken/bt_bg/spriteFrame');
});

test('页头三件套：4 个页签 × 3 张图全部落盘，且文件名严格 = `bt_<artKey>_<part>`', () => {
    assert.deepEqual(Object.keys(BT_PAGE_ART).sort(), ['djjj', 'ggl', 'qrdl', 'txz']);
    const missing: string[] = [];
    for (const tab of BT_TABS) {
        for (const part of ['title', 'headbg', 'hero'] as const) {
            const name = btPageArtName(tab.artKey, part);
            assert.equal(name, `bt_${tab.artKey}_${part}`, '命名约定：bt_<artKey>_<part>');
            if (!artExists(name)) missing.push(name);
        }
    }
    assert.deepEqual(missing, [], `页头图没落盘：${missing.join(', ')}`);
    // 未知 artKey 退回默认页（通行证）
    assert.equal(btPageArtName('nope', 'hero'), 'bt_txz_hero');
});

test('品质框：4 档，**必须与七日 / 礼包 / 活动 / 首充同算法**（跨 5 个模块的约定）', () => {
    assert.deepEqual([...BT_QUALITY_FRAME_NAMES], [
        'common_img_pzk_01', 'common_img_pzk_02', 'common_img_pzk_03', 'common_img_pzk_04',
    ]);
    // ⚠️ 实际映射有个「看着像 off-by-one」的既成约定：`clamp(quality - 1, 1, 4)`
    //    ⇒ 品质 1 与 2 **都**落框 01；3→02、4→03、5+→04。
    //    它在 sevenDay / gift / activity / firstRecharge / battletoken **五个模块里逐字相同**，
    //    要改就是跨模块改，别在这里单独「修正」。
    assert.deepEqual(
        [0, 1, 2, 3, 4, 5, 9].map((q) => qualityFrameLevel(q)),
        [1, 1, 1, 2, 3, 4, 4],
    );
    assert.equal(qualityFrameName(3), 'common_img_pzk_02', '品质 3 ⇒ 框 02');
    assert.equal(qualityFrameName(5), 'common_img_pzk_04', '品质 5+ ⇒ 框 04');
    // 跨模块逐值对账（不是比源码文本，比行为）
    for (const q of [0, 1, 2, 3, 4, 5, 9, 100]) {
        assert.equal(
            qualityFrameLevel(q),
            sevenDayQualityFrameLevel(q),
            `quality=${q} 时与 SevenDayArt 的算法不一致（五个模块必须一致）`,
        );
    }
    for (const name of BT_QUALITY_FRAME_NAMES) {
        assert.ok(existsSync(`assets/resources/image/frame/${name}.png`), `品质框缺图：${name}`);
    }
});

test('跨模块复用的 4 张（不另存第二份，md5 同源）', () => {
    assert.deepEqual(BT_SHARED_BOTTOM_BAR, { root: 'image/gift', name: 'gf_bottom_bar' });
    assert.deepEqual(BT_SHARED_BACK, { root: 'image/gift', name: 'gf_btn_back' });
    assert.deepEqual(BT_SHARED_LOCK_MASK, { root: 'image/sevenDay', name: 'sd_bb24' });
    assert.deepEqual(BT_SHARED_CHECK, { root: 'image/sevenDay', name: 'sd_check' });
    for (const ref of [BT_SHARED_BOTTOM_BAR, BT_SHARED_BACK, BT_SHARED_LOCK_MASK, BT_SHARED_CHECK]) {
        assert.ok(existsSync(`assets/resources/${ref.root}/${ref.name}.png`), `复用图丢了：${ref.root}/${ref.name}`);
        // ⚠️ 复用图**不能**在战令目录里再存一份（改一处忘一处）
        assert.equal(artExists(ref.name), false, `${ref.name} 不该出现在 ${BT_ART_DIR}`);
    }
});

test('⚠️ 「已消耗：」的小图标（`costIcon` / 体力 9）必须落盘 —— 它是 `roleProperty` 那一支，整条链上没有第二处守卫', () => {
    // ⚠️ 2026-09-24 端到端探针逮到的**真缺口**：`roleProperty` 的图标迁到
    //    `assets/resources/icons/resource/` 时，铜币 / 洗炼石 / 幻灵玉 / 活跃度 / 灵石 都迁了，
    //    **偏偏漏了体力（resId 9）** ⇒ `resources.load('icons/resource/图标_体力/spriteFrame')`
    //    失败、`_setFrame` 静默跳过 ⇒ 消耗图标永久留白（不报错、prefab 校验也全绿）。
    assert.equal(BT_EXP_COST_RES_ID, 9, '老端 `TabBattleTokenPage` 写死 `roleProperty.end`');

    const rows = JSON.parse(readFileSync('assets/remoteRef/roleProperty.json', 'utf8')) as Record<string, unknown>;
    const raw = Object.values(rows);
    const row = raw.find((r) => r && typeof r === 'object'
        && Number((r as Record<string, unknown>).resId) === BT_EXP_COST_RES_ID) as Record<string, unknown>;
    assert.ok(row, `roleProperty 里没有 resId = ${BT_EXP_COST_RES_ID}`);
    assert.equal(row.name, '体力');
    assert.equal(row.icon, '图标_体力', '`icon` 存的是 FGUI 裸名 ⇒ 落 icons/resource/<name>');
    // 落盘（含 `.meta`，否则进不了包）
    assert.equal(existsSync('assets/resources/icons/resource/图标_体力.png'), true);
    assert.equal(existsSync('assets/resources/icons/resource/图标_体力.png.meta'), true);
});

test('⚠️ 所有装配路径都必须带 `/spriteFrame`（漏了只是静默留白 + 一条 warn）', () => {
    // 规则 57：`resources.load` 取图必须带 `/spriteFrame`，裸路径报
    // `Bundle resources doesn\'t contain xxx`。
    const paths: string[] = [];
    for (const key of Object.keys(BT_ART_NAMES)) {
        const p = btArtPath(key);
        assert.ok(p, `btArtPath(${key}) 不该是 null`);
        paths.push(p!);
    }
    for (const tab of BT_TABS) {
        for (const part of ['title', 'headbg', 'hero'] as const) paths.push(btPageArtPath(tab.artKey, part));
    }
    for (const ref of [BT_SHARED_BOTTOM_BAR, BT_SHARED_BACK, BT_SHARED_LOCK_MASK, BT_SHARED_CHECK]) {
        paths.push(btSharedPath(ref));
    }
    for (const p of paths) {
        assert.ok(p.endsWith('/spriteFrame'), `路径没带 /spriteFrame：${p}`);
        assert.ok(p.startsWith('image/') || p.startsWith('icons/'), `路径根不对：${p}`);
    }
    assert.equal(btArtPath('noSuchKey'), null);
});

test('⚠️ 九宫 border 与 FGUI `package.xml` 的 `scale9grid` 逐张对账', () => {
    // FGUI 的 `scale9grid="x,y,w,h"` 是**中心矩形**，要换算成 Cocos 的四边边框：
    //   borderLeft = x / borderTop = y / borderRight = W-(x+w) / borderBottom = H-(y+h)
    // 漏写的症状是「图照样显示、只是整张被拉伸」，不报错。
    const sliced: ReadonlyArray<{
        readonly art: string;
        readonly name: string;
        /** FGUI `scale9grid="x,y,w,h"` */
        readonly grid: readonly [number, number, number, number];
        /** 图片原始尺寸（`trimType: none` 后 = 原图尺寸） */
        readonly size: readonly [number, number];
    }> = [
        { art: 'btnRed', name: 'bt_btn_red', grid: [74, 27, 66, 23], size: [193, 74] },
        { art: 'barBg', name: 'bt_bar_bg', grid: [18, 10, 7, 3], size: [40, 24] },
        { art: 'barFill', name: 'bt_bar_fill', grid: [20, 11, 2, 3], size: [40, 24] },
        { art: 'lineFill', name: 'bt_line_fill', grid: [6, 6, 4, 6], size: [14, 16] },
        { art: 'lineBg', name: 'bt_line_bg', grid: [4, 6, 6, 4], size: [14, 16] },
        { art: 'bg', name: 'bt_bg', grid: [0, 1278, 720, 1], size: [720, 1280] },
        { art: 'panelBg', name: 'bt_panel_bg', grid: [155, 164, 310, 328], size: [620, 656] },
        { art: 'titleBg', name: 'bt_title_bg', grid: [228, 18, 272, 26], size: [747, 63] },
        { art: 'qipao', name: 'bt_qipao', grid: [117, 29, 126, 58], size: [331, 119] },
    ];
    // 表里的 9 张必须与 `BT_ART_SLICED` 完全一致（多一张少一张都要显式改这条）
    assert.deepEqual([...BT_ART_SLICED].sort(), sliced.map((s) => s.name).sort());

    for (const { art, name, grid, size } of sliced) {
        assert.equal(BT_ART_NAMES[art], name, `BT_ART_NAMES.${art} 对不上`);
        const ud = spriteUserData(BT_ART_DIR, name);
        const [gx, gy, gw, gh] = grid;
        const [w, h] = size;
        assert.equal(ud.width, w, `${name} 的图宽变了（${String(ud.width)}）—— border 是按原图算的`);
        assert.equal(ud.height, h, `${name} 的图高变了（${String(ud.height)}）`);
        assert.equal(ud.trimType, 'none', `${name} 的 trimType 必须是 none —— auto 会裁掉透明边让 border 整体偏边`);
        assert.deepEqual(
            [ud.borderLeft, ud.borderTop, ud.borderRight, ud.borderBottom],
            [gx, gy, w - (gx + gw), h - (gy + gh)],
            `${name} 的九宫 border 与 FGUI scale9grid ${grid.join(',')} 不符（拉伸会错位）`,
        );
    }
    // 两张行底板**不是**九宫（逐列不透明像素 656/656 满值，没有可切的中缝）——
    // 它们只是「整张拉伸的装饰底」，别顺手补一个 scale9grid
    for (const name of [BT_ART_NAMES.rowBg2, BT_ART_NAMES.rowBg3]) {
        const ud = spriteUserData(BT_ART_DIR, name);
        assert.deepEqual(
            [ud.borderLeft, ud.borderTop, ud.borderRight, ud.borderBottom],
            [0, 0, 0, 0],
            `${name} 不该有九宫 border`,
        );
        assert.equal(BT_ART_SLICED.has(name), false);
    }
});

test('`btSpriteType`：`BT_ART_SLICED` 里的返回 1(SLICED)，其余 0(SIMPLE)', () => {
    assert.equal(BT_SPRITE_SIMPLE, 0);
    assert.equal(BT_SPRITE_SLICED, 1);
    for (const [key, name] of Object.entries(BT_ART_NAMES)) {
        const expect = BT_ART_SLICED.has(name) ? BT_SPRITE_SLICED : BT_SPRITE_SIMPLE;
        assert.equal(btSpriteType(name), expect, `${key}(${name}) 的 Sprite type 判断不对`);
    }
    assert.equal(btSpriteType('no_such_art'), BT_SPRITE_SIMPLE);
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

const PREFAB_PATH = 'assets/resources/ui/BattleToken/BattleToken.prefab';

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

/** 读一个脚本的 cid（= 编译器 `_RF.push` 用的那个）。 */
function scriptCid(tsPath: string): string {
    const meta = JSON.parse(readFileSync(`${tsPath}.meta`, 'utf8')) as { uuid: string };
    return compressUuid(meta.uuid);
}

const PREFAB = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, unknown>>;
const PREFAB_NODES = PREFAB.filter((entry) => entry && entry.__type__ === 'cc.Node');

/** 脚本类名 → 源文件。 */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
    BattleTokenPage: 'assets/script/app/battletoken/BattleTokenPage.ts',
    // ⚠️ 没有 `BattleTokenTabButton` —— 2026-09-28 起底栏 4 格改用**共用**的
    // `ui/common/TabButton`（其脚本住在子 prefab 里，不出现在本 prefab 的 `__type__` 里）。
    BattleTokenRow: 'assets/script/app/battletoken/BattleTokenRow.ts',
    BattleTokenRewardSlot: 'assets/script/app/battletoken/BattleTokenRewardSlot.ts',
    BattleTokenBuyButton: 'assets/script/app/battletoken/BattleTokenBuyButton.ts',
    BattleTokenProgressBar: 'assets/script/app/battletoken/BattleTokenProgressBar.ts',
    VScrollView: 'assets/script/vscrollview/VScrollView.ts',
};

/** 节点路径 → 节点对象（helper，避免满篇 `findIndex`）。 */
const NODE_BY_PATH = new Map<string, Record<string, unknown>>();
{
    const byId = new Map<number, Record<string, unknown>>();
    PREFAB.forEach((entry, index) => {
        if (entry && entry.__type__ === 'cc.Node') byId.set(index, entry);
    });
    for (const node of byId.values()) {
        const parts: string[] = [];
        let cursor: Record<string, unknown> | undefined = node;
        while (cursor) {
            parts.unshift(String(cursor._name));
            const parent = cursor._parent as { __id__: number } | null;
            cursor = parent ? byId.get(parent.__id__) : undefined;
        }
        NODE_BY_PATH.set(parts.join('/'), node);
    }
}

function node(path: string): Record<string, unknown> {
    const hit = NODE_BY_PATH.get(path);
    assert.ok(hit, `prefab 里没有节点 ${path}`);
    return hit!;
}

/**
 * `__id__` 解引用（prefab JSON 里的引用有两种形态：`{__id__}` 和**内联对象**，
 * 例如 `asset` / `_spriteFrame` 是 `{__uuid__, __expectedType__}`）。
 * 内联对象原样返回，`null` / 原始值返回 `undefined`。
 */
function at(ref: unknown): Record<string, unknown> | undefined {
    if (!ref || typeof ref !== 'object') return undefined;
    const id = (ref as { __id__?: number }).__id__;
    return typeof id === 'number' ? PREFAB[id] : (ref as Record<string, unknown>);
}

function compsOf(path: string): Array<Record<string, unknown>> {
    const target = node(path);
    return ((target._components as Array<{ __id__: number }>) ?? []).map((ref) => PREFAB[ref.__id__]!);
}

function compOfType<T extends string>(path: string, type: T): Record<string, unknown> {
    const hit = compsOf(path).find((comp) => comp && comp.__type__ === type);
    assert.ok(hit, `${path} 上没挂 ${type}`);
    return hit!;
}

function transformOf(path: string): { w: number; h: number; ax: number; ay: number } {
    const ut = compOfType(path, 'cc.UITransform');
    const size = ut._contentSize as { width: number; height: number };
    const anchor = ut._anchorPoint as { x: number; y: number };
    return { w: size.width, h: size.height, ax: anchor.x, ay: anchor.y };
}

/**
 * 反解出节点在**画布坐标系**里的「左 / 上边缘 + 尺寸」（画布 720×1280，左上角为原点、y 向下）。
 *
 * ⚠️ 三个易错点（都在移植时踩过）：
 *   ① `_lpos` 累加出来的是**锚点**位置，不是中心 —— 必须按 `anchor` 展开成矩形；
 *   ② 画布 y 向下、Cocos 局部 y 向上，所以 `top` 是减出来的；
 *   ③ 规则 59：**别用 `cc.view.getVisibleSize()` / `worldPosition`**，往上累加 `position` 才对。
 *      （`scale` 不参与 —— 本函数量的是**布局框**，与 FGUI 的 `xy/size` 同一个口径。）
 */
function canvasBox(path: string): { left: number; top: number; w: number; h: number } {
    const parts = path.split('/');
    let accX = 0;
    let accY = 0;
    for (let i = 1; i <= parts.length; i++) {
        const own = node(parts.slice(0, i).join('/'));
        const pos = own._lpos as { x: number; y: number };
        accX += pos.x;
        accY += pos.y;
    }
    const t = transformOf(path);
    return {
        left: CANVAS_W / 2 + accX - t.ax * t.w,
        top: CANVAS_H / 2 - accY - (1 - t.ay) * t.h,
        w: t.w,
        h: t.h,
    };
}

const CANVAS_W = 720;
const CANVAS_H = 1280;

test('prefab 存在，根节点是第一个 cc.Node 且 cc.Prefab.data 指向它（排错会让整棵子树消失）', () => {
    assert.ok(existsSync(PREFAB_PATH), `prefab 不存在：${PREFAB_PATH}`);
    const data = (PREFAB[0] as { data: { __id__: number } }).data;
    const firstNodeIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.equal(data.__id__, firstNodeIndex, 'cc.Prefab.data 必须指向第一个 cc.Node');
    assert.equal(PREFAB_NODES[0]!._name, 'BattleToken');
    assert.equal(PREFAB_NODES[0]!._parent as unknown, null, '根节点没有父节点');
    assert.deepEqual(transformOf('BattleToken'), { w: 720, h: 1280, ax: 0.5, ay: 0.5 });
    // 100 个节点是「4 页签共用一套内容 + 2 个列表模板」的结果，数量变了先确认结构
    assert.equal(PREFAB_NODES.length, 100);
});

test('⚠️ 所有节点的 `_layer` 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    // 两类「不带自己那一份数据」的节点可以跳过，但数量必须对得上（见下）：
    //   ① 嵌套 prefab 实例的根：`_layer` / `_name` / `_children` 都在**子 prefab** 里；
    //   ② `cc.TargetOverrideInfo.target` 的占位节点：整个对象只有 `__editorExtras__`。
    const stub = PREFAB_NODES.filter((n) => !('_layer' in n));
    const instanceRoots = stub.filter((n) => !!at(at(n._prefab)?.instance));
    // `cc.TargetOverrideInfo` 有两处：① 实例自己的 `targetOverrides`（`target` = 下面这些占位节点）；
    // ② 根 `PrefabInfo.targetOverrides`（把子 prefab 的 `bg` / `icon` / `nameLabel` / `redDot`
    // 四条引用绑定的 `localID` 链**重述**到父 prefab，`target` 反而指向实例根）。
    const referenced = new Set<number>();
    for (const e of PREFAB) {
        if (e?.__type__ === 'cc.TargetOverrideInfo' && e.target) referenced.add((e.target as { __id__: number }).__id__);
    }
    const stubNoPrefabIdx = PREFAB
        .map((e, i) => (e?.__type__ === 'cc.Node' && !('_prefab' in e) ? i : -1))
        .filter((i) => i >= 0);
    assert.equal(stubNoPrefabIdx.length, 4, '无 `_prefab` 的占位节点应当只有 4 个');
    assert.equal(instanceRoots.length, 4, 'TabBar 下应当只有 4 个嵌套实例根');
    for (const index of stubNoPrefabIdx) {
        assert.ok(referenced.has(index), `节点 #${index} 既没有 \`_prefab\` 也不是某条 TargetOverrideInfo 的 target`);
    }
    assert.equal(stub.length, instanceRoots.length + stubNoPrefabIdx.length, '有没有解释不了来源的空壳节点');

    const layers = new Set(PREFAB_NODES.filter((n) => '_layer' in n).map((n) => n._layer));
    assert.deepEqual([...layers], [33554432], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

/**
 * 引擎**内部**类型（不是脚本组件）：`__type__` 不带 `cc.` 前缀、且长度只有 22，
 * 所以下面那个「cid 必须 23 位」的检查要先排除它们。
 * `CCPropertyOverrideInfo` 只出现在嵌套实例的属性覆盖里（`ui/common/TabButton` 的 4 个实例）。
 */
const ENGINE_ENTRY_TYPES = new Set(['CCPropertyOverrideInfo']);

test('⚠️ 每个脚本组件的 `__type__` 都能从对应 `.ts.meta` 的 uuid 反解出来（防 cid 抄错成 MissingScript）', () => {
    const expected = new Map<string, string>();
    for (const [className, file] of Object.entries(SCRIPT_FILES)) {
        expected.set(scriptCid(file), className);
    }
    const used = new Set(
        PREFAB
            .filter((entry) => entry && typeof entry.__type__ === 'string' && !entry.__type__.startsWith('cc.'))
            .map((entry) => entry.__type__ as string)
            .filter((type) => !ENGINE_ENTRY_TYPES.has(type)),
    );
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须是 23 位：${cid}`);
        assert.ok(expected.has(cid), `prefab 里的 cid ${cid} 反解不出任何脚本（抄错了？）`);
    }
    // 反向：6 种脚本组件都在 prefab 里出现过（少一种说明有一块界面没建）
    for (const [cid, className] of expected) {
        assert.ok(used.has(cid), `${className} 的组件没出现在 prefab 里`);
    }
    assert.equal(used.size, Object.keys(SCRIPT_FILES).length);
});

test('prefab 无空洞、无越界 `__id__`、CompPrefabInfo.fileId 长度 22', () => {
    const holes = PREFAB.map((entry, index) => (entry ? -1 : index)).filter((index) => index >= 0);
    assert.deepEqual(holes, [], `有空洞：${holes.join(', ')}`);

    /** 只沿「引用字段」走，避免把 `__type__` 之类的字符串也当引用。 */
    const REF_KEYS = ['_parent', '_children', '_components', '_prefab', 'node', 'data', '__prefab'];
    let refs = 0;
    const check = (value: unknown, where: string): void => {
        if (!value || typeof value !== 'object') return;
        if (Array.isArray(value)) {
            value.forEach((item, index) => check(item, `${where}[${index}]`));
            return;
        }
        const record = value as Record<string, unknown>;
        const id = record.__id__;
        if (typeof id === 'number') {
            refs++;
            assert.ok(id >= 0 && id < PREFAB.length, `${where} 的 __id__ ${id} 越界`);
            assert.ok(PREFAB[id], `${where} 的 __id__ ${id} 指向空洞`);
            return;
        }
        for (const key of Object.keys(record)) {
            if (key.startsWith('__') && key !== '__prefab') continue;
            check(record[key], `${where}.${key}`);
        }
    };
    PREFAB.forEach((entry, index) => {
        for (const key of REF_KEYS) check((entry ?? {})[key], `#${index}.${key}`);
    });
    assert.ok(refs > 500, `引用数太少（${refs}），说明没走全`);

    const fids = PREFAB.filter((e) => e && e.__type__ === 'cc.PrefabInfo').map((e) => e.fileId);
    // ⚠️ 嵌套实例根的 `fileId` **必须**等于子 prefab 根节点的 `fileId`（引擎靠它把
    //    `propertyOverrides` / `targetOverrides` 解析回去），所以 4 个 TabButton 实例
    //    的 `fileId` 天然重复 ⇒ 去重只对「自带数据的节点」做。
    const owned = PREFAB.filter((e) => e?.__type__ === 'cc.PrefabInfo' && !e.instance).map((e) => e.fileId);
    assert.equal(new Set(owned).size, owned.length, '自带数据的节点 PrefabInfo.fileId 有重复');
    const rootFids = new Set(PREFAB.filter((e) => e?.__type__ === 'cc.PrefabInfo' && e.instance).map((e) => e.fileId));
    assert.deepEqual([...rootFids], ['a94rYDHddOg4KBiWlY+2in'], '4 个页签实例必须共用 TabButton.prefab 的根 fileId');
    // 每个**真节点**一个 `cc.PrefabInfo`（挂在 `_prefab` 上）；TargetOverride 的占位节点没有
    assert.equal(fids.length, PREFAB_NODES.filter((n) => '_prefab' in n).length, 'PrefabInfo 数量应等于真节点数');
    for (const info of PREFAB.filter((e) => e && e.__type__ === 'cc.CompPrefabInfo')) {
        assert.equal(typeof info.fileId, 'string');
        assert.equal((info.fileId as string).length, 22, `CompPrefabInfo.fileId 长度异常：${String(info.fileId)}`);
    }
});

test('⚠️ 层序铁律：`PageRoot` 必须排在底栏之前（底栏要盖在内容页上）', () => {
    // 老端是 `组件_战令`（sortingOrder = 1）叠在 `组件_超值战令` 上；移植成同一 prefab 的两个子树，
    // 靠的就是 `_children` 序 = 渲染序。
    const root = node('BattleToken');
    const order = ((root._children as Array<{ __id__: number }>) ?? [])
        .map((ref) => String(PREFAB[ref.__id__]!._name));
    assert.deepEqual(order, ['PageRoot', 'BottomBar', 'BackBtn', 'TabBar']);
    const pageRootAt = order.indexOf('PageRoot');
    for (const later of ['BottomBar', 'BackBtn', 'TabBar']) {
        assert.ok(pageRootAt < order.indexOf(later), `PageRoot 排到了 ${later} 之后 —— 底栏会被内容页盖住`);
    }
});

/** 直接从 PNG 的 IHDR 读宽高（不依赖任何图像库）—— 用于核对图标几何推导的前提。 */
function pngSize(file: string): { w: number; h: number } {
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(12), 0x49484452, `${file} 不是 PNG（缺 IHDR）`);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ============================================================
// 底栏四格 = `ui/common/TabButton` 的嵌套实例
// （2026-09-28 起与主界面六格共用同一个 prefab；旧的私有 `BattleTokenTabButton` 已退场）
// ============================================================

const TABBUTTON_PREFAB_PATH = 'assets/resources/ui/common/TabButton.prefab';
const TABBUTTON_PREFAB = JSON.parse(readFileSync(TABBUTTON_PREFAB_PATH, 'utf8')) as Array<Record<string, unknown>>;
const TABBUTTON_ASSET_UUID = (JSON.parse(readFileSync(`${TABBUTTON_PREFAB_PATH}.meta`, 'utf8')) as { uuid: string }).uuid;
/** 子 prefab 里各节点的 `fileId` —— 也就是覆盖里 `targetInfo.localID` 那一段。 */
const TB_ROOT_FILEID = 'a94rYDHddOg4KBiWlY+2in';   // 根节点（底图 122×96）
const TB_ICON_FILEID = '0bIL5aQhxLVJaK82xrgNbv';   // Icon 节点
const TB_LABEL_FILEID = '42N0MHO9FCRIw/jInra5dC';  // NameLabel 节点
const TB_SCRIPT_FILEID = 'R4ksdmxfdtKOagAvszqgPS'; // TabButton 脚本组件

const TAB_NAMES = ['Tab1', 'Tab2', 'Tab3', 'Tab4'] as const;

/**
 * 读一个页签实例的**属性覆盖**。
 *
 * ⚠️ 节点体的几何住在**子 prefab** 里，父 prefab 里那 4 个节点只是空壳（没有 `_name` /
 * `_children` / `_lpos`）⇒ 不能像普通节点那样沿 `_children` 累加 `_lpos`，只能按
 * `localID` 读 `propertyOverrides`（`localID` = 子 prefab 里的 fileId 链）。
 */
function tabOverride(name: string, key: string, localID?: string): unknown {
    for (const entry of PREFAB) {
        if (entry?.__type__ !== 'cc.PrefabInstance') continue;
        const overs = ((entry.propertyOverrides ?? []) as unknown[]).map(at);
        if (!overs.some((ov) => ov?.propertyPath?.[0] === '_name' && ov.value === name)) continue;
        const hits = overs.filter((ov) => {
            if ((ov?.propertyPath as unknown[])?.[0] !== key) return false;
            return localID === undefined || at(ov.targetInfo)?.localID?.[0] === localID;
        });
        return hits.length ? hits.at(-1)!.value : undefined; // 同名多条时 Cocos 用后写的那条
    }
    throw new Error(`prefab 里没有名为 ${name} 的页签实例`);
}

/** 子 prefab 里某个节点（按 `fileId`）的 UITransform 尺寸（`cc.Size` → 扁平的 `{w,h}`）。 */
function tabButtonNodeSize(fileId: string): { w: number; h: number } {
    const info = TABBUTTON_PREFAB.find((e) => e?.__type__ === 'cc.PrefabInfo' && e.fileId === fileId);
    assert.ok(info, `TabButton.prefab 里没有 fileId=${fileId} 的节点`);
    const holder = TABBUTTON_PREFAB[(info!.root as { __id__: number }).__id__]!;
    const ut = ((holder._components as Array<{ __id__: number }>) ?? [])
        .map((ref) => TABBUTTON_PREFAB[ref.__id__]!)
        .find((comp) => comp?.__type__ === 'cc.UITransform');
    assert.ok(ut, `${fileId} 上没有 cc.UITransform`);
    const size = ut!._contentSize as { width: number; height: number };
    return { w: size.width, h: size.height };
}

test('页签按钮几何：TabBar 容器不变，四格换成共用件后 122×96、间距仍 120', () => {
    // ⚠️ 历史坑：`itemX(left, w, parentW)` 只减 `parentW/2`，**假定父容器左边缘在 0**。
    //    而 TabBar 是合成容器、左边缘在 240 ⇒ 照抄绝对 `left` 会让整排页签**右移 240**：
    //    Tab1 跑到 480、Tab4 跑到 840（**画布只有 720 宽**）。不报错，只有量画布像素才看得见。
    assert.deepEqual(canvasBox('BattleToken/TabBar'), { left: 240, top: 1168, w: 480, h: 112 });
    // [实例名, 相对 TabBar 的 x, 相对 TabBar 的 y] —— 中心仍在画布 y 1223.5（与旧 120×111 一致）
    const expect: ReadonlyArray<readonly [string, number, number]> = [
        ['Tab1', -180, 0.5],
        ['Tab2', -60, -0.5],
        ['Tab3', 60, -0.5],
        ['Tab4', 180, -0.5],
    ];
    for (const [name, x, y] of expect) {
        // 4 个实例必须都指向**共用**的 `ui/common/TabButton.prefab`（不许再抄一份私有件）
        const info = PREFAB.find((e) => e?.__type__ === 'cc.PrefabInfo'
            && (e.asset as { __uuid__?: string } | undefined)?.__uuid__ === TABBUTTON_ASSET_UUID);
        assert.ok(info, '有页签实例没指向共用 TabButton.prefab');
        assert.deepEqual(tabOverride(name, '_lpos', TB_ROOT_FILEID),
            { __type__: 'cc.Vec3', x, y, z: 0 }, `${name} 的 _lpos`);
        // 底图 122×96（= 老端 TY_btn13/14 原图 168×132 × 0.7），不再是被纵向拉长的 120×111
        assert.deepEqual(tabButtonNodeSize(TB_ROOT_FILEID), { w: 122, h: 96 }, `${name} 的节点尺寸`);
        // ⚠️ 底图 122 宽而间距恒 120 ⇒ 最外侧两格各溢出画布 1px（第 1 格左边 239、第 4 格右边 721）；
        //    那 1px 落在底图的透明边上，视觉与原稿等价 —— 这里按 ±1 放行，别当成「跑出画布」。
        const left = 480 + x - 61; // TabBar 中心在画布 x 480（left 240 + 480/2）
        assert.ok(left >= -1 && left + 122 <= CANVAS_W + 1, `${name} 跑出画布了（left=${left}）`);
    }
    // 相邻间距恒 = 120
    const xs = expect.map(([, x]) => x);
    for (let i = 1; i < xs.length; i++) assert.equal(xs[i]! - xs[i - 1]!, 120);
    // 页签名画在原稿图标里 ⇒ 共用件的 NameLabel 在实例里被关掉
    for (const name of TAB_NAMES) {
        assert.equal(tabOverride(name, '_active', TB_LABEL_FILEID), false, `${name} 的 NameLabel 应隐藏`);
    }
});

test('⚠️ 页签图标：底边 −42.5（不是继承六格的 −34）、选中上移 26', () => {
    // 老端 `BattleTokenTabButton.setSelected()` 写的是**中心** y = 选中 33.5 / 未选 −2.5，
    // 那正是 FGUI `按钮_首页_菜单` 里 `icon` / `selectIcon` 两个元素的盒中心。
    // 共用件的 Icon 改成**底边对齐**（anchor `0.5,0`）+ `_sizeMode=RAW`（尺寸跟随贴图）
    // ⇒ 复现老行为要把**底边**放到 −42.5 / −16.5（未选图 80 高、选中图 100 高），位移 26。
    //    直接抄中心位移 36 会整体多抬 10；沿用六格的 −34 会整体抬 8.5。
    for (const name of TAB_NAMES) {
        assert.deepEqual(tabOverride(name, '_lpos', TB_ICON_FILEID),
            { __type__: 'cc.Vec3', x: 0, y: -42.5, z: 0 }, `${name} 的 Icon 底边`);
        assert.equal(tabOverride(name, 'iconRaiseY', TB_SCRIPT_FILEID), 26, `${name} 的 iconRaiseY`);
    }
    // 上面 −42.5 / 26 的前提：四格**未选图全 80 高、选中图全 100 高**（宽度不一，靠锚点居中）
    const artDir = 'assets/resources/ui/Gift/art';
    for (const [off, on] of [['djjj_1', 'djjj'], ['qtdl_1', 'qtdl'], ['txz_1', 'txz'], ['ggl_1', 'ggl']]) {
        assert.equal(pngSize(`${artDir}/${off}.png`).h, 80, `${off} 的图高变了 ⇒ −42.5 / 26 要重算`);
        assert.equal(pngSize(`${artDir}/${on}.png`).h, 100, `${on} 的图高变了 ⇒ −42.5 / 26 要重算`);
    }
});

test('底部 4 个 tab 使用原稿 on/off 图标，并与累充图标放在同一目录', () => {
    const dir = 'assets/resources/ui/Gift/art';
    const frameUuid = (name: string): string => {
        const meta = JSON.parse(readFileSync(`${dir}/${name}.png.meta`, 'utf8')) as { subMetas?: Record<string, { uuid?: string }> };
        const uuid = Object.values(meta.subMetas ?? {}).map((sub) => sub.uuid).find((u) => u?.endsWith('@f9941'));
        assert.ok(uuid, `${name} 没有 spriteFrame subMeta`);
        return uuid!;
    };

    assert.equal(existsSync(`${dir}/活动_图标_充值.png`), true, '累充图标的目录口径');
    for (const name of ['djjj', 'djjj_1', 'qtdl', 'qtdl_1', 'txz', 'txz_1', 'ggl', 'ggl_1']) {
        assert.equal(existsSync(`${dir}/${name}.png`), true, `${name}.png 未落在累充图标目录`);
        frameUuid(name);
    }

    // 两态帧与业务类型号都写在**实例覆盖**上（共用件本身不带这两态）——
    // 顺序 = FGUI `组件_战令.xml` 的 `xy.x` 240/360/480/600（与 `BT_TABS` 一致）。
    // ⚠️ 常量名反直觉：`BT_TYPE_END` = **通行证**（1，默认页），`BT_TYPE_PASS` = 过关令（4）。
    const EXPECT: ReadonlyArray<readonly [string, string, string, number]> = [
        // [页签实例, 未选图, 选中图, tabType]
        ['Tab1', 'djjj_1', 'djjj', BT_TYPE_LEVEL_FUND], // 等级基金 3
        ['Tab2', 'qtdl_1', 'qtdl', BT_TYPE_SIGN_IN],    // 七日登录 2
        ['Tab3', 'txz_1', 'txz', BT_TYPE_END],          // 通行证 1
        ['Tab4', 'ggl_1', 'ggl', BT_TYPE_PASS],         // 过关令 4
    ];
    for (const [tab, off, on, type] of EXPECT) {
        assert.equal((tabOverride(tab, 'offIcon', TB_SCRIPT_FILEID) as { __uuid__: string })?.__uuid__,
            frameUuid(off), `${tab} 的未选图标`);
        assert.equal((tabOverride(tab, 'onIcon', TB_SCRIPT_FILEID) as { __uuid__: string })?.__uuid__,
            frameUuid(on), `${tab} 的选中图标`);
        assert.equal(tabOverride(tab, 'tabType', TB_SCRIPT_FILEID), type, `${tab} 的业务类型号`);
    }

    // 旧的私有页签组件必须已从页面与本 prefab 退场（规则 104：反向断言前先剥注释）
    const page = readFileSync('assets/script/app/battletoken/BattleTokenPage.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!page.includes('BattleTokenTabButton'), 'BattleTokenPage 还在引用旧的私有页签组件');
    assert.ok(page.includes('collectTabButtons'), '页面应当从 tabBar 运行时收集共用页签');
    assert.ok(PREFAB.every((e) => e?.__type__ !== 'f51e27J6RJCPZP'), 'prefab 里还挂着旧 BattleTokenTabButton 组件');
});

test('页头 / 面板 / 购买行 / 列表 / 经验条：几何逐条等于 FGUI XML 反解值', () => {
    // 左边是节点路径，右边是 FGUI 原稿的 `xy` + `size`（画布 720×1280）。
    const boxes: ReadonlyArray<readonly [string, number, number, number, number]> = [
        ['BattleToken/PageRoot/HeadBg', 0, 0, 720, 484],        // n125 loader 720×484 @ 0,0
        ['BattleToken/PageRoot/Hero', 20, 29, 353, 357],        // img_header @ 20,29
        ['BattleToken/PageRoot/TitleIcon', 314, 32, 406, 167],  // title_icon @ 314,32
        ['BattleToken/PageRoot/PanelBg', 0, 413, 720, 740],     // n126 tybg @ 0,413
        ['BattleToken/PageRoot/TitleBg', 0, 354, 720, 67],      // n127 titlebg @ 0,354
        ['BattleToken/PageRoot/Qipao', 336, 165, 330, 195],     // n141 qipao @ 336,165（通行证宽 330）
        ['BattleToken/PageRoot/BuyRow', 0, 442, 720, 71],       // 按钮 @ 0,442（720×71）
        ['BattleToken/PageRoot/ListView3', 36, 517, 656, 580],  // list  @ 36,517
        ['BattleToken/PageRoot/ListView2', 36, 515, 656, 580],  // list2 @ 36,515
        ['BattleToken/PageRoot/ExpGroup', 0, 0, 720, 1280],     // 整页容器
        ['BattleToken/PageRoot/ExpGroup/CostIcon', 539, 239, 42, 42],   // costIcon @ 539,239
        ['BattleToken/PageRoot/ExpGroup/ExpBar', 351, 325, 359, 24],    // progress @ 351,325
        ['BattleToken/BottomBar', 1, 1168, 720, 120],           // n0 diban_BG @ 1,1168
        ['BattleToken/BackBtn', 1, 1165, 123, 123],             // 按钮_返回 @ 1,1165
    ];
    for (const [path, left, top, w, h] of boxes) {
        assert.deepEqual(canvasBox(path), { left, top, w, h }, `${path} 的几何与 FGUI 不符`);
    }
    // 四个 `pivot + anchor="true"` 的文字节点：`xy` 是**中心点**（规则 58）
    const centers: ReadonlyArray<readonly [string, number, number]> = [
        ['BattleToken/PageRoot/Countdown', 323, 383],                          // 文本_倒计时
        ['BattleToken/PageRoot/Hint', 511, 264],                               // n13（anchor="true"）
        ['BattleToken/PageRoot/ExpGroup/Consumed', 560, 383],                  // n138「已消耗：」
        ['BattleToken/PageRoot/ExpGroup/ConsumedValue', 672, 382],             // 文本_消耗
    ];
    for (const [path, cx, cy] of centers) {
        const box = canvasBox(path);
        assert.equal(box.left + box.w / 2, cx, `${path} 的中心 x`);
        assert.equal(box.top + box.h / 2, cy, `${path} 的中心 y`);
    }
});

test('⚠️ 气泡 `n141` 的 `xy` 是**左上角**（有 pivot 但没 anchor）—— 别套中心点公式', () => {
    // FGUI: `<image name="n141" xy="336,165" pivot="0.5,0.5" size="330,195" scale="1,0.6"/>`
    // 没有 `anchor="true"` ⇒ xy 是左上角。规则 58 的那个陷阱（把它当中心点会整体偏半个元素）。
    const box = canvasBox('BattleToken/PageRoot/Qipao');
    assert.equal(box.left, 336, '左上角口径');
    assert.equal(box.top, 165);
    assert.equal(box.left + box.w / 2, 501, '中心 x = 336 + 165（不是 336）');
    // 而它包住的说明文字 n13 是 `anchor="true"` ⇒ 中心 (511,264)，两者不同心（FGUI 原稿如此）
    const hint = canvasBox('BattleToken/PageRoot/Hint');
    assert.equal(hint.left + hint.w / 2, 511);
    assert.notEqual(box.left + box.w / 2, hint.left + hint.w / 2);
    // 纵向缩放 0.6 挂在节点 scale 上（不是改 195）
    const scale = node('BattleToken/PageRoot/Qipao')._lscale as { x: number; y: number };
    assert.deepEqual([scale.x, scale.y], [1, 0.6]);
    assert.equal(box.h, 195, '框高仍是 195 —— 0.6 由 scale 承担，别改成 117');
});

test('两个列表：`content` 锚点 (0.5,1) + 唯一子节点是行模板（`VirtualScrollView` 取它当模板）', () => {
    const lists: ReadonlyArray<readonly [string, string, number, number]> = [
        // 路径, 模板名, 格子数, 底板显示高
        ['BattleToken/PageRoot/ListView3', 'RowTemplate3', 3, 106],
        ['BattleToken/PageRoot/ListView2', 'RowTemplate2', 2, 107],
    ];
    for (const [path, tpl, count, bgHeight] of lists) {
        const contentPath = `${path}/content`;
        // 视口与 content 的锚点都必须是 (0.5,1)（规则 8：改错会让列表从中间长出去）
        assert.deepEqual(
            [transformOf(path).ax, transformOf(path).ay],
            [0.5, 1],
            `${path} 视口锚点必须是 (0.5,1)`,
        );
        assert.deepEqual(
            [transformOf(contentPath).ax, transformOf(contentPath).ay],
            [0.5, 1],
            `${contentPath} 锚点必须是 (0.5,1)`,
        );
        assert.equal(transformOf(path).w, 656);
        assert.equal(transformOf(path).h, 580);
        const kids = ((node(contentPath)._children as Array<{ __id__: number }>) ?? [])
            .map((ref) => String(PREFAB[ref.__id__]!._name));
        assert.deepEqual(kids, [tpl], `${contentPath} 只应有模板节点 ${tpl}`);
        // 模板的行高 103、y = −103/2（列表从 content 顶往下排）
        assert.deepEqual([transformOf(`${contentPath}/${tpl}`).w, transformOf(`${contentPath}/${tpl}`).h], [656, 103]);
        assert.equal((node(`${contentPath}/${tpl}`)._lpos as { y: number }).y, -103 / 2);
        assert.equal(compOfType(`${contentPath}/${tpl}`, scriptCid(SCRIPT_FILES.BattleTokenRow!)).slotCount, count);
        // 底板：**显示尺寸 ≠ 物理尺寸**（zhanl3 物理 103 / 显示 106；zhanl1 物理 103 / 显示 107）
        const bg = `${contentPath}/${tpl}/Bg`;
        assert.equal(transformOf(bg).h, bgHeight, `${bg} 的显示高（FGUI 原稿让它往下溢出 3~4px）`);
        assert.equal(transformOf(bg).w, 656);
        // 格子：90×90，左边缘与 FGUI 逐格一致（3 格 69/300/512；2 格 126/452）
        const slots = Array.from({ length: count }, (_v, i) => `${contentPath}/${tpl}/Slot${i + 1}`);
        for (const slot of slots) {
            assert.deepEqual([transformOf(slot).w, transformOf(slot).h], [90, 90], `${slot} 尺寸`);
            // 每个格子四个子件齐全：图标 / 遮罩 / 对勾 / 锁 / 红点
            const sub = ((node(slot)._children as Array<{ __id__: number }>) ?? [])
                .map((ref) => String(PREFAB[ref.__id__]!._name));
            assert.deepEqual(sub, ['Icon', 'Mask', 'CheckMark', 'Lock', 'RedDot'], `${slot} 的子节点`);
            assert.deepEqual(
                ((node(`${slot}/RedDot`)._children as Array<{ __id__: number }>) ?? [])
                    .map((ref) => String(PREFAB[ref.__id__]!._name)),
                ['Dot'],
                '红点内部那层 Dot',
            );
        }
        const lefts = slots.map((s) => canvasBox(s).left - canvasBox(`${contentPath}/${tpl}`).left);
        const expectLefts = count === 3 ? [69, 300, 512] : [126, 452];
        assert.deepEqual(lefts, expectLefts, `${tpl} 的格子相对行左边缘的偏移与 FGUI 的 item0/1/2 不符`);
    }
});

test('⚠️ 行内四个子件的坐标是 FGUI `组件_战令_项Item.xml` 的**原始值**（与锁 / 红点逐一对上）', () => {
    // FGUI `组件_战令_项Item.xml`（组件自身 90×90）：
    //   n0 com_goods 物品框 @0,0 90×90 · n7 对勾 @29,28 · n2 图标遮罩 @0,0 90×90
    //   n4 锁01 @59,2 · n8 红点 @60,0 · 文本_等级 center(231,55)（3 格）/ (329,56)（2 格）
    // 逐格反解回画布，再减去所在行的左上角，得到「行内偏移」，与 FGUI 原值逐条对账。
    const cases: ReadonlyArray<readonly [string, number, number, number, number]> = [
        // 格子路径, 行内左偏移, 行内上偏移, 等级圆底中心x, 等级圆底中心y
        ['BattleToken/PageRoot/ListView3/content/RowTemplate3/Slot1', 69, 8, 230, 54],
        ['BattleToken/PageRoot/ListView3/content/RowTemplate3/Slot2', 300, 8, 230, 54],
        ['BattleToken/PageRoot/ListView3/content/RowTemplate3/Slot3', 512, 8, 230, 54],
        ['BattleToken/PageRoot/ListView2/content/RowTemplate2/Slot1', 126, 8, 328, 56],
        ['BattleToken/PageRoot/ListView2/content/RowTemplate2/Slot2', 452, 6, 328, 56],
    ];
    for (const [slot, slotLeft, slotTop, badgeCx, badgeCy] of cases) {
        const row = slot.slice(0, slot.lastIndexOf('/'));
        const rowBox = canvasBox(row);
        const box = canvasBox(slot);
        assert.equal(box.left - rowBox.left, slotLeft, `${slot} 的行内左偏移（FGUI item 的 xy.x）`);
        assert.equal(box.top - rowBox.top, slotTop, `${slot} 的行内上偏移（FGUI item 的 xy.y）`);

        /** 格子内某子件相对格子左上角的偏移。 */
        const rel = (name: string) => ({
            left: canvasBox(`${slot}/${name}`).left - box.left,
            top: canvasBox(`${slot}/${name}`).top - box.top,
        });
        assert.deepEqual(rel('Icon'), { left: 4, top: 4 }, `${slot}/Icon 应当是居中的 82×82`);
        assert.deepEqual(rel('Mask'), { left: 0, top: 0 }, `${slot}/Mask 应当是整格 90×90 的遮罩`);
        assert.deepEqual(rel('CheckMark'), { left: 29, top: 28 }, `${slot}/CheckMark（FGUI n7 @29,28）`);
        assert.deepEqual(rel('Lock'), { left: 59, top: 2 }, `${slot}/Lock（FGUI n4 @59,2）`);
        assert.deepEqual(rel('RedDot'), { left: 60, top: 0 }, `${slot}/RedDot（FGUI com_rd @60,0）`);
        // 遮罩 / 图标的尺寸也要对（漏了 `_type` 之外的第二个坑：尺寸被渲染组件回写）
        assert.deepEqual([transformOf(`${slot}/Icon`).w, transformOf(`${slot}/Icon`).h], [82, 82]);
        assert.deepEqual([transformOf(`${slot}/Mask`).w, transformOf(`${slot}/Mask`).h], [90, 90]);
        assert.deepEqual([transformOf(`${slot}/CheckMark`).w, transformOf(`${slot}/CheckMark`).h], [32, 33]);
        assert.deepEqual([transformOf(`${slot}/Lock`).w, transformOf(`${slot}/Lock`).h], [35, 38]);
        assert.deepEqual([transformOf(`${slot}/RedDot`).w, transformOf(`${slot}/RedDot`).h], [30, 30]);

        // 等级圆底 + 数字：**行级元素**（一行一个，不跟着格子走）
        const badge = canvasBox(`${row}/LevelBadge`);
        assert.deepEqual([badge.w, badge.h], [60, 59]);
        assert.equal(badge.left - rowBox.left + badge.w / 2, badgeCx, `${row}/LevelBadge 的行内中心 x`);
        assert.equal(badge.top - rowBox.top + badge.h / 2, badgeCy, `${row}/LevelBadge 的行内中心 y`);
        const label = canvasBox(`${row}/LevelLabel`);
        assert.deepEqual([label.w, label.h], [33, 34]);
        // FGUI：3 格那版 圆底(230,54) / 数字(231,55)；2 格那版 都是 (328,56) / (329,56)
        assert.equal(label.left - rowBox.left + label.w / 2, badgeCx + 1, `${row}/LevelLabel 的行内中心 x`);
        assert.equal(
            label.top - rowBox.top + label.h / 2,
            badgeCy + (badgeCy === 54 ? 1 : 0),
            `${row}/LevelLabel 的行内中心 y`,
        );
    }
});

test('⚠️ 连接段：`LineTop` / `LineBottom` 各带「底 + 填充」两件，几何照 FGUI 的 `n105` / `n102`', () => {
    // FGUI `组件_战令_项.xml`：n105（头）组 @222,−4 14×45（底 n103 14×44 / 填 n104 14×39）
    //                       n102（尾）组 @222,72 14×53（底 n97 14×45 / 填 n98 14×53）
    // FGUI `组件_战令_项_两个.xml`：n105 @320,−7 14×74（底 14×73 / 填 14×62）
    //                              n102 @320,68 14×80（底 14×80 / 填 14×76）
    const cases: ReadonlyArray<readonly [string, number, number, number, number, number, number, number]> = [
        // 行, LineTop左, LineTop上, LineTop宽, LineTop高, LineBottom左, LineBottom上, LineBottom高
        ['BattleToken/PageRoot/ListView3/content/RowTemplate3', 222, -4, 14, 45, 222, 72, 53],
        ['BattleToken/PageRoot/ListView2/content/RowTemplate2', 320, -7, 14, 74, 320, 68, 80],
    ];
    for (const [row, topLeft, topTop, topW, topH, bottomLeft, bottomTop, bottomH] of cases) {
        const rowBox = canvasBox(row);
        // FGUI 的 `xy` 是相对**行组件左上角**的 ⇒ 与画布绝对坐标之间差一个行的左上角
        const rel = (path: string) => {
            const box = canvasBox(path);
            return { left: box.left - rowBox.left, top: box.top - rowBox.top, w: box.w, h: box.h };
        };
        const top = rel(`${row}/LineTop`);
        assert.deepEqual([top.left, top.top, top.w, top.h], [topLeft, topTop, topW, topH], `${row}/LineTop 几何`);
        const bottom = rel(`${row}/LineBottom`);
        assert.deepEqual(
            [bottom.left, bottom.top, bottom.w, bottom.h],
            [bottomLeft, bottomTop, 14, bottomH],
            `${row}/LineBottom 几何`,
        );
        // 「底」与「填充」逐件对 FGUI（n103/n104 与 n97/n98）
        const bg = rel(`${row}/LineTop/LineTopBg`);
        const fill = rel(`${row}/LineTop/LineTopFill`);
        assert.equal(bg.w, 14);
        assert.equal(fill.w, 14);
        assert.ok(fill.h < bg.h, `${row}/LineTopFill 应该比 LineTopBg 短（点亮时露出的就是这一截）`);
        assert.ok(rel(`${row}/LineBottom/LineBottomBg`).w === 14);
        assert.ok(rel(`${row}/LineBottom/LineBottomFill`).w === 14);
        // 三件齐全（本轮的实例：首版只摆了「填充」、漏了「底」）
        assert.deepEqual(
            ((node(`${row}/LineTop`)._children as Array<{ __id__: number }>) ?? [])
                .map((ref) => String(PREFAB[ref.__id__]!._name)),
            ['LineTopBg', 'LineTopFill'],
            `${row}/LineTop 必须同时有底与填充`,
        );
        assert.deepEqual(
            ((node(`${row}/LineBottom`)._children as Array<{ __id__: number }>) ?? [])
                .map((ref) => String(PREFAB[ref.__id__]!._name)),
            ['LineBottomBg', 'LineBottomFill'],
            `${row}/LineBottom 必须同时有底与填充`,
        );
        // 连接段的两张图都是九宫（`bt_line_bg` 4,6,6,4 / `bt_line_fill` 6,6,4,6）
        for (const group of ['LineTop', 'LineBottom']) {
            for (const part of [`${group}Bg`, `${group}Fill`]) {
                assert.equal(
                    compOfType(`${row}/${group}/${part}`, 'cc.Sprite')._type,
                    1,
                    `${row}/${group}/${part} 应当用九宫图`,
                );
            }
        }
    }
});

test('⚠️ 经验条：`BarFill` 必须是 anchor (0,0.5) + `x = −totalLength/2`（`cc.ProgressBar` 的硬约束）', () => {
    // 读引擎源码 `cocos/ui/progress-bar.ts` 的 `_updateBarStatus()`：HORIZONTAL 模式下它会把
    // `_barSprite` 的 anchorPoint **强制设成 (0,0.5)**、contentSize 设成
    // `(totalLength × progress, h)`，并按 `finalPosition.add3f(totalWidth × (0 − 旧锚点x), …)` **补偿位置**
    // ⇒ 只有「填充锚点 (0,0.5) + 宿主内 x = −totalLength/2」这一种摆法与补偿自洽。
    const bar = 'BattleToken/PageRoot/ExpGroup/ExpBar';
    const fill = `${bar}/BarFill`;
    assert.deepEqual([transformOf(fill).ax, transformOf(fill).ay], [0, 0.5], 'BarFill 锚点必须是 (0,0.5)');
    assert.equal((node(fill)._lpos as { x: number }).x, -359 / 2, 'BarFill.x 必须是 −179.5');
    assert.equal(transformOf(fill).w, 359, 'BarFill 宽 = totalLength');
    const pb = compOfType(bar, 'cc.ProgressBar');
    assert.equal(pb._totalLength, 359);
    assert.equal(pb._mode, 0, 'HORIZONTAL');
    const barSprite = pb._barSprite as { __id__: number };
    const fillSprite = (compsOf(fill).find((c) => c.__type__ === 'cc.Sprite') as { __id__?: number });
    assert.ok(barSprite && barSprite.__id__ >= 0, 'ProgressBar 必须指向 BarFill 的 Sprite');
    assert.ok(fillSprite, 'BarFill 缺 cc.Sprite');
    // 宿主底板是九宫图（`bt_bar_bg` 18,10,7,3 —— 漏了 `_type=1` 会把两头圆角拉成椭圆）
    assert.equal(compOfType(bar, 'cc.Sprite')._type, 1);
    // 条上文案是 `value/max`（FGUI 那个组件是 `titleType="valueAndmax"`）
    assert.equal(compOfType(`${bar}/Value`, 'cc.Label')._string, '0/0');
    assert.equal((node(`${bar}/Value`)._lpos as { y: number }).y, -0.5);
});

test('购买行：三个按钮的位置 / 尺寸 / 位置随「两个·三个」切换（`buyButtonPos` 与 prefab 同结果）', () => {
    for (const [name, index] of [['Plan1', 0], ['Plan2', 1], ['Plan3', 2]] as const) {
        const path = `BattleToken/PageRoot/BuyRow/${name}`;
        const pos = buyButtonPos(true, index)!;
        const own = node(path)._lpos as { x: number; y: number };
        assert.deepEqual([own.x, own.y], [pos.x, pos.y], `${name} 的节点坐标与 buyButtonPos(true,${index}) 不符`);
        assert.deepEqual([transformOf(path).w, transformOf(path).h], [BT_BUY_BTN_W, BT_BUY_BTN_H]);
        // 按钮底图 + 可点 Button + 脚本三件齐全
        assert.equal(compOfType(path, 'cc.Button')._transition, 3, '按钮用 SCALE 过渡');
        assert.equal(compOfType(path, 'cc.Button')._zoomScale, 0.94);
        assert.deepEqual(
            ((node(path)._children as Array<{ __id__: number }>) ?? [])
                .map((ref) => String(PREFAB[ref.__id__]!._name)),
            ['CheckMark', 'Icon', 'Title'],
            `${name} 的子节点（FGUI 那个组件有对勾 / 货币图标 / 文案三件）`,
        );
    }
});

test('⚠️ 九宫：`BT_ART_SLICED` 的每张图在 prefab 里都必须 `_type = 1`；其余自有图 `_type = 0`', () => {
    /** `.meta` 的 `subMetas.f9941.uuid` 写法与 prefab 里 `_spriteFrame.__uuid__` 一致（含 `@f9941`）。 */
    const uuidOf = (name: string): string => {
        for (const ext of ['png', 'jpg', 'jpeg']) {
            const file = `${BT_ART_DIR}/${name}.${ext}.meta`;
            if (!existsSync(file)) continue;
            const meta = JSON.parse(readFileSync(file, 'utf8')) as { subMetas: Record<string, { uuid: string }> };
            return meta.subMetas.f9941!.uuid;
        }
        throw new Error(`缺图 ${name}`);
    };
    // ⚠️ 比对前必须归一化：`subMetas.f9941.uuid` 是「顶层 uuid + `@f9941`」，
    //    而 `meta.uuid` 是裸 uuid，拿错哪一个都会让整批九宫图被判成「非九宫」。
    const norm = (u: string) => u.replace('@f9941', '');
    const slicedUuid = new Set<string>();
    const plainUuid = new Set<string>();
    for (const name of Object.values(BT_ART_NAMES)) {
        (BT_ART_SLICED.has(name) ? slicedUuid : plainUuid).add(norm(uuidOf(name)));
    }
    let slicedSeen = 0;
    for (const comp of PREFAB.filter((e) => e && e.__type__ === 'cc.Sprite')) {
        const frame = comp._spriteFrame as { __uuid__?: string } | undefined;
        if (!frame || !frame.__uuid__) continue;
        const uuid = norm(frame.__uuid__);
        if (slicedUuid.has(uuid)) {
            slicedSeen++;
            assert.equal(comp._type, 1, '九宫图没写 _type=1（会整张拉伸、不报错）');
        } else if (plainUuid.has(uuid)) {
            assert.equal(comp._type, 0, `非九宫图写了 _type=${String(comp._type)}`);
        }
    }
    assert.ok(slicedSeen > 0, '一张九宫图都没用上？');
    // 每张被引用的九宫图都要真的出现在某个 Sprite/Script 属性上（漏摆 = 静默少一块底）
    const bgUuid = norm(uuidOf(BT_ART_NAMES.bg!));
    const allUuids = JSON.stringify(PREFAB);
    for (const key of Object.keys(BT_ART_NAMES)) {
        const name = BT_ART_NAMES[key]!;
        if (name === BT_ART_NAMES.bg) continue; // 老端注释态，见下
        assert.ok(allUuids.includes(norm(uuidOf(name))), `${name} 在 prefab 里一处都没引用（漏摆了？）`);
    }
    // `bt_bg` 老端是**注释态**（`LayerBattleTokenUI.init` 里那行 `SetUrlByBg("zhuangbei_bg")`）
    // ⇒ 有意不摆。别顺手加上去。
    assert.equal(allUuids.includes(bgUuid), false, 'bt_bg 是故意不摆的（老端注释态），别顺手加');
});

test('`_sizeMode` 恒为 CUSTOM(0)：`contentSize` 被渲染组件回写，别让它自动量（规则 7）', () => {
    for (const comp of PREFAB.filter((e) => e && e.__type__ === 'cc.Sprite')) {
        assert.equal(comp._sizeMode, 0, 'Sprite._sizeMode 必须是 CUSTOM(0)');
    }
});

// ============================================================
// D. 数据管道接线（源码文本）
// ============================================================

const BT_DIR = 'assets/script/app/battletoken';
const src = (file: string): string => readFileSync(`${BT_DIR}/${file}`, 'utf8');

test('三个请求的 proto 名与 `Cmd.d.ts` 登记一致（写错 = 请求发不出去）', () => {
    const request = src('RequestBattleTokenMsg.ts');
    assert.match(request, /return 'CmdBattleTokenOpenReqMsg';/);
    assert.match(request, /return 'CmdBattleTokenTakeRewardReqMsg';/);
    assert.match(request, /return 'CmdBattleTokenResetReqMsg';/);
    // 三个类都继承 `RequestMsg` 并成对声明 Req/Rsp 泛型
    assert.match(request, /class RequestBattleTokenOpen extends RequestMsg<\s*CmdBattleTokenOpenReqMsg,\s*CmdBattleTokenOpenRspMsg\s*>/);
    assert.match(request, /class RequestBattleTokenTakeReward extends RequestMsg<\s*CmdBattleTokenTakeRewardReqMsg,\s*CmdBattleTokenTakeRewardRspMsg\s*>/);
    assert.match(request, /class RequestBattleTokenReset extends RequestMsg<\s*CmdBattleTokenResetReqMsg,\s*CmdBattleTokenResetRspMsg\s*>/);
    // ⚠️ 没有「拉取战令数据」的请求 —— 别造一个假的
    assert.match(request, /没有「拉取战令数据」的请求/);
    const cmd = readFileSync('assets/script/app/generated/netProto/Cmd.d.ts', 'utf8');
    for (const name of ['CmdBattleTokenOpenReqMsg', 'CmdBattleTokenTakeRewardReqMsg', 'CmdBattleTokenResetReqMsg']) {
        assert.ok(cmd.includes(name), `Cmd.d.ts 里没有 ${name}`);
    }
});

test('Repository：状态走 `CacheMgr.getCmdBattleToken(type)`，**不自存快照**', () => {
    const repository = src('BattleTokenRepository.ts');
    assert.match(repository, /CacheMgr\.instance/);
    assert.match(repository, /getCmdBattleToken\(type\)/);
    assert.match(repository, /tlTakeLevel/);
    // `undefined` ⇒ null（字段缺失）与 `[]`（给了空数组）语义不同 —— 这条注释丢了说明有人改回单标量
    assert.match(repository, /字段缺失/);
    // 读表走 RefUtil（与其它活动一致）
    assert.match(repository, /RefUtil\.instance\.getRefAllAsync\(table\)/);
    assert.match(repository, /'battleTokenPlan'/);
    assert.match(repository, /'battleTokenReward'/);
    assert.match(repository, /'battleTokenConfig'/);
    // 奖励图标两支都要读：`item`（路径直通）+ `roleProperty`（货币档，战令奖励几乎全是它）
    assert.match(repository, /parseItemRows/);
    assert.match(repository, /parseRolePropertyRows/);
    assert.match(repository, /'payChannel'/);
});

test('⚠️ 三条请求都必须 `withTimeout` + 离线早退 + `catch` 返结果（否则永悬）', () => {
    const repository = src('BattleTokenRepository.ts');
    const sends = repository.match(/await withTimeout\(/g) ?? [];
    assert.equal(sends.length, 3, '开通 / 领奖 / 重置三条各一次 —— 少一条就会永悬（规则 22）');
    assert.match(repository, /const READ_TIMEOUT_MS = 800;/);
    assert.match(repository, /const WRITE_TIMEOUT_MS = 5000;/);
    assert.match(repository, /BT_READ_TIMEOUT_MS = READ_TIMEOUT_MS/);
    assert.match(repository, /BT_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS/);
    // 结果类型四态（`rejected` = 服务端 ret === false）
    assert.match(repository, /export type BattleTokenRequestResult = 'ok' \| 'offline' \| 'failed' \| 'rejected';/);
    assert.match(repository, /ret === false|ret\b.*=== false/);
});

test('购买战令：Open 回包 ret=true 后必须继续走 `FW.pay(payChannelId)`，道具档不走支付', () => {
    const repository = src('BattleTokenRepository.ts');
    assert.match(repository, /openPlan\(resId: number, payChannelId: number/);
    assert.match(repository, /ret === true && payChannelId > 0/);
    assert.match(repository, /FW\.pay\(payChannelId, 'common', 0\)/);

    const page = src('BattleTokenPage.ts');
    assert.match(page, /const payChannelId = price\.kind === 'rmb' \? price\.rmb : 0;/);
    assert.match(page, /openPlan\(resId, payChannelId, this\)/);
});

test('长屏布局：页头贴顶、底栏贴底，多出的高度全部给面板和列表', () => {
    const page = src('BattleTokenPage.ts');
    assert.match(page, /this\._applyScreenLayout\(\);/);
    assert.match(page, /parentTransform\?\.contentSize\.height/);
    assert.match(page, /this\.pageRoot\.setPosition\(0, extra \/ 2/);
    assert.match(page, /PANEL_BASE_HEIGHT \+ extra/);
    assert.match(page, /LIST_BASE_HEIGHT \+ extra/);
    assert.match(page, /const bottomOffset = -extra \/ 2/);

    const pageScript = compOfType('BattleToken', scriptCid('assets/script/app/battletoken/BattleTokenPage.ts'));
    for (const key of ['pageRoot', 'panelBg', 'bottomBar', 'tabBar']) {
        assert.equal(typeof (pageScript[key] as { __id__?: number })?.__id__, 'number', `BattleTokenPage.${key} 未接 prefab`);
    }
});

test('页面：`static prefabPath` 指向新 prefab，且路径真的存在（大小写也必须一致）', () => {
    const page = src('BattleTokenPage.ts');
    const matched = page.match(/static prefabPath = ['"]([^'"]+)['"]/);
    assert.ok(matched, 'BattleTokenPage 必须声明 static prefabPath');
    assert.equal(matched![1], 'ui/BattleToken/BattleToken');
    assert.ok(
        existsSync(`assets/resources/${matched![1]}.prefab`),
        `prefabPath 指向的文件不存在：assets/resources/${matched![1]}.prefab`,
    );
    // ⚠️ Android / iOS 的 zip 内路径**大小写敏感** —— 目录名与磁盘必须逐字相同
    // ⚠️ 大小写只能从**文件名本身**核（Windows 的 FS 不敏感，`existsSync('ui/battletoken')` 也返回 true，
    //    真机 / 热更新 zip 里才会炸）
    const dirs = readdirSync('assets/resources/ui');
    assert.ok(dirs.includes('BattleToken'), 'assets/resources/ui 下必须有 BattleToken（大小写逐字一致）');
    assert.equal(dirs.includes('battletoken'), false, '别用全小写（Windows 上照样能跑，真机才炸）');
});

test('页面继承 `PopupBase`（入口要按弹窗打开它，不是自己 instantiate）', () => {
    const page = src('BattleTokenPage.ts');
    assert.match(page, /import \{ PopupBase \} from '\.\.\/\.\.\/framework\/ui\/PopupBase';/);
    assert.match(page, /export class BattleTokenPage extends PopupBase \{/);
    // 生命周期钩子走 PopupBase 那套：onInit 只接静态线，onOpen 每次重读数据
    assert.match(page, /protected onInit\(\): void \{/);
    assert.match(page, /protected async onOpen\(\): Promise<void> \{/);
    // `_onBack` 必须交给 PopupManager 出栈（不能自己 `node.active = false` 赖着不走）
    assert.match(page, /this\.closeByButton\(\);/);
    assert.doesNotMatch(page, /this\.node\.active = false/);
    // 倒计时用 `update` 累加而不是 `schedule`（节点被回收时 `schedule` 不会自己停）
    assert.match(page, /protected update\(deltaTime: number\): void \{/);
    assert.doesNotMatch(page, /this\.schedule\(/);
});

test('⚠️ 虚拟列表：`renderItemFn` 只绑一次 + 渲染时现取 `_rowContext`（禁闭包捕获）', () => {
    const page = src('BattleTokenPage.ts');
    // 规则 55 ①：回调只绑一次，靠 `_listBound{N}` 守卫
    assert.match(page, /_listBound3/);
    assert.match(page, /_listBound2/);
    assert.equal((page.match(/renderItemFn = /g) ?? []).length, 2, '两个列表各绑一次');
    // 规则 55 ②：`_renderRow` 必须现取 `this._rowContext`，不能把入参闭包进去
    assert.match(page, /view\.render\(index, this\._rowContext\)/);
    // 数据先存字段再 await 预加载
    const rebuild = page.indexOf('this._rows = rows;');
    const preload = page.indexOf('await this._preloadRowFrames(');
    assert.ok(rebuild >= 0 && preload > rebuild, '必须先 `this._rows = rows` 再 `await` 预加载');
});

test('⚠️ 图标预加载集合 = 奖励 resId ∪ 购买按钮要用的固定图 ∪ 页头小件（漏了会静默降级）', () => {
    const page = src('BattleTokenPage.ts');
    // 奖励
    assert.match(page, /for \(const resId of row\.resIds\)/);
    // 按钮：`openCostItemResId` **不在** `row.resIds` 里
    assert.match(page, /const price = priceOf\(plan\);/);
    assert.match(page, /price\.kind === 'item'/);
    assert.match(page, /this\._iconPathOf\(price\.resId\)/);
    // ⚠️ 页头小件（「已消耗：」旁边的体力图标）也**不在**任何 `row.resIds` 里：
    //    `_preloadCommonFrames` 必须显式带上，否则 `_setFrame` 静默跳过（探针逮到的第二个缺口）。
    assert.match(page, /const costPath = this\._iconPathOf\(BT_EXP_COST_RES_ID\);/);
    assert.match(page, /if \(costPath\) paths\.push\(costPath\);/);
    // 规则 57：取图必须带 `/spriteFrame`
    assert.match(page, /\/spriteFrame/);
    // 奖励图标走统一入口（`item` 直通 / `roleProperty` 落 icons/resource）
    assert.match(page, /resolveRewardIconRef\(goods\)/);
});

test('页面：切页只换图 / 换数据，**不重建节点**（4 个页签共用一套内容）', () => {
    const page = src('BattleTokenPage.ts');
    // 页头三图按 artKey 换帧
    assert.match(page, /btPageArtPath\(artKey, 'headbg'\)/);
    assert.match(page, /btPageArtPath\(artKey, 'hero'\)/);
    assert.match(page, /btPageArtPath\(artKey, 'title'\)/);
    // 说明文字：文案 + **框尺寸**都要换（七日登录的 `425,42` 只在生成器里对不上会静默折行）
    assert.match(page, /hintBoxOf\(type\)/);
    assert.match(page, /setContentSize\(box\.w, box\.h\)/);
    assert.match(page, /qipaoBoxOf\(type\)/);
    // 通行证专有的显隐：`titleBg` / 倒计时 / 经验条都跟着 type 走
    assert.match(page, /type !== BT_TYPE_LEVEL_FUND/);
    assert.match(page, /type === BT_TYPE_END/);
    // 条上文案是 `value/max`
    assert.match(page, /setProgress\(exp, expMax, `\$\{exp\}\/\$\{expMax\}`\)/);
    // 两个列表按 `isThreePlan` 互斥显隐
    assert.match(page, /isThreePlan\(type\)/);
});

test('入口接线：`MainEntranceRoute` 白名单 + `MainEntranceList` 类映射都要有 battleToken', () => {
    const route = readFileSync('assets/script/app/main/MainEntranceRoute.ts', 'utf8');
    assert.match(route, /LayerBattleToken:\s*['"]battleToken['"]/);
    assert.match(route, /EntrancePopupKey = ['"]firstRecharge['"] \| ['"]sevenDay['"][^;]*\| ['"]battleToken['"]/);

    const list = readFileSync('assets/script/app/main/MainEntranceList.ts', 'utf8');
    assert.match(list, /import \{ BattleTokenPage \} from '\.\.\/battletoken\/BattleTokenPage'/);
    assert.match(list, /battleToken:\s*BattleTokenPage/);

    // 弹窗 key 的联合类型里必须有它（`POPUP_CLASSES` 的键是 `Record<EntrancePopupKey, …>`，
    // 少一个键 TS 会报，但少一个**白名单项**不会 —— 所以上面那条才是关键守卫）
    assert.match(route, /\| 'battleToken'/);
});

test('open.json 里的战令入口（refId=104）各项与注释一致', () => {
    const row = table('open').find((r) => r.url === 'LayerBattleToken');
    assert.ok(row, 'open.json 里没有 LayerBattleToken');
    assert.equal(row!.refId, 104);
    assert.equal(row!.belond, 2, '左列');
    assert.equal(row!.order, 3);
    assert.equal(row!.icon, '图标_战斗选关_按钮_战令');
    assert.equal(row!.RDExpr, '[RDBattleToken]');
    assert.equal(row!.tipShow, '通关第1关解锁');
});

// ============================================================
// E. 文案表
// ============================================================

test('文案表：老端 `mL.json` 那几条原文逐条对上', () => {
    assert.equal(BT_TEXTS.needMoney, '￥{0}');
    assert.equal(BT_TEXTS.alreadyOpen, '指挥官已经开通该档位了，不能重复开通哦~');
    assert.equal(BT_TEXTS.errAlreadyOpen, '该战令已购买');
    assert.equal(BT_TEXTS.errNotOpen, '战令未开启');
    assert.equal(BT_TEXTS.errNotMaxLevel, '战令未达最大等级');
    assert.equal(BT_TEXTS.errRewardNotAllTaken, '战令奖励未全部领取');
    assert.equal(BT_TEXTS.errAlreadyRewarded, '战令奖励已领取');
    assert.equal(BT_TEXTS.errLevelNotCondition, '战令等级不满足条件');
    assert.equal(BT_TEXTS.consumedLabel, '已消耗：');
    assert.equal(BT_TEXTS.countdownPrefix, '活动倒计时:');
    assert.equal(BT_TEXTS.activityEnd, '活动已结束');
    assert.equal(BT_TEXTS.freeTitle, '今日福利');
});

test('`btFormat` 只替换第一处（照抄老端 `String.replace("{0}", x)` 的行为）', () => {
    assert.equal(btFormat('{0} 与 {1}', 'A', 'B'), 'A 与 B');
    assert.equal(btFormat('{0}{0}', 'A'), 'A{0}', '`String.replace` 只替换第一处 —— 别改成 replaceAll');
    assert.equal(btFormat('没有占位符', 'A'), '没有占位符');
    assert.equal(btFormat('{1} 在前 {0} 在后', 'A', 'B'), 'B 在前 A 在后');
});

test('付费按钮金额文案 / 倒计时整句 / 激活弹窗说明句', () => {
    assert.equal(btMoneyText(30), '￥30');
    assert.equal(btMoneyText(0), '￥0');
    assert.equal(btCountdownText('02:30:00'), '活动倒计时:02:30:00');
    // 倒计时整句与 `countdownText` 必须同前缀（两处都改了才一致）
    assert.equal(BT_TEXTS.countdownPrefix + '1天02:30:00', countdownText(86400 + 9000, 0));
    assert.equal(btUnlockHint(false), BT_TEXTS.unlockHintBasic);
    assert.equal(btUnlockHint(true), BT_TEXTS.unlockHintAdvanced);
    assert.equal(BT_TEXTS.unlockTitle, '激活战令');
});

test('⚠️ 界面文案的唯一入口是 `BT_TEXTS`（页面里不许再写中文字面量）', () => {
    const page = src('BattleTokenPage.ts');
    assert.match(page, /import \{ BT_TEXTS, btMoneyText \} from '\.\/BattleTokenTexts';/);
    assert.doesNotMatch(page, /btn\.label\.string/);
    assert.match(page, /this\.consumedLabel\.string = BT_TEXTS\.consumedLabel/);
    assert.match(page, /btMoneyText\(payRmbOf\(snapshot, price\.rmb\)\)/);
    // 倒计时整句走 `BattleTokenTable.countdownText`（内含 `活动已结束` 的替换）
    assert.match(page, /countdownText\(state\.endSeconds, nowSec\)/);
    // 去掉注释与 `@property({ tooltip: '…' })` 后再粗筛中文字面量 —— tooltip 是编辑器里看的，不算界面文案
    const codeOnly = page
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/@property\(\{[\s\S]*?\}\)/g, '');
    const chineseLiterals = (codeOnly.match(/'[^'\n]*[\u4e00-\u9fa5][^'\n]*'/g) ?? [])
        .filter((literal) => !literal.startsWith("'[BattleToken]"));
    assert.deepEqual(
        chineseLiterals,
        [],
        `页面里出现了中文界面文案字面量 —— 应当收敛进 BT_TEXTS：${chineseLiterals.join(', ')}`,
    );
    // 兜底：确认扫描真的跑到了代码（不然「没扫到」会假绿）
    assert.ok(codeOnly.includes('btMoneyText'), '去掉注释后应当还剩下代码文本');
});





