/**
 * 「好友」面板底部的页签按钮，三个页签共用一份（对齐 FGUI `共用组件/组件/页签/组件_弹窗_页签`）。
 *
 * 样式与布局全在 prefab 上，代码只处理随状态变化的部分 —— 这里只有底图：
 * 选中 `fd_tab_on`、未选中 `fd_tab_off`，两张图由 `FriendPage` 预加载后传进来。
 * 换不到就保留 prefab 里那一帧，不置空（置空会变成一个看不见的按钮，而且不报错）。
 *
 * FGUI `gearIcon` 的映射：`up` → `fd_tab_off`，`down` / `selectedOver` → `fd_tab_on`，
 * `over` → `fd_tab_over`（本工程不用 hover 态）。
 */

import { _decorator, Button, Color, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('FriendTabButton')
export class FriendTabButton extends Component {
    @property({ type: Sprite, tooltip: 'Bg：页签底图（选中 / 未选 两态切换）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: 'Label：页签文案（好友列表 / 添加好友 / 黑名单）' })
    label: Label = null;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null;

    /** 本按钮对应的页签下标（`FriendTab` 的数值）。 */
    private index = 0;

    /** 点击回调，由宿主在 `onInit` 里绑一次。 */
    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    /** 绑定页签下标 + 点击回调（`FriendPage.onInit` 里对三个页签各调一次）。 */
    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /**
     * 铺一次：文案 / 颜色 / `interactable` / 底图都要绝对赋值。
     *
     * v2 是「灰轨道 + 金黄选中药丸」：未选中不挂底图（`frameOff` 传 null 就清空），
     * 选中才显示 `frameOn`。底图不能「拿不到就不换」—— 那样切页签时高亮会停在上一帧。
     */
    render(text: string, selected: boolean, frameOff: SpriteFrame | null, frameOn: SpriteFrame | null): void {
        this.label.string = text;
        this.label.fontSize = 26;
        this.label.isBold = true;
        this.label.color = selected
            ? new Color(255, 248, 234, 255)
            : new Color(74, 55, 38, 255);
        this.label.enableOutline = selected;
        this.label.outlineColor = new Color(122, 74, 5, 255);
        this.label.outlineWidth = 2;
        this.button.interactable = !selected;

        if (selected) {
            if (frameOn) this.background.spriteFrame = frameOn;
        } else {
            // 未选中必须清空（含首次 `frameOff = null` 的情况），否则会残留上一页的金底。
            this.background.spriteFrame = frameOff;
        }
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}

// 未接项：页签红点（FGUI `com_rd`，「好友申请」页签靠它提示有新申请）。
// 老端走服务端的红点表达式引擎，Demo3.8 没有这套引擎，所以本轮不接，prefab 里也不放
// 红点子节点（放一个永远不亮的节点只会让人去找开关）。几何：相对页签中心 (+50, +36)，30×30。
