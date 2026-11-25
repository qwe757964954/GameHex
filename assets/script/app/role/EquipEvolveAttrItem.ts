import { _decorator, Component, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 装备锻造属性行组件（对齐 FGUI `组件_装备锻造_属性item.xml`）。
 * 遵循组件属性绑定规范，消除外部 getChildByName/getComponent 动态查询。
 */
@ccclass('EquipEvolveAttrItem')
export class EquipEvolveAttrItem extends Component {
    @property({ type: Label, tooltip: '属性名标签' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '当前属性值标签' })
    curLabel: Label = null!;

    @property({ type: Label, tooltip: '下一级属性值标签' })
    nextLabel: Label = null!;

    @property({ type: Node, tooltip: '提升箭头节点' })
    arrowNode: Node = null!;

    setData(name: string, cur: string | number, next?: string | number, isMax?: boolean): void {
        this.node.active = true;
        this.nameLabel.string = name;
        this.curLabel.string = String(cur);
        if (next !== undefined && !isMax) {
            this.nextLabel.string = String(next);
            this.nextLabel.node.active = true;
            if (this.arrowNode) this.arrowNode.active = true;
        } else {
            this.nextLabel.node.active = false;
            if (this.arrowNode) this.arrowNode.active = false;
        }
    }
}
