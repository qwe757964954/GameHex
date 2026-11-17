import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「物品框」—— FGUI `组件_公用_道具`（100×100）在 Demo3.8 的实现。
 *
 * 结构是三件套，都在子节点上（根节点只有 `cc.UITransform` + 本组件）：
 *   Frame  品质框底图（8 档 `cu_quality_01`..`08`）
 *   Icon   道具图标
 *   Num    数量（锚点 (1, 0.5) + overflow=NONE）
 * 读图要走 `frame` / `icon` 这两个绑定，别对根节点 `getComponent(Sprite)` —— 那会静默拿到 null。
 *
 * 尺寸口径来自老端 `GObjGoodsBehavior.enter()`：按宿主外框与 100×100 原稿的比例整体缩放。
 * 所以 prefab 里三件套一律按 100×100 烘，缩放交给宿主节点的 `scale`。
 *
 * 宿主共三处：物品详情主框、「内容」格（无数量）、「10级领取」HUD（无数量）。
 */
@ccclass('GoodsBox')
export class GoodsBox extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框 —— **子节点 `Frame` 上**的 cc.Sprite（8 档 `cu_quality_01`..`08`）' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：道具图标 —— **子节点 `Icon` 上**的 cc.Sprite（没有映射图时会被整块隐藏）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Num：数量 —— **子节点 `Num` 上**的 cc.Label（锚点 (1,0.5) + overflow=NONE；`0` 时不显示）' })
    num: Label = null!;

    /**
     * 点击回调，由宿主在每次铺格子时重设。
     *
     * 不能在这里绑业务监听：格子会被虚拟列表 / 池化 clone 复用，同一实例对应不同的物品，
     * 回调里必须按当前身份（宿主按 index 现取）处理。
     */
    onClick: (() => void) | null = null;

    /**
     * prefab 上烘的静态帧，`qualityFrame` 传 `null` 时的回退值。
     * 有了它，`render()` 才能无条件写 `spriteFrame`；否则复用格子时，
     * 上一格的品质框会在本格图加载失败（`null`）时留下来，静默显示错的品质颜色。
     */
    private defaultFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        this.defaultFrame = this.frame.spriteFrame ?? null;
        // 节点上没有 cc.Button，只能监听 TOUCH_END；绑 CLICK 会是死按钮。
        // 监听随节点销毁自动清理，这里不写 off（组件按 _components 序析构时 node 已置 null）。
        this.node.on(Node.EventType.TOUCH_END, this.emitClick, this);
    }

    private emitClick(): void {
        this.onClick?.();
    }

    /**
     * 铺一个物品框。每处状态都绝对赋值：prefab 会照 FGUI 原稿烘出非零默认值
     * （品质框默认金框、数量默认 1），而格子是复用实例，条件赋值会永久停在错的状态。
     *
     * @param qualityFrame 品质框（宿主预加载好再传；`null` 回退到 prefab 静态帧）
     * @param iconFrame    道具图标（`null` 整块隐藏）
     * @param numberText   数量文案（空串即不显示）
     * @param showNumber   是否显示数量（「内容」格与 HUD 传 `false`）
     */
    render(
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        numberText: string = '',
        showNumber: boolean = false,
    ): void {
        this.frame.spriteFrame = qualityFrame ?? this.defaultFrame;
        this.icon.spriteFrame = iconFrame;
        this.icon.node.active = iconFrame != null;
        this.num.string = numberText;
        this.num.node.active = showNumber && numberText.length > 0;
    }

    hide(): void {
        this.node.active = false;
    }
}
