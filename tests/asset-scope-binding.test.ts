import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { scopeAssetService, type AssetService, type AssetLoadOptions } from '../assets/script/core/asset/AssetService';
import { ResourceScope } from '../assets/script/core/asset/ResourceScope';

class Frame { refs = 0; valid = true; }
function fixture() {
    const frame = new Frame(), options: AssetLoadOptions[] = [];
    const retain = (opts: AssetLoadOptions = {}) => {
        options.push(opts);
        if (opts.scope) { frame.refs++; opts.scope.defer(() => { frame.refs--; if (frame.refs === 0) frame.valid = false; }); }
        return frame;
    };
    const assets = { load: async (_path: string, _type: unknown, opts?: AssetLoadOptions) => retain(opts),
        loadDir: async (_path: string, _type: unknown, opts?: AssetLoadOptions) => [retain(opts)],
        has: async () => true, preload: async () => {},
    } as AssetService;
    return { frame, options, assets };
}

test('退出战斗只释放战斗引用，领地持有的共享帧继续有效，领地关闭后释放', async () => {
    const f = fixture(), page = new ResourceScope('territory'), battle = new ResourceScope('battle');
    const assets = scopeAssetService(f.assets, page);
    const frame = await assets.load('image/buildings/img_land_01/spriteFrame', Frame);
    await f.assets.loadDir('image/buildings', Frame, { scope: battle });
    assert.equal(frame.refs, 2); battle.dispose();
    assert.equal(frame.refs, 1); assert.equal(frame.valid, true);
    page.dispose(); assert.equal(frame.refs, 0); assert.equal(frame.valid, false);
});

test('独立战斗scope原样传递，领地销毁不释放已移交的战斗资源，保留bundle/cache', async () => {
    const f = fixture(), page = new ResourceScope('territory'), battle = new ResourceScope('battle');
    const assets = scopeAssetService(f.assets, page);
    await assets.load('unit', Frame, { scope: battle, bundle: 'battle', cache: false });
    assert.equal(f.options[0].scope, battle); assert.equal(f.options[0].bundle, 'battle'); assert.equal(f.options[0].cache, false);
    page.dispose(); assert.equal(f.frame.refs, 1); battle.dispose(); assert.equal(f.frame.refs, 0);
});

test('页面关闭后不派发默认请求，迟到完成释放且拒绝交给已关闭的视图', async () => {
    const f = fixture(), page = new ResourceScope('territory');
    let finish: () => void = () => {};
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const original = f.assets.load.bind(f.assets);
    f.assets.load = async (...args) => { await gate; return original(...args); };
    const assets = scopeAssetService(f.assets, page), pending = assets.load('late', Frame);
    page.dispose(); finish(); await assert.rejects(pending, /取消|释放|关闭/);
    assert.equal(f.frame.refs, 0);
    const count = f.options.length;
    await assert.rejects(assets.load('closed', Frame), /取消|释放|关闭/);
    await assert.rejects(assets.loadDir('closed-dir', Frame), /取消|释放|关闭/);
    await assert.rejects(assets.has('closed', Frame), /取消|释放|关闭/);
    assert.equal(f.options.length, count);
});

test('领地章节美术、翻格、云、宝箱统一使用页面作用域，销毁时归还', () => {
    const source = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.match(source, /scopeAssetService\(assets, this\.resourceScope\)/);
    assert.match(source, /new TerritoryChapterLoader\(pageAssets\)/);
    for (const method of ['loadHexFlipAssets', 'loadResourceGainIcons', 'loadChestArt', 'loadCloudArt']) {
        assert.ok(source.includes(`this.${method}(pageAssets)`));
    }
    assert.match(source, /this\.resourceScope\.dispose\(\)/);
});
