import { _decorator, Button, Component, Node, Sprite, SpriteFrame } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { ZC_BATTLE_TYPE_CHAPTER, ZC_CHAPTER_BATTLE_SUB_TREASURE } from '../battle/BattleStartModel';
import type { IMatchingEntryParams } from '../matching/MatchTypes';
import { ChestBar } from './ChestBar';
import { CHEST_EMPTY_SLOT_STAMINA_COST, CHEST_SLOT_COUNT, ChestSlotAction, ChestSlotState } from './ChestTypes';
import type { IChestSlotData } from './ChestTypes';
import { NewTreasureRepository } from './NewTreasureRepository';

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
        this.chestBar.bindCollapse(() => this.setChestPanelOpen(false));
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
        this.findCurrentBoss = null;
        this.treasureRepository.dispose();
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
        this.chestBar.render(data, (slot) => { void this.onChestAction(slot); });
    }

    private readonly refreshTreasureDisplay = (): void => {
        this.renderChests(this.treasureRepository.slots);
    };

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

        const result = item.action === ChestSlotAction.Activate
            ? await this.treasureRepository.activate(item.index)
            : (item.action === ChestSlotAction.SpeedUp
                ? await this.treasureRepository.fastOpen(item.index)
                : await this.treasureRepository.open(item.index));
        if (!this.isValid) return;
        if (result === 'busy' || result === 'ok') return;
        if (result === 'offline') FW.showTip(MAIN_PAGE_TEXTS.networkUnavailable);
        else if (result === 'failed') FW.showTip(MAIN_PAGE_TEXTS.actionFailed);
        else if (result === 'protocol-missing') FW.showTip(MAIN_PAGE_TEXTS.openProtocolMissing);
    }
}
