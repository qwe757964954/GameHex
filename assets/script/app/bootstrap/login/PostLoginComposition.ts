import { Node, Prefab, sys } from 'cc';
import { ControllerBase, type IControllerContext } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../../framework/procedure/ProcedureManager';
import { AudioMgr } from '../../../framework/audio/AudioMgr';
import { LaunchProgressUI, LAUNCH_UPDATE_WEIGHT } from '../../loading/LaunchProgressUI';
import { PostLoginController } from '../../loading/PostLoginController';
import { resolvePostLoginIdentity } from '../../loading/PostLoginContract';
import { TerritoryChapterInfoRepository } from '../../territory/application/TerritoryChapterInfoRepository';

/** 每次进入持有独立控制器，启动遮罩仅在 Main 首屏完成后交给接续流程。 */
export class PostLoginComposition extends ControllerBase {
    private prefab: Prefab | null = null;
    private ui: LaunchProgressUI | null = null;
    private controller: PostLoginController | null = null;
    constructor(context: IControllerContext, private readonly host: Node) { super(context, 'post-login-composition'); }
    async preload(context: ProcedurePreloadContext): Promise<void> {
        const prefab = await this.resources.assets.load('ui/loading/LaunchProgress', Prefab, { scope: context.resources });
        if (context.cancelled || this.isDisposed) return;
        this.prefab = prefab;
    }
    mount(params?: unknown): void {
        if (this.isDisposed || this.controller) return;
        const prefab = this.prefab;
        if (!prefab) throw new Error('LaunchProgress 尚未预加载');
        try {
            const { ui, startRatio } = this.createView(prefab);
            const controller = this.createController(ui, startRatio);
            this.controller = controller;
            this.own(() => controller.dispose());
            void controller.start(params);
        } catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { console.error('[PostLoginComposition] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private createView(prefab: Prefab): {
        ui: LaunchProgressUI;
        startRatio: number;
    } {
        const existed = LaunchProgressUI.ensure(this.host);
        const startRatio = existed ? existed.currentRatio : LAUNCH_UPDATE_WEIGHT;
        existed?.release();
        const ui = LaunchProgressUI.createFromPrefab(prefab, this.host);
        if (!ui)
            throw new Error('LaunchProgress 缺少有效视图');
        this.ui = ui;
        ui.show();
        return { ui, startRatio };
    }
    private createController(ui: LaunchProgressUI, startRatio: number): PostLoginController {
        return new PostLoginController(this.resources, {
            startRatio,
            failed: error => console.error('[PostLoginComposition] 登录后资源加载失败', error),
            session: {
                prepare: report => this.resources.sessionAssets.prepare(report),
                bootstrapIdentity: bootstrapPostLoginIdentity,
                initAudio: () => AudioMgr.instance.init()
            },
            view: {
                setProgress: ratio => ui.setProgress(ratio),
                setStatus: message => ui.setStatus(message)
            },
            navigation: {
                navigate: route => ProcedureManager.navigate(route)
            },
        });
    }
    leave(): void { this.release(this.controller?.mainReady ?? false); }
    dispose(): void { this.release(false); }
    private release(handoff: boolean): void {
        this.releaseInputs();
        this.controller = null;
        const ui = this.ui;
        this.ui = null;
        this.prefab = null;
        try { if (ui && !handoff) ui.release(); }
        finally { super.dispose(); }
    }
}

function bootstrapPostLoginIdentity(params: unknown): void {
    let owner = resolvePostLoginIdentity(params, null);
    if (!owner) {
        try {
            owner = resolvePostLoginIdentity(null, sys.localStorage.getItem('login_session'));
        }
        catch (error) {
            console.warn('[PostLoginComposition] 读取身份缓存失败', error);
        }
    }
    if (!owner) {
        console.warn('[PostLoginComposition] 缺少有效角色身份，跳过章节汇总拉取');
        return;
    }
    const repository = TerritoryChapterInfoRepository.instance;
    repository.bindOwner(owner.roleId, owner.serverId);
    // 账号仓库持有共享后台同步，流程退出不清空其快照。
    void repository.refresh().catch(error => console.warn('[PostLoginComposition] 章节汇总刷新失败', error));
}
