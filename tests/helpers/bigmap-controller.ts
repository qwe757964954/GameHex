/**
 * `BigMapController` 直连 `GameNet.instance` 之后不能再在 Node 里直接 import（会拖进 `cc`
 * 和整套网络/提示链路）。这里统一沙箱加载，并把单例桥接给用例：
 *
 * ```ts
 * const { BigMapController } = loadBigMapController(net);
 * ```
 *
 * `unresolved` 直接断言在加载处 —— 桩表漏写不会静默变成 `undefined`。
 */
import assert from 'node:assert/strict';
import { loadTsModule } from './cc-sandbox';
import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import { EventMgr } from '../../assets/script/framework/event/EventMgr';
import * as bigMapWorld from '../../assets/script/app/bigmap/model/BigMapWorld';
import * as bigMapCampRoleInfo from '../../assets/script/app/bigmap/model/BigMapCampRoleInfo';
import * as bigMapCampMove from '../../assets/script/app/bigmap/model/BigMapCampMove';
import * as bigMapServerState from '../../assets/script/app/bigmap/model/BigMapServerState';
import * as bigMapEvents from '../../assets/script/app/bigmap/application/BigMapEvents';
import * as bigMapViewState from '../../assets/script/app/bigmap/application/BigMapViewState';
import * as battleStartModel from '../../assets/script/app/battle/BattleStartModel';
import * as bigMapBattle from '../../assets/script/app/bigmap/model/BigMapBattle';
import type { requestBattleStart } from '../../assets/script/app/battle/BattleStartService';

export interface IBigMapNetPort {
    addEvent(name: string, caller: object, listener: (message: unknown) => void): void;
    removeCaller(caller: object): void;
}

const EMPTY_NET: IBigMapNetPort = { addEvent() {}, removeCaller() {} };
type BigMapControllerModule = typeof import('../../assets/script/app/bigmap/application/BigMapController');

export function loadBigMapController(net: IBigMapNetPort = EMPTY_NET,
    request: typeof requestBattleStart = () => { throw new Error('Unexpected battle request'); },
): BigMapControllerModule {
    const { exports, unresolved } = loadTsModule<BigMapControllerModule>(
        'assets/script/app/bigmap/application/BigMapController.ts', { modules: {
            '/ControllerBase': { ControllerBase },
            '/EventMgr': { EventMgr },
            '/GameNet': { GameNet: { instance: net } },
            '/BattleStartModel': battleStartModel,
            '/BattleStartService': { requestBattleStart: request },
            '/BigMapBattle': bigMapBattle,
            '/BigMapWorld': bigMapWorld,
            '/BigMapCampRoleInfo': bigMapCampRoleInfo,
            '/BigMapCampMove': bigMapCampMove,
            '/BigMapServerState': bigMapServerState,
            '/BigMapEvents': bigMapEvents,
            '/BigMapViewState': bigMapViewState,
        } });
    assert.deepEqual(unresolved, []);
    return exports;
}
