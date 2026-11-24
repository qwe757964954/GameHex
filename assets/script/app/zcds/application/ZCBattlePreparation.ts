import { ZCDC_LOG_DIAGNOSTICS } from '../ZCDCLogSwitch';
import type { IControllerContext, IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import { MAP_DIRECTORY } from '../ZCGame';
import type { ZCGame } from '../ZCGame';
import { ZCGameLoader } from './ZCGameLoader';
import {
    ZCBattleController,
    type IZCBattleSessionInput,
    type IZCBattleResourceLoader,
    type IZCBattlePveResolver,
    type IZCBattleControllerServices,
} from './ZCBattleController';
import type { ZCGameEntryParams } from './ZCGameEntry';
import type { IZCGamePreparedResources } from './ZCGamePreparedResources';
import { buildZCBattleEntry, resolveZCBattlePlayerCount } from './ZCBattleEntryBuilder';
import { createTerritorySaveStore } from '../../territory/application/TerritorySaveStoreAdapter';

export class ZCBattleDefaultResourceLoader implements IZCBattleResourceLoader {
    prepare(scope: ResourceScope, entry: ZCGameEntryParams | undefined, resources: IControllerResources, _caller: object): Promise<IZCGamePreparedResources> {
        const loader = new ZCGameLoader(resources, MAP_DIRECTORY, Math.random, resolveZCBattlePlayerCount(entry));
        const battle = entry ? entry.battle : undefined;
        const extraCards = entry && entry.pve ? entry.pve.waves.map(wave => wave.pvpCardId) : undefined;
        return loader.prepare(scope, battle, extraCards);
    }
}

export class ZCBattleDefaultPveResolver implements IZCBattlePveResolver {
    resolvePveResult(pve: NonNullable<ZCGameEntryParams['pve']>, victory: boolean, _caller: object): void {
        createTerritorySaveStore(pve.territorySaveOwner).resolveBattle(pve.chapterId, pve.territoryCellId, pve.levelId, victory);
    }
}

const DEFAULT_RESOURCE_LOADER = new ZCBattleDefaultResourceLoader();
const DEFAULT_PVE_RESOLVER = new ZCBattleDefaultPveResolver();

/** 所有入口都从这里建单局会话；资源服务由组合层注入，节点等战斗流程起来再挂。*/
export function createZCBattleSession(context: IControllerContext, input: IZCBattleSessionInput): ZCBattleController<ZCGame> {
    const startedAt = Date.now();
    const session = new ZCBattleController<ZCGame>(context, {
        loader: DEFAULT_RESOURCE_LOADER,
        pveResolver: DEFAULT_PVE_RESOLVER,
        buildEntry: buildZCBattleEntry,
    }, input);

    void session.ready.then(
        (resources) => {
            if (!ZCDC_LOG_DIAGNOSTICS) return;
            const phase = resources.loadDeferredArt ? '首帧资源准备完成' : '资源准备完成';
            console.info(`[BattleLoading] ${phase} ${Math.max(0, Date.now() - startedAt)}ms`);
        },
        () => {},
    );
    return session;
}
