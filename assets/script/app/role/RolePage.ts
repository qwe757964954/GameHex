import { _decorator, Button, Color, Component, Label, Node, sp } from 'cc';
import { roleRepository } from './RoleRepository';
import { VIEW_LIFECYCLE } from '../../framework/ui/ViewLifecycle';
import { RoleEvent } from './RoleEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import type { IRoleSnapshot } from './RoleTypes';
import { RedDot } from '../common/RedDot';
import { CmdRedDotType } from '../generated/netProto/CmdInterface';
import { readServerRedDot } from '../rd/RdServerVar';
import { ROLE_EQUIP_PART_COUNT } from './RoleTypes';
import type { RoleBagTabId, RoleNavId } from './RoleTypes';
import { RoleBagPanel } from './RoleBagPanel';
import { RoleEquipSlot } from './RoleEquipSlot';
import { loadRoleBagIcon, loadRoleQualityFrame } from './RoleArtLoader';
import { formatPowerText } from '../card/CardLineupPower';

const { ccclass, property } = _decorator;

/** 背包页签节点名 → tab id（prefab 既有节点名 = 真源）。 */
const BAG_TAB_NODES: ReadonlyArray<readonly [string, RoleBagTabId]> = [
    ['BagTabGem', 1],
    ['BagTabEquip', 2],
    ['BagTabItem', 3],
];

/** 设计稿顶部「宝石背包」入口（复用页签 1；点击直接切到宝石列表）。 */
const BAG_ENTRY_GEM = 'BagBtnGem';

const BAG_ENTRY_COMPOSE = 'BagBtnCompose';
const BAG_ENTRY_PENDING: readonly string[] = ['BagBtnAll'];

/** 未选中页签的文字色 / 描边色（设计稿：灰底深棕字；选中态白字 + 深棕描边）。 */
const TAB_LABEL_IDLE = new Color(74, 55, 38, 255);
const TAB_LABEL_OUTLINE = new Color(54, 34, 17, 255);

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
 * 主角立绘：`skel/主角铁拳/主角铁拳.prefab` 的**嵌套实例**节点名 + 待机动画名。
 *
 * 2026-11-17 换代：原来嵌的是 `units/剑圣/剑圣.prefab`（序列帧，`cc.Sprite` + `cc.Animation`，
 * **该目录同日已 `svn delete`**，别照着路径去找）。美术给了主角本体的 Spine 版（`tqzj`，动画
 * `animation` / `attack` / `idle` / `move`，skin 只有 `default`）⇒ 统一走骨骼，
 * 与其余 36 套单位同一套口径：**根节点 + 子节点 `spine`**，动作走 `setAnimation`。
 *
 * ⚠️ 仍然在 `renderSnapshot` 里**显式播一次**：`sp.Skeleton.defaultAnimation` 的自动播
 * 依赖组件 `onLoad` 的时序，而嵌套实例的 `onLoad` 时机随宿主激活走（RolePage 的 `onLoad`
 * 可能早于骨架就绪）；显式播既确定又能被断言。
 *
 * ⚠️ `setAnimation` 在骨架还没走完 `onLoad` 时返回 `null`（与 `ZCUnitView.playClip` 同一条
 * 自愈路径）⇒ 见 {@link playHeroIdle}，补一帧重试一次，不做无限重试。
 *
 * ⚠️ 立绘**挂在 `HeroIcon` 下**（不是 `Role` 的直接子节点）：嵌套实例根**不能挂 `cc.Widget`**，
 * 而屏幕比设计分辨率高时上半屏要整体贴顶 —— 所以把它收进同样贴顶的 `HeroIcon` 里，
 * 靠宿主一起走。取它必须先下 `HeroIcon` 一层（2026-09-26 iPhone X 适配时改）。
 *
 * ⚠️ 骨架原始尺寸 942.67×769（`spine` 子节点 822×1218），实例上覆盖了 `_lscale = 0.2`
 * 才和 `HeroIcon`（209×244）对得上 —— 换美术时**先看 prefab 里的覆盖，别只看 prefab 自身尺寸**。
 */
const ROLE_HERO_HOST = 'HeroIcon';
const ROLE_HERO_NODE = '主角铁拳';
/** 骨架子节点名（37 套单位里 36 套都是这个；`skel/yueka` 例外，见 {@link ensureInit}）。 */
const ROLE_HERO_SPINE = 'spine';
const ROLE_HERO_IDLE = 'idle';

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
    bagPanel: Node = null!;

    @property({ type: Node, tooltip: 'PowerValue：战斗力数值节点（其上挂 cc.Label）' })
    powerValue: Node = null!;

    /** 当前选中的背包页签（null = 未选中）。 */
    private activeTab: RoleBagTabId | null = null;

    /** 装备栏 6 格（下标 = 部位号 − 1）。 */
    private readonly equipSlots: RoleEquipSlot[] = [];

    /** 宝石页签的红点（`BagTabGem/com_rd`，`RedDot` 组件）。 */
    private gemTabRedDot: RedDot = null!;

    /** 缓存：BagPanel 节点上的面板组件（{@link ensureInit} 里取）。 */
    private bagPanelComp: RoleBagPanel = null!;

    /** 缓存：主角立绘上的 `sp.Skeleton`（进页面播 idle）。 */
    private heroSkeleton: sp.Skeleton = null!;

    /** 缓存：PowerValue 节点上的 Label。 */
    private powerLabel: Label = null!;

    /** 每趟 `onEnable` 递增，丢弃过期的异步结果（切走时页面可能已被销毁）。 */
    private revision = 0;

    /** 气泡闪烁定时器（嵌套 setTimeout 句柄；`null` = 没在闪）。 */
    private qipaoTimer: ReturnType<typeof setTimeout> | null = null;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onLoad(): void {
        this.ensureInit();
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'ready' }, this);
    }

    /**
     * 每次进页面（首次激活 / 再次切回来）都刷一遍数据。
     *
     * ⚠️ 用 `onEnable` 而不是 `onLoad`：tab 页切走时会被 `MainTabHost` **销毁重建**，
     * 但同一个 tab 连点两次不会重建 —— 两种情况都要保证数据是最新的。
     */
    protected onEnable(): void {
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, this);
    }

    selectBag(tab: RoleBagTabId): void { this.activeTab = tab; this.applyTabLook(); }
    showBag(tab: RoleBagTabId): Promise<void> { return this.bagPanelComp.show(tab); }

    /** 仅由 onLoad 取得 prefab 引用并绑定输入。 */
    private ensureInit(): void {

        for (const [name, tab] of BAG_TAB_NODES) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab }, this), this);
        }

        for (const [name, navId] of NAV_NODES) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => EventMgr.instance.emit(RoleEvent.Intent, { kind: 'nav', navId }, this), this);
        }

        const gemEntry = this.node.getChildByName(BAG_ENTRY_GEM)?.getComponent(Button);
        gemEntry?.node.on(Button.EventType.CLICK, () => EventMgr.instance.emit(RoleEvent.Intent, { kind: 'bag', tab: 1 }, this), this);
        this.node.getChildByName(BAG_ENTRY_COMPOSE).on(Button.EventType.CLICK,
            () => EventMgr.instance.emit(RoleEvent.Intent, { kind: 'compose' }, this), this);
        for (const name of BAG_ENTRY_PENDING) {
            const button = this.node.getChildByName(name)?.getComponent(Button);
            button?.node.on(Button.EventType.CLICK, () => EventMgr.instance.emit(RoleEvent.Intent, { kind: 'nav', navId: 7 }, this), this);
        }

        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默留个死界面。
        this.bagPanelComp = this.bagPanel.getComponent(RoleBagPanel);
        this.powerLabel = this.powerValue.getComponent(Label);

        // 主角立绘（`skel/主角铁拳` 嵌套实例）上的骨架 —— 它挂在 HeroIcon 下（见文件头说明）。
        // 布局与其余 36 套单位一致：Skeleton 在子节点 `spine` 上（`skel/yueka` 例外，直接挂在根）；
        // 这两个分支都试，别假定唯一形态。
        const heroRoot = this.node.getChildByName(ROLE_HERO_HOST).getChildByName(ROLE_HERO_NODE);
        this.heroSkeleton = heroRoot.getComponent(sp.Skeleton) || heroRoot.getChildByName(ROLE_HERO_SPINE).getComponent(sp.Skeleton);

        // 装备栏：6 格按部位号顺序取（老端也是 `com.tm2("equipType" + 部位号)` 现取）。
        for (let partId = 1; partId <= ROLE_EQUIP_PART_COUNT; partId += 1) {
            this.equipSlots.push(this.node.getChildByName(`Equip${partId}`).getComponent(RoleEquipSlot));
        }

        // 红点：18 处都挂了 `RedDot`（带 spine 闪闪），**根节点保持 active**，
        // 显隐由 `setRedDot()` 决定 —— 不在这里写 `com_rd.active`。
        this.gemTabRedDot = this.node.getChildByName('BagTabGem').getChildByName('com_rd').getComponent(RedDot);
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
        // 这是服务端唯一与背包沾边的红点类型；老端其余 17 处（导航 7 个 / 页签另 2 个 /
        // 装备 6 格 / 锻造）走的是**客户端本地表达式**，新端 `app/rd/**` 还没实现对应变量
        // ⇒ 那些红点保持不亮（`RedDot` 默认收起），等口径定下来再接。
        this.gemTabRedDot.setRedDot(readServerRedDot(CmdRedDotType.GEM_COMPOSE));

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

    /**
     * ⚠️ 销毁期**只停定时器，不碰任何节点**（规则 176/278）。
     *
     * 引擎销毁序（`node.ts::_onPreDestroyBase` L1532→L1545）：先 `children[i]._destroyImmediate()`，
     * 再销毁自身组件 ⇒ 轮到本组件的 `onDestroy` 时，子节点 `Qipao` 已走完 `_destruct`，
     * 它的 `_name` 被清成 `''` ⇒ `getChildByName('Qipao')` 返回 `null`，
     * 写 `node.active` 当场抛 `Cannot set properties of null (setting 'active')`。
     *
     * 🔴 这个异常不是"报一行就算了"：它从 `onDestroy` 抛回 `CCObject._deferredDestroy()`
     * （`object.ts` L173，**没有 try/catch**）⇒ 整批延迟销毁中断，本对象拿不到 `Destroyed`
     * 标记（永远不会 `isValid === false`）、留在 `objectsToDestroy` 里每帧重炸。
     *
     * 收气泡已经由 {@link onDisable} 负责，且必然早于这里：`Node.destroy()` 会先同步
     * `active = false`（`node.ts` L1367）触发一次 `onDisable`，`NodeActivator.destroyComp`
     * 也会在调 `onDestroy` 前先 `disableComp`。语义上也不需要 —— 整棵节点树都要没了。
     */
    protected onDestroy(): void {
        this.clearQipaoTimer();
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'destroyed' }, this);
    }

    protected onDisable(): void {
        // 切 tab / 关页面：把面板收掉、红点归零（`RedDot` 复用不留残影）。
        this.revision += 1;
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'disabled' }, this);
        this.bagPanelComp?.hide();
        this.activeTab = null;
        this.gemTabRedDot?.setRedDot(0);
        this.stopQipao();
    }

    // ============================================================
    // 内部
    // ============================================================

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
     * 点左侧导航：已落地的打开对应界面，未落地给「功能未接入」提示。
     *
     * ⚠️ `ROLE_NAV_READY` 只表示「这条落地了」，**打开哪个界面由这里分发** ——
     * 别把 prefab 路径塞进表里（视图层的事归视图层）。
     */
    /**
     * 页签选中观感：选中项亮橙色高亮（`hl`）+ 白字描边，其余保持灰底深棕字。
     *
     * 高亮 / 文字色都烘在 prefab 的静态初值里，这里只做状态切换；不再缩放节点。
     */
    private applyTabLook(): void {
        for (const [name, tab] of BAG_TAB_NODES) {
            const node = this.node.getChildByName(name);
            const active = this.activeTab === tab;
            const hl = node.getChildByName('hl');
            if (hl) hl.active = active;
            const label = node.getChildByName('title')?.getComponent(Label);
            if (!label) continue;
            label.color = active ? new Color(255, 255, 255, 255) : TAB_LABEL_IDLE.clone();
            label.enableOutline = active;
            label.outlineColor = TAB_LABEL_OUTLINE.clone();
            label.outlineWidth = 2;
        }
    }

    /**
     * 「前期建议优先提升攻击力」气泡：等级 ≥ 5 永不显示，否则亮 {@link QIPAO_INTERVAL_MS}
     * → 灭同样时长 → 循环（口径照抄老端 `TabRoleMain.showQiPao`，含「先灭一次再判等级」）。
     */
    private showQipao(): void {
        this.stopQipao();
        const node = this.node.getChildByName(QIPAO_NODE);
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

    /**
     * 停闪烁并把气泡收掉（进页面 / 切走都要先走这步，防定时器叠加）。
     *
     * ⚠️ 取不到节点时**直接跳过**，不是"静默兜底"：`onDisable` 有两条触发路径 ——
     * ① 切 tab / `Node.destroy()`：先同步 `active = false`，此时子节点都还在；
     * ② 宿主被父节点连带销毁：引擎先拆完子节点再 `disableComp`，`Qipao` 已经没了。
     * 只有 ②会命中 `null`，写 `active` 必抛（就是本轮 `RolePage.ts:308` 那条）。
     * 正常运行时若 `Qipao` 被改名，{@link showQipao} 里裸写的 `node.active = true` 仍会当场抛，
     * 不会因为这里的判空而漏掉 prefab 绑定错误。
     */
    private stopQipao(): void {
        this.clearQipaoTimer();
        const node = this.node.getChildByName(QIPAO_NODE);
        if (node) node.active = false;
    }

    /** 只停定时器（销毁期用：此时子节点已先被引擎销毁，见 {@link onDestroy}）。 */
    private clearQipaoTimer(): void {
        if (this.qipaoTimer === null) return;
        clearTimeout(this.qipaoTimer);
        this.qipaoTimer = null;
    }
}
