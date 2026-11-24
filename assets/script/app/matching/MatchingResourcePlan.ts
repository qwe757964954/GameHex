import {
    ARTIFACT_ART_ROOT, CARD_ROLE_ICON_BY_ATTACK, HEAD_ART_ROOT, ICON_ART_ROOT,
    MATCH_ART_ROOT, MATCH_CARD_FRAME_ART, MATCH_SEARCH_BARS, MATCH_SLOT_BARS, MATCH_SLOT_PILLS,
} from '../ArtPaths';
import type { MatchProfileLookup } from '../battle/BattleStartModel';
import type { IIconLoader } from '../common/SpriteFrameCache';

/** 资源描述符：根目录 + 资源名。 */
export interface IArtDescriptor {
    readonly root: string;
    readonly name: string;
}

/** 匹配页面默认底图及占位头像。 */
export const DEFAULT_MATCH_AVATAR = 'tx_01';

/**
 * 纯函数：计算进入匹配流程需要预热的所有美术资产清单。
 * 零 I/O、无外部依赖、纯数据输出，支持单测 0 Mock 秒级验证。
 */
export function buildMatchingArtPlan(
    lookup: MatchProfileLookup,
    avatarId: string,
): readonly IArtDescriptor[] {
    const plan: IArtDescriptor[] = [];

    // 本机头像（经 headArt 表解析）
    const avatarName = lookup?.headArt?.artName ? lookup.headArt.artName(avatarId) : '';
    if (avatarName) {
        plan.push({ root: HEAD_ART_ROOT, name: avatarName });
    }

    // 匹配常规 UI 与槽位视觉组件
    const matchingArt = [DEFAULT_MATCH_AVATAR, 'icon_fdj', 'search_avatar']
        .concat(MATCH_SLOT_BARS, MATCH_SEARCH_BARS, MATCH_SLOT_PILLS, Object.values(MATCH_CARD_FRAME_ART));
    for (const name of matchingArt) {
        if (name) plan.push({ root: MATCH_ART_ROOT, name });
    }

    // 卡牌职业角标
    for (const name of Object.values(CARD_ROLE_ICON_BY_ATTACK)) {
        if (name) plan.push({ root: ICON_ART_ROOT, name });
    }

    // 全局神器图标（对局开始前回包未达，双方神器未知，需全部预热）
    if (lookup?.allArtifactIcons) {
        for (const name of lookup.allArtifactIcons()) {
            if (name) plan.push({ root: ARTIFACT_ART_ROOT, name });
        }
    }

    return plan;
}

/** 批量加载美术资产清单。 */
export async function preloadArtPlan(
    loadIcon: IIconLoader,
    plan: readonly IArtDescriptor[],
): Promise<void> {
    await Promise.all(plan.map(art => loadIcon(art.name, art.root)));
}
