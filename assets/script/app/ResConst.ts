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

export const GAME_AUDIO_ROOT = 'resources://塔防/音效';
export const GAME_AUDIO = {
    chapterMusic: `${GAME_AUDIO_ROOT}/关卡背景音乐`,
    battleMusic: `${GAME_AUDIO_ROOT}/战斗背景音乐`,
    victory: `${GAME_AUDIO_ROOT}/战斗胜利音效`,
    defeat: `${GAME_AUDIO_ROOT}/战斗失败音效`,
    randomTile: `${GAME_AUDIO_ROOT}/随机格奖励`,
    smallFixedTile: `${GAME_AUDIO_ROOT}/固定格奖励小`,
    largeFixedTile: `${GAME_AUDIO_ROOT}/固定格奖励大`,
    goldFragment: `${GAME_AUDIO_ROOT}/金卡碎片展示`,
    explosion: `${GAME_AUDIO_ROOT}/爆炸技能`,
    /**
     * 战斗内翻地块的抽卡结果音（用户 2026-11-24），按抽到的卡牌品阶四选一。
     * 与领地那三颗（`randomTile` / `smallFixedTile` / `largeFixedTile`）不是一套：
     * 领地按「有没有箱子 / 数量大小」分，战斗按「抽空 / 蓝绿 / 紫 / 金」分。
     */
    drawEmpty: `${GAME_AUDIO_ROOT}/战斗中抽空`,
    drawGreenBlue: `${GAME_AUDIO_ROOT}/战斗中抽蓝绿`,
    drawPurple: `${GAME_AUDIO_ROOT}/战斗中抽紫`,
    drawGold: `${GAME_AUDIO_ROOT}/战斗中抽金`,
} as const;
