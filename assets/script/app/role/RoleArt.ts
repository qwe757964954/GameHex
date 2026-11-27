import { ART_ROOT } from '../ArtPaths';

/** 角色模块运行时取图使用的键和值，路径相对 `assets/resources/image/`。 */
export const RL_ART_NAMES = {
    // 民兵天赋节点底图
    talentNodeBg: 'militia/ml_tf_icon_bg03',
    talentNodeOn: 'militia/ml_tf_icon_bg01',
    talentNodeCurrent: 'militia/ml_tf_icon_bg02',

    // 宝石替换面板
    arrowDown: 'common/cu_img_jian_tou_01',
    listRow: 'common/cu_list_02_9gong',
    tagEquipped: 'common/cu_tag_zhuang_bei_zhong',

    // 宝石详情品质底板
    gemHeaderBlue: 'role/gem_header_01',
    gemHeaderPurple: 'role/gem_header_02',
    gemHeaderGold: 'role/gem_header_03',
    gemHeaderGreen: 'role/gem_header_04',
    gemHeaderRed: 'role/gem_header_05',

    // 背包品质底
    bagQuality1: 'role/rl_bag_quality_01',
    bagQuality2: 'role/rl_bag_quality_02',
    bagQuality3: 'role/rl_bag_quality_03',
    bagQuality4: 'role/rl_bag_quality_04',
    bagQuality5: 'role/rl_bag_quality_05',
} as const;

export function roleArtRelPath(key: string): string {
    const rel = (RL_ART_NAMES as Readonly<Record<string, string>>)[key];
    return typeof rel === 'string' ? `${ART_ROOT}/${rel}` : '';
}

/**
 * 宝石详情左侧品质底板：蓝湖「底板品质」给出的 5 个品质色（绿 / 蓝 / 紫 / 金 / 红）。
 *
 * `gemQuality` 为 1..7（白 / 绿 / 蓝 / 紫 / 金 / 红 / 多彩）。白品质不铺色板，
 * 保持米色卡面；多彩没有独立切图，沿用最高档红色。返回空串表示隐藏底板。
 */
export function gemDetailHeaderKey(quality: number): string {
    const q = Math.floor(quality) || 1;
    if (q <= 1) return '';
    if (q === 2) return 'gemHeaderGreen';
    if (q === 3) return 'gemHeaderBlue';
    if (q === 4) return 'gemHeaderPurple';
    if (q === 5) return 'gemHeaderGold';
    return 'gemHeaderRed';
}
