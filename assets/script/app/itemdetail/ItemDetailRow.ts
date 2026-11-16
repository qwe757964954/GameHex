import { _decorator, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 物品详情「获取途径」列表的一行（469×70，作为 `AccessList` 的模板节点）。
 *
 * 结构对齐 FGUI `组件_角色_道具详情_项.xml`：行底（九宫 `id_row_bg`）+ 途径文案，
 * 右侧两个箭头是静态烘在 prefab 上的装饰。
 *
 * 老端这一行只设一次文本，没有图标和状态，所以这里也只暴露 `render(text)`。
 * 「点了往哪跳」由列表的 `onItemClickFn` 统一处理：行会被虚拟列表 clone 复用，
 * 行内绑回调容易点到别的下标上去。
 */
@ccclass('ItemDetailRow')
export class ItemDetailRow extends Component {
    @property({ type: Label, tooltip: 'Label：途径文案（`viewtype.value`，如「冒险关卡」）' })
    label: Label = null!;

    render(text: string): void {
        // 同一实例会被复用到别的下标，无条件写，条件赋值会留下上一行的文案。
        this.label.string = text;
    }

    hide(): void {
        this.node.active = false;
    }
}
