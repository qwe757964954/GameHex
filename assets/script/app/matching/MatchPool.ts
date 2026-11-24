import type { MatchPlayerData } from './MatchTypes';

/** 服务端数据到达前的展示占位，调用方不得就地修改。 */
export const LOCAL_PLAYER: Readonly<MatchPlayerData> = {
    name: '',
    avatarIcon: 'tx_01',
    power: 0,
    rank: '',
    trophy: 0,
    artifactName: '',
    artifactIcon: '',
    stats: [],
    cards: [],
};
