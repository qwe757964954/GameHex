/**
 * 巡逻宝箱表现层常量。
 * 业务数值（等级上限/升级消耗/成功率/失败上限/奖励池）由 monsterBox 配表驱动。
 * 本文件仅管理无配表源的表现属性（守护怪等级门槛、静态提示文案）。
 */
export const TERRITORY_MONSTER_BOX_SPEC = {
    /** 守护怪格数（设计稿 3 格）。 */
    guardCount: 3,
    /**
     * 每格守护怪的解锁等级（第 1 格 1 级、第 2 格 2 级、第 3 格 4 级 ——
     * 设计稿 Lv.2 时前两格亮、第三格写「4 级解锁」）。
     *
     * 长度可以小于 `guardCount`：超出的格按最后一档算。
     */
    guardUnlockLvs: [1, 2, 4] as readonly number[],
    /** 弹窗标题。 */
    title: '巡逻宝箱',
    battleCaption: '开始挑战',
    upgradeCaption: '升级宝箱',
    /** 底部说明（还能升级时）。 */
    footerText: '升级为主，打为次',
    footerTextAtMaxLv: '灰怪点亮，只可打开',
    /** 绑不到关卡行（`battleId` 在 `monsterBox` 表里查不到）时的底部说明。 */
    footerTextNoLevel: '这一片还没有配巡逻关卡',
} as const;

/**
 * 巡逻宝箱模型图的档位范围（`monsterBox.monsterBoxLevel` 1~4）。
 *
 * 四档对应 `image/territory/buildings/territory_monsterBox_L{1..4}.png`（闭合）与
 * `territory_monsterBoxOpen_L{1..4}.png`（开盖），都是 212×212 的建筑规格图。
 * 地图锚点格与详情弹窗**同一套图**：弹窗原先取 `image/main/chest/boxLevel{N}`（100×100 通用宝箱，
 * 塞进 192 的显示区里发糊），2026-11-20 起换成这批专用图。
 */
export const TERRITORY_MONSTER_BOX_MIN_LV = 1;
export const TERRITORY_MONSTER_BOX_MAX_LV = 4;

/**
 * 巡逻宝箱模型图在**地图上**的显示倍率（乘在「可见宽度归一」系数之上）。
 *
 * 归一到可见宽 84 之后，四档**闭合**版是 70.9~73.1 高（与固定宝箱 66.4 / 主城 67.1 同档，合理）；
 * 但**开盖**版掀起的盖子把可见高拉到 **88.9~91.6**，而格面只有 90 高 ⇒ 直接顶满格子
 * （`territory-cell-center-align` 的 0.85 上限会红，截图上也会读成「偏下 / 撑满」）。
 *
 * 取 0.82 后：闭合 58.1~59.9、开盖 72.9~75.1（≤ 90 × 0.85 = 76.5），
 * 两态**可见宽恒为 68.9** —— 通过那一刻只有盖子往上长、宽度一点不变，
 * 不会被读成「箱子突然缩小」。改这个值要先看 `territory-cell-center-align` 的两条数值护栏。
 */
export const TERRITORY_MONSTER_BOX_ART_SCALE = 0.82;

/**
 * 巡逻宝箱模型图的 `resources` 完整路径（带 `/spriteFrame`）。
 *
 * @param lv 宝箱等级（1~4）；越界 / 非数字按夹到最近一档处理 —— 等级来自服务端快照，
 *   脏值不该让锚点格整块空掉。
 * @param open `true` = 开盖图（本片已挑战通过）。
 */
export function territoryMonsterBoxArtPath(lv: number, open = false): string {
    const raw = Math.round(lv);
    const level = Math.min(
        Math.max(Number.isFinite(raw) ? raw : TERRITORY_MONSTER_BOX_MIN_LV, TERRITORY_MONSTER_BOX_MIN_LV),
        TERRITORY_MONSTER_BOX_MAX_LV,
    );
    return `image/territory/buildings/territory_monsterBox${open ? 'Open' : ''}_L${level}/spriteFrame`;
}
