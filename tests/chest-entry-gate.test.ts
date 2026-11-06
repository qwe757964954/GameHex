/**
 * 战斗宝箱入口的**开启条件**回归网（需求 2026-11-03）。
 *
 * 需求原文：*「在功能开启表中补充完整战斗宝箱掉落的开启条件，只有当 pvp 节点 20001 胜利
 * 通过后，才展示出战斗宝箱入口 icon，播放 icon 生成的缩放动画」*。
 *
 * 这里钉三件事：
 *
 * | # | 钉什么 | 为什么 |
 * | :-- | :-- | :-- |
 * | ① 表 | 策划表 701「战斗掉落宝箱」那一行的条件就是 `territoryLevel(20001)`、`belond=0` | 条件**写在表里**，客户端不认关卡号 |
 * | ② 判定 | 未过 20001 ⇒ 不显示；过了 ⇒ 显示；表缺行 ⇒ 不显示但报得出来 | 三种状态不能混成一个 `false` |
 * | ③ 动画 | `0 → 1.15 → 1`，与领地宝箱同一条曲线 | 两处"弹出来"的手感必须像一家人 |
 *
 * 全程只 import 零引擎依赖的模块（`ChestEntryGate` 对 `MainEntranceVisible` 只有值/类型依赖，
 * 后者本身零引擎），所以能直接在 Node 里跑。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    CHEST_ENTRY_OPEN_REF_ID,
    CHEST_ENTRY_POP_OVERSHOOT,
    CHEST_ENTRY_POP_SECONDS,
    chestEntryPopScale,
    findChestEntryRow,
    inspectChestEntryConditions,
    isChestEntryUnlocked,
    isChestEntryVerdictProvisional,
    isTerritoryLevelPassedInTerritory,
    passedTerritoryLevelIds,
    resolveChestEntryGate,
    territoryLevelCellsInChapter,
} from '../assets/script/app/main/ChestEntryGate';
import type { ChestEntryTerritoryView } from '../assets/script/app/main/ChestEntryGate';
import { EMPTY_ENTRANCE_PLAYER_STATE } from '../assets/script/app/main/MainEntranceVisible';
import type { EntrancePlayerState, EntranceVisibleRow } from '../assets/script/app/main/MainEntranceVisible';
import { collectEntranceItems, EntranceBelond } from '../assets/script/app/main/MainEntranceTypes';
import { TERRITORY_CHEST_POP_OVERSHOOT } from '../assets/script/app/territory/model/TerritoryChestAnimation';
import { assetPath } from './helpers/asset-paths';

const OPEN_TABLE = 'assets/remoteRef/open.json';
const READ_PATH = 'assets/script/app/main/MainPage.ts';

const openRows = JSON.parse(readFileSync(OPEN_TABLE, 'utf8')) as EntranceVisibleRow[];

/**
 * 一个只有「通关了这几关」这一件事的玩家。
 *
 * 两个取数口都按同一份清单答复（`battleLevel` 与 `territoryLevel` 在本用例里不区分数据源）；
 * 要单独验证「只过主线不算数」用 `stateTerritoryPassed`。
 */
function statePassed(...levels: number[]): EntrancePlayerState {
    return {
        ...EMPTY_ENTRANCE_PLAYER_STATE,
        hasRole: true,
        roleLevel: 60,
        createdDays: 30,
        isLevelPassed: (level: number) => levels.includes(level),
        isTerritoryLevelPassed: (levelId: number) => levels.includes(levelId),
    };
}

/** 只有领地据点通过（主线 `CmdBattleLevel` 一份都没有）。 */
function stateTerritoryPassed(...levelIds: number[]): EntrancePlayerState {
    return { ...statePassed(), isLevelPassed: () => false, isTerritoryLevelPassed: (id) => levelIds.includes(id) };
}

/** 吞掉 `console.warn` 并把内容收集起来（缺行 / 未识别条件都会 warn，不该糊在测试输出里）。 */
function captureWarn(run: () => void): string[] {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
    try {
        run();
    } finally {
        console.warn = original;
    }
    return warnings;
}

// ============================================================
// ① 表
// ============================================================

test('open.json 的 701「战斗掉落宝箱」那一行：territoryLevel(20001) + belond=0', () => {
    const row = findChestEntryRow(openRows);
    assert.ok(row, `open.json 里找不到 refId=${CHEST_ENTRY_OPEN_REF_ID} 的战斗掉落宝箱行`);

    assert.equal(CHEST_ENTRY_OPEN_REF_ID, 701, 'refId 必须是策划表里那一行（2026-11-03「补充到 701 对应行内」）');
    // `EntranceVisibleRow` 只声明判定要用的字段；`name` / `resShowType` / `type` 是策划表的其它列。
    const raw = row as unknown as { name?: string; resShowType?: number[]; type?: number };
    assert.equal(raw.name, '战斗掉落宝箱', 'name 要跟策划表一致，改表时这条会先红');
    assert.deepEqual(raw.resShowType, [10, 7], '货币条口径（金币 + 体力）照策划表原样留着');
    // 策划表 G-功能开启.xlsx 的 701 行「界面类型」列本来就填了 2（layer 界面）。
    // json 是从 Excel 导出来的产物，手工补行时最容易漏掉这类"表里有、逻辑不用"的列。
    assert.equal(raw.type, 2, 'type 必须照抄策划表（2 = layer 界面），漏了就是 json 和表对不上');
    assert.deepEqual(row!.visibleCondition, [{ param: { resId: 20001 }, type: 'territoryLevel' }],
        '开启条件必须是「pvp 据点 20001 通关」；类型得是 territoryLevel —— battleLevel 查的是\n'
        + ' CmdBattleLevel，而服务端对 pvp 据点不写那张表（2026-11-03 实机验证）');
    assert.equal(row!.preResId, undefined, '不该挂前置系统，条件自成一条');
    assert.equal(row!.belond, 0, 'belond 必须是 0 —— 它是条件载体，不是左右两列的活动入口');
    assert.equal(row!.url, undefined, '没有对应界面，别填 url（填了会被 MainEntranceRoute 白名单要求路由）');
    assert.equal(row!.icon, undefined, '图标是 prefab 上 ChestEntry 自带的，不按表加载');
    assert.match(String(row!.tipShow ?? ''), /20001/, 'tipShow 要把解锁关卡写出来，策划对表用');
    // 上一版临时开的 `refId=504` 已经撤掉 —— 留着它就等于在表里多一条策划不认识的行。
    assert.equal(openRows.some((entry) => entry.refId === 504), false,
        '504 是临时行，已经并进 701，不许再回来');
});

test('运行时真正读的那份表（refSmallAll.json 里的 open）也要有 701', () => {
    // ⚠️ `open` 在 `tools/ref/small.txt` 里 = 合并表成员。`RefUtil.loadRefSmallAll()`
    // 把 refSmallAll 里出现的每个表名注册进 `tmMergeRef`，之后 `getResData` 见到合并表成员
    // 直接返回 null ⇒ 只肯从 refSmallAll 取。`assets/remoteRef/open.json` 是历史残留的死文件，
    // 改它对运行时没有任何效果（2026-11-03 实机踩到：表读到了但报 refId=701 找不到）。
    const smallList = readFileSync('tools/ref/small.txt', 'utf8').split('\n').map((line) => line.trim());
    assert.ok(smallList.includes('open'), 'open 得在 small.txt 里，否则本用例的前提就不成立');

    const all = JSON.parse(readFileSync('assets/remoteRef/refSmallAll.json', 'utf8')) as Record<string, unknown>;
    const block = all.open as { k: string[]; v: unknown[][] } | undefined;
    assert.ok(block?.k, 'refSmallAll.json 里没有 open 表');

    // 列式还原成行式（`RefUtil.tryGetCompressKeyRefData` 干的就是这件事）
    const rows = block!.v.map((row) => Object.fromEntries(block!.k.map((key, index) => [key, row[index]])));
    const row701 = rows.find((entry) => entry.refId === 701) as Record<string, unknown> | undefined;
    assert.ok(row701, 'refSmallAll 的 open 里没有 701 —— 只改 open.json 是不生效的，得重跑 ref_compress_json.py');
    assert.deepEqual(row701!.visibleCondition, [{ param: { resId: 20001 }, type: 'territoryLevel' }]);
    assert.equal(row701!.name, '战斗掉落宝箱');
    assert.equal(row701!.type, 2);

    // 两份必须同源：行数不一致说明改了策划表没重跑压缩脚本
    assert.equal(rows.length, openRows.length,
        `refSmallAll(${rows.length}) 与 open.json(${openRows.length}) 行数不一致 —— 改完表记得重跑 tools/ref/ref_compress_json.py`);
});

test('条件行不会在主界面左右两侧多长出一颗图标', () => {
    for (const side of [EntranceBelond.left, EntranceBelond.right]) {
        const items = collectEntranceItems(openRows as never, side, () => true);
        assert.equal(
            items.some((item) => item.refId === CHEST_ENTRY_OPEN_REF_ID), false,
            `belond=${side} 收进了战斗宝箱行 —— 它该只当条件载体`,
        );
    }
});

// ============================================================
// ② 判定
// ============================================================

test('20001 没通关 ⇒ 宝箱入口不显示；通关 ⇒ 显示', () => {
    const locked = captureWarn(() => {
        assert.equal(isChestEntryUnlocked(openRows, statePassed()), false);
    });
    assert.deepEqual(locked, [], '条件没满足是正常状态，不该 warn');

    assert.equal(isChestEntryUnlocked(openRows, statePassed(20001)), true);
});

test('边界：只打到 20000 不算数，必须是 20001 本身', () => {
    assert.equal(isChestEntryUnlocked(openRows, statePassed(10001, 20000)), false);
    assert.equal(isChestEntryUnlocked(openRows, statePassed(20001, 20002)), true);
});

test('pvp 据点只走 territoryLevel：主线 battleLevel 通了也不算数（2026-11-03 实机根因）', () => {
    // 实机现象：`CmdBattleLevel 里没有 level=20001 这一行` —— 服务端对据点不写那张表。
    // 所以只把主线判定打通（isLevelPassed 全 true）时，入口必须**仍然锁着**。
    assert.equal(isChestEntryUnlocked(openRows, { ...statePassed(), isLevelPassed: () => true }), false);
    // 反过来：只有领地据点通过 ⇒ 解锁
    assert.equal(isChestEntryUnlocked(openRows, stateTerritoryPassed(20001)), true);
    assert.equal(isChestEntryUnlocked(openRows, stateTerritoryPassed(10001)), false);
});

test('表上如果退回 battleLevel，领地数据再全也救不回来 —— 这条就是那个坑的护栏', () => {
    // 真实的服务器状态（2026-11-03 实测）：领地据点 20001 已通关，
    // 但 `CmdBattleLevel` 里**没有**这一行 —— 服务端根本不写。
    const realServer = { ...stateTerritoryPassed(20001), isLevelPassed: () => false };

    // territoryLevel（查领地）⇒ 解锁
    assert.equal(isChestEntryUnlocked(openRows, realServer), true);
    // battleLevel（查 CmdBattleLevel）⇒ 同一份服务器状态下锁死
    const rows = openRows.map((row) => (row.refId === 701
        ? { ...row, visibleCondition: [{ param: { resId: 20001 }, type: 'battleLevel' }] }
        : row));
    assert.equal(isChestEntryUnlocked(rows, realServer), false,
        '类型和数据源必须成对：battleLevel 配领地据点 = 永远打不开');
});

// ============================================================
// ②-2 跨章节：一次性成就
// ============================================================

/** 第 2 章的领地快照：**没有** 20001（它属第 1 章），并且一格都没通。 */
function chapterTwoView(): ChestEntryTerritoryView {
    const stageByCell = new Map<number, { levelId: number }>();
    for (let index = 0; index < 16; index += 1) stageByCell.set(100 + index, { levelId: 10011 + index });
    return { stageByCell, isAreaPassed: () => false };
}

test('切到第 2 章后，第 1 章通关的据点仍然算通关（2026-11-04 实机：入口又丢了）', () => {
    const chapterTwo = chapterTwoView();
    // 第 2 章里根本没有 20001 —— 只看当前章 ⇒ 恒 false，正是那个 bug
    assert.deepEqual(territoryLevelCellsInChapter(chapterTwo, 20001), []);
    assert.equal(isTerritoryLevelPassedInTerritory(20001, chapterTwo, null), false);

    // 账号级的「已通关」是跨章成就 ⇒ 切到哪一章都算过
    assert.equal(isTerritoryLevelPassedInTerritory(20001, chapterTwo, new Set([20001])), true);
    assert.equal(isTerritoryLevelPassedInTerritory(20002, chapterTwo, new Set([20001])), false,
        '只认记过的那些关卡号，不能一条成就放行所有关卡');

    // 挂到入口判定上：条件一个字没改，只是数据源变成「跨章成就 || 当前章快照」
    const archived = new Set([20001]);
    const crossChapter = {
        ...stateTerritoryPassed(),
        isTerritoryLevelPassed: (levelId: number) => isTerritoryLevelPassedInTerritory(levelId, chapterTwo, archived),
    };
    assert.equal(isChestEntryUnlocked(openRows, crossChapter), true);

    const noArchive = {
        ...crossChapter,
        isTerritoryLevelPassed: (levelId: number) => isTerritoryLevelPassedInTerritory(levelId, chapterTwo, null),
    };
    assert.equal(isChestEntryUnlocked(openRows, noArchive), false,
        '既没有落盘成就、当前章又没有这一关 ⇒ 锁着（查不到不等于通过）');
});

test('第 1 章的现场判定不变：同一关的格子任一个通关就算通关', () => {
    // 一片战斗区域横跨好几格，只有第 2 格被记成通关 —— 区域内归并由
    // `TerritoryProgress.isAreaPassed` 负责，这里只钉「有格子 ⇒ 看格子通没通」这一层。
    const view: ChestEntryTerritoryView = {
        stageByCell: new Map<number, { levelId: number }>([
            [7, { levelId: 20001 }], [8, { levelId: 20001 }], [9, { levelId: 10011 }],
        ]),
        isAreaPassed: (cellId) => cellId === 8,
    };
    assert.deepEqual(territoryLevelCellsInChapter(view, 20001), [7, 8]);
    assert.equal(isTerritoryLevelPassedInTerritory(20001, view, null), true);

    // 「这一章已通关的关卡」= MainPage 每帧整批记进账号成就的那份清单（去重）
    assert.deepEqual(passedTerritoryLevelIds(view), [20001]);
    assert.deepEqual(passedTerritoryLevelIds(chapterTwoView()), [], '一格都没通 ⇒ 没有可记的');
    assert.deepEqual(passedTerritoryLevelIds({ stageByCell: null, isAreaPassed: () => true }), []);
    assert.deepEqual(passedTerritoryLevelIds({ stageByCell: view.stageByCell, isAreaPassed: null }), []);
    assert.equal(isTerritoryLevelPassedInTerritory(10011, view, null), false, '没通的那一关不能算');
    assert.equal(isTerritoryLevelPassedInTerritory(30001, view, null), false, '这一章没有的关卡');

    // 快照没到（null）也走不动，但绝不抛
    assert.equal(isTerritoryLevelPassedInTerritory(20001, { stageByCell: null, isAreaPassed: () => true }, null), false);
    assert.equal(isTerritoryLevelPassedInTerritory(20001, { stageByCell: view.stageByCell, isAreaPassed: null }, null), false);
});

test('排障快照：逐条给出条件的关卡号与判定结果（2026-11-03 实机没长出来时加的探针）', () => {
    // 未通关：能看到「是哪一关卡住了」
    const blocked = inspectChestEntryConditions(openRows, statePassed());
    assert.equal(blocked.length, 1, '701 行当前只有一条 visibleCondition');
    assert.equal(blocked[0].type, 'territoryLevel');
    assert.equal(blocked[0].resId, 20001, '关卡号要从表里读出来，别写死在客户端');
    assert.equal(blocked[0].verdict, 'fail');

    // 通关：同一条变成 pass —— 探针和判定必须是同一套语义，不能各判各的
    const passed = inspectChestEntryConditions(openRows, statePassed(20001));
    assert.deepEqual(passed.map((entry) => entry.verdict), ['pass']);

    // 表缺行：没有条件可报，交给 rowMissing 那条日志说
    assert.deepEqual(inspectChestEntryConditions(null, statePassed()), []);
    assert.deepEqual(inspectChestEntryConditions([], statePassed()), []);
});

test('表缺行 ⇒ 不显示（fail-closed），且与「条件没满足」区分得开', () => {
    const missing = { unlocked: false, rowMissing: true };
    let gate = missing;
    const warnings = captureWarn(() => {
        gate = resolveChestEntryGate([], statePassed(20001));
    });
    assert.deepEqual(gate, missing, '整张表都没这一行时不能自动放行');
    assert.equal(warnings.length, 1, '缺行要 warn 一次，否则线上只会看到「入口没了」');
    assert.match(warnings[0], new RegExp(`refId=${CHEST_ENTRY_OPEN_REF_ID}`));

    const lockedGate = resolveChestEntryGate(openRows, statePassed());
    assert.deepEqual(lockedGate, { unlocked: false, rowMissing: false }, '条件没满足不是"缺行"');
});

test('整张表读失败（null / undefined）按缺行处理，不抛', () => {
    for (const rows of [null, undefined]) {
        let gate = { unlocked: true, rowMissing: false };
        captureWarn(() => { gate = resolveChestEntryGate(rows, statePassed(20001)); });
        assert.deepEqual(gate, { unlocked: false, rowMissing: true });
    }
});

// ============================================================
// ③ 生成动画
// ============================================================

test('生成动画：0 起、冲到 1.15 再落回 1，时长一到就定格', () => {
    assert.equal(chestEntryPopScale(0), 0, '起手必须是 0（不是 0.9 那种"淡入"）');
    assert.equal(chestEntryPopScale(-1), 0);
    assert.equal(chestEntryPopScale(Number.NaN), 0);
    assert.equal(chestEntryPopScale(CHEST_ENTRY_POP_SECONDS), 1);
    assert.equal(chestEntryPopScale(CHEST_ENTRY_POP_SECONDS * 3), 1, '落位后不再动缩放');

    // 峰值出现在 65% 处（与领地宝箱 `springPop` 的 rise 同口径）
    const peakAt = CHEST_ENTRY_POP_SECONDS * 0.65;
    assert.ok(Math.abs(chestEntryPopScale(peakAt) - CHEST_ENTRY_POP_OVERSHOOT) < 1e-9, '峰值缩放应为 1.15');

    // 上升段单调涨、回落段单调降 —— 中间夹一下才叫"弹"
    let previous = 0;
    for (let t = 0; t < peakAt; t += CHEST_ENTRY_POP_SECONDS / 40) {
        const scale = chestEntryPopScale(t);
        assert.ok(scale >= previous - 1e-9, `t=${t} 处上升段回头了`);
        assert.ok(scale <= CHEST_ENTRY_POP_OVERSHOOT + 1e-9, '不该冲过峰值');
        previous = scale;
    }
    let falling = CHEST_ENTRY_POP_OVERSHOOT;
    for (let t = peakAt; t < CHEST_ENTRY_POP_SECONDS; t += CHEST_ENTRY_POP_SECONDS / 40) {
        const scale = chestEntryPopScale(t);
        assert.ok(scale <= falling + 1e-9, `t=${t} 处回落段回头了`);
        falling = scale;
    }
    assert.ok(falling > 0.98, '回落段结尾要收到 1 附近，不能停在半截');
});

test('峰值常量与领地宝箱是同一个数（两处"弹出来"的手感不许漂）', () => {
    assert.equal(CHEST_ENTRY_POP_OVERSHOOT, TERRITORY_CHEST_POP_OVERSHOOT);
});

// ============================================================
// ④ 接线（源码 / prefab）
// ============================================================

/** 去掉注释，只看真正会跑的代码（注释里提到 20001 不算"写死"）。 */
function codeOnly(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\r\n]*/g, '$1');
}

test('客户端不写死关卡号 —— 条件只有表里那一份', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));
    assert.equal(/20001/.test(code), false, 'MainPage 里出现了 20001 —— 条件该由 open.json 决定');
    assert.match(code, /resolveChestEntryGate\(/, '判定要走 ChestEntryGate，别自己写一套 battleLevel 判断');
});

test('MainPage 接线：先藏再判、解锁才播动画、销毁时退订关卡缓存', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));

    // 先藏再判：onLoad 里 active=false 必须早于 refreshChestEntry()（数量格同步藏）
    assert.match(code, /this\.chestToggle\.active = false;\s*this\.setChestCellsVisible\(false\);\s*this\.refreshChestEntry\(\);/,
        'onLoad 必须先把入口和数量格都藏起来再判条件，否则未解锁的号会瞥见一帧');
    // 解锁路径：显示 + 播生成动画（且只播一次，靠静态标记挡重播）
    assert.match(code, /private static chestEntryCelebrated = false;/,
        '庆祝标记必须是静态的 —— 主城页每局返回都会重建，实例字段会重播');
    assert.match(code, /if \(MainPage\.chestEntryCelebrated\) return;\s*MainPage\.chestEntryCelebrated = true;\s*this\.startChestEntryPop\(\);/);
    // 关卡通关状态变化要实时重算，不能等重进主城
    assert.match(code, /setEventUpdate\('CmdBattleLevel', this, this\.onBattleLevelCacheUpdate\)/);
    assert.match(code, /removeEventUpdate\('CmdBattleLevel', this, this\.onBattleLevelCacheUpdate\)/);
    // 没解锁时点不开宝箱栏
    assert.match(code, /if \(!this\.chestEntryUnlocked\) return;[\s\S]*?setChestPanelOpen/);
});

test('prefab 上入口图标就绑在 MainPage.chestToggle 上，且挂在 BottomHud 下', () => {
    const objects = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as Array<Record<string, unknown>>;
    const page = objects.find((entry) => entry && 'chestToggle' in entry && 'chestCell0' in entry);
    assert.ok(page, 'MainPage 组件上没找到 chestToggle');

    const node = objects[(page!.chestToggle as { __id__: number }).__id__];
    assert.equal(node.__type__, 'cc.Node');
    assert.equal(node._name, 'ChestEntry', 'chestToggle 绑错节点了');
    assert.equal(node._active, false, '入口默认必须是藏着的（fail-closed）：条件判过才由 MainPage 打开');

    const parent = objects[(node._parent as { __id__: number }).__id__];
    assert.equal(parent._name, 'BottomHud', '入口必须挂在底部 HUD 上（不能是宝箱栏里的节点）');

    const sprite = ((node._components ?? []) as Array<{ __id__: number }>)
        .map((ref) => objects[ref.__id__])
        .find((entry) => entry?.__type__ === 'cc.Sprite') as Record<string, unknown> | undefined;
    assert.ok(sprite, '入口上没有 Sprite —— 藏了之后就没东西可显示了');
    const frameUuid = (sprite!._spriteFrame as { __uuid__?: string } | undefined)?.__uuid__;
    const hudChest = JSON.parse(readFileSync(assetPath('image/main/hud/hud_chest.png.meta'), 'utf8')) as { uuid: string };
    assert.equal(frameUuid, `${hudChest.uuid}@f9941`, '入口贴图变了？确认是不是换成了别的 icon');
});

test('四个数量格跟着入口 icon 同进同出（2026-11-03「宝箱未解锁时这几个也不展示」）', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));

    // ① 解锁 ⇒ icon 和数量格一起亮出来
    assert.match(code, /this\.chestToggle\.active = true;\s*this\.setChestCellsVisible\(true\);/,
        '解锁时要连数量格一起显示');
    // ② 未解锁 ⇒ 一起藏掉（只藏 icon 会留下 4 个孤零零的格子）
    assert.match(code, /if \(!gate\.unlocked\) \{[\s\S]*?this\.setChestCellsVisible\(false\);/,
        '未解锁分支必须把数量格也藏了');
    // ③ 格子集合只有一处定义：显隐和填色走同一份，免得将来只改一边
    assert.match(code, /private chestCells\(\): Sprite\[\]/, '四个格子要抽成一个集合');
    const lists = code.match(/\[this\.chestCell0, this\.chestCell1, this\.chestCell2, this\.chestCell3\]/g) ?? [];
    assert.equal(lists.length, 1, `格子列表出现了 ${lists.length} 次 —— 只该在 chestCells() 里有一处`);

    // ④ prefab：绑定正确 + 默认藏（fail-closed，跟 ChestEntry 同一个口径）
    const objects = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as Array<Record<string, unknown>>;
    const page = objects.find((entry) => entry && 'chestToggle' in entry && 'chestCell0' in entry);
    assert.ok(page, 'MainPage 组件上没找到 chestCell0');
    const bottomHud = objects.find((entry) => entry?.__type__ === 'cc.Node' && entry._name === 'BottomHud');
    assert.ok(bottomHud, 'prefab 里找不到 BottomHud');
    const siblings = ((bottomHud._children ?? []) as Array<{ __id__: number }>).map((ref) => objects[ref.__id__]);

    const pairs: Array<[string, string]> = [['chestCell0', 'Cell0'], ['chestCell1', 'Cell1'],
        ['chestCell2', 'Cell2'], ['chestCell3', 'Cell3']];
    for (const [key, name] of pairs) {
        const sprite = objects[(page![key] as { __id__: number }).__id__];
        assert.equal(sprite.__type__, 'cc.Sprite', `${key} 该绑 Sprite 组件`);
        const node = objects[(sprite.node as { __id__: number }).__id__];
        assert.equal(node._name, name, `${key} 绑到了 ${String(node._name)} 上`);
        assert.ok(siblings.some((entry) => entry._name === name), `${name} 应该在 BottomHud 下`);
        assert.equal(node._active, false, `${name} 默认必须藏着 —— 解锁后才由 MainPage 打开`);
    }
});

test('领地快照没到时那是「还没数据」不是「没通关」—— 不许打成 warn（2026-11-03 实机）', () => {
    // 实机日志（icon 出现前刷了两行，看着像关卡号配错）：
    // `[MainPage] 战斗宝箱入口未解锁: territoryLevel(20001) => fail（…当前章节 0 格）`
    const reports = inspectChestEntryConditions(openRows, statePassed());
    assert.ok(reports.some((report) => report.type === 'territoryLevel'),
        '701 行的条件是 territoryLevel —— 本用例的前提');

    assert.equal(isChestEntryVerdictProvisional(reports, false), true,
        '领地快照没到 ⇒ 判定是「暂缓」，不该报 fail');
    assert.equal(isChestEntryVerdictProvisional(reports, true), false,
        '快照到位后仍然 fail ⇒ 那是真没过，必须照常报出来');

    // 只有 battleLevel 条件时永远不算暂缓：主线表是同步的，缺行就是硬失败
    const battleOnly = [{
        refId: CHEST_ENTRY_OPEN_REF_ID,
        visibleCondition: [{ type: 'battleLevel', param: { resId: 1 } }],
    }] as unknown as EntranceVisibleRow[];
    const battleReports = inspectChestEntryConditions(battleOnly, statePassed());
    assert.deepEqual(battleReports.map((report) => report.type), ['battleLevel']);
    assert.equal(isChestEntryVerdictProvisional(battleReports, false), false,
        '没有 territoryLevel 条件时，快照状态与判定无关');

    // 空 reports（表里没有 visibleCondition）也不该被吞掉，那条 warn 要留着
    assert.equal(isChestEntryVerdictProvisional([], false), false);

    // 接线：MainPage 必须在打 warn 之前先判「暂缓」，「空表」也不能当成「这一章没有这关」
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));
    assert.match(code, /if \(isChestEntryVerdictProvisional\(reports, this\.territorySnapshotReady\(\)\)\)/,
        'MainPage 没接「暂缓」判定');
    assert.match(code, /private territorySnapshotReady\(\): boolean \{[\s\S]*?stageByCell\.size > 0/,
        '快照就绪的判据里必须要求 size > 0 —— 空表也是没到');
    assert.match(code, /if \(!stageByCell \|\| stageByCell\.size === 0\) \{[\s\S]*?还没到/,
        'territoryLevelDetail 不能把空表说成「这一章没有这关」');
    assert.match(code, /private static chestEntryWaitingLogged = false;/,
        '「还在等数据」那条 log 要去重（主城页会重建，必须静态）');
    // 真失败的诊断不许被顺手删掉
    assert.match(code, /console\.warn\(`\[MainPage\] 战斗宝箱入口未解锁：\$\{report\.type\}/,
        '真失败的 warn 还在 —— 只是「暂缓」时才跳过');
});

test('MainPage 把判定接到账号级成就上：切章不回退，且只有一处落盘点（2026-11-04）', () => {
    const code = codeOnly(readFileSync(READ_PATH, 'utf8'));

    // ① 判定本身走纯函数（跨章 + 当前章），不再自己 for 一遍 stageByCell
    assert.match(code, /isTerritoryLevelPassedInTerritory\(levelId, \{/,
        '判领地据点通没通必须走 ChestEntryGate 的跨章版本');
    assert.equal(/for \(const \[cellId, stage\] of stageByCell\)/.test(code), false,
        'MainPage 里又自己遍历格子了 —— 那样只看当前章，切到第 2 章就会丢入口');

    // ② 观察到的通关整批落盘，且发生在**判条件之前**（onTerritoryRender 里）
    assert.match(code, /this\.rememberPassedTerritoryLevels\(\);[\s\S]{0,80}?this\.refreshChestEntry\(\);/,
        '领地渲染时要先把这一章已通关的关卡记下来，再判入口 —— 顺序反了，切章那一笔会漏');
    assert.match(code, /this\.territoryArchive\(\)\.markLevelsPassed\(Array\.from\(passed\)\)/,
        '落盘要传 `Array.from(set)` —— release 构建把 `[...set]` 降级成 `[].concat(set)`，静默一条都记不上');
    assert.equal(/markLevelsPassed\(\[\.\.\./.test(code), false,
        '别对 Set 用展开：`assets/script` 不许 [...set]（打包后静默失效）');
    assert.match(code, /private passedTerritoryLevelSet\(\): Set<number> \{[\s\S]*?loadPassedLevels\(\)/,
        '内存镜像要从 TerritorySaveStore.loadPassedLevels 起手（账号级、不分章节）');
    assert.match(code, /createTerritorySaveStore\(readTerritorySaveOwner\(\)\)/,
        '存档作用域必须复用 readTerritorySaveOwner —— 别在 MainPage 里另拼一份 server:role:');

    // ③ 幂等：已经记过的关卡不该反复写盘（内存 Set 先挡）
    assert.match(code, /\.filter\(\(levelId\) => !passed\.has\(levelId\)\)/,
        '落盘前要按内存镜像过滤新增（判定每帧都可能走好几遍）');
    assert.match(code, /if \(!fresh\.length\) return;/);

    // ④ 排障文案要能指出「当前章没有 + 成就里也没有」，否则下次还是分不清
    assert.match(code, /跨章成就里也没记过它/, 'territoryLevelDetail 少了跨章那一句');
});
