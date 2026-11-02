import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { VIEW_LIFECYCLE, type IViewLifecycle } from '../../../framework/ui/ViewLifecycle';
import { ARTIFACT_ART_ROOT, MATCH_ART_ROOT, MATCH_SLOT_BARS, MATCH_SLOT_FRAMES } from '../../ArtPaths';
import { preloadHeadByIds } from '../../HeadArtModel';
import { ZC_BATTLE_TYPE_PVP, type MatchProfileLookup } from '../../battle/BattleStartModel';
import { clearLastBattleStart, startBattle } from '../../battle/BattleStartService';
import { getLastPvpInfo, fetchPvpInfo } from '../../battle/PvpInfoService';
import { GameNet } from '../../net/GameNet';
import { createMatchIconLoader, preloadMatchIcons, type MatchIconLoader } from '../../matching/MatchIcons';
import { MatchingPage } from '../../matching/MatchingPage';
import { MatchingController } from '../../matching/MatchingController';
import { MatchingModel } from '../../matching/MatchingModel';
import { LOCAL_PLAYER } from '../../matching/MatchPool';
import { loadMatchProfileLookup } from '../../matching/MatchProfileConfig';
import { buildSelfPlayerData, readSelfIdentity } from '../../matching/MatchSelfProfile';
import { loadMatchTips } from '../../matching/MatchTipsConfig';
import type { IMatchingEntryParams } from '../../matching/MatchTypes';
import type { SessionAssetService } from '../../../core/asset/SessionAssetService';
import type { BattlePreloadProvider } from '../../session/AppSessionAssetService';
import { createZCBattlePreload } from '../../zcds/application/ZCBattlePreparation';

/** 装配服务与生命周期；本轮匹配规则归 MatchingController/MatchingModel。 */
export class MatchingComposition extends ControllerBase {
    private prefab: Prefab | null = null;
    private node: Node | null = null;
    private iconLoader: MatchIconLoader | null = null;
    private tips: readonly string[] = [];
    private lookup: MatchProfileLookup | null = null;
    constructor(context: IControllerContext, private readonly host: Node) { super(context, 'matching-composition'); }
    async preload(context: ProcedurePreloadContext): Promise<void> {
        this.resources.sessionAssets.pauseWarmup?.();
        const prefab = await this.resources.assets.load('ui/matching/MatchingRoot', Prefab, { scope: context.resources });
        if (context.cancelled || this.isDisposed) return;
        this.prefab = prefab;
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
            const identity = readSelfIdentity();
            const model = new MatchingModel(buildSelfPlayerData(identity, this.lookup), identity?.roleId, this.lookup);
            model.pvp = getLastPvpInfo();
            clearLastBattleStart();
            this.own(() => clearLastBattleStart());
            const provider = this.resources.sessionAssets as SessionAssetService & Partial<BattlePreloadProvider>;
            const controller = new MatchingController(this.resources, {
                model, requestBattle: (caller, isCurrent) => startBattle(params?.battleType ?? ZC_BATTLE_TYPE_PVP, params?.battleParams ?? [], caller, isCurrent),
                createPreload: task => provider.takeBattlePreload?.() ?? createZCBattlePreload(task.then(battle => {
                    if (!battle) throw new Error('服务端未确认开战');
                    return battle;
                })),
                fetchPvp: caller => fetchPvpInfo(caller), render: state => page.render(state),
                removeCaller: caller => GameNet.instance.removeCaller(caller),
                schedule: (callback, seconds) => { page.scheduleOnce(callback, seconds); return () => page.unschedule(callback); },
                navigate: (route, entry) => ProcedureManager.navigate(route, entry),
                failed: error => console.error('[MatchingComposition]', error),
            });
            this.own(() => controller.dispose());
            this.listen(VIEW_LIFECYCLE, (event: IViewLifecycle) => {
                if (event.owner !== page) return;
                if (event.phase === 'ready') controller.start();
                else if (event.phase === 'destroyed') this.dispose();
            });
            node.setPosition(Vec3.ZERO);
            node.setParent(this.host);
        } catch (error) { this.dispose(); throw error; }
    }
    dispose(): void {
        this.releaseInputs();
        const node = this.node;
        this.node = null;
        if (node?.isValid) node.destroy();
        this.prefab = null; this.iconLoader = null; this.lookup = null; this.tips = [];
        super.dispose();
    }
}
