import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    configureZCMap,
    ZC_DEPTH_TENDENCY,
    ZC_MAP_REGIONS,
    ZC_TENDENCY_TEXT,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

const hexView = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
const renderWorld = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
const hexPrefab = JSON.parse(readFileSync('assets/resources/ui/game/ZCGameHex.prefab', 'utf8')) as any[];

test('自选主城地图不在正式战斗地块上显示金币等资源文字', () => {
  assert.match(hexView, /hideNeutralResourceLabel\?: boolean/);
  assert.match(hexView, /state\.neutralResourceId && !hideNeutralResourceLabel/);
  assert.match(renderWorld, /hideNeutralResourceLabel: model\.mapConfig\.cityMode === 'select'/);
});

/**
 * 选点阶段棋盘上那行小字 = **区域名标签**（`前区·速攻` 这种），画在 `map.regions` 的锚点格上，
 * 受「显示提示 / 收起提示」开关控制（默认开）。
 *
 * 2026-10-10 修的这一版：`select_river.json` 的 6 个 region 原本自带 `"text": "???"`，
 * 而 `ZCMapConfig` 的归一化是
 *   `text: typeof region.text === 'string' ? region.text : ZC_TENDENCY_TEXT[tendency]`
 * —— **只要 JSON 给了字符串就用它**，好好的兜底文案被顶掉，界面上就是一团「前区·???」。
 * 这条用例同时钉住两侧：地图数据不许再带占位 text，且归一化后的文案必须是兜底表里的正经词。
 */
test('★select_river 的区域文案由 tendency 推导，落盘的 "???" 占位必须清掉', () => {
    const layout = JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout;
    assert.ok(Array.isArray(layout.regions) && layout.regions.length > 0, 'select_river 必须圈了区域（选点阶段靠它出区域提示）');
    for (const region of layout.regions!) {
        assert.equal(region.text, undefined,
            `区域 ${region.section}/${region.depth} 不该自带 text（会顶掉 ZC_TENDENCY_TEXT 兜底）`);
    }

    configureZCMap(layout);
    assert.equal(ZC_MAP_REGIONS.length, layout.regions!.length, '归一化后区域数应与地图一致');
    for (const region of ZC_MAP_REGIONS) {
        const tendency = region.tendency ?? ZC_DEPTH_TENDENCY[region.depth];
        assert.equal(region.text, ZC_TENDENCY_TEXT[tendency],
            `区域 ${region.section}/${region.depth} 的文案应取 ZC_TENDENCY_TEXT[${tendency}]`);
        assert.doesNotMatch(String(region.text), /\?/, '区域文案里不许再有问号占位');
    }
});

/**
 * 「前区·速攻」共 5 个字，而 `IconLabel` 原本只有 45×22（为 `25` / `锁` / `已选` 这种 1~2 字设计的），
 * 配上 `overflow=CLAMP` + 自动换行 ⇒ 6 个字的区域名被折成两行再裁切，糊成一团（实测截图里就是那块糊字）。
 * 修法 = 加宽节点 + 关掉自动换行；这里把两件事都钉住，防止又被改回去。
 */
test('★区域名标签（IconLabel）要放得下最长的「前区·速攻」且不折行', () => {
    const index = hexPrefab.findIndex((o) => o?.__type__ === 'cc.Node' && o._name === 'IconLabel');
    assert.ok(index >= 0, 'ZCGameHex 里找不到 IconLabel 节点');
    const comps = (hexPrefab[index]._components as any[]).map((ref) => hexPrefab[ref.__id__]);
    const ui = comps.find((c) => c?.__type__ === 'cc.UITransform');
    const label = comps.find((c) => c?.__type__ === 'cc.Label');
    assert.ok(ui && label, 'IconLabel 上必须有 UITransform 与 Label');

    // 最长区域名 = 「前区」2 字 + 「·」1 字 + 倾向词（速攻 / 控场 / 发育，各 2 字）
    const longestTendency = Math.max(...Object.values(ZC_TENDENCY_TEXT).map((t) => t.length));
    const required = (2 + 1 + longestTendency) * label._fontSize;
    assert.ok(ui._contentSize.width >= required,
        `IconLabel 宽 ${ui._contentSize.width} 放不下最长的区域名（需要 ${required}）—— 会被折行 + 裁切`);
    assert.equal(label._enableWrapText, false,
        'IconLabel 必须关掉自动换行：放不下时宁可裁一刀，也不能折成两行糊在一起（CLAMP 是裁切语义）');
    assert.equal(label._overflow, 1, 'IconLabel 保持 CLAMP(1)，别改成 NONE —— NONE 会把文本实测尺寸写回 UITransform');
});
