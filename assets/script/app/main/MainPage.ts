import { _decorator, Button, Component, Node } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
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

    @property({ type: ChestBar, tooltip: 'ChestBar：底部宝箱栏（4 格，蓝湖「塔防主界面-2」）' })
    chestBar: ChestBar = null!;

    private readonly treasureRepository = new NewTreasureRepository();
    private readonly emptyChestSlots: readonly IChestSlotData[] = Array.from({ length: CHEST_SLOT_COUNT }, (_, index) => ({
        index,
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
        ProcedureManager.navigate(GameRoute.Matching);
    }

    private renderChests(data: readonly IChestSlotData[]): void {
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
            this.onStartGame();
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
