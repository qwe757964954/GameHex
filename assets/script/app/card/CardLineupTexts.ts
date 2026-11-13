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
    boardLoadFailed: '布阵数据加载失败，请重新打开',
    onField: '出战中',
    progressSeparator: '/',
    navShops: '商店',
    navHero: '英雄',
    navRoles: '角色',
    /** 蓝湖改版后「领地」指主城页，不是角色主界面。 */
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
    skillTitle: '技能升级',
    skillUpgradeSingle: '升级技能',
    skillTierSuffix: '阶',
    /** 判的是英雄自己的等级，不是 CmdRole.lv 的角色等级。 */
    skillUnlockPrefix: '英雄等级',
    skillUnlockSuffix: '级解锁',
    skillActive: '主动',
    skillPassive: '被动',
    skillCooldown: '冷却：',
    skillSeconds: '秒',
    /** 技能等级统一用设计稿的 Lv. 前缀。 */
    skillLevelPrefix: 'Lv.',
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
    skillUpgradeSending: '升级中',
    skillUpgradeOffline: '未连接服务器',
    skillUpgradeFailed: '技能升级失败',
    // ---- 卡牌详情页（2026-11-03 改版：CardUpgrade 弹窗整体换成详情页外观）----
    /** 底部页签两个状态的名字。 */
    detailTabInfo: '详情',
    detailTabLevel: '等级',
    detailPower: '战力',
    detailChainLocked: '未解锁',
    /** 升级奖励条前缀（后缀由配置/里程碑拼接，当前表里没有奖励列时只显示前缀）。 */
    detailRewardPrefix: '升级奖励：',
    /** 里程碑行等级前缀（效果图 `Lv.3` 形态）。 */
    detailMilestonePrefix: 'Lv.',
    detailLevelSuffix: '级',
    /** 首档解锁等级为 0（一级就有）时的等级块文案：表里 0 = 开局即解锁，展示按「1级」算。 */
    detailLevelInitial: '1级',
    /** 里程碑行里「技能名 + 该档描述」之间的分隔。 */
    detailSkillNameSeparator: '：',
    /** 描述栏一条都没有时的占位（这些卡的技能描述整块还没配，见 armySkillLevelUp）。 */
    detailMilestoneEmpty: '暂无技能描述',
    /** 升级奖励条的全队暴击伤害前缀，数值来自 pvpSkillPlan 109001 链。 */
    upgradeCritDamage: '升级增加全队暴击伤害：',
    /** 品质字（菱形中央）：品级中文名（普通/稀有/史诗/传说）。 */
    detailQualityPrefix: '',
    detailQualityGrade: '品',
} as const;
