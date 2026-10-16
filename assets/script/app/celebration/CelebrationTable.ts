/**
 * 开服庆典（老端 FGUI `开服冲榜` 包 + `LayerOSRankUI` 三页签）的**全部判定口径**。
 *
 * ⚠️ **本文件零 `import`** —— 与 `HangTable` / `GiftTable` / `BattleTokenTable` / `SevenDayTable`
 * 同一条家族约定：判定逻辑必须能在纯 Node 里直接跑单测。
 * `tests/celebration.test.ts` 第一段会断言这条，**谁在这里加一个 import（含 `import type`），
 * 整段判定就失去回归网**。所以类型与枚举也定义在本文件里，没有单独的 `CelebrationTypes.ts`。
 *
 * ## 老端的判定散在哪（这里是怎么收敛的）
 *
 * | 老端出处 | 迁成 |
 * |---|---|
 * | `VOCelebration.GetStateBySubId` / `GetRd` / `GetTargetArr` 排序 | `stateBySubId` / `rdOf` / `sortTargetsByState` |
 * | `VOCelebration.GetId` / `GetRefConfig` / `GetTargetRefBySubId` | `celebrationIdOf` / `configOfRankType` / `targetOfSubId` |
 * | `VOCelebration.GetBuyCountBySubId` | `buyCountOf` |
 * | `VOCelebration.Actived` / `EndTime`（靠 `VORank`） | `rankActiveOf` / `rankTimeOf` |
 * | `ModelCelebration.Enabled`（靠 `SystemId.OSRank` 的可见性条件集） | `enabledOf`（见下「可见性怎么落」） |
 * | `LayerOSRankUI.renderTargetListItem` 的文案拼装 | `conditionText0Of` / `propertyWantTextOf` |
 * | `LayerOSRankUI.renderRankListItem` 的名次分段 + 达标判定 | `rankSegmentOf` / `rankTextOf` / `rankReachedOf` |
 * | `LayerOSRankUI.renderShopListItem` 的支付分支 / 折扣 / 限购 | `pricingOf` / `saleTextOf` / `limitBuyTextOf` / `purchaseStateOf` |
 * | `LayerOSRankUI.UpdateTime` 的倒计时（`end - 3e5 - now`） | `countdownOffsetOf` |
 * | `LayerOSRankDetailUI.updateView` 的名次文案 | `myRankTextOf` |
 *
 * ## 🔴 `cmd.id` 是 **rankType**，不是 `celebrationConfig.id`
 *
 * `CmdCelebrationInfo { id, curValue, targetInfos, shopInfos }` 里的 `id`
 * 对应的是 `celebrationConfig.rankType`（`VOCelebration.GetRefConfig()` = `getRef("rankType", cmd.id)`）。
 * 一张 `celebrationConfig` 里 `id ≠ rankType`（实测 id=1..11 / rankType=32,34,36,…52）。
 * 真正用来过滤 `celebrationTarget` / `celebrationRank` / `celebrationShop` 的是
 * **`celebrationConfig.id`**（`VOCelebration.GetId()` 反查出来的那个）。
 * 两者混用**不报错、只是列表永远空**。
 *
 * ## 🔴 `GetRd` 扫的是 `celebrationRank`、判的是 `celebrationTarget`
 *
 * 老端 `VOCelebration.GetRd()`：
 *
 * ```ts
 * for (let item of RefMgrcelebrationRank.getRefAll())
 *     if (item.id == this.GetId())
 *         if (this.GetStateBySubId(item.subId) == Reward) return 1;
 * ```
 *
 * 外层遍历 `celebrationRank` 的 `subId`，内层 `GetStateBySubId` 却去查 `celebrationTarget`
 * （`GetTargetRefBySubId`）。两张表 `subId` 都从 1 起、实测 rank 有 1..5 而 target 有 1..8
 * ⇒ 等效于「只看 target 的 subId 1..5」。**这是老端的原样，照抄不改** ——
 * 改成扫 `celebrationTarget` 会让红点在 target 第 6..8 项可领时也多亮一次（线上没有的行为）。
 *
 * ## 可见性怎么落（`enabledOf` 的替代口径）
 *
 * 老端 `ModelCelebration.Enabled()` = `ModelSystem.GetSystem(SystemId.OSRank)
 * .GetVisibleConditionSet().GetBool()` **且** `VOCelebrationBag.GetFirstOne() != null`。
 *
 * Demo3.8 **没有** `ModelSystem` / `SystemId` / `ConditionSet` 那套（`assets/script/app/` 下
 * 不存在同名文件，`grep -rn "SystemId" assets/script/` 零命中）。而那个条件集在策划表里
 * 对应的就是红点 / 可见性变量 `VarOSRankShow`，它的 `OnComputeResult()` 全部内容只有一句：
 * **「现在落在 `CmdRankItem` 的 `startTime ~ GetEndTime()` 之间」**。
 *
 * ⇒ 这里落在 `enabledOf(rankItem, now)` = 同一句原始语义，**不是**新拍的门槛。
 * 差集只有一个：老端多一层「策划表达式可另行关闭」，本工程这一层没迁（表达式没迁），
 * 所以 `enabledOf` 会比老端**更宽**（老端表达式若关了就永远不显示）。
 * 记账在此，等表达式 / `SystemId` 那套落地时把 `enabledOf` 收回去。
 *
 * ## ⚠️ 四张庆典表都是**压缩表**（`{k,v,c}`）
 *
 * `celebrationConfig` / `celebrationTarget` / `celebrationRank` / `celebrationShop`
 * 落盘形状是 `{"k":[…列名…],"v":[[…值…]],"c":1}`。解压由 `RefUtil` 的 `RefAsset` 负责
 * （`getRefAllAsync` 返回的已经是对象行），所以本文件的 `parseXxxRows` 只处理**对象行**，
 * 与非压缩表（`payChannel` / `item` / `roleProperty`）同一套写法。
 */

// ============================================================
// 类型与枚举
// ============================================================

/**
 * 庆典目标项的三种状态。
 *
 * 🔴 值必须与老端 `ECelebrationTargetRewardType` **逐位一致** ——
 * FGUI 控制器 `状态` 的页序就是它（`item1.xml`: `1,未领取,0,未达标,2,已完成`），
 * 迁过来的 prefab 是按这个序号驱动显隐的，改值 = 三页全错位且不报错。
 */
export enum ECelebrationTargetRewardType {
    /** 可领取（老端 `Reward = 0`）。 */
    Reward = 0,
    /** 未完成（老端 `Unfinished = 1`）。 */
    Unfinished = 1,
    /** 已领取（老端 `Received = 2`）。 */
    Received = 2,
}

/** FGUI 主界面控制器 `页签` 的页序（`0,庆典目标,1,庆典排名,2,限时特惠`）。 */
export enum ECelebrationTab {
    Target = 0,
    Rank = 1,
    Shop = 2,
}

/** 名次分段（FGUI `item2` 控制器 `名次`：`0,第一名 / 1,2-3名 / 2,其他`）。 */
export enum ECelebrationRankSegment {
    First = 0,
    SecondThird = 1,
    Other = 2,
}

/** 商品卡的两个分支（FGUI `item3` 控制器 `buyType`：`0,rmb / 1,cost`）。 */
export type CelebrationPayBranch = 'rmb' | 'cost';

/** 一条奖励（`rewards` / `rewards1` / `rewards2` 的元素）。 */
export interface ICelebrationReward {
    readonly resId: number;
    readonly number: number;
}

/** `celebrationConfig` 一行。 */
export interface ICelebrationConfigRow {
    readonly id: number;
    readonly start: number;
    readonly end: number;
    readonly rankType: number;
    readonly name: string;
    readonly targetGroupId: number;
    readonly rankGroupId: number;
    readonly sellGroupId: number;
    readonly goto: number;
    readonly tips: string;
}

/** `celebrationTarget` 一行（庆典目标）。 */
export interface ICelebrationTargetRow {
    readonly id: number;
    readonly subId: number;
    readonly count: number;
    readonly rewards: readonly ICelebrationReward[];
}

/** `celebrationRank` 一行（庆典排名奖档）。 */
export interface ICelebrationRankRow {
    readonly id: number;
    readonly subId: number;
    readonly start: number;
    readonly end: number;
    readonly rewards1: readonly ICelebrationReward[];
    readonly count: number;
    readonly rewards2: readonly ICelebrationReward[];
}

/** `celebrationShop` 一行（限时特惠商品）。 */
export interface ICelebrationShopRow {
    readonly id: number;
    readonly subId: number;
    readonly name: string;
    readonly rewards: readonly ICelebrationReward[];
    /** 🔴 是 **`payChannel.id`**（不是元）；`0` = 走 `costType`/`costCount` 货币购买。 */
    readonly rmb: number;
    readonly costType: number;
    readonly costCount: number;
    readonly limit: number;
    readonly price: number;
    readonly discount: number;
}

/** `payChannel` 里本模块用的两个字段。 */
export interface ICelebrationPayChannelRow {
    readonly id: number;
    readonly name: string;
    /** 真实金额（元）。 */
    readonly rmb: number;
}

/** 服务器下发的庆典状态（`CmdCelebrationInfo`）。 */
export interface ICelebrationServerState {
    /** 🔴 是 **rankType**，见文件头。 */
    readonly id: number;
    /** `curValue: Long` ⇒ 已转 number（当前战力 / 进度值）。 */
    readonly curValue: number;
    /** `targetInfos`：下标 `subId - 1` = 1 表示该档已领。 */
    readonly targetInfos: readonly number[];
    /** `shopInfos`：下标 `subId - 1` = 已购买次数。 */
    readonly shopInfos: readonly number[];
}

/** `CmdRankItem` 里本模块用的时间字段（**已 ×1000 转毫秒**）。 */
export interface ICelebrationRankTime {
    /** `CmdRankItem.type` = `celebrationConfig.rankType`。 */
    readonly type: number;
    readonly startTimeMs: number;
    /** `(showEndTime || endTime) * 1000`（老端 `VORank.GetEndTime`）。 */
    readonly endTimeMs: number;
}

/** 商品卡的展示口径（`pricingOf` 的返回值）。 */
export interface ICelebrationShopPricing {
    readonly branch: CelebrationPayBranch;
    /** `lab_old_price`：原价。两个分支**都**会写（老端两支都 `setText`）。 */
    readonly oldPriceText: string;
    /** `lab_price`：rmb 分支 = 真实金额；cost 分支 = `costCount`。 */
    readonly priceText: string;
    /**
     * `icon_cost`（cost 分支的货币图标）。
     *
     * 老端走 `ModelGoods.GetGoodsIconKeyByRefId(data.costType)` 拿图标 key ⇒
     * 这里只交出 `costType`，怎么解析成资源路径由页面交给
     * `LayerActivityArt.resolveRewardIconRef`（`roleProperty` 那一支）。
     */
    readonly costIconResId: number;
    /** `RmbSign3`（rmb 页的 ￥）：rmb 分支显示。 */
    readonly showRmbSign: boolean;
    /** `CostIcon2`（`icon_cost`）：cost 分支显示。 */
    readonly showCostIcon: boolean;
}

/**
 * 一件道具 / 货币的展示信息。
 *
 * 与 `activity/LayerActivityTable.IActivityGoodsInfo` **结构完全一致**（刻意）：Table 层
 * 零 import 约束下不能去 import 那个接口，所以这里复述一遍字段 —— 结构化类型下
 * `Map<number, IActivityGoodsInfo>` 可以直接赋给 `ReadonlyMap<number, ICelebrationGoodsInfo>`，
 * 不需要断言。改一边的字段名会让赋值处编译失败（这正是想要的：改不动就等于没生效）。
 */
export interface ICelebrationGoodsInfo {
    readonly name: string;
    readonly quality: number;
    readonly icon: string;
    /** `icon` 是否已经是资源路径（`item` 表 `true` / `roleProperty` 表 `false`）。 */
    readonly iconIsPath: boolean;
}

/** 一次界面刷新要的全部数据。 */
export interface ICelebrationSnapshot {
    readonly now: number;
    readonly configs: readonly ICelebrationConfigRow[];
    readonly targets: readonly ICelebrationTargetRow[];
    readonly ranks: readonly ICelebrationRankRow[];
    readonly shops: readonly ICelebrationShopRow[];
    readonly payRows: readonly ICelebrationPayChannelRow[];
    /** `item` 表（`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, ICelebrationGoodsInfo>;
    /** `roleProperty` 表（`iconIsPath = false`，货币 / 属性类落这里）。 */
    readonly resources: ReadonlyMap<number, ICelebrationGoodsInfo>;
    /** `rankType` → 时间窗（`CmdRankItem`）。 */
    readonly rankTimes: ReadonlyMap<number, ICelebrationRankTime>;
    /** `CacheMgr.getTlCmdCelebrationInfo()` 选中的那一行（选法见文件头）；读不到为 `null`。 */
    readonly server: ICelebrationServerState | null;
    /** `celebrationConfig` 里 `rankType === snapshot.rankType` 的那一行；查不到为 `null`。 */
    readonly config: ICelebrationConfigRow | null;
    /** 当前庆典的 `rankType`（= `server.id`；没有 server 时退到 `configs[0]?.rankType`）。 */
    readonly rankType: number;
    /** 当前庆典的 `celebrationConfig.id`（老端 `VOCelebration.GetId()`）；查不到为 0。 */
    readonly celebrationId: number;
    /** 当前进度值（`CmdCelebrationInfo.curValue`）；读不到为 0。 */
    readonly curValue: number;
    /** 庆典目标页的行（已按状态升序排；老端 `GetTargetArr`）。 */
    readonly targetArr: readonly ICelebrationTargetRow[];
    /** 庆典排名页的行（**表序**，老端 `GetRankArr` 不排序）。 */
    readonly rankArr: readonly ICelebrationRankRow[];
    /** 限时特惠页的行（**表序**，老端 `GetShopArr` 不排序）。 */
    readonly shopArr: readonly ICelebrationShopRow[];
    /** 红点值（0 / 1；老端 `GetRd`）。 */
    readonly rd: number;
    /** 活动是否在时间窗内（见文件头「可见性怎么落」）。 */
    readonly enabled: boolean;
    /** 当前 rankType 的时间窗；读不到为 `null`。 */
    readonly rankTime: ICelebrationRankTime | null;
    /** `EndTime()`（毫秒）；读不到为 0。 */
    readonly endTimeMs: number;
    /** 倒计时用（`endTimeMs - 3e5 - now`，可能为负 ⇒ 页面按 0 显示）。 */
    readonly countdownOffsetMs: number;
}

/** 名次文案（`data.rank` = `-1` 表示未上榜；老端 `RANK_POSITION_TEXT` / `Client_NotInRank`）。 */
export const CL_NOT_IN_RANK = -1;

/** 倒计时提前量：老端 `UpdateTime` 里的 `- 3e5`（5 分钟）。 */
export const CL_COUNTDOWN_LEAD_MS = 3e5;

// ============================================================
// 基础工具
// ============================================================

/**
 * `unknown` → 非负整数；认不出返回 0。
 *
 * ⚠️ 压缩表解压后的值可能是字符串 / `undefined`（列缺失）。`Number(undefined)` 是 `NaN`，
 * 而 `NaN` 参与比较**恒 false** ⇒ 会让「已达标」静默变成「未达标」。
 */
export function toCount(value: unknown): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

/** `unknown` → 字符串；认不出返回 `''`。 */
export function toText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
    return '';
}

/** 洗一条奖励数组（`{resId, number}`）。 */
export function parseRewards(raw: unknown): ICelebrationReward[] {
    if (!Array.isArray(raw)) return [];
    const out: ICelebrationReward[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const r = entry as Record<string, unknown>;
        const resId = toCount(r.resId);
        if (resId <= 0) continue;
        out.push({ resId, number: toCount(r.number) });
    }
    return out;
}

/** 一行原始数据的对象视图；不是对象返回 `null`。 */
function asRow(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
}

// ============================================================
// 洗表
// ============================================================

/** 洗整张 `celebrationConfig`。 */
export function parseConfigRows(values: unknown): ICelebrationConfigRow[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationConfigRow[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        if (id <= 0) continue;
        out.push({
            id,
            start: toCount(r.start),
            end: toCount(r.end),
            rankType: toCount(r.rankType),
            name: toText(r.name),
            targetGroupId: toCount(r.targetGroupId),
            rankGroupId: toCount(r.rankGroupId),
            sellGroupId: toCount(r.sellGroupId),
            goto: toCount(r.goto),
            tips: toText(r.tips),
        });
    }
    return out;
}

/** 洗整张 `celebrationTarget`。 */
export function parseTargetRows(values: unknown): ICelebrationTargetRow[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationTargetRow[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) continue;
        out.push({ id, subId, count: toCount(r.count), rewards: parseRewards(r.rewards) });
    }
    return out;
}

/** 洗整张 `celebrationRank`。 */
export function parseRankRows(values: unknown): ICelebrationRankRow[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationRankRow[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) continue;
        out.push({
            id,
            subId,
            start: toCount(r.start),
            end: toCount(r.end),
            rewards1: parseRewards(r.rewards1),
            count: toCount(r.count),
            rewards2: parseRewards(r.rewards2),
        });
    }
    return out;
}

/** 洗整张 `celebrationShop`。 */
export function parseShopRows(values: unknown): ICelebrationShopRow[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationShopRow[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        const subId = toCount(r.subId);
        if (id <= 0 || subId <= 0) continue;
        out.push({
            id,
            subId,
            name: toText(r.name),
            rewards: parseRewards(r.rewards),
            rmb: toCount(r.rmb),
            costType: toCount(r.costType),
            costCount: toCount(r.costCount),
            limit: toCount(r.limit),
            price: toCount(r.price),
            discount: toCount(r.discount),
        });
    }
    return out;
}

/** 洗 `payChannel` 里本模块用的两个字段。 */
export function parsePayChannelRows(values: unknown): ICelebrationPayChannelRow[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationPayChannelRow[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        if (id <= 0) continue;
        out.push({ id, name: toText(r.name), rmb: toCount(r.rmb) });
    }
    return out;
}

/**
 * 洗 `CmdRankItem` 缓存 → `type` → 时间窗。
 *
 * ⚠️ 三个时间字段服务端下发的是**秒**，老端 `× 1000` 转毫秒。
 * ⚠️ `endTimeMs` 取 `showEndTime || endTime`（老端 `VORank.GetEndTime`），
 * **不是** `endTime` —— 活动展示期常常在真实结束时间之外再多留一段。
 */
export function parseRankTimes(values: unknown): Map<number, ICelebrationRankTime> {
    const map = new Map<number, ICelebrationRankTime>();
    if (!Array.isArray(values)) return map;
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const type = toCount(r.type);
        if (type <= 0) continue;
        const show = toCount(r.showEndTime);
        const end = toCount(r.endTime);
        map.set(type, {
            type,
            startTimeMs: toCount(r.startTime) * 1000,
            endTimeMs: (show || end) * 1000,
        });
    }
    return map;
}

// ============================================================
// 取行 / 反查
// ============================================================

/** `celebrationConfig` 里 `rankType === rankType` 的那一行（老端 `GetRefConfig`）；查不到 `null`。 */
export function configOfRankType(
    configs: readonly ICelebrationConfigRow[],
    rankType: number,
): ICelebrationConfigRow | null {
    for (const row of configs) if (row.rankType === rankType) return row;
    return null;
}

/**
 * `rankType` → `celebrationConfig.id`（老端 `VOCelebration.GetId`）；查不到 **0**。
 *
 * ⚠️ 这个 id 才是用来过滤三张子表的键 —— 见文件头「`cmd.id` 是 rankType」。
 */
export function celebrationIdOf(configs: readonly ICelebrationConfigRow[], rankType: number): number {
    return configOfRankType(configs, rankType)?.id ?? 0;
}

/** 过滤 `celebrationTarget`（老端 `GetTargetArr` 的过滤部分，不排序）。 */
export function targetsOf(rows: readonly ICelebrationTargetRow[], id: number): ICelebrationTargetRow[] {
    const out: ICelebrationTargetRow[] = [];
    for (const row of rows) if (row.id === id) out.push(row);
    return out;
}

/** 过滤 `celebrationRank`（老端 `GetRankArr`）。 */
export function ranksOf(rows: readonly ICelebrationRankRow[], id: number): ICelebrationRankRow[] {
    const out: ICelebrationRankRow[] = [];
    for (const row of rows) if (row.id === id) out.push(row);
    return out;
}

/** 过滤 `celebrationShop`（老端 `GetShopArr`）。 */
export function shopsOf(rows: readonly ICelebrationShopRow[], id: number): ICelebrationShopRow[] {
    const out: ICelebrationShopRow[] = [];
    for (const row of rows) if (row.id === id) out.push(row);
    return out;
}

/** 取 `id + subId` 那一行（老端 `GetTargetRefBySubId` 走 `["id","subId"]` 复合键）；查不到 `null`。 */
export function targetOfSubId(
    rows: readonly ICelebrationTargetRow[],
    id: number,
    subId: number,
): ICelebrationTargetRow | null {
    for (const row of rows) if (row.id === id && row.subId === subId) return row;
    return null;
}

// ============================================================
// 目标状态 / 红点
// ============================================================

/**
 * 某一档庆典目标的状态（老端 `VOCelebration.GetStateBySubId`）。
 *
 * ```
 * subRef.count <= currentValue ? (targetInfos[subId-1] ? 已领取 : 可领取) : 未完成
 * ```
 *
 * ⚠️ `targetInfos` 的下标是 **`subId - 1`**（老端原样），不是 `subId`；
 * 越界 / 缺失一律当「未领」（老端 `undefined` 是 falsy）。
 * ⚠️ 查不到 `celebrationTarget` 那一行时：老端会 `subRef.count` 抛 `TypeError`
 * （`subRef` 为 `undefined`）。这里退到 **`Unfinished`**，与「配置缺失 = 做不了」语义一致，
 * 且不会让 `GetTargetArr` 的排序整体炸掉。
 */
export function stateBySubId(
    targets: readonly ICelebrationTargetRow[],
    id: number,
    subId: number,
    currentValue: number,
    targetInfos: readonly number[],
): ECelebrationTargetRewardType {
    const row = targetOfSubId(targets, id, subId);
    if (!row) return ECelebrationTargetRewardType.Unfinished;
    if (row.count > currentValue) return ECelebrationTargetRewardType.Unfinished;
    const got = toCount(targetInfos[subId - 1]) !== 0;
    return got ? ECelebrationTargetRewardType.Received : ECelebrationTargetRewardType.Reward;
}

/**
 * 红点值（老端 `VOCelebration.GetRd`）—— 有任意一档「可领取」即 1。
 *
 * 🔴 外层扫的是 **`celebrationRank`** 的 `subId`，内层判的是 `celebrationTarget`
 * —— 老端原样，见文件头，**别"顺手修正"**。
 */
export function rdOf(
    ranks: readonly ICelebrationRankRow[],
    targets: readonly ICelebrationTargetRow[],
    id: number,
    currentValue: number,
    targetInfos: readonly number[],
): number {
    for (const row of ranks) {
        if (row.id !== id) continue;
        if (stateBySubId(targets, id, row.subId, currentValue, targetInfos) === ECelebrationTargetRewardType.Reward) {
            return 1;
        }
    }
    return 0;
}

/**
 * 按状态升序排（老端 `GetTargetArr` 的 `sort`）：可领取 → 未完成 → 已领取。
 *
 * `Array.prototype.sort` 在 V8 里是稳定的（ES2019 起）⇒ 同状态内保持**表序**，
 * 与老端一致（老端也是原生 `sort`）。返回新数组，不改入参。
 */
export function sortTargetsByState(
    rows: readonly ICelebrationTargetRow[],
    stateOf: (subId: number) => number,
): ICelebrationTargetRow[] {
    return rows.slice().sort((a, b) => stateOf(a.subId) - stateOf(b.subId));
}

// ============================================================
// 名次
// ============================================================

/**
 * 名次分段（老端 `renderRankListItem` 的三段 `if`）。
 *
 * ```
 * start === 1                     → 第一名
 * start >= 2 && end <= 3          → 2-3名
 * 其他                             → 其他
 * ```
 *
 * ⚠️ 老端第二段条件**不是** `start === 2` —— 是 `start >= 2 && end <= 3`。
 * 写成 `start === 2` 会让 `start=2,end=3` 以外的档（没有）走「其他」，
 * 现在表里不会有差别，但语义不同，照抄原条件。
 */
export function rankSegmentOf(start: number, end: number): ECelebrationRankSegment {
    if (start === 1) return ECelebrationRankSegment.First;
    if (start >= 2 && end <= 3) return ECelebrationRankSegment.SecondThird;
    return ECelebrationRankSegment.Other;
}

/**
 * 名次文案（老端 `renderRankListItem`）。
 *
 * `start === end` ⇒ `第N名`；否则 `N-M名`（**不带「第」**）。
 */
export function rankTextOf(start: number, end: number): string {
    return start === end ? `第${start}名` : `${start}-${end}名`;
}

/**
 * 「我的名次」文案（老端 `updateRank` 的回包分支）。
 *
 * `rank === -1` ⇒ `未上榜`（`Client_NotInRank`）；否则 `第{0}名`（`RANK_POSITION_TEXT`）。
 */
export function myRankTextOf(rank: number, notInRankText: string, positionTemplate: string): string {
    if (rank === CL_NOT_IN_RANK) return notInRankText;
    return positionTemplate.replace('{0}', String(rank));
}

/** 排名档是否已达标（老端 `enough = voCelebration.GetValue() >= data.count`）。 */
export function rankReachedOf(currentValue: number, count: number): boolean {
    return currentValue >= count;
}

// ============================================================
// 文案
// ============================================================

/** `{n}` 占位符替换。 */
function fill(template: string, args: readonly (string | number)[]): string {
    return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
        const i = Number(index);
        return Number.isInteger(i) && i >= 0 && i < args.length ? String(args[i]) : whole;
    });
}

/** 庆典目标项的描述（`SERVER_LAUNCH_RANKING_CONDITION_TEXT_0`：`{0}达到{1}`）。 */
export function conditionTextOf(propertyName: string, count: number, template: string): string {
    return fill(template, [propertyName, count]);
}

/**
 * 庆典目标页表头（老端 `lab_proty1 = refConfig.name + SERVER_LAUNCH_RANKING_CONDITION_TITLE`）。
 */
export function propertyWantTextOf(propertyName: string, titleSuffix: string): string {
    return `${propertyName}${titleSuffix}`;
}

/** 折扣文案（老端 `` `${data.discount / 100}折` ``）。`500 → 5折`、`150 → 1.5折`。 */
export function saleTextOf(discount: number, suffix: string): string {
    return `${discount / 100}${suffix}`;
}

/** 限购文案（`Client_LimitSale`：`限购{0}/{1}`）。 */
export function limitBuyTextOf(buyCount: number, limit: number, template: string): string {
    return fill(template, [buyCount, limit]);
}

/**
 * 商品的购买状态页（FGUI `购买状态`：`0,可购买 / 1,不可购买`）。
 *
 * 🔴 是 **`>=`**（老端 `buyCount >= data.limit ? 1 : 0`）。
 * `limit` 为 0 时恒「不可购买」—— 表里没这么填，但别改成 `>`。
 */
export function purchaseStateOf(buyCount: number, limit: number): number {
    return buyCount >= limit ? 1 : 0;
}

/** 已购买次数（老端 `GetBuyCountBySubId`：`shopInfos[subId - 1] || 0`）。 */
export function buyCountOf(server: ICelebrationServerState | null, subId: number): number {
    if (!server) return 0;
    return toCount(server.shopInfos[subId - 1]);
}

/** `payChannel.id` → 真实金额（元）；查不到退化成 `rmbId`。 */
export function realRmbOf(payRows: readonly ICelebrationPayChannelRow[], rmbId: number): number {
    for (const row of payRows) if (row.id === rmbId) return row.rmb > 0 ? row.rmb : rmbId;
    return rmbId;
}

/**
 * 商品卡的支付分支（老端 `renderShopListItem` 的 `if (data.rmb) … else …`）。
 *
 * ```
 * rmb 分支 : buyType=rmb  ; lab_old_price = data.price     ; lab_price = payChannel.rmb ; 显 ￥(RmbSign3)
 * cost 分支: buyType=cost ; lab_old_price = `${data.price}`; lab_price = data.costCount  ; 显 icon_cost
 * ```
 *
 * ⚠️ `data.rmb` 是 **`payChannel.id`**（不是元）⇒ 价格必须过一次 `realRmbOf`。
 * 老端 `setText(data.price)` 传的是 **number**（FGUI 自己转字符串）；这里显式 `String()`，
 * 免得落到 `cc.Label.string` 上变成 `0`（`Label.string` 是 string 类型，传 number 会被强转，
 * 但 `undefined` 会变 `"undefined"`）。
 */
export function pricingOf(
    row: ICelebrationShopRow,
    payRows: readonly ICelebrationPayChannelRow[],
): ICelebrationShopPricing {
    if (row.rmb > 0) {
        return {
            branch: 'rmb',
            oldPriceText: String(row.price),
            priceText: String(realRmbOf(payRows, row.rmb)),
            costIconResId: 0,
            showRmbSign: true,
            showCostIcon: false,
        };
    }
    return {
        branch: 'cost',
        oldPriceText: String(row.price),
        priceText: String(row.costCount),
        costIconResId: row.costType,
        showRmbSign: false,
        showCostIcon: true,
    };
}

// ============================================================
// 时间
// ============================================================

/** 取某个 `rankType` 的时间窗；读不到 `null`。 */
export function rankTimeOf(
    rankTimes: ReadonlyMap<number, ICelebrationRankTime>,
    rankType: number,
): ICelebrationRankTime | null {
    return rankTimes.get(rankType) ?? null;
}

/**
 * 排名是否处在活动期内（老端 `VORank.Actived`）。
 *
 * ```
 * now >= startTime && now <= endTime
 * ```
 *
 * ⚠️ `startTime <= 0`（服务端还没推 / 推了 0）⇒ **false**。
 * 老端 `VarOSRankShow.OnComputeResult` 更严：`startTime == null || startTime <= 0` 直接 `false`。
 */
export function rankActiveOf(time: ICelebrationRankTime | null, nowMs: number): boolean {
    if (!time) return false;
    if (time.startTimeMs <= 0) return false;
    return nowMs >= time.startTimeMs && nowMs <= time.endTimeMs;
}

/**
 * `enabled`（老端 `ModelCelebration.Enabled` 的替代口径，见文件头）。
 *
 * = `rankActiveOf(rankTime, now)` 且**有 server 行**（老端第二半条件是
 * `VOCelebrationBag.GetFirstOne() != null`，而 `GetFirstOne` 本身就只返回 `Actived()` 的）。
 */
export function enabledOf(
    rankTime: ICelebrationRankTime | null,
    server: ICelebrationServerState | null,
    nowMs: number,
): boolean {
    if (!server) return false;
    return rankActiveOf(rankTime, nowMs);
}

/**
 * 倒计时偏移（老端 `LayerOSRankUI.UpdateTime`）：`EndTime() - 3e5 - now`。
 *
 * ⚠️ 老端是**减** 3e5：活动结束前 5 分钟倒计时就归 0（提前收口，避免最后一刻还能点）。
 * ⇒ 这个值**可以是负数**，页面按 0 显示，别在这里 `Math.max(0, …)` 抹掉语义
 * （`UpdateTime` 的判据是「归零即停」，不是「显示 0」）。
 */
export function countdownOffsetOf(endTimeMs: number, nowMs: number): number {
    return endTimeMs - CL_COUNTDOWN_LEAD_MS - nowMs;
}

// ============================================================
// 选中哪一行 server（老端 `VOCelebrationBag.GetFirstOne`）
// ============================================================

/**
 * 从 `CmdCelebrationInfo` 全表里选出**第一行处于活动期的**。
 *
 * 老端 `GetFirstOne()`：遍历 bag，返回第一个 `Actived()` 为 true 的 VO
 * （`Actived` → `VORankBag` 里同 `rankType` 的 `VORank.Actived()`）。
 * 一个活跃的都没有 ⇒ 返回 `null` ⇒ `Enabled()` false ⇒ 入口 / 面板都不显示。
 *
 * ⚠️ **不要**退化成「取第一行」：服务端会同时下发多个庆典（一份 `CmdCelebrationInfo` 一行），
 * 取第一行会在旧庆典过期后展示错的那一个 —— 而且**不报错**，只是数据全错。
 */
export function pickActiveServer(
    servers: readonly ICelebrationServerState[],
    rankTimes: ReadonlyMap<number, ICelebrationRankTime>,
    nowMs: number,
): ICelebrationServerState | null {
    for (const s of servers) {
        if (rankActiveOf(rankTimes.get(s.id) ?? null, nowMs)) return s;
    }
    return null;
}

/**
 * 数字缩写（**逐字复刻老端 `StringUtil.numAbbr`**）。
 *
 * | 阈值 | 输出 |
 * |---|---|
 * | `>= 1e10` | `floor(n / 1e9) + 'G'` |
 * | `>= 1e7`  | `floor(n / 1e6) + 'M'` |
 * | `>= 1e4`  | `floor(n / 1e3) + 'k'` |
 * | 其他      | `floor(n)` |
 *
 * 🔴 **不要换成 `StringUtil.formatNumberToKMBT`** —— 名字像、语义完全不同：
 * 后者是 `T/B/M/K` 四档（`1e12 / 1e9 / 1e6 / 1e3`），阈值差 1000 倍。
 * 老端详细排行那行战力走的是 `numAbbr`（`LayerOSRankDetailUI.renderItem`）。
 * 换成 KMBT 会在 `1e7 ~ 1e9` 区间给出**不同**的显示（`numAbbr` 是 `N M`、
 * KMBT 是 `N M` 但分母不同）—— 不报错，只是同一战力两种数。
 *
 * ⚠️ 小写 `k`（老端原文），不是 `K`。
 */
export function numAbbrOf(value: number): string {
    const n = Number.isFinite(value) ? value : 0;
    const abs = Math.abs(n);
    if (abs >= 1e10) return `${Math.floor(n / 1e9)}G`;
    if (abs >= 1e7) return `${Math.floor(n / 1e6)}M`;
    if (abs >= 1e4) return `${Math.floor(n / 1e3)}k`;
    return `${Math.floor(n)}`;
}

/** 两段补零。 */
function pad2(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}

/**
 * `HH:MM:SS` 倒计时文案 —— 老端 `TimeUtil.timeMillisecond2HMSStr(ms)`。
 *
 * ```
 * timeSec2HMSStr(Math.ceil(ms * 0.001))
 * ```
 *
 * ⚠️ 秒数是 **`Math.ceil`（进位）**，不是截断。改成 `floor` 会让 `3_599_999ms` 显示
 * `00:59:59` 而非 `01:00:00`。
 *
 * ⚠️ 与 `HangTable.formatHms` 是同一份实现的两个副本（各模块自足，家族约定）。
 * 改这里不影响那边 —— 两处的**共同真源**是老端 `TimeUtil.timeMillisecond2HMSStr`。
 *
 * ⚠️ 本函数**把负数钳到 0**（⇒ `00:00:00`）。老端没有这个钳制：
 * `LayerOSRankUI.UpdateTime` 传的 `offset = end - 3e5 - now` 在最后 5 分钟内就是负的，
 * 老端把它丢给 `timeSec2HMS` 做取余 ⇒ 输出 `0-1:0-1:0-59` 这类垃圾。
 * 这里钳成 `00:00:00` 是**有意的偏离**（老端行为是缺陷，不是设计）。
 */
export function countdownHmsOf(ms: number): string {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** 洗 `CmdCelebrationInfo` 缓存行。 */
export function parseServerStates(values: unknown): ICelebrationServerState[] {
    if (!Array.isArray(values)) return [];
    const out: ICelebrationServerState[] = [];
    for (const raw of values) {
        const r = asRow(raw);
        if (!r) continue;
        const id = toCount(r.id);
        if (id <= 0) continue;
        out.push({
            id,
            curValue: toCount(r.curValue),
            targetInfos: Array.isArray(r.targetInfos) ? r.targetInfos.map(toCount) : [],
            shopInfos: Array.isArray(r.shopInfos) ? r.shopInfos.map(toCount) : [],
        });
    }
    return out;
}
