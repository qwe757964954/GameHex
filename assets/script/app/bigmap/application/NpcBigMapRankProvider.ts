/**
 *单机 / 离线档的榜单实现 —— 行为与「接服务器之前」等价（单人、无拥挤）。
 *
 *联机版由 `RemoteBigMapRankProvider` 走服务器接口，组合根按环境挑一个注入；
 *`BigMapModel` 只认 `IBigMapRankProvider`，两边共用同一套视图字段。
 */
import type { IBigMapConfig } from '../model/BigMapTypes';
import { buildBigMapCityRankBoard, type IBigMapCityRankBoard, type IBigMapRankProvider } from '../model/BigMapRank';

export class NpcBigMapRankProvider implements IBigMapRankProvider {
    constructor(private readonly config: IBigMapConfig) {}

    async fetchCityRank(cityId: number, playerWarScore: number): Promise<IBigMapCityRankBoard> {
        return buildBigMapCityRankBoard(this.config, cityId, playerWarScore);
    }
}
