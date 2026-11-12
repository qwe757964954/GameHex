/**
 * 跨模块共享的资源路径表。
 *
 * 路径相对对应 bundle、不带扩展名；页面/弹窗私有 prefab 路径仍就近写在各自
 * `static prefabPath`，这里只放跨模块共享项，不要硬编码业务目录。
 */

/** Prefab 目录根。 */
export const PREFAB_ROOT = 'prefab';
/** UI Prefab 目录。 */
export const PREFAB_UI_ROOT = `${PREFAB_ROOT}/ui`;
/** UI 根节点预制体完整路径。 */
export const UI_ROOT_PREFAB_PATH = `${PREFAB_UI_ROOT}/UIRoot`;

/** 音频目录根。 */
export const AUDIO_ROOT = 'audio';
/** 音效目录。 */
export const SFX_ROOT = `${AUDIO_ROOT}/sfx`;
/** 受击音效完整路径。 */
export const HIT_SFX_PATH = `${SFX_ROOT}/hit`;
