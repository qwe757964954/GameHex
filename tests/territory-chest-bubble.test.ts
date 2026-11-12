import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    TERRITORY_CHEST_BUBBLE_FONT_SIZE,
    TERRITORY_CHEST_BUBBLE_FRAME_PATH,
    TERRITORY_CHEST_BUBBLE_HEIGHT,
    TERRITORY_CHEST_BUBBLE_ICON_SIZE,
    TERRITORY_CHEST_BUBBLE_ICON_Y,
    TERRITORY_CHEST_BUBBLE_TEXT_COLOR,
    TERRITORY_CHEST_BUBBLE_TEXT_Y,
    TERRITORY_CHEST_BUBBLE_WIDTH,
    territoryChestBubbleLayout,
} from '../assets/script/app/territory/model/TerritoryChestBubble';
import { decodePngRgba, readPngAlphaBox } from './helpers/png-alpha';

/**
 * 固定宝箱的**提示气泡**（需求 2026-11-02）：
 *
 * > 「宝箱的气泡框使用新的美术资源 `frame_04`，图标内 icon 和数字的排版参考 screenshot-2 的美术图」
 *
 * 两件事各自都有「不说就会静默做错」的坑：
 *
 *  ① **底图换了**：`frame_04` 是 77×87 的**竖向水滴**（章节那两颗是 94×45 横向胶囊），
 *    尺寸写错不会报错，只是气泡被拉扁 / 数字飘到尖外面；
 *  ② **内部排版换了**：参考图是「icon 在上、数字在下」，且底图是奶白 ⇒ 数字**不能再用白字**
 *    （白字等于没字）。以前那套「图标 + 数字并排」在 77 宽里根本放不下。
 *
 * 所以①回到 PNG 本身量，②钉常量关系 + 源码接线，别让"改了没人发现"重现。
 */

/** 底图在 bundle 里的真实位置（`image/spawn-region/...` 是**运行时**路径，磁盘上在 battle bundle 下）。 */
const FRAME_PNG = 'assets/bundles/battle/image/spawn-region/frame_04.png';

/** 站点视图 / 页面资源 / 地图视图的源码（接线守卫用）。 */
const stationViewSource = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
const mapViewSource = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
const pageAssetsSource = readFileSync('assets/script/app/territory/application/TerritoryPageAssets.ts', 'utf8');

/** 相对亮度（0~255），用来判「深字 / 浅底」。 */
function luminance(r: number, g: number, b: number): number {
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * 取 PNG 每一行的**不透明区间**（像素列，闭区间）。
 *
 * `readPngAlphaBox` 只给整张图的包围盒 —— 而水滴是上宽下尖，
 * 「某个 y 上还有多宽可用」只能逐行量，这正是排版是否溢出的判据。
 */
function opaqueRowSpans(): { width: number; height: number; spans: Array<[number, number] | null> } {
    const { width, height, pixels } = decodePngRgba(FRAME_PNG);
    const spans: Array<[number, number] | null> = [];
    for (let row = 0; row < height; row += 1) {
        let left = -1;
        let right = -1;
        for (let col = 0; col < width; col += 1) {
            if (pixels[(row * width + col) * 4 + 3] <= 40) continue;
            if (left < 0) left = col;
            right = col;
        }
        spans.push(left < 0 ? null : [left, right]);
    }
    return { width, height, spans };
}

// ---------------------------------------------------------------------------
// ① 底图：必须就是美术给的那张，尺寸与常量一致
// ---------------------------------------------------------------------------

test('★★★气泡底图就是美术给的 frame_04，且常量与 PNG 实际尺寸一致', () => {
    assert.equal(TERRITORY_CHEST_BUBBLE_FRAME_PATH, 'image/spawn-region/frame_04/spriteFrame',
        '运行时路径必须是 frame_04（与章节气泡同在 spawn-region 目录，但**不是**同一张图）');
    const box = readPngAlphaBox(FRAME_PNG);
    assert.equal(TERRITORY_CHEST_BUBBLE_WIDTH, box.width, '常量宽与 PNG 画布宽不一致 ⇒ 气泡会被拉伸');
    assert.equal(TERRITORY_CHEST_BUBBLE_HEIGHT, box.height, '常量高与 PNG 画布高不一致 ⇒ 水滴被压扁');
    // 与章节气泡（94×45 横向胶囊）形状不同，这正是必须单独一套排版的原因。
    assert.ok(TERRITORY_CHEST_BUBBLE_HEIGHT > TERRITORY_CHEST_BUBBLE_WIDTH,
        '水滴是**竖向**的（高 > 宽）；若这条挂了，说明拿错了图（章节那颗是横的）');
});

// ---------------------------------------------------------------------------
// ② 排版：icon 与数字都要落在水滴的不透明区域里
// ---------------------------------------------------------------------------

/** node 坐标（原点在正中、y 向上）→ PNG 行号（原点在左上）。 */
function rowOf(nodeY: number, height: number): number {
    return Math.round(height / 2 - nodeY);
}

test('★★★icon 与数字都完整落在水滴内（含最窄的尖端那几行）', () => {
    const { width, height, spans } = opaqueRowSpans();
    const layout = territoryChestBubbleLayout();
    const half = width / 2;

    /** 一个内容方框：中心 (0, centerY)，边长 size（数字按文本宽 × 字高）。 */
    const assertInside = (label: string, centerY: number, boxWidth: number, boxHeight: number): void => {
        const top = rowOf(centerY + boxHeight / 2, height);
        const bottom = rowOf(centerY - boxHeight / 2, height);
        for (let row = top; row <= bottom; row += 1) {
            const span = spans[row];
            assert.ok(span, `${label} 的第 ${row} 行落在气泡的透明区（已画到气泡外）`);
            const needLeft = Math.floor(half - boxWidth / 2);
            const needRight = Math.ceil(half + boxWidth / 2) - 1;
            assert.ok(span[0] <= needLeft && span[1] >= needRight,
                `${label} 在第 ${row} 行超出水滴轮廓：需要 ${needLeft}~${needRight}，实际只有 ${span[0]}~${span[1]}`);
        }
    };

    assertInside('icon', layout.iconY, layout.iconSize, layout.iconSize);
    // 数字：按两位数的最坏情况估宽（Arial 粗体 ≈ 0.6em/位），高度取字号；
    // 描边会**向外**扩 `2×宽度`（2026-11-02 起宝箱数字带描边补字重）⇒ 包围盒要计进去，
    // 否则「加了描边就顶到尖端」这种回归测不出来。
    const textWidth = Math.max(1, 2) * layout.fontSize * 0.6 + 2 * layout.outlineWidth;
    assertInside('数字', layout.textY, textWidth, layout.fontSize + 2 * layout.outlineWidth);
});

test('★★★icon 在上、数字在下，两者不重叠', () => {
    const layout = territoryChestBubbleLayout();
    assert.ok(layout.iconY > layout.textY, '参考图是「icon 在上、数字在下」，顺序写反了');
    const iconBottom = layout.iconY - layout.iconSize / 2;
    const textTop = layout.textY + (layout.fontSize + 2 * layout.outlineWidth) / 2;
    assert.ok(iconBottom > textTop,
        `icon 底边(${iconBottom}) 与数字顶边(${textTop}) 挨上/交叠了，参考图里两者有明显间距`);
});

test('★★★数字不能用白字：底图是奶白，白字等于没字', () => {
    const { width, height, pixels } = decodePngRgba(FRAME_PNG);
    // 取图中央一带（避开描边）的平均亮度当作底色。
    let sum = 0;
    let count = 0;
    for (let row = Math.round(height * 0.25); row < Math.round(height * 0.55); row += 1) {
        for (let col = Math.round(width * 0.25); col < Math.round(width * 0.75); col += 1) {
            const at = (row * width + col) * 4;
            if (pixels[at + 3] <= 200) continue;
            sum += luminance(pixels[at], pixels[at + 1], pixels[at + 2]);
            count += 1;
        }
    }
    assert.ok(count > 0, '量不到底图底色 ⇒ 取样区域选错了');
    const fill = sum / count;
    assert.ok(fill > 200, `底图底色应当是浅色（实测 ${fill.toFixed(1)}）`);
    const text = luminance(...TERRITORY_CHEST_BUBBLE_TEXT_COLOR);
    assert.ok(text < 110,
        `数字颜色亮度 ${text.toFixed(1)} 太亮，在 ${fill.toFixed(1)} 的奶白底上看不见（美术稿是深棕）`);
});

// ---------------------------------------------------------------------------
// ③ 接线：新底图 / 新排版必须真的被用上（写好了没人调 = 需求没做）
// ---------------------------------------------------------------------------

test('★★★页面加载了新底图，并把它交给了视图（art.chestBubbleFrame）', () => {
    assert.ok(pageAssetsSource.includes('TERRITORY_CHEST_BUBBLE_FRAME_PATH'),
        'TerritoryPageAssets 没按常量加载 frame_04');
    assert.ok(pageAssetsSource.includes('loadFrame(assets, TERRITORY_CHEST_BUBBLE_FRAME_PATH)'),
        '加载调用没落在 loadTerritoryBattleArt 的 Promise.all 里');
    assert.ok(/return \{[^}]*chestBubbleFrame/.test(pageAssetsSource),
        'TerritoryPageAssets 没把 chestBubbleFrame 交出去 ⇒ 视图永远拿不到新图');
});

test('★★★宝箱气泡取的是 chestBubbleFrame，取不到才回落到旧的蓝胶囊', () => {
    const at = mapViewSource.indexOf('levelBubble: showHintBubble ? String(site.unlock.staminaCost) : undefined');
    assert.ok(at > 0, '找不到宝箱气泡那一段');
    const block = mapViewSource.slice(at, at + 900);
    assert.ok(block.includes('input.art.chestBubbleFrame ?? input.art.levelBubbleFrame'),
        '宝箱气泡必须先用新底图 `chestBubbleFrame`，取不到才回落胶囊');
    assert.ok(!/levelBubbleFrame: showHintBubble \? input\.art\.levelBubbleFrame \?\? null/.test(mapViewSource),
        '还有分支在直接借关卡气泡的底图（宝箱不该长成横胶囊）');
});

test('★★★视图按「有没有 icon」切两套排版：水滴走上下两行', () => {
    assert.ok(stationViewSource.includes('territoryChestBubbleLayout()'),
        '视图没读 `model/TerritoryChestBubble` 的排版常量');
    // icon 与数字**各自**水平居中：x 恒为 0（并排那套是 ±total/2，已删）。
    assert.ok(stationViewSource.includes('icon.node.setPosition(0, chest.iconY, 0)'),
        'icon 没按常量放到上半区');
    assert.ok(stationViewSource.includes('this.badgeLabel.node.setPosition(0, chest.textY, 0)'),
        '数字没按常量放到下半区');
    // 水滴是整张成品图，没有九宫格切边 ⇒ 用 SIMPLE；胶囊仍用 SLICED 保圆角。
    assert.ok(stationViewSource.includes('const spriteType = chest ? Sprite.Type.SIMPLE : Sprite.Type.SLICED;'),
        '气泡底图类型要按排版切换（水滴 SIMPLE / 胶囊 SLICED）');
    // 反向：并排那套必须真的删干净，否则下次有人「顺手」把它改回来。
    assert.ok(!stationViewSource.includes('LEVEL_BUBBLE_ICON_GAP'),
        '并排布局的间距常量还在 ⇒ 两套排版同时存在，迟早用错');
    assert.ok(!stationViewSource.includes('readBubbleTextWidth'),
        '还在按文本实测宽并排 ⇒ 水滴里没有横向空间');
});

test('★★气泡尺寸按底图走：高度不能被写死成胶囊的 45', () => {
    // 定位到 applyLevelBubblePosition：它必须读节点实际高度，而不是常量 45。
    const at = stationViewSource.indexOf('private applyLevelBubblePosition(): void {');
    assert.ok(at > 0);
    // ⚠️ 按**函数体边界**切片，别用固定字符数：2026-11-11 预告气泡给这个函数加了一段
    //    锚点注释，旧的 `at + 900` 窗口被撑短 ⇒ 明明代码还在却报「尺寸没按底图刷新」。
    const body = stationViewSource.slice(at, stationViewSource.indexOf('\n    private ', at + 10));
    assert.ok(body.includes('bubbleHeight'),
        '气泡定位还在用固定高度 ⇒ 87 的水滴会扎进地块 / 整体飘高');
    assert.ok(!body.includes('mapMarkerBadgeY(..., MAP_MARKER_BUBBLE_HEIGHT)'),
        '定位仍写死胶囊高度');

    // 渲染入口：尺寸也是每帧对一遍（同一格可能从编号气泡变成宝箱提示）。
    const renderAt = stationViewSource.indexOf('private renderLevelBubble(');
    const renderBody = stationViewSource.slice(renderAt, stationViewSource.indexOf('\n    private ', renderAt + 10));
    assert.ok(renderBody.includes('nodeTransform.setContentSize(bubbleWidth, bubbleHeight)'),
        '气泡节点尺寸必须在渲染时按当前底图刷新');
    assert.ok(renderBody.includes('const chest = iconFrame ? territoryChestBubbleLayout() : null;'),
        '两套排版的判据必须是「有没有 icon」，别另起一套开关');
});

test('★★数字字号要装得进水滴：行高 ≥ 字号，且字号有明显权重', () => {
    const layout = territoryChestBubbleLayout();
    assert.ok(layout.lineHeight >= layout.fontSize, '行高小于字号会把字裁掉');
    assert.ok(layout.fontSize >= 18 && layout.fontSize <= 28,
        `字号 ${layout.fontSize} 不在合理区间（参考图里数字约占气泡高 20%）`);
    assert.ok(layout.iconSize > layout.fontSize,
        '参考图里 icon 明显比数字大；现在 icon 反而更小，排版读起来会怪');
    // 尺寸类字段必须是正数，否则 UITransform 会得到 0 → 什么都不显示。
    // （`textY` 故意为负 = 数字在水滴下半部分，不参与这条检查。）
    for (const key of ['width', 'height', 'iconSize', 'fontSize', 'lineHeight'] as const) {
        assert.ok(layout[key] > 0, `布局项 ${key} = ${layout[key]} 必须为正`);
    }
    assert.ok(layout.textY < 0, '数字必须在水滴中心**下方**（参考图）');
    assert.ok(layout.iconY > 0, 'icon 必须在水滴中心**上方**（参考图）');
});

// ---------------------------------------------------------------------------
// ④ 2026-11-02 第二轮：「体力 icon 放大 5%，字体样式匹配原来的大小和粗细」
// ---------------------------------------------------------------------------

test('★★★icon 比换图那版大 5%（34 × 1.05 = 35.7 → 36），占比仍在水滴的安全区间', () => {
    const layout = territoryChestBubbleLayout();
    // 5% 是用户口径，34 × 1.05 = 35.7；像素只能取整 ⇒ 进到 36（+5.9%，视觉上仍是「大一点点」）。
    const before = 34;
    const want = before * 1.05;
    assert.ok(layout.iconSize >= Math.floor(want) && layout.iconSize <= Math.ceil(want),
        `icon 边长 ${layout.iconSize} 不在「放大 5%（${want}）」的取整范围内`);
    assert.ok(layout.iconSize / layout.width > 0.44 && layout.iconSize / layout.width < 0.5,
        `icon 占气泡宽 ${(layout.iconSize / layout.width * 100).toFixed(1)}%，超出美术稿的 44%~50%`);
    // 放大了不能顶到水滴的圆顶：最上一行仍要留出 `iconSize` 宽的净空（几何判据已覆盖，这里再钉一次方向）。
    assert.ok(layout.iconY + layout.iconSize / 2 < layout.height / 2 - 8,
        'icon 顶部离水滴尖端太近（圆顶那一带只有 30~40 宽）');
});

test('★★★数字的字重靠「isBold + 同色系深描边」补：描边开关/宽度/颜色都得接线', () => {
    const layout = territoryChestBubbleLayout();
    // 描边是「补字重」的手段，不是装饰：0 就等于没做，太小（<1）在 0.5 倍渲染下会被吃掉。
    assert.ok(layout.outlineWidth >= 1 && layout.outlineWidth <= 3,
        `描边宽度 ${layout.outlineWidth} 不合理（美术稿笔画约占字高 25%，Arial 常规只有 12%）`);
    // 描边色必须比文字色**更深**（否则描边看起来像糊了一圈，而不是加粗）。
    const text = luminance(...layout.textColor);
    const outline = luminance(...layout.outlineColor);
    assert.ok(outline < text, `描边色亮度 ${outline.toFixed(1)} 不比文字色 ${text.toFixed(1)} 深，等于没加粗`);
    assert.ok(text > 40, '文字色别深到发黑（美术稿是深棕，纯黑在暖白底上太硬）');
});

test('★★★视图把描边真的写进了 Label（两套气泡共用同一个 Label，必须双向复位）', () => {
    const at = stationViewSource.indexOf('private themeLevelBubbleLabel(');
    assert.ok(at > 0, '找不到唯一的文字样式入口');
    const body = stationViewSource.slice(at, at + 2200);
    // 宝箱分支：开关 / 宽度 / 颜色三件都要来自 model，别在视图里另抄数字。
    assert.ok(body.includes('this.badgeLabel.enableOutline = chest.outlineWidth > 0'), '宝箱描边开关没接线');
    assert.ok(body.includes('this.badgeLabel.outlineWidth = chest.outlineWidth'), '宝箱描边宽度没接线');
    assert.ok(body.includes('chest.outlineColor[0], chest.outlineColor[1], chest.outlineColor[2]'),
        '宝箱描边颜色没接线');
    // ⚠️ 反向：`enableOutline = false` 是上一轮的字重做法，别再回来（回来就等于「不补字重」）。
    assert.ok(!/else \{[\s\S]*?this\.badgeLabel\.enableOutline = false/.test(body),
        '编号气泡分支必须是「开描边」；宝箱分支不许再整段关掉描边');
    // 同一个 Label 轮流服务两套气泡 ⇒ 描边色必须显式复位，否则切回编号气泡会带着棕色边。
    assert.ok(/this\.badgeLabel\.outlineColor = Color\.BLACK/.test(body),
        '编号气泡分支要把描边色复位成黑（否则会串上一轮的深棕）');
    assert.ok(body.indexOf('Color.BLACK') > body.indexOf('this.badgeLabel.color = Color.WHITE') - 200,
        '复位必须发生在编号气泡分支里');
});
