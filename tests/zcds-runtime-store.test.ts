import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ZCRuntimeConfigStore } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';
import { compilePvpTables } from '../assets/script/app/zcds/model/ZCPvpConfigCompiler';
import type { ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';

function compiledConfig() {
    const names = ['pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
        'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams'];
    return compilePvpTables(Object.fromEntries(names.map(name => {
        const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
        return [name, Array.isArray(raw) ? raw : raw.v.map((values: unknown[]) =>
            Object.fromEntries(raw.k.map((key: string, index: number) => [key, values[index]])))];
    })) as ZCPvpTables);
}

test('并发预编译共用任务，只提交一次完整快照', async () => {
    const store = new ZCRuntimeConfigStore();
    const compiled = compiledConfig();
    let calls = 0;
    const load = async () => { calls++; return compiled; };
    const first = store.ensure(load);
    assert.strictEqual(store.ensure(load), first);
    assert.equal(await first, true);
    assert.equal(await store.ensure(load), true);
    assert.equal(calls, 1);
    assert.equal(store.ready, true);
    assert.strictEqual(store.snapshot.units, compiled.units);
});

test('reset 清除全部目录，旧任务不会覆盖新会话任务及快照', async () => {
    const store = new ZCRuntimeConfigStore();
    const compiled = compiledConfig();
    let finishOld: (value: typeof compiled) => void = () => {};
    const old = store.ensure(() => new Promise(resolve => { finishOld = resolve; }));
    store.reset();
    const current = store.ensure(async () => compiled);
    finishOld({ ...compiled, rules: { ...compiled.rules, sourceSha256: 'old-session' } });
    assert.equal(await old, false);
    assert.equal(await current, true);
    assert.equal(store.snapshot.rules?.sourceSha256, compiled.rules.sourceSha256);
    store.reset();
    assert.equal(store.ready, false);
    assert.deepEqual(store.snapshot, {});
});

test('预编译失败不发布半成品并允许重试', async () => {
    const store = new ZCRuntimeConfigStore();
    await assert.rejects(store.ensure(async () => { throw new Error('load failed'); }), /load failed/);
    assert.equal(store.ready, false);
    assert.deepEqual(store.snapshot, {});
    assert.equal(await store.ensure(async () => compiledConfig()), true);
});

test('旧会话加载失败返回 false，不干扰当前会话加载', async () => {
    const store = new ZCRuntimeConfigStore();
    let fail: (error: Error) => void = () => {};
    const old = store.ensure(() => new Promise((_, reject) => { fail = reject; }));
    store.reset();
    const current = store.ensure(async () => compiledConfig());
    fail(new Error('old load failed'));
    assert.equal(await old, false);
    assert.equal(await current, true);
    assert.equal(store.ready, true);
});
