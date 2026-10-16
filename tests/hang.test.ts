/**
 * 征收（挂机，老端 `LayerHang` / FGUI 包「挂机」）移植的回归网。
 *
 * 分六段，各守一件事：
 *
 *   A. **判定口径**（`HangTable`，**零 import** 纯函数）—— 老端这些判定散在
 *      `ModelChapterNew` / `ModelHang` / `ModelRole` / `LayerHangUI` 里（依赖 DI 容器 +
 *      FGUI 控制器），没法单测；移植时全收敛成传参纯函数，本段是唯一回归网。
 *      ⚠️ 快照级查询（`freePageOf` / `adCountBranchOf` / `progressOf` …）也在这里，
 *      不是随手放 —— 见下面「为什么判定必须在 Table 里」。
 *   B. **资源口径**（`HangArt`）—— 三处「查不到就静默不出图」的坑：`resources.load`
 *      少 `/spriteFrame`、`trimType` 裁掉透明边让九宫 border 偏、`HJ_ART_SLICED` 漏一张
 *      导致「图照样显示、只是整张被拉伸」。
 *   C. **prefab 结构 + 几何** —— 脚本组件的 `__type__` 必须能从 `*.ts.meta` 反解（防 cid 抄错
 *      成 `MissingScript`）；节点位置必须与 FGUI XML 反解出的画布像素一致。
 *   D. **数据管道接线**（源码文本）—— 四条协议名 + `MessageId`、缓存读法、超时兜底、
 *      入口 / 弹窗口径、`CacheMgr` 生成的 `getTl*` 方法名。
 *   E. **文案表**。
 *   F. **主界面「征收」入口（HUD）** —— 挂在 `ui/main/ArenaRoot.prefab` 上、**不**走
 *      `open.url` 白名单。守三件「改错了不报错」的事：`_active` 必须烘 `true`（否则
 *      `onLoad` 死锁）、`_children` 序 = FGUI displayList 序、`Btn` 是 `scaleFree`
 *      缩出来的 100×90.27（不是 100×100）。
 *
 * ## ⚠️ 为什么判定必须在 `HangTable` 里（而不是 `HangRepository`）
 *
 * 家族约定（`BattleTokenTable` / `GiftTable` / `MonthCardGiftTable` 同）：**Table 层零引擎依赖**
 * ——不 import `cc`、不 import `RefUtil` / `CacheMgr`，所以能在 Node 里直接跑。
 * `HangRepository` 拖进 `CacheMgr`（→ `GameNet` → `cc`）就再也跑不了单测，
 * 于是「只读源码文本」是它的唯一测法。
 * 本文件第一行断言 `HangTable.ts` **一个 import 都没有**，就是在守这条约定 ——
 * 谁往 Table 里加一个 import，判定逻辑就整体失去回归网。
 *
 * ## ⚠️ 两层「表」都要解压（本文件最大的坑）
 *
 * `assets/remoteRef/*.json` 有**两种形状**：
 *
 * | 形状 | 例 | 行是什么 |
 * |---|---|---|
 * | 普通数组 | `gameConfig` / `ad` / `item` / `roleProperty` / `monthCardActPlan` / `payChannel` | 对象 |
 * | **压缩表** `{k,v,c}`（`c === 1`） | `guankaReward` / `interactReward` | **数组** |
 *
 * 压缩表的行是数组，`row.id` / `row.level` 一律 `undefined` —— 不解压直接断言
 * **判据恒空但测试照样绿**（`assert.equal(rows.length, 0)` 也会过）。
 * 运行时由 `RefUtil.compressKeyRefDataFix()` 按 `k` 展成对象，本文件的 `readRefRows()`
 * 是它的逐字复刻。两张压缩表都**没有** `vk` / `sv`（共享值与二级键映射），
 * 所以只需要「`k[i] → row[i]`」这一步。
 *
 * ## ⚠️ `CmdBattleLevel.star` 是**位掩码**
 *
 * 不是星数。`0b011` = 1 星 + 2 星。老端 `GetStageIsPerfectClean()` 写的
 * `mask >= StageProgress.threeStar(3)` 实际含义是「**2 星及以上**」，与 FGUI 文案一致。
 * 本文件 A 段把这个口径两侧都钉住（`levelStarCount` 与 `deriveSweetLevel`）。
 *
 * 口径真源：
 *   - 配置：`assets/remoteRef/{guankaReward,interactReward,gameConfig,ad,item,roleProperty,monthCardActPlan,payChannel}.json`
 *   - 老端：`client/assets/script/app/game/{ctrl/hang,model/hang,model/chapter,model/vo/Other}/**`
 *   - 设计：`zarts/art/UIProject/trunk/UIProject/assets/挂机/**`（720×1280）
 *   - 缓存：`assets/resources/config/protoCache.json`
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { FRAME_ART_ROOT, spriteFramePath } from '../assets/script/app/ArtPaths';
import {
    HJ_ART_NAMES,
    HJ_ART_ROOT,
    HJ_ART_SLICED,
    HJ_COST_ICON_NAME,
    HJ_COST_ICON_PATH,
    HJ_RESOURCE_ICON_ROOT,
    HJ_SHARED_BTN_DARK,
    HJ_SHARED_BTN_GOLD,
    HJ_SHARED_BTN_SWEEP,
    HJ_SHARED_CLOSE,
    HJ_SHARED_PANEL_BG,
    HJ_SHARED_PANEL_TITLE,
    HJ_SHARED_RED_DOT,
    HJ_SHARED_RED_DOT_NEW,
    HJ_SHARED_RED_DOT_NUM,
    HJ_SPRITE_SIMPLE,
    HJ_SPRITE_SLICED,
    QUALITY_FRAME_NAMES,
    hjArtPath,
    hjArtRef,
    hjSharedPath,
    hjSpriteType,
    qualityFrameLevel,
    qualityFrameName,
    qualityFramePath,
} from '../assets/script/app/hang/HangArt';
import { qualityFrameLevel as sevenDayQualityFrameLevel } from '../assets/script/app/sevenDay/SevenDayArt';
import {
    HJ_CFG_SWEEP_FREE_TIMES,
    HJ_DEFAULT_GEAR_INDEX,
    HJ_END_RES_ID,
    HJ_FALLBACK_INCOME_LEVEL,
    HJ_FALLBACK_SWEEP_FREE_TIMES,
    HJ_INSTANCE_TYPE_NORMAL,
    HJ_INTERACT_STATE_DONE,
    HJ_INTERACT_TYPE_AFK_BLDG,
    HJ_MAX_IDLE_MS,
    HJ_MIN_CHALLENGE_LEVEL,
    HJ_MIN_CLAIM_MS,
    HJ_PASSED_STAR,
    HJ_PERFECT_STAR,
    HJ_STAR_BITS,
    HJ_SWEEP_GEARS,
    HJ_SWEEP_TYPE_CHAPTER,
    adCountBranchOf,
    adLeftOf,
    canClaim,
    cappedElapsedMsOf,
    claimableOf,
    collectInteractTaxRewards,
    contentCenterOffsetY,
    costTextOf,
    deriveMaxChallengeLevel,
    deriveSweetLevel,
    elapsedMsOf,
    formatHms,
    freePageOf,
    gearLabel,
    guankaRowOf,
    idleCappedMs,
    idleElapsedMs,
    idleProgress01,
    idleReachedMax,
    incomeLevelOf,
    levelStarCount,
    mergeRewards,
    monthCardBarVisibleOf,
    nextGearIndex,
    normalizeRewards,
    parseGameConfigRows,
    parseGuankaRow,
    parseGuankaRows,
    parseInteractRows,
    perHourText,
    progressOf,
    reachedMaxOf,
    rewardAt,
    shouldTick,
    sweepCostText,
    sweepFreeTimesOf,
    sweepLevelOf,
    sweepTimesOf,
    sweepUsedOf,
    timesOf,
} from '../assets/script/app/hang/HangTable';
import type { IHjGuankaRow, IHjInteractRow, IHjReward, IHjSnapshotView } from '../assets/script/app/hang/HangTable';
import { HJ_TEXTS, hjFormat, hjFormatPercent } from '../assets/script/app/hang/HangTexts';
// ⚠️ 主界面入口（`EntranceLayer`）那两张表是**纯数据 + 纯函数**，Node 里能直接 import。
// 征收**不**在里面（见 F 段最后一条用例）—— 这里 import 是为了从**函数口径**反向钉住它。
import {
    isEntranceUrlRouted,
    resolveEntranceRoute,
    routedEntranceUrls,
} from '../assets/script/app/main/MainEntranceRoute';

// ============================================================
// 共用夹具
// ============================================================

/**
 * 读一张 `remoteRef` 表 → 行对象数组。
 *
 * ⚠️ 两形状都要认（见文件头）：`c === 1` 的压缩表按 `k` 展列，业务侧由
 * `RefUtil.compressKeyRefDataFix()` 做同一件事。**别写成只认数组**。
 */
function readRefRows(name: string): Array<Record<string, unknown>> {
    const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][]; c?: number };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => {
        const entry: Record<string, unknown> = {};
        raw.k.forEach((key, index) => { entry[key] = row[index]; });
        return entry;
    });
}

function src(file: string): string {
    return readFileSync(`assets/script/app/hang/${file}`, 'utf8');
}

/** 造一行关卡。 */
function guanka(level: number, instanceType: number = HJ_INSTANCE_TYPE_NORMAL, chapter?: number): IHjGuankaRow {
    return {
        level,
        instanceType,
        chapter: chapter ?? level,
        stage: 1,
        end: 5,
        idleRewards: [],
    };
}

/** 造一条最小快照（只给 `IHjSnapshotView` 要的字段）。 */
function snapshot(patch: Partial<IHjSnapshotView> = {}): IHjSnapshotView {
    return {
        hasUnlimited: false,
        sweepFreeTimes: HJ_FALLBACK_SWEEP_FREE_TIMES,
        sweepEnd: 5,
        now: 0,
        role: null,
        monthCard: null,
        ...patch,
    };
}

/** 一张「所有章节都存在」的查询器。 */
const allChapters = (): boolean => true;

const GUANKA_ROWS_RAW = readRefRows('guankaReward');
const INTERACT_ROWS_RAW = readRefRows('interactReward');
const GUANKA_ROWS = parseGuankaRows(GUANKA_ROWS_RAW);
const INTERACT_ROWS = parseInteractRows(INTERACT_ROWS_RAW);
const CONFIG = parseGameConfigRows(readRefRows('gameConfig'));

// ============================================================
// A. 判定口径（HangTable）
// ============================================================

test('⚠️ `HangTable.ts` 零 import —— 这是「判定逻辑可单测」的物理前提，别往里加 import', () => {
    const table = src('HangTable.ts');
    assert.equal(/^\s*import\s/m.test(table), false, 'HangTable 出现了 import —— 判定逻辑会失去 Node 单测能力');
    // 兜底：确认读到的是真文件（不然「没匹配上」会假绿）
    assert.ok(table.includes('export function deriveMaxChallengeLevel'));
});

test('常量口径与老端逐条一致', () => {
    assert.equal(HJ_MAX_IDLE_MS, 8 * 60 * 60 * 1000, '老端 `maxIdleTime = 8 * 60 * 60 * 1000`');
    assert.equal(HJ_MIN_CLAIM_MS, 60 * 60 * 1000, '老端 `onClickReceive` 的 `diffTime < 3600000`');
    assert.deepEqual([...HJ_SWEEP_GEARS], [1, 5, 10, 20, 50], '老端 `SWEEP_GEARS` 写死');
    assert.equal(HJ_DEFAULT_GEAR_INDEX, 0);
    assert.equal(HJ_CFG_SWEEP_FREE_TIMES, 'sweepFreeTimes');
    assert.equal(HJ_FALLBACK_SWEEP_FREE_TIMES, 3);
    assert.equal(HJ_INTERACT_TYPE_AFK_BLDG, 3, '老端 `ModelHang.AFK_BLDG_TYPE`');
    assert.equal(HJ_INTERACT_STATE_DONE, 1, '老端 `vo.GetState() === 1`');
    assert.equal(HJ_INSTANCE_TYPE_NORMAL, 0, '老端 `InstanceType.Normal`');
    assert.equal(HJ_MIN_CHALLENGE_LEVEL, 1, '老端 `let maxLevel = 1`');
    assert.equal(HJ_FALLBACK_INCOME_LEVEL, 1);
    assert.equal(HJ_SWEEP_TYPE_CHAPTER, 1, '`CmdBattleType.CHAPTER`');
    assert.equal(HJ_STAR_BITS, 3, '星级掩码只有低 3 位');
});

test('⚠️ `HJ_END_RES_ID = 9` 的来源是 `RefEnum.roleProperty.end`，**不是 `roleProperty.json` 的列**', () => {
    assert.equal(HJ_END_RES_ID, 9);
    const enumSrc = readFileSync('assets/script/app/generated/refGen/RefEnum.ts', 'utf8');
    assert.match(enumSrc, /export enum roleProperty \{[\s\S]*?\bend = 9,/);
    // 反向：`roleProperty.json` **没有** `end` 列 —— 曾经按 `roleProperty` 表找 `end` 列，找不到
    const props = readRefRows('roleProperty');
    assert.ok(props.length > 0);
    const columns = Object.keys(props[0]!);
    assert.equal(columns.includes('end'), false, `roleProperty.json 不该有 end 列，实际列：${columns.join('/')}`);
    // 表里 `resId = 9` 那行就是体力 —— 图标 / 品质都据此
    const end = props.find((row) => Number(row.resId) === HJ_END_RES_ID);
    assert.ok(end, 'roleProperty 里应有 resId=9 的行');
    assert.equal(end!.name, '体力');
    assert.equal(end!.icon, HJ_COST_ICON_NAME);
    assert.equal(end!.quality, 3);
});

test('⚠️ 星级是**位掩码**：`levelStarCount` 才是星数（老端 `VOBattleChapter.ToLocalStar`）', () => {
    assert.equal(levelStarCount(0), 0);
    assert.equal(levelStarCount(1), 1, '0b001 = 1 星');
    assert.equal(levelStarCount(3), 2, '0b011 = 1 星 + 2 星');
    assert.equal(levelStarCount(7), 3, '0b111 = 满星');
    // 非法输入不抛
    assert.equal(levelStarCount(Number.NaN), 0);
    assert.equal(levelStarCount(-1), 0);
    // 老端实现：`(s&1) + ((s>>1)&1) + ((s>>2)&1)`，只取低 3 位
    for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
        assert.equal(levelStarCount(mask), (mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1), `mask=${mask}`);
    }
});

test('⚠️ `HJ_PERFECT_STAR = 3` 是**掩码**门槛 ⇒ 实际语义「2 星及以上」，与 FGUI 文案一致', () => {
    assert.equal(HJ_PERFECT_STAR, 3);
    // 2 星（mask=3）应当「达标」—— 如果谁把它改成「星数 >= 3」，这条立刻红
    assert.ok(3 >= HJ_PERFECT_STAR, 'mask=3（2 星）必须算达标');
    assert.ok(levelStarCount(3) < 3, 'mask=3 的星数只有 2 —— 门槛比的不是星数');
    assert.equal(HJ_TEXTS.levelHint, '征收最新2星及以上通关的关卡奖励', '文案门槛与代码门槛是同一个');
});

test('normalizeRewards：坏条目直接丢（表里 `idleRewards` 允许为空数组）', () => {
    assert.deepEqual(normalizeRewards(null), []);
    assert.deepEqual(normalizeRewards(undefined), []);
    assert.deepEqual(normalizeRewards({}), []);
    assert.deepEqual(normalizeRewards('x'), []);
    assert.deepEqual(normalizeRewards([]), []);
    assert.deepEqual(
        normalizeRewards([
            { resId: 7, number: 16 },
            { resId: 0, number: 1 },        // resId 非法
            { resId: -3, number: 1 },       // resId 非法
            { resId: 8, number: 0 },        // number 非法
            { resId: 8, number: -1 },       // number 非法
            { resId: 8 },                   // number 缺失
            { number: 3 },                  // resId 缺失
            [1, 2],                         // 数组
            null,
            7,
            { resId: '9', number: '2' },    // 数字串认（列存表里可能是字符串）
        ]),
        [{ resId: 7, number: 16 }, { resId: 9, number: 2 }],
    );
    // `pro` 等下发表里的额外字段被丢掉，只留 `{resId, number}`
    assert.deepEqual(normalizeRewards([{ resId: 7, number: 16, pro: 10000 }]), [{ resId: 7, number: 16 }]);
});

test('mergeRewards：同 resId 相加、新 resId 追加到末尾、base 顺序不变（顺序有语义！）', () => {
    const base: IHjReward[] = [{ resId: 7, number: 16 }, { resId: 16014, number: 1 }];
    const extra: IHjReward[] = [{ resId: 16014, number: 4 }, { resId: 10013, number: 2 }];
    assert.deepEqual(mergeRewards(base, extra), [
        { resId: 7, number: 16 },
        { resId: 16014, number: 5 },
        { resId: 10013, number: 2 },
    ]);
    // 不改入参（`_mergeTaxRewards` 的 `map` 拷贝就是为了这个）
    assert.deepEqual(base, [{ resId: 7, number: 16 }, { resId: 16014, number: 1 }]);
    assert.deepEqual(mergeRewards([], extra), extra);
    assert.deepEqual(mergeRewards(base, []), base);
});

test('⚠️ 真表 `guankaReward` lv1：merged 顺序与数值 = 截图上的「16/h」「1/h」', () => {
    const lv1 = GUANKA_ROWS.find((row) => row.level === 1);
    assert.ok(lv1, 'guankaReward 应当有 level=1 的行');
    // ⚠️ 原始 6 条里有两条 `resId=10012`（number 2 与 3），**老端不去重**：
    //    `_mergeTaxRewards` 第一句是 `baseRewards.map(...)` —— 原样拷贝，只在合并「互动建筑
    //    加成」时才做同 resId 相加。所以这里必须得到 6 条、第 3/4 条都是 10012。
    //    （曾经误以为会去重成 5 条 —— 去重后的条数分布是 `{0:200, 5:1432}`，但那是 resId 的
    //      **唯一值**个数，不是列表条数，见 C 段那个网格用例。）
    assert.equal(lv1!.idleRewards.length, 6, 'lv1 原始 6 条（含一对重复 resId=10012）');
    const merged = mergeRewards(lv1!.idleRewards, []);
    assert.deepEqual(merged, [
        { resId: 7, number: 16 },
        { resId: 16014, number: 1 },
        { resId: 10012, number: 2 },
        { resId: 10012, number: 3 },
        { resId: 10011, number: 1 },
        { resId: 10013, number: 1 },
    ]);
    // 右侧两个展示位用的是 `merged[0]` / `merged[1]`（顺序有语义）⇒ 截图上的「16/h」「1/h」
    assert.equal(perHourText(rewardAt(merged, 0)), '16/h');
    assert.equal(perHourText(rewardAt(merged, 1)), '1/h');
    // 反向：把「互动建筑加成」合进来时，第 1 条的银币要涨、且**条数不变**（resId 7 已存在）
    const withTax = mergeRewards(lv1!.idleRewards, collectInteractTaxRewards(INTERACT_ROWS, new Set([2630001])));
    assert.equal(withTax.length, 6, '互动加成只加数值，不新增条目（`resId=7` 本来就有）');
    assert.equal(rewardAt(withTax, 0)!.number, 16 + 5, '产税建筑（type=3）每座 +5 银币/h');
    assert.equal(lv1!.end, 5, 'lv1 快速征收一次扣 5 体力');
});

test('rewardAt / perHourText：越界返回 null 且文案为空串（老端这里会直接崩）', () => {
    const list: IHjReward[] = [{ resId: 7, number: 16 }];
    assert.deepEqual(rewardAt(list, 0), { resId: 7, number: 16 });
    assert.equal(rewardAt(list, 1), null);
    assert.equal(rewardAt([], 0), null);
    assert.equal(perHourText(null), '');
    assert.equal(perHourText({ resId: 7, number: 16 }), '16/h');
});

test('parseGuankaRow / parseGuankaRows / guankaRowOf', () => {
    assert.equal(parseGuankaRow(null), null);
    assert.equal(parseGuankaRow([]), null);
    assert.equal(parseGuankaRow({ level: 0 }), null, 'level 必须为正整数');
    assert.equal(parseGuankaRow({ level: -1 }), null);
    assert.deepEqual(parseGuankaRow({ level: 3 }), {
        level: 3, instanceType: 0, chapter: 0, stage: 0, end: 0, idleRewards: [],
    });
    assert.deepEqual(parseGuankaRow({ level: '7', instanceType: '0', chapter: '2', stage: '3', end: '5' }), {
        level: 7, instanceType: 0, chapter: 2, stage: 3, end: 5, idleRewards: [],
    });
    assert.deepEqual(parseGuankaRows([{ level: 1 }, null, { level: 2 }]).map((r) => r.level), [1, 2]);
    assert.deepEqual(parseGuankaRows('nope'), []);
    // 真表
    assert.equal(GUANKA_ROWS.length, 1632, 'guankaReward 1632 行（压缩表 v 的长度）');
    assert.deepEqual(
        guankaRowOf(GUANKA_ROWS, 2)!.idleRewards.map((r) => r.number),
        [17, 1, 2, 3, 1, 1],
        '第 2 关的产出（银币 17/h）',
    );
    assert.equal(guankaRowOf(GUANKA_ROWS, 99999), null);
});

test('parseInteractRows / collectInteractTaxRewards：只算 `type === 3` 且 `state === 1`', () => {
    const rows: IHjInteractRow[] = [
        { id: 100, type: HJ_INTERACT_TYPE_AFK_BLDG, rewards: [{ resId: 7, number: 5 }] },
        { id: 200, type: 1, rewards: [{ resId: 7, number: 100 }] },       // 非产税建筑
        { id: 300, type: HJ_INTERACT_TYPE_AFK_BLDG, rewards: [{ resId: 7, number: 2 }, { resId: 9, number: 3 }] },
    ];
    assert.deepEqual(collectInteractTaxRewards(rows, new Set([100])), [{ resId: 7, number: 5 }]);
    assert.deepEqual(collectInteractTaxRewards(rows, new Set([100, 200])), [{ resId: 7, number: 5 }], 'type=1 不算');
    assert.deepEqual(collectInteractTaxRewards(rows, new Set([100, 300])), [
        { resId: 7, number: 7 },
        { resId: 9, number: 3 },
    ], '同 resId 汇总、新 resId 追加');
    assert.deepEqual(collectInteractTaxRewards(rows, new Set()), [], '一个都没互动 ⇒ 空');
    // 真表
    assert.equal(INTERACT_ROWS.length, 199);
    const tax = INTERACT_ROWS.filter((r) => r.type === HJ_INTERACT_TYPE_AFK_BLDG);
    assert.equal(tax.length, 9, 'type=3 只有 9 行（battlelevel 26/46/66/… 每 20 关一个）');
    assert.deepEqual(tax.map((r) => r.id), [2630001, 4630001, 6630001, 8630001, 10630001, 12630001, 14630001, 16630001, 18630001]);
    for (const row of tax) assert.deepEqual(row.rewards, [{ resId: 7, number: 5 }], '每个产税建筑都是 +5 银币/h');
    // 全互动 ⇒ 9 × 5 = 45，而不是 45 条独立条目
    assert.deepEqual(collectInteractTaxRewards(INTERACT_ROWS, new Set(tax.map((r) => r.id))), [{ resId: 7, number: 45 }]);
});

test('parseGameConfigRows / sweepFreeTimesOf：读不到退 3（老端同值）', () => {
    const map = parseGameConfigRows([{ key: 'a', value: 1 }, { key: ' b ', value: '2' }, { value: 3 }, null, 'x']);
    assert.equal(map.size, 2);
    assert.equal(map.get('a'), 1);
    assert.equal(map.get('b'), '2');
    assert.equal(sweepFreeTimesOf(map), HJ_FALLBACK_SWEEP_FREE_TIMES, 'map 里没有这一项 ⇒ 退 3');
    assert.equal(sweepFreeTimesOf(parseGameConfigRows([])), HJ_FALLBACK_SWEEP_FREE_TIMES);
    assert.equal(sweepFreeTimesOf(parseGameConfigRows([{ key: HJ_CFG_SWEEP_FREE_TIMES, value: 5 }])), 5);
    assert.equal(sweepFreeTimesOf(parseGameConfigRows([{ key: HJ_CFG_SWEEP_FREE_TIMES, value: '5' }])), 5, '数字串认');
    assert.equal(sweepFreeTimesOf(parseGameConfigRows([{ key: HJ_CFG_SWEEP_FREE_TIMES, value: 0 }])), HJ_FALLBACK_SWEEP_FREE_TIMES, '0 视为无效');
    assert.equal(sweepFreeTimesOf(parseGameConfigRows([{ key: HJ_CFG_SWEEP_FREE_TIMES, value: 2.7 }])), 2, '取整');
    // 真表
    assert.equal(sweepFreeTimesOf(CONFIG), 3, 'gameConfig.sweepFreeTimes = 3');
    assert.equal(HJ_CFG_SWEEP_FREE_TIMES, 'sweepFreeTimes', 'key 名就是老端 `GetGameConfigValueByKey` 传的那个');
});

test('时长口径：idleElapsedMs / idleCappedMs / idleProgress01 / idleReachedMax / canClaim / shouldTick', () => {
    assert.equal(idleElapsedMs(1000, 5000), 4000);
    assert.equal(idleElapsedMs(5000, 1000), 0, '负数归零');
    assert.equal(idleElapsedMs(Number.NaN, 1000), 1000, 'NaN 起点按 0');
    assert.equal(idleElapsedMs(1000, Number.NaN), 0);

    assert.equal(idleCappedMs(-1), 0);
    assert.equal(idleCappedMs(HJ_MAX_IDLE_MS + 1), HJ_MAX_IDLE_MS, '封顶 8h');
    assert.equal(idleProgress01(0), 0);
    assert.equal(idleProgress01(HJ_MAX_IDLE_MS), 1);
    assert.equal(idleProgress01(HJ_MAX_IDLE_MS * 2), 1, '封顶后不越界');
    assert.equal(idleProgress01(HJ_MAX_IDLE_MS / 2), 0.5);

    assert.equal(idleReachedMax(HJ_MAX_IDLE_MS - 1), false);
    assert.equal(idleReachedMax(HJ_MAX_IDLE_MS), true, '等于即到顶');
    assert.equal(shouldTick(HJ_MAX_IDLE_MS), false, '到顶就停表（老端 `timer.stop()`）');
    assert.equal(shouldTick(HJ_MAX_IDLE_MS - 1), true);

    assert.equal(canClaim(HJ_MIN_CLAIM_MS - 1), false);
    assert.equal(canClaim(HJ_MIN_CLAIM_MS), true);
});

test('⚠️ formatHms 是 `08:00:00` 形态，**不是**战令那个带「N天」前缀的（别复用）', () => {
    assert.equal(formatHms(0), '00:00:00');
    assert.equal(formatHms(1000), '00:00:01');
    assert.equal(formatHms(60_000), '00:01:00');
    assert.equal(formatHms(3_600_000), '01:00:00');
    assert.equal(formatHms(27 * 60_000 + 6_000), '00:27:06');
    assert.equal(formatHms(HJ_MAX_IDLE_MS), '08:00:00', '封顶恰好 8h 整');
    assert.equal(formatHms(-1), '00:00:00');
    // ⚠️ 老端 `timeMillisecond2HMSStr` = `timeSec2HMSStr(Math.ceil(time * 0.001))` —— 是**进位**
    assert.equal(formatHms(1999), '00:00:02', '进位到 2 秒，不是截断成 1 秒');
    assert.equal(formatHms(3_599_999), '01:00:00', '差 1ms 也进位到整点');
    // ⚠️ **封顶不在这里** —— 老端是在 `refreshTime()` 里先钳到 `maxIdleTime` 再格式化。
    //    直接喂超量值会如实列出 >8h（这不是 bug，是「本函数不管封顶」的证明）；
    //    要走封顶必须先过 `idleCappedMs` / `cappedElapsedMsOf`。
    assert.equal(formatHms(HJ_MAX_IDLE_MS + 60_000), '08:01:00', '本函数不封顶');
    assert.equal(formatHms(idleCappedMs(HJ_MAX_IDLE_MS + 60_000)), '08:00:00', '封顶后恰好 8h');
    // 快照口径也要封顶（⚠️ 起点 <= 0 是「服务端还没推 / 离线」⇒ 归 0，不是从 1970 年算）
    const hung24h = snapshot({ now: 1_000 + HJ_MAX_IDLE_MS * 3, role: { lastIdleRewardTimeMs: 1_000, sweepTimes: 0 } });
    assert.equal(cappedElapsedMsOf(hung24h), HJ_MAX_IDLE_MS, '挂了 24h 也只算 8h');
    assert.equal(formatHms(cappedElapsedMsOf(hung24h)), '08:00:00', '快照口径封顶');
    assert.equal(formatHms(cappedElapsedMsOf(snapshot({ now: 99_999, role: { lastIdleRewardTimeMs: 0, sweepTimes: 0 } }))), '00:00:00', '起点 0 = 离线 ⇒ 归 0');
    assert.equal(formatHms(27 * 3_600_000), '27:00:00', '不带「N天」前缀（与战令那个刻意不同）');
});

test('倍率口径：非月卡恒 1；`nextGearIndex` 环绕；角标 / 花费文案', () => {
    for (const index of [0, 1, 2, 3, 4, 99, -1]) {
        assert.equal(sweepTimesOf(index, false), 1, '`hasUnlimited=false` ⇒ 下标被忽略，恒 1');
    }
    assert.equal(sweepTimesOf(0, true), 1);
    assert.equal(sweepTimesOf(2, true), 10);
    assert.equal(sweepTimesOf(4, true), 50);
    assert.equal(sweepTimesOf(9, true), 1, '越界退默认档');

    assert.deepEqual([0, 1, 2, 3, 4].map(nextGearIndex), [1, 2, 3, 4, 0], '1→5→10→20→50→1');
    assert.equal(nextGearIndex(99), HJ_DEFAULT_GEAR_INDEX, '非法下标 → 默认档（0）');

    assert.equal(gearLabel(1), 'x1');
    assert.equal(gearLabel(50), 'x50');

    // ⚠️ 服务端按 `end × times` 扣体力（`BattleSweepHandler` 第 3 步）
    assert.equal(sweepCostText(5, 1), 'x5');
    assert.equal(sweepCostText(5, 10), 'x50');
    assert.equal(sweepCostText(0, 5), 'x0', '`end` 查不到就是 0（不是 5）');
    assert.equal(sweepCostText(5, 0), 'x5', 'times 非法按 1');
});

test('★ `contentCenterOffsetY`：内容块的竖直中心（用于把整块移到屏幕中心）', () => {
    // 老端：`LayerHangUI.init()` 第一行 `com.toFullCenterParent(container)` + FGUI 组 n78 的
    // `relation center-center,middle-middle` ⇒ 内容块**恒居中于屏幕**。
    // 新端只搬了静态坐标 ⇒ 偏下，运行时用这个函数求补偿量（取负 = 上移量）。
    assert.equal(contentCenterOffsetY([]), 0, '空集合不补偿（别返回 −Infinity/NaN）');
    assert.equal(contentCenterOffsetY([{ bottom: -50, top: 50 }]), 0, '单块已居中 ⇒ 0');
    // 单块居中偏移：中心就是 (top+bottom)/2
    assert.equal(contentCenterOffsetY([{ bottom: -10, top: 90 }]), 40);
    // 多块取并集（对应 FGUI 组的 AABB：顶取最大值、底取最小值）
    assert.equal(contentCenterOffsetY([
        { bottom: -655, top: -514 },   // 月卡条
        { bottom: -504, top: 399 },    // 弹窗底板
    ]), -128);
    // 顺序无关（AABB 是集合运算）
    assert.equal(contentCenterOffsetY([
        { bottom: -504, top: 399 },
        { bottom: -655, top: -514 },
    ]), -128);
    // 月卡条隐藏 ⇒ 只剩底板 ⇒ 偏移变成 −52.5（居中量随显隐变，写死常数会错）
    assert.equal(contentCenterOffsetY([{ bottom: -504, top: 399 }]), -52.5);
});

test('⚠️ deriveMaxChallengeLevel：上界 = **普通关总数**，空表返回 **0**（别钳到 1）', () => {
    const rows = [guanka(1), guanka(2), guanka(3), { ...guanka(4, 9) }];
    assert.equal(deriveMaxChallengeLevel(rows, () => false), 1, '一关没过 ⇒ 1');
    assert.equal(deriveMaxChallengeLevel(rows, (lv) => lv <= 1), 2);
    assert.equal(deriveMaxChallengeLevel(rows, (lv) => lv <= 2), 3);
    assert.equal(deriveMaxChallengeLevel(rows, () => true), 3, 'clamp 到普通关数（3），不是 4');
    assert.equal(deriveMaxChallengeLevel([], () => true), 0, '空表 0 —— 与 FirstRechargeAutoOpen 同口径');
    // 断档：第 2 关没过就停，后面的第 3 关过了也不算
    assert.equal(deriveMaxChallengeLevel(rows, (lv) => lv === 1 || lv === 3), 2);
    // 非普通关（instanceType 9）被过滤掉，不进 clamp 的分母
    assert.equal(deriveMaxChallengeLevel([{ ...guanka(1, 9) }], () => true), 0);
});

test('⚠️ deriveSweetLevel：比的是**掩码**（>= 3 ⇔ 2 星），且 `hasChapter` 为假时 **break**', () => {
    const rows = [guanka(1), guanka(2), guanka(3), guanka(4)];
    // 掩码语义：3（2 星）算达标
    assert.equal(deriveSweetLevel(rows, (lv) => (lv === 2 ? 3 : 0), allChapters), 2, 'mask=3（2 星）必须算达标');
    assert.equal(deriveSweetLevel(rows, (lv) => (lv === 1 ? 2 : 0), allChapters), null, 'mask=2（只有 1 星）不算');
    assert.equal(deriveSweetLevel(rows, (lv) => (lv === 1 ? 1 : 0), allChapters), null, 'mask=1 不算');
    assert.equal(deriveSweetLevel(rows, (lv) => (lv === 3 ? 7 : 0), allChapters), 3, '满星算');
    // 取「最后一个」达标的
    assert.equal(deriveSweetLevel(rows, () => 7, allChapters), 4);
    assert.equal(deriveSweetLevel([], () => 7, allChapters), null);

    // ⚠️ 老端 `VOBattleChapterBag.Get(ref.chapter) == null` ⇒ break（整段停止扫描）
    const missingAt3 = (chapter: number): boolean => chapter < 3;
    assert.equal(
        deriveSweetLevel(rows, () => 7, missingAt3),
        2,
        '第 3 章没数据 ⇒ 第 4 章也不再看（break 而不是 continue）',
    );
    // 若写成 continue，这条会变 4 —— 正是这条断言在守
    assert.notEqual(deriveSweetLevel(rows, () => 7, () => true), 2);
});

test('incomeLevelOf / sweepLevelOf：收益与消耗可以不是同一关，**只有展示那侧兜底**', () => {
    // 展示侧（`incomeLevelOf`）：有意偏差 —— 老端查 `level = 0` 得空、界面全空；
    // Demo3.8 退到第 1 关，让离线预览 / 新号看得见「产出奖励」区。**纯展示，不参与请求。**
    assert.equal(incomeLevelOf(1), 1, '一关没过时老端查 level=0（表里没有）⇒ Demo3.8 退到第 1 关');
    assert.equal(incomeLevelOf(2), 1);
    assert.equal(incomeLevelOf(3), 2);
    assert.equal(incomeLevelOf(0), 1);
    assert.equal(incomeLevelOf(-5), 1);
    assert.equal(incomeLevelOf(Number.NaN), 1);

    // 请求侧（`sweepLevelOf`）：**与老端一致，不兜底** —— 没满星关 ⇒ 0
    //   （老端 `ref == null` ⇒ 不写花费文案 + `onClickLevy` 第一句 return，一个请求都不发）
    assert.equal(sweepLevelOf(7), 7, '有满星关 ⇒ 用 `GetSweetLevel()`');
    assert.equal(sweepLevelOf(null), 0, '没满星关 ⇒ 0（**不许**退到第 1 关，否则新号会发老端从不发的请求）');
    assert.equal(sweepLevelOf(0), 0);
    assert.equal(sweepLevelOf(-1), 0);
    assert.equal(sweepLevelOf(Number.NaN), 0);
    // 反向：签名只有一个参数（多一个 `maxChallengeLevel` 就是又埋了兜底）
    assert.match(src('HangTable.ts'), /export function sweepLevelOf\(sweetLevel: number \| null\): number \{/);
    assert.equal(/export function sweepLevelOf\([^)]*maxChallengeLevel/.test(src('HangTable.ts')), false);
});

test('快照查询：起点为 0（离线）时进度归 0，**不是**从 1970 年算起', () => {
    const now = 1_700_000_000_000;
    const offline = snapshot({ now });
    assert.equal(elapsedMsOf(offline), now, '裸 `elapsedMsOf` 会算出巨大值 —— 所以页面不许直接用它');
    assert.equal(cappedElapsedMsOf(offline), 0, '起点 0 ⇒ 归 0');
    assert.equal(progressOf(offline), 0);
    assert.equal(reachedMaxOf(offline), false);
    assert.equal(claimableOf(offline), false);

    const half = snapshot({ now, role: { lastIdleRewardTimeMs: now - HJ_MAX_IDLE_MS / 2, sweepTimes: 0 } });
    assert.equal(cappedElapsedMsOf(half), HJ_MAX_IDLE_MS / 2);
    assert.equal(progressOf(half), 0.5);
    assert.equal(reachedMaxOf(half), false);
    assert.equal(claimableOf(half), true);

    const full = snapshot({ now, role: { lastIdleRewardTimeMs: now - HJ_MAX_IDLE_MS * 3, sweepTimes: 0 } });
    assert.equal(cappedElapsedMsOf(full), HJ_MAX_IDLE_MS, '封顶');
    assert.equal(progressOf(full), 1);
    assert.equal(reachedMaxOf(full), true);
});

test('快照查询：倍率 / 花费（无月卡恒 `x5`，即使快照里带了别的档位）', () => {
    const s = snapshot({ sweepEnd: 5 });
    assert.equal(timesOf(s), 1);
    assert.equal(timesOf(s, 4), 1, '无月卡时档位参数被忽略');
    assert.equal(costTextOf(s), 'x5');
    assert.equal(costTextOf(s, 4), 'x5');
    assert.equal(costTextOf(snapshot({ sweepEnd: 5, hasUnlimited: true }), 4), 'x250', '满档 50 倍 ⇒ 5×50');
});

test('⚠️ `freePageOf`：语义反直觉 —— **「免费=是」(1) 才是「还有免费次数」**', () => {
    // 老端 `btn.setSelectedIndex("免费", sweepTimes >= sweepFreeTimes ? 0 : 1)`
    assert.equal(freePageOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 0 } })), 1);
    assert.equal(freePageOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 2 } })), 1);
    assert.equal(freePageOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 3 } })), 0, '用完了 ⇒ 0（显示看视频图标）');
    assert.equal(freePageOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 99 } })), 0);
    assert.equal(freePageOf(snapshot({ sweepFreeTimes: 3 })), 1, '`sweepTimes` 读不到按 0 ⇒ 还有免费次数');
    assert.equal(freePageOf(snapshot({ hasUnlimited: true, role: { lastIdleRewardTimeMs: 1, sweepTimes: 99 } })), 1, '有月卡恒「是」');
});

test('`adCountBranchOf` / `adLeftOf` / `sweepUsedOf`：三个互斥分支', () => {
    assert.equal(adCountBranchOf(snapshot()), 'left');
    assert.equal(adCountBranchOf(snapshot({ hasUnlimited: true })), 'unlimited', '有月卡优先');
    assert.equal(
        adCountBranchOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 3 } })),
        'watch',
    );
    assert.equal(adLeftOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 1 } })), 2);
    assert.equal(adLeftOf(snapshot({ sweepFreeTimes: 3, role: { lastIdleRewardTimeMs: 1, sweepTimes: 99 } })), 0, '不为负');
    assert.equal(sweepUsedOf(snapshot()), 0);
    assert.equal(monthCardBarVisibleOf(snapshot()), true, '无月卡 ⇒ 显示销售条');
    assert.equal(monthCardBarVisibleOf(snapshot({ hasUnlimited: true })), false);
});

test('⚠️ 真表：列表条数**恒为 6**（两条同 resId），刚好填满 6 格网格', () => {
    // 两种口径都要看，别混：
    //   ① **列表条数** = `mergeRewards(idleRewards, [])` 的长度（老端 `list.update(result)` 用这个）
    //      ⇒ 直方图 `{0: 200, 6: 1432}`，**永远是 6**（`idleRewards` 里本来就有一对重复 resId）
    //   ② **唯一 resId 个数** ⇒ `{0: 200, 5: 1432}`
    // 曾经把 ② 当成 ①，于是推出「第 6 格永远隐藏」—— **错**：6 格刚好被 6 条填满。
    const listSizes = new Map<number, number>();
    const uniqueSizes = new Map<number, number>();
    for (const row of GUANKA_ROWS) {
        const rows = mergeRewards(row.idleRewards, []);
        listSizes.set(rows.length, (listSizes.get(rows.length) ?? 0) + 1);
        const unique = new Set(rows.map((r) => r.resId)).size;
        uniqueSizes.set(unique, (uniqueSizes.get(unique) ?? 0) + 1);
    }
    assert.deepEqual([...listSizes].sort((a, b) => a[0] - b[0]), [[0, 200], [6, 1432]], `列表条数分布 ${JSON.stringify([...listSizes])}`);
    assert.deepEqual([...uniqueSizes].sort((a, b) => a[0] - b[0]), [[0, 200], [5, 1432]], `唯一 resId 分布 ${JSON.stringify([...uniqueSizes])}`);
    assert.equal(listSizes.get(0), 200, '200 行是空数组（= 普通关总数）');
    // 网格只有 6 格（见 C 段）⇒ 「列表条数 ≤ 6」这个约束一旦破了就会静默丢格
    assert.ok(Math.max(...listSizes.keys()) <= 6, '产出条数超过了网格格数 —— 需要加格');
});

test('真表：普通关 200 关（level 1..200 连续），非普通关也在同表里', () => {
    const normal = GUANKA_ROWS.filter((row) => row.instanceType === HJ_INSTANCE_TYPE_NORMAL);
    assert.equal(normal.length, 200);
    assert.equal(normal[0]!.level, 1);
    assert.equal(normal[normal.length - 1]!.level, 200);
    for (let i = 1; i < normal.length; i++) {
        assert.ok(normal[i]!.level > normal[i - 1]!.level, '普通关 level 必须严格递增（`derive*` 依赖顺序）');
    }
    const types = [...new Set(GUANKA_ROWS.map((row) => row.instanceType))].sort((a, b) => a - b);
    assert.deepEqual(types, [0, 1, 2, 3, 4, 9, 10], '`instanceType` 取值集合（`0` 才是普通关）');
});

test('真表：`ad` 表 `type=11` 就是扫荡，`limit=5`；`monthCardActPlan` plan1 的真实金额是 ￥30', () => {
    const ad = readRefRows('ad');
    assert.equal(ad.length, 15);
    const sweep = ad.filter((row) => Number(row.type) === 11);
    assert.equal(sweep.length, 1, '`type=11` 只有一行');
    assert.equal(sweep[0]!.key, 'sweep', '`AdType.sweep` 与表里 key 对得上');
    assert.equal(sweep[0]!.limit, 5);

    const plans = readRefRows('monthCardActPlan');
    assert.equal(plans.length, 2);
    const welfare = plans.find((row) =>
        Array.isArray(row.privilege) && row.privilege.some((p) => Number((p as Record<string, unknown>).type) === 4),
    );
    assert.ok(welfare, 'plan1「福利月卡」的 `privilege` 里应有 `type: 4`（无限次快速扫荡）');
    assert.equal(welfare!.plan, 1);
    assert.equal(welfare!.desc, '福利月卡');
    assert.equal(welfare!.type, 1);
    // ⚠️ `monthCardActPlan.rmb` 是 `payChannel.id`，不是钱数
    assert.equal(welfare!.rmb, 9);
    const pay = readRefRows('payChannel').find((row) => Number(row.id) === 9);
    assert.ok(pay, 'payChannel id=9 应当存在');
    assert.equal(pay!.rmb, 30, '真实金额 —— 截图上的 ￥30');
    assert.equal(pay!.name, '福利月卡');
    // 反向：plan2「超值月卡」也有征收相关特权（type 8/9），但**老端征收界面不用它**
    const valuable = plans.find((row) => Number(row.plan) === 2)!;
    const types = (valuable.privilege as Array<Record<string, unknown>>).map((p) => Number(p.type));
    assert.deepEqual(types, [6, 5, 8, 9], 'plan2 的特权（8=征收收益+30% / 9=税收上限+50%）—— 老端 LayerHang 没读');
});

// ============================================================
// B. 资源口径（HangArt）
// ============================================================

const HJ_ART_DIR = 'assets/resources/image/hang';

/**
 * 读一张图的 **spriteFrame** subMeta（`uuid/width/height/border*`）。
 *
 * ⚠️ `dir` 是**相对工程根**的目录（`assets/resources/image/hang`），不是相对 `resources`。
 * ⚠️ 返回的 `uuid` 是 `subMetas.f9941.uuid`（**带 `@f9941`**），不是顶层 `meta.uuid` ——
 *    prefab 的 `cc.Sprite._spriteFrame.__uuid__` 存的也是带 `@f9941` 的那个（规则 64）。
 *    拿顶层 uuid 去比会「看起来差一点点」然后被当成抄错。
 */
function spriteMeta(dir: string, name: string): {
    uuid: string;
    width: number;
    height: number;
    border: number[];
    trimType: string;
} {
    const metaPath = `${dir}/${name}.png.meta`;
    assert.ok(existsSync(metaPath), `缺 .meta：${metaPath}`);
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as {
        uuid: string;
        subMetas: Record<string, {
            uuid: string;
            userData: {
                width: number;
                height: number;
                borderLeft: number;
                borderTop: number;
                borderRight: number;
                borderBottom: number;
                trimType: string;
            };
        }>;
    };
    const sub = meta.subMetas.f9941!;
    assert.equal(sub.uuid, `${meta.uuid}@f9941`, '`subMetas.f9941.uuid` 必须是顶层 uuid + `@f9941`');
    const userData = sub.userData;
    return {
        uuid: sub.uuid,
        width: userData.width,
        height: userData.height,
        border: [userData.borderLeft, userData.borderTop, userData.borderRight, userData.borderBottom],
        trimType: userData.trimType,
    };
}

test('`HJ_ART_NAMES` 13 张全部落盘（名字写错 = 静默留白）', () => {
    assert.equal(Object.keys(HJ_ART_NAMES).length, 13);
    assert.deepEqual(
        Object.keys(HJ_ART_NAMES).sort(),
        [
            'ad', 'barBg', 'barFill', 'entryBg', 'entryIcon', 'gearBg', 'gearIcon',
            'headBg', 'monthBg', 'monthBtn', 'monthDeco', 'rewardFrame', 'tagMax',
        ],
    );
    for (const name of Object.values(HJ_ART_NAMES)) {
        assert.ok(existsSync(`${HJ_ART_DIR}/${name}.png`), `缺图：${HJ_ART_DIR}/${name}.png`);
    }
    assert.equal(HJ_ART_ROOT, 'image/hang');
});

test('⚠️ 主界面入口那两张（第二轮补迁）：入口长在**主界面**，不是「挂机」包里的图', () => {
    // 第一轮只迁了弹窗自己的图，漏的就是这两张 —— 症状是「入口整块不存在」而不是留白。
    // 判据：① 都落盘；② 原始尺寸 == FGUI 原稿；③ `hj_entry_icon` 非九宫 / `hj_entry_bg` 是九宫。
    const icon = spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.entryIcon);
    assert.deepEqual([icon.width, icon.height], [113, 102], '`zjm_icon03_ZhengShou` 原始 113×102');
    assert.deepEqual(icon.border, [0, 0, 0, 0], '入口按钮脸**不是**九宫（别照抄信息底）');
    // ⚠️ `Btn` 的 100×90.27 就是这张按 `scaleFree`(contain) 缩出来的：100 / 113 × 102
    assert.equal(113, spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.entryIcon).width, '缩放基准');

    const bg = spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.entryBg);
    assert.deepEqual([bg.width, bg.height], [80, 30], '`战斗选关_九宫_信息底01` 原始 80×30');
    // FGUI `scale9grid="20,7,40,14"` ⇒ borderRight = 80−(20+40) = 20 / borderBottom = 30−(7+14) = 9
    assert.deepEqual(bg.border, [20, 7, 20, 9], '九宫换算：left=x / top=y / right=W−(x+w) / bottom=H−(y+h)');
});

test('⚠️ `trimType`：九宫四张 + 两张入口图必须 `none`，其余 `auto`', () => {
    // 为什么要 `none`：
    //   - 九宫四张：`auto` 会先把透明边裁掉 ⇒ 回解尺寸变小 ⇒ border 换算整体偏边
    //   - `hj_entry_icon` / `hj_entry_bg`：FGUI 是 `<loader fill="scaleFree">`，缩的是**整张原图**
    //     （含透明留白）⇒ 裁掉留白后 `Btn` 的 100×90.27 就再也量不出来（实测 `hj_entry_bg` 80→75）
    const mustNone: string[] = [
        HJ_ART_NAMES.barFill,
        HJ_ART_NAMES.barBg,
        HJ_ART_NAMES.rewardFrame,
        HJ_ART_NAMES.entryBg,
        HJ_ART_NAMES.entryIcon,
    ];
    for (const name of mustNone) {
        assert.equal(spriteMeta(HJ_ART_DIR, name).trimType, 'none', `${name} 必须 trimType:none`);
    }
    // 反向：其余保持 `auto`（一刀切全设 none 会白白浪费图集空间，也不是 FGUI 原稿口径）
    const others = Object.values(HJ_ART_NAMES).filter((name) => !mustNone.includes(name));
    assert.equal(others.length, 8, `受检图数变了：${others.join(', ')}`);
    for (const name of others) {
        assert.equal(spriteMeta(HJ_ART_DIR, name).trimType, 'auto', `${name} 应当是 trimType:auto`);
    }
});

test('⚠️ 九宫名单 `HJ_ART_SLICED` 与 `.meta` 的 `border*` **双向一致**（三张都不许漏）', () => {
    // 判据：四边任意一条 > 0 即九宫（`borderLeft=0/Right=0` 也是合法值）
    const onDiskSliced = Object.values(HJ_ART_NAMES).filter((name) => spriteMeta(HJ_ART_DIR, name).border.some((v) => v > 0));
    assert.deepEqual([...HJ_ART_SLICED].sort(), onDiskSliced.sort(), '`HJ_ART_SLICED` 必须严格等于「`.meta` border 非 0」的集合');

    // 逐张对 FGUI `scale9grid` 的换算：left=x / top=y / right=W-(x+w) / bottom=H-(y+h)
    assert.deepEqual(HJ_ART_SLICED.has(HJ_ART_NAMES.barFill), true);
    assert.deepEqual(spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.barFill).border, [4, 3, 6, 6], '`hj_bar_fill` 14×17 / FGUI `4,3,4,8`');
    assert.deepEqual(spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.barBg).border, [7, 5, 9, 8], '`hj_bar_bg` 30×23 / FGUI `7,5,14,10`');
    assert.deepEqual(spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.rewardFrame).border, [101, 25, 104, 28], '`hj_reward_frame` 407×103 / FGUI `101,25,202,50`');
    // ⚠️ 小图被拉成 290×20 ⇒ `trimType` 必须为 none，尺寸才回到原图（否则 border 整体偏边）
    assert.equal(spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.barFill).width, 14);
    assert.equal(spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.barBg).width, 30);
});

test('`hjSpriteType`：`HJ_ART_SLICED` 里的返回 1(SLICED)，其余 0(SIMPLE)', () => {
    assert.equal(HJ_SPRITE_SIMPLE, 0);
    assert.equal(HJ_SPRITE_SLICED, 1);
    for (const name of Object.values(HJ_ART_NAMES)) {
        assert.equal(hjSpriteType(name), HJ_ART_SLICED.has(name) ? 1 : 0, name);
    }
    assert.equal(hjSpriteType('不存在的图'), 0);
});

test('跨模块复用的 9 张全部落盘（不另存第二份，md5 同源）', () => {
    const shared: ReadonlyArray<readonly [{ root: string; name: string }, string]> = [
        [HJ_SHARED_PANEL_BG, '弹窗底板 626×903'],
        [HJ_SHARED_PANEL_TITLE, '弹窗标题底条 344×81'],
        [HJ_SHARED_BTN_SWEEP, '快速征收底图（**非**九宫）'],
        [HJ_SHARED_BTN_GOLD, '领取按钮底图（颜色=1 橙）'],
        [HJ_SHARED_BTN_DARK, '领取按钮底图（颜色=0 蓝，本轮备用）'],
        [HJ_SHARED_CLOSE, '弹窗关闭键 60×60'],
        [HJ_SHARED_RED_DOT, '普通红点'],
        [HJ_SHARED_RED_DOT_NUM, '数字红点'],
        [HJ_SHARED_RED_DOT_NEW, '「新」角标红点'],
    ];
    for (const [ref, why] of shared) {
        assert.ok(
            existsSync(`assets/resources/${ref.root}/${ref.name}.png`),
            `缺复用图：${ref.root}/${ref.name}（${why}）`,
        );
    }
    // ⚠️ `fd_tab_off`（TY_btn23）**不是**九宫 —— FGUI `package.xml` 里没有 `scale9grid`，
    //    按印象抄 TY_btn06 的 `14,11,4,12` 会让按钮文字被拉伸变形
    assert.deepEqual(spriteMeta('assets/resources/image/friend', 'fd_tab_off').border, [0, 0, 0, 0]);
    // 反向：`title_brown`（弹窗标题底条）**是**九宫（171,20,16,40）
    assert.deepEqual(spriteMeta('assets/resources/image/firstRecharge', 'title_brown').border, [171, 20, 16, 40]);
});

test('品质框：4 档，**必须与七日 / 礼包 / 活动 / 首充 / 战令同算法**（跨 5 个模块的约定）', () => {
    assert.equal(FRAME_ART_ROOT, 'image/frame');
    assert.deepEqual([...QUALITY_FRAME_NAMES], ['common_img_pzk_01', 'common_img_pzk_02', 'common_img_pzk_03', 'common_img_pzk_04']);
    for (const name of QUALITY_FRAME_NAMES) {
        // ⚠️ `FRAME_ART_ROOT` 是相对 `resources` 的（`image/frame`），落盘检查要补 `assets/resources/`
        assert.ok(existsSync(`assets/resources/${FRAME_ART_ROOT}/${name}.png`), `缺品质框：${name}`);
    }
    for (let quality = -1; quality <= 9; quality++) {
        assert.equal(qualityFrameLevel(quality), sevenDayQualityFrameLevel(quality), `quality=${quality} 与七日算法必须一致`);
    }
    assert.equal(qualityFrameLevel(1), 1);
    assert.equal(qualityFrameLevel(3), 2);
    assert.equal(qualityFrameLevel(4), 3);
    assert.equal(qualityFrameLevel(6), 4);
    assert.equal(qualityFrameName(3), 'common_img_pzk_02');
    // ⚠️ 征收的 5 条产出：前 4 条品质 3（档 2）、第 5 条品质 1（档 1）⇒ 设计图上「4 蓝 + 1 灰」
    assert.equal(qualityFrameLevel(3), 2);
    assert.equal(qualityFrameLevel(1), 1);
    assert.equal(qualityFramePath(1), 'image/frame/common_img_pzk_01/spriteFrame');
});

test('⚠️ 体力图标（`roleProperty.resId = 9` 的 `图标_体力`）必须落盘 —— 整条链上没有第二处守卫', () => {
    assert.equal(HJ_RESOURCE_ICON_ROOT, 'icons/resource');
    assert.equal(HJ_COST_ICON_NAME, '图标_体力');
    assert.equal(HJ_COST_ICON_PATH, 'icons/resource/图标_体力/spriteFrame');
    assert.ok(existsSync(`assets/resources/${HJ_RESOURCE_ICON_ROOT}/${HJ_COST_ICON_NAME}.png`), '漏了不报错、按钮上永远留一块白');
});

test('所有装配路径都必须带 `/spriteFrame`（漏了只是静默留白 + 一条 warn）', () => {
    for (const key of Object.keys(HJ_ART_NAMES) as Array<keyof typeof HJ_ART_NAMES>) {
        const path = hjArtPath(key);
        assert.ok(path.endsWith('/spriteFrame'), `${key} 的路径少了 /spriteFrame：${path}`);
        assert.ok(path.startsWith(`${HJ_ART_ROOT}/`));
        assert.deepEqual(hjArtRef(key), { root: HJ_ART_ROOT, name: HJ_ART_NAMES[key] });
    }
    for (const ref of [HJ_SHARED_PANEL_BG, HJ_SHARED_BTN_SWEEP, HJ_SHARED_CLOSE, HJ_SHARED_RED_DOT]) {
        assert.ok(hjSharedPath(ref).endsWith('/spriteFrame'));
        assert.equal(hjSharedPath(ref), spriteFramePath(ref.root, ref.name));
    }
});

// ============================================================
// C. prefab 结构 + 几何
// ============================================================

const PREFAB_PATH = 'assets/resources/ui/Hang/Hang.prefab';
const CANVAS_W = 720;
const CANVAS_H = 1280;

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

const PREFAB = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, unknown>>;
const PREFAB_NODES = PREFAB.filter((entry) => entry && entry.__type__ === 'cc.Node');

/** 脚本类名 → 源文件。 */
const SCRIPT_FILES: Readonly<Record<string, string>> = {
    HangPage: 'assets/script/app/hang/HangPage.ts',
    HangRewardSlot: 'assets/script/app/hang/HangRewardSlot.ts',
    HangGainItem: 'assets/script/app/hang/HangGainItem.ts',
    HangGearSwitch: 'assets/script/app/hang/HangGearSwitch.ts',
    HangSweepButton: 'assets/script/app/hang/HangSweepButton.ts',
};

/**
 * 节点路径 → 节点对象。
 *
 * ⚠️ 一律**按路径（= 节点名）**查，绝不写死 `__id__`：编辑器 `enter → save → exit`
 * 往返会把「节点连续、组件后置」的对象顺序**整体重排**（实测 365 个对象里 354 个下标变了），
 * 但节点名与字段值稳定。断言下标 = 下次在编辑器里存一次盘就全红。
 */
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

function compsOf(path: string): Array<Record<string, unknown>> {
    const target = node(path);
    return ((target._components as Array<{ __id__: number }>) ?? []).map((ref) => PREFAB[ref.__id__]!);
}

function compOfType<T extends string>(path: string, type: T): Record<string, unknown> {
    const hit = compsOf(path).find((comp) => comp && comp.__type__ === type);
    assert.ok(hit, `${path} 上没挂 ${type}`);
    return hit!;
}

function hasCompType(path: string, type: string): boolean {
    return compsOf(path).some((comp) => comp && comp.__type__ === type);
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
 * ⚠️ 三个易错点：
 *   ① `_lpos` 累加出来的是**锚点**位置，不是中心 —— 必须按 `anchor` 展开成矩形；
 *   ② 画布 y 向下、Cocos 局部 y 向上，所以 `top` 是减出来的；
 *   ③ **根节点的 `_lpos` 是相对画布中心的**，所以累加起点是 `(0,0)` 的根、公式里补 `±半个画布`。
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

test('prefab 存在，根节点是第一个 `cc.Node` 且 `cc.Prefab.data` 指向它（排错会让整棵子树消失）', () => {
    assert.ok(existsSync(PREFAB_PATH), `prefab 不存在：${PREFAB_PATH}`);
    const data = (PREFAB[0] as { data: { __id__: number } }).data;
    const firstNodeIndex = PREFAB.findIndex((entry) => entry && entry.__type__ === 'cc.Node');
    assert.equal(data.__id__, firstNodeIndex, '`cc.Prefab.data` 必须指向第一个 `cc.Node`');
    assert.equal(PREFAB_NODES[0]!._name, 'Hang');
    assert.equal(PREFAB_NODES[0]!._parent as unknown, null, '根节点没有父节点');
    assert.deepEqual(transformOf('Hang'), { w: 720, h: 1280, ax: 0.5, ay: 0.5 });
    // 58 = 弹窗壳 4 + 头部 1 + 进度条 3 + 收益 2×2 + 网格 6×2 + 按钮 2 + 倍率 4 + 月卡条 6 + 文字若干
    assert.equal(PREFAB_NODES.length, 58, '节点数变了先确认结构（编辑器往返不会改数量）');
});

test('⚠️ 所有节点的 `_layer` 都是 UI_2D（落在 DEFAULT 会让整棵子树不渲染）', () => {
    const layers = new Set(PREFAB_NODES.map((n) => n._layer));
    assert.deepEqual([...layers], [33554432], `出现非 UI_2D 的 layer：${[...layers].join(', ')}`);
});

test('⚠️ 每个脚本组件的 `__type__` 都能从对应 `.ts.meta` 的 uuid 反解出来（防 cid 抄错成 MissingScript）', () => {
    const expected = new Map<string, string>();
    for (const [className, file] of Object.entries(SCRIPT_FILES)) {
        const meta = JSON.parse(readFileSync(`${file}.meta`, 'utf8')) as { uuid: string };
        expected.set(compressUuid(meta.uuid), className);
    }
    const used = new Set(
        PREFAB
            .filter((entry) => entry && typeof entry.__type__ === 'string' && !entry.__type__.startsWith('cc.'))
            .map((entry) => entry.__type__ as string),
    );
    for (const cid of used) {
        assert.equal(cid.length, 23, `cid 长度必须是 23 位：${cid}`);
        assert.ok(expected.has(cid), `prefab 里的 cid ${cid} 反解不出任何脚本（抄错了？）`);
    }
    for (const [cid, className] of expected) {
        assert.ok(used.has(cid), `${className} 的组件没出现在 prefab 里`);
    }
    assert.equal(used.size, Object.keys(SCRIPT_FILES).length, '5 种脚本组件都该出现');
});

test('prefab 无空洞、无越界 `__id__`、`fileId` 长度统一 22', () => {
    const holes = PREFAB.map((entry, index) => (entry ? -1 : index)).filter((index) => index >= 0);
    assert.deepEqual(holes, [], `有空洞：${holes.join(', ')}`);

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
    assert.ok(refs > 400, `引用数太少（${refs}），说明没走全`);

    const infos = PREFAB.filter((e) => e && e.__type__ === 'cc.PrefabInfo');
    const fids = infos.map((e) => e.fileId);
    assert.equal(new Set(fids).size, fids.length, '`PrefabInfo.fileId` 有重复');
    assert.equal(fids.length, PREFAB_NODES.length, '每个节点一个 `cc.PrefabInfo`');
    // 规则 11：`cc.CompPrefabInfo.fileId` 必须 22 位（LCG 取低位会周期重复）
    for (const info of PREFAB.filter((e) => e && e.__type__ === 'cc.CompPrefabInfo')) {
        assert.equal(typeof info.fileId, 'string');
        assert.equal((info.fileId as string).length, 22, `CompPrefabInfo.fileId 长度异常：${String(info.fileId)}`);
    }
    // z 分量恒 0（生成器笔误会让节点飞出画布）
    for (const n of PREFAB_NODES) {
        const pos = n._lpos as { x: number; y: number; z: number };
        assert.equal(pos.z, 0, `${String(n._name)} 的 _lpos.z 不为 0`);
        assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), `${String(n._name)} 的 _lpos 不是有限数`);
    }
});

test('⚠️ 层序铁律：`PopBg` 必须排在第 0 位（弹窗底板），`MonthCardBar` 必须排在最后', () => {
    // 老端是 FGUI 里 `popBg` 在 displayList 最前、`n74`（月卡条）最后；移植成同一个 prefab 的子节点，
    // 靠的就是 `_children` 序 = 渲染序。
    const order = ((node('Hang')._children as Array<{ __id__: number }>) ?? []).map(
        (ref) => String(PREFAB[ref.__id__]!._name),
    );
    assert.deepEqual(order, [
        'PopBg',
        'HeadBg',
        'SweepBar',
        'MaxBadge',
        'BarLabel',
        'TimeText',
        'RewardFrame',
        'RewardTitle',
        'MaxTimeText',
        'RewardGrid',
        'Gain1',
        'Gain2',
        'SweepBtn',
        'ClaimBtn',
        'LevelHint',
        'AdCountText',
        'GearSwitch',
        'MonthCardBar',
    ]);
    assert.equal(order[0], 'PopBg', '弹窗底板必须最先画');
    assert.equal(order[order.length - 1], 'MonthCardBar', '月卡条必须最后画（压在最上层）');
    // ⚠️ `MAX` 角标要压在 `SweepBar` 上 ⇒ 排在它之后
    assert.ok(order.indexOf('MaxBadge') > order.indexOf('SweepBar'));
    // 弹窗壳内部：底板 → 标题底条 → 关闭键 → 标题
    const popOrder = ((node('Hang/PopBg')._children as Array<{ __id__: number }>) ?? []).map(
        (ref) => String(PREFAB[ref.__id__]!._name),
    );
    assert.deepEqual(popOrder, ['Bg', 'TitleBg', 'CloseBtn', 'Title']);
});

test('⚠️ 几何逐条对 FGUI XML 反解值（画布 720×1280，左上角原点、y 向下）', () => {
    // 左边是节点路径，右边是 FGUI 原稿的 `xy` + `size`（作者从 `组件_挂机_界面.xml` 等人工反解）
    const boxes: ReadonlyArray<readonly [string, number, number, number, number]> = [
        // —— 弹窗（`组件_公共弹窗_新` 实例 `xy=48,241 size=626,903`）——
        ['Hang/PopBg', 48, 241, 626, 903],
        ['Hang/PopBg/Bg', 48, 241, 626, 903],
        ['Hang/PopBg/TitleBg', 189, 213, 344, 81],
        ['Hang/PopBg/CloseBtn', 612, 221, 60, 60],
        ['Hang/PopBg/Title', 241, 230, 240, 42],
        // —— 头部 / 进度条 ——
        ['Hang/HeadBg', 88, 301, 550, 324],
        ['Hang/SweepBar', 224, 604, 290, 20],
        ['Hang/SweepBar/Bg', 224, 604, 290, 20],
        // ⚠️ `Fill` 是 `cc.ProgressBar` 的填充层：FGUI 原稿里它就是进度条自身的尺寸（`xy=224,604
        //    size=290,20`），但移植成节点后 anchor 必须变 (0,0.5) + `_lpos.x = −145`（见下一个用例）
        //    ⇒ 反解出来的矩形与 `Bg` 完全重合（左 224 / 上 604 / 290×20）。
        ['Hang/SweepBar/Fill', 224, 604, 290, 20],
        ['Hang/MaxBadge', 481, 594, 44, 21],
        ['Hang/BarLabel', 272, 599.5, 64, 29],
        ['Hang/TimeText', 344, 597, 98, 34],
        // —— 奖励区 ——
        ['Hang/RewardFrame', 105, 697, 532, 236],
        ['Hang/RewardTitle', 310, 658, 126, 42],
        ['Hang/MaxTimeText', 239.5, 933, 247, 34],
        ['Hang/RewardGrid', 117, 716, 492, 191],
        ['Hang/Gain1', 203, 628, 102, 44],
        ['Hang/Gain1/Icon', 206, 631, 38, 38],
        ['Hang/Gain1/Text', 249, 632, 55, 34],
        ['Hang/Gain2', 422, 628, 102, 44],
        ['Hang/Gain2/Icon', 425, 631, 38, 38],
        ['Hang/Gain2/Text', 468, 632, 55, 34],
        // —— 两个按钮 ——
        ['Hang/SweepBtn', 179, 983, 150, 68],
        ['Hang/SweepBtn/Title', 222, 1012.5, 84, 29],
        ['Hang/SweepBtn/RedDot', 310, 970, 30, 30],
        ['Hang/SweepBtn/RedDot/Dot', 310.5, 971, 29, 28],
        ['Hang/SweepBtn/AdIcon', 198, 1019, 39, 28],
        ['Hang/SweepBtn/CostIcon', 219, 990, 20, 20],
        ['Hang/SweepBtn/Cost', 239, 985, 35, 31],
        ['Hang/ClaimBtn', 395, 985, 150, 68],
        ['Hang/ClaimBtn/Title', 406, 984.5, 128, 69],
        // —— 底部 ——
        ['Hang/LevelHint', 227, 1083, 276, 25],
        ['Hang/AdCountText', 203, 1056, 110, 26],
        ['Hang/GearSwitch', 280, 962, 115, 62],
        ['Hang/GearSwitch/Bg', 280, 963, 115, 61],
        ['Hang/GearSwitch/TimesText', 335, 975, 35, 36],
        ['Hang/GearSwitch/Arrow', 301, 975, 34, 37],
        ['Hang/GearSwitch/Arrow/Icon', 301, 975, 34, 37],
        // —— 月卡条（FGUI 组 `n74` `xy=55,1154 size=603,141`）——
        ['Hang/MonthCardBar', 55, 1154, 603, 141],
        ['Hang/MonthCardBar/Bg', 55, 1154, 603, 141],
        ['Hang/MonthCardBar/Entry', 80, 1174, 100, 100],
        ['Hang/MonthCardBar/Deco', 204, 1175, 152, 38],
        ['Hang/MonthCardBar/Hint', 204, 1220, 220, 34],
        ['Hang/MonthCardBar/BuyBtn', 472, 1191, 147, 60],
        ['Hang/MonthCardBar/BuyBtn/Price', 511.5, 1200, 68, 42],
    ];
    for (const [path, left, top, w, h] of boxes) {
        assert.deepEqual(canvasBox(path), { left, top, w, h }, `${path} 的几何与 FGUI 对不上`);
    }
    // 反向：`NODE_BY_PATH` 里的每个节点都必须在几何对账里核过（不许有"没人管的节点"）
    // 奖励网格的 6 格 ×（格 + Icon）在下一个用例里单独核
    const gridPaths: string[] = [];
    for (let i = 1; i <= 6; i++) {
        gridPaths.push(`Hang/RewardGrid/Slot${i}`, `Hang/RewardGrid/Slot${i}/Icon`);
    }
    const checked = new Set<string>(['Hang', ...boxes.map(([p]) => p), ...gridPaths]);
    const unchecked = [...NODE_BY_PATH.keys()].filter((p) => !checked.has(p));
    assert.deepEqual(unchecked, [], `这些节点没进几何对账表：${unchecked.join(', ')}`);
    // 兜底：确认对账表没漏（58 个节点全部覆盖）
    assert.equal(checked.size, PREFAB_NODES.length, `对账表覆盖 ${checked.size} 个，实际 ${PREFAB_NODES.length} 个节点`);
});

test('★ 内容块竖直居中：静态声明盒中心 **−128**（老端 FGUI 组 AABB 高 1054），由 `_fitContentCenter` 运行时补掉', () => {
    // 老端 `挂机/组件/组件_挂机_界面.xml`：
    //   <group id="n78" xy="48,241" size="626,903" advanced layout="vt" lineGap="10" excludeInvisibles="true">
    //     <relation target="" sidePair="center-center,middle-middle"/>
    //   n78 的内容 = n47(626×903 @48,241) + 10 + n74(603×141 @55,1154)
    //     ⇒ AABB [241 .. 1295] 高 **1054**，`middle-middle` 把它**垂直居中**于组件。
    //   新端画布 720×1280、原点在中心 ⇒ PopBg 顶 = 640 − 241 = **399**、
    //   MonthCardBar 底 = 640 − (1154 + 141) = **−655** ⇒ 内容块 [−655 .. 399]，高 1054 ✓
    //   ⇒ 中心 **−128**，即**不补就是偏下 128**（这就是山猫说的「没有上下适配居中」）。
    const boxOf = (path: string) => {
        const n = node(path);
        const pos = n._lpos as { x: number; y: number };
        const comps = ((n._components as Array<{ __id__: number }>) ?? []).map((r) => PREFAB[r.__id__]!);
        const ui = comps.find((c) => c && c.__type__ === 'cc.UITransform')!;
        assert.ok(ui, `${path} 上没有 cc.UITransform`);
        const size = ui._contentSize as { width: number; height: number };
        const ap = ui._anchorPoint as { x: number; y: number };
        return {
            bottom: pos.y - size.height * ap.y,
            top: pos.y + size.height * (1 - ap.y),
            height: size.height,
            active: n._active !== false,
        };
    };

    const popBg = boxOf('Hang/PopBg');
    const bar = boxOf('Hang/MonthCardBar');
    assert.equal(bar.active, true, '月卡条静态必须可见（FGUI `n74` 的 gearDisplay pages=1 = 无月卡时显示）');

    // 一级子节点里只有这两个决定内容块上下边界（其余都嵌在它们之间）
    const root = node('Hang');
    const kids = ((root._children as Array<{ __id__: number }>) ?? []).map((r) => String(PREFAB[r.__id__]!._name));
    const boxes = kids.filter((k) => k !== 'MaxBadge').map((k) => boxOf(`Hang/${k}`));
    for (const b of boxes) {
        assert.ok(b.top <= popBg.top + 0.01, `有子节点顶（${b.top}）超出 PopBg 顶（${popBg.top}）`);
        assert.ok(b.bottom >= bar.bottom - 0.01, `有子节点底（${b.bottom}）低于月卡条底（${bar.bottom}）`);
    }

    assert.equal(popBg.top, 399, 'PopBg 顶（= 640 − FGUI 241）');
    assert.equal(bar.bottom, -655, '月卡条底（= 640 − FGUI 1295）');
    const height = popBg.top - bar.bottom;
    assert.equal(height, 1054, '内容块高 = 老端组 AABB 高（903 + 10 + 141）');
    const center = contentCenterOffsetY([{ bottom: bar.bottom, top: bar.top }, { bottom: popBg.bottom, top: popBg.top }]);
    assert.equal(center, -128, '内容块中心（局部）= −128 ⇒ 需上移 128');

    // 月卡条隐藏（已购月卡）⇒ 只剩底板 ⇒ 中心 −52.5（居中量随显隐变）
    assert.equal(contentCenterOffsetY([{ bottom: popBg.bottom, top: popBg.top }]), -52.5);
});

test('⚠️ 奖励网格：6 格 4 列（列距 130 / 行距 107），每格恰好一个 `Icon` 子节点', () => {
    const grid = canvasBox('Hang/RewardGrid');
    assert.deepEqual(grid, { left: 117, top: 716, w: 492, h: 191 });
    const frame = canvasBox('Hang/RewardFrame');
    assert.deepEqual(frame, { left: 105, top: 697, w: 532, h: 236 });
    // FGUI `list`：`layout="flow_hz"` `colGap=28` `lineGap=5` `lineItemCount=4`，格 102×102
    const slots = [1, 2, 3, 4, 5, 6].map((i) => canvasBox(`Hang/RewardGrid/Slot${i}`));
    for (const [index, box] of slots.entries()) {
        assert.deepEqual([box.w, box.h], [102, 102], `Slot${index + 1} 是 102×102`);
        assert.ok(box.left >= grid.left && box.left + box.w <= grid.left + grid.w, `Slot${index + 1} 横向溢出网格`);
        // ⚠️ 纵向**不能**拿 `grid` 当界限：FGUI 作者把 list 高度写成 191，而 2 行内容需要
        //    102 + 5 + 102 = **209** ⇒ 第 2 行本来就比 list 框矮出去 18px。
        //    照抄 FGUI 的排布（`GList.handleAlign` 只在 `contentHeight < viewHeight` 时才做
        //    Middle/Bottom 偏移，这里 209 > 191 ⇒ **不偏移**，第 2 行就在 `716 + 107 = 823`），
        //    真正的视觉界限是外层 `RewardFrame`（697..933）：6 格都落在它里面，不越框。
        assert.ok(box.top >= frame.top && box.top + box.h <= frame.top + frame.h, `Slot${index + 1} 溢出奖励框`);
        const kids = ((node(`Hang/RewardGrid/Slot${index + 1}`)._children as Array<{ __id__: number }>) ?? []).map(
            (ref) => String(PREFAB[ref.__id__]!._name),
        );
        assert.deepEqual(kids, ['Icon'], `Slot${index + 1} 只该有 Icon 一个子节点`);
    }
    // 4 列 × 2 行
    assert.deepEqual(slots.slice(0, 4).map((b) => b.left), [117, 247, 377, 507]);
    assert.deepEqual(slots.slice(0, 4).map((b) => b.top), [716, 716, 716, 716]);
    assert.deepEqual(slots.slice(4).map((b) => b.top), [823, 823]);
    assert.equal(slots[1]!.left - slots[0]!.left, 130, '列距 = 102 + colGap 28');
    assert.equal(slots[4]!.top - slots[0]!.top, 107, '行距 = 102 + lineGap 5');
    // 第 2 行底部（925）仍在奖励框底部（933）之内 —— 这是「list 框 191 < 内容 209」不算 bug 的理由
    assert.ok(slots[5]!.top + slots[5]!.h <= frame.top + frame.h, '第 2 行越出了奖励框');
    // ⚠️ 不补数量 Label —— 老端 `comGoods.GetBehavior().onNumberVisible(false)` 恒隐藏数字
    for (let i = 1; i <= 6; i++) {
        assert.equal(hasCompType(`Hang/RewardGrid/Slot${i}`, 'cc.Label'), false, `Slot${i} 不该有数字 Label`);
    }
});

test('⚠️ 进度条：`Fill` 必须 anchor (0,0.5) + `x = −总长/2`（`cc.ProgressBar` 的硬约束）', () => {
    // `Mode.HORIZONTAL` 下 `_updateBarStatus()` 会把 `_barSprite` 的锚点强制设成 (0,0.5)、
    // 宽度设成 `totalLength × progress` ⇒ 只有 `_lpos.x = −totalLength/2` 才自洽。
    const ut = compOfType('Hang/SweepBar/Fill', 'cc.UITransform');
    assert.deepEqual(ut._anchorPoint, { __type__: 'cc.Vec2', x: 0, y: 0.5 });
    assert.deepEqual(ut._contentSize, { __type__: 'cc.Size', width: 290, height: 20 });
    assert.equal((node('Hang/SweepBar/Fill')._lpos as { x: number }).x, -145, '−290/2');

    const bar = compOfType('Hang/SweepBar', 'cc.ProgressBar');
    assert.equal(bar._mode, 0, 'HORIZONTAL');
    assert.equal(bar._totalLength, 290);
    assert.equal(bar._progress, 0.5, 'FGUI 原稿 `value="50" max="100"`（运行时会被页面改写）');
    const fillIndex = (bar._barSprite as { __id__: number }).__id__;
    assert.equal((PREFAB[fillIndex] as Record<string, unknown>).__type__, 'cc.Sprite');
    assert.equal(String((PREFAB[fillIndex] as Record<string, unknown>)._name), '', 'Fill 只有一个 Sprite 组件');
    assert.equal(
        (PREFAB[fillIndex] as Record<string, unknown>).node && ((PREFAB[fillIndex] as Record<string, unknown>).node as { __id__: number }).__id__,
        PREFAB.indexOf(node('Hang/SweepBar/Fill')),
        '`_barSprite` 必须指向 `Fill` 节点上的那个 Sprite',
    );
});

test('⚠️ 九宫：`HJ_ART_SLICED` 的每张图在 prefab 里都必须 `_type = 1`；非九宫的必须 `_type = 0`', () => {
    // 漏写的症状是「图照样显示、只是整张被拉伸」，不报错
    const spriteUuidAt = (path: string): string => {
        const sprite = compOfType(path, 'cc.Sprite');
        const ref = sprite._spriteFrame as { __uuid__?: string } | null;
        assert.ok(ref && ref.__uuid__, `${path} 没有 spriteFrame`);
        return ref.__uuid__!;
    };
    const uuidOf = (dir: string, name: string): string => spriteMeta(dir, name).uuid;

    const sliced: ReadonlyArray<readonly [string, string, string]> = [
        ['Hang/SweepBar/Bg', `${HJ_ART_DIR}`, HJ_ART_NAMES.barBg],
        ['Hang/SweepBar/Fill', `${HJ_ART_DIR}`, HJ_ART_NAMES.barFill],
        ['Hang/RewardFrame', `${HJ_ART_DIR}`, HJ_ART_NAMES.rewardFrame],
        ['Hang/PopBg/Bg', 'assets/resources/image/friend', 'fd_panel_bg'],
        ['Hang/PopBg/TitleBg', 'assets/resources/image/firstRecharge', 'title_brown'],
        ['Hang/ClaimBtn', 'assets/resources/image/friend', 'fd_btn_gold'],
    ];
    for (const [path, dir, name] of sliced) {
        assert.equal(uuidOf(dir, name), spriteUuidAt(path), `${path} 应当用 ${dir}/${name}`);
    }
    // 全部 `_type = 1` 的节点恰好在上面这批里
    const slicedNodes = [...NODE_BY_PATH.keys()].filter((path) => {
        if (path === 'Hang') return false;
        return hasCompType(path, 'cc.Sprite') && compOfType(path, 'cc.Sprite')._type === 1;
    });
    assert.deepEqual(
        slicedNodes.sort(),
        sliced.map(([path]) => path).sort(),
        '九宫节点集合变了 —— 要么该补 `_type`，要么 `HJ_ART_SLICED` 漏了一张',
    );

    // 非九宫的四张（含「快速征收」底图 —— 它不是九宫，别照抄 TY_btn06）
    const plain: ReadonlyArray<readonly [string, string, string]> = [
        ['Hang/HeadBg', HJ_ART_DIR, HJ_ART_NAMES.headBg],
        ['Hang/MaxBadge', HJ_ART_DIR, HJ_ART_NAMES.tagMax],
        ['Hang/SweepBtn', 'assets/resources/image/friend', 'fd_tab_off'],
        ['Hang/PopBg/CloseBtn', 'assets/resources/image/activity', 'act_btn_close'],
        ['Hang/SweepBtn/AdIcon', HJ_ART_DIR, HJ_ART_NAMES.ad],
        ['Hang/GearSwitch/Bg', HJ_ART_DIR, HJ_ART_NAMES.gearBg],
        ['Hang/GearSwitch/Arrow/Icon', HJ_ART_DIR, HJ_ART_NAMES.gearIcon],
        ['Hang/MonthCardBar/Bg', HJ_ART_DIR, HJ_ART_NAMES.monthBg],
        ['Hang/MonthCardBar/Deco', HJ_ART_DIR, HJ_ART_NAMES.monthDeco],
        ['Hang/MonthCardBar/BuyBtn', HJ_ART_DIR, HJ_ART_NAMES.monthBtn],
        ['Hang/SweepBtn/RedDot/Dot', 'assets/resources/image/common', 'cm_red_dot'],
    ];
    for (const [path, dir, name] of plain) {
        assert.equal(uuidOf(dir, name), spriteUuidAt(path), `${path} 应当用 ${dir}/${name}`);
        assert.equal(compOfType(path, 'cc.Sprite')._type, 0, `${path} 不该是九宫`);
    }
});

test('⚠️ 奖励格烘焙的品质框：前 4 格 = 档 2（`common_img_pzk_02`）、第 5/6 格 = 档 1', () => {
    // ⚠️ **烘焙值只是「设计图口径」的占位**（设计稿只有 4 个格子 ⇒ 4 档 2 + 2 档 1），
    //    运行时 `HangRewardSlot.render()` 会**绝对赋值**覆盖它。所以它**不**等于 lv1 的真实帧序列
    //    （真实是 5 档 2 + 1 档 1，见下面那个用例）—— 别把这条当成「品质映射对不对」的判据。
    //    本条只守两件事：① 6 格都指向 `image/frame/` 里的合法品质框；② 两极（档 1 / 档 2）都在。
    // ⚠️ `FRAME_ART_ROOT` 是相对 `resources` 的 ⇒ 落盘/读 meta 都要补 `assets/resources/`
    const frameUuid = (name: string): string => spriteMeta(`assets/resources/${FRAME_ART_ROOT}`, name).uuid;
    for (const i of [1, 2, 3, 4]) {
        assert.equal(
            (compOfType(`Hang/RewardGrid/Slot${i}`, 'cc.Sprite')._spriteFrame as { __uuid__: string }).__uuid__,
            frameUuid('common_img_pzk_02'),
            `Slot${i} 应当是档 2 的框`,
        );
    }
    for (const i of [5, 6]) {
        assert.equal(
            (compOfType(`Hang/RewardGrid/Slot${i}`, 'cc.Sprite')._spriteFrame as { __uuid__: string }).__uuid__,
            frameUuid('common_img_pzk_01'),
            `Slot${i} 应当是档 1 的框`,
        );
    }
});

test('⚠️ 品质 → 框的**真实**映射：lv1 六条产出算出来是 `[2,2,2,2,2,1]`（第 6 条才降档）', () => {
    // 判据全部来自真表（`item` / `roleProperty` 两支分流 + `qualityFrameLevel`），不是烘焙值：
    //   resId 7    → roleProperty，quality 3 ⇒ 档 2
    //   resId 16014/10012/10011 → item，quality 3 ⇒ 档 2
    //   resId 10013 → item，quality **1** ⇒ 档 1
    const itemRows = readRefRows('item');
    const roleRows = readRefRows('roleProperty');
    const qualityOf = (resId: number): number => {
        const it = itemRows.find((r) => Number(r.resId) === resId);
        const rp = roleRows.find((r) => Number(r.resId) === resId);
        const hit = it ?? rp;
        assert.ok(hit, `resId ${resId} 在 item / roleProperty 里都查不到 —— 图标与品质框会静默留白`);
        return Number(hit!.quality) || 1;
    };
    const lv1 = GUANKA_ROWS.find((row) => row.level === 1)!;
    assert.deepEqual(
        lv1.idleRewards.map((r) => qualityOf(r.resId)),
        [3, 3, 3, 3, 3, 1],
        'lv1 六条产出的品质',
    );
    assert.deepEqual(
        lv1.idleRewards.map((r) => qualityFrameLevel(qualityOf(r.resId))),
        [2, 2, 2, 2, 2, 1],
        '真实帧序列 ≠ prefab 的烘焙占位（4 档 2 + 2 档 1）—— 运行时 `render()` 绝对覆盖，以本条为准',
    );
    // 两支分流都要有（全落 `item` 或全落 `roleProperty` 都说明分流写错了）
    assert.equal(itemRows.some((r) => Number(r.resId) === 7), false, '银币 7 只在 `roleProperty` 里');
    assert.equal(roleRows.some((r) => Number(r.resId) === 10012), false, '道具只在 `item` 里');
});

test('⚠️ 两处节点缩放必须落在节点上：`GearSwitch` 0.8、`AdIcon` 0.5', () => {
    assert.deepEqual(node('Hang/GearSwitch')._lscale, { __type__: 'cc.Vec3', x: 0.8, y: 0.8, z: 1 }, 'FGUI `scale="0.8,0.8"`');
    assert.deepEqual(node('Hang/SweepBtn/AdIcon')._lscale, { __type__: 'cc.Vec3', x: 0.5, y: 0.5, z: 1 }, 'FGUI `n6` 的 `scale="0.5,0.5"`');
    for (const path of ['Hang', 'Hang/PopBg', 'Hang/HeadBg', 'Hang/SweepBtn', 'Hang/ClaimBtn', 'Hang/MonthCardBar']) {
        assert.deepEqual(node(path)._lscale, { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 }, `${path} 不该有缩放`);
    }
    // ⚠️ 缩放节点**不能**带 `cc.Widget`（缩放 + 对齐会互相打架，且 `ProgressBar` 会回写尺寸）
    for (const path of [...NODE_BY_PATH.keys()]) {
        if (path === 'Hang') continue;
        const scale = (node(path)._lscale as { x: number }).x;
        if (scale !== 1) {
            assert.equal(hasCompType(path, 'cc.Widget'), false, `${path} 有缩放又挂了 cc.Widget`);
        }
    }
});

test('`_sizeMode` 恒为 CUSTOM(0)：`contentSize` 会被渲染组件回写，别让它自动量（规则 7）', () => {
    for (const path of NODE_BY_PATH.keys()) {
        if (!hasCompType(path, 'cc.Sprite')) continue;
        assert.equal(compOfType(path, 'cc.Sprite')._sizeMode, 0, `${path} 的 _sizeMode 不是 CUSTOM`);
    }
    // `_isTrimmedMode` 必须 false（近亲坑：trim 会改回解尺寸，让九宫 border 偏）
    for (const path of NODE_BY_PATH.keys()) {
        if (!hasCompType(path, 'cc.Sprite')) continue;
        assert.equal(compOfType(path, 'cc.Sprite')._isTrimmedMode, false, `${path} 开了 trim`);
    }
});

test('⚠️ 脚本属性接线：每个 `@property` 都指向正确的节点 / 组件（错位 = 静默不动）', () => {
    // ⚠️ `.meta` 是挂在 **`Xxx.ts`** 上的（`Xxx.ts.meta`），不是 `Xxx.meta`
    const cidOf = (file: string): string =>
        compressUuid(
            (JSON.parse(readFileSync(`assets/script/app/hang/${file}.ts.meta`, 'utf8')) as { uuid: string }).uuid,
        );

    const page = PREFAB.find((entry) => entry && entry.__type__ === cidOf('HangPage'));
    assert.ok(page, 'prefab 里没有 HangPage 组件');

    /** 引用 → 它所属节点的名字（组件引用要再往上一层找 `node`）。 */
    const nameOfRef = (value: unknown): string => {
        const id = (value as { __id__: number }).__id__;
        let cursor: Record<string, unknown> | undefined = PREFAB[id];
        if (cursor && cursor.__type__ !== 'cc.Node') cursor = PREFAB[(cursor.node as { __id__: number }).__id__];
        return String((cursor as Record<string, unknown>)._name);
    };

    assert.equal(nameOfRef(page!.closeButton), 'CloseBtn');
    assert.equal(nameOfRef(page!.claimButton), 'ClaimBtn');
    assert.equal(nameOfRef(page!.progressBar), 'SweepBar');
    assert.equal(nameOfRef(page!.timeLabel), 'TimeText');
    assert.equal(nameOfRef(page!.maxBadge), 'MaxBadge');
    assert.equal(nameOfRef(page!.gain1), 'Gain1');
    assert.equal(nameOfRef(page!.gain2), 'Gain2');
    assert.equal(nameOfRef(page!.sweepButton), 'SweepBtn');
    assert.equal(nameOfRef(page!.adCountLabel), 'AdCountText');
    assert.equal(nameOfRef(page!.gearSwitch), 'GearSwitch');
    assert.equal(nameOfRef(page!.monthCardBar), 'MonthCardBar');
    assert.equal(nameOfRef(page!.monthCardEntry), 'Entry');
    assert.equal(nameOfRef(page!.monthCardBuy), 'BuyBtn');
    assert.equal(nameOfRef(page!.monthCardPriceLabel), 'Price');
    // 组件引用要指向**组件**本身，不是节点（指向节点时 tsc 会红，但手改 JSON 就会静默失效）
    assert.equal((PREFAB[(page!.progressBar as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.ProgressBar');
    assert.equal((PREFAB[(page!.timeLabel as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Label');
    assert.equal((PREFAB[(page!.adCountLabel as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Label');
    assert.equal((PREFAB[(page!.monthCardPriceLabel as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Label');
    assert.equal((PREFAB[(page!.gain1 as { __id__: number }).__id__] as Record<string, unknown>).__type__, cidOf('HangGainItem'));
    assert.equal((PREFAB[(page!.sweepButton as { __id__: number }).__id__] as Record<string, unknown>).__type__, cidOf('HangSweepButton'));
    assert.equal((PREFAB[(page!.gearSwitch as { __id__: number }).__id__] as Record<string, unknown>).__type__, cidOf('HangGearSwitch'));

    const slots = (page!.rewardSlots as Array<{ __id__: number }>).map((ref) => {
        const comp = PREFAB[ref.__id__]!;
        assert.equal(comp.__type__, cidOf('HangRewardSlot'));
        return nameOfRef(comp.node);
    });
    assert.deepEqual(slots, ['Slot1', 'Slot2', 'Slot3', 'Slot4', 'Slot5', 'Slot6'], '6 个奖励格按网格顺序');

    // 子组件内部接线
    const firstOf = (file: string): Record<string, unknown> => {
        const hit = PREFAB.find((entry) => entry && entry.__type__ === cidOf(file));
        assert.ok(hit, `prefab 里没有 ${file} 组件`);
        return hit!;
    };

    const slotComp = firstOf('HangRewardSlot');
    assert.equal((PREFAB[(slotComp.frame as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Sprite');
    assert.equal((PREFAB[(slotComp.icon as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Sprite');
    assert.equal(nameOfRef(slotComp.node), 'Slot1', '`node` 由 cc 自动填，指回挂它的节点');

    const gainComp = firstOf('HangGainItem');
    assert.equal((PREFAB[(gainComp.icon as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Sprite');
    assert.equal((PREFAB[(gainComp.text as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Label');
    assert.equal(nameOfRef(gainComp.text), 'Text');

    const sweepComp = firstOf('HangSweepButton');
    assert.equal((PREFAB[(sweepComp.button as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Button');
    assert.equal(nameOfRef(sweepComp.title), 'Title');
    assert.equal(nameOfRef(sweepComp.adIcon), 'AdIcon');
    assert.equal(nameOfRef(sweepComp.costIcon), 'CostIcon');
    assert.equal(nameOfRef(sweepComp.cost), 'Cost');
    assert.equal(nameOfRef(sweepComp.redDot), 'RedDot');

    const gearComp = firstOf('HangGearSwitch');
    assert.equal((PREFAB[(gearComp.button as { __id__: number }).__id__] as Record<string, unknown>).__type__, 'cc.Button');
    assert.equal(nameOfRef(gearComp.timesText), 'TimesText');
    assert.equal(nameOfRef(gearComp.arrow), 'Arrow');
});

test('⚠️ 三个按钮的文案都落在**子 Label** 上（FGUI 的 `icon` 与 `title` 是两回事）', () => {
    // 从 FairyGUI 搬按钮：底图是纯色块时忘了补 Label 子节点 ⇒ **不报任何错**，界面上是空按钮
    const needsLabel: ReadonlyArray<readonly [string, string]> = [
        ['Hang/SweepBtn', '快速征收'],
        ['Hang/ClaimBtn', '领取'],
    ];
    for (const [path, text] of needsLabel) {
        const label = compOfType(`${path}/Title`, 'cc.Label');
        assert.equal(label._string, text, `${path} 的文案应当落在子节点 Title 上`);
    }
    // 弹窗标题 / 月卡价格 / 底部小字也要有字
    assert.equal(compOfType('Hang/PopBg/Title', 'cc.Label')._string, '税收');
    assert.equal(compOfType('Hang/MonthCardBar/BuyBtn/Price', 'cc.Label')._string, '￥30');
    assert.equal(compOfType('Hang/LevelHint', 'cc.Label')._string, '征收最新2星及以上通关的关卡奖励');
    assert.equal(compOfType('Hang/MonthCardBar/Hint', 'cc.Label')._string, '购买后税收不限次数');
    assert.equal(compOfType('Hang/MaxTimeText', 'cc.Label')._string, '当天最长征收时间：8h');
    assert.equal(compOfType('Hang/RewardTitle', 'cc.Label')._string, '产出奖励');
    assert.equal(compOfType('Hang/BarLabel', 'cc.Label')._string, '已征收');
    // ⚠️ `GearSwitch/TimesText` 的初值是 FGUI 原稿的 `X5`（大写）；运行时 `gearLabel()` 写小写 `x5`
    assert.equal(compOfType('Hang/GearSwitch/TimesText', 'cc.Label')._string, 'X5');
    assert.equal(gearLabel(5), 'x5');
});

test('⚠️ 按钮的缩放反馈：`cc.Button._transition = 3(SCALE)` + `_zoomScale`（照抄 FGUI 的 `downEffect`）', () => {
    // FGUI `按钮_公用_9Gone` / `按钮_快速征收` / `按钮_切换` 都是 `downEffect="scale" downEffectValue="0.8"`
    for (const path of ['Hang/PopBg/CloseBtn', 'Hang/SweepBtn', 'Hang/ClaimBtn', 'Hang/GearSwitch']) {
        const btn = compOfType(path, 'cc.Button');
        assert.equal(btn._transition, 3, `${path} 应当是 SCALE 过渡`);
        assert.equal(btn._zoomScale, 0.8, `${path} 的缩放 0.8`);
    }
    // ⚠️ 例外：`按钮_公共_通用` 的 `downEffectValue="0.9"`（小箭头）
    assert.equal(compOfType('Hang/GearSwitch/Arrow', 'cc.Button')._zoomScale, 0.9);
    // ⚠️ 再一个例外：`按钮_月卡` 组件**没有** `downEffect` ⇒ 走 `buttonPayload` 的默认 0.94
    assert.equal(compOfType('Hang/MonthCardBar/BuyBtn', 'cc.Button')._zoomScale, 0.94);
});

test('⚠️ 动态图必须在 prefab 里留空（`null` 是「运行时填」的标记，不是漏图）', () => {
    // 这四处都是运行时 `resources.load` 装的：体力图标、两个收益条图标、月卡入口图标
    for (const path of [
        'Hang/SweepBtn/CostIcon',
        'Hang/Gain1/Icon',
        'Hang/Gain2/Icon',
        'Hang/MonthCardBar/Entry',
    ]) {
        const sprite = compOfType(path, 'cc.Sprite');
        assert.equal(sprite._spriteFrame, null, `${path} 的 _spriteFrame 应当留空`);
    }
    for (let i = 1; i <= 6; i++) {
        assert.equal(compOfType(`Hang/RewardGrid/Slot${i}/Icon`, 'cc.Sprite')._spriteFrame, null, `Slot${i}/Icon`);
    }
});

test('`cc.PrefabInfo.asset` 恒指向 `obj[0]`（写别的值会让层级管理器里除根节点外全变红）', () => {
    for (const info of PREFAB.filter((e) => e && e.__type__ === 'cc.PrefabInfo')) {
        assert.deepEqual(info.asset, { __id__: 0 }, '`PrefabInfo.asset` 必须是 `{__id__: 0}`（= `cc.Prefab` 自己）');
        assert.equal(info.instance, null);
        assert.equal(info.targetOverrides, null);
    }
});

// ============================================================
// D. 数据管道接线（源码文本）
// ============================================================

test('四条请求的 proto 名与 `MessageId` 登记一致（写错 = 请求发不出去）', () => {
    const request = src('RequestHangMsg.ts');
    assert.match(request, /return 'CmdHangGetRewardReqMsg';/);
    assert.match(request, /return 'CmdHangQuickReqMsg';/);
    assert.match(request, /return 'CmdHangTimeReqMsg';/);
    assert.match(request, /return 'CmdBattleSweepReqMsg';/);
    // 成对声明 Req/Rsp 泛型
    assert.match(request, /class RequestHangGetReward extends RequestMsg<\s*CmdHangGetRewardReqMsg,\s*CmdHangGetRewardRspMsg\s*>/);
    assert.match(request, /class RequestHangQuick extends RequestMsg<CmdHangQuickReqMsg, CmdHangQuickRspMsg>/);
    assert.match(request, /class RequestHangTime extends RequestMsg<CmdHangTimeReqMsg, CmdHangTimeRspMsg>/);
    assert.match(request, /class RequestBattleSweep extends RequestMsg<CmdBattleSweepReqMsg, CmdBattleSweepRspMsg>/);
    assert.match(request, /倍率只作用于\*\*客户端\*\*的体力校验与花费文案/);
    // ⚠️ 没有「拉取挂机数据」的请求 —— 别造一个假的（这条注在 Repository 侧）
    assert.match(src('HangRepository.ts'), /没有「拉取挂机数据」的请求/);

    const cmd = readFileSync('assets/script/app/generated/netProto/Cmd.d.ts', 'utf8');
    for (const name of ['CmdHangGetRewardReqMsg', 'CmdHangQuickReqMsg', 'CmdHangTimeReqMsg', 'CmdBattleSweepReqMsg', 'CmdRoleWatchAdvertReqMsg']) {
        assert.ok(cmd.includes(name), `Cmd.d.ts 里没有 ${name}`);
    }
    // `MessageId` 登记（规则 20：只看 Rsp 有没有登记，没登记就发不出去）
    for (const [name, id] of [
        ['CmdHangGetRewardRspMsg', 1443586620],
        ['CmdHangQuickRspMsg', 1023337980],
        ['CmdHangTimeRspMsg', 20353276],
        ['CmdBattleSweepRspMsg', 70842819],
    ] as const) {
        assert.ok(cmd.includes(`${name} = ${id},`), `MessageId 登记变了：${name} 应为 ${id}`);
    }
});

test('⚠️ `CmdBattleSweepReqMsg` 在 proto 源里**没有 `times`** ⇒ 请求体只写 `{ level, type }`', () => {
    // 老端 `.d.ts` 里的 `times?` 是过期产物；写出 `{ level, type, times }` 反而会 `TS2353`
    const proto = readFileSync('client_proto/protoCompiled.proto', 'utf8');
    const block = /message CmdBattleSweepReqMsg \{([\s\S]*?)\}/.exec(proto);
    assert.ok(block, 'proto 源里找不到 `CmdBattleSweepReqMsg`');
    assert.match(block![1]!, /required sint32 level = 2;/);
    assert.match(block![1]!, /required sint32 type = 1;/);
    assert.equal(/times/.test(block![1]!), false, 'proto 里出现了 `times` —— 处置口径要重核');

    const repository = src('HangRepository.ts');
    assert.match(repository, /new RequestBattleSweep\(\{ level, type \}, caller as any, callback\)/);
    // ⚠️ 「倍率只作用于客户端…」这段口径写在 **RequestHangMsg.ts** 的文件头（请求体定义那儿），
    //    不是 Repository —— 别在 Repository 里找
    assert.match(src('RequestHangMsg.ts'), /倍率只作用于\*\*客户端\*\*的体力校验与花费文案/);
});

test('Repository：8 张表一次读完，状态读 `CacheMgr`（**不自存快照**）', () => {
    const repository = src('HangRepository.ts');
    for (const table of [
        'guankaReward',
        'interactReward',
        'gameConfig',
        'item',
        'roleProperty',
        'monthCardActPlan',
        'payChannel',
        'ad',
    ]) {
        assert.match(repository, new RegExp(`readRows\\('${table}'\\)`), `没读 ${table} 表`);
    }
    assert.match(repository, /CacheMgr\.instance\?\.getTlCmdRole\(\)/);
    assert.match(repository, /CacheMgr\.instance\?\.getTlCmdRoleInteractInfo\(\)/);
    assert.match(repository, /getCmdBattleLevel\(level\)/);
    assert.match(repository, /getCmdBattleChapter\(chapter\)/);
    // 缓存读法必须走生成的 `getTl*`（方法名写错 = 编译不过，但改成手写字典就是另一回事了）
    const gen = readFileSync('assets/script/app/generated/netProto/CacheMgrGen.ts', 'utf8');
    for (const method of ['getTlCmdRole()', 'getTlCmdRoleInteractInfo()', 'getCmdBattleLevel(level: number)', 'getCmdBattleChapter(chapterId: number)']) {
        assert.ok(gen.includes(method), `CacheMgrGen 里没有 ${method}`);
    }
    // ⚠️ `CmdAdvert` **不是**独立的缓存表（protoCache.json 里没有）—— 它是 `CmdRole.tlCmdAdvert`
    assert.equal(gen.includes('getTlCmdAdvert'), false, '`CmdAdvert` 不该有独立缓存入口');
    const protoCache = JSON.parse(readFileSync('assets/resources/config/protoCache.json', 'utf8')) as Record<string, unknown>;
    assert.ok(protoCache.CmdRole, 'protoCache 应有 CmdRole');
    assert.equal(protoCache.CmdAdvert, undefined, 'protoCache 里没有 CmdAdvert（只能从 CmdRole.tlCmdAdvert 读）');
    assert.match(repository, /tlCmdAdvert/);
});

test('⚠️ 三条请求都必须 `withTimeout` + 离线早退 + `catch` 返结果（否则永悬）', () => {
    const repository = src('HangRepository.ts');
    // 三条：claimReward / sweep / watchAd
    const earlyReturns = repository.match(/if \(!net\.isConnected\) return 'offline';/g) ?? [];
    assert.equal(earlyReturns.length, 3, '三条请求都要离线早退');
    const timeouts = repository.match(/withTimeout\(/g) ?? [];
    assert.equal(timeouts.length, 3, '三条请求都要 withTimeout');
    const catches = repository.match(/catch \(error\)/g) ?? [];
    assert.ok(catches.length >= 3, '三条请求都要 catch');
    assert.match(repository, /HJ_READ_TIMEOUT_MS = READ_TIMEOUT_MS/);
    assert.match(repository, /const READ_TIMEOUT_MS = 800;/);
    assert.match(repository, /const WRITE_TIMEOUT_MS = 5000;/);
    // watchAd 走 `RequestRoleWatchAdvert`（不是本模块的 RequestHangMsg）
    assert.match(repository, /new RequestRoleWatchAdvert\(\{ type \}, caller as any, callback\)/);
    assert.match(repository, /import \{ RequestRoleWatchAdvert \} from '\.\.\/generated\/requestMsg\/RequestRoleMsg';/);
});

test('⚠️ 领取成功要 `FW.ShowReward(rsp.tlCmdGoods)`（对齐老端 `ModelHang` + Celebration 口径）', () => {
    const repository = src('HangRepository.ts');
    // 老端 `ModelHang.requestHangGetReward` 在响应里 `FW.ShowReward(rsp.tlCmdGoods)` + `FW.showTip(ModelWorkShop_1)`；
    // 这里与 `CelebrationRepository.claimTargetReward` 同一条路：FW.ShowReward 是可注入的全局出口
    // （Repository 不 import 视图类、不 import cc），空数组时 ShowRewardPage 自己 close()。
    assert.match(repository, /FW\.ShowReward\(rsp\?\.tlCmdGoods \?\? \[\]\);/);
    assert.match(repository, /import \{ FW \} from '\.\.\/\.\.\/framework\/FW';/);
});

test('⚠️ 广告位类型 `HJ_AD_TYPE_SWEEP = 11` 有表口径兜住（不 import `RefEnum` 是为了纯 Node 单测）', () => {
    const repository = src('HangRepository.ts');
    assert.match(repository, /export const HJ_AD_TYPE_SWEEP = 11;/);
    assert.equal(/import .*RefEnum/.test(repository), false, '别 import RefEnum（会拖进生成目录）');
    const ad = readRefRows('ad');
    assert.equal(ad.find((row) => Number(row.type) === 11)!.key, 'sweep', '表口径：type=11 的 key 就是 sweep');
});

test('⚠️ `readAdLimit` / `readAdUsed` 的方向：`num` 是**已用**次数，`adRest = limit − num`', () => {
    const repository = src('HangRepository.ts');
    assert.match(repository, /const adRest = Math\.max\(0, adLimit - readAdUsed\(\)\);/);
    assert.match(repository, /是「已用次数」不是「剩余次数」/);
    // 表缺失时的兜底是 **1**（老端 `|| 1`），不是 0 —— 0 会让文案变成 1/0
    assert.match(repository, /return Number\.isFinite\(limit\) && limit > 0 \? limit : 1;/);
    assert.match(repository, /^    return 1;$/m);
});

test('页面：`static prefabPath` 指向新 prefab，且路径真的存在（大小写也必须一致）', () => {
    const page = src('HangPage.ts');
    assert.match(page, /static prefabPath = 'ui\/Hang\/Hang';/);
    assert.ok(existsSync('assets/resources/ui/Hang/Hang.prefab'), '`ui/Hang/Hang` 对应的 prefab 不存在');
    // Android / iOS 热更新 zip 内路径大小写敏感 ⇒ 别写成 ui/hang。
    // ⚠️ **不能**用 `existsSync('assets/resources/ui/hang/…') === false` 来守：Windows 文件系统
    //    大小写不敏感，那个断言在开发机上永远失败（而在 Linux 构建机上才有效）。
    //    改守「目录列举里必须是 `Hang`、且没有第二个 `hang`」—— 这才是真判据。
    const uiDirs = readdirSync('assets/resources/ui');
    assert.ok(uiDirs.includes('Hang'), '`assets/resources/ui/` 下应有 `Hang` 目录');
    assert.equal(uiDirs.includes('hang'), false, 'ui/ 下不要另建一个 `hang`（大小写不一致 = 热更新包里找不到）');
    assert.equal(readdirSync('assets/resources/ui/Hang').includes('Hang.prefab'), true);
});

test('页面继承 `PopupBase`（入口要按弹窗打开它，不是自己 instantiate）', () => {
    const page = src('HangPage.ts');
    assert.match(page, /export class HangPage extends PopupBase/);
    assert.match(page, /import \{ POPUP_BLANK_CATCHER, PopupBase \} from '\.\.\/\.\.\/framework\/ui\/PopupBase';/);
    assert.match(page, /import \{ MonthCardGiftPage \} from '\.\.\/monthcard\/MonthCardGiftPage';/);
    assert.match(page, /void MonthCardGiftPage\.open\(\{\}\);/);
});

test('⚠️ 空白关闭口径：**不覆写** `canCloseOnBlank()`（老端 `init` 里 `this.enableBlackClick()`）', () => {
    const page = src('HangPage.ts');
    assert.equal(
        /canCloseOnBlank\s*\(/.test(page.replace(/\/\/[^\n]*/g, '')),
        false,
        '覆写 `canCloseOnBlank()` 会与 prefab 的 `closeOnBlank: true` 打架',
    );
    assert.match(page, /enableBlackClick/);
    // prefab 侧也必须是 true（与礼包 / 邮件 / 活动 / 七日 同一个口径）
    const pageComp = PREFAB.find((entry) => entry && typeof entry.closeOnBlank === 'boolean');
    assert.ok(pageComp, 'prefab 的 HangPage 组件应当序列化 `closeOnBlank`');
    assert.equal(pageComp!.closeOnBlank, true);
});

test('★ 居中接线：`_fitContentCenter` 必须在 `_renderMonthCard` 之后调用，且三处口径不能改', () => {
    const raw = src('HangPage.ts');
    const page = raw.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    // ① 顺序：月卡条显隐（`_renderMonthCard`）先确定，居中量再算
    assert.match(
        page,
        /this\._renderMonthCard\(snapshot\);[\s\S]{0,400}?this\._fitContentCenter\(\);[\s\S]{0,120}?this\._restartTimer\(\);/,
        '`_fitContentCenter()` 必须排在 `_renderMonthCard()` 之后、`_restartTimer()` 之前',
    );

    // ② 排除运行时补的全屏空白层 —— 不排 ⇒ 包围盒恒等于屏幕 ⇒ 偏移恒 0（看起来没问题，实际没生效）
    assert.match(page, /if \(child\.name === POPUP_BLANK_CATCHER\) continue;/);
    assert.match(page, /import \{ POPUP_BLANK_CATCHER, PopupBase \} from/, '常量必须从 PopupBase 引，别自己写字符串');

    // ③ 只统计可见节点（月卡条隐藏时内容块 1054 → 903）
    assert.match(page, /if \(!child\.activeInHierarchy\) continue;/);

    // ④ 用**声明矩形**（position + contentSize + anchorPoint），与老端 FGUI 组 AABB 同口径；
    //    `getBoundingBoxToWorld()` 会把标题横幅骑出底板的 28px 算进来 ⇒ 与老端差 14px
    assert.equal(/getBoundingBoxToWorld/.test(page), false, '别用渲染包围盒算内容块（口径与老端不一致）');
    assert.match(page, /bottom: pos\.y - h \* ui\.anchorPoint\.y,/);
    assert.match(page, /top: pos\.y \+ h \* \(1 - ui\.anchorPoint\.y\),/);

    // ⑤ 补偿取负 = 把整块**上移**（内容块中心 −128 ⇒ 根节点 +128）
    assert.match(page, /this\.node\.setPosition\(0, -contentCenterOffsetY\(boxes\), 0\);/);

    // ⑥ 老端口径的出处要在注释里留痕（`toFullCenterParent` 是这次对齐的依据）
    assert.match(raw, /toFullCenterParent/, '注释里要写清「为什么该居中」的来源，别让下一个人再猜一遍');
});

test('⚠️ 预加载集合 = 「界面会 `_setFrame()` 的每一处」（漏了不报错，只是那一格永远留白）', () => {
    const page = src('HangPage.ts');
    // 体力图标恒在集合里
    assert.match(page, /new Set<string>\(\[HJ_COST_ICON_PATH\]\)/);
    // 每个奖励：图标路径 + 品质框路径
    assert.match(page, /const ref = rewardIconRefOf\(snapshot, reward\.resId\);/);
    assert.match(page, /if \(ref\) paths\.add\(hjSharedPath\(ref\)\);/);
    assert.match(page, /paths\.add\(qualityFramePath\(rewardQualityOf\(snapshot, reward\.resId\)\)\);/);
    // 预加载的每一处都能在 `_setFrame` 侧找到消费者
    assert.match(page, /this\.sweepButton\?\.renderCostIcon\(this\._frameOf\(HJ_COST_ICON_PATH\)\);/);
    assert.match(page, /this\.gain1\?\.render\(this\._iconFrameOf\(snapshot, first \? first\.resId : 0\), perHourText\(first\)\);/);
    assert.match(page, /slot\.render\(\s*this\._frameOf\(qualityFramePath\(rewardQualityOf\(snapshot, reward\.resId\)\)\)/);
});

test('⚠️ 奖励图标两支分流必须转发 `resolveRewardIconRef`，**不许自己判** `item` / `roleProperty`', () => {
    const art = src('HangArt.ts');
    assert.match(art, /export \{ resolveRewardIconRef as hjResolveRewardIconRef \} from '\.\.\/activity\/LayerActivityArt';/);
    const repository = src('HangRepository.ts');
    assert.match(repository, /import \{ resolveRewardIconRef \} from '\.\.\/activity\/LayerActivityArt';/);
    assert.match(repository, /return resolveRewardIconRef\(goodsOf\(snapshot, resId\)\);/);
    // 唯一入口在 `LayerActivityArt.ts`（曾经在 `LayerActivityTable.ts` 里找错过）
    const layerArt = readFileSync('assets/script/app/activity/LayerActivityArt.ts', 'utf8');
    assert.match(layerArt, /export function resolveRewardIconRef/);
});

test('页面：切页只换图 / 换数据，**不重建节点**；到 MAX 就停表', () => {
    const page = src('HangPage.ts');
    // 1s 心跳只刷进度条 + 时间
    assert.match(page, /private _tick\(\): void \{\s*this\._refreshTime\(\);\s*if \(this\._atMax\) this\.unschedule\(this\._tick\);/);
    assert.match(page, /if \(!this\._atMax\) this\.schedule\(this\._tick, TICK_SECONDS\);/);
    assert.match(page, /const TICK_SECONDS = 1;/);
    // 🔴 `MAX` 角标必须**无条件写**，不许写成「只在翻转时写 `active`」：
    //    prefab 里 `MaxBadge._active` 烘的是 `true`（FGUI 原稿没写 `visible="false"`），
    //    首次 `_refreshTime()` 时 `atMax === _atMax === false` ⇒ 「只在翻转时写」会短路不写，
    //    于是**面板刚打开 MAX 就一直亮**（探针实测逮到，`maxBadgeActive === true` / `00:00:02`）。
    //    老端 `LayerHang.refreshTime()` 是每秒无条件 `tm("maxImg").visible = …`。
    assert.match(page, /this\._atMax = atMax;\s*if \(this\.maxBadge\) this\.maxBadge\.active = atMax;/);
    assert.equal(/if \(atMax !== this\._atMax\)/.test(page), false,
        '`maxBadge.active` 不许写成「只在翻转时写」—— prefab 默认 `_active = true`，会短路成常亮');
    // 页面里不许 `instantiate`（节点全是 prefab 烘死的）
    assert.equal(/instantiate\(/.test(page), false, '页面不该自己造节点');
    // 关面板要停表
    assert.match(page, /protected onClose\(\): void \{\s*this\.unscheduleAllCallbacks\(\);/);
});

test('🔴 `MAX` 角标：prefab 默认**可见**（FGUI 原稿没写 `visible="false"`）⇒ 只靠「翻转时写」会常亮', () => {
    // FGUI `挂机/组件/组件_挂机_界面.xml` 里：`<image name="maxImg" …/>` **没有** `visible="false"`
    // ⇒ 默认可见，迁到 prefab 就是 `_active: true`。这条是下面那个断言的前提，别当废话删掉。
    assert.equal(node('Hang/MaxBadge')._active, true,
        '`MaxBadge` 应当照 FGUI 原稿烘成默认可见（改这一条会让「常亮」这个 bug 变得不可复现）');
    const page = src('HangPage.ts');
    // `reload()` 里**不许**预置 `_atMax = false` 来掩盖：那样只是恰好把首次写变成「不写」，
    // 真正的修法是让 `_refreshTime()` 自己无条件写 `maxBadge.active`
    assert.equal(/this\._atMax = false;\s*this\._refreshTime\(\);/.test(page), false,
        '`reload()` 里不许靠预置 `_atMax = false` 掩盖 —— `_refreshTime()` 必须自己无条件写节点');
});

test('🔴 click 监听必须挂在**真挂了 `cc.Button` 的节点**上（挂错 = 死按钮，且一条错都不报）', () => {
    const page = src('HangPage.ts');
    const CLICK_BOUND: Readonly<Record<string, string>> = {
        closeButton: 'Hang/PopBg/CloseBtn',
        claimButton: 'Hang/ClaimBtn',
        monthCardBuy: 'Hang/MonthCardBar/BuyBtn',
    };
    for (const [prop, path] of Object.entries(CLICK_BOUND)) {
        assert.match(page, new RegExp(`this\\.${prop}\\?\\.on\\(Button\\.EventType\\.CLICK, this\\._onTap`),
            `${prop} 应当走 Button CLICK`);
        assert.equal(hasCompType(path, 'cc.Button'), true,
            `${path} 上必须有 cc.Button，否则 CLICK 永远不触发（静默死按钮）`);
    }
    // 两个子件也走 `Button.EventType.CLICK`，同样要有 Button
    for (const path of ['Hang/SweepBtn', 'Hang/GearSwitch']) {
        assert.equal(hasCompType(path, 'cc.Button'), true, `${path} 上必须有 cc.Button`);
    }
    // ⚠️ 例外（踩过）：月卡入口在 FGUI 原稿里是 `<loader id="n77_" name="taskBtn" …>` ——
    //    **不是按钮**，迁过来只有 `cc.Sprite`。老端也是手动开的触摸
    //    （`taskBtn.touchable = true; taskBtn.setClick(this.onClickMonthCard, this);`）
    //    ⇒ 必须走节点级 `Node.EventType.TOUCH_END`。写成 `Button.EventType.CLICK` 就是个死按钮：
    //    不报错、不弹窗、探针里表现为 `mcFound:false`。
    assert.equal(hasCompType('Hang/MonthCardBar/Entry', 'cc.Button'), false,
        '`Entry` 在 FGUI 里是 loader，prefab 里不该有 cc.Button（有了说明有人绕过生成器手改过）');
    assert.match(page, /this\.monthCardEntry\?\.on\(Node\.EventType\.TOUCH_END, this\._onTapMonthCard, this\);/);
    assert.equal(/this\.monthCardEntry\?\.on\(Button\.EventType\.CLICK/.test(page), false,
        '`Entry` 上没有 cc.Button，写成 Button CLICK 会静默失效');
});

test('⚠️ 广告**播放**能力没迁 ⇒ `HJ_AD_PLAYBACK_AVAILABLE = false`，只提示不发请求', () => {
    const page = src('HangPage.ts');
    assert.match(page, /export const HJ_AD_PLAYBACK_AVAILABLE = false;/);
    assert.match(page, /if \(!HJ_AD_PLAYBACK_AVAILABLE\) \{\s*FW\.showTip\(HJ_TEXTS\.adUnavailable\);\s*return;/);
    // 二次确认弹窗走 `CommonTips`（老端 `GObjChapterSelect_1`），`onSure` 才去看广告
    assert.match(page, /await CommonTips\.open\(\{/);
    assert.match(page, /sureText: HJ_TEXTS\.adConfirmWatch,/);
    assert.match(page, /onSure: \(\) => \{ void this\._watchAdThenSweep\(\); \},/);
    // 免费次数用完且还有广告次数才弹（老端 `refreshBtn` 的分支）
    assert.match(page, /if \(!snapshot\.hasUnlimited && used >= snapshot\.sweepFreeTimes && snapshot\.adRest > 0\) \{/);
});

test('页面：500ms 防抖 + 体力校验 + 成功后重挂起点（老端 `onClickLevy`）', () => {
    const page = src('HangPage.ts');
    assert.match(page, /const SWEEP_DEBOUNCE_MS = 500;/);
    assert.match(page, /if \(this\._lastSweepMs > 0 && now - this\._lastSweepMs < SWEEP_DEBOUNCE_MS\) return;/);
    assert.match(page, /if \(!this\._hasEnoughEnd\(snapshot, snapshot\.sweepEnd \* times\)\) \{/);
    assert.match(page, /this\._startMs = Date\.now\(\);/);
    // 不满 1 小时点领取只提示
    assert.match(page, /if \(!canClaim\(this\._elapsed\(\)\)\) \{\s*FW\.showTip\(HJ_TEXTS\.fullOneHour\);/);
    // 非月卡点倍率切换只提示
    assert.match(page, /FW\.showTip\(HJ_TEXTS\.monthCardLockTip\);/);
});

test('⚠️ 界面文案的唯一入口是 `HJ_TEXTS`（页面里不许再写中文字面量）', () => {
    const page = src('HangPage.ts');
    assert.match(page, /import \{ HJ_TEXTS, hjFormat \} from '\.\/HangTexts';/);
    assert.match(page, /this\.timeLabel\.string = formatHms\(capped\);/);
    assert.match(page, /this\.adCountLabel\.string = adCountTextOf\(snapshot, snapshot\.adRest, snapshot\.adLimit\);/);
    assert.match(page, /this\.monthCardPriceLabel\.string = monthCardPriceTextOf\(snapshot\);/);
    // 去掉注释与 `@property({ tooltip: '…' })` 后再粗筛中文字面量（tooltip 是编辑器里看的，不算界面文案）
    const codeOnly = page
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/@property\(\{[\s\S]*?\}\)/g, '');
    const chineseLiterals = (codeOnly.match(/'[^'\n]*[\u4e00-\u9fa5][^'\n]*'/g) ?? [])
        .filter((literal) => !literal.startsWith("'[Hang]"));
    assert.deepEqual(
        chineseLiterals,
        [],
        `页面里出现了中文界面文案字面量 —— 应当收敛进 HJ_TEXTS：${chineseLiterals.join(', ')}`,
    );
    assert.ok(codeOnly.includes('adCountTextOf'), '去掉注释后应当还剩下代码文本');
});

test('⚠️ 入口：征收**不走** open.url 路由（老端走跳转 `JUMP_TYPE.HANG = 9`），别往白名单里塞', () => {
    // 路径口径：单测一律从工程根跑 ⇒ 隔壁的 `doc/`（策划表）与 `client/`（老端）都是 `../`。
    // `../doc/…` 在本仓已有先例（`tests/zcds-model.test.ts` 的 `readPvpRef`）；`../client/…`
    // 同理 —— 两者都在 `D:/City1001/` 这一级，读不到就应当**响亮地失败**（而不是静默跳过）。
    // ── 正向：老端出处逐条对源文件，不是靠印象 ─────────────────────────────
    const modelJump = readFileSync('../client/assets/script/app/game/model/jump/ModelJump.ts', 'utf8');
    const old = /HANG = (\d+),/.exec(modelJump);
    assert.ok(old, '老端 `ModelJump.ts` 里应有 `HANG = <n>,`');
    assert.equal(Number(old![1]), 9, '老端 `JUMP_TYPE.HANG = 9`');
    assert.match(modelJump, /\/\/征收/, '老端这两行是有 `//征收` 注释的');
    const viewJump = readFileSync('../client/assets/script/app/game/ctrl/jump/ViewJump.ts', 'utf8');
    assert.match(viewJump, /case JUMP_TYPE\.HANG:[\s\S]{0,80}CtrlMgr\.CtrlHang\.openLayerHang\(\)/);
    const ctrlHang = readFileSync('../client/assets/script/app/game/ctrl/hang/CtrlHang.ts', 'utf8');
    assert.match(ctrlHang, /openLayerHang\(\)/);
    assert.match(ctrlHang, /this\.LayerHang\.load\(\);/);
    // 另一处老端入口：战斗选关面板上的按钮
    assert.match(
        readFileSync('../client/assets/script/app/game/fguiExtend/GObjChapterSelect.ts', 'utf8'),
        /CtrlHang\.openLayerHang\(\)/,
    );

    // ── 常量：⚠️ **不能 import**（`HangRepository` 拖进 `CacheMgr` → `cc`，Node 里跑不了）
    //    所以既能读源码、又能和老端源文件交叉验证：本工程的值必须 == `ModelJump` 里的值。
    const own = /export const HJ_JUMP_TYPE_HANG = (\d+);/.exec(src('HangRepository.ts'));
    assert.ok(own, '`HangRepository` 里应有 `export const HJ_JUMP_TYPE_HANG = <n>;`');
    assert.equal(Number(own![1]), Number(old![1]), '本工程常量必须等于老端 `JUMP_TYPE.HANG`');
    assert.equal(Number(own![1]), 9);
    assert.match(src('HangRepository.ts'), /本工程\*\*还没接跳转链路\*\*/);

    // ── 反向：策划源表与工程表里都没有 `LayerHang` 行（这是「不登记」的硬依据）──
    const sourceOpen = readFileSync('../doc/塔防数据配置/json/client/open.json', 'utf8');
    assert.equal(/LayerHang/.test(sourceOpen), false, '策划源表 open.json 里出现了 LayerHang —— 结论要重核，可以登记了');
    const engineOpen = readFileSync('assets/remoteRef/open.json', 'utf8');
    assert.equal(/LayerHang/.test(engineOpen), false, '工程 open.json 里出现了 LayerHang —— 结论要重核');

    // ── 反向：两张路由表都不许出现 hang（登记了会打破「白名单 ⊆ open.json」守卫）──
    const route = readFileSync('assets/script/app/main/MainEntranceRoute.ts', 'utf8');
    const list = readFileSync('assets/script/app/main/MainEntranceList.ts', 'utf8');
    assert.equal(/hang/i.test(route), false, '征收不是 open.url 入口 ⇒ 路由白名单不该出现 hang');
    assert.equal(/HangPage/.test(list), false, '征收不是 open.url 入口 ⇒ 类映射不该出现 HangPage');
    // 反向的守卫本身必须在（它才是「有人顺手登记」的报警器）
    const routeTest = readFileSync('tests/main-entrance-route.test.ts', 'utf8');
    assert.match(routeTest, /白名单里每个 url 都必须真的出现在 open\.json 里/);
    assert.match(routeTest, /routedEntranceUrls\(\)\.filter\(\(url\) => !allUrls\.has\(url\)\)/);
});

// ============================================================
// E. 文案表
// ============================================================

test('`HJ_TEXTS`：FGUI 静态文案与 `mL.json` 原文逐条对上', () => {
    // FGUI `组件_挂机_界面.xml` / 子组件 XML 的 `text` 属性（静态文案的权威）
    assert.equal(HJ_TEXTS.title, '税收');
    assert.equal(HJ_TEXTS.barLabel, '已征收');
    assert.equal(HJ_TEXTS.rewardTitle, '产出奖励');
    assert.equal(HJ_TEXTS.quickTitle, '快速征收');
    assert.equal(HJ_TEXTS.claimTitle, '领取');
    assert.equal(HJ_TEXTS.monthCardPriceFallback, '￥30');
    assert.equal(HJ_TEXTS.levelHint, '征收最新2星及以上通关的关卡奖励');
    // ⚠️ 是「**税收**不限次数」不是「征收」
    assert.equal(HJ_TEXTS.monthCardHint, '购买后税收不限次数');
    // ⚠️ 冒号是**全角** `：`
    assert.equal(HJ_TEXTS.maxTimeHint, '当天最长征收时间：8h');
    assert.ok(HJ_TEXTS.maxTimeHint.includes('：'), '全角冒号');
    assert.equal(HJ_TEXTS.monthCardLabel, '月卡');
    assert.equal(HJ_TEXTS.monthCardTitle, '福利月卡');

    // `mL.json`（新工程 `assets/remoteRef/mL.json`）
    assert.equal(HJ_TEXTS.dayLeftTime, '今日剩余({0}/{1})');
    assert.equal(HJ_TEXTS.dayWatchTime, '今日看广告次数:{0}/{1}');
    assert.equal(HJ_TEXTS.unlimitedTime, '无限征收');
    assert.equal(HJ_TEXTS.fullOneHour, '挂机满一小时可领取');
    assert.equal(HJ_TEXTS.claimSuccess, '领取成功');
    assert.equal(HJ_TEXTS.monthCardInEffect, '月卡还在有效期内，暂不可重复购买');
    assert.equal(HJ_TEXTS.adConfirmContent, '免费扫荡次数已用完，是否观看广告增加1次扫荡机会？(每日最多加{0}/{1}次)');
    assert.equal(HJ_TEXTS.adConfirmWatch, '立即观看');
    assert.equal(HJ_TEXTS.sweepError, '当前关卡不能扫荡');
    assert.equal(HJ_TEXTS.sweepTimesEnough, '每天只能扫荡%s次', '⚠️ 占位是 %s 不是 {0}');

    // Demo3.8 自备
    assert.equal(HJ_TEXTS.offlineTip, '网络未连接');
    assert.equal(HJ_TEXTS.failedTip, '操作失败，请稍后再试');
    assert.equal(HJ_TEXTS.adUnavailable, '广告暂未接入');
    // ⚠️ `TabGiftMonth_Lock` 新工程 mL.json 里**没有**（老端 id=601）⇒ 只能作为常量新增
    assert.equal(HJ_TEXTS.monthCardLockTip, '激活月卡后解锁功能');
    const ml = readFileSync('assets/remoteRef/mL.json', 'utf8');
    assert.equal(ml.includes('激活月卡后解锁功能'), false, '新工程 mL.json 不该有这条 —— 有的化就该改成读表');
});

test('两套占位符口径：`hjFormat` 认 `{n}`、`hjFormatPercent` 认 `%s`', () => {
    assert.equal(hjFormat(HJ_TEXTS.dayLeftTime, 2, 3), '今日剩余(2/3)');
    assert.equal(hjFormat(HJ_TEXTS.priceTemplate, 30), '￥30');
    assert.equal(hjFormat('a{0}b{1}c', 1, 2), 'a1b2c');
    // 越界的占位符原样保留（不是空串）
    assert.equal(hjFormat('a{0}b{5}', 1), 'a1b{5}');
    assert.equal(hjFormat('no placeholder', 1), 'no placeholder');
    // `%s` 一套（从前往后逐个吃参数）
    assert.equal(hjFormatPercent(HJ_TEXTS.sweepTimesEnough, 5), '每天只能扫荡5次');
    assert.equal(hjFormatPercent('a%sb%sc', 1, 2), 'a1b2c');
    assert.equal(hjFormatPercent('a%sb%sc', 1), 'a1b%sc');
    assert.equal(hjFormatPercent('no placeholder', 1), 'no placeholder');
    // 两套互不干扰
    assert.equal(hjFormat(HJ_TEXTS.sweepTimesEnough, 5), HJ_TEXTS.sweepTimesEnough);
    assert.equal(hjFormatPercent(HJ_TEXTS.dayLeftTime, 2, 3), HJ_TEXTS.dayLeftTime);
});

test('文案表的键集合稳定（增删键要让每条用途都还有人用）', () => {
    const keys = Object.keys(HJ_TEXTS);
    // 至少覆盖这些用途
    for (const key of [
        'title', 'barLabel', 'rewardTitle', 'maxTimeHint', 'levelHint', 'monthCardHint',
        'quickTitle', 'claimTitle', 'monthCardPriceFallback', 'priceTemplate',
        'dayLeftTime', 'dayWatchTime', 'unlimitedTime', 'fullOneHour', 'claimSuccess',
        'monthCardInEffect', 'monthCardLockTip', 'adConfirmContent', 'adConfirmWatch',
        'sweepError', 'sweepTimesEnough', 'offlineTip', 'failedTip', 'adUnavailable',
    ]) {
        assert.ok(keys.includes(key), `HJ_TEXTS 缺 ${key}`);
    }
    // 页面 / 仓库引用到的键都必须存在（防改名漏改）
    const page = src('HangPage.ts');
    for (const match of page.matchAll(/HJ_TEXTS\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        assert.ok(keys.includes(match[1]!), `HangPage 引用了不存在的 HJ_TEXTS.${match[1]}`);
    }
    const repository = src('HangRepository.ts');
    for (const match of repository.matchAll(/HJ_TEXTS\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        assert.ok(keys.includes(match[1]!), `HangRepository 引用了不存在的 HJ_TEXTS.${match[1]}`);
    }
    // 字面量联合类型
    const texts = src('HangTexts.ts');
    assert.match(texts, /export type HangTextKey = keyof typeof HJ_TEXTS;/);
});

// ============================================================
// F. 主界面「征收」入口（HUD，**不是** open.json 入口）
// ============================================================
//
// 这个入口长在**主界面**（老端 `组件_战斗_章节选择` 里的 `快速扫荡` 节点），点下去才开
// `HangPage`。它和 `ChatEntry` 是同一类「竞技页常驻 HUD」⇒ 挂在
// `assets/resources/ui/main/ArenaRoot.prefab` 根下，靠 `cc.Widget(LEFT|BOT)` 定位，
// **不**走 `open.url` 白名单（理由见 D 段「征收不走 open.url 路由」那条）。
//
// 版面真源是**三级嵌套**，缺一级就偏：
//   主界面 720×1280 → `组件_章节选择` `xy=(0,196) size=720×1000` → `快速扫荡`
//   `xy=(17,800) size=100×131` + `<gearDisplay controller="有无扫荡" pages="1"/>`
// ⇒ 屏上 `left = 17`、`bottom = 1280 − (196 + 800 + 131) = 153`（与 `ChatEntry` 的 152 同一条底线）。
// ⚠️ 别只看本体 `组件_战斗_快速扫荡.xml` 的 `size=100,120` —— 它被实例覆写成 100×131。

const ARENA_PATH = 'assets/resources/ui/main/ArenaRoot.prefab';

/** `HangEntryButton.ts.meta` 的 uuid 压缩出来的 cid（`compressUuid` 定义在 C 段）。 */
const ENTRY_CID = '10ef5PuHu1JN556yrBvqD60';

/**
 * 入口子树的根路径。
 *
 * ⚠️ 节点表的 key **带根名**（与 Hang 那边的 `Hang/PopBg` 同一口径）—— 写成裸 `HangEntry`
 * 会「一层都没匹配上」，症状是每条用例都报「里没有节点 HangEntry」。
 */
const ENTRY = 'ArenaRoot/HangEntry';

/** `ENTRY` 下的子节点路径。 */
function entryChild(name: string): string {
    return `${ENTRY}/${name}`;
}

const ARENA = JSON.parse(readFileSync(ARENA_PATH, 'utf8')) as Array<Record<string, unknown>>;

/**
 * ⚠️ 嵌套 prefab 实例在本文件里只是「带 `_parent` + `_prefab` 的**桩**」：**没有 `_children` /
 * `_layer`**（技能 §6.1.1）。把它们算进节点表会连报假警报 ⇒ 判据 = 是否带 `_children` 数组。
 */
const ARENA_NODES = ARENA.filter((entry) => entry && entry.__type__ === 'cc.Node' && Array.isArray(entry._children));

const ARENA_BY_PATH = new Map<string, Record<string, unknown>>();
{
    const byId = new Map<number, Record<string, unknown>>();
    ARENA.forEach((entry, index) => {
        if (entry && entry.__type__ === 'cc.Node') byId.set(index, entry);
    });
    for (const n of ARENA_NODES) {
        const parts: string[] = [];
        let cursor: Record<string, unknown> | undefined = n;
        while (cursor) {
            parts.unshift(String(cursor._name));
            const parent = cursor._parent as { __id__: number } | null;
            cursor = parent ? byId.get(parent.__id__) : undefined;
        }
        ARENA_BY_PATH.set(parts.join('/'), n);
    }
}

function aNode(path: string): Record<string, unknown> {
    const hit = ARENA_BY_PATH.get(path);
    assert.ok(hit, `${ARENA_PATH} 里没有节点 ${path}`);
    return hit!;
}

function aCompsOf(path: string): Array<Record<string, unknown>> {
    return ((aNode(path)._components as Array<{ __id__: number }>) ?? []).map((ref) => ARENA[ref.__id__]!);
}

function aCompOfType(path: string, type: string): Record<string, unknown> {
    const hit = aCompsOf(path).find((comp) => comp && comp.__type__ === type);
    assert.ok(hit, `${path} 上没挂 ${type}`);
    return hit!;
}

function aHasCompType(path: string, type: string): boolean {
    return aCompsOf(path).some((comp) => comp && comp.__type__ === type);
}

function aSizeOf(path: string): { w: number; h: number } {
    const size = aCompOfType(path, 'cc.UITransform')._contentSize as { width: number; height: number };
    return { w: size.width, h: size.height };
}

/** 浮点相等的容差比较（`lpos` 里有 90.26548672566372 这种值）。 */
function sameNum(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-9;
}

test('⚠️ 入口挂在 `ArenaRoot` 根下，且是**最后一个**子节点（`_children` 序 = 渲染序）', () => {
    const kids = ((aNode('ArenaRoot')._children as Array<{ __id__: number }>) ?? []).map(
        (ref) => String(ARENA[ref.__id__]!._name),
    );
    assert.ok(kids.includes('HangEntry'), `ArenaRoot 根下应有 HangEntry，实际：${kids.join(', ')}`);
    assert.equal(kids[kids.length - 1], 'HangEntry', '入口要压在既有 HUD 之上（渲染最上层）');
    // 它和 `ChatEntry` 同类：都是竞技页常驻 HUD、都在根下；`EntranceLayer` 才是数据驱动的入口列
    assert.ok(kids.includes('ChatEntry'), '`ChatEntry` 是同类 HUD，应当也还在根下');
    assert.equal(kids.includes('EntranceLayer'), true, '`EntranceLayer` 不能被改动');

    // ⚠️ 层序 = FGUI `组件_战斗_快速扫荡` 的 displayList 序
    //    （`按钮 → n61(底板) → 文本 → com_rd`）。写反了**不报错**：
    //    `Bg` 提前会把图标下沿盖住、`TimeText` 提前会被底板盖住。
    assert.deepEqual(
        ((aNode(ENTRY)._children as Array<{ __id__: number }>) ?? []).map((ref) => String(ARENA[ref.__id__]!._name)),
        ['Btn', 'Bg', 'TimeText', 'RedDot'],
    );
});

test('⚠️ 入口子树：全 UI_2D、组件序固定、脚本 cid 双向可反解（防 `MissingScript`）', () => {
    for (const path of [ENTRY, entryChild('Btn'), entryChild('Bg'), entryChild('TimeText'), entryChild('RedDot')]) {
        assert.equal(aNode(path)._layer, 33554432, `${path} 的 layer 不是 UI_2D ⇒ 整棵子树不渲染`);
    }
    assert.deepEqual(
        aCompsOf(ENTRY).map((comp) => comp.__type__),
        ['cc.UITransform', 'cc.Widget', 'cc.Button', ENTRY_CID],
        '先布局（UITransform/Widget）再交互（Button），脚本最后',
    );
    assert.deepEqual(aCompsOf(entryChild('Btn')).map((c) => c.__type__), ['cc.UITransform', 'cc.Sprite']);
    assert.deepEqual(aCompsOf(entryChild('Bg')).map((c) => c.__type__), ['cc.UITransform', 'cc.Sprite']);
    assert.deepEqual(aCompsOf(entryChild('TimeText')).map((c) => c.__type__), ['cc.UITransform', 'cc.Label']);
    assert.deepEqual(aCompsOf(entryChild('RedDot')).map((c) => c.__type__), ['cc.UITransform', 'cc.Sprite']);

    // ⚠️ `__scriptAsset` 是编辑器注入的运行时属性、**不落盘** ⇒ 唯一能证明「脚本接对了」的判据
    //    就是 cid ↔ `.ts.meta.uuid` 互相反解。
    const metaUuid = (JSON.parse(readFileSync('assets/script/app/hang/HangEntryButton.ts.meta', 'utf8')) as {
        uuid: string;
    }).uuid;
    assert.equal(compressUuid(metaUuid), ENTRY_CID, '`ENTRY_CID` 与 `.ts.meta` 反解值必须一致（抄错就是 MissingScript）');
    assert.equal(
        ARENA.some((entry) => entry && String(entry.__type__).includes('Missing')),
        false,
        '出现了 `cc.MissingScript`',
    );
});

test('⚠️ 几何：`HangEntry` 100×131 + `Widget(LEFT|BOT)` 17 / 153（三级嵌套反解）', () => {
    assert.deepEqual(aSizeOf(ENTRY), { w: 100, h: 131 }, '实例把本体声明的 100×120 覆写成 100×131');
    const widget = aCompOfType(ENTRY, 'cc.Widget');
    // AlignFlags: TOP=1 / MID=2 / BOT=4 / LEFT=8 / CENTER=16 / RIGHT=32 ⇒ 8|4 = 12
    assert.equal(widget._alignFlags, 12, 'LEFT(8) | BOT(4)');
    assert.equal(widget._left, 17, 'FGUI `xy=(17,800)` 的 x —— 参照系是 720 宽的 `组件_章节选择`，正好等于左距');
    // 1280 − (196 + 800 + 131) = 153；⚠️ 别把 800 直接当屏坐标
    assert.equal(widget._bottom, 153, '底边距屏底 = 153（与 `ChatEntry` 的 152 同一条底线）');
    assert.equal(widget._alignMode, 2, 'ALWAYS —— 切分辨率立刻重算');
    assert.equal(widget._target, null, '对齐父节点');

    // 存盘位置也要对：`Widget` 只在运行时覆盖，存盘值错会让「没跑 Widget 的预览」偏位
    const pos = aNode(ENTRY)._lpos as { x: number; y: number; z: number };
    assert.ok(sameNum(pos.x, 17 + 50 - 360), `lpos.x 应为 left + 半宽 − 半画布 = −293，实际 ${pos.x}`);
    assert.ok(sameNum(pos.y, 153 + 65.5 - 640), `lpos.y 应为 bottom + 半高 − 半画布 = −421.5，实际 ${pos.y}`);
    assert.equal(pos.z, 0);
});

test('⚠️ 子树几何逐条反解回 FGUI XML 原值（局部系 100×131、y 向下）', () => {
    // FGUI `组件_战斗_快速扫荡.xml` displayList 的 `xy` + `size` ⇒ 换算 `lpos = (中心x − 50, 65.5 − 中心y)`
    const kids: ReadonlyArray<readonly [string, number, number, number, number, number, number]> = [
        // 节点, lposX, lposY, 宽, 高, FGUI 中心x, FGUI 中心y
        ['Btn', 0, -11.5, 100, 102 * 100 / 113, 50, 77],
        ['Bg', -0.5, -48.5, 163, 30, 49.5, 114],
        ['TimeText', 0, -48.5, 107, 29, 50, 114],
        ['RedDot', 36, 49.5, 30, 30, 86, 16],
    ];
    for (const [name, lx, ly, w, h, cx, cy] of kids) {
        const path = entryChild(name);
        const pos = aNode(path)._lpos as { x: number; y: number };
        assert.ok(sameNum(pos.x, lx) && sameNum(pos.y, ly), `${path} 的 _lpos 应为 (${lx}, ${ly})，实际 (${pos.x}, ${pos.y})`);
        const size = aSizeOf(path);
        assert.ok(sameNum(size.w, w) && sameNum(size.h, h), `${path} 的尺寸应为 ${w}×${h}，实际 ${size.w}×${size.h}`);
        // ⚠️ 反解回 FGUI 中心才是「没偏」的硬判据 —— 只比 `lpos` 会被「自己也抄错一次」骗过
        assert.ok(
            sameNum(pos.x + 100 / 2, cx) && sameNum(131 / 2 - pos.y, cy),
            `${path} 反解回 FGUI 局部中心应为 (${cx}, ${cy})，实际 (${pos.x + 50}, ${65.5 - pos.y})`,
        );
        const anchor = aCompOfType(path, 'cc.UITransform')._anchorPoint as { x: number; y: number };
        assert.deepEqual([anchor.x, anchor.y], [0.5, 0.5], `${path} 的 anchor 不是中心`);
    }
    // ⚠️ `Btn` 的高是 `scaleFree`(contain) 算出来的：容器 100×100、贴图 113×102 ⇒ 100/113×102
    //    写 100×100 会让图标纵向拉伸 11%（而这是**不报错**的）
    assert.ok(
        sameNum(aSizeOf(entryChild('Btn')).h, 102 * 100 / 113),
        `Btn 高应为 90.2655，实际 ${aSizeOf(entryChild('Btn')).h}`,
    );
});

test('⚠️ 入口三张图：uuid / `_type` / `_sizeMode` 全对上（底板必须是九宫）', () => {
    const uuidAt = (path: string): string => {
        const sprite = aCompOfType(path, 'cc.Sprite');
        const ref = sprite._spriteFrame as { __uuid__?: string } | null;
        assert.ok(ref && ref.__uuid__, `${path} 没有 spriteFrame`);
        return ref.__uuid__!;
    };
    // 按钮脸：`zjm_icon03_ZhengShou`（**非**九宫，别照抄信息底）
    assert.equal(uuidAt(entryChild('Btn')), spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.entryIcon).uuid);
    assert.equal(aCompOfType(entryChild('Btn'), 'cc.Sprite')._type, 0, '按钮脸不是九宫');
    // 文案底板：`战斗选关_九宫_信息底01`（九宫 20,7,20,9）—— `_type` 漏写只是「整张被拉伸」，不报错
    assert.equal(uuidAt(entryChild('Bg')), spriteMeta(HJ_ART_DIR, HJ_ART_NAMES.entryBg).uuid);
    assert.equal(aCompOfType(entryChild('Bg'), 'cc.Sprite')._type, 1, '底板必须 SLICED');
    // 红点：照抄 `ChatEntry/RedDot` —— 同一张 30×30 占位图，**不是**嵌套 `ui/common/RedDot.prefab` 实例
    assert.equal(uuidAt(entryChild('RedDot')), uuidAt('ArenaRoot/ChatEntry/RedDot'), '红点占位图应与 ChatEntry 同一张');
    assert.equal(uuidAt(entryChild('RedDot')), spriteMeta('assets/resources/image/common', 'cm_red_dot').uuid);
    assert.equal(aCompOfType(entryChild('RedDot'), 'cc.Sprite')._type, 0);
    assert.equal(aHasCompType(entryChild('RedDot'), 'cc.Button'), false, '红点不是按钮');
    for (const name of ['Btn', 'Bg', 'RedDot']) {
        assert.equal(aCompOfType(entryChild(name), 'cc.Sprite')._sizeMode, 0, `${name} 的 _sizeMode 必须是 CUSTOM(0)`);
    }
});

test('⚠️ 时长文案 Label 7 项口径（FGUI `文本_快速扫荡章节` 20 号白字居中）', () => {
    const label = aCompOfType(entryChild('TimeText'), 'cc.Label');
    // ⚠️ 初值就是 `00:00:00`：FGUI 里那个 `第{zhang=1}章第{guan=1}关` 是**废弃模板**，
    //    老端 `onTimeLoop()` 真正写进去的是「累计挂机时长」（见 `HangEntryButton` 文件头）。
    assert.equal(label._string, '00:00:00');
    assert.equal(label._fontSize, 20);
    assert.deepEqual(label._color, { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 }, '白字');
    assert.equal(label._horizontalAlign, 1, 'CENTER');
    assert.equal(label._verticalAlign, 1, 'CENTER');
    assert.equal(label._overflow, 2, 'SHRINK —— 8 位数刚好塞进 107 宽');
    assert.equal(label._enableWrapText, false, 'SHRINK + 折行会挤成两行');
});

test('⚠️ `@property` 接线：`shakeNode` / `redDot` 指向**节点**、`timeLabel` 指向 **cc.Label 组件**', () => {
    const script = aCompsOf(ENTRY).find((comp) => comp.__type__ === ENTRY_CID);
    assert.ok(script, '`HangEntry` 上没有 `HangEntryButton`');
    const deref = (value: unknown): Record<string, unknown> => ARENA[(value as { __id__: number }).__id__]!;

    const shake = deref(script!.shakeNode);
    assert.equal(shake.__type__, 'cc.Node');
    assert.equal(shake._name, 'Btn', '摇摆对象是 FGUI `按钮_快速扫荡`（`t0` 转的就是它），不是根节点');

    const dot = deref(script!.redDot);
    assert.equal(dot.__type__, 'cc.Node');
    assert.equal(dot._name, 'RedDot');

    // ⚠️ 组件引用必须指向**组件**本身：指向节点时 tsc 会红，但手改 JSON 就会**静默失效**
    const time = deref(script!.timeLabel);
    assert.equal(time.__type__, 'cc.Label');
    assert.equal(deref(time.node)._name, 'TimeText');
});

test('🔴 `HangEntry._active` 必须烘 `true`（烘 `false` ⇒ `onLoad` 永不执行 ⇒ 入口永不显示）', () => {
    // `Component.onLoad` **只在节点被激活时才跑**，而 `refresh()` 在 `onLoad` 里 ⇒
    // 照 FGUI 设计期默认页（「无」）烘 `false` 就是死锁：哪怕 `sweetLevel` 真有值也不会显示。
    // 烘 `true` 后由 `applySnapshot()` 每趟**无条件**改写（规则 82）—— 见下一个用例。
    assert.equal(aNode(ENTRY)._active, true, '烘 false 会让 onLoad 死锁');
    assert.equal(aNode(entryChild('RedDot'))._active, false, '红点占位保持隐藏（老端从不点亮）');
    assert.equal(aNode('ArenaRoot/ChatEntry/RedDot')._active, false, '既有口径：`ChatEntry/RedDot` 也是 `_active=false`');
    for (const name of ['Btn', 'Bg', 'TimeText']) {
        assert.equal(aNode(entryChild(name))._active, true, `${name} 要可见`);
    }
});

test('⚠️ `HangEntryButton` 源码口径（它 import `cc` ⇒ 只能读文本）', () => {
    // ⚠️ 先剥注释：文件头/函数体注释里**故意**写了反例（如 `if (v !== this._visible)`），
    //    不剥就会把「举的反例」当成「真写了」。
    const code = src('HangEntryButton.ts')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\/\/[^\n]*$/gm, '')
        .replace(/@property\(\{[\s\S]*?\}\)/g, '');
    assert.ok(code.includes('applySnapshot'), '剥完注释应当还剩下代码文本（不然下面的断言全是假绿）');

    // ---- ① 可见性：`sweetLevel !== null`（老端 `有无扫荡` controller）----
    assert.match(code, /const visible = snapshot\.sweetLevel !== null;/);
    // 🔴 无条件写（规则 82）：prefab 烘的是 `true`（见上一条），写成「只在翻转时写」就会
    //    因为「新值 === 缓存初值」短路 ⇒ 新号永久停在可见态。
    assert.match(code, /this\.node\.active = visible;/);
    assert.equal(/this\._visible\b/.test(code), false, '不许引入「上一次的可见性」缓存字段 —— 那就是「只在翻转时写」');

    // ---- ② 点击：挂在**根节点**的 `cc.Button` 上（点击区 100×131 > `Btn` 的 100×90.27）----
    assert.match(code, /this\.node\.getComponent\(Button\)/);
    assert.match(code, /button\.node\.on\(Button\.EventType\.CLICK, this\.onClick, this\);/);
    assert.match(code, /void HangPage\.open\(\);/);

    // ---- ③ 规则 71：`onDestroy` 里**禁** `off(`（会抛 TypeError 并中断销毁链）----
    const destroy = /protected onDestroy\(\): void \{([\s\S]*?)\n {4}\}/.exec(code);
    assert.ok(destroy, '没抓到 `onDestroy` 函数体');
    assert.equal(/\.off\(/.test(destroy![1]!), false, '规则 71：`onDestroy` 里 off 会抛 TypeError 并中断销毁链');
    assert.match(destroy![1]!, /this\.unscheduleAllCallbacks\(\);/);
    assert.match(destroy![1]!, /this\._stopShake\(\);/);

    // ---- ④ 摇摆：FGUI `t0` = `0 → +8° → −8° → 0`，每段 12 帧 @60fps = 0.2s ----
    assert.match(code, /export const HJ_ENTRY_SHAKE_SEGMENT_SECONDS = 0\.2;/);
    assert.match(code, /export const HJ_ENTRY_SHAKE_DEG = 8;/);
    assert.match(code, /\.union\(\)[\s\S]{0,20}\.repeatForever\(\)/);
    assert.match(code, /if \(this\._shaking\) return;/, '`_startShake` 必须幂等');
    // ⚠️ `_stopShake` 里必须判 `isValid`：销毁期 `setRotationFromEuler` 抛了会中断销毁链
    const stop = /private _stopShake\(\): void \{([\s\S]*?)\n {4}\}/.exec(code);
    assert.ok(stop, '没抓到 `_stopShake` 函数体');
    assert.match(stop![1]!, /if \(!target \|\| !target\.isValid\) return;/);
    assert.match(stop![1]!, /Tween\.stopAllByTarget\(target\);/);
    assert.match(stop![1]!, /target\.setRotationFromEuler\(0, 0, 0\);/);

    // ---- ⑤ 计时：起点 `lastIdleRewardTimeMs || now`、每秒一跳、到顶停表 ----
    assert.match(code, /const start = snapshot\.role \? snapshot\.role\.lastIdleRewardTimeMs : 0;/);
    assert.match(code, /this\._startMs = start > 0 \? start : Date\.now\(\);/);
    assert.match(code, /this\.schedule\(this\._tick, 1\);/);
    assert.match(code, /this\.timeLabel\.string = formatHms\(idleCappedMs\(elapsed\)\);/);
    assert.match(code, /if \(canClaim\(elapsed\)\) \{/);
    assert.match(code, /if \(idleReachedMax\(elapsed\)\) this\.unschedule\(this\._tick\);/);
    // 不可领取时不许留 tween 在跑（否则一直摇）
    assert.match(code, /\} else \{[\s\S]{0,40}this\._stopShake\(\);/);

    // ---- ⑥ 红点：本轮**不**点亮（照老端）----
    assert.match(code, /setRedDot\(visible: boolean\): void \{/);
    assert.equal(/this\.redDot\.active = true/.test(code), false, '老端从不点亮入口红点 ⇒ 不许无条件点亮');
});

test('⚠️ 入口**不**登记路由白名单（HUD ≠ `open.json` 入口行）', () => {
    // D 段那条从**源码文本**钉；这里从**函数口径**再钉一次，
    // 免得有人把它当成 `EntranceLayer` 的一员顺手登记进去
    // （登记了会打破 `tests/main-entrance-route.test.ts` 的「白名单 ⊆ open.json」守卫）。
    assert.equal(resolveEntranceRoute('LayerHang').kind, 'none');
    assert.equal(isEntranceUrlRouted('LayerHang'), false);
    assert.equal(routedEntranceUrls().some((url) => /hang/i.test(url)), false);
});

test('`ArenaRoot.prefab` 无空洞、无越界 `__id__`、`fileId` 长度统一 22', () => {
    const holes = ARENA.map((entry, index) => (entry ? -1 : index)).filter((index) => index >= 0);
    assert.deepEqual(holes, [], `有空洞：${holes.join(', ')}`);

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
            assert.ok(id >= 0 && id < ARENA.length, `${where} 的 __id__ ${id} 越界`);
            assert.ok(ARENA[id], `${where} 的 __id__ ${id} 指向空洞`);
            return;
        }
        for (const key of Object.keys(record)) {
            if (key.startsWith('__') && key !== '__prefab') continue;
            check(record[key], `${where}.${key}`);
        }
    };
    ARENA.forEach((entry, index) => {
        for (const key of REF_KEYS) check((entry ?? {})[key], `#${index}.${key}`);
    });
    assert.ok(refs > 300, `引用数太少（${refs}），说明没走全`);

    // ⚠️ 嵌套 prefab 实例根有**独立作用域**，它的 `fileId` 与宿主内其它节点可以重复 ⇒ 要跳过
    //    （判据：`cc.PrefabInfo.instance` 非空 = 实例根）
    const infos = ARENA.filter((e) => e && e.__type__ === 'cc.PrefabInfo');
    const own = infos.filter((e) => !e.instance);
    assert.equal(own.length, ARENA_NODES.length, '每个**自有**节点一个 `cc.PrefabInfo`');
    const fids = own.map((e) => String(e.fileId));
    assert.equal(new Set(fids).size, fids.length, '自有节点的 `PrefabInfo.fileId` 有重复');
    // 规则 11：`cc.CompPrefabInfo.fileId` 必须 22 位（LCG 取低位会周期重复）
    for (const info of ARENA.filter((e) => e && e.__type__ === 'cc.CompPrefabInfo')) {
        assert.equal(typeof info.fileId, 'string');
        assert.equal((info.fileId as string).length, 22, `CompPrefabInfo.fileId 长度异常：${String(info.fileId)}`);
    }
});
