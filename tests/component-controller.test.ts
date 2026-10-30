import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { ControllerBase } from '../assets/script/framework/controller/ControllerBase';
import { createControllerContext } from './helpers/controller-context';

test('component controller uses the configured runtime without per-component service injection', async () => {
    const manager: { instance: { context: ReturnType<typeof createControllerContext> } | null } = { instance: null };
    const exports: { ComponentController?: new (name: string) => ControllerBase } = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/framework/controller/ComponentController.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, require: (path: string) => path.endsWith('/ProcedureManager')
        ? { ProcedureManager: manager } : { ControllerBase } });
    assert.ok(exports.ComponentController);
    const controller = new exports.ComponentController('component');
    assert.throws(() => controller.resources, /configured application context/);
    const context = createControllerContext();
    let loads = 0;
    context.assets.load = async (_path, Type, options) => {
        assert.equal(options?.scope, controller.scope);
        loads++;
        return new Type();
    };
    manager.instance = { context };
    await controller.resources.assets.load('frame', class {});
    assert.equal(loads, 1);
    assert.equal(controller.resources.configs, context.configs);
    controller.dispose();
    await assert.rejects(controller.resources.assets.load('late', class {}), /取消|释放/);
    assert.equal(loads, 1);
});
