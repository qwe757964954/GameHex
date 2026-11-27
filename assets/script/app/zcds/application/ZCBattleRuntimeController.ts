import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import { EventMgr } from '../../../framework/event/EventMgr';
import { GAME_AUDIO } from '../../ResConst';
import { ZC_BATTLE_TYPE_CHAPTER } from '../../battle/BattleStartModel';
import { buildDamageStatistics } from '../../battle/BattleStatisticsModel';
import { findCatalogCard, type ZCCardRarity, type ZCDeckCard, type ZCUnitDefinition } from '../model/ZCCombatCatalog';
import { ZCGameModel } from '../model/ZCGameModel';
import { ZCOwner } from '../model/ZCMapConfig';
import { captureZCMatchConfig, type ZCMatchConfig } from '../model/ZCMatchConfig';
import { ZC_MONSTER_FOCUS_TOAST } from '../model/ZCMonsterPresentation';
import { buildRankSeats } from '../model/ZCRankBoard';
import { createSeededRandom } from '../model/ZCSeededRandom';
import { buildSettlementMvp, type IZCSettlementMvp, type IZCSettlementMvpCard } from '../model/ZCSettlementMvp';
import { buildZCBarracksInfo } from '../model/ZCBarracksInfo';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from '../model/ZCSpawnSelection';
import { ZCGameUiEvent, type IZCDebugDrawCardIntent, type IZCRequestEffectArtIntent, type IZCRequestUnitArtIntent } from '../view/ZCGameHudEvents';
import { ZCDC_LOG_DAMAGE_FLOAT, ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { ZCBattleAudio } from './ZCBattleAudio';
import type { IZCBattlePhase } from './ZCBattleController';
import { ZC_BATTLE_EVENTS, type IZCBattleDamagePopupState, type IZCBattleFrame } from './ZCBattleEvents';
import type { IZCBattleRuntimeServices, IZCBattleView, IZCDamageStatsSeats, IZCDamageStatsUnit } from './ZCBattleRuntimeContract';
import { ZCBattleSettlementController } from './ZCBattleSettlementController';
import type { IZCGameEntry } from './ZCGameEntry';

/**
 * 投降（提前退出）的确认文案。
 *
 * 需求（11-4 测试包反馈「【战斗】投降功能」）原本写「提前结束需要 2 次确认」，
 * 11-09 曾按「同一个框点两次」实现（`CommonTips.confirmAgainText` 上膛文案）。
 * 山猫 2026-11-11 实机确认：只留一次确认 —— 点「确定」直接结算，不再上膛。
 *
 * 所以这里不传 `confirmAgainText`。`CommonTips` 上的「点两次」能力保留（缺省不生效），
 * 但投降不再使用；别在没确认需求前加回来，否则按钮会变成「再次确认」、看起来像第二层弹窗。
*/
const RETREAT_CONFIRM = {
    content: '你确定放弃当前对局，提前退出嘛？', sureText: '确定', cancelText: '取消',
} as const;

/**
 * 同一条集火提示的最短重复间隔（用对局逻辑秒，不是墙钟）。
 *
 * 按钮改成恒可点之后，不相邻地块上连点会一直弹同一句话；吐司是**排队**播的，
 * 连点五下要排队放好几秒，看起来像卡住。只压同一句，换句子（比如冷却中 → 相邻）照常弹。
 */
const MONSTER_FOCUS_TOAST_REPEAT_SECONDS = 1;

/**
 * 战斗内翻地块的抽卡音按品阶四选一（用户 2026-11-24）：
 * 抽空 → `战斗中抽空`；蓝卡/绿卡 → `战斗中抽蓝绿`；紫卡 → `战斗中抽紫`；金卡 → `战斗中抽金`。
 *
 * 四颗与领地那三颗（`randomTile` / `smallFixedTile` / `largeFixedTile`）**不是一套刻度**：
 * 那三颗按奖励数量分档，这四颗按抽出来的卡牌品阶分档。也别拿 `rarityRank()` 当判据 ——
 * 它给出的是数字序号，落成音效还得再映射一次，不如直接按品阶枚举。
 */
export function battleDrawSoundOf(rarity: ZCCardRarity | undefined): string {
    if (!rarity) return GAME_AUDIO.drawEmpty;
    if (rarity === 'gold') return GAME_AUDIO.drawGold;
    if (rarity === 'purple') return GAME_AUDIO.drawPurple;
    // 'blue' / 'green' 共用一颗：用户口径「抽出蓝绿卡 都播放 蓝绿卡音效」。
    return GAME_AUDIO.drawGreenBlue;
}

/** 每局唯一的规则编排入口；组件只提供帧脉冲及展示端口。*/
export class ZCBattleRuntimeController extends ControllerBase {
    private model: ZCGameModel | null = null;
    private selection: ZCSpawnSelection | null = null;
    private entry: IZCGameEntry | null = null;
    private random: () => number = Math.random;
    private renderClock = 0;
    private readonly battleAudio = new ZCBattleAudio();
    private readonly audioSourceOf = (id: number) => this.model?.attackInfoForUnit(id);
    private hints = true;
    private stopShowcase: (() => void) | null = null;
    /** 投降确认进行中（await 期间连点不能叠出第二个确认框）。*/
    private retreating = false;
    private damageActive = false;
    private damageOpening = false;
    private guideOpening = false;
    private readonly pendingUnitArt = new Set<string>();
    private readonly loadedUnitArt = new Set<string>();
    /** 特效美术按需补载：在飞的（path → Promise）与已到货的（路径集合）。*/
    private readonly pendingEffectArt = new Map<string, Promise<void>>();
    private readonly loadedEffectArt = new Set<string>();
    /** 上一条集火提示：同一条文案在 `MONSTER_FOCUS_TOAST_REPEAT_SECONDS` 内不重复弹（见 `showMonsterFocusToast`）。*/
    private lastMonsterFocusToast: { key: keyof typeof ZC_MONSTER_FOCUS_TOAST; at: number } | null = null;
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
            this.logOpeningConfig(entry, this.model, resolved);
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
        this.listen(ZCGameUiEvent.MonsterFocus, this.onMonsterFocus);
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
        this.listen(ZC_BATTLE_EVENTS.DAMAGE_POPUP_STATE, this.onDamagePopupState);
    }
    private onFrame({ dt }: IZCBattleFrame): void {
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
        if (this.services.audio?.playSound) {
            const { combatEvents, projectiles, elapsedSeconds } = frame.snapshot;
            this.battleAudio.present(combatEvents, elapsedSeconds, this.audioSourceOf, this.services.audio.playSound, projectiles);
        }
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
        if (this.phase.beginSettlementPresentation()) {
            this.services.dialogs.cancel();
            this.view.hideBarracksInfo();
            this.refreshDamageStats();
        }
        if (this.view.advanceSettlementPresentation(model, frame, dt)) return;
        this.render();
        this.openSettlement(false);
    }
    private render(): void {
        const model = this.model;
        if (model) this.view.renderBattle(model, model.createRenderFrame(), model.drainPresentationEvents(), 'all');
    }
    private renderSpawn(): void { if (this.selection) this.view.renderSpawnSelection(this.selection, this.hints); }
    private finishSpawnSelection(): void {
        this.stopShowcase?.();
        this.stopShowcase = null;
        const selection = this.selection;
        const result = selection ? selection.result : null;
        const entry = this.entry;
        if (this.isDisposed || !selection || !result || !entry) return;
        const config = captureZCMatchConfig(resolveZCSpawnMatchConfig(entry.matchConfig, result));
        this.selection = null;
        const model = new ZCGameModel(null, this.random, config);
        this.logOpeningConfig(entry, model, config);
        model.recordSpawnSelection();
        this.model = model;
        this.phase.startPlaying();
        this.view.startPlaying(model, config, selection, model.createRenderFrame(), model.drainPresentationEvents());
    }
    private logOpeningConfig(entry: IZCGameEntry, model: ZCGameModel, config: ZCMatchConfig): void {
        const seats = model.owners.map(owner => {
            const deck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
            if (ZCDC_LOG_DAMAGE_FLOAT) {
                const loadouts = config.modifiers?.[owner] ?? [];
                console.info('[伤害飘字][开局攻击]', owner, deck.flatMap(card => {
                    if (!card.unitId) return [];
                    const unitId = card.unitId;
                    const attackModifiers = loadouts
                        .filter(loadout => loadout.targetUnitId === unitId)
                        .flatMap(loadout => loadout.typedModifiers.filter(modifier =>
                            modifier.domain === 'unit' && modifier.statId === 'attack'));
                    const unitRate = config.unitRates?.[owner]?.[unitId]?.attackRate;
                    const hasServerOverride = attackModifiers.some(modifier =>
                        modifier.sourceKind === 'server' && modifier.operation === 'override');
                    return [{
                        cardId: card.id, unitId, name: card.name, baseAttack: model.definitionForUnit(unitId).attack,
                        attackModifiers, appliedRate: unitRate ?? (hasServerOverride ? 1 : config.ownerRates?.[owner]?.attackRate ?? 1),
                        attack: model.effectiveDefinitionForUnit(owner, unitId).attack,
                    }];
                }));
            }
            const home = model.snapshot.hexes.find(hex => hex.owner === owner && hex.building === 'hq');
            const heroLevels = entry.heroLevels?.find(([seat]) => seat === owner)?.[1];
            return {
                owner,
                unitId: entry.seatUnitIds?.find(([seat]) => seat === owner)?.[1] ?? null,
                gold: model.snapshot.goldByOwner?.[owner] ?? config.rules.initialGold,
                buildingLevels: config.ownerBuildingLevels?.[owner] ?? {},
                home: home ? {
                    hexId: home.id, maxHp: home.maxHp, wallMaxHp: home.wallMaxHp, wallLevel: home.wallLevel ?? null,
                } : null,
                rates: config.ownerRates?.[owner] ?? {},
                unitRates: config.unitRates?.[owner] ?? {},
                cards: deck.map(card => {
                    const definition = card.unitId ? model.effectiveDefinitionForUnit(owner, card.unitId) : null;
                    return {
                        cardId: card.id, name: card.name, heroId: card.unitId ?? null, level: heroLevels?.[card.id] ?? null,
                        buildingHp: card.baseHp ?? null,
                        maxHp: definition?.maxHp ?? null,
                        attack: definition?.attack ?? null,
                        cycleSeconds: card.cycleSeconds,
                        buildDigGoldNum: card.buildDigGoldNum,
                    };
                }),
            };
        });
        if (ZCDC_LOG_WARNINGS) {
            const { id, name, version, rows, columns, resolvedResources } = config.map;
            console.info('[对局开局配置]', JSON.stringify({
                seed: entry.battleSeed,
                battleType: entry.battleType ?? entry.slgBattleType ?? null,
                pveContext: entry.pveContext,
                configHash: config.configHash,
                map: { id, name, version, rows, columns, spawnMode: entry.matchConfig.map.cityMode ?? 'fixed',
                    resources: resolvedResources ?? [] },
                rules: config.rules,
                seats,
            }));
        }
    }
    private async onRequestUnitArt({ unitId }: IZCRequestUnitArtIntent, source: object): Promise<void> {
        if (source !== this.view || this.pendingUnitArt.has(unitId) || this.loadedUnitArt.has(unitId)) return;
        if (!this.entry) return;
        const definition = this.entry.matchConfig.units.find(unit => unit.unitId === unitId);
        if (!definition || !definition.prefabPath) return;
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
     * 特效美术按需补载（与 {@link onRequestUnitArt} 同型，缺口在特效那条链上）。
     *
     * 本局特效清单由 `buildZCVisualResourcePlan(heroIds)` 按后端英雄名单过滤 ⇒ 兵营产兵 /
     * 波次兵 / GM 临时加的兵不在名单里，它们的普攻与技能特效路径一条都不会被加载。
     * 单位模型早就有这条补载，特效侧一直空着 ⇒ 那两类兵的子弹永久消失，且连「加载失败」
     * 都不会报（压根没被要求加载）。派发方 `ZCGameRenderWorld` 在第一次取不到时发一次，
     * 到货后由它下一帧补挂（{@link IZCBattleView.applyEffectPrefab}）。
    */
    private onRequestEffectArt({ path }: IZCRequestEffectArtIntent, source: object): void {
        if (source !== this.view || !path) return;
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
    /**
     * 集火按钮（或整只野怪）点击 → 切集火 + 弹提示。
     *
     * 2026-11-26 第 56 批用户：
     * 「点击特效按钮后弹出提示UI，地块相邻后才能集火野怪；激活野怪后，点击按钮，
     *   弹出屏幕中间弹出文字提示，开始激活野怪；点击取消集火，取消集火时弹出提示【集火取消】」。
     *
     * 三种结局都由模型回（`toggleMonsterFocusResult`），这里只负责翻译成一句话：
     * 被拦 → 原因；开 → 「开始激活野怪」；关 → 「集火取消」。
     * 🔴 同一句话**一秒内不重复弹**：按钮现在是恒可点（视觉上灰着也能点），
     * 玩家在不相邻的地块上连点会把吐司队列刷满，排队放完要好几秒。
     */
    private onMonsterFocus(hexId: number): void {
        if (!this.phase.isPlaying || this.view.dragMoved) return;
        if (!this.model) return;
        // HUD 按钮直接触发时不经过 `HexClick` 路由，兵营面板要在这里收（点击路由那次同理）。
        this.view.hideBarracksInfo();
        const result = this.model.toggleMonsterFocusResult(hexId);
        const key = result.reason ?? result.kind;
        if (!key) return;
        this.showMonsterFocusToast(key);
        if (result.kind) this.render();
    }

    private showMonsterFocusToast(key: keyof typeof ZC_MONSTER_FOCUS_TOAST): void {
        const now = this.model?.snapshot.elapsedSeconds ?? 0;
        const last = this.lastMonsterFocusToast;
        if (last && last.key === key && now - last.at < MONSTER_FOCUS_TOAST_REPEAT_SECONDS) return;
        this.lastMonsterFocusToast = { key, at: now };
        // 🔴 走 services 注入而不是直接 import `common/Toast`：`Toast` 顶层 `import 'cc'`，
        // 而 application 层的**运行期**依赖图必须保持 cc-free（`tests/helpers/battle-runtime.ts`
        // 直接 import 本控制器）。真实装配在 `BattleComposition.createRuntimeServices`。
        this.services.toast?.(ZC_MONSTER_FOCUS_TOAST[key]);
    }
    /**
     * 点击兵营 → 装配并展示兵营信息；返回 `true` 表示这一下被面板消费。
     *
     * 数据口径：卡（席位卡组 → 本地卡牌目录兜底）、本局生效兵种属性、卡牌英雄等级。
     * 四阵营兵营都可看（中立营没有归属卡组，直接不弹）。
    */
    private openBarracksInfoFor(hexId: number): boolean {
        const model = this.model;
        const entry = this.entry;
        if (!model || !entry || !this.phase.isPlaying) return false;
        const hex = model.snapshot.hexes[hexId];
        if (!hex || hex.building !== 'barracks' || !hex.cardId || hex.owner === 'neutral') return false;
        const owner = hex.owner as ZCOwner;
        const config = entry.matchConfig;
        const deck = config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
        const card = deck.find(item => item.id === hex.cardId) ?? findCatalogCard(hex.cardId);
        if (!card) return false;
        //  兵营卡必须指向兵种；纯建筑卡或配置缺失时不开面板，也不让异常打断点击链路。
        if (card.unitId == null) return false;
        const heroLevel = entry.heroLevels?.find(([seat]) => seat === owner)?.[1][card.id] ?? 1;
        let definition: ZCUnitDefinition;
        try {
            definition = model.effectiveDefinitionForUnit(owner, String(card.unitId));
        } catch {
            return false;
        }
        this.view.showBarracksInfo(buildZCBarracksInfo(card, definition, heroLevel));
        return true;
    }
    private onHexClick(hexId: number): void {
        if (this.phase.isSettled || this.view.dragMoved) return;
        if (this.selection) {
            const result = this.selection.select(ZCOwner.Player, hexId);
            if (!result.ok) this.view.flashSpawn(result.message);
            this.renderSpawn(); return;
        }
        const model = this.model;
        //  兵营：点击只弹信息面板，不参与开发/集火判定（用户 2026-11-25「点击兵营弹出兵营信息」）。
        if (model && this.openBarracksInfoFor(hexId)) return;
        if (model) this.view.hideBarracksInfo();
        //  野怪格：点整只野怪 = 点集火按钮（2026-11-25 用户）。走 `onMonsterFocus` 而不是在这里
        //  重写一遍，冷却 / 拖拽 / 结算态的守卫都在它那儿。
        if (model && model.isMonsterFocusHex(hexId)) { this.onMonsterFocus(hexId); return; }
        if (model && model.canPlayerDevelop(hexId)) {
            const result = model.developHex(hexId);
            if (result.reason === 'insufficientGold') {
                this.view.flashInsufficientGold();
            } else if (result.ok && this.services.audio?.playSound) {
                // 战斗内翻地块的四档抽卡音（用户 2026-11-24）：抽空 / 蓝绿 / 紫 / 金。
                // 只在**开发真的落地**那一拍响：不可开发的格、金币不足都静默
                // （后者已有金栏闪红），否则玩家会以为白捡了一次奖励。
                // 品阶取 `result.cardRarity`（`ZCDevelopResult`）：抽空时它是 `undefined`，
                // 抽到卡但该格建不上时仍有值 ⇒ 音效按「抽到什么」走，不按「建没建成」走。
                this.services.audio.playSound(battleDrawSoundOf(result.cardRarity));
            }
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
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.SHOW_TIP, { message: this.model.useArtifact().message }, this.view);
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
     * 投降 = 一次确认才结算。
     *
     * 取消 / 点空白关闭都直接返回，不产生任何对局副作用；`retreating` 挡住连点。
    */
    private async onRetreat(): Promise<void> {
        if (!this.phase.isPlaying || this.retreating) return;
        this.retreating = true;
        try {
            if (!await this.services.dialogs.confirm(RETREAT_CONFIRM)) return;
            if (this.isDisposed || !this.phase.isPlaying) return;
            this.openSettlement(true);
        } catch (error) {
            if (!this.isDisposed) this.services.failed(error);
        } finally {
            this.retreating = false;
        }
    }
    private onResetCamera(): void { this.view.resetCamera(); }
    private onSettlementConfirm(): void { this.settlement.confirm(); }
    private onReturnToMain(): void { EventMgr.instance.emit(ZC_BATTLE_EVENTS.RETURN_TO_MAIN, undefined, this.view); }
    private openSettlement(retreated: boolean): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry || this.phase.isSettled) return;
        if (!retreated && model.snapshot.status === 'playing') return;
        if (!this.phase.openSettlement()) return;
        this.damageOpening = false;
        this.damageActive = false;
        this.services.dialogs.cancel();
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'closeRuntimePopups' }, this.view);
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
            // MVP 卡片：本局**赢家阵营里输出最高的卡**（骨骼模型 + 卡名 + 输出/承伤占比），
            // 「查看完整队伍」仍用这份冻结的席位统计。
            mvp: this.settlementMvp(),
            units: this.damageUnits(), seats: this.damageSeats(),
        });
    }
    private async onOpenGuide(): Promise<void> {
        const entry = this.entry;
        if (!entry || !this.model || this.phase.isSettled || this.guideOpening) return;
        this.guideOpening = true;
        try {
            const content = await entry.resources.loadGuide();
            if (this.isDisposed || this.phase.isSettled) return;
            EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
                kind: 'openGuide',
                content,
            }, this.view);
        } catch (error) {
            if (!this.isDisposed) this.services.failed(error);
        } finally {
            this.guideOpening = false;
        }
    }
    /**
     * 打开实时伤害统计面板。
     *
     * 1. 战局未就绪 / 选点中 / 已结算 / 在途或已展开时直接忽略；
     * 2. 打开命令交给组合层托管，回告就绪后立刻推一次追平刷新；
     * 3. 局内由 onFrame 按 0.15s 节流持续推流，弹窗关闭回告后停止推流。
     */
    private onOpenDamage(): void {
        if (!this.model || !this.entry || this.phase.isSettled || this.damageOpening || this.damageActive) {
            return;
        }
        const units = this.damageUnits();
        const seats = this.damageSeats();
        this.damageOpening = true;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
            kind: 'openDamage',
            phase: 'runtime',
            units,
            seats,
        }, this.view);
    }
    private onDamagePopupState({ phase, open }: IZCBattleDamagePopupState, source: object): void {
        if (source !== this.view || phase !== 'runtime') return;
        this.damageOpening = false;
        this.damageActive = open && !this.phase.isSettled;
        if (this.damageActive) {
            this.refreshDamageStats();
        }
    }
    /**
     * 本局结算 MVP：赢家阵营里 `damageCards` 输出最高的那张卡。
     *
     * 名称 / 骨骼模型 / 原始尺寸都从本局生效的 `ZCUnitDefinition` 取（与服务端倍率无关，
     * 只是美术与文案）；等级来自 `entry.heroLevels`（本地局没有 ⇒ 等级行收起）。
     * 选人规则本身在 `buildSettlementMvp`，这里只做「模型统计 → 卡片行」的翻译。
    */
    private settlementMvp(): IZCSettlementMvp | null {
        const model = this.model, entry = this.entry;
        if (!model || !entry) return null;
        const levels = new Map(entry.heroLevels ?? []);
        const cards: IZCSettlementMvpCard[] = model.damageCards.map((card) => {
            const definition = model.effectiveDefinitionForUnit(card.owner, card.unitId);
            return {
                owner: card.owner, unitId: card.unitId, cardId: card.cardId,
                name: definition.name, prefabPath: definition.prefabPath,
                // 结算立绘位吃的是收敛过的 `gameEndPrefabSize`：`prefabSize` 里含「补画布虚大」
                // 的那部分（磁电菇 canvas 1798 / 本体 980 ⇒ 1.8），搬到按美术归一的立绘位
                // 就成了纯放大 1.8 倍，会把 265 高的框撑到 520。
                prefabSize: definition.gameEndPrefabSize,
                damage: card.damage, damageTaken: card.damageTaken,
                level: levels.get(card.owner)?.[card.unitId] ?? 0,
            };
        });
        return buildSettlementMvp(cards, model.winner);
    }
    /**
     * 本局逐单位（卡）战斗数据：`damageCards` + 阵容里还没出伤害的卡 → 可展示行。
     *
     * `damageCards` 只合并同一张卡的多只兵，不同席位各占一行；头像取该席位实际卡池的 `headIcon`，
     * 本地目录兜底（塔防波次怪 / 中立怪可能不在席位卡池里）。
     *
     * 11-24 需求：进局时 `damageCards` 是空的（要等第一波伤害才凭空长出来），统计面板一打开
     * 我方一栏全空。所以这里把**各席位卡组里还没出现的卡按 0 补进来**，并带上 `deckOrder`
     * —— 弹窗据此先按阵容序排、拿到数据后再按数值降序（口径在 `compareDamageStatsRows`）。
     * 补进来的行 `unitId` 留空：它还没上场，没有服务端单元 id。
     */
    private damageUnits(): readonly IZCDamageStatsUnit[] {
        const model = this.model, entry = this.entry;
        if (!model || !entry) return [];
        const config = entry.matchConfig;
        const decks = new Map<ZCOwner, readonly ZCDeckCard[]>();
        const deckOf = (owner: ZCOwner): readonly ZCDeckCard[] => {
            let deck = decks.get(owner);
            if (!deck) {
                deck = config.ownerDecks?.[owner]
                    ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck);
                decks.set(owner, deck);
            }
            return deck;
        };
        const rows: IZCDamageStatsUnit[] = [];
        //  同一张卡在 `damageCards` 里已经有一行（可能 0 输出，只要挨过打就有），
        //  补阵容时按 `owner:cardId` 去重，别出现两行同一张卡。
        const counted = new Set<string>();
        for (const card of model.damageCards) {
            const deck = deckOf(card.owner);
            const deckCard = deck.find(entryCard => entryCard.id === card.cardId) ?? findCatalogCard(card.cardId);
            const definition = model.effectiveDefinitionForUnit(card.owner, card.unitId);
            counted.add(`${card.owner}:${card.cardId}`);
            rows.push({
                owner: card.owner, unitId: card.unitId, cardId: card.cardId,
                name: definition.name || deckCard?.name || card.cardId,
                iconKey: deckCard?.headIcon ?? '',
                // 底框按品级换色；目录外的兵（波次怪 / 中立怪）查不到卡就按绿（普通）兜底。
                rarity: deckCard?.rarity ?? 'green',
                damage: card.damage, damageTaken: card.damageTaken,
                deckOrder: deck.findIndex(entryCard => entryCard.id === card.cardId),
            });
        }
        for (const owner of model.owners) {
            deckOf(owner).forEach((deckCard, index) => {
                if (!deckCard.unitId) return;
                if (counted.has(`${owner}:${deckCard.id}`)) return;
                rows.push({
                    owner, unitId: '', cardId: deckCard.id,
                    name: deckCard.name || deckCard.id,
                    iconKey: deckCard.headIcon ?? '',
                    rarity: deckCard.rarity,
                    damage: 0, damageTaken: 0, deckOrder: index,
                });
            });
        }
        return rows;
    }
    /**
     * 统计弹窗的席位上下文（敌方头像栏 + 默认选中）。
     *
     * 与排行榜 / HUD 同一份 `entry.seatProfiles`；本局席位序以 `model.owners` 为准。
     * 老入口（本地局没有 `battle.units`）拿不到档案也要给出席位 —— 头像退回默认图，
     * 但「有几个敌方、默认选谁」仍然对。
     */
    private damageSeats(): IZCDamageStatsSeats {
        const model = this.model, entry = this.entry;
        if (!model || !entry) return { owners: [], profiles: new Map() };
        return { owners: model.owners, profiles: new Map(entry.seatProfiles) };
    }
    private refreshDamageStats(): void {
        if (!this.damageActive) return;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
            kind: 'refreshDamage',
            units: this.damageUnits(),
        }, this.view);
    }
    private onOpenRank(): void {
        const model = this.model, entry = this.entry;
        if (!model || !entry || this.phase.isSettled) return;
        const profiles = new Map(entry.seatProfiles);
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, {
            kind: 'openRank',
            seats: buildRankSeats(model.owners, owner => model.territoryCountOf(owner), profiles, model.snapshot.status !== 'playing'),
            profiles,
        }, this.view);
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.phase.leave();
        this.releaseInputs();
        const stopShowcase = this.stopShowcase;
        this.stopShowcase = null;
        this.damageOpening = false;
        this.damageActive = false;
        try {
            stopShowcase?.();
        } finally {
            try {
                this.services.dialogs.cancel();
            } finally {
                try {
                    this.settlement.dispose();
                } finally {
                    try {
                        EventMgr.instance.emit(ZC_BATTLE_EVENTS.POPUP_COMMAND, { kind: 'closeRuntimePopups' }, this.view);
                    } finally {
                        this.pendingUnitArt.clear(); this.loadedUnitArt.clear();
                        this.pendingEffectArt.clear(); this.loadedEffectArt.clear();
                        this.model = null; this.selection = null; this.entry = null;
                        super.dispose();
                    }
                }
            }
        }
    }
}
