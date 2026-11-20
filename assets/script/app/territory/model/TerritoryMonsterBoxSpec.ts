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
