import { _decorator, Button, Color, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

const LABEL_COLOR_ON = new Color(48, 38, 24, 255);
const LABEL_COLOR_OFF = new Color(255, 255, 255, 255);
const BACKGROUND_COLOR = new Color(255, 255, 255, 255);

/**
 * 礼包面板底部的大页签按钮。
 *
 * 只使用底图和 Label，不引入主界面菜单图标；选中态复用主页的 `nav_sel` 底图。
 */
@ccclass('GiftTabButton')
export class GiftTabButton extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底图（选中 / 未选切换）' })
    bg: Sprite = null!;

    @property({ type: Label, tooltip: 'Label：页签文案' })
    label: Label = null!;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null!;

    @property({ type: SpriteFrame, tooltip: '选中态底板（主页同款 city/nav_sel）' })
    selectedFrame: SpriteFrame = null!;

    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /** 文案 + 选中态；空文案保留 prefab 上的静态名称。 */
    render(text: string, selected: boolean): void {
        if (text) this.label.string = text;
        this.bg.spriteFrame = selected ? this.selectedFrame : null;
        this.bg.color = BACKGROUND_COLOR;
        this.label.color = selected ? LABEL_COLOR_ON : LABEL_COLOR_OFF;
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}
