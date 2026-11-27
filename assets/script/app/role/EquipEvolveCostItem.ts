import { _decorator, Color, Component, Label, Sprite, SpriteFrame } from 'cc';
import { formatResourceAmount } from '../../core/math/CompactNumber';
import type { IRoleEquipCostFact } from './RoleTypes';

const { ccclass, property } = _decorator;

/** 持有足够 / 不足的文字色（蓝湖设计稿 `3055/100` 与 `0/1` 的取色）。 */
const ENOUGH_COLOR = new Color(81, 209, 115);
const LACK_COLOR = new Color(255, 80, 84);

/**
 * 装备锻造消耗展示组件（对齐 FGUI `组件_公用_消耗_单个.xml`，蓝湖版式为「图标 + 持有/需求」）。
 */
@ccclass('EquipEvolveCostItem')
export class EquipEvolveCostItem extends Component {
    @property({ type: Sprite, tooltip: '消耗物品图标' })
    iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '消耗数量标签' })
    costLabel: Label = null!;

    /** `owned/need` 文案 + 够/不够配色；图标帧由调用方按 `fact.iconPath` 异步取好后传入。 */
    setCost(fact: IRoleEquipCostFact, iconFrame?: SpriteFrame | null): void {
        this.node.active = true;
        // 银币等资源量走工程公共大数换算（1 万起 K/M/B/T，保留一位小数），避免长串数字挤出底栏。
        this.costLabel.string = `${formatResourceAmount(fact.owned)}/${formatResourceAmount(fact.need)}`;
        this.costLabel.color = fact.owned >= fact.need ? ENOUGH_COLOR : LACK_COLOR;
        if (iconFrame) {
            this.iconSprite.spriteFrame = iconFrame;
            this.iconSprite.node.active = true;
        } else {
            this.iconSprite.node.active = false;
        }
    }
}
