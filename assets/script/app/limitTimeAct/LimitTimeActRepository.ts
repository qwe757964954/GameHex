/**
 * 「限时活动」的数据端口 —— **后台活动缓存 + 服务端下发配置 + 网络请求** 三合一。
 *
 * 与 `LayerActivityRepository` / `MonthCardGiftRepository` 同一套分层：页面只依赖本文件接口，
 * 判定逻辑全在 `LimitTimeActTable`（纯函数、可单测），本文件只负责「把数据搬进来 / 发出去」。
 *
 * 数据来源（**与 `LayerActivity` 那套「每日挑战」不同，这套的配置是服务端下发的**）：
 *   ① 活动实例 —— `CmdActivitySimple` 缓存（登录同步下发），取 `type === 101(limit_time)` 那条；
 *   ② 配置（`limitTimeTask` / `limitTimeDay` / `limitTimeActivity` / `limitTimeConfig`）——
 *      **服务端下发**（`reqActivityJson` 的 `content` 是 JSON 字符串），不是 `remoteRef` 静态表；
 *   ③ 服务器状态 —— `reqActivityLimitTimeInfo`（任务进度 + 礼包 / 限购次数）；
 *   ④ 领取 / 购买 —— `reqActivityLimitTimeTake`（`type`: 1 领任务 / 2 买每日礼包 / 3 买限购）。
 *
 * ## ⚠️ 配置是服务端下发的 ⇒ 本模块**必须**有主动拉取（不像 MonthCard 那种纯读本地）
 *
 *  老端在 `ModelBackStageAct.afterEnterGame()` 里遍历 `VOBackStageActBag` 逐个拉配置 + 数据，
 *  Demo3.8 没有 `afterEnterGame` 钩子，这里改成**页面打开时 `refresh()` 拉一次**，拉到后缓存
 *  在内存里供后续 `load()` 复用；`load()` 本身**不发请求**（会被预览页频繁调用）。
 *
 * ## ⚠️ 领奖 / 购买后要拿响应里的状态**原地覆盖**，而不是再拉一次
 *
 *  `CmdActivityLimitTimeTakeRspMsg` 响应体里带了更新后的 `tlCmdTask` / `tlLimitTimeDay` /
 *  `tlLimitTimeActivity`（老端 `ModelBackStageAct.reqActivityLimitTimeTake` 就是拿这些
 *  `SetData` 的），所以领完直接把响应数据覆盖进内存缓存即可，不用再发一次 `reqActivityLimitTimeInfo`。
 */

import { FW } from '../../framework/FW';
import { GameNet } from '../net/GameNet';
import { CacheMgr } from '../net/CacheMgr';
import { withTimeout } from '../net/RequestGuard';
import {
    findLimitTimeMeta,
    parseActConfig,
    parseActData,
    parseActTitleAndIcon,
} from './LimitTimeActTable';
import type {
    ILimitTimeActConfig,
    ILimitTimeActData,
    ILimitTimeActMeta,
    ILimitTimeActSnapshot,
} from './LimitTimeActTypes';
import {
    RequestActivityJson,
    RequestActivityLimitTimeInfo,
    RequestActivityLimitTimeTake,
} from './RequestLimitTimeActMsg';

/** 请求结果：三态（对齐 MonthCardGift 的口径）。 */
export type LimitTimeRequestResult = 'ok' | 'offline' | 'failed';

export interface ILimitTimeActRepository {
    /**
     * 组装一次快照（读 `CmdActivitySimple` 缓存 + 内存里已缓存的活动配置 / 数据）；
     * **不发请求**。活动没开 / 还没拉过配置时返回 `null`。
     */
    load(): ILimitTimeActSnapshot | null;
    /** 主动拉一次配置 + 数据（页面打开时调）；成功后缓存到内存。 */
    refresh(): Promise<boolean>;
    /** 领某条每日任务的奖励（`taskResId` = 任务行 `resId`）。 */
    claimTask(taskResId: number, caller?: object): Promise<LimitTimeRequestResult>;
    /** 购买某个每日礼包 / 限购（`type`: 2 每日礼包 / 3 限购，`goodsResId` = 礼包行 `resId`）。 */
    buyGoods(type: number, goodsResId: number, caller?: object): Promise<LimitTimeRequestResult>;
    /** 当前缓存的活动 meta（调试 / 测试用）。 */
    peekMeta(): ILimitTimeActMeta | null;
}

/** 读请求超时（规则 22）。 */
const READ_TIMEOUT_MS = 800;
const WRITE_TIMEOUT_MS = 5000;

/** 生产环境 Repository。 */
export class RuntimeLimitTimeActRepository implements ILimitTimeActRepository {
    /** 内存缓存：`reqActivityJson` 拉到的三页签配置。 */
    private config: ILimitTimeActConfig | null = null;
    /** 内存缓存：`reqActivityLimitTimeInfo` 拉到的服务器数据。 */
    private data: ILimitTimeActData | null = null;
    /** 活动 meta（含标题 / 图标，来自 `limitTimeConfig`）。 */
    private meta: ILimitTimeActMeta | null = null;

    /** 读缓存里的 `CmdActivitySimple` 全表。 */
    private readActivitySimples(): readonly unknown[] {
        try {
            return CacheMgr.instance?.getTlCmdActivitySimple() ?? [];
        } catch (error) {
            console.warn('[LimitTimeAct] 读 CmdActivitySimple 缓存失败', error);
            return [];
        }
    }

    peekMeta(): ILimitTimeActMeta | null {
        return this.meta;
    }

    load(): ILimitTimeActSnapshot | null {
        const meta = this.meta ?? findLimitTimeMeta(this.readActivitySimples());
        if (!meta) return null;
        if (!this.config || !this.data) return null;
        return { meta, config: this.config, data: this.data };
    }

    /**
     * 拉一次配置 + 数据。
     *
     * 配置 `reqActivityJson` 的 `tlJsonName` 直接用 meta 的 `jsonNames`（老端 `VOBackStageAct.GetJsonNames()`）。
     * 数据 `reqActivityLimitTimeInfo` 无参数。
     * 两个请求**串行**（配置里的 `limitTimeConfig` 要用来补 meta 的标题 / 图标）。
     */
    async refresh(): Promise<boolean> {
        const meta = findLimitTimeMeta(this.readActivitySimples());
        if (!meta) return false;
        this.meta = meta;

        const jsonContent = await this.fetchJson(meta);
        const config = parseActConfig(jsonContent);
        this.config = config;

        // `limitTimeConfig` 用来补标题 / 图标（老端 `UpdateData` 里 `limit_time` 分支读它）。
        const titleAndIcon = parseActTitleAndIcon(jsonContent ? asArrayOfConfig(jsonContent, 'limitTimeConfig') : []);
        this.meta = { ...meta, title: titleAndIcon.title, icon: titleAndIcon.icon };

        const data = await this.fetchInfo();
        if (data) this.data = data;
        return true;
    }

    private async fetchJson(meta: ILimitTimeActMeta): Promise<unknown> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let content: string | null = null;
        try {
            const ok = await withTimeout(
                net.send(new RequestActivityJson(
                    { activityId: meta.id, tlJsonName: meta.jsonNames as string[] },
                    undefined,
                    (rsp) => { content = rsp?.content ?? null; },
                ), false),
                READ_TIMEOUT_MS,
                () => false,
            );
            if (!ok) return null;
        } catch (error) {
            console.warn('[LimitTimeAct] 拉活动配置失败', error);
            return null;
        }
        return content;
    }

    private async fetchInfo(): Promise<ILimitTimeActData | null> {
        const net = GameNet.instance;
        if (!net.isConnected) return null;
        let rsp: unknown = null;
        try {
            const ok = await withTimeout(
                net.send(new RequestActivityLimitTimeInfo({}, undefined, (r) => { rsp = r; }), false),
                READ_TIMEOUT_MS,
                () => false,
            );
            if (!ok) return null;
        } catch (error) {
            console.warn('[LimitTimeAct] 拉限时活动数据失败', error);
            return null;
        }
        return parseActData(rsp);
    }

    async claimTask(taskResId: number, caller?: object): Promise<LimitTimeRequestResult> {
        return this.take(1, taskResId, caller);
    }

    async buyGoods(type: number, goodsResId: number, caller?: object): Promise<LimitTimeRequestResult> {
        return this.take(type, goodsResId, caller);
    }

    /** `reqActivityLimitTimeTake` 的公共壳：离线早退、超时兜底、响应覆盖内存缓存。 */
    private async take(type: number, resId: number, caller?: object): Promise<LimitTimeRequestResult> {
        const net = GameNet.instance;
        if (!net || !net.isConnected) return 'offline';

        let rsp: CmdActivityLimitTimeTakeRspMsg | null = null;
        try {
            const ok = await withTimeout(
                net.send(new RequestActivityLimitTimeTake(
                    { resId, type },
                    caller,
                    (r) => {
                        rsp = r;
                        FW.ShowReward(r?.tlCmdGoods ?? []);
                    },
                ), false),
                WRITE_TIMEOUT_MS,
                () => false,
            );
            if (!ok) return 'failed';
        } catch (error) {
            console.warn('[LimitTimeAct] 领取 / 购买请求失败', error);
            return 'failed';
        }
        if (!rsp) return 'failed';
        // 响应里带更新后的状态，原地覆盖内存缓存（不用再拉一次）。
        this.data = parseActData(rsp);
        return 'ok';
    }
}

/** 从 `reqActivityJson` 的 content 里抽某个键的数组（`limitTimeConfig` 用）。 */
function asArrayOfConfig(content: unknown, key: string): unknown[] {
    if (!content || typeof content !== 'object') return [];
    const raw = (content as Record<string, unknown>)[key];
    return Array.isArray(raw) ? raw : [];
}

export const limitTimeActRepository: ILimitTimeActRepository = new RuntimeLimitTimeActRepository();
