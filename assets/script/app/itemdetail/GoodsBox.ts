import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 「物品框」—— FGUI `共用组件/组件/物品框/组件_公用_道具`（100×100）在 Demo3.8 的实现。
 *
 * 结构（**三件套**，prefab 里必须齐全且按这个兄弟序）：
 *   Frame  品质框底图 —— **子节点 `Frame` 上的 `cc.Sprite`**（8 档 `cu_quality_01`..`08`）
 *   Icon   道具图标   —— **子节点 `Icon` 上的 `cc.Sprite`**
 *   Num    数量       —— **子节点 `Num` 上的 `cc.Label`**（锚点必须 `(1, 0.5)` + `overflow=NONE`）
 *
 * ⚠️ 三件套都在**子节点**上，`Goods` 这个根只有 `cc.UITransform` + 本组件。
 * 探针/调试读图时要走 `box.frame` / `box.icon` 这两个绑定，
 * 别写 `goodsNode.getComponent(cc.Sprite)` —— 那会**静默拿到 `null`**（看着像"图没加载"）。
 *
 * ## 尺寸口径（⚠️ 别照抄 `物品框.xml`）
 *
 * `物品框.xml` 只是 FGUI 里 `clearOnPublish="true"` 的**预览件**，不是运行时真源。
 * 真源是老端 `GObjGoodsBehavior.enter()`：
 *
 * ```js
 * var k = gobjGoods.width / com.width;      // com = 100×100 原稿
 * com.setScale(k, k);
 * ```
 *
 * ⇒ 宿主给的外框多大，里面这套就整体缩放多少（实测三处 `com_goods`：`k` 各不同）。
 * 所以 prefab 里 Frame/Icon/Num 的尺寸与位置**一律按 100×100 原稿烘**，
 * 缩放交给**宿主节点**的 `scale` —— 别在这里读宿主尺寸做自适应，那会和生成器的几何表打架。
 *
 * ## 三处宿主
 *
 *   · 物品详情主框   `ItemDetailPage.goods`（有数量）
 *   · 物品详情「内容」格 `ItemDetailPage.contentBar`（`onNumberVisible(false)` ⇒ 无数量）
 *   · 「10级领取」HUD  `GetHeroEntry.goods`（无数量）
 */
@ccclass('GoodsBox')
export class GoodsBox extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框 —— **子节点 `Frame` 上**的 cc.Sprite（8 档 `cu_quality_01`..`08`）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：道具图标 —— **子节点 `Icon` 上**的 cc.Sprite（没有映射图时会被整块隐藏）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Num：数量 —— **子节点 `Num` 上**的 cc.Label（锚点 (1,0.5) + overflow=NONE；`0` 时不显示）' })
    num: Label = null;

    /**
     * 点击回调 —— **由宿主在每次铺格子时重设**。
     *
     * ⚠️ 不能在这里绑「业务」监听：格子会被虚拟列表 / 池化 clone 复用，
     * 同一个实例会被赋上不同的物品；回调里必须按**当前身份**（宿主按 index 现取）处理，
     * 否则点第 3 格会触发第 1 格的请求。
     */
    onClick: (() => void) | null = null;

    /**
     * prefab 上烘的静态帧 —— `qualityFrame` 传 `null` 时的回退值。
     *
     * ⚠️ 存在的理由 = 让 `render()` 能**无条件写** `spriteFrame`（规则 82）：
     * 「有值才写」的写法在**复用格子**上是真 bug —— 上一格是金框、这一格的品质框图
     * 恰好加载失败（`null`）⇒ 金框留下来了，界面上静默显示**错的品质颜色**。
     * 有回退值之后每一趟都有确定值，短路问题消失。
     */
    private defaultFrame: SpriteFrame | null = null;

    protected onLoad(): void {
        // 兜底：万一 prefab 上漏绑了 `frame`，退回到「本节点自己的 Sprite」。
        // 当前三处宿主都是把 `Frame` 做成**子节点**（`box.frame` 指子节点上的 Sprite），
        // 所以这条分支实际不走 —— 留着只是为了别在漏绑定时直接 `null.string` 崩掉。
        if (!this.frame) {
            const own = this.getComponent(Sprite);
            if (own) this.frame = own;
        }
        this.defaultFrame = this.frame?.spriteFrame ?? null;
        // ⚠️ FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**（规则 81b）：
        //   `node.on(Button.EventType.CLICK, …)` 在这里是**静默死按钮** —— 点了没反应、不报错。
        //   正解就是 `Node.EventType.TOUCH_END`（老端也是手动 `setClick()`，不是真按钮）。
        this.node.on(Node.EventType.TOUCH_END, this.emitClick, this);
        // ⚠️ 这里**不写** `off`：`onDestroy` 里 `this.node.getComponent(X)?.node.off(...)`
        //   会因组件按 `_components` 序析构（`Component.node` 已置 null）抛 TypeError、
        //   中断整条销毁链（规则 71）。节点自身的监听随销毁自动清理。
    }

    private emitClick(): void {
        this.onClick?.();
    }

    /**
     * 铺一个物品框。
     *
     * ⚠️ 每一处状态都**绝对赋值**（规则 82）：prefab 会照 FGUI 原稿烘出**非零默认值**
     * （品质框默认金框、数量默认 1），而格子又是复用实例 ——
     * 「只在翻转时写」会让「新值 === 上一格留下的值」时短路，永久停在错的状态，且不报错。
     *
     * @param qualityFrame 品质框（**宿主预加载好再传**；`null` = 回退到 prefab 上的静态帧）
     * @param iconFrame    道具图标（`null` = 整块隐藏，不画问号占位）
     * @param numberText   数量文案（空串即不显示）
     * @param showNumber   要不要显示数量（「内容」格与 HUD 传 `false`）
     */
    render(
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        numberText: string = '',
        showNumber: boolean = false,
    ): void {
        // 三行都**无条件写**（规则 82）。品质框尤其不能「有值才写」—— 那是颜色语义，
        // 留错档不会报错、只会显示成另一个品质。`?? this.defaultFrame` 保证每趟都有值。
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
