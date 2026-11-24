import type { Prefab, SpriteFrame } from 'cc';

/** 升级成功弹窗一次展示所需的全部数据；美术为空时由视图隐藏对应节点。 */
export interface ICardUpgradedContent {
    /** 按品质切换的 720×1610 整屏背景（`image/carddetail_bg/kpxx_bg_01..04`）。 */
    readonly background: SpriteFrame | null;
    /** 按品质切换的左右属性框（`image/carddetail/upgrade_popup/frame_01..04`）。 */
    readonly frame: SpriteFrame | null;
    readonly hero: SpriteFrame | null;
    /** 兵种骨骼 prefab；有值时英雄位改播 `idle`，为空时回退 `hero` 静态立绘。 */
    readonly heroPrefab: Prefab | null;
    readonly quality: SpriteFrame | null;
    readonly classIcon: SpriteFrame | null;
    readonly name: string;
    readonly className: string;
    /** 如「7级」。 */
    readonly levelText: string;
    /**
     * 升级**前**的等级（如「6级」）；省略或与 `levelText` 相同时不做「跳动换字」。
     *
     * 表现层要的是「旧值 → 放大 → 换成新值」，只有新值就没有可切换的对象。
     */
    readonly previousLevelText?: string;
    /** 升级材料进度，如「53/53」；空串时隐藏进度条。 */
    readonly progressText: string;
    /**
     * 0..1，进度条按左端对齐裁剪。
     *
     * **口径：升级成功弹窗里恒为满格（1）**，代表「本次刚好攒够、这一档被吃掉」；
     * 刷光后先**清空到 0**，再由 {@link nextProgressRatio} 从左往右涨到下一级的真实进度
     * （2026-11-24：「新的进度条首先是空的，绿色部分再按箭头方向从左往右涨」）。
     * 别传当级的真实持有比例 —— 那样 `progressRatio == nextProgressRatio`，条根本不动。
     */
    readonly progressRatio: number;
    /**
     * 刷光后退到 0、再涨到的**下一级**材料进度，如「40/80」；省略时不做换档演出。
     *
     * 与 `progressRatio` 是两个不同的时间点：前者是「本次消耗那一档」的满格，
     * 后者是升级完成后重新攒出来的位置。
     */
    readonly nextProgressText?: string;
    /** 清空后涨到的比例（0..1）；省略时沿用 `progressRatio`（不演换档）。 */
    readonly nextProgressRatio?: number;
    readonly hpValue: string;
    readonly hpGain: string;
    readonly attackValue: string;
    readonly attackGain: string;
    /** 升级前的生命 / 攻击数值；省略时属性区直接显示新值、不做切换。 */
    readonly previousHpValue?: string;
    readonly previousAttackValue?: string;
    /** 战斗力增益描述（富文本）；空串时隐藏底部增益条。 */
    readonly bonusText: string;
}
