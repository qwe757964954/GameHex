import { _decorator, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 天赋总览里的**一行**（`ui/Role/MilitiaAttrItem`，520×35）。
 *
 * 两个列表共用它（属性聚合 / 已解锁描述），老端也是同一个 `组件_民兵天赋项` + `文本_desc`。
 *
 * ⚠️ 属性直接声明 `Label`（prefab 上绑的是 **Desc 节点上的 cc.Label 组件**）：条目由虚拟列表
 * `instantiate`，首帧 `render` 可能在节点激活前调用（`onLoad` 还没跑），所以引用必须由
 * 反序列化填好，不能靠 `onLoad` 现取。
 */
@ccclass('MilitiaAttrItem')
export class MilitiaAttrItem extends Component {
    @property({ type: Label, tooltip: 'Desc：行文本' })
    desc: Label = null!;

    /** 铺一行（无条件写 —— 规则 82：比新旧会被 prefab 默认值短路）。 */
    render(text: string): void {
        this.desc.string = text;
    }
}
