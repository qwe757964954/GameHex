import type { ConfigService } from '../../core/config/ConfigService';
import { buildMatchProfileLookup } from '../battle/BattleStartModel';
import type { ArtifactRow, GradeRow, HeadRow, IconRow, MatchProfileLookup } from '../battle/BattleStartModel';

/** 配置缓存由 ConfigService 管理；读取失败仅影响本次展示。 */
export async function loadMatchProfileLookup(configs: ConfigService): Promise<MatchProfileLookup> {
    try {
        const [grades, artifacts, heads, icons] = await Promise.all([
            configs.getTable<GradeRow>('grade'),
            configs.getTable<ArtifactRow>('pvpArtifact'),
            configs.getTable<HeadRow>('head'),
            configs.getTable<IconRow>('icon'),
        ]);
        return buildMatchProfileLookup(grades, artifacts, heads, icons);
    } catch (error) {
        console.error('[MatchProfileConfig] 表读取失败，信息条保留兜底值', error);
        return buildMatchProfileLookup(null, null);
    }
}
