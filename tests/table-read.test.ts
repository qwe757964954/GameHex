import assert from 'node:assert/strict';
import test from 'node:test';
import { readRefRows, readRefRowsSafe } from '../assets/script/app/common/TableRead';

test('readRefRows: null / undefined 兜底空数组，失败向上抛', async () => {
    assert.deepEqual(await readRefRows({ getRefAllAsync: async () => null }, 'item'), []);
    assert.deepEqual(await readRefRows({ getRefAllAsync: async () => undefined }, 'item'), []);
    assert.deepEqual(await readRefRows({ getRefAllAsync: async () => [{ id: 1 }] }, 'item'), [{ id: 1 }]);
    await assert.rejects(
        readRefRows({ getRefAllAsync: async () => { throw new Error('boom'); } }, 'item'),
        /boom/,
    );
});

test('readRefRowsSafe: 失败降级空数组，不把异常抛给调用方', async () => {
    assert.deepEqual(await readRefRowsSafe({ getRefAllAsync: async () => { throw new Error('boom'); } }, 'item', 'ItemDetail'), []);
});
