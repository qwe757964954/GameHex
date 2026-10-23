import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as saveKeys from '../assets/script/app/bigmap/application/BigMapSaveKeys';
import type { IBigMapStorage } from '../assets/script/app/bigmap/application/BigMapPresenter';

interface IOwner { roleId: string; serverId: string }

function harness() {
    const disk = new Map<string, string>();
    const accesses: string[] = [];
    const storage = {
        getItem(key: string) { accesses.push(key); return disk.get(key) ?? null; },
        setItem(key: string, value: string) { accesses.push(key); disk.set(key, value); },
    };
    const exports: Record<string, unknown> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/bigmap/application/BigMapStorage.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText, { exports, require: (name: string) => name === 'cc' ? { sys: { localStorage: storage } } : saveKeys });
    const create = exports.createBigMapStorage as (owner: IOwner | null) => IBigMapStorage;
    return { disk, accesses, create };
}

test('同角色重进保留完整存档，不同角色和区服互不读取、覆盖', () => {
    const h = harness();
    const key = saveKeys.BIGMAP_SAVE_KEY;
    const a = h.create({ roleId: '9007199254740993', serverId: '1' });
    const save = JSON.stringify({ base: { buildings: [71001], queues: [1], res: { coin: 99 } }, battle: { occupiedCityIds: [101] } });
    a.write(key, save);
    assert.equal(h.create({ roleId: '9007199254740994', serverId: '1' }).read(key), null);
    assert.equal(h.create({ roleId: '9007199254740993', serverId: '2' }).read(key), null);
    h.create({ roleId: '9007199254740994', serverId: '1' }).write(key, 'B');
    assert.equal(h.create({ roleId: '9007199254740993', serverId: '1' }).read(key), save);
});

test('存储实例固定创建时身份，迟到的写入不会跟随身份对象改写其他角色', () => {
    const h = harness();
    const owner = { roleId: 'A', serverId: '1' };
    const a = h.create(owner);
    owner.roleId = 'B';
    owner.serverId = '2';
    a.write('progress', 'late-A');
    assert.equal(h.create({ roleId: 'A', serverId: '1' }).read('progress'), 'late-A');
    assert.equal(h.create(owner).read('progress'), null);
});

test('旧共享存档保留原样，不导入新角色或被新角色覆盖', () => {
    const h = harness();
    const legacyKey = `${saveKeys.BIGMAP_SAVE_KEY}.${saveKeys.BIGMAP_SAVE_KEY}`;
    h.disk.set(legacyKey, 'legacy-save');
    const a = h.create({ roleId: 'A', serverId: '1' });
    assert.equal(a.read(saveKeys.BIGMAP_SAVE_KEY), null);
    a.write(saveKeys.BIGMAP_SAVE_KEY, 'new-save');
    assert.equal(h.disk.get(legacyKey), 'legacy-save');
    assert.equal(h.accesses.includes(legacyKey), false);
});

test('未登录预览不读写磁盘，且各预览实例互相独立', () => {
    const h = harness();
    const preview = h.create(null);
    preview.write('save', 'preview');
    assert.equal(preview.read('save'), 'preview');
    assert.equal(h.create(null).read('save'), null);
    assert.equal(h.accesses.length, 0);
});

test('空身份拒绝持久化，身份分隔符编码后不会碰撞', () => {
    const h = harness();
    assert.throws(() => h.create({ roleId: '', serverId: '1' }), /角色|区服/);
    assert.throws(() => h.create({ roleId: 'A', serverId: ' ' }), /角色|区服/);
    const a = h.create({ roleId: 'A:role:B', serverId: '1' });
    a.write('save', 'A');
    assert.equal(h.create({ roleId: 'B', serverId: '1:role:A' }).read('save'), null);
});
