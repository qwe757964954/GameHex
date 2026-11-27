import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import type { ConfigService } from '../assets/script/core/config/ConfigService';
import * as BattleStartModel from '../assets/script/app/battle/BattleStartModel';
import * as MatchTypes from '../assets/script/app/matching/MatchTypes';
import { loadMatchIcons, TestSpriteFrame } from './helpers/sprite-frame-cache';

const TABLE_NAMES_STUB = {
    ITEM_TABLE: 'item',
    ROLE_PROPERTY_TABLE: 'roleProperty',
    PAY_CHANNEL_TABLE: 'payChannel',
    GUANKA_REWARD_TABLE: 'guankaReward',
    HEAD_TABLE: 'head',
    ICON_TABLE: 'icon',
    OPEN_TABLE: 'open',
    PVP_ARTIFACT_TABLE: 'pvpArtifact',
    PVP_CARD_TABLE: 'pvpCard',
};

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

const { MatchIcons } = loadMatchIcons();

function configs(rows: Record<string, readonly unknown[]>): ConfigService {
    return { initialize: async () => {}, getTable: async <T>(name: string) => (rows[name] ?? []) as readonly T[] };
}

test('同作用域同图标并发只加载一次，根目录不同则分别加载', async () => {
    const paths: string[] = [];
    const icons = new MatchIcons({ load: async (path: string) => {
        paths.push(path);
        return new TestSpriteFrame();
    } } as never, new ResourceScope('icons'));
    await Promise.all([icons.load('icon', 'root-a'), icons.load('icon', 'root-a'), icons.load('icon', 'root-b')]);
    assert.equal(paths.length, 2);
    assert.notEqual(paths[0], paths[1]);
});

test('作用域释放后缓存和新请求均不返回资源', async () => {
    const scope = new ResourceScope('released-icons');
    let loads = 0;
    const icons = new MatchIcons({ load: async () => { loads++; return new TestSpriteFrame(); } } as never, scope);
    assert.ok(await icons.load('icon', 'root'));
    scope.dispose();
    assert.equal(await icons.load('icon', 'root'), null);
    assert.equal(await icons.load('new-icon', 'root'), null);
    assert.equal(loads, 1);
});

test('加载期间释放作用域，迟到资源不交给页面', async () => {
    const scope = new ResourceScope('late-icons');
    let finish!: (frame: object) => void;
    const icons = new MatchIcons({ load: () => new Promise((resolve) => { finish = resolve; }) } as never, scope);
    const pending = icons.load('icon', 'root');
    await Promise.resolve();
    scope.dispose();
    finish({});
    assert.equal(await pending, null);
});

test('图标加载失败可重试，空资源名不发请求', async () => {
    let loads = 0;
    const icons = new MatchIcons({ load: async () => {
        if (++loads === 1) throw new Error('temporary failure');
        return new TestSpriteFrame();
    } } as never, new ResourceScope('retry-icons'));
    assert.equal(await icons.load('', 'root'), null);
    assert.equal(await icons.load('icon', 'root'), null);
    assert.ok(await icons.load('icon', 'root'));
    assert.equal(loads, 2);
});

test('匹配配置按注入来源读取，失败不污染后续解析', async () => {
    const { loadMatchProfileLookup } = load<typeof import('../assets/script/app/matching/MatchProfileConfig')>('MatchProfileConfig', {
        '../battle/BattleStartModel': BattleStartModel,
        '../../framework/ref/RefUtil': {},
        '../../core/config/TableNames': TABLE_NAMES_STUB,
    });
    const first = await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '白银' }] }));
    const second = await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '黄金' }] }));
    assert.equal(first.gradeName(1), '白银');
    assert.equal(second.gradeName(1), '黄金');
    const failing = { initialize: async () => {}, getTable: async () => { throw new Error('temporary failure'); } };
    assert.equal((await loadMatchProfileLookup(failing)).gradeName(1), '');
    assert.equal((await loadMatchProfileLookup(configs({ grade: [{ gradeId: 1, gradeName: '恢复' }] }))).gradeName(1), '恢复');
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
        '../card/CardRepository': { cardRepository: { getCachedLineupSnapshot: () => null } },
        '../zcds/model/ZCCombatCatalog': { getPlayerDeck: () => [] },
        './MatchTypes': MatchTypes,
        './MatchPool': { LOCAL_PLAYER: template },
    });
    const first = buildSelfPlayerData(null);
    first.stats.push({ icon: 'icon', value: 1 });
    assert.equal(buildSelfPlayerData(null).stats.length, 0);
    assert.equal(buildSelfPlayerData({ roleId: '1', name: '我方', avatarId: '' }).stats.length, 0);
});
