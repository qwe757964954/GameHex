/**
 * 开服庆典（老端 `LayerOSRankUI` / `LayerOSRankDetailUI` + FGUI 包「开服冲榜」）的纯逻辑单测。
 *
 * ## 盯住哪四类东西（按「错了会不会报错」排序）
 *
 * | 组 | 内容 | 错了会怎样 |
 * |---|---|---|
 * | A | `CelebrationTable` 的判定与解析（零 `cc`） | 静默 —— 比如 `purchaseStateOf` 用 `>` 而非 `>=`、`buyCountOf` 用 `subId` 而非 `subId-1` |
 * | B | 美术资源存在性（`existsSync`） | 静默留白 + 一条 warn |
 * | C | prefab 结构与 `ArenaRoot` HUD 入口几何 | 静默 —— 红点被底图盖住 / 入口跑到屏幕外 |
 * | D | 视图脚本接线（源码文本） | 静默 —— `renderItemFn` 闭包捕获旧数据 |
 * | E | 文案（含**故意照抄**的老端错别字） | 有人"顺手修正"就与设计稿分叉 |
 * | F | `CelebrationArt` 的资源名 / 九宫名单（与 `.meta` 双向对账） | 静默 —— 九宫图按 SIMPLE 画 ⇒ 拉伸变形 |
 * | G | `CelebrationViewState` 的三个视图态纯函数（零 `cc`） | 静默 —— 页签停在错的选中态 |
 *
 * ## 为什么能直接 `import` 这些源码
 *
 * `CelebrationTable` / `CelebrationTexts` / `CelebrationArt` / `CelebrationViewState` 的 import
 * 链上**没有 `cc`**（`ArtPaths` 零依赖、`LayerActivityArt` → `SevenDayArt` → `ArtPaths` 也零依赖）。
 * 这是硬约束：一旦哪条链上出现 `import … from 'cc'`，本文件会整片 import 失败 ⇒
 * 那一刻的报错就是哨兵，别去「从测试里绕开」。
 *
 * ⚠️ `CelebrationRepository` / `CelebrationFrames` / 所有 `OS*.ts` 视图脚本**都带 `cc`**
 * ⇒ 本文件**不** import 它们（相关约束走 D 组的源码文本断言）。
 * 所以 `osTabVisual` / `osShopVisibility` / `osTargetNodeState` 被抽到
 * `CelebrationViewState.ts`（规则 78），本文件对它们**真跑逻辑**，而不是源码文本对账。
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
    CL_COUNTDOWN_LEAD_MS,
    CL_NOT_IN_RANK,
    ECelebrationRankSegment,
    ECelebrationTargetRewardType,
    buyCountOf,
    conditionTextOf,
    countdownHmsOf,
    countdownOffsetOf,
    enabledOf,
    limitBuyTextOf,
    myRankTextOf,
    numAbbrOf,
    parseConfigRows,
    parseRankRows,
    parseRankTimes,
    parseServerStates,
    parseShopRows,
    parseTargetRows,
    pickActiveServer,
    pricingOf,
    propertyWantTextOf,
    purchaseStateOf,
    rankActiveOf,
    rankReachedOf,
    rankSegmentOf,
    rankTextOf,
    rdOf,
    realRmbOf,
    saleTextOf,
    sortTargetsByState,
    stateBySubId,
    toCount,
    toText,
} from '../assets/script/app/celebration/CelebrationTable';
import type {
    ICelebrationPayChannelRow,
    ICelebrationRankRow,
    ICelebrationRankTime,
    ICelebrationServerState,
    ICelebrationShopRow,
    ICelebrationTargetRow,
} from '../assets/script/app/celebration/CelebrationTable';
import { CL_TEXTS } from '../assets/script/app/celebration/CelebrationTexts';
import {
    OS_ART_ALL_KEYS,
    OS_ART_NAMES,
    OS_ART_ROOT,
    OS_ART_SLICED,
    OS_ART_TILED,
    osArtPath,
    osArtRef,
    osQualityFrameLevel,
    osQualityFrameName,
    osSpriteType,
} from '../assets/script/app/celebration/CelebrationArt';
import { RL_ART_ROOT } from '../assets/script/app/role/RoleArt';
import {
    osShopVisibility,
    osTabVisual,
    osTargetNodeState,
} from '../assets/script/app/celebration/CelebrationViewState';
import { assetPath } from './helpers/asset-paths';

// ============================================================
// 公共小工具
// ============================================================

const CL_ROOT = assetPath('ui/Celebration');
const ARENA_ROOT = assetPath('ui/main/ArenaRoot.prefab');

/** 解析一个 prefab，返回对象数组。 */
function loadPrefab(path: string): any[] {
    return JSON.parse(readFileSync(path, 'utf8')) as any[];
}

/** 按名字找一个 `cc.Node` 的下标；找不到返回 -1。 */
function nodeIndex(o: any[], name: string, parentId?: number): number {
    return o.findIndex(
        (x) => x?.__type__ === 'cc.Node' && x._name === name
            && (parentId === undefined || x._parent?.__id__ === parentId),
    );
}

/** 取节点上的某类组件对象。 */
function compOf(o: any[], nodeId: number, type: string): any | null {
    for (const c of o[nodeId]._components ?? []) {
        const comp = o[c.__id__];
        if (comp?.__type__ === type) return comp;
    }
    return null;
}

/** 取节点上的脚本组件（`__type__` 是 23 位 cid，既不是 `cc.*` 也不是 `cc.` 开头的内置类型）。 */
function scriptOf(o: any[], nodeId: number): any | null {
    for (const c of o[nodeId]._components ?? []) {
        const comp = o[c.__id__];
        if (typeof comp?.__type__ === 'string' && comp.__type__.length === 23 && !comp.__type__.startsWith('cc.')) {
            return comp;
        }
    }
    return null;
}

/** 递归找 meta 里的 border 字段（Cocos 3.8 把它放在 `subMetas.<id>.userData`，但别写死层级）。 */
function deepBorder(obj: any): any | null {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.borderTop === 'number') return obj;
    for (const v of Object.values(obj)) {
        const hit = deepBorder(v);
        if (hit) return hit;
    }
    return null;
}

/** 取一张图的九宫 border（没配就是全 0）。 */
function borderOf(value: string): { t: number; b: number; l: number; r: number } {
    const metaPath = assetPath(`image/${value}.png.meta`);
    if (!existsSync(metaPath)) return { t: 0, b: 0, l: 0, r: 0 };
    const hit = deepBorder(JSON.parse(readFileSync(metaPath, 'utf8')));
    return hit
        ? { t: hit.borderTop ?? 0, b: hit.borderBottom ?? 0, l: hit.borderLeft ?? 0, r: hit.borderRight ?? 0 }
        : { t: 0, b: 0, l: 0, r: 0 };
}

/** 去掉注释（规则 104：反向断言 `!src.includes(x)` **必须先剥注释**，否则被自己文件里的反例注释绊倒）。 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

/** 一张图在磁盘上的第一个真实扩展名（`bg` 是 .jpg，其余基本是 .png）。 */
function artExt(relPathUnderResources: string): string | null {
    for (const ext of ['png', 'jpg', 'jpeg']) {
        if (existsSync(assetPath(`${relPathUnderResources}.${ext}`))) return ext;
    }
    return null;
}

const fixtureTarget: ICelebrationTargetRow = { id: 9001, subId: 1, count: 100, rewards: [{ resId: 1, number: 10 }] };
const fixtureRank: ICelebrationRankRow = {
    id: 9001, subId: 1, start: 1, end: 1, rewards1: [{ resId: 1, number: 1 }], count: 100, rewards2: [],
};
const fixtureShop: ICelebrationShopRow = {
    id: 9001, subId: 1, rmb: 101, costType: 3, costCount: 500, limit: 3, price: 12, discount: 500,
} as ICelebrationShopRow;

// ============================================================
// A. 判定与解析（CelebrationTable）
// ============================================================

test('庆祝 A1｜toCount 认不出必须返回 0（NaN 会让「已达标」静默变「未达标」）', () => {
    assert.equal(toCount(undefined), 0);
    assert.equal(toCount(null), 0);
    assert.equal(toCount(NaN), 0);
    assert.equal(toCount(Infinity), 0);
    assert.equal(toCount('abc'), 0);
    assert.equal(toCount('42'), 42);
    assert.equal(toCount(7), 7);
    // 压缩表解压后可能是字符串，必须能认
    assert.equal(toText(12), '12');
    assert.equal(toText(undefined), '');
});

test('庆祝 A2｜purchaseStateOf 是 `>=` 不是 `>`（limit=0 恒不可购买）', () => {
    assert.equal(purchaseStateOf(0, 3), 0, '没买过 → 可购买');
    assert.equal(purchaseStateOf(2, 3), 0);
    assert.equal(purchaseStateOf(3, 3), 1, '买到上限 → 不可购买');
    assert.equal(purchaseStateOf(4, 3), 1);
    assert.equal(purchaseStateOf(0, 0), 1, 'limit=0 ⇒ 恒不可购买（`>=` 的直接后果）');
});

test('庆祝 A3｜buyCountOf 的下标是 subId-1（用 subId 会读错一格）', () => {
    const server: ICelebrationServerState = { id: 1, curValue: 0, targetInfos: [], shopInfos: [5, 0, 9] };
    assert.equal(buyCountOf(server, 1), 5);
    assert.equal(buyCountOf(server, 3), 9);
    assert.equal(buyCountOf(server, 4), 0, '越界 → 0');
    assert.equal(buyCountOf(null, 1), 0, '没有 server 行 → 0');
});

test('庆祝 A4｜stateBySubId 三态 + 配置缺失退 Unfinished', () => {
    const targets = [fixtureTarget];
    const T = ECelebrationTargetRewardType;
    assert.equal(stateBySubId(targets, 9001, 1, 50, []), T.Unfinished, '没到门槛');
    assert.equal(stateBySubId(targets, 9001, 1, 100, []), T.Reward, '够了且没领');
    assert.equal(stateBySubId(targets, 9001, 1, 100, [1]), T.Received, '够了且已领（下标 subId-1）');
    assert.equal(stateBySubId(targets, 9001, 2, 999, []), T.Unfinished, '查不到那一行 → Unfinished（老端会抛）');
});

test('庆祝 A5｜rdOf 外层扫 rank.subId、内层判 target（老端原样，别"顺手修正"）', () => {
    const targets = [fixtureTarget, { id: 9001, subId: 2, count: 999, rewards: [] }];
    const ranks = [fixtureRank, { ...fixtureRank, subId: 2 }];
    // subId=1 够 100 → Reward → 红点 1
    assert.equal(rdOf(ranks, targets, 9001, 100, []), 1);
    // 只够 subId=1 的门槛，但把 targetInfos[0] 置 1 ⇒ 已领 ⇒ 不再有可领取
    assert.equal(rdOf(ranks, targets, 9001, 100, [1]), 0);
    assert.equal(rdOf(ranks, targets, 9001, 10, []), 0);
    // 换了 id ⇒ 一条都不匹配
    assert.equal(rdOf(ranks, targets, 8000, 999, []), 0);
});

test('庆祝 A6｜sortTargetsByState 升序且同状态保持表序', () => {
    const rows: ICelebrationTargetRow[] = [
        { id: 1, subId: 1, count: 1, rewards: [] },
        { id: 1, subId: 2, count: 1, rewards: [] },
        { id: 1, subId: 3, count: 1, rewards: [] },
    ];
    const stateOf = (subId: number) => ({ 1: 2, 2: 0, 3: 1 } as Record<number, number>)[subId];
    const sorted = sortTargetsByState(rows, stateOf);
    assert.deepEqual(sorted.map((r) => r.subId), [2, 3, 1], '可领取 → 未完成 → 已领取');
    assert.deepEqual(rows.map((r) => r.subId), [1, 2, 3], '不改入参');
});

test('庆祝 A7｜rankReachedOf 是 `>=`', () => {
    assert.equal(rankReachedOf(100, 100), true);
    assert.equal(rankReachedOf(99, 100), false);
});

test('庆祝 A8｜rankSegmentOf / rankTextOf 的分段与文案', () => {
    const S = ECelebrationRankSegment;
    assert.equal(rankSegmentOf(1, 1), S.First);
    assert.equal(rankSegmentOf(2, 3), S.SecondThird, '条件是 start>=2 && end<=3');
    assert.equal(rankSegmentOf(2, 4), S.Other);
    assert.equal(rankSegmentOf(4, 10), S.Other);
    assert.equal(rankTextOf(1, 1), '第1名');
    assert.equal(rankTextOf(2, 3), '2-3名', '区间文案不带「第」');
});

test('庆祝 A9｜myRankTextOf：-1 → 未上榜', () => {
    assert.equal(myRankTextOf(CL_NOT_IN_RANK, '未上榜', '第{0}名'), '未上榜');
    assert.equal(myRankTextOf(3, '未上榜', '第{0}名'), '第3名');
    assert.equal(CL_NOT_IN_RANK, -1);
});

test('庆祝 A10｜numAbbrOf 逐字复刻老端（阈值 1e4/1e7/1e10，小写 k，floor）', () => {
    assert.equal(numAbbrOf(0), '0');
    assert.equal(numAbbrOf(9999), '9999');
    assert.equal(numAbbrOf(1e4), '10k');
    assert.equal(numAbbrOf(19999), '19k', 'floor 不四舍五入');
    assert.equal(numAbbrOf(1e7), '10M');
    assert.equal(numAbbrOf(1e10), '10G');
    assert.equal(numAbbrOf(-1e4), '-10k', '走 abs 判阈值');
});

test('庆祝 A11｜countdownHmsOf 负数钳到 00:00:00（有意的偏离）', () => {
    assert.equal(countdownHmsOf(-1), '00:00:00');
    assert.equal(countdownHmsOf(0), '00:00:00');
    assert.equal(countdownHmsOf(1000), '00:00:01');
    assert.equal(countdownHmsOf(3_600_000), '01:00:00');
    assert.equal(countdownHmsOf(3661_000 * 2), '02:02:02');
});

test('庆祝 A12｜countdownOffsetOf 是「减」5 分钟且可为负', () => {
    const now = 1_000_000;
    assert.equal(countdownOffsetOf(now + CL_COUNTDOWN_LEAD_MS + 5000, now), 5000);
    assert.equal(countdownOffsetOf(now, now), -CL_COUNTDOWN_LEAD_MS, '最后 5 分钟内为负');
    assert.equal(CL_COUNTDOWN_LEAD_MS, 3e5);
});

test('庆祝 A13｜rankActiveOf：startTime<=0 一律 false', () => {
    const mk = (s: number, e: number): ICelebrationRankTime => ({ startTimeMs: s, endTimeMs: e } as ICelebrationRankTime);
    assert.equal(rankActiveOf(null, 1e12), false);
    assert.equal(rankActiveOf(mk(0, 9e12), 1e12), false, '服务端还没推 startTime');
    assert.equal(rankActiveOf(mk(1e11, 9e12), 1e12), true);
    assert.equal(rankActiveOf(mk(9e12, 1e13), 1e12), false, '还没开始');
});

test('庆祝 A14｜pickActiveServer 跳过过期行（不能退化成「取第一行」）', () => {
    const servers: ICelebrationServerState[] = [
        { id: 1, curValue: 1, targetInfos: [], shopInfos: [] },
        { id: 2, curValue: 2, targetInfos: [], shopInfos: [] },
    ];
    const now = 1e12;
    const times = new Map<number, ICelebrationRankTime>([
        [1, { startTimeMs: 1, endTimeMs: 5e11 } as ICelebrationRankTime],       // 已过期
        [2, { startTimeMs: 5e11, endTimeMs: 2e12 } as ICelebrationRankTime],   // 进行中
    ]);
    const picked = pickActiveServer(servers, times, now);
    assert.equal(picked?.id, 2, '旧庆典过期后必须选新的那一行');
    assert.equal(pickActiveServer(servers, new Map(), now), null, '一条都没时间窗 → null');
});

test('庆祝 A15｜enabledOf 需要「有 server 行」+「在时间窗内」', () => {
    const server: ICelebrationServerState = { id: 1, curValue: 0, targetInfos: [], shopInfos: [] };
    const time = { startTimeMs: 1, endTimeMs: 9e12 } as ICelebrationRankTime;
    assert.equal(enabledOf(time, server, 1e12), true);
    assert.equal(enabledOf(time, null, 1e12), false, '没有 server 行 → 不显示');
    assert.equal(enabledOf(null, server, 1e12), false);
});

test('庆祝 A16｜pricingOf：rmb 走 payChannel 换真金额，cost 走 costCount', () => {
    const pays: ICelebrationPayChannelRow[] = [{ id: 101, rmb: 30 } as ICelebrationPayChannelRow];
    const rmb = pricingOf(fixtureShop, pays);
    assert.equal(rmb.branch, 'rmb');
    assert.equal(rmb.priceText, '30', '`rmb` 是 payChannel.id ⇒ 必须过一次 realRmbOf');
    assert.equal(rmb.oldPriceText, '12', '原价是 row.price');
    assert.equal(rmb.showRmbSign, true);
    assert.equal(rmb.showCostIcon, false);

    const cost = pricingOf({ ...fixtureShop, rmb: 0 } as ICelebrationShopRow, pays);
    assert.equal(cost.branch, 'cost');
    assert.equal(cost.priceText, '500', 'cost 分支的现价是 costCount');
    assert.equal(cost.costIconResId, 3, '图标用 costType');
    assert.equal(cost.showCostIcon, true);

    assert.equal(realRmbOf(pays, 101), 30);
    assert.equal(realRmbOf(pays, 999), 999, '查不到退化成 rmbId 本身');
});

test('庆祝 A17｜四条文案拼装', () => {
    assert.equal(conditionTextOf('战力', 100, CL_TEXTS.conditionText0), '战力达到100');
    assert.equal(propertyWantTextOf('战力', CL_TEXTS.conditionTitle), '战力要求');
    assert.equal(saleTextOf(500, CL_TEXTS.discountSuffix), '5折');
    assert.equal(saleTextOf(150, CL_TEXTS.discountSuffix), '1.5折');
    assert.equal(limitBuyTextOf(2, 3, CL_TEXTS.limitSaleTemplate), '限购2/3');
});

test('庆祝 A18｜洗表：非法行被丢、字段能认字符串', () => {
    const configs = parseConfigRows([
        { id: 1, rankType: 10, name: '战力', targetGroupId: 1, rankGroupId: 1, sellGroupId: 1 },
        { id: 0, rankType: 1 },          // id<=0 丢
        null,                            // 非对象丢
        { id: '2', rankType: '20', name: '等级' },  // 字符串能认
    ]);
    assert.deepEqual(configs.map((c) => c.id), [1, 2]);
    assert.equal(configs[1].rankType, 20);
    assert.equal(configs[1].name, '等级');

    const targets = parseTargetRows([
        { id: 1, subId: 1, count: '100', rewards: [{ resId: 5, number: '2' }, { resId: 0, number: 9 }] },
        { id: 1, subId: 0 },             // subId<=0 丢
    ]);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].count, 100);
    assert.deepEqual(targets[0].rewards, [{ resId: 5, number: 2 }], 'resId<=0 的奖励被丢');

    const ranks = parseRankRows([{ id: 1, subId: 1, start: 1, end: 1, count: 10, rewards1: [], rewards2: [] }]);
    assert.equal(ranks.length, 1);
    assert.equal(ranks[0].start, 1);

    const shops = parseShopRows([{ id: 1, subId: 1, rmb: 101, costType: 3, costCount: 5, limit: 1, price: 9, discount: 500 }]);
    assert.equal(shops.length, 1);
    assert.equal(shops[0].rmb, 101);

    const servers = parseServerStates([
        { id: 7, curValue: '5', targetInfos: [1, '0'], shopInfos: ['2'] },
        { id: 0 },
    ]);
    assert.equal(servers.length, 1);
    assert.equal(servers[0].curValue, 5);
    assert.deepEqual(servers[0].targetInfos, [1, 0]);
    assert.deepEqual(servers[0].shopInfos, [2]);

    assert.deepEqual(parseConfigRows('not-array'), []);
    assert.deepEqual(parseTargetRows(undefined), []);
    assert.deepEqual(parseServerStates(null), []);
});

test('庆祝 A19｜parseRankTimes 按 type 建表', () => {
    const times = parseRankTimes([
        { type: 10, startTime: 100, endTime: 200 },
        { type: 20, startTime: 300, endTime: 400 },
    ]);
    assert.equal(times.size, 2);
    assert.equal(times.get(10)?.startTimeMs, 100_000, '老端的秒 → 毫秒换算');
    assert.equal(times.get(20)?.endTimeMs, 400_000);
    assert.equal(times.get(99), undefined);
});

// ============================================================
// B. 美术资源存在性
// ============================================================

test('庆祝 B1｜OS_ART_NAMES 每一张图都在磁盘上（漏一张就是静默留白 + 一条 warn）', () => {
    const missing: string[] = [];
    for (const key of OS_ART_ALL_KEYS) {
        const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
        // ⚠️ 只查 .png 会把 `bg`（os_qd_tongyong.jpg）判成缺图 ⇒ 假红（2026-09-28）
        if (!artExt(`${OS_ART_ROOT}/${value}`)) missing.push(`${key} → ${value}`);
    }
    assert.deepEqual(missing, [], '缺图清单');
});

test('庆祝 B2｜OS_ART_NAMES 的值都相对 image/ 且带目录（别拼成 image/celebration/<name>）', () => {
    for (const key of OS_ART_ALL_KEYS) {
        const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
        assert.ok(value.includes('/'), `${key} 的值「${value}」没带目录`);
        assert.ok(!value.startsWith('/'), `${key} 的值不该以 / 开头`);
        assert.equal(osArtRef(key)?.root + '/' + osArtRef(key)?.name, value, `${key} 的 osArtRef 切分要能还原`);
    }
    assert.equal(osArtRef('不存在的key'), null);
});

test('庆祝 B3｜osArtPath 必须带 image/ 前缀 + /spriteFrame（漏前缀 ⇒ Bundle doesn\'t contain）', () => {
    const bad: string[] = [];
    for (const key of OS_ART_ALL_KEYS) {
        const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
        const path = osArtPath(key);
        if (path !== `${OS_ART_ROOT}/${value}/spriteFrame`) {
            bad.push(`${key} → ${path}（应为 ${OS_ART_ROOT}/${value}/spriteFrame）`);
            continue;
        }
        // 拼出来的路径必须在 resources 下真的有这张图（png / jpg 都算）
        const rel = path.slice(0, -'/spriteFrame'.length);
        const ok = ['png', 'jpg', 'jpeg'].some((ext) => existsSync(assetPath(`${rel}.${ext}`)));
        if (!ok) bad.push(`${key} → assets/resources/${rel} 在磁盘上不存在`);
    }
    assert.deepEqual(bad, [], '装配路径不对 / 磁盘上没这张图');
    assert.equal(osArtPath('不存在的key'), '', '缺 key 返回空串，别拼出 image//spriteFrame');
});

test('庆祝 B4｜OS_ART_ROOT 与 RoleArt 的美术根同一口径（都是 image）', () => {
    assert.equal(OS_ART_ROOT, 'image');
    // 真源在零 cc 的 `RoleArt.RL_ART_ROOT`（`RoleArtLoader` 只是转发）⇒ 那边改了这边必须跟着改
    assert.equal(OS_ART_ROOT, RL_ART_ROOT, 'OS_ART_ROOT 与 RL_ART_ROOT 分叉 ⇒ 又是同一类静默留白');
});

// ============================================================
// F. CelebrationArt：资源名 / 九宫名单（与 .meta 双向对账）
// ============================================================

test('庆祝 F1｜OS_ART_SLICED ↔ .png.meta 的 border 双向对账', () => {
    const wrong: string[] = [];
    for (const key of OS_ART_ALL_KEYS) {
        const value = (OS_ART_NAMES as Readonly<Record<string, string>>)[key];
        const b = borderOf(value);
        // ⚠️ 判据是「**任意一条** border 非 0」，与生成器 `tmp/_fguilib.mjs` 的 `spriteTypeOf`
        //    （`border.some(v => v > 0)`）同一口径 —— 按「四面都非 0」判会把
        //    `bb_pic30` / `BB_img03` 这类**只有左右边框**的横向彩条误判成不是九宫（假红）。
        const hasBorder = b.t > 0 || b.b > 0 || b.l > 0 || b.r > 0;
        const inList = OS_ART_SLICED.has(key);
        if (hasBorder !== inList) {
            wrong.push(`${key}: meta border=${b.t},${b.b},${b.l},${b.r} 但名单里${inList ? '有' : '没有'}`);
        }
    }
    assert.deepEqual(wrong, [], '九宫名单与 meta 不一致（漏了 ⇒ 图被按 SIMPLE 拉伸变形）');
});

test('庆祝 F2｜osSpriteType 只对名单内的 key 返回 SLICED', () => {
    for (const key of OS_ART_SLICED) assert.equal(osSpriteType(key), 1, `${key} 应是 SLICED`);
    assert.equal(osSpriteType('bg'), 0, '整屏底图是 SIMPLE');
    assert.equal(osSpriteType('不存在的key'), 0);
});

test('庆祝 F3｜本包没有 tile 图（空集合是事实，不是漏写）', () => {
    assert.equal(OS_ART_TILED.size, 0);
});

test('庆祝 F4｜品质框档位与名字', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 99].map(osQualityFrameLevel), [1, 1, 2, 3, 4, 4, 4]);
    assert.equal(osQualityFrameName(1), 'common_img_pzk_01');
    assert.equal(osQualityFrameName(4), 'common_img_pzk_04');
    assert.equal(osQualityFrameLevel(NaN), 1);
});

// ============================================================
// G. 视图态纯函数（CelebrationViewState，规则 78 抽出来的零 cc 层）
// ============================================================

test('庆祝 G1｜osTabVisual：选中 / 未选中各亮两张，绝不重叠', () => {
    const off = osTabVisual(false);
    assert.deepEqual(off, { plateUp: true, plateDown: false, iconOff: true, iconOn: false });
    const on = osTabVisual(true);
    assert.deepEqual(on, { plateUp: false, plateDown: true, iconOff: false, iconOn: true });
    // 四个字段恰好两真两假，且没有「四张全亮 / 全灭」的退化
    for (const v of [off, on]) {
        const vals = [v.plateUp, v.plateDown, v.iconOff, v.iconOn];
        assert.equal(vals.filter(Boolean).length, 2);
        assert.notEqual(v.plateUp, v.plateDown);
        assert.notEqual(v.iconOff, v.iconOn);
    }
});

test('庆祝 G2｜osShopVisibility：两个分支 × 两种购买状态', () => {
    // rmb + 可购买：现价 + ￥可见，货币图标 / 售罄不可见
    assert.deepEqual(osShopVisibility('rmb', 0), {
        priceVisible: true, rmbSignVisible: true, costIconVisible: false, soldOutVisible: false, buyGrayed: false,
    });
    // cost + 可购买
    assert.deepEqual(osShopVisibility('cost', 0), {
        priceVisible: true, rmbSignVisible: false, costIconVisible: true, soldOutVisible: false, buyGrayed: false,
    });
    // 不可购买：现价 / ￥ / 货币图标全灭，售罄亮，按钮置灰
    for (const branch of ['rmb', 'cost'] as const) {
        const v = osShopVisibility(branch, 1);
        assert.equal(v.priceVisible, false, `${branch} 不可购买时不显现价`);
        assert.equal(v.rmbSignVisible, false);
        assert.equal(v.costIconVisible, false);
        assert.equal(v.soldOutVisible, true);
        assert.equal(v.buyGrayed, true, '是置灰不是禁用（老端只 gearLook）');
    }
    // 「可购买」时三种小件恰好亮一个
    for (const branch of ['rmb', 'cost'] as const) {
        const v = osShopVisibility(branch, 0);
        assert.equal([v.rmbSignVisible, v.costIconVisible].filter(Boolean).length, 1);
        assert.equal(v.soldOutVisible, false);
    }
});

test('庆祝 G3｜osTargetNodeState：三态互斥且覆盖，与老端页 id 对齐', () => {
    const T = ECelebrationTargetRewardType;
    assert.deepEqual(osTargetNodeState(T.Reward), { claimVisible: true, goVisible: false, claimedVisible: false });
    assert.deepEqual(osTargetNodeState(T.Unfinished), { claimVisible: false, goVisible: true, claimedVisible: false });
    assert.deepEqual(osTargetNodeState(T.Received), { claimVisible: false, goVisible: false, claimedVisible: true });
    // 三态各恰好亮一个
    for (const s of [T.Reward, T.Unfinished, T.Received]) {
        const v = osTargetNodeState(s);
        assert.equal([v.claimVisible, v.goVisible, v.claimedVisible].filter(Boolean).length, 1);
    }
});

test('庆祝 G4｜CelebrationViewState 必须保持零 cc（规则 78 的守卫）', () => {
    const src = stripComments(readFileSync('assets/script/app/celebration/CelebrationViewState.ts', 'utf8'));
    assert.ok(!/from\s+'cc'/.test(src), "CelebrationViewState.ts 里出现了 from 'cc' ⇒ 本文件的 G 组会整片失效");
    // 三个视图脚本必须改为从这里转发，而不是各留一份本地实现
    for (const f of ['OSTabButton', 'OSShopItem', 'OSTargetItem']) {
        const view = readFileSync(`assets/script/app/celebration/${f}.ts`, 'utf8');
        assert.ok(/from\s+'\.\/CelebrationViewState'/.test(view), `${f}.ts 应从 CelebrationViewState 转发`);
    }
});

// ============================================================
// C. prefab 结构
// ============================================================

test('庆祝 C1｜7 个庆典 prefab 都在，且 layer 全是 UI_2D', () => {
    const names = ['OSRank', 'OSRankTargetItem', 'OSRankRankItem', 'OSRankShopItem',
        'OSRankRewardItem', 'OSRankDetailRow', 'OSRankRankDetail'];
    for (const n of names) {
        const p = `${CL_ROOT}/${n}.prefab`;
        assert.ok(existsSync(p), `缺 ${p}`);
        const o = loadPrefab(p);
        const badLayers = o
            .filter((x) => x?.__type__ === 'cc.Node' && x._layer !== 33554432)
            .map((x) => `${x._name}=${x._layer}`);
        assert.deepEqual(badLayers, [], `${n} 有非 UI_2D 的节点（UI 相机会整棵子树不渲染）`);
    }
});

test('庆祝 C2｜OSRank 的三个页签各挂 OSTabButton，且默认停在「庆典排名」页', () => {
    const o = loadPrefab(`${CL_ROOT}/OSRank.prefab`);
    for (const tab of ['TabTarget', 'TabRank', 'TabShop']) {
        const i = nodeIndex(o, tab);
        assert.notEqual(i, -1, `缺页签节点 ${tab}`);
        assert.ok(scriptOf(o, i), `${tab} 上没挂脚本组件`);
    }
    const page = loadPrefab(`${CL_ROOT}/OSRank.prefab`);
    const rootScript = scriptOf(page, nodeIndex(page, 'OSRank'));
    assert.ok(rootScript, 'OSRank 根上没挂 OSRankPage');
    // 首次打开停在「庆典排名」（FGUI `页签 selected="1"`）
    const src = readFileSync('assets/script/app/celebration/OSRankPage.ts', 'utf8');
    assert.ok(/CL_DEFAULT_TAB\s*=\s*1/.test(src), '默认页签应为 1（庆典排名）');
});

test('庆祝 C3｜OSRankPage 声明了 rankHeaderNodes（数组属性，MCP 绑不了 ⇒ 只能回生成器）', () => {
    const o = loadPrefab(`${CL_ROOT}/OSRank.prefab`);
    const rootScript = scriptOf(o, nodeIndex(o, 'OSRank'));
    assert.ok(Array.isArray(rootScript.rankHeaderNodes), 'rankHeaderNodes 应是数组引用');
    assert.equal(rootScript.rankHeaderNodes.length, 6, '列头底图 ×3 + 文案 ×3');
    for (const ref of rootScript.rankHeaderNodes) {
        assert.equal(o[ref.__id__].__type__, 'cc.Node', '数组元素必须指向「节点」（指组件会静默读成空）');
    }
});

/** 节点 → FGUI 画布盒 `{l,t,w,h}`（y 向下）。根 720×1280、锚点 (0.5,0.5) ⇒ 中心 (360,640)。 */
function fguiBox(o: any[], nodeId: number): { l: number; t: number; w: number; h: number } {
    const ui = compOf(o, nodeId, 'cc.UITransform')!;
    const w = ui._contentSize.width, h = ui._contentSize.height;
    const ax = ui._anchorPoint.x, ay = ui._anchorPoint.y;
    const x = o[nodeId]._lpos.x, y = o[nodeId]._lpos.y;
    const tlX = 360 + x - ax * w;       // 左上角 UI x（父中心 360）
    const tlY = 640 + y + (1 - ay) * h; // 左上角 UI y（父中心 640，y 向上）
    return { l: tlX, t: 1280 - tlY, w, h };
}

test('庆祝 C4｜主容器 4 个贴底延展节点按 720×1280 适配（FGUI 设计稿 720×1476 压 196）', () => {
    // FGUI 原稿 `组件_开服冲榜_主界面` 是 720×1476，这 4 个节点挂了
    //   `relation target="n90_延展" sidePair="bottomext-bottom"` ⇒ 在 720×1280 屏上
    //   「顶部不动、底部贴屏、高度压 196」。生成器若把 `bottomext` 当普通 `bottom` 位移
    //   （整类静默错）会让它们整体上移 196、高度不变 —— 只有量画布才看得见，`prefab_audit` 不报。
    const o = loadPrefab(`${CL_ROOT}/OSRank.prefab`);
    const rootId = nodeIndex(o, 'OSRank');
    const expect: Record<string, { l: number; t: number; w: number; h: number }> = {
        PanelBg: { l: 0, t: 487, w: 720, h: 594 },
        ListRank: { l: 29, t: 582, w: 659, h: 470 },
        ListTarget: { l: 32, t: 529, w: 660, h: 514 },
        ListShop: { l: 26, t: 518, w: 667, h: 524 },
    };
    for (const [name, e] of Object.entries(expect)) {
        const id = nodeIndex(o, name, rootId);
        assert.notEqual(id, -1, `缺 ${name}`);
        const b = fguiBox(o, id);
        assert.deepEqual(
            { l: Math.round(b.l), t: Math.round(b.t), w: Math.round(b.w), h: Math.round(b.h) },
            e,
            `${name} 贴底适配错位（若 t 比预期小 196 且 h 比预期大 196 = bottomext 被当成了 bottom 位移）`,
        );
    }
});

// ============================================================
// F'. ArenaRoot HUD 入口（本轮新增，MCP 手做 ⇒ 最容易被后人改坏）
// ============================================================

test("庆祝 F'1｜ArenaRoot 根下有 OSRankEntry，结构与 ChatEntry 同构", () => {
    const o = loadPrefab(ARENA_ROOT);
    const rootId = o.findIndex((x) => x?.__type__ === 'cc.Node' && x._parent === null);
    assert.notEqual(rootId, -1);

    const entryId = nodeIndex(o, 'OSRankEntry', rootId);
    assert.notEqual(entryId, -1, 'ArenaRoot 根下缺 OSRankEntry');

    // 🔴 规则 86：_active 必须烘 true（烘 false ⇒ onLoad 不跑 ⇒ 永久不可见且不报错）
    assert.equal(o[entryId]._active, true, 'OSRankEntry 的 _active 必须烘 true');

    // 与 ChatEntry 同构：子节点序 [Btn, RedDot]
    const kids = (o[entryId]._children ?? []).map((c: any) => o[c.__id__]._name);
    assert.deepEqual(kids, ['Btn', 'RedDot'], '兄弟序 = 画序：红点必须在底图之后（否则被盖住）');

    // Widget：RIGHT|BOTTOM(36)，right=15（= ChatEntry.right）、bottom=264
    const w = compOf(o, entryId, 'cc.Widget');
    assert.ok(w, 'OSRankEntry 上缺 cc.Widget');
    assert.equal(w._alignFlags, 36, 'RIGHT|BOTTOM');
    assert.equal(w._right, 15);
    assert.equal(w._bottom, 264);
    assert.equal(w._left, 0);
    assert.equal(w._top, 0);
    assert.equal(w._alignMode, 2, 'ALWAYS');

    // 落位与 Widget 自洽：父 720×1280、节点 100×100 ⇒ 中心 (360-15-50, -640+264+50)
    assert.deepEqual({ x: o[entryId]._lpos.x, y: o[entryId]._lpos.y }, { x: 295, y: -326 });
});

test("庆祝 F'2｜Btn：90×100 + 入口图 + cc.Button（缺 Button 就是静默死按钮）", () => {
    const o = loadPrefab(ARENA_ROOT);
    const rootId = o.findIndex((x) => x?.__type__ === 'cc.Node' && x._parent === null);
    const entryId = nodeIndex(o, 'OSRankEntry', rootId);
    const btnId = nodeIndex(o, 'Btn', entryId);
    assert.notEqual(btnId, -1);

    const ui = compOf(o, btnId, 'cc.UITransform');
    assert.equal(ui._contentSize.width, 90, '尺寸沿用老端 90×100');
    assert.equal(ui._contentSize.height, 100);
    assert.equal(ui._anchorPoint.x, 0.5);
    assert.equal(ui._anchorPoint.y, 0.5);

    const sprite = compOf(o, btnId, 'cc.Sprite');
    assert.ok(sprite, 'Btn 上缺 cc.Sprite');
    assert.equal(sprite._sizeMode, 0, 'CUSTOM，否则贴图会回写 contentSize');
    assert.equal(sprite._spriteFrame.__uuid__, 'e1b801f1-4a48-4b49-962a-ce4117e8da7e@f9941', '入口图 = 战斗选关_按钮_开服冲榜');

    const button = compOf(o, btnId, 'cc.Button');
    assert.ok(button, 'Btn 上缺 cc.Button（`Button.EventType.CLICK` 永远不会 emit ⇒ 点了毫无反应且不报错）');
    assert.equal(button._transition, 3, 'SCALE');
    assert.equal(button._zoomScale, 0.92);
    assert.equal(button._duration, 0.08);
});

test("庆祝 F'3｜RedDot：30×30 + 位置 (34,34) + 烘 false，且脚本 redDot 指向它", () => {
    const o = loadPrefab(ARENA_ROOT);
    const rootId = o.findIndex((x) => x?.__type__ === 'cc.Node' && x._parent === null);
    const entryId = nodeIndex(o, 'OSRankEntry', rootId);
    const dotId = nodeIndex(o, 'RedDot', entryId);
    assert.notEqual(dotId, -1);

    const ui = compOf(o, dotId, 'cc.UITransform');
    assert.equal(ui._contentSize.width, 30);
    assert.equal(ui._contentSize.height, 30);
    assert.deepEqual({ x: o[dotId]._lpos.x, y: o[dotId]._lpos.y }, { x: 34, y: 34 });
    assert.equal(o[dotId]._active, false, '设计期隐藏（页面每趟无条件改写，规则 82）');

    const sprite = compOf(o, dotId, 'cc.Sprite');
    assert.ok(sprite, 'RedDot 上缺 cc.Sprite');
    assert.ok(sprite._spriteFrame.__uuid__, 'RedDot 没绑图');

    // 脚本的 redDot 必须指向「节点」（指组件会静默读成 null）
    const btnId = nodeIndex(o, 'Btn', entryId);
    const script = scriptOf(o, btnId);
    assert.ok(script, 'Btn 上缺 OSRankEntryButton');
    assert.equal(typeof script.__type__, 'string');
    assert.equal(script.__type__.length, 23, '脚本组件 __type__ 必须是 23 位 cid');
    assert.notEqual(script.redDot, null, 'redDot 没绑上');
    assert.equal(o[script.redDot.__id__].__type__, 'cc.Node', 'redDot 应指向节点对象');
    assert.equal(o[script.redDot.__id__]._name, 'RedDot');
});

test("庆祝 F'4｜两张红点图字节相同（所以 cu_icon_dot 与 cm_red_dot 可互换）", () => {
    const a = readFileSync(assetPath(`image/common/cu_icon_dot.png`));
    const b = readFileSync(assetPath(`image/common/cm_red_dot.png`));
    assert.equal(Buffer.compare(a, b), 0, '这两张是同一张图的副本；若不相等，说明有人换了其中一张，入口红点样式会与同屏 HUD 不一致');
    // 两个文件都必须还在（CelebrationArt 用 cu_icon_dot，ArenaRoot 入口用 cm_red_dot）
    assert.ok(existsSync(assetPath(`image/common/cu_icon_dot.png`)));
    assert.ok(existsSync(assetPath(`image/common/cm_red_dot.png`)));
});

// ============================================================
// D. 视图脚本接线（源码文本）
// ============================================================

test('庆祝 D1｜OSRankPage 的列表回调只绑一次，且不闭包捕获行数据（规则 55）', () => {
    const src = readFileSync('assets/script/app/celebration/OSRankPage.ts', 'utf8');
    assert.ok(/static\s+prefabPath\s*=\s*'ui\/Celebration\/OSRank'/.test(src), 'prefabPath 不对');
    // renderItemFn 每个列表各绑一次，且都在 onInit 里（target / rank / shop 三份 ⇒ 3 次）
    const assigns = src.match(/\.renderItemFn\s*=/g) ?? [];
    assert.equal(assigns.length, 3, `renderItemFn 应是三个列表各绑一次（共 3 次），实际 ${assigns.length} 次`);
    // 不允许在 renderItemFn 里 for…of this.rows 这种闭包捕获
    assert.ok(!/for\s*\(\s*const\s+\w+\s+of\s+this\.(rows|_snapshot)\s*\)/.test(src),
        'renderItemFn 里禁止闭包捕获本趟数据（应按 index 现取）');
});

test('庆祝 D2｜OSRankEntryButton 点击走 Button.EventType.CLICK、且不写 off(...)（规则 71）', () => {
    // ⚠️ 先剥注释：本文件的注释里**故意**写了 `off(...)` 的反例（规则 71 的说明）
    const src = stripComments(readFileSync('assets/script/app/celebration/OSRankEntryButton.ts', 'utf8'));
    assert.ok(/Button\.EventType\.CLICK/.test(src), '应监听 CLICK（该节点有 cc.Button）');
    assert.ok(!/\.off\s*\(/.test(src), 'onDestroy 里禁止写 off(...)（会中断销毁链）');
    assert.ok(/applySnapshot/.test(src), '需要 applySnapshot 供探针注入');
    // active 无条件写（规则 82）
    assert.ok(/this\.node\.active\s*=/.test(src));
});

test('庆祝 D3｜数据层的判定全部转发自零 cc 的 CelebrationTable', () => {
    const src = readFileSync('assets/script/app/celebration/CelebrationRepository.ts', 'utf8');
    assert.ok(/from\s+'\.\/CelebrationTable'/.test(src), '判定应来自 CelebrationTable');
    assert.ok(!/export\s+function\s+purchaseStateOf/.test(src), 'purchaseStateOf 不该在 Repository 里再实现一份');
});

// ============================================================
// E. 文案
// ============================================================

test('庆祝 E1｜老端原文照抄：footerTip 里的「多钱」是**有意的**错别字', () => {
    assert.equal(CL_TEXTS.footerTip, '排行榜奖励将于多钱活动结束后次日0：00通过邮件发放');
    assert.ok(CL_TEXTS.footerTip.includes('多钱'), '这是 FGUI 原文；改了就等于单方面改设计稿');
});

test('庆祝 E2｜半角冒号（FGUI 原文如此，别"顺手"换全角）', () => {
    assert.equal(CL_TEXTS.myRankLabel, '我的名次:');
    assert.equal(CL_TEXTS.powerLabelFallback, '战斗力:');
});

test('庆祝 E3｜mL.json 的 7 条原文逐条对上', () => {
    assert.equal(CL_TEXTS.countdownSuffix, '后刷新');
    assert.equal(CL_TEXTS.positionTemplate, '第{0}名');
    assert.equal(CL_TEXTS.notInRank, '未上榜');
    assert.equal(CL_TEXTS.limitSaleTemplate, '限购{0}/{1}');
    assert.equal(CL_TEXTS.conditionTitle, '要求');
    assert.equal(CL_TEXTS.conditionText0, '{0}达到{1}');
    assert.equal(CL_TEXTS.conditionText1, '{0}达{1}');
});

test('庆祝 E4｜FGUI 静态文案', () => {
    assert.equal(CL_TEXTS.detailButton, '详细排名>');
    assert.equal(CL_TEXTS.goBuildButton, '前往提升>');
    assert.equal(CL_TEXTS.colRank, '排名');
    assert.equal(CL_TEXTS.colReward, '基础奖励');
    assert.equal(CL_TEXTS.soldOut, '已售罄');
    assert.equal(CL_TEXTS.detailColPlayer, '玩家信息');
    assert.equal(CL_TEXTS.detailColPower, '战力');
});
