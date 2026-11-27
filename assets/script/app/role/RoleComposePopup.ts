import { _decorator, Button, Label, Node, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { ROLE_TEXTS, roleQualityName } from './RoleTexts';
import { ROLE_COMPOSE_HIGH_QUALITY, type IRoleComposeView } from './RoleComposeView';
import { RoleComposeChipList } from './RoleComposeChipList';

const { ccclass, property } = _decorator;

export interface IRoleComposePopupParams {
    /** 聚合后的两段数据（`buildRoleComposeView` 的输出）。 */
    readonly view: IRoleComposeView;
    readonly title?: string;
    readonly sureText?: string;
    /** 高品质二次确认文案；缺省 = 一次点击即确认。 */
    readonly confirmAgainText?: string;
    readonly onConfirm?: () => void;
    readonly onCancel?: () => void;
}

/**
 * 一键合成确认弹窗，展示按品质汇总的消耗和预计产出。
 * 合成包含传说或更高品质的材料时，首次确认只更新按钮文案，第二次确认才提交。
 */
@ccclass('RoleComposePopup')
export class RoleComposePopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleComposePopup';

    @property({ type: Node, tooltip: '弹窗内容面板（点击外部空白关闭）' })
    panel: Node = null!;

    @property({ type: Label, tooltip: '标题（木牌）' })
    titleLabel: Label = null!;

    @property({ type: Label, tooltip: '第一段：将消耗 N 颗宝石' })
    costLabel: Label = null!;

    @property({ type: RoleComposeChipList, tooltip: '第一段棋子容器' })
    costChips: RoleComposeChipList = null!;

    @property({ type: Node, tooltip: '第二段容器（箭头 + 标题 + 产出棋子），无产出时隐藏' })
    outSection: Node = null!;

    @property({ type: Label, tooltip: '第二段：预计产出 N 颗宝石' })
    outLabel: Label = null!;

    @property({ type: RoleComposeChipList, tooltip: '第二段棋子容器' })
    outChips: RoleComposeChipList = null!;

    @property({ type: Node, tooltip: '警示图标（红圈感叹号）' })
    warnIcon: Node = null!;

    @property({ type: Label, tooltip: '警示文案（常规提示 / 高品质具体品质名）' })
    warnLabel: Label = null!;

    @property({ type: Button, tooltip: '右上角关闭' })
    closeBtn: Button = null!;

    @property({ type: Button, tooltip: '取消按钮' })
    cancelBtn: Button = null!;

    @property({ type: Label, tooltip: '取消按钮文字' })
    cancelLabel: Label = null!;

    @property({ type: Button, tooltip: '确认合成按钮' })
    sureBtn: Button = null!;

    @property({ type: Label, tooltip: '确认合成按钮文字' })
    sureLabel: Label = null!;

    private params: IRoleComposePopupParams | null = null;
    /** 「两次确认」是否已上膛。 */
    private armed = false;

    protected onInit(): void {
        this.closeBtn.node.on(Button.EventType.CLICK, this.closeByButton, this);
        this.cancelBtn.node.on(Button.EventType.CLICK, this.onCancelClick, this);
        this.sureBtn.node.on(Button.EventType.CLICK, this.onSureClick, this);
    }

    protected onOpen(userData?: IRoleComposePopupParams): void {
        if (!userData?.view?.materials.length) {
            this.close();
            return;
        }
        this.contentNodes = [this.panel];
        this.apply(userData);
    }

    protected onClose(): void {
        // 棋子留到下次 `apply` 统一清理：离场还有 0.16s 淡出，
        // 这里 destroy 会让图标在淡出途中突然消失。
        this.params = null;
        this.armed = false;
    }

    private apply(params: IRoleComposePopupParams): void {
        const view = params.view;
        const high = view.topQuality >= ROLE_COMPOSE_HIGH_QUALITY;
        this.params = params;
        this.armed = false;

        this.titleLabel.string = params.title ?? ROLE_TEXTS.gemCompose;
        this.costLabel.string = ROLE_TEXTS.gemComposeSummary(view.gemCount);
        // 警示永远可见：常规态是「材料不可找回」，高品质态换成**具体品质名**。
        this.setWarn(high
            ? ROLE_TEXTS.gemComposeWarn(roleQualityName(view.topQuality))
            : ROLE_TEXTS.gemComposeTip);

        const hasOutput = view.outputs.length > 0;
        this.outSection.active = hasOutput;
        this.outLabel.string = ROLE_TEXTS.gemComposeOutput(view.outputCount);

        this.costChips.render(view.materials);
        this.outChips.render(view.outputs);

        this.sureLabel.string = params.sureText ?? ROLE_TEXTS.gemComposeConfirm;
        this.cancelLabel.string = ROLE_TEXTS.gemComposeCancel;
    }

    /** 警示行整体居中：图标贴文字左侧，文字宽度变化时一起平移。 */
    private setWarn(text: string): void {
        this.warnLabel.string = text;
        this.warnLabel.updateRenderData(true);
        const ui = this.warnLabel.node.getComponent(UITransform);
        const measured = ui ? ui.width : 0;
        // 极端情况下 Label 还没算出宽度，用字数兜底，避免图标压到文字。
        const width = Math.min(560, Math.max(measured, text.length * 18));
        const iconGap = 8;
        const iconSize = 22;
        this.warnLabel.node.setPosition((iconSize + iconGap) / 2, 0, 0);
        this.warnIcon.setPosition(-(width + iconSize + iconGap) / 2 + iconSize / 2, 0, 0);
    }

    private onSureClick(): void {
        const params = this.params;
        if (!params) return;
        if (params.confirmAgainText && !this.armed) {
            this.armed = true;
            this.sureLabel.string = params.confirmAgainText;
            return;
        }
        params.onConfirm?.();
        this.close();
    }

    private onCancelClick(): void {
        this.params?.onCancel?.();
        this.close();
    }
}
