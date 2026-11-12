import { ZCBattleController } from '../../assets/script/app/zcds/application/ZCBattleController';
import { ResourceScope } from '../../assets/script/core/asset/ResourceScope';
import type { IZCGamePreparedResources } from '../../assets/script/app/zcds/application/ZCGamePreparedResources';
import { createControllerContext } from './controller-context';

/** Real session for phase/runtime tests that do not load presentation resources. */
export function createBattleSession(context = createControllerContext()) {
    return new ZCBattleController(context, {
        prepareDirect: async () => ({} as IZCGamePreparedResources),
        buildEntry: () => { throw new Error('Unexpected session mount'); },
        resolvePveResult: () => {},
    }, { owner: new ResourceScope('test-session') });
}
