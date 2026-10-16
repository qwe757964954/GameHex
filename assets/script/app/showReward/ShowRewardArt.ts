/**
 * 「获得奖励」弹窗美术入口（纯数据、零 `cc`，便于单测做「映射 ↔ 磁盘 ↔ `.meta` border」对账）。
 * 加载复用 ItemDetailArtLoader 的缓存；公共件（hintBg / star）落 `image/common`，不在本模块另存。
 */

/** 本模块自有图目录（`assets/resources/image/showReward`）。 */
export const SR_ART_DIR = 'showReward';

/** 全部图 key → 相对 `assets/resources/image/` 的路径；compile() 按 FGUI 原尺寸反查，不符即 throw。 */
export const SR_ART_NAMES: Readonly<Record<string, string>> = {
    /** 弹窗底 338×280，九宫 border 84,97,86,114；实例显示 648×402。 */
    panelBg: 'showReward/sr_panel_bg',
    /** 标题图「获得奖励」388×97，无九宫；实例显示 456×114（等比放大）。 */
    title: 'showReward/sr_title',
    /** 奖励格闪光 200×200，无九宫；add 混合、color #ffd077。 */
    glow: 'showReward/sr_glow',
    /** 底部提示条底 310×32，无九宫，不缩放。 */
    hintBg: 'common/cu_hint_bg',
    /** 星点 100×100，无九宫；5 处按 27~56 缩放。 */
    star: 'common/cu_star_01',
};

/** SLICED 图（`.png.meta` border 非 0），生成器会与 `.meta` 双向对账；仅弹窗底是九宫。 */
export const SR_ART_SLICED: ReadonlySet<string> = new Set<string>([
    'panelBg',     // 获得奖励_底框01   border 84,97,86,114
]);

/** 平铺图（本模块无；生成器内核要求该集合存在，写法必须带 `([`）。 */
export const SR_ART_TILED: ReadonlySet<string> = new Set<string>([]);
