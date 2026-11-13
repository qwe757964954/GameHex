/**
 * 引导台词与立绘配置的判据。
 *
 * 台词表是从设计案「NPC与文案」页提取的 44 句 —— 这里用真表当夹具，
 * 表被改坏（丢句 / 组错 / 说话人写错）会直接红。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
    getGuidePortraitAsset,
    getGuidePortraitLoadPath,
    groupGuideDialogLines,
    parseGuideDialogLines,
} from '../assets/script/app/guide/model/GuideDialogConfig';

const RAW = JSON.parse(
    readFileSync('assets/remoteRef/guideDialog.json', 'utf8'),
) as { k: string[]; v: unknown[][] };

const LINES = parseGuideDialogLines(RAW.v.map((row) => {
    const out: Record<string, unknown> = {};
    RAW.k.forEach((key, index) => { out[key] = row[index]; });
    return out;
}));

test('真表：44 句全部解析成功，id 是数字且不重复', () => {
    assert.equal(LINES.length, 44);
    assert.equal(LINES.every((line) => typeof line.id === 'number' && Number.isSafeInteger(line.id)), true);
    const ids = new Set(LINES.map((line) => line.id));
    assert.equal(ids.size, 44);
    // id = 组序号 × 100 + 句序号 ⇒ 首句 101、末句 1603
    assert.equal(LINES[0].id, 101);
    assert.equal(LINES[LINES.length - 1].id, 1603);
});

test('真表：16 个台词组，组号是 D01~D16', () => {
    const groups = groupGuideDialogLines(LINES);
    assert.equal(groups.size, 16);
    const keys = [...groups.keys()].sort();
    assert.equal(keys[0], 'D01');
    assert.equal(keys[keys.length - 1], 'D16');
});

test('真表：每组 2~3 句，且组内按 order 升序、句尾字母连续', () => {
    const groups = groupGuideDialogLines(LINES);
    for (const [group, lines] of groups) {
        assert.ok(lines.length >= 2 && lines.length <= 3, `${group} 句数异常：${lines.length}`);
        const orders = lines.map((line) => line.order);
        assert.deepEqual(orders, [...orders].sort((a, b) => a - b), `${group} 组内未按 order 排序`);
        assert.equal(orders[0], 1, `${group} 首句 order 应为 1`);
    }
});

test('真表：说话人只有豌豆游侠与埃莉斯，且埃莉斯单句 ≤ 12 字（设计案口径③④）', () => {
    const speakers = new Set(LINES.map((line) => line.speaker));
    assert.deepEqual([...speakers].sort(), ['埃莉斯', '豌豆游侠'].sort());

    const tooLong = LINES
        .filter((line) => line.speaker === '埃莉斯' && line.content.length > 12)
        .map((line) => `${line.id}(${line.content.length}字)`);
    assert.deepEqual(tooLong, [], `埃莉斯有超 12 字的台词：${tooLong.join(' / ')}`);
});

test('真表：每句台词非空，且至少含一组中文标点或汉字', () => {
    const bad = LINES.filter((line) => line.content.trim().length === 0);
    assert.deepEqual(bad.map((line) => line.id), []);
});

test('立绘映射：埃莉斯是静图、豌豆游侠是骨骼，两者都登记', () => {
    assert.deepEqual(getGuidePortraitAsset('埃莉斯'), { kind: 'sprite', asset: 'image/guide/guide_elis' });
    // 豌豆游侠复用战场那份骨骼，不再需要另出立绘
    assert.deepEqual(getGuidePortraitAsset('豌豆游侠'), { kind: 'prefab', asset: 'skel/豌豆射手/豌豆射手' });
    assert.equal(getGuidePortraitAsset('不存在的角色'), null);
});

test('加载路径：静图带 /spriteFrame，骨骼用原路径', () => {
    assert.equal(getGuidePortraitLoadPath('埃莉斯'), 'image/guide/guide_elis/spriteFrame');
    assert.equal(getGuidePortraitLoadPath('豌豆游侠'), 'skel/豌豆射手/豌豆射手');
    assert.equal(getGuidePortraitLoadPath('不存在的角色'), null);
});

test('立绘资源真实存在（防止改了路径但资源没跟着搬）', () => {
    const elis = getGuidePortraitAsset('埃莉斯');
    assert.ok(elis);
    assert.equal(existsSync(`assets/bundles/main-pages/${elis.asset}.png`), true, '埃莉斯立绘缺失');

    const npc = getGuidePortraitAsset('豌豆游侠');
    assert.ok(npc);
    assert.equal(existsSync(`assets/resources/${npc.asset}.prefab`), true, '豌豆射手骨骼预制体缺失');
});

test('立绘来源：D01 组 2 句 = 骨骼(豌豆游侠) → 静图(埃莉斯)', () => {
    const groups = groupGuideDialogLines(LINES);
    const d01 = groups.get('D01');
    assert.ok(d01);
    assert.deepEqual(
        d01.map((line) => getGuidePortraitAsset(line.speaker)?.kind ?? null),
        ['prefab', 'sprite'],
    );
});

test('立绘来源：D16 组 3 句交替，末句回到骨骼', () => {
    const groups = groupGuideDialogLines(LINES);
    const d16 = groups.get('D16');
    assert.ok(d16);
    assert.deepEqual(
        d16.map((line) => getGuidePortraitAsset(line.speaker)?.kind ?? null),
        ['prefab', 'sprite', 'prefab'],
    );
});

test('全部 44 句都能找到立绘来源（不再有「无立绘」的角色）', () => {
    const missing = LINES
        .filter((line) => getGuidePortraitAsset(line.speaker) === null)
        .map((line) => line.id);
    assert.deepEqual(missing, []);
});
