/**
 * 「好友」面板底部的**页签按钮**（160×72）—— 三个页签共用这一份。
 *
 * 对齐 FGUI `共用组件/组件/页签/组件_弹窗_页签.xml`（160×72，`extention="Button"`）：
 *   `n4` 底图 loader（`TY_btn23` 常态 / `TY_btn20` 按下与选中 / `TY_btn22` 悬停）
 *   `title`（136×42，fontSize 30，`#fcf0d6` 描边 `#502010`）
 *   `com_rd` 红点（**未接**，见文件末的说明）
 *
 * ## 两态底图由宿主预加载后传进来
 *
 * 项目约定：**样式与布局全在 prefab 上**，代码只处理「随状态变化」的部分。
 * 本按钮唯一随状态变的就是底图 —— 选中 `fd_tab_on`、未选中 `fd_tab_off`
 * （两张图都已在 prefab 上序列化出一份，运行时由 `FriendPage` 预加载同名图后传入，
 * 换不到就**保留 prefab 里那一帧，不置空** —— 置空会变成一个看不见的按钮，
 * 而且不报错）。
 *
 * ⚠️ FGUI 的 `gearIcon` 映射别按图名猜：
 *   `button=0(up)` → `TY_btn23`（→ `fd_tab_off`）
 *   `button=1(down)` / `button=3(selectedOver)` → `TY_btn20`（→ `fd_tab_on`）
 *   `button=2(over)` → `TY_btn22`（→ `fd_tab_over`，本工程不使用 hover 态）
 */

import { _decorator, Button, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('FriendTabButton')
export class FriendTabButton extends Component {
    @property({ type: Sprite, tooltip: 'Bg：页签底图（选中 / 未选 两态切换）' })
    background: Sprite = null!;

    @property({ type: Label, tooltip: 'Label：页签文案（好友列表 / 添加好友 / 黑名单）' })
    label: Label = null!;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null!;

    /** 本按钮对应的页签下标（`FriendTab` 的数值）。 */
    private index = 0;

    /** 点击回调，由宿主在 `onInit` 里绑一次。 */
    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        if (!this.button) {
            const own = this.getComponent(Button);
            if (own) this.button = own;
        }
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    /** 绑定页签下标 + 点击回调（`FriendPage.onInit` 里对三个页签各调一次）。 */
    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /**
     * 铺一次。
     *
     * ⚠️ 三处都要**绝对赋值**：文案、`interactable`、底图。
     *    底图那条是本方法的重点 —— 选中态必须由 `frameOn` / `frameOff` 决定，
     *    不能「拿不到就不换」（那样切页签时底图会停在上一帧，界面**不报错**，
     *    只是「页签高亮永远停在第 1 个」）。因此两张图都拿不到时才保留原帧。
     */
    render(text: string, selected: boolean, frameOff: SpriteFrame | null, frameOn: SpriteFrame | null): void {
        this.label.string = text;
        if (this.button) this.button.interactable = !selected;
        const target = selected ? frameOn : frameOff;
        if (target) this.background.spriteFrame = target;
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}

// ============================================================
// 未接项：页签红点（`com_rd`）
// ============================================================
//
// FGUI `组件_弹窗_页签.xml` 上有个 `com_rd`（130,0，右上角）；「好友申请」页签靠它提示
// 「有新的申请」。老端走 `ModelSystem.GetRDExpr()` 的**表达式引擎**（红点由服务端下发的
// 表达式串驱动），Demo3.8 **没有这套引擎** ⇒ 本轮不接，也不在 prefab 里放红点子节点
// （放一个永远不亮的节点只会误导后来人去找开关）。
// 几何备好：相对页签中心 `(+50, +36)`，尺寸 30×30，用 `app/common/RedDot.ts` 那一套。
