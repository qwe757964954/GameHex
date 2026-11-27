import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import * as guideConfig from '../assets/script/app/zcds/model/ZCGuideConfig';
import type { ZCGuideLoader } from '../assets/script/app/zcds/application/ZCGuideLoader';
import { type ITestBattlePopup, runtimeFixture, deferred, flush } from './helpers/battle-runtime';
import { loadViews } from './helpers/zcds-view-fixtures';
import { EventMgr } from '../assets/script/framework/event/EventMgr';
import { ZCGameUiEvent } from '../assets/script/app/zcds/view/ZCGameHudEvents';
import type { IZCGuidePreparedContent } from '../assets/script/app/zcds/application/ZCGuideLoader';

const content: IZCGuidePreparedContent = { entries: [], params: guideConfig.ZC_GUIDE_DEFAULT_PARAMS, iconFrames: new Map() };

test('指南条目支持单列四项并在复用时恢复双列尺寸', () => {
    const { load, FakeNode } = loadViews();
    const { ZCGuideItem } = load('./ZCGuideItem');
    const item = new ZCGuideItem();
    const makeLabel = () => ({ node: new FakeNode(), string: '' });
    const slots = Array.from({ length: 4 }, makeLabel);
    [item.reward0, item.reward1, item.reward2, item.reward3] = slots;
    item.titleLabel = makeLabel();
    item.costLabel = makeLabel();
    item.iconSprite = { node: new FakeNode() };
    const [entry] = guideConfig.parseGuideEntries([{
        id: 'a', rewards: ['empty', 'green', 'blue', 'gold'].map(rarity => ({ name: '奖励', rarity, rate: 25 })),
    }]);

    item.render(entry, null, 1);
    assert.deepEqual(slots.map(label => label.node.position.x), [-105, -105, -105, -105]);
    assert.deepEqual(slots.map(label => label.node.position.y), [24, -2, -28, -54]);
    assert.ok(slots.every(label => label.node.active && label.node.scale.x < 1));

    item.render({ ...entry, rewards: entry.rewards.slice(0, 2) }, null, 2);
    assert.deepEqual(slots.map(label => label.node.active), [true, true, false, false]);
    assert.equal(slots[1].node.position.x, 125);
    assert.equal(slots[1].node.scale.x, 1);
    assert.equal(slots[2].string, '');
});

function guideLoader(load: (path: string, scope: ResourceScope) => Promise<object>,
    rows: Promise<readonly unknown[]> = Promise.resolve([{ id: 'mine', icon: 'mine' }])) {
    const warnings: unknown[] = [];
    let configReads = 0;
    const context = {
        exports: {} as { ZCGuideLoader: new (resources: unknown) => Pick<ZCGuideLoader, 'prepare'> },
        require: (name: string) => name === 'cc' ? { SpriteFrame: class {} } : guideConfig,
        console: { warn: (...args: unknown[]) => warnings.push(args) },
    };
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/application/ZCGuideLoader.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    const loader = new context.exports.ZCGuideLoader({
        configs: { getTable: (name: string) => { configReads++; return name === 'zcGuide' ? rows : Promise.resolve([]); } },
        assets: { load: (path: string, _type: unknown, options: { scope: ResourceScope }) => load(path, options.scope) },
    });
    return { loader, warnings, configReads: () => configReads };
}

test('指南图标按键去重，传递当前对局作用域并返回完整内容', async () => {
    const scope = new ResourceScope('guide');
    const frame = {};
    const paths: string[] = [];
    const h = guideLoader(async (path, owner) => {
        assert.equal(owner, scope);
        paths.push(path);
        return frame;
    }, Promise.resolve([{ id: 'a', icon: 'mine' }, { id: 'b', icon: 'mine' }]));
    const result = await h.loader.prepare(scope);
    assert.deepEqual(paths, [guideConfig.getGuideIconPath('mine')]);
    assert.equal(result.entries.length, 2);
    assert.equal(result.iconFrames.get('mine'), frame);
    scope.dispose();
});

test('指南图标失败保留原始错误，不返回缺图内容或记录降级告警', async () => {
    const failure = new Error('missing guide icon');
    const h = guideLoader(async () => { throw failure; });
    await assert.rejects(h.loader.prepare(), error => error === failure);
    assert.equal(h.warnings.length, 0);
});

test('指南加载不抛出取消伪错误，作用域生命周期交由上层与资产服务管理', async () => {
    const scope = new ResourceScope('guide');
    scope.dispose();
    const frame = {};
    const h = guideLoader(async () => frame);
    const result = await h.loader.prepare(scope);
    assert.equal(result.entries.length, 1);
});

test('指南内容加载期间离场或换局，不创建迟到弹窗', async () => {
    for (const replace of [false, true]) {
        const pending = deferred<IZCGuidePreparedContent>(); let opens = 0;
        const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
        Object.assign(h.entry.resources, { loadGuide: () => pending.promise });
        EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); h.dispose();
        const next = replace ? runtimeFixture() : null;
        pending.resolve(content); await flush();
        assert.equal(opens, 0); next?.dispose();
    }
});
test('指南弹窗加载期间离场，迟到弹窗立即关闭', async () => {
    const pending = deferred<ITestBattlePopup | null>(); let closed = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); await flush(); h.dispose();
    pending.resolve({ close: () => closed++ }); await flush();
    assert.equal(closed, 1);
});
test('视图退出后指南迟到完成不再读取组件字段', async () => {
    const pending = deferred<IZCGuidePreparedContent>(); let opens = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
    Object.assign(h.entry.resources, { loadGuide: () => pending.promise });
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide); h.dispose(); Object.freeze(h.view);
    pending.resolve(content); await flush(); assert.equal(opens, 0);
});

test('指南加载在途期间重复点击被门闩拦截，不重复打开弹窗', async () => {
    const pending = deferred<IZCGuidePreparedContent>();
    let opens = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
    Object.assign(h.entry.resources, { loadGuide: () => pending.promise });

    // 快速连续触发两次打开意图
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    await flush();

    pending.resolve(content);
    await flush();

    assert.equal(opens, 1, '在途门闩应拦截并发连击，弹窗仅打开一次');
    h.dispose();
});

test('结算后触发指南意图直接忽略，不打开弹窗', async () => {
    let opens = 0;
    const h = runtimeFixture({}, false, undefined, { openGuide: async () => { opens++; return null; } });
    Object.assign(h.entry.resources, { loadGuide: async () => content });

    h.runtime['phase'].openSettlement();
    EventMgr.instance.emit(ZCGameUiEvent.OpenGuide);
    await flush();

    assert.equal(opens, 0, '已结算状态下不得打开指南弹窗');
    h.dispose();
});
