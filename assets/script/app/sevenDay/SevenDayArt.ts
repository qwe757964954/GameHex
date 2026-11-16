/**
 * 七日狂欢美术口径。
 * item.icon 已是 resources 资源路径（icons/分类/文件名），直接解析。
 */

export const SEVEN_DAY_ART_ROOT = 'image/sevenDay';

/** 品质框统一在 `common/QualityFrameArt`，这里只转发，不重算。 */
export {
    QUALITY_FRAME_ROOT,
    QUALITY_FRAME_NAMES,
    qualityFrameLevel,
    qualityFrameName,
} from '../common/QualityFrameArt';

export type { IItemIconRef as ISevenDayIconRef } from '../common/RewardIcon';

/** 旧导出名保留；实现已归位到 `common/RewardIcon`。 */
export {
    ITEM_ICON_ALIASES as SEVEN_DAY_ITEM_ICON_MAP,
    ITEM_ICON_PATH_ROOT as SEVEN_DAY_ICON_PATH_ROOT,
    splitIconPath,
    resolveItemIconRef,
    resolveItemIconPath,
} from '../common/RewardIcon';
