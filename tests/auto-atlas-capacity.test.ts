/**
 * auto-atlas 容量账护栏（代码审查规范 §4「构建期才切图 / 糊图」）。
 *
 * 历史失效：给 `image/buildings/` 加图后没同步扩 `auto-atlas.pac.meta` 容量，
 * 本地零报错，构建期才切图 / 糊图（规则 403）。
 *
 * 判据口径 2026-11-05 实测校正：
 *  · 全库 56 个 auto-atlas 中 15 个目录像素总量超 1024² 且运行正常（Cocos 分多页），
 *    所以「总量 ≤ 单页容量」**不是**全库硬规则，只对要求单页的关键目录生效；
 *  · 全库硬规则是容量字段合法 + 单图不超尺寸，已知例外按**基线锁定**（新增或消失都要红）。
 *
 * 真源函数在 tools/verify/auto_atlas_capacity.mjs，本用例不在测试里另抄像素算法。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    atlasReport,
    listAtlases,
    readAtlasLimit,
} from '../tools/verify/auto_atlas_capacity.mjs';

const BUILDINGS = 'assets/resources/image/buildings/auto-atlas.pac.meta';

/** 2026-11-05 实测快照：maxWidth = 0，需人工确认是「不限制」还是配置缺陷。 */
const KNOWN_BAD_LIMIT = ['assets/resources/icons/common'];

/** 2026-11-05 实测快照：单图尺寸超出所在图集容量（大背景，非图集碎图）。
 * 2026-11-05 晚：`matching/bg_main`（720×1610）与 `bigmap/bigMapBG`（2048×2048）已移出图集覆盖范围
 * （前者进 `resources/image` 根，后者进 bigmap bundle 顶层），本基线回到空集 —— 再出现即新增，要红。 */
const KNOWN_OVERSIZED_SINGLE: string[] = [];

const dirOf = (metaPath: string) => metaPath.replace(/\/auto-atlas\.pac\.meta$/, '');

test('C1 全库 auto-atlas 容量字段合法：0 值例外只允许登记过的那一个', () => {
    const metas = listAtlases();
    assert.ok(metas.length >= 50, `auto-atlas 数量应 ≥50，实际 ${metas.length}（扫描根目录写错会掉到 0）`);
    const bad = metas
        .filter((metaPath) => {
            const { maxWidth, maxHeight } = readAtlasLimit(metaPath);
            return !Number.isInteger(maxWidth) || maxWidth <= 0
                || !Number.isInteger(maxHeight) || maxHeight <= 0;
        })
        .map(dirOf)
        .sort();
    assert.deepEqual(bad, KNOWN_BAD_LIMIT.slice().sort(),
        '容量字段为 0 / 缺失的目录集合变了：新增要修配置，消失要把基线例外一并删掉');
});

test('C2 image/buildings 容量账：加图后已扩容到 2048，且 1024 确实装不下', () => {
    const report = atlasReport(BUILDINGS);
    assert.equal(report.maxWidth, 2048, '规则 403：该目录必须扩到 2048');
    assert.equal(report.maxHeight, 2048);
    assert.ok(report.files > 0, '目录里一张图都没扫到 ⇒ 扫描路径失效，后面全是假绿');
    assert.ok(report.pixels > 1024 * 1024,
        `2.27M 像素的历史前提变了（实测 ${report.pixels}），1024² 若已够用请重新确认是否需要 2048`);
    assert.ok(report.pixels <= report.capacity,
        `像素总量 ${report.pixels} 超出单页容量 ${report.capacity}，加图后没扩容`);
    assert.equal(report.oversizedSingle, false);
    assert.equal(report.ok, true, report.reasons.join('；'));
});

test('C3 护栏有效性：把容量注入回 1024 必须立刻判不通过（不扩散容就红）', () => {
    const report = atlasReport(BUILDINGS, { maxWidth: 1024, maxHeight: 1024 });
    assert.equal(report.ok, false, '容量不足时报告必须不通过，否则整个护栏是摆设');
    assert.equal(report.overCapacity, true);
    assert.ok(report.pixels > report.capacity);
    assert.ok(report.reasons.some((reason) => reason.includes('单页容量')),
        `诊断信息要能直接指出原因，实际：${report.reasons.join('；')}`);
});

test('C4 单图超容量只允许登记过的目录（新增即红）', () => {
    const oversized = listAtlases()
        .map((metaPath) => atlasReport(metaPath))
        .filter((report) => report.limitValid && report.oversizedSingle)
        .map((report) => report.dir)
        .sort();
    assert.deepEqual(oversized, KNOWN_OVERSIZED_SINGLE.slice().sort(),
        '单图尺寸超容量的目录集合变了：新加的大图要么扩容、要么显式登记为已知例外');
});

test('C5 容量字段非法时也必须判不通过（0 值不能被当成「不限制」悄悄放过）', () => {
    const report = atlasReport(BUILDINGS, { maxWidth: 0 });
    assert.equal(report.limitValid, false);
    assert.equal(report.ok, false);
    assert.equal(report.capacity, 0);
    assert.ok(report.reasons.some((reason) => reason.includes('容量字段非法')));
});
