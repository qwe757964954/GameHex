/**
 * 领地模块玩家可见文案集中处。
 *
 *  散落在 TerritoryPage / TerritoryProgress / TerritorySaveStore / TerritoryMapView 里的
 *  中文字符串以前是硬编码，改文案要跨文件搜。这里按场景分组，和 card 模块
 *  `CARD_LINEUP_TEXTS` 同口径。
 */

/** 加载 / 状态提示（轻提示 toast）。 */
export const TERRITORY_TEXTS = {
    // 加载态（2026-10-12 起不再有整页 LoadingPanel：本地存档先渲染、失败只 toast）
    loadingResourceMissing: '领地资源未就绪',
    loadingChapter: '领地数据加载中，请稍候',
    noLevelTarget: '暂无可定位的关卡',
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
    requireChapterComplete: (occupied: number, total: number) =>
        `请先占领本章全部站点（${occupied}/${total}）`,

    /**
     * 首次解锁关卡 ⇒ 自动进战斗时的提示条（需求 2026-11-02）。
     *
     * 这条入口是**系统替玩家按下的开战**（他没看过关卡界面），所以要在推镜头的同一时刻
     * 交代一句「为什么要进战斗」。与 `model/TerritoryBattleApproach` 的过场时长配套：
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
     * 前置没满足的**兜底**文案（2026-11-02 起只在"叫不出名字"时用）。
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
     * ⚠️ 口径 2026-11-02：**只报第一个前置**，所以这里不会收到「1-1、1-2」这种名单
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
    /**
     * 领取成功的轻提示。
     *
     * ⚠️ 2026-10-22 起**页面上不再弹**（`TERRITORY_TWO_STEP_TEXTS.fixedResource.claimed` 改空串）：
     * 那条深色提示条正压在地图中央，把刚开的宝箱和地块全盖住，而同样的信息开箱表演已经表达过了。
     * 文案留着是为了地图角标等其它用途要复用时不必再造一句。
     */
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
    // 关卡格**只解锁**那一步的提示（2026-10-28：锁着时点一下只花银币解锁、不弹关卡界面；
    // 解锁后还要再点一次才打开界面，所以文案不能沿用 `bossUnlocked` 的「点击开战」）。
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
    pendingTitle: '站点配置待补齐',    unboundConfigId: '未配置',

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
    // ⚠️ 不要恢复「已通关」那档按钮文案（2026-10-28 曾短暂存在、同日撤回）：
    // 用户口径是**已通关的关卡再打一次照常扣体力** ⇒ 按钮恒为 {@link levelFight} 或
    // {@link levelUnlock}，没有第三种状态。写回去会被读成"这关不能打了"，是错的。

    // 开战兜底
    resourceNotEnoughFallback: '资源不足',

    // 请求进行中（全屏 loading 遮挡文案，防快速点击重复请求）
    busyUnlock: '解锁中…',
    busyPass: '通关中…',
    busyBattle: '开战中…',
    busyOpen: '开启中…',
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

/** 详情面板敌方守军最多展示几条。 */
export const TERRITORY_ENEMY_DISPLAY_LIMIT = 8;

/**
 * 玩家关卡弹窗里**奖励格的数量**（设计稿 = 3 格）。
 *
 * 不是「最多显示几条」的自由值：prefab 里就是 3 个槽位，改这个数要么露空槽要么丢奖励，
 * 真要改必须同步改 prefab（`RewardSlots/Slot1..3`）。
 */
export const TERRITORY_ASYNC_REWARD_SLOTS = 3;

/**
 * 「侦查」按钮的银币消耗（设计稿 = 10）。
 *
 * 🔴 服务端还没有侦查协议、也没有对应配置表 ⇒ 先按设计稿写常量。
 * 协议/配置到位后把它换成服务端下发的价格（只改 Presenter 一处，视图不用动）。
 */
export const TERRITORY_ASYNC_SCOUT_SILVER = 10;

/** 存档 storage key 前缀。 */
export const TERRITORY_STORAGE_PREFIX = 'territory.chapter.v1.';
export const TERRITORY_LAST_CHAPTER_KEY = 'territory.lastChapter.v1';

// ============================================================
// 「关卡界面」/「关卡提示」（蓝湖，2026-10-27）


/** 「关卡界面」掉落奖励最多几格（与 prefab 的 `DropSlots/Slot1..3` 对应）。 */
export const TERRITORY_LEVEL_DROP_SLOTS = 3;

