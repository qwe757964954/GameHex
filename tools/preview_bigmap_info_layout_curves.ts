/**
 * 世界页详情弹窗「居中竖排」的排版采样（离线验收用，与 `tools/preview_bigmap_info_layout.py` 配对）。
 *
 * 真源 = `model/BigMapInfoLayout`：这里把几种典型内容算成 JSON，Python 只负责贴图，
 * 不重算公式 —— 图里的位置就是运行时写进节点的位置。
 * 图标的自然高度从**真美术**读（`tests/helpers/png-alpha`），不手写一个近似值。
 *
 *   npx tsx tools/preview_bigmap_info_layout_curves.ts
 *
 * 产物：`docs/.tmp-bigmap-info-layout.json`
 */
import { writeFileSync } from 'node:fs';
import { bigMapInfoLayout } from '../assets/script/app/bigmap/model/BigMapInfoLayout';
import { readPngAlphaBox } from '../tests/helpers/png-alpha';

/** 720×1280 设计稿：卡片 = `clamp` 之后的 560×400（见 `BigMapPage.buildInfoPanel`）。 */
const PANEL_WIDTH = 560;
const PANEL_HEIGHT = 400;
/** 详情图标请求的显示宽度（`refreshInfoContent` 里 city / monster 用 112，建筑用 110）。 */
const ICON_REQUEST_WIDTH = 112;
const CITY_ICON_PNG = 'assets/resources/image/bigmap/concept/sprites/fortress.png';

/** 按「请求宽度」铺开后的可见高度 —— 与 `applyInfoLayout` 里那行算法逐字一致。 */
function naturalIconHeight(file: string, width: number): number {
    const box = readPngAlphaBox(file);
    const rectWidth = box.right - box.left;
    const rectHeight = box.top - box.bottom;
    return rectHeight * (width / Math.max(1, rectWidth));
}

const iconHeight = naturalIconHeight(CITY_ICON_PNG, ICON_REQUEST_WIDTH);

const siteLines = ['协同集结中', '集战', '战境玩法本图不开战'];
const cityLines = [
    '状态：可攻打',
    '日程：集结期 · 可攻打',
    '距离：3 格',
    '城防：82%   本轮战功：0/500',
    '名次：第 7 名   同场 12 人',
    '消耗行动力：6',
    '预计伤害 1280 · 战功 +40',
    '',
    '这座要塞扼守着东侧走廊，攻下后可以直取王庭。',
];

const scenes = [
    {
        key: 'before',
        title: '军团壁垒（Lv.2）',
        lines: siteLines,
        // 改前：左图标 + 右文字栏。按老代码公式重算（截图里就是这三处错位）。
        legacy: {
            iconX: -PANEL_WIDTH / 2 + 78,
            iconY: 44,
            iconWidth: 112,
            titleX: (PANEL_WIDTH / 2 - 24) - (PANEL_WIDTH - 220) / 2,
            bodyX: 0,
            bodyY: -14,
            bodyWidth: PANEL_WIDTH - 56,
            bodyHeight: PANEL_HEIGHT - 170,
            actionY: -PANEL_HEIGHT / 2 + 46,
            secondaryX: -76,
            primaryX: 76,
            showPrimary: false,
        },
    },
    {
        key: 'after-site',
        title: '军团壁垒（Lv.2）',
        lines: siteLines,
        lineHeight: 19,
        hasPrimary: false,
        hasSecondary: true,
    },
    {
        key: 'after-city',
        title: '灰烬要塞（Lv.3）',
        lines: cityLines,
        lineHeight: 19,
        hasPrimary: true,
        hasSecondary: true,
    },
];

const payload = scenes.map((scene) => {
    if (scene.legacy) return { ...scene, layout: null };
    const layout = bigMapInfoLayout({
        panelWidth: PANEL_WIDTH,
        panelHeight: PANEL_HEIGHT,
        lines: scene.lines.length,
        lineHeight: scene.lineHeight,
        hasPrimary: scene.hasPrimary,
        hasSecondary: scene.hasSecondary,
        iconHeight,
    });
    return { ...scene, layout };
});

writeFileSync(
    'docs/.tmp-bigmap-info-layout.json',
    JSON.stringify({
        panelWidth: PANEL_WIDTH,
        panelHeight: PANEL_HEIGHT,
        iconRequestWidth: ICON_REQUEST_WIDTH,
        iconNaturalHeight: iconHeight,
        cityIconPng: CITY_ICON_PNG,
        scenes: payload,
    }, null, 2),
    'utf8',
);
console.log('ok', payload.map((s) => `${s.key}:icon=${s.layout ? s.layout.iconSize.toFixed(1) : '-'}`).join(' '));
