import { reportGuideComplete, reportBattleGuideSettled } from '../../assets/script/app/guide/application/GuideEvents';
import { ownersForPlayerCount, ZCOwner } from '../../assets/script/app/zcds/model/ZCMapConfig';
import { ZC_BATTLE_EVENTS } from '../../assets/script/app/zcds/application/ZCBattleEvents';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import { ZCBattleController } from '../../assets/script/app/zcds/application/ZCBattleController';
import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import { bundleForPath } from '../../assets/script/core/asset/BundleCatalog';
import { ResourceScope } from '../../assets/script/core/asset/ResourceScope';
import * as zcdsLogSwitch from '../../assets/script/app/zcds/ZCDCLogSwitch';

function loadModule(path: string, resolve: (name: string) => unknown) {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require: resolve });
    return exports;
}
export function loadBattlePreparation(dependencies: Record<string, unknown>) {
    return loadModule('assets/script/app/zcds/application/ZCBattlePreparation.ts', name => {
        if (name === '../ZCDCLogSwitch') return zcdsLogSwitch;
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
    // `ZCBattleEntryBuilder` 自 11-23 起要 `ownersForPlayerCount` / `ZCOwner`（纯函数 + 枚举，
    // 没有引擎依赖）⇒ 直接用真模块补上，别让「缺桩」把整个组合层夹具卡在求值阶段。
    if (!('../zcds/model/ZCMapConfig' in dependencies)) {
        dependencies['../zcds/model/ZCMapConfig'] = { ownersForPlayerCount, ZCOwner };
    }
    const builder = loadModule('assets/script/app/zcds/application/ZCBattleEntryBuilder.ts', name => {
        const key = name.startsWith('./') ? '../zcds/application/' + name.slice(2) : '../zcds/' + name.slice(3);
        if (!(key in dependencies)) throw new Error(`Missing entry dependency ${key}`);
        return dependencies[key];
    });
    dependencies['../zcds/application/ZCBattlePreparation'] = loadBattlePreparation({ ...dependencies, './ZCBattleEntryBuilder': builder });
    return loadModule('assets/script/app/bootstrap/battle/BattleComposition.ts', name => {
        if (name in overrides) return overrides[name];
        if (name.endsWith('/GuideComposition')) return { GuideComposition: class { dispose() {} } };
        if (name.endsWith('/GuideEvents')) return { reportGuideComplete, reportBattleGuideSettled };
        if (name === 'cc') return { Prefab: class Prefab {} };
        if (name.endsWith('/BundleCatalog')) return { bundleForPath };
        if (name.endsWith('/ResourceScope')) return { ResourceScope };
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
        if (name.endsWith('/PopupDef')) return { PopupCloseReason: { Manual: 0, Force: 3 }, PopupLayer: { SYSTEM: 1 } };
        if (name.endsWith('/EventMgr')) return { EventMgr };
        if (name.endsWith('/ZCBattleEvents')) return { ZC_BATTLE_EVENTS };
        if (name.endsWith('/GameRoute')) return { GameRoute: { Main: 'main' } };
        if (name.endsWith('/FW')) return dependencies['../../framework/FW'] ?? { FW: { showTip() {} } };
        // 投降二次确认走通用提示框；这条夹具不验弹窗本身，只要求模块能求值。
        if (name.endsWith('/CommonTips')) return { CommonTips: { open: async () => null } };
        //  集火提示的吐司出口（2026-11-26 第 56 批）：`Toast` 顶层 `import 'cc'`，这条夹具里只给个壳。
        if (name.endsWith('/common/Toast')) return { Toast: { show() {} } };
        if (name.endsWith('/AudioMgr')) return { AudioMgr: { instance: { playMusic: async () => {}, stopMusic: () => {}, playSound: () => {} } } };
        if (name.endsWith('/ResConst')) return { GAME_AUDIO: {} };
        // 结算 MVP 的 `Lv.x` 读本机等级；角色仓库有自己的存储/网络依赖，这里只给个读数壳。
        if (name.endsWith('/RoleRepository')) return { roleRepository: { roleLevel: () => 0 } };
        if (/\/(ZCSettlementPage|GameRunAway|ZCGuidePanel|ZCGameRankBoard|FW|GameRoute|BattleStartService|GameNet|RewardFrames|ZCBattleEvents)$/.test(name)) return {};
        if (name.endsWith('/ProcedureManager')) return dependencies['../../framework/procedure/ProcedureManager'] ?? {};
        const key = name.replace('../../', '../');
        if (!(key in dependencies)) throw new Error(`Missing battle dependency ${key}`);
        return dependencies[key];
    });
}
