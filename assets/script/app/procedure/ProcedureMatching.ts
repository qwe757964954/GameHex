import { ProcedureBase, type ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { MatchingComposition } from '../bootstrap/matching/MatchingComposition';
import type { IMatchingEntryParams } from '../matching/MatchTypes';

export class ProcedureMatching extends ProcedureBase {
    public static __cname = 'ProcedureMatching';
    private composition: MatchingComposition | null = null;
    async onPreload(params?: IMatchingEntryParams, context?: ProcedurePreloadContext): Promise<void> {
        if (!context) throw new Error('匹配流程缺少 ProcedurePreloadContext');
        const composition = new MatchingComposition({ assets: this.assets, configs: this.configs, sessionAssets: this.sessionAssets }, this.host);
        this.composition = composition;
        // `params` 要进去：领地普通关要在预加载阶段就把过场云帧取好（进页时才有云可铺）。
        await composition.preload(context, params);
    }
    onEnter(params?: IMatchingEntryParams): void { this.composition?.mount(params); }
    onPreloadCancelled(): void { this.disposeComposition(); }
    onLeave(): void { this.disposeComposition(); this.releaseResourceScope(); }
    protected onDestroy(): void { this.onLeave(); super.onDestroy(); }
    private disposeComposition(): void { this.composition?.dispose(); this.composition = null; }
}
