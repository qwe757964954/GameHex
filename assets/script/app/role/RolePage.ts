import { _decorator, Animation, Button, Component, Label, Node } from 'cc';
import { FW } from '../../framework/FW';
import { roleRepository } from './RoleRepository';
import { ROLE_NAV_READY, isRoleBagTabReady } from './RoleTable';
import { ROLE_TEXTS } from './RoleTexts';
import { RedDot } from '../common/RedDot';
import { CmdRedDotType } from '../generated/netProto/CmdInterface';
import { readServerRedDot } from '../rd/RdServerVar';
import { ROLE_EQUIP_PART_COUNT } from './RoleTypes';
import type { RoleBagTabId, RoleNavId } from './RoleTypes';
import { RoleBagPanel } from './RoleBagPanel';
import { RoleEquipSlot } from './RoleEquipSlot';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import { MilitiaTalentPage } from './MilitiaTalentPage';

const { ccclass, property } = _decorator;

/** 背包页签节点名 → tab id（prefab 既有节点名 = 真源）。 */
const BAG_TAB_NODES: ReadonlyArray<readonly [string, RoleBagTabId]> = [
    ['BagTabGem', 1],
    ['BagTabEquip', 2],
    ['BagTabItem', 3],
];

/** 民兵天赋的导航 id（`ROLE_NAV_READY` 白名单里唯一落地的一条）。 */
const ROLE_NAV_TALENT: RoleNavId = 2;

/** 左侧导航节点名 → nav id。 */
const NAV_NODES: ReadonlyArray<readonly [string, RoleNavId]> = [
    ['NavHero', 1],
    ['NavMilitia', 2],
    ['NavGongMing', 3],
    ['NavGuards', 4],
    ['NavPreview', 5],
    ['NavArtifact', 6],
    ['NavLeaderSkill', 7],
];

/**
 * 主角立绘：`units/剑圣/剑圣.prefab` 的**嵌套实例**节点名 + 待机动画名。
 *
 * 这个 prefab 本来就是塔防里的「剑圣主角」（`cc.Sprite` + `cc.Animation`，clip 三个：
 * `剑圣-idle` / `-attack` / `-run`，`defaultClip` 就是 idle、`playOnLoad = true`）。
 * 这里选它而不是另做一张立绘：**资源单源** —— 战斗里改了帧，角色页跟着变。
 *
 * ⚠️ 仍然在 `onOpen` 里**显式播一次**：`playOnLoad` 依赖 `cc.Animation.onLoad` 的时序，
 * 而嵌套实例的 `onLoad` 时机随宿主激活走；显式播既确定又能被探针断言（别改成只靠 playOnLoad）。
 *
 * ⚠️ 剑圣**挂在 `HeroIcon` 下**（不是 `Role` 的直接子节点）：嵌套实例根**不能挂 `cc.Widget`**，
 * 而屏幕比设计分辨率高时上半屏要整体贴顶 —— 所以把它收进同样贴顶的 `HeroIcon` 里，
 * 靠宿主一起走。取它必须先下 `HeroIcon` 一层（2026-09-26 iPhone X 适配时改）。
 */
const ROLE_HERO_HOST = 'HeroIcon';
const ROLE_HERO_NODE = '剑圣';
const ROLE_HERO_IDLE = '剑圣-idle';

/**
 * 「前期建议优先提升攻击力」气泡（文案烘在 prefab 里，这里只管显隐）。
 *
 * 口径 = 老端 `TabRoleMain.showQiPao()`：**等级 ≥ 5 永不显示**；否则进页面就亮、
 * 亮 5 秒 → 灭 5 秒 → 再亮……循环闪烁（`qipaoTimer` 嵌套 setTimeout）。
 * 切走页面要清定时器（不然回调打在已销毁的组件上）。
 */
const QIPAO_NODE = 'Qipao';
const QIPAO_MAX_LEVEL = 5;
const QIPAO_INTERVAL_MS = 5000;

/**
 * 角色主界面（**主界面 tab 页**，挂 `ui/Role/Role.prefab` 根节点 —— 与 `CardLineup` 同构）。
 *
 * 本轮落地：顶部三个背包页签（宝石 / 装备 / 道具）→ 下半屏列表 `RoleBagPanel`；
 * 左侧 7 个导航未落地，点击给「功能未接入」提示，不留死按钮。
 *
 * ⚠️ **它是 tab 页，不是弹窗**（2026-09-26 山猫定）：
 *   · 由 `MainTabHost` 在「领地」tab 上 `showPage()` 实例化到 `Content` 下，切走即销毁；
 *   · 没有关闭按钮、不响应点空白、**不进 `PopupManager` 的栈**；
 *   · 生命周期用 `onLoad`（一次性接线）+ `onEnable`（每次进页面刷数据），
 *     对应弹窗时代的 `onInit` / `onOpen`。
 */
@ccclass('RolePage')
export class RolePage extends Component {
    static prefabPath = 'ui/Role/Role';

    // ⚠️ 两个引用在 prefab 里存的是【节点】不是组件（与项目「按钮一律绑节点」的口径一致），
    //    所以声明一律 `Node`，组件在 {@link ensureInit} 里 `getComponent` 现取并缓存。
    //    声明成 `Label` / `RoleBagPanel` 会拿到一个 cc.Node（truthy），
    //    然后 `.node.on(...)` 抛 `Cannot read properties of undefined (reading 'on')`。
    @property({ type: Node, tooltip: 'BagPanel：背包列表面板节点（其上挂 RoleBagPanel）' })
    bagPanel: Node = null;

    @property({ type: Node, tooltip: 'PowerValue：战斗力数值节点（其上挂 cc.Label）' })
    powerValue: Node = null;

    /** 当前选中的背包页签（null = 未选中）。 */
    private activeTab: RoleBagTabId | null = null;

    /** 装备栏 6 格（下标 = 部位号 − 1）。 */
    private readonly equipSlots: RoleEquipSlot[] = [];

    /** 宝石页签的红点（`BagTabGem/com_rd`，`RedDot` 组件）。 */
    private gemTabRedDot: RedDot = null;

    /** 缓存：BagPanel 节点上的面板组件（{@link ensureInit} 里取）。 */
    private bagPanelComp: RoleBagPanel = null;

    /** 缓存：主角立绘上的 `cc.Animation`（进页面播 idle）。 */
    private heroAnim: Animation = null;

    /** 缓存：PowerValue 节点上的 Label。 */
    private powerLabel: Label = null;

    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    /** 每趟 `onEnable` 递增，丢弃过期的异步结果（切走时页面可能已被销毁）。 */
    private revision = 0;

    /** 气泡闪烁定时器（嵌套 setTimeout 句柄；`null` = 没在闪）。 */
    private qipaoTimer: ReturnType<typeof setTimeout> | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.ensureInit();
    }

    /**
     * 每次进页面（首次激活 / 再次切回来）都刷一遍数据。
     *
     * ⚠️ 用 `onEnable` 而不是 `onLoad`：tab 页切走时会被 `MainTabHost` **销毁重建**，
     * 但同一个 tab 连点两次不会重建 —— 两种情况都要保证数据是最新的。
     */
    protected onEnable(): void {
        void this.refresh();
    }

    /**
     * 取组件 + 接回调（幂等）。
     *
     * ⚠️ 不能只放在 `onLoad` 里一次性做完 —— 但也不能放 `onEnable`（会重复挂监听）。
     * 这里保持「只跑一次」的语义，`onLoad` 调一次即可；写幂等是为了防将来有人
     * 在 `onEnable` 里也调（重复挂监听是最难查的静默故障）。
     */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;

        for (const [name, tab] of BAG_TAB_NODES) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => void this.onClickBag(tab), this);
        }

        for (const [name, navId] of NAV_NODES) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => this.onClickNav(navId), this);
        }

        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默留个死界面。
        this.bagPanelComp = this.bagPanel.getComponent(RoleBagPanel);
        this.powerLabel = this.powerValue.getComponent(Label);

        // 主角立绘（`units/剑圣` 嵌套实例）上的动画组件 —— 它挂在 HeroIcon 下（见文件头说明）。
        this.heroAnim = this.node.getChildByName(ROLE_HERO_HOST).getChildByName(ROLE_HERO_NODE).getComponent(Animation);

        // 装备栏：6 格按部位号顺序取（老端也是 `com.tm2("equipType" + 部位号)` 现取）。
        for (let partId = 1; partId <= ROLE_EQUIP_PART_COUNT; partId += 1) {
            this.equipSlots.push(this.node.getChildByName(`Equip${partId}`).getComponent(RoleEquipSlot));
        }

        // 红点：18 处都挂了 `RedDot`（带 spine 闪闪），**根节点保持 active**，
        // 显隐由 `setRedDot()` 决定 —— 不在这里写 `com_rd.active`。
        this.gemTabRedDot = this.node.getChildByName('BagTabGem').getChildByName('com_rd').getComponent(RedDot);
    }

    /** 页面是否还活着（替代弹窗时代的 `isPopupOpen` 守卫）。 */
    private get alive(): boolean {
        return this.node.isValid && this.node.activeInHierarchy;
    }

    /** 刷数据：攻击力 / 主角 idle / 装备栏 / 背包列表 / 红点。 */
    private async refresh(): Promise<void> {
        const rev = (this.revision += 1);
        const snapshot = await roleRepository.load();
        if (!this.alive || rev !== this.revision) return;

        // 攻击力**无条件写**（规则 82）：0 也显示成 "0" —— 留白会被误读成"压根没接"。
        this.powerLabel.string = String(snapshot.power);

        // 主角立绘：每次进页面从头播 idle（`Stop` 一下再播，避免上次留下的进度）。
        this.heroAnim.stop();
        this.heroAnim.play(ROLE_HERO_IDLE);

        // 老端结构（`TabRoleMain`）：进页面下半屏**直接铺列表**，默认停在「宝石」页签，
        // 不是「点页签才弹出一个覆盖式面板」（那样进来时下半屏是空白的）。
        await this.presentEquips();
        if (!this.alive || rev !== this.revision) return;

        // 宝石页签红点 = 服务端 `CmdRedDotType.GEM_COMPOSE`（「有宝石可合成」）。
        // 这是服务端唯一与背包沾边的红点类型；老端其余 17 处（导航 7 个 / 页签另 2 个 /
        // 装备 6 格 / 锻造）走的是**客户端本地表达式**，新端 `app/rd/**` 还没实现对应变量
        // ⇒ 那些红点保持不亮（`RedDot` 默认收起），等口径定下来再接。
        this.gemTabRedDot.setRedDot(readServerRedDot(CmdRedDotType.GEM_COMPOSE));

        const tab: RoleBagTabId = 1;
        this.activeTab = tab;
        await this.bagPanelComp.show(tab);
        this.applyTabLook();

        // 气泡最后起（老端 enter() 的最后一步也是 showQiPao）—— 等级读缓存，与加载时序无关。
        this.showQipao();
    }

    protected onDisable(): void {
        // 切 tab / 关页面：把面板收掉、红点归零（`RedDot` 复用不留残影）。
        this.revision += 1;
        this.bagPanelComp?.hide();
        this.activeTab = null;
        this.gemTabRedDot?.setRedDot(0);
        this.stopQipao();
    }

    // ============================================================
    // 内部
    // ============================================================

    /** 点背包页签：未落地给提示，已落地打开面板。 */
    private async onClickBag(tab: RoleBagTabId): Promise<void> {
        if (!isRoleBagTabReady(tab)) {
            FW.showTip(ROLE_TEXTS.bagTabMissing);
            return;
        }
        this.activeTab = tab;
        this.applyTabLook();
        await this.bagPanelComp.show(tab);
    }

    /**
     * 装备栏 6 格：图标 + 品质框 + `Lv.x`。
     *
     * ⚠️ 图 / 框**先 `await` 完再写**（与背包列表同一口径）：`render` 是同步的，
     * 边加载边写会先闪一格旧图。
     * ⚠️ 空位（`entry === null`）**不隐藏格子** —— 老端也是恒在，只把图 / 框 / 文字清掉。
     */
    private async presentEquips(): Promise<void> {
        const slots = roleRepository.equipParts();
        await Promise.all(
            slots.map(async (data, index) => {
                const slot = this.equipSlots[index];
                const entry = data.entry;
                if (!entry) {
                    slot.render(null, null, 0, false);
                    return;
                }
                const [icon, frame] = await Promise.all([
                    loadRoleBagIcon(entry),
                    loadRoleQualityFrame(entry.quality),
                ]);
                if (!this.alive) return;
                slot.render(frame, icon, data.level, true);
            }),
        );
    }

    /**
     * 点左侧导航：已落地的打开对应界面，未落地给「功能未接入」提示。
     *
     * ⚠️ `ROLE_NAV_READY` 只表示「这条落地了」，**打开哪个界面由这里分发** ——
     * 别把 prefab 路径塞进表里（视图层的事归视图层）。
     */
    private onClickNav(navId: RoleNavId): void {
        if (navId === ROLE_NAV_TALENT) {
            void MilitiaTalentPage.open();
            return;
        }
        if (ROLE_NAV_READY.has(navId)) return;
        FW.showTip(ROLE_TEXTS.navMissing);
    }

    /** 页签选中观感：当前页签放大 1.08，其余 1。 */
    private applyTabLook(): void {
        for (const [name, tab] of BAG_TAB_NODES) {
            const node = this.node.getChildByName(name);
            if (node) node.setScale(this.activeTab === tab ? 1.08 : 1, this.activeTab === tab ? 1.08 : 1, 1);
        }
    }

    /**
     * 「前期建议优先提升攻击力」气泡：等级 ≥ 5 永不显示，否则亮 {@link QIPAO_INTERVAL_MS}
     * → 灭同样时长 → 循环（口径照抄老端 `TabRoleMain.showQiPao`，含「先灭一次再判等级」）。
     */
    private showQipao(): void {
        this.stopQipao();
        const node = this.node.getChildByName(QIPAO_NODE);
        if (!node) return;
        if (roleRepository.roleLevel() >= QIPAO_MAX_LEVEL) return;
        node.active = true;
        this.qipaoTimer = setTimeout(() => {
            if (!this.alive) return;
            node.active = false;
            this.qipaoTimer = setTimeout(() => {
                if (this.alive) this.showQipao();
            }, QIPAO_INTERVAL_MS);
        }, QIPAO_INTERVAL_MS);
    }

    /** 停闪烁并把气泡收掉（进页面 / 切走都要先走这步，防定时器叠加）。 */
    private stopQipao(): void {
        if (this.qipaoTimer !== null) {
            clearTimeout(this.qipaoTimer);
            this.qipaoTimer = null;
        }
        const node = this.node.getChildByName(QIPAO_NODE);
        if (node) node.active = false;
    }
}
