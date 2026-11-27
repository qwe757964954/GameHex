import { _decorator, Button, Component, Label, Node, sp, UITransform } from 'cc';
import { roleRepository } from './RoleRepository';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { RoleEvent } from './RoleEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import type { IRoleDecomposeResult, IRoleSnapshot } from './RoleTypes';
import { RedDot } from '../common/RedDot';
import { CmdRedDotType } from '../generated/netProto/CmdInterface';
import { readServerRedDot } from '../rd/RdServerVar';
import type { RoleBagTabId } from './RoleTypes';
import { RoleBagPanel } from './RoleBagPanel';
import { EquipDecomposePopup } from './EquipDecomposePopup';
import { RoleBagTabGroup } from './RoleBagTabGroup';
import { RoleEquipSlot } from './RoleEquipSlot';
import { RoleNavItem } from './RoleNavItem';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import { ROLE_TEXTS } from './RoleTexts';
import { formatPowerText } from '../card/CardLineupPower';

const { ccclass, property } = _decorator;

/**
 * 主角待机动画名。骨架实例由 prefab 直绑到 {@link RolePage.heroSkeleton}（不再下钻 `HeroIcon/主角铁拳`），
 * 但首播仍可能早于嵌套实例的 `onLoad` ⇒ `playHeroIdle` 在未就绪时延后一帧重试一次。
 */
const ROLE_HERO_IDLE = 'idle';

/** 低等级攻击力提示。文案来自 prefab，定时切换显隐，页面离开时停止计时。 */
const QIPAO_MAX_LEVEL = 5;
const QIPAO_INTERVAL_MS = 5000;

/**
 * 主界面角色页，由 `MainTabHost` 挂载，切走时销毁。
 *
 * 职责边界：页面只做**组合**（把快照分发给各子组件、按意图出口切顶部功能行）；
 * 每个可点区域由自己的组件负责 —— 页签 `RoleBagTabItem`（选中态 + 红点 + 点击，由
 * `RoleBagTabGroup` 统一收口选中态）、导航 `RoleNavItem`（点击）、装备格 `RoleEquipSlot`
 * （图标 / 等级 / 红点 / 点击）。
 * 页面里不再按节点名查节点，也不再给已绑引用判空：绑错应当在 `onLoad` 当场抛。
 */
@ccclass('RolePage')
export class RolePage extends Component {
    static prefabPath = 'ui/Role/Role';

    // 引用一律按【实际形态】声明：组件绑组件（RoleBagPanel / Label / sp.Skeleton / 各 item），
    // 按钮绑【节点】（cc.Button 的 CLICK 由节点派发）。不再用 `getComponent` 现取，也不再判空。
    @property({ type: RoleBagPanel, tooltip: 'BagPanel：背包列表面板（RoleBagPanel）' })
    bagPanelComp: RoleBagPanel = null!;

    @property({ type: Label, tooltip: 'PowerValue：战斗力数值（Label）' })
    powerLabel: Label = null!;

    @property({ type: sp.Skeleton, tooltip: 'HeroIcon/主角铁拳/spine：主角待机骨架' })
    heroSkeleton: sp.Skeleton = null!;

    @property({ type: Node, tooltip: 'Qipao：低等级攻击力气泡（定时显隐）' })
    qipao: Node = null!;

    // 顶部功能行（applyBagChrome）：按钮按实际形态声明 —— 按钮绑【节点】（cc.Button 的
    // CLICK 由节点派发），文案绑 Label 【组件】。运行时不再按名字取节点，也不判空：
    // 绑错应当在 onLoad 当场抛出来，判空只会把它变成静默死按钮。
    @property({ type: Node, tooltip: 'BagBtnGem：宝石背包 / 装备分解入口（其上挂 cc.Button）' })
    gemEntry: Node = null!;

    @property({ type: Label, tooltip: 'BagBtnGem/title：入口文案' })
    gemEntryTitle: Label = null!;

    @property({ type: Node, tooltip: 'BagBtnCompose：一键合成 / 品质筛选（其上挂 cc.Button）' })
    composeBtn: Node = null!;

    @property({ type: Label, tooltip: 'BagBtnCompose/title：按钮文案' })
    composeTitle: Label = null!;

    @property({ type: Node, tooltip: 'BagBtnAll：部位筛选 / 全选（其上挂 cc.Button）' })
    filterBtn: Node = null!;

    @property({ type: Label, tooltip: 'BagBtnAll/title：按钮文案' })
    filterTitle: Label = null!;

    /** 一键合成按钮的角标（`BagBtnCompose/com_rd`）：老端 `TabGem` 就挂在这里，监听 `RDGemCompose`。 */
    @property({ type: RedDot, tooltip: 'BagBtnCompose/com_rd：一键合成角标（分解模式里必须归零）' })
    composeBtnRedDot: RedDot = null!;

    /** 当前选中的背包页签（null = 未选中）。 */
    private activeTab: RoleBagTabId | null = null;

    /** 背包页签组：选中态与页签红点都由它收口，页面只报「当前 tab」。 */
    @property({ type: RoleBagTabGroup, tooltip: 'TabGroup：背包页签组（三个 RoleBagTabItem 挂在它下面）' })
    tabGroup: RoleBagTabGroup = null!;

    /** 左侧导航（7 个，各自带 `navId` 并自己派发点击）。 */
    @property({ type: [RoleNavItem], tooltip: '左侧导航：NavHero … NavLeaderSkill' })
    navItems: RoleNavItem[] = [];

    /** 装备栏 6 格（下标 = 部位号 − 1，顺序与 `RoleEquipRedDotTable` 一致）。 */
    @property({ type: [RoleEquipSlot], tooltip: '装备栏 6 格：Equip1 … Equip6（顺序即部位号）' })
    equipSlots: RoleEquipSlot[] = [];

    @property({ type: Node, tooltip: 'ForgeBtn：锻造入口（其上挂 cc.Button）' })
    forgeBtn: Node = null!;

    @property({ type: RedDot, tooltip: 'ForgeBtn/com_rd：锻造入口红点（口径同装备页签）' })
    forgeBtnRedDot: RedDot = null!;

    /** 每趟 `onEnable` 递增，丢弃过期的异步结果（切走时页面可能已被销毁）。 */
    private revision = 0;

    /** 顶部宝石功能行的占位高度（隐藏后列表区上探这段距离，取自 prefab 节点高度）。 */
    private gemHeaderHeight = 0;

    /** 气泡闪烁定时器（嵌套 setTimeout 句柄；`null` = 没在闪）。 */
    private qipaoTimer: ReturnType<typeof setTimeout> | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        // 顶部功能行 + 锻造入口：节点由 prefab 绑好，四个入口的差异只在回调里。
        // 页签 / 导航 / 装备格的点击由各自组件负责（见类注释），页面不再遍历节点绑事件。
        this.gemEntry.on(Button.EventType.CLICK, this.onGemEntry);
        this.composeBtn.on(Button.EventType.CLICK, this.onCompose);
        this.filterBtn.on(Button.EventType.CLICK, this.onFilter);
        this.forgeBtn.on(Button.EventType.CLICK, this.onForge);
        EventMgr.instance.on(RoleEvent.DecomposeModeChanged, this.applyBagChrome, this);
        this.gemHeaderHeight = this.gemEntry.getComponent(UITransform).height;

        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'ready' }, this);
    }

    /** 顶部左侧入口：宝石页签 ›「宝石背包」；装备页签 ›「装备分解」；分解模式 ›「阶数筛选」。 */
    private onGemEntry = (): void => {
        if (this.bagPanelComp.isDecomposing) {
            void this.bagPanelComp.cycleDecomposeRank();
            return;
        }
        if (this.activeTab === 2) {
            void EquipDecomposePopup.open({});
            return;
        }
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 1 });
    };

    /** 一键合成；分解模式里同一节点改作「品质筛选」。 */
    private onCompose = (): void => {
        if (this.bagPanelComp.isDecomposing) {
            void this.bagPanelComp.cycleDecomposeQuality();
            return;
        }
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'compose' });
    };

    /** 宝石部位筛选；分解模式里同一节点改作「全选」。 */
    private onFilter = (): void => {
        if (this.bagPanelComp.isDecomposing) {
            this.bagPanelComp.selectAllDecompose();
            return;
        }
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'gemFilter' });
    };

    private onForge = (): void => {
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'forge' });
    };

    /** 每次激活时通知组合层刷新角色数据。 */
    protected onEnable(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, this);
    }

    /**
     * 选中指定背包页签：更新底部按钮高亮，并联动顶部三个功能按钮的显隐 / 文案。
     *
     * 装备页签常驻一个「装备分解」入口（复用 `BagBtnGem` 的位置）；
     * 进入分解模式后同一行三个按钮变成「阶数 ≤N / 品质 ≤X / 全选」。
     */
    selectBag(tab: RoleBagTabId): void {
        if (tab !== 2 && this.bagPanelComp.isDecomposing) this.bagPanelComp.exitDecompose(false);
        this.activeTab = tab;
        this.tabGroup.select(tab);
        this.applyBagChrome();
    }

    showBag(tab: RoleBagTabId, gemEquipId = 0, gemFilterName = '全部'): Promise<void> {
        if (!this.bagPanelComp.isDecomposing) this.filterTitle.string = gemFilterName;
        return this.bagPanelComp.show(tab, gemEquipId);
    }

    /** 顶部功能行的唯一显隐 / 文案出口（普通页签与分解模式共用）。 */
    private applyBagChrome(): void {
        if (this.bagPanelComp.isDecomposing) {
            // 分解模式：三个按钮全部保留，改成筛选 / 全选。
            this.gemEntry.active = true;
            this.composeBtn.active = true;
            this.filterBtn.active = true;
            this.gemEntryTitle.string = ROLE_TEXTS.decomposeRank(this.bagPanelComp.decomposeRankFilter);
            this.composeTitle.string = ROLE_TEXTS.decomposeQuality(this.bagPanelComp.decomposeQualityFilter);
            this.filterTitle.string = ROLE_TEXTS.decomposeSelectAll;
            this.bagPanelComp.setTopExtra(0);
            this.updateComposeRedDot();
            return;
        }

        const tab = this.activeTab;
        const isGem = tab === 1;
        const isEquip = tab === 2;
        this.gemEntry.active = isGem || isEquip;
        this.composeBtn.active = isGem;
        this.filterBtn.active = isGem;
        if (isGem) {
            this.gemEntryTitle.string = ROLE_TEXTS.gemBagEntry;
            this.composeTitle.string = ROLE_TEXTS.gemCompose;
            this.filterTitle.string = ROLE_TEXTS.gemFilterAll;
        } else if (isEquip) {
            this.gemEntryTitle.string = ROLE_TEXTS.decomposeEntry;
        }
        // 装备页签也要保留顶部这一行（分解入口在这里），只有道具页签整体上探。
        this.bagPanelComp.setTopExtra(tab === 3 ? this.gemHeaderHeight : 0);
        this.updateComposeRedDot();
    }

    /**
     * 一键合成角标唯一的显隐出口：只在「宝石页签 + 非分解模式」显示。
     *
     * ⚠️ 分解模式会把同一节点 `BagBtnCompose` 复用成「品质筛选」，
     * 这里不归零就会把宝石合成的红点带到装备分解里。
     */
    private updateComposeRedDot(value = readServerRedDot(CmdRedDotType.GEM_COMPOSE)): void {
        const visible = this.activeTab === 1 && !this.bagPanelComp.isDecomposing;
        this.composeBtnRedDot.setRedDot(visible ? value : 0);
    }

    /** 分解回包（Composition 调用）：交给面板收口，奖励弹窗由 Composition 先弹。 */
    finishDecompose(result: IRoleDecomposeResult): Promise<void> {
        if (!this.isValid) return Promise.resolve();
        return this.bagPanelComp.finishDecompose(result);
    }

    /**
     * 页面是否还活着（替代弹窗时代的 `isPopupOpen` 守卫）。
     *
     * ⚠️ 必须**先判 `this.isValid`**：组件销毁时引擎的 `_destruct()`（`compileDestruct`）
     * 会把所有对象型自有属性清成 `null`，`_node` 就在其中 ⇒ 销毁后再写 `this.node.isValid`
     * 直接抛 `Cannot read properties of null (reading 'isValid')`。`isValid` 读的是
     * `_objFlags`（数字，不被清理），销毁后恒 `false`，正好短路掉后面的节点判断。
     * ⇒ 所有 `await` 之后的存活判断都走这里，不要再单独写 `this.node.isValid`。
     */
    private get alive(): boolean {
        return this.isValid && this.node.activeInHierarchy;
    }

    /** 刷数据：战斗力（卡牌阵容战力）/ 主角 idle / 装备栏 / 背包列表 / 红点。 */
    async renderSnapshot(snapshot: IRoleSnapshot): Promise<void> {
        const rev = ++this.revision;

        // 战斗力与卡牌页同源同式：`CardLineupPower.formatPowerText` 负责万位缩写；
        // 0 也照写 "0"（规则 82），留白会被误读成"压根没接"。
        this.powerLabel.string = formatPowerText(snapshot.power);

        // 主角立绘：每次进页面从头播 idle（spine 的 `setAnimation` 会让轨道重新计时）。
        this.playHeroIdle();

        // 老端结构（`TabRoleMain`）：进页面下半屏**直接铺列表**，默认停在「宝石」页签，
        // 不是「点页签才弹出一个覆盖式面板」（那样进来时下半屏是空白的）。
        await this.presentEquips(rev);
        if (!this.alive || rev !== this.revision) return;

        // 宝石页签红点 = 服务端 `CmdRedDotType.GEM_COMPOSE`（「有宝石可合成」）。
        // 一键合成按钮的角标与页签同源；老端 `TabGem` 也是把 `按钮_一键合成.com_rd`
        // 挂到 `RDGemCompose`（同一个服务端红点）—— 这里恢复对老端的对齐。
        // 装备相关红点（装备页签 / 锻造入口 / 6 格装备）与锻造弹窗共用 `roleRepository.equipRedDots()`；
        // 其余导航（武将 / 天赋 / 近卫…）的客户端表达式变量在新端仍为桩，红点保持不亮。
        const gemComposeRedDot = readServerRedDot(CmdRedDotType.GEM_COMPOSE);
        this.tabGroup.item(1).setRedDot(gemComposeRedDot);
        this.updateComposeRedDot(gemComposeRedDot);
        this.refreshEquipRedDots(rev).catch(error => console.warn('[RolePage] 装备红点刷新失败', error));

        this.showQipao();
    }

    /**
     * 播主角待机。
     *
     * `setAnimation` 返回 `null` = 骨架还没走完 `onLoad`（与 `ZCUnitView.playClip` 同一条
     * 自愈路径）。首次进页面时 RolePage 的 `onLoad` 可能早于嵌套实例的 `sp.Skeleton.onLoad`
     * ⇒ 补一帧重试**一次**。不无限重试：真配错（动画名不存在）时宁可停在 setup pose，
     * 也不要给已切走的页面留一串定时器。
     */
    private playHeroIdle(retry = 1): void {
        if (this.heroSkeleton.setAnimation(0, ROLE_HERO_IDLE, true)) return;
        if (retry <= 0) return;
        this.scheduleOnce(() => this.playHeroIdle(retry - 1), 0);
    }

    /** 子节点可能早于本组件销毁。气泡显隐在 `onDisable` 处理，此处只解除定时器和监听，避免异常中断引擎的延迟销毁。 */
    protected onDestroy(): void {
        this.clearQipaoTimer();
        EventMgr.instance.off(RoleEvent.DecomposeModeChanged, this.applyBagChrome, this);
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, this);
    }

    protected onDisable(): void {
        // 切 tab / 关页面：把面板收掉、红点归零（`RedDot` 复用不留残影）。
        // 引用全是 prefab 绑的（数组默认 `[]`），onDisable 又跑在 `_destruct` 之前 ⇒ 这里不判空。
        this.revision += 1;
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'disabled' }, this);
        this.bagPanelComp.hide();
        this.activeTab = null;
        this.composeBtnRedDot.setRedDot(0);
        this.forgeBtnRedDot.setRedDot(0);
        this.tabGroup.clearRedDots();
        for (const slot of this.equipSlots) slot.setRedDot(0);
        this.stopQipao();
    }

    // ============================================================
    // 内部
    // ============================================================

    /**
     * 装备红点：页签 / 锻造入口取整页汇总，6 格取各自部位。
     *
     * ⚠️ 结果回来时页面可能已切走（`revision` 变了或被销毁），必须 `alive` + revision 双重校验。
     */
    private async refreshEquipRedDots(revision: number): Promise<void> {
        const dots = await roleRepository.equipRedDots();
        if (!this.alive || revision !== this.revision) return;
        this.tabGroup.item(2).setRedDot(dots.any);
        this.forgeBtnRedDot.setRedDot(dots.any);
        for (let index = 0; index < this.equipSlots.length; index += 1) {
            this.equipSlots[index].setRedDot(dots.parts[index].any);
        }
    }

    /**
     * 装备栏 6 格：图标 + 品质框 + `Lv.x`。
     *
     * ⚠️ 图 / 框**先 `await` 完再写**（与背包列表同一口径）：`render` 是同步的，
     * 边加载边写会先闪一格旧图。
     * ⚠️ 空位（`entry === null`）**不隐藏格子** —— 老端也是恒在，只把图 / 框 / 文字清掉。
     */
    private async presentEquips(revision: number): Promise<void> {
        const slots = await Promise.all(roleRepository.equipParts().map(async data => {
            const entry = data.entry;
            if (!entry) return { data, icon: null, frame: null, gems: [] };
            const [icon, frame, gems] = await Promise.all([
                loadRoleBagIcon(entry),
                loadRoleQualityFrame(entry.quality),
                Promise.all(data.sockets.map(socket => {
                    const gem = roleRepository.findGem(socket.gemId);
                    return gem ? loadRoleBagIcon(gem) : null;
                })),
            ]);
            return { data, icon, frame, gems };
        }));
        if (!this.alive || revision !== this.revision) return;
        slots.forEach(({ data, icon, frame, gems }, index) => {
            this.equipSlots[index].render(frame, icon, data.level, data.entry !== null);
            this.equipSlots[index].renderGems(gems);
        });
    }

    /**
     * 「前期建议优先提升攻击力」气泡：等级 ≥ 5 永不显示，否则亮 {@link QIPAO_INTERVAL_MS}
     * → 灭同样时长 → 循环（口径照抄老端 `TabRoleMain.showQiPao`，含「先灭一次再判等级」）。
     */
    private showQipao(): void {
        this.stopQipao();
        // 等级够高就永不显示（先收掉再判，与老端一致）。
        if (roleRepository.roleLevel() >= QIPAO_MAX_LEVEL) return;
        this.qipao.active = true;
        this.qipaoTimer = setTimeout(() => {
            if (!this.alive) return;
            this.qipao.active = false;
            this.qipaoTimer = setTimeout(() => {
                if (this.alive) this.showQipao();
            }, QIPAO_INTERVAL_MS);
        }, QIPAO_INTERVAL_MS);
    }

    /**
     * 停闪烁并把气泡收掉（进页面 / 切走都要先走这步，防定时器叠加）。
     *
     * ⚠️ `isValid` 不是冗余判空：`onDisable` 有两条触发路径 ——
     * ① 切 tab / `Node.destroy()`：先同步 `active = false`，此时节点都还在；
     * ② 宿主被父节点连带销毁：引擎先拆完子节点再 `disableComp`，`Qipao` 已走完自己的销毁，
     *    对它写 `active` 会打断引擎的延迟销毁（就是 2026-11-17 那条崩溃）。
     * 运行期 `Qipao` 若没绑，{@link showQipao} 里裸写的 `this.qipao.active = true` 仍会当场抛。
     */
    private stopQipao(): void {
        this.clearQipaoTimer();
        if (this.qipao?.isValid) this.qipao.active = false;
    }

    /** 只停定时器（销毁期用：此时子节点已先被引擎销毁，见 {@link onDestroy}）。 */
    private clearQipaoTimer(): void {
        if (this.qipaoTimer === null) return;
        clearTimeout(this.qipaoTimer);
        this.qipaoTimer = null;
    }
}
