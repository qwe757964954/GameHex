/**
 * 匹配界面四张表：grade（段位名）、pvpArtifact（神器名）、head + icon（头像）。
 * 查不到返回空串，界面保留兜底值。会话内缓存。
 */
import type { ConfigService } from '../../core/config/ConfigService';
import { RefUtil } from '../../framework/ref/RefUtil';
import {
    ArtifactRow, GradeRow, HeadRow, IconRow, MatchProfileLookup, buildMatchProfileLookup,
} from '../battle/BattleStartModel';

export const MATCH_PROFILE_TABLES = ['grade', 'pvpArtifact', 'head', 'icon'] as const;

let cached: MatchProfileLookup | null = null;

/** 读四张表建解析器。失败不抛，缓存空解析器（界面用兜底值）。 */
export async function loadMatchProfileLookup(configs?: ConfigService): Promise<MatchProfileLookup> {
    if (cached) return cached;
    try {
        const [gradeRows, artifactRows, headRows, iconRows] = configs
            ? await Promise.all(MATCH_PROFILE_TABLES.map((name) => configs.getTable(name)))
            : await Promise.all(MATCH_PROFILE_TABLES.map((name) => RefUtil.instance.getRefAllAsync(name)));
        cached = buildMatchProfileLookup(
            gradeRows as GradeRow[],
            artifactRows as ArtifactRow[],
            headRows as HeadRow[],
            iconRows as IconRow[],
        );
    } catch (error) {
        console.error('[MatchProfileConfig] 表读取失败，信息条保留兜底值', error);
        cached = buildMatchProfileLookup(null, null);
    }
    return cached;
}
