import { ZCDC_LOG_DIAGNOSTICS, ZCDC_LOG_WARNINGS } from './ZCDCLogSwitch';
import {
    _decorator,
    Component,
    Director,
    director,
    instantiate,
    Node,
    Prefab,
    SpriteFrame,
    Vec3,
    Widget,
} from 'cc';
import type { IZCGamePreparedResources } from './application/ZCGamePreparedResources';
import type { IZCGameEntry } from './application/ZCGameEntry';
import { getEnemyDeck, getPlayerDeck, type ZCDeckCard, type ZCUnitId } from './model/ZCCombatCatalog';
import { ZCGameHUDView } from './view/ZCGameHUDView';
import { EventMgr } from '../../framework/event/EventMgr';
import type { IZCBattleRenderModel, IZCBattlePresentationArt } from './application/ZCBattleRuntimeContract';
import { ZCGameRenderWorld } from './view/ZCGameRenderWorld';
import type { ZCGameRenderFrame, ZCBattlePresentationEvents } from './model/ZCGameRenderFrame';
import { buildDecorPlacements, buildPlayerHomeFocus } from './view/ZCGameViewUtil';
import { type IRankSeatProfile } from './model/ZCRankBoard';
// `ZC_OWNER_ORDER` 是值（遍历本局全部 owner 的卡池），不是纯类型。
import { ZC_OWNER_ORDER, resolveZCMapZoom, ZCOwner } from './model/ZCMapConfig';
import type { ZCMatchConfig, ZCMatchMap } from './model/ZCMatchConfig';
import type { ZCSpawnSelection } from './model/ZCSpawnSelection';
import { ZCSpawnSelectionView } from './view/ZCSpawnSelectionView';
import { ZCHudBossPanel } from './view/ZCHudBossPanel';
import { HeadArt } from '../HeadArt';
import type { IControllerResources } from '../../framework/controller/ControllerBase';
import { ZC_BATTLE_EVENTS } from './application/ZCBattleEvents';
import { createIconLoader, type IIconLoader } from '../common/SpriteFrameCache';
import { resolveCardClass } from '../card/CardLineupTypes';
import type { ICardArtConfig } from '../card/CardArtConfig';

const { ccclass } = _decorator;

/**
 * 对局地图资源目录（相对 `resources/`）。
 *
 *  全工程唯一的路径来源：`tests/**` 与 `tools/map-editor/copy_maps.py` 都从本文件
 * 解析这一行。挪动地图目录时只改这里，**不要**在别处再硬编码一份 —— 之前地图从
 * `config/zcds/maps` 挪到 `config/maps` 时，正是靠各处硬编码的副本把这个常量漏掉了。
 */
export const MAP_DIRECTORY = 'config/maps';

export type { IZCGamePreparedResources } from './application/ZCGamePreparedResources';

export type { IZCGameEntry } from './application/ZCGameEntry';

/**
 * Battle presentation adapter, mounted by BattleComposition with externally owned resources.
 * Runtime controllers advance the model; presentation entities live in ZCGameRenderWorld.
 */
@ccclass('ZCGame')
export class ZCGame extends Component {
    get dragMoved(): boolean { return this.hudView.dragMoved; }
    resetCamera(): void { this.hudView.resetCamera(); }
    flashSpawn(message: string): void { this.spawnSelectionView?.flash(message); }
    flashInsufficientGold(): void { this.hudView.flashInsufficientGold(); }
    renderBattle(model: IZCBattleRenderModel, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents, mode: 'all' | 'dynamic' | 'static'): void {
        if (mode !== 'dynamic') { this.hudView.render(model); this.renderBossPanel(model); }
        if (mode === 'all') this.renderWorld.render(frame, events);
        else if (mode === 'dynamic') this.renderWorld.renderDynamic(frame, events);
        else this.renderWorld.renderStatic(frame);
    }
    advanceSettlementPresentation(frame: ZCGameRenderFrame, dt: number): boolean {
        if (!this.beginVictorySweep(frame)) return false;
        if (!this.hudView.settlementOverviewSettled) { this.hudView.startSettlementOverview(); return true; }
        return this.renderWorld.advanceVictorySweep(frame, dt);
    }
    startPlaying(model: IZCBattleRenderModel, config: ZCMatchConfig, selection: ZCSpawnSelection, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void {
        this.renderWorld.clearSpawnRegionHints();
        this.restoreSpawnConfirmButton();
        this.spawnSelectionView?.node.destroy();
        this.spawnSelectionView = null;
        this.hudView.setMapFocus(buildPlayerHomeFocus(config.map));
        const zoom = resolveZCMapZoom(config.map);
        this.hudView.setMapZoomRange(zoom.min, zoom.max);
        this.hudView.setSpawnSelectionMode(false);
        this.renderWorld.syncResolvedResources(config.map.resolvedResources ?? []);
        // 必须先写完整归属，再启动共享归属波。
        this.renderWorld.render(frame, events);
        this.renderWorld.startTerritoryClaimWave(frame, selection);
    }
    private presentationResources: IControllerResources | null = null;
    private get artResources(): IControllerResources {
        if (!this.presentationResources) throw new Error('对局显示资源尚未注入');
        return this.presentationResources;
    }
    private iconLoader: IIconLoader | null = null;

    private get loadIcon(): IIconLoader {
        return this.iconLoader ??= createIconLoader(this.artResources.assets, this.artResources.scope);
    }

    private async loadHeadFrame(avatarId: string): Promise<SpriteFrame | null> {
        const resolver = await HeadArt.loadHeadArtResolver(this.artResources.configs);
        if (this.leaving) return null;
        return HeadArt.loadHeadFrame(avatarId, this.loadIcon, resolver);
    }

    private async loadHeadIconFrame(icon: string): Promise<SpriteFrame | null> {
        const resolver = await HeadArt.loadIconArtResolver(this.artResources.configs);
        if (this.leaving) return null;
        return HeadArt.loadHeadIconFrame(icon, this.loadIcon, resolver);
    }
    private matchConfig: ZCMatchConfig | null = null;
    private hudView: ZCGameHUDView | null = null;
    private playerAvatars: Readonly<{ player: string; enemy: string }> | null = null;
    private seatProfiles: Map<ZCOwner, IRankSeatProfile> = new Map();
    private initialized = false;
    private stopped = false;
    private renderWorld: ZCGameRenderWorld | null = null;
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
    private deferredAfterDraw: (() => void) | null = null;
    private preparedResources: IZCGamePreparedResources | null = null;
    /**
     * 本局角色卡面图（卡表 `headIcon` → `icons/cardHead/**`）；异步加载，整局一份。
     * 视图通过注入的本局只读资源表按 id 取图。
     */
    private readonly legendCardArtFrames: Map<string, SpriteFrame> = new Map();
    /** 横幅使用阵容页立绘；与地块翻牌的 headIcon 分开，资源仍归本局作用域。 */
    private readonly legendRoleArtFrames = new Map<string, SpriteFrame>();
    /** 本局玩家头像帧（owner → `images/head` 那套）；异步加载，拿不到就只显示头像环。 */
    private readonly legendPortraitFrames: Map<string, SpriteFrame> = new Map();
    /** 守城局的首领条实例（只在 `model.defenceWaveProgress` 非空时存在）。 */
    private bossPanel: ZCHudBossPanel | null = null;
    /** 波次怪的头像帧（键 = 卡 id）；与名字一起喂给首领条，异步填、拿不到就留空框。 */
    private readonly bossPortraits: Map<string, SpriteFrame> = new Map();
    private readonly bossNames: Map<string, string> = new Map();
    private get leaving(): boolean { return this.stopped || !this.isValid; }


    onLoad(): void {
        // Cocos 组件只建立自身生命周期；单局数据与显示资源由外部会话显式注入。
    }
    initialize(entry: IZCGameEntry, resources: IControllerResources, model: IZCBattleRenderModel | null, selection: ZCSpawnSelection | null): void {
        if (this.initialized) throw new Error('ZCGame 已初始化');
        this.initialized = true;
        this.presentationResources = resources;
        this.matchConfig = entry.matchConfig;
        this.seatProfiles = new Map(entry.seatProfiles);
        this.playerAvatars = entry.playerAvatars;
        this.preparedResources = entry.resources;
        try { this.createGame(entry.resources, model, selection); }
        catch (error) { this.shutdown(); throw error; }
    }

    /** 帧事件 payload 复用：EventMgr 同步派发，唯一监听者只解构取 owner/dt，不持有引用。 */
    private readonly framePayload: { owner: ZCGame; dt: number } = { owner: this, dt: 0 };

    update(dt: number): void {
        this.framePayload.dt = dt;
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.FRAME, this.framePayload);
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
     * 调用方直接弹结算别等。撤退不走这里，由运行控制器直接发起结算。
     */
    private beginVictorySweep(frame: ZCGameRenderFrame): boolean {
        const status = frame.snapshot.status;
        if (status !== 'victory' && status !== 'defeat') return false;
        // 🔴 用**模型判定的胜方**，不要拿 status 反推：status 只有 victory / defeat 两态，
        // 而 4 人局里"我方出局"可能是 2 号红方、也可能是 4 号紫方赢 —— 反推会把紫方赢的局
        // 铺成红方色（2026-10-28 用户报的就是这个）。
        // 兜底只在模型没给胜方时用（例如恢复一份已经结束的快照，`checkOutcome` 不会重判）：
        // 那时退回旧口径，至少方向和以前一致，不至于整段扫场不播。
        const winner = frame.winner ?? (status === 'victory' ? ZCOwner.Player : ZCOwner.Enemy);
        return this.renderWorld.startVictorySweep(frame, winner);
    }

    onDestroy(): void {
        this.shutdown();
        EventMgr.instance.emit(ZC_BATTLE_EVENTS.RUNTIME_DESTROYED, { owner: this });
    }

    /**
     * 流程退出时先销毁视图，再释放资源，避免等待组件的延迟销毁。
     *
     *  **幂等**靠本实例 `stopped` 标记：`ProcedureGame.onLeave` 显式调一次，紧接着的
     * `destroy()` → `onDestroy` 会再调一次，第二次直接早退。别把这个闸门删掉（会重复销毁）。
     *
     *  ⚠️ 下面几处 `?.` **不要按「createGame 都建好了」删掉**：本函数还要在**半成品节点**上收尾 ——
     * `initialize` 的 catch 会在 `createGame` **中途抛错**时调它，而 `hudView` / `renderWorld`
     * 是 createGame 中段才 new 的，那时可能还没建。删掉的话收尾自己会抛
     * `Cannot read properties of null`，把真正的抛错原因盖掉（进不去对局时只能看到这个假错）。
     */
    shutdown(): void {
        if (this.stopped) return;
        this.stopped = true;
        if (this.deferredAfterDraw) director.off(Director.EVENT_AFTER_DRAW, this.deferredAfterDraw);
        this.deferredAfterDraw = null;
        // 先归还按钮再拆 HUD：按钮此刻挂在棋盘层，不送回去就随选点 HUD 一起销毁不了。
        this.restoreSpawnConfirmButton();
        this.spawnSelectionView?.node.destroy();
        this.spawnSelectionView = null;
        // 退出前先把扫场还原掉：地块的 sweepOwner 是表现层状态，不还原就留给下一局。
        this.renderWorld?.clearVictorySweep();
        // 同理：开局归属扩散波若正播到一半退出，格子会停在「过渡到一半」的颜色上。
        this.renderWorld?.clearTerritoryClaimWave();
        this.renderWorld?.destroy();
        this.renderWorld = null;
        this.hudView?.node.destroy();
        this.hudView = null;
        this.preparedResources = null;
        this.unitVisualPrefabs.clear();
        this.buildingFramesByCardId.clear();
        this.matchConfig = null;
        this.playerAvatars = null;
        this.seatProfiles.clear();
        this.legendCardArtFrames.clear();
        this.legendRoleArtFrames.clear();
        this.legendPortraitFrames.clear();
        this.bossPortraits.clear();
        this.presentationResources = null;
        this.iconLoader = null;
    }

    /**
     * 传说卡横幅右上角的玩家头像。
     *
     *  头像要过 head/icon 表 + 控制器 AssetService 才拿得到，是**异步**的；而 `createGame` 是同步路径
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
            this.loadHeadFrame(avatars.player).catch(() => null),
            this.loadHeadFrame(avatars.enemy).catch(() => null),
        ]).then(([player, enemy]) => {
            //  判据只用 phase：`renderWorld` 与 `leaving` 同由 `shutdown()` 驱动（它首行 `phase.leave()`、
            // 随后同步置 null）⇒ 两者在每个 await 边界上恒等，多写一个对象判空只是重复判据。
            if (this.leaving) return;
            if (!player && !enemy) return;
            // 头像帧落在控制器上（横幅按 owner 现取）；这里只通知渲染世界补刷**已经弹出来**的横幅。
            const portraits = new Map<string, SpriteFrame>();
            if (player) portraits.set(ZCOwner.Player, player);
            if (enemy) portraits.set(ZCOwner.Enemy, enemy);
            for (const [owner, frame] of portraits) this.legendPortraitFrames.set(owner, frame);
            this.renderWorld.refreshLegendCardArt();
        });
    }

    /**
     * 本局展示图预扫：地块翻牌保留卡表 headIcon，横幅使用阵容页专属立绘 / 职业占位。
     *
     *  口径与 `loadLegendPortraits` 完全一致：卡面图要过 icon 表 + 控制器 AssetService，是**异步**的，
     *  而 `createGame` 是同步路径（首帧必须画出来）⇒ 这里 fire-and-forget；拿到就注入解析器
     *  （`ZCGameRenderWorld.setLegendCardArtResolver` 会连同已弹出的横幅与小卡牌一起补刷），
     *  一张都拿不到就保留回退链，**不阻断对局**。
     *
     *   预扫**本局全部卡池**而不是等翻牌那一刻再按需加载：解析必须是**同步命中**，
     *  否则会先闪一帧回退图（兵种 idle / 建筑图）再换成卡面图。
     *
     *   卡池口径必须与模型 `ZCGameModel.deckFor` **逐条对齐**：那边是
     *  `ownerDecks?.[owner] ?? (player ? playerDeck : enemyDeck)`，正式对局会经
     *  `ZCClientCombatConfig` 按后端各席位阵容构筑牌组 ⇒
     *  这里若只扫全局 `getPlayerDeck()/getEnemyDeck()`，那些局会一张卡面都取不到，
     *  然后每张卡都刷「没有角色卡面图」的日志。宁可多扫，不可漏扫。
     */
    private loadLegendCardArt(art: ICardArtConfig): void {
        const config = this.matchConfig;
        const decks: ReadonlyArray<readonly ZCDeckCard[]> = [
            ...(config ? ZC_OWNER_ORDER.map((owner) => (
                config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck)
            )) : []),
            getPlayerDeck(),
            getEnemyDeck(),
        ];
        const cards = new Map<string, ZCDeckCard>();
        for (const deck of decks) {
            for (const card of deck) {
                cards.set(card.id, card);
            }
        }
        const loadIcon = this.loadIcon;
        void Promise.all(Array.from(cards.values()).map(async (card) => {
            // 立绘真源 = pvpCard.headIcon（icon.json 解析到 icons/cardHead 资源名）；
            // 无 headIcon 或缺图时回退职业雕像，与列表条目同一条解析链。
            const heroFrame = card.headIcon
                ? await this.loadHeadIconFrame(card.headIcon).catch(() => null)
                : null;
            let role = heroFrame;
            if (!role) {
                if (this.leaving) return { cardId: card.id, frame: heroFrame, role: null };
                const path = art.paths.get(`hero.${resolveCardClass(card, art.lineup)}`);
                const cut = path.lastIndexOf('/');
                role = await loadIcon(path.slice(cut + 1), path.slice(0, cut)).catch(() => null);
            }
            return { cardId: card.id, frame: heroFrame, role };
        })).then((entries) => {
            //  同上：`leaving` 已经盖住「renderWorld 被收走」这件事。
            if (this.leaving) return;
            // 原位合并本局展示表，再刷新已经弹出的卡牌和横幅。
            for (const { cardId, frame, role } of entries) {
                if (frame) this.legendCardArtFrames.set(cardId, frame);
                if (role) this.legendRoleArtFrames.set(cardId, role);
            }
            this.renderWorld.refreshLegendCardArt();
        }).catch(error => { if (ZCDC_LOG_WARNINGS) console.warn('[ZCGame] 卡牌展示图预加载失败', error); });
    }

    private readonly unitVisualPrefabs = new Map<ZCUnitId, Prefab>();
    private readonly buildingFramesByCardId = new Map<string, SpriteFrame>();

    applyUnitPrefab(unitId: string, prefab: Prefab): void {
        this.unitVisualPrefabs.set(unitId, prefab);
    }

    /**
     * 特效美术按需补载到货 → 交给渲染世界合并进本局特效表（下一帧由它补挂到在飞的特效节点上）。
     *
     * 为什么不在这里持一份 Map：渲染世界会因为后补 job 而**整体换掉** `effectVisualPrefabs`
     * 的快照（`applyDeferredArt` 里 `new Map([...])`），视图侧留一份引用必然指向旧表 ⇒ 合到幽灵里。
     * 唯一持有者就是渲染世界，入口也只有它一个。
     */
    applyEffectPrefab(path: string, prefab: Prefab): void {
        this.renderWorld?.applyEffectPrefab(path, prefab);
    }

    /** 这里只做同步实例化和首帧渲染；异步工作必须在调用前全部完成。 */
    private createGame(prepared: IZCGamePreparedResources, model: IZCBattleRenderModel | null, selection: ZCSpawnSelection | null): void {
        const entryMatchConfig = this.matchConfig;
        if (!entryMatchConfig) throw new Error('ZCGame.initialize 缺少本局配置快照');
        const setupConfig = entryMatchConfig;

        this.node.removeAllChildren();

        const hud = instantiate(prepared.hudPrefab);
        hud.setParent(this.node);
        hud.setPosition(Vec3.ZERO);
        // 视图组件与它的 14 个 @property 都在 ZCGameHUD.prefab 上绑好（leftPlayer / rightPlayer /
        // gameVS 是嵌套实例引用，走根 PrefabInfo 的 targetOverrides）⇒ 不再 `|| addComponent` 兜底：
        // 那个分支永远走不到，真掉组件时反而会静默补一个空视图。
        this.hudView = hud.getComponent(ZCGameHUDView);
        // HUD 的神器按钮原先显示 prefab 硬绑的通用图（`image/gameui/zd_faqi.png`），
        // 与本局携带的神器无关 ⇒ 棋盘显示剑、HUD 显示石锤。这里喂同一份已加载的帧。
        // ⚠️ 自选地图局**不遮蔽这个按钮**：它显示的是玩家自己的神器，不是地图里的随机资源
        //   （2026-10-23 首次改错成"自选局用问号"，已回退）。
        this.hudView.setArtifactFrame(prepared.artifactIconFrame);
        // 开局镜头停在我方主城那一格，而不是整盘中心（3 / 4 人图的整盘中心落在几块领地
        // 之间的中立空白处）。必须在 initialize 之前给 —— 入场镜头在 initialize 里就播完了。
        // 自选主城图此时还没有主城坐标（`playerHomeId = -1`），落点留空，
        // 由 `finishSpawnSelection` 在选点完成后补上。
        this.hudView.setMapFocus(buildPlayerHomeFocus(setupConfig.map));
        // 本局地图自己的镜头倍率区间（地图 JSON 的 zoomMin / zoomMax，缺省 0.6~1.2）。
        // 必须在 initialize 之前注入 —— 入场镜头的收尾倍率就是拿这个区间夹出来的。
        const zoom = resolveZCMapZoom(setupConfig.map);
        this.hudView.setMapZoomRange(zoom.min, zoom.max);

        const selectingSpawn = (setupConfig.map.cityMode ?? 'fixed') === 'select';
        this.hudView.initialize({ deferMapIntro: selectingSpawn });
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

        for (const [id, prefab] of prepared.unitVisualPrefabs) this.unitVisualPrefabs.set(id, prefab);
        const decks = [getPlayerDeck(), getEnemyDeck(), ...ZC_OWNER_ORDER.map(owner =>
            setupConfig.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? setupConfig.playerDeck : setupConfig.enemyDeck))];
        for (const deck of decks) for (const card of deck) {
            const frame = card.buildIcon ? prepared.buildingFrames.get(card.buildIcon) : null;
            if (frame) this.buildingFramesByCardId.set(card.id, frame);
        }
        const presentationArt: IZCBattlePresentationArt = {
            unitVisualPrefabs: this.unitVisualPrefabs,
            cardArtFrames: this.legendCardArtFrames,
            legendRoleArtFrames: this.legendRoleArtFrames,
            buildingFramesByCardId: this.buildingFramesByCardId,
            buildingFrames: prepared.buildingFrames,
            legendPortraitFrames: this.legendPortraitFrames,
        };
        this.renderWorld = new ZCGameRenderWorld({
            owner: this, presentationArt,
            mapLayer: this.hudView.mapLayer,
            board,
            wallLayer,
            hexPrefab: prepared.hexPrefab,
            unitPrefab: prepared.unitPrefab,
            unitVisualPrefabs: this.unitVisualPrefabs,
            buildingFrames: prepared.buildingFrames,
            wallFrames: prepared.wallFrames,
            wallMaterial: prepared.wallMaterial,
            unitOutlineCopyEffect: prepared.unitOutlineCopyEffect,
            hexGroundGlowFrames: prepared.hexGroundGlowFrames,
            hexPulseFrames: prepared.hexPulseFrames,
            // 神器领取的格心蓝色爆炸（18 帧序列帧）。
            artifactClaimBurstFrames: prepared.artifactClaimBurstFrames,
            effectPrefab: prepared.effectPrefab,
            effectVisualPrefabs: prepared.effectVisualPrefabs,
            allowGenericEffects: !!prepared.loadDeferredArt,
            floatTextPrefab: prepared.floatTextPrefab,
            cardRevealPrefab: prepared.cardRevealPrefab,
            legendBannerPrefab: prepared.legendBannerPrefab,
            // 传说卡横幅弹在屏幕正中 ⇒ 挂全屏层；mapLayer 是 ScrollView 的 content，会跟着拖动跑。
            overlayLayer: this.hudView.node,
            // 中立资源点「神器充能」格显示玩家携带的那件神器（整局一张，逐个地块视图注入）。
            artifactIconFrame: prepared.artifactIconFrame,
            // 自选地图局的中立资源格盖成问号（资源进游戏才随机，别剧透是箱子还是金矿）。
            unknownResourceFrame: prepared.unknownResourceFrame,
            neutralResourceFrames: prepared.neutralResourceFrames,
            // 中立资源获取特效：飞向 HUD 金币栏的那把金币贴图。
            goldCoinFrame: prepared.goldCoinFrame,
            // 自选主城区域气泡底图（frame_01 绿 / frame_02 红，九宫格）。
            spawnRegionFrames: prepared.spawnRegionFrames,
            // 金币粒子落点 = 整个 CoinPanel 面板（不是 GoldLabel / coin 子图标）。
            coinPanelNode: this.hudView.coinPanel,
            artifactButtonNode: this.hudView.artifactButton.node,
            decorPrefab: prepared.decorPrefab,
            spawnFxPrefab: prepared.spawnFxPrefab,
            deathFxPrefab: prepared.deathFxPrefab,
            buildingDestroyFxPrefab: prepared.buildingDestroyFxPrefab,
            hitFxPrefabs: prepared.hitFxPrefabs,
            wallPrefab: prepared.wallPrefab,
        });
        this.loadLegendPortraits();
        this.loadLegendCardArt(prepared.cardArtConfig);
        this.loadDefenceBossArt();
        if (selection) {
            this.renderWorld.initialize(setupConfig.map);
            this.startSpawnSelection(prepared);
        } else {
            if (!model) throw new Error('固定主城缺少战斗展示数据');
            this.renderWorld.initialize(model.mapConfig);
        }
        // 自选主城阶段还没有模型，自由装饰直接从本局地图配置读取。
        this.installMapDecor(setupConfig.map, prepared.decorFrames);
        this.scheduleDeferredArt(prepared, setupConfig.map);
    }

    private scheduleDeferredArt(prepared: IZCGamePreparedResources, map: ZCMatchMap): void {
        const load = prepared.loadDeferredArt;
        if (!load) return;
        const isCurrent = (): boolean => !this.leaving && this.isValid && this.preparedResources === prepared;
        const afterDraw = (): void => {
            this.deferredAfterDraw = null;
            if (!isCurrent()) return;
            if (ZCDC_LOG_DIAGNOSTICS) console.info('[BattleLoading] 首帧已绘制，开始后补特效');
            let decorFrames = prepared.decorFrames;
            void load(art => {
                if (!isCurrent()) return;
                this.renderWorld.applyDeferredArt(art);
                if (art.decorFrames !== decorFrames) {
                    decorFrames = art.decorFrames;
                    this.installMapDecor(map, decorFrames);
                }
            }).catch(error => {
                if (isCurrent()) if (ZCDC_LOG_WARNINGS) console.warn('[BattleLoading] 后补特效中断', error);
            });
        };
        this.deferredAfterDraw = afterDraw;
        director.once(Director.EVENT_AFTER_DRAW, afterDraw);
    }

    /** 从 `art.freeDecor` 铺纯表现装饰；不依赖模型，也不参与格子规则。 */
    private installMapDecor(map: ZCMatchMap, decorFrames: ReadonlyMap<string, SpriteFrame>): void {
        this.renderWorld.installDecor(
            buildDecorPlacements(map.art?.freeDecor, (art) => {
                const frame = decorFrames.get(art);
                return frame ? frame.originalSize : null;
            }),
            decorFrames,
        );
    }
    private startSpawnSelection(prepared: IZCGamePreparedResources): void {
        this.hudView.setSpawnSelectionMode(true);
        if (!prepared.spawnSelectionPrefab) throw new Error('自选主城缺少选点界面资源');
        const node = instantiate(prepared.spawnSelectionPrefab);
        node.layer = this.hudView.node.layer;
        node.setParent(this.hudView.node);
        this.spawnSelectionView = node.getComponent(ZCSpawnSelectionView);
        this.spawnSelectionView.initialize();
        this.borrowSpawnConfirmButton();
    }

    renderSpawnSelection(selection: ZCSpawnSelection, hints: boolean): void {
        this.spawnSelectionView?.render(selection.snapshot, hints);
        this.renderWorld.renderSpawnSelection(selection, hints);
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
        //  这里不判「按钮 / 父级是否存在」：`confirmButton` 是 `ZCSpawnSelection.prefab` 上的**必填引用**
        //（`ZCSpawnSelectionView` 声明 `Node = null!`），而本方法唯一的调用点是刚 `instantiate + setParent`
        // 完的 `startSpawnSelection` ⇒ 节点必然有效、也必然有父级。真掉绑定就该在这里炸，别静默不借。
        const button = this.spawnSelectionView.confirmButton;
        const layer = this.hudView.mapLayer;
        const parent = button.parent;
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
        this.renderWorld.setSpawnConfirmButton(button);
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

    /**
     * 守城（塔防）局的波次面板：**按需实例化**，非守城局直接销毁。
     *
     * 面板上两拨东西的生命周期**不同**（2026-11-09 用户）：
     *  · 波次徽标（`IconBoss` + `第N/M波`）**常驻**，从第一波起一直挂着；
     *  · 当前波生成后，普通波与 BOSS 波都显示头像 / 名字 / 总血条。
     *
     * 头像与名字按 `currentWaveCardId` 查 `loadDefenceBossArt()` 预扫好的表（解析必须同步命中，
     * 否则会先闪一帧空框再换成怪图）；`render` 每帧全量赋值，面板侧不做增量。
     */
    private renderBossPanel(model: IZCBattleRenderModel): void {
        const progress = model.defenceWaveProgress;
        if (!progress) {
            this.bossPanel?.node.destroy();
            this.bossPanel = null;
            return;
        }
        if (!this.bossPanel) {
            const prepared = this.preparedResources;
            //  同族简化：`preparedResources` 只在 `shutdown()` 里清空 ⇒ 与 `leaving` 恒等。
            if (this.leaving) return;
            const hud = this.hudView.node;
            if (!prepared.bossPanelPrefab) throw new Error('守城战斗缺少首领面板资源');
            const node = instantiate(prepared.bossPanelPrefab);
            node.layer = hud.layer;
            node.setParent(hud);
            // 位置归 prefab 的 Widget（左上角按 top=76 / left=129 钉住），这里不写 setPosition。
            this.bossPanel = node.getComponent(ZCHudBossPanel);
        }
        this.bossPanel.setBossBarVisible(progress.currentWaveId !== null);
        const cardId = progress.currentWaveCardId;
        this.bossPanel.render(
            progress,
            cardId ? this.bossNames.get(cardId) ?? '' : '',
            cardId ? this.bossPortraits.get(cardId) ?? null : null,
        );
    }

    /**
     * 波次怪可能来自任一参战席位或完整卡牌目录；按与单位模型一致的卡 id 收集头像与名字。
     *
     * 头像走卡表 `headIcon`，异步加载完再落表；
     * 一张都拿不到就留空框，**不阻断对局**。
     */
    private loadDefenceBossArt(): void {
        const config = this.matchConfig;
        const decks: ReadonlyArray<readonly ZCDeckCard[]> = [
            getEnemyDeck(),
            ...(config ? ZC_OWNER_ORDER.map((owner) => (
                config.ownerDecks?.[owner] ?? (owner === ZCOwner.Player ? config.playerDeck : config.enemyDeck)
            )) : []),
        ];
        const icons = new Map<string, string>();
        for (const deck of decks) {
            for (const card of deck) {
                if (card.name) this.bossNames.set(card.id, card.name);
                if (card.headIcon) icons.set(card.id, card.headIcon);
            }
        }
        for (const [cardId, icon] of Array.from(icons)) {
            void this.loadHeadIconFrame(icon).then((frame) => {
                if (!this.leaving && frame?.isValid) this.bossPortraits.set(cardId, frame);
            }).catch((error) => { if (ZCDC_LOG_WARNINGS) console.warn(`[ZCGame] 波次怪头像加载失败：${icon}`, error); });
        }
    }

}
