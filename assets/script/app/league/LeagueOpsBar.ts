/**
 * 「联盟 · 大厅 · 详情」的**角色操作浮层** —— `720×100`
 * （`ui/League/LeagueHall.prefab` 的 `TabDetail/OpsBar`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_联盟操作.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n6` 浮层底框 `frame_Zhikuang01`（859×100，横向铺满） | `Bg` | 九宫格 |
 * | `click` 4096×4096 空白 loader | `Click` | **全屏点击遮罩**：点它 = 收起浮层 |
 * | `n13` group（804×70，`layout=hz colGap=10`） | `Group` | 5 个按钮的容器（恒居中） |
 * | `btn_show` / `btn_to_leader` / `btn_to_admin` / `btn_un_admin` / `btn_kick` | `BtnShow` / `BtnToLeader` / `BtnToAdmin` / `BtnUnAdmin` / `BtnKick` | `按钮_公共_通用`，`icon=TY_btn07` |
 *
 * ## 三个行为口径（照老端 `LayerLeagueHallDetail`）
 *
 * 1. **浮层不居中、而是贴在被点的那一行上**：老端 `itemClick` 里
 *    `comp_ctrl.y = local.y`（该行竖向中点在详情组件内的 y）—— 横向不动。
 *    y 的换算见 `LeagueHallPage.placeOpsBar`。
 * 2. **5 个按钮按权限逐个显隐**（`myvo.CanBeXxx(targetOffical)` → 本端 `resolveLeagueMemberActions`），
 *    不是整排显示 / 隐藏。
 * 3. **任何一次操作、或点空白，都要收起浮层**（老端每个 handler 末尾都调 `onGlobalTouch()`）。
 *
 * ## 为什么 `Click` 能当遮罩
 *
 * 工程既有约定（见 `framework/ui/PopupBase` 的注释）：Cocos 里节点**只要注册了触摸监听**
 * 就参与命中检测（`UITransform.hitTest`），**不需要 Sprite / Button**。
 *
 * ⚠️ 但「浮层打开时不要把点击透传到底下的页签 / 列表行」这件事**不能只靠引擎**：
 *    引擎会把事件派发给所有命中节点（各节点自行决定是否 `propagationStopped`）。
 *    所以 `LeagueHallPage` 里对页签 / 行点击做了一道 `opsBar.isOpen ⇒ 只收起、不响应` 的显式闸门。
 */

import { _decorator, Button, Component, Node } from 'cc';
import type { ILeagueMemberActions } from './LeagueTable';

const { ccclass, property } = _decorator;

/** 浮层上的 5 个操作（键 = `LeagueTexts.LEAGUE_OPS_LABELS` / `ILeagueMemberActions` 对齐）。 */
export type LeagueOpsAction = 'show' | 'toLeader' | 'toAdmin' | 'unAdmin' | 'kick';

@ccclass('LeagueOpsBar')
export class LeagueOpsBar extends Component {
    @property({ type: Node, tooltip: 'btn_show：查看' })
    showButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_to_leader：任命盟主' })
    toLeaderButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_to_admin：任命副盟主' })
    toAdminButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_un_admin：卸任副盟主' })
    unAdminButton: Node = null!;

    @property({ type: Node, tooltip: 'btn_kick：踢出联盟' })
    kickButton: Node = null!;

    @property({ type: Node, tooltip: 'click：全屏点击遮罩（点它收起浮层）' })
    clickMask: Node = null!;

    /** 点中某个操作时的回调（浮层**先自己收起**再回调，与老端 `onGlobalTouch()` 同序）。 */
    onSelect: ((action: LeagueOpsAction) => void) | null = null;

    /** 浮层收起时的回调（可选，给宿主做「取消选中」）。 */
    onDismiss: (() => void) | null = null;

    private bound = false;

    protected onLoad(): void {
        this.bind();
    }

    /** 浮层是否正展开。 */
    get isOpen(): boolean {
        return !!this.node && this.node.isValid && this.node.active;
    }

    /**
     * 按权限显隐 + 移到指定 y 并展开。
     *
     * @param actions `resolveLeagueMemberActions` 的结果（五项权限）
     * @param y       浮层中心的 y（**详情容器局部坐标**，由 `LeagueHallPage.placeOpsBar` 算好）
     */
    show(actions: ILeagueMemberActions, y: number): void {
        this.bind();
        this.applyActions(actions);
        // 只改 y：x 是 prefab 里的设计位（FGUI `comp_ctrl` 横向不动）
        this.node.setPosition(this.node.position.x, y, this.node.position.z);
        this.node.active = true;
    }

    /** 收起浮层（幂等）。 */
    hide(): void {
        if (!this.node || !this.node.isValid) return;
        if (!this.node.active) return;
        this.node.active = false;
        if (this.onDismiss) this.onDismiss();
    }

    /** 五个按钮逐个显隐（**绝对赋值**，不依赖上一状态）。 */
    applyActions(actions: ILeagueMemberActions): void {
        setActive(this.showButton, actions.show);
        setActive(this.toLeaderButton, actions.appointLeader);
        setActive(this.toAdminButton, actions.appointAdmin);
        setActive(this.unAdminButton, actions.dismissAdmin);
        setActive(this.kickButton, actions.kick);
    }

    private bind(): void {
        if (this.bound) return;
        this.bound = true;

        this.onClick(this.showButton, 'show');
        this.onClick(this.toLeaderButton, 'toLeader');
        this.onClick(this.toAdminButton, 'toAdmin');
        this.onClick(this.unAdminButton, 'unAdmin');
        this.onClick(this.kickButton, 'kick');
        // 点空白 = 只收起，不派发任何操作
        this.onClick(this.clickMask, null);
    }

    private onClick(node: Node | null, action: LeagueOpsAction | null): void {
        if (!node) {
            console.warn('[LeagueOpsBar] 按钮 / 遮罩节点缺失，点击不会生效');
            return;
        }
        const handler = (): void => {
            this.hide();
            if (action && this.onSelect) this.onSelect(action);
        };
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }
}

/** 安全显隐（节点缺失时静默跳过）。 */
function setActive(node: Node | null, active: boolean): void {
    if (node && node.isValid) node.active = active;
}
