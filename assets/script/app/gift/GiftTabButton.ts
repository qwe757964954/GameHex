import { _decorator, Button, Color, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

const COLOR_ON = new Color(255, 255, 255, 255);
const COLOR_OFF = new Color(140, 140, 140, 255);

/**
 * 礼包面板底部的**大页签按钮**（120×111，照着 FGUI `共用组件/组件/底菜单/按钮_首页_菜单.xml` 的尺寸）。
 *
 * 简化点（与新项目「面板内自绘」的既有范式一致，见 `SevenDayPageTab`）：
 *   - FGUI 那个组件靠 `类型` 控制器的 `gearIcon` 切一整套主界面底菜单图标；这里**不用图标**，
 *     只用底图 + Label 文案 —— 礼包面板里只有两个页签，再引一套主界面图标包不划算。
 *   - 选中态靠两张底图切换（`bgOn` / `bgOff` 由宿主预加载后传入）。
 */
@ccclass('GiftTabButton')
export class GiftTabButton extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底图（选中 / 未选切换）' })
    bg: Sprite = null!;

    @property({ type: Label, tooltip: 'Label：页签文案' })
    label: Label = null!;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null!;

    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        if (!this.button) {
            const own = this.getComponent(Button);
            if (own) this.button = own;
        }
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /** 文案 + 选中态。文案为空时保留上一帧（模板复用时会串页签名）。 */
    render(text: string, selected: boolean, frameOff: SpriteFrame | null, frameOn: SpriteFrame | null): void {
        if (text && this.label) this.label.string = text;
        const target = selected ? frameOn : frameOff;
        if (target) {
            this.bg.spriteFrame = target;
        } else {
            this.bg.color = selected ? COLOR_ON : COLOR_OFF;
        }
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}
