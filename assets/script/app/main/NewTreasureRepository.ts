import { FW } from '../../framework/FW';
import { RequestMsg } from '../../framework/net/RequestMsg';
import { RefUtil } from '../../framework/ref/RefUtil';
import { withTimeout } from '../net/RequestGuard';
import { GameNet } from '../net/GameNet';
import { CHEST_EMPTY_SLOT_STAMINA_COST, CHEST_SLOT_COUNT, ChestSlotAction, ChestSlotState } from './ChestTypes';
import type { IChestSlotData } from './ChestTypes';

type Result = 'ok' | 'offline' | 'failed' | 'protocol-missing' | 'busy';
type TreasureInfo = CmdNewTreasureInfo;
type ChestChangeListener = (slots: readonly IChestSlotData[]) => void;

const SECONDS_PER_MINUTE = 60;
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
    readonly cardBoxOpenTime: number;
}

/** 新宝箱服务端状态和旧版 ChestBar 之间的适配层。 */
export class NewTreasureRepository {
    private readonly infos = new Map<number, TreasureInfo>();
    private readonly configs = new Map<number, IBoxConfig>();
    private readonly eventCaller = {};
    private readonly pendingActions = new Set<string>();
    private changeListener: ChestChangeListener | null = null;
    private isListening = false;
    private isLoading = false;

    get slots(): readonly IChestSlotData[] {
        const nowSeconds = Math.floor(Date.now() / 1000);
        return Array.from({ length: CHEST_SLOT_COUNT }, (_, slot) => {
            const info = this.infos.get(slot);
            if (!info || info.cardBoxID <= 0) {
                return {
                    index: slot,
                    state: ChestSlotState.Empty,
                    name: '',
                    remainSeconds: 0,
                    totalSeconds: 0,
                    action: ChestSlotAction.Battle,
                    cost: CHEST_EMPTY_SLOT_STAMINA_COST,
                };
            }

            const config = this.configs.get(info.cardBoxID);
            const durationSeconds = Math.max(0, (config?.cardBoxOpenTime ?? 0) * SECONDS_PER_MINUTE);
            if (info.openTime <= 0) {
                return {
                    index: info.index,
                    state: ChestSlotState.Ready,
                    name: `${BOX_NAME_PREFIX}${info.cardBoxID}`,
                    remainSeconds: 0,
                    totalSeconds: durationSeconds,
                    action: ChestSlotAction.Activate,
                    cost: 0,
                };
            }

            const remainSeconds = Math.max(0, info.openTime + durationSeconds - nowSeconds);
            return {
                index: info.index,
                state: remainSeconds > 0 ? ChestSlotState.Counting : ChestSlotState.Ready,
                name: `${BOX_NAME_PREFIX}${info.cardBoxID}`,
                remainSeconds,
                totalSeconds: durationSeconds,
                action: remainSeconds > 0 ? ChestSlotAction.SpeedUp : ChestSlotAction.Open,
                cost: 0,
            };
        });
    }

    async load(caller: object, onChange: ChestChangeListener): Promise<'ok' | 'offline' | 'failed'> {
        this.changeListener = onChange;
        if (!this.isListening) {
            GameNet.instance.addEvent(TREASURE_BROADCAST, this.eventCaller as never, this.onBroadcast);
            this.isListening = true;
        }
        if (!GameNet.instance.isConnected) return 'offline';
        if (this.isLoading) return 'ok';
        this.isLoading = true;
        try {
            await this.loadConfig();
            const received: { value: boolean } = { value: false };
            const sent = await withTimeout(
                GameNet.instance.send(new RequestNewTreasureInfoList({}, caller as never, (rsp) => {
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
        const protoMgr = GameNet.instance.protoMgr;
        if (protoMgr?.getMessageId('CmdNewTreasureOpenReqMsg') == null) return 'protocol-missing';
        if (!GameNet.instance.isConnected) return 'offline';
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
            GameNet.instance.removeCallerEvent(this.eventCaller as never);
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
        const rows = await RefUtil.instance.getRefAllAsync('newTreasureBoxConfig') as IBoxConfig[] | null;
        for (const row of rows ?? []) {
            if (Number.isSafeInteger(row.cardBoxID) && row.cardBoxID > 0) {
                this.configs.set(row.cardBoxID, row);
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
        return Number.isSafeInteger(index) && index >= 0 && index < CHEST_SLOT_COUNT;
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
