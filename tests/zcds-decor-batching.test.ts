/**
 * 装饰（`image/decor/**`）**不要**按 art 分组重排—— 这条护栏钉住一个已验证的结论。
 *
 * ## 背景：一次被否决的优化
 *
 * 2026-10-08 提出过「装饰按 art 分组再入 DecorLayer，理由是 river.json 有 60 个装饰
 * 却只��3 种图、同行相邻换图 27 次 ⇒ 断批」。**动手前查了图集口径，结论是收益不存在**：
 *
 * Cocos 的 2D 合批按**纹理**切，不按 spriteFrame 切。同一张图集里的相邻 Sprite
 * 换 `spriteFrame` **不断批**。而 `image/decor/auto-atlas.pac` 的配置是：
 *
 * ```json
 * "removeImageInBundle": true     ← 打包时把原图从 bundle 里移除
 * "removeSpriteAtlasInBundle": true
 * ```
 *
 * 也就是**全部装饰图在打包后被合并进同一张图集**，原图不再单独存在。
 * 所以「3 种 art 相邻换图」根本不是 27 次断批，只是 27 次 SpriteFrame 赋值。
 *
 * ## 那���为什么不能顺手做一下
 *
 * 因为它**有害无益**：按 art 分组会改 `buildDecorPlacements` 的画家算法顺序
 * （`y降序 → x升序`），而相邻格的装饰 fit 后**横向可能重叠**（格面宽 112 > 列间距 84）。
 * 像素级比对实测：**PVP4-1 差 70 像素、notch 差 650 像素** —— 画面真的会变。
 *
 * 零收益 + 改画面 ⇒ 不做。
 *
 * ## 这条用例在防什么
 *
 * ① 有人看到"27 次换图"又来提一遍分组 —— 断言会告诉他图集已合并。
 * ② 美术把某张装饰图挪到 `image/xxx/` 下（不在 decor 树里）⇒ 变成独立纹理，
 *    断批真的存在了。断言会在**那时**变红，提示这条结论需要重估。
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { assetPath } from './helpers/asset-paths';

const MAP_DIR = assetPath('config/maps');
const DECOR_ROOT = assetPath('image/decor');
const ATLAS_META = `${DECOR_ROOT}/auto-atlas.pac.meta`;

/** 所有地图与编辑器夹具 `art.freeDecor` 里使用的资源名。 */
function decorArts(): Array<{ map: string; art: string }> {
    const out: Array<{ map: string; art: string }> = [];
    const files = readdirSync(MAP_DIR).filter((f) => f.endsWith('.json'))
        .map((file) => ({ name: file, path: `${MAP_DIR}/${file}` }))
        .concat([{ name: 'zcds-map-v3-decor.json', path: 'tests/fixtures/zcds-map-v3-decor.json' }]);
    for (const file of files) {
        const data = JSON.parse(readFileSync(file.path, 'utf8'));
        for (const item of data.art?.freeDecor ?? []) {
            out.push({ map: file.name, art: String(item.art) });
        }
    }
    return out;
}

test('全部装饰 art 都落在 image/decor 树内 —— 都在 auto-atlas.pac 覆盖范围里', () => {
    const all = decorArts();
    assert.ok(all.length > 0, '夹具失效：一张地图都没有装饰');

    const outside = [...new Set(all.filter((d) => !d.art.startsWith('image/decor/')).map((d) => d.art))];
    assert.deepEqual(
        outside, [],
        `这些装饰图不在 image/decor 树内 ⇒ 不被 auto-atlas.pac 覆盖，会成为独立纹理：\n  ${outside.join('\n  ')}`,
    );
});

test('decor 的 auto-atlas.pac 配了「打包后移除原图」—— 同图集是硬事实，不是假设', () => {
    assert.ok(existsSync(ATLAS_META), 'decor/auto-atlas.pac.meta 不存在，自动图集没配');
    const meta = JSON.parse(readFileSync(ATLAS_META, 'utf8'));
    assert.equal(meta.importer, 'auto-atlas');
    const ud = meta.userData ?? {};
    // 这两条是"同图集"的根据：打包时原图进图集、单图不再单独存在。
    assert.equal(ud.removeImageInBundle, true, '没开 removeImageInBundle ⇒ 原图留在 bundle 里，不能断定同图集');
    assert.equal(ud.removeSpriteAtlasInBundle, true);
    // 没开 filterUnused 的话未引用图也会被打进去（图仍然同批，只是包体大一点）。
    assert.ok(typeof ud.filterUnused === 'boolean', 'filterUnused 应显式配过，别靠默认值');
});

test('【结论钉子】同图集 ⇒ 换 spriteFrame 不断批 ⇒ 按 art 分组无收益，不做', () => {
    const meta = JSON.parse(readFileSync(ATLAS_META, 'utf8'));
    const sameAtlas = meta.userData?.removeImageInBundle === true;
    const outside = decorArts().filter((d) => !d.art.startsWith('image/decor/'));

    if (sameAtlas && outside.length === 0) {
        // 期望路径：装饰全在 decor 树 + 打包合进一张图集 ⇒ 分组只是重排 SpriteFrame 赋值。
        // 这条断言本身不做任何代码改动，它的作用是让"再提一次分组"的人先看到这里。
        assert.equal(sameAtlas, true);
        assert.equal(outside.length, 0);
        return;
    }
    // 前提变了（有人挪了图 / 关了打包合并）⇒ 分组可能有收益，提示重估。
    assert.fail(
        '前提已变：装饰不再全部同图集（'
        + `removeImageInBundle=${meta.userData?.removeImageInBundle}`
        + `, 树外装饰 ${outside.length} 项）`
        + ' ⇒ "按 art 分组"从"零收益"变成"可能有收益"，需重新评估。'
        + '注意分组会改画家算法顺序，实测会让 PVP4-1 / notch 画面变（像素差 70 / 650）。',
    );
});

test('城墙 4 张砖图同在 image/walls 图集 ⇒ 「按方向分组让同图砖连续」同样零收益', () => {
    // `WALL_TILE_EDGES` 按 edge 交替取 rightUp/up/rightDown/down，看着像"频繁换图断批"。
    // 但 4 张图全在 `image/walls/` 树内、且该树的 auto-atlas.pac 开了 removeImageInBundle
    // ⇒ 打包后合成同一张图集，换 spriteFrame **不断批**。
    // 墙砖是贴图**实例化**出来的独立 Sprite（`ZCGameWallLayer`），但只要纹理相同就能合批 ——
    // 旋转 / 镜像 / 缩放改的是矩阵，不改纹理。
    const WALL_ATLAS_META = 'assets/resources/image/walls/auto-atlas.pac.meta';
    assert.ok(existsSync(WALL_ATLAS_META), 'walls/auto-atlas.pac.meta 不存在，城墙图集没配');
    const meta = JSON.parse(readFileSync(WALL_ATLAS_META, 'utf8'));
    assert.equal(meta.importer, 'auto-atlas');
    assert.equal(
        meta.userData?.removeImageInBundle, true,
        'walls 图集没开 removeImageInBundle ⇒ 原图留在 bundle，"同图集"前提不成立，'
        + '此时「按方向分组」才可能真有收益，需要重新评估。',
    );
    // 4 张砖图必须都在 walls 树内（挪出去就变成独立纹理）。
    const dir = 'assets/resources/image/walls';
    for (const art of ['rightUp', 'up', 'rightDown', 'down']) {
        assert.ok(existsSync(`${dir}/${art}.png`), `${art}.png 不在 ${dir} 里了？`);
    }
});
