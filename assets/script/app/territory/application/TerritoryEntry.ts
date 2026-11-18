import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import type { ZCBattleController } from '../../zcds/application/ZCBattleController';
import type { ZCGame } from '../../zcds/ZCGame';
import type { ZCGameEntryParams } from '../../zcds/application/ZCGameEntry';
import type { ITerritoryCellGateway, ITerritoryNavigateBattlePayload } from './TerritoryModel';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { GameRoute } from '../../../core/runtime/GameRoute';
import type { IControllerContext, IControllerResources } from '../../../framework/controller/ControllerBase';
import { readRoleRow } from '../../main/MainRoleRow';
import { CacheMgr } from '../../net/CacheMgr';
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

/** Composition root, one instance per mounted chapter page. */
export class TerritoryEntry {
    readonly controller: TerritoryController;
    private battleSession: ZCBattleController<ZCGame> | null = null;
    private battlePayload: ITerritoryNavigateBattlePayload | null = null;
    readonly saveOwner: ITerritorySaveOwner | null;

    constructor(context: IControllerContext, schedule: (callback: () => void, seconds: number) => () => void) {
        const role = readRoleRow();
        this.saveOwner = role ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) } : null;
        const chapters = TerritoryChapterInfoRepository.instance.availableChapters;
        const cells = new TerritoryCellRepository();
        this.controller = new TerritoryController(
            (resources, gateway) => this.createModel(resources, gateway, chapters),
            this.createControllerOptions(context, schedule, cells),
        );
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
    dispose(): void { this.controller.dispose(); }
}
