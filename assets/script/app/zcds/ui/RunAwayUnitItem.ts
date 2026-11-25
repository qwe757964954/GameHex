import { formatDamageStatsValue } from '../../../core/math/CompactNumber';
import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { damageStatsBarRatio } from '../model/ZCDamageStats';

const { ccclass, property, disallowMultiple } = _decorator;

/**
 * 战斗统计列表的一行（`RunAwayUnitItem.prefab`）：品级底框 + 头像 + 数值 + 进度条。
 *
 * 虚拟列表会复用节点，所以每次渲染都必须全量赋值；`render` 不持有单位对象，
 * 数据由 `GameRunAway` 按 index 现取。
 */
@ccclass('RunAwayUnitItem')
@disallowMultiple
export class RunAwayUnitItem extends Component {
    @property({ type: Sprite, tooltip: 'Base：品级底框（Avatar 容器内的整张 pzk，超出部分由 Mask 裁掉）' })
    base: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Avatar：单位头像（叠在品级底框上层）' })
    avatar: Sprite = null!;

    @property({ type: Label, tooltip: 'Value：当前页签的数值（伤害 / 承伤）' })
    valueLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'Fill：进度条填充（Sprite Type = FILLED，横向）' })
    fill: Sprite = null!;

    /** 预制体自带的兜底底框（紫色品级底，pzk 原图）：哪一档图没加载出来就退回它。*/
    private defaultBase: SpriteFrame | null = null;

    protected onLoad(): void {
        this.defaultBase = this.base.spriteFrame;
    }

    /**
     * 刷新一行；`baseFrame` 按品级给底框，`frame` 是头像图（为空时只留底框）。
     *
     * `total` = 本列合计（该席位全队总量）⇒ 进度条画的是**这一行占全队的比例**，
     * 不是「列内最大值」。`total <= 0`（开局全 0 / 单人局）时条为空。
     */
    public render(
        value: number,
        total: number,
        frame: SpriteFrame | null,
        baseFrame: SpriteFrame | null,
    ): void {
        this.base.spriteFrame = baseFrame ?? this.defaultBase;
        this.avatar.spriteFrame = frame;
        this.valueLabel.string = formatDamageStatsValue(value);
        this.fill.fillRange = damageStatsBarRatio(value, total);
    }

    /** 列表项回收 / 面板清空时调用。*/
    public clear(): void {
        this.base.spriteFrame = this.defaultBase;
        this.avatar.spriteFrame = null;
        this.valueLabel.string = '';
        this.fill.fillRange = 0;
    }
}
