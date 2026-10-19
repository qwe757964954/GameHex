import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { GoodsBox } from '../../itemdetail/GoodsBox';
import { loadIdArtByRel } from '../../itemdetail/ItemDetailArtLoader';
import { ZCGameUiEvent } from '../view/ZCGameHudEvents';
import { EventMgr } from '../../../framework/event/EventMgr';

const { ccclass, property } = _decorator;

/** 胜利 / 失败的标题套图（底板 + 标题字），都在 `image/settlement/` 下。 */
const TITLE_RELS = {
    victory: { plate: 'settlement/JS_title_bg_01', text: 'settlement/title_text_01' },
    defeat: { plate: 'settlement/JS_title_02', text: 'settlement/title_text' },
} as const;

/** 结算页的两态（图标文案里的「战斗胜利 / 战斗失败」走美术，不写文字）。 */
export type ZCSettlementOutcome = 'victory' | 'defeat';

/** 变强途径三个入口的键（点哪个由上层决定）。 */
export type ZCSettlementGrowEntry = 'equip' | 'hero' | 'rune';

/** 一个奖励格：**帧已加载好**再传（解析链在调用方，页面只负责画）。 */
export interface IZCSettlementReward {
    readonly qualityFrame: SpriteFrame | null;
    readonly iconFrame: SpriteFrame | null;
    /** 数量文案；空串 = 不显示数量（`GoodsBox` 口径）。 */
    readonly number: string;
}

/** `ZCSettlementPage.open` 的 userData。 */
export interface IZCSettlementOptions {
    /** 胜负：决定标题套图（`image/settlement/` 两套）。 */
    readonly victory: boolean;
    /** 段位名（`grade.json` 的 `gradeName`）；空 = 整行收起。 */
    readonly rankName?: string;
    /** 段位积分 `12/100`。 */
    readonly scoreText?: string;
    /** 本局加分 `+100`。 */
    readonly addScoreText?: string;
    /** 段位条进度 0~1（缺省 0）。 */
    readonly rankProgress?: number;
    /** 段位说明（「本次战斗段位获得100积分」）。 */
    readonly rankHint?: string;
    /** 通关奖励（条数不限；虚拟列表按视口铺槽位）。 */
    readonly rewards?: readonly IZCSettlementReward[];
    /** 双倍奖励。**本期没有接线**：不给就整组收起 `BtnDouble`（见 {@link onOpen}）。 */
    readonly onDoubleReward?: () => void;
    /** 变强途径三个入口。**本期没有接线**：不给就整组收起 `Panel/Grow`（见 {@link onOpen}）。 */
    readonly onGrowEntry?: (entry: ZCSettlementGrowEntry) => void;
    //  确定/关闭**不走回调**：页面只 `EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm)`，
    // 「回主界面 / 换流程」由控制器订阅后处理（契约见 `view/ZCGameHudEvents.ts`）。原先的 `onConfirm`
    // 必填字段要求调用方把流程入口塞进视图，还得给「没拿到回调」写一条告警兜底 —— 现在都不需要了。
}

/**
 * 对局结算页（挂在 `ZCSettlement.prefab` 根节点上）。
 *
 * 蓝湖「结算-胜利」/「结算-失败」两张稿：同一套骨架，只有标题套图不同。
 * 结构、尺寸、美术全在 prefab 里；代码只按数据刷文案 / 标题图 / 段位条 / 奖励格。
 *
 * 奖励格复用物品详情那套 `GoodsBox`（品质框 `cu_quality_*` + 道具图标 + 数量），
 * **帧由调用方解析好再传**（`image/settlement/` 之外的美术不归这一页管）。
 *
 *  奖励区是**虚拟列表**（`VirtualScrollView`，视窗 + content + 模板 `Slot` 全在本 prefab 内联）：
 * 槽位只有「视口放得下的行数 + buffer + 2」个、靠 `renderItemFn` 反复复用 ⇒ 奖励条数不再被格数卡住。
 * 列表参数（5 列 / 列距 11 / 行距 14 / 上下留白 20）全在 prefab 的 Inspector 里，代码只喂条数与内容。
 *
 *  全屏遮罩 `Dim` 是**纯 prefab 件**（白块 Sprite + 染色 + 四边 Widget），**代码不碰** ——
 * 别在这里改回 `cc.Graphics` 手画矩形：那个只在 `onInit` 画一次、用的是 prefab 烘的 720×1280，
 * 真机可见区 720×1610 会上下各漏 165px（`UITransform` 被 Widget 拉大了，画上去的矩形却没变）。
 *
 * ## 两条不可绕过的收尾约定
 *
 *  ① **关闭只走 `ZCGameUiEvent.SettlementConfirm` 事件**（页面自己不关、也不改流程），且**禁止空白关闭**
 *  （`canCloseOnBlank()` 覆写为 `false`）。结算页一关，`ZCGame.openSettlement` 置死的
 *  `settlementOpened` 就让它再也弹不出来 ⇒ 「关页」等价于「卡死」，不能当退路。
 *  ② **没接线的功能整组收起**：`onDoubleReward` / `onGrowEntry` 不给就收起 `BtnDouble`
 *  与 `Panel/Grow`（含标题），与 `renderRank` 的 `hasRank` 同一口径 —— 不留点了没反应的死按钮。
 */
@ccclass('ZCSettlementPage')
export class ZCSettlementPage extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。 */
    static prefabPath = 'ui/game/ZCSettlement';

    @property({ type: Sprite, group: '标题', tooltip: 'Panel/TitlePlate：胜利/失败的标题底板' })
    titlePlate: Sprite = null!;

    @property({ type: Sprite, group: '标题', tooltip: 'Panel/TitlePlate/TitleText：胜利/失败的标题字' })
    titleText: Sprite = null!;

    @property({ type: Node, group: '段位', tooltip: 'Panel/RankRow：段位行整组（无数据时收起）' })
    rankRow: Node = null!;

    @property({ type: Sprite, group: '段位', tooltip: 'RankRow/RankIcon' })
    rankIcon: Sprite = null!;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankName：段位名' })
    rankName: Label = null!;

    @property({ type: Sprite, group: '段位', tooltip: 'RankRow/RankBar/RankFill：段位进度（FILLED）' })
    rankFill: Sprite = null!;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankScore：12/100' })
    rankScore: Label = null!;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankAdd：+100' })
    rankAdd: Label = null!;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankHint：本次战斗段位获得100积分' })
    rankHint: Label = null!;

    @property({ type: VirtualScrollView, group: '奖励', tooltip: 'Panel/RewardSection/RewardScroll：通关奖励虚拟列表（模板 = content/Slot）' })
    rewardList: VirtualScrollView = null!;

    @property({ type: Button, group: '底部', tooltip: 'BtnDouble：双倍奖励' })
    doubleButton: Button = null!;

    @property({ type: Node, group: '变强途径', tooltip: 'Panel/Grow：变强途径整组（无回调时连标题带入口一起收起）' })
    growGroup: Node = null!;

    @property({ type: Button, group: '底部', tooltip: 'BtnConfirm：确定' })
    confirmButton: Button = null!;

    @property({ type: Button, group: '变强途径', tooltip: 'Panel/Grow/Entry0：装备升级' })
    entryEquip: Button = null!;

    @property({ type: Button, group: '变强途径', tooltip: 'Panel/Grow/Entry1：英雄' })
    entryHero: Button = null!;

    @property({ type: Button, group: '变强途径', tooltip: 'Panel/Grow/Entry2：符文' })
    entryRune: Button = null!;

    private options: IZCSettlementOptions | null = null;
    /** 本趟要显示的奖励（`renderItemFn` 按下标现取 —— 禁止闭包捕获，槽位会跨趟复用）。 */
    private rewards: readonly IZCSettlementReward[] = [];
    /** 标题套图的加载代号：两态切换 / 关闭后到达的异步结果要丢掉。 */
    private titleRevision = 0;
    /** 「确定」防重复提交：连点两下只发一次收尾（收尾多半是切流程，重复发等于 navigate 两次）。 */
    private confirming = false;

    protected onInit(): void {
        // 虚拟列表的回调只在初始化时接**一次**（槽位节点被反复复用，回调里再挂事件会越滚越多）。
        //  赋**具名方法 + `.bind(this)`**（规范 §7.5 配套第 3 条）：`VScrollView` 侧是
        // `this.renderItemFn(node, i)` 的**方法调用**语法，不绑的话函数里 `this` 会是 VScrollView
        // ⇒ `this.rewards` 读到 undefined 直接崩。
        this.rewardList.renderItemFn = this.renderReward.bind(this);
        // 按钮只在实例生命周期内绑一次（`PopupBase` 保证首次打开前调一次），
        // 节点失活 / 池化复用不会掉监听，补绑会叠出多份。
        // 监听一律**具名方法 + this 作 target**（范本 `GameRunAway.onInit`）：调用栈里能看到是谁点的，
        // 将来要 `off` 也有稳定的函数引用可传 —— 箭头闭包这两样都做不到。
        this.doubleButton.node.on(Button.EventType.CLICK, this.onDoubleRewardClicked, this);
        this.confirmButton.node.on(Button.EventType.CLICK, this.onConfirmClicked, this);
        this.entryEquip.node.on(Button.EventType.CLICK, this.onEquipEntryClicked, this);
        this.entryHero.node.on(Button.EventType.CLICK, this.onHeroEntryClicked, this);
        this.entryRune.node.on(Button.EventType.CLICK, this.onRuneEntryClicked, this);
    }

    protected onOpen(userData?: IZCSettlementOptions): void {
        if (!userData) return;
        this.options = userData;
        this.confirming = false;
        this.renderRank(userData);
        this.renderRewards(userData.rewards ?? []);
        this.renderEntryGroups(userData);
        void this.applyTitle(userData.victory ? 'victory' : 'defeat');
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 关掉后异步回来的标题图不许再写（槽位会被下一局复用）。
        this.titleRevision += 1;
        this.options = null;
    }

    /**
     * 结算页**绝不允许被空白关闭**（覆写基类那层 `closeOnBlank` 的默认放行）。
     *
     *  理由：结算是终局页，关闭动作只有一个 —— `onConfirm`（回主界面 / 换流程）。
     *  走空白关闭等于绕过它 ⇒ 页面消失、对局还开着，而调用方 `openSettlement` 早已把
     *  `settlementOpened` 置死 ⇒ 这局**再也弹不出结算页**，玩家卡死在战斗结束态。
     *
     *  ⚠️ 与调用方 `ZCSettlementPage.open({ closeOnBlank: false })` 的关系：
     *  那只是**同向的一层保险**，兜底必须放在页面自己身上 —— 参数写漏一次不该出事。
     */
    protected canCloseOnBlank(): boolean {
        return false;
    }

    // 按钮响应

    private onDoubleRewardClicked(): void {
        this.options?.onDoubleReward?.();
    }

    private onEquipEntryClicked(): void {
        this.options?.onGrowEntry?.('equip');
    }

    private onHeroEntryClicked(): void {
        this.options?.onGrowEntry?.('hero');
    }

    private onRuneEntryClicked(): void {
        this.options?.onGrowEntry?.('rune');
    }

    /**
     * 确定：只**派发意图事件**，页面自己不关、也不改流程（收尾归控制器）。
     *
     *  绝不能退化成 `close()` —— 那正是「页面关了、人还留在对局里」那个坑（2026-10-14 探针逮到过），
     * 何况对局侧已置死 `settlementOpened`，关了就是卡死。
     *  `confirming` 保留：连点两下只派发一次（收尾多半是切流程，重复等于 navigate 两次）。
     */
    private onConfirmClicked(): void {
        if (this.confirming) return;
        this.confirming = true;
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
    }

    // 渲染
    

    /**
     * 标题套图：两态各一套（`image/settlement/`），异步加载完才换。
     *
     *  加载期间保留 prefab 里的默认（胜利那套），别先清空 —— 会闪一帧空底板。
     */
    private async applyTitle(outcome: ZCSettlementOutcome): Promise<void> {
        const revision = ++this.titleRevision;
        const rel = TITLE_RELS[outcome];
        const [plate, text] = await Promise.all([
            loadIdArtByRel(rel.plate),
            loadIdArtByRel(rel.text),
        ]);
        // 期间换了态 / 弹窗已关 / 节点已销毁 ⇒ 丢弃这次结果。
        if (revision !== this.titleRevision || !this.isValid) return;
        if (plate) this.titlePlate.spriteFrame = plate;
        if (text) this.titleText.spriteFrame = text;
    }

    /** 段位行：**整组**显隐（没段位数据就收起，别留一行空框）。 */
    private renderRank(data: IZCSettlementOptions): void {
        const hasRank = Boolean(data.rankName);
        this.rankRow.active = hasRank;
        if (!hasRank) return;
        this.rankName.string = data.rankName!;
        this.rankScore.string = data.scoreText ?? '';
        this.rankAdd.string = data.addScoreText ?? '';
        this.rankHint.string = data.rankHint ?? '';
        this.rankFill.fillRange = Math.max(0, Math.min(1, data.rankProgress ?? 0));
    }

    /**
     * 通关奖励：**只喂条数**，格内容由 {@link renderReward} 按需填（虚拟列表铺槽位并复用）。
     *
     *  本趟数据存进字段、回调里按下标**现取**：`renderItemFn` 只在首次铺列表时绑一次，
     * 闭包捕获的本趟数组到了下一局就还是上一局的（技能 §6 的两条时序铁律之一）。
     */
    private renderRewards(rewards: readonly IZCSettlementReward[]): void {
        this.rewards = rewards;
        this.rewardList.setTotalCount(rewards.length);
        // 条数变化后可能停在越界位置；回到顶部（不播动画）。
        this.rewardList.scrollToTop(false);
    }

    /** 把一个奖励填进槽位（新建的或回收来的都要**全量**赋值，别留上一局的数量/图标）。 */
    private renderReward(node: Node, index: number): void {
        const reward = this.rewards[index];
        node.getComponent(GoodsBox)!.render(reward.qualityFrame, reward.iconFrame, reward.number, true);
    }

    /**
     * 「双倍奖励」与「变强途径」的口径（`renderRank` 的 `hasRank` 同一套思路）：
     *
     *  - **双倍奖励按钮常显**：它在设计稿里是奖励区中间那一段（两侧 `RewardLineL/R` 接过去），
     *    藏掉会中间断一截、左右不对称 ⇒ 一律显示（层片归 prefab，代码不碰美术）；
     *    但**没接线时 `interactable = false`** —— 看得到、点不动，不做「点了没反应」的假交互。
     *  - **变强途径**没接线时**整组收起**：它是一整块（底板 + 标题 + 三个入口），
     *    只收入口会剩一个空标题框，比死按钮更奇怪；收整组则「本期没有这个功能」一眼可见。
     */
    private renderEntryGroups(data: IZCSettlementOptions): void {
        this.doubleButton.node.active = true;
        this.doubleButton.interactable = Boolean(data.onDoubleReward);
        this.growGroup.active = Boolean(data.onGrowEntry);
    }
}
