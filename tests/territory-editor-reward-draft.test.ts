import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');

function rewardEditor(initialRewardIds: Array<number | undefined>) {
    const sites = initialRewardIds.map((rewardId, index) => ({
        type: 'fixedResource', cellId: index + 1, ...(rewardId === undefined ? {} : { rewardId }),
    }));
    const field = { value: '', focus() {} };
    const context = {
        map: { sites }, selectedCell: 1, $: () => field, commit() {}, markErrorsStale() {}, message() {},
    };
    const match = source.match(/function applyRewardIdFromForm\(\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'rewardId must have a dedicated draft persistence function');
    const apply = runInNewContext(`${match[0]}; applyRewardIdFromForm`, context) as () => boolean;
    return { sites, field, context, apply };
}

test('两个固定资源格的奖励 ID 独立提交，保存前的当前输入也会提交', () => {
    const editor = rewardEditor([undefined, undefined]);
    editor.field.value = '101';
    assert.equal(editor.apply(), true);
    editor.context.selectedCell = 2;
    editor.field.value = '202';
    assert.equal(editor.apply(), true);
    assert.deepEqual(editor.sites.map((site) => site.rewardId), [101, 202]);
});

test('无效奖励 ID 不覆盖已保存的站点值', () => {
    const editor = rewardEditor([101]);
    editor.field.value = '2.5';
    assert.equal(editor.apply(), false);
    assert.equal(editor.sites[0].rewardId, 101);
});

test('切换格子、校验、保存与导出前都会提交当前奖励输入', () => {
    assert.match(source, /function paint\([^\n]+\{\s*\n\s*if \(cell < 0\) return;\s*\n\s*if \(!applyRewardIdFromForm\(\)\) return;/);
    assert.match(source, /function validateCurrent\(\) \{\s*\n\s*if \(!applyRewardIdFromForm\(\)\) throw/);
    assert.match(source, /async function save\(\) \{[^\n]*validateCurrent\(\)/);
    assert.match(source, /\$\('rewardId'\)\.addEventListener\('change', applyRewardIdFromForm\)/);
    assert.match(source, /\$\('export'\)\.addEventListener\('click', \(\) => \{ if \(!applyRewardIdFromForm\(\)\) return;/);
});
