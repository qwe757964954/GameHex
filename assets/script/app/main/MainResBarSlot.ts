import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ResBarSlot } from './MainResBarTypes';
import { loadResBarSprite } from './MainResBarArt';

const { ccclass, property } = _decorator;

/** 资源栏里的一个资源格。 */
@ccclass('MainResBarSlot')
export class MainResBarSlot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：资源图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Value：数值（体力是 当前/上限）' })
    valueLabel: Label = null!;

    /**
     * Plus：补货加号。**设计上可选** —— 只有「能补货」的格子（体力这类）才配这个节点，
     * 商城的金币 / 钻石格本来就没有加号 ⇒ 它挂 `ResBar` 时不绑这一项。
     *
     * ⚠️ 与规则 109「已绑的 `@property` 一律不判空」不冲突：那条管的是**绑错了不许静默**；
     * 这里是「本格没有加号」这种**合法配置**，所以按可选处理，不是防编辑器漏绑。
     * 判据：`render(null)` 之外，`showPlus` 为 false 的格子在任何宿主下都不需要这个节点。
     */
    @property({ type: Node, tooltip: 'Plus：补货加号（只有可补货的格子才有，如体力格；没有就留空）' })
    plus: Node | null = null;

    @property({ type: SpriteFrame, tooltip: 'Optional icon supplied by the host prefab; otherwise use the resource table icon' })
    iconOverride: SpriteFrame | null = null;

    @property({ tooltip: 'Keep the add affordance visible for this host appearance' })
    alwaysShowPlus = false;

    /** 防串图令牌：异步回调回来时数据可能已换。 */
    private token = 0;

    onLoad(): void {
        this.icon.trim = false;
        this.icon.sizeMode = Sprite.SizeMode.CUSTOM;
    }

    /** @param slot null = 整格隐藏。 */
    render(slot: ResBarSlot | null): void {
        if (!slot) {
            this.node.active = false;
            return;
        }
        this.node.active = true;
        this.valueLabel.string = slot.valueText;
        if (this.plus) this.plus.active = this.alwaysShowPlus || slot.showPlus;

        const current = ++this.token;
        if (this.iconOverride) {
            this.icon.spriteFrame = this.iconOverride;
            return;
        }
        if (!slot.iconArt) {
            this.icon.spriteFrame = null;
            return;
        }
        void loadResBarSprite(slot.iconArt).then((frame) => {
            if (!this.isValid || current !== this.token) return;
            if (frame) this.icon.spriteFrame = frame;
        });
    }
}
