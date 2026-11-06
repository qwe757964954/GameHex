/**
 * 首充礼包道具展示：品质框。
 * 物品图标按物品表 icon 路径直接加载，见 CardLineupIcons.loadIconByArtPath。
 */

export interface IFirstRechargeItemInfo {
    readonly resId: number;
    readonly name: string;
    /** 物品图标在 resources 下的直接路径（icons/ 开头）；空 = 无图。 */
    readonly icon: string;
    readonly quality: number;
}

/** 品质框统一在 `common/QualityFrameArt`，这里只转发，不重算。 */
export {
    QUALITY_FRAME_ROOT,
    QUALITY_FRAME_NAMES,
    qualityFrameLevel,
    qualityFrameName,
} from '../common/QualityFrameArt';
