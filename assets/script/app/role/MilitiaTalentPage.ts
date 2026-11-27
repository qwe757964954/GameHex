import { _decorator, Button, Label, Node, Sprite } from 'cc';
import type { SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { TabButton } from '../common/TabButton';
import { FW } from '../../framework/FW';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { RefUtil } from '../../framework/ref/RefUtil';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import { loadMilitiaTalentIcon, loadRoleArt } from './RoleArtLoader';
import { militiaRepository } from './MilitiaRepository';
import { MilitiaTalentOverviewPage } from './MilitiaTalentOverviewPage';
import { ROLE_TEXTS } from './RoleTexts';
import { MilitiaTalentItem } from './MilitiaTalentItem';
import { MilitiaTalentCostItem } from './MilitiaTalentCostItem';
import type { IMilitiaTalentCell, IMilitiaTalentDetail, IMilitiaTalentSnapshot, MilitiaTalentState } from './MilitiaTypes';

import { ITEM_TABLE } from '../../core/config/TableNames';
const { ccclass, property } = _decorator;

/**
 * 民兵「天赋」界面（`ui/Role/TabMilitiaTalent`，720×1280）。
 *
 * 老端三件套里的**天赋分页**（`TabMilitiaTalent`）：
 *   · 纵向虚拟列表 = `armyLevel[id=66014]` 的等级曲线（**等级降序**），打开时滚到「下一级」并居中；
 *   · 点一格 → 详情小弹窗（效果名 / 描述 / 两行消耗 / 激活按钮）；
 *   · 「激活」发 `CmdArmyLevelUpReqMsg { armyId }`，成功后整页重刷。
 */
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

    @property({ type: VirtualScrollView, tooltip: '天赋列表' })
    private list: VirtualScrollView = null!;

    @property({ type: Button, tooltip: '天赋属性总览按钮' })
    private attrButton: Button = null!;

    @property({ type: Button, tooltip: '详情弹窗遮罩按钮' })
    private maskButton: Button = null!;

    @property({ type: Button, tooltip: '激活按钮' })
    private activateButton: Button = null!;

    @property({ type: Button, tooltip: '关闭详情按钮' })
    private infoCloseButton: Button = null!;

    @property({ type: [Node], tooltip: '随详情一起显隐的节点' })
    private infoNodes: Node[] = [];

    @property({ type: Label, tooltip: '天赋详情名称' })
    private skillName: Label = null!;

    @property({ type: Label, tooltip: '天赋详情描述' })
    private skillDesc: Label = null!;

    @property({ type: Sprite, tooltip: '天赋详情图标' })
    private skillIcon: Sprite = null!;

    @property({ type: MilitiaTalentCostItem, tooltip: '金币消耗行' })
    private goldCost: MilitiaTalentCostItem = null!;

    @property({ type: MilitiaTalentCostItem, tooltip: '道具消耗行' })
    private itemCost: MilitiaTalentCostItem = null!;

    // ---- 底部菜单层（`MenuBar`，老端 `组件_民兵_菜单层`）----

    /** `MenuBar/BtnBack`：返回（关整页）。老端 `LayerMiltiaMenuMenuUI.onReturnClick`。 */
    @property({ type: Button, tooltip: 'MenuBar/BtnBack：返回' })
    private backButton: Button = null!;

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
    private isActivating = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.list.renderItemFn = (node, index) => this.renderItem(node, index);
        this.list.onItemClickFn = (_node, index) => this.onItemClick(index);
        this.attrButton.node.on(Button.EventType.CLICK, this.onAttrClick, this);
        this.maskButton.node.on(Button.EventType.CLICK, this.hideInfo, this);
        this.activateButton.node.on(Button.EventType.CLICK, this.onActivateClick, this);
        this.backButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
        this.infoCloseButton.node.on(Button.EventType.CLICK, this.hideInfo, this);
        this.tabTalent.setSelected(true);
        this.tabSkin.setSelected(false);
        this.tabSkin.bindSelect(() => FW.showTip(ROLE_TEXTS.tabSkinMissing));
        this.hideInfo();
    }

    protected onOpen(): void {
        this.isActivating = false;
        this.activateButton.interactable = true;
        void this.refresh();
    }

    protected onClose(): void {
        this.hideInfo();
    }

    // ============================================================
    // 刷新
    // ============================================================

    /** 读表 → 取快照 → 预加载图 → 铺列表 → 滚到「下一级」居中。 */
    private async refresh(): Promise<void> {
        const context = this.popupOpenContext;
        if (!context) return;
        const rev = ++this.revision;
        this.hideInfo();
        await militiaRepository.loadTables();
        if (!this.isValid || context.cancelled || rev !== this.revision) return;

        const snapshot: IMilitiaTalentSnapshot = militiaRepository.snapshot();

        // 图先 await 完再铺（renderItemFn 是同步的，边加载边写会闪上一格图）。
        await this.preloadArt(snapshot.cells);
        if (!this.isValid || context.cancelled || rev !== this.revision) return;
        this.cells = snapshot.cells;
        this.redDot = snapshot.redDot;

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
    private async preloadArt(cells: readonly IMilitiaTalentCell[]): Promise<void> {
        const keys = Array.from(new Set(cells.map((c) => c.iconKey).filter((k) => k !== '')));
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
        const context = this.popupOpenContext;
        if (!detail || !context || this.isActivating) return;
        if (!detail.activatable) {
            FW.showTip(ROLE_TEXTS.talentNotNext);
            return;
        }
        if (!detail.canAfford) {
            FW.showTip(ROLE_TEXTS.talentLack);
            return;
        }
        const button = this.activateButton;
        this.isActivating = true;
        button.interactable = false;
        try {
            const result = await militiaRepository.requestLevelUp(this);
            if (!this.isValid || context.cancelled) return;
            if (result !== 'ok') {
                FW.showTip(result === 'offline' ? ROLE_TEXTS.offline : ROLE_TEXTS.failed);
                return;
            }
            FW.showTip(ROLE_TEXTS.talentUpOk);
            await this.refresh();
        } finally {
            if (this.isValid && !context.cancelled) {
                this.isActivating = false;
                button.interactable = true;
            }
        }
    }

    // ============================================================
    // 详情小弹窗
    // ============================================================

    /** 打开详情（老端 `showSkillEffect`）。 */
    private async showInfo(detail: IMilitiaTalentDetail): Promise<void> {
        const context = this.popupOpenContext;
        if (!context) return;
        this.detail = detail;

        this.skillName.string = detail.effectName;
        this.skillDesc.string = detail.effectDesc;
        const cachedIcon = this.iconFrames.get(detail.iconKey) ?? null;
        this.skillIcon.spriteFrame = cachedIcon;
        this.goldCost.render(this.goldFrame, detail.goldOwned, detail.goldNeed);
        this.itemCost.render(null, detail.itemOwned, detail.itemNeed);
        this.renderInfoVisibility();

        const [icon, itemFrame] = await Promise.all([
            cachedIcon ?? loadMilitiaTalentIcon(detail.iconKey),
            this.loadCostItemIcon(detail.itemId),
        ]);
        if (!this.isValid || context.cancelled || this.detail !== detail) return;
        this.skillIcon.spriteFrame = icon;
        this.itemCost.render(itemFrame, detail.itemOwned, detail.itemNeed);
    }

    /** 关掉详情（老端 `closeInfo`）。 */
    private hideInfo(): void {
        this.detail = null;
        this.renderInfoVisibility();
    }

    private renderInfoVisibility(): void {
        const visible = this.detail !== null;
        for (const node of this.infoNodes) node.active = visible;
        this.maskButton.node.active = visible;
        this.activateButton.node.active = this.detail?.activatable === true;
    }

    /** 消耗道具的图标（`item.icon` 的 resources 相对路径）。 */
    private async loadCostItemIcon(itemId: number): Promise<SpriteFrame | null> {
        const row = await RefUtil.instance.getRefAsync(ITEM_TABLE, 'resId', itemId) as { icon?: string } | null;
        return row ? loadItemIconArt(String(row.icon ?? '')) : null;
    }
}
