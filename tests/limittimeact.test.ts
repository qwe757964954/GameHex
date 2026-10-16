/**
 * 「限时活动」三页签（`limitTimeAct`）的数据口径单测。
 *
 * 只测 `LimitTimeActTable`（纯函数、零 `cc` 依赖）：
 *   - `reqActivityJson` 下发的 JSON 字符串 → 三页签配置解析；
 *   - `reqActivityLimitTimeInfo` 响应 → 任务进度 / 礼包次数 / 限购次数解析；
 *   - `CmdActivitySimple` → 活动 meta（type=101 才收）；
 *   - 任务三态（未完成 / 可领 / 已领）+ 排序（可领置顶、已领沉底）；
 *   - 礼包 / 限购的剩余次数 + 排序（有剩置顶、售罄沉底）。
 *
 * 被测模块零 import（连 `cc` 都没有），运行时依赖链是空的，可直接在 node 里跑。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    findLimitTimeMeta,
    goodsPhaseOf,
    goodsRemainOf,
    goodsTimesOf,
    parseActConfig,
    parseActData,
    parseActTitleAndIcon,
    parseGoodsRows,
    parseGoodsStates,
    parseRewards,
    parseTaskRows,
    parseTaskStates,
    sortGoodsForDisplay,
    sortTasksForDisplay,
    taskHasRedDot,
    taskPhaseOf,
    taskProgressText,
    taskStateOf,
} from '../assets/script/app/limitTimeAct/LimitTimeActTable';

// ============================================================
// 夹具：老端 limitTimeTask / limitTimeDay / limitTimeActivity 的真实形状
// ============================================================

const LIMIT_TIME_JSON = JSON.stringify({
    limitTimeTask: [
        { resId: 10001, name: '每日福利', sort: 1, desc: '每日登录领取奖励', targetType: 6, param: { count: 1 }, reward: [{ number: 20, resId: 10008 }] },
        { resId: 10002, name: '法术技能升级', sort: 2, desc: '章节关卡内选择技能80次', targetType: 16, param: { count: 80 }, reward: [{ number: 200, resId: 10012 }] },
        { resId: 10003, name: '消耗体力', sort: 3, desc: '消耗100点体力', targetType: 2, param: { count: 100 }, reward: [{ number: 10, resId: 10008 }] },
    ],
    limitTimeDay: [
        { resId: 1, title: '阵法升级礼包', desc: '阵法升级礼包', reward: [{ number: 500, resId: 10008 }], priceType: 10, cost: 1000, count: 1, discount: 2, extend: {}, refreshParam: { day: 1, hour: 0 } },
        { resId: 2, title: '阵法技能升级礼包', desc: '阵法技能升级礼包', reward: [{ number: 100, resId: 10009 }], priceType: 10, cost: 200, count: 1, discount: 2, extend: {}, refreshParam: { day: 1, hour: 0 } },
    ],
    limitTimeActivity: [
        { resId: 1, title: '鲛女皮肤礼包', desc: '鲛女皮肤礼包', reward: [{ number: 1, resId: 80005 }], priceType: 10, cost: 280, count: 1, discount: 1, extend: {}, refreshParam: null },
    ],
    limitTimeConfig: [
        { key: 'icon', value: '战斗选关_按钮_欢度元旦', title: '' },
        { key: 'title', value: '', title: '欢度元旦' },
    ],
});

const INFO_RSP = {
    tlCmdTask: [
        { resId: 10001, count: 1, rewardState: 2 },
        { resId: 10002, count: 80, rewardState: 1 },
        { resId: 10003, count: 30, rewardState: 0 },
    ],
    tlLimitTimeDay: [{ resId: 1, times: 1 }],
    tlLimitTimeActivity: [{ resId: 1, times: 0 }],
};

// ============================================================
// A. 解析
// ============================================================

test('A. parseActConfig：JSON 字符串 → 三页签配置', () => {
    const cfg = parseActConfig(LIMIT_TIME_JSON);
    assert.equal(cfg.tasks.length, 3);
    assert.equal(cfg.dayGifts.length, 2);
    assert.equal(cfg.limitBuys.length, 1);
    assert.deepEqual(cfg.tasks.map((t) => t.name), ['每日福利', '法术技能升级', '消耗体力']);
    assert.equal(cfg.tasks[0].targetType, 6);
    assert.equal(cfg.tasks[0].count, 1);
    assert.deepEqual(cfg.tasks[0].rewards, [{ resId: 10008, number: 20 }]);
    assert.equal(cfg.dayGifts[0].cost, 1000);
    assert.equal(cfg.dayGifts[0].discount, 2);
    assert.equal(cfg.dayGifts[0].count, 1);
});

test('A. parseActConfig：非法 / 空 content 不抛，各页签空数组', () => {
    const empty = parseActConfig(null);
    assert.equal(empty.tasks.length, 0);
    assert.equal(empty.dayGifts.length, 0);
    assert.equal(empty.limitBuys.length, 0);
    const bad = parseActConfig('{not json');
    assert.equal(bad.tasks.length, 0);
});

test('A. parseTaskRows：缺 name / resId 的行跳过、param 缺失不抛', () => {
    const rows = parseTaskRows([
        { resId: 10001, name: '每日福利', sort: 1, desc: 'd', targetType: 6, param: { count: 1 }, reward: [] },
        { resId: 10002, name: '', sort: 2, desc: '无名字' },                 // name 空 → 跳过
        { resId: 0, name: '无id' },                                          // resId 0 → 跳过
        { name: '无id字段' },                                                 // 缺 resId → 跳过
        { resId: 10003, name: '无param', sort: 3, desc: '', targetType: 2 }, // param 缺失 → count 0
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.resId), [10001, 10003]);
    assert.equal(rows[1].count, 0);
});

test('A. parseActData：响应 → 任务进度 / 次数', () => {
    const data = parseActData(INFO_RSP);
    assert.equal(data.tasks.length, 3);
    assert.equal(data.dayGifts.length, 1);
    assert.equal(data.limitBuys.length, 1);
    assert.deepEqual(data.tasks.map((t) => [t.resId, t.count, t.state]), [
        [10001, 1, 2],
        [10002, 80, 1],
        [10003, 30, 0],
    ]);
});

test('A. findLimitTimeMeta：只收 type=101 的活动', () => {
    const simples = [
        { id: 'act1', type: 101, jsonNames: ['limitTimeTask', 'limitTimeConfig'], cmdActivityTime: { endTime: 1700000000000 } },
        { id: 'act2', type: 102, jsonNames: ['skin'], cmdActivityTime: { endTime: 1700000000000 } },
    ];
    const meta = findLimitTimeMeta(simples);
    assert.ok(meta);
    assert.equal(meta.id, 'act1');
    assert.equal(meta.type, 101);
    assert.equal(meta.endTime, 1700000000000);
    assert.deepEqual(meta.jsonNames, ['limitTimeTask', 'limitTimeConfig']);
    // 没有 limit_time → null
    assert.equal(findLimitTimeMeta([{ id: 'x', type: 102, jsonNames: [], cmdActivityTime: {} }]), null);
});

test('A. parseActTitleAndIcon：从 limitTimeConfig 抽标题 / 图标', () => {
    const { title, icon } = parseActTitleAndIcon([
        { key: 'icon', value: '战斗选关_按钮_欢度元旦' },
        { key: 'title', value: '', title: '欢度元旦' },
    ]);
    assert.equal(icon, '战斗选关_按钮_欢度元旦');
    assert.equal(title, '欢度元旦');
});

test('A. parseRewards：非法条目跳过', () => {
    assert.deepEqual(parseRewards([{ resId: 1, number: 5 }, { resId: 0, number: 1 }, null, { resId: 2, number: 0 }]), [
        { resId: 1, number: 5 },
    ]);
});

// ============================================================
// B. 任务三态 + 排序
// ============================================================

test('B. taskPhaseOf：三态正确', () => {
    const states = parseTaskStates(INFO_RSP.tlCmdTask);
    const tasks = parseActConfig(LIMIT_TIME_JSON).tasks;
    const byId = (id: number) => tasks.find((t) => t.resId === id)!;
    assert.equal(taskPhaseOf(byId(10001), states), 'taken');      // rewardState=2
    assert.equal(taskPhaseOf(byId(10002), states), 'claimable');   // rewardState=1
    assert.equal(taskPhaseOf(byId(10003), states), 'goto');        // rewardState=0 且 targetType=2
});

test('B. taskPhaseOf：targetType=0 且未完成 → undone', () => {
    const tasks = parseTaskRows([{ resId: 1, name: '无跳转任务', sort: 1, desc: '', targetType: 0, param: { count: 1 }, reward: [] }]);
    assert.equal(taskPhaseOf(tasks[0], []), 'undone');
});

test('B. sortTasksForDisplay：可领取置顶、已领取沉底、组内按 sort', () => {
    const states = parseTaskStates(INFO_RSP.tlCmdTask);
    const tasks = parseActConfig(LIMIT_TIME_JSON).tasks;
    const sorted = sortTasksForDisplay(tasks, states);
    // 10002(可领) → 10003(前往/未完成) → 10001(已领)
    assert.deepEqual(sorted.map((t) => t.resId), [10002, 10003, 10001]);
});

test('B. taskProgressText / taskHasRedDot / taskStateOf', () => {
    const states = parseTaskStates(INFO_RSP.tlCmdTask);
    const tasks = parseActConfig(LIMIT_TIME_JSON).tasks;
    const t2 = tasks.find((t) => t.resId === 10002)!;
    assert.equal(taskProgressText(t2, states), '法术技能升级 (80/80)');
    assert.equal(taskHasRedDot(t2, states), true);
    assert.equal(taskHasRedDot(tasks.find((t) => t.resId === 10001)!, states), false);
    // 没下发的任务 → 0 / 未完成
    assert.deepEqual(taskStateOf(99999, states), { resId: 99999, count: 0, state: 0 });
});

// ============================================================
// C. 礼包 / 限购
// ============================================================

test('C. goodsTimesOf / goodsRemainOf / goodsPhaseOf', () => {
    const dayStates = parseGoodsStates(INFO_RSP.tlLimitTimeDay);
    const days = parseActConfig(LIMIT_TIME_JSON).dayGifts;
    // resId=1 已买 1 次，count=1 → 售罄
    assert.equal(goodsTimesOf(1, dayStates), 1);
    assert.equal(goodsRemainOf(days[0], dayStates), 0);
    assert.equal(goodsPhaseOf(days[0], dayStates), 'soldout');
    // resId=2 没买 → 可买
    assert.equal(goodsRemainOf(days[1], dayStates), 1);
    assert.equal(goodsPhaseOf(days[1], dayStates), 'buyable');
});

test('C. sortGoodsForDisplay：有剩余置顶、售罄沉底', () => {
    const dayStates = parseGoodsStates(INFO_RSP.tlLimitTimeDay);
    const days = parseActConfig(LIMIT_TIME_JSON).dayGifts;
    const sorted = sortGoodsForDisplay(days, dayStates);
    // resId=2(可买) → resId=1(售罄)
    assert.deepEqual(sorted.map((g) => g.resId), [2, 1]);
});

test('C. parseGoodsRows：非法行跳过、按 resId 升序', () => {
    const rows = parseGoodsRows([
        { resId: 3, title: 'c' },
        { resId: 1, title: 'a' },
        { resId: 0, title: 'bad' },
        { resId: 2, title: 'b', reward: [{ resId: 1, number: 2 }] },
    ]);
    assert.deepEqual(rows.map((r) => r.resId), [1, 2, 3]);
    assert.deepEqual(rows.find((r) => r.resId === 2)!.rewards, [{ resId: 1, number: 2 }]);
});

// ============================================================
// D. prefab 结构（house style：直接读 JSON 断言，不起引擎）
//    防静默失效：引用绑错类型（铁律 6）、页签层级放错（getChildByName 只查直接子节点）
// ============================================================

import { readFileSync } from 'node:fs';

type PrefabObj = { __type__?: string; _name?: string; [k: string]: unknown };

const PREFAB_PATH = 'assets/resources/ui/LimitTimeAct/LimitTimeAct.prefab';
const PREFAB: PrefabObj[] = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as PrefabObj[];

/** 脚本组件 cid（生成器从编译产物读；这里独立钉住，cid 变了说明 .ts.meta uuid 变了，prefab 要重新生成）。 */
const PAGE_CID = 'e58d4KJ0/5KR5ZzT8+GQm1r';
const ITEM_CID = '3e5fe6v4T5AGZA2mrPOv0f6';
const LIST_CID = '544earF5qRLB4JTuTnSr11+';

function prefabNodes(): PrefabObj[] {
    return PREFAB.filter((o) => o?.__type__ === 'cc.Node');
}
function compOfType(nodeIdx: number, type: string): PrefabObj | null {
    const node = PREFAB[nodeIdx];
    for (const c of (node._components ?? []) as { __id__: number }[]) {
        const comp = PREFAB[c.__id__];
        if (comp?.__type__ === type) return comp;
    }
    return null;
}
function childNameList(nodeIdx: number): string[] {
    return ((PREFAB[nodeIdx]._children ?? []) as { __id__: number }[]).map((c) => PREFAB[c.__id__]._name as string);
}

test('D. prefab 存在且根结构正确（data → 第一个 cc.Node）、全部节点 UI_2D', () => {
    assert.equal(PREFAB[0].__type__, 'cc.Prefab');
    const rootIdx = (PREFAB[0].data as { __id__: number }).__id__;
    assert.equal(PREFAB[rootIdx]._name, 'LimitTimeAct');
    for (const n of prefabNodes()) assert.equal(n._layer, 33554432, `${n._name} layer 应为 UI_2D`);
});

test('D. ⚠️ 三个页签是根节点的直接子节点（脚本 getChildByName 只查直接子节点）', () => {
    // 这是端到端探针逮过的静默失效：页签放进 TabBar 容器 ⇒ onInit 一个都绑不上 ⇒ 点了没反应
    const rootIdx = (PREFAB[0].data as { __id__: number }).__id__;
    const childNames = childNameList(rootIdx);
    const rootChildren = (PREFAB[rootIdx]._children ?? []) as { __id__: number }[];
    for (const tab of ['TabTask', 'TabDayGift', 'TabLimitBuy']) {
        assert.ok(childNames.includes(tab), `${tab} 必须是根节点直接子节点（现根子节点：${childNames.join(',')}）`);
        const idx = rootChildren.find((c) => PREFAB[c.__id__]._name === tab)!. __id__;
        assert.ok(compOfType(idx, 'cc.Button'), `${tab} 要挂 cc.Button`);
    }
});

test('D. Page 脚本 6 个 @property 引用类型正确（铁律 6：指向组件不是节点）', () => {
    const page = PREFAB.find((o) => o?.__type__ === PAGE_CID);
    assert.ok(page, 'LimitTimeActPage 组件要在 prefab 里');
    const typeOf = (ref: { __id__: number } | null) => (ref ? PREFAB[ref.__id__]?.__type__ : undefined);
    assert.equal(typeOf(page.titleLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(page.timeLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(page.descLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(page.hintLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(page.list as { __id__: number }), LIST_CID);
    assert.equal(typeOf(page.closeBtn as { __id__: number }), 'cc.Button');
});

test('D. Item 脚本 9 个 @property 引用类型正确', () => {
    const item = PREFAB.find((o) => o?.__type__ === ITEM_CID);
    assert.ok(item, 'LimitTimeActItem 组件要在 prefab 里');
    const typeOf = (ref: { __id__: number } | null) => (ref ? PREFAB[ref.__id__]?.__type__ : undefined);
    assert.equal(typeOf(item.nameLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(item.actionButton as { __id__: number }), 'cc.Button');
    assert.equal(typeOf(item.actionLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(item.rewardBar as { __id__: number }), 'cc.Node');
    assert.equal(typeOf(item.limitLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(item.discountLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(item.priceLabel as { __id__: number }), 'cc.Label');
    assert.equal(typeOf(item.redDot as { __id__: number }), 'cc.Node');
    assert.equal(typeOf(item.takenStamp as { __id__: number }), 'cc.Node');
});

test('D. 虚拟列表 NODE 模式：模板在 content 下（唯一子节点）、参数正确', () => {
    const list = PREFAB.find((o) => o?.__type__ === LIST_CID);
    assert.ok(list, 'VirtualScrollView 组件要在 prefab 里');
    assert.equal(list.useVirtualList, true);
    assert.equal(list.itemCreationMode, 0, 'NODE 模式（模板放 content 下，无独立 item prefab）');
    assert.equal(list.spacing, 10, '行间距 = FGUI lineGap 10');
    assert.ok(list.content, 'content 引用要绑上');
    // content 唯一子节点 = RowTemplate（挂 LimitTimeActItem）
    const contentIdx = (list.content as { __id__: number }).__id__;
    assert.deepEqual(childNameList(contentIdx), ['RowTemplate']);
    // RowTemplate 下有 RewardBar，4 个奖励格，每格有 Icon 子节点
    const rowChildren = (PREFAB[contentIdx]._children ?? []) as { __id__: number }[];
    const rowIdx = rowChildren[0].__id__;
    const rowKidIds = (PREFAB[rowIdx]._children ?? []) as { __id__: number }[];
    const rewardBarId = rowKidIds.map((c) => c.__id__).find((i) => PREFAB[i]._name === 'RewardBar');
    assert.ok(rewardBarId !== undefined, 'RowTemplate 下要有 RewardBar');
    const slots = ((PREFAB[rewardBarId]._children ?? []) as { __id__: number }[]).map((c) => PREFAB[c.__id__]);
    assert.equal(slots.length, 4, '4 个奖励格');
    for (const slot of slots) {
        const kids = ((slot._children ?? []) as { __id__: number }[]).map((c) => PREFAB[c.__id__]);
        assert.ok(kids.some((n) => n._name === 'Icon'), `${slot._name} 要有 Icon 子节点`);
    }
});
