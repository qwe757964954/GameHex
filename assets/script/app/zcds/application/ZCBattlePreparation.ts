import { ComponentController } from '../../../framework/controller/ComponentController';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import { MAP_DIRECTORY } from '../ZCGame';
import { ZCGameLoader } from './ZCGameLoader';
import { ZCGamePreload } from './ZCGamePreload';

export interface IZCBattlePreparationOptions {
    readonly waveCardIds?: readonly number[];
    readonly playerCount?: 2 | 3 | 4;
}

/** 两种地图入口共用资源准备与单次移交；不保存战斗数据或节点。 */
export function createZCBattlePreload(battle: Promise<ZCBattleStart | null>, options: IZCBattlePreparationOptions = {}): ZCGamePreload {
    const startedAt = Date.now();
    const controller = new ComponentController('battle:preparation');
    let preload: ZCGamePreload;
    try {
        preload = new ZCGamePreload(new ZCGameLoader(controller.resources, MAP_DIRECTORY,
            Math.random, options.playerCount), battle, options.waveCardIds, () => controller.dispose());
    } catch (error) {
        controller.dispose();
        throw error;
    }
    void preload.ready.then(
        resources => console.info(`[BattleLoading] ${resources.loadDeferredArt ? '首帧资源准备完成' : '资源准备完成'} ${Math.max(0, Date.now() - startedAt)}ms`),
        () => {},
    );
    return preload;
}
