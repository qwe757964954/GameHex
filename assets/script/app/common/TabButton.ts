import { _decorator, Button, CCFloat, CCInteger, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { RdExprBinding } from '../rd/RedDotBinding';
import { RedDot } from './RedDot';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../../core/hex/ShakePresentation';

const { ccclass, property } = _decorator;
const TAB_ENABLED_TINT = new Color(255, 255, 255, 255);
const TAB_DISABLED_TINT = new Color(140, 140, 140, 255);

/**
 * 通用页签按钮：主界面底栏与战令页内四格共用同一个组件。
 *
 * 两处实例的差异全部由 Inspector 参数表达（图标两态、图标底边 y、选中上移量、名称显隐、红点来源），
 * 不写两套代码。共用件尺寸按底图自身取 122×96 —— 老端 FGUI 的 120×111 是含透明留白的组件盒，
 * 拿它当节点高会把底图纵向拉伸。
 *
 * 写这个组件时要守的三条：
 * 1. 选中态绝对赋值：`setSelected` 把底图、图标、位移两态都写，只写选中会让多个页签同时高亮。
 * 2. 不碰 `contentSize`：两处 Icon 的 Sprite 都是 `RAW`，赋 `spriteFrame` 时引擎会按贴图尺寸回写节点，
 *    代码再写一遍是死代码；尺寸交给 prefab 声明。
 * 3. 红点走表达式：组件内部持有 `RdExprBinding`，宿主销毁时由 `onDestroy` 解绑，
 *    否则表达式引擎里会留着指向已销毁 `RedDot` 的回调。
 *
 * `ensureInit` 不能只放在 `onLoad`：`active=false` 的页面要等第一次 `setActive(true)` 才跑 `onLoad`，
 * 而 `bindSelect` 常常更早被调用；只在 `onLoad` 挂 CLICK 会让那批点击静默失效。
 * 所以 `onLoad` 与 `bindSelect` 各兜一次，`node.on` 自身按 callback + target 去重。
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
    offBgFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '底图·选中（留空 = 不换底图）' })
    onBgFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '图标·未选中（留空 = 保留 prefab 的 Icon SpriteFrame）' })
    offIcon: SpriteFrame | null = null;

    @property({ type: SpriteFrame, tooltip: '图标·选中（留空 = 不换图标）' })
    onIcon: SpriteFrame | null = null;

    @property({ type: RedDot, tooltip: 'RedDot：本格红点，挂 ui/common/RedDot.prefab 的实例' })
    redDot: RedDot = null!;

    @property({
        type: Node,
        tooltip: 'SelectBg：选中底板（主城七格的金色圆角块 nav_sel，压在图标下面）；留空 = 本格没有底板',
    })
    selectBg: Node | null = null;

    @property({ type: Node, tooltip: 'LockIcon：禁用时显示的右上角锁；无锁样式的页签可留空' })
    lockIcon: Node | null = null;

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
    private isEnabled = true;
    private isSelected = false;

    /** 「奖励粒子飞进本按钮」受击抖动的已用时（< 0 = 空闲）；基准缩放在起播那刻读一次。 */
    private hitElapsed = -1;
    private hitBaseScaleX = 1;
    private hitBaseScaleY = 1;

    protected onLoad(): void {
        this.ensureInit();
    }

    private ensureInit(): void {
        this.node.on(Button.EventType.CLICK, this.handleClick, this);
    }

    private handleClick(): void {
        if (!this.isEnabled) return;
        this.onSelect?.();
    }

    /**
     * 接点击。传 `null` 取消。
     *
     * 组件只管视觉与点击回调，不派发跳转 —— 切页 / 切 tab 由宿主决定。
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
        if (this.lockIcon) this.lockIcon.active = !enabled;
        const tint = this.isEnabled ? TAB_ENABLED_TINT : TAB_DISABLED_TINT;
        this.icon.color = tint;
        this.bg.color = tint;
        this.nameLabel.color = this.isEnabled ? (this.isSelected ? this.onLabelColor : this.offLabelColor) : tint;
    }

    /**
     * 直接指定图标帧，供确实需要运行时换图的场景；主城导航资源由 prefab 实例绑定。
     * `null` = 保留现有图（加载失败不抹成空白，与 `RedDot` 同口径）。
     */
    setIconFrame(frame: SpriteFrame | null): void {
        if (frame) this.icon.spriteFrame = frame;
    }

    /**
     * 「奖励粒子飞进本按钮」的受击抖动。
     *
     * 复用 `core/hex/ShakePresentation` 的「先 Y 后 X」两段脉冲（建筑生成 120% 档），
     * 不另造曲线；只写 `icon.node` 的缩放，且乘进起播那一刻的基准缩放，
     * 不覆盖 `setSelected` 的位移。纯 `elapsed` + `update`，不建 tween ——
     * 本组件会被复用，tween 挂在回收后的节点上会继续写。
     */
    playHitFeedback(): void {
        if (!this.icon.isValid) return;
        if (this.hitElapsed < 0) {
            const scale = this.icon.node.scale;
            this.hitBaseScaleX = scale.x;
            this.hitBaseScaleY = scale.y;
        }
        this.hitElapsed = 0;
    }

    /** 逐帧推进受击抖动；播完把缩放显式复位并停表（不靠曲线自己恒 1）。 */
    update(dt: number): void {
        if (this.hitElapsed < 0) return;
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.hitElapsed += step;
        if (!this.icon.isValid) {
            this.hitElapsed = -1;
            return;
        }
        if (this.hitElapsed >= SPAWN_SHAKE_TOTAL_SECONDS) {
            this.icon.node.setScale(this.hitBaseScaleX, this.hitBaseScaleY, 1);
            this.hitElapsed = -1;
            return;
        }
        const x = spawnShakeScaleX(this.hitElapsed, BUILDING_SHAKE_STRETCH);
        const y = spawnShakeScaleY(this.hitElapsed, BUILDING_SHAKE_STRETCH);
        this.icon.node.setScale(this.hitBaseScaleX * x, this.hitBaseScaleY * y, 1);
    }

    /** 选中态：底图 / 图标 / 位移 / 选中底板 / 文字颜色全部两态绝对赋值。 */
    setSelected(selected: boolean): void {
        this.isSelected = selected;
        const bgFrame = selected ? this.onBgFrame : this.offBgFrame;
        if (bgFrame) this.bg.spriteFrame = bgFrame;

        const iconFrame = selected ? this.onIcon : this.offIcon;
        if (iconFrame) this.icon.spriteFrame = iconFrame;

        // 主城七格：选中态是一块金色底板（不换图），逐格切换底板显隐；未绑底板的实例跳过。
        if (this.selectBg) this.selectBg.active = selected;

        // 名称颜色同样两态都写（战令实例的 NameLabel 是隐藏的，写了不显示）。
        this.nameLabel.color = this.isEnabled
            ? (selected ? this.onLabelColor : this.offLabelColor)
            : TAB_DISABLED_TINT;

        // 基准 y 取 prefab 现值，只叠加偏移；惰性读且只读一次（onLoad 可能晚跑）。
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
     * 直接喂红点计数（`<= 0` 收起）。
     * 与 `bindRedDotExpr` 二选一：需要后端推送自动亮灭的用表达式入口，同步算出来的值用这个。
     */
    setRedDot(count: number | boolean | null | undefined): void {
        this.redDot.setRedDot(count);
    }

    /**
     * 绑红点表达式（如 `[RDLeague]`、`[RDBattleToken:3]`）。
     *
     * - `expr` 为空 / `null` ⇒ 收起红点（与老端 `AddRdExpr` 的 else 分支一致）；
     * - 可反复调用，`RdExprBinding.bind` 会先解绑上一次；
     * - 表达式第一次 bind 时才进表达式引擎，没配红点的格子零开销。
     */
    bindRedDotExpr(expr: string | null | undefined): void {
        if (!this.rdBinding) this.rdBinding = new RdExprBinding(this.redDot);
        this.rdBinding.bind(expr);
    }

    protected onDestroy(): void {
        // 必须解绑：不解则表达式引擎里会留着指向已销毁 RedDot 的回调。
        if (this.rdBinding) {
            this.rdBinding.unbind();
            this.rdBinding = null;
        }
        this.node.off(Button.EventType.CLICK, this.handleClick, this);
    }
}
