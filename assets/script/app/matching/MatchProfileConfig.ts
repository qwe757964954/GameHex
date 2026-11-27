import type { ConfigService } from '../../core/config/ConfigService';
import { buildMatchProfileLookup } from '../battle/BattleStartModel';
import type { ArtifactRow, GradeRow, HeadRow, IconRow, MatchCardRow, MatchProfileLookup } from '../battle/BattleStartModel';

import { HEAD_TABLE, ICON_TABLE, PVP_ARTIFACT_TABLE, PVP_CARD_TABLE } from '../../core/config/TableNames';
/** 配置缓存由 ConfigService 管理；读取失败仅影响本次展示。 */
export async function loadMatchProfileLookup(configs: ConfigService): Promise<MatchProfileLookup> {
    try {
        const [grades, artifacts, heads, icons, cards] = await Promise.all([
            configs.getTable<GradeRow>('grade'),
            configs.getTable<ArtifactRow>(PVP_ARTIFACT_TABLE),
            configs.getTable<HeadRow>(HEAD_TABLE),
            configs.getTable<IconRow>(ICON_TABLE),
            configs.getTable<MatchCardRow>(PVP_CARD_TABLE),
        ]);
        return buildMatchProfileLookup(grades, artifacts, heads, icons, cards);
    } catch (error) {
        console.error('[MatchProfileConfig] 表读取失败，信息条保留兜底值', error);
        return buildMatchProfileLookup(null, null);
    }
}
