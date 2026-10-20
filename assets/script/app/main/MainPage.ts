import { _decorator, Button, Component, Node } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { FW } from '../../framework/FW';
import { ChestBar, ChestSlotAction, ChestSlotState, IChestSlotData } from './ChestBar';

const { ccclass, property } = _decorator;

/**
 * 主城底部宝箱栏的**占位数据**（协议未接）。
 *
 * 形态完全照蓝湖「塔防主界面-2」的四格：
 * `蓝(24h) / 空槽位(⚡50 开始战斗) / 金(开启) / 蓝(04:11:05 加速)`。
 * 接协议后整块替换成服务端队列数据，`ChestBar` / `ChestSlotView` 不用动。
 */
const CHEST_PLACEHOLDER: readonly IChestSlotData[] = [
    {
        state: ChestSlotState.Counting,
        name: '宝箱名字',
        remainSeconds: 24 * 3600,
        totalSeconds: 24 * 3600,
        action: ChestSlotAction.Open,
        cost: 0,
    },
    {
        state: ChestSlotState.Empty,
        name: '',
        remainSeconds: 0,
        totalSeconds: 0,
        action: ChestSlotAction.Battle,
        cost: 50,
    },
    {
        state: ChestSlotState.Ready,
        name: '宝箱名字',
        remainSeconds: 0,
        totalSeconds: 0,
        action: ChestSlotAction.Open,
        cost: 0,
    },
    {
        state: ChestSlotState.Counting,
        name: '宝箱名字',
        remainSeconds: 4 * 3600 + 11 * 60 + 5,
        totalSeconds: 24 * 3600,
        action: ChestSlotAction.SpeedUp,
        cost: 0,
    },
];

/**
 * 主城页组件：交互入口。
 *
 * 2026-10-19 起 `ui/main/ArenaRoot` 是**主城页**（领地主 tab，内嵌六边格领地图）；
 * 底部宝箱栏（`ChestBar`）按需展开，占位数据见 `CHEST_PLACEHOLDER`。
 */
@ccclass('MainPage')
export class MainPage extends Component {
    @property({ type: Node, tooltip: 'BeginGame：快速寻敌按钮' })
    startButton: Node = null!;

    @property({ type: Node, tooltip: 'ChestEntry：打开 / 收起底部宝箱栏' })
    chestToggle: Node = null!;

    @property({ type: ChestBar, tooltip: 'ChestBar：底部宝箱栏（4 格，蓝湖「塔防主界面-2」）' })
    chestBar: ChestBar = null!;

    onLoad(): void {
        this.startButton.on(Button.EventType.CLICK, this.onStartGame, this);
        this.chestToggle.on(Button.EventType.CLICK, this.onToggleChestPanel, this);
    }

    /**
     * ⚠️ 宝箱栏放到 `start()`：`onLoad` 是父先子后，`MainPage` 挂在页根，
     * 在 `onLoad` 里铺宝箱会在 `ChestBar` 装配槽位之前跑（实测 4 格停在 prefab 默认态）。
     */
    start(): void {
        this.renderChests();
        this.chestBar.setOpen(false, false);
        this.startButton.active = true;
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

    /**
     * 铺宝箱栏。
     *
     * ⚠️ 现在是**占位数据**：宝箱队列协议（开启 / 开始战斗 / 加速）还没接，
     * 先把 UI 落地；接协议时把 `CHEST_PLACEHOLDER` 换成服务端下发的列表即可。
     */
    private renderChests(): void {
        if (!this.chestBar) return;
        this.chestBar.render(CHEST_PLACEHOLDER, (index) => {
            const item = CHEST_PLACEHOLDER[index];
            if (!item) return;
            const text = item.action === ChestSlotAction.Battle ? '宝箱队列还没接服务器'
                : (item.action === ChestSlotAction.SpeedUp ? '加速还没接服务器' : '开启还没接服务器');
            FW.showTip(text);
        });
    }
}
