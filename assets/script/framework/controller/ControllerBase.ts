import { scopeAssetService, type AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { GameContext } from '../../core/runtime/GameContext';
import { EventMgr } from '../event/EventMgr';
import type { EventBusHandler } from '../event/EventBus';

export type IControllerContext = Pick<GameContext, 'assets' | 'configs' | 'sessionAssets' | 'callbackOwners'>;

/** Views receive services for presentation, without access to business controller methods. */
export interface IControllerResources {
    readonly assets: AssetService;
    readonly configs: GameContext['configs'];
    readonly sessionAssets: GameContext['sessionAssets'];
    readonly scope: ResourceScope;
}

/**
 * 把上下文服务绑到一个资源作用域上；`ControllerBase.resources` 与「组合根自己装配模型」共用这一份，
 * 避免同一段 `scopeAssetService(...)` 组装逻辑散在多处。
 */
export function createScopedResources(context: IControllerContext, scope: ResourceScope): IControllerResources {
    return Object.freeze({
        assets: scopeAssetService(context.sessionAssets.reusableAssets ?? context.assets, scope),
        configs: context.configs,
        sessionAssets: context.sessionAssets,
        scope,
    });
}

export abstract class ControllerBase {
    readonly scope: ResourceScope;
    private readonly lifetime = new ResourceScope('controller-inputs');
    private resolvedResources: IControllerResources | null = null;
    private resolvedContext: IControllerContext | null = null;
    private readonly resolveContext: () => IControllerContext;

    protected constructor(context: IControllerContext | (() => IControllerContext), scope: string | ResourceScope) {
        this.scope = scope instanceof ResourceScope ? scope : new ResourceScope(scope);
        if (typeof context === 'function') {
            this.resolveContext = context;
        } else {
            this.resolvedContext = context;
            this.resolveContext = () => context;
        }
    }

    get resources(): IControllerResources {
        if (!this.resolvedResources) {
            if (!this.resolvedContext) this.resolvedContext = this.resolveContext();
            this.resolvedResources = createScopedResources(this.resolvedContext, this.scope);
        }
        return this.resolvedResources;
    }

    get isDisposed(): boolean { return this.lifetime.disposed; }

    protected own(stop: () => void): () => void { return this.lifetime.defer(stop); }

    protected listen(event: string, handler: EventBusHandler): void {
        if (this.isDisposed) return;
        EventMgr.instance.on(event, handler, this);
    }

    protected clearCallbackOwners(): void {
        this.resolvedContext?.callbackOwners?.removeCallerListener(this);
    }

    protected releaseInputs(): void {
        if (this.lifetime.disposed) return;
        EventMgr.instance.offTarget(this);
        this.lifetime.dispose();
        this.clearCallbackOwners();
    }

    dispose(): void {
        this.releaseInputs();
        this.scope.dispose();
    }
}
