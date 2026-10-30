import { scopeAssetService, type AssetService } from '../../core/asset/AssetService';
import { ResourceScope } from '../../core/asset/ResourceScope';
import type { GameContext } from '../../core/runtime/GameContext';

export type IControllerContext = Pick<GameContext, 'assets' | 'configs' | 'sessionAssets'>;

/** Views receive services for presentation, without access to business controller methods. */
export interface IControllerResources {
    readonly assets: AssetService;
    readonly configs: GameContext['configs'];
    readonly sessionAssets: GameContext['sessionAssets'];
    readonly scope: ResourceScope;
}

export abstract class ControllerBase {
    readonly scope: ResourceScope;
    private resolvedResources: IControllerResources | null = null;
    private readonly resolveContext: () => IControllerContext;

    protected constructor(context: IControllerContext | (() => IControllerContext), scopeName: string) {
        this.scope = new ResourceScope(scopeName);
        this.resolveContext = typeof context === 'function' ? context : () => context;
    }

    get resources(): IControllerResources {
        if (!this.resolvedResources) {
            const context = this.resolveContext();
            this.resolvedResources = Object.freeze({
                assets: scopeAssetService(context.sessionAssets.reusableAssets ?? context.assets, this.scope),
                configs: context.configs,
                sessionAssets: context.sessionAssets,
                scope: this.scope,
            });
        }
        return this.resolvedResources;
    }

    dispose(): void { this.scope.dispose(); }
}
