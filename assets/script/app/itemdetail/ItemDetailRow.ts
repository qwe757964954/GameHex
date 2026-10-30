import { _decorator, Component, Label, Sprite } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 物品详情「获取途径」列表里的**一行**（469×70，作为 `AccessList` 的模板节点）。
 *
 * 结构对齐 FGUI `主界面_角色/组件/道具/组件_角色_道具详情_项.xml`：
 *   Background  行底（九宫 `id_row_bg`，即老端 `tycb_pt`）
 *   Label       途径文案（`viewtype.value`）
 *   双减号      右侧两个箭头（**纯装饰，静态烘在 prefab 上**，老端 `n29`/`n30`
 *               `scale="-0.5,0.5"` 水平翻转，指向右侧）
 *
 * ⚠️ 老端这一行**只设一次文本**：
 *
 * ```js
 * private render(index, item, id) {
 *     let ref = this.Ref.RefMgrviewtype.getRef("resId", id);
 *     item.tm("lab").setText(ref.value);
 * }
 * ```
 *
 * 没有图标、没有状态 —— 所以本类也只暴露 `render(text)`。
 * 「点了往哪跳」由列表的 `onItemClickFn` 统一处理（**不在这里绑监听**：
 * 整行会被虚拟列表 clone 复用，行内绑回调容易点到别的下标上去）。
 */
@ccclass('ItemDetailRow')
export class ItemDetailRow extends Component {
    @property({ type: Sprite, tooltip: 'Background：行底（本节点上的 cc.Sprite，九宫 `id_row_bg`）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Label：途径文案（`viewtype.value`，如「冒险关卡」）' })
    label: Label = null;

    protected onLoad(): void {
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }
    }

    render(text: string): void {
        // 无条件写（规则 82）：同一实例会被复用到别的下标，条件式赋值会留下上一行的文案。
        this.label.string = text;
    }

    hide(): void {
        this.node.active = false;
    }
}
