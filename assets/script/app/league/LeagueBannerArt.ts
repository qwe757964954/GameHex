import type { SpriteFrame } from 'cc';
import { loadArt } from '../card/CardLineupIcons';
import { LEAGUE_ART_ROOT, LEAGUE_BANNER_COLOR_COUNT, leagueBannerArt } from './LeagueArt';

/** 八张旗面图名（按 FGUI `颜色` 页序）。 */
const LEAGUE_BANNER_NAMES: readonly string[] = Array.from(
    { length: LEAGUE_BANNER_COLOR_COUNT },
    (_, index) => leagueBannerArt(index),
);

/** 一次性预加载八张旗面；`loadArt` 解不出的槽位保留 `null`。 */
export function loadLeagueBannerFrames(): Promise<(SpriteFrame | null)[]> {
    return Promise.all(LEAGUE_BANNER_NAMES.map((name) => loadArt(name, LEAGUE_ART_ROOT)));
}
