/**
 * 单机 / 离线档的榜单实现 —— 行为与「接服务器之前」等价（单人、无拥挤）。
 *
 * 联机版应当平级再写一个 `RemoteBigMapRankProvider`（走 `ReqBigMapCityInfo`），
 * 组合根按环境挑一个注入；`BigMapPresenter` 只认 `IBigMapRankProvider`，一行不用改。
 */
import type { IBigMapConfig } from '../model/BigMapTypes';
import { buildBigMapCityRankBoard, type IBigMapCityRankBoard, type IBigMapRankProvider } from '../model/BigMapRank';

export class NpcBigMapRankProvider implements IBigMapRankProvider {
    constructor(private readonly config: IBigMapConfig) {}

    async fetchCityRank(cityId: number, playerWarScore: number): Promise<IBigMapCityRankBoard> {
        return buildBigMapCityRankBoard(this.config, cityId, playerWarScore);
    }
}
