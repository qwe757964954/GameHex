import { _decorator, Button, Component, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「超值礼包」页里的**一个子页签**（159×64）。
 *
 * 结构对齐 FGUI `礼包/组件/子页面/超值礼包子页面/组件_礼包_超值礼包页签.xml`：
 *   - `n0` / `n1` 两张底图（未选 / 选中，`gearDisplay` 按 `选中` 控制器切）
 *   - `img_tittle`：标题**图**（`gearIcon` 按 `tabName` 切，5 张 + 默认）
 *   - `com_rd`：红点
 *
 * ⚠️ 标题用的是**美术文字图**（`gf_tab_daily` / `gf_tab_week` / `gf_tab_month`），
 * 不是 Label。图与名字一一对应（`mr.png` = 每日、`zc.png` = 周常、`yd.png` = 月度），
 * 空串标题会画出一块空白底 —— 所以 `render()` 拿不到标题图时**不切**，保留上一帧。
 */
@ccclass('GiftSubTab')
export class GiftSubTab extends Component {
    @property({ type: Sprite, tooltip: 'Bg：底图（未选 / 选中两张切换）' })
    bg: Sprite = null;

    @property({ type: Sprite, tooltip: 'TitleArt：标题图（保留上一帧，拿不到不切）' })
    titleArt: Sprite = null;

    @property({ type: Button, tooltip: 'Button：本节点上的 cc.Button' })
    button: Button = null;

    /** 本页签在列表里的下标（宿主 `bind` 时写入）。 */
    private index = 0;

    private clickHandler: ((index: number) => void) | null = null;

    protected onLoad(): void {
        if (!this.button) {
            const own = this.getComponent(Button);
            if (own) this.button = own;
        }
        // 监听挂**节点自己**上（模板实例各自绑一次）。
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
