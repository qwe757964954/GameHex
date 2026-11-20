import { ZCDC_LOG_DIAGNOSTICS } from '../ZCDCLogSwitch';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { MAP_DIRECTORY } from '../ZCGame';
import type { ZCGame } from '../ZCGame';
import { ZCGameLoader } from './ZCGameLoader';
import { ZCBattleController, type IZCBattleSessionInput } from './ZCBattleController';
import { buildZCBattleEntry, resolveZCBattlePlayerCount } from './ZCBattleEntryBuilder';
import { createTerritorySaveStore } from '../../territory/application/TerritorySaveStoreAdapter';

/** 所有入口都从这里建单局会话；资源服务由组合层注入，节点等战斗流程起来再挂。*/
export function createZCBattleSession(context: IControllerContext, input: IZCBattleSessionInput): ZCBattleController<ZCGame> {
    const startedAt = Date.now();
    const session = new ZCBattleController<ZCGame>(context, {
        prepareDirect: (scope, entry, resources) => {
            const loader = new ZCGameLoader(resources, MAP_DIRECTORY, Math.random, resolveZCBattlePlayerCount(entry));
            const battle = entry ? entry.battle : undefined;
            const extraCards = entry && entry.pve ? entry.pve.waves.map(wave => wave.pvpCardId) : undefined;
            return loader.prepare(scope, battle, extraCards);
        },
        buildEntry: buildZCBattleEntry,
        resolvePveResult: (pve, victory) => {
            createTerritorySaveStore(pve.territorySaveOwner).resolveBattle(pve.chapterId, pve.territoryCellId, pve.levelId, victory);
        },
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
