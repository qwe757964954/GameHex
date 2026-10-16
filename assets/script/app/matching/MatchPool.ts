import { MatchPlayerData } from './MatchTypes';

/**
 * 本机玩家展示占位 —— 服务端 PVP 信息 / 战斗单元到达前的空占位。
 *
 * 昵称与头像从 `CmdRole` 缓存读（登录即有）；战力/段位/神器等服务端下发后覆盖。
 * 头像查不到时显示占位图 `img_people`。
 */

/** 本机玩家的展示占位。 */
export const LOCAL_PLAYER: MatchPlayerData = {
    name: '',
    avatarIcon: 'img_people',
    power: 0,
    rank: '',
    trophy: 0,
    artifactName: '',
    artifactIcon: '',
    stats: [],
};
