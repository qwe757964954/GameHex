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
    emptyQueue: '暂无建造任务',
    queue: '建造队列',
    stored: '可收取',
    harvest: '收取',
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
    const battle = monster.battle;
    if (battle) {
        return [
            monster.unlocked ? '状态：已解锁' : `条件：${monster.reason}`,
            `推荐战力：${battle.recommendAttack}`,
            `消耗行动力：${monster.staminaCost}`,
            battle.rallyOpen ? `支持集结${battle.rallyNum > 0 ? `：${battle.rallyNum} 人` : ''}` : '个人挑战',
            `首杀奖励：${battle.firstKillDrops.length} 项　普通奖励：${battle.normalDrops.length} 项`,
            monster.attackReason,
        ].filter((line) => line !== '').join('\n');
    }
    return [
        monster.unlocked ? '状态：可挑战' : `条件：${monster.reason}`,
        `血量：${Math.round((monster.hpRatio ?? 0) * 100)}%`,
        `消耗行动力：${monster.staminaCost}`,
        monster.respawnInSeconds > 0 ? `刷新倒计时：${monster.respawnInSeconds}s` : '已刷新',
        '',
        '野怪必须逐级通关：攻 5 级需先通关 4 级。',
    ].join('\n');
}
