import { _decorator, Button, Label, Node, Sprite } from 'cc';
import type { SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { TabButton } from '../common/TabButton';
import { FW } from '../../framework/FW';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RefUtil } from '../../framework/ref/RefUtil';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { loadRoleArt } from './RoleArtLoader';
import { loadMilitiaTalentIcon } from './RoleArtLoader';
import { militiaRepository } from './MilitiaRepository';
import { MilitiaTalentOverviewPage } from './MilitiaTalentOverviewPage';
import { ROLE_TEXTS } from './RoleTexts';
import { MilitiaTalentItem } from './MilitiaTalentItem';
import type { IMilitiaTalentCell, IMilitiaTalentDetail, IMilitiaTalentSnapshot, MilitiaTalentState } from './MilitiaTypes';

const { ccclass, property } = _decorator;

/**
 * 民兵「天赋」界面（`ui/Role/TabMilitiaTalent`，720×1280）。
 *
 * 老端三件套里的**天赋分页**（`TabMilitiaTalent`）：
 *   · 纵向虚拟列表 = `armyLevel[id=66014]` 的等级曲线（**等级降序**），打开时滚到「下一级」并居中；
 *   · 点一格 → 详情小弹窗（效果名 / 描述 / 两行消耗 / 激活按钮）；
 *   · 「激活」发 `CmdArmyLevelUpReqMsg { armyId }`，成功后整页重刷。
 *
 * ## 为什么「小弹窗」是一组节点而不是一个父节点
 *
 * FGUI 里它们是 advanced group `强化小弹窗`（`popBg` + 文本 + icon + `n52` group），
 * 靠 controller `显示小弹窗` 的「是 / 否」两页切换；生成器**不认 controller**，把这些节点
 * 摊平到了根下 ⇒ 这里用一个名字数组统一显隐，而不是去改 prefab 的层级（改层级要重算 lpos）。
 */
const INFO_NODE_NAMES = ['Popup', 'SkillName', 'NodeIcon', 'SkillDesc', 'Cost1', 'Cost2', 'BtnActivate'] as const;

/** 节点底图三态（FGUI `按钮_天赋项` 的「状态」controller 三页，生成器只烘了默认页）。 */
const STATE_ART: Readonly<Record<MilitiaTalentState, string>> = {
    locked: 'talentNodeBg',
    unlocked: 'talentNodeOn',
    current: 'talentNodeCurrent',
};

/** 金币图标（`armyLevel.costGoldCnt` 用的是 `roleProperty.gold`，它**不在 item 表**里 ⇒ 单独给图）。 */
const GOLD_ICON_PATH = 'icons/resource/图标_铜币';

@ccclass('MilitiaTalentPage')
export class MilitiaTalentPage extends PopupBase {
    static prefabPath = 'ui/Role/TabMilitiaTalent';

    @property({ type: Node, tooltip: 'List：天赋列表（其上挂 VirtualScrollView，gridCount=1）' })
    listNode: Node = null!;

    @property({ type: Node, tooltip: 'AttrBtn：天赋属性总览按钮（挂 cc.Button）' })
    attrButton: Node = null!;

    @property({ type: Node, tooltip: 'Mask：详情弹窗的遮罩（挂 cc.Button，点它关弹窗）' })
    maskButton: Node = null!;

    @property({ type: Node, tooltip: 'BtnActivate：激活按钮（挂 cc.Button）' })
    activateButton: Node = null!;

    // ---- 底部菜单层（`MenuBar`，老端 `组件_民兵_菜单层`）----

    /** `MenuBar/BtnBack`：返回（关整页）。老端 `LayerMiltiaMenuMenuUI.onReturnClick`。 */
    @property({ type: Node, tooltip: 'MenuBar/BtnBack：返回（挂 cc.Button）' })
    backButton: Node = null!;

    /**
     * `MenuBar/TabTalent`：「天赋」页签（复用 `ui/common/TabButton` ——
     * 老端 `按钮_首页_菜单` 的 `类型=23`，图标 `zjm_icon01_TianFu/TianFu02`）。
     */
    @property({ type: TabButton, tooltip: 'MenuBar/TabTalent：天赋页签（当前页，常驻选中）' })
    tabTalent: TabButton = null!;

    /**
     * `MenuBar/TabSkin`：「皮肤」页签（`类型=24`，图标 `zjm_icon01_PiFu/PiFu02`）。
     *
     * 老端是 `TabMilitiaSkin`（另一个 tab，由 `LayerMiltiaMain` 托管），**本工程还没迁**
     * ⇒ 页签照摆（还原原稿），点击给「没移植」提示，不留死按钮（规则 113 的同款口径）。
     */
    @property({ type: TabButton, tooltip: 'MenuBar/TabSkin：皮肤页签（未移植，点击给提示）' })
    tabSkin: TabButton = null!;

    /** 缓存：列表组件。 */
    private list: VirtualScrollView = null!;

    /** 当前列表数据（等级降序）。 */
    private cells: readonly IMilitiaTalentCell[] = [];

    /** iconKey → 天赋图标（缺图为 `null`，界面留白）。 */
    private readonly iconFrames = new Map<string, SpriteFrame | null>();

    /** 节点底图三态。 */
    private readonly stateFrames = new Map<MilitiaTalentState, SpriteFrame | null>();

    /** 金币图标（一次性）。 */
    private goldFrame: SpriteFrame | null = null;

    /** 当前详情（点开小弹窗时才有；`null` = 没开）。 */
    private detail: IMilitiaTalentDetail | null = null;

    /** 当前快照的红点（0/1，只给「下一级」那格）。 */
    private redDot = 0;

    /** 每趟刷新递增，丢弃过期的异步结果。 */
    private revision = 0;

    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.ensureInit();
        // 详情小弹窗在 prefab 里是**展开**的（生成器不认 FGUI 的 controller 页）⇒
        // 这里先收掉，否则打开的第一帧会闪一下弹窗（refresh 是异步的，来不及）。
        this.hideInfo();
    }

    protected onOpen(): void {
        this.ensureInit();
        void this.refresh();
    }

    protected onClose(): void {
        this.revision += 1;
        this.hideInfo();
    }

    /** 取组件 + 接回调（幂等：宿主可能初始非激活 ⇒ `onInit` 未必先跑，见规则 108）。 */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;

        this.list = this.listNode.getComponent(VirtualScrollView);
        this.list.renderItemFn = (node: Node, index: number) => this.renderItem(node, index);
        this.list.onItemClickFn = (_node: Node, index: number) => this.onItemClick(index);

        // CLICK 挂在**节点**上（Button 自身没有 on）。
        this.attrButton.getComponent(Button)!.node.on(Button.EventType.CLICK, this.onAttrClick, this);
        this.maskButton.getComponent(Button)!.node.on(Button.EventType.CLICK, this.hideInfo, this);
        this.activateButton.getComponent(Button)!.node.on(Button.EventType.CLICK, this.onActivateClick, this);
        this.backButton.getComponent(Button)!.node.on(Button.EventType.CLICK, this.closeByButton, this);
        // 页签：天赋 = 当前页（常驻选中、不接点击）；皮肤没迁 ⇒ 点它给提示。
        this.tabTalent.setSelected(true);
        this.tabSkin.setSelected(false);
        this.tabSkin.bindSelect(() => FW.showTip(ROLE_TEXTS.tabSkinMissing));
        this.node.getChildByName('Popup')!.getChildByName('CloseBtn')!
            .getComponent(Button)!.node.on(Button.EventType.CLICK, this.hideInfo, this);
    }

    // ============================================================
    // 刷新
    // ============================================================

    /** 读表 → 取快照 → 预加载图 → 铺列表 → 滚到「下一级」居中。 */
    private async refresh(): Promise<void> {
        const rev = (this.revision += 1);
        this.hideInfo();
        await militiaRepository.loadTables();
        if (!this.alive || rev !== this.revision) return;

        const snapshot: IMilitiaTalentSnapshot = militiaRepository.snapshot();
        this.cells = snapshot.cells;
        this.redDot = snapshot.redDot;

        // 图先 await 完再铺（renderItemFn 是同步的，边加载边写会闪上一格图）。
        await this.preloadArt();
        if (!this.alive || rev !== this.revision) return;

        // 菜单层页签红点：老端 `onRdChanged` 里天赋格取 `checkMilitiaCanLevelUp()`、
        // 皮肤格取 `hasArmySkinRD()` —— 本工程皮肤页没迁 ⇒ 恒 0（收起）。
        this.tabTalent.setRedDot(this.redDot);
        this.tabSkin.setRedDot(0);

        this.list.refreshList(this.cells.length);
        if (snapshot.focusIndex >= 0) {
            // 老端滚动到「下一级」并居中（虚拟列表要等一帧才实例化 ⇒ 交给组件内部排队）。
            this.list.scrollToIndex(snapshot.focusIndex, false, undefined, undefined, true);
        }
    }

    /** 预加载：天赋图标去重 + 节点三态底图 + 金币图。 */
    private async preloadArt(): Promise<void> {
        const keys = Array.from(new Set(this.cells.map((c) => c.iconKey).filter((k) => k !== '')));
        await Promise.all(keys.map(async (key) => {
            this.iconFrames.set(key, await loadMilitiaTalentIcon(key));
        }));
        for (const [state, art] of Object.entries(STATE_ART)) {
            this.stateFrames.set(state as MilitiaTalentState, await loadRoleArt(art));
        }
        this.goldFrame = await loadItemIconArt(GOLD_ICON_PATH);
    }

    /** 铺一格。 */
    private renderItem(node: Node, index: number): void {
        const item = node.getComponent(MilitiaTalentItem);
        const cell = this.cells[index];
        if (!item || !cell) return;
        item.render(
            cell,
            this.stateFrames.get(cell.state) ?? null,
            cell.iconKey ? (this.iconFrames.get(cell.iconKey) ?? null) : null,
            // 红点只给「下一级」，且只在材料够时亮（老端 `rd.OnRDUpdate(isNext ? canLevelUp : 0)`）。
            cell.isNext ? this.redDot : 0,
        );
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 点一格 → 详情小弹窗。 */
    private onItemClick(index: number): void {
        const cell = this.cells[index];
        if (!cell) return;
        const detail = militiaRepository.detailOf(cell.level);
        if (!detail) return;
        void this.showInfo(detail);
    }

    /** 属性总览（老端 `LayerMiltiaAllAttr`：另开一个弹窗）。 */
    private onAttrClick(): void {
        void MilitiaTalentOverviewPage.open();
    }

    /** 「激活」：只认「下一级」+ 材料够（与老端 `onUpClick` 同一口径）。 */
    private async onActivateClick(): Promise<void> {
        const detail = this.detail;
        if (!detail) return;
        if (!detail.activatable) {
            FW.showTip(ROLE_TEXTS.talentNotNext);
            return;
        }
        if (!detail.canAfford) {
            FW.showTip(ROLE_TEXTS.talentLack);
            return;
        }
        const result = await militiaRepository.requestLevelUp();
        if (!this.alive) return;
        if (result === 'offline') {
            FW.showTip(ROLE_TEXTS.offline);
            return;
        }
        if (result === 'failed') {
            FW.showTip(ROLE_TEXTS.failed);
            return;
        }
        FW.showTip(ROLE_TEXTS.talentUpOk);
        this.hideInfo();
        await this.refresh();
    }

    // ============================================================
    // 详情小弹窗
    // ============================================================

    /** 打开详情（老端 `showSkillEffect`）。 */
    private async showInfo(detail: IMilitiaTalentDetail): Promise<void> {
        const rev = this.revision;
        this.detail = detail;

        this.setInfoVisible(true);
        this.node.getChildByName('SkillName')!.getComponent(Label)!.string = detail.effectName;
        this.node.getChildByName('SkillDesc')!.getComponent(Label)!.string = detail.effectDesc;

        // 图标：详情的 key 可能不在列表预加载的集合里（点的是未解锁的高等级）⇒ 现加载。
        const icon = this.iconFrames.get(detail.iconKey) ?? await loadMilitiaTalentIcon(detail.iconKey);
        if (!this.alive || rev !== this.revision) return;
        this.node.getChildByName('NodeIcon')!.getChildByName('Icon')!.getComponent(Sprite)!.spriteFrame = icon;

        this.renderCost('Cost1', this.goldFrame, detail.goldOwned, detail.goldNeed);
        const itemFrame = await this.loadCostItemIcon(detail.itemId);
        if (!this.alive || rev !== this.revision) return;
        this.renderCost('Cost2', itemFrame, detail.itemOwned, detail.itemNeed);

        // 「激活」只在点的是「下一级」时出现（老端 `激活项` 页）。
        this.activateButton.active = detail.activatable;
    }

    /** 关掉详情（老端 `closeInfo`）。 */
    private hideInfo(): void {
        this.detail = null;
        this.setInfoVisible(false);
    }

    /** 一组节点统一显隐（见文件头「为什么是一组节点」）。 */
    private setInfoVisible(visible: boolean): void {
        for (const name of INFO_NODE_NAMES) {
            const node = this.node.getChildByName(name);
            if (node) node.active = visible;
        }
        // 遮罩压在小弹窗下面、列表上面 —— 只在弹窗开着时收点击。
        this.maskButton.active = visible;
        if (!visible) this.activateButton.active = false;
    }

    /** 一行消耗：图标 + 「持有/需要」（`HasText` / `NeedText`）。 */
    private renderCost(nodeName: string, frame: SpriteFrame | null, owned: number, need: number): void {
        const box = this.node.getChildByName(nodeName)!;
        box.getChildByName('CostIcon')!.getComponent(Sprite)!.spriteFrame = frame;
        box.getChildByName('HasText')!.getComponent(Label)!.string = String(owned);
        box.getChildByName('NeedText')!.getComponent(Label)!.string = `/${need}`;
    }

    /** 消耗道具的图标（`item.icon` 的 resources 相对路径）。 */
    private async loadCostItemIcon(itemId: number): Promise<SpriteFrame | null> {
        const rows = await this.itemRowOf(itemId);
        return rows ? loadItemIconArt(String(rows.icon ?? '')) : null;
    }

    /** 取一行 item（走 `RefUtil`，与背包同一张表）。 */
    private async itemRowOf(itemId: number): Promise<{ icon?: string } | null> {
        const row = await RefUtil.instance.getRefAsync('item', 'resId', itemId);
        return (row as { icon?: string } | null) ?? null;
    }

    /** 组件所在节点是否仍然有效（弹窗随时可能被关，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
