import type { AssetService } from '../../core/asset/AssetService';
import type { ResourceScope } from '../../core/asset/ResourceScope';
import type { MatchProfileLookup } from '../battle/BattleStartModel';
import { createIconLoader, type IIconLoader } from '../common/SpriteFrameCache';
import { buildMatchingArtPlan, preloadArtPlan } from './MatchingResourcePlan';

/**
 * 匹配流程图标加载门面。
 * 动态加载能力基于通用 createIconLoader，预热规则由 MatchingResourcePlan 纯函数提供。
 */
export class MatchIcons {
    readonly load: IIconLoader;

    constructor(assets: AssetService, scope: ResourceScope) {
        this.load = createIconLoader(assets, scope);
    }

    preload(lookup: MatchProfileLookup, avatarId: string): Promise<void> {
        return preloadArtPlan(this.load, buildMatchingArtPlan(lookup, avatarId));
    }
}
