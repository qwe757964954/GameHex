/**
 * 累计充值（活动体系）的数据端口 —— 表 + 服务器缓存 + 领奖请求。
 *
 * 与 `GiftRepository` / `RechargeDailyRepository` 同一套分层：页面只依赖本接口，
 * 判定全在 `RechargeActivityTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * 数据来源：
 *   ① 配置表 `activityTab`（页签 → `tlType` + 「活动介绍」正文）
 *   ② 配置表 `activity`（`activityRefId` → `{ type, name, plan }`）
 *   ③ 配置表 `rechargeGiftActPlan`（档位行，按 `plan` 分组）
 *   ④ 配置表 `item`（奖励格品质 + 图标）
 *   ⑤ 服务器缓存 `CmdActivity`（**已开启的活动实例**；服务端主动推，收包时已写进 GameCache）
 *   ⑥ 请求 `CmdTakeRechargeGiftActReward`（领某档位）
 *
 * ## ⚠️ 与「每日充值」的关键差异：进度在 `CmdActivity` 里，不在独立缓存里
 *
 * `rechargeDaily` 有一张**专属**缓存 `CmdRechargeDaily`；累计充值**没有**，
 * 它的进度挂在 `CmdActivity` 每行的 `detail.rechargeGiftActDetail` /
 * `cmdRechargeGiftAct2Detail` / `cmdRechargeGiftAct3Detail` 上（见 `RechargeActivityTable` 文件头 ①）。
 * 所以「活动没开启」和「没数据」是同一件事 —— 界面退化成空列表，不要造一个假请求。
 *
 * ## 没有「拉取活动列表」这一步
 *
 * 老端 `TabGiftRechargeTotal` 打开时只读 `VOActivityBag`（已有 `CmdActivity` 缓存），
 * `Cmd.d.ts` 里也只有 `CmdActivity` 推送 + `CmdTakeRechargeGiftActReward` 请求。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    buildRechargeTotalPageView,
    parseRechargeActPlanRows,
    parseRechargeActivityRows,
    parseRechargeTabRows,
    readRechargeActivities,
    rechargeTotalRedDot,
    RECHARGE_TAB,
} from './RechargeActivityTable';
import type {
    IRechargeActivityInfo,
    IRechargeActPlanRow,
    IRechargeTotalPageView,
} from './RechargeActivityTable';
import { RequestTakeRechargeGiftActReward } from './RequestRechargeActivityMsg';

/** 一次界面快照。 */
export interface IRechargeActivitySnapshot {
    /** 页签 `id` → 该页签的视图（`base` / `advanced` 两页）。 */
    readonly pages: ReadonlyMap<number, IRechargeTotalPageView>;
    /** 当前已开启的充值活动（原样留着，页签红点、宝箱都要用）。 */
    readonly activities: readonly IRechargeActivityInfo[];
    /** resId → 物品展示信息（品质 + 图标路径）。 */
    readonly items: ReadonlyMap<number, { readonly quality: number; readonly icon: string }>;
    /** 页签「充值好礼」显不显示。 */
    readonly advancedTabVisible: boolean;
    /** 三个页签里任一有可领奖励（老端 `hasRecharegeTotalRd`）。 */
    readonly hasRedDot: boolean;
    readonly now: number;
}

export type RechargeActivityRequestResult = 'ok' | 'offline' | 'failed';

export interface IRechargeActivityRepository {
    /** 读表 + 读缓存，组装一次快照；不发请求。 */
    load(nowMs?: number): Promise<IRechargeActivitySnapshot>;
    /** 领某档位的累计充值奖励（`activityId` = 活动实例 `openResId`）。 */
    claim(activityId: number, rechargeProcess: number, caller?: object): Promise<RechargeActivityRequestResult>;
}

const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读 `CmdActivity` 缓存；拿不到返回空数组。 */
function readCmdActivities(): unknown[] {
    try {
        return CacheMgr.instance?.getTlCmdActivity() ?? [];
    } catch (error) {
        console.warn('[RechargeActivity] 读 CmdActivity 缓存失败', error);
        return [];
    }
}

/** `item` 表 → 展示信息。 */
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

export class RuntimeRechargeActivityRepository implements IRechargeActivityRepository {
    async load(nowMs: number = Date.now()): Promise<IRechargeActivitySnapshot> {
        const [tabRows, activityRows, planRowArr, itemRows] = await Promise.all([
            readRows('activityTab'),
            readRows('activity'),
            readRows('rechargeGiftActPlan'),
            readRows('item'),
        ]);

        const tabMap = parseRechargeTabRows(tabRows);
        const activityMap = parseRechargeActivityRows(activityRows);
        const planRows: IRechargeActPlanRow[] = parseRechargeActPlanRows(planRowArr);
        const activities = readRechargeActivities(readCmdActivities(), activityMap);

        const pages = new Map<number, IRechargeTotalPageView>();
        for (const tab of [RECHARGE_TAB.base, RECHARGE_TAB.advanced]) {
            pages.set(tab, buildRechargeTotalPageView(tab, activities, planRows, tabMap));
        }

        return {
            pages,
            activities,
            items: parseItemMap(itemRows),
            advancedTabVisible: (pages.get(RECHARGE_TAB.advanced)?.advancedTabVisible) ?? false,
            hasRedDot: rechargeTotalRedDot(activities, planRows),
            now: nowMs,
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
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            const sent = await withTimeout(net.send(msg, false), WRITE_TIMEOUT_MS, () => false);
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn('[RechargeActivity] 领奖请求失败', error);
            return 'failed';
        }
        return 'ok';
    }
}

export const rechargeActivityRepository: IRechargeActivityRepository =
    new RuntimeRechargeActivityRepository();
