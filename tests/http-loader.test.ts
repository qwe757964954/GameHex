import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import * as ts from 'typescript';

type Callback = (error: Error | null, asset?: object) => void;
function loader() {
    let callback: Callback = () => {};
    const cleared: string[] = [];
    const urls: string[] = [];
    class Texture2D { image: object | null = null; }
    const assetManager = {
        loadRemote(_url: string, options: object | Callback, done?: Callback) {
            urls.push(_url);
            callback = typeof options === 'function' ? options : done as Callback;
        }, cacheManager: { removeCache(path: string) { cleared.push(path); } },
    };
    const exports: Record<string, Record<string, (...args: any[]) => Promise<any>>> = {};
    runInNewContext(ts.transpileModule(readFileSync('assets/script/framework/utils/HttpLoader.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, {
        exports, require: (name: string) => name === 'cc' ? { assetManager, Texture2D }
            : { EngineMain: { isBrowser: false } },
    });
    return { api: exports.HttpLoader, settle: (error: Error | null, asset?: object) => callback(error, asset), cleared, urls, Texture2D };
}

test('远程资源加载失败时全部 Promise 拒绝，不能把 undefined 当成功', async () => {
    for (const [name, args] of [
        ['RequestTexture', []], ['RequestTextureWith', ['.png']],
        ['RequestAudioClip', []], ['RequestJson', [true]], ['RequestText', []],
    ] as const) {
        const h = loader();
        const result = h.api[name]('https://example.test/asset.png', ...args);
        const failure = new Error('download failed');
        h.settle(failure);
        await assert.rejects(result, error => error === failure);
        assert.deepEqual(h.cleared, []);
    }
});

test('远程图片转换成 Texture2D，JSON 使用随机参数刷新缓存', async () => {
    for (const name of ['RequestTexture', 'RequestTextureWith']) {
        const h = loader();
        const result = h.api[name]('https://example.test/image.png', '.png');
        const image = { width: 32, height: 16 };
        h.settle(null, image);
        const texture = await result;
        assert.ok(texture instanceof h.Texture2D);
        assert.equal(texture.image, image);
    }
    const h = loader();
    const result = h.api.RequestJson('https://example.test/table.json', true);
    const asset = { nativeUrl: 'cached/table.json', json: { value: 1 } };
    h.settle(null, asset);
    assert.equal(await result, asset);
    assert.deepEqual(h.cleared, []);
    assert.match(h.urls[0], /table\.json\?v=\d+$/);
});
