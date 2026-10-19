/**
 * 地块轮廓合并到共享 `cc.Graphics`（2026-10-08）的回归护栏。
 *
 * ## 这次改了什么
 *
 * 原来**每格一个 `cc.Graphics`**（`ZCHexView.outlineGraphics`，prefab 的 `TerritoryOutline` 上）。
 * `cc.Graphics` 走引擎 `commitModel`：既不合批**又是断批点**，所以一格一个的真实代价
 * 不是 1 DC 而是约**6 DC/格**（实测 200 格 = 1228 DC，baseline 22）。
 *
 * 现在合成整盘一个（`ZCGameBoard.prefab` 的 `OutlineLayer`，逻辑在 `ZCOutlineLayer`）。
 *
 * ## 这些用例在防什么
 *
 * 合并最容易出的不是「报错」，而是**静默画错 / 静默不画** —— 三类：
 * ① 少画边（mask 位解读变了）⇒ 归属色连成一片，看不出边界；
 * ② 位置错（忘了加格心偏移）⇒ 整盘轮廓堆在原点；
 * ③ 分桶把不同颜色合进同一 stroke ⇒ 颜色错。
 * 所以判据不是「有没有报错」，而是**逐条比对线段集合**。
 *
 * ## 2026-10-16 追加：中立格也要画线
 *
 * 中立格原来靠 `hex_flat` 底图（白色约 60%）铺满 —— 格子被提亮、格与格之间留约 1px 缝，
 * 整片中立区看上去就是一张暖棕网格。底图下线后这层网格随之消失（山猫：「中立没有棕色的线呢」），
 * 于是改用矢量补回：`appendHexOutlineSegments` 对 `neutral` 不再 `return`，
 * 改为按 mask 画**单一颜色的细格线**（`NEUTRAL_GRID_LINE_WIDTH` / `NEUTRAL_GRID_LINE_COLOR`）。
 * ⚠️ 它与 2026-10-12 被去掉的「灰色线」不是一回事：那次走 `INNER_GRID` 混色口径，
 * 中立格混出来是灰蓝；这次是「半透明深色叠在底图上」的暖棕。
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    configureZCMap,
    ZC_HEX_CONFIG,
    type ZCFaction,
    type ZCMapLayout,
} from '../assets/script/app/zcds/model/ZCGameModel';

/** 加载 `ZCOutlineLayer`；`ZCTheme` 走真源（颜色口径不许在测试里另抄一份）。 */
function loadOutline() {
    return loadViews().load('./ZCOutlineLayer');
}

/** 把一次 flush 产出的命令解析成「线段 + 线宽 + 颜色」的可比较集合。 */
interface Stroke {
    lineWidth: number;
    color: string;
    segments: Array<[number, number, number, number]>;
}

/**
 * 记录型 `Graphics`：在 `stroke()` **发生的瞬间**把 lineWidth / strokeColor 一起快照。
 *
 * ⚠️ 别改成"事后回放命令列表再读 `graphics.lineWidth`" ——
 * flush 跑完后这两个字段停在**最后一个桶**的值（`lineWidth` 最终是 2，不是首个桶的 6），
 * 于是每一笔都会被记成最后一笔的样式：表现为「所有笔颜色/线宽都一样」，
 * 而真实产物是对的。引擎是**逐 stroke 采样**的，桩必须照抄这个语义。
 */
class RecordingGraphics {
    static LineCap = { BUTT: 0, ROUND: 1, SQUARE: 2 };
    lineWidth = 1;
    lineCap = RecordingGraphics.LineCap.BUTT;
    strokeColor: any = null;
    readonly strokes: Stroke[] = [];
    private current: Stroke | null = null;
    private from: [number, number] | null = null;

    clear(): void {
        this.strokes.length = 0;
        this.current = null;
        this.from = null;
    }

    moveTo(x: number, y: number): void {
        // ⚠️ **不要**在这里结算上一笔：flush 的写法是「连续 moveTo/lineTo 若干段 → 最后 stroke() 一次」，
        // 每个 moveTo 只是**同一条路径里的新子路径**（分桶后同色的一批线段共用一笔）。
        // 若把 moveTo 当成"新一笔"，6 段同色线会被记成 6 笔 —— 真实的 subModel 只有 1 个。
        if (!this.current) {
            this.current = {
                lineWidth: this.lineWidth,
                color: colorKey(this.strokeColor),
                segments: [],
            };
        }
        this.from = [x, y];
    }

    lineTo(x: number, y: number): void {
        if (!this.from) this.moveTo(x, y);
        this.current!.segments.push([this.from![0], this.from![1], x, y]);
        this.from = [x, y];
    }

    stroke(): void {
        this.flushPending();
    }

    private flushPending(): void {
        if (this.current && this.current.segments.length > 0) this.strokes.push(this.current);
        this.current = null;
        this.from = null;
    }
}

function colorKey(color: { r: number; g: number; b: number; a: number } | null): string {
    return color ? `${color.r},${color.g},${color.b},${color.a}` : 'null';
}

/** 取记录的笔数（已自动过滤掉空路径）。 */
function strokesOf(graphics: RecordingGraphics): Stroke[] {
    return graphics.strokes;
}

/** 线段集合的无序规范化形式（按 x1,y1,x2,y2 排序，方向视为等价）。 */
function normalize(strokes: Stroke[]): string[] {
    const out: string[] = [];
    for (const stroke of strokes) {
        for (const [x1, y1, x2, y2] of stroke.segments) {
            const a = `${x1},${y1}`;
            const b = `${x2},${y2}`;
            const key = a < b ? `${a}->${b}` : `${b}->${a}`;
            out.push(`${stroke.lineWidth}|${stroke.color}|${key}`);
        }
    }
    return out.sort();
}

test('共享轮廓逐边还原：低 6 位画外边界、bit 8..13 画同阵营内部分隔', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();

    // 一个玩家格，mask 低 6 位 = 0b000010（只有第 1 条边是外边界），
    // 高 6 位（>>8）= 0b000100（第 2 条边是内部线）。
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 100, centerY: 200, owner: 'player', boundaryMask: 0b000010 | (0b000100 << 8) });
    outline.flushOutlineSegments(g);

    const strokes = strokesOf(g);
    // 玩家格 = 外轮廓（6px）+ 内部分隔（2px）两笔，颜色同源但 alpha 不同 ⇒ 两个桶。
    assert.equal(strokes.length, 2, `应恰好两笔（6px 外轮廓 / 2px 内部线），实际 ${strokes.length}`);

    const widths = strokes.map((s) => s.lineWidth).sort((a, b) => a - b);
    assert.deepEqual(widths, [2, 6]);

    const points = outline.ZC_OUTLINE_HEX_POINTS;
    const expectedEdge = (index: number, scale: number, cx: number, cy: number) => {
        const from = points[index];
        const to = points[(index + 1) % 6];
        return [cx + from[0] * scale, cy + from[1] * scale, cx + to[0] * scale, cy + to[1] * scale];
    };
    const outer = strokes.find((s) => s.lineWidth === 6)!;
    const inner = strokes.find((s) => s.lineWidth === 2)!;
    // ⚠️ 内缩系数从源码读（`outline.OWNED_OUTLINE_INSET_SCALE`），不硬编 ——
    // 它会被美术调（2026-10-12 就从 0.92 调到 0.98），硬编会让这条每次陪跑变红。
    const INSET = outline.OWNED_OUTLINE_INSET_SCALE;
    assert.deepEqual(outer.segments[0], expectedEdge(1, INSET, 100, 200), `外轮廓应内缩 ${INSET} 且带上格心`);
    assert.deepEqual(inner.segments[0], expectedEdge(2, INSET, 100, 200), '内部线与外轮廓同一内缩路径');
    assert.equal(inner.color, '135,138,231,255', '内部线采用不透明的柔和阵营色，交汇点不会叠色变深');
});

test('线段坐标已含格心偏移：flush 不再叠任何偏移（叠加会画到两倍位置）', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    outline.resetOutlineSegments();
    // 用 player 验证格心偏移（有主格走阵营色粗线，断言语义直观）。中立格 2026-10-16 起
    // 也画线、走的是同一条内缩路径，单独由下面的「中立格画暖棕格线」用例钉。
    outline.appendHexOutlineSegments({ centerX: 300, centerY: -400, owner: 'player', boundaryMask: 0b000001 });
    outline.flushOutlineSegments(g);

    const segments = strokesOf(g).flatMap((s) => s.segments);
    assert.equal(segments.length, 1);
    const points = outline.ZC_OUTLINE_HEX_POINTS;
    // 有主格按 `OWNED_OUTLINE_INSET_SCALE` 内缩（从源码读，不硬编）。
    const inset = outline.OWNED_OUTLINE_INSET_SCALE;
    assert.deepEqual(segments[0],
        [300 + points[0][0] * inset, -400 + points[0][1] * inset, 300 + points[1][0] * inset, -400 + points[1][1] * inset]);
    // 顶点是「格心 ± 半径」，所以至少有一端离格心一个半宽 —— 证明偏移真加上了。
    // ⚠️ 别写死 56：立体地块的顶面半宽是 61.5（2026-10-12 换 `img_land_01_gray`）。
    const halfWidth = Math.abs(points[0][0]) * inset;
    assert.ok(segments[0].includes(300 + halfWidth) || segments[0].includes(300 - halfWidth));
});

test('中立格画暖棕格线：只描 mask 里的边、用专门的格线色（2026-10-16 贴图下线后补回）', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 0, centerY: 0, owner: 'neutral', boundaryMask: 0b111111 });
    outline.flushOutlineSegments(g);

    // 六条边同色同宽 ⇒ 合成**一笔**（共享层的收益点：整片中立区只多 1 个 subModel）。
    const strokes = strokesOf(g);
    assert.equal(strokes.length, 1, '中立格应出 1 笔格线');
    assert.equal(strokes[0].lineWidth, outline.NEUTRAL_GRID_LINE_WIDTH);
    assert.equal(strokes[0].segments.length, 6, 'mask = 0b111111 ⇒ 六条边都描');
    const line = outline.NEUTRAL_GRID_LINE_COLOR;
    assert.equal(strokes[0].color, `${line.r},${line.g},${line.b},${line.a}`);
    // ⚠️ 别退回 2026-10-12 被否掉的那版：`zcFactionColor('neutral')` 混 160 灰 = **灰蓝**线，
    // 山猫当时的口径就是「灰色的线去掉」。现在要的是贴图缝隙那种暖棕。
    const neutral = loadViews().load('./ZCTheme').zcFactionColor('neutral');
    assert.notEqual(strokes[0].color, `${neutral.r},${neutral.g},${neutral.b},255`,
        '格线不能用阵营中立色 —— 那正是被去掉的灰蓝线');

    // 高 6 位（同阵营内部线）对中立格**不生效**：中立区没有"内部"可言，
    // 共享边全落在低 6 位（见 `buildTerritoryBoundaryMasks`）。
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({
        centerX: 0, centerY: 0, owner: 'neutral', boundaryMask: 0x3f | (0x3f << 8),
    });
    assert.equal(outline.outlineSegmentCount(), 6, '内部线位不该给中立格多描出边');
});

test('按颜色分桶：同色同宽合成一笔连续路径，异色绝不合并', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    outline.resetOutlineSegments();
    // 三个不同阵营 ⇒ 应分成 3 桶（player/enemy/enemy2 各一笔）。
    // ⚠️ 这组只放**阵营格**：中立格 2026-10-16 起有自己的格线色，混进来会多一个桶、
    // 盖住「3 个阵营 = 3 笔」这条判据。
    const cases: Array<['player' | 'enemy' | 'enemy2', number]> = [
        ['player', 0], ['enemy', 200], ['enemy2', 400],
    ];
    for (const [owner, x] of cases) {
        outline.appendHexOutlineSegments({ centerX: x, centerY: 0, owner, boundaryMask: 0b000001 });
    }
    outline.flushOutlineSegments(g);

    const strokes = strokesOf(g);
    assert.equal(outline.outlineSegmentCount(), 3);
    // ⚠️ 判据必须是「**每段用的是自己阵营的颜色**」，不能只判「颜色不重复」。
    // 分桶若忽略颜色（只按 lineWidth 归组），3 段会并成 1 笔（3 个阵营同粗细），
    // 颜色**仍然互不相同**（取桶首那条）—— 「颜色不重复」照样通过，但 enemy/enemy2 的线
    // 已经被涂成 player 的颜色。**这是合并共享 Graphics 最容易出的静默视觉错。**
    const theme = loadViews().load('./ZCTheme');
    // 按**线段中点 x**定位，不能用"包含某个坐标"—— 六边形的顶点 x 在相邻格之间会撞车。
    // 中点也从顶点表算，别手写常量：内缩系数一改，手写的数就悄悄对不上了。
    const points = outline.ZC_OUTLINE_HEX_POINTS;
    const byMidX = new Map<number, string>();
    for (const stroke of strokes) {
        for (const [x1, , x2] of stroke.segments) {
            byMidX.set(Math.round((x1 + x2) / 2), `${stroke.lineWidth}|${stroke.color}`);
        }
    }
    for (const [owner, x] of cases) {
        const midX = Math.round(x + (points[0][0] + points[1][0]) / 2 * outline.OWNED_OUTLINE_INSET_SCALE);
        const style = byMidX.get(midX);
        assert.ok(style, `${owner}（x=${x}，中点 ${midX}）那条线段不见了`);
        const expected = { ...theme.zcFactionColor(owner), a: 255 };
        assert.ok(
            style.includes(`${expected.r},${expected.g},${expected.b},${expected.a}`),
            `${owner} 的线段用了别人的颜色：${style}，应为 ${expected.r},${expected.g},${expected.b},${expected.a}`,
        );
    }
    assert.equal(strokes.length, 3, `应 3 笔（3 个阵营），实际 ${strokes.length}`);
});

test('选点阶段已选落点有内缩高亮且不会留到下一次绘制', () => {
    const outline = loadOutline();
    const graphics = new RecordingGraphics();
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 100, centerY: 200, owner: 'neutral', boundaryMask: 0b111111 });
    outline.appendSelectedHexOutlineSegments(100, 200);
    outline.flushOutlineSegments(graphics);

    const strokes = strokesOf(graphics);
    // ⚠️ 2026-10-16 起中立格自己也出 1 笔格线 ⇒ 这里是「格线 + 已选高亮」两笔。
    assert.equal(strokes.length, 2);
    const selected = strokes.find((stroke) => stroke.color === '255,235,150,255');
    assert.equal(selected?.lineWidth, 4);
    assert.equal(selected?.segments.length, 6);
    const [from, to] = outline.ZC_OUTLINE_HEX_POINTS;
    assert.deepEqual(selected?.segments[0], [
        100 + from[0] * 0.82, 200 + from[1] * 0.82,
        100 + to[0] * 0.82, 200 + to[1] * 0.82,
    ]);

    // 重画后高亮不许留到下一次：只剩中立格那 1 笔格线（笔数与颜色都要对上）。
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 100, centerY: 200, owner: 'neutral', boundaryMask: 0b111111 });
    outline.flushOutlineSegments(graphics);
    const line = outline.NEUTRAL_GRID_LINE_COLOR;
    assert.deepEqual(strokesOf(graphics).map((stroke) => stroke.color),
        [`${line.r},${line.g},${line.b},${line.a}`]);
});

test('选中没有边界 mask 的内部格也高亮；切换落点或进入对局才重画', () => {
    const { load, cc } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer: { scale: { x: 1 } } });
    const graphics = new cc.Graphics();
    world.outlineGraphics = graphics;
    const hexes = [
        { id: 7, x: 0, y: 0, playable: true },
        { id: 8, x: 3, y: 0, playable: true },
    ];
    const masks = new Map([[7, 0], [8, 0]]);
    const owner = (): ZCFaction => 'player';
    let clears = 0;
    const clear = graphics.clear.bind(graphics);
    graphics.clear = () => { clears += 1; clear(); };

    world.redrawSharedOutline(hexes, owner, masks, 'spawn', 7);
    assert.equal(graphics.commands.filter((command: { kind: string }) => command.kind === 'lineTo').length, 6);
    world.redrawSharedOutline(hexes, owner, masks, 'spawn', 7);
    assert.equal(clears, 1, '相同落点不应重复上传描线');

    world.redrawSharedOutline(hexes, owner, masks, 'spawn', 8);
    assert.equal(clears, 2, '仅落点变更也要重画');
    world.redrawSharedOutline(hexes, owner, masks);
    assert.equal(clears, 3, '正式对局必须清除选点高亮');
    assert.equal(graphics.commands.length, 0);
});

test('地图缩放变化会刷新共享轮廓，静止时不重复上传', () => {
    const { load, cc } = loadViews();
    const mapLayer = { scale: { x: 0.5 } };
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer });
    const graphics = new cc.Graphics();
    world.outlineGraphics = graphics;
    const hexes = [{ id: 7, x: 0, y: 0, playable: true }];
    const masks = new Map([[7, 0b111111]]);
    const owner = (): ZCFaction => 'neutral';
    let clears = 0;
    const clear = graphics.clear.bind(graphics);
    graphics.clear = () => { clears += 1; clear(); };

    world.redrawSharedOutline(hexes, owner, masks);
    world.redrawSharedOutline(hexes, owner, masks);
    assert.equal(clears, 1);
    mapLayer.scale.x = 1;
    world.redrawSharedOutline(hexes, owner, masks);
    assert.equal(clears, 2, '放大后线宽需恢复，不能沿用全图视角的描线缓存');
});

test('reset 之后残留清零：跨局/跨阶段复用缓冲不画上一局的线', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 0, centerY: 0, owner: 'player', boundaryMask: 0b111111 });
    assert.equal(outline.outlineSegmentCount(), 6);

    outline.resetOutlineSegments();
    assert.equal(outline.outlineSegmentCount(), 0, 'reset 没清干净');
    outline.flushOutlineSegments(g);
    assert.deepEqual(strokesOf(g), [], '清空后不该留任何 stroke');
});

/**
 * 结算收尾的**线条脉冲**（需求 2026-10-16：「回正动画结束再增加一个线条波动的脉冲效果，
 * 类似回正动画的」）在共享层上怎么落笔。
 *
 * 它和 `appendHexOutlineSegments` 的口径**故意不同**：不看 `boundaryMask`、六条边全描。
 * 理由（见 `appendHexPulseOutlineSegments` 的注释）：共享边只由 id 小的那格画，而波带按行走、
 * 与 id 大小无关 ⇒ 按 mask 描会让波带前沿变成一圈断断续续的边；而且内部分隔线是 2px 混色，
 * 显不出「整圈一起亮」。这里把这条口径钉死，免得有人"顺手统一成按 mask 描"。
 */
test('结算线条脉冲：六条边全描（与 mask 无关）、样式整笔一致、叠在领地轮廓之上', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    const style = { lineWidth: 7, color: { r: 201, g: 203, b: 255, a: 255 } };

    // ① mask 只给一条外边界 + 一条内部线 ⇒ 常规口径只会画 2 条；脉冲必须仍然画满 6 条。
    outline.resetOutlineSegments();
    outline.appendHexPulseOutlineSegments(0, 0, style);
    assert.equal(outline.outlineSegmentCount(), 6, '脉冲必须整圈六条边，不看 mask');

    // ② 六条边落成一笔（同色同宽）—— 这是它敢画在共享层上的前提。
    outline.flushOutlineSegments(g);
    const strokes = strokesOf(g);
    assert.equal(strokes.length, 1, `六条边应合成一笔，实际 ${strokes.length} 笔`);
    assert.equal(strokes[0].lineWidth, style.lineWidth, '线宽必须整笔一致');
    assert.equal(strokes[0].color, `${style.color.r},${style.color.g},${style.color.b},${style.color.a}`);
    assert.equal(strokes[0].segments.length, 6, '一笔里应有 6 条线段');

    // ③ 🔴 同一段共享边描两遍必须**仍是同一笔同一样式**：叠描幂等才不会出现"双线"。
    //    （相邻两格都在波带里时真的会发生：两格各画一次它们的共享边。）
    outline.resetOutlineSegments();
    outline.appendHexPulseOutlineSegments(0, 0, style);
    outline.appendHexPulseOutlineSegments(0, 0, style);
    outline.flushOutlineSegments(g);
    const doubled = strokesOf(g);
    assert.equal(doubled.length, 1, '重复描同一格也应只有一笔（同色同宽归同一个桶）');
    assert.equal(doubled[0].segments.length, 12, '线段数翻倍，但样式一致 ⇒ 叠出来还是同一条线');

    // ④ 不同档位是不同的亮度 ⇒ 必须分到不同桶，不能被并成一样（并了整条波带就是一个颜色）。
    outline.resetOutlineSegments();
    outline.appendHexPulseOutlineSegments(0, 0, style);
    outline.appendHexPulseOutlineSegments(0, 0, { lineWidth: 7, color: { r: 255, g: 255, b: 255, a: 255 } });
    outline.flushOutlineSegments(g);
    assert.equal(strokesOf(g).length, 2, '不同亮度的档位必须各占一笔');

    // ⑤ 与领地层**共用同一份顶点口径**（内缩比例一致），否则亮线会和轮廓错开一条缝。
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 0, centerY: 0, owner: 'player', boundaryMask: 0b111111 });
    outline.appendHexPulseOutlineSegments(0, 0, style);
    outline.flushOutlineSegments(g);
    const plain = normalize(strokesOf(g).filter((s) => s.lineWidth !== style.lineWidth));
    const pulse = normalize(strokesOf(g).filter((s) => s.lineWidth === style.lineWidth));
    assert.equal(plain.length, 6);
    assert.equal(pulse.length, 6);
    // 去掉线宽/颜色前缀后，两组的几何必须逐条相同。
    const geometry = (keys: string[]): string[] => keys.map((key) => key.split('|').slice(2).join('|'));
    assert.deepEqual(geometry(pulse), geometry(plain), '脉冲亮线与领地轮廓必须是同一组坐标');
});

test('空盘也要 clear：否则上一局的线会留在画布上（换图不重画就可见）', () => {
    const outline = loadOutline();
    const g = new RecordingGraphics();
    outline.resetOutlineSegments();
    outline.appendHexOutlineSegments({ centerX: 0, centerY: 0, owner: 'player', boundaryMask: 0b111111 });
    outline.flushOutlineSegments(g);
    assert.ok(strokesOf(g).length > 0);

    outline.resetOutlineSegments();
    outline.flushOutlineSegments(g);
    assert.deepEqual(strokesOf(g), [], '空盘必须把画布清干净');
});

test('逐张真图：所有可玩格的 mask 都能被共享层还原，笔数与格数无关', () => {
    const outline = loadOutline();
    const { load } = loadViews();
    const util = load('./ZCGameViewUtil');
    // 逐张**真图**跑。`configureZCMap` 会改写模块级 `ZC_HEX_CONFIG`，所以循环里每张都要重配。
    // 只测一张合成数据容易漏掉"某张图有四阵营 / 整盘中立"这类分桶边界。
    const maps = readdirSync('assets/resources/config/maps').filter((f) => f.endsWith('.json'));
    assert.ok(maps.length >= 8, `地图只有 ${maps.length} 张，覆盖面不够`);
    for (const file of maps) {
        configureZCMap(
            JSON.parse(readFileSync(`assets/resources/config/maps/${file}`, 'utf8')) as ZCMapLayout,
        );
        // ⚠️ `ZCHexConfig` 是**地图配置**，只有 playable/邻接/坐标，**没有 owner**
        //（owner 在快照的 `ZCHexState` 上）。这里要的是"这格归谁"来算 mask，
        // 而 map json 里 v1/v2 用 `#/.` `-` 记初始归属 —— 走 `ZC_HEX_CONFIG` 拿不到。
        // 🔴 整盘按 neutral 算只会得到 1 笔（2026-10-16 起中立格画单一暖棕格线）、测不到分桶。
        // 改为按**格 id 轮流给四个阵营**（player/enemy/enemy2/enemy3），
        // 让外边界位与内部线位都走到，同时验证分桶与 mask 还原。
        const owners: ZCFaction[] = ['player', 'enemy', 'enemy2', 'enemy3'];
        const ownerFor = (id: number): ZCFaction => owners[id % owners.length];
        const masks = util.buildTerritoryBoundaryMasks(ZC_HEX_CONFIG, (hex) => ownerFor(hex.id));

        const g = new RecordingGraphics();
        outline.resetOutlineSegments();
        let appended = 0;
        for (const hex of ZC_HEX_CONFIG) {
            if (!hex.playable) continue;
            outline.appendHexOutlineSegments({
                centerX: util.mapToViewX(hex.x), centerY: util.mapToViewY(hex.y),
                owner: ownerFor(hex.id), boundaryMask: masks.get(hex.id) ?? 0,
            });
            appended += 1;
        }
        assert.ok(appended > 0, `${file} 没有可玩格，夹具失效`);

        outline.flushOutlineSegments(g);
        const strokes = strokesOf(g);
        assert.ok(strokes.length > 0, `${file} 整盘一条线都没画出来`);
        // 笔数 = 颜色种数（4 个阵营），**与格数无关** —— 这正是本次优化的收益点。
        assert.ok(
            strokes.length <= 8,
            `${file}: 共享层 ${strokes.length} 笔 / ${appended} 格，笔数应远小于格数`,
        );
        const total = strokes.reduce((sum, s) => sum + s.segments.length, 0);
        assert.ok(total >= appended, `${file}: 线段 ${total} < 格数 ${appended}，有格没画`);
        // 归一化后每条唯一：同一段画两次就是叠线变深/变粗 —— 共享边必须只画一次。
        const keys = normalize(strokes);
        assert.equal(new Set(keys).size, keys.length, `${file}: 有线段被重复画出（共享边叠色）`);
    }
});
