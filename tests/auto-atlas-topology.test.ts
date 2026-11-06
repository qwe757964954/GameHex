/**
 * auto-atlas 拓扑护栏（`docs/AI架构与代码规范.md` §7.3.2）。
 *
 * 规范原文：「每棵碎图目录树的最外层一级分类目录必须放置且仅放置一份 `auto-atlas.pac`；
 * 递归覆盖子目录；严禁父子同放；严禁在 `image/` 根放 pac；**漏配 pac 引擎不会报任何错误或警告**」。
 *
 * 既有 `auto-atlas-capacity.test.ts` 只查容量账（会不会糊图 / 切页），
 * **不查「有没有图集」**。于是新增一个碎图目录却忘了放 pac 时，构建照过、运行照跑，
 * 只是那批图永远不进图集（drawcall 与包体白涨），且没有任何信号。
 *
 * 这里补的就是那半条：谁在图集覆盖之外、谁又父子同放。
 * 判定按 `*.pac.meta` 的 `importer === 'auto-atlas'` 认图集，不按文件名 ——
 * 战斗弹道目录用的是 `<图集名>.pac`，按 `auto-atlas.pac` 字面量扫会整批漏掉。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const ASSETS = 'assets';

const toPosix = (path: string) => path.replace(/\\/g, '/');

/** 递归列目录（只返回目录）。 */
function listDirs(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const abs = join(dir, entry.name);
        out.push(toPosix(abs));
        listDirs(abs, out);
    }
    return out;
}

const dirs = listDirs(ASSETS);
const filesOf = new Map<string, string[]>();
const atlasDirs = new Set<string>();
const pngDirs: string[] = [];

for (const dir of dirs) {
    const files = readdirSync(dir);
    filesOf.set(dir, files);
    for (const name of files) {
        if (!name.endsWith('.pac.meta')) continue;
        try {
            const meta = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { importer?: string };
            if (meta.importer === 'auto-atlas') atlasDirs.add(dir);
        } catch {
            // 坏 meta 不在这里判，容量护栏会先红。
        }
    }
    if (files.some((name) => name.endsWith('.png'))) pngDirs.push(dir);
}

/** 自身或任一祖先目录有图集即视为已覆盖（pac 递归生效）。 */
function covered(dir: string): boolean {
    let cursor = dir;
    while (cursor && cursor !== ASSETS) {
        if (atlasDirs.has(cursor)) return true;
        const cut = cursor.lastIndexOf('/');
        if (cut < 0) break;
        cursor = cursor.slice(0, cut);
    }
    return false;
}

test('T1 每个散图目录树都在某份 auto-atlas 覆盖内（白名单只有 Spine 与 image 根）', () => {
    const uncovered = pngDirs.filter((dir) => !covered(dir));
    // Spine 单位是三件套（`.png` + `.skel` + `.atlas.txt`），图必须独立采样，不能进图集。
    // `assets/resources/image` 与 `assets/bundles/bigmap` 的根目录是**刻意的大图区**：
    // 超出图集页的背景图放这里（根目录按规范禁止放 pac，天然不进图集）。
    const violations = uncovered.filter(
        (dir) => !dir.startsWith('assets/resources/skel/')
            && dir !== 'assets/resources/image'
            && dir !== 'assets/bundles/bigmap',
    );
    assert.deepEqual(violations, [], '这些碎图目录没有任何 auto-atlas 覆盖：漏配 pac 引擎零报错，构建期也不会提醒');

    assert.equal(
        uncovered.filter((dir) => dir === 'assets/resources/image').length,
        1,
        'image 根目录不应成为散图落点',
    );
    const imageRootPngs = (filesOf.get('assets/resources/image') ?? []).filter((name) => name.endsWith('.png'));
    // 根目录**不允许**放 pac（规范 §7.3.2 第 2 条严禁），所以这里天然是「不进图集」区：
    // 尺寸超过图集页的大背景就往这儿放（`bg_main` 720×1610 就是为此从 `image/matching/` 挪来的）。
    // `pkzr_bg_01/02` 是历史遗留散图，当前无任何引用。
    assert.equal(imageRootPngs.length, 3,
        'image 根下只应放大图（不进图集）与历史散图；普通碎图要归进子目录分类');
});

test('T2 严禁父子目录同时放 pac（子目录贴图会被重复打包）', () => {
    const nested = [...atlasDirs].filter((dir) => {
        let cursor = dir;
        while (true) {
            const cut = cursor.lastIndexOf('/');
            if (cut < 0) return false;
            cursor = cursor.slice(0, cut);
            if (cursor === ASSETS || cursor.length < ASSETS.length) return false;
            if (atlasDirs.has(cursor)) return true;
        }
    });
    assert.deepEqual(nested.sort(), [], '父子同放 pac 会让同一批图重复进两张图集');
});

test('T3 根级图集只有 bigmap 这一处已登记例外', () => {
    const rootLevel = [...atlasDirs]
        .filter((dir) => dir.endsWith('/image') || dir.endsWith('/icons'))
        .sort();
    assert.deepEqual(rootLevel, ['assets/bundles/bigmap/image'],
        '规范禁止在 image/ 根放 pac；bigmap 的 bundle 根即分类层，是文档登记过的唯一例外（docs/bigmap-效果图资源接入.md）');
});
