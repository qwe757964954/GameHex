import { game, instantiate, Node, Prefab, SpriteFrame, Vec3, view } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { ARTIFACT_ART_ROOT, MATCH_ART_ROOT, MATCH_SLOT_BARS, MATCH_SLOT_FRAMES, TERRITORY_CLOUD_ART_ROOT } from '../../ArtPaths';
import { preloadHeadByIds } from '../../HeadArtModel';
import { ZC_BATTLE_TYPE_PVP, type MatchProfileLookup } from '../../battle/BattleStartModel';
import { clearLastBattleStart, startBattle } from '../../battle/BattleStartService';
import { getLastPvpInfo, fetchPvpInfo } from '../../battle/PvpInfoService';
import { GameNet } from '../../net/GameNet';
import { createMatchIconLoader, preloadMatchIcons, type MatchIconLoader } from '../../matching/MatchIcons';
import { MatchingPage } from '../../matching/MatchingPage';
import { MatchingController } from '../../matching/MatchingController';
import { MatchingModel } from '../../matching/MatchingModel';
import { resolveMatchSeats } from '../../matching/MatchSlots';
import { LOCAL_PLAYER } from '../../matching/MatchPool';
import { loadMatchProfileLookup } from '../../matching/MatchProfileConfig';
import { buildSelfPlayerData, readSelfIdentity } from '../../matching/MatchSelfProfile';
import { loadMatchTips } from '../../matching/MatchTipsConfig';
import type { IMatchingEntryParams } from '../../matching/MatchTypes';
import { createZCBattleSession } from '../../zcds/application/ZCBattlePreparation';
import { getZCLocalPlayerCountOverride } from '../../zcds/model/ZCMapConfig';
import { TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS } from '../../territory/model/TerritoryBattleIntro';
import { TerritoryBattleCover } from '../../territory/view/TerritoryBattleCover';
import { TerritoryBattleCoverOverlay } from '../../territory/view/TerritoryBattleCoverOverlay';

/** 装配服务与生命周期；本轮匹配规则归 MatchingController/MatchingModel。 */
export class MatchingComposition extends ControllerBase {
    private prefab: Prefab | null = null;
    private node: Node | null = null;
    private iconLoader: MatchIconLoader | null = null;
    private tips: readonly string[] = [];
    private lookup: MatchProfileLookup | null = null;
    /**
     * 匹配界面**底下**那层云（领地普通关才建）。
     *
     * 玩家在匹配界面看到的不是"云散了"，而是"云一直在，只是被界面盖着"。所以这层云必须是
     * 匹配页自己的第 0 个子节点：界面一关就露出来，不需要跨流程去保住领地页的节点。
     */
    private cover: TerritoryBattleCover | null = null;
    /**
     * 交接出去之后接管这层云的宿主（跨流程活到战场挂上、散完再自己收）。
     *
     * 「先切战场、再散云」要求云在 `navigate` 之后还活着，而匹配页（含页内的云）会在
     * `onLeave` 里被整体销毁 —— 所以关界面那一刻把云**搬**到流程宿主下的这一层。
     */
    private handoffOverlay: TerritoryBattleCoverOverlay | null = null;
    /** 待机五帧（`cloud_idle_0..4`）；只有领地普通关会在 preload 里加载。 */
    private cloudFrames: SpriteFrame[] = [];
    constructor(context: IControllerContext, private readonly host: Node) { super(context, 'matching-composition'); }
    async preload(context: ProcedurePreloadContext, params?: IMatchingEntryParams): Promise<void> {
        this.resources.sessionAssets.pauseWarmup?.();
        const prefab = await this.resources.assets.load('ui/matching/MatchingRoot', Prefab, { scope: context.resources });
        if (context.cancelled || this.isDisposed) return;
        this.prefab = prefab;
        // 领地普通关：匹配界面底下要铺同一屏云（约 5 张 PNG，与主界面同源，通常已在缓存里）。
        if (params?.pve) await this.loadCloudFrames(context);
        if (context.cancelled || this.isDisposed) return;
        const iconLoader = createMatchIconLoader(this.resources.assets, context.resources);
        this.iconLoader = iconLoader;
        const [tips, lookup] = await Promise.all([loadMatchTips(this.resources.configs), loadMatchProfileLookup(this.resources.configs)]);
        if (context.cancelled || this.isDisposed) return;
        this.tips = tips;
        this.lookup = lookup;
        await Promise.all([
            preloadMatchIcons([LOCAL_PLAYER.avatarIcon, 'icon_fdj', ...MATCH_SLOT_BARS, ...MATCH_SLOT_FRAMES], MATCH_ART_ROOT, iconLoader),
            preloadMatchIcons(lookup.allArtifactIcons(), ARTIFACT_ART_ROOT, iconLoader),
            preloadHeadByIds([readSelfIdentity()?.avatarId ?? ''], lookup.headArt, iconLoader),
        ]);
        if (context.cancelled || this.isDisposed) return;
    }
    mount(params?: IMatchingEntryParams): void {
        if (!this.prefab || !this.iconLoader || this.isDisposed) throw new Error('MatchingRoot 尚未准备好');
        try {
            const node = instantiate(this.prefab);
            this.node = node;
            const page = node.getComponent(MatchingPage);
            page.initialize(this.iconLoader, this.tips);
            const controller = this.createController(page, params);
            this.own(() => controller.dispose());
            this.listen(VIEW_LIFECYCLE, (event: IViewLifecycle) => {
                if (event.owner !== page) return;
                if (event.phase === 'ready') controller.start();
                else if (event.phase === 'destroyed') this.dispose();
            });
            node.setPosition(Vec3.ZERO);
            node.setParent(this.host);
            this.buildCover(node, page, params);
        } catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[MatchingComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private createController(page: MatchingPage, params?: IMatchingEntryParams): MatchingController {
        const identity = readSelfIdentity();
        // 本局几个人：入口声明（按模式）与本地固定人数取大者；都没有就 `null`，
        // 让模型按最小值铺，等服务端回包再按真实人数重排（口径见 `MatchSlots`）。
        const seats = resolveMatchSeats(params?.participants, getZCLocalPlayerCountOverride());
        const model = new MatchingModel(buildSelfPlayerData(identity, this.lookup), identity?.roleId, this.lookup, seats);
        model.pvp = getLastPvpInfo();
        clearLastBattleStart();
        this.own(() => clearLastBattleStart());
        return new MatchingController(this.resources, {
            model,
            failed: error => console.error('[MatchingComposition]', error),
            // 领地普通关：匹配成功后不直接切战场，而是「关界面 → 露云 → 等资源 → 散云 → 跳」。
            // 云是这一页自己的子节点，所以这三件事只能在这里做（那边的主界面已经销毁了）。
            handoff: params?.pve
                ? {
                    closeInstantly: () => this.handOverCover(),
                    // 顺序是"先切场、再散云"：`releaseCover` 在 `navigate` 之后才被调，
                    // 云这时已经搬到跨流程的顶层，等战场挂上才开始散（见 overlay）。
                    releaseCover: () => this.handoffOverlay?.arm(),
                    readyTimeout: TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS,
                }
                : undefined,
            battle: {
                requestBattle: (caller, isCurrent) => startBattle(params?.battleType ?? ZC_BATTLE_TYPE_PVP, params?.battleParams ?? [], caller, isCurrent),
                createSession: (task, owner) => createZCBattleSession(this.resources, { owner, battle: task.then(battle => {
                        if (!battle)
                            throw new Error('服务端未确认开战');
                        return battle;
                    }), params: { pve: params?.pve, selfRoleId: identity?.roleId, battleType: params?.battleType } }),
                fetchPvp: caller => fetchPvpInfo(caller),
                removeCaller: caller => GameNet.instance.removeCaller(caller)
            },
            view: {
                render: state => page.render(state)
            },
            navigation: {
                // 领地普通关的 `pve` 在这里透传：匹配页不认识它，但战斗流程要靠它拿波次表 /
                // 敌阵 / `territorySaveOwner`（战报回写）。丢了这一项，打完这一关领地进度不动。
                navigate: (route, entry) => {
                    const pve = params?.pve;
                    ProcedureManager.navigate(route, pve && entry && typeof entry === 'object'
                        ? { ...(entry as Record<string, unknown>), pve }
                        : entry);
                }
            },
            clock: {
                schedule: (callback, seconds) => { page.scheduleOnce(callback, seconds); return () => page.unschedule(callback); }
            },
        });
    }
    /**
     * 取过场用那几张**云体**（`image/territory/cloud/cloud_body_*`）。
     *
     * 🔴 不要换成 `cloud_idle_*`：那是「云体 + 影子」烤在一起的合并图，密铺时每朵的黑影
     * 会盖在邻居的白云体上 ⇒ 整屏发灰（实机整屏均值 147，领地正常页 231）。
     * 与领地页共用同一组帧，交接过去才是同一屏云。
     *
     * 目录整个没导入 / 加载失败都只是"没有云"，不影响匹配本身：`buildCover` 会跳过，
     * 散场那一下露出空底色 —— 比让玩家进不了匹配强。
     */
    private async loadCloudFrames(context: ProcedurePreloadContext): Promise<void> {
        try {
            const frames = await this.resources.assets.loadDir(TERRITORY_CLOUD_ART_ROOT, SpriteFrame, {
                scope: context.resources,
            });
            this.cloudFrames = (frames ?? [])
                .filter((frame) => !!frame?.name && frame.name.startsWith('cloud_body_'))
                .sort((left, right) => left.name.localeCompare(right.name));
        } catch (error) {
            this.cloudFrames = [];
            console.warn('[MatchingComposition] 过场云帧加载失败', error);
        }
    }

    /**
     * 把领地页那一屏云**在匹配界面底下重建一份**。
     *
     * 为什么可以"重建"而不怕接不上：点阵是**确定性**的（`territoryBattleIntroCoverPuffs`
     * 纯函数 + 同一视口），待机相位靠 `coverStep` 从领地页带过来 ⇒ 切流程那一帧画面逐像素相同。
     *
     * 层级：建成第 0 个子节点（在所有匹配 UI 之下）。`TerritoryBattleCover.build` 默认摆在
     * 最上层（地图那边要盖住一切），所以这里必须再往下压一次。
     */
    private buildCover(node: Node, page: MatchingPage, params?: IMatchingEntryParams): void {
        if (!params?.pve || !this.cloudFrames.length) {
            if (params?.pve) {
                console.warn('[MatchingComposition] 过场云帧缺失（image/territory/cloud/cloud_idle_0…4），'
                    + '匹配界面底下不会有云，散场那一下会露出空底色');
            }
            return;
        }
        // 尺寸以领地页带过来的为准（那才是它实际铺过的那一屏）；没带才退回可视区域。
        const viewport = params.coverViewport;
        const size = viewport && viewport.width > 0 && viewport.height > 0
            ? viewport
            : view.getVisibleSize();
        const cover = new TerritoryBattleCover(node, this.cloudFrames);
        if (!cover.build(size.width, size.height)) return;
        cover.layerNode?.setSiblingIndex(0);
        // 与领地页最后一帧对齐：云已经合拢到位、整层不透明。
        cover.setBaseStep(params.coverStep ?? 0);
        cover.apply(1, 1, 0);
        this.cover = cover;
        // 菜单页不会给"每帧回调"，用组件的调度器（interval=0 ⇒ 每帧）。
        // `game.deltaTime` 而非 `director.getDeltaTime()`：后者自 3.3 起废弃（3.8 每帧刷 deprecated 告警）。
        page.schedule(() => cover.tick(game.deltaTime), 0);
    }

    /** 匹配界面**瞬间**消失：只把 UI 那几棵子树关掉，云留着（它就是"被露出来的底"）。 */
    private hidePageContent(): void {
        const node = this.node;
        if (!node?.isValid) return;
        const coverNode = this.cover?.layerNode ?? null;
        for (const child of node.children) {
            if (child === coverNode) continue;
            child.active = false;
        }
    }

    /**
     * 交接的第一步：藏 UI + 把云**搬出匹配页**。
     *
     * 🔴 为什么要搬：下一步就是 `navigate('battle')`，而 `onLeave` 会把匹配页连同页内的云
     * 一起销毁。云要是留在页里，"散云"就只能在切场之前发生 —— 那正是被打回的那版：
     * 云底下一片黑（页面 UI 已经关了，战场还没挂上）。
     */
    private handOverCover(): void {
        this.hidePageContent();
        const cover = this.cover;
        if (!cover?.built) return;
        const overlay = TerritoryBattleCoverOverlay.create(this.host, cover);
        if (!overlay) return;
        this.handoffOverlay = overlay;
        // 所有权转交：`dispose` 里的销毁与这里都按 `this.cover` 判断，置空即可。
        this.cover = null;
    }

    dispose(): void {
        this.releaseInputs();
        const cover = this.cover;
        this.cover = null;
        const overlay = this.handoffOverlay;
        this.handoffOverlay = null;
        const node = this.node;
        this.node = null;
        this.cloudFrames = [];
        this.prefab = null; this.iconLoader = null; this.lookup = null; this.tips = [];
        try { cover?.dispose(); }
        finally {
            // 已交接的云归 overlay；离开时 arm 保证中断导航也能超时散场。
            try { overlay?.arm(); }
            finally {
                try { if (node?.isValid) node.destroy(); }
                finally { super.dispose(); }
            }
        }
    }
}
