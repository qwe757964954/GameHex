/**
 * 「邮件」的数据端口 —— **配置表 + 本地快照 + 网络请求** 三合一的 Repository。
 *
 * 与 `FriendRepository` / `GiftRepository` 同一套分层：页面只依赖本文件的接口，
 * 判定逻辑全在 `MailTable`（纯函数、可单测），本文件只负责「把数据搬进来 / 把请求发出去」。
 *
 * ## 数据来源 —— 邮件**不走 `GameCache`**
 *
 * | 来源 | 内容 | 走哪 |
 * |---|---|---|
 * | 请求 `CmdMailListRspMsg` | 邮件列表（`tlCmdMailSimple`） | **本类自己存快照** |
 * | 请求 `CmdMailReadRspMsg` | 单封详情（`cmdMail`） | 本类存 `detail`，返回给页面 |
 * | 配置表 `gameConfig` | `maxMailNum`（50）/ `mailValid`（40） | `RefUtil.instance.getRefAllAsync` |
 * | 配置表 `item` + `roleProperty` | 奖励图标（两支） | 同上（`parseItemRows` / `parseRolePropertyRows`） |
 *
 * **为什么不读 `CacheMgr`**：`CmdCache` 是通用结构（`{cacheName, data, type}`），
 * 服务端推的缓存表里**没有 mail 条目**；老端 `ModelMail` 同样是 `SetMailList(rsp.tlCmdMailSimple)`
 * 自己存一份内存快照 ⇒ 新端口径一致。
 *
 * ## 请求三态
 *
 * 每个请求都是 `'ok' | 'offline' | 'failed'`：**离线早退**、`withTimeout` 兜底
 * （读 800ms / 写 5000ms），`catch` 一律返 `'failed'` —— 绝不把 Promise 悬着
 * （`GameNet.send` 没有按请求的超时，服务端不回应就永悬）。
 *
 * ⚠️ 批量接口（删除 / 领取）的 `id` 是 `Long[]` ⇒ **必须发十进制字符串数组**：
 *   `protoCompiledStatic.ts` 生成的请求类构造函数是**裸赋值**，真正的换算在编码时由
 *   `LongBits.from` 做 —— 它认 `Long` / `number` / 十进制字符串，普通对象会被当成 `zero`
 *   ⇒ **id 静默变成 0**（发出去、服务端删不掉，界面看着「点了没反应」）。
 */

import { RefUtil } from '../../framework/ref/RefUtil';
import { FW } from '../../framework/FW';
import { parseItemRows, parseRolePropertyRows } from '../activity/LayerActivityTable';
import type { IActivityGoodsInfo } from '../activity/LayerActivityTable';
import { GameNet } from '../net/GameNet';
import { toIdString, withTimeout } from '../net/RequestGuard';
import {
    IMailConfig,
    IMailDetail,
    IMailReward,
    IMailRow,
    mailRewardsOfArray,
    normalizeMailDetail,
    normalizeMailRows,
    parseMailConfig,
    sortMails,
} from './MailTable';
import {
    RequestMailDelete,
    RequestMailList,
    RequestMailRead,
    RequestMailTakeReward,
} from './RequestMailMsg';

/** 一次界面刷新要的全部数据。 */
export interface IMailSnapshot {
    /** 排序后的邮件列表（`sortMails`：未处理的置顶、同组新的在前）。 */
    readonly rows: readonly IMailRow[];
    readonly config: IMailConfig;
    /** `item` 表索引（`resId` → 展示字段，`iconIsPath = true`）。 */
    readonly items: ReadonlyMap<number, IActivityGoodsInfo>;
    /** `roleProperty` 表索引（货币 / 属性类，`iconIsPath = false`）。 */
    readonly resources: ReadonlyMap<number, IActivityGoodsInfo>;
    /** 本次快照的时间基准（毫秒）—— 相对时间文案按它算。 */
    readonly now: number;
}

/** 请求结果：三态，页面据此决定提示文案。 */
export type MailRequestResult = 'ok' | 'offline' | 'failed';

/**
 * 批量领取的结果。
 *
 * 为什么要连**三态**一起回：光看「奖励数组」分不出「离线」与「服务端报错」，
 * 而这两种要给玩家不同的提示（老端 `FW.showTip` 也是两句不同的话）。
 */
export interface IMailTakeResult {
    readonly result: MailRequestResult;
    /** 服务端回带的奖励（`result !== 'ok'` 时为空数组）。 */
    readonly rewards: readonly IMailReward[];
}

export interface IMailRepository {
    /** 读一次界面要的全量数据（表 + 首次拉列表）。不抛。 */
    load(caller?: unknown): Promise<IMailSnapshot>;
    /** 重新拉列表（服务端 Rsp 是全量替换）。 */
    reload(caller?: unknown): Promise<MailRequestResult>;
    /** 读一封邮件的详情（服务端顺带标记已读）；失败返回 `null`。 */
    readMail(id: string, caller?: unknown): Promise<IMailDetail | null>;
    /** 批量删除。 */
    deleteMails(ids: readonly string[], caller?: unknown): Promise<MailRequestResult>;
    /** 批量领取；`rewards` 是**服务端回带**的那批（可能为空）。 */
    takeRewards(ids: readonly string[], caller?: unknown): Promise<IMailTakeResult>;
}

/** 请求超时（与好友 / 礼包 / 首充 / 七日同口径：读 800ms / 写 5000ms）。 */
export const MAIL_READ_TIMEOUT_MS = 800;
export const MAIL_WRITE_TIMEOUT_MS = 5000;

/** 读一张表；表缺失 / 读失败返回空数组（**不抛**，也不 reject）。 */
async function readTable(name: string): Promise<readonly unknown[]> {
    try {
        const rows = await RefUtil.instance.getRefAllAsync(name);
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn(`[Mail] 读表失败：${name}`, error);
        return [];
    }
}

/** 生产环境 Repository。 */
export class RuntimeMailRepository implements IMailRepository {
    /** 邮件列表快照（**内存**，服务端只在 Rsp 里给，无推送）。 */
    private rows: IMailRow[] = [];
    /** 是否已经成功拉过一次列表（避免 `load()` 每次都发包）。 */
    private fetched = false;

    /** 清空快照（登出 / 换号时调用；也方便单测）。 */
    reset(): void {
        this.rows = [];
        this.fetched = false;
    }

    /** 只读快照（给探针 / 测试看当前状态）。 */
    get currentRows(): readonly IMailRow[] {
        return this.rows;
    }

    async load(caller?: unknown): Promise<IMailSnapshot> {
        const [configRows, itemRows, propRows] = await Promise.all([
            readTable('gameConfig'),
            readTable('item'),
            readTable('roleProperty'),
        ]);

        // 首次进来还没拉过列表 ⇒ 拉一次（拿到之前先给空列表，不阻塞界面）
        if (!this.fetched) await this.reload(caller);

        return {
            rows: sortMails(this.rows),
            config: parseMailConfig(configRows),
            items: parseItemRows(itemRows),
            resources: parseRolePropertyRows(propRows),
            now: Date.now(),
        };
    }

    async reload(caller?: unknown): Promise<MailRequestResult> {
        return this.send(
            () =>
                new RequestMailList({}, caller as any, (rsp: any) => {
                    this.rows = normalizeMailRows(rsp?.tlCmdMailSimple);
                    this.fetched = true;
                }),
            MAIL_READ_TIMEOUT_MS,
        );
    }

    async readMail(id: string, caller?: unknown): Promise<IMailDetail | null> {
        const mailId = toIdString(id);
        if (!mailId) return null;
        let detail: IMailDetail | null = null;
        const result = await this.send(
            () =>
                new RequestMailRead({ id: mailId } as any, caller as any, (rsp: any) => {
                    detail = normalizeMailDetail(rsp?.cmdMail);
                    // 读一封会把它变成「已读」⇒ 顺手把列表快照里那条也标上，
                    // 免得关掉详情回到列表还显示「未读」（老端是 closeUI() 时重拉，两条路都对）
                    if (detail) this.markRead(detail.id);
                }),
            MAIL_READ_TIMEOUT_MS,
        );
        return result === 'ok' ? detail : null;
    }

    async deleteMails(ids: readonly string[], caller?: unknown): Promise<MailRequestResult> {
        const list = this.cleanIds(ids);
        if (!list.length) return 'failed';
        const result = await this.send(
            () => new RequestMailDelete({ id: list } as any, caller as any),
            MAIL_WRITE_TIMEOUT_MS,
        );
        if (result === 'ok') {
            // Rsp 是空消息 ⇒ 本地先摘掉（服务端删除成功才走到这里），再重拉对账
            this.removeLocal(list);
            void this.reload(caller);
        }
        return result;
    }

    async takeRewards(ids: readonly string[], caller?: unknown): Promise<IMailTakeResult> {
        const list = this.cleanIds(ids);
        if (!list.length) return { result: 'failed', rewards: [] };
        let rewards: IMailReward[] = [];
        const result = await this.send(
            () =>
                new RequestMailTakeReward({ id: list } as any, caller as any, (rsp: any) => {
                    // ⚠️ `CmdMailTakeRewardRspMsg.tlReward` 是**裸 `CmdGoods[]`**（不是 `CmdGoodsList`）
                    FW.ShowReward(rsp?.tlReward ?? []);
                    rewards = mailRewardsOfArray(rsp?.tlReward);
                }),
            MAIL_WRITE_TIMEOUT_MS,
        );
        if (result !== 'ok') return { result, rewards: [] };
        void this.reload(caller);
        return { result, rewards };
    }

    // ============================================================
    // 内部工具
    // ============================================================

    /** `toIdString` 逐个归一 + 去重（发出去的一定是十进制字符串）。 */
    private cleanIds(ids: readonly string[]): string[] {
        const out: string[] = [];
        for (const raw of ids ?? []) {
            const id = toIdString(raw);
            if (id && !out.includes(id)) out.push(id);
        }
        return out;
    }

    private markRead(id: string): void {
        const next = this.rows.map((row) => (row.id === id ? { ...row, read: true } : row));
        this.rows = next;
    }

    private removeLocal(ids: readonly string[]): void {
        const drop = new Set(ids);
        this.rows = this.rows.filter((row) => !drop.has(row.id));
    }

    /**
     * 统一的发包 + 三态收口。
     * ⚠️ 必须 `withTimeout`：`GameNet.send` 没有按请求的超时，服务端不回就永悬。
     */
    private async send(make: () => any, timeoutMs: number): Promise<MailRequestResult> {
        const net = GameNet.instance;
        if (!net.isConnected) return 'offline';
        try {
            const sent = await withTimeout(net.send(make(), false), timeoutMs, () => false);
            return sent === true ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[Mail] 请求失败', error);
            return 'failed';
        }
    }
}

/** 全模块共用的单例（页面 `private repo: IMailRepository = mailRepository`）。 */
export const mailRepository: IMailRepository = new RuntimeMailRepository();
