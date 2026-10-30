import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import type { GameContext } from '../../assets/script/core/runtime/GameContext';

export function createControllerContext(): GameContext {
    return {
        assets: {
            load: async (_path, Type) => new Type(), loadDir: async () => [], has: async () => true,
        },
        configs: { initialize: async () => {}, getTable: async () => [] },
        sessionAssets: { ready: true, prepare: async () => {}, clear() {} },
        network: { requestJson: async () => { throw new Error('Unexpected network request'); } },
    };
}

export function createControllerResources(context = createControllerContext()) {
    class Controller extends ControllerBase {
        constructor() { super(context, 'test-controller'); }
    }
    return new Controller().resources;
}

/** VM components still exercise the real base ownership, without importing the Cocos runtime. */
export function componentControllerModule(context = createControllerContext()) {
    class ComponentController extends ControllerBase {
        constructor(scopeName: string) { super(context, scopeName); }
    }
    return { ComponentController };
}
