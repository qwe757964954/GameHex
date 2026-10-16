/**
 * 战令的数据端口 —— **表 + 服务器状态 + 网络请求** 三合一的 Repository。
 *
 * 与 `GiftRepository` / `SevenDayRepository` / `LayerActivityRepository` 同一套分层：
 * 页面只依赖本文件，判定逻辑全在 `BattleTokenTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * ## 数据来源
 *
 * | # | 来源 | 用途 |
 * |---|---|---|
 * | ① | `battleTokenPlan` / `battleTokenReward` / `battleTokenConfig` | 档位价格、每级奖励、等级上限 |
 * | ② | `item` + `roleProperty` | 奖励格的品质框 + 图标（**两支分流**，唯一入口 `resolveRewardIconRef`） |
 * | ③ | `payChannel` | `battleTokenPlan.rmb` 是 **`payChannel.id`**，真实金额要从表里查 |
 * | ④ | `CacheMgr.instance.getCmdBattleToken(type)` | 等级 / 经验 / 结束时间 / 各档位开没开 |
 *
 * ## ⚠️ 走 `CacheMgr`，不自己存快照
 *
 * `assets/resources/config/protoCache.json` 里**有** `CmdBattleToken`（key = `type`）⇒
 * 服务端会主动推（还有 `CmdBattleTokenOpenBroMsg`），`GameNet` 收包时已写进 `GameCache`。
 * 所以每次 `load()` 现读，**不要自己存一份**。
 *
 * ## ⚠️ 没有「拉取战令数据」这一步
 *
 * `Cmd.d.ts` 里没有 `CmdBattleTokenReqMsg`（只有 Open / TakeReward / Reset 三个），
 * 老端 `ModelBattleToken.enter()` 也只读缓存。缓存为空 = 服务端还没推 / 离线，
 * 界面按 0 级渲染即可，**不要造一个假请求**。
 *
 * ## ⚠️ 支付链路要走完「业务前置请求 → 中心服支付」
 *
 * 老端 `BattleTokenCodeSharing.unlock()` 的顺序是：先发 `CmdBattleTokenOpenReqMsg`，
 * 拿到 `rsp.ret === true` **之后**再 `SDKMgr.pay(payRef.id, "common", 0)`。
 * `FW.pay` 是 Demo3.8 统一支付出口；如果只收到 `rsp.ret === true` 却不调它，
 * 中心服不会建单 / 发货，表现就是「点购买有回包，但战令始终没开通」。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    BT_CFG_LEVEL_UP_COST,
    BT_CFG_MAX_LEVEL,
    BT_CFG_RESET_COST,
    BT_FALLBACK_MAX_LEVEL,
    buildLevelRows,
    endSecondsOf,
    parseConfigRows,
    parsePlanRows,
    parseRewardRows,
} from './BattleTokenTable';
import type { ILevelRow, IPlanRow, IRewardRow } from './BattleTokenTable';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
import {
    RequestBattleTokenOpen,
    RequestBattleTokenReset,
    RequestBattleTokenTakeReward,
} from './RequestBattleTokenMsg';

/** 一个档位的服务器状态（老端 `VOBattleToken` 的界面所需子集）。 */
export interface IPlanState {
    /** 该档位开没开。 */
    readonly open: boolean;
    /**
     * 服务端记录的已领取等级（`tlTakeLevel`）。
     *
     * ⚠️ `null` 表示**服务端连这个字段都没给**（与「给了空数组」语义不同）——
     * 老端 `renderItem` 对这两种情况的处理不一样（见 `BattleTokenTable.rewardSlotState`）。
     */
    readonly takenLevels: readonly number[] | null;
}

/** 一个类型号的完整状态。 */
export interface ITokenState {
    readonly type: number;
    /** 等级（缺省 0）。 */
    readonly level: number;
    readonly exp: number;
    /** 结束时间（**秒**；读不到为 0）。 */
    readonly endSeconds: number;
    /** `battleTokenPlan.resId` → 该档位开没开。 */
    readonly planStates: ReadonlyMap<number, IPlanState>;
}

/** 一次界面刷新要的全部数据。 */
export interface IBattleTokenSnapshot {
    readonly plans: readonly IPlanRow[];
    readonly rewards: readonly IRewardRow[];
    /** `battleTokenConfig` 的 key → 原始值（`lotterylevelUpCostEnd` 是字符串）。 */
    readonly config: ReadonlyMap<string, unknown>;
    /** `item` 表（`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `roleProperty` 表（`iconIsPath = false`，战令奖励几乎全落这里）。 */
    readonly resources: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `payChannel.id` → 真实金额（元）。 */
    readonly payRmb: ReadonlyMap<number, number>;
    /** `CmdBattleTokenType` → 状态。 */
    readonly states: ReadonlyMap<number, ITokenState>;
    readonly now: number;
}

/**
 * 请求结果。
 *
 * `rejected` 是**开通**专有的第四态：网络走通了、但服务端 `ret === false`
 * （= 这一档已经开过了）⇒ 老端此时**什么都不做**（既不提示也不支付），界面弹「已开通」提示。
 * 领奖 / 重置只会返回前三态。
 */
export type BattleTokenRequestResult = 'ok' | 'offline' | 'failed' | 'rejected';

export interface IBattleTokenRepository {
    /** 读表 + 读缓存，组装一次快照；**不发任何请求**。 */
    load(nowMs?: number): Promise<IBattleTokenSnapshot>;
    /** 开通一个档位；人民币档的 `payChannelId` = `battleTokenPlan.rmb`，道具档传 0。 */
    openPlan(resId: number, payChannelId: number, caller?: unknown): Promise<BattleTokenRequestResult>;
    /** 领取某个档位某一级的奖励。 */
    takeReward(type: number, resId: number, level: number, caller?: unknown): Promise<BattleTokenRequestResult>;
    /** 重置战令。 */
    reset(caller?: unknown): Promise<BattleTokenRequestResult>;
    /** 当前缓存的某个类型的状态（调试 / 测试用）。 */
    peekState(type: number): ITokenState;
}

/** 请求超时（与首充 / 七日 / 礼包同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 取一个类型的状态（`CacheMgr` 里没有就返回一个 0 级空状态）。 */
function readState(type: number): ITokenState {
    const empty: ITokenState = {
        type,
        level: 0,
        exp: 0,
        endSeconds: 0,
        planStates: new Map<number, IPlanState>(),
    };
    let cmd: any = null;
    try {
        cmd = (CacheMgr.instance as any)?.getCmdBattleToken(type);
    } catch (error) {
        console.warn('[BattleToken] 读 CmdBattleToken 缓存失败', error);
        return empty;
    }
    if (!cmd) return empty;

    const planStates = new Map<number, IPlanState>();
    const list = Array.isArray(cmd.tlBattleTokenMessage) ? cmd.tlBattleTokenMessage : [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const resId = Number((item as Record<string, unknown>).resId);
        if (!Number.isFinite(resId) || resId <= 0) continue;
        const rawTaken = (item as Record<string, unknown>).tlTakeLevel;
        planStates.set(resId, {
            open: !!(item as Record<string, unknown>).open,
            // `undefined` ⇒ null（字段缺失）；`[]` ⇒ 空数组，两者语义不同
            takenLevels: Array.isArray(rawTaken) ? rawTaken.map((n) => Number(n)) : null,
        });
    }

    return {
        type,
        level: Number(cmd.level) || 0,
        exp: Number(cmd.exp) || 0,
        endSeconds: endSecondsOf(cmd.endTime),
        planStates,
    };
}

/** 读 `payChannel` 全表 → `id` → 金额。表缺失时返回空 Map（价格文案退化成空串）。 */
async function readPayChannels(): Promise<ReadonlyMap<number, number>> {
    const rows = await readRows('payChannel');
    const map = new Map<number, number>();
    for (const raw of rows) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        const id = Number(r.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        map.set(id, Number(r.rmb) || 0);
    }
    return map;
}

/** 生产环境 Repository。 */
export class RuntimeBattleTokenRepository implements IBattleTokenRepository {
    async load(nowMs: number = Date.now()): Promise<IBattleTokenSnapshot> {
        const [planRows, rewardRows, cfgRows, itemRows, resRows, payRmb] = await Promise.all([
            readRows('battleTokenPlan'),
            readRows('battleTokenReward'),
            readRows('battleTokenConfig'),
            readRows('item'),
            readRows('roleProperty'),
            readPayChannels(),
        ]);

        // 本轮做的 4 个页签各读一次状态（转盘 5/6 不读）
        const states = new Map<number, ITokenState>();
        for (const type of [1, 2, 3, 4]) states.set(type, readState(type));

        return {
            plans: parsePlanRows(planRows),
            rewards: parseRewardRows(rewardRows),
            config: parseConfigRows(cfgRows),
            items: parseItemRows(itemRows),
            resources: parseRolePropertyRows(resRows),
            payRmb,
            states,
            now: nowMs,
        };
    }

    peekState(type: number): ITokenState {
        return readState(type);
    }

    /** 开通档位：先发业务前置请求；`ret === true` 才是「服务端同意开通」。 */
    async openPlan(resId: number, payChannelId: number, caller?: unknown): Promise<BattleTokenRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let ret: boolean | null = null;
        const callback = (rsp: any): void => {
            ret = !!(rsp && rsp.ret);
        };

        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
            const sent = await withTimeout(
                net.send(new RequestBattleTokenOpen({ resId }, caller as any, callback), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[BattleToken] 开通档位失败', error);
            return 'failed';
        }
        // `ret === false` ⇒ 服务端说这一档已经开过了（老端此时静默）
        if (ret === false) return 'rejected';
        // 道具付费由游戏服在 Open 请求中直接扣除；只有人民币档继续走中心服支付。
        if (ret === true && payChannelId > 0) FW.pay(payChannelId, 'common', 0);
        return 'ok';
    }

    /** 领取奖励。 */
    async takeReward(type: number, resId: number, level: number, caller?: unknown): Promise<BattleTokenRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: CmdBattleTokenTakeRewardRspMsg): void => {
            FW.ShowReward(rsp?.tlReward ?? []);
            applied = true;
        };

        try {
            const sent = await withTimeout(
                net.send(
                    new RequestBattleTokenTakeReward(
                        { takeAll: true, resId, level, type },
                        caller as any,
                        callback,
                    ),
                    false,
                ),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[BattleToken] 领取奖励失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }

    /** 重置战令。 */
    async reset(caller?: unknown): Promise<BattleTokenRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        try {
            const sent = await withTimeout(
                net.send(new RequestBattleTokenReset({}, caller as any, () => { applied = true; }), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[BattleToken] 重置战令失败', error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }
}

export const battleTokenRepository: IBattleTokenRepository = new RuntimeBattleTokenRepository();

/** 读一次超时常量给测试用（避免测试里硬编码 800/5000）。 */
export const BT_READ_TIMEOUT_MS = READ_TIMEOUT_MS;
export const BT_WRITE_TIMEOUT_MS = WRITE_TIMEOUT_MS;

// ============================================================
// 快照上的便捷查询（页面直接调，不必自己拼）
// ============================================================

/** 取某类型的状态；快照里没有时返回一个 0 级空状态。 */
export function stateOf(snapshot: IBattleTokenSnapshot, type: number): ITokenState {
    return snapshot.states.get(type) ?? {
        type, level: 0, exp: 0, endSeconds: 0, planStates: new Map<number, IPlanState>(),
    };
}

/** 取某档位的状态（`resId` = `battleTokenPlan.resId`）。 */
export function planStateOf(state: ITokenState, resId: number): IPlanState | null {
    return state.planStates.get(resId) ?? null;
}

/** 该类型的等级上限（配置缺失时兜底 50）。 */
export function maxLevelOf(snapshot: IBattleTokenSnapshot): number {
    const v = snapshot.config.get(BT_CFG_MAX_LEVEL);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : BT_FALLBACK_MAX_LEVEL;
}

/** 升级所需经验（配置缺失时兜底 0）。 */
export function levelUpCostOf(snapshot: IBattleTokenSnapshot): number {
    const v = snapshot.config.get(BT_CFG_LEVEL_UP_COST);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 重置所需消耗（配置缺失时兜底 0）。 */
export function resetCostOf(snapshot: IBattleTokenSnapshot): number {
    const v = snapshot.config.get(BT_CFG_RESET_COST);
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 付费档位在按钮上显示的金额文案。
 *
 * `battleTokenPlan.rmb` 是 **`payChannel.id`**（不是钱数）⇒ 必须查表换算。
 * 查不到时退化成 `￥<id>`（宁可显示怪数字，也不要空按钮）。
 */
export function payRmbOf(snapshot: IBattleTokenSnapshot, planId: number): number {
    return snapshot.payRmb.get(planId) ?? planId;
}

/** 奖励展示信息（`item` 优先，回落 `roleProperty`；都查不到返回 `null`）。 */
export function goodsOf(snapshot: IBattleTokenSnapshot, resId: number): IActivityGoodsInfo | null {
    return snapshot.items.get(resId) ?? snapshot.resources.get(resId) ?? null;
}

/** 该类型的分级行（页面初始化时算一次）。 */
export function rowsOf(snapshot: IBattleTokenSnapshot, type: number): ILevelRow[] {
    return buildLevelRows(snapshot.plans, snapshot.rewards, type, maxLevelOf(snapshot));
}
