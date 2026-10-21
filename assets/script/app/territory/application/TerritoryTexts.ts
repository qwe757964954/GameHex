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
    noBossTarget: '暂无可定位的 Boss 关卡',
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

    // 站点状态 reason（Progress.checkExplore 返回）
    cellOutOfMap: '格子不在本章领地内',
    cellAlreadyOwned: '该格已经占领',
    cellDisabled: '该格暂不可探索',
    cellExploring: '该格正在探索中',
    /** 服务端 `unlockCells` 里没有这一格（`serverStateKnown` 为 true 时才生效）。 */
    cellNotUnlocked: '该格尚未解锁',
    footprintAlreadyOwned: '该地块已经占领',
    footprintLocked: '该地块暂不可探索',
    prerequisiteNotOwned: '前置领地尚未占领',
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
    bossBattleReady: '可开战',
    bossBattleClaimed: '已通关',
    bossBattleStartFailed: '开战失败，请稍后重试',
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
    unboundStatus: '当前 PVP-关卡表中没有可绑定关卡，因此仅展示地图站点，不扣资源、不进入战斗。',

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

/** 存档 storage key 前缀。 */
export const TERRITORY_STORAGE_PREFIX = 'territory.chapter.v1.';
export const TERRITORY_LAST_CHAPTER_KEY = 'territory.lastChapter.v1';
