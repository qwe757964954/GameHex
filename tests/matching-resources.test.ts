import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { ConfigService } from '../assets/script/core/config/ConfigService';
import * as BattleStartModel from '../assets/script/app/battle/BattleStartModel';
import { loadSpriteFrameCache, TestSpriteFrame } from './helpers/sprite-frame-cache';

function load<T>(file: string, dependencies: Record<string, unknown>): T {
    const exports = {};
    const code = ts.transpileModule(readFileSync(`assets/script/app/matching/${file}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    runInNewContext(code, { exports, console, require(name: string) {
        if (name in dependencies) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
    } });
    return exports as T;
}

function icons() {
    return load<typeof import('../assets/script/app/matching/MatchIcons')>('MatchIcons', {
        '../common/SpriteFrameCache': loadSpriteFrameCache(),
    });
}

function configs(rows: Record<string, readonly unknown[]>): ConfigService {
    return { initialize: async () => {}, getTable: async <T>(name: string) => (rows[name] ?? []) as readonly T[] };
}

test('同作用域同图标并发只加载一次，根目录不同则分别加载', async () => {
    const { createMatchIconLoader } = icons();
    const paths: string[] = [];
    const loader = createMatchIconLoader({ load: async (path: string) => {
        paths.push(path);
        return new TestSpriteFrame();
    } } as never, new ResourceScope('icons'));
    await Promise.all([loader('icon', 'root-a'), loader('icon', 'root-a'), loader('icon', 'root-b')]);
    assert.equal(paths.length, 2);
    assert.notEqual(paths[0], paths[1]);
});

test('作用域释放后缓存和新请求均不返回资源', async () => {
    const scope = new ResourceScope('released-icons');
    let loads = 0;
    const loader = icons().createMatchIconLoader({ load: async () => { loads++; return new TestSpriteFrame(); } } as never, scope);
    assert.ok(await loader('icon', 'root'));
    scope.dispose();
    assert.equal(await loader('icon', 'root'), null);
    assert.equal(await loader('new-icon', 'root'), null);
    assert.equal(loads, 1);
});

test('加载期间释放作用域，迟到资源不交给页面', async () => {
    const scope = new ResourceScope('late-icons');
    let finish!: (frame: object) => void;
    const loader = icons().createMatchIconLoader({ load: () => new Promise((resolve) => { finish = resolve; }) } as never, scope);
    const pending = loader('icon', 'root');
    await Promise.resolve();
    scope.dispose();
    finish({});
    assert.equal(await pending, null);
});

test('图标加载失败可重试，空资源名不发请求', async () => {
    let loads = 0;
    const loader = icons().createMatchIconLoader({ load: async () => {
        if (++loads === 1) throw new Error('temporary failure');
        return new TestSpriteFrame();
    } } as never, new ResourceScope('retry-icons'));
    assert.equal(await loader('', 'root'), null);
    assert.equal(await loader('icon', 'root'), null);
    assert.ok(await loader('icon', 'root'));
    assert.equal(loads, 2);
});

test('匹配配置按注入来源读取，失败不污染后续解析', async () => {
    const { loadMatchProfileLookup } = load<typeof import('../assets/script/app/matching/MatchProfileConfig')>('MatchProfileConfig', {
        '../battle/BattleStartModel': BattleStartModel,
        '../../framework/ref/RefUtil': {},
    });
    const first = await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '白银' }] }));
    const second = await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '黄金' }] }));
    assert.equal(first.gradeName(1), '白银');
    assert.equal(second.gradeName(1), '黄金');
    const failing = { initialize: async () => {}, getTable: async () => { throw new Error('temporary failure'); } };
    assert.equal((await loadMatchProfileLookup(failing)).gradeName(1), '');
    assert.equal((await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '恢复' }] }))).gradeName(1), '恢复');
});

test('开战回包阵容经真实卡表生成僵尸、坦克、战士、射手统计，零计数仍展示', async () => {
    const { loadMatchProfileLookup } = load<typeof import('../assets/script/app/matching/MatchProfileConfig')>('MatchProfileConfig', {
        '../battle/BattleStartModel': BattleStartModel,
    });
    const rows = Object.fromEntries(['grade', 'pvpArtifact', 'head', 'icon', 'pvpCard'].map(name => {
        const table = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
        return [name, Array.isArray(table) ? table : table.v.map((values: unknown[]) => Object.fromEntries(table.k.map((key: string, i: number) => [key, values[i]])))];
    }));
    const lookup = await loadMatchProfileLookup(configs(rows));
    const base = { name: '', avatarIcon: '', power: 0, rank: '', trophy: 0, artifactName: '', artifactIcon: '', stats: [] };
    for (const [ids, expected] of [
        [[68001, 68002, 68005, 68020, 68033, 68021, 68012, 68004], [1, 1, 4, 3]],
        [[68002, 68028, 68020, 68013, 68029, 68022, 68031, 68034], [4, 3, 1, 2]],
        [[68022, 99999], [0, 0, 0, 0]],
    ]) {
        const unit = BattleStartModel.normalizeBattleUnit({ campId: 1, showInfo: {},
            heroInfos: ids.map(heroId => ({ heroId, level: 1 })), artifactId: 0 } as never);
        const view = BattleStartModel.applyUnitToPlayerView(base, unit, lookup);
        assert.deepEqual(view.stats.map(stat => stat.icon), ['icon_01', 'icon_03', 'icon_02', 'icon_04']);
        assert.deepEqual(view.stats.map(stat => stat.value), expected);
        assert.equal(view.artifactName, '');
        assert.equal(view.artifactIcon, '');
    }
    assert.deepEqual(base.stats, [], '不修改占位数据');
});

test('无效卡表行跳过，未加载卡表时不伪造统计', () => {
    const lookup = BattleStartModel.buildMatchProfileLookup(null, null, null, null, [
        null as never, { id: 0 }, { id: 1, traits: null }, { id: 2, traits: { camp: 3, attack: false } },
    ]);
    assert.deepEqual(lookup.heroStats([1, 2, 999]).map(stat => stat.value), [0, 0, 0, 0]);
    assert.deepEqual(BattleStartModel.buildMatchProfileLookup(null, null).heroStats([1]), []);
});

test('匹配提示过滤空文案并稳定排序，失败后可重新读取', async () => {
    const { loadMatchTips } = load<typeof import('../assets/script/app/matching/MatchTipsConfig')>('MatchTipsConfig', {
        '../../framework/ref/RefUtil': {},
    });
    const failing = { initialize: async () => {}, getTable: async () => { throw new Error('temporary failure'); } };
    assert.equal((await loadMatchTips(failing)).length, 0);
    const result = await loadMatchTips(configs({ matchTips: [
        { id: 'b', order: 2, text: ' B ' }, { id: 'c', order: 1, text: ' C ' },
        { id: 'a', order: 1, text: ' A ' }, { id: 'empty', text: '  ' },
    ] }));
    assert.deepEqual(Array.from(result), ['A', 'C', 'B']);
    assert.deepEqual(Array.from(await loadMatchTips(configs({ matchTips: [{ text: '新配置' }] }))), ['新配置']);
});

test('我方展示数据使用独立统计数组，不能修改下一次匹配的占位数据', () => {
    const template = { name: '', avatarIcon: 'img_people', power: 0, rank: '', trophy: 0,
        artifactName: '', artifactIcon: '', stats: [] };
    const { buildSelfPlayerData } = load<typeof import('../assets/script/app/matching/MatchSelfProfile')>('MatchSelfProfile', {
        cc: {}, '../net/CacheMgr': {}, '../net/RequestGuard': {}, '../HeadArtModel': { applyHeadArt() {} },
        './MatchPool': { LOCAL_PLAYER: template },
    });
    const first = buildSelfPlayerData(null);
    first.stats.push({ icon: 'icon', value: 1 });
    assert.equal(buildSelfPlayerData(null).stats.length, 0);
    assert.equal(buildSelfPlayerData({ roleId: '1', name: '我方', avatarId: '' }).stats.length, 0);
});

test('统计条目复用时清除上一条图标，空数据隐藏整条', () => {
    const exports = {} as { MatchStatItem: new () => {
        icon: { node: { active: boolean }; spriteFrame: unknown };
        valueLabel: { node: { active: boolean }; string: string };
        render(stat: { icon: string; value: number } | null, frame: unknown): void;
    } };
    const code = ts.transpileModule(readFileSync('assets/script/app/matching/MatchStatItem.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    runInNewContext(code, { exports, require() { return { Component: class {},
        _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} } }; } });
    const item = new exports.MatchStatItem();
    item.icon = { node: { active: true }, spriteFrame: {} };
    item.valueLabel = { node: { active: true }, string: '' };
    item.render({ icon: 'missing', value: 7 }, null);
    assert.equal(item.icon.spriteFrame, null, '资源缺失不能沿用上一个条目的图');
    assert.equal(item.valueLabel.string, '7');
    item.render(null, null);
    assert.equal(item.icon.node.active, false);
    assert.equal(item.valueLabel.node.active, false);
});
