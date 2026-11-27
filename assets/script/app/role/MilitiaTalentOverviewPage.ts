import { _decorator, Button } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { militiaRepository } from './MilitiaRepository';
import { MilitiaAttrItem } from './MilitiaAttrItem';
import { ROLE_TEXTS } from './RoleTexts';

const { ccclass, property } = _decorator;

/**
 * 「民兵天赋总览」弹窗（`ui/Role/MilitiaTalentOverview`，老端 `LayerMiltiaAllAttr`）。
 *
 * 两个列表：
 *   · `AttrList` —— 已解锁天赋的**属性聚合**（`民兵暴击率+0.1%` 这种，来自 `skillAttrModifier.modify`）；
 *   · `List`     —— 已解锁天赋的**描述**（`armyLevel.modifyDesc`，一行一条）。
 *
 * 取数区间 = `1 .. 当前等级`（含当前级），与老端两个 `updataXxx` 完全同一口径。
 */
@ccclass('MilitiaTalentOverviewPage')
export class MilitiaTalentOverviewPage extends PopupBase {
    static prefabPath = 'ui/Role/MilitiaTalentOverview';

    @property({ type: VirtualScrollView, tooltip: '属性聚合列表' })
    private attrList: VirtualScrollView = null!;

    @property({ type: VirtualScrollView, tooltip: '已解锁描述列表' })
    private descList: VirtualScrollView = null!;

    @property({ type: Button, tooltip: '右上角关闭按钮' })
    private closeButton: Button = null!;

    /** 当前数据（铺格时按 index 现取）。 */
    private attrs: string[] = [];
    private descs: string[] = [];

    protected onInit(): void {
        this.attrList.renderItemFn = (node, index) => node.getComponent(MilitiaAttrItem).render(this.attrs[index]);
        this.descList.renderItemFn = (node, index) => node.getComponent(MilitiaAttrItem).render(this.descs[index]);
        this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    protected onOpen(): void {
        void this.refresh();
    }

    /** 读表 → 聚合 → 铺两个列表。 */
    private async refresh(): Promise<void> {
        const context = this.popupOpenContext;
        await militiaRepository.loadTables();
        if (!this.isValid || !context || context.cancelled) return;

        const { attrs, descs } = militiaRepository.overview();
        this.attrs = attrs.length || descs.length ? attrs : [ROLE_TEXTS.talentEmpty];
        this.descs = descs;
        this.attrList.setTotalCount(this.attrs.length);
        this.descList.setTotalCount(this.descs.length);
        this.attrList.scrollToTop(false);
        this.descList.scrollToTop(false);
    }
}
