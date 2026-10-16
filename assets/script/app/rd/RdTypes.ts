/**
 * 红点变量名 / 表达式口径的**唯一真源** —— 零 import 纯常量与纯函数（可被 Node 用例直接 import）。
 *
 * ## 这份表是干什么的
 * 老端红点的亮灭不是代码写死的，是**策划在 `open.json` 的 `RDExpr` 列里配表达式**：
 * ```
 * RDExpr = "[RDSevenday]"          本入口自己的红点
 * tlRDResId = [405,406,407]        还要把这三个系统的红点也聚合进来（求和）
 * ```
 * 表达式里的 `[RDXxx]` 是**变量**，每个变量由一个 `ExprVarBase` 子类实现（老端在
 * `client/.../model/expr/ModelExpr.ts` 里一次性 `RegistVarClass` 注册）。
 *
 * 本文件只放「变量名 / 表达式模板 / 变量与服务端红点类型的映射」这些**数据**，
 * 实现全在 `RdVars.ts`，注册在 `RdRegistry.ts`。
 *
 * ## ⚠️ 变量名不许改
 * `open.json`（远端表，策划维护）里已经写死了这 34 个名字。改名字 = 表达式里的变量找不到
 * ⇒ `ExprVarMgr.AddRef` 报「尚未注册该值」并退化成 `close` ⇒ **红点静默不亮**（不报错、界面无感）。
 * 守卫见 `tests/rdExpr.test.ts`：注册集合必须覆盖 `open.json` 里出现的**全部**变量名。
 *
 * ## 两类变量的分界线（决定数据从哪来）
 * - **服务端型**（`RD_SERVER_VAR_TYPES`）：值就是服务端下发的 `CmdRedDotCache.number`，
 *   客户端只管按 `redDotType` 取。**不依赖该玩法在新工程做没做**（服务端照样下发）。
 * - **客户端型**：值由客户端按各模块自己持有的数据算出来（老端 `RD*` 类各写各的）。
 */

// ============================================================
// 表达式
// ============================================================

/**
 * 变量名 → 表达式里的字面量。
 *
 * ⚠️ 表达式引擎（`framework/expr/Expr.ts`）按 `[name]` / `[name:p1,p2,p3]` 识别变量，
 * 且**编译期会把空格全去掉**（`script.replace(/\s/g, "")`）—— 所以生成时不要带空格。
 */
export function rdExpr(varName: string): string {
    return `[${varName}]`;
}

/** 从一段表达式里抽出用到的全部变量名（去重、保序）。与 `Expr.ts` 的 `RegMatchFunc` 同口径。 */
export function parseRdVarNames(script: string | null | undefined): string[] {
    if (!script) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const regex = /\[([\w_:,]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(script)) !== null) {
        // `[time:1,2]` 这种带参数的，参数不是变量名
        const name = match[1].split(/[:,]/)[0];
        if (!name || seen.has(name)) continue;
        seen.add(name);
        out.push(name);
    }
    return out;
}

// ============================================================
// 服务端红点类型 → 变量名
// ============================================================

/**
 * `CmdRedDotType` 的**数值**（不 import `CmdInterface`，让本文件保持零依赖可单测）。
 * 与 `app/generated/netProto/CmdInterface.ts` 的 `enum CmdRedDotType` 逐条对齐，
 * 改动必须同步 —— `tests/rdExpr.test.ts` 会读那个文件做文本对账。
 */
export const RD_SERVER_TYPE = {
    TEST: 1,
    MAIL: 2,
    CONTINUITY_DAYS: 3,
    GEM_COMPOSE: 4,
    SEVEN_DAY: 5,
    LIMIT_TIME_ACTIVITY: 6,
    SIGNIN: 7,
    SPIRIT_ANIMAL_BOX: 8,
    FIRST_RECHARGE: 9,
} as const;

/**
 * 服务端型变量 → `CmdRedDotType`。
 *
 * 口径来源：老端 `model/expr/RD/Server/RD*.ts` 各自 `GetRedDotType()` 的返回值。
 * 这些变量的值 = `CacheMgr.getCmdRedDotCache(type).number`。
 */
export const RD_SERVER_VAR_TYPES: Readonly<Record<string, number>> = {
    RDMail: RD_SERVER_TYPE.MAIL,
    RDContinuityGift: RD_SERVER_TYPE.CONTINUITY_DAYS,
    RDGemCompose: RD_SERVER_TYPE.GEM_COMPOSE,
    RDSevenday: RD_SERVER_TYPE.SEVEN_DAY,
    RDLimitActivity: RD_SERVER_TYPE.LIMIT_TIME_ACTIVITY,
    RDDaySign: RD_SERVER_TYPE.SIGNIN,
    RDFirstRechargeServer: RD_SERVER_TYPE.FIRST_RECHARGE,
};

/**
 * 客户端型变量 → 取数来源（**只用于文档 / 单测对账，不参与运行时判定**）。
 *
 * `source` 写「这个变量在新工程应该读什么」；`impl` 标它是不是真接了：
 * - `'ready'` —— 新工程对应模块已存在，变量读它的 Repository / Table（实现类在 `RdVars.ts`）。
 * - `'stub'`  —— 玩法 / 取数口径在新工程**还没落地**，变量恒返回 0（名字照注册，等补数据源）。
 * - `'set'`   —— **聚合型**：自己不写判定，值 = 别的变量拼出来的表达式。定义在 `RD_SET_VARS`，
 *   注册走 `RdRegistry` 第 ③ 步，**不是**桩。
 */
export interface RdClientVarSpec {
    /** 取数来源说明。 */
    readonly source: string;
    readonly impl: 'ready' | 'stub' | 'set';
}

export const RD_CLIENT_VARS: Readonly<Record<string, RdClientVarSpec>> = {
    // —— 已接：新工程有对应模块（实现类在 RdVars.ts 的 RD_CLIENT_VAR_CLASSES 里，**键名必须一字不差**） ——
    RDActivity: { source: 'LayerActivityTable.taskHasRedDot（活动每日任务）', impl: 'ready' },
    RDActivityEvenyDayTask: {
        source: '同上（老端 [RDActivity] 的聚合子项、判定实体）',
        impl: 'ready',
    },
    RDBattleToken: {
        source:
            'BattleTokenTable.hasClaimableRedDot（战令可领）；' +
            '⚠️ 支持带参 [RDBattleToken:<CmdBattleTokenType>] ⇒ 战令页内每一格各算各的 ' +
            '（老端 LayerBattleToken.refreshRd 逐 tab 的 GetBattleTokenRD(type)），' +
            '无参时 = 老端 RDBattleToken 口径（第一个 VO = 通行证），供 open.json refId=104 用',
        impl: 'ready',
    },
    RDFriend: { source: 'FriendTable.canGetEnd + 申请条数（好友申请 / 可领体力）', impl: 'ready' },
    RDGift: { source: 'RechargeActivityRepository.hasRedDot（充值礼包聚合）', impl: 'ready' },
    RDGiftDaily: { source: '同 RDGift（老端是 RDGiftBase 按 GiftType 扫商店）', impl: 'ready' },
    RDGiftMonth: { source: '同 RDGift（口径同 RDGiftDaily）', impl: 'ready' },
    RDGiftOnce: { source: '同 RDGift（终身礼包页签）', impl: 'ready' },
    RDGiftWeek: { source: '同 RDGift（每周礼包页签）', impl: 'ready' },
    RDLeague: {
        source: 'LeagueRepository.loadLeagueEntryRedDots（砍价 ∪ 任务 ∪ 北伐；老端 RDLeague.OnComputeResult）',
        impl: 'ready',
    },

    // —— 留桩（⚠️ 名字**必须**注册：漏了会让表达式报「尚未注册该值」⇒ 红点静默不亮） ——
    // 下面这三个不是「玩法没做」，而是**取数口径还没定**，理由写在 RdVars.ts 文件头，别两处打架。
    RDChat: {
        source: '留桩：卡在聊天自己的「已读」——markRead() 全仓无调用方 ⇒ readTimeOf() 恒 0 ⇒ 接上去会永久亮（先补已读标记，再接；详见 RdVars.ts 文件头）',
        impl: 'stub',
    },
    RDFirstRecharge: {
        source: '留桩：open.json 用的是服务端型 RDFirstRechargeServer（已接），客户端侧当前没有引用点',
        impl: 'stub',
    },
    RDLimitTime: { source: '留桩：限时礼包页在新工程还没落地', impl: 'stub' },

    // —— 留桩：玩法尚未在新工程落地，返回 0，注册着等补 ——
    RDAdvisor: { source: '军师（未做）', impl: 'stub' },
    RDArmy: { source: '兵种强化（未做）', impl: 'stub' },
    RDChallengeRewards: { source: '秘境-锁妖塔奖励（未做）', impl: 'stub' },
    RDCity: { source: '主城（未做）', impl: 'stub' },
    RDCoinStore: { source: '金币商店（未做）', impl: 'stub' },
    RDDailyShare: { source: '分享（未做）', impl: 'stub' },
    RDEquipLevelUp: { source: '装备升级（未做）', impl: 'stub' },
    RDFightRewards: { source: '章节奖励（未做）', impl: 'stub' },
    RDGemStore: { source: '宝石商店（未做）', impl: 'stub' },
    RDGeneral: { source: '武将（未做）', impl: 'stub' },
    RDGuards: { source: '近卫（未做）', impl: 'stub' },
    RDLeaderSkill: { source: '主公技（未做）', impl: 'stub' },
    RDLiLian: { source: '历练（未做）', impl: 'stub' },
    RDMiltia: { source: '天赋（未做）', impl: 'stub' },
    RDOSRank: { source: '开服冲榜（未做）', impl: 'stub' },
    RDTabWorkShop: { source: '工坊页签（未做）', impl: 'stub' },

    // —— 聚合型：实现不在这里，看 RD_SET_VARS（注册走 RdRegistry 第 ③ 步） ——
    RDTabGem: { source: '聚合 [RDGemHaveBetter]+[RDGemCompose]（见 RD_SET_VARS）', impl: 'set' },
    RDTabSkill: { source: '聚合 [RDSkillLevelUp]+([RDSkillBreak])（见 RD_SET_VARS）', impl: 'set' },
};

/** 注册表里**应该**存在的全部变量名（服务端型 + 客户端型）。 */
export const RD_REGISTERED_VAR_NAMES: readonly string[] = [
    ...Object.keys(RD_SERVER_VAR_TYPES),
    ...Object.keys(RD_CLIENT_VARS),
];

/**
 * 老端额外注册、但 `open.json` 当前没用到的变量（客户端型）。
 *
 * 留着免得上线前策划一配就报未注册 —— 注册集合 (`RD_ALL_VAR_NAMES`) 是「名字能不能出现在
 * 表达式里」的唯一判据。这些名字统统按 `RdStubVar` 注册，值恒 0。
 *
 * ⚠️ `RDActivityEvenyDayTask` **不在**这里：它已经有真实现（见 `RD_CLIENT_VARS`），
 * 放这儿会被当成桩，语义反过来。
 */
export const RD_EXTRA_VAR_NAMES: readonly string[] = [
    'RDGuanKaGift',
    'RDHead',
    'RDPetsStoreAD',
    'RDPetsStoreReward',
    'RDSkillBreak',
    'RDSkillBreakAd',
    'RDSkillLevelUp',
    'RDWorkShopAd',
    'RDWorkShopBuild',
    'RDWorkShopRewards',
    'RDActivityMonthCard',
    'RDActivityPayGift',
    'RDActivityPayGift2',
    'RDGemHaveBetter',
    'RDGemNew',
    'RDDailyShareDayTips',
    'RDDailyShareRewards',
];

// ============================================================
// 聚合型变量（老端 RDClientSet）
// ============================================================

/**
 * 聚合型变量的复合表达式。
 *
 * 老端 `RDClientSet` 的子类**不直接算值**，而是把自己定义成「别的变量的组合」，
 * 例如角色宝石页签：
 * ```
 * RDTabGem.GetScript() = "[RDGemHaveBetter]+([RDGemCompose])"
 * ```
 * 这样页签红点自动等于两个子红点之和，子红点各自变脏时会顺着表达式传播上来。
 *
 * ⚠️ **不许自引用**（`RDTabGem` 的定义里出现 `[RDTabGem]`）：`OnEnter` 会把本表达式
 * 注册成监听自己的回调 ⇒ 自己触发自己 ⇒ `ExprMgr.Update()` 里每帧反复标脏。
 * 守卫见 `validateRdAggregation()` 与 `tests/rdExpr.test.ts`。
 */
export const RD_SET_VARS: Readonly<Record<string, string>> = {
    // 老端 RDTabGem / RDTabSkill 是「页签 = 子项求和」。这两个子变量在新工程还没落地，
    // 先把结构放这儿，等宝石 / 技能系统做了直接生效（现在求值恒 0）。
    RDTabGem: '[RDGemHaveBetter]+([RDGemCompose])',
    RDTabSkill: '[RDSkillLevelUp]+([RDSkillBreak])',
};

/**
 * **运行时会有类的**全部变量名 = 注册表全集（三张表的并集，**去重**）。
 *
 * `RdRegistry` 就是按这个集合逐个 `RegistVarClass`：
 * ①②③ 是真实现，④⑤ 补 `RdStubVar` 桩。所以「某个名字能不能出现在表达式里」
 * 只认这一份 —— 别用 `RD_REGISTERED_VAR_NAMES`（那只是
 * `RD_SERVER_VAR_TYPES` + `RD_CLIENT_VARS`，**不含** `RD_EXTRA_VAR_NAMES` / `RD_SET_VARS`，会漏）。
 *
 * 为什么要去重：聚合型（`RDTabGem` / `RDTabSkill`）**登记**在 `RD_CLIENT_VARS`（标 `impl: 'set'`，
 * 好让「还有多少没接」的统计里不把它们当成桩），而**定义**在 `RD_SET_VARS` ⇒ 两张表都有这个名字。
 * `RdRegistry` 第 ③ 步先注册、④⑤ 靠 `done.includes` 跳过，所以去重只是把同一件事写明。
 */
export const RD_ALL_VAR_NAMES: readonly string[] = [
    ...new Set([
        ...RD_REGISTERED_VAR_NAMES,
        ...RD_EXTRA_VAR_NAMES,
        ...Object.keys(RD_SET_VARS),
    ]),
];

/**
 * 校验一个聚合表达式是否合法：只能引用**别的**变量名，且引用的名字都得注册过。
 *
 * @returns 错误列表；空数组 = 通过。
 */
export function validateRdAggregation(
    varName: string,
    script: string | null | undefined,
    registered: readonly string[] = RD_ALL_VAR_NAMES,
): string[] {
    const errors: string[] = [];
    if (!script) return errors;
    const known = new Set(registered);
    for (const used of parseRdVarNames(script)) {
        if (used === varName) {
            errors.push(`聚合表达式自引用：${varName} => ${script}`);
        } else if (!known.has(used)) {
            errors.push(`聚合表达式引用了未注册的变量：${varName} => [${used}]`);
        }
    }
    return errors;
}

// ============================================================
// 计数归一化
// ============================================================

/**
 * 把服务端 / 各模块来的计数收敛成非负整数。
 *
 * 对齐 `RedDotState.normalizeRedDotCount`，但**不接布尔**：这里的入参来自 protobuf / 表，
 * 只会是 number / Long / string。Long 走 `toNumber` / `low+high`（规则 23：uint64 是 Long）。
 */
export function normalizeRdCount(value: unknown): number {
    if (value === null || value === undefined) return 0;
    let num: number;
    if (typeof value === 'number') {
        num = value;
    } else if (typeof value === 'boolean') {
        num = value ? 1 : 0;
    } else if (typeof value === 'string') {
        num = Number(value);
    } else if (typeof value === 'object') {
        const long = value as { toNumber?: () => number; low?: number; high?: number };
        if (typeof long.toNumber === 'function') {
            num = long.toNumber();
        } else if (typeof long.low === 'number' && typeof long.high === 'number') {
            num = long.high * 4294967296 + (long.low >>> 0);
        } else {
            return 0;
        }
    } else {
        return 0;
    }
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.floor(num));
}
