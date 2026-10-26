import type { AssetService } from '../../../core/asset/AssetService';
import type { ConfigService } from '../../../core/config/ConfigService';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import { MAP_DIRECTORY } from '../ZCGame';
import { ZCGameLoader } from './ZCGameLoader';
import { ZCGamePreload } from './ZCGamePreload';

export interface IZCBattlePreparationOptions {
    readonly waveCardIds?: readonly number[];
    readonly playerCount?: 2 | 3 | 4;
}

/** 两种地图入口共用资源准备与单次移交；不保存战斗数据或节点。 */
export function createZCBattlePreload(assets: AssetService, configs: ConfigService,
    battle: Promise<ZCBattleStart | null>, options: IZCBattlePreparationOptions = {}): ZCGamePreload {
    const startedAt = Date.now();
    const preload = new ZCGamePreload(new ZCGameLoader(assets, configs, MAP_DIRECTORY,
        Math.random, options.playerCount), battle, options.waveCardIds);
    void preload.ready.then(
        () => console.info(`[BattleLoading] 资源准备完成 ${Math.max(0, Date.now() - startedAt)}ms`),
        () => {},
    );
    return preload;
}
