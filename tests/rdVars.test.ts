/**
 * 红点**客户端变量**的回归网 —— `RdJudgements`（判定胶水） + `RdVars`（实现类注册表）的防线。
 *
 * 为什么单独一个文件、而不是并进 `rdExpr.test.ts`：那边守的是**表达式引擎**这一层
 * （变量名注册齐没齐、聚合算得对不对）；这边守的是**变量算出来的值**。
 * 两层都会「静默不亮红点」，但失效原因完全不同，分开才能一眼定位。
 *
 * 分三段：
 *   A. `battleTokenRedDot` —— 战令入口「有没有可领」。
 *   B. `friendRedDot` —— 好友入口「有申请 or 体力可领」。
 *   C. ⭐ **源码对账** —— `RdVars.ts` 的注册表键 ←→ `RdTypes.RD_CLIENT_VARS` 的 `impl: 'ready'`。
 *      这条是「文档说接了、代码没接」（或反过来）唯一能在跑起来之前逮住它的手段：
 *      键名写错 ⇒ `RegistVarClass` 照样成功（不校验）⇒ 运行时 `new undefined()` 抛异常被
 *      `catch` 掉 ⇒ **红点静默不亮、界面无感**（见 `RdRegistry` 文件头）。
 *
 * ⚠️ 本文件**不能** import `RdVars.ts` 本身（它 import 各模块 Repository，链上有 `cc`），
 * 所以 C 段走**源码文本**解析 —— 与 `battletoken.test.ts` D 段同一手法。
 *
 * 口径真源：
 *   - 判定：`BattleTokenTable.hasClaimableRedDot` / `FriendTable.canGetEnd`（各有自己的单测）
 *   - 老端：`client/.../model/expr/RD/Client/RDBattleToken.ts` / `RDFriend.ts`
 *   - 入口：`assets/remoteRef/open.json`（战令 `refId=104`，好友 `refId=206`）
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    BT_DEFAULT_TYPE,
    BT_TABS,
    BT_TYPE_END,
    BT_TYPE_LEVEL_FUND,
    BT_TYPE_PASS,
    BT_TYPE_SIGN_IN,
    battleTokenRdType,
    battleTokenTabRdExpr,
    type IPlanRow,
    type IRewardRow,
} from '../assets/script/app/battletoken/BattleTokenTable';
import type { IFriendRow } from '../assets/script/app/friend/FriendTable';
import {
    battleTokenRedDot,
    friendRedDot,
    leagueRedDot,
    type ILeagueRedDotLike,
    type IRdPlanStateLike,
    type IRdTokenStateLike,
} from '../assets/script/app/rd/RdJudgements';
import { parseRdVarNames, RD_CLIENT_VARS } from '../assets/script/app/rd/RdTypes';

// ============================================================
// 夹具
// ============================================================

/** 一个方案行（只填判据用得到的四项，其余给中性值）。 */
function plan(resId: number, order: number, rewardPlan: number, type = BT_DEFAULT_TYPE): IPlanRow {
    return { resId, type, order, rmb: 0, openCostItemResId: 0, openCostItemNum: 0, rewardPlan };
}

/** 某方案某级的奖励行。 */
function reward(planNo: number, level: number): IRewardRow {
    return { plan: planNo, level, resId: 1000 + level, number: 1 };
}

/** `levels` 级奖励（`plan` 号从 `planNo` 开始）。 */
function rewards(planNo: number, levels: number): IRewardRow[] {
    const out: IRewardRow[] = [];
    for (let lv = 1; lv <= levels; lv++) out.push(reward(planNo, lv));
    return out;
}

/** 一个档位状态。 */
function planState(open: boolean, takenLevels: readonly number[] | null): IRdPlanStateLike {
    return { open, takenLevels };
}

/** 一个类型的状态（`planStates` 用 `Map` —— 与快照同形）。 */
function tokenState(level: number, planStates: [number, IRdPlanStateLike][]): IRdTokenStateLike {
    return { level, planStates: new Map(planStates) };
}

/** 好友一行（只填判据用得到的两个开关）。 */
function friend(id: string, todayReceive: boolean, todayTake: boolean): IFriendRow {
    return {
        id,
        name: `f${id}`,
        level: 1,
        power: '0',
        avatarId: '',
        online: false,
        lastOfflineMs: 0,
        todaySend: false,
        todayReceive,
        todayTake,
    };
}

/**
 * 「通行证」默认页的三方案基准表（与 `battleTokenPlan` 同构：order 1/2/3 → rewardPlan 1/2/3）。
 *
 * 每个方案各 3 级奖励 ⇒ `maxLevel = 3` 时分级行有 3 行（index 0/1/2）。
 */
const PLANS = [plan(11, 1, 1), plan(12, 2, 2), plan(13, 3, 3)];
const REWARDS = [...rewards(1, 3), ...rewards(2, 3), ...rewards(3, 3)];

// ============================================================
// A. 战令
// ============================================================

test('A1 空 / 缺数据一律不亮，且不抛', () => {
    const states = new Map<number, IRdTokenStateLike>([[BT_DEFAULT_TYPE, tokenState(3, [])]]);
    assert.equal(battleTokenRedDot(null), false);
    assert.equal(battleTokenRedDot(undefined), false);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states: null, maxLevel: 3 }), false);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }), false, '该类型没有状态');
    assert.equal(
        battleTokenRedDot({
            plans: PLANS,
            rewards: REWARDS,
            states: new Map([[BT_TYPE_SIGN_IN, tokenState(9, [])]]),
            maxLevel: 3,
        }),
        false,
        '只有七日登录的状态 —— 战令入口看的是默认页（通行证）',
    );
});

test('A2 缺方案 / 缺奖励表 / maxLevel 为 0 ⇒ 分级行空，不亮', () => {
    const states = new Map<number, IRdTokenStateLike>([[BT_DEFAULT_TYPE, tokenState(3, [[11, planState(true, [])]])]]);
    assert.equal(battleTokenRedDot({ plans: null, rewards: REWARDS, states, maxLevel: 3 }), false);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: null, states, maxLevel: 3 }), false);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 0 }), false, 'maxLevel 0 ⇒ 没有可领的级');
});

test('A3 ⭐ 等级已到、档位已开、该级还没领 ⇒ 亮', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(2, [[11, planState(true, [1])], [12, planState(false, null)], [13, planState(false, null)]])],
    ]);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }), true);
});

test('A4 该级已领 ⇒ 不亮', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(2, [[11, planState(true, [1, 2])], [12, planState(false, null)], [13, planState(false, null)]])],
    ]);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }), false);
});

test('A5 档位没开 ⇒ 不亮（哪怕等级早就到了）', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(50, [[11, planState(false, [1])], [12, planState(false, null)], [13, planState(false, null)]])],
    ]);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }), false);
});

test('A6 等级一级都没到 ⇒ 不亮', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(0, [[11, planState(true, [])], [12, planState(true, [])], [13, planState(true, [])]])],
    ]);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }), false);
});

test('A7 ⚠️ tlTakeLevel 字段缺失（null）⇒ 不算红点（照抄老端：有字段才判定）', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(3, [[11, planState(true, null)], [12, planState(true, null)], [13, planState(true, null)]])],
    ]);
    assert.equal(
        battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states, maxLevel: 3 }),
        false,
        'null 是「服务端没下发这个字段」，不是「一级都没领」—— 后者是 []',
    );
});

test('A8 ⭐ 方案必须按 type 过滤（把别的页签的方案也算进来会凭空多出红点）', () => {
    // 七日登录那页：档位已开、`tlTakeLevel` 是 `[]`（字段在、一级没领）⇒ 若被算进来必然判「可领」
    const otherType = plan(21, 1, 21, BT_TYPE_SIGN_IN);
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(2, [[11, planState(true, [1, 2])], [12, planState(false, null)], [13, planState(false, null)]])],
        [BT_TYPE_SIGN_IN, tokenState(9, [[21, planState(true, [])]])],
    ]);
    assert.equal(
        battleTokenRedDot({
            plans: [...PLANS, otherType],
            rewards: [...REWARDS, ...rewards(21, 3)],
            states,
            maxLevel: 3,
        }),
        false,
        '通行证三个档位全领完 ⇒ 不亮；误把七日登录的方案算进来才会亮',
    );
});

test('A9 方案在外层未按 order 排序也不影响（内部统一走 plansOfType）', () => {
    const shuffled = [PLANS[2], PLANS[0], PLANS[1]];
    const mkStates = (): Map<number, IRdTokenStateLike> =>
        new Map([
            [BT_DEFAULT_TYPE, tokenState(2, [[11, planState(true, [1])], [12, planState(false, null)], [13, planState(false, null)]])],
        ]);
    assert.equal(battleTokenRedDot({ plans: shuffled, rewards: REWARDS, states: mkStates(), maxLevel: 3 }), true);
    assert.equal(battleTokenRedDot({ plans: PLANS, rewards: REWARDS, states: mkStates(), maxLevel: 3 }), true);
});

// ------------------------------------------------------------
// A10+ 页内**逐页签**细分（`[RDBattleToken:<type>]`）
//
// 老端 `LayerBattleToken.refreshRd()` 是逐 tab 调 `GetBattleTokenRD(type)`；本端把
// 「type」搬进表达式的**参数**（`ExprVarMgr` 按「名字+参数」分实例）⇒ 上面这批用例
// 钉的就是「四格各算各的，不是共用默认页」。
// ------------------------------------------------------------

test('A10 ⭐ per-tab：同一份快照上四个页签各判各的（一个亮三个不亮）', () => {
    // 每个 type 各一个档位、各 3 级奖励
    const plans = [
        plan(11, 1, 1, BT_TYPE_END),
        plan(21, 1, 21, BT_TYPE_SIGN_IN),
        plan(31, 1, 31, BT_TYPE_LEVEL_FUND),
        plan(41, 1, 41, BT_TYPE_PASS),
    ];
    const rewardRows = [...rewards(1, 3), ...rewards(21, 3), ...rewards(31, 3), ...rewards(41, 3)];
    const states = new Map<number, IRdTokenStateLike>([
        // 通行证：等级到 3、档位已开，但 1/2/3 全领完 ⇒ 不亮
        [BT_TYPE_END, tokenState(3, [[11, planState(true, [1, 2, 3])]])],
        // 七日登录：等级 1、档位已开、`tlTakeLevel` 是 `[]`（字段在、一级没领）⇒ 亮
        [BT_TYPE_SIGN_IN, tokenState(1, [[21, planState(true, [])]])],
        // 等级基金：等级早到了，但档位**没开** ⇒ 不亮
        [BT_TYPE_LEVEL_FUND, tokenState(9, [[31, planState(false, [])]])],
        // 过关令：档位已开、一级没领，但等级 0 ⇒ 不亮
        [BT_TYPE_PASS, tokenState(0, [[41, planState(true, [])]])],
    ]);
    const input = { plans, rewards: rewardRows, states, maxLevel: 3 };

    assert.equal(battleTokenRedDot(input, BT_TYPE_END), false, '通行证：都领完了');
    assert.equal(battleTokenRedDot(input, BT_TYPE_SIGN_IN), true, '七日登录：有可领');
    assert.equal(battleTokenRedDot(input, BT_TYPE_LEVEL_FUND), false, '等级基金：档位没开');
    assert.equal(battleTokenRedDot(input, BT_TYPE_PASS), false, '过关令：等级没到');
});

test('A11 ⭐ 每个页签只认自己 type 的方案（串页 = 凭空多红点）', () => {
    // 只有七日登录那页有「档位已开 + tlTakeLevel=[]」⇒ 若四格共用一份方案池，四格会一起亮
    const plans = [plan(11, 1, 1, BT_TYPE_END), plan(21, 1, 21, BT_TYPE_SIGN_IN)];
    const rewardRows = [...rewards(1, 3), ...rewards(21, 3)];
    const states = new Map<number, IRdTokenStateLike>([
        [BT_TYPE_END, tokenState(3, [[11, planState(true, [1, 2, 3])]])],
        [BT_TYPE_SIGN_IN, tokenState(1, [[21, planState(true, [])]])],
    ]);
    const input = { plans, rewards: rewardRows, states, maxLevel: 3 };

    assert.equal(battleTokenRedDot(input, BT_TYPE_END), false);
    assert.equal(battleTokenRedDot(input, BT_TYPE_SIGN_IN), true);
    assert.equal(battleTokenRedDot(input, BT_TYPE_PASS), false, '该 type 连方案都没有 ⇒ 不亮');
});

test('A12 ⭐ 不传 type 与显式传 BT_DEFAULT_TYPE 完全等价（open.json refId=104 的口径不许变）', () => {
    const states = new Map<number, IRdTokenStateLike>([
        [BT_DEFAULT_TYPE, tokenState(2, [[11, planState(true, [1])], [12, planState(false, null)], [13, planState(false, null)]])],
        [BT_TYPE_SIGN_IN, tokenState(1, [[21, planState(true, [])]])],
    ]);
    const input = {
        plans: [...PLANS, plan(21, 1, 21, BT_TYPE_SIGN_IN)],
        rewards: [...REWARDS, ...rewards(21, 3)],
        states,
        maxLevel: 3,
    };
    assert.equal(battleTokenRedDot(input), battleTokenRedDot(input, BT_DEFAULT_TYPE));
    assert.equal(battleTokenRedDot(input), true, '默认页有可领');
    // 反证「type 真被用上」：同一份快照按默认页不亮时，换默认页内容就变 ⇒ 说明不是被忽略
    const onlySignIn = new Map<number, IRdTokenStateLike>([[BT_TYPE_SIGN_IN, tokenState(1, [[21, planState(true, [])]])]]);
    assert.equal(battleTokenRedDot({ ...input, states: onlySignIn }, BT_DEFAULT_TYPE), false);
    assert.equal(battleTokenRedDot({ ...input, states: onlySignIn }, BT_TYPE_SIGN_IN), true);
});

test('A13 `battleTokenRdType`：数字 / 字符串都吃，非法值一律回落默认页（不抛）', () => {
    assert.equal(battleTokenRdType(2), BT_TYPE_SIGN_IN);
    assert.equal(battleTokenRdType('3'), BT_TYPE_LEVEL_FUND);
    assert.equal(battleTokenRdType(' 4 '), BT_TYPE_PASS, '`Number(" 4 ")` 会 trim —— 表达式里带空格也认');
    assert.equal(battleTokenRdType(2.7), 2, '向下取整，不产生 2.7 这种 type');

    for (const bad of [undefined, null, '', 'abc', 0, -1, NaN, {}, [], true, false]) {
        assert.equal(battleTokenRdType(bad), BT_DEFAULT_TYPE, `非法参数 ${JSON.stringify(bad)} 应回落默认页`);
    }
});

test('A14 ⭐ `battleTokenTabRdExpr` 生成的表达式：变量名仍是 RDBattleToken（注册守卫不误报）', () => {
    const exprs = BT_TABS.map((tab) => battleTokenTabRdExpr(tab.type));
    assert.deepEqual(
        exprs,
        ['[RDBattleToken:3]', '[RDBattleToken:2]', '[RDBattleToken:1]', '[RDBattleToken:4]'],
        '顺序必须与 BT_TABS 声明序一致（等级基金/七日登录/通行证/过关令）',
    );
    for (const expr of exprs) {
        assert.deepEqual(
            parseRdVarNames(expr),
            ['RDBattleToken'],
            `${expr} 抽出来的变量名必须是已注册的 RDBattleToken（否则注册守卫会误报「未注册变量」）`,
        );
    }
    // 参数能原样回到 type 上（与 `RdVars.RDBattleTokenVar` 读 `GetP1()` 同口径）
    const roundTrip = exprs.map((expr) => battleTokenRdType(expr.replace(/^\[RDBattleToken:|]$/g, '')));
    assert.deepEqual(roundTrip, BT_TABS.map((tab) => tab.type));
});

// ============================================================
// B. 好友
// ============================================================

test('B1 有好友申请 ⇒ 亮（不管体力可不可领）', () => {
    assert.equal(friendRedDot(1, [], 0), true);
    assert.equal(friendRedDot(3, null, 0), true);
});

test('B2 没申请但「领取体力」可点 ⇒ 亮', () => {
    const rows = [friend('1', true, false)];
    assert.equal(friendRedDot(0, rows, 3), true);
});

test('B3 收到的都领完了 ⇒ 不亮', () => {
    const rows = [friend('1', true, true)];
    assert.equal(friendRedDot(0, rows, 3), false);
});

test('B4 今日次数已用完 ⇒ 不亮（哪怕还有没领的）', () => {
    assert.equal(friendRedDot(0, [friend('1', true, false)], 0), false);
});

test('B5 没收到体力的好友不参与判定 ⇒ 不亮', () => {
    assert.equal(friendRedDot(0, [friend('1', false, false)], 3), false);
    assert.equal(friendRedDot(0, null, 3), false);
    assert.equal(friendRedDot(0, [], 3), false);
});

test('B6 一次领过、另一次还有 ⇒ 亮（判据是「还有人没领」而不是「一个都没领」）', () => {
    const rows = [friend('1', true, true), friend('2', true, false)];
    assert.equal(friendRedDot(0, rows, 3), true);
});

// ============================================================
// D. `leagueRedDot` —— 联盟入口红点（`open.json` refId 14 的 `[RDLeague]`）
// ============================================================

/** 三条判据的入参（默认全 `false`）。 */
function leagueDots(patch: Partial<ILeagueRedDotLike> = {}): ILeagueRedDotLike {
    return { discount: false, task: false, north: false, ...patch };
}

test('D1 ⭐ 三条判据任一为真就亮（老端 RDLeague 是「或」链）', () => {
    assert.equal(leagueRedDot(leagueDots({ discount: true })), true);
    assert.equal(leagueRedDot(leagueDots({ task: true })), true);
    assert.equal(leagueRedDot(leagueDots({ north: true })), true);
});

test('D2 三条全假 ⇒ 不亮（未入盟 / 可领的都领完了）', () => {
    assert.equal(leagueRedDot(leagueDots()), false);
});

test('D3 空 / 缺数据一律不亮，且不抛', () => {
    assert.equal(leagueRedDot(null), false);
    assert.equal(leagueRedDot(undefined), false);
    assert.equal(leagueRedDot({}), false);
});

test('D4 ⚠️ 只认 `true`：真值不是 `true`（1 / 字符串 / 对象）一律不算亮', () => {
    // 与战令 / 好友两条判据同口径 —— 上游给的就该是 boolean，类型串了应「不亮」而不是「乱亮」
    assert.equal(leagueRedDot({ discount: 1 as unknown as boolean }), false);
    assert.equal(leagueRedDot({ task: 'yes' as unknown as boolean }), false);
    assert.equal(leagueRedDot({ north: {} as unknown as boolean }), false);
});

test('D5 ⚠️ 老端的「捐献」判据本端**有意不接**（广告链路未迁）—— 多塞进来也不该点亮', () => {
    // `ILeagueRedDotLike` 里没有 `donate`；上游真塞一个也不参与判定。
    // 这条同时是「将来补广告时别忘了在 `leagueRedDot` 里加一条」的提醒位。
    assert.equal(leagueRedDot({ donate: true } as unknown as ILeagueRedDotLike), false);
});

// ============================================================
// C. RdVars.ts ←→ RdTypes.RD_CLIENT_VARS 源码对账
// ============================================================

const RD_VARS_SRC = readFileSync('assets/script/app/rd/RdVars.ts', 'utf8');

/**
 * 从 `RdVars.ts` 源码里抠出 `RD_CLIENT_VAR_CLASSES` 的键。
 *
 * 不做 AST：对象字面量里每行只有「`名字,`」或「`名字: 类,`」两种形态（见文件尾），
 * 剥掉行内注释后按行解析；出现解析不了的行就**直接失败**（别静默少收一个名字）。
 */
function readClientVarClassKeys(source: string): string[] {
    const anchor = source.indexOf('export const RD_CLIENT_VAR_CLASSES');
    assert.ok(anchor > 0, 'RdVars.ts 里找不到 RD_CLIENT_VAR_CLASSES');
    const open = source.indexOf('{', anchor);
    const close = source.indexOf('\n};', open);
    assert.ok(open > anchor && close > open, 'RD_CLIENT_VAR_CLASSES 的对象字面量边界没找到');

    const keys: string[] = [];
    for (const rawLine of source.slice(open + 1, close).split('\n')) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        const match = /^([A-Za-z_$][\w$]*)\s*(?::[^,]*)?,?$/.exec(line);
        // 解析不了就**当场炸**：静默少收一个名字 = 守卫失效（注册表缺项却全绿）
        if (!match) throw new Error(`RD_CLIENT_VAR_CLASSES 里有解析不了的行：${rawLine.trim()}`);
        keys.push(match[1]);
    }
    return keys.sort();
}

test('C1 ⭐ 注册表键 == RD_CLIENT_VARS 里标 ready 的名字（键名写错 = 该变量静默不亮）', () => {
    const impl = readClientVarClassKeys(RD_VARS_SRC);
    const ready = Object.entries(RD_CLIENT_VARS)
        .filter(([, spec]) => spec.impl === 'ready')
        .map(([name]) => name)
        .sort();
    assert.deepEqual(
        impl,
        ready,
        '两边对不上：\n' +
            `  只有实现类：${impl.filter((n) => !ready.includes(n)).join(', ') || '（无）'}\n` +
            `  只有 ready 标注：${ready.filter((n) => !impl.includes(n)).join(', ') || '（无）'}\n` +
            '→ 改了 impl 就要同步 RdVars.ts 的 RD_CLIENT_VAR_CLASSES（反之亦然）',
    );
});

test('C2 ⭐ 每个键名都得在 RdVars.ts 里真有 `class <键名>`（注册不校验类是否存在）', () => {
    const missing: string[] = [];
    for (const key of readClientVarClassKeys(RD_VARS_SRC)) {
        if (!new RegExp(`\\bclass\\s+${key}\\b`).test(RD_VARS_SRC)) missing.push(key);
    }
    assert.deepEqual(
        missing,
        [],
        `RD_CLIENT_VAR_CLASSES 里这些键在 RdVars.ts 里找不到同名 class：${missing.join(', ')}\n` +
            '→ 变量名对不上类名，注册照样「成功」，运行时才抛异常被吞 ⇒ 红点静默不亮',
    );
});

test('C3 每个实现类的 `static __cname` 必须等于它的键（复制粘贴最容易漏改这一行）', () => {
    const wrong: string[] = [];
    for (const key of readClientVarClassKeys(RD_VARS_SRC)) {
        const expect = `static __cname: string = '${key}'`;
        if (!RD_VARS_SRC.includes(expect)) wrong.push(key);
    }
    assert.deepEqual(wrong, [], `这些类的 __cname 与键名对不上：${wrong.join(', ')}`);
});

test('C4 判据不许写回 RdVars.ts（那里的 import 链带 `cc`，判定会脱离本文件的回归网）', () => {
    // 只扫**代码行**（本文件的注释里会正常提到这些名字，扫注释太脆）
    const codeOnly = RD_VARS_SRC.split('\n')
        .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');

    // 允许：只调 `RdJudgements` 的两个组装函数。
    // 禁止：直接出现底层判据函数名 / 字段名 —— 那是「把判定重写了一遍」的信号。
    const forbidden = [
        'hasClaimableRedDot',
        'canGetEnd',
        'todayReceive',
        'todayTake',
        'takenLevels',
        'cmdOpenFlags',
    ];
    const found = forbidden.filter((token) => codeOnly.includes(token));
    assert.deepEqual(found, [], `RdVars.ts 的代码里出现了判据符号：${found.join(', ')} → 判定应留在 RdJudgements.ts`);
    assert.ok(
        codeOnly.includes("from './RdJudgements'"),
        'RdVars.ts 没 import RdJudgements —— 判定可能又被写回本文件了',
    );
});

/**
 * C5 —— 页内四格的那条「隐式」依赖：`RDBattleTokenVar` 得把表达式参数喂进判定。
 *
 * 为什么单测逮不住：A10 直接调 `battleTokenRedDot(input, type)`，天然是对的；
 * 而**接线**在 `RdVars` 里（读 `GetP1()` → 传给判定）。接线漏了的表现是
 * **页内四格全按默认页（通行证）算** —— 四格一起亮或一起灭，不报错、不崩。
 * 这类「判据对了但没接上」只能靠源码对账。
 */
test('C5 ⭐ `RDBattleTokenVar` 必须把表达式参数喂进判定（漏了 = 四格一起亮，静默）', () => {
    const anchor = RD_VARS_SRC.indexOf('class RDBattleTokenVar');
    assert.ok(anchor > 0, 'RdVars.ts 里找不到 RDBattleTokenVar');
    const end = RD_VARS_SRC.indexOf('\n}', anchor);
    assert.ok(end > anchor, 'RDBattleTokenVar 的类体边界没找到');
    const body = RD_VARS_SRC.slice(anchor, end);

    assert.ok(body.includes('GetP1()'), 'RDBattleTokenVar 没读表达式参数 ⇒ 页内四格会全按默认页算');
    assert.ok(body.includes('battleTokenRdType('), '参数解析必须走 battleTokenRdType（非法值回落默认页、不抛）');
    assert.ok(
        /battleTokenRedDot\(\s*\{[\s\S]*?\},\s*type,?\s*\)/.test(body),
        '`battleTokenRedDot(...)` 少了 `type` 实参 ⇒ 参数读了却没用上',
    );
});
