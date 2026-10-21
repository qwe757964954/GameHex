import { _decorator, Button, CCFloat, CCInteger, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RdExprBinding } from '../rd/RedDotBinding';
import { RedDot } from './RedDot';

const { ccclass, property } = _decorator;
const TAB_ENABLED_TINT = new Color(255, 255, 255, 255);
const TAB_DISABLED_TINT = new Color(140, 140, 140, 255);

/**
 * 通用页签按钮 —— **主界面底栏六格**与**战令页内四格**共用这一个组件。
 *
 * ## 为什么能共用（不是凑合，是这两处本来就是同一个东西）
 * 老端 `zarts/.../共用组件/组件/底菜单/按钮_首页_菜单.xml`（120×111，pivot `0.5,1`）同时被：
 * - 首页底菜单 `组件_首页_底菜单.xml` 的六格引用；
 * - 战令底栏 `超值战令/组件/组件_战令.xml` 的「按钮_通行证 / 七日签到 / 等级基金 / 过关令」引用
 *   （`xy.x` = 480 / 360 / 240 / 600，pitch 120 ⇒ 与 `BattleTokenTable.BT_TABS` 的 240/360/480/600 一致）。
 * 所以两地共用同一个组件是**还原原稿**，不是新造的抽象。
 *
 * ## 两处实例的差异靠 Inspector 参数表达，不靠两套代码
 * | | 主界面底栏六格 | 战令页内四格 |
 * |---|---|---|
 * | 图标两态 | `offIcon` / `onIcon` 绑定在主城 prefab 实例（通常是同一张图） | `offIcon` / `onIcon` 写在实例覆盖上 |
 * | 图标底边 y | 继承共用件的 −34 | 实例覆盖成 −42.5（图高不同 ⇒ 底边要更低） |
 * | 选中时图标上移 | 主城实例绑定 12 | 26 |
 * | 名称 | 「商店」…（`NameLabel`，运行时 `setLabel`） | 无（图内已含文字 ⇒ 实例里把 `NameLabel` 置 `active=false`） |
 * | 红点 | `open.json` 的 `RDExpr` + `tlRDResId` 聚合（六格口径还没登记 ⇒ 当前恒收起） | `[RDBattleToken:<tabType>]` |
 *
 * ## 尺寸为什么是 122×96（而不是 FGUI 组件声明的 120×111）
 * 老端那两个底图 `TY_btn13/14.png` 是 **168×132**，美术按 ×0.7 导入 ⇒ **117.6×92.4**；
 * FGUI 里 `按钮_首页_菜单` 的 `size=120,111` 是**组件盒**（含透明留白），
 * 早期把 `111` 当成节点高，底图就被纵向拉伸了 10%+。共用件一律按底图自身尺寸 **122×96**。
 *
 * ## 两个图标 y 的来历（改之前先读这段）
 * 老端 `按钮_首页_菜单.xml` 里 `icon`（未选）底边距盒底 8px、`selectIcon`（选中）距 39px，
 * 而 `BattleTokenTabButton` 当年是按**元素盒中心**换算的：未选 −2.5 / 选中 +33.5。
 * 共用件的 `Icon` 改成**底边对齐**（anchor `0.5,0`）、`_sizeMode=RAW`（尺寸跟随贴图）
 * ⇒ 复现那对中心需要把底边放到 −42.5 / −16.5（未选图 80 高、选中图 100 高），位移 **26**。
 * 主界面那套图（67～83 高）沿用共用件的 −34 ⇒ 中心 ≈ −2.5，与本端既有版式一致。
 *
 * ## ⚠️ 有意没复刻的一处：FGUI 选中时是**整块**上抬
 * `按钮_首页_菜单.xml` 里底图是两个位置不同的元素 —— `n14`（up，`TY_btn13`）左上角 `(-1,16)`、
 * `n15`（down，`TY_btn14`）左上角 `(-1,-18)`，画布都 117.6×92.4 ⇒ **选中时整块木牌上抬 34px**；
 * 红点也跟着走（`gearXY = "98,3|97,-30"` ⇒ 相对中心 37.5 → 70.5，抬 33）。图标是 31（见上）。
 * 本端两态底图**共用一个节点位置**（只换图），红点也不跟随 —— 这是**移植以来就有的简化**
 * （主界面那套一直是静态底图），本轮只是换共用件，不在重构里偷偷改版式。
 * 要补就再走一遍 `iconRaiseY` 的口径：给 `bg.node` / 红点各加一条 `xxxRaiseY`。
 *
 * ## 三条写这条代码时必须守的约定
 * 1. **选中态绝对赋值**（项目规则）：`setSelected` 把底图 / 图标 / 位移**两态都写**。
 *    只写「选中」不写「取消」的话，切页签时会多个同时高亮。
 * 2. **不碰 `contentSize`**：两处 `Icon` 的 `cc.Sprite._sizeMode` 都是 `RAW(2)`，
 *    引擎在 `spriteFrame` 赋值时就会按贴图 `originalSize` 回写节点尺寸
 *    （见 `cocos/2d/components/sprite.ts` 的 `_applySpriteSize`）。
 *    代码里再写一遍是死代码，还会和声明打架 ⇒ 尺寸交给 prefab 声明。
 * 3. **红点走表达式**（`bindRedDotExpr`）：组件内部持有一个 `RdExprBinding`，
 *    后端推送 → 变量标脏 → 表达式重算 → `RedDot.setRedDot`，全程不用宿主干预。
 *    宿主销毁时由本组件的 `onDestroy` 解绑（不解绑则表达式引擎里留着指向死 `RedDot` 的回调）。
 *
 * ## `ensureInit()` 为什么不能只写在 `onLoad`
 * 引擎只在节点**第一次激活**时调 `onLoad`。prefab 里 `active=false` 的页面，
 * 它的 `onLoad` 会拖到第一次 `setActive(true)` 才跑 —— 而 `bindSelect` 常常更早被调用
 * （宿主在 `_wireStatic()` 里接线）。若只在 `onLoad` 里挂 CLICK 监听，
 * 那一批点击会**静默失效**（点页签没反应、零报错）。
 * ⇒ 初始化做成幂等，`onLoad` 与 `bindSelect` 各兜一次。
 */
@ccclass('TabButton')
export class TabButton extends Component {
    @property({ type: Sprite, tooltip: '底图：本节点自带的 Sprite，随选中态换 offBgFrame / onBgFrame' })
    bg: Sprite = null!;

    @property({ type: Sprite, tooltip: '图标：子节点 Icon（选中 / 未选中两态见下面两个字段）' })
    icon: Sprite = null!;

    @property({
        type: Label,
        tooltip: 'NameLabel：功能名（主界面底栏用；战令页签图内已含文字 ⇒ 实例里把该节点 active 置 false）',
    })
    nameLabel: Label = null!;

    @property({ type: SpriteFrame, tooltip: '底图·未选中（留空 = 不换底图，保留 prefab 现值）' })
    offBgFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '底图·选中（留空 = 不换底图）' })
    onBgFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '图标·未选中（留空 = 保留 prefab 的 Icon SpriteFrame）' })
    offIcon: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '图标·选中（留空 = 不换图标）' })
    onIcon: SpriteFrame = null!;

    @property({ type: RedDot, tooltip: 'RedDot：本格红点，挂 ui/common/RedDot.prefab 的实例' })
    redDot: RedDot = null!;

    @property({
        type: Node,
        tooltip: 'SelectBg：选中底板（主城七格的金色圆角块 nav_sel，压在图标下面）；留空 = 本格没有底板',
    })
    selectBg: Node | null = null;

    @property({ type: Color, tooltip: '名称·未选中颜色（主城七格 = 白色）' })
    offLabelColor: Color = new Color(255, 255, 255, 255);

    @property({ type: Color, tooltip: '名称·选中颜色（主城七格 = 白色，Label 自带深色描边）' })
    onLabelColor: Color = new Color(255, 255, 255, 255);

    @property({
        type: CCInteger,
        tooltip: '业务页签类型：主界面按 MainTab 识别；战令按 CmdBattleTokenType 识别',
    })
    tabType = -1;

    @property({ type: CCFloat, tooltip: '选中时图标额外上移的量（战令 26；主城实例 12）' })
    iconRaiseY = 0;

    /** 未选中态图标的 y（惰性读 prefab 现值，只读一次）。 */
    private baseIconY: number | null = null;
    private rdBinding: RdExprBinding | null = null;
    private onSelect: (() => void) | null = null;
    private inited = false;
    private isEnabled = true;
    private isSelected = false;

    protected onLoad(): void {
        this.ensureInit();
    }

    /** 幂等初始化：`onLoad` 与 `bindSelect` 各兜一次（见类注释）。 */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;
        this.node.on(Button.EventType.CLICK, this.handleClick, this);
    }

    private handleClick(): void {
        if (!this.isEnabled) return;
        if (this.onSelect) this.onSelect();
    }

    /**
     * 接点击。传 `null` 取消。
     *
     * 组件**只管视觉与点击回调**，不派发跳转 —— 切页 / 切 tab 由宿主决定
     * （主界面 `MainTabHost`，战令 `BattleTokenPage`）。
     */
    bindSelect(handler: (() => void) | null): void {
        this.ensureInit();
        this.onSelect = handler;
    }

    /** 写功能名（战令实例的 `NameLabel` 是隐藏的，写了也不显示）。 */
    setLabel(text: string): void {
        this.nameLabel.string = text;
    }

    /** 禁用时保留页签外观但压暗，并阻止宿主回调。 */
    setEnabled(enabled: boolean): void {
        this.isEnabled = enabled;
        const tint = this.isEnabled ? TAB_ENABLED_TINT : TAB_DISABLED_TINT;
        this.icon.color = tint;
        this.bg.color = tint;
        this.nameLabel.color = this.isEnabled ? (this.isSelected ? this.onLabelColor : this.offLabelColor) : tint;
    }

    /**
     * 直接指定图标帧 —— 供确实需要运行时换图的场景使用；主城导航资源由 prefab 实例绑定。
     *
     * @param frame `null` = 保留现有图（加载失败时不抹成空白，与 `RedDot` 同一口径）
     */
    setIconFrame(frame: SpriteFrame | null): void {
        if (frame) this.icon.spriteFrame = frame;
    }

    /** 选中态：底图 / 图标 / 图标位移 / 选中底板 / 文字颜色**两态都绝对赋值**（只写一半会多个同时高亮）。 */
    setSelected(selected: boolean): void {
        this.isSelected = selected;
        const bgFrame = selected ? this.onBgFrame : this.offBgFrame;
        if (bgFrame) this.bg.spriteFrame = bgFrame;

        const iconFrame = selected ? this.onIcon : this.offIcon;
        if (iconFrame) this.icon.spriteFrame = iconFrame;

        // 主城七格：选中态是**一块金色底板**（不是换图）⇒ 逐格切换底板显隐。
        // 未绑底板的实例（战令四格 / 旧六格）走 `if` 直接跳过，行为零变化。
        if (this.selectBg) this.selectBg.active = selected;

        // 名称颜色：同样两态都写（战令实例的 NameLabel 是隐藏的，写了不显示）。
        this.nameLabel.color = this.isEnabled
            ? (selected ? this.onLabelColor : this.offLabelColor)
            : TAB_DISABLED_TINT;

        // ⚠️ 基准 y 取 **prefab 现值**，只叠加偏移 —— 坐标声明跟 prefab 走，不在代码里写死。
        //    惰性读且只读一次：`onLoad` 可能因为宿主初始 `active=false` 而晚跑。
        if (this.iconRaiseY !== 0) {
            if (this.baseIconY === null) this.baseIconY = this.icon.node.position.y;
            const y = this.baseIconY + (selected ? this.iconRaiseY : 0);
            this.icon.node.setPosition(this.icon.node.position.x, y, this.icon.node.position.z);
        }
    }

    // ============================================================
    // 红点
    // ============================================================

    /**
     * 直接喂红点计数（`<= 0` 收起）。走 `RedDot.setRedDot` 的语义，见 `common/RedDot.ts`。
     *
     * 与 `bindRedDotExpr` **二选一**：表达式型入口用后者（后端推送自动亮灭），
     * 需要同步算出来的值才用这个。
     */
    setRedDot(count: number | boolean | null | undefined): void {
        this.redDot.setRedDot(count);
    }

    /**
     * 绑红点表达式（如主界面的 `[RDLeague]`、战令的 `[RDBattleToken:3]`）。
     *
     * - `expr` 为空 / `null` ⇒ 收起红点（老端 `AddRdExpr` 的 else 分支也是 `OnRDUpdate(0)`）；
     * - 可反复调用，内部 `RdExprBinding.bind` 会先解绑上一次；
     * - 表达式在**第一次 bind 时**才进表达式引擎 ⇒ 没配红点的格子零开销。
     */
    bindRedDotExpr(expr: string | null | undefined): void {
        if (!this.rdBinding) this.rdBinding = new RdExprBinding(this.redDot);
        this.rdBinding.bind(expr);
    }

    protected onDestroy(): void {
        // ⚠️ 必须解绑：不解则表达式引擎里留着指向已销毁 RedDot 的回调，
        //    下次值变化就往死对象上写（`setRedDot` 里读 `this.node.active` 会炸）。
        if (this.rdBinding) {
            this.rdBinding.unbind();
            this.rdBinding = null;
        }
        if (this.node && this.node.isValid) {
            this.node.off(Button.EventType.CLICK, this.handleClick, this);
        }
    }
}
