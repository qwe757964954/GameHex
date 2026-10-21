import { _decorator, Component, Node, sys, UITransform, view, Widget } from 'cc';

const { ccclass, property } = _decorator;
const MAIN_HUD_EDGE_MARGIN = 16;
const MAIN_HUD_LONG_SCREEN_TOP = 131;
const MAIN_HUD_STANDARD_ASPECT = 1280 / 720;

/** 普通屏贴顶；长屏使用额外高度留白，安全区较大时以安全区为准。 */
export function resolveMainHudTop(width: number, height: number, safeTop: number): number {
    const extraHeight = Math.max(0, height - width * MAIN_HUD_STANDARD_ASPECT);
    const longScreenInset = Math.min(
        MAIN_HUD_LONG_SCREEN_TOP - MAIN_HUD_EDGE_MARGIN,
        extraHeight / 2,
    );
    return MAIN_HUD_EDGE_MARGIN + Math.max(longScreenInset, safeTop);
}

/** 顶栏整体适配，子节点保持蓝湖稿内的相对位置。 */
@ccclass('MainHudLayout')
export class MainHudLayout extends Component {
    @property({ type: UITransform, tooltip: '主界面全屏视口' })
    viewport: UITransform = null!;

    @property({ type: Widget, tooltip: 'TopHud 的顶部对齐组件' })
    topHudWidget: Widget = null!;

    onEnable(): void {
        this.viewport.node.on(Node.EventType.SIZE_CHANGED, this.applyLayout, this);
        view.on('canvas-resize', this.applyLayout, this);
        this.applyLayout();
    }

    onDisable(): void {
        this.viewport.node.off(Node.EventType.SIZE_CHANGED, this.applyLayout, this);
        view.off('canvas-resize', this.applyLayout, this);
    }

    private applyLayout(): void {
        const visible = view.getVisibleSize();
        if (visible.height <= 0 || this.viewport.width <= 0 || this.viewport.height <= 0) return;
        // Cocos 返回设计坐标系的安全区；换算为当前页面坐标，避免物理像素重复缩放。
        const safeArea = sys.getSafeAreaRect(false);
        const safeTop = Math.max(0, visible.height - safeArea.y - safeArea.height)
            * this.viewport.height / visible.height;
        this.topHudWidget.top = resolveMainHudTop(this.viewport.width, this.viewport.height, safeTop);
        this.topHudWidget.updateAlignment();
    }
}
