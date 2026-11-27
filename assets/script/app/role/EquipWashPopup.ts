import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { EventMgr } from '../../framework/event/EventMgr';
import { FW } from '../../framework/FW';
import { RoleEvent } from './RoleEvents';
import { roleRepository } from './RoleRepository';
import { ROLE_TEXTS } from './RoleTexts';

const { ccclass, property } = _decorator;

export interface IEquipWashPopupOpenParams {
    equipId: number;
    name: string;
    rank: number;
    level: number;
    oldEffects: readonly string[];
    washValues: readonly number[];
    newEffectIds: readonly number[];
}

/**
 * 装备洗练对比确认弹窗（对齐 FGUI `组件_装备锻造_洗练分页.xml` 及老端 `LayerRoleEquipWash`）。
 *
 * 仅在装备锻造页面洗练请求成功后弹出，展示：
 *   - 左侧「洗练前」原有词条与右侧「洗练后」随机出的新词条对比；
 *   - 「取消」按钮：放弃新词条，保留原属性；
 *   - 「确认替换」按钮：发送替换确认协议，采用新属性；
 *   - 点击背景遮罩或关闭按钮默认取消保留原属性。
 */
@ccclass('EquipWashPopup')
export class EquipWashPopup extends PopupBase {
    static prefabPath = 'ui/Role/EquipWash';

    @property({ type: Node, tooltip: '弹窗主背景板（点击外部空白关闭）' })
    popBg: Node = null!;

    @property({ type: Button, tooltip: '关闭弹窗按钮' })
    closeBtn: Button = null!;

    @property({ type: Label, tooltip: '装备名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '品质文字' })
    qualityLabel: Label = null!;

    @property({ type: Label, tooltip: '等级文字' })
    lvLabel: Label = null!;

    @property({ type: Node, tooltip: '原属性面板' })
    nowPanel: Node = null!;

    @property({ type: Node, tooltip: '原属性列表容器' })
    nowAttrList: Node = null!;

    @property({ type: Node, tooltip: '新属性面板' })
    nextPanel: Node = null!;

    @property({ type: Node, tooltip: '新属性列表容器' })
    nextAttrList: Node = null!;

    @property({ type: Button, tooltip: '确认替换按钮' })
    washBtn: Button = null!;

    @property({ type: Button, tooltip: '放弃保留按钮' })
    cancelBtn: Button = null!;

    private equipId = 0;
    private oldEffects: readonly string[] = [];
    private newEffects: readonly string[] = [];

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(params?: IPopupOpenParams<IEquipWashPopupOpenParams> | IEquipWashPopupOpenParams): Promise<void> {
        const data = (params && 'userData' in params ? params.userData : params) as IEquipWashPopupOpenParams | undefined;
        if (!data) return;
        this.equipId = data.equipId;
        this.oldEffects = data.oldEffects;

        this.contentNodes = [this.popBg];

        this.nameLabel.string = data.name;
        this.qualityLabel.string = `${data.rank}阶`;
        this.lvLabel.string = data.level > 0 ? `Lv.${data.level}` : '';

        const context = this.popupOpenContext;
        const effects = await roleRepository.equipmentWashAttributes(data.newEffectIds, data.washValues);
        if (!context || context.cancelled) return;
        this.newEffects = effects;
        this.renderAttributeLists();
    }

    private bindEvents(): void {
        this.closeBtn.node.on(Button.EventType.CLICK, () => this.onCancelClick());
        this.washBtn.node.on(Button.EventType.CLICK, this.onConfirmClick, this);
        this.cancelBtn.node.on(Button.EventType.CLICK, this.onCancelClick, this);
    }

    private renderAttributeLists(): void {
        this.renderRows(this.nowAttrList, this.oldEffects);
        this.renderRows(this.nextAttrList, this.newEffects);
    }

    /**
     * 逐行填词条文字。
     *
     * 行内子节点是 `Dot / Label / Line`，其中 `Dot` 本身也是一个 Label（装饰符号 `●`，
     * 20×26、overflow=SHRINK）。`getComponentInChildren(Label)` 先命中 Dot，文字会被写进
     * 圆点里压成看不见的极小字号，真正的文字节点一直为空 —— 表现为「弹窗词条区是空的」。
     * 因此这里按名字取行内 `Label`，并对没有该子节点的 prefab 回退到行自身组件。
     */
    private renderRows(list: Node, effects: readonly string[]): void {
        const items = list.children;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const hasEffect = i < effects.length;
            item.active = hasEffect;
            if (!hasEffect) continue;
            const textNode = item.getChildByName('Label');
            const label = textNode ? textNode.getComponent(Label) : item.getComponent(Label);
            if (label) label.string = effects[i];
        }
    }

    private onConfirmClick(): void {
        this.submitWashConfirm(true);
    }

    private onCancelClick(): void {
        this.submitWashConfirm(false);
    }

    private submitWashConfirm(change: boolean): void {
        void roleRepository.requestGrowth('CmdEquipWashConformReqMsg', {
            equipId: this.equipId,
            change,
        }, this, () => {
            FW.showTip(change ? ROLE_TEXTS.equipApplyWash : ROLE_TEXTS.equipKeepWash);
            if (change) EventMgr.instance.emit(RoleEvent.WashConfirmed, this.equipId);
            this.close();
        });
    }
}
