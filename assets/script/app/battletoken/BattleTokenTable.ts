/**
 * 战令（`LayerBattleToken`）的**判定口径**——零 import 纯函数，单测直接跑。
 *
 * 真源：老端 `client/assets/script/app/game/ctrl/main/battleToken/` +
 *      FGUI「超值战令」包 + 新工程 `assets/remoteRef/battleToken{Config,Plan,Reward}.json`。
 *
 * ## 两套页签编号 —— 这是本模块最容易错的地方
 *
 * FGUI 里**两个** `标签` 系控制器，编号口径**不同**：
 *
 * | 控制器 | 所在 | 编号口径 | 用途 |
 * |---|---|---|---|
 * | `标签页` | `组件_战令.xml`（底栏外壳） | **page id**（`pages="2,通行证,3,七日签到,1,等级基金,0,过关令"`） | 按钮 `Button controller="标签页" page="N"` |
 * | `标签` | `组件_超值战令.xml`（内容页） | **声明序 index**（`pages="1,通行证,3,七日登录,2,等级基金,0,过关令,5,抽奖"`） | 代码 `setSelectedIndex("标签", tabPageIndex)` |
 *
 * 而 `CmdBattleTokenType` 的数值 1~4 恰好等于**内容页的 index+1**（`tabPageIndex = type - 1`），
 * 却**不等于**底栏的 page id。照抄老端 `LayerBattleToken.InitTab()` 里逐个按钮写死的 `setSelectedPage`,
 * 别想着用一套公式统一。
 *
 * ## 底栏左右顺序 ≠ 类型号顺序
 *
 * FGUI 按钮的 `xy` 从左到右是 `240 等级基金 / 360 七日签到 / 480 通行证 / 600 过关令`
 * ⇒ 屏幕顺序是 **3, 2, 1, 4**，而 `_children` 渲染序是另外一回事（返回 → 过关令 → 通行证 → 七日签到 → 等级基金）。
 * 默认页 = 通行证（`按钮_通行证` 带 `checked="true"`，老端 `switchDefaultTab()` 的第一个 addTab 也是它）。
 */

// ============================================================
// 类型号（= `CmdBattleTokenType`，新工程 `Cmd.d.ts:4960`）
// ============================================================

/** 通行证（有 3 个购买方案，是唯一 `isThree` 的类型）。 */
export const BT_TYPE_END = 1;
/** 七日登录（奖励表只有 7 级）。 */
export const BT_TYPE_SIGN_IN = 2;
/** 等级基金。 */
export const BT_TYPE_LEVEL_FUND = 3;
/** 过关令（方案 2 用**道具**支付：680 金币）。 */
export const BT_TYPE_PASS = 4;
/** 转盘战令 1（本轮不做页签，老端走独立 `LayerBattleTokenSpin`）。 */
export const BT_TYPE_LOTTERY1 = 5;
/** 转盘战令 2。 */
export const BT_TYPE_LOTTERY2 = 6;

/**
 * 底栏 4 个页签，**顺序 = FGUI 屏幕从左到右**（240 / 360 / 480 / 600）。
 *
 * ⚠️ `childrenIndex` 是 FGUI `displayList` 里的**渲染序**（返回排第 0），
 * 与 `xy` 顺序不同 —— 移植时两样都要对。
 */
export const BT_TABS: readonly IBTabDef[] = [
    { type: BT_TYPE_LEVEL_FUND, label: '等级基金', artKey: 'djjj', x: 240 },
    { type: BT_TYPE_SIGN_IN, label: '七日登录', artKey: 'qrdl', x: 360 },
    { type: BT_TYPE_END, label: '通行证', artKey: 'txz', x: 480 },
    { type: BT_TYPE_PASS, label: '过关令', artKey: 'ggl', x: 600 },
];

/** 默认打开的页签（= 通行证）。 */
export const BT_DEFAULT_TYPE = BT_TYPE_END;

/** 本轮支持的页签（转盘 5/6 不做）。 */
export const BT_SUPPORTED_TYPES: readonly number[] = BT_TABS.map((t) => t.type);

/** 购买方案序号（= `battleTokenPlan.order`）。 */
export const BT_PLAN_FREE = 1;
/** 方案 2（基础 / 高级）。 */
export const BT_PLAN_NORMAL = 2;
/** 方案 3（只有通行证有）。 */
export const BT_PLAN_ADVANCED = 3;

/** `battleTokenConfig` 的三个 key（值来自 `assets/remoteRef/battleTokenConfig.json`）。 */
export const BT_CFG_MAX_LEVEL = 'maxLevel';
export const BT_CFG_LEVEL_UP_COST = 'levelUpCostEnd';
export const BT_CFG_RESET_COST = 'resetNeedCostEnd';

/** 满级时进度条的 `max`（老端 `VOBattleToken.GetExpMax()` 写死 1000）。 */
export const BT_MAX_LEVEL_EXP = 1000;

/**
 * 「已消耗：」旁边那个小图标用的资源 id（FGUI `costIcon`，42×42，`gearDisplay pages="1"`）。
 *
 * 老端 `TabBattleTokenPage` 第 128 行写死：`GetGoodsIconKeyByRefId(roleProperty.end)`
 * ⇒ `roleProperty.end = 9`（体力）。这一支是 `roleProperty`（FGUI 裸名）不是 `item`（路径），
 * 装配路径落 `icons/resource/图标_体力`。
 *
 * ⚠️ 这个 resId **不在任何 `row.resIds` 里**（它不属于奖励，是页头的固定小件）⇒ 必须
 * **显式进预加载集合**，否则帧取不到、`_setFrame` 静默跳过 ⇒ 消耗图标永久留白（不报错、单测测不出）。
 */
export const BT_EXP_COST_RES_ID = 9;

/** 老端 `VOBattleToken.IsMaxLevel()` 的兜底等级上限（配置读不到时）。 */
export const BT_FALLBACK_MAX_LEVEL = 50;

// ============================================================
// 接口
// ============================================================

/** 底栏一个页签。 */
export interface IBTabDef {
    /** `CmdBattleTokenType` 数值。 */
    readonly type: number;
    /**
     * 按钮上的文案。
     *
     * ⚠️ 七日登录那页 FGUI **两处写法不一致**：底栏 controller `标签页` 的页面名是「七日签到」，
     * 而**真正可见**的两处（底栏按钮的图标 `类型,21` + 内容页 controller `标签`）都是「七日登录」，
     * 效果图也是「七日登录」⇒ 统一取「七日登录」（详见 `BattleTokenTexts.BT_TEXTS.tabSignIn`）。
     */
    readonly label: string;
    /** 该页页头三张图的前缀（`bt_<artKey>_title` / `_headbg` / `_hero`）。 */
    readonly artKey: string;
    /** FGUI 底栏按钮的 `xy.x`（画布左边缘）。 */
    readonly x: number;
}

/** `battleTokenPlan` 一行。 */
export interface IPlanRow {
    readonly resId: number;
    readonly type: number;
    /** 方案序号 1/2/3。 */
    readonly order: number;
    /** 人民币档位（`payChannel.id`）；0 = 不花钱。 */
    readonly rmb: number;
    /** 道具支付时的道具 resId（`rmb === 0` 且本值 > 0 时走道具）。 */
    readonly openCostItemResId: number;
    readonly openCostItemNum: number;
    /** 关联的 `battleTokenReward.plan`。 */
    readonly rewardPlan: number;
}

/** `battleTokenReward` 一行（一个方案的某一级）。 */
export interface IRewardRow {
    readonly plan: number;
    readonly level: number;
    /** 该级奖励，取 `reward[0]`（老端也只读第 0 项）。 */
    readonly resId: number;
    readonly number: number;
}

/** 一级 / 一行（老端 `BattleTokenListInfo`）。 */
export interface ILevelRow {
    /** 0-based 行号（= 等级 - 1）。 */
    readonly index: number;
    /** 各方案在这一级的奖励 resId，下标 = `order - 1`。 */
    readonly resIds: readonly number[];
    /** 各方案在这一级的奖励数量，下标 = `order - 1`。 */
    readonly numbers: readonly number[];
    /** 总行数（= `min(奖励表行数, maxLevel)`）。 */
    readonly max: number;
    readonly type: number;
}

/** 一个奖励格的显示状态。 */
export interface IRewardSlotState {
    /** 该方案开没开（绿通 = 已购买 / 免费档恒真）。 */
    readonly unlocked: boolean;
    /** 已领取（打勾）。 */
    readonly taken: boolean;
    /** 可领取 —— **只决定红点**，不代表能不能点。 */
    readonly claimable: boolean;
    /** 能点（点了发领取请求）。 */
    readonly canTake: boolean;
    /** 置灰遮罩（等级还没到）。 */
    readonly masked: boolean;
}

/** 一行两侧连接段的显隐 / 点亮。 */
export interface IJointState {
    /** 上方连到上一行的段是否存在（首行没有）。 */
    readonly topExist: boolean;
    /** 下方连到下一行的段是否存在（末行没有）。 */
    readonly bottomExist: boolean;
    /** 上段是否点亮（已达等级）。 */
    readonly topLit: boolean;
    /** 下段是否点亮。 */
    readonly bottomLit: boolean;
    /** 本行是否已解锁（`level > index`）。 */
    readonly unlocked: boolean;
}

// ============================================================
// 表解析
// ============================================================

/** 宽松读数字（表里 `lotterylevelUpCostEnd` 的 value 是字符串）。 */
function num(v: unknown): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') return Number(v);
    return 0;
}

/** 解析 `battleTokenPlan`。 */
export function parsePlanRows(rows: readonly unknown[]): IPlanRow[] {
    const out: IPlanRow[] = [];
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const resId = num(r.resId);
        if (!resId) continue;
        out.push({
            resId,
            type: num(r.type),
            order: num(r.order),
            rmb: num(r.rmb),
            openCostItemResId: num(r.openCostItemResId),
            openCostItemNum: num(r.openCostItemNum),
            rewardPlan: num(r.rewardPlan),
        });
    }
    return out.sort((a, b) => a.type - b.type || a.order - b.order);
}

/** 解析 `battleTokenReward`（`reward` 是 `[{resId, number}]`）。 */
export function parseRewardRows(rows: readonly unknown[]): IRewardRow[] {
    const out: IRewardRow[] = [];
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const plan = num(r.plan);
        const level = num(r.level);
        if (!plan || !level) continue;
        const list = Array.isArray(r.reward) ? r.reward : [];
        const first = (list[0] ?? {}) as Record<string, unknown>;
        out.push({ plan, level, resId: num(first.resId), number: num(first.number) });
    }
    return out;
}

/**
 * 解析 `battleTokenConfig` → key → 值。
 *
 * ⚠️ `lotterylevelUpCostEnd` 的 value 在表里是**字符串** `"10"`，别假定全是 number
 * （本函数保留原始类型，取值时用 `configNum`）。
 */
export function parseConfigRows(rows: readonly unknown[]): ReadonlyMap<string, unknown> {
    const map = new Map<string, unknown>();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const key = typeof r.key === 'string' ? r.key : '';
        if (key) map.set(key, r.value);
    }
    return map;
}

/** 从 config map 取数字（缺失 / 非数字时用兜底）。 */
export function configNum(
    cfg: ReadonlyMap<string, unknown>,
    key: string,
    fallback: number,
): number {
    const v = cfg.get(key);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return fallback;
}

// ============================================================
// 页签口径
// ============================================================

/** 该类型是不是本轮做的页签（转盘 5/6 不是）。 */
export function isSupportedTab(type: number): boolean {
    return BT_SUPPORTED_TYPES.includes(type);
}

/** 类型号 → 底栏下标（`BT_TABS` 里的位置）；不支持的类型返回 -1。 */
export function tabIndexOf(type: number): number {
    return BT_TABS.findIndex((t) => t.type === type);
}

/**
 * 内容页「标签」控制器的**声明序 index**。
 *
 * 老端 `TabBattleTokenPage.tabPageIndex`：转盘（5/6）共用最后一页（下标 4），其余 `type - 1`。
 * 声明序：`通行证(0) / 七日登录(1) / 等级基金(2) / 过关令(3) / 抽奖(4)`。
 */
export function tabPageIndex(type: number): number {
    if (type === BT_TYPE_LOTTERY1 || type === BT_TYPE_LOTTERY2) return 4;
    return type - 1;
}

/**
 * 该类型是不是「三个方案」（用 3 格列表）。
 *
 * 老端 `TabBattleTokenPage.isThree` 是**反着写**的：列出 5 个 false 的类型 ⇒ 其余为 true。
 * 表口径印证：只有 `type = 1`（通行证）在 `battleTokenPlan` 里有 3 个 `order`。
 */
export function isThreePlan(type: number): boolean {
    switch (type) {
        case BT_TYPE_SIGN_IN:
        case BT_TYPE_LEVEL_FUND:
        case BT_TYPE_PASS:
        case BT_TYPE_LOTTERY1:
        case BT_TYPE_LOTTERY2:
            return false;
        default:
            return true;
    }
}

/** 该类型一行里的奖励格数量。 */
export function slotCountOf(type: number): number {
    return isThreePlan(type) ? 3 : 2;
}

/** 该类型的页头美术前缀（`bt_<key>_title` 等）；未知类型退回默认页。 */
export function artKeyOf(type: number): string {
    const tab = BT_TABS.find((t) => t.type === type);
    return tab ? tab.artKey : 'txz';
}

// ============================================================
// 红点表达式口径
// ============================================================

/**
 * 战令**页内某个页签**的红点表达式 —— `[RDBattleToken:<type>]`。
 *
 * ## 为什么可以带参
 * `ExprVarMgr.Hash(name, p1, p2, p3)` 把参数拼进实例的 key（`framework/expr/ExprVarMgr.AddRef`）
 * ⇒ `[RDBattleToken:2]` 和 `[RDBattleToken:4]` 天然是**两个独立的变量实例**，各按自己的
 * `type` 判定；而变量**名**仍是同一个，所以注册集合（`RD_ALL_VAR_NAMES`）只需 `RDBattleToken`。
 * 变量实例侧用 `GetP1()` 取参数（见 `RdVars.RDBattleTokenVar`）。
 *
 * ## 与老端对齐
 * 老端 `LayerBattleToken.refreshRd()` 就是逐 tab 调
 * `ModelBattleToken.GetBattleTokenRD(CmdBattleTokenType.xxx)` —— **它不走表达式体系**。
 * 本端把它翻译成「同一个变量的不同参数」，好让页内四格与主界面六格**共用同一条**
 * 「表达式 → `RdExprBinding` → `RedDot`」通路（组件接口才统一得起来）。
 *
 * ⚠️ **无参的 `[RDBattleToken]` 另有语义**：老端 `RDBattleToken.OnComputeResult()` 取
 * **第一个** VO（= 通行证页），`open.json` 的 `refId=104` 战令入口用的就是它。
 * 页内四格一律走带参，别混用。
 */
export function battleTokenTabRdExpr(type: number): string {
    return `[RDBattleToken:${type}]`;
}

/**
 * 表达式参数 → `CmdBattleTokenType`。
 *
 * 参数经 `Expr.ts` 的 `parseValue` 过来，可能是 `number` 也可能是 `string`；
 * 解析不出正数（无参 / 空 / 非数字 / `0` / 负数）⇒ 回落 `BT_DEFAULT_TYPE`，**不抛** ——
 * 表达式里一个笔误不该把整条红点链路炸掉。
 *
 * ⚠️ 刻意**不做**「必须在 `BT_TABS` 里」的白名单：`5` / `6`（转盘）在本端没做 UI，
 * 但表里真配了方案时按它自己的 type 算（没方案就恒不亮），比悄悄回落成通行证更忠实。
 */
export function battleTokenRdType(raw: unknown): number {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : BT_DEFAULT_TYPE;
}

// ============================================================
// 方案 / 等级
// ============================================================

/** 取某类型的全部方案行，按 `order` 升序。 */
export function plansOfType(plans: readonly IPlanRow[], type: number): IPlanRow[] {
    return plans.filter((p) => p.type === type).sort((a, b) => a.order - b.order);
}

/**
 * 取「某类型 + 某方案序号」的 `resId`。
 *
 * 老端 `BattleTokenCodeSharing.getResIdByPlanAndType` 在找不到时**返回 1**（不是 0 / -1）——
 * 照抄，因为下游 `getRef("resId", 1)` 会命中通行证的免费档（表格第一行），不至于崩。
 */
export function planResId(plans: readonly IPlanRow[], type: number, order: number): number {
    const hit = plans.find((p) => p.type === type && p.order === order);
    return hit ? hit.resId : 1;
}

/** 取某方案行（找不到返回 `null`）。 */
export function planRow(plans: readonly IPlanRow[], type: number, order: number): IPlanRow | null {
    return plans.find((p) => p.type === type && p.order === order) ?? null;
}

/**
 * 该方案的价格文案数据。
 *
 * - `rmb > 0` ⇒ `{ kind: 'rmb', rmb }`（走 `payChannel` 查钱数）
 * - `rmb === 0 && openCostItemResId > 0` ⇒ `{ kind: 'item', resId, num }`（**过关令方案 2**：680 金币）
 * - 其余 ⇒ `{ kind: 'free' }`（免费档，按钮只在方案 1 上出现且是「免费」样式）
 */
export interface IPlanPrice {
    readonly kind: 'rmb' | 'item' | 'free';
    readonly rmb: number;
    readonly resId: number;
    readonly num: number;
}

export function priceOf(row: IPlanRow | null): IPlanPrice {
    if (!row) return { kind: 'free', rmb: 0, resId: 0, num: 0 };
    if (row.rmb > 0) return { kind: 'rmb', rmb: row.rmb, resId: 0, num: 0 };
    if (row.openCostItemResId > 0 && row.openCostItemNum > 0) {
        return { kind: 'item', rmb: 0, resId: row.openCostItemResId, num: row.openCostItemNum };
    }
    return { kind: 'free', rmb: 0, resId: 0, num: 0 };
}

/** 等级是否已满（`level >= maxLevel`）。 */
export function isMaxLevel(level: number, maxLevel: number): boolean {
    return level >= maxLevel;
}

/** 进度条的 `max`：满级写死 1000，否则读配置。 */
export function expMaxOf(level: number, maxLevel: number, levelUpCostEnd: number): number {
    return isMaxLevel(level, maxLevel) ? BT_MAX_LEVEL_EXP : levelUpCostEnd;
}

/**
 * 装配整个列表的数据（老端 `ModelBattleToken.GetTlBattleTokenMessage`）。
 *
 * 行数 `max = min(该类型第一个方案的奖励表行数, maxLevel)`：
 *   通行证 / 等级基金 / 过关令 = **50**，七日登录 = **7**。
 *
 * ⚠️ 老端这里 `tlresId` / `tlnumber` 是**按方案循环**填的（j 遍历方案、i 遍历等级），
 * 所以 `resIds[order-1]` 才是该方案在第 `index+1` 级的奖励。
 */
export function buildLevelRows(
    plans: readonly IPlanRow[],
    rewards: readonly IRewardRow[],
    type: number,
    maxLevel: number,
): ILevelRow[] {
    const typePlans = plansOfType(plans, type);
    if (!typePlans.length) return [];

    const perPlan = typePlans.map((p) => rewards.filter((r) => r.plan === p.rewardPlan).sort((a, b) => a.level - b.level));
    const lengths = perPlan.map((l) => l.length).filter((n) => n > 0);
    if (!lengths.length) return [];

    const max = Math.min(Math.min(...lengths), maxLevel);
    const out: ILevelRow[] = [];
    for (let i = 0; i < max; i++) {
        const resIds: number[] = [];
        const numbers: number[] = [];
        for (const list of perPlan) {
            const cell = list[i];
            resIds.push(cell ? cell.resId : 0);
            numbers.push(cell ? cell.number : 0);
        }
        out.push({ index: i, resIds, numbers, max, type });
    }
    return out;
}

/**
 * 一个奖励格的状态（老端 `BattleTokenCodeSharing.renderItem` 的核心分支）。
 *
 * 老端的判据链（照抄，含它那两个**看起来多余但会影响表现**的分支）：
 *   ① `cmd 存在 && cmd.open && level > index` ⇒ 可点；再分：
 *      - `tlTakeLevel` 存在且**不含** `index+1` ⇒ 红点（可领）
 *      - `tlTakeLevel` 存在且**含** `index+1` ⇒ 已领取
 *      - `tlTakeLevel` 不存在 ⇒ **能点但没红点**（老端 `isRed` 保持 false）
 *   ② 其余 ⇒ 不能点
 *   ③ 「遮罩」只在 `level > index` 时关掉（没到等级就压暗）
 *
 * @param cmdOpen      该方案是否已开（`cmd.open`）
 * @param takenLevels  服务端记录的已领取等级（`cmd.tlTakeLevel`），`null` = 字段缺失
 * @param level        当前战令等级
 * @param index        0-based 行号
 */
export function rewardSlotState(
    cmdOpen: boolean,
    takenLevels: readonly number[] | null,
    level: number,
    index: number,
): IRewardSlotState {
    const reached = level > index;
    const canTake = !!cmdOpen && reached;
    const hasList = takenLevels !== null;
    const already = hasList && takenLevels.includes(index + 1);
    return {
        unlocked: !!cmdOpen,
        taken: canTake && hasList && already,
        claimable: canTake && hasList && !already,
        canTake: canTake && !(hasList && already),
        masked: !reached,
    };
}

/**
 * 一行两侧连接段的显隐与点亮（老端 `renderItem` 的头 / 尾 / 上 / 下 四段）。
 *
 * 老端两段写法同构：首行只留「下」、末行只留「上」、中间上下都留；
 * 点亮条件都是 `level > index`。
 */
export function jointState(index: number, max: number, level: number): IJointState {
    const unlocked = level > index;
    const topExist = index > 0;
    const bottomExist = index < max - 1;
    return {
        topExist,
        bottomExist,
        topLit: topExist && unlocked,
        bottomLit: bottomExist && unlocked,
        unlocked,
    };
}

/**
 * 当前「可领取的那一级」（老端 `GetBattleTokenCurrentLv`）——
 * 用于打开面板时把列表滚到该行。
 *
 * 找不到可领取的就返回 `level`；`level < 3` 时老端界面层会把它归零（见 `TabBattleTokenPage.UpdateList`）。
 */
export function currentClaimLv(rows: readonly ILevelRow[], level: number, cmdOpenFlags: readonly boolean[], takenLevels: readonly (readonly number[] | null)[]): number {
    for (const row of rows) {
        for (let plan = 0; plan < cmdOpenFlags.length; plan++) {
            if (!cmdOpenFlags[plan]) continue;
            if (!(level > row.index)) continue;
            const taken = takenLevels[plan];
            if (!taken || !taken.includes(row.index + 1)) return row.index + 1;
        }
    }
    return level;
}

/** 老端界面层对滚动目标的归零：`currentLv < 3` ⇒ 0。 */
export function scrollTargetIndex(claimLv: number, max: number): number {
    const lv = claimLv < 3 ? 0 : claimLv;
    return Math.min(max - 1, lv);
}

/**
 * 购买按钮尺寸（FGUI `组件/按钮_购买.xml` 与 `按钮_购买_免费.xml` 都是 193×74）。
 */
export const BT_BUY_BTN_W = 193;
export const BT_BUY_BTN_H = 74;

/** 购买行容器尺寸（FGUI `组件/组件_战令_标签组合.xml`，720×71；按钮 74 高会溢出 3px）。 */
export const BT_BUY_ROW_W = 720;
export const BT_BUY_ROW_H = 71;

/** 一个按钮在购买行里的「左上角 + 尺寸」（FGUI 坐标）。 */
export interface IBuyButtonBox {
    readonly left: number;
    readonly top: number;
    readonly w: number;
    readonly h: number;
}

/**
 * 购买行三个按钮的位置 —— FGUI `标签组合` 里那两组 `gearXY controller="个数"`。
 *
 * ⚠️ `pages="0,1"` 的**值序**是「page0 | page1」= 「两个 | 三个」，**不是**屏幕顺序：
 *
 * | 下标 | 按钮 | 两个（page 0） | 三个（page 1） |
 * |---|---|---|---|
 * | 0 | `免费` | `109,-3` | `58,-1` |
 * | 1 | `方案1`（= `order 2` / Normal / 黄） | `440,-4` | `287,-2` |
 * | 2 | `方案2`（= `order 3` / Advanced / **红**） | 隐藏 | `496,-2` |
 *
 * 两组都「整体居中」：两个时两端 109..633、三个时 58..689，中心都在 371 附近。
 */
export function buyButtonLayout(three: boolean): readonly (IBuyButtonBox | null)[] {
    if (three) {
        return [
            { left: 58, top: -1, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
            { left: 287, top: -2, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
            { left: 496, top: -2, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        ];
    }
    return [
        { left: 109, top: -3, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        { left: 440, top: -4, w: BT_BUY_BTN_W, h: BT_BUY_BTN_H },
        null,
    ];
}

/**
 * 购买行里第 `index` 个按钮的**节点坐标**（相对容器中心）。
 *
 * 容器与按钮同为 `anchor (0.5,0.5)` ⇒ `pos = 子中心 − 父中心`。
 * 三个按钮的 xy 是**左上角**（这几处 `pivot="0.5,0.5"` 没带 `anchor="true"`，
 * 见规则 58；用「气泡 n141 正好包住 `anchor="true"` 的说明文字」交叉验证过）。
 */
export function buyButtonPos(three: boolean, index: number): { x: number; y: number } | null {
    const box = buyButtonLayout(three)[index];
    if (!box) return null;
    return {
        x: box.left + box.w / 2 - BT_BUY_ROW_W / 2,
        y: BT_BUY_ROW_H / 2 - (box.top + box.h / 2),
    };
}

/**
 * 底栏某类型是否该显示红点（老端 `GetBattleTokenRD`）。
 *
 * 判据：存在一行 `i` 与一个方案 `cmd`，满足 `cmd.open && level > i && tlTakeLevel 不含 i+1`。
 * 注意老端这里是**只要有 tlTakeLevel 字段**才判定（缺字段的行不算红点）。
 */
export function hasClaimableRedDot(
    rows: readonly ILevelRow[],
    level: number,
    cmdOpenFlags: readonly boolean[],
    takenLevels: readonly (readonly number[] | null)[],
): boolean {
    for (const row of rows) {
        for (let plan = 0; plan < cmdOpenFlags.length; plan++) {
            if (!cmdOpenFlags[plan]) continue;
            if (!(level > row.index)) continue;
            const taken = takenLevels[plan];
            if (taken && !taken.includes(row.index + 1)) return true;
        }
    }
    return false;
}

/**
 * 某个方案在**前 `maxLevel` 级**里的奖励汇总（老端 `GetTlBattleTokenReward`）。
 *
 * 用于「激活战令」弹窗里那句「激活基础战令，预计可以获得奖励:」下面的奖励列表。
 */
export function rewardTotals(
    rewards: readonly IRewardRow[],
    plan: number,
    maxLevel: number,
): { resId: number; number: number }[] {
    const sum = new Map<number, number>();
    for (const r of rewards) {
        if (r.plan !== plan) continue;
        if (r.level > maxLevel) continue;
        sum.set(r.resId, (sum.get(r.resId) ?? 0) + r.number);
    }
    return Array.from(sum.entries()).map(([resId, number]) => ({ resId, number }));
}

// ============================================================
// 倒计时
// ============================================================

/**
 * 秒 → `2天09:02:00` 形态（老端 `TimeUtil.timeSec2HMSStr2` 的界面用法）。
 *
 * 老端文案是 `活动倒计时:${timeStr}`；`time < 0` 时改成「活动已结束」。
 */
export function formatCountdown(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '活动已结束';
    const total = Math.floor(seconds);
    const day = Math.floor(total / 86400);
    const hour = Math.floor((total % 86400) / 3600);
    const minute = Math.floor((total % 3600) / 60);
    const second = total % 60;
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    const hms = `${pad(hour)}:${pad(minute)}:${pad(second)}`;
    return day > 0 ? `${day}天${hms}` : hms;
}

/**
 * 终局时间戳（**秒**）。
 *
 * ⚠️ `CmdBattleToken.endTime` 是 **`Long`（uint64，毫秒）** ⇒ 必须走 `toIdString` 拿到字符串再除 1000，
 * **禁 `Number(long)`**（超 2^53 会丢精度，见规则 23）。老端 `VOBattleToken.GetEndTime()` = `cmd.endTime / 1000`。
 */
export function endSecondsOf(endTimeRaw: unknown): number {
    if (endTimeRaw === null || endTimeRaw === undefined) return 0;
    if (typeof endTimeRaw === 'number') return endTimeRaw / 1000;
    const s = typeof endTimeRaw === 'string' ? endTimeRaw : toIdStringSafe(endTimeRaw);
    const ms = Number(s);
    return Number.isFinite(ms) ? ms / 1000 : 0;
}

/** `Long` → 字符串；非 Long 原样 `String()`（`toIdString` 的极简本地版，避免 Table 引入依赖）。 */
function toIdStringSafe(v: unknown): string {
    if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function') {
        const s = String(v);
        return s === '[object Object]' ? '' : s;
    }
    return v === null || v === undefined ? '' : String(v);
}

/** 剩余秒数（`end - now`，秒）。 */
export function remainSeconds(endSeconds: number, nowSeconds: number): number {
    if (!Number.isFinite(endSeconds) || endSeconds <= 0) return 0;
    return endSeconds - nowSeconds;
}

/** 倒计时文案（界面唯一入口）。 */
export function countdownText(endSeconds: number, nowSeconds: number): string {
    const remain = remainSeconds(endSeconds, nowSeconds);
    if (remain < 0) return '活动已结束';
    return `活动倒计时:${formatCountdown(remain)}`;
}

// ============================================================
// 每页的说明文案（FGUI `gearText controller="标签"`）
// ============================================================

/**
 * 页头那句说明（FGUI `n13` 的 `gearText`）。
 *
 * 原稿 `values` 只给了 3 页 + 一个 default：
 *   `pages="3,2,0"` ⇒ `七日登录 / 等级基金 / 过关令`，default 落在**通行证**。
 */
export function pageHintOf(type: number): string {
    switch (type) {
        case BT_TYPE_SIGN_IN:
            return '持续登录 每日领取丰厚奖励';
        case BT_TYPE_LEVEL_FUND:
            return '努力提升角色等级 \n解锁丰厚奖励';
        case BT_TYPE_PASS:
            return '努力通过更多层 \n解锁丰厚奖励';
        default:
            return '消耗体力来提升战令等级！';
    }
}

/** 页头一个可变元素的尺寸（FGUI `gearSize`）。 */
export interface IHeadBox {
    readonly w: number;
    readonly h: number;
}

/**
 * 说明文字框（FGUI `n13` 的 `gearSize controller="标签"`，`values` 是 `宽,高,scaleX,scaleY`）。
 *
 * `pages="1,2,0,5"` ⇒ 只列了 通行证(1) / 等级基金(2) / 过关令(0) / 抽奖(5)，
 * **七日登录(3) 不在里面** ⇒ 用它的 `default="425,42,1,1"`。
 *
 * ⚠️ 不跟着改的症状：七日登录那页的字被挤进 230 宽 —— 折成两行或（`SHRINK`）字号变小，
 *    不报错、**单测也测不出**（只有对着 FGUI 的 `gearSize` 核才看得见）。
 */
export function hintBoxOf(type: number): IHeadBox {
    switch (type) {
        case BT_TYPE_END:
            return { w: 230, h: 71 };
        case BT_TYPE_LEVEL_FUND:
            return { w: 251, h: 79 };
        case BT_TYPE_PASS:
            return { w: 221, h: 79 };
        default:
            // 七日登录 = `gearSize` 的 default（也是抽奖页之外唯一没被列出的页）
            return { w: 425, h: 42 };
    }
}

/** FGUI `n141` 气泡的**原始**高度（节点上挂 `scale (1, 0.6)`，所以显示高 = 195 × 0.6 = 117）。 */
export const BT_QIPAO_H = 195;

/**
 * 说明气泡的尺寸（FGUI `n141` 的 `gearSize pages="1,3"`）。
 *
 * `values="330,195,1,0.6|378,195,1,0.6"` ⇒ 通行证(1) 330 宽、**七日登录(3) 378 宽**，
 * `default="330,195,1,0.6"` ⇒ 等级基金 / 过关令 走 330。高度恒 195（纵向缩放 0.6 由 prefab 上的
 * `scale` 承担，**别把 195 改成 117**，否则 0.6 会再压一次）。
 */
export function qipaoBoxOf(type: number): IHeadBox {
    return { w: type === BT_TYPE_SIGN_IN ? 378 : 330, h: BT_QIPAO_H };
}
