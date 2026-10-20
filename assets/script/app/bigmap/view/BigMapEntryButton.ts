import { _decorator, Component, Graphics, Label, Node, UITransform } from 'cc';
import type { ConfigService } from '../../../core/config/ConfigService';
import { BigMapEntry } from '../application/BigMapEntry';
import { BIGMAP_COLORS, createLabel, createUiNode, drawPanel } from './BigMapTheme';

const { ccclass } = _decorator;

/**
 * 主界面上的「大地图」悬浮入口按钮。
 *
 * 为什么用悬浮按钮而不是塞进底部六格：底部六格是既有版式（商店/角色/竞技/领地/冒险/联盟），
 * 加第七格会动到主城 tab 配置与那排 `TabButton` 的 prefab；
 * 大世界本期是新增玩法、美术也未定，先用一个独立的悬浮按钮挂上，改版式时直接挪。
 */
@ccclass('BigMapEntryButton')
export class BigMapEntryButton extends Component {
    private configs: ConfigService | null = null;
    private label: Label = null!;
    private background: Graphics = null!;

    /** 由 `MainTabHost` 注入（必须早于节点激活）。 */
    initialize(configs: ConfigService): void {
        this.configs = configs;
    }

    onLoad(): void {
        const size = this.node.getComponent(UITransform)?.contentSize ?? { width: 132, height: 46 };
        const width = size.width || 132;
        const height = size.height || 46;

        const panel = createUiNode('Panel', this.node, width, height);
        this.background = panel.addComponent(Graphics);
        this.paint(false);
        this.label = createLabel(panel, '大地图', 20, BIGMAP_COLORS.text, width - 12, height);
        this.label.horizontalAlign = Label.HorizontalAlign.CENTER;

        panel.on(Node.EventType.TOUCH_START, () => this.paint(true));
        panel.on(Node.EventType.TOUCH_CANCEL, () => this.paint(false));
        panel.on(Node.EventType.TOUCH_END, () => {
            this.paint(false);
            void this.open();
        });
    }

    private paint(pressed: boolean): void {
        const size = this.node.getComponent(UITransform)?.contentSize ?? { width: 132, height: 46 };
        drawPanel(
            this.background,
            size.width || 132,
            size.height || 46,
            pressed ? BIGMAP_COLORS.panelLight : BIGMAP_COLORS.panel,
            BIGMAP_COLORS.gold,
        );
    }

    private async open(): Promise<void> {
        if (!this.configs) {
            console.warn('[BigMapEntryButton] 还没注入 ConfigService，无法打开大世界');
            return;
        }
        await BigMapEntry.shared().open(this.configs);
    }
}
