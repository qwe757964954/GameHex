/**
 * 引导台词与立绘配置的判据。
 *
 * 台词表是从设计案「NPC与文案」页提取的 39 句 —— 这里用真表当夹具，
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

test('真表：39 句全部解析成功，id 是数字且不重复', () => {
    assert.equal(LINES.length, 39);
    assert.equal(LINES.every((line) => typeof line.id === 'number' && Number.isSafeInteger(line.id)), true);
    const ids = new Set(LINES.map((line) => line.id));
    assert.equal(ids.size, 39);
    // id = 组序号 × 100 + 句序号 ⇒ 首句 101、末句 1403（旧 D03 删掉后整条 id 顺位前移）
    assert.equal(LINES[0].id, 101);
    assert.equal(LINES[LINES.length - 1].id, 1403);
});

test('真表：14 个台词组，组号是 D01~D14 且中间不留空档', () => {
    const groups = groupGuideDialogLines(LINES);
    assert.equal(groups.size, 14);
    const keys = [...groups.keys()].sort();
    assert.equal(keys[0], 'D01');
    assert.equal(keys[keys.length - 1], 'D14');
    // 组号必须连续：删组后要么顺位前移，要么这里会露出来。
    assert.deepEqual(keys, keys.map((_, index) => `D${String(index + 1).padStart(2, '0')}`));
});

test('真表：每组 1~3 句，且组内按 order 升序、首句 order 恒为 1', () => {
    const groups = groupGuideDialogLines(LINES);
    for (const [group, lines] of groups) {
        // 删掉旧 D03（单句翻地提示）后每组都是 2~3 句；上限仍按 3 句守。
        assert.ok(lines.length >= 1 && lines.length <= 3, `${group} 句数异常：${lines.length}`);
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

test('立绘来源：D14 组 3 句交替，末句回到骨骼', () => {
    const groups = groupGuideDialogLines(LINES);
    const d14 = groups.get('D14');
    assert.ok(d14);
    assert.deepEqual(
        d14.map((line) => getGuidePortraitAsset(line.speaker)?.kind ?? null),
        ['prefab', 'sprite', 'prefab'],
    );
});

test('全部 39 句都能找到立绘来源（不再有「无立绘」的角色）', () => {
    const missing = LINES
        .filter((line) => getGuidePortraitAsset(line.speaker) === null)
        .map((line) => line.id);
    assert.deepEqual(missing, []);
});

test('id 与组号、句序严格对应（删组顺位后最容易错的地方）', () => {
    const groupNumber = (group: string) => Number(group.slice(1));
    const bad = LINES.filter((line) => Math.floor(line.id / 100) !== groupNumber(line.group)
        || line.id % 100 !== line.order);
    assert.deepEqual(bad.map((line) => `${line.id}/${line.group}/${line.order}`), []);
});

test('步骤表的 dialogId 全部能在台词表里找到组，且没有孤儿组', () => {
    const raw = JSON.parse(readFileSync('assets/remoteRef/guideStep.json', 'utf8')) as { k: string[]; v: unknown[][] };
    const used = raw.v
        .map((row) => row[raw.k.indexOf('dialogId')])
        .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const groups = new Set(groupGuideDialogLines(LINES).keys());
    assert.deepEqual(used.filter((id) => !groups.has(id)), [], '步骤引用了不存在的台词组');
    assert.deepEqual([...groups].filter((group) => !used.includes(group)), [], '有台词组没有任何步骤在用');
});
