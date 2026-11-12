import assert from 'node:assert/strict';
import test from 'node:test';
import {
    readConfigArray, readConfigInteger, readConfigNumber, readConfigObject, readConfigText,
} from '../assets/script/core/config/ConfigValue';

test('基础数字读取不转换外部类型，保留有限数值', () => {
    for (const value of [0, -1, 0.5, Number.MAX_VALUE]) {
        assert.equal(readConfigNumber(value, 'test.amount'), value);
    }
    for (const value of ['1', '', null, undefined, true, [], {}, NaN, Infinity, -Infinity]) {
        assert.throws(() => readConfigNumber(value, 'test.amount'), /test\.amount.*收到/);
    }
    assert.throws(() => readConfigNumber(NaN, 'test.amount'), /NaN/);
    assert.throws(() => readConfigNumber(Infinity, 'test.amount'), /Infinity/);
    assert.throws(() => readConfigNumber('1', 'test.amount'), /"1"/);
});

test('整数读取校验安全整数和调用方提供的闭区间', () => {
    assert.equal(readConfigInteger(0, 'queue.count', 0, 1), 0);
    assert.equal(readConfigInteger(1, 'queue.count', 0, 1), 1);
    assert.equal(readConfigInteger(Number.MIN_SAFE_INTEGER, 'value'), Number.MIN_SAFE_INTEGER);
    assert.equal(readConfigInteger(Number.MAX_SAFE_INTEGER, 'value'), Number.MAX_SAFE_INTEGER);
    for (const value of [-1, 2, 0.5, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => readConfigInteger(value, 'queue.count', 0, 1), /queue\.count/);
    }
    assert.throws(() => readConfigInteger(Number.MAX_SAFE_INTEGER + 1, 'value'), /整数/);
});

test('对象与数组读取保留原引用并拒绝错误结构', () => {
    const row = { id: 1 };
    const rows = [row];
    assert.strictEqual(readConfigObject(row, 'table.row'), row);
    assert.strictEqual(readConfigArray(rows, 'table.rows'), rows);
    assert.deepEqual(readConfigArray([], 'table.rows'), []);
    for (const value of [null, undefined, [], 'row', 1]) {
        assert.throws(() => readConfigObject(value, 'table.row'), /table\.row/);
    }
    for (const value of [null, undefined, {}, 'rows', 1]) {
        assert.throws(() => readConfigArray(value, 'table.rows'), /table\.rows/);
    }
});

test('非空字符串读取不隐式裁剪、转换或补默认值', () => {
    assert.equal(readConfigText(' name ', 'card.name'), ' name ');
    for (const value of ['', '  ', 1, null, undefined, []]) {
        assert.throws(() => readConfigText(value, 'card.name'), /card\.name/);
    }
});
