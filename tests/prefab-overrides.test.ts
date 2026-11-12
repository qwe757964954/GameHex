import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInstanceOverrides } from './helpers/prefab-overrides';

test('实例覆写按 fileId 分别应用到根和子节点，不修改源预制体', () => {
    const source = [
        { _prefab: { __id__: 2 }, _lpos: { x: 0 } },
        { _prefab: { __id__: 3 }, _lpos: { x: 1 } },
        { fileId: 'root' }, { fileId: 'child' },
    ];
    const host = [
        { targetInfo: { __id__: 2 }, propertyPath: ['_lpos', 'x'], value: 20 },
        { targetInfo: { __id__: 3 }, propertyPath: ['_lpos'], value: { x: 30 } },
        { localID: ['root'] }, { localID: ['child'] },
    ];
    const result = applyInstanceOverrides(source, host, { propertyOverrides: [{ __id__: 0 }, { __id__: 1 }] });
    assert.equal(result[0]._lpos.x, 20);
    assert.equal(result[1]._lpos.x, 30);
    assert.equal(source[0]._lpos!.x, 0);
    assert.equal(source[1]._lpos!.x, 1);
    assert.throws(() => applyInstanceOverrides(source, [{ ...host[0], targetInfo: { __id__: 1 } },
        { localID: ['missing'] }], { propertyOverrides: [{ __id__: 0 }] }), /unknown override fileId/);
});
