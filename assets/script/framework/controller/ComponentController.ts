import { ProcedureManager } from '../procedure/ProcedureManager';
import { ControllerBase } from './ControllerBase';

/** Resolve the existing runtime only when a Cocos component first needs its services. */
export class ComponentController extends ControllerBase {
    constructor(scopeName: string) {
        super(() => {
            const manager = ProcedureManager.instance;
            if (!manager) throw new Error(`${scopeName} requires the configured application context`);
            return manager.context;
        }, scopeName);
    }
}
