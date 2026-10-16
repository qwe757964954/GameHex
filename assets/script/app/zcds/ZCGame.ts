import {
    _decorator,
    Component,
    instantiate,
    Node,
    SpriteFrame,
    Vec3,
    Widget,
} from 'cc';
import type { ZCGamePreparedResources } from './application/ZCGameLoader';
import type { IZCGameEntry, IZCGamePveContext } from './application/ZCGameEntry';
import { ZCDC_LOG_WARNINGS } from './ZCDCLogSwitch';
import { GameRunAway } from './ui/GameRunAway';
import { ZCSettlementPage } from './ui/ZCSettlementPage';
import { getEnemyDeck, getPlayerDeck, type ZCDeckCard } from './model/ZCCombatCatalog';
import { ZCGameHUDView } from './view/ZCGameHUDView';
import { ZCGuidePanel } from './ui/ZCGuidePanel';
import { ZCActionResult, ZCGameModel } from './model/ZCGameModel';
import { ZCGameRenderWorld } from './view/ZCGameRenderWorld';
import type { ZCGameRenderFrame } from './model/ZCGameRenderFrame';
import { buildDecorPlacements, buildPlayerHomeFocus } from './view/ZCGameViewUtil';
import { createSeededRandom } from './model/ZCSeededRandom';
import { buildRankSeats, type IRankSeat, type IRankSeatProfile } from './model/ZCRankBoard';
import { ZCGameRankBoard } from './view/ZCGameRankBoard';
// `ZC_OWNER_ORDER` 是值（遍历本局全部 owner 的卡池），不是纯类型。
import { ZC_OWNER_ORDER, type ZCOwner } from './model/ZCMapConfig';
import { captureZCMatchConfig } from './model/ZCMatchConfig';
import type { ZCMatchConfig, ZCMatchMap } from './model/ZCMatchConfig';
import { resolveZCMapResources, resolveZCSpawnMatchConfig, ZCSpawnSelection } from './model/ZCSpawnSelection';
import { ZCSpawnSelectionView } from './view/ZCSpawnSelectionView';
import { ZCHudBossPanel } from './view/ZCHudBossPanel';
import { buildZCClientCombatConfig } from './application/ZCClientCombatConfig';
import { ZCBattlePhaseController } from './application/ZCBattlePhaseController';
import { FW } from '../../framework/FW';
import { GameRoute } from '../../core/runtime/GameRoute';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { PopupCloseReason, PopupLayer } from '../../framework/ui/PopupDef';
import { finishBattle, BATTLE_RESULT_WIN, BATTLE_RESULT_LOSE } from '../battle/BattleStartService';
// 章节战斗的结算奖励走服务端广播（`CmdBattleResultBroMsg` 1002），不在 `finishBattle` 回包里。
import { BattleResultService } from '../battle/BattleResultService';
import type { IZCChapterBattleOutcome } from '../battle/BattleResultService';
import { resolveCmdGoodsFrames } from '../showReward/RewardFrames';
import { itemNumberTextOf } from '../itemdetail/ItemDetailTable';
import type { IZCSettlementReward } from './ui/ZCSettlementPage';
import { HeadArt } from '../HeadArt';

const { ccclass } = _decorator;

/**
 * 对局地图资源目录（相对 `resources/`）。
 *
 *  全工程唯一的路径来源：`tests/**` 与 `tools/map-editor/copy_maps.py` 都从本文件
 * 解析这一行。挪动地图目录时只改这里，**不要**在别处再硬编码一份 —— 之前地图从
 * `config/zcds/maps` 挪到 `config/maps` 时，正是靠各处硬编码的副本把这个常量漏掉了。
 */
export const MAP_DIRECTORY = 'config/maps';

/** 选点全部确认后停留展示主城的秒数。 */
const SPAWN_SHOWCASE_SECONDS = 1;

/** 静态渲染（地块 / HUD）的节流间隔秒数：每帧刷新单位与特效，静态层按此间隔刷新。 */
const STATIC_RENDER_INTERVAL_SECONDS = 0.15;

export type { ZCGamePreparedResources } from './application/ZCGameLoader';

export type { IZCGameEntry } from './application/ZCGameEntry';

/**
 * Game composition root. Rules live in ZCGameModel, presentation entities live
 * in ZCGameRenderWorld, and drawing/gestures live on the prefab view scripts.
 */
@ccclass('ZCGame')
export class ZCGame extends Component {
    private model!: ZCGameModel;
    private battleSeed: string | null = null;
    private matchConfig: ZCMatchConfig | null = null;
    private hudView: ZCGameHUDView | null = null;
    private playerAvatars: Readonly<{ player: string; enemy: string }> | null = null;
    private seatProfiles: Map<ZCOwner, IRankSeatProfile> = new Map();
    private pveContext: IZCGamePveContext | null = null;
    private initialized = false;
    private readonly phase = new ZCBattlePhaseController();
    private pveResultRecorded = false;
    private renderWorld: ZCGameRenderWorld | null = null;
    private renderClock = 0;
    private matchRandom: () => number = Math.random;
    private spawnSelection: ZCSpawnSelection | null = null;
    private spawnSelectionView: ZCSpawnSelectionView | null = null;
    /**
     * 从选点 HUD「借出来」的绿色【确认位置】按钮及其**原位信息**。
     *
     *  节点就是 `ZCSpawnSelection.prefab/ConfirmSpawn`（绿勾 `btn_gou.png`），选点期间被挪到
     *  `hudView.mapLayer` 下跟着基地走，选点结束/退出对局时按这里记的 parent/兄弟序/坐标
     *  原样塞回去再随 HUD 一起销毁。非 null 即代表「按钮正在外面漂着」。
     */
    private spawnConfirmBorrow: {
        node: Node;
        parent: Node;
        index: number;
        position: Vec3;
        widget: Widget | null;
    } | null = null;
    private spawnHintsVisible = true;
    private spawnBaseConfig: ZCMatchConfig | null = null;
    /** 选点全部确认后停留在选点画面的展示秒数，让双方看清落点再进战斗。 */
    private spawnShowcaseLeft: number | null = null;
    private spawnConfigWasStaged = false;
    /** 结算页（蓝湖「结算-胜利」/「结算-失败」）。伤害统计另走 `damagePopup`（GameRunAway）。 */
    private settlementPopup: ZCSettlementPage | null = null;
    private damagePopup: GameRunAway | null = null;
    private guidePopup: ZCGuidePanel | null = null;
    private damagePopupLoading = false;
    private guidePopupLoading = false;
    /** 对局内排行榜弹窗（蓝湖「排行榜」）；与伤害统计同构，离场强制关。 */
    private rankPopup: ZCGameRankBoard | null = null;
    private rankPopupLoading = false;
    private lastHint = '';
    private preparedResources: ZCGamePreparedResources | null = null;
    /** 守城局的首领条实例（只在 `model.defenceWaveProgress` 非空时存在）。 */
    private bossPanel: ZCHudBossPanel | null = null;
    /** 波次怪的头像帧（键 = 卡 id）；与名字一起喂给首领条，异步填、拿不到就留空框。 */
    private readonly bossPortraits: Map<string, SpriteFrame> = new Map();
    private readonly bossNames: Map<string, string> = new Map();

    private get settlementOpened(): boolean {
        return this.phase.current === 'settlement';
    }

    private get leaving(): boolean {
        return this.phase.isLeaving;
    }

    onLoad(): void {
        // Cocos 组件只建立自身生命周期；单局数据由 ProcedureGame 显式传入 initialize。
    }

    initialize(entry: IZCGameEntry): void {
        if (this.initialized) throw new Error('ZCGame 已初始化');
        this.initialized = true;
        this.battleSeed = entry.battleSeed;
        this.matchConfig = entry.matchConfig;
        this.seatProfiles = new Map(entry.seatProfiles);
        this.pveContext = entry.pveContext;
        this.playerAvatars = entry.playerAvatars;
        this.preparedResources = entry.resources;
        try {
            BattleResultService.ensureListening();
            this.createGame(entry.resources);
        } catch (error) {
            this.shutdown();
            throw error;
        }
    }

    update(dt: number): void {
        if (this.spawnSelection) {
            this.spawnSelection.tick(dt);
            this.renderSpawnSelection();
            if (this.spawnSelection.snapshot.finished) {
                // 全部确认后停留 1 秒展示主城落点，再正式进战斗。
                if (this.spawnShowcaseLeft === null) this.spawnShowcaseLeft = SPAWN_SHOWCASE_SECONDS;
                this.spawnShowcaseLeft -= dt;
                if (this.spawnShowcaseLeft <= 0) {
                    this.spawnShowcaseLeft = null;
                    this.finishSpawnSelection();
                }
            }
            return;
        }
        if (!this.model || this.settlementOpened || this.leaving) return;
        // `tick` 要**无条件**调（它自己首行就挡非 playing，见 `ZCGameModel.tick`）：
        // 判出胜负的那一帧也得照常走这一刀，否则「结算那一帧还推进一步」的既有语义就没了。
        this.model.tick(dt);
        const frame = this.model.createRenderFrame();
        const presentationEvents = this.model.drainPresentationEvents();
        if (this.model.snapshot.status === 'playing') {
            // 单位、特效与飘字每帧更新；地块和 HUD 保持低频刷新。
            this.renderWorld?.renderDynamic(frame, presentationEvents);
            this.renderClock += dt;
            if (this.renderClock < STATIC_RENDER_INTERVAL_SECONDS) return;
            this.renderClock = 0;
            this.hudView?.render(this.model);
            this.renderWorld?.renderStatic(frame);
            return;
        }
        this.phase.beginSettlementPresentation();
        // 结算演出：① 镜头先拉远、居中看全局 ② 逐格把地块染成胜利方 ③ 播完才弹结算弹窗。
        this.renderWorld?.renderDynamic(frame, presentationEvents);
        if (this.beginVictorySweep(frame) && this.hudView) {
            // 镜头没到位就先别推进扫场：表已经建好了，但 `litStep` 还停在 -1，一格都没染，
            // 所以这里 `return` 不会先冒出几格颜色。玩家可能刚把视角拖到角落，照原视角逐格
            // 变色的话半张棋盘还在屏幕外，等于没看到"整盘归了胜利方"。
            if (!this.hudView.settlementOverviewSettled) {
                this.hudView.startSettlementOverview();
                return;
            }
            if (this.renderWorld?.advanceVictorySweep(frame, dt)) return;
        }
        this.render();
        this.openSettlement();
    }

    /**
     * 胜负已定：用**现有地块资源**播一段「胜利方扫场」再弹结算 —— 镜头先由 HUD 拉远
     * 居中看全局（**镜头动画本身不变**，row8 原文「镜头放大的动画保持不变」），再整行把地块
     * 铺成胜利方的**深饱和**色、铺过两行就从起点推回去回正成阵营**当前色**，
     * 回正收手后再有一道亮线沿同一方向扫过（线条脉冲）。
     * （方向：我方从下往上 / 其他玩家从上往下，见 `buildVictorySweepPlan`）。
     * **起手不染色**，见 `ZCGameRenderWorld.startVictorySweep`。
     *
     * 放在结算分支的**入口**、每帧都调（幂等，已经在播就直接返回）：胜负不一定是
     * `tick` 判出来的，服务端下发的快照、掉线判负也会把它置成非 playing —— 绑死在
     * 「tick 刚判负那一帧」的话，这些路径就静默没有扫场了。
     *
     * 返回**是否要走这段演出**：平局没有胜利方、整盘没有可染的格子，都返回 false，
     * 调用方直接弹结算别等。撤退根本不走这里（`openSettlement(true)` 由 HUD 直接调）。
     */
    private beginVictorySweep(frame: ZCGameRenderFrame): boolean {
        const status = frame.snapshot.status;
        if (status !== 'victory' && status !== 'defeat') return false;
        const winner = status === 'victory' ? 'player' : 'enemy';
        return this.renderWorld?.startVictorySweep(frame, winner) ?? false;
    }

    onDestroy(): void {
        this.shutdown();
    }

    /** 流程退出时先销毁视图，再释放资源，避免等待组件的延迟销毁。 */
    shutdown(): void {
        if (!this.phase.leave()) return;
        this.settlementPopup?.close(PopupCloseReason.Force);
        this.settlementPopup = null;
        this.damagePopup?.close(PopupCloseReason.Force);
        this.damagePopup = null;
        this.guidePopup?.close(PopupCloseReason.Force);
        this.guidePopup = null;
        this.rankPopup?.close(PopupCloseReason.Force);
        this.rankPopup = null;
        // 先归还按钮再拆 HUD：按钮此刻挂在棋盘层，不送回去就随选点 HUD 一起销毁不了。
        this.restoreSpawnConfirmButton();
        this.spawnSelectionView?.node.destroy();
        this.spawnSelectionView = null;
        this.spawnSelection = null;
        this.spawnBaseConfig = null;
        // 退出前先把扫场还原掉：地块的 sweepOwner 是表现层状态，不还原就留给下一局。
        this.renderWorld?.clearVictorySweep();
        // 同理：开局归属扩散波若正播到一半退出，格子会停在「过渡到一半」的颜色上。
        this.renderWorld?.clearTerritoryClaimWave();
        this.renderWorld?.destroy();
        this.renderWorld = null;
        this.hudView?.node.destroy();
        this.hudView = null;
        this.preparedResources = null;
        this.battleSeed = null;
        this.matchConfig = null;
        this.playerAvatars = null;
        this.pveContext = null;
        this.seatProfiles.clear();
    }

    /**
     * 传说卡横幅右上角的玩家头像。
     *
     *  头像要过 head/icon 表 + `resources.load` 才拿得到，是**异步**的；而 `createGame` 是同步路径
     * （首帧必须在这一帧画出来），所以这里 fire-and-forget：拿到就注入解析器，拿不到就只留
     * 四个玩家色的头像环 —— 少一枚头像不影响这次演出，**不**阻断对局。
     *
     *  注入时机晚于横幅弹出也没关系：`ZCGameRenderWorld.setLegendPortraitResolver` 会连同
     * 已经弹出来的横幅一起刷新。
     */
    private loadLegendPortraits(): void {
        const avatars = this.playerAvatars;
        if (!avatars) return;
        void Promise.all([
            HeadArt.loadHeadFrame(avatars.player).catch(() => null),
            HeadArt.loadHeadFrame(avatars.enemy).catch(() => null),
        ]).then(([player, enemy]) => {
            if (this.leaving || !this.renderWorld) return;
            if (!player && !enemy) return;
            this.renderWorld.setLegendPortraitResolver((owner) => (owner === 'player' ? player : enemy));
        });
    }

    /**
     * **卡面静态图**（卡表 `headIcon` → `icons/cardHead/**`）：传说横幅左格与对局小卡牌**共用**。
     *
     *  口径与 `loadLegendPortraits` 完全一致：卡面图要过 icon 表 + `resources.load`，是**异步**的，
     *  而 `createGame` 是同步路径（首帧必须画出来）⇒ 这里 fire-and-forget；拿到就注入解析器
     *  （`ZCGameRenderWorld.setLegendCardArtResolver` 会连同已弹出的横幅与小卡牌一起补刷），
     *  一张都拿不到就保留回退链，**不阻断对局**。
     *
     *   预扫**本局全部卡池**而不是等翻牌那一刻再按需加载：解析必须是**同步命中**，
     *  否则会先闪一帧回退图（兵种 idle / 建筑图）再换成卡面图。
     *
     *   卡池口径必须与模型 `ZCGameModel.deckFor` **逐条对齐**：那边是
     *  `ownerDecks?.[owner] ?? (player ? playerDeck : enemyDeck)`，PVE / 英雄模式会经
     *  `buildZCPveEnemyDecks` / `hasRemoteHeroes` 换掉牌组（见 `ZCClientCombatConfig`）⇒
     *  这里若只扫全局 `getPlayerDeck()/getEnemyDeck()`，那些局会一张卡面都取不到，
     *  然后每张卡都刷「没有角色卡面图」的日志。宁可多扫，不可漏扫。
     */
    private loadLegendCardArt(): void {
        const config = this.matchConfig;
        const decks: ReadonlyArray<readonly ZCDeckCard[]> = [
            ...(config ? ZC_OWNER_ORDER.map((owner) => (
                config.ownerDecks?.[owner] ?? (owner === 'player' ? config.playerDeck : config.enemyDeck)
            )) : []),
            getPlayerDeck(),
            getEnemyDeck(),
        ];
        const icons = new Map<string, string>();
        for (const deck of decks) {
            for (const card of deck) {
                if (card.headIcon) icons.set(card.id, card.headIcon);
            }
        }
        if (!icons.size) return;
        void Promise.all(Array.from(icons).map(async ([cardId, icon]) => (
            [cardId, await HeadArt.loadHeadIconFrame(icon).catch(() => null)] as const
        ))).then((entries) => {
            if (this.leaving || !this.renderWorld) return;
            const frames = new Map<string, SpriteFrame>();
            for (const [cardId, frame] of entries) if (frame) frames.set(cardId, frame);
            if (!frames.size) return;
            this.renderWorld.setLegendCardArtResolver((cardId) => frames.get(cardId) ?? null);
        });
    }

    /** 这里只做同步实例化和首帧渲染；异步工作必须在调用前全部完成。 */
    private createGame(prepared: ZCGamePreparedResources): void {
        // 随机源在这里落地：有服务端种子就用它播种（同种子 = 同一副开局），没有则退回真随机。
        // `ZCGameModel` 是唯一消费方（初始地块分布 / 抽地块与保底 / AI 选格 / 单位出生抖动），
        // 所以"整局可复现"只需要这一个注入点 —— 别在别处再 new 一份随机源。
        const entryMatchConfig = this.matchConfig;
        if (!entryMatchConfig) throw new Error('ZCGame.initialize 缺少本局配置快照');
        const setupConfig = entryMatchConfig;
        this.matchRandom = createSeededRandom(this.battleSeed);
        this.node.removeAllChildren();

        const hud = instantiate(prepared.hudPrefab);
        hud.setParent(this.node);
        hud.setPosition(Vec3.ZERO);
        // 视图组件与它的 14 个 @property 都在 ZCGameHUD.prefab 上绑好（leftPlayer / rightPlayer /
        // gameVS 是嵌套实例引用，走根 PrefabInfo 的 targetOverrides）⇒ 不再 `|| addComponent` 兜底：
        // 那个分支永远走不到，真掉组件时反而会静默补一个空视图。
        this.hudView = hud.getComponent(ZCGameHUDView)!;
        // HUD 的神器按钮原先显示 prefab 硬绑的通用图（`image/gameui/zd_faqi.png`），
        // 与本局携带的神器无关 ⇒ 棋盘显示剑、HUD 显示石锤。这里喂同一份已加载的帧。
        this.hudView.setArtifactFrame(prepared.artifactIconFrame);
        // 开局镜头停在我方主城那一格，而不是整盘中心（3 / 4 人图的整盘中心落在几块领地
        // 之间的中立空白处）。必须在 initialize 之前给 —— 入场镜头在 initialize 里就播完了。
        // 自选主城图此时还没有主城坐标（`playerHomeId = -1`），落点留空，
        // 由 `finishSpawnSelection` 在选点完成后补上。
        this.hudView.setMapFocus(buildPlayerHomeFocus(setupConfig.map));
        const selectingSpawn = (setupConfig.map.cityMode ?? 'fixed') === 'select';
        this.hudView.initialize({
            useArtifact: () => this.applyResult(this.model.useArtifact(), { toast: true }),
            openGuide: () => {
                if (this.guidePopupLoading || this.guidePopup?.isPopupOpen || this.leaving) return;
                this.guidePopupLoading = true;
                ZCGuidePanel.open({ userData: { content: prepared.guide } }).then((popup) => {
                    if (this.leaving) popup?.close(PopupCloseReason.Force);
                    else this.guidePopup = popup;
                }).catch((error) => {
                    if (ZCDC_LOG_WARNINGS) console.error('[ZCGame] 打开战斗指南失败', error);
                }).finally(() => {
                    this.guidePopupLoading = false;
                });
            },
            openDamageStats: () => this.openRunAway(),
            //  这条以前**漏传**了：`ZCHudActions.openRank` 与 `bind(this.rankButton, …)`
            // 早就存在，但这里没给 ⇒ `leftPanel/RankBtn` 点了没反应（零报错）。
            openRank: () => this.openRankBoard(),
            retreat: () => this.openSettlement(true),
        }, { deferMapIntro: selectingSpawn });
        if (this.seatProfiles.size > 0) {
            // 名字 + 头像一起交给 HUD（多队伍改造后按**席位**渲染，不再是「我方/敌方」两槽）。
            this.hudView.setSeatProfiles(this.seatProfiles);
        }
        // 棋盘图层容器：水面 / 地块 / 装饰 / 建筑 / 状态条五层的结构与层序都在这个 prefab 里，
        // 这里只把它挂到地图层下（layer 也由 prefab 声明，不再逐个 new Node 现拼）。
        const board = instantiate(prepared.boardPrefab);
        board.setParent(this.hudView.mapLayer);
        board.setPosition(Vec3.ZERO);

        const wallLayer = instantiate(prepared.wallLayerPrefab);
        wallLayer.name = 'PermanentWallLayer';
        wallLayer.layer = this.hudView.mapLayer.layer;
        wallLayer.setParent(this.hudView.mapLayer);
        wallLayer.setPosition(Vec3.ZERO);

        this.renderWorld = new ZCGameRenderWorld({
            mapLayer: this.hudView.mapLayer,
            board,
            wallLayer,
            hexPrefab: prepared.hexPrefab,
            unitPrefab: prepared.unitPrefab,
            unitVisualPrefabs: prepared.unitVisualPrefabs,
            buildingFrames: prepared.buildingFrames,
            wallFrames: prepared.wallFrames,
            wallMaterial: prepared.wallMaterial,
            unitOutlineCopyEffect: prepared.unitOutlineCopyEffect,
            hexGroundGlowFrames: prepared.hexGroundGlowFrames,
            hexPulseFrames: prepared.hexPulseFrames,
            hexPulseMaterial: prepared.hexPulseMaterial,
            effectPrefab: prepared.effectPrefab,
            effectVisualPrefabs: prepared.effectVisualPrefabs,
            floatTextPrefab: prepared.floatTextPrefab,
            cardRevealPrefab: prepared.cardRevealPrefab,
            legendBannerPrefab: prepared.legendBannerPrefab,
            // 传说卡横幅弹在屏幕正中 ⇒ 挂全屏层；mapLayer 是 ScrollView 的 content，会跟着拖动跑。
            overlayLayer: this.hudView.node,
            // 中立资源点「神器充能」格显示玩家携带的那件神器（整局一张，逐个地块视图注入）。
            artifactIconFrame: prepared.artifactIconFrame,
            decorPrefab: prepared.decorPrefab,
            spawnFxPrefab: prepared.spawnFxPrefab,
            deathFxPrefab: prepared.deathFxPrefab,
            hitFxPrefabs: prepared.hitFxPrefabs,
            wallPrefab: prepared.wallPrefab,
            onHexClick: (hexId) => this.onHexClick(hexId),
        });
        this.loadLegendPortraits();
        this.loadLegendCardArt();
        this.loadDefenceBossArt();
        if (selectingSpawn) {
            this.renderWorld.initialize(setupConfig.map);
            this.startSpawnSelection(setupConfig, entryMatchConfig !== null, prepared);
        } else {
            const baseConfig = entryMatchConfig ?? buildZCClientCombatConfig(setupConfig, null).config;
            const matchConfig = baseConfig.map.resolvedResources
                ? baseConfig
                : {
                    ...baseConfig,
                    map: {
                        ...baseConfig.map,
                        resolvedResources: resolveZCMapResources(baseConfig.map, this.matchRandom),
                    },
                };
            this.model = new ZCGameModel(null, this.matchRandom, matchConfig);
            this.renderWorld.initialize(this.model.mapConfig);
            this.phase.startPlaying();
            this.render();
        }
        // 两个分支都传 `setupConfig.map`：**自选主城阶段还没有 `ZCGameModel`**，
        // 装饰只认地图配置（`art.tiles` + `hexes`），不能从 model 取。
        this.installMapDecor(setupConfig.map, prepared.decorFrames);
    }

    /**
     * 铺地图的虚空装饰（地图 JSON 的 `art.tiles` 里 `"行,列"` 键）。
     *
     * 地图编辑器早就把装饰选好、存好、跟着镜像展开了，**客户端此前一直没接渲染**
     * —— 数据到 `ZCMatchConfig.art` 就断了，`ZCHexView` 只认 Inspector 上绑死的
     * 地块贴图，所以虚空格上的装饰在游戏里一个都看不见（还是光秃秃的虚空）。
     *
     * 装饰只摆在虚空格上，而虚空格没有地块节点，所以这里交给渲染层单独铺一层
     * （`installDecor`），不走地块实体。
     *
     * 取数**只认 `map`**（`art.tiles` + `hexes` 都是地图配置上的字段），不碰 `this.model`：
     * 自选主城开局时 model 还没建（要等 `finishSpawnSelection`），从 model 取会静默 return
     * ⇒ 自选主城图（`cityMode = 'select'`）一条装饰都铺不出来，而这两张图恰恰有 38~48 条装饰。
     * 装饰坐标只由 `hexes` 的 `x/y` 决定，与主城/分区无关，所以选点前后铺一次就够，
     * `installDecor` 幂等（先 `clearDecor`），重开局/换图重复调也不会叠层。
     *
     * 帧已在 Procedure 的 ResourceScope 中准备好；缺图只跳过对应装饰，不阻断对局。
     */
    private installMapDecor(map: ZCMatchMap, decorFrames: ReadonlyMap<string, SpriteFrame>): void {
        const world = this.renderWorld;
        const tiles = map.art?.tiles;
        if (!world || !tiles) return;
        world.installDecor(
            buildDecorPlacements(map.hexes, tiles, (art) => {
                const frame = decorFrames.get(art);
                return frame ? frame.originalSize : null;
            }),
            decorFrames,
        );
    }

    private onHexClick(hexId: number): void {
        if (this.settlementOpened) return;
        if (this.hudView?.dragMoved) return;
        if (this.spawnSelection) {
            const result = this.spawnSelection.select('player', hexId);
            this.lastHint = result.message;
            if (!result.ok) this.spawnSelectionView?.flash(result.message);
            this.renderSpawnSelection();
            return;
        }
        if (this.model.canPlayerDevelop(hexId)) {
            const result = this.model.developHex(hexId);
            // 金币不足：棋盘上放不下这段提示（那一格的图标与价格照旧），由 HUD 底部的金币栏自己表达
            // —— 金币图标跳动 + 数字闪红。判据走结构化 `reason`，不解析中文文案（文案会随策划改字）。
            if (result.reason === 'insufficientGold') this.hudView?.flashInsufficientGold();
            this.applyResult(result);
        }
        // 点到不可开发地块 / 已有建筑：当前没有任何可见反馈，不做副作用（静态文案已删）。
    }

    private startSpawnSelection(config: ZCMatchConfig, wasStaged: boolean, prepared: ZCGamePreparedResources): void {
        this.phase.startSpawnSelection();
        this.spawnBaseConfig = config;
        this.spawnConfigWasStaged = wasStaged;
        this.spawnSelection = new ZCSpawnSelection(config.map, this.matchRandom);
        this.spawnHintsVisible = true;
        this.hudView?.setSpawnSelectionMode(true);
        // 节点树、尺寸与全部 @property 都在 `ZCSpawnSelection.prefab` 上（以前是 new Node 现搭 12 个节点）。
        const node = instantiate(prepared.spawnSelectionPrefab);
        node.layer = this.hudView?.node.layer ?? this.node.layer;
        node.setParent(this.hudView?.node ?? this.node);
        this.spawnSelectionView = node.getComponent(ZCSpawnSelectionView)!;
        this.spawnSelectionView.initialize({
            confirm: () => this.confirmSpawnSelection(),
            toggleHints: () => {
                this.spawnHintsVisible = !this.spawnHintsVisible;
                this.renderSpawnSelection();
            },
        });
        // 需求 2：基地正下方 2 格的绿色【确认位置】按钮 —— 直接借用 HUD 上那颗绿勾，
        // 不新建节点（见 `borrowSpawnConfirmButton`）。
        this.borrowSpawnConfirmButton();
        this.renderSpawnSelection();
    }

    private confirmSpawnSelection(): void {
        if (!this.spawnSelection) return;
        const result = this.spawnSelection.confirm('player');
        this.lastHint = result.message;
        if (!result.ok) this.spawnSelectionView?.flash(result.message);
        this.renderSpawnSelection();
        if (this.spawnSelection.snapshot.finished) this.finishSpawnSelection();
    }

    private renderSpawnSelection(): void {
        if (!this.spawnSelection) return;
        this.spawnSelectionView?.render(this.spawnSelection.snapshot, this.spawnHintsVisible);
        this.renderWorld?.renderSpawnSelection(this.spawnSelection, this.spawnHintsVisible);
    }

    /**
     * 把 HUD 上那颗绿色对勾【确认位置】按钮**借**到棋盘层，让它跟着基地走。
     *
     *   是「借用」不是新建：需求 2 要的按钮就是 `ZCSpawnSelection.prefab/ConfirmSpawn`
     *  （`btn_gou.png` 绿勾）。`ZCSpawnSelectionView` 已经在按选点合法性给它染色
     *  （`CONFIRM_INVALID/READY/IDLE`）、在「等待其他玩家」期间隐藏它，并把 `TOUCH_END`
     *  接到 `actions.confirm()` —— 这些语义全部沿用，本方法只做两件事：换父级 + 关 Widget。
     *  所以这里**不要**再实例化一个自己的按钮（2026-10-15 已删掉手画的
     *  `ui/game/ZCSpawnBaseConfirm`）：两套按钮会各有一套染色/显隐判据，必然分叉。
     *
     *   关 Widget 这一步不能省：按钮在选点 HUD 里靠 `cc.Widget`（水平居中 + 底边 200px）
     *  钉在屏幕底部，换到棋盘层后 Widget 仍会每帧按那套对齐规则把它拽回去，跟逐帧写的
     *  基地坐标打架 —— 表现为按钮卡在屏幕底部纹丝不动。
     */
    private borrowSpawnConfirmButton(): void {
        const button = this.spawnSelectionView?.confirmButton;
        const layer = this.hudView?.mapLayer;
        if (!button || !button.isValid || !layer) return;
        const parent = button.parent;
        if (!parent) return;
        const widget = button.getComponent(Widget);
        this.spawnConfirmBorrow = {
            node: button,
            parent,
            index: button.getSiblingIndex(),
            position: button.position.clone(),
            widget,
        };
        if (widget) widget.enabled = false;
        button.setParent(layer);
        this.renderWorld?.setSpawnConfirmButton(button);
    }

    /**
     * 归还【确认位置】按钮：放回 `ZCSpawnSelection` 预制里的原位，恢复 Widget。
     *
     *  选点结束与退出对局都要调，而且必须在 `spawnSelectionView.node.destroy()` **之前**调 ——
     *  按钮此刻挂在棋盘层下，不送回去它就不会跟着选点 HUD 一起销毁，会永久留在地图上。
     *
     *  顺手把世界层里的引用置 `null`：`Node.destroy()` 当帧 `isValid` 仍为 true，
     *  不置空会多写一帧坐标到正在销毁的节点上。
     */
    private restoreSpawnConfirmButton(): void {
        const borrow = this.spawnConfirmBorrow;
        this.spawnConfirmBorrow = null;
        this.renderWorld?.setSpawnConfirmButton(null);
        if (!borrow) return;
        const node = borrow.node;
        if (!node.isValid) return;
        if (borrow.parent.isValid) {
            node.setParent(borrow.parent);
            node.setSiblingIndex(borrow.index);
            node.setPosition(borrow.position);
            if (borrow.widget) borrow.widget.enabled = true;
            return;
        }
        // 原父级已经没了（对局被强制拆掉）：按钮失去了归宿，直接销毁，别留在棋盘上。
        node.destroy();
    }

    private finishSpawnSelection(): void {
        const selection = this.spawnSelection;
        const base = this.spawnBaseConfig;
        const result = selection?.result;
        if (!selection || !base || !result || !this.renderWorld || !this.hudView) return;
        const resolved = resolveZCSpawnMatchConfig(base, result);
        const matchConfig = this.spawnConfigWasStaged ? captureZCMatchConfig(resolved)
            : buildZCClientCombatConfig(resolved, null).config;
        this.spawnSelection = null;
        this.spawnBaseConfig = null;
        this.restoreSpawnConfirmButton();
        this.spawnSelectionView?.node.destroy();
        this.spawnSelectionView = null;
        // 选点定下来才拿得到我方主城坐标；`setSpawnSelectionMode(false)` 紧接着播入场镜头，
        // 落点必须在那之前注入，否则镜头又落回整盘中心。
        this.hudView.setMapFocus(buildPlayerHomeFocus(matchConfig.map));
        this.hudView.setSpawnSelectionMode(false);
        this.model = new ZCGameModel(null, this.matchRandom, matchConfig);
        this.phase.startPlaying();
        const frame = this.model.createRenderFrame();
        this.renderWorld.render(frame, this.model.drainPresentationEvents());
        // 先按真实归属整盘渲染一遍，再起扩散波把中立格压回「选点阶段的半区色」——
        // 顺序反了会先闪一帧战斗底色（波是把半区色往回换，不是把中立色拉上来）。
        // `selection` 已经置空，这里传的是**局部引用**：波要拿它查每格属于哪个半区。
        this.renderWorld.startTerritoryClaimWave(frame, selection);
    }

    private applyResult(result: ZCActionResult, options?: { toast?: boolean }): void {
        this.lastHint = result.message;
        // 主动点击类操作（神器按钮）额外弹吐司：战报栏在屏幕底部，视线在按钮上时
        // 根本不会去看，而失败原因（充能不足 / 冷却中）恰恰是这一下点击的全部意义。
        // 走 `FW.showTip` 而不是直接 import Toast，守住 framework 不反向依赖 app 的分层。
        if (options?.toast) FW.showTip(result.message);
        this.render();
    }

    /** 对局结束或主动撤退后弹结算页（蓝湖「结算-胜利 / 失败」稿）。 */
    private openSettlement(retreated = false): void {
        if (!this.model || this.settlementOpened || this.leaving) return;
        const state = this.model.snapshot;
        // 非撤退分支只在终局（victory/defeat/draw）弹结算；playing 挡掉。
        if (!retreated && state.status === 'playing') return;
        if (!this.phase.openSettlement()) return;
        const localVictory = !retreated && state.status === 'victory';
        // 先建立等待器，再发结束请求；否则快速广播会被服务丢弃。
        const chapterResult = this.pveContext ? BattleResultService.waitForChapterResult() : null;
        // 结算即上报完成战斗，撤退按失败上报。失败不阻塞结算弹窗。
        //
        //  章节局（`pveContext`）**也必须发**：它是用 `CmdStartBattleReqMsg(1002)` 开的局
        // （`TerritoryPresenter.bossBattleStart.battleId`），服务端要靠这条完成上报给那一局收尾，
        // 再推 `CmdBattleResultBroMsg`（`battleType = 1002` → `CmdChapterBattleResultInfo`）下发奖励。
        // 漏掉它 ⇒ 广播永远不来、结算页奖励恒空（白等满一个等待超时才弹空页）。
        // 原注释写的是「领地 PVE 是本地关卡…不向 PVP 完成接口误报」——那条理由已不成立：
        // 章节战斗走的就是同一套 startBattle，拿的也是服务端发的 battleId，谈不上"误报"。
        const result = localVictory ? BATTLE_RESULT_WIN : BATTLE_RESULT_LOSE;
        const commands = this.model.frameEvents.map((e) => ({ frameId: e.frameId, unitId: e.unitId, op: e.op, params: e.params }));
        void finishBattle(state.elapsedSeconds, result, commands, this.buildStatistics(), this.node);
        void this.showSettlement(localVictory, chapterResult);
    }

    /**
     * 真正弹结算页。
     *
     * ## 为什么是 async（章节局要等广播）
     *
     * 章节战斗的奖励由服务端在战斗结束后经 `CmdBattleResultBroMsg`（`battleType = 1002`，
     * `dataBytes = CmdChapterBattleResultInfo`）推下来，**不在任何 req→rsp 里** ——
     * 所以先 `await` 那条广播（带超时兜底）再弹页，奖励一次到位，不会先闪一版空奖励格。
     *
     * `openSettlement` 先建立等待器，再发送 `CmdFinishBattleReqMsg` 并调用本方法。
     * 匹配局（PVP，`battleType = 1001`）本轮**没接**，照旧立即弹。
     *
     *  等不到（超时 / 服务端没推）就按空奖励照弹，**绝不把结算卡住**。
     */
    private async showSettlement(
        localVictory: boolean,
        chapterResult: Promise<IZCChapterBattleOutcome | null> | null,
    ): Promise<void> {
        const result = chapterResult ? await chapterResult : null;
        if (this.leaving) return;
        if (result) this.recordPveResult(result.code === BATTLE_RESULT_WIN);
        const rewards = result ? await this.loadChapterRewards(result) : [];
        // 等广播期间玩家可能已经退出对局（`shutdown`）⇒ 别再弹。
        if (this.leaving) return;
        ZCSettlementPage.open({
            layer: PopupLayer.SYSTEM,
            closeOnBlank: false,
            userData: {
                victory: result ? result.code === BATTLE_RESULT_WIN : localVictory,
                rewards,
                onConfirm: () => {
                    if (!this.leaving) this.returnToMain();
                },
            },
        }).then((popup) => {
            if (this.leaving) popup?.close(PopupCloseReason.Force);
            else this.settlementPopup = popup;
        }).catch((error) => {
            if (ZCDC_LOG_WARNINGS) console.error('[ZCGame] 打开结算弹窗失败', error);
        });
    }

    /**
     * 章节战斗的通关奖励：等广播 → `CmdGoods[]` → 奖励格（帧已加载好）。
     *
     * 帧的解析链与「获得奖励」弹窗**共用一份**（`RewardFrames`）：`item`/`roleProperty`
     * 两张表都查，品质框按 `quality` 换档 —— 两表都查不到时退化成「品质 1 + 无图标」。
     */
    private async loadChapterRewards(result: IZCChapterBattleOutcome): Promise<IZCSettlementReward[]> {
        if (result.goods.length === 0) return [];
        const resolved = await resolveCmdGoodsFrames(result.goods);
        return resolved.map(({ entry, frames }) => ({
            qualityFrame: frames.qualityFrame,
            iconFrame: frames.iconFrame,
            number: itemNumberTextOf(entry.number),
        }));
    }

    private recordPveResult(victory: boolean): void {
        const pve = this.pveContext;
        if (!pve || this.pveResultRecorded) return;
        this.pveResultRecorded = true;
        pve.onResult(victory);
    }

    private returnToMain(): void {
        if (this.pveContext) {
            ProcedureManager.navigate(GameRoute.Main, { initialTab: 'adventure' });
            return;
        }
        ProcedureManager.navigate(GameRoute.Main);
    }

    /** 把本局伤害汇总转成 CmdBattleStatisticsInfo 上报给服务端。 */
    private buildStatistics(): CmdBattleStatisticsInfo[] {
        const stats = this.model.damageStats;
        const opponents = Object.entries(stats).filter(([owner]) => owner !== 'player');
        const enemyDealt = opponents.reduce((total, [, v]) => total + v.dealt, 0);
        const enemyTaken = opponents.reduce((total, [, v]) => total + v.taken, 0);
        return [
            { unitId: 0, eventType: 1, frameId: 0, kv: ['player_dealt', String(stats.player.dealt), 'player_taken', String(stats.player.taken), 'enemy_dealt', String(enemyDealt), 'enemy_taken', String(enemyTaken)] },
        ];
    }

    private damageSummary() {
        const stats = this.model.damageStats;
        const opponents = Object.entries(stats).filter(([owner]) => owner !== 'player');
        return {
            mine: {
                // 昵称取席位档案（HUD 的两方版 `leftPlayer.nameLabel` 已在「多队伍」改造中移除；
                // 左侧玩家行接入后这里也是同一份数据源，不会漂）。
                name: this.seatProfiles.get('player')?.name || '我方',
                damage: stats.player.dealt,
                damageTaken: stats.player.taken,
            },
            enemy: {
                name: this.seatProfiles.get('enemy')?.name || '敌方',
                damage: opponents.reduce((total, [, value]) => total + value.dealt, 0),
                damageTaken: opponents.reduce((total, [, value]) => total + value.taken, 0),
            },
        };
    }

    /**
     * 打开伤害统计预览（GameRunAway）。
     * 昵称沿用 HUD 当前展示的值，伤害取模型里的双方累计统计 —— 两行的进度条上限
     * 由 GameRunAway 内部按双方较大值统一，保证两根条可以直接比长短。
     *
     * 统计预览不改动对局状态，点空白处即可关闭。
     */
    private openRunAway(): void {
        if (!this.model || this.settlementOpened || this.leaving) return;
        if (this.damagePopupLoading || this.damagePopup?.isPopupOpen) return;
        this.damagePopupLoading = true;
        GameRunAway.open({
            userData: this.damageSummary(),
        }).then((popup) => {
            if (this.leaving) popup?.close(PopupCloseReason.Force);
            else this.damagePopup = popup;
        }).catch((error) => {
            if (ZCDC_LOG_WARNINGS) console.error('[ZCGame] 打开对局结算页失败', error);
        }).finally(() => {
            this.damagePopupLoading = false;
        });
    }

    /**
     * 打开对局内排行榜（蓝湖「排行榜」设计稿）。
     *
     * 与 {@link openRunAway} 同构：都是**对局期间**只读地打开一个弹窗，
     * 不改对局状态，点空白/关闭键收起。守卫口径也一致（重复点不叠开、离场强制关）。
     *
     *  数据每次打开现取：地块数在变，缓存下来的榜会显示过期名次。
     */
    private openRankBoard(): void {
        if (!this.model || this.rankPopupLoading || this.leaving) return;
        if (this.rankPopup?.isPopupOpen) return;
        this.rankPopupLoading = true;
        ZCGameRankBoard.open({
            userData: {
                seats: buildRankSeats(
                    this.model.owners,
                    (owner) => this.model.territoryCountOf(owner),
                    this.seatProfiles,
                    this.model.snapshot.status !== 'playing',
                ),
                profiles: this.seatProfiles,
            },
        }).then((popup) => {
            if (this.leaving) popup?.close(PopupCloseReason.Force);
            else this.rankPopup = popup;
        }).catch((error) => {
            if (ZCDC_LOG_WARNINGS) console.error('[ZCGame] 打开对局排行榜失败', error);
        }).finally(() => {
            this.rankPopupLoading = false;
        });
    }

    private render(): void {
        if (!this.model || !this.hudView || !this.renderWorld) return;
        this.hudView.render(this.model);
        this.renderBossPanel(this.model);
        const frame = this.model.createRenderFrame();
        this.renderWorld.render(frame, this.model.drainPresentationEvents());
    }

    /**
     * 守城（塔防）局的首领条：**按需实例化**，非守城局直接销毁。
     *
     * 头像与名字按 `currentWaveCardId` 查 `loadDefenceBossArt()` 预扫好的表（解析必须同步命中，
     * 否则会先闪一帧空框再换成怪图）；`render` 每帧全量赋值，面板侧不做增量。
     */
    private renderBossPanel(model: ZCGameModel): void {
        const progress = model.defenceWaveProgress;
        if (!progress) {
            this.bossPanel?.node.destroy();
            this.bossPanel = null;
            return;
        }
        if (!this.bossPanel) {
            const prepared = this.preparedResources;
            if (!prepared || this.leaving) return;
            const hud = this.hudView?.node ?? this.node;
            const node = instantiate(prepared.bossPanelPrefab);
            node.layer = hud.layer;
            node.setParent(hud);
            // 位置归 prefab 的 Widget（左上角按 top=76 / left=129 钉住），这里不写 setPosition。
            this.bossPanel = node.getComponent(ZCHudBossPanel)!;
        }
        const cardId = progress.currentWaveCardId;
        this.bossPanel.render(
            progress,
            cardId ? this.bossNames.get(cardId) ?? '' : '',
            cardId ? this.bossPortraits.get(cardId) ?? null : null,
        );
    }

    /**
     * 预扫**本局敌方牌组**的波次怪头像与名字（守城局的怪就是以 `pvpCard` 行生成的单位）。
     *
     * 与 `loadLegendCardArt` 同一套口径：卡面走卡表 `headIcon`，异步加载完再落表；
     * 一张都拿不到就留空框，**不阻断对局**。
     */
    private loadDefenceBossArt(): void {
        const deck = this.matchConfig?.enemyDeck ?? getEnemyDeck();
        const icons = new Map<string, string>();
        for (const card of deck) {
            if (!card.name) continue;
            this.bossNames.set(card.id, card.name);
            if (card.headIcon) icons.set(card.id, card.headIcon);
        }
        if (!icons.size) return;
        void Promise.all(Array.from(icons).map(async ([cardId, icon]) => (
            [cardId, await HeadArt.loadHeadIconFrame(icon).catch(() => null)] as const
        ))).then((entries) => {
            if (this.leaving) return;
            for (const [cardId, frame] of entries) if (frame) this.bossPortraits.set(cardId, frame);
        });
    }

}
