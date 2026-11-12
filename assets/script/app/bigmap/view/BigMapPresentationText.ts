import { BIGMAP_MOVE_HINT } from '../application/BigMapEvents';
import type { IBigMapPlotDetailView, IBigMapMonsterView } from '../application/BigMapViewState';

/** 六边形六个顶点（相对格子中心，尖角朝上）。选中环 / 进度环 / 放置预判共用这一份。 */
export function bigMapHexCorners(width: number, height: number): readonly { readonly x: number; readonly y: number }[] {
    return [
        { x: width / 2, y: 0 },
        { x: width / 4, y: height / 2 },
        { x: -width / 4, y: height / 2 },
        { x: -width / 2, y: 0 },
        { x: -width / 4, y: -height / 2 },
        { x: width / 4, y: -height / 2 },
    ];
}

/**
 * 建造进度环的折线点：沿六边形轮廓从「右顶点」顺时针走 `progress`（`0~1`）圈。
 *
 * 纯几何、不碰 `Graphics` —— 这样进度环的**覆盖比例**能在 node 测试里直接断言，
 * 而不是只能靠肉眼看"环好像走了三分之一"。
 *
 * `progress <= 0` 返回空数组（不画）；`progress >= 1` 返回 7 个点（首尾重合 = 闭合）。
 */
export function buildBigMapProgressPolyline(
    width: number, height: number, progress: number,
): readonly { readonly x: number; readonly y: number }[] {
    const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    if (ratio <= 0) return [];
    const corners = bigMapHexCorners(width, height);
    const lit = ratio * corners.length;
    const points: { x: number; y: number }[] = [corners[0]];
    for (let edge = 1; edge <= corners.length; edge += 1) {
        const target = corners[edge % corners.length];
        const previous = corners[edge - 1];
        if (edge <= lit) {
            points.push(target);
            continue;
        }
        // 最后一条边按小数插值，进度环才能连续走，而不是一格一格跳。
        const t = lit - (edge - 1);
        if (t > 0) points.push({ x: previous.x + (target.x - previous.x) * t, y: previous.y + (target.y - previous.y) * t });
        break;
    }
    return points;
}

export const BIGMAP_PRESENTATION_TEXT = {
    // `baseTitle: '我的基地'` 已退役（2026-10-22 第二轮）：用户要求删掉题头文字，
    // 世界页不再有标题字，「当前在基地还是大地图」由那颗两态木牌表达。
    baseToggle: '基地',
    worldToggle: '大地图',
    harvestAll: '一键收取',
    build: '建造',
    buildMenu: '建造目录',
    emptyPlot: '＋',
    /**
     * 选中建筑时名字牌的第二行（参考图口径：`科研中心` / `等级21` 两行，无底板）。
     * 平时不显示名字牌，点一下才出 —— 所以这里是「读的时候需要的信息」，不是常显标签。
     */
    buildingLevel: '等级',
    upgrade: '升级',
    cancelBuild: '取消建造',
    /** 已建成建筑的次按钮：能收取就先给「收取」，收不了才给「移动」（同一颗按钮，不新增控件）。 */
    move: '移动',
    moveCancel: '取消移动',
    moveHint: BIGMAP_MOVE_HINT,
    emptyQueue: '暂无建造任务',
    queue: '建造队列',
    /** 队列条尾部提示：还差几条才到 `bigmapQueue.maxBuildQueue`（花货币解锁）。 */
    queueLocked: '待解锁',
    stored: '可收取',
    harvest: '收取',
    /** 开战回包已到、战斗资源还在预加载：世界页留着并盖一层遮罩，别露出主界面的领地页。 */
    enteringBattle: '正在进入战斗…',
    /** 城池弹窗（蓝湖「城池弹窗3」）：增益效果段标题。 */
    buffTitle: '增益效果',
    /** 弹窗底部那颗大按钮（设计稿写「进攻」，与旧面板的「攻打」是同一件事）。 */
    attack: '进攻',
    cannotAttack: '不可进攻',
} as const;

/** 只有配置开放日时展示条件，不把配置天数当成剩余天数。 */
export function formatBigMapCityOpening(openDay: number): string {
    return openDay > 0 ? `未开放\n开服第${openDay}天开放` : '未开放';
}

/**
 * 秒 → `mm:ss`（满 1 小时给 `h:mm:ss`）。
 *
 * 原先界面上是裸 `${remainSeconds}s`（`120s`），超过一小时要玩家自己换算。
 * 取整用 `ceil`：倒计时最后半秒显示 `00:01` 而不是 `00:00`，避免"明明还能收却显示 0"。
 */
export function formatBigMapDuration(seconds: number): string {
    const total = Math.max(0, Math.ceil(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const rest = total % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(rest).padStart(2, '0');
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 产量 → `1.2K/h`（< 1000 不带 K，整数不带小数点）。 */
export function formatBigMapRate(perHour: number): string {
    if (!Number.isFinite(perHour) || perHour <= 0) return '0/h';
    if (perHour < 1000) return `${Math.round(perHour)}/h`;
    const k = perHour / 1000;
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}K/h`;
}

/**
 * 建筑详情正文（纯文本兜底 —— 结构化字段已经由 `IBigMapPlotDetailView` 提供，
 * 新的贴底建筑卡直接读字段画控件，这个函数留给仍需一段文字的场合）。
 *
 * 2026-11-11 改版：原来只有「消耗 + 一句『提升建筑等级与发展能力』」，
 * 玩家看不到升级换来什么。现在按「产量对比 → 储存 → 消耗 → 耗时 → 前置 → 原因」排，
 * 并且**不再把英文资源 key 拼进正文**。
 */
export function formatBigMapPlotDetail(detail: IBigMapPlotDetailView): string {
    if (detail.queueSlotIndex >= 0) {
        return `建造中 · 剩余 ${formatBigMapDuration(detail.remainSeconds)}`
            + `\n进度 ${Math.round(detail.progress * 100)}%`
            + '\n取消将按原规则返还资源';
    }
    const lines: string[] = [];
    if (detail.resType !== '' && (detail.produceNow > 0 || detail.produceNext > 0)) {
        if (detail.produceNow > 0) {
            const delta = detail.produceNext - detail.produceNow;
            lines.push(`产量 ${formatBigMapRate(detail.produceNow)} → ${formatBigMapRate(detail.produceNext)}`
                + (delta > 0 ? `　+${formatBigMapRate(delta)}` : ''));
        } else {
            lines.push(`建成后产量 ${formatBigMapRate(detail.produceNext)}`);
        }
        if (detail.produceCap > 0) lines.push(`储存上限 ${detail.produceCap}`);
    }
    if (detail.attrBonus > 0) lines.push(`属性加成 +${(detail.attrBonus / 10).toFixed(1)}%`);
    lines.push(`消耗　粮食 ${detail.costGrain}　木材 ${detail.costWood}　铁矿 ${detail.costIron}`);
    lines.push(`耗时 ${formatBigMapDuration(detail.buildTime)}`);
    const pending = detail.preBuild.filter((pre) => !pre.done);
    if (pending.length > 0) {
        lines.push(`前置　${pending.map((pre) => `${pre.name} Lv.${pre.level}`).join('　')}`);
    }
    if (!detail.canUpgrade && detail.reason !== '') lines.push(detail.reason);
    return lines.join('\n');
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
