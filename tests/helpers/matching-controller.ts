import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as BattleStartModel from '../../assets/script/app/battle/BattleStartModel';
import type { MatchingController } from '../../assets/script/app/matching/MatchingController';
import * as MatchReveal from '../../assets/script/app/matching/MatchReveal';
import * as MatchTypes from '../../assets/script/app/matching/MatchTypes';
import { ControllerBase } from '../../assets/script/framework/controller/ControllerBase';
import { EventMgr } from '../../assets/script/framework/event/EventMgr';

const code = ts.transpileModule(readFileSync('assets/script/app/matching/MatchingController.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

/** Run the real event publisher, replacing the network and battle preparation edges. */
export function loadMatchingController(dependencies: Record<string, unknown>): typeof MatchingController {
    const modules = {
        '../../framework/controller/ControllerBase': { ControllerBase },
        '../../framework/event/EventMgr': { EventMgr },
        '../battle/BattleStartModel': BattleStartModel,
        './MatchReveal': MatchReveal,
        './MatchTypes': MatchTypes,
        ...dependencies,
    };
    const exports = {} as { MatchingController: typeof MatchingController };
    runInNewContext(code, { exports, console: { error() {} }, require(name: string) {
        if (!(name in modules)) throw new Error(`Missing matching dependency ${name}`);
        return modules[name];
    } });
    return exports.MatchingController;
}
