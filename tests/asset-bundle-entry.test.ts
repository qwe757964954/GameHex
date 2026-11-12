import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const LOADER = 'assets/script/platform/cocos/AssetBundleLoader.ts';

/**
 * 允许直连 `assetManager.loadBundle` 的白名单：
 * - `AssetBundleLoader`：唯一入口，负责从热更 manifest 解析远程 url/version；
 * - `CocosBundleRuntime`：热更域，自带版本比对、removeBundle 与失败回滚语义。
 */
const ALLOWED = new Set([
    LOADER,
    'assets/script/platform/hotupdate/CocosBundleRuntime.ts',
]);

const normalize = (path: string): string => path.split('\\').join('/');

function listScripts(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = dir === '' ? entry.name : join(dir, entry.name);
        if (entry.isDirectory()) return listScripts(path);
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.d.ts')) return [];
        return statSync(path).isFile() ? [normalize(path)] : [];
    });
}

/** 只认真正的 `assetManager.loadBundle(...)` 调用节点：注释、字符串里的同名字样不算。 */
function findLoadBundleCalls(file: string): number[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2020, true);
    const lines: number[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(source).includes('assetManager.loadBundle')) {
            lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return lines;
}

test('assetManager.loadBundle 只允许出现在 AssetBundleLoader 与热更运行时', () => {
    const offenders = listScripts('assets/script')
        .filter((file) => !ALLOWED.has(file))
        .flatMap((file) => findLoadBundleCalls(file).map((line) => `${file}:${line}`));
    assert.deepEqual(offenders, [],
        'bundle 的远程 url/version 只有 AssetBundleLoader 会从热更 manifest 解析；'
        + '直连 loadBundle 会让热更后的 onDemand bundle 拿到旧包或 404，且零报错。'
        + '需要 bundle 时调用 loadAssetBundle(name)。');
});

function load(path: string, dependencies: Record<string, unknown>) {
    const context = {
        exports: {} as Record<string, unknown>,
        console,
        require: (name: string) => {
            assert.ok(name in dependencies, name);
            return dependencies[name];
        },
    };
    runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    } }).outputText, context);
    return context.exports;
}

interface ILoaderEnvOptions {
    /** 已加载的 bundle（`getBundle` 命中时返回它）。 */
    preloaded?: { name?: string };
    /** 热更 manifest 里的描述符；缺省表示这一版包里没登记该 bundle。 */
    remote?: { url: string; version: string };
    failFirst?: boolean;
}

function makeLoaderEnv(options: ILoaderEnvOptions = {}) {
    const calls: string[] = [];
    let attempts = 0;
    const loaded = { name: 'loaded' };
    const assetManager = {
        getBundle: (name: string) => {
            calls.push(`getBundle:${name}`);
            return options.preloaded;
        },
        loadBundle: (...args: unknown[]) => {
            const source = args[0] as string;
            const maybeOptions = typeof args[1] === 'object' && args[1] !== null ? args[1] as { version?: string } : null;
            const done = (typeof args[1] === 'function' ? args[1] : args[2]) as (error: Error | null, bundle?: unknown) => void;
            calls.push(`loadBundle:${source}${maybeOptions?.version ? `@${maybeOptions.version}` : ''}`);
            attempts += 1;
            if (options.failFirst && attempts === 1) {
                done(new Error('bundle 下载失败'));
                return;
            }
            done(null, loaded);
        },
    };
    const resources = { name: 'resources' };
    const { loadAssetBundle } = load(LOADER, {
        cc: { assetManager, resources, AssetManager: class {} },
        '../hotupdate/CocosBundleRegistry': { CocosBundleRegistry: { resolve: () => options.remote } },
    }) as { loadAssetBundle: (name?: string) => Promise<{ name?: string }> };
    return { loadAssetBundle, calls, resources, loaded };
}

test('loadAssetBundle：未指定名称或 resources 直接返回首包，不碰 AssetManager', async () => {
    const env = makeLoaderEnv();
    assert.equal(await env.loadAssetBundle(), env.resources);
    assert.equal(await env.loadAssetBundle('resources'), env.resources);
    assert.deepEqual(env.calls, []);
});

test('loadAssetBundle：未在 manifest 登记时按 bundle 名加载（构建期地址）', async () => {
    const env = makeLoaderEnv();
    assert.equal(await env.loadAssetBundle('bigmap'), env.loaded);
    assert.deepEqual(env.calls, ['getBundle:bigmap', 'loadBundle:bigmap']);
});

test('loadAssetBundle：manifest 有描述符时用远程 url + version，热更才真正生效', async () => {
    const env = makeLoaderEnv({ remote: { url: 'https://cdn.example.com/release/bigmap', version: 'a1b2c3' } });
    await env.loadAssetBundle('bigmap');
    assert.deepEqual(env.calls, [
        'getBundle:bigmap',
        'loadBundle:https://cdn.example.com/release/bigmap@a1b2c3',
    ]);
});

test('loadAssetBundle：同名并发只发一次 IO', async () => {
    const env = makeLoaderEnv();
    const [first, second] = await Promise.all([env.loadAssetBundle('main-pages'), env.loadAssetBundle('main-pages')]);
    assert.equal(first, second);
    assert.equal(env.calls.filter((call) => call.startsWith('loadBundle:')).length, 1);
});

test('loadAssetBundle：加载失败不缓存失败结果，下一次重新发起', async () => {
    const env = makeLoaderEnv({ failFirst: true });
    await assert.rejects(() => env.loadAssetBundle('battle'), /bundle 下载失败/);
    assert.equal(await env.loadAssetBundle('battle'), env.loaded);
    assert.equal(env.calls.filter((call) => call.startsWith('loadBundle:')).length, 2);
});
