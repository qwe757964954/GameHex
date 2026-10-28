import { _decorator, Button, Label, Node, Sprite } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
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

/** 变强途径三个入口 —— 作为 `SettlementGrowEntry` 事件的 payload 派发出去。 */
export type ZCSettlementGrowEntry = 'equip' | 'hero' | 'rune';

/**
 * 一个奖励格：**公共奖励格 `ui/common/RewardItem.prefab`** 的数据。
 *
 * 宿主只喂 `resId` + `amount`，图标 / 品质框 / 数量由 `RewardItemView` 自己解析
 * （与宝箱详情、关卡界面、玩家关卡弹窗共用同一份口径，见 `common/RewardItemView.ts`）。
 */
export type IZCSettlementReward = IRewardItemData;

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
    /** 通关奖励（条数不限；虚拟列表按视口铺槽位）。宿主只给 `resId` + `amount`。 */
    readonly rewards?: readonly IZCSettlementReward[];
    /**
     * 是否接了「双倍奖励」。缺省 / `false` ⇒ `BtnDouble` 常显但**置灰**（不收起，见 `renderEntryGroups`）。
     *
     * 它只回答「点了有没有人接」，行为本身由控制器订阅 `SettlementDoubleReward` 决定。
     */
    readonly hasDoubleReward?: boolean;
    /**
     * 是否接了「变强途径」。缺省 / `false` ⇒ `Panel/Grow`（连标题）**整组收起**。
     *
     * 入口点哪个走 `SettlementGrowEntry` 事件的 payload（`'equip' | 'hero' | 'rune'`）。
     */
    readonly hasGrowEntry?: boolean;
    //  所有按钮**都不走回调**：页面只 `EventMgr.instance.emit(...)`，「回主界面 / 换流程 /
    //  双倍 / 变强入口」全由控制器订阅后处理（契约见 `view/ZCGameHudEvents.ts`）。回调那套
    //  要求调用方把流程入口塞进视图，漏传一个就是「点了没反应且零报错」。
}

/**
 * 对局结算页（挂在 `ZCSettlement.prefab` 根节点上）。
 *
 * 胜负两稿同一骨架，只有标题套图不同；**结构 / 尺寸 / 美术全在 prefab**，代码只按数据刷文案、
 * 标题图、段位条与奖励格。奖励格复用**公共奖励格 `ui/common/RewardItem.prefab`**（`RewardItemView`
 * 自己解析图标 / 品质框 / 数量，宿主只喂 `resId` + `amount`），奖励区是虚拟列表
 * （视窗 / 模板 / 5 列等参数都在 prefab 里），代码只喂条数。全屏遮罩 `Dim` 是纯 prefab 件、
 * **代码不碰** —— 改回 `cc.Graphics` 手画会在长屏上下各漏 165px。
 *
 * 三条不可绕过的约定：
 *  ① **页面自己不关、也不改流程**，只派发意图事件；`canCloseOnBlank()` 恒 `false`
 *     （关页 = `settlementOpened` 置死后再也弹不出来 = 卡死）。真正关页的是
 *     `ZCGame.onSettlementConfirm`：先 `close()` 再 `navigate`，切流被取消时它负责把页面补回来
 *     —— 所以别在这里改成 `this.close()`。
 *  ② **按钮一律只 `emit` 事件**（`SettlementConfirm` / `SettlementDoubleReward` /
 *     `SettlementGrowEntry`），控制器订阅后处理；页面不持有任何回调。
 *  ③ **没接线的功能不留死按钮**：`hasDoubleReward` / `hasGrowEntry` 缺省就置灰 / 整组收起
 *     （与 `renderRank` 的 `hasRank` 同一口径）。
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

    /** 本趟要显示的奖励（`renderItemFn` 按下标现取 —— 禁止闭包捕获，槽位会跨趟复用）。 */
    private rewards: readonly IZCSettlementReward[] = [];
    /** 标题套图的加载代号：两态切换 / 关闭后到达的异步结果要丢掉。 */
    private titleRevision = 0;
    /** 「确定」防重复提交：连点两下只发一次收尾（收尾多半是切流程，重复发等于 navigate 两次）。 */
    private confirming = false;

    protected onInit(): void {
        // 回调与按钮监听都只在实例生命周期内绑**一次**（`PopupBase` 保证首次打开前调一次）：
        // 虚拟列表要给 `.bind(this)`（`VScrollView` 是方法调用语法，不绑 `this` 会是它自己）；
        // 按钮用「具名方法 + this 作 target」，将来要 `off` 有稳定引用，箭头闭包做不到。
        this.rewardList.renderItemFn = this.renderReward.bind(this);
        this.doubleButton.node.on(Button.EventType.CLICK, this.onDoubleRewardClicked, this);
        this.confirmButton.node.on(Button.EventType.CLICK, this.onConfirmClicked, this);
        this.entryEquip.node.on(Button.EventType.CLICK, this.onEquipEntryClicked, this);
        this.entryHero.node.on(Button.EventType.CLICK, this.onHeroEntryClicked, this);
        this.entryRune.node.on(Button.EventType.CLICK, this.onRuneEntryClicked, this);
    }

    /** 这一页**不留 userData**：所有意图都派发出去，页面不需要记得「谁接的」。 */
    protected onOpen(userData?: IZCSettlementOptions): void {
        if (!userData) return;
        this.confirming = false;
        this.renderRank(userData);
        this.renderRewards(userData.rewards ?? []);
        this.renderEntryGroups(userData);
        void this.applyTitle(userData.victory ? 'victory' : 'defeat');
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 关掉后异步回来的标题图不许再写（槽位会被下一局复用）。
        this.titleRevision += 1;
    }

    /** 结算页**绝不允许被空白关闭**：那是绕过「确定」⇒ 页面消失、对局还开着、再也弹不回来。 */
    protected canCloseOnBlank(): boolean {
        return false;
    }

    // 按钮响应：**全部只派发意图**，页面不持有回调（见类头注 ②）

    private onDoubleRewardClicked(): void {
        EventMgr.instance.emit(ZCGameUiEvent.SettlementDoubleReward);
    }

    private onEquipEntryClicked(): void {
        this.emitGrowEntry('equip');
    }

    private onHeroEntryClicked(): void {
        this.emitGrowEntry('hero');
    }

    private onRuneEntryClicked(): void {
        this.emitGrowEntry('rune');
    }

    /** 三个入口共用一条事件，点哪个由 payload 区分（控制器按 key 路由）。 */
    private emitGrowEntry(entry: ZCSettlementGrowEntry): void {
        EventMgr.instance.emit(ZCGameUiEvent.SettlementGrowEntry, entry);
    }

    /** 确定：连点两下只派发一次（收尾是切流程，重复发等于 navigate 两次）。 */
    private onConfirmClicked(): void {
        if (this.confirming) return;
        this.confirming = true;
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
    }

    // 渲染
    

    /** 标题套图：异步加载完才换；加载期间保留 prefab 默认那套（先清空会闪一帧空底板）。 */
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

    /** 通关奖励：**只喂条数**；内容由 {@link renderReward} 按下标现取（闭包捕获会留上一局的数组）。 */
    private renderRewards(rewards: readonly IZCSettlementReward[]): void {
        this.rewards = rewards;
        this.rewardList.setTotalCount(rewards.length);
        // 条数变化后可能停在越界位置；回到顶部（不播动画）。
        this.rewardList.scrollToTop(false);
    }

    /** 把一个奖励填进槽位（新建的或回收来的都要**全量**赋值，别留上一局的数量/图标）。 */
    private renderReward(node: Node, index: number): void {
        // 组件由 `itemPrefab` 焊死、下标由 `setTotalCount` 限死，两处都不可能为空。
        node.getComponent(RewardItemView)!.render(this.rewards[index]);
    }

    /**
     * 「双倍奖励」与「变强途径」的显隐口径（与 `renderRank` 的 `hasRank` 同一套思路）：
     *  - 双倍按钮**常显但按 `hasDoubleReward` 置灰**：它在设计稿里是奖励区中间那一段，
     *    藏掉两侧 `RewardLineL/R` 会断开 ⇒ 一律显示，只在没接线时 `interactable = false`；
     *  - 变强途径**整组收起**：只收入口会剩一个空标题框，比死按钮更奇怪。
     */
    private renderEntryGroups(data: IZCSettlementOptions): void {
        this.doubleButton.node.active = true;
        this.doubleButton.interactable = Boolean(data.hasDoubleReward);
        this.growGroup.active = Boolean(data.hasGrowEntry);
    }
}
