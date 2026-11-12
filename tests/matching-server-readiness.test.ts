import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as MatchTypes from '../assets/script/app/matching/MatchTypes';

test('matching page destruction emits lifecycle without accessing destroyed child nodes', () => {
    const exports: Record<string, any> = {}, events: unknown[] = [];
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchingPage.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { Component: class {}, _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } };
        if (name.endsWith('/EventMgr')) return { EventMgr: { instance: { emit: (_name: string, event: unknown) => events.push(event) } } };
        if (name.endsWith('/ViewLifecycle')) return { VIEW_LIFECYCLE: 'lifecycle' };
        return {};
    } });
    const page = new exports.MatchingPage();
    page.waveNodes = [{ node: { set active(_v: boolean) { throw new Error('destroyed'); } } }];
    assert.doesNotThrow(() => page.onDestroy());
    assert.equal(page.waveNodes.length, 0); assert.equal(events.length, 1);
});

function playerFixture() {
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/matching/MatchPlayerItem.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, { exports, require(name: string) {
        if (name === 'cc') return { Component: class {}, Vec3: class {},
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } };
        if (name.endsWith('/ArtPaths')) return { MATCH_SLOT_BARS: ['bar'], MATCH_SLOT_FRAMES: ['frame'] };
        if (name === './MatchTypes') return { MATCH_STAT_SLOTS: 5 };
        return {};
    } });
    const item = new exports.MatchPlayerItem();
    let complete!: (frame: object) => void;
    const frame = new Promise<object>((resolve) => { complete = resolve; });
    let writes = 0;
    const sprite = { set spriteFrame(_value: unknown) { writes++; } };
    Object.assign(item, { barFrame: sprite, avatarFrame: sprite, avatar: sprite, artifactIcon: sprite,
        nameLabel: {}, rankLabel: {}, trophyLabel: {}, powerValueLabel: {}, artifactNameLabel: {}, artifactRow: {},
        syncRankRowWidth() {}, renderStats() { writes++; } });
    item.setIconLoader(() => frame);
    return { item, complete, get writes() { return writes; } };
}

test('信息条销毁使配色和内容加载失效，迟到图标不再写组件', async () => {
    const h = playerFixture();
    const slot = h.item.applySlot(0);
    const content = h.item.refresh({ name: '我方', rank: '', trophy: 0, power: 0,
        artifactName: '', artifactIcon: '', avatarIcon: '', stats: [] });
    h.item.onDestroy();
    h.complete({});
    await Promise.all([slot, content]);
    assert.equal(h.writes, 0);
});

test('信息条仍存活时正常应用异步图标', async () => {
    const h = playerFixture();
    const slot = h.item.applySlot(0);
    h.complete({});
    await slot;
    assert.equal(h.writes, 2);
});

test('统计传入列表并显示整行，空神器隐藏且清掉旧帧', async () => {
    const h = playerFixture();
    delete h.item.renderStats;
    let slots: unknown[] = [];
    h.item.statRow = { active: false };
    h.item.statList = { refreshList(data: unknown[]) { slots = data; } };
    h.item.artifactIcon = { spriteFrame: {} };
    h.item.setIconLoader(async () => null);
    const data = { name: '我方', rank: '', trophy: 0, power: 0, avatarIcon: '',
        artifactName: '', artifactIcon: '', stats: [{ icon: 'icon_01', value: 0 }] };
    await h.item.refresh(data);
    assert.equal(h.item.statRow.active, true);
    assert.equal(slots.length, 1);
    assert.equal(h.item.artifactRow.active, false);
    assert.equal(h.item.artifactIcon.spriteFrame, null);
    await h.item.refresh({ ...data, artifactName: '希瓦的守护', artifactIcon: '霜封冰刃' });
    assert.equal(h.item.artifactRow.active, true);
    h.item.clear();
    assert.equal(h.item.statRow.active, false);
    assert.equal(slots.length, 0);
});

test('matching ready is emitted from start after child onLoad, never from parent onLoad', () => {
    const code = readFileSync('assets/script/app/matching/MatchingPage.ts', 'utf8');
    const onLoad = code.slice(code.indexOf('protected onLoad()'), code.indexOf('protected start()'));
    assert.doesNotMatch(onLoad, /phase: 'ready'|\.setSearching\(/);
    assert.match(code, /protected start\(\): void \{ EventMgr\.instance\.emit\(VIEW_LIFECYCLE, \{ owner: this, phase: 'ready' \}\)/);
});
