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
    /** 升级材料进度，如「53/53」；空串时隐藏进度条。 */
    readonly progressText: string;
    /** 0..1，进度条按左端对齐裁剪。 */
    readonly progressRatio: number;
    readonly hpValue: string;
    readonly hpGain: string;
    readonly attackValue: string;
    readonly attackGain: string;
    /** 战斗力增益描述（富文本）；空串时隐藏底部增益条。 */
    readonly bonusText: string;
}
