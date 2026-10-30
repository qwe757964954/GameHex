import { ControllerBase } from '../../../framework/controller/ControllerBase';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { bigMapOccupantOf } from '../model/BigMapWorld';
import { normalizeBigMapRoleEvent } from '../model/BigMapCampRoleInfo';
import { BIGMAP_MOVE_HINT, BigMapUiEvent, BigMapViewEvent, type BigMapIntent, type IBigMapIntentEvent,
    type BigMapViewCommand } from './BigMapEvents';
import { buildBigMapViewState, type IBigMapUiState, type IBigMapViewState } from './BigMapViewState';
import type { BigMapModel, IBigMapActionFeedback } from './BigMapModel';
import { BIGMAP_CAMP_REFRESH_SECONDS, type BigMapCampRepository } from './BigMapCampRepository';
import type { BigMapSlgRepository } from './BigMapSlgRepository';

export interface IBigMapNetworkEvents {
    addEvent(name: string, caller: object, listener: (message: unknown) => void): void;
    removeCaller(caller: object): void;
}
export interface IBigMapControllerOptions {
    readonly context: IControllerContext;
    readonly network?: IBigMapNetworkEvents;
    readonly campRepository?: BigMapCampRepository;
    readonly slgRepository?: BigMapSlgRepository;
    readonly schedule?: (callback: () => void, milliseconds: number) => () => void;
    readonly now?: () => number;
}

/** 唯一的事件编排入口：网络/Model/UI → 状态变更 → 展示事件。 */
export class BigMapController extends ControllerBase {
    private started = false;
    private disposed = false;
    private stopTimer: (() => void) | null = null;
    private readonly subscriptions: (() => void)[] = [];
    private visibleCampIds: readonly number[] = [];
    private nextCampRefreshAt = 0;
    private ui: { -readonly [K in keyof IBigMapUiState]: IBigMapUiState[K] } = {
        mode: 'world', selectedCityId: 0, selectedMonsterId: 0, selectedPlotHexId: -1, selectedBaseHexId: -1,
        pendingBuildingId: 0, pendingMoveInstanceId: 0, baseActionPending: false,
        enteringBattle: false, buildMenuVisible: false,
    };

    constructor(private readonly model: BigMapModel, private readonly options: IBigMapControllerOptions) { super(options.context, 'bigmap-controller'); }

    get snapshot(): IBigMapViewState { return buildBigMapViewState(this.model, this.ui); }

    start(): void {
        if (this.started || this.disposed) return;
        this.started = true;
        this.bindModelEvents();
        this.bindNetworkEvents();
        this.bindUiEvents();
        const schedule = this.options.schedule ?? ((callback: () => void, milliseconds: number) => {
            const timer = setInterval(callback, milliseconds);
            return () => clearInterval(timer);
        });
        this.stopTimer = schedule(() => this.tick(), 500);
    }

    initialize(): Promise<boolean> { return this.model.initializeSlg(); }
    refreshUnlockContext(): void { if (!this.disposed) this.model.refreshUnlockContext(); }

    private bindNetworkEvents(): void {
        const net = this.options.network;
        if (!net) return;
        net.addEvent('CmdSlgGameRoleInfoBroMsg', this, this.onRoleBroadcast);
        net.addEvent('CmdSlgGameInfoBroMsg', this, this.onGameBroadcast);
        net.addEvent('CmdSlgBuildInfoBroMsg', this, this.onBuildBroadcast);
        net.addEvent('reconnectSuccessAndLogin', this, this.onGameBroadcast);
    }
    private onRoleBroadcast(message: unknown): void {
        const event = normalizeBigMapRoleEvent(message);
        if (event) this.model.applyRoleEvent(event);
    }
    private onGameBroadcast(): void { this.options.slgRepository?.invalidate('game'); }
    private onBuildBroadcast(): void { this.options.slgRepository?.invalidate('build'); }

    private bindModelEvents(): void {
        this.subscriptions.push(this.model.onChanged(() => this.publish()));
        if (this.options.campRepository) this.subscriptions.push(this.options.campRepository.onChanged(() => this.model.notifyCampChanged()));
        if (this.options.slgRepository) this.subscriptions.push(this.options.slgRepository.onChanged(() => this.model.syncServerBase()));
    }
    private bindUiEvents(): void {
        EventMgr.instance.on(BigMapUiEvent.Intent, this.onIntent, this);
        EventMgr.instance.on(BigMapUiEvent.Ready, this.onViewReady, this);
        EventMgr.instance.on(BigMapUiEvent.Disposed, this.onViewDisposed, this);
    }
    private onViewDisposed(): void {
        this.dispose();
    }
    private onViewReady(): void {
        this.publish();
    }
    private publish(): void {
        EventMgr.instance.emit(BigMapViewEvent.Render, { state: this.snapshot });
    }
    private command(command: BigMapViewCommand): void {
        EventMgr.instance.emit(BigMapViewEvent.Command, { command });
    }
    private feedback(result: IBigMapActionFeedback): void {
        if (result.message) this.command({ kind: 'feedback', ...result });
    }

    private onIntent(event: IBigMapIntentEvent): void {
        const intent = event.intent;
        // 视口反馈不依赖战斗/写请求锁；它只更新下次轮询的可见集合。
        if (intent.kind === 'visibleCamps') {
            this.visibleCampIds = [...new Set(intent.campIds)].filter((id) => this.model.world.cities.has(id));
            if (this.ui.mode === 'world' && !this.ui.enteringBattle) void this.refreshVisibleCamps();
            return;
        }
        if (this.ui.enteringBattle || this.ui.baseActionPending) return;
        this.handleIntent(intent);
    }
    private handleIntent(intent: BigMapIntent): void {
        switch (intent.kind) {
            case 'worldTap': this.selectWorld(intent.hexId); break;
            case 'plotTap': this.selectPlot(intent.hexId); break;
            case 'build': this.chooseBuilding(intent.buildingKind); break;
            case 'harvest': void this.runAction(() => this.model.requestHarvest(intent.instanceId)); break;
            case 'harvestAll': void this.runAction(() => this.model.requestHarvestAll()); break;
            case 'mode': this.switchMode(intent.mode); break;
            case 'primary': this.primary(); break;
            case 'secondary': this.secondary(); break;
            case 'clear': this.clearSelection(); this.publish(); break;
            case 'toggleBuildMenu': this.ui.buildMenuVisible = !this.ui.buildMenuVisible; this.publish(); break;
        }
    }

    private switchMode(mode: IBigMapUiState['mode']): void {
        if (mode === this.ui.mode) return;
        this.ui.mode = mode;
        this.ui.buildMenuVisible = false;
        this.ui.pendingBuildingId = 0;
        this.clearSelection();
        const main = mode === 'base' ? this.model.plotCells().find((plot) => plot.buildingId === this.model.mainBuildingId) : null;
        if (main) this.ui.selectedPlotHexId = main.hexId;
        this.publish();
        if (main) this.command({ kind: 'focusBase', hexId: main.hexId });
    }
    private clearSelection(): void {
        this.ui.pendingMoveInstanceId = 0;
        this.ui.selectedCityId = 0;
        this.ui.selectedMonsterId = 0;
        this.ui.selectedPlotHexId = -1;
        this.ui.selectedBaseHexId = -1;
    }
    private selectWorld(hexId: number): void {
        const occupant = bigMapOccupantOf(this.model.world, hexId, this.model.playerBaseHexId);
        this.clearSelection();
        if (occupant.kind === 'city') {
            this.ui.selectedCityId = occupant.cityId;
            this.publish();
            if (this.model.cityView(occupant.cityId)?.isServerCamp) void this.model.refreshCampDetail(occupant.cityId);
            else void this.model.refreshCityRank(occupant.cityId);
            return;
        }
        if (occupant.kind === 'monster') this.ui.selectedMonsterId = occupant.instanceId;
        if (occupant.kind === 'base') {
            if (occupant.base.isPlayer) { this.switchMode('base'); this.feedback({ ok: true, message: '回到自己的基地' }); return; }
            this.feedback({ ok: false, message: '该玩家据点暂未开放' });
        }
        this.publish();
    }
    private selectPlot(hexId: number): void {
        const moveId = this.ui.pendingMoveInstanceId;
        if (moveId !== 0) {
            if (hexId === this.ui.selectedPlotHexId) { this.ui.pendingMoveInstanceId = 0; this.publish(); return; }
            void this.runAction(() => this.model.requestMove(moveId, hexId), () => { this.ui.pendingMoveInstanceId = 0; });
            return;
        }
        this.ui.selectedPlotHexId = hexId;
        if (this.ui.pendingBuildingId !== 0) {
            const id = this.ui.pendingBuildingId;
            void this.runAction(() => this.model.requestBuild(hexId, id), () => { this.ui.pendingBuildingId = 0; });
            return;
        }
        this.ui.buildMenuVisible = this.model.plotDetail(hexId) === null;
        this.publish();
    }
    private chooseBuilding(kind: number): void {
        if (kind === -1) { void this.runAction(() => this.model.requestUnlockBuildQueue()); return; }
        const entry = this.model.buildMenu().find((row) => row.kind === kind);
        if (!entry) return;
        if (!entry.unlocked || entry.buildingId === 0) { this.feedback({ ok: false, message: entry.reason }); return; }
        const picking = this.ui.pendingBuildingId === entry.buildingId;
        this.ui.pendingBuildingId = picking ? 0 : entry.buildingId;
        this.ui.buildMenuVisible = false;
        this.publish();
        this.feedback({ ok: true, message: picking ? '已取消选择' : `点击空地放置${entry.name}` });
    }
    private primary(): void {
        if (this.ui.mode === 'base') {
            const detail = this.model.plotDetail(this.ui.selectedPlotHexId);
            if (detail) void this.runAction(() => detail.queueSlotIndex >= 0
                ? this.model.requestCancelQueue(detail.queueSlotIndex) : this.model.requestUpgrade(detail.instanceId));
        } else if (this.ui.selectedCityId !== 0) {
            void this.runAction(() => this.model.requestAttackCity(this.ui.selectedCityId), () => { this.ui.enteringBattle = true; });
        } else if (this.ui.selectedMonsterId !== 0) {
            void this.runAction(() => this.model.requestAttackMonster(this.ui.selectedMonsterId), () => { this.ui.enteringBattle = true; });
        } else this.feedback({ ok: false, message: '先在地图上选一座城池或一只野怪' });
    }
    private secondary(): void {
        if (this.ui.mode === 'base') {
            const detail = this.model.plotDetail(this.ui.selectedPlotHexId);
            if (!detail) return;
            if (detail.stored > 0 || this.model.canCollectBuilding(detail.buildingId)) {
                void this.runAction(() => this.model.requestHarvest(detail.instanceId)); return;
            }
            if (detail.queueSlotIndex >= 0) return;
            this.ui.pendingMoveInstanceId = this.ui.pendingMoveInstanceId === detail.instanceId ? 0 : detail.instanceId;
            this.publish();
            if (this.ui.pendingMoveInstanceId !== 0) this.feedback({ ok: true, message: BIGMAP_MOVE_HINT });
            return;
        }
        const target = this.ui.selectedCityId ? this.model.cityView(this.ui.selectedCityId) : this.model.monsterView(this.ui.selectedMonsterId);
        if (target) this.command({ kind: 'focusWorld', hexId: target.hexId });
    }

    private async runAction(action: () => Promise<IBigMapActionFeedback>, onSuccess?: () => void): Promise<void> {
        if (this.ui.baseActionPending || this.ui.enteringBattle) return;
        this.ui.baseActionPending = true;
        this.publish();
        try {
            const result = await action();
            if (this.disposed) return;
            if (result.ok) onSuccess?.();
            this.feedback(result);
        } catch {
            if (!this.disposed) this.feedback({ ok: false, message: '操作失败，请重试' });
        } finally {
            this.ui.baseActionPending = false;
            if (!this.disposed) this.publish();
        }
    }
    cancelEnteringBattle(): void {
        if (this.disposed || !this.ui.enteringBattle) return;
        this.ui.enteringBattle = false;
        this.publish();
    }
    private tick(): void {
        this.options.slgRepository?.tick();
        this.model.tick(false);
        if (this.ui.mode === 'world' && !this.ui.enteringBattle && (this.options.now ?? Date.now)() >= this.nextCampRefreshAt) void this.refreshVisibleCamps();
        this.publish();
    }
    private async refreshVisibleCamps(): Promise<void> {
        if (this.visibleCampIds.length === 0) return;
        this.nextCampRefreshAt = (this.options.now ?? Date.now)() + BIGMAP_CAMP_REFRESH_SECONDS * 1000;
        await this.model.refreshVisibleCamps(this.visibleCampIds);
    }
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopTimer?.(); this.stopTimer = null;
        EventMgr.instance.offTarget(this);
        this.options.network?.removeCaller(this);
        for (const unsubscribe of this.subscriptions) unsubscribe();
        this.subscriptions.length = 0;
        this.model.dispose();
        super.dispose();
    }
}
