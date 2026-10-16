import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

function batchEditor(input: string, siteOverrides?: Array<{ type: string; cellId: number; rewardId?: number }>) {
    const sites: Array<{ type: string; cellId: number; rewardId?: number }> = siteOverrides ?? [
        { type: 'fixedResource', cellId: 326, rewardId: 101 },
        { type: 'stage', cellId: 327 },
        { type: 'fixedResource', cellId: 347, rewardId: 202 },
        { type: 'bonus', cellId: 348 },
        { type: 'fixedResource', cellId: 349 },
    ];
    const field = { value: input, focused: false, focus() { this.focused = true; } };
    const counters = { commits: 0, renders: 0, stale: 0, message: '' };
    const context = {
        map: { sites },
        $: () => field,
        commit: () => { counters.commits += 1; },
        render: () => { counters.renders += 1; },
        markErrorsStale: () => { counters.stale += 1; },
        message: (value: string) => { counters.message = value; },
    };
    const match = source.match(/function applyBatchRewardId\(\) \{[\s\S]*?\n\}/);
    assert.ok(match, '批量操作应有独立的函数');
    const apply = runInNewContext(`${match[0]}; applyBatchRewardId`, context) as () => boolean;
    return { sites, field, counters, apply };
}

test('一个奖励 ID 覆盖当前地图所有固定资源格，其他站点不变且只记一次撤销', () => {
    const editor = batchEditor('3001');
    assert.equal(editor.apply(), true);
    assert.deepEqual(editor.sites.map((site) => site.rewardId), [3001, undefined, 3001, undefined, 3001]);
    assert.equal(editor.counters.commits, 1);
    assert.equal(editor.counters.renders, 1);
    assert.match(editor.counters.message, /3 个固定资源格/);
});

test('空值或非法奖励 ID 不会部分修改地图', () => {
    for (const input of ['', '0', '-1', '1.5', 'abc']) {
        const editor = batchEditor(input);
        assert.equal(editor.apply(), false, input);
        assert.deepEqual(editor.sites.map((site) => site.rewardId), [101, undefined, 202, undefined, undefined]);
        assert.equal(editor.counters.commits, 0);
        assert.equal(editor.field.focused, true);
    }
});

test('批量入口只作用于当前地图，已一致时不新增撤销记录', () => {
    assert.match(html, /id="batchRewardId"/);
    assert.match(html, /id="applyBatchRewardId"/);
    assert.match(source, /\$\('applyBatchRewardId'\)\.addEventListener\('click', applyBatchRewardId\)/);
    const editor = batchEditor('3001');
    editor.apply();
    editor.apply();
    assert.equal(editor.counters.commits, 1);
});

test('当前地图没有固定资源格时不产生空撤销记录', () => {
    const editor = batchEditor('3001', [{ type: 'stage', cellId: 1 }]);
    assert.equal(editor.apply(), false);
    assert.equal(editor.counters.commits, 0);
    assert.match(editor.counters.message, /没有固定资源格/);
});
