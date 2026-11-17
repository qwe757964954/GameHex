import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeTerritoryMap } from '../tools/map-editor/formats/territory-format.js';
import { configureTerritoryMap } from '../assets/script/app/territory/model/TerritoryMapConfig';

function patrolMap(battleIds: unknown = [10002, 10001, 10002]) {
    return {
        version: 1, mapKind: 'territoryChapter', id: 'patrol_test', chapterId: 1,
        rows: 4, columns: 4, startCellId: 0, defaults: {},
        sites: [{ id: 'patrol_1', type: 'patrolChest', cellId: 1, battleIds }],
    };
}

test('巡逻宝箱的多个战斗 ID 经编辑器和客户端解析后保留顺序及重复值', () => {
    for (const battleIds of [[10001], [10002, 10001, 10002]]) {
        const input = patrolMap(battleIds);
        const normalized = normalizeTerritoryMap(input).map;
        assert.deepEqual(normalized.sites[0].battleIds, battleIds);
        const config = configureTerritoryMap(normalized);
        assert.equal(config.sites[0].type, 'patrolChest');
        assert.deepEqual(config.sites[0].battleIds, battleIds);
        assert.notEqual(normalized.sites[0].battleIds, battleIds);
        assert.notEqual(config.sites[0].battleIds, normalized.sites[0].battleIds);
    }
});

test('巡逻宝箱保存边界拒绝缺失、空数组和非法战斗 ID', () => {
    for (const battleIds of [null, [], '10001', [0], [-1], [1.5], ['10001'], [true], [Number.MAX_SAFE_INTEGER + 1]]) {
        const input = patrolMap(battleIds);
        assert.throws(() => normalizeTerritoryMap(input), /battleIds/);
        assert.throws(() => configureTerritoryMap(input), /battleIds/);
    }
    const missing = patrolMap();
    delete missing.sites[0].battleIds;
    assert.throws(() => normalizeTerritoryMap(missing), /battleIds/);
    assert.throws(() => configureTerritoryMap(missing), /battleIds/);
});

test('普通站点不能误带巡逻战斗数组', () => {
    const input = patrolMap();
    input.sites[0].type = 'stage';
    assert.throws(() => normalizeTerritoryMap(input), /only valid for patrolChest/);
    assert.throws(() => configureTerritoryMap(input), /only valid for patrolChest/);
});

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');

test('野怪巡逻 ID 在编辑器和客户端解析中保留，旧地图仍可省略', () => {
    const input = patrolMap();
    Object.assign(input.sites[0], { patrolId: 60001 });
    const normalized = normalizeTerritoryMap(input).map;
    assert.equal(normalized.sites[0].patrolId, 60001);
    assert.equal(configureTerritoryMap(normalized).sites[0].patrolId, 60001);
    assert.equal(configureTerritoryMap(patrolMap()).sites[0].patrolId, undefined);
    for (const patrolId of [0, -1, 1.5, '60001', true, null, Number.MAX_SAFE_INTEGER + 1]) {
        Object.assign(input.sites[0], { patrolId });
        assert.throws(() => normalizeTerritoryMap(input), /patrolId/);
        assert.throws(() => configureTerritoryMap(input), /patrolId/);
    }
    Object.assign(input.sites[0], { type: 'stage', patrolId: 60001 });
    delete input.sites[0].battleIds;
    assert.throws(() => normalizeTerritoryMap(input), /patrolId/);
    assert.throws(() => configureTerritoryMap(input), /patrolId/);
});

test('野怪巡逻 ID 输入可按格修改及清空，非法值不覆盖原配置', () => {
    const sites = [{ type: 'patrolChest', cellId: 1, patrolId: 60001 }, { type: 'patrolChest', cellId: 2 }];
    const field = { value: '60002', focus() {} };
    const context = {
        map: { sites }, selectedCell: 1, $: () => field,
        commits: 0, commit() { context.commits += 1; }, markErrorsStale() {}, message() {},
    };
    const functions = ['siteAtCell', 'readPatrolId', 'applyPatrolIdFromForm'].map((name) => {
        const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    });
    const apply = runInNewContext(`${functions.join('\n')}; applyPatrolIdFromForm`, context) as () => boolean;
    assert.equal(apply(), true);
    assert.equal(sites[0].patrolId, 60002);
    apply();
    assert.equal(context.commits, 1);
    for (const value of ['0', '-1', '1.5', 'abc', '9007199254740992']) {
        field.value = value;
        assert.equal(apply(), false);
        assert.equal(sites[0].patrolId, 60002);
    }
    context.selectedCell = 2;
    field.value = '60003';
    assert.equal(apply(), true);
    assert.equal(sites[1].patrolId, 60003);
    context.selectedCell = 1;
    field.value = '';
    assert.equal(apply(), true);
    assert.equal('patrolId' in sites[0], false);
    assert.equal(sites[1].patrolId, 60003);
});

function patrolEditor() {
    const sites = [
        { type: 'patrolChest', cellId: 1, battleIds: [10001] },
        { type: 'patrolChest', cellId: 2, battleIds: [] as number[] },
        { type: 'stage', cellId: 3 },
    ];
    const field = { value: '', focused: false, focus() { this.focused = true; } };
    const context = {
        map: { sites }, selectedCell: 1, $: () => field,
        commits: 0, commit() { context.commits += 1; }, markErrorsStale() {}, message() {},
    };
    const functions = ['siteAtCell', 'readPatrolBattleIds', 'applyPatrolBattleIdsFromForm'].map((name) => {
        const match = source.match(new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
        assert.ok(match, `${name} must exist`);
        return match[0];
    });
    const apply = runInNewContext(`${functions.join('\n')}; applyPatrolBattleIdsFromForm`, context) as () => boolean;
    return { sites, field, context, apply };
}

test('巡逻战斗输入按格独立提交，非法值不覆盖已有配置，相同值不新增撤销', () => {
    const editor = patrolEditor();
    editor.field.value = '10002，10001, 10003';
    assert.equal(editor.apply(), true);
    assert.deepEqual(Array.from(editor.sites[0].battleIds ?? []), [10002, 10001, 10003]);
    assert.equal(editor.context.commits, 1);
    editor.apply();
    assert.equal(editor.context.commits, 1);
    for (const input of ['0', '-1', '2.5', 'abc', '10001,']) {
        editor.field.value = input;
        assert.equal(editor.apply(), false, input);
        assert.deepEqual(Array.from(editor.sites[0].battleIds ?? []), [10002, 10001, 10003]);
    }
    editor.context.selectedCell = 2;
    editor.field.value = '20001';
    assert.equal(editor.apply(), true);
    assert.deepEqual(Array.from(editor.sites[1].battleIds ?? []), [20001]);
    editor.context.selectedCell = 3;
    editor.field.value = 'invalid';
    assert.equal(editor.apply(), true);
    assert.equal('battleIds' in editor.sites[2], false);
});

test('新绘制的巡逻宝箱可以留空继续编辑，保存由格式校验拦截', () => {
    const editor = patrolEditor();
    editor.context.selectedCell = 2;
    assert.equal(editor.apply(), true);
    assert.equal(editor.context.commits, 0);
});

test('巡逻宝箱的工具、表单及保存入口接通', () => {
    const html = readFileSync('tools/map-editor/territory.html', 'utf8');
    assert.match(html, /data-mode="patrolChest"/);
    assert.match(html, /option value="patrolChest"/);
    assert.match(html, /id="battleIds"/);
    assert.match(html, /id="patrolId"/);
    assert.match(source, /if \(!applyPatrolIdFromForm\(\)\) return;/);
    assert.match(source, /if \(!applyPatrolIdFromForm\(\)\) throw/);
    assert.match(source, /\$\('patrolId'\)\.addEventListener\('change', applyPatrolIdFromForm\)/);
    assert.match(source, /function paint\([^\n]+\{[\s\S]*?if \(!applyPatrolBattleIdsFromForm\(\)\) return;/);
    assert.match(source, /function buildJSON\(\) \{[\s\S]*?if \(!applyPatrolBattleIdsFromForm\(\)\) throw/);
    assert.match(source, /\$\('battleIds'\)\.addEventListener\('change', applyPatrolBattleIdsFromForm\)/);
});
