import { _decorator, Button, Component, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「超值礼包」页的一个子页签。
 *
 * 标题使用美术文字图，不是 Label；拿不到标题图时保留 prefab 当前图。
 */
@ccclass('GiftSubTab')
export class GiftSubTab extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底图（未选 / 选中两张切换）' })
    bg: Sprite = null!;

    @property({ type: Sprite, tooltip: 'TitleArt：标题图' })
    titleArt: Sprite = null!;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null!;

    /** 本页签在列表里的下标，由宿主 `bind` 写入。 */
    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        this.button.node.on(Button.EventType.CLICK, this.emitClick, this);
    }

    /** 绑定下标与回调（每次铺列表都要重绑，避免复用残影）。 */
    bind(index: number, clickHandler: (index: number) => void): void {
        this.index = index;
        this.clickHandler = clickHandler;
    }

    /** `selected` = 选中态；两张底图任一为空时只切能得到的那张。 */
    render(selected: boolean, frameOff: SpriteFrame | null, frameOn: SpriteFrame | null): void {
        const target = selected ? frameOn : frameOff;
        if (target) this.bg.spriteFrame = target;
    }

    /** 换标题图；传 `null` 时**不动**（避免把上一帧的标题带过来或画成空白）。 */
    renderTitle(frame: SpriteFrame | null): void {
        if (!frame) return;
        this.titleArt.spriteFrame = frame;
        this.titleArt.node.active = true;
    }

    private emitClick(): void {
        this.clickHandler?.(this.index);
    }
}
