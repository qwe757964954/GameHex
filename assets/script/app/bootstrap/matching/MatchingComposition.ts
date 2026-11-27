import { game, instantiate, Node, Prefab, SpriteFrame, Vec3, view } from 'cc';
import { GameRoute } from '../../../core/runtime/GameRoute';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { TERRITORY_CLOUD_ART_ROOT, spriteFramePath } from '../../ArtPaths';
import type { MatchProfileLookup } from '../../battle/BattleStartModel';
import { clearLastBattleStart } from '../../battle/BattleStartService';
import { getLastPvpInfo } from '../../battle/PvpInfoService';
import { MatchIcons } from '../../matching/MatchIcons';
import { MatchingPage } from '../../matching/MatchingPage';
import { MatchingController } from '../../matching/MatchingController';
import { MatchingModel, type IMatchingViewState } from '../../matching/MatchingModel';
import { resolveMatchSeats } from '../../matching/MatchSlots';
import { loadMatchProfileLookup } from '../../matching/MatchProfileConfig';
import { buildSelfPlayerData, readSelfIdentity, type SelfIdentity } from '../../matching/MatchSelfProfile';
import { loadMatchTips } from '../../matching/MatchTipsConfig';
import { MATCHING_EVENTS, type IMatchingEntryParams, type IMatchingLeave } from '../../matching/MatchTypes';
import { getZCLocalPlayerCountOverride } from '../../zcds/model/ZCMapConfig';
import { TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS } from '../../territory/model/TerritoryBattleIntro';
import { TerritoryBattleCover } from '../../territory/view/TerritoryBattleCover';
import { TerritoryBattleCoverOverlay } from '../../territory/view/TerritoryBattleCoverOverlay';

/** 装配服务与生命周期；本轮匹配规则归 MatchingController/MatchingModel。 */
export class MatchingComposition extends ControllerBase {
    private prefab: Prefab | null = null;
    private node: Node | null = null;
    private mounted: { readonly page: MatchingPage; readonly controller: MatchingController } | null = null;
    private icons: MatchIcons | null = null;
    private identity: SelfIdentity | null = null;
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
    /** 与领地页共用的纯云体帧。 */
    private cloudFrames: SpriteFrame[] = [];
    constructor(context: IControllerContext, private readonly host: Node) { super(context, 'matching-composition'); }
    async preload(context: ProcedurePreloadContext, params?: IMatchingEntryParams): Promise<void> {
        this.resources.sessionAssets.pauseWarmup?.();
        const prefab = await this.resources.assets.load('ui/matching/MatchingRoot', Prefab, { scope: context.resources });
        if (context.cancelled || this.isDisposed) return;
        const [tips, lookup, cloudFrames] = await Promise.all([
            loadMatchTips(this.resources.configs),
            loadMatchProfileLookup(this.resources.configs),
            params?.pve ? this.loadCloudFrames(context.resources) : [],
        ]);
        if (context.cancelled || this.isDisposed) return;
        const identity = readSelfIdentity();
        const icons = new MatchIcons(this.resources.assets, context.resources);
        await icons.preload(lookup, identity?.avatarId ?? '');
        if (context.cancelled || this.isDisposed) return;
        this.prefab = prefab;
        this.icons = icons;
        this.identity = identity;
        this.tips = tips;
        this.lookup = lookup;
        this.cloudFrames = cloudFrames;
    }
    mount(params?: IMatchingEntryParams): void {
        if (!this.prefab || !this.icons || this.isDisposed) throw new Error('MatchingRoot 尚未准备好');
        try {
            const node = instantiate(this.prefab);
            this.node = node;
            const page = node.getComponent(MatchingPage);
            page.initialize(this.tips, this.icons.load);
            const controller = this.createController(params);
            this.mounted = { page, controller };
            this.own(() => controller.dispose());
            this.listen(VIEW_LIFECYCLE, this.onLifecycle);
            this.listen(MATCHING_EVENTS.STATE, this.onStateChanged);
            this.listen(MATCHING_EVENTS.HANDOFF, this.onHandoff);
            this.listen(MATCHING_EVENTS.LEAVE, this.onLeaveMatching);
            node.setPosition(Vec3.ZERO);
            node.setParent(this.host);
            this.buildCover(node, page, params);
        } catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[MatchingComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    advanceTime(seconds: number): void {
        this.mounted?.controller.advanceTime(seconds);
    }

    private createController(params?: IMatchingEntryParams): MatchingController {
        const identity = this.identity;
        // 入口声明和本地固定人数决定预期席位，回包后展示席位可按参战人数增加。
        const seats = resolveMatchSeats(params?.participants, getZCLocalPlayerCountOverride());
        const model = new MatchingModel(buildSelfPlayerData(identity, this.lookup), identity?.roleId, this.lookup, seats);
        model.updatePvpInfo(getLastPvpInfo());
        clearLastBattleStart();
        this.own(() => clearLastBattleStart());
        return new MatchingController(this.resources, {
            model,
            entry: params,
            handoffReadyTimeout: params?.pve ? TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS : undefined,
        });
    }

    private onLifecycle(event: IViewLifecycle, source: object): void {
        const mounted = this.mounted;
        if (!mounted || source !== mounted.page) return;
        if (event.phase === 'ready') mounted.controller.start();
        else if (event.phase === 'destroyed') this.dispose();
    }

    private onStateChanged(state: IMatchingViewState, source?: object): void {
        const mounted = this.mounted;
        if (!mounted || source !== mounted.controller) return;
        mounted.page.render(state);
    }

    private onHandoff(_payload: undefined, source?: object): void {
        const mounted = this.mounted;
        if (!mounted || source !== mounted.controller) return;
        this.handOverCover(mounted.page.node);
    }

    private onLeaveMatching(event: IMatchingLeave, source?: object): void {
        const mounted = this.mounted;
        if (!mounted || source !== mounted.controller) return;
        if (event.destination === 'battle') {
            ProcedureManager.navigate(GameRoute.Battle, event.entry);
        } else {
            console.error('[MatchingComposition]', event.error);
            ProcedureManager.navigate(GameRoute.Main);
        }
        this.handoffOverlay?.arm();
    }
    /** 纯云体与领地页一致（实际项目资源只有 cloud_body_0 单帧），密铺时避免合成影子把画面压暗。 */
    private async loadCloudFrames(scope: ResourceScope): Promise<SpriteFrame[]> {
        try {
            const frame = await this.resources.assets.load(
                spriteFramePath(TERRITORY_CLOUD_ART_ROOT, 'cloud_body_0'),
                SpriteFrame,
                { scope },
            );
            return frame ? [frame] : [];
        } catch (error) {
            if (!scope.disposed) console.warn('[MatchingComposition] 过场云帧加载失败', error);
            return [];
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
        if (!this.cloudFrames.length) return;
        // 尺寸以领地页带过来的为准（那才是它实际铺过的那一屏）；没带才退回可视区域。
        const viewport = params?.coverViewport;
        const size = viewport && viewport.width > 0 && viewport.height > 0
            ? viewport
            : view.getVisibleSize();
        const cover = new TerritoryBattleCover(node, this.cloudFrames);
        if (!cover.build(size.width, size.height)) return;
        cover.layerNode.setSiblingIndex(0);
        // 与领地页最后一帧对齐：云已经合拢到位、整层不透明。
        cover.setBaseStep(params?.coverStep ?? 0);
        cover.apply(1, 1, 0);
        this.cover = cover;
        // 菜单页不会给"每帧回调"，用组件的调度器（interval=0 ⇒ 每帧）。
        // `game.deltaTime` 而非 `director.getDeltaTime()`：后者自 3.3 起废弃（3.8 每帧刷 deprecated 告警）。
        page.schedule(() => cover.tick(game.deltaTime), 0);
    }

    /** 匹配 UI 即时隐藏，已建的云层交给跨流程宿主，切场时继续覆盖画面。 */
    private handOverCover(node: Node): void {
        const cover = this.cover;
        const coverNode = cover?.layerNode;
        for (const child of node.children) {
            if (child === coverNode) continue;
            child.active = false;
        }
        if (!cover) return;
        const overlay = TerritoryBattleCoverOverlay.create(this.host, cover);
        if (!overlay) return;
        this.handoffOverlay = overlay;
        // 所有权转交：`dispose` 里的销毁与这里都按 `this.cover` 判断，置空即可。
        this.cover = null;
    }

    dispose(): void {
        this.releaseInputs();
        this.mounted = null;
        const cover = this.cover;
        this.cover = null;
        const overlay = this.handoffOverlay;
        this.handoffOverlay = null;
        const node = this.node;
        this.node = null;
        this.cloudFrames = [];
        this.prefab = null; this.icons = null; this.identity = null; this.lookup = null; this.tips = [];
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
