/**
 * 七日狂欢美术口径。
 *
 * 图标解析新入口是 `common/RewardIcon`；禁止新增 `SevenDayArt.splitIconPath` /
 * `SevenDayArt.resolveItemIconRef` 调用。本文件只保留七日目录与品质框转发；
 * 当全仓（含测试）不再存在上述旧路径调用、且本文件只剩业务美术导出时，不再恢复图标转发符号。
 * `item.icon` 已是 resources 资源路径（icons/分类/文件名），调用方直接从 common 解析。
 */

import { SEVEN_DAY_ART_ROOT as ART_SEVEN_DAY_ROOT } from '../ArtPaths';

export const SEVEN_DAY_ART_ROOT = ART_SEVEN_DAY_ROOT;

/** 品质框统一在 `common/QualityFrameArt`，这里只转发，不重算。 */
export {
    QUALITY_FRAME_ROOT,
    QUALITY_FRAME_NAMES,
    qualityFrameLevel,
    qualityFrameName,
} from '../common/QualityFrameArt';

/** 道具图标解析在 `common/RewardIcon`；本文件不再转发，调用方直接 import 真源。 */
