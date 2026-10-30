/**
 * 每日充值的数据端口 —— 表 + 服务器缓存 + 领奖请求。
 *
 * 与 `GiftRepository` 同一套分层：页面只依赖本接口，判定全在 `RechargeDailyTable`（纯函数）。
 *
 * 数据来源：
 *   ① 配置表 `rechargeDaily`（走 RefUtil）；
 *   ② 服务器缓存 `CmdRechargeDaily`（服务端主动推，收包时已写进 GameCache）；
 *   ③ 配置表 `item`（奖励格品质 + 图标）；
 *   ④ 请求 `CmdRechargeDailyGetReward`（按天领）/ `CmdRechargeDailyGetAccReward`（累计领）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    buildRoundView,
    parseRechargeDailyRows,
    readRoundProgresses,
} from './RechargeDailyTable';
import type {
    IRechargeDailyReward,
    IRechargeDailyRoundView,
} from './RechargeDailyTable';
import {
    RequestRechargeDailyGetAccReward,
    RequestRechargeDailyGetReward,
} from './RequestRechargeDailyMsg';

/** 一次界面快照。 */
export interface IRechargeDailySnapshot {
    readonly rounds: readonly IRechargeDailyRoundView[];
    /** resId → 物品展示信息（品质 + 图标路径）。 */
    readonly items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>;
    readonly now: number;
}

export type RechargeDailyRequestResult = 'ok' | 'offline' | 'failed';

export interface IRechargeDailyRepository {
    /** 读表 + 读缓存，组装一次快照；不发请求。 */
    load(nowMs?: number): Promise<IRechargeDailySnapshot>;
    /** 领某档某天的每日奖励。 */
    claimDay(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult>;
    /** 领某档累计第 day 天的奖励。 */
    claimAcc(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult>;
}

const WRITE_TIMEOUT_MS = 5000;

async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读 CmdRechargeDaily 第一行；拿不到返回 null。 */
function readCmd(): unknown {
    try {
        const rows = CacheMgr.instance.getTlCmdRechargeDaily() ?? [];
        for (const row of rows) {
            if (row) return row;
        }
    } catch (error) {
        console.warn('[RechargeDaily] 读 CmdRechargeDaily 缓存失败', error);
    }
    return null;
}

/** item 表 → 展示信息。 */
function parseItemMap(rows: readonly unknown[]): Map<number, { quality: number; icon: string }> {
    const map = new Map<number, { quality: number; icon: string }>();
    for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
        const r = row as Record<string, unknown>;
        const resId = Number(r.resId);
        if (!Number.isSafeInteger(resId) || resId <= 0) continue;
        map.set(resId, {
            quality: Number(r.quality) || 1,
            icon: typeof r.icon === 'string' ? r.icon : '',
        });
    }
    return map;
}

export class RuntimeRechargeDailyRepository implements IRechargeDailyRepository {
    async load(nowMs: number = Date.now()): Promise<IRechargeDailySnapshot> {
        const [rowArr, itemRows] = await Promise.all([
            readRows('rechargeDaily'),
            readRows('item'),
        ]);

        const rows = parseRechargeDailyRows(rowArr);
        const progresses = readRoundProgresses(readCmd());

        // 按 round 去重，每档一档视图；表里出现过的 round 都要（哪怕缓存空）。
        const roundSet = new Set<number>();
        for (const row of rows) roundSet.add(row.round);
        const rounds: IRechargeDailyRoundView[] = [];
        for (const round of Array.from(roundSet).sort((a, b) => a - b)) {
            rounds.push(buildRoundView(round, rows, progresses.get(round)));
        }

        return {
            rounds,
            items: parseItemMap(itemRows),
            now: nowMs,
        };
    }

    async claimDay(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult> {
        let applied = false;
        const msg = new RequestRechargeDailyGetReward({ id: round, day }, caller, (rsp) => {
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        });
        return this.sendClaim(msg);
    }

    async claimAcc(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult> {
        let applied = false;
        const msg = new RequestRechargeDailyGetAccReward({ id: round, day }, caller, (rsp) => {
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
            applied = true;
        });
        return this.sendClaim(msg);
    }

    private async sendClaim(
        msg: RequestRechargeDailyGetReward | RequestRechargeDailyGetAccReward,
    ): Promise<RechargeDailyRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            const sent = await withTimeout(
                net.send(msg, false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[RechargeDaily] 领奖请求失败', error);
            return 'failed';
        }
        return 'ok';
    }
}

export const rechargeDailyRepository: IRechargeDailyRepository = new RuntimeRechargeDailyRepository();

// 保留类型引用，避免被 tree-shake 误判未用。
export type { IRechargeDailyReward };
