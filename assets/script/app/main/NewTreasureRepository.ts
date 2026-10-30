import { FW } from '../../framework/FW';
import { RequestMsg } from '../../framework/net/RequestMsg';
import { RefUtil } from '../../framework/ref/RefUtil';
import { withTimeout } from '../net/RequestGuard';
import { GameNet } from '../net/GameNet';
import {
    CHEST_DETAIL_REWARD_SLOTS,
    CHEST_EMPTY_SLOT_STAMINA_COST,
    CHEST_SLOT_COUNT,
    ChestSlotAction,
    ChestSlotState,
} from './ChestTypes';
import type { IChestDetailData, IChestDetailRewardData, IChestSlotData } from './ChestTypes';
import {
    ITEM_TABLE,
    ROLE_PROPERTY_TABLE,
    resBarCellOfRefId,
    resBarIconSpritePath,
    type IItemRefRow,
    type IResPropertyRow,
} from '../common/ResTypes';

type Result = 'ok' | 'offline' | 'failed' | 'protocol-missing' | 'busy';
type TreasureInfo = CmdNewTreasureInfo;
type ChestChangeListener = (slots: readonly IChestSlotData[]) => void;

const BOX_NAME_PREFIX = '宝箱';
const READ_TIMEOUT_MS = 3000;
const WRITE_TIMEOUT_MS = 5000;
const TREASURE_BROADCAST = 'CmdNewTreasureInfoBroMsg';

class RequestNewTreasureInfoList extends RequestMsg<CmdNewTreasureInfoListReqMsg, CmdNewTreasureInfoListRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdNewTreasureInfoListReqMsg'; }
}

class RequestNewTreasureActivate extends RequestMsg<CmdNewTreasureActivateReqMsg, CmdNewTreasureActivateRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdNewTreasureActivateReqMsg'; }
}

class RequestNewTreasureFastOpen extends RequestMsg<CmdNewTreasureFastOpenReqMsg, CmdNewTreasureFastOpenRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdNewTreasureFastOpenReqMsg'; }
}

class RequestNewTreasureOpen extends RequestMsg<CmdNewTreasureOpenReqMsg, CmdNewTreasureOpenRspMsg> {
    getReqMsgProtoName(): ReqMsgProtoName { return 'CmdNewTreasureOpenReqMsg'; }
}

interface IBoxConfig {
    readonly cardBoxID: number;
    /** 激活后的等待时长，单位为秒。 */
    readonly cardBoxOpenTime: number;
    /** 「立即打开」的消耗，形如 `10_10`（第一段 = 货币数量）。 */
    readonly cardBoxOpenNow?: unknown;
    /** 抽卡池权重：`[{ poolId, pro }]`，`pro` 是**百分比**。 */
    readonly cardDropRate?: unknown;
}

interface IBoxItemConfig {
    readonly resId: number;
    readonly name: string;
}

/** `itemBoxPro` 的一行：`boxResId` 池里出 `resId` 道具。 */
interface IBoxProRow {
    readonly boxResId?: unknown;
    readonly resId?: unknown;
    readonly pro?: unknown;
    readonly minNumber?: unknown;
    readonly maxNumber?: unknown;
}

/** 新宝箱服务端状态和旧版 ChestBar 之间的适配层。 */
export class NewTreasureRepository {
    private readonly infos = new Map<number, TreasureInfo>();
    private readonly configs = new Map<number, IBoxConfig>();
    private readonly names = new Map<number, string>();
    /** 读表缓存：详情弹窗要按 `resId` 查图标 / 品质（`roleProperty` 优先、`item` 兜底）。 */
    private propRows: readonly IResPropertyRow[] = [];
    private itemRows: readonly IItemRefRow[] = [];
    private boxProRows: readonly IBoxProRow[] = [];
    private readonly eventCaller = {};
    private readonly pendingActions = new Set<string>();
    private changeListener: ChestChangeListener | null = null;
    private isListening = false;
    private isLoading = false;

    get slots(): readonly IChestSlotData[] {
        const nowSeconds = Math.floor(Date.now() / 1000);
        return Array.from({ length: CHEST_SLOT_COUNT }, (_, slot) => {
            // 界面数组为 0～3，协议槽位固定为 1～4；出站请求始终保留服务端下标。
            const index = slot + 1;
            const info = this.infos.get(index);
            if (!info || info.cardBoxID <= 0) {
                return {
                    index,
                    state: ChestSlotState.Empty,
                    name: '',
                    remainSeconds: 0,
                    totalSeconds: 0,
                    action: ChestSlotAction.Battle,
                    cost: CHEST_EMPTY_SLOT_STAMINA_COST,
                };
            }

            const config = this.configs.get(info.cardBoxID);
            const durationSeconds = Math.max(0, config?.cardBoxOpenTime ?? 0);
            const name = this.names.get(info.cardBoxID) ?? `${BOX_NAME_PREFIX}${info.cardBoxID}`;
            if (info.openTime <= 0) {
                return {
                    index: info.index,
                    state: ChestSlotState.Ready,
                    name,
                    remainSeconds: durationSeconds,
                    totalSeconds: durationSeconds,
                    action: ChestSlotAction.Activate,
                    cost: 0,
                };
            }

            const remainSeconds = Math.max(0, info.openTime + durationSeconds - nowSeconds);
            return {
                index: info.index,
                state: remainSeconds > 0 ? ChestSlotState.Counting : ChestSlotState.Ready,
                name,
                remainSeconds,
                totalSeconds: durationSeconds,
                action: remainSeconds > 0 ? ChestSlotAction.SpeedUp : ChestSlotAction.Open,
                cost: 0,
            };
        });
    }

    /**
     * 道具品质（1..8，查不到给 1）。
     *
     * 两张表都有 `quality` 列，但 `IItemRefRow` 只声明了本模块用到的字段 ⇒ 这里按
     * 结构读（不是 `any` 兜盖：值照样 `Number()` 归一 + 夹到 >=1）。
     */
    private qualityOf(resId: number): number {
        const prop = this.propRows.find((row) => Number(row.resId) === resId);
        const item = this.itemRows.find((row) => Number(row.resId) === resId) as { quality?: unknown } | undefined;
        const quality = Number(prop?.quality ?? item?.quality);
        return Number.isFinite(quality) && quality >= 1 ? Math.floor(quality) : 1;
    }

    /**
     * 详情弹窗数据（纯数据，帧由页面加载）。
     *
     * 与 `slots` 的区别：那个给宝箱栏（4 格状态），这个给「宝箱详情」弹窗 ——
     * 多带品质 / 图标路径 / 奖励说明 / 立即打开价格。空槽位返回 `null`。
     */
    detailOf(index: number): IChestDetailData | null {
        const info = this.infos.get(index);
        if (!info || info.cardBoxID <= 0) return null;
        const config = this.configs.get(info.cardBoxID);
        const durationSeconds = Math.max(0, config?.cardBoxOpenTime ?? 0);
        const remainSeconds = info.openTime <= 0
            ? durationSeconds
            : Math.max(0, info.openTime + durationSeconds - Math.floor(Date.now() / 1000));
        const cell = resBarCellOfRefId(info.cardBoxID, this.propRows, this.itemRows);
        return {
            index: info.index,
            cardBoxId: info.cardBoxID,
            name: this.names.get(info.cardBoxID) ?? `${BOX_NAME_PREFIX}${info.cardBoxID}`,
            quality: this.qualityOf(info.cardBoxID),
            icon: resBarIconSpritePath(cell),
            rewards: this.detailRewards(info.cardBoxID),
            fastOpenCost: parseFastOpenCost(config?.cardBoxOpenNow),
            remainSeconds,
            state: info.openTime <= 0
                ? ChestSlotState.Ready
                : (remainSeconds > 0 ? ChestSlotState.Counting : ChestSlotState.Ready),
            action: info.openTime <= 0 ? ChestSlotAction.Activate
                : (remainSeconds > 0 ? ChestSlotAction.SpeedUp : ChestSlotAction.Open),
        };
    }

    /**
     * 奖励说明：把 `cardDropRate` 的每个池按 `itemBoxPro` 摊平成道具行。
     *
     * 每条带的概率是**池的概率**（`pro` 百分比），不是池内道具的概率 —— 池内 `pro` 全是 100，
     * 玩家真正关心的是「这个池 70% 会中」。取满 `CHEST_DETAIL_REWARD_SLOTS` 格为止。
     */
    private detailRewards(cardBoxId: number): readonly IChestDetailRewardData[] {
        const rates = Array.isArray(this.configs.get(cardBoxId)?.cardDropRate)
            ? this.configs.get(cardBoxId).cardDropRate as { poolId?: unknown; pro?: unknown }[]
            : [];
        const out: IChestDetailRewardData[] = [];
        for (const rate of rates) {
            const poolId = Number(rate.poolId);
            const ratePercent = Number(rate.pro);
            if (!Number.isSafeInteger(poolId) || poolId <= 0) continue;
            for (const row of this.boxProRows) {
                if (Number(row.boxResId) !== poolId) continue;
                const resId = Number(row.resId);
                if (!Number.isSafeInteger(resId) || resId <= 0) continue;
                out.push({
                    resId,
                    amount: Math.max(1, Math.floor(Number(row.maxNumber) || Number(row.minNumber) || 1)),
                    ratePercent: Number.isFinite(ratePercent) ? ratePercent : 0,
                    icon: resBarIconSpritePath(resBarCellOfRefId(resId, this.propRows, this.itemRows)),
                    quality: this.qualityOf(resId),
                });
                if (out.length >= CHEST_DETAIL_REWARD_SLOTS) return out;
            }
        }
        return out;
    }

    async load(caller: object, onChange: ChestChangeListener): Promise<'ok' | 'offline' | 'failed'> {
        this.changeListener = onChange;
        if (!this.isListening) {
            GameNet.instance.addEvent(TREASURE_BROADCAST, this.eventCaller, this.onBroadcast);
            this.isListening = true;
        }
        if (!GameNet.instance.isConnected) return 'offline';
        if (this.isLoading) return 'ok';
        this.isLoading = true;
        try {
            await this.loadConfig();
            const received: { value: boolean } = { value: false };
            const sent = await withTimeout(
                GameNet.instance.send(new RequestNewTreasureInfoList({}, caller, (rsp) => {
                    this.replaceInfos(rsp?.infos ?? []);
                    received.value = true;
                }), false),
                READ_TIMEOUT_MS,
                () => false,
            );
            return sent && received.value ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[NewTreasure] 加载宝箱队列失败', error);
            return 'failed';
        } finally {
            this.isLoading = false;
        }
    }

    async activate(index: number): Promise<Result> {
        if (!this.isValidIndex(index)) return 'failed';
        if (!GameNet.instance.isConnected) return 'offline';
        return this.withPendingAction(index, 'activate', async () => {
            let updated = false;
            const result = await this.send(
                new RequestNewTreasureActivate({ index }, undefined, (rsp) => {
                    if (rsp?.info) {
                        this.upsertInfo(rsp.info);
                        updated = true;
                    }
                }),
                WRITE_TIMEOUT_MS,
            );
            return result === 'ok' && updated ? 'ok' : result === 'ok' ? 'failed' : result;
        });
    }

    async fastOpen(index: number): Promise<Result> {
        if (!this.isValidIndex(index)) return 'failed';
        if (!GameNet.instance.isConnected) return 'offline';
        return this.withPendingAction(index, 'fastOpen', async () => {
            let succeeded = false;
            const result = await this.send(
                new RequestNewTreasureFastOpen({ index }, undefined, (rsp) => {
                    if (rsp?.succ !== 1) return;
                    this.removeInfo(rsp.index);
                    succeeded = true;
                    if (rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods);
                }),
                WRITE_TIMEOUT_MS,
            );
            return result === 'ok' && succeeded ? 'ok' : result === 'ok' ? 'failed' : result;
        });
    }

    async open(index: number): Promise<Result> {
        if (!this.isValidIndex(index)) return 'failed';
        if (!GameNet.instance.isConnected) return 'offline';
        const protoMgr = GameNet.instance.protoMgr;
        // 请求号由响应枚举建立映射；未提供开箱响应号时不发送无法匹配的请求。
        if (protoMgr?.getMessageId('CmdNewTreasureOpenReqMsg') == null) return 'protocol-missing';
        return this.withPendingAction(index, 'open', async () => {
            let succeeded = false;
            const result = await this.send(
                new RequestNewTreasureOpen({ index }, undefined, (rsp) => {
                    if (rsp?.succ !== 1) return;
                    this.removeInfo(rsp.index);
                    succeeded = true;
                    if (rsp.tlCmdGoods?.length) FW.ShowReward(rsp.tlCmdGoods);
                }),
                WRITE_TIMEOUT_MS,
            );
            return result === 'ok' && succeeded ? 'ok' : result === 'ok' ? 'failed' : result;
        });
    }

    dispose(): void {
        this.changeListener = null;
        if (this.isListening) {
            GameNet.instance.removeCallerEvent(this.eventCaller);
            this.isListening = false;
        }
    }

    private async send<Req, Rsp>(request: RequestMsg<Req, Rsp>, timeoutMs: number): Promise<Result> {
        try {
            const sent = await withTimeout(GameNet.instance.send(request, false), timeoutMs, () => false);
            return sent ? 'ok' : 'failed';
        } catch (error) {
            console.warn('[NewTreasure] 宝箱操作失败', error);
            return 'failed';
        }
    }

    private async withPendingAction(index: number, action: string, perform: () => Promise<Result>): Promise<Result> {
        const key = `${index}:${action}`;
        if (this.pendingActions.has(key)) return 'busy';
        this.pendingActions.add(key);
        try {
            return await perform();
        } finally {
            this.pendingActions.delete(key);
        }
    }

    private async loadConfig(): Promise<void> {
        if (this.configs.size > 0) return;
        // 四张表一次并行：配置（时长/价格/池权重）+ 名称 + 图标/品质（两张表）+ 池内容。
        // 任何一张读不到都只是「详情里少一块」，不阻断宝箱栏本身。
        const [rows, items, props, boxPro] = await Promise.all([
            RefUtil.instance.getRefAllAsync('newTreasureBoxConfig').catch(() => null) as Promise<IBoxConfig[] | null>,
            RefUtil.instance.getRefAllAsync(ITEM_TABLE).catch(() => null) as Promise<IBoxItemConfig[] | null>,
            RefUtil.instance.getRefAllAsync(ROLE_PROPERTY_TABLE).catch(() => null) as Promise<IResPropertyRow[] | null>,
            RefUtil.instance.getRefAllAsync('itemBoxPro').catch(() => null) as Promise<IBoxProRow[] | null>,
        ]);
        for (const row of rows ?? []) {
            if (Number.isSafeInteger(row.cardBoxID) && row.cardBoxID > 0) {
                this.configs.set(row.cardBoxID, row);
            }
        }
        this.itemRows = (items ?? []) as readonly IItemRefRow[];
        this.propRows = props ?? [];
        this.boxProRows = boxPro ?? [];
        for (const item of items ?? []) {
            if (this.configs.has(item.resId) && typeof item.name === 'string' && item.name.trim()) {
                this.names.set(item.resId, item.name.trim());
            }
        }
    }

    private readonly onBroadcast = (message: unknown): void => {
        const info = (message as { info?: TreasureInfo } | null)?.info;
        if (info) this.upsertInfo(info);
    };

    private replaceInfos(infos: readonly TreasureInfo[]): void {
        this.infos.clear();
        for (const info of infos) {
            if (this.isValidInfo(info)) this.infos.set(info.index, info);
        }
        this.render();
    }

    private upsertInfo(info: TreasureInfo): void {
        if (!this.isValidInfo(info)) return;
        this.infos.set(info.index, info);
        this.render();
    }

    private isValidIndex(index: number): boolean {
        return Number.isSafeInteger(index) && index >= 1 && index <= CHEST_SLOT_COUNT;
    }

    private isValidInfo(info: TreasureInfo): boolean {
        return this.isValidIndex(info.index)
            && Number.isSafeInteger(info.cardBoxID) && info.cardBoxID >= 0
            && Number.isSafeInteger(info.openTime) && info.openTime >= 0;
    }

    private removeInfo(index: number): void {
        this.infos.delete(index);
        this.render();
    }

    private render(): void {
        this.changeListener?.(this.slots);
    }
}

/**
 * `cardBoxOpenNow` 形如 `10_10` → 货币消耗（第一段）。
 *
 * 表里这两个数是「货币数量_另一段」，策划文档没写第二段是什么；详情弹窗只需要
 * 一颗按钮上的价格，所以取第一段、第二段原样忽略（拿到真实口径再补语义）。
 */
function parseFastOpenCost(raw: unknown): number {
    const text = typeof raw === 'string' ? raw : '';
    const head = Number(text.split('_')[0]);
    return Number.isFinite(head) && head > 0 ? Math.floor(head) : 0;
}
