import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { ZCGameModel } from '../model/ZCGameModel';
import { createSeededRandom } from '../model/ZCSeededRandom';
import { ZCOwner } from '../model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../model/ZCMatchConfig';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../model/ZCSpawnSelection';
import { buildDamageStatistics } from '../../battle/BattleStatisticsModel';
import { ZC_BATTLE_TYPE_CHAPTER } from '../../battle/BattleStartModel';
import { buildRankSeats, RANK_FALLBACK_NAMES } from '../model/ZCRankBoard';
import { ZCGameUiEvent, type IZCRequestUnitArtIntent, type IZCRequestEffectArtIntent, type IZCDebugDrawCardIntent } from '../view/ZCGameHudEvents';
import type { IZCBattlePhase } from './ZCBattleController';
import { ZC_BATTLE_EVENTS, type IZCBattleFrame } from './ZCBattleEvents';
import type { IZCGameEntry } from './ZCGameEntry';
import type { IZCBattleView, IZCBattleRuntimeServices, IZCBattleConfirmOptions, IZCDamageStatsPlayer, IZCDamageStatsPopup } from './ZCBattleRuntimeContract';
import { ZCBattleSettlementController, type IZCBattlePopup } from './ZCBattleSettlementController';

/**
 * 投降（提前退出）的确认文案。
 *
 * 需求（11-4 测试包反馈「【战斗】投降功能」）原本写「提前结束需要 **2 次确认**」，
 * 11-09 曾按「同一个框点两次」实现（`CommonTips.confirmAgainText` 上膛文案）。
 * 山猫 2026-11-11 实机确认：**只留一次确认** —— 点「确定」直接结算，不再上膛。
 *
 * 所以这里**不传** `confirmAgainText`。`CommonTips` 上的「点两次」能力保留（缺省不生效），
 * 但投降不再使用；别在没确认需求前加回来，否则按钮会变成「再次确认」、看起来像第二层弹窗。
 */
const RETREAT_CONFIRM = {
    content: '你确定放弃当前对局，提前退出嘛？', sureText: '确定', cancelText: '取消',
} as const;

/** 每局唯一的规则编排入口；组件只提供帧脉冲及展示端口。 */
export class ZCBattleRuntimeController extends ControllerBase {
    private model: ZCGameModel | null = null;
    private selection: ZCSpawnSelection | null = null;
    private entry: IZCGameEntry | null = null;
    private random: () => number = Math.random;
    private renderClock = 0;
    private hints = true;
    private stopShowcase: (() => void) | null = null;
    private readonly popups = new Map<'guide' | 'damage' | 'rank' | 'retreat', IZCBattlePopup>();
    /** 投降确认进行中（await 期间连点不能叠出第二个确认框）。 */
    private retreating = false;
    private damagePopup: IZCDamageStatsPopup | null = null;
    private damageOpening = false;
    private readonly pendingUnitArt = new Set<string>();
    private readonly loadedUnitArt = new Set<string>();
    /** 特效美术按需补载：在飞的（path → Promise）与已到货的（路径集合）。 */
    private readonly pendingEffectArt = new Map<string, Promise<void>>();
    private readonly loadedEffectArt = new Set<string>();
    get currentModel(): ZCGameModel | null { return this.model; }
    constructor(context: IControllerContext, private readonly view: IZCBattleView,
        private readonly settlement: ZCBattleSettlementController, private readonly services: IZCBattleRuntimeServices,
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
            const resolved = config.map.resolvedResources ? config : Object.assign({}, config, {
                map: Object.assign({}, config.map, { resolvedResources: resolveZCMapResources(config.map, this.random) }),
            });
            this.model = new ZCGameModel(null, this.random, resolved);
            this.logCardAttributes(this.model, resolved);
            this.phase.startPlaying();
        }
        this.bindUiEvents();
        this.view.initialize(entry, resources, this.model, this.selection);
        if (this.selection) this.renderSpawn(); else this.render();
    }
    private bindUiEvents(): void {
        this.listen(ZC_BATTLE_EVENTS.FRAME, this.onFrame);
        this.listen(ZCGameUiEvent.RequestUnitArt, this.onRequestUnitArt);
        this.listen(ZCGameUiEvent.RequestEffectArt, this.onRequestEffectArt);
        this.listen(ZCGameUiEvent.HexClick, this.onHexClick);
        this.listen(ZCGameUiEvent.DebugDrawCard, this.onDebugDrawCard);
        this.listen(ZCGameUiEvent.DebugAddGold, this.onDebugAddGold);
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
                this.stopShowcase = this.services.clock.schedule(() => this.finishSpawnSelection(), 1);
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
                this.refreshDamageStats();
            }
            return;
        }
        this.phase.beginSettlementPresentation();
        this.refreshDamageStats();
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
        this.logCardAttributes(model, config);
        model.recordSpawnSelection();
        this.model = model;
        this.phase.startPlaying();
        this.view.startPlaying(model, config, selection, model.createRenderFrame(), model.drainPresentationEvents());
    }
    private logCardAttributes(model: ZCGameModel, config: ZCMatchConfig): void {
        for (const owner of model.owners) {
            const deck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
            console.info('[对局卡牌属性]', owner, JSON.stringify(deck.map((card) => {
                const definition = card.unitId ? model.effectiveDefinitionForUnit(owner, card.unitId) : null;
                return {
                    cardId: card.id, name: card.name, heroId: card.unitId ?? null,
                    buildingHp: card.baseHp ?? null,
                    maxHp: definition?.maxHp ?? null,
                    attack: definition?.attack ?? null,
                };
            })));
        }
    }
    private async onRequestUnitArt({ owner, unitId }: IZCRequestUnitArtIntent): Promise<void> {
        if (owner !== this.view || this.pendingUnitArt.has(unitId) || this.loadedUnitArt.has(unitId)) return;
        const definition = this.entry?.matchConfig.units.find(unit => unit.unitId === unitId);
        if (!definition?.prefabPath) return;
        this.pendingUnitArt.add(unitId);
        try {
            const prefab = await this.services.art.loadUnitPrefab(definition.prefabPath);
            if (this.isDisposed || !prefab) return;
            this.loadedUnitArt.add(unitId);
            this.view.applyUnitPrefab(unitId, prefab);
        } catch (error) { if (!this.isDisposed) this.services.failed(error); }
        finally { this.pendingUnitArt.delete(unitId); }
    }
    /**
     * 特效美术按需补载（与 {@link onRequestUnitArt} 同型，缺口在**特效**那条链上）。
     *
     * 本局特效清单由 `buildZCVisualResourcePlan(heroIds)` 按后端英雄名单过滤 ⇒ 兵营产兵 /
     * 波次兵 / GM 临时加的兵不在名单里，它们的普攻与技能特效路径**一条都不会被加载**。
     * 单位模型早就有这条补载，特效侧一直空着 ⇒ 那两类兵的子弹**永久**消失，且连「加载失败」
     * 都不会报（压根没被要求加载）。派发方 `ZCGameRenderWorld` 在第一次取不到时发一次，
     * 到货后由它下一帧补挂（{@link IZCBattleView.applyEffectPrefab}）。
     */
    private onRequestEffectArt({ owner, path }: IZCRequestEffectArtIntent): void {
        if (owner !== this.view || this.isDisposed || !path) return;
        if (this.loadedEffectArt.has(path) || this.pendingEffectArt.has(path)) return;
        //  同一路径可能同时有好几发子弹在飞（弹幕），共享一个 Promise，不重复打加载。
        const task = (async () => {
            try {
                const prefab = await this.services.art.loadEffectPrefab(path);
                if (this.isDisposed || !prefab) return;
                this.loadedEffectArt.add(path);
                this.view.applyEffectPrefab(path, prefab);
            } catch (error) { if (!this.isDisposed) this.services.failed(error); }
            finally { this.pendingEffectArt.delete(path); }
        })();
        this.pendingEffectArt.set(path, task);
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
    private onDebugAddGold(amount: number): void {
        const result = this.model ? this.model.addDebugGold(amount) : { ok: false, message: '请先完成出生点选择' };
        if (result.ok) this.render();
        EventMgr.instance.emit(ZCGameUiEvent.DebugAddGoldResult, { message: result.message });
    }
    /**
     * 投降 = **一次确认**才结算。
     *
     * 取消 / 点空白关闭都直接返回，不产生任何对局副作用；`retreating` 挡住连点。
     */
    private async onRetreat(): Promise<void> {
        if (this.isDisposed || this.phase.isSettled || this.retreating) return;
        this.retreating = true;
        try {
            if (!await this.askRetreat(RETREAT_CONFIRM)) return;
            this.openSettlement(true);
        } catch (error) {
            if (!this.isDisposed) this.services.failed(error);
        } finally {
            this.retreating = false;
        }
    }
    /**
     * 问一次。返回 `true` 只有「玩家点了确定」这一种情况。
     *
     * 弹窗句柄存进 `popups`，退出对局时 `closePopups` 会关它 ⇒ `answered` 兑现 `false`，
     * 这里就自然不会再往下走（不需要额外的 disposed 竞速）。
     */
    private async askRetreat(step: IZCBattleConfirmOptions): Promise<boolean> {
        const popup = await this.services.popups.confirm(step);
        if (!popup) return false;
        if (this.isDisposed) { popup.close('force'); return false; }
        this.popups.set('retreat', popup);
        try {
            return (await popup.answered) === true;
        } finally {
            if (this.popups.get('retreat') === popup) this.popups.delete('retreat');
        }
    }
    private onResetCamera(): void { this.view.resetCamera(); }
    private onSettlementConfirm(): void { this.settlement.confirm(); }
    private onReturnToMain(): void { EventMgr.instance.emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, { owner: this.view }); }
    private openSettlement(retreated: boolean): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry || this.phase.isSettled) return;
        if (!retreated && model.snapshot.status === 'playing') return;
        if (!this.phase.openSettlement()) return;
        this.damagePopup?.close();
        this.damagePopup = null;
        this.popups.delete('damage');
        const stats = model.damageStats, unitIds = new Map(entry.seatUnitIds ?? []);
        // ≥3 人局的结算要先过排行榜（需求 11-4）。席位与档案和 HUD 那颗「排行榜」按钮同源，
        // `finished=true` ⇒ 不再出现「比赛中…」态（结算时每方地块数都已是定局）。
        const profiles = new Map(entry.seatProfiles);
        const rankSeats = model.owners.length >= 3
            ? buildRankSeats(model.owners, owner => model.territoryCountOf(owner), profiles, true)
            : [];
        this.settlement.start({
            localVictory: !retreated && model.snapshot.status === 'victory', elapsedSeconds: model.snapshot.elapsedSeconds,
            commands: model.frameEvents.map(event => ({ frameId: event.frameId, unitId: unitIds.get(event.owner) ?? 0, op: event.op, params: event.params })),
            statistics: buildDamageStatistics(model.owners.map(owner => ({ unitId: unitIds.get(owner) ?? 0, harm: stats[owner].dealt }))),
            // 入口声明的 battleType 优先（匹配入口：宝箱栏 1002 / PVP 1001），
            // 老形状（只给 slgBattleType）与领地 PVE 各自保留一条退路。
            battleType: entry.battleType ?? entry.slgBattleType ?? (entry.pveContext ? ZC_BATTLE_TYPE_CHAPTER : null),
            rank: rankSeats.length >= 3 ? { seats: rankSeats, profiles } : null,
        });
    }
    private async onOpenGuide(): Promise<void> {
        const entry = this.entry;
        if (!entry) return;
        try {
            const content = await entry.resources.loadGuide();
            if (this.isDisposed) return;
            await this.trackPopup('guide', this.services.popups.openGuide(content));
        } catch (error) { if (!this.isDisposed) this.services.failed(error); }
    }
    private async onOpenDamage(): Promise<void> {
        if (!this.model || !this.entry || this.phase.isSettled || this.damageOpening || this.damagePopup?.isOpen) return;
        this.damageOpening = true;
        try {
            const popup = await this.services.popups.openDamage(this.damagePlayers());
            if (!popup) return;
            if (this.isDisposed || this.phase.isSettled) { popup.close(); return; }
            if (!popup.isOpen) return;
            this.damagePopup = popup;
            this.popups.set('damage', popup);
            this.refreshDamageStats();
        } catch (error) { if (!this.isDisposed) this.services.failed(error); }
        finally { this.damageOpening = false; }
    }
    private damagePlayers(): readonly IZCDamageStatsPlayer[] {
        const profiles = new Map(this.entry.seatProfiles), stats = this.model.damageStats;
        return this.model.owners.map(owner => ({
            owner, name: profiles.get(owner)?.name || RANK_FALLBACK_NAMES[owner],
            headKey: profiles.get(owner)?.headKey ?? '',
            damage: stats[owner].dealt, damageTaken: stats[owner].taken,
        }));
    }
    private refreshDamageStats(): void {
        if (!this.damagePopup) return;
        if (!this.damagePopup.isOpen) {
            this.damagePopup = null;
            this.popups.delete('damage');
            return;
        }
        this.damagePopup.refresh(this.damagePlayers());
    }
    private onOpenRank(): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry) return;
        const profiles = new Map(entry.seatProfiles);
        void this.trackPopup('rank', this.services.popups.openRank(buildRankSeats(model.owners, owner => model.territoryCountOf(owner), profiles, model.snapshot.status !== 'playing'), profiles));
    }
    private async trackPopup(kind: 'guide' | 'damage' | 'rank', pending: Promise<IZCBattlePopup | null>): Promise<void> {
        try {
            const popup = await pending;
            if (!popup) return;
            if (this.isDisposed) popup.close(); else this.popups.set(kind, popup);
        } catch (error) { if (!this.isDisposed) this.services.failed(error); }
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
                    this.pendingUnitArt.clear(); this.loadedUnitArt.clear();
                    this.model = null; this.selection = null; this.entry = null;
                    this.damagePopup = null;
                    super.dispose();
                }
            }
        }
    }
}
