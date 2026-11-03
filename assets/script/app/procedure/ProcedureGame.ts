import { ProcedureBase, type ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { BattleComposition } from '../bootstrap/battle/BattleComposition';
import type { ZCGame } from '../zcds/ZCGame';
import type { ZCGameEntryParams } from '../zcds/application/ZCGameEntry';

/** 对局流程只转发生命周期，单局会话由外部组合层持有。 */
export class ProcedureGame extends ProcedureBase {
    public static __cname = 'ProcedureGame';
    private composition: BattleComposition | null = null;
    /** 兼容现有表现层的数据查询；流程动作通过事件发起。 */
    static get current(): ZCGame | null {
        const procedure = ProcedureManager.instance?.currentProcedure;
        return procedure instanceof ProcedureGame ? procedure.composition?.current ?? null : null;
    }
    async onPreload(params?: ZCGameEntryParams, context?: ProcedurePreloadContext): Promise<void> {
        if (!context) throw new Error('对局预加载需要流程资源作用域');
        this.disposeComposition();
        if (context.cancelled || context.resources.disposed) {
            params?.session?.dispose();
            return;
        }
        const composition = new BattleComposition({ assets: this.assets, configs: this.configs, sessionAssets: this.sessionAssets }, this.host, params);
        this.composition = composition;
        await composition.preload(params, context);
    }
    onEnter(): void {
        if (!this.composition) throw new Error('对局资源尚未准备完成，无法初始化 ZCGame');
        this.composition.mount();
    }
    onPreloadCancelled(): void { this.disposeComposition(); }
    onLeave(): void { this.disposeComposition(); this.releaseResourceScope(); }
    protected onDestroy(): void { this.disposeComposition(); super.onDestroy(); }
    private disposeComposition(): void { this.composition?.dispose(); this.composition = null; }
}
