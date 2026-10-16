/**
 * 战斗指南（zcds）的 UI 侧 barrel：把 model 层的配置/解析能力按原路径转出。
 *
 * 原先还放了品级配色表与 `guideRewardColor`，但全工程唯一消费类是 `ZCGuideItem`
 * —— 按 §6.2 第 12 条，已内聚为 `ZCGuideItem` 的私有静态成员，本文件只保留转发。
 */
export {
    getGuideIconPath,
    parseGuideEntries,
    parseGuideParams,
} from '../model/ZCGuideConfig';
export type {
    ZCGuideEntry,
    ZCGuideParams,
    ZCGuideRarity,
    ZCGuideReward,
} from '../model/ZCGuideConfig';
