/** 卡牌阵容页固定 UI 文案。临时集中一处，后续换读表。 */
export const CARD_LINEUP_TEXTS = {
    qualityBonus: '品质加成',
    teamEdit: '队伍编辑',
    bondBonusTitle: '羁绊加成',
    bondTitleSuffix: '：',
    levelSuffix: '级',
    boardTitle: '布阵',
    boardResetAll: '一键下阵',
    boardSave: '保存',
    boardSaving: '保存中…',
    boardSaved: '已保存',
    boardSaveOffline: '未连接服务器',
    boardSaveFailed: '保存失败',
    onField: '已出战！',
    progressSeparator: '/',
    navShops: '商店',
    navHero: '英雄',
    navRoles: '角色',
    /** ⚠️ 2026-10-19 蓝湖改版后「领地」= 主城页（六边格地图），不再是角色主界面。 */
    navTerritory: '领地',
    navChallenge: '挑战',
    navAlliance: '联盟',
    navWorld: '世界',
    /** 旧六格的名称（保留：老包/老入口仍可能引用，别删）。 */
    navArena: '竞技',
    navAdventure: '冒险',
    upgradeTitle: '卡牌升级',
    upgradeConfirm: '升级',
    /** 等级 0 → 1 是解锁，按钮改叫「解锁」。 */
    upgradeUnlock: '解锁',
    upgradeUnlocking: '解锁中…',
    upgradeMaxed: '已满级',
    upgradeSending: '升级中…',
    upgradeCardRow: '卡牌',
    upgradeExpRow: '经验',
    upgradeExpDetail: '通用',
    upgradeExpDetailJoin: ' + 兵种 ',
    upgradeLevelArrow: ' → ',
    upgradeOffline: '未连接服务器，先登录才能升级',
    upgradeFailed: '升级失败，请稍后再试',
    upgradeNoConfig: '该卡暂无升级配置',
    skillTitle: '技能',
    /**
     * 技能等级前缀。**留空**：2026-10-20 起需求是「显示等级就好」，不再带 `Lv.` 前缀
     * （渲染成 `2` / `2/3` / `3（满级）`）。
     */
    skillLevelPrefix: '',
    /** 技能列表空的说法（主城 / 金矿这类没配技能的卡）。 */
    skillEmpty: '该卡没有技能',
    /** 「↓」按钮文案（往回看一档，纯本地预览，不发包）。 */
    skillPrev: '↓',
    /** 「↑」按钮文案（升一级，发 `CmdPvpHeroUpSkillReqMsg`）。 */
    skillNext: '↑',
    /** 目标档未到解锁英雄等级。 */
    skillLocked: '英雄等级不足',
    /** 表里没配技能名时的占位前缀（后接技能编号）。 */
    skillNameFallback: '技能 ',
    /** 表里没配该档描述时的占位。 */
    skillDescEmpty: '暂无描述',
    /** 满级标记，拼在等级后面：`Lv.3（满级）`。 */
    skillMaxed: '（满级）',
    /** 升级按钮的常态文案。 */
    skillUpgradeButton: '升级',
    skillUpgradeOffline: '未连接服务器',
    skillUpgradeFailed: '技能升级失败',
} as const;
