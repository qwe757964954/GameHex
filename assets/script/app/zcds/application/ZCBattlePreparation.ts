import { ZCDC_LOG_DIAGNOSTICS } from '../ZCDCLogSwitch';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { MAP_DIRECTORY } from '../ZCGame';
import type { ZCGame } from '../ZCGame';
import { ZCGameLoader } from './ZCGameLoader';
import { ZCBattleController, type IZCBattleSessionInput } from './ZCBattleController';
import { buildZCBattleEntry, resolveZCBattlePlayerCount } from './ZCBattleEntryBuilder';
import { createTerritorySaveStore } from '../../territory/application/TerritorySaveStoreAdapter';

/** 各入口创建同一单局会话；资源服务从组合入口注入，节点留到战斗流程挂载。 */
export function createZCBattleSession(context: IControllerContext, input: IZCBattleSessionInput): ZCBattleController<ZCGame> {
    const startedAt = Date.now();
    const session = new ZCBattleController<ZCGame>(context, {
        prepareDirect: (scope, entry, resources) => {
            const loader = new ZCGameLoader(resources, MAP_DIRECTORY, Math.random, resolveZCBattlePlayerCount(entry));
            return loader.prepare(scope, entry?.battle, entry?.pve?.waves.map(wave => wave.pvpCardId));
        },
        buildEntry: buildZCBattleEntry,
        resolvePveResult: (pve, victory) => {
            createTerritorySaveStore(pve.territorySaveOwner).resolveBattle(pve.chapterId, pve.territoryCellId, pve.levelId, victory);
        },
    }, input);
    void session.ready.then(
        resources => {
            if (ZCDC_LOG_DIAGNOSTICS) console.info(`[BattleLoading] ${resources.loadDeferredArt ? '首帧资源准备完成' : '资源准备完成'} ${Math.max(0, Date.now() - startedAt)}ms`);
        },
        () => {},
    );
    return session;
}
