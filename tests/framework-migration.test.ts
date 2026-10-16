import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

function collectTypeScriptFiles(root: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) result.push(...collectTypeScriptFiles(path));
        else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(path);
    }
    return result;
}

test('ResourceScope 逆序且幂等释放资源引用', () => {
    const calls: string[] = [];
    const scope = new ResourceScope('test');
    scope.defer(() => calls.push('first'));
    scope.defer(() => calls.push('second'));

    scope.dispose();
    scope.dispose();
    scope.defer(() => calls.push('late'));

    assert.equal(scope.disposed, true);
    assert.deepEqual(calls, ['second', 'first', 'late']);
});

test('已迁移的流程框架不反向依赖 app 业务层', () => {
    const violations = collectTypeScriptFiles('assets/script/framework/procedure').filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /from\s+['"][^'"]*app\//.test(source);
    });
    assert.deepEqual(violations, []);
});

test('启动器迁到 app 组合根并保留 Root.scene 绑定 UUID', () => {
    const oldPath = 'assets/script/framework/procedure/ProcedureBootstrap.ts';
    const newPath = 'assets/script/app/bootstrap/ProcedureBootstrap.ts';
    assert.equal(existsSync(oldPath), false);
    assert.equal(existsSync(newPath), true);

    const meta = JSON.parse(readFileSync(`${newPath}.meta`, 'utf8')) as { uuid: string };
    assert.equal(meta.uuid, '7944cce6-2c70-4239-aca6-9235d08f3098');
    assert.match(readFileSync('assets/Root.scene', 'utf8'), /7944czmLHBCOaymkjXQjzCY/);
});

test('应用流程的根资源统一通过 AssetService 加载', () => {
    const procedureRoot = 'assets/script/app/procedure';
    for (const file of collectTypeScriptFiles(procedureRoot)) {
        const source = readFileSync(file, 'utf8');
        assert.doesNotMatch(source, /\bresources\.(load|loadDir)\s*\(/, file);
    }
});

test('登录协议只依赖 NetworkTransport，fetch 与 CORS 策略留在平台层', () => {
    const gateway = readFileSync('assets/script/app/login/LoginProtocol.ts', 'utf8');
    const adapter = readFileSync('assets/script/platform/network/FetchNetworkTransport.ts', 'utf8');
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');

    assert.match(gateway, /NetworkTransport/);
    assert.doesNotMatch(gateway, /\bfetch\s*\(/);
    assert.match(adapter, /\bfetch\s*\(/);
    assert.match(bootstrap, /network:\s*new FetchNetworkTransport\(\)/);
});

test('旧 framework/asset 门面已移除，RefUtil 直接使用 remoteRef bundle', () => {
    assert.equal(existsSync('assets/script/framework/asset'), false);
    assert.equal(existsSync('assets/script/framework/asset.meta'), false);

    const framework = collectTypeScriptFiles('assets/script/framework')
        .map((file) => readFileSync(file, 'utf8'))
        .join('\n');
    assert.doesNotMatch(framework, /\b(?:AssetMgr|AssetProxy|BundleProxy)\b/);
    assert.match(readFileSync('assets/script/framework/ref/RefUtil.ts', 'utf8'), /assetManager\.getBundle\(REMOTE_REF_BUNDLE\)/);
});

test('对局加载已从 Component 下沉到应用服务并只依赖端口', () => {
    const component = readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8');
    const loader = readFileSync('assets/script/app/zcds/application/ZCGameLoader.ts', 'utf8');
    const procedure = readFileSync('assets/script/app/procedure/ProcedureGame.ts', 'utf8');

    assert.doesNotMatch(component, /static async prepareResources/);
    assert.match(procedure, /new ZCGameLoader\(this\.assets, this\.configs, MAP_DIRECTORY\)/);
    assert.doesNotMatch(loader, /framework\//);
    assert.doesNotMatch(loader, /platform\//);
});

test('RefConfigService 合并并发初始化并缓存结果', async () => {
    const source = readFileSync('assets/script/platform/config/RefConfigService.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    let initializeCalls = 0;
    let finishInitialize!: () => void;
    const refUtil = {
        loadRefSmallAll: () => {
            initializeCalls += 1;
            return new Promise<void>((resolve) => { finishInitialize = resolve; });
        },
        instance: {
            getRefAllAsync: async (name: string) => [{ name }],
        },
    };
    const context = {
        exports: {} as { RefConfigService: new () => { initialize(): Promise<void>; getTable(name: string): Promise<unknown[]> } },
        require: (name: string) => {
            if (name === '../../framework/ref/RefUtil') return { RefUtil: refUtil };
            throw new Error(`unexpected dependency: ${name}`);
        },
    };
    runInNewContext(code, context);

    const service = new context.exports.RefConfigService();
    const first = service.initialize();
    const second = service.initialize();
    assert.equal(initializeCalls, 1);
    finishInitialize();
    await Promise.all([first, second]);
    await service.initialize();
    assert.equal(initializeCalls, 1);
    assert.deepEqual(await service.getTable('pvpCard'), [{ name: 'pvpCard' }]);
});
