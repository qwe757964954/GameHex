/**
 * 领地模块玩家可见文案。
 *
 * 按场景分组，避免文案散落在页面、模型与视图里。
 */

/** 加载 / 状态提示（轻提示 toast）。 */
export const TERRITORY_TEXTS = {
    // 加载态（不再有整页 LoadingPanel：本地存档先渲染、失败只 toast）
    loadingResourceMissing: '领地资源未就绪',
    loadingChapter: '领地数据加载中，请稍候',
    noLevelTarget: '暂无可定位的关卡',
    noIdleRewards: '暂无可征收奖励',
    loadFailed: '领地数据加载失败\n请检查关卡与怪物卡牌配置',

    // 站点详情 - 状态
    owned: '已占领，可重复挑战',
    exploring: (remainSeconds: number) => `探索中，剩余 ${remainSeconds} 秒`,
    exploringShort: '探索中',
    available: '可挑战',
    notUnlocked: '尚未解锁',

    // 站点详情 - 文案
    startBattle: '开战',
    unlockBattle: '解锁',
    /** 服务端明确回 `succ=0`：这一格现在不能解锁，停止开战。 */
    unlockRejected: '该格暂不可解锁',
    /** 通关上报（`CmdCityChapterPassCellReqMsg`）被服务端拒绝。 */
    passRejected: '通关结果未被服务器接受',
    finalChapter: '最终章',
    nextChapter: '下一章',
    nextChapterLocked: '完成后解锁',
    chapterComplete: '；本章完成，下一章已解锁',

    // 资源不足
    silverNotEnough: '银币不足',
    staminaNotEnough: '体力不足',

    // 进度结算 toast
    victory: '胜利，站点探索已开始',
    victoryNoExplore: '挑战胜利',
    defeat: '挑战失败，站点未占领',
    battleIncomplete: '上次挑战未完成',
    newlyOwned: (count: number) => `已占领 ${count} 个新地块`,
    /**
     * 往后切章被拦的提示（**通过本章最后一个首领关卡**就算通关）。
     *
     * 不再报「已占领 x/y」：占领率与通关条件已经不是一回事（异步据点不参与判定），
     * 报占领进度会让人以为"再占几格就能进"。
     */
    requireChapterComplete: () => '请先通关本章最后一个首领关卡',

    /**
     * 首次解锁关卡 ⇒ 自动进战斗时的提示条。
     *
     * 这条入口是**系统替玩家按下的开战**（他没看过关卡界面），所以要在推镜头的同一时刻
     * 交代一句「进战斗的原因」。与 `model/TerritoryBattleApproach` 的过场时长配套：
     * 页面在起播时弹它，1.2s 后跳战斗页。
     */
    battleApproach: '遭遇敌人，即将开始战斗',

    // 站点状态 reason（Progress.checkExplore 返回）
    cellOutOfMap: '格子不在本章领地内',
    cellAlreadyOwned: '该格已经占领',
    cellDisabled: '该格暂不可探索',
    cellExploring: '该格正在探索中',
    /** 服务端 `unlockCells` 里没有这一格（`serverStateKnown` 为 true 时才生效）。 */
    cellNotUnlocked: '该格尚未解锁',
    footprintAlreadyOwned: '该地块已经占领',
    footprintLocked: '该地块暂不可探索',
    /**
     * 前置没满足的**兜底**文案（只在"叫不出名字"时用）。
     *
     * 玩家能看到的提示优先由 `model/TerritoryPrerequisite` 拼出具体对象：
     * 关卡用它的气泡文案（`1-1 关卡通关后解锁`），宝箱用 `前置宝箱未打开`。
     * 仍然保留这句，是因为前置格可能是**不属于任何站点的普通地块**（`chapter_01` 有 4 处），
     * 那种情况没有任何名字可说。
     */
    prerequisiteNotOwned: '前置领地尚未占领',
    /**
     * 前置是关卡：`names` 是**一个**关卡的气泡文案（如 `1-1` / `PVP`）。
     *
     * 口径 **只报第一个前置**，所以这里不会收到「1-1、1-2」这种名单
     * （见 `model/TerritoryPrerequisite`）。要改回全列，得同时动那边。
     */
    prerequisiteStageLocked: (names: string) => `${names} 关卡通关后解锁`,
    /** 前置是固定奖励宝箱（还没解锁 / 已解锁未领取，对玩家都是"没打开"）。 */
    prerequisiteChestLocked: '前置宝箱未打开',
    combatPowerNotEnough: '战力不足',

    // 地图上站点角标 / 底条
    pendingConfig: '待配置',
    lockBadge: '锁',
    randomResource: '随机资源',
    randomNeedsNeighbor: '需相邻已开启格子',
    randomOpenFailed: '开启失败，请稍后重试',
    openCost: (silver: number, stamina: number) => `${silver}银 ${stamina}体`,
    randomCostHint: (silver: number, stamina: number) =>
        ` · 随机格开启需 ${silver} 银币和 ${stamina} 体力`,
    fixedResourceUnlocked: '已解锁，点击宝箱领取',
    fixedResourceUnlockFailed: '解锁失败，请稍后重试',
    fixedResourceClaimReady: '可领取',
    /** 领取成功的轻提示；页面不弹（开箱表演已表达），留给角标等场景复用。 */
    fixedResourceClaimed: '已领取',
    fixedResourceClaimFailed: '领取失败，请稍后重试',

    // 两步式关卡（stage_4 与 fixedResource 同交互：先解锁展示建筑，再点击通关）
    stagePassUnlocked: '已解锁，点击通关',
    stagePassUnlockFailed: '解锁失败，请稍后重试',
    stagePassClaimReady: '可通关',
    stagePassClaimed: '已通关',
    stagePassClaimFailed: '通关失败，请稍后重试',

    // Boss 关两步式（先解锁展示建筑；已解锁再次点击 → `CmdStartBattleReqMsg` 开战，不发通关）
    bossUnlocked: '已解锁，点击开战',
    bossUnlockFailed: '解锁失败，请稍后重试',
    // 锁着时点击只花银币解锁、不打开关卡界面，因此不能沿用 bossUnlocked 的「点击开战」。
    stageUnlocked: '已解锁，点击查看关卡',
    bossBattleReady: '可开战',
    bossBattleClaimed: '已通关',
    bossBattleStartFailed: '开战失败，请稍后重试',
    // 过场演完、跳转也发了，但战斗流程没接手（预加载失败 / 路由没注册）。
    // 这一条必须给：以前是静默等兜底定时器把玩家甩回领地，看起来像"点了没反应"。
    battleEnterFailed: '进入战斗失败，请稍后重试',
    bossBattleConfigMissing: '该关卡缺少战斗配置',
    // 库存
    emptyInventory: '暂无道具',

    // 站点详情 - 守军/波次/奖励
    noEnemyCards: '配置中没有可用守军卡牌',
    noWavesUseBossTeam: '波次表尚未配置，使用首领守军阵容',
    singleNpcOpponent: '1 名 NPC 对手',
    noReward: '无',
    defenceWavesLabel: '塔防波次',
    matchLineupLabel: '匹配阵容',

    // 未绑定关卡的详情面板
    pendingTitle: '站点配置待补齐',
    unboundConfigId: '未配置',

    // 异步据点「玩家关卡」弹窗（蓝湖「玩家关卡」设计稿）
    /** 第一条占领奖励的固定文案；本期所有异步据点都是「1 个卡牌宝箱」。 */
    asyncPlayerChestReward: '获得 1 个卡牌宝箱',
    /** 开战按钮文案（设计稿原文）。 */
    asyncPlayerFight: '开始战斗',
    /** 侦查按钮的暂未开放提示（协议未接，先给明确反馈，别做成点了没反应）。 */
    asyncPlayerScoutUnavailable: '侦查暂未开放，后续版本上线',

    // 关卡界面 / 关卡提示（蓝湖「关卡界面」「关卡提示」）
    /** 标题前缀：首领关。 */
    bossStageTitle: '首领关卡',
    /** 标题前缀：普通关。 */
    stageTitle: '领地关卡',
    /** 通关目标（设计稿固定文案）。 */
    levelObjective: '第一名成功通过关卡',
    /** 占据奖励（硬币）：`【征收】+6 硬币`。 */
    levelOccupy: (amount: number, name: string) => `【征收】+${Math.round(amount)} ${name}`,
    /** 关卡界面主按钮：已解锁（设计稿原文「开始战斗」）。 */
    levelFight: '开始战斗',
    /** 关卡界面主按钮：未解锁（点了先解锁）。 */
    levelUnlock: '解锁后开战',
    // 不要恢复「已通关」那档按钮文案（曾短暂存在、同日撤回）：
    // 规则是**已通关的关卡再打一次照常扣体力** ⇒ 按钮恒为 {@link levelFight} 或
    // {@link levelUnlock}，没有第三种状态。写回去会被读成"这关不能打了"，是错的。

    // 开战兜底
    resourceNotEnoughFallback: '资源不足',

    // 请求进行中（全屏 loading 遮挡文案，防快速点击重复请求）
    busyUnlock: '解锁中…',
    busyPass: '通关中…',
    busyBattle: '开战中…',
    busyOpen: '开启中…',
    /** 征收（领挂机奖励）在途。 */
    busyIdleReward: '领取中…',
    /** 征收请求失败（网络超时 / 服务端拒绝）；离线另走本地兜底，不弹这条。 */
    idleRewardFailed: '领取失败，请稍后再试',
    /** 征收离线提示（扫荡 / 领奖共用）。 */
    idleRewardOffline: '网络未连接，请稍后再试',
    /** 章节扫荡在途。 */
    busySweep: '扫荡中…',
    /** 章节扫荡失败（服务端 `succ !== 1`）。 */
    sweepFailed: '扫荡失败，请稍后再试',
    /** 一个关卡都没通关时点扫荡（没有可扫的目标格，不发请求）。 */
    noSweepTarget: '暂无可扫荡的关卡',
    /** 升级怪物宝箱在途（`CmdCityChapterUpMonsterBoxLvReqMsg`）。 */
    busyUpgradeMonsterBox: '升级中…',
    /** 升级怪物宝箱失败（服务端 `succ !== 1` / 超时）。 */
    monsterBoxUpgradeFailed: '宝箱升级失败，请稍后再试',
    /** 升级成功：用**服务端回包的新等级**，不本地 +1。 */
    monsterBoxUpgraded: (lv: number) => `怪物宝箱已升至 ${lv} 级`,
    /** 「宝箱开启」奖励页：跳过卡片入场（蓝湖「宝箱开启」设计稿原文，`>>` 不是省略号）。 */
    chestOpenSkip: '跳过>>',
    /** 「宝箱开启」奖励页：关闭提示（设计稿原文）。 */
    chestOpenClose: '点击关闭',
    chestOpenClaim: '点击领取奖励',
} as const;

/** 未绑定关卡的据点类型名（地图上的"类型"标签）。 */
export const TERRITORY_UNBOUND_TYPE_NAMES = {
    stage: '关卡',
    boss: '首领',
    asyncPvp: '异步据点',
    fixedResource: '资源据点',
    bonus: '奖励据点',
} as const;

/** 离线 / 编辑器直连时的兜底钱包值。 */
export const TERRITORY_FALLBACK_WALLET = {
    silver: 10000,
    stamina: 100,
} as const;

/** 开局玩家固定上场人数（领地 PVE 玩家侧）。 */
export const TERRITORY_DEFAULT_PLAYER_COUNT = 2;

/**
 * 玩家关卡弹窗里的奖励格数量（设计稿 3 格）。
 *
 * prefab 固定 3 个槽位（`RewardSlots/Slot1..3`），改这个数需同步改 prefab。
 */
export const TERRITORY_ASYNC_REWARD_SLOTS = 3;

/** 侦查按钮的体力消耗（设计稿 10）。服务端暂无侦查协议，接入后改为下发价格。 */
export const TERRITORY_ASYNC_SCOUT_STAMINA = 10;

/** 存档 storage key 前缀。 */
export const TERRITORY_STORAGE_PREFIX = 'territory.chapter.v1.';
export const TERRITORY_LAST_CHAPTER_KEY = 'territory.lastChapter.v1';
/**
 * 「已通关的领地关卡」storage key（账号级，不带 chapterId）。
 *
 * 关卡归属由 `levelInfo.levelChapter` 决定，跨章后当前章的 `stageByCell` 查不到它；
 * 按一次性成就落盘，切章后依赖它的功能才不会消失。
 */
export const TERRITORY_PASSED_LEVELS_KEY = 'territory.passedLevels.v1';
/**
 * 「已激活的领地关卡」storage key（账号级，不带 chapterId）。
 *
 * 判据是「花银币激活」，供快速寻敌等需要跨章常驻的功能使用。
 * 与通关表分开：激活包含「还没打」的状态，合并会污染两种语义。
 */
export const TERRITORY_ACTIVATED_LEVELS_KEY = 'territory.activatedLevels.v1';

// 关卡界面 / 关卡提示
/** 「关卡界面」掉落奖励最多几格（与 prefab 的 `DropSlots/Slot1..3` 对应）。 */
export const TERRITORY_LEVEL_DROP_SLOTS = 3;

