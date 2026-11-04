import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';
import { scopeAssetService } from '../assets/script/core/asset/AssetService';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import { loadSpriteFrameCache, TestSpriteFrame } from './helpers/sprite-frame-cache';
import { createControllerContext } from './helpers/controller-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function fixture() {
    const pending: { path: string; finish(): void; reject(): void }[] = [];
    const frames: TestSpriteFrame[] = [];
    const writes: string[] = [];
    const owners: ResourceScope[] = [];
    let holdHeads = false;
    let finishHeadTable = () => {};
    const headTable = new Promise<void>(resolve => { finishHeadTable = resolve; });
    const context = createControllerContext();
    const source = (path: string) => new Promise<TestSpriteFrame>((resolve, reject) => {
        pending.push({ path, reject: () => reject(new Error('asset unavailable')), finish() {
            const frame = new TestSpriteFrame();
            frames.push(frame);
            resolve(frame);
        } });
    });
    context.assets.load = async (path, _Type, options) => {
        const scope = options.scope;
        owners.push(scope);
        const frame = await source(path);
        if (!scope.disposed) {
            frame.addRef();
            scope.defer(() => frame.decRef());
        }
        return frame as never;
    };
    class PopupBase {
        resourceScope = new ResourceScope('rank-test');
        get assets() { return scopeAssetService(context.assets, this.resourceScope); }
        get configs() { return context.configs; }
        isValid = true;
        node = { isValid: true, getChildByPath: (path: string) => {
            writes.push(path);
            return { getComponent: () => ({ spriteFrame: null }) };
        } };
        nextPopupFrame() { return Promise.resolve(true); }
        onDestroy() { this.resourceScope.dispose(); this.isValid = false; this.node.isValid = false; }
    }
    const HeadArt = {
        async loadHeadArtResolver(configs: unknown) {
            assert.equal(configs, context.configs, '头像配置使用本次弹窗端口');
            if (holdHeads) await headTable;
            return {};
        },
        async loadHeadFrame(key: string, loader?: (name: string, root: string) => Promise<unknown>) {
            if (holdHeads) await headTable;
            return loader ? loader(key, 'icons/head') : source(`icons/head/${key}`);
        },
    };
    const dependencies: Record<string, unknown> = {
        cc: {
            _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
            SpriteFrame: TestSpriteFrame,
            resources: { load: (path: string, _Type: unknown, callback: (error: unknown, frame: unknown) => void) => {
                void source(path).then(frame => callback(null, frame));
            } },
        },
        '../../../framework/ui/PopupBase': { PopupBase },
        '../../../vscrollview/VScrollView': {},
        '../../ArtPaths': ArtPaths,
        '../../HeadArt': { HeadArt },
        '../../common/SpriteFrameCache': loadSpriteFrameCache(),
        '../ZCDCLogSwitch': { ZCDC_LOG_WARNINGS: false },
        './ZCGameRankRow': {},
    };
    const exports: any = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/zcds/view/ZCGameRankBoard.ts', 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
    }).outputText, { exports, console, require: (name: string) => {
        assert.ok(name in dependencies, `unexpected dependency ${name}`);
        return dependencies[name];
    } });
    const board = new exports.ZCGameRankBoard();
    board.list = { node: { isValid: true }, setTotalCount: (count: number) => writes.push(`rows:${count}`), scrollToTop() {} };
    return { board, pending, frames, writes, owners,
        holdHeads() { holdHeads = true; }, finishHeadTable,
        close() { board.onClose?.(); board.resourceScope.dispose(); },
        reopen() { board.resourceScope = new ResourceScope('rank-reopen'); },
        async finishLoads() {
            for (let round = 0; round < 5; round++) { pending.splice(0).forEach(request => request.finish()); await flush(); }
        },
    };
}

test('排行榜关闭后迟到切图不留引用、不再查询节点或继续加载', async () => {
    const h = fixture();
    const opening = h.board.onOpen({ seats: [] });
    await flush();
    const oldScope = h.board.resourceScope;
    h.close();
    await h.finishLoads();
    await opening;
    assert.deepEqual(h.writes, []);
    assert.ok(h.frames.every(frame => frame.refs === 0));
    assert.ok(h.owners.every(owner => owner === oldScope));
    assert.equal(h.frames.length, 10, '所有切图在本次加载批次并行提交，不在关闭后追加任务');
});

test('排行榜关闭后重开，旧头像任务不能借用新作用域或覆盖新列表', async () => {
    const h = fixture();
    h.holdHeads();
    const oldOpening = h.board.onOpen({ seats: [{ headKey: 'old' }] });
    await h.finishLoads();
    h.close();
    h.reopen();
    const currentOpening = h.board.onOpen({ seats: [] });
    await h.finishLoads();
    const before = h.writes.length;
    h.finishHeadTable();
    await h.finishLoads();
    await Promise.all([oldOpening, currentOpening]);
    assert.equal(h.writes.length, before, '迟到头像不得再次渲染当前列表');
    assert.ok(!h.pending.some(request => request.path.includes('old')));
    h.close();
    assert.ok(h.frames.every(frame => frame.refs === 0));
});

test('排行榜正常打开使用作用域资源，关闭释放所有帧', async () => {
    const h = fixture();
    const opening = h.board.onOpen({ seats: [{ headKey: 'hero' }] });
    await h.finishLoads();
    await opening;
    assert.ok(h.writes.includes('rows:1'));
    assert.ok(h.owners.length >= 10, '展示切图通过 AssetService 加载');
    h.close();
    assert.ok(h.frames.every(frame => frame.refs === 0));
});

for (const destroyed of [false, true]) {
    test(`排行榜头像资源在${destroyed ? '销毁' : '关闭'}后返回，不写节点、不留引用`, async () => {
        const h = fixture();
        const opening = h.board.onOpen({ seats: [{ headKey: 'late' }] });
        await flush();
        h.pending.splice(0).forEach(request => request.finish());
        await flush();
        assert.ok(h.pending.some(request => request.path.includes('late')), '头像资源请求确实在途');
        if (destroyed) h.board.onDestroy(); else h.close();
        await h.finishLoads();
        await opening;
        assert.deepEqual(h.writes, []);
        assert.ok(h.frames.every(frame => frame.refs === 0));
    });
}

test('排行榜资源失败使用空帧继续打开，关闭仍完整释放', async () => {
    const h = fixture();
    const opening = h.board.onOpen({ seats: [] });
    await flush();
    const failed = h.pending.shift();
    assert.ok(failed);
    failed.reject();
    await h.finishLoads();
    await opening;
    assert.ok(h.writes.includes('rows:0'));
    h.close();
    assert.ok(h.frames.every(frame => frame.refs === 0));
});
