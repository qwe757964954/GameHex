import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import type { ZCBattleController } from '../../zcds/application/ZCBattleController';
import type { ZCGame } from '../../zcds/ZCGame';
import type { ZCGameEntryParams } from '../../zcds/application/ZCGameEntry';
import type { ITerritoryCellGateway, ITerritoryNavigateBattlePayload } from './TerritoryModel';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { GameRoute } from '../../../core/runtime/GameRoute';
import { ResourceScope } from '../../../core/asset/ResourceScope';
import {
    createScopedResources,
    type IControllerContext,
    type IControllerResources,
} from '../../../framework/controller/ControllerBase';
import { readRoleRow } from '../../main/MainRoleRow';
import { CacheMgr } from '../../net/CacheMgr';
import { GameNet } from '../../net/GameNet';
import { toCount, toIdString } from '../../net/RequestGuard';
import { TerritoryModel } from './TerritoryModel';
import { TerritoryController, type ITerritoryControllerOptions } from './TerritoryController';
import { TerritoryChapterLoader } from './TerritoryChapterLoader';
import { TerritoryCellRepository } from './TerritoryCellRepository';
import { TerritoryChapterInfoRepository } from './TerritoryChapterInfoRepository';
import { TerritorySaveStoreAdapter } from './TerritorySaveStoreAdapter';
import { TERRITORY_DEFAULT_PLAYER_COUNT, TERRITORY_FALLBACK_WALLET } from './TerritoryTexts';
import type { ITerritorySaveOwner, TerritoryWallet } from '../model/TerritorySaveStore';

type ITerritoryBattlePort = NonNullable<ITerritoryControllerOptions['battle']>;

/**
 * Composition root, one instance per mounted chapter page.
 *
 * 页面 scope、Model、Controller、Repository 全在这里装配一次：Model 由本类构造后交给
 * Controller 消费，Controller 不再参与装配；页面 scope 也归本类，销毁时统一释放。
 */
export class TerritoryEntry {
    readonly controller: TerritoryController;
    /** 页面作用域下的展示资源；章节美术（Model）与地块 / 宝箱 / 云（View）共用这一个 scope。 */
    readonly resources: IControllerResources;
    readonly saveOwner: ITerritorySaveOwner | null;
    private readonly scope = new ResourceScope('territory-page');
    private battleSession: ZCBattleController<ZCGame> | null = null;
    private battlePayload: ITerritoryNavigateBattlePayload | null = null;
    private disposed = false;

    constructor(context: IControllerContext, schedule: (callback: () => void, seconds: number) => () => void) {
        const role = readRoleRow();
        this.saveOwner = role ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) } : null;
        this.resources = createScopedResources(context, this.scope);
        let controller: TerritoryController;
        try {
            const chapters = TerritoryChapterInfoRepository.instance.availableChapters;
            // caller 在构造时注入（本页宿主）：仓储本身就是网关端口，不再套一层转发 lambda。
            const cells = new TerritoryCellRepository(this);
            this.scope.defer(() => cells.cancelBattleStart());
            const model = this.createModel(this.resources, cells, chapters);
            // 写请求被服务端拒绝时下发的是 `CmdTips`、**不派发 Rsp 事件** ⇒ 业务侧收不到任何
            // 信号，只能等 5 秒硬超时（玩家看到的是「菊花一直转」）。仓储把 `fErrorCallback`
            // 接出来，这里直接回灌 Model 当场收尾。
            cells.onWriteError = (requestName, reason) => model.applyWriteError(requestName, reason);
            controller = new TerritoryController(model, this.createControllerOptions(context, schedule, cells));
        } catch (error) {
            // 装配失败时本类不会再被持有，页面 scope 必须当场释放，否则章节美术引用漏到场景卸载。
            this.scope.dispose();
            throw error;
        }
        this.controller = controller;
    }

    private createModel(resources: IControllerResources, gateway: ITerritoryCellGateway,
        chapters: readonly number[]): TerritoryModel {
        return new TerritoryModel({
            loader: new TerritoryChapterLoader(resources.assets), gateway,
            store: new TerritorySaveStoreAdapter(this.saveOwner, chapters, chapters[0] ?? 1),
            availableChapters: chapters,
            walletSeed: () => this.readWallet() ?? { ...TERRITORY_FALLBACK_WALLET },
            readServerWallet: () => this.readWallet(),
            // 章节级挂机起点只读账号单例（登录后已拉过一次），Model 不再重复发 Info 请求。
            readServerIdleTimeSeconds: () => TerritoryChapterInfoRepository.instance.current?.idleTime ?? null,
            // 领奖回包的 `idleTime` 是新起点：写回单例，弹窗 / 金币车下一次读就是新值。
            writeServerIdleTimeSeconds: (seconds) => TerritoryChapterInfoRepository.instance.applyIdleTime(seconds),
        });
    }

    private createControllerOptions(context: IControllerContext,
        schedule: (callback: () => void, seconds: number) => () => void,
        cells: TerritoryCellRepository): ITerritoryControllerOptions {
        return {
            context,
            battle: this.createBattlePort(context),
            cells, schedule,
            roleCache: { subscribe: (caller, callback) => {
                CacheMgr.instance.setEventUpdate('CmdRole', caller, callback);
                return () => CacheMgr.instance.removeEventUpdate('CmdRole', caller, callback);
            } },
        };
    }

    private createBattlePort(context: IControllerContext): ITerritoryBattlePort {
        return {
            prepare: (payload, owner) => {
                if (payload.pve.mode === 'match') return undefined;
                this.battleSession?.dispose();
                const params = this.battleParams(payload);
                const session = createZCBattleSession(context, { owner, battle: Promise.resolve(payload.battle ?? null), params });
                this.battleSession = session;
                this.battlePayload = payload;
                return session.ready;
            },
            enter: payload => {
                if (payload !== this.battlePayload) return;
                const session = this.battleSession;
                this.battleSession = null;
                this.battlePayload = null;
                ProcedureManager.navigate(GameRoute.Battle, {
                    ...this.battleParams(payload), session: session?.isDisposed ? undefined : session,
                });
            },
        };
    }

    private readWallet(): TerritoryWallet | null {
        const role = readRoleRow();
        return role ? { silver: Math.max(0, toCount(role.gold)), stamina: Math.max(0, toCount(role.end)) } : null;
    }

    private battleParams(payload: ITerritoryNavigateBattlePayload): ZCGameEntryParams {
        return { pve: { ...payload.pve, playerCount: TERRITORY_DEFAULT_PLAYER_COUNT, territorySaveOwner: this.saveOwner }, battle: payload.battle,
            selfRoleId: this.saveOwner?.roleId };
    }
    start(): void { this.controller.start(); }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.controller.dispose();
        GameNet.instance.removeCaller(this);
        this.scope.dispose();
    }
}
