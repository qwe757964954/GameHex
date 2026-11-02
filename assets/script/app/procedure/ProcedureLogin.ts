import { ProcedureBase, type ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { LoginComposition } from '../bootstrap/login/LoginComposition';

export class ProcedureLogin extends ProcedureBase {
    public static __cname = 'ProcedureLogin';
    private composition: LoginComposition | null = null;
    async onPreload(_params?: unknown, context?: ProcedurePreloadContext): Promise<void> {
        if (!context) throw new Error('登录流程缺少 ProcedurePreloadContext');
        const composition = new LoginComposition({ assets: this.assets, configs: this.configs, sessionAssets: this.sessionAssets }, this.network, this.host);
        this.composition = composition;
        await composition.preload(context);
    }
    onEnter(): void { this.composition?.mount(); }
    onPreloadCancelled(): void { this.disposeComposition(); }
    onLeave(): void { this.disposeComposition(); this.releaseResourceScope(); }
    protected onDestroy(): void { this.onLeave(); super.onDestroy(); }
    private disposeComposition(): void { this.composition?.dispose(); this.composition = null; }
}
