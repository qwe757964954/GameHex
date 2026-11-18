/**
 * 引导台词与立绘配置的判据。
 *
 * 台词表是从设计案「NPC与文案」页提取的 24 句 —— 这里用真表当夹具，
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

test('真表：22 句全部解析成功，id 是数字且不重复', () => {
    // 第 22 条把 `D06`（战斗里那张抽到的卡）的三句并成一句 ⇒ 24 → 22。
    assert.equal(LINES.length, 22);
    assert.equal(LINES.every((line) => typeof line.id === 'number' && Number.isSafeInteger(line.id)), true);
    const ids = new Set(LINES.map((line) => line.id));
    assert.equal(ids.size, 22);
    // id = 组序号 × 100 + 句序号 ⇒ 首句 101、末句 1103（第 18 条把「点击关卡」两句拆成新的 `D05`，
    // 后面的组整体前移一位，于是末组从 `D10` 变成 `D11`）
    assert.equal(LINES[0].id, 101);
    assert.equal(LINES[LINES.length - 1].id, 1103);
});

test('D06 只剩一句：战斗里那张卡只活 1.156s，第二句根本来不及读（第 22 条）', () => {
    const groups = groupGuideDialogLines(LINES);
    const d06 = groups.get('D06') ?? [];
    assert.equal(d06.length, 1, 'D06 多于一句 ⇒ 抽卡动画结束时台词会被整组拆掉（第 20 条现场）');
    assert.equal(d06[0].id, 601);
    assert.equal(d06[0].speaker, '豌豆游侠');
    // 原 602「它自己上场了！」/ 603「没错，看它大显身手吧。」的意思并进这一句。
    assert.match(d06[0].content, /刚抽到的卡牌/);
    assert.match(d06[0].content, /自动战斗/);
    assert.match(d06[0].content, /大显身手/);
});

test('真表：11 个台词组，组号是 D01~D11 且中间不留空档', () => {
    const groups = groupGuideDialogLines(LINES);
    assert.equal(groups.size, 11);
    const keys = [...groups.keys()].sort();
    assert.equal(keys[0], 'D01');
    assert.equal(keys[keys.length - 1], 'D11');
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

test('立绘来源：末组 D11 3 句交替，末句回到骨骼', () => {
    const groups = groupGuideDialogLines(LINES);
    const last = groups.get('D11');
    assert.ok(last);
    assert.deepEqual(
        last.map((line) => getGuidePortraitAsset(line.speaker)?.kind ?? null),
        ['prefab', 'sprite', 'prefab'],
    );
});

test('全部 24 句都能找到立绘来源（不再有「无立绘」的角色）', () => {
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


test('第 18 条：「点击关卡 1-1」的两句挂在 5-1，不再抢在 4-1 翻地时先播', () => {
    const raw = JSON.parse(readFileSync('assets/remoteRef/guideStep.json', 'utf8')) as { k: string[]; v: unknown[][] };
    const stepColumn = raw.k.indexOf('stepId');
    const dialogColumn = raw.k.indexOf('dialogId');
    const dialogOf = new Map(raw.v.map((row) => [String(row[stepColumn]), String(row[dialogColumn] ?? '')]));
    // 4-1 是「翻第 3 块地」：只留「再多翻几块」。讲「去点关卡」的号令必须落在 5-1
    // （那一步的焦点才是 `Map/Level_10001`，光圈画在关卡地块上）。
    assert.equal(dialogOf.get('4-1'), 'D04');
    assert.equal(dialogOf.get('5-1'), 'D05');
    // 卡牌展示（5-3）顺势接下一组，不跟着 5-1 一起前移。
    assert.equal(dialogOf.get('5-3'), 'D06');

    const groups = groupGuideDialogLines(LINES);
    const d04 = groups.get('D04');
    const d05 = groups.get('D05');
    assert.ok(d04 && d05);
    assert.deepEqual(d04.map((line) => line.id), [401]);
    assert.deepEqual(d05.map((line) => line.id), [501, 502]);
    assert.match(d05[0].content, /点击「关卡」1-1/);
});
