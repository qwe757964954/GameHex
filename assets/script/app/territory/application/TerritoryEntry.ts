import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { readRoleRow } from '../../main/MainRoleRow';
import { CacheMgr } from '../../net/CacheMgr';
import { GameNet } from '../../net/GameNet';
import { toCount, toIdString } from '../../net/RequestGuard';
import { TerritoryModel } from './TerritoryModel';
import { TerritoryController } from './TerritoryController';
import { TerritoryChapterLoader } from './TerritoryChapterLoader';
import { TerritoryCellRepository } from './TerritoryCellRepository';
import { TerritoryChapterInfoRepository } from './TerritoryChapterInfoRepository';
import { TerritorySaveStoreAdapter } from './TerritorySaveStoreAdapter';
import { TERRITORY_FALLBACK_WALLET } from './TerritoryTexts';
import type { ITerritorySaveOwner, TerritoryWallet } from '../model/TerritorySaveStore';

/** Composition root, one instance per mounted chapter page. */
export class TerritoryEntry {
    readonly controller: TerritoryController;
    readonly saveOwner: ITerritorySaveOwner | null;

    constructor(context: IControllerContext, schedule: (callback: () => void, seconds: number) => () => void) {
        const role = readRoleRow();
        this.saveOwner = role ? { roleId: toIdString(role.id), serverId: toIdString(role.selectServerId) } : null;
        const chapters = TerritoryChapterInfoRepository.instance.availableChapters;
        const cells = new TerritoryCellRepository();
        const readWallet = (): TerritoryWallet | null => {
            const current = readRoleRow();
            return current ? { silver: Math.max(0, toCount(current.gold)), stamina: Math.max(0, toCount(current.end)) } : null;
        };
        const controller = new TerritoryController((resources) => new TerritoryModel({
            loader: new TerritoryChapterLoader(resources.assets), gateway: cells,
            store: new TerritorySaveStoreAdapter(this.saveOwner, chapters, chapters[0] ?? 1),
            availableChapters: chapters,
            walletSeed: () => readWallet() ?? { ...TERRITORY_FALLBACK_WALLET },
            readServerWallet: readWallet,
            // Evaluated only when a request is sent, after the Controller has been assigned.
            get lifecycleHost() { return controller; },
        }), {
            context,
            cells, network: GameNet.instance, schedule,
            roleCache: { subscribe: (callback) => {
                CacheMgr.instance.setEventUpdate('CmdRole', controller, callback);
                return () => CacheMgr.instance.removeEventUpdate('CmdRole', controller, callback);
            } },
        });
        this.controller = controller;
    }
    start(): void { this.controller.start(); }
    dispose(): void { this.controller.dispose(); }
}
