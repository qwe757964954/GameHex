import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import * as ArtPaths from '../assets/script/app/ArtPaths';
import * as HeadArtModel from '../assets/script/app/HeadArtModel';
import * as ItemDetailArt from '../assets/script/app/itemdetail/ItemDetailArt';
import * as RoleArt from '../assets/script/app/role/RoleArt';
import { qualityFrameSuffixOf } from '../assets/script/app/itemdetail/ItemDetailTable';
import { resIconRoot } from '../assets/script/app/common/ResTypes';
import { loadSpriteFrameCache, TestSpriteFrame } from './helpers/sprite-frame-cache';

function fixture<T>(file: string, extras: Record<string, unknown> = {}) {
    const paths: string[] = [];
    const frames: TestSpriteFrame[] = [];
    const shared = loadSpriteFrameCache((path: string, _type: unknown, done: (error: null, frame: TestSpriteFrame) => void) => {
        paths.push(path);
        const frame = new TestSpriteFrame(); frames.push(frame);
        done(null, frame);
    });
    const exports = {};
    const dependencies: Record<string, unknown> = {
        '../ArtPaths': ArtPaths, './ArtPaths': ArtPaths,
        '../common/SpriteFrameCache': shared, './common/SpriteFrameCache': shared, './SpriteFrameCache': shared,
        '../HeadArt': { HeadArt: {} }, './HeadArtModel': HeadArtModel,
        '../framework/ref/RefUtil': {}, './ItemDetailArt': ItemDetailArt,
        './RoleArt': RoleArt, '../itemdetail/ItemDetailTable': { qualityFrameSuffixOf },
        '../common/ResTypes': { resIconRoot },
        ...extras,
    };
    runInNewContext(ts.transpileModule(readFileSync(`assets/script/app/${file}.ts`, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, console, require(name: string) {
        if (name in dependencies) return dependencies[name];
        throw new Error(`Unexpected dependency: ${name}`);
    } });
    return { api: exports as T, paths, frames };
}

test('卡牌按名与直接路径入口共享图，退出登录释放引用', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/card/CardLineupIcons')>('card/CardLineupIcons');
    const first = await api.loadArt('icon', 'icons/card');
    assert.equal(await api.loadIconByArtPath('icons/card/icon/spriteFrame'), first);
    assert.deepEqual(paths, ['icons/card/icon/spriteFrame']);
    api.releaseArtCache();
    assert.equal(frames[0].refs, 0);
});

test('商城保留资源路径与释放入口', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/store/StoreArt')>('store/StoreArt');
    await Promise.all([api.loadStoreIcon('icons/item/a'), api.loadStoreIcon('icons/item/a')]);
    assert.deepEqual(paths, ['icons/item/a/spriteFrame']);
    api.releaseStoreArt();
    assert.equal(frames[0].refs, 0);
});

test('物品的 image 相对路径与完整图标路径不混用，peek 和 reset 保持可用', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/itemdetail/ItemDetailArtLoader')>('itemdetail/ItemDetailArtLoader');
    const key = Object.keys(ItemDetailArt.ID_ART_NAMES)[0];
    const rel = ItemDetailArt.ID_ART_NAMES[key];
    const first = await api.loadIdArt(key);
    assert.equal(api.peekIdArt(key), first);
    assert.equal(await api.loadIdArtByRel(rel), first);
    await api.loadItemIconArt('icons/item/a');
    assert.deepEqual(paths, [`image/${rel}/spriteFrame`, 'icons/item/a/spriteFrame']);
    api.resetIdArtCacheForTest();
    assert.equal(api.peekIdArt(key), null);
    assert.ok(frames.every((frame) => frame.refs === 0));
});

test('角色键经原路径解析，背包按类型分目录；reset 同时释放两类图', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/role/RoleArtLoader')>('role/RoleArtLoader', {
        '../itemdetail/ItemDetailArtLoader': {},
    });
    const key = Object.keys(RoleArt.RL_ART_NAMES)[0];
    const first = await api.loadRoleArt(key);
    assert.equal(api.peekRoleArt(key), first);
    await api.loadRoleBagIconSprite('gem', 'a');
    await api.loadRoleBagIconSprite('equip', 'a');
    assert.deepEqual(paths, [`${RoleArt.roleArtRelPath(key)}/spriteFrame`, 'icons/gem/a/spriteFrame', 'icons/equip/a/spriteFrame']);
    api.resetRoleArtCacheForTest();
    assert.equal(api.peekRoleArt(key), null);
    assert.ok(frames.every((frame) => frame.refs === 0));
});

test('头像按原目录并发去重，reset 释放图片', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/HeadArt')>('HeadArt');
    const [first, same] = await Promise.all([api.HeadArt.loadHeadSprite('a'), api.HeadArt.loadHeadSprite('a')]);
    assert.equal(first, same);
    assert.deepEqual(paths, [`${ArtPaths.HEAD_ART_ROOT}/a/spriteFrame`]);
    api.HeadArt.resetCacheForTest();
    assert.equal(frames[0].refs, 0);
});

test('红点加载保留美术表并在退出时释放', async () => {
    const { api, paths, frames } = fixture<typeof import('../assets/script/app/common/RedDotArt')>('common/RedDotArt');
    await api.preloadRedDotFrames();
    assert.deepEqual(paths, Array.from(api.RED_DOT_ART_KEYS, (key) => api.redDotArtPath(key)));
    api.releaseRedDotFrames();
    assert.ok(frames.every((frame) => frame.refs === 0));
});

test('资源栏默认目录仍走货币映射，同时支持显式根目录', async () => {
    const { api, paths } = fixture<typeof import('../assets/script/app/main/MainResBarArt')>('main/MainResBarArt');
    await api.loadResBarSprite('图标_经验值');
    await api.loadResBarSprite('a', 'custom');
    assert.deepEqual(paths, [`${resIconRoot('图标_经验值')}/图标_经验值/spriteFrame`, 'custom/a/spriteFrame']);
});
