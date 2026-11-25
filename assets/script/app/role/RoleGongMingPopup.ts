import { _decorator, Button, Color, Component, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason, type IPopupOpenParams } from '../../framework/ui/PopupDef';
import { roleRepository } from './RoleRepository';

const { ccclass, property } = _decorator;

interface IGongMingTier {
    quality: number;
    name: string;
    addDamagePer: number;
}

const GONG_MING_TIERS: ReadonlyArray<IGongMingTier> = [
    { quality: 1, name: '普通', addDamagePer: 3 },
    { quality: 2, name: '精良', addDamagePer: 6 },
    { quality: 3, name: '优秀', addDamagePer: 9 },
    { quality: 4, name: '史诗', addDamagePer: 12 },
    { quality: 5, name: '传说', addDamagePer: 15 },
    { quality: 6, name: '绝世', addDamagePer: 18 },
    { quality: 7, name: '神话', addDamagePer: 21 },
];

/**
 * 角色共鸣弹窗（对齐 FGUI `组件_角色_共鸣.xml`、`组件_角色_共鸣_属性.xml` 及老端 `LayerRoleGongMing`）。
 *
 * 展示：
 *   - 「当前共鸣」阶级与伤害加成效果；
 *   - 下指向箭头；
 *   - 「下一阶共鸣」达成条件与更高属性预览；
 *   - 点击背景深色遮罩或关闭按钮安全退出。
 */
@ccclass('RoleGongMingPopup')
export class RoleGongMingPopup extends PopupBase {
    static prefabPath = 'ui/Role/RoleGongMing';

    @property({ type: Node, tooltip: '弹窗主面板' })
    popupPanel: Node = null!;

    @property({ type: Button, tooltip: '关闭按钮' })
    closeBtn: Button = null!;

    @property({ type: Label, tooltip: '当前共鸣标题' })
    nowTitle: Label = null!;

    @property({ type: Label, tooltip: '当前共鸣属性' })
    nowAttr: Label = null!;

    @property({ type: Node, tooltip: '当前共鸣角标' })
    nowMarker: Node = null!;

    @property({ type: Label, tooltip: '下一阶共鸣标题' })
    nextTitle: Label = null!;

    @property({ type: Label, tooltip: '下一阶共鸣属性' })
    nextAttr: Label = null!;

    @property({ type: Node, tooltip: '下一阶共鸣角标' })
    nextMarker: Node = null!;

    protected onInit(): void {
        this.bindEvents();
    }

    protected async onOpen(_params?: IPopupOpenParams<void>): Promise<void> {
        this.contentNodes = [this.popupPanel];
        this.renderView();
    }

    private bindEvents(): void {
        this.closeBtn.node.on(Button.EventType.CLICK, () => this.close(PopupCloseReason.CloseButton), this);
    }

    private renderView(): void {
        const parts = roleRepository.equipParts();
        let minQuality = 7;
        for (const p of parts) {
            const q = p.entry?.rank ?? 0;
            if (q < minQuality) minQuality = q;
        }
        if (minQuality < 1) minQuality = 1;

        const currentTier = GONG_MING_TIERS.find(t => t.quality === minQuality) ?? GONG_MING_TIERS[0];
        const nextTier = GONG_MING_TIERS.find(t => t.quality === minQuality + 1) ?? currentTier;

        this.nowTitle.string = `穿戴6件${currentTier.name}品质装备`;
        this.nowAttr.string = `伤害加成 +${currentTier.addDamagePer}%`;
        this.nowMarker.active = true;

        this.nextTitle.string = `穿戴6件${nextTier.name}品质装备`;
        this.nextAttr.string = `伤害加成 +${nextTier.addDamagePer}%`;
        this.nextMarker.active = false;
    }
}
