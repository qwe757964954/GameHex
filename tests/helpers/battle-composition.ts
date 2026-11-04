import { ZC_BATTLE_EVENTS } from '../../assets/script/app/zcds/application/ZCBattleEvents';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import { ZCBattleController } from '../../assets/script/app/zcds/application/ZCBattleController';
import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import { bundleForPath } from '../../assets/script/core/asset/BundleCatalog';

function loadModule(path: string, resolve: (name: string) => unknown) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require: resolve });
    return exports;
}
export function loadBattlePreparation(dependencies: Record<string, unknown>) {
    return loadModule('assets/script/app/zcds/application/ZCBattlePreparation.ts', name => {
        if (name === './ZCBattleController') return { ZCBattleController };
        if (name in dependencies) return dependencies[name];
        const key = name === '../ZCGame' ? '../zcds/ZCGame'
            : name.startsWith('./') ? '../zcds/application/' + name.slice(2) : name.replace('../../', '../');
        if (!(key in dependencies)) throw new Error(`Missing preparation dependency ${name}`);
        return dependencies[key];
    });
}

/** Run the real composition and entry builder while replacing only engine/I/O edges. */
export function loadBattleComposition(dependencies: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    const builder = loadModule('assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', name => {
        const key = name.startsWith('./') ? '../zcds/application/' + name.slice(2) : '../zcds/' + name.slice(3);
        if (!(key in dependencies)) throw new Error(`Missing entry dependency ${key}`);
        return dependencies[key];
    });
    dependencies['../zcds/application/ZCBattlePreparation'] = loadBattlePreparation({ ...dependencies, './ZCBattleEntryBuilder': builder });
    return loadModule('assets/script/app/bootstrap/battle/BattleComposition.ts', name => {
        if (name in overrides) return overrides[name];
        if (name === 'cc') return { Prefab: class Prefab {} };
        if (name.endsWith('/BundleCatalog')) return { bundleForPath };
        if (name.endsWith('/ControllerBase')) return { ControllerBase };
        if (name.endsWith('/ZCBattleController')) return { ZCBattleController };
        if (name.endsWith('/ZCBattleEntryBuilder')) return builder;
        // This fixture tests entry ownership; runtime use cases have their own real-controller suite.
        if (name.endsWith('/ZCBattleRuntimeController')) return { ZCBattleRuntimeController: class {
            constructor(_context: unknown, private view: { initialize: Function }) {}
            start(entry: unknown, resources: unknown) { this.view.initialize(entry, resources, null, null); }
            dispose() {}
        } };
        if (name.endsWith('/ZCBattleSettlementController')) return { ZCBattleSettlementController: class {} };
        if (name.endsWith('/BattleResultService')) return { BattleResultService: { ensureListening() {} } };
        if (name.endsWith('/PopupDef')) return { PopupCloseReason: { Force: 3 }, PopupLayer: { SYSTEM: 1 } };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/ZCBattleEvents')) return { ZC_BATTLE_EVENTS };
        if (name.endsWith('/GameRoute')) return { GameRoute: { Main: 'main' } };
        if (name.endsWith('/FW')) return dependencies['../../framework/FW'] ?? { FW: { showTip() {} } };
        if (/\/(ZCSettlementPage|GameRunAway|ZCGuidePanel|ZCGameRankBoard|FW|GameRoute|BattleStartService|GameNet|RewardFrames|ZCBattleEvents)$/.test(name)) return {};
        if (name.endsWith('/ProcedureManager')) return dependencies['../../framework/procedure/ProcedureManager'] ?? {};
        const key = name.replace('../../', '../');
        if (!(key in dependencies)) throw new Error(`Missing battle dependency ${key}`);
        return dependencies[key];
    });
}
