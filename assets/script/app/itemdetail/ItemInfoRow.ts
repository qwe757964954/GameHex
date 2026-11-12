import { _decorator, Component, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「道具信息」弹窗「获取途径」列表里的**一行**（414×57，蓝湖「道具信息」稿）。
 *
 * 结构与老端 `ItemDetailRow` 同角色（行底 + 文案 + 右箭头），差别：
 *   · 行底是九宫 `iteminfo/brn_hqtj`（设计稿 420×61，压到 414×57 用）；
 *   · 右侧箭头是 **`iteminfo/jiantou_03`**（橙色单箭头，静态烘在 prefab 上）；
 *   · 占位行（「暂无获取途径」）要把箭头藏掉 —— 不可点的行不该长着「可跳转」的样子。
 *
 * ⚠️ 行是 prefab 里**预建**的固定节点（不是虚拟列表）：点击由宿主统一按 index 现取数据，
 * 行内不绑业务监听（复用语义与 `ItemDetailRow` 一致）。
 */
@ccclass('ItemInfoRow')
export class ItemInfoRow extends Component {
    @property({ type: Label, tooltip: 'Label：途径文案（`viewtype.value`，如「兵种招募」）' })
    label: Label = null!;

    @property({ type: Node, tooltip: 'Arrow：右侧箭头（占位行隐藏）' })
    arrow: Node = null!;

    render(text: string, showArrow: boolean = true): void {
        // 无条件写（同一批行会被不同物品复用，条件赋值会留下上一行的文案）
        this.label.string = text;
        this.arrow.active = showArrow;
    }

    hide(): void {
        this.node.active = false;
    }
}
