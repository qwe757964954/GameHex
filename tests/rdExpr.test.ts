/**
 * 红点**表达式体系**的回归网 —— `app/rd/**` 的移植防线。
 *
 * 分六段：
 *   A. 聚合口径（`RdExprResolver`）—— 老端 `SystemObject.GetRDExpr/GetRDExprToPre`。
 *   B. 异常口径 —— 自引用 / 成环 / 缺配置，**只报错不断链、不递归死**。
 *   C. ⭐ **真 `open.json` 对账** —— 表里出现的变量名必须全都在注册表里；
 *      **且引用了的桩必须逐个登记**（`C6`）。
 *      这条是本套测试里最值钱的一条：漏注册 ⇒ `ExprVarMgr` 报「尚未注册该值」并退化成 `close`
 *      ⇒ 红点静默不亮、界面无感。单测是唯一能在跑起来之前逮住它的手段。
 *      而 `C2` 只挡「名字没注册」；**桩也是注册过的**，所以「模块已落地、变量还是桩」这种漏得靠
 *      `C6` 挡 —— `RDLeague` 就是这么漏了一整个 P6 期的。
 *   D. `RdTypes` 纯函数 —— 变量名提取、计数归一化、聚合校验。
 *   E. `CmdRedDotType` 文本对账 —— `RD_SERVER_TYPE` 是**手抄**的枚举数值，靠这条守着别抄错。
 *   F. 注册表自身的**不变量** —— `impl` 取值合法且与 `RD_SET_VARS` 对齐；额外表不与主表重名；
 *      `RD_ALL_VAR_NAMES` 正好等于三张表的并集（「名字能不能出现在表达式里」只认这一份）。
 *
 * 变量**算出来的值**归 `tests/rdVars.test.ts`（那边还守着 `RdVars.ts` 注册表与 `impl` 的对账）。
 *
 * 口径真源：
 *   - 老端聚合：`client/.../model/System/ModelSystem.ts` 的 `GetRDExpr` / `GetRDExprToPre`
 *   - 老端注册表：`client/.../model/expr/ModelExpr.ts` 的 `Init()`
 *   - 新工程配置表：`assets/remoteRef/open.json`（`RDExpr` + `tlRDResId` 两列）
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    indexRdOpenRows,
    resolveAllRdExprs,
    resolveRdExpr,
} from '../assets/script/app/rd/RdExprResolver';
import type { RdOpenRowLike } from '../assets/script/app/rd/RdExprResolver';
import {
    normalizeRdCount,
    parseRdVarNames,
    rdExpr,
    RD_ALL_VAR_NAMES,
    RD_CLIENT_VARS,
    RD_EXTRA_VAR_NAMES,
    RD_REGISTERED_VAR_NAMES,
    RD_SERVER_TYPE,
    RD_SERVER_VAR_TYPES,
    RD_SET_VARS,
    validateRdAggregation,
} from '../assets/script/app/rd/RdTypes';

// ============================================================
// A. 聚合口径
// ============================================================

const row = (refId: number, RDExpr?: string, tlRDResId?: number[]): RdOpenRowLike =>
    tlRDResId ? { refId, RDExpr, tlRDResId } : { refId, RDExpr };

test('A1 只有自己的 RDExpr ⇒ 原样返回', () => {
    const r = resolveRdExpr(1, [row(1, '[RDMail]')]);
    assert.equal(r.expr, '[RDMail]');
    assert.deepEqual(r.warnings, []);
});

test('A2 自己 + 一个子项 ⇒ `自身+(子项)`', () => {
    const r = resolveRdExpr(1, [row(1, '[RDCoinStore]', [2]), row(2, '[RDGemStore]')]);
    assert.equal(r.expr, '[RDCoinStore]+([RDGemStore])');
});

test('A3 多个子项逐个 `+` 连接，除首项外都带括号（保护 Expr 的 split 结合顺序）', () => {
    const r = resolveRdExpr(1, [
        row(1, '[RDA]', [2, 3]),
        row(2, '[RDB]'),
        row(3, '[RDC]'),
    ]);
    assert.equal(r.expr, '[RDA]+([RDB])+([RDC])');
});

test('A4 子项没配表达式 ⇒ 不产生空括号（老端 expr 为空时不进 parts）', () => {
    const r = resolveRdExpr(1, [row(1, '[RDA]', [2, 3]), row(2, ''), row(3, '[RDC]')]);
    assert.equal(r.expr, '[RDA]+([RDC])');
});

test('A5 自己没配、只有子项 ⇒ 子项直接串联', () => {
    const r = resolveRdExpr(1, [row(1, undefined, [2, 3]), row(2, '[RDB]'), row(3, '[RDC]')]);
    assert.equal(r.expr, '[RDB]+([RDC])');
});

test('A6 嵌套聚合：A→B→C 逐层求和', () => {
    const r = resolveRdExpr(1, [
        row(1, '[RDA]', [2]),
        row(2, '[RDB]', [3]),
        row(3, '[RDC]'),
    ]);
    assert.equal(r.expr, '[RDA]+([RDB]+([RDC]))');
    assert.deepEqual(r.warnings, []);
});

test('A7 空白字符被清掉（Expr 构造时也会去空格，这里提前去便于去重比较）', () => {
    const r = resolveRdExpr(1, [row(1, '[RDCoinStore] + [RDGemStore]')]);
    assert.equal(r.expr, '[RDCoinStore]+[RDGemStore]');
});

test('A8 一行都没有 RDExpr 也没 tlRDResId ⇒ 空串（调用方据此收红点）', () => {
    const r = resolveRdExpr(1, [row(1)]);
    assert.equal(r.expr, '');
    assert.deepEqual(r.warnings, []);
});

test('A9 全表一次算完，每个入口都能拿到自己的表达式', () => {
    const rows = [row(1, '[RDA]', [2]), row(2, '[RDB]'), row(3, '[RDC]')];
    const all = resolveAllRdExprs(rows);
    assert.equal(all.size, 3);
    assert.equal(all.get(1)?.expr, '[RDA]+([RDB])');
    assert.equal(all.get(2)?.expr, '[RDB]');
    assert.equal(all.get(3)?.expr, '[RDC]');
});

// ============================================================
// B. 异常口径
// ============================================================

test('B1 ⚠️ 自己关注自己 ⇒ 报错并跳过（不跳过会无限递归）', () => {
    const r = resolveRdExpr(1, [row(1, '[RDA]', [1])]);
    assert.equal(r.expr, '[RDA]');
    assert.ok(r.warnings.some((w) => w.includes('包含了自己')), r.warnings.join('|'));
});

test('B2 ⚠️ 成环 A→B→A ⇒ 报错断链、**不能**递归死', () => {
    const r = resolveRdExpr(1, [row(1, '[RDA]', [2]), row(2, '[RDB]', [1])]);
    // A 展开 B，B 再想展开 A 时被 visited 挡下
    assert.equal(r.expr, '[RDA]+([RDB])');
    assert.ok(r.warnings.some((w) => w.includes('成环或重复引用')), r.warnings.join('|'));
});

test('B3 缺配置：tlRDResId 指向不存在的 refId ⇒ 报错并忽略这一项', () => {
    const r = resolveRdExpr(1, [row(1, '[RDA]', [999])]);
    assert.equal(r.expr, '[RDA]');
    assert.ok(r.warnings.some((w) => w.includes('不存在')), r.warnings.join('|'));
});

test('B4 目标 refId 不在表里 ⇒ 空串 + 报错', () => {
    const r = resolveRdExpr(777, [row(1, '[RDA]')]);
    assert.equal(r.expr, '');
    assert.ok(r.warnings.some((w) => w.includes('777')), r.warnings.join('|'));
});

test('B5 同一个子项被引用两次 ⇒ 第二次报「重复引用」并断链（老端原文口径）', () => {
    const r = resolveRdExpr(1, [row(1, '[RDA]', [2, 2]), row(2, '[RDB]')]);
    assert.equal(r.expr, '[RDA]+([RDB])');
    assert.ok(r.warnings.some((w) => w.includes('成环或重复引用')), r.warnings.join('|'));
});

test('B6 refId 是字符串 / Long 形状也能索引（远端表字段类型不定）', () => {
    const rows = [
        { refId: '1' as unknown as number, RDExpr: '[RDA]', tlRDResId: ['2' as unknown as number] },
        { refId: 2, RDExpr: '[RDB]' },
    ];
    assert.equal(resolveRdExpr(1, rows).expr, '[RDA]+([RDB])');
    assert.equal(indexRdOpenRows(rows).size, 2);
});

// ============================================================
// C. ⭐ 真 open.json 对账
// ============================================================

const OPEN_JSON = 'assets/remoteRef/open.json';
const openRows = JSON.parse(readFileSync(OPEN_JSON, 'utf8')) as RdOpenRowLike[];

/** `open.json` 里所有 `RDExpr` 用到的变量名（去重）。 */
function varNamesInOpenJson(): string[] {
    const seen = new Set<string>();
    for (const r of openRows) {
        for (const name of parseRdVarNames(r?.RDExpr ?? '')) seen.add(name);
    }
    return [...seen].sort();
}

test('C1 open.json 能读，且确实带 RDExpr / tlRDResId 两列', () => {
    assert.ok(Array.isArray(openRows), 'open.json 顶层应是数组');
    assert.ok(openRows.length > 0, 'open.json 没有行');
    const withExpr = openRows.filter((r) => r?.RDExpr);
    const withTl = openRows.filter((r) => (r?.tlRDResId ?? []).length > 0);
    assert.ok(withExpr.length > 0, 'open.json 里没有任何 RDExpr —— 红点表达式体系会整个失效');
    assert.ok(withTl.length > 0, 'open.json 里没有任何 tlRDResId —— 聚合红点会整个失效');
});

test('C2 ⭐ open.json 用到的每个变量名都必须注册过（漏一个 = 该入口红点静默不亮）', () => {
    const registered = new Set<string>([
        ...RD_REGISTERED_VAR_NAMES,
        ...RD_EXTRA_VAR_NAMES,
        ...Object.keys(RD_SET_VARS),
    ]);
    const missing = varNamesInOpenJson().filter((name) => !registered.has(name));
    assert.deepEqual(
        missing,
        [],
        `open.json 用了但没注册的变量（会静默退化成 0）：${missing.join(', ')}\n` +
            '→ 去 app/rd/RdTypes.ts 补进 RD_SERVER_VAR_TYPES / RD_CLIENT_VARS',
    );
});

test('C3 open.json 每一个配了 RDExpr 的入口，聚合过程都不该报异常', () => {
    const all = resolveAllRdExprs(openRows);
    const problems: string[] = [];
    for (const [refId, result] of all) {
        if (result.warnings.length > 0) {
            problems.push(`refId=${refId}: ${result.warnings.join(' / ')}`);
        }
    }
    assert.deepEqual(problems, [], `open.json 聚合异常：\n${problems.join('\n')}`);
});

test('C4 配了 RDExpr 的入口，聚合结果必须非空（否则红点永远不亮）', () => {
    const all = resolveAllRdExprs(openRows);
    const empties: number[] = [];
    for (const r of openRows) {
        const refId = Number(r?.refId);
        if (!Number.isFinite(refId)) continue;
        if (!r?.RDExpr) continue;
        if (!all.get(refId)?.expr) empties.push(refId);
    }
    assert.deepEqual(empties, [], `这些入口配了 RDExpr 却聚合出空串：${empties.join(', ')}`);
});

test('C5 主界面用到的入口聚合出的表达式里，变量名都不能重复出现（重复 = 值被算两遍）', () => {
    const all = resolveAllRdExprs(openRows);
    const dup: string[] = [];
    for (const [refId, result] of all) {
        if (!result.expr) continue;
        const names = parseRdVarNames(result.expr);
        if (new Set(names).size !== names.length) {
            dup.push(`refId=${refId}: ${result.expr}`);
        }
    }
    assert.deepEqual(dup, [], `聚合表达式里变量重复：\n${dup.join('\n')}`);
});

/**
 * `open.json` 里**被引用、但实现仍是桩**（`impl: 'stub'`）的变量 —— 必须在此登记。
 *
 * 为什么单靠 `C2` 不够：`C2` 只保证「名字注册过」，而**桩也是注册过的**（`RdStubVar` 恒返回 0）。
 * 于是「模块在新工程已落地、却忘了把变量从桩改成真实现」这种漏，`C2` 抓不到 —— 表现是
 * **红点永不亮、也不报错**（`RDLeague` 就这样潜伏了整个 P6 期，直到横向排查才发现）。
 * 本守卫把「被 `open.json` 引用的桩」变成**显式清单**：新增一个被引用的桩 ⇒ 红；
 * 已登记的桩接上真实现后忘了从清单删 ⇒ 也红（防止清单腐烂）。
 */
const OPEN_JSON_STUB_ALLOWLIST: readonly string[] = [
    // 玩法 / 模块尚未在新工程落地（`RD_CLIENT_VARS` 第二组「未做」）
    'RDAdvisor', 'RDArmy', 'RDChallengeRewards', 'RDCity', 'RDCoinStore',
    'RDDailyShare', 'RDEquipLevelUp', 'RDFightRewards', 'RDGemStore', 'RDGeneral',
    'RDGuards', 'RDLeaderSkill', 'RDLiLian', 'RDMiltia', 'RDOSRank', 'RDTabWorkShop',
    // 玩法已做、但取数口径未定（理由见 `RdTypes.RD_CLIENT_VARS` 注释）
    'RDChat', // 卡在聊天「已读」标记（`markRead()` 无调用方 ⇒ `readTimeOf()` 恒 0）
    'RDLimitTime', // 限时礼包页在新工程还没落地
].sort();

test('C6 ⭐ open.json 引用到的桩必须逐个登记在册（RDLeague 就是漏在这条上）', () => {
    // 正向：引用了却没登记的桩 ⇒ 说明有模块已落地、但变量忘了转真实现
    const referencedStubs = varNamesInOpenJson().filter(
        (name) => RD_CLIENT_VARS[name]?.impl === 'stub',
    );
    const undocumented = referencedStubs.filter((n) => !OPEN_JSON_STUB_ALLOWLIST.includes(n));
    assert.deepEqual(
        undocumented,
        [],
        `open.json 引用了这些变量，但它们仍是桩（⇒ 该入口红点永不亮、且不报错）：${undocumented.join(', ')}\n` +
            '→ 要么把模块接上（RdTypes 改 impl 为 ready + 在 RdVars.ts 补实现类），' +
            '要么在 OPEN_JSON_STUB_ALLOWLIST 里登记理由',
    );

    // 反向：清单腐烂 —— 登记的名字要么已不在 open.json 引用里，要么已经接了真实现
    const stale = OPEN_JSON_STUB_ALLOWLIST.filter(
        (n) => RD_CLIENT_VARS[n]?.impl !== 'stub' || !referencedStubs.includes(n),
    );
    assert.deepEqual(stale, [], `OPEN_JSON_STUB_ALLOWLIST 里这些名字该删了：${stale.join(', ')}`);
});

// ============================================================
// D. RdTypes 纯函数
// ============================================================

test('D1 parseRdVarNames 去重、保序，且把 `[time:1,2]` 的参数丢掉', () => {
    assert.deepEqual(parseRdVarNames('[A]+([B])+([A])'), ['A', 'B']);
    assert.deepEqual(parseRdVarNames('5<[time:1,2]&&[time]<10'), ['time']);
    assert.deepEqual(parseRdVarNames(''), []);
    assert.deepEqual(parseRdVarNames(null), []);
    assert.deepEqual(parseRdVarNames('[RDChat]'), ['RDChat']);
});

test('D2 rdExpr 生成 `[名]`，不带空格（Expr 会去空格，提前对齐）', () => {
    assert.equal(rdExpr('RDMail'), '[RDMail]');
    assert.equal(rdExpr('RDMail').includes(' '), false);
});

test('D3 normalizeRdCount：null/undefined/NaN/负数/小数/Long 形状', () => {
    assert.equal(normalizeRdCount(null), 0);
    assert.equal(normalizeRdCount(undefined), 0);
    assert.equal(normalizeRdCount(0), 0);
    assert.equal(normalizeRdCount(-5), 0, '负数收敛成 0（红点计数没有负数含义）');
    assert.equal(normalizeRdCount(Number.NaN), 0);
    assert.equal(normalizeRdCount(3.9), 3);
    assert.equal(normalizeRdCount('7'), 7);
    assert.equal(normalizeRdCount(true), 1);
    assert.equal(normalizeRdCount(false), 0);
    assert.equal(normalizeRdCount({ toNumber: () => 42 }), 42, 'Long 走 toNumber');
    assert.equal(normalizeRdCount({ low: 7, high: 0 }), 7, 'Long 走 low/high');
    assert.equal(normalizeRdCount({}), 0);
});

test('D4 validateRdAggregation：自引用、引用未注册变量都要报出来', () => {
    assert.deepEqual(validateRdAggregation('RDTabGem', '[RDGemHaveBetter]+([RDGemCompose])'), []);
    assert.ok(
        validateRdAggregation('RDTabGem', '[RDTabGem]').some((e) => e.includes('自引用')),
        '自引用必须被抓到',
    );
    assert.ok(
        validateRdAggregation('RDTabGem', '[RDNotExistXyz]').some((e) => e.includes('未注册')),
        '未注册引用必须被抓到',
    );
    assert.deepEqual(validateRdAggregation('RDTabGem', ''), [], '空表达式不算错');
});

// ============================================================
// E. CmdRedDotType 文本对账
// ============================================================

test('E1 ⭐ RD_SERVER_TYPE 的手抄数值必须与 CmdInterface.ts 的 enum 逐条一致', () => {
    const source = readFileSync('assets/script/app/generated/netProto/CmdInterface.ts', 'utf8');
    const start = source.indexOf('enum CmdRedDotType');
    assert.ok(start > 0, 'CmdInterface.ts 里找不到 enum CmdRedDotType');
    const body = source.slice(start, source.indexOf('}', start));

    const actual = new Map<string, number>();
    for (const match of body.matchAll(/(\w+)\s*=\s*(\d+)/g)) {
        actual.set(match[1], Number(match[2]));
    }
    assert.ok(actual.size > 0, 'CmdRedDotType 一条都没解析出来');

    const expected = new Map<string, number>([
        ['TEST', RD_SERVER_TYPE.TEST],
        ['MAil', RD_SERVER_TYPE.MAIL],
        ['continuity_days', RD_SERVER_TYPE.CONTINUITY_DAYS],
        ['GEM_COMPOSE', RD_SERVER_TYPE.GEM_COMPOSE],
        ['SEVEN_DAY', RD_SERVER_TYPE.SEVEN_DAY],
        ['limit_time_activity', RD_SERVER_TYPE.LIMIT_TIME_ACTIVITY],
        ['signin', RD_SERVER_TYPE.SIGNIN],
        ['SPIRIT_ANIMAL_BOX', RD_SERVER_TYPE.SPIRIT_ANIMAL_BOX],
        ['FIRST_RECHARGE', RD_SERVER_TYPE.FIRST_RECHARGE],
    ]);

    for (const [name, value] of expected) {
        assert.equal(actual.get(name), value, `CmdRedDotType.${name} 抄错了`);
    }
    assert.equal(actual.size, expected.size, '枚举成员数与 RD_SERVER_TYPE 对不上（新增了类型？）');
});

test('E2 服务端型变量映射到的都是合法枚举值，且变量名以 RD 开头', () => {
    const legal = new Set(Object.values(RD_SERVER_TYPE));
    for (const [varName, type] of Object.entries(RD_SERVER_VAR_TYPES)) {
        assert.ok(varName.startsWith('RD'), `${varName} 命名不符`);
        assert.ok(legal.has(type as never), `${varName} 映射到了非法枚举值 ${type}`);
    }
});

// ============================================================
// F. 注册表自身
// ============================================================

test('F1 RD_SET_VARS 每条都自洽（不自引用、引用的变量都注册过）', () => {
    const problems: string[] = [];
    for (const [name, script] of Object.entries(RD_SET_VARS)) {
        problems.push(...validateRdAggregation(name, script));
    }
    assert.deepEqual(problems, [], problems.join('\n'));
});

test('F2 服务端型与客户端型没有重名（同一个名字两条注册 = 后者覆盖前者）', () => {
    const serverNames = Object.keys(RD_SERVER_VAR_TYPES);
    const clientNames = Object.keys(RD_CLIENT_VARS);
    const overlap = serverNames.filter((n) => clientNames.includes(n));
    assert.deepEqual(overlap, [], `同时出现在服务端表和客户端表：${overlap.join(', ')}`);
});

test('F3 RD_REGISTERED_VAR_NAMES 覆盖两张表，无重复', () => {
    const expected = [...Object.keys(RD_SERVER_VAR_TYPES), ...Object.keys(RD_CLIENT_VARS)];
    assert.equal(RD_REGISTERED_VAR_NAMES.length, expected.length);
    assert.equal(new Set(RD_REGISTERED_VAR_NAMES).size, RD_REGISTERED_VAR_NAMES.length, '有重名');
    for (const name of expected) {
        assert.ok(RD_REGISTERED_VAR_NAMES.includes(name), `少了 ${name}`);
    }
});

test('F4 每个客户端变量都标了 impl（ready / stub / set），便于统计还有多少没接', () => {
    for (const [name, spec] of Object.entries(RD_CLIENT_VARS)) {
        assert.ok(
            spec.impl === 'ready' || spec.impl === 'stub' || spec.impl === 'set',
            `${name} 的 impl 值非法：${spec.impl}`,
        );
        assert.ok(spec.source.length > 0, `${name} 没写数据来源说明`);
    }
});

test('F5 `impl: set` 的变量必须正好是 RD_SET_VARS 的键（标错 ⇒ 统计「还有多少没接」时把已接的算成桩）', () => {
    const marked = Object.entries(RD_CLIENT_VARS)
        .filter(([, spec]) => spec.impl === 'set')
        .map(([name]) => name)
        .sort();
    assert.deepEqual(marked, Object.keys(RD_SET_VARS).sort());
});

test('F6 RD_EXTRA_VAR_NAMES 与两张主表不重名（同一个名字两处登记 ⇒ 表里说的和注册的会打架）', () => {
    const main = new Set([...Object.keys(RD_SERVER_VAR_TYPES), ...Object.keys(RD_CLIENT_VARS)]);
    const overlap = RD_EXTRA_VAR_NAMES.filter((n) => main.has(n));
    assert.deepEqual(overlap, [], `这些名字同时出现在额外表与主表：${overlap.join(', ')}`);
});

test('F7 RD_ALL_VAR_NAMES = 三张表的并集（去重后），一个都不许漏', () => {
    const union = [
        ...new Set([
            ...RD_REGISTERED_VAR_NAMES,
            ...RD_EXTRA_VAR_NAMES,
            ...Object.keys(RD_SET_VARS),
        ]),
    ].sort();
    assert.deepEqual(
        [...RD_ALL_VAR_NAMES].sort(),
        union,
        '→ 名字能不能出现在表达式里只认 RD_ALL_VAR_NAMES（少一个 = 该变量报「尚未注册」⇒ 红点静默不亮）',
    );
});
