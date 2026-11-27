/**
 * 跨模块共享的资源路径表。
 *
 * 路径相对对应 bundle、不带扩展名；页面/弹窗私有 prefab 路径仍就近写在各自
 * `static prefabPath`，这里只放跨模块共享项，不要硬编码业务目录。
 */

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
    /**
     * 养成通用反馈（用户 2026-11-26）：卡牌升级界面 / 巡逻宝箱升级 / 装备升级与强化 / 宝石镶嵌
     * 成功都用这一条；失败只有巡逻宝箱会用（其余玩法失败仍是 toast）。
     *
     * 与 `drawXxx` / `xxxFixedTile` 那些「一条玩法一套」的音效不同 —— 这是**全养成通用**的一对，
     * 加新玩法时优先复用它，别再造第三条。
     */
    upgradeSuccess: `${GAME_AUDIO_ROOT}/升级成功通用音效`,
    upgradeFailure: `${GAME_AUDIO_ROOT}/升级失败通用音效`,
} as const;
