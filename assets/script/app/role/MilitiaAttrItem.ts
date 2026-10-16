import { _decorator, Component, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 天赋总览里的**一行**（`ui/Role/MilitiaAttrItem`，520×35）。
 *
 * 两个列表共用它（属性聚合 / 已解锁描述），老端也是同一个 `组件_民兵天赋项` + `文本_desc`。
 *
 * ⚠️ 属性声明 `Node`（同 `MilitiaTalentItem`）：prefab 上存的是节点。
 */
@ccclass('MilitiaAttrItem')
export class MilitiaAttrItem extends Component {
    @property({ type: Node, tooltip: 'Desc：行文本（其上挂 cc.Label）' })
    descNode: Node = null!;

    private desc: Label = null!;
    private inited = false;

    protected onLoad(): void {
        this.ensureInit();
    }

    /** 取组件（幂等：宿主可能初始非激活 ⇒ `onLoad` 未必先跑）。 */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;
        this.desc = this.descNode.getComponent(Label);
    }

    /** 铺一行（无条件写 —— 规则 82：比新旧会被 prefab 默认值短路）。 */
    render(text: string): void {
        this.ensureInit();
        this.desc.string = text;
    }
}
