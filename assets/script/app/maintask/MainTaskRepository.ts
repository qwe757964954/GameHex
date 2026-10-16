/**
 * 主线任务（主界面「10级领取」HUD）的数据端口。
 *
 * 与 `SevenDayRepository` 同一套分层：判定全在 `MainTaskTable`（纯函数、可单测），
 * 本文件只负责「把表 + 缓存搬进来」与「发领奖请求」。
 *
 * 数据来源：
 *   ① 配置表 `taskMain` —— 取 `targetType = 99` 那一行（进度上限 / 奖励 / 名字）；
 *   ② 服务端缓存 `CmdTask`（`CacheMgrGen.getTlCmdTask()`）—— `count` / `rewardState`；
 *   ③ 请求 `CmdTakeMainTaskRewardReqMsg` —— 领奖。
 *
 * ## 缓存读不到不是异常
 *
 * `CacheMgr.instance` 在 `GameNet.doPrepare()` 之前是空壳，`getTlCmdTask()` 会抛
 * 「没有这张表」。这里 `safe()` 吞掉并返回空数组 —— 主界面在**未登录**状态下也会被打开
 * （编辑器预览），HUD 必须显示「0 进度」而不是白屏 + 一片报错。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { CacheMgr } from '../net/CacheMgr';
import { GameNet } from '../net/GameNet';
import { withTimeout } from '../net/RequestGuard';
import {
    CMD_COMMON_STATE,
    canClaimOf,
    entryVisibleOf,
    normalizeTaskState,
    parseMainTaskRows,
    pickFirstTaskRow,
    pickHeroTaskRow,
    progressTextOf,
    redDotVisibleOf,
    taskDetailTitleOf,
    taskEntryLabelOf,
    taskTitleOf,
} from './MainTaskTable';
import type { IMainTaskRow, IMainTaskState } from './MainTaskTable';
import { GET_HERO_TEXTS, MAIN_TASK_TEXTS } from './MainTaskTexts';
import { RequestTakeMainTaskReward } from './RequestMainTaskMsg';

/** 「10级领取」HUD 一次刷新要的全部数据。 */
export interface IHeroTaskSnapshot {
    /** `taskMain` 表里有没有 `targetType = 99` 那行。 */
    readonly configured: boolean;
    /** 任务 id（= `CmdTakeMainTaskRewardReqMsg.resId`）；没配为 `0`。 */
    readonly resId: number;
    /** 任务名（`taskMain.name`）。 */
    readonly name: string;
    /** 进度上限（`param.count`）。 */
    readonly max: number;
    /** 当前进度（服务端 `CmdTask.count`）。 */
    readonly value: number;
    /** 奖励物 `resId`（老端取 `reward[0].resId`；没配为 `0`）。 */
    readonly rewardResId: number;
    /** 奖励数量。 */
    readonly rewardNumber: number;
    /** 与奖励 `resId` 对应的 **物品名**（`item` 表；取不到为空串）。 */
    readonly rewardName: string;
    /** 奖励物品的图标路径（`item.icon`，相对 `assets/resources/`；取不到为空串）。 */
    readonly rewardIcon: string;
    /** 奖励物品品质（`item.quality`；取不到为 `1`）。 */
    readonly rewardQuality: number;
    /** `CmdCommonState`。 */
    readonly rewardState: number;
    /** 进度文案 `(7/10)`。 */
    readonly progressText: string;
    /** 能不能领（FINISH）。 */
    readonly canClaim: boolean;
    /** HUD 显不显示（`canClaim || isUndone`）。 */
    readonly visible: boolean;
    /** 红点亮不亮（只有 `canClaim`）。 */
    readonly showRedDot: boolean;
}

/** 一个奖励格 —— `item` 表解析后的形状（详情弹窗的 `list_item` 用）。 */
export interface IRewardEntry {
    /** 物品 `resId`。 */
    readonly resId: number;
    /** 数量（表里 `reward[].number`）。 */
    readonly number: number;
    /** 物品名（`item.name`；取不到为空串）。 */
    readonly name: string;
    /** 图标路径（`item.icon`，相对 `assets/resources/`；取不到为空串）。 */
    readonly icon: string;
    /** 品质（`item.quality`；取不到为 `1`）。 */
    readonly quality: number;
}

/**
 * 当前**主线任务**（主界面入口 + 详情弹窗）一次刷新要的全部数据。
 *
 * 与 `IHeroTaskSnapshot` 的区别：那是「10级领取」（`targetType = 99`，**单个**奖励、
 * 只显示进度），这是 `GetFirstVO()` 选出来的常规主线任务（**多个**奖励、要弹详情）。
 */
export interface IMainTaskSnapshot {
    /** 有没有可展示的主线任务（`pickFirstTaskRow` 选出来了）。没有 ⇒ 入口隐藏、详情不弹。 */
    readonly configured: boolean;
    /** 任务 id（= `CmdTakeMainTaskRewardReqMsg.resId`）；没选出来为 `0`。 */
    readonly resId: number;
    /** 任务名（`{count}` 已按 `param.count` 替换；老端 `GetTitle()`）。 */
    readonly title: string;
    /** 当前进度（服务端 `CmdTask.count`）。 */
    readonly value: number;
    /** 进度上限（`taskMain.param.count`）。 */
    readonly max: number;
    /** 详情弹窗标题：`${title} (${value}/${max})`（老端 `lab_title`）。 */
    readonly detailTitle: string;
    /** 主界面入口两行文案：`${title}\n(${value}/${max})`（老端 `lab_task`）。 */
    readonly entryLabel: string;
    /** 奖励列表（每个都带 `item` 表解析出来的名字 / 图标 / 品质）。 */
    readonly rewards: readonly IRewardEntry[];
    /** `CmdCommonState`。 */
    readonly rewardState: number;
    /** 进度文案 `(4/5)`。 */
    readonly progressText: string;
    /** 能不能领（`FINISH`）—— 入口点击走「直接领奖」而不是「弹详情」（老端口径）。 */
    readonly canClaim: boolean;
    /**
     * 入口 / 弹窗显不显示。
     * 老端 `if (first) { …visible = true } else { visible = false }` —— 选出来的一定是
     * `UNDONE` / `FINISH`（`REWARDED` 在 `pickFirstTaskRow` 里就被滤掉了）⇒ 等价于 `configured`。
     */
    readonly visible: boolean;
    /** 红点亮不亮（只有 `canClaim`；老端 `reddot.OnRDUpdate(canReward ? 1 : 0)`）。 */
    readonly showRedDot: boolean;
    /** 跳转 id（老端 `vo.GetRef().goto`；本工程只留接线口，见 `MAIN_TASK_TEXTS.jumpNotWired`）。 */
    readonly goto: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type MainTaskRequestResult = 'ok' | 'offline' | 'failed';

/** 领奖超时（写请求口径：5000ms）。 */
const WRITE_TIMEOUT_MS = 5000;

export interface IMainTaskRepository {
    /** 读表 + 读缓存，组装「10级领取」快照；**不发请求**。任何时候都兑现。 */
    load(): Promise<IHeroTaskSnapshot>;
    /**
     * 读表 + 读缓存，选出**当前主线任务**（老端 `VOMainTaskBag.GetFirstVO()`）；**不发请求**。
     * 主界面入口与详情弹窗共用这一份快照。
     */
    loadFirst(): Promise<IMainTaskSnapshot>;
    /** 领取主线任务奖励（「10级领取」与常规主线任务是**同一个协议**）。 */
    claim(resId: number, caller?: unknown): Promise<MainTaskRequestResult>;
}

/** 表行 → 空快照（表没配时的形状）。 */
function emptySnapshot(): IHeroTaskSnapshot {
    return {
        configured: false,
        resId: 0,
        name: '',
        max: 0,
        value: 0,
        rewardResId: 0,
        rewardNumber: 0,
        rewardName: '',
        rewardIcon: '',
        rewardQuality: 1,
        rewardState: 0,
        progressText: progressTextOf(0, 0),
        canClaim: false,
        visible: false,
        showRedDot: false,
    };
}

/**
 * 读一张缓存表；表不存在 / 未登录时返回空数组。
 * ⚠️ `CacheMgrGen` 的取值方法在缺表时**抛异常**（不是返回空），必须自己兜住。
 */
function readCache(fn: () => unknown[]): readonly unknown[] {
    try {
        return fn() ?? [];
    } catch {
        return [];
    }
}

/** 在 `CmdTask` 缓存里找这条任务。 */
function findTaskRow(rows: readonly unknown[], resId: number): unknown | null {
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const id = Number((row as Record<string, unknown>).resId);
        if (Number.isFinite(id) && id === resId) return row;
    }
    return null;
}

/** `CmdTask` 缓存全量 → `resId → 收敛后的状态`。 */
function taskStateMap(rows: readonly unknown[]): Map<number, IMainTaskState> {
    const out = new Map<number, IMainTaskState>();
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const id = Number((row as Record<string, unknown>).resId);
        if (!Number.isFinite(id) || id <= 0) continue;
        out.set(id, normalizeTaskState(row));
    }
    return out;
}

/**
 * 奖励物 → `item` 表解析出的形状。
 *
 * 老端 `ModelGoods.CreateGoodsByCmd({number, resId})` 后再读 VO；本工程没有 Goods VO，
 * 直接查 `item` 表（键是 **`resId`**，不是 `id` —— 按 `id` 查会全 MISSING 且**不报错**）。
 * 查不到不是异常（表里没有该物品 / 未登录），返回只有 id + 数量的条目。
 */
async function resolveRewardItem(resId: number, count: number): Promise<IRewardEntry> {
    const fallback: IRewardEntry = { resId, number: count, name: '', icon: '', quality: 1 };
    if (!(resId > 0)) return fallback;
    try {
        const item = await RefUtil.instance.getRefAsync('item', 'resId', resId);
        if (!item || typeof item !== 'object') return fallback;
        const r = item as Record<string, unknown>;
        const q = Number(r.quality);
        return {
            resId,
            number: count,
            name: typeof r.name === 'string' ? r.name : '',
            icon: typeof r.icon === 'string' ? r.icon : '',
            quality: Number.isFinite(q) && q > 0 ? q : 1,
        };
    } catch (error) {
        console.warn('[MainTask] 读 item 失败', error);
        return fallback;
    }
}

/** 没有可展示的主线任务时的形状。 */
function emptyFirstSnapshot(): IMainTaskSnapshot {
    return {
        configured: false,
        resId: 0,
        title: '',
        value: 0,
        max: 0,
        detailTitle: '',
        entryLabel: '',
        rewards: [],
        rewardState: CMD_COMMON_STATE.UNDONE,
        progressText: progressTextOf(0, 0),
        canClaim: false,
        visible: false,
        showRedDot: false,
        goto: 0,
    };
}

class MainTaskRepositoryImpl implements IMainTaskRepository {
    async load(): Promise<IHeroTaskSnapshot> {
        let rows: readonly unknown[] = [];
        try {
            rows = (await RefUtil.instance.getRefAllAsync('taskMain')) ?? [];
        } catch (error) {
            console.warn('[MainTask] 读 taskMain 失败', error);
        }

        const row: IMainTaskRow | null = pickHeroTaskRow(parseMainTaskRows(rows));
        if (!row) {
            console.warn(GET_HERO_TEXTS.noTaskWarn);
            return emptySnapshot();
        }

        const taskRows = readCache(() => CacheMgr.instance.getTlCmdTask());
        const rawTask = findTaskRow(taskRows, row.resId);
        if (!rawTask) console.warn(GET_HERO_TEXTS.noCmdWarn);
        const state = normalizeTaskState(rawTask);

        const firstReward = row.reward[0] ?? null;
        const rewardResId = firstReward?.resId ?? 0;
        const rewardNumber = firstReward?.number ?? 0;

        // 奖励物的名字 / 图标 / 品质 —— 老端 `ModelGoods.CreateGoods(...)` 后再读 VO；
        // 本工程没有 Goods VO，走与详情弹窗同一个 `resolveRewardItem`（唯一出口）。
        const reward = await resolveRewardItem(rewardResId, rewardNumber);

        return {
            configured: true,
            resId: row.resId,
            name: row.name,
            max: row.maxCount,
            value: state.count,
            rewardResId,
            rewardNumber,
            rewardName: reward.name,
            rewardIcon: reward.icon,
            rewardQuality: reward.quality,
            rewardState: state.rewardState,
            progressText: progressTextOf(state.count, row.maxCount),
            canClaim: canClaimOf(state.rewardState),
            visible: entryVisibleOf(true, state.rewardState),
            showRedDot: redDotVisibleOf(state.rewardState),
        };
    }

    /**
     * 选出一条「当前主线任务」（主界面入口 + 详情弹窗共用）。
     *
     * 与 `load()` 的三点不同，都是老端口径：
     *   ① 选的是 `GetFirstVO()`（按 `preResId` 升序、排除 `targetType = 99`、只认 UNDONE/FINISH）；
     *   ② 奖励是**一组**（详情弹窗的 `list_item` 要铺 N 个格子，不是只有一个）；
     *   ③ 文案分两套 —— 详情用 `title (x/y)`、入口用 `title\n(x/y)`。
     */
    async loadFirst(): Promise<IMainTaskSnapshot> {
        let rows: readonly unknown[] = [];
        try {
            rows = (await RefUtil.instance.getRefAllAsync('taskMain')) ?? [];
        } catch (error) {
            console.warn('[MainTask] 读 taskMain 失败', error);
        }

        const table = parseMainTaskRows(rows);
        const states = taskStateMap(readCache(() => CacheMgr.instance.getTlCmdTask()));
        const pick = pickFirstTaskRow(table, states);
        if (!pick) {
            console.warn(MAIN_TASK_TEXTS.noTaskWarn);
            return emptyFirstSnapshot();
        }

        const rewards = await Promise.all(
            pick.row.reward.map((r) => resolveRewardItem(r.resId, r.number)),
        );

        return {
            configured: true,
            resId: pick.row.resId,
            title: taskTitleOf(pick.row),
            value: pick.state.count,
            max: pick.row.maxCount,
            detailTitle: taskDetailTitleOf(pick.row, pick.state),
            entryLabel: taskEntryLabelOf(pick.row, pick.state),
            rewards,
            rewardState: pick.state.rewardState,
            progressText: progressTextOf(pick.state.count, pick.row.maxCount),
            canClaim: canClaimOf(pick.state.rewardState),
            visible: true,
            showRedDot: redDotVisibleOf(pick.state.rewardState),
            goto: pick.row.goto,
        };
    }

    async claim(resId: number, caller?: unknown): Promise<MainTaskRequestResult> {
        if (!Number.isFinite(resId) || resId <= 0) return 'failed';
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';

        try {
            // ⚠️ 必须 withTimeout：`GameNet.send` 没有按请求的超时，服务端不回就永悬，
            //    HUD 会卡在「已点但没反应」的状态再也不刷新。
            const sent = await withTimeout(
                net.send(new RequestTakeMainTaskReward(
                    { resId },
                    caller as any,
                    (rsp) => FW.ShowReward(rsp?.tlCmdGoods ?? []),
                ), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[MainTask] 领取英雄任务奖励失败', error);
            return 'failed';
        }
    }
}

/** 全局单例（页面默认用它；测试可注入替身）。 */
export const mainTaskRepository: IMainTaskRepository = new MainTaskRepositoryImpl();
