/**
 * 每日充值的数据端口：读取 `rechargeDaily` 表、`CmdRechargeDaily` 缓存和 `item` 表，
 * 并发送单日/累计奖励的领取请求。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { readRefRows } from '../common/TableRead';
import { parseRechargeItemMap } from './RechargeItemMap';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    buildRoundView,
    parseRechargeDailyRows,
    readRoundProgresses,
} from './RechargeDailyTable';
import type { IRechargeDailyRoundView } from './RechargeDailyTable';
import {
    RequestRechargeDailyGetAccReward,
    RequestRechargeDailyGetReward,
} from './RequestRechargeDailyMsg';

/** 一次界面快照。 */
export interface IRechargeDailySnapshot {
    readonly rounds: readonly IRechargeDailyRoundView[];
    readonly items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>;
}

export type RechargeDailyRequestResult = 'ok' | 'offline' | 'failed';

export interface IRechargeDailyRepository {
    /** 读表 + 读缓存，组装一次快照；不发请求。 */
    load(): Promise<IRechargeDailySnapshot>;
    /** 领某档某天的每日奖励。 */
    claimDay(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult>;
    /** 领某档累计第 day 天的奖励。 */
    claimAcc(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult>;
}

const WRITE_TIMEOUT_MS = 5000;

const readRows = (table: string): Promise<unknown[]> => readRefRows(RefUtil.instance, table);

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

export class RuntimeRechargeDailyRepository implements IRechargeDailyRepository {
    async load(): Promise<IRechargeDailySnapshot> {
        const [rowArr, itemRows] = await Promise.all([
            readRows('rechargeDaily'),
            readRows('item'),
        ]);

        const rows = parseRechargeDailyRows(rowArr);
        const progresses = readRoundProgresses(readCmd());

        // 表里出现的每个 round 都要生成视图，即使缓存为空。
        const rounds = Array.from(new Set(rows.map((row) => row.round)))
            .sort((a, b) => a - b)
            .map((round) => buildRoundView(round, rows, progresses.get(round)));

        return {
            rounds,
            items: parseRechargeItemMap(itemRows),
        };
    }

    async claimDay(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult> {
        const msg = new RequestRechargeDailyGetReward({ id: round, day }, caller, (rsp) => {
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
        });
        return this.sendClaim(msg);
    }

    async claimAcc(round: number, day: number, caller?: object): Promise<RechargeDailyRequestResult> {
        const msg = new RequestRechargeDailyGetAccReward({ id: round, day }, caller, (rsp) => {
            FW.ShowReward(rsp?.tlCmdGoods ?? []);
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
