/**
 * 累计充值的数据端口：读取活动相关配置和 `CmdActivity` 缓存，并发送领奖请求。
 *
 * 活动进度挂在 `CmdActivity.detail` 上，没有独立的拉取请求；缓存为空时界面按无活动处理。
 */

import { FW } from '../../framework/FW';
import { RefUtil } from '../../framework/ref/RefUtil';
import { readRefRows } from '../common/TableRead';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import type { IRechargeActivityInfo, IRechargeTotalPageView } from './RechargeActivityTable';
import {
    RECHARGE_TAB,
    buildRechargeTotalPageView,
    parseRechargeActPlanRows,
    parseRechargeActivityRows,
    parseRechargeTabRows,
    readRechargeActivities,
    rechargeTotalRedDot,
} from './RechargeActivityTable';
import { parseRechargeItemMap } from './RechargeItemMap';
import { RequestTakeRechargeGiftActReward } from './RequestRechargeActivityMsg';

import { ACTIVITY_TABLE, ACTIVITY_TAB_TABLE, ITEM_TABLE } from '../../core/config/TableNames';
import type { INetRequestStatus } from '../../core/types/NetResult';
import { WRITE_TIMEOUT_MS } from '../net/Timeouts';
/** 一次界面快照。 */
export interface IRechargeActivitySnapshot {
    /** 页签 `id` → 该页签的视图。 */
    readonly pages: ReadonlyMap<number, IRechargeTotalPageView>;
    readonly activities: readonly IRechargeActivityInfo[];
    readonly items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>;
    readonly advancedTabVisible: boolean;
    /** 两个充值页签是否有可领奖励，供 `RdVars` 的礼包聚合红点使用。 */
    readonly hasRedDot: boolean;
}

export type RechargeActivityRequestResult = INetRequestStatus;

export interface IRechargeActivityRepository {
    /** 读表 + 读缓存，组装一次快照；不发请求。 */
    load(): Promise<IRechargeActivitySnapshot>;
    /** 领某档位的累计充值奖励。 */
    claim(activityId: number, rechargeProcess: number, caller?: object): Promise<RechargeActivityRequestResult>;
}


const readRows = (table: string): Promise<unknown[]> => readRefRows(RefUtil.instance, table);

/** 读 `CmdActivity` 缓存；拿不到返回空数组。 */
function readCmdActivities(): unknown[] {
    try {
        return CacheMgr.instance.getTlCmdActivity() ?? [];
    } catch (error) {
        console.warn('[RechargeActivity] 读 CmdActivity 缓存失败', error);
        return [];
    }
}

export class RuntimeRechargeActivityRepository implements IRechargeActivityRepository {
    async load(): Promise<IRechargeActivitySnapshot> {
        const [tabRows, activityRows, planRowArr, itemRows] = await Promise.all([
            readRows(ACTIVITY_TAB_TABLE),
            readRows(ACTIVITY_TABLE),
            readRows('rechargeGiftActPlan'),
            readRows(ITEM_TABLE),
        ]);

        const tabMap = parseRechargeTabRows(tabRows);
        const activityMap = parseRechargeActivityRows(activityRows);
        const planRows = parseRechargeActPlanRows(planRowArr);
        const activities = readRechargeActivities(readCmdActivities(), activityMap);

        const pages = new Map<number, IRechargeTotalPageView>();
        for (const tab of [RECHARGE_TAB.base, RECHARGE_TAB.advanced]) {
            pages.set(tab, buildRechargeTotalPageView(tab, activities, planRows, tabMap));
        }

        return {
            pages,
            activities,
            items: parseRechargeItemMap(itemRows),
            advancedTabVisible: pages.get(RECHARGE_TAB.advanced)?.advancedTabVisible ?? false,
            hasRedDot: rechargeTotalRedDot(activities, planRows),
        };
    }

    async claim(
        activityId: number,
        rechargeProcess: number,
        caller?: object,
    ): Promise<RechargeActivityRequestResult> {
        const msg = new RequestTakeRechargeGiftActReward(
            { resId: activityId, rechargeProcess },
            caller,
            (rsp) => FW.ShowReward(rsp?.tlReward ?? []),
        );
        return GameNet.sendRequest(() => msg, { timeoutMs: WRITE_TIMEOUT_MS, tag: 'RechargeActivity' });
    }
}

export const rechargeActivityRepository: IRechargeActivityRepository =
    new RuntimeRechargeActivityRepository();
