import { _decorator, Button, Component, Node, Sprite, SpriteFrame } from 'cc';
import type { AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { EventMgr } from '../../framework/event/EventMgr';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_CHAPTER_BATTLE_SUB_TREASURE } from '../battle/BattleStartModel';
import type { IMatchingEntryParams } from '../matching/MatchTypes';
import { spriteFramePathOf } from '../ArtPaths';
import { qualityFrameArtPath } from '../itemdetail/ItemDetailArt';
import { qualityFrameSuffixOf, qualityNameOf } from '../itemdetail/ItemDetailTable';
import { ChestBar } from './ChestBar';
import { PopupManager } from '../../framework/ui/PopupManager';
import { ChestDetailPanel } from './ChestDetailPanel';
import type { IChestDetailContent } from './ChestDetailPanel';
import { CHEST_EVENTS } from './ChestEvents';
import {
    CHEST_EMPTY_SLOT_STAMINA_COST, CHEST_SLOT_COUNT, ChestSlotAction, ChestSlotState, formatChestCountdown,
} from './ChestTypes';
import type { IChestDetailData, IChestSlotData } from './ChestTypes';
import { NewTreasureRepository } from './NewTreasureRepository';
import { GameNet } from '../net/GameNet';

const { ccclass, property } = _decorator;

const MAIN_PAGE_TEXTS = {
    treasureUnavailable: '宝箱数据暂不可用',
    treasureLoadFailed: '宝箱数据加载失败',
    networkUnavailable: '网络未连接',
    actionFailed: '操作失败，请稍后重试',
    openProtocolMissing: '开箱协议消息号未配置',
    bossMapUnavailable: '关卡地图未就绪',
} as const;

/**
 * 主城页交互入口。
 *
 * 领地主 tab 内嵌在主界面；底部宝箱状态从服务端读取并由协议广播刷新。
 */
@ccclass('MainPage')
export class MainPage extends Component {
    @property({ type: Node, tooltip: 'BeginGame：快速寻敌按钮' })
    startButton: Node = null!;

    @property({ type: Node, tooltip: 'ChestEntry：打开 / 收起底部宝箱栏' })
    chestToggle: Node = null!;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell0：第一个宝箱数量格' })
    chestCell0: Sprite = null!;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell1：第二个宝箱数量格' })
    chestCell1: Sprite = null!;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell2：第三个宝箱数量格' })
    chestCell2: Sprite = null!;

    @property({ type: Sprite, tooltip: 'BottomHud/Cell3：第四个宝箱数量格' })
    chestCell3: Sprite = null!;

    @property({ type: SpriteFrame, tooltip: '宝箱数量格：已占用（绿色）' })
    chestCellFilled: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '宝箱数量格：空闲（灰色）' })
    chestCellEmpty: SpriteFrame = null!;

    @property({ type: ChestBar, tooltip: 'ChestBar：底部宝箱栏（4 格，蓝湖「塔防主界面-2」）' })
    chestBar: ChestBar = null!;

    private findCurrentBoss: (() => void) | null = null;
    private readonly treasureRepository = new NewTreasureRepository();
    /** 详情弹窗当前对应的槽位（1~4）与那颗按钮要发的动作；`0` = 没开。 */
    private detailSlot = 0;
    private detailAction: ChestSlotAction = ChestSlotAction.Open;
    /** `initialize` 注入的资源入口（宝箱图标 / 品质框）。 */
    private assets: AssetService | null = null;
    /** 图标按路径缓存（同一批奖励反复加载同一张图不值得）。 */
    private readonly chestIconCache = new Map<string, SpriteFrame>();
    private readonly chestArtScope = new ResourceScope('main:chest-detail-art');
    private readonly emptyChestSlots: readonly IChestSlotData[] = Array.from({ length: CHEST_SLOT_COUNT }, (_, index) => ({
        index: index + 1,
        state: ChestSlotState.Empty,
        name: '',
        remainSeconds: 0,
        totalSeconds: 0,
        action: ChestSlotAction.Battle,
        cost: CHEST_EMPTY_SLOT_STAMINA_COST,
    }));

    onLoad(): void {
        this.startButton.on(Button.EventType.CLICK, this.onStartGame, this);
        this.chestToggle.on(Button.EventType.CLICK, this.onToggleChestPanel, this);
        // 宝箱栏的意图（点格子 / 收起 / 翻页）都由 EventMgr 派发，页面**只订阅一次**
        EventMgr.instance.on(CHEST_EVENTS.SLOT_ACTION, this.onChestAction, this);
        EventMgr.instance.on(CHEST_EVENTS.COLLAPSE, this.onChestCollapse, this);

        // 宝箱详情走 `PopupBase`（`PopupManager` 管层级 / 遮罩 / 点空白关闭 / 尺寸），
        // 页面**不实例化、不撑尺寸**，只订阅它的三条意图。
        EventMgr.instance.on(CHEST_EVENTS.CLOSE, this.onChestDetailClose, this);
        EventMgr.instance.on(CHEST_EVENTS.FAST_OPEN, this.onChestDetailFastOpen, this);
        EventMgr.instance.on(CHEST_EVENTS.OPEN, this.onChestDetailOpen, this);
    }

    /** 注入资源入口（宿主 `MainTabHost` 在 `setParent` 之前调）。 */
    initialize(assets: AssetService): void {
        this.assets = assets;
    }

    /** 由主界面宿主接入同页地图，避免快速寻敌另开战斗流程。 */
    bindFindCurrentBoss(handler: () => void): void {
        this.findCurrentBoss = handler;
    }

    start(): void {
        this.renderChests(this.emptyChestSlots);
        this.chestBar.setOpen(false, false);
        this.startButton.active = true;
        void this.loadTreasureQueue();
    }

    onEnable(): void {
        this.schedule(this.refreshTreasureDisplay, 1);
    }

    onDisable(): void {
        this.unschedule(this.refreshTreasureDisplay);
    }

    onDestroy(): void {
        if (this.detailSlot > 0) PopupManager.inst?.get(ChestDetailPanel)?.close();
        this.chestArtScope.dispose();
        this.chestIconCache.clear();
        EventMgr.instance.offTarget(this);
        this.findCurrentBoss = null;
        this.treasureRepository.dispose();
        GameNet.instance.removeCaller(this);
    }

    private async loadTreasureQueue(): Promise<void> {
        const result = await this.treasureRepository.load(this, (slots) => this.renderChests(slots));
        if (!this.isValid) return;
        if (result === 'offline') FW.showTip(MAIN_PAGE_TEXTS.treasureUnavailable);
        else if (result === 'failed') FW.showTip(MAIN_PAGE_TEXTS.treasureLoadFailed);
    }

    private onToggleChestPanel(): void {
        this.setChestPanelOpen(!this.chestBar.opened);
    }

    /** 宝箱展开时收起快速寻敌按钮，避免两个战斗入口互相遮挡。 */
    private setChestPanelOpen(open: boolean): void {
        if (!this.chestBar) return;
        this.chestBar.setOpen(open);
        this.startButton.active = !open;
    }

    private onStartGame(): void {
        if (!this.findCurrentBoss) {
            FW.showTip(MAIN_PAGE_TEXTS.bossMapUnavailable);
            return;
        }
        this.findCurrentBoss();
    }

    private renderChests(data: readonly IChestSlotData[]): void {
        const count = data.reduce((total, slot) => total + Number(slot.state !== ChestSlotState.Empty), 0);
        const cells = [this.chestCell0, this.chestCell1, this.chestCell2, this.chestCell3];
        for (let index = 0; index < cells.length; index++) {
            cells[index].spriteFrame = index < count ? this.chestCellFilled : this.chestCellEmpty;
        }
        if (!this.chestBar) return;
        this.chestBar.render(data);
    }

    /** 宝箱栏收起（点折叠箭头 / 左箭头在展开态）。 */
    private readonly onChestCollapse = (): void => { this.setChestPanelOpen(false); };

    private readonly refreshTreasureDisplay = (): void => {
        this.renderChests(this.treasureRepository.slots);
        this.refreshChestDetailCountdown();
    };

    /** 弹窗开着时每秒刷一次倒计时（只写那一颗按钮，不整窗重开）。 */
    private refreshChestDetailCountdown(): void {
        const panel = PopupManager.inst?.get(ChestDetailPanel);
        if (!panel || this.detailSlot <= 0) return;
        const detail = this.treasureRepository.detailOf(this.detailSlot);
        if (!detail) {
            // 槽位没了（刚开完箱）⇒ 收起弹窗，别指着一个空槽
            panel.close();
            return;
        }
        this.detailAction = detail.action;
        panel.updateCountdown(detail.remainSeconds, detail.action === ChestSlotAction.SpeedUp);
    }

    private async onChestAction(slot: number): Promise<void> {
        const item = this.treasureRepository.slots[slot];
        if (!item) return;
        if (item.action === ChestSlotAction.Battle) {
            const entry: IMatchingEntryParams = {
                battleType: ZC_BATTLE_TYPE_CHAPTER,
                battleParams: [String(ZC_CHAPTER_BATTLE_SUB_TREASURE)],
            };
            ProcedureManager.navigate(GameRoute.Matching, entry);
            return;
        }
        // 2026-10-27（蓝湖「宝箱详情」）：非空槽位**先弹详情**，让玩家看见能开出什么、
        // 立即开要花多少，再由弹窗的两颗按钮发请求。原来这里是点一下直接发
        // activate / fastOpen / open 三条之一，全程没有确认也没有奖励预览。
        await this.openChestDetail(item.index);
    }

    // ============================================================
    // 宝箱详情弹窗
    // ============================================================

    private async openChestDetail(index: number): Promise<void> {
        const detail = this.treasureRepository.detailOf(index);
        if (!detail) return;
        this.detailSlot = index;
        this.detailAction = detail.action;
        const content = await this.chestDetailContentOf(detail);
        if (!this.isValid) return;
        // 加载期间玩家可能又点了别的箱子（或关了弹窗）⇒ 以最新那次为准
        if (this.detailSlot !== index) return;
        const opened = PopupManager.inst?.get(ChestDetailPanel);
        if (opened) { opened.applyContent(content); return; }
        void ChestDetailPanel.open({ userData: content });
    }

    private async chestDetailContentOf(detail: IChestDetailData): Promise<IChestDetailContent> {
        const [icon, frame, rewards] = await Promise.all([
            this.loadChestFrame(detail.icon),
            this.loadQualityFrame(detail.quality),
            // 奖励格只要 id + 数量，图标/品质框由 `RewardItemView` 自己解析
            detail.rewards.map((reward) => ({
                resId: reward.resId,
                amount: reward.amount,
                ratePercent: reward.ratePercent,
            })),
        ]);
        const counting = detail.action === ChestSlotAction.SpeedUp;
        const activated = detail.action !== ChestSlotAction.Activate;
        return {
            name: detail.name,
            qualityText: `品质：${qualityNameOf(null, detail.quality)}`,
            // 银币图标用 prefab 上的静态帧（弹窗只在传了帧时才覆盖）
            costIcon: null,
            // 协议没有「持有数量」字段（`CmdNewTreasureInfo` 只有 cardBoxID/openTime/index）
            // ⇒ 按「一个槽位一个宝箱」固定 1（山猫 2026-10-27 口径）。
            countText: '数量：1',
            icon,
            qualityFrame: frame,
            rewards,
            fastOpenCost: detail.fastOpenCost,
            // 未激活时也能花银币直接开（跳过倒计时）；空槽位走不到这里。
            fastOpenEnabled: true,
            openCaption: '打开',
            openCountdown: detail.remainSeconds > 0 ? formatChestCountdown(detail.remainSeconds) : '',
            // 倒计时中不能开（要么等、要么点「立即打开」）；未激活时这颗 = 开始计时。
            openEnabled: !counting && (activated || detail.remainSeconds >= 0),
        };
    }

    /** 图标按路径缓存；缺图返回 `null`（那一枚没图，不影响其它格）。 */
    private async loadChestFrame(path: string): Promise<SpriteFrame | null> {
        if (!path || this.chestArtScope.disposed) return null;
        const cached = this.chestIconCache.get(path);
        if (cached?.isValid) return cached;
        this.chestIconCache.delete(path);
        const assets = this.assets;
        if (!assets) return null;
        try {
            const frame = await assets.load(spriteFramePathOf(path), SpriteFrame, { scope: this.chestArtScope });
            if (this.chestArtScope.disposed || !frame.isValid) return null;
            this.chestIconCache.set(path, frame);
            return frame;
        } catch (error) {
            console.warn(`[MainPage] 宝箱详情图标加载失败：${path}`, error);
            return null;
        }
    }

    private async loadQualityFrame(quality: number): Promise<SpriteFrame | null> {
        return this.loadChestFrame(`image/${qualityFrameArtPath(qualityFrameSuffixOf(quality))}`);
    }

    private readonly onChestDetailClose = (): void => {
        this.detailSlot = 0;
    };

    private readonly onChestDetailFastOpen = (): void => {
        void this.runTreasureAction('fastOpen');
    };

    private readonly onChestDetailOpen = (): void => {
        // 「打开」在未激活状态 = 开始计时；到点状态 = 开箱。
        if (this.detailAction === ChestSlotAction.Activate) void this.runTreasureAction('activate');
        else if (this.detailAction === ChestSlotAction.Open) void this.runTreasureAction('open');
    };

    /**
     * 发请求 + 收尾。
     *
     * 激活成功后在当前弹窗继续显示倒计时；真正开箱后关闭对应详情。
     */
    private async runTreasureAction(kind: 'activate' | 'fastOpen' | 'open'): Promise<void> {
        const index = this.detailSlot;
        if (index <= 0) return;
        const result = kind === 'activate'
            ? await this.treasureRepository.activate(index)
            : (kind === 'fastOpen'
                ? await this.treasureRepository.fastOpen(index)
                : await this.treasureRepository.open(index));
        if (!this.isValid || this.detailSlot !== index) return;
        if (result === 'busy') return;
        if (result === 'ok') {
            if (kind === 'activate') this.refreshChestDetailCountdown();
            else PopupManager.inst?.get(ChestDetailPanel)?.close();
            return;
        }
        if (result === 'offline') FW.showTip(MAIN_PAGE_TEXTS.networkUnavailable);
        else if (result === 'failed') FW.showTip(MAIN_PAGE_TEXTS.actionFailed);
        else if (result === 'protocol-missing') FW.showTip(MAIN_PAGE_TEXTS.openProtocolMissing);
    }
}
