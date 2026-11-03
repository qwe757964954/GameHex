import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { ZCGameModel } from '../model/ZCGameModel';
import { createSeededRandom } from '../model/ZCSeededRandom';
import { ZCOwner } from '../model/ZCMapConfig';
import { captureZCMatchConfig } from '../model/ZCMatchConfig';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../model/ZCSpawnSelection';
import { buildDamageStatistics } from '../../battle/BattleStatisticsModel';
import { ZC_BATTLE_TYPE_CHAPTER } from '../../battle/BattleStartModel';
import { buildRankSeats } from '../model/ZCRankBoard';
import { ZCGameUiEvent, type IZCDebugDrawCardIntent } from '../view/ZCGameHudEvents';
import type { IZCBattlePhase } from './ZCBattleController';
import { ZC_BATTLE_EVENTS, type IZCBattleFrame } from './ZCBattleEvents';
import type { IZCGameEntry } from './ZCGameEntry';
import type { IZCBattleView, IZCBattleAuxiliaryPorts } from './ZCBattleRuntimeContract';
import { ZCBattleSettlementController, type IZCBattlePopup } from './ZCBattleSettlementController';

/** 每局唯一的规则编排入口；组件只提供帧脉冲及展示端口。 */
export class ZCBattleRuntimeController extends ControllerBase {
    private model: ZCGameModel | null = null;
    private selection: ZCSpawnSelection | null = null;
    private entry: IZCGameEntry | null = null;
    private random: () => number = Math.random;
    private renderClock = 0;
    private hints = true;
    private stopShowcase: (() => void) | null = null;
    private readonly popups = new Map<'guide' | 'damage' | 'rank', IZCBattlePopup>();
    get currentModel(): ZCGameModel | null { return this.model; }
    constructor(context: IControllerContext, private readonly view: IZCBattleView,
        private readonly settlement: ZCBattleSettlementController, private readonly ports: IZCBattleAuxiliaryPorts,
        private readonly phase: IZCBattlePhase) {
        super(context, 'battle-runtime');
    }
    start(entry: IZCGameEntry, resources: IControllerResources): void {
        if (this.entry || this.isDisposed) throw new Error('对局运行期不可重复启动');
        this.entry = entry;
        this.random = createSeededRandom(entry.battleSeed);
        const config = entry.matchConfig;
        if ((config.map.cityMode ?? 'fixed') === 'select') {
            this.selection = new ZCSpawnSelection(config.map, this.random);
            this.phase.startSpawnSelection();
        } else {
            const resolved = config.map.resolvedResources ? config : {
                ...config, map: { ...config.map, resolvedResources: resolveZCMapResources(config.map, this.random) },
            };
            this.model = new ZCGameModel(null, this.random, resolved);
            this.phase.startPlaying();
        }
        this.bindUiEvents();
        this.view.initialize(entry, resources, this.model, this.selection);
        if (this.selection) this.renderSpawn(); else this.render();
    }
    private bindUiEvents(): void {
        this.listen(ZC_BATTLE_EVENTS.FRAME, this.onFrame);
        this.listen(ZCGameUiEvent.HexClick, this.onHexClick);
        this.listen(ZCGameUiEvent.DebugDrawCard, this.onDebugDrawCard);
        this.listen(ZCGameUiEvent.UseArtifact, this.onUseArtifact);
        this.listen(ZCGameUiEvent.OpenGuide, this.onOpenGuide);
        this.listen(ZCGameUiEvent.OpenDamageStats, this.onOpenDamage);
        this.listen(ZCGameUiEvent.OpenRank, this.onOpenRank);
        this.listen(ZCGameUiEvent.Retreat, this.onRetreat);
        this.listen(ZCGameUiEvent.ResetCamera, this.onResetCamera);
        this.listen(ZCGameUiEvent.SettlementConfirm, this.onSettlementConfirm);
        this.listen(ZCGameUiEvent.ReturnToMain, this.onReturnToMain);
        this.listen(ZCGameUiEvent.SpawnConfirm, this.onSpawnConfirm);
        this.listen(ZCGameUiEvent.SpawnToggleHints, this.onSpawnToggleHints);
    }
    private onFrame({ owner, dt }: IZCBattleFrame): void {
        if (owner !== this.view || this.isDisposed) return;
        if (this.selection) {
            this.selection.tick(dt);
            this.renderSpawn();
            if (this.selection.snapshot.finished && !this.stopShowcase) {
                this.stopShowcase = this.ports.schedule(() => this.finishSpawnSelection(), 1);
            }
            return;
        }
        const model = this.model;
        if (!model || this.phase.isSettled) return;
        model.tick(dt);
        const frame = model.createRenderFrame(), events = model.drainPresentationEvents();
        this.view.renderBattle(model, frame, events, 'dynamic');
        if (model.snapshot.status === 'playing') {
            this.renderClock += dt;
            if (this.renderClock >= 0.15) {
                this.renderClock = 0;
                this.view.renderBattle(model, frame, events, 'static');
            }
            return;
        }
        this.phase.beginSettlementPresentation();
        if (this.view.advanceSettlementPresentation(frame, dt)) return;
        this.render();
        this.openSettlement(false);
    }
    private render(): void {
        const model = this.model;
        if (model) this.view.renderBattle(model, model.createRenderFrame(), model.drainPresentationEvents(), 'all');
    }
    private renderSpawn(): void { if (this.selection) this.view.renderSpawnSelection(this.selection, this.hints); }
    private finishSpawnSelection(): void {
        this.stopShowcase?.(); this.stopShowcase = null;
        const selection = this.selection, result = selection?.result, entry = this.entry;
        if (this.isDisposed || !selection || !result || !entry) return;
        const config = captureZCMatchConfig(resolveZCSpawnMatchConfig(entry.matchConfig, result));
        this.selection = null;
        const model = new ZCGameModel(null, this.random, config);
        model.recordSpawnSelection();
        this.model = model;
        this.phase.startPlaying();
        this.view.startPlaying(model, config, selection, model.createRenderFrame(), model.drainPresentationEvents());
    }
    private onHexClick(hexId: number): void {
        if (this.phase.isSettled || this.view.dragMoved) return;
        if (this.selection) {
            const result = this.selection.select(ZCOwner.Player, hexId);
            if (!result.ok) this.view.flashSpawn(result.message);
            this.renderSpawn(); return;
        }
        const model = this.model;
        if (model?.canPlayerDevelop(hexId)) {
            const result = model.developHex(hexId);
            if (result.reason === 'insufficientGold') this.view.flashInsufficientGold();
            this.render();
        }
    }
    private onSpawnConfirm(): void {
        if (!this.selection) return;
        const result = this.selection.confirm(ZCOwner.Player);
        if (!result.ok) this.view.flashSpawn(result.message);
        this.renderSpawn();
        if (this.selection.snapshot.finished) this.finishSpawnSelection();
    }
    private onSpawnToggleHints(): void { this.hints = !this.hints; this.renderSpawn(); }
    private onUseArtifact(): void {
        if (!this.model || !this.phase.isPlaying) return;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.SHOW_TIP, { owner: this.view, message: this.model.useArtifact().message });
        this.render();
    }
    private onDebugDrawCard(intent: IZCDebugDrawCardIntent): void {
        const result = this.model ? this.model.setDebugDrawCard(intent.cardId, intent.count) : { message: '请先完成出生点选择' };
        EventMgr.instance.emit(ZCGameUiEvent.DebugDrawCardResult, { message: result.message });
    }
    private onRetreat(): void { this.openSettlement(true); }
    private onResetCamera(): void { this.view.resetCamera(); }
    private onSettlementConfirm(): void { this.settlement.confirm(); }
    private onReturnToMain(): void { EventMgr.instance.emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, { owner: this.view }); }
    private openSettlement(retreated: boolean): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry || this.phase.isSettled) return;
        if (!retreated && model.snapshot.status === 'playing') return;
        if (!this.phase.openSettlement()) return;
        const stats = model.damageStats, unitIds = new Map(entry.seatUnitIds ?? []);
        this.settlement.start({
            localVictory: !retreated && model.snapshot.status === 'victory', elapsedSeconds: model.snapshot.elapsedSeconds,
            commands: model.frameEvents.map(event => ({ frameId: event.frameId, unitId: unitIds.get(event.owner) ?? 0, op: event.op, params: event.params })),
            statistics: buildDamageStatistics(model.owners.map(owner => ({ unitId: unitIds.get(owner) ?? 0, harm: stats[owner].dealt }))),
            battleType: entry.slgBattleType ?? (entry.pveContext ? ZC_BATTLE_TYPE_CHAPTER : null),
        });
    }
    private async onOpenGuide(): Promise<void> {
        const entry = this.entry;
        if (!entry) return;
        try {
            const content = await entry.resources.loadGuide();
            if (this.isDisposed) return;
            await this.trackPopup('guide', this.ports.openGuide(content));
        } catch (error) { if (!this.isDisposed) this.ports.failed(error); }
    }
    private onOpenDamage(): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry || this.phase.isSettled) return;
        const profiles = new Map(entry.seatProfiles), stats = model.damageStats;
        const opponents = Object.entries(stats).filter(([owner]) => owner !== ZCOwner.Player);
        void this.trackPopup('damage', this.ports.openDamage({
            mine: { name: profiles.get(ZCOwner.Player)?.name || '我方', damage: stats.player.dealt, damageTaken: stats.player.taken },
            enemy: { name: profiles.get(ZCOwner.Enemy)?.name || '敌方', damage: opponents.reduce((sum, [, value]) => sum + value.dealt, 0), damageTaken: opponents.reduce((sum, [, value]) => sum + value.taken, 0) },
        }));
    }
    private onOpenRank(): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry) return;
        const profiles = new Map(entry.seatProfiles);
        void this.trackPopup('rank', this.ports.openRank(buildRankSeats(model.owners, owner => model.territoryCountOf(owner), profiles, model.snapshot.status !== 'playing'), profiles));
    }
    private async trackPopup(kind: 'guide' | 'damage' | 'rank', pending: Promise<IZCBattlePopup | null>): Promise<void> {
        try {
            const popup = await pending;
            if (!popup) return;
            if (this.isDisposed) popup.close(); else this.popups.set(kind, popup);
        } catch (error) { if (!this.isDisposed) this.ports.failed(error); }
    }
    private closePopups(): void {
        const popups = Array.from(this.popups.values());
        this.popups.clear();
        let failed = false;
        let firstError: unknown;
        for (const popup of popups) {
            try { popup.close(); }
            catch (error) { if (!failed) { failed = true; firstError = error; } }
        }
        if (failed) throw firstError;
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.phase.leave();
        this.releaseInputs();
        const stopShowcase = this.stopShowcase;
        this.stopShowcase = null;
        try { stopShowcase?.(); }
        finally {
            try { this.settlement.dispose(); }
            finally {
                try { this.closePopups(); }
                finally {
                    this.model = null; this.selection = null; this.entry = null;
                    super.dispose();
                }
            }
        }
    }
}
