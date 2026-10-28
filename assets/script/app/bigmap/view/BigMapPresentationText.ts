import type { IBigMapPlotDetailView, IBigMapMonsterView } from '../application/BigMapPresenter';

export const BIGMAP_PRESENTATION_TEXT = {
    // `baseTitle: '我的基地'` 已退役（2026-10-22 第二轮）：用户要求删掉题头文字，
    // 世界页不再有标题字，「当前在基地还是大地图」由那颗两态木牌表达。
    baseToggle: '基地',
    worldToggle: '大地图',
    harvestAll: '一键收取',
    build: '建造',
    buildMenu: '建造目录',
    emptyPlot: '＋',
    upgrade: '升级',
    cancelBuild: '取消建造',
    /** 已建成建筑的次按钮：能收取就先给「收取」，收不了才给「移动」（同一颗按钮，不新增控件）。 */
    move: '移动',
    moveCancel: '取消移动',
    moveHint: '点击空地移过去；点这格取消',
    emptyQueue: '暂无建造任务',
    queue: '建造队列',
    /** 队列条尾部提示：还差几条才到 `bigmapQueue.maxBuildQueue`（花货币解锁）。 */
    queueLocked: '待解锁',
    stored: '可收取',
    harvest: '收取',
    /** 开战回包已到、战斗资源还在预加载：世界页留着并盖一层遮罩，别露出主界面的领地页。 */
    enteringBattle: '正在进入战斗…',
} as const;

export function formatBigMapPlotDetail(detail: IBigMapPlotDetailView): string {
    if (detail.queueSlotIndex >= 0) {
        return `建造中 · 剩余 ${detail.remainSeconds}s\n进度 ${Math.round(detail.progress * 100)}%\n取消将按原规则返还资源`;
    }
    return `升级消耗\n粮食 ${detail.costGrain}   木材 ${detail.costWood}`
        + `\n铁矿 ${detail.costIron}   时间 ${detail.buildTime}s`
        + `\n${detail.canUpgrade ? '提升建筑等级与发展能力' : detail.reason}`;
}

export function formatBigMapMonsterDetail(monster: IBigMapMonsterView): string {
    // 击杀进度并进第一行：详情面板按 `sections` 三行切块（前 2 / 中 3 / 其余），
    // 单独插一行会把「挑战信息」那一块整体挤歪，所以不加行、只加长首行。
    const progress = monster.clearedLevel > 0 ? `　已通关最高 ${monster.clearedLevel} 级` : '';
    const battle = monster.battle;
    if (battle) {
        return [
            `${monster.unlocked ? '状态：已解锁' : `条件：${monster.reason}`}${progress}`,
            `推荐战力：${battle.recommendAttack}`,
            `消耗行动力：${monster.staminaCost}`,
            battle.rallyOpen ? `支持集结${battle.rallyNum > 0 ? `：${battle.rallyNum} 人` : ''}` : '个人挑战',
            `首杀奖励：${battle.firstKillDrops.length} 项　普通奖励：${battle.normalDrops.length} 项`,
            monster.attackReason,
        ].filter((line) => line !== '').join('\n');
    }
    return [
        `${monster.unlocked ? '状态：可挑战' : `条件：${monster.reason}`}${progress}`,
        `血量：${Math.round((monster.hpRatio ?? 0) * 100)}%`,
        `消耗行动力：${monster.staminaCost}`,
        monster.respawnInSeconds > 0 ? `刷新倒计时：${monster.respawnInSeconds}s` : '已刷新',
        '',
        '野怪必须逐级通关：攻 5 级需先通关 4 级。',
    ].join('\n');
}
