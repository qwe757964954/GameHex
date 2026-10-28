/**
 * 「活动 → 每日任务」的数据端口 —— **表 + 服务器缓存 + 网络请求** 三合一的 Repository。
 *
 * 与 `SevenDayRepository` / `MonthCardGiftRepository` 同一套分层：页面（`LayerActivityPage`）
 * 只依赖本文件的接口，判定逻辑全在 `LayerActivityTable`（纯函数、可单测），
 * 本文件只负责「把数据搬进来 / 发出去」。
 *
 * 数据来源：
 *   ① 配置表 `dayChallengeActTask` / `dayChallengeActTaskProgress` / `activityTab` /
 *      `activity` / `item` / `roleProperty`（`assets/remoteRef/*.json`，走 `RefUtil`）；
 *      `roleProperty` 是**货币 / 属性类**奖励的图标来源（银币 7 / 洗炼石 8 / 金币 10 /
 *      活跃度 15），它们不在 `item` 表里 —— 少了这张表，奖励格只剩品质框没有图标。
 *   ② 服务器状态 —— **走 `CacheMgr`，不走内存自持**（这点与七日狂欢相反）：
 *      `CmdActivity` 在 `assets/resources/config/protoCache.json` 里，是**登录同步 + 服务端推**的
 *      缓存表；`CacheMgr.instance.getTlCmdActivity()` 读它。
 *      周活跃积分在 `CmdRole.activityCoin`（`getTlCmdRole()`）。
 *   ③ 请求 `CmdTakeDayChallengeActRewardReqMsg` / `CmdTakeDayActProgressRewardReqMsg`。
 *
 * ## ⚠️ 领奖之后**必须靠缓存变更事件**重新取数，不能只等请求的 Promise
 *
 *  两条领奖协议的响应体**只有奖励、没有活动状态**（见 `RequestActivityMsg`），
 *  也就是「发完请求 → 马上重新 `load()`」拿到的还是**旧**状态，界面看着像没生效
 *  （症状：领完按钮还是「领取」，能反复点）。
 *
 *  老端靠 `VOBagSubset` 的 `OnChanged` 事件重铺界面（`TabDayChallengeActTask.InitListener`），
 *  这里等价地订阅 `GameCache` 的 `onChange`：`subscribe()` 之后的每一次 `CmdActivity`
 *  变化都会回调页面去 `reload()`。
 *
 * ## ⚠️ 本模块**没有** `refreshFromServer()`
 *
 *  老端这个界面打开时不发任何「拉取」请求（`TabDayChallengeActTask.init` 只读本地：
 *  `ModelMgr.ModelActivity.GetVoActivitySubSet` + `Ref` 表），活动数据由活动模块统一维护。
 *  所以这里不造一个「发出去但不知道会同步什么」的假刷新接口；打开界面 = `load()` 读表 + 读缓存。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout, toCount } from '../net/RequestGuard';
import {
    activityCoinOf,
    EMPTY_ACTIVITY_STATE,
    findDayChallengeTab,
    normalizeActivityState,
    parseItemRows,
    parseProgressRows,
    parseRolePropertyRows,
    parseTabRows,
    parseTaskRows,
    sortTasksForDisplay,
} from './LayerActivityTable';
import type {
    IActivityGoodsInfo,
    IActivityProgressRow,
    IActivityServerState,
    IActivityTabRow,
    IActivityTaskRow,
} from './LayerActivityTable';
import {
    RequestTakeDayActProgressReward,
    RequestTakeDayChallengeActReward,
} from './RequestActivityMsg';

/** 采集一次界面要的全部数据。 */
export interface IActivitySnapshot {
    /** 已按「可领取 → 未完成 → 已领取」排好序的任务行。 */
    readonly tasks: readonly IActivityTaskRow[];
    /** 周活跃进度宝箱（按 `cost` 升序）。 */
    readonly boxes: readonly IActivityProgressRow[];
    /** `item` 表（奖励展示：品质 + 图标名）。 */
    readonly items: ReadonlyMap<number, IActivityGoodsInfo>;
    /**
     * `roleProperty` 表（**货币 / 属性类**奖励，`item` 表里没有它们）。
     *
     * 每日任务的奖励里混着银币 7 / 洗炼石 8 / 金币 10 / 活跃度 15，全靠这张表兜住；
     * 少了它，10 个奖励格里 8 个只剩品质框、没有图标。
     */
    readonly resources: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `activityTab` 全表（界面只落地了「每日任务」那一个）。 */
    readonly tabs: readonly IActivityTabRow[];
    /** 本次要展示的页签；表里没有 1001 时是 `null`。 */
    readonly tab: IActivityTabRow | null;
    readonly state: IActivityServerState;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type ActivityRequestResult = 'ok' | 'offline' | 'failed' | 'noInstance';

export interface IActivityRepository {
    /** 读表 + 读缓存，组装一次快照；**不发请求**。 */
    load(): Promise<IActivitySnapshot>;
    /**
     * 领取某条每日任务的奖励。
     * `taskResId` = `dayChallengeActTask.resId`；活动实例 id 由内部从缓存取。
     */
    claimTask(taskResId: number, caller?: object): Promise<ActivityRequestResult>;
    /** 领取某个周活跃宝箱（`id` = `dayChallengeActTaskProgress.id`）。 */
    claimBox(id: number, caller?: object): Promise<ActivityRequestResult>;
    /** 订阅活动缓存变化；返回取消订阅函数。 */
    subscribe(caller: object, listener: () => void): () => void;
    /** 当前缓存里的活动状态（调试 / 测试用）。 */
    peekState(): IActivityServerState;
}

/** 写请求超时（规则 22：读 800 / 写 5000）。 */
const WRITE_TIMEOUT_MS = 5000;

/** 缓存表名（`protoCache.json` 里的 key，也是 `GameCache` 的名字）。 */
const ACTIVITY_CACHE = 'CmdActivity';

/** 读一张分表的全部行；表缺失时返回空数组。 */
async function readRows(table: string): Promise<unknown[]> {
    return (await RefUtil.instance.getRefAllAsync(table)) ?? [];
}

/** 读缓存里的 `CmdActivity` 全表；缓存不可用时返回空数组（不抛）。 */
function readActivityCmds(): readonly unknown[] {
    try {
        return CacheMgr.instance?.getTlCmdActivity() ?? [];
    } catch (error) {
        console.warn('[Activity] 读 CmdActivity 缓存失败', error);
        return [];
    }
}

/** 读缓存里的 `CmdRole` 全表；缓存不可用时返回空数组（不抛）。 */
function readRoleRows(): readonly unknown[] {
    try {
        return CacheMgr.instance?.getTlCmdRole() ?? [];
    } catch (error) {
        console.warn('[Activity] 读 CmdRole 缓存失败', error);
        return [];
    }
}

/** 生产环境 Repository。 */
export class RuntimeActivityRepository implements IActivityRepository {
    /**
     * 上一次 `load()` 采到的活动状态。
     *
     * 存这份是为了让 `peekState()` **不需要**重新读表和缓存 —— 缓存变更回调里要判
     * 「这次变化是不是跟每日挑战有关」，同步取一份旧值比较就够了（见 `LayerActivityPage`）。
     */
    private lastState: IActivityServerState = EMPTY_ACTIVITY_STATE;

    async load(): Promise<IActivitySnapshot> {
        const [taskRows, progressRows, tabRows, activityRows, itemRows, resourceRows] = await Promise.all([
            readRows('dayChallengeActTask'),
            readRows('dayChallengeActTaskProgress'),
            readRows('activityTab'),
            readRows('activity'),
            readRows('item'),
            // 货币 / 属性类奖励（银币 / 金币 / 活跃度…）不在这张表里就没有图标可画
            readRows('roleProperty'),
        ]);

        const tables = parseTaskRows(taskRows);
        const boxes = parseProgressRows(progressRows);
        const tabs = parseTabRows(tabRows);
        const base = normalizeActivityState(readActivityCmds(), activityRows);
        const state: IActivityServerState = { ...base, coin: activityCoinOf(readRoleRows()) };
        this.lastState = state;

        return {
            tasks: sortTasksForDisplay(tables, state),
            boxes,
            items: parseItemRows(itemRows),
            resources: parseRolePropertyRows(resourceRows),
            tabs,
            tab: findDayChallengeTab(tabs),
            state,
        };
    }

    /** 上一次 `load()` 的服务器状态（不含表数据）。 */
    peekState(): IActivityServerState {
        return this.lastState;
    }

    /**
     * 订阅 `CmdActivity` 缓存变化。
     *
     * ⚠️ 缓存事件是「一个 `caller` 一条回调」的模型（`GameCacheMgr.setEventChange`），
     * 页面销毁时**必须**调返回的取消函数，否则弹窗关了回调还在跑、去写已销毁的 Label。
     */
    subscribe(caller: object, listener: () => void): () => void {
        const mgr = CacheMgr.instance;
        try {
            mgr.setEventChange(ACTIVITY_CACHE, caller, listener);
        } catch (error) {
            console.warn('[Activity] 订阅活动缓存失败，界面将只在主动操作后刷新', error);
            return () => {};
        }
        let done = false;
        return () => {
            if (done) return;
            done = true;
            try {
                mgr.removeEventChange(ACTIVITY_CACHE, caller, listener);
            } catch (error) {
                console.warn('[Activity] 取消活动缓存订阅失败', error);
            }
        };
    }

    async claimTask(taskResId: number, caller?: object): Promise<ActivityRequestResult> {
        const instanceId = this.instanceIdOrZero();
        if (instanceId <= 0) return 'noInstance';
        return this.writeRequest(
            (cb) => new RequestTakeDayChallengeActReward(
                { resId: instanceId, taskResId },
                caller,
                cb,
            ),
            '领取任务奖励',
            'tlReward',
        );
    }

    async claimBox(id: number, caller?: object): Promise<ActivityRequestResult> {
        const instanceId = this.instanceIdOrZero();
        if (instanceId <= 0) return 'noInstance';
        return this.writeRequest(
            (cb) => new RequestTakeDayActProgressReward({ resId: instanceId, id }, caller, cb),
            '领取周活跃宝箱',
            'tlCmdGoods',
        );
    }

    /**
     * 当前活动实例 id（`CmdActivity.openResId`）；取不到返回 0。
     *
     * ⚠️ 这里**不能**先 `await` `activity` 表再按 `activityRefId` 判类型 ——
     * 发请求前的早退判定必须是同步的，否则「活动没开」会被拖成一次异步等待，
     * 而且 `claimTask/claimBox` 的返回值就变成 `Promise` 套 `Promise` 了。
     * 判据取 `detail.dayChallengeActDetail` 的形状：只有每日挑战那条活动会带它
     * （见 `CmdActivityDetail` 的字段定义），等价且省一次查表。
     */
    private instanceIdOrZero(): number {
        for (const raw of readActivityCmds()) {
            if (!raw || typeof raw !== 'object') continue;
            const cmd = raw as Record<string, unknown>;
            const detail = cmd.detail && typeof cmd.detail === 'object'
                ? (cmd.detail as Record<string, unknown>)
                : null;
            if (!detail?.dayChallengeActDetail) continue;
            const id = toCount(cmd.openResId);
            if (id > 0) return id;
        }
        return 0;
    }

    /** 写请求的公共壳：离线早退、超时兜底。**不做状态覆盖**（服务端在别处推）。 */
    private async writeRequest(
        build: (cb: (rsp: any) => void) => unknown,
        label: string,
        rewardField: 'tlReward' | 'tlCmdGoods',
    ): Promise<ActivityRequestResult> {
        const net = GameNet.instance;
        if (!net || !net.isConnected) return 'offline';

        let responded = false;
        try {
            const sent = await withTimeout(
                net.send(build((rsp) => {
                    FW.ShowReward(rsp?.[rewardField] ?? []);
                    responded = true;
                }) as any, false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (sent !== true) return 'failed';
        } catch (error) {
            console.warn(`[Activity] ${label}请求失败`, error);
            return 'failed';
        }
        // 两条协议都**没有 `ret` 字段**（响应体只有奖励列表），成功判据只能是「响应到达」，
        // 与 `MonthCardGiftRepository.claim` 同一口径。
        return responded ? 'ok' : 'failed';
    }
}

export const activityRepository: IActivityRepository = new RuntimeActivityRepository();
