import { Prefab, sys } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { AudioMgr } from '../../framework/audio/AudioMgr';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { LAUNCH_UPDATE_WEIGHT, LaunchProgressUI } from '../loading/LaunchProgressUI';
import { TerritoryChapterInfoRepository } from '../territory/application/TerritoryChapterInfoRepository';

const POST_LOGIN_ERROR_MESSAGE = '加载失败，请重新进入游戏';

/**
 * 登录完成后的基础资源准备流程，负责进度、重试和返回登录。
 *
 * 进度 UI 与热更（`ProcedureUpdate`）**共用同一个启动 UI**（`LaunchProgress.prefab`，
 * 首包 resources，不进远程热更 bundle）。本流程起始进度读热更留下的旧节点实际值：
 * 热更走完（0.6）则续走；热更跳过/异常（进度 0）则从 0 起步，保证登录后 loading
 * 始终是一条 0-100% 连续进度、不会出现「到 100 再 100%」。会话基础资源与 Main
 * 界面加载合并为同一段 `[startRatio, 1]`，最终一次到达 100%。热更流程切出时已释放
 * 其预加载资源作用域，故本流程销毁热更留下的节点、用自己预加载的 prefab 重建；
 * `onLeave`（进入 Main）保留登录图节点，MainRoot 已在登录预加载阶段挂载并渲染于其下，
 * 由 `ProcedureMain.onEnter` 直接移除登录图，露出完整主城。
 */
export class ProcedurePostLogin extends ProcedureBase {
    public static __cname: string = 'ProcedurePostLogin';

    /** 启动进度 prefab（首包 resources；随 resourceScope 释放）。 */
    private launchPrefab: Prefab | null = null;
    private launchUI: LaunchProgressUI | null = null;
    private revision = 0;
    /** 本流程起始进度：热更已走到 LAUNCH_UPDATE_WEIGHT 则续走，否则（跳过/异常）从 0 起步。 */
    private startRatio = LAUNCH_UPDATE_WEIGHT;

    /** 预加载首包启动进度页（兜底：热更流程异常缺席时本流程也能创建 UI）。 */
    async onPreload(_params?: unknown, context?: ProcedurePreloadContext): Promise<void> {
        if (this.launchPrefab) return;
        const prefab = await this.assets.load('ui/loading/LaunchProgress', Prefab, { scope: context?.resources });
        if (context?.cancelled) return;
        this.launchPrefab = prefab;
    }

    onEnter(params?: { account?: string; session?: { roleId?: number; selectServerId?: number } }): void {
        const existed = LaunchProgressUI.ensure(this.host);
        if (existed) {
            // 热更流程 onLeave 已释放其预加载资源作用域（prefab + 贴图引用计数归零），
            // 旧节点保留在 host 下但 Sprite 贴图可能已失效 ⇒ 销毁重建。
            // 重建前先读取旧节点实际进度：热更走到 0.6 则续走；热更跳过/异常（进度 0）则从 0 起步。
            this.startRatio = existed.currentRatio;
            existed.release();
        }
        this.launchUI = this.launchPrefab
            ? LaunchProgressUI.createFromPrefab(this.launchPrefab, this.host)
            : null;
        if (!this.launchUI) {
            console.error('[ProcedurePostLogin] 启动进度 UI 不可用（LaunchProgress 未预加载或组件缺失）');
            return;
        }
        this.launchUI.show();
        this.bootstrapTerritoryChapterInfo(params);
        void this.prepare();
    }

    /**
     * 登录成功后拉一次「占城章节汇总」。
     *
     * - 先 `bindOwner`：按 `(serverId, roleId)` 切 namespace 并从 localStorage 恢复旧快照，
     *   冒险页在 Req 回包到之前就能用旧数据先渲染；
     * - 再 `refresh()`：发 `CmdCityChapterInfoReqMsg`，回包覆盖本地；
     * - 全程 fire-and-forget：失败不进主流程、不弹错（Repository 内部静默回落）。
     *
     * 服务端通关后主动推 `CmdCityChapterInfoBroMsg`，Repository 内部已订阅，不需要这里管。
     */
    private bootstrapTerritoryChapterInfo(
        params?: { account?: string; session?: { roleId?: number; selectServerId?: number } },
    ): void {
        let roleId: string | undefined;
        let serverId: string | undefined;
        const fromParams = params?.session;
        if (fromParams && fromParams.roleId != null && fromParams.selectServerId != null) {
            roleId = String(fromParams.roleId);
            serverId = String(fromParams.selectServerId);
        } else {
            try {
                const saved = sys.localStorage.getItem('login_session');
                if (saved) {
                    const parsed = JSON.parse(saved) as { roleId?: unknown; selectServerId?: unknown };
                    if (parsed.roleId != null && parsed.selectServerId != null) {
                        roleId = String(parsed.roleId);
                        serverId = String(parsed.selectServerId);
                    }
                }
            } catch (error) {
                console.warn('[ProcedurePostLogin] 读 login_session 失败，跳过章节汇总拉取', error);
            }
        }
        if (!roleId || !serverId) {
            console.warn('[ProcedurePostLogin] 缺少角色身份，跳过章节汇总拉取');
            return;
        }
        TerritoryChapterInfoRepository.instance.bindOwner(roleId, serverId);
        void TerritoryChapterInfoRepository.instance.refresh();
    }

    onLeave(): void {
        this.revision += 1;
        // 登录图节点保留在 host 下（MainRoot 已在其下渲染就绪），由 ProcedureMain.onEnter 直接移除。
        this.launchUI = null;
        this.launchPrefab = null;
        this.releaseResourceScope();
    }

    private async prepare(): Promise<void> {
        const revision = ++this.revision;
        this.launchUI?.setStatus('正在加载游戏资源…');
        // 登录后所有预加载合并为一条连续进度：会话资源占 (1-startRatio)*0.7，
        // Main 界面加载占剩余 0.3，最终一次到达 100%（不在中途提前满）。
        const remain = 1 - this.startRatio;
        this.launchUI?.setProgress(this.startRatio);
        // 登录成功后 `localStorage['account_num']` 才有值，音量存档键是 `setting_music<account>`
        // （老端 `OnOffMgr.OnLogin()` 同理）⇒ 这里必须重读一次，否则会一直用登录前的空账号键。
        AudioMgr.instance.init();
        try {
            await this.sessionAssets.prepare((progress) => {
                if (revision !== this.revision) return;
                this.launchUI?.setProgress(this.startRatio + progress.ratio * remain * 0.7);
            });
            if (revision !== this.revision) return;
            this.navigate(GameRoute.Main, {
                onProgress: (ratio: number) => {
                    if (revision !== this.revision) return;
                    this.launchUI?.setProgress(this.startRatio + remain * (0.7 + ratio * 0.3));
                },
                onError: () => {
                    if (revision !== this.revision) return;
                    this.launchUI?.setStatus(POST_LOGIN_ERROR_MESSAGE);
                },
            });
        } catch (error) {
            if (revision !== this.revision) return;
            console.error('[ProcedurePostLogin] 登录后资源加载失败', error);
            this.launchUI?.setStatus(POST_LOGIN_ERROR_MESSAGE);
        }
    }
}
