import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    isZCRuntimeCompiled,
    loadPvpTables,
    resetZCRuntime,
    type ZCPvpTables,
} from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function rows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) =>
        Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

test('编译标志随 loadPvpTables 置位、resetZCRuntime 复位', () => {
    resetZCRuntime();
    assert.equal(isZCRuntimeCompiled(), false);
    const names = [
        'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
    ];
    loadPvpTables(Object.fromEntries(names.map((name) => [name, rows(name)])) as ZCPvpTables);
    assert.equal(isZCRuntimeCompiled(), true, '编译安装成功后标志置位');
    resetZCRuntime();
    assert.equal(isZCRuntimeCompiled(), false, '退出登录复位后强制下次重新编译');
});

test('ensureZCRuntimeCompiled 幂等：首次全量加载，已编译后再次跳过', async () => {
    const source = readFileSync('assets/script/app/zcds/application/ZCRuntimePrecompiler.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;

    let getTableCalls = 0;
    let initializeCalls = 0;
    let loadCalls = 0;
    let compiled = false;
    const configs = {
        initialize: async () => { initializeCalls += 1; },
        getTable: async () => { getTableCalls += 1; return [{}]; },
    };
    const deps: Record<string, unknown> = {
        // 新模块仅依赖 ZCGameRuntimeConfig（ConfigService 为 type-only，已 erased）。
        '../model/ZCGameRuntimeConfig': {
            isZCRuntimeCompiled: () => compiled,
            loadPvpTables: () => { loadCalls += 1; compiled = true; },
        },
    };
    const context = {
        exports: {} as { ensureZCRuntimeCompiled: (c: typeof configs) => Promise<void> },
        require: (name: string) => deps[name],
        console: { info() {}, warn() {}, error() {} },
    };
    runInNewContext(code, context);

    await context.exports.ensureZCRuntimeCompiled(configs);
    assert.equal(initializeCalls, 1);
    assert.equal(getTableCalls, 24, '首次触发全部 24 张表 getTable');
    assert.equal(loadCalls, 1);

    await context.exports.ensureZCRuntimeCompiled(configs);
    assert.equal(initializeCalls, 1, '已编译后 initialize 幂等跳过');
    assert.equal(getTableCalls, 24, '已编译后 getTable 幂等跳过');
    assert.equal(loadCalls, 1);
});
