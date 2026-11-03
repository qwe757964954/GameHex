import { ProcedureBase, type ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { PostLoginComposition } from '../bootstrap/login/PostLoginComposition';

/** 流程只转发生命周期，登录后加载会话由外部组合层持有。 */
export class ProcedurePostLogin extends ProcedureBase {
    public static __cname = 'ProcedurePostLogin';
    private composition: PostLoginComposition | null = null;
    async onPreload(_params?: unknown, context?: ProcedurePreloadContext): Promise<void> {
        if (!context) throw new Error('登录后加载缺少 ProcedurePreloadContext');
        this.disposeComposition();
        const composition = new PostLoginComposition({ assets: this.assets, configs: this.configs, sessionAssets: this.sessionAssets }, this.host);
        this.composition = composition;
        await composition.preload(context);
    }
    onEnter(params?: unknown): void { this.composition?.mount(params); }
    onPreloadCancelled(): void { this.disposeComposition(); }
    onLeave(): void {
        this.composition?.leave();
        this.composition = null;
        this.releaseResourceScope();
    }
    protected onDestroy(): void { this.disposeComposition(); super.onDestroy(); }
    private disposeComposition(): void { this.composition?.dispose(); this.composition = null; }
}
