import { _decorator, Button, Node } from 'cc';
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

    @property({ type: Node, tooltip: 'AttrList：属性聚合列表（其上挂 VirtualScrollView，gridCount=1）' })
    attrListNode: Node = null!;

    @property({ type: Node, tooltip: 'List：已解锁描述列表（其上挂 VirtualScrollView，gridCount=1）' })
    descListNode: Node = null!;

    @property({ type: Node, tooltip: 'Popup/CloseBtn：右上角关闭（挂 cc.Button）' })
    closeButton: Node = null!;

    /** 缓存：两个列表组件。 */
    private attrList: VirtualScrollView = null!;
    private descList: VirtualScrollView = null!;

    /** 当前数据（铺格时按 index 现取）。 */
    private attrs: string[] = [];
    private descs: string[] = [];

    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    protected onInit(): void {
        this.ensureInit();
    }

    protected onOpen(): void {
        this.ensureInit();
        void this.refresh();
    }

    /** 取组件 + 接回调（幂等：宿主可能初始非激活 ⇒ `onInit` 未必先跑，见规则 108）。 */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;

        this.attrList = this.attrListNode.getComponent(VirtualScrollView);
        this.descList = this.descListNode.getComponent(VirtualScrollView);
        this.attrList.renderItemFn = (node: Node, index: number) => this.renderAttr(node, index);
        this.descList.renderItemFn = (node: Node, index: number) => this.renderDesc(node, index);

        this.closeButton.getComponent(Button)!.node.on(Button.EventType.CLICK, this.closeByButton, this);
    }

    /** 读表 → 聚合 → 铺两个列表。 */
    private async refresh(): Promise<void> {
        await militiaRepository.loadTables();
        if (!this.alive) return;

        const overview = militiaRepository.overview();
        this.attrs = overview.attrs;
        this.descs = overview.descs;
        this.attrList.refreshList(this.attrs.length);
        this.descList.refreshList(this.descs.length);
        this.attrList.scrollToTop(false);
        this.descList.scrollToTop(false);

        // 一格数据都没有：明说「还没解锁」，不留两个空列表（界面看着像坏了）。
        if (!this.attrs.length && !this.descs.length) {
            this.attrList.refreshList(1);
            this.attrs = [ROLE_TEXTS.talentEmpty];
        }
    }

    private renderAttr(node: Node, index: number): void {
        const item = node.getComponent(MilitiaAttrItem);
        const text = this.attrs[index];
        if (!item || text === undefined) return;
        item.render(text);
    }

    private renderDesc(node: Node, index: number): void {
        const item = node.getComponent(MilitiaAttrItem);
        const text = this.descs[index];
        if (!item || text === undefined) return;
        item.render(text);
    }

    /** 组件所在节点是否仍然有效（弹窗随时可能被关，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
