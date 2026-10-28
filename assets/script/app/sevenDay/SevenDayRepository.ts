/**
 * 七日狂欢的数据端口 —— **表 + 服务器状态 + 网络请求** 三合一的 Repository。
 *
 * 与 `FirstRechargeRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `SevenDayTable`（纯函数、可单测），本文件只负责「把数据搬进来」。
 *
 * 数据来源：
 *   ① 配置表 `sevenDayTask` / `sevenDayShop` / `sevenDayPoint`（`assets/remoteRef/*.json`，走 `RefUtil`）；
 *   ② 服务器状态 `CmdSevenDayInfo`；
 *   ③ 请求 `CmdSevenDayInfo` / `…TakeTaskReward` / `…ShopBuy` / `…TakePointReward`。
 *
 *  ⚠️ **服务器状态是内存持有的，不走 `CacheMgr`**（与首充不同，这点是老端口径）：
 *  `assets/resources/config/protoCache.json` 里**没有** `CmdSevenDayInfo` —— 服务端不推这张表，
 *  它是随每个响应体回来的。所以 `GameCache` 那套「按 key 查」用不上，本类自己存一份快照，
 *  四条 rsp 谁回来就用谁带的 `cmdSevenDayInfo` 整体覆盖。
 *  （首充那张 `CmdFirstRechargeNew` 在 protoCache 里，所以那边走 `CacheMgr` —— 别照抄错。）
 *
 *  ⚠️ 内存态是**模块级单例**的字段，退出界面不清：老端 `ModelSevenday` 也活在常驻 ModelMgr 里，
 *  清了会导致「关掉再打开先闪一帧全未完成」。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { toCount, toIdString, withTimeout } from '../net/RequestGuard';
import {
    deriveCurDay,
    deriveEndTimeMs,
    deriveTaskMaxDay,
    EMPTY_SEVEN_DAY_STATE,
    parseItemRows,
    parsePointRows,
    parseShopRows,
    parseTaskRows,
    SEVEN_DAY_FALLBACK_MAX_DAY,
} from './SevenDayTable';
import type {
    ISevenDayItemInfo,
    ISevenDayPointRow,
    ISevenDayShopRow,
    ISevenDayServerState,
    ISevenDayTaskRow,
    ISevenDayTaskServerState,
} from './SevenDayTable';
import {
    RequestSevenDayInfo,
    RequestSevenDayShopBuy,
    RequestSevenDayTakePointReward,
    RequestSevenDayTakeTaskReward,
} from './RequestSevenDayMsg';

/** 一次界面刷新要的全部数据。 */
export interface ISevenDaySnapshot {
    readonly tasks: readonly ISevenDayTaskRow[];
    readonly shops: readonly ISevenDayShopRow[];
    readonly boxes: readonly ISevenDayPointRow[];
    /** `item` 表（奖励展示用：品质 + 图标名）。 */
    readonly items: ReadonlyMap<number, ISevenDayItemInfo>;
    readonly state: ISevenDayServerState;
    /** 创角第几天（1 起）。 */
    readonly curDay: number;
    /** 任务 / 商品表实际配置的天数（天数按钮按它渲染）。 */
    readonly taskMaxDay: number;
    /** 活动结束时间（毫秒）；算不出来时是 `0`。 */
    readonly endTimeMs: number;
    /** 这次快照的时间基准（毫秒）。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type SevenDayRequestResult = 'ok' | 'offline' | 'failed';

export interface ISevenDayRepository {
    /** 读表 + 读内存状态，组装一次快照；**不发请求**。 */
    load(nowMs?: number): Promise<ISevenDaySnapshot>;
    /** 打开界面时向服务端要一次最新状态；失败不抛错。 */
    refreshFromServer(caller?: object): Promise<boolean>;
    /** 领取第 `day` 天的任务奖励（服务端按天结算）。 */
    claimTaskReward(day: number, caller?: object): Promise<SevenDayRequestResult>;
    /** 购买一个商品（`id` = `sevenDayShop.id`）。 */
    buyShop(id: number, caller?: object): Promise<SevenDayRequestResult>;
    /** 领取一个积分宝箱（`resId` = `sevenDayPoint.resId`）。 */
    claimBox(resId: number, caller?: object): Promise<SevenDayRequestResult>;
    /** 当前内存里的服务器状态（调试 / 测试用）。 */
    peekState(): ISevenDayServerState;
}

/** 请求超时（与首充同口径：读 800ms / 写 5000ms）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/**
 * 创角时间（毫秒）。读不到返回 `0` —— 此时 `deriveCurDay` 会退化成「第 1 天」，
 * 界面只解锁第一天，不会把所有天都点亮（那是更危险的失败方向）。
 */
function readCreateTimeMs(): number {
    try {
        const rows = CacheMgr.instance.getTlCmdRole() ?? [];
        for (const row of rows) {
            if (!row) continue;
            const ms = Number(toIdString(row.createTime));
            if (Number.isFinite(ms) && ms > 0) return ms;
        }
    } catch (error) {
        console.warn('[SevenDay] 读 CmdRole 缓存失败', error);
    }
    return 0;
}

/** 把 `CmdSevenDayInfo`（`unknown` 形状）收敛成 `ISevenDayServerState`。 */
export function normalizeServerState(info: unknown): ISevenDayServerState {
    if (!info || typeof info !== 'object') return EMPTY_SEVEN_DAY_STATE;
    const raw = info as Record<string, unknown>;

    const pointRaw = (raw.cmdSevenDayPoint ?? null) as Record<string, unknown> | null;
    const point = pointRaw ? toCount(pointRaw.point) : 0;
    const takenBoxIds: number[] = [];
    const ids = pointRaw?.tlIds;
    if (Array.isArray(ids)) {
        for (const id of ids) takenBoxIds.push(toCount(id));
    }

    const tasks = new Map<number, ISevenDayTaskServerState>();
    const taskList = raw.tlCmdTask;
    if (Array.isArray(taskList)) {
        for (const item of taskList) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const resId = toCount(row.resId);
            if (resId <= 0) continue;
            tasks.set(resId, { count: toCount(row.count), rewardState: toCount(row.rewardState) });
        }
    }

    const shops = new Map<number, number>();
    const shopList = raw.tlCmdSevenDayShop;
    if (Array.isArray(shopList)) {
        for (const item of shopList) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const id = toCount(row.id);
            if (id <= 0) continue;
            shops.set(id, toCount(row.buyTimes));
        }
    }

    return { point, takenBoxIds, tasks, shops };
}

/** 生产环境 Repository。 */
export class RuntimeSevenDayRepository implements ISevenDayRepository {
    /** 服务器状态快照（模块级单例共享，见文件头说明）。 */
    private state: ISevenDayServerState = EMPTY_SEVEN_DAY_STATE;

    async load(nowMs: number = Date.now()): Promise<ISevenDaySnapshot> {
        const [taskRows, shopRows, pointRows, itemRows] = await Promise.all([
            readRows('sevenDayTask'),
            readRows('sevenDayShop'),
            readRows('sevenDayPoint'),
            readRows('item'),
        ]);

        const tasks = parseTaskRows(taskRows);
        const shops = parseShopRows(shopRows);
        const boxes = parsePointRows(pointRows);
        const createTimeMs = readCreateTimeMs();

        return {
            tasks,
            shops,
            boxes,
            items: parseItemRows(itemRows),
            state: this.state,
            curDay: deriveCurDay(createTimeMs, nowMs),
            taskMaxDay: deriveTaskMaxDay(tasks, shops),
            endTimeMs: deriveEndTimeMs(createTimeMs, SEVEN_DAY_FALLBACK_MAX_DAY),
            now: nowMs,
        };
    }

    peekState(): ISevenDayServerState {
        return this.state;
    }

    async refreshFromServer(caller?: object): Promise<boolean> {
        const net = GameNet.instance;
        if (!net.isConnected) return false;
        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬，
            //    界面会卡在「加载中」再也不刷新（连线失败也一样）。
            const sent = await withTimeout(
                net.send(new RequestSevenDayInfo({}, caller, (rsp) => {
                    this.applyServerInfo(rsp?.cmdSevenDayInfo);
                }), false),
                READ_TIMEOUT_MS,
                () => false,
            );
            return sent === true;
        } catch (error) {
            console.warn('[SevenDay] 拉取活动信息失败', error);
            return false;
        }
    }

    async claimTaskReward(day: number, caller?: object): Promise<SevenDayRequestResult> {
        return this.writeRequest(
            (cb) => new RequestSevenDayTakeTaskReward({ day }, caller, cb),
            '领取任务奖励',
        );
    }

    async buyShop(id: number, caller?: object): Promise<SevenDayRequestResult> {
        return this.writeRequest(
            (cb) => new RequestSevenDayShopBuy({ id }, caller, cb),
            '购买商品',
        );
    }

    async claimBox(resId: number, caller?: object): Promise<SevenDayRequestResult> {
        return this.writeRequest(
            (cb) => new RequestSevenDayTakePointReward({ resId }, caller, cb),
            '领取积分宝箱',
        );
    }

    /** 写请求的公共壳：离线早退、超时兜底、成功后覆盖快照。 */
    private async writeRequest(
        build: (cb: (rsp: any) => void) => unknown,
        label: string,
    ): Promise<SevenDayRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        let applied = false;
        const callback = (rsp: any): void => {
            if (rsp) {
                // 服务端在 rsp 里回带整份新状态 —— 直接覆盖，不做增量合并（老端同）。
                this.applyServerInfo(rsp.cmdSevenDayInfo);
                FW.ShowReward(rsp.tlCmdGoods ?? []);
                applied = true;
            }
        };

        try {
            const sent = await withTimeout(
                net.send(build(callback) as any, false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn(`[SevenDay] ${label}请求失败`, error);
            return 'failed';
        }
        return applied ? 'ok' : 'failed';
    }

    /** 用服务端下发的整份信息覆盖本地快照。 */
    applyServerInfo(info: unknown): void {
        if (!info) return;
        this.state = normalizeServerState(info);
    }
}

export const sevenDayRepository: ISevenDayRepository = new RuntimeSevenDayRepository();
