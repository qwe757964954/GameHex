import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { HotUpdateManager } from '../assets/script/app/update/HotUpdateManager';
import { compareVersion, parseHotUpdateManifest, parseReleasePointer, resolveBundleLoadOrder } from '../assets/script/core/update/HotUpdateManifest';
import type {
    HotUpdateBundleRuntime,
    HotUpdateConfig,
    HotUpdateManifest,
    HotUpdateManifestVerifier,
    HotUpdateStoredState,
    HotUpdateStore,
} from '../assets/script/core/update/HotUpdateTypes';

const baseConfig: HotUpdateConfig = {
    enabled: true,
    enabledPlatforms: ['android', 'ios'],
    channel: 'dev',
    clientVersion: '1.0.0',
    latestUrlTemplate: 'https://cdn.example.com/{platform}/{channel}/latest.json',
    startupBundles: ['remoteRef'],
    requestTimeoutMs: 1000,
    allowHttpForLocalDebug: false,
    allowUnsignedManifests: true,
    requireRemoteOnFirstInstall: false,
};

test('本地调试允许局域网 HTTP 热更新地址，但公网 HTTP 仍被拒绝', () => {
    const pointer = {
        schemaVersion: 1,
        releaseId: 'local-r1',
        manifestUrl: 'http://192.168.2.156:5000/hotupdate/android/local-r1/manifest.json',
    };
    assert.equal(parseReleasePointer(pointer, true).manifestUrl, pointer.manifestUrl);
    assert.throws(() => parseReleasePointer(pointer, false), /HTTPS/);
    assert.throws(() => parseReleasePointer({ ...pointer, manifestUrl: 'http://example.com/manifest.json' }, true), /HTTPS/);
});

test('Web platform skips hot update before reading state or requesting network', async () => {
    let requested = false;
    const manager = new HotUpdateManager({
        platform: 'web',
        store: {
            read: () => { throw new Error('Web should not read hot-update state'); },
            commit: (value) => ({ clientId: 'web-client', activeManifest: value }),
        },
        runtime: { apply: async () => { throw new Error('Web should not load remote bundles'); } },
        verifier: { verify: async () => false },
        network: {
            requestJson: async <T>() => {
                requested = true;
                throw new Error('Web should not request hot-update endpoints');
            },
        },
    });

    const result = await manager.run({
        ...baseConfig,
        enabledPlatforms: ['android', 'ios'],
        platformOverride: 'android',
    });
    assert.equal(result.status, 'disabled');
    assert.equal(result.canContinue, true);
    assert.equal(requested, false);
});

function manifest(releaseId: string, minClientVersion = '1.0.0'): HotUpdateManifest {
    return {
        schemaVersion: 1,
        releaseId,
        platform: 'android',
        channel: 'dev',
        minClientVersion,
        bundles: {
            remoteRef: {
                url: `https://cdn.example.com/android/${releaseId}/remoteRef`,
                version: `hash-${releaseId}`,
                requiredAt: 'startup',
                dependencies: [],
            },
        },
    };
}

function createHarness(target: HotUpdateManifest, initial?: HotUpdateManifest) {
    let state: HotUpdateStoredState = { clientId: 'client-1', activeManifest: initial };
    const applied: string[] = [];
    const store: HotUpdateStore = {
        read: () => state,
        commit: (value) => state = { clientId: state.clientId, activeManifest: value, previousManifest: state.activeManifest },
    };
    const runtime: HotUpdateBundleRuntime = {
        apply: async (value) => { applied.push(value.releaseId); },
    };
    const verifier: HotUpdateManifestVerifier = { verify: async () => true };
    let request = 0;
    const manager = new HotUpdateManager({
        platform: 'android',
        store,
        runtime,
        verifier,
        now: () => 123,
        network: {
            requestJson: async <T>() => (++request === 1
                ? { schemaVersion: 1, releaseId: target.releaseId, manifestUrl: 'https://cdn.example.com/manifest.json' }
                : target) as T,
        },
    });
    return { manager, applied, getState: () => state, runtime };
}

test('版本比较兼容四段版本号', () => {
    assert.equal(compareVersion('0.6.0.0', '0.6.0'), 0);
    assert.equal(compareVersion('0.6.1', '0.6.0.9'), 1);
    assert.equal(compareVersion('1.0.0', '1.0.1'), -1);
});

test('Bundle 依赖按依赖优先排序', () => {
    assert.deepEqual(resolveBundleLoadOrder({
        common: { url: 'https://a/common', version: '1' },
        art: { url: 'https://a/art', version: '1', dependencies: ['common'] },
        game: { url: 'https://a/game', version: '1', dependencies: ['art'] },
    }, ['game']), ['common', 'art', 'game']);
});

test('Manifest 拒绝循环依赖', () => {
    assert.throws(() => parseHotUpdateManifest({
        schemaVersion: 1,
        releaseId: 'r1',
        platform: 'android',
        channel: 'dev',
        minClientVersion: '1.0.0',
        bundles: {
            a: { url: 'https://cdn.example.com/a', version: '1', dependencies: ['b'] },
            b: { url: 'https://cdn.example.com/b', version: '1', dependencies: ['a'] },
        },
    }, 'android', 'dev'), /依赖形成环/);
});

test('目标 releaseId 不按大小比较，服务端指回旧版本也会应用', async () => {
    const current = manifest('release-z');
    const target = manifest('release-a');
    const harness = createHarness(target, current);
    const result = await harness.manager.run(baseConfig);
    assert.equal(result.status, 'applied');
    assert.deepEqual(harness.applied, ['release-a']);
    assert.equal(harness.getState().activeManifest?.releaseId, 'release-a');
    assert.equal(harness.getState().previousManifest?.releaseId, 'release-z');
});

test('客户端低于门槛时阻断进入游戏', async () => {
    const harness = createHarness(manifest('r2', '2.0.0'));
    const result = await harness.manager.run(baseConfig);
    assert.equal(result.status, 'mandatory-client-update');
    assert.equal(result.canContinue, false);
    assert.deepEqual(harness.applied, []);
});

test('目标 Bundle 加载失败时恢复上一可用版本', async () => {
    const current = manifest('r1');
    const target = manifest('r2');
    const harness = createHarness(target, current);
    harness.runtime.apply = async (value) => {
        harness.applied.push(value.releaseId);
        if (value.releaseId === 'r2') throw new Error('download failed');
    };
    const result = await harness.manager.run(baseConfig);
    assert.equal(result.status, 'degraded');
    assert.equal(result.canContinue, true);
    assert.deepEqual(harness.applied, ['r2', 'r1']);
    assert.equal(harness.getState().activeManifest?.releaseId, 'r1');
});

test('首装要求远端资源时，网络失败会阻断', async () => {
    const harness = createHarness(manifest('r1'));
    const manager = new HotUpdateManager({
        platform: 'android',
        store: { read: () => ({ clientId: 'new-client' }), commit: (value) => ({ clientId: 'new-client', activeManifest: value }) },
        runtime: harness.runtime,
        verifier: { verify: async () => true },
        network: { requestJson: async () => { throw new Error('offline'); } },
    });
    const result = await manager.run({ ...baseConfig, requireRemoteOnFirstInstall: true });
    assert.equal(result.status, 'degraded');
    assert.equal(result.canContinue, false);
});

test('启动链先进入更新流程，测试配置仅启用 Android/iOS', () => {
    const bootstrap = readFileSync('assets/script/app/bootstrap/ProcedureBootstrap.ts', 'utf8');
    const config = JSON.parse(readFileSync('assets/resources/config/hot_update.json', 'utf8')) as HotUpdateConfig;
    assert.match(bootstrap, /registerRoute\(GameRoute\.Update, ProcedureUpdate\)/);
    assert.match(bootstrap, /navigate\(GameRoute\.Update\)/);
    assert.equal(config.enabled, true);
    assert.deepEqual(config.enabledPlatforms, ['android', 'ios']);
});

test('Manifest 生成器从 MD5 Bundle 产物生成可用的两级清单', () => {
    const root = mkdtempSync(join(tmpdir(), 'city1001-hotupdate-'));
    const input = join(root, 'remote');
    const output = join(root, 'release');
    const bundle = join(input, 'remoteRef');
    try {
        mkdirSync(bundle, { recursive: true });
        writeFileSync(join(bundle, 'cc.config.abc123.json'), '{}', 'utf8');
        writeFileSync(join(bundle, 'index.abc123.js'), 'export default {};', 'utf8');
        execFileSync(process.execPath, [
            'tools/hotupdate/build_hotupdate.mjs',
            '--input', input,
            '--output', output,
            '--platform', 'android',
            '--channel', 'dev',
            '--release', 'r1',
            '--client-version', '1.0.0.0',
            '--base-url', 'https://cdn.example.com/hotupdate',
        ], { cwd: process.cwd() });
        const generated = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as HotUpdateManifest;
        assert.equal(generated.bundles.remoteRef.version, 'abc123');
        assert.equal(generated.bundles.remoteRef.requiredAt, 'startup');
        assert.equal(generated.bundles.remoteRef.url, 'https://cdn.example.com/hotupdate/android/r1/remoteRef');
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test('热更 UI：首包 LaunchProgress prefab 预载，复用启动 UI 做权重段映射', () => {
    // 2026-10-12：启动 UI 资源化后，热更阶段（启动早期）直接 load 首包 prefab
    // （assets/resources ⇒ 不进远程热更 bundle）；登录后加载复用同一节点续走进度。
    const source = readFileSync('assets/script/app/procedure/ProcedureUpdate.ts', 'utf8');
    assert.match(source, /import \{ [^}]*LaunchProgressUI[^}]*\} from '\.\.\/loading\/LaunchProgressUI';/);
    assert.match(source, /LAUNCH_UPDATE_WEIGHT/);
    // 首包 prefab 预载：热更阶段直接 load 内置启动 UI（assets/resources ⇒ 不进远程热更 bundle），
    // 失败静默兜底，不阻塞更新流程。
    assert.match(source, /assets\.load\('ui\/loading\/LaunchProgress', Prefab/);
    // 只有 Android/iOS 且配置启用才走热更；web/调试/小游戏等平台跳过更新直接进登录。
    assert.match(source, /!config\.enabled \|\| !config\.enabledPlatforms\.includes\(platform\)/);
    assert.match(source, /跳过更新流程/);
    // 复用启动 UI：ensure(host) + 点击重试仍挂在同一节点上。
    assert.match(source, /LaunchProgressUI\.ensure\(this\.host\)/);
    assert.match(source, /launchUI\.node\.on\(Node\.EventType\.TOUCH_END, this\.onRetry, this\)/);
    // 进度映射：热更实际进度 × 热更权重段；无确定进度（检查/校验/提交）归零不显示百分比。
    assert.match(source, /setProgress\(progress\.total\s*\?[\s\S]*?\/ progress\.total\) \* LAUNCH_UPDATE_WEIGHT\s*: null\)/);
    assert.match(source, /setProgress\(\(\(progress\.percent \?\? progress\.percentByFile \?\? 0\) \/ 100\) \* LAUNCH_UPDATE_WEIGHT\)/);
    // 热更完成进入登录前把进度停在权重段终点，供登录后加载续走。
    assert.match(source, /setProgress\(LAUNCH_UPDATE_WEIGHT\);\s*this\.navigate\(GameRoute\.Login\)/);
    // 生命周期：onLeave 只隐藏不销毁（留给 ProcedurePostLogin），销毁由登录后加载负责。
    assert.match(source, /this\.launchUI\.hide\(\);/);
    assert.match(source, /this\.launchUI = null;/);
    assert.doesNotMatch(source, /this\.launchUI\.release\(\)/);
});
