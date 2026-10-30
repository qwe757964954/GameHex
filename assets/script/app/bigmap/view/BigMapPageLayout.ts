import { _decorator, Component, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import { BigMapBaseView } from './BigMapBaseView';
import { BigMapButton } from './BigMapButton';
import { BigMapBuildRow } from './BigMapBuildRow';

const { ccclass, property } = _decorator;

/** 固定结构与 Inspector 接线；内容和交互由 BigMapPage 编排。 */
@ccclass('BigMapPageLayout')
export class BigMapPageLayout extends Component {
    @property(Node) backdrop: Node = null;
    @property(Node) header: Node = null;
    @property(Node) resourceCard: Node = null;
    @property([Label]) resourceLabels: Label[] = [];
    @property([Sprite]) resourceIcons: Sprite[] = [];
    @property(BigMapBaseView) baseView: BigMapBaseView = null;
    @property(BigMapButton) harvestButton: BigMapButton = null;
    @property(BigMapButton) buildMenuButton: BigMapButton = null;
    @property(Node) modeNode: Node = null;
    @property(Label) modeLabel: Label = null;
    @property(Sprite) modeIcon: Sprite = null;
    @property(Sprite) modeFrame: Sprite = null;
    @property(Graphics) modeFallback: Graphics = null;
    @property(Node) buildPanel: Node = null;
    @property(BigMapBuildRow) buildRowTemplate: BigMapBuildRow = null;
    @property(Node) infoDim: Node = null;
    @property(Node) infoPanel: Node = null;
    @property(Label) infoTitle: Label = null;
    @property(Label) infoBody: Label = null;
    @property(Sprite) infoThumbnail: Sprite = null;
    @property(BigMapButton) closeButton: BigMapButton = null;
    @property(BigMapButton) primaryButton: BigMapButton = null;
    @property(BigMapButton) secondaryButton: BigMapButton = null;
    @property(Node) queuePanel: Node = null;
    @property(Label) queueLabel: Label = null;
    @property(Label) toastLabel: Label = null;
    @property(Node) enterMask: Node = null;
    @property(Label) enterLabel: Label = null;

    resize(width: number, height: number, navigationHeight: number): void {
        const size = (node: Node, w: number, h: number): void => {
            const transform = node.getComponent(UITransform);
            if (!transform) throw new Error(`[BigMapPageLayout] ${node.name} 缺少 UITransform`);
            transform.setContentSize(w, h);
        };
        size(this.node, width, height);
        size(this.backdrop, width, height);
        size(this.infoDim, width, height);
        size(this.enterMask, width, height);
        size(this.enterLabel.node, width - 80, 44);
        this.enterLabel.node.setPosition(0, height / 2 - 160);
        size(this.header, width, 108);
        this.header.setPosition(0, height / 2 - 54);
        const cardWidth = Math.max(220, width - 152);
        size(this.resourceCard, cardWidth, 62);
        this.resourceCard.setPosition(-width / 2 + 12 + cardWidth / 2, 0);
        const resourceWidth = cardWidth / 5;
        this.resourceIcons.forEach((icon, index) => {
            icon.node.setPosition(-cardWidth / 2 + resourceWidth * index + 20, 0);
            const label = this.resourceLabels[index];
            size(label.node, resourceWidth - 38, 30);
            label.node.setPosition(-cardWidth / 2 + resourceWidth * (index + 0.5) + 14, 0);
        });
        this.harvestButton.node.setPosition(width / 2 - 70, 0);
        this.buildMenuButton.node.setPosition(-width / 2 + 60, height / 2 - 140);
        this.buildPanel.setPosition(-width / 2 + 162, -40);
        const panelWidth = Math.min(Math.max(300, width - 48), 560);
        const panelHeight = Math.min(400, Math.max(300, height - 108 - navigationHeight - 160));
        size(this.infoPanel, panelWidth, panelHeight);
        size(this.infoTitle.node, panelWidth - 56, 34);
        size(this.infoBody.node, panelWidth - 56, panelHeight - 170);
        this.closeButton.node.setPosition(panelWidth / 2 - 23, panelHeight / 2 - 22);
        size(this.queuePanel, width - 180, 38);
        size(this.queueLabel.node, width - 210, 30);
        this.queuePanel.setPosition(50, height / 2 - 134);
        size(this.toastLabel.node, width - 40, 36);
        this.toastLabel.node.setPosition(0, height / 2 - 188);
    }
}
