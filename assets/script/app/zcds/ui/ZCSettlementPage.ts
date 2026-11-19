import { _decorator, Button, Label, Node, Prefab, Sprite } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { VirtualScrollView } from '../../../vscrollview/VScrollView';
import { RewardItemView, type IRewardItemData } from '../../common/RewardItemView';
import { loadIdArtByRel } from '../../itemdetail/ItemDetailArtLoader';
import { ZCGameUiEvent } from '../view/ZCGameHudEvents';
import type { IZCSettlementMvp } from '../model/ZCSettlementMvp';
import { ZC_SETTLEMENT_STYLE } from '../model/ZCSettlementStyle';
import { ZCSettlementLayout } from '../view/ZCSettlementLayout';
import { ZCSettlementMvpActor } from '../view/ZCSettlementMvpActor';
import { EventMgr } from '../../../framework/event/EventMgr';
import { bundleForPath } from '../../../core/asset/BundleCatalog';

const { ccclass, property } = _decorator;

/** 结算页的两态（图标文案里的「战斗胜利 / 战斗失败」走美术，不写文字）。*/
export type ZCSettlementOutcome = 'victory' | 'defeat';

/**
 * 一个奖励格：公共奖励格 `ui/common/RewardItem.prefab` 的数据。
 *
 * 宿主只喂 `resId` + `amount`，图标 / 品质框 / 数量由 `RewardItemView` 自己解析
 * （与宝箱详情、关卡界面、玩家关卡弹窗共用同一份口径，见 `common/RewardItemView.ts`）。
*/
export type IZCSettlementReward = IRewardItemData;

/** `ZCSettlementPage.open` 的 userData。*/
export interface IZCSettlementOptions {
    /** 胜负：决定标题套图（`image/settlement/` 两套）。*/
    readonly victory: boolean;
    /** 段位名（`grade.json` 的 `gradeName`）；空 = 整行收起。*/
    readonly rankName?: string;
    /** 段位积分 `12/100`。*/
    readonly scoreText?: string;
    /** 本局加分 `+100`。*/
    readonly addScoreText?: string;
    /** 段位条进度 0~1（缺省 0）。*/
    readonly rankProgress?: number;
    /** 段位说明（「本次战斗段位获得100积分」）。*/
    readonly rankHint?: string;
    /** 通关奖励（条数不限；虚拟列表按视口铺槽位）。宿主只给 `resId` + `amount`。*/
    readonly rewards?: readonly IZCSettlementReward[];
    /**
     * 是否接了「双倍奖励」。缺省 / `false` ⇒ `BtnDouble` 常显但置灰（不收起，见 `renderEntryGroups`）。
     *
     * 它只回答「点了有没有人接」，行为本身由控制器订阅 `SettlementDoubleReward` 决定。
    */
    readonly hasDoubleReward?: boolean;
    /**
     * MVP 卡片数据（`buildSettlementMvp` 的产物）。缺省 / `null` ⇒ 整组收起。
     *
     * 文案与进度都由模型算好（见 `model/ZCSettlementMvp.ts`），页面只负责摆 prefab、挂骨骼模型。
    */
    readonly mvp?: IZCSettlementMvp | null;
    //  所有按钮都不走回调：页面只 `EventMgr.instance.emit(...)`，「回主界面 / 换流程 /
    //  双倍 / 查看完整队伍」全由控制器订阅后处理（契约见 `view/ZCGameHudEvents.ts`）。回调那套
    //  要求调用方把流程入口塞进视图，漏传一个就是「点了没反应且零报错」。
}

/**
 * 对局结算页（挂在 `ZCSettlement.prefab` 根节点上）。
 *
 * 结构按蓝湖「结算-MVP」稿（720×1610）：标题套图 → MVP 卡片 → 段位行 → 通关奖励 → 底部按钮。
 * 胜负两稿同一骨架，只有标题套图不同；结构 / 尺寸 / 美术全在 prefab，代码只按数据刷文案、
 * 标题图、MVP 卡、段位条与奖励格。段位行无数据时由根节点的 `ZCSettlementLayout` 按行高
 * 把奖励区上移补位（基准 Y 仍从 prefab 读，不在页面另写坐标）。奖励格复用公共奖励格 `ui/common/RewardItem.prefab`（`RewardItemView`
 * 自己解析图标 / 品质框 / 数量，宿主只喂 `resId` + `amount`），奖励区是虚拟列表
 * （视窗 / 模板 / 5 列等参数都在 prefab 里），代码只喂条数。全屏遮罩 `Dim` 是纯 prefab 件、
 * 代码不碰 —— 改回 `cc.Graphics` 手画会在长屏上下各漏 165px。
 *
 * 三条不可绕过的约定：
 * 1. 页面自己不关、也不改流程，只派发意图事件；`canCloseOnBlank()` 恒 `false`
 * （关页 = `settlementOpened` 置死后再也弹不出来 = 卡死）。真正关页的是
 * `ZCGame.onSettlementConfirm`：先 `close()` 再 `navigate`，切流被取消时它负责把页面补回来
 * —— 所以别在这里改成 `this.close()`。
 * 2. 按钮一律只 `emit` 事件（`SettlementConfirm` / `SettlementDoubleReward` /
 * `SettlementViewTeam`），控制器订阅后处理；页面不持有任何回调。
 * 3. 没接线的功能不留死按钮：`hasDoubleReward` 缺省就置灰、`mvp` 缺省整组收起
 * （与 `renderRank` 的 `hasRank` 同一口径）。
*/
@ccclass('ZCSettlementPage')
export class ZCSettlementPage extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。*/
    static prefabPath = 'ui/game/ZCSettlement';

    /**
     * 不播统一离场过渡（见 `PopupBase.motionEnabled` 的两类例外：自带编排的大页）。
     *
     * ⚠️ 不是观感问题：`PopupBase._internalClose` 里 `resourceScope.dispose()` 是**同步**的，
     * 页面自己 load 的帧（奖励图标 / MVP 骨骼 prefab）在下一个 `EVENT_AFTER_DRAW` 就 `decRef`
     * 归零销毁；离场过渡却让节点再活 0.16s（`UIMotion` 的 exit 时长）继续提交渲染 ⇒
     * `Batcher2D` 每帧报 `frame should not be invalid, it may have been released`
     * 并在 `SpriteFrame.getGFXTexture()` 上空指针（`_texture` 已被解绑）。
     */
    motionEnabled = false;

    @property({ type: Sprite, group: '标题', tooltip: 'Panel/TitlePlate：胜利/失败的标题底板' })
    titlePlate: Sprite = null;

    @property({ type: Sprite, group: '标题', tooltip: 'Panel/TitlePlate/TitleText：胜利/失败的标题字' })
    titleText: Sprite = null;

    @property({ type: Node, group: 'MVP', tooltip: 'Panel/MvpBlock：MVP 整组（无数据时收起）' })
    mvpGroup: Node = null;

    @property({ type: Node, group: 'MVP', tooltip: 'MvpBlock/MvpActor：MVP 骨骼立绘位（本局赢家输出最高卡，播 idle）' })
    mvpActor: Node = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpLevel：Lv.x（非本机时收起）' })
    mvpLevel: Label = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpName：MVP 名字' })
    mvpName: Label = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpDealtRate：总输出百分比' })
    mvpDealtRate: Label = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpDealtBar/MvpDealtValue：总输出数值' })
    mvpDealtValue: Label = null;

    @property({ type: Sprite, group: 'MVP', tooltip: 'MvpBlock/MvpDealtBar/MvpDealtFill：总输出进度（FILLED）' })
    mvpDealtFill: Sprite = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpTakenRate：总承伤百分比' })
    mvpTakenRate: Label = null;

    @property({ type: Label, group: 'MVP', tooltip: 'MvpBlock/MvpTakenBar/MvpTakenValue：总承伤数值' })
    mvpTakenValue: Label = null;

    @property({ type: Sprite, group: 'MVP', tooltip: 'MvpBlock/MvpTakenBar/MvpTakenFill：总承伤进度（FILLED）' })
    mvpTakenFill: Sprite = null;

    @property({ type: Button, group: 'MVP', tooltip: 'MvpBlock/TeamButton：查看完整队伍' })
    teamButton: Button = null;

    @property({ type: Node, group: '段位', tooltip: 'Panel/RankRow：段位行整组（无数据时收起）' })
    rankRow: Node = null;

    @property({ type: Sprite, group: '段位', tooltip: 'RankRow/RankIcon' })
    rankIcon: Sprite = null;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankName：段位名' })
    rankName: Label = null;

    @property({ type: Sprite, group: '段位', tooltip: 'RankRow/RankBar/RankFill：段位进度（FILLED）' })
    rankFill: Sprite = null;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankScore：12/100' })
    rankScore: Label = null;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankAdd：+100' })
    rankAdd: Label = null;

    @property({ type: Label, group: '段位', tooltip: 'RankRow/RankHint：本次战斗段位获得100积分' })
    rankHint: Label = null;

    @property({ type: VirtualScrollView, group: '奖励', tooltip: 'Panel/RewardSection/RewardScroll：通关奖励虚拟列表（模板 = content/Slot）' })
    rewardList: VirtualScrollView = null;

    @property({ type: Button, group: '底部', tooltip: 'BtnDouble：双倍奖励' })
    doubleButton: Button = null;

    @property({ type: Button, group: '底部', tooltip: 'BtnConfirm：确定' })
    confirmButton: Button = null;

    /** 段位行收起时的奖励区补位（prefab 根节点上的布局组件；取不到就不补）。*/
    private layout: ZCSettlementLayout | null = null;

    /** 本趟要显示的奖励（`renderItemFn` 按下标现取 —— 禁止闭包捕获，槽位会跨趟复用）。*/
    private rewards: readonly IZCSettlementReward[] = [];
    /** 标题套图的加载代号：两态切换 / 关闭后到达的异步结果要丢掉。*/
    private titleRevision = 0;
    /** MVP 骨骼的加载代号：同桌复用、两局连开时丢掉上一趟迟到的 prefab。*/
    private mvpRevision = 0;
    /** MVP 立绘位的模型包装（懒建；宿主节点随页面常驻）。*/
    private mvpPreview: ZCSettlementMvpActor | null = null;
    /** 「确定」防重复提交：连点两下只发一次收尾（收尾多半是切流程，重复发等于 navigate 两次）。*/
    private confirming = false;

    protected onInit(): void {
        // 回调与按钮监听都只在实例生命周期内绑一次（`PopupBase` 保证首次打开前调一次）：
        // 虚拟列表要给 `.bind(this)`（`VScrollView` 是方法调用语法，不绑 `this` 会是它自己）；
        // 按钮用「具名方法 + this 作 target」，将来要 `off` 有稳定引用，箭头闭包做不到。
        this.rewardList.renderItemFn = this.renderReward.bind(this);
        this.layout = this.node.getComponent(ZCSettlementLayout);
        this.doubleButton.node.on(Button.EventType.CLICK, this.onDoubleRewardClicked, this);
        this.confirmButton.node.on(Button.EventType.CLICK, this.onConfirmClicked, this);
        this.teamButton.node.on(Button.EventType.CLICK, this.onViewTeamClicked, this);
    }

    /** 这一页不留 userData：所有意图都派发出去，页面不需要记得「谁接的」。*/
    protected onOpen(userData?: IZCSettlementOptions): void {
        if (!userData) return;
        this.confirming = false;
        this.renderMvp(userData.mvp ?? null);
        this.renderRank(userData);
        this.renderRewards(userData.rewards ?? []);
        this.renderEntryGroups(userData);
        void this.applyTitle(userData.victory ? 'victory' : 'defeat');
    }

    protected onClose(_reason: PopupCloseReason): void {
        // 关掉后异步回来的标题图 / 模型不许再写（槽位会被下一局复用）。
        this.titleRevision += 1;
        this.mvpRevision += 1;
        this.mvpPreview?.clear();
        this.layout?.reset();
    }

    /** 结算页绝不允许被空白关闭：那是绕过「确定」⇒ 页面消失、对局还开着、再也弹不回来。*/
    protected canCloseOnBlank(): boolean {
        return false;
    }

    // 按钮响应：全部只派发意图，页面不持有回调（见类头注 2.）

    private onDoubleRewardClicked(): void {
        EventMgr.instance.emit(ZCGameUiEvent.SettlementDoubleReward);
    }

    /**
     * 查看完整队伍：结算期 `phase.isSettled` 已置位，运行期的 `OpenDamageStats` 入口会直接 return，
     * 所以这里派一条结算自己的事件，由结算控制器用同一套 `openDamage(players)` 弹统计面板。
    */
    private onViewTeamClicked(): void {
        EventMgr.instance.emit(ZCGameUiEvent.SettlementViewTeam);
    }

    /** 确定：连点两下只派发一次（收尾是切流程，重复发等于 navigate 两次）。*/
    private onConfirmClicked(): void {
        if (this.confirming) return;
        this.confirming = true;
        EventMgr.instance.emit(ZCGameUiEvent.SettlementConfirm);
    }

    // 渲染
    

    /** 标题套图：异步加载完才换；加载期间保留 prefab 默认那套（先清空会闪一帧空底板）。*/
    private async applyTitle(outcome: ZCSettlementOutcome): Promise<void> {
        const revision = ++this.titleRevision;
        const rel = ZC_SETTLEMENT_STYLE.title[outcome];
        const [plate, text] = await Promise.all([
            loadIdArtByRel(rel.plate),
            loadIdArtByRel(rel.text),
        ]);
        // 期间换了态 / 弹窗已关 / 节点已销毁 ⇒ 丢弃这次结果。
        if (revision !== this.titleRevision || !this.isValid) return;
        if (plate) this.titlePlate.spriteFrame = plate;
        if (text) this.titleText.spriteFrame = text;
    }

    /**
     * MVP 卡片：整组显隐 + 全量文案/进度；骨骼模型异步补。
     *
     * 「没数据」有两种：`mvp` 为 `null`（统计缺失 / 全员 0 输出）⇒ 整组收起，不留空框；
     * `prefabPath` 为空（兵种目录里没配美术）⇒ 立绘位留空，但名字 / 进度照常显示。
    */
    private renderMvp(mvp: IZCSettlementMvp | null): void {
        // 每次换数据都换代号：上一趟还在 loading 的模型到了也不许写进来。
        const revision = ++this.mvpRevision;
        this.mvpGroup.active = Boolean(mvp);
        this.mvpPreview?.clear();
        if (!mvp) return;
        //  等级只有服务端 `battle.units[].heroes[].level` 才有（本地局拿不到）⇒ 无值时整块收起，
        //  不留一个孤零零的 `Lv.`。
        this.mvpLevel.node.active = Boolean(mvp.levelText);
        this.mvpLevel.string = mvp.levelText;
        this.mvpName.string = mvp.name;
        this.mvpDealtRate.string = mvp.dealtRateText;
        this.mvpDealtValue.string = mvp.dealtText;
        this.mvpDealtFill.fillRange = mvp.dealtRate;
        this.mvpTakenRate.string = mvp.takenRateText;
        this.mvpTakenValue.string = mvp.takenText;
        this.mvpTakenFill.fillRange = mvp.takenRate;
        this.mvpActor.active = Boolean(mvp.prefabPath);
        if (mvp.prefabPath) void this.applyMvpActor(mvp, revision);
    }

    /**
     * 骨骼模型：`prefabPath` → 本局兵种 prefab（和对局内单位同一份资源）→ 立绘位播 idle。
     *
     * 加载期间立绘位留空，到货再挂；迟到的结果按代号 + `resourceScope.disposed` 丢弃。
     * 美术契约不符（缺 `spine` / 缺 `idle`）只让立绘位空着并告警，不能把整张结算页挂掉。
    */
    private async applyMvpActor(mvp: IZCSettlementMvp, revision: number): Promise<void> {
        const scope = this.resourceScope;
        const prefab = await this.assets.load(mvp.prefabPath, Prefab, {
            scope, bundle: bundleForPath(mvp.prefabPath),
        });
        if (!this.isValid || scope.disposed || revision !== this.mvpRevision) return;
        try {
            this.mvpPreview ??= new ZCSettlementMvpActor(this.mvpActor);
            this.mvpPreview.show(prefab, mvp.prefabSize);
        } catch (error) {
            this.mvpPreview.clear();
            console.warn('[ZCSettlementPage] MVP 骨骼模型不可用', error);
        }
    }

    /** 段位行：整组显隐（没段位数据就收起，别留一行空框）。*/
    private renderRank(data: IZCSettlementOptions): void {
        const hasRank = Boolean(data.rankName);
        this.rankRow.active = hasRank;
        this.layout?.apply(hasRank);
        if (!hasRank) return;
        this.rankName.string = data.rankName;
        this.rankScore.string = data.scoreText ?? '';
        this.rankAdd.string = data.addScoreText ?? '';
        this.rankHint.string = data.rankHint ?? '';
        this.rankFill.fillRange = Math.max(0, Math.min(1, data.rankProgress ?? 0));
    }

    /** 通关奖励：只喂条数；内容由 {@link renderReward} 按下标现取（闭包捕获会留上一局的数组）。*/
    private renderRewards(rewards: readonly IZCSettlementReward[]): void {
        this.rewards = rewards;
        this.rewardList.setTotalCount(rewards.length);
        // 条数变化后可能停在越界位置；回到顶部（不播动画）。
        this.rewardList.scrollToTop(false);
    }

    /** 把一个奖励填进槽位（新建的或回收来的都要全量赋值，别留上一局的数量/图标）。*/
    private renderReward(node: Node, index: number): void {
        // 组件由 `itemPrefab` 焊死、下标由 `setTotalCount` 限死，两处都不可能为空。
        node.getComponent(RewardItemView).render(this.rewards[index]);
    }

    /**
     * 「双倍奖励」的显隐口径（与 `renderRank` 的 `hasRank` 同一套思路）：
     * 按钮常显但按 `hasDoubleReward` 置灰：它在设计稿里是奖励区的中间那一段，
     * 藏掉两侧 `RewardLineL/R` 会断开 ⇒ 一律显示，只在没接线时 `interactable = false`。
    */
    private renderEntryGroups(data: IZCSettlementOptions): void {
        this.doubleButton.node.active = true;
        this.doubleButton.interactable = Boolean(data.hasDoubleReward);
    }
}
