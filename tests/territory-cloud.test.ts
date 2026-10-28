import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as gridLayout from '../assets/script/core/hex/HexGridLayout';
import * as cloud from '../assets/script/app/territory/model/TerritoryCloud';
import * as layout from '../assets/script/app/territory/model/TerritoryMapLayout';
import {
    TERRITORY_CLOUD_ART_HEIGHT,
    TERRITORY_CLOUD_ART_OFFSET_Y,
    TERRITORY_CLOUD_ART_WIDTH,
    TERRITORY_CLOUD_BODY_HEIGHT,
    TERRITORY_CLOUD_BODY_WIDTH,
    TERRITORY_CLOUD_DISSOLVE_BURST_SCALE,
    TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE,
    TERRITORY_CLOUD_DISSOLVE_FRAGMENT,
    TERRITORY_CLOUD_DISSOLVE_HOLD,
    TERRITORY_CLOUD_DISSOLVE_INTACT,
    TERRITORY_CLOUD_DISSOLVE_LIFT_PX,
    TERRITORY_CLOUD_DISSOLVE_PUNCH,
    TERRITORY_CLOUD_DISSOLVE_SECONDS,
    TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE,
    TERRITORY_CLOUD_DISSOLVE_SHADOW_SCALE,
    TERRITORY_CLOUD_DOLLY_FADE_SECONDS,
    TERRITORY_CLOUD_DOLLY_FIT_MARGIN,
    TERRITORY_CLOUD_DOLLY_IN_SECONDS,
    TERRITORY_CLOUD_DOLLY_OUT_SECONDS,
    TERRITORY_CLOUD_FILL_FADE_SECONDS,
    TERRITORY_CLOUD_FILL_WAVE_SPREAD,
    TERRITORY_CLOUD_FILL_WAVE_STAGGER,
    TERRITORY_CLOUD_FULL_HEIGHT,
    TERRITORY_CLOUD_KEEP_OUT_PX,
    TERRITORY_CLOUD_POCKET_MAX_CELLS,
    TERRITORY_CLOUD_POCKET_SCALE,
    TERRITORY_CLOUD_SCALE,
    territoryCloudArtOffsetY,
    territoryCloudDissolveFrame,
    territoryCloudDollyFadeDue,
    territoryCloudDollyFitScale,
    territoryCloudDollyTotalSeconds,
    territoryCloudDollyZoom,
    territoryCloudFillOpacity,
    territoryCloudFillPoints,
    territoryCloudFillWaveOpacity,
    territoryCloudFillWaveOrder,
    territoryCloudFillWaveWindow,
    territoryCloudKeepOutPoints,
    territoryCloudPocketCells,
    territoryTileOutlinePoints,
} from '../assets/script/app/territory/model/TerritoryCloud';

/**
 * 「章节地图未解锁云」判据（2026-10-23 第四版口径）
 * ------------------------------------------------------------------
 *   ① 云与地块留**固定 15px** 间隔、不遮挡地块 ⇒ 挡云遮罩 = 已解锁格面外扩 15px（反向 Mask）；
 *   ② 序列帧**只在消散时**用，未解锁是**静止图**（`cloud_body_0`，不轮播）；
 *   ③ 云体与影子是**两张同画布图**（`cloud_body_N` / `cloud_shadow_N`，美术层离线拆的），
 *      **所有影子画在所有云体之下** —— 而且是**一个全局影子层**（`CloudKeepOut` 的第 0 个孩子，
 *      里面再分"铺满"与"真实云层"两个子分组）；每层各带一个影子分组是不够的，
 *      云层影子会画到铺满层云体上（2026-10-26 灰云带）；
 *   ④ 云洞**不裁剪**：每格一朵、缩到 `TERRITORY_CLOUD_POCKET_SCALE`；
 *   ⑤ 铺满整块内容层，**全地图解锁后整层关掉**。
 * 外加视图接线守卫（层序、消散层自带的"排除自己"遮罩、换章复位、无帧降级）。
 *
 * ⚠️ 第四版**删掉**了「运行时按行切 SpriteFrame」那套（`TERRITORY_CLOUD_*_BAND` /
 * `territoryCloudBandRect` / 视图 `sliceFrame`）：`SpriteFrame.rect` 是自上而下的，按
 * "原点在左下"推 y 会把体 / 影两刀整体互换，实机表现为**影子压在云体上、整片云发灰**。
 * 文末的反向守卫就是为了不让它回来。
 */

const read = (path: string): string => readFileSync(path, 'utf8');
const stripComments = (source: string): string => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

// ============================================================
// ① 挡云区：格面外扩 15px
// ============================================================

/** 格面六边形原始顶点（与模型同一个口径，这里独立重算一遍当对照）。 */
function faceOutline(): { x: number; y: number }[] {
    const hw = gridLayout.HEX_GRID_FACE_WIDTH / 2;
    const hh = gridLayout.HEX_GRID_FACE_HEIGHT / 2;
    const qw = gridLayout.HEX_GRID_FACE_WIDTH / 4;
    return [
        { x: hw, y: 0 },
        { x: qw, y: hh },
        { x: -qw, y: hh },
        { x: -hw, y: 0 },
        { x: -qw, y: -hh },
        { x: qw, y: -hh },
    ];
}

const EPSILON = 1e-9;

test('挡云多边形：6 个点、逆时针、每条边**精确外移 15px**（基准是「格面 + 侧壁」，不是格面）', () => {
    const inset = TERRITORY_CLOUD_KEEP_OUT_PX;
    assert.equal(inset, 15, '用户口径是固定 15px');
    const face = faceOutline();
    const outline = territoryTileOutlinePoints();
    const points = territoryCloudKeepOutPoints();
    assert.equal(points.length, outline.length, '六边形就要 6 个点');

    // 🔴 2026-10-26 七版：基准是**地块可见轮廓**（格面 + 下方 26px 侧壁）。
    //    只按格面外扩时，遮罩底边比图底还高 11px ⇒ 云压在侧壁上，读成"底部 0 间隙"
    //    （用户：「底部的云层也要和地块有 15px 的间隙」）。
    assert.equal(gridLayout.HEX_GRID_TILE_SIDE_HEIGHT, 26,
        '侧壁高度是美术实测（126×117，草地/泥土面 y=0…91）');
    const hh = gridLayout.HEX_GRID_FACE_HEIGHT / 2;
    const bottomY = -hh - gridLayout.HEX_GRID_TILE_SIDE_HEIGHT;
    // 上面两个顶点不动、下面两个顶点整体下移一段侧壁 —— 网格底部才不会被"当成薄纸"。
    assert.equal(outline[1].y, hh, '上边顶点不下移');
    assert.equal(outline[2].y, hh, '上边顶点不下移');
    assert.ok(Math.abs(outline[4].y - bottomY) < 1e-9, '左下顶点要下移一段侧壁');
    assert.ok(Math.abs(outline[5].y - bottomY) < 1e-9, '右下顶点要下移一段侧壁');
    assert.ok(Math.abs(outline[4].x - face[4].x) < 1e-9 && Math.abs(outline[5].x - face[5].x) < 1e-9,
        '侧壁是**竖直**下移（x 不变），不是把多边形等比拉高');

    // 底边必须比"格面底边外扩 15px"再低一段侧壁 —— 这才是用户要的那 15px 间隙。
    const bottomEdge = Math.min(...points.map((point) => point.y));
    assert.ok(Math.abs(bottomEdge - (bottomY - inset)) < 1e-6,
        `遮罩底边应在 ${bottomY - inset}，实际 ${bottomEdge}（少了侧壁就只剩 ${-hh - inset}）`);
    assert.ok(bottomEdge < -hh - inset, '底边必须比"只按格面算"更低，否则云又会压到侧壁上');

    // 每条边外移 inset ⇒ 用它自己的单位外法线量，两个端点到原边的距离都必须是 15。
    // ⚠️ 这条正是"按顶点等比放大"会挂的地方：那种做法在斜边上只有 ~7.5px。
    for (let index = 0; index < outline.length; index += 1) {
        const a = outline[index];
        const b = outline[(index + 1) % outline.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        const nx = dy / length;
        const ny = -dx / length;
        for (const vertex of [points[index], points[(index + 1) % points.length]]) {
            const distance = (vertex.x - a.x) * nx + (vertex.y - a.y) * ny;
            assert.ok(Math.abs(distance - inset) < 1e-6,
                `第 ${index} 条边的端点离原边 ${distance}，不是 ${inset}`);
        }
    }
    // 方向对：外扩后的多边形一定把地块轮廓整个包住（面积更大）。
    const area = (list: readonly { x: number; y: number }[]): number => {
        let sum = 0;
        for (let index = 0; index < list.length; index += 1) {
            const p = list[index];
            const q = list[(index + 1) % list.length];
            sum += p.x * q.y - q.x * p.y;
        }
        return sum / 2;
    };
    assert.ok(area(points) > area(outline), '外扩多边形的面积必须更大（方向反了就成缩小）');
    assert.ok(area(outline) > area(face), '地块轮廓必须比格面大（下面那圈侧壁）');
});

test('挡云多边形：inset = 0 就是地块轮廓本身；脏参数不产出 NaN', () => {
    const zero = territoryCloudKeepOutPoints(0);
    // 基准是「格面 + 侧壁」，不是格面 —— 见上面那条用例。
    const outline = territoryTileOutlinePoints();
    for (let index = 0; index < outline.length; index += 1) {
        assert.ok(Math.abs(zero[index].x - outline[index].x) < EPSILON, `inset=0 第 ${index} 点 x 应与地块轮廓重合`);
        assert.ok(Math.abs(zero[index].y - outline[index].y) < EPSILON, `inset=0 第 ${index} 点 y 应与地块轮廓重合`);
    }
    // 脏参数分两条规矩，别混着断：
    //   ① 负数 ⇒ 按 0 处理（= 贴地块轮廓），不是"退回 15"；
    //   ② NaN / ±Infinity / 非数字 ⇒ 退回默认 15。
    // 共同点：绝不产出 NaN 坐标（NaN 会让整块遮罩静默消失，连报错都没有）。
    for (const dirty of [-5, -1e9]) {
        const points = territoryCloudKeepOutPoints(dirty);
        for (let index = 0; index < outline.length; index += 1) {
            assert.ok(Math.abs(points[index].x - outline[index].x) < EPSILON, `负数 inset ${dirty} 应按 0 处理`);
            assert.ok(Math.abs(points[index].y - outline[index].y) < EPSILON, `负数 inset ${dirty} 应按 0 处理`);
        }
    }
    const fallback = territoryCloudKeepOutPoints();
    for (const dirty of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'x' as unknown as number]) {
        const points = territoryCloudKeepOutPoints(dirty);
        for (let index = 0; index < points.length; index += 1) {
            const point = points[index];
            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `脏 inset ${String(dirty)} 产出了 NaN`);
            assert.ok(Math.abs(point.x - fallback[index].x) < EPSILON, `脏 inset ${String(dirty)} 应退回默认 15`);
            assert.ok(Math.abs(point.y - fallback[index].y) < EPSILON, `脏 inset ${String(dirty)} 应退回默认 15`);
        }
    }
});

// ============================================================
// ② 消散时间轴
// ============================================================

test('消散四段：整朵炸一下 → 裂开（壳收到 0.84）→ 碎块炸开（1.15）+ 上飘 + 淡出，到点返回 null', () => {
    assert.ok(TERRITORY_CLOUD_DISSOLVE_SECONDS > 0 && TERRITORY_CLOUD_DISSOLVE_SECONDS <= 1.5,
        `消散时长 ${TERRITORY_CLOUD_DISSOLVE_SECONDS}s 不合理（太长会读成"点了没反应"）`);
    const n = 2;
    // ⚠️ `TERRITORY_CLOUD_DISSOLVE_HOLD` / `_INTACT` 都是**进度比例**（0.3 = 前 30%），不是秒；
    // 这里按比例算秒再喂进去，别把 0.3 当 0.3s 用（那样已经走到 57% 了）。
    const total = TERRITORY_CLOUD_DISSOLVE_SECONDS;
    const at = (seconds: number) => {
        const frame = territoryCloudDissolveFrame(seconds, n);
        assert.ok(frame, `k=${seconds} 不该是 null`);
        return frame!;
    };
    const atT = (ratio: number) => at(ratio * total);

    // ① 起手段：**整朵不换帧**（`index = -1`）、全不透明、缩放从 1 起、还没上飘。
    //    🔴 这就是 2026-10-26 六版的核心：老口径第一帧直接写 `cloud_dissolve_body_0`（中间已经
    //    裂出洞的环），整朵云 → 断环是一次瞬间跳变，用户读到的是"换图"而不是"过渡"。
    const start = at(0);
    assert.equal(start.index, -1, '起手必须还是整朵云（-1），不许第一帧就跳成裂开的环');
    assert.equal(start.opacity, 1);
    assert.equal(start.scale, 1);
    assert.equal(start.liftY, 0);

    // 炸开段内：帧不换、不透明、缩放**单调涨**（真在"炸"），且不越过 PUNCH。
    let rising = 0;
    for (let index = 1; index <= 10; index += 1) {
        const frame = atT((TERRITORY_CLOUD_DISSOLVE_INTACT * index) / 11);
        assert.equal(frame.index, -1, '炸开段不许换帧');
        assert.equal(frame.opacity, 1, '炸开段不许淡（还没裂就变淡会读成"凭空消失"）');
        assert.equal(frame.liftY, 0, '炸开段还没开始上飘');
        assert.ok(frame.scale >= rising - 1e-9, `炸开段缩放回跌了：${rising} → ${frame.scale}`);
        assert.ok(frame.scale <= TERRITORY_CLOUD_DISSOLVE_PUNCH + 1e-9, `炸开段越过了峰值 ${frame.scale}`);
        rising = frame.scale;
    }
    assert.ok(rising > 1.02, `炸开段必须真的放大（实际只到 ${rising}），否则读不出"炸"`
        + '；也别超过 1.1（云会跳一下）');
    assert.ok(TERRITORY_CLOUD_DISSOLVE_PUNCH <= 1.1, '峰值倍率太大，看着像抽搐');

    // ② 裂开后：两帧都用到、顺序递增（裂成环 → 只剩碎块）。
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_INTACT).index, 0, '炸开一结束就要裂');
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_HOLD).index, 0);
    assert.equal(atT(0.8).index, 1);
    assert.equal(atT(0.99).index, n - 1);

    // ③ 缩放**两段**：壳先收到 CRUSH（"变小"）、碎块再炸到 BURST（"散开"）。
    //    🔴 只有单调缩小会读成"云瘪了"，只有单调放大又变成"云涨大"；一收一放才是"炸开"。
    const pivot = TERRITORY_CLOUD_DISSOLVE_INTACT
        + (1 - TERRITORY_CLOUD_DISSOLVE_INTACT) * TERRITORY_CLOUD_DISSOLVE_FRAGMENT;
    assert.ok(TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE < 1, '裂开段必须真的在缩（<1）');
    assert.ok(TERRITORY_CLOUD_DISSOLVE_BURST_SCALE > 1, '碎块段必须真的向外炸（>1）');
    assert.ok(TERRITORY_CLOUD_DISSOLVE_BURST_SCALE <= 1.3,
        '炸得太开会飞出格子范围，碎片反而看不出是"这朵云"');
    // 接缝必须连续：调头点那一帧正好等于 CRUSH（不是"缩到 0.7 又跳到 0.84"）。
    assert.ok(Math.abs(atT(pivot).scale - TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE) < 0.02,
        `调头点应在 ${TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE}，实际 ${atT(pivot).scale}`);
    let previousScale = atT(TERRITORY_CLOUD_DISSOLVE_INTACT).scale;
    for (let index = 1; index < 100; index += 1) {
        const ratio = index / 100;
        if (ratio < TERRITORY_CLOUD_DISSOLVE_INTACT) continue;
        if (ratio >= pivot - 1e-6) break;
        const frame = atT(ratio);
        assert.ok(frame.scale <= previousScale + 1e-9,
            `裂开段（t=${ratio}）缩放回涨了（${previousScale} → ${frame.scale}）`);
        previousScale = frame.scale;
    }
    let expandingFrom = atT(pivot).scale;
    for (let index = 1; index < 100; index += 1) {
        const ratio = index / 100;
        if (ratio <= pivot + 1e-6) continue;
        const frame = atT(ratio);
        assert.ok(frame.scale >= expandingFrom - 1e-9,
            `碎块段（t=${ratio}）缩放回跌了（${expandingFrom} → ${frame.scale}）`);
        expandingFrom = frame.scale;
    }
    // 上飘：全程**单调不降**，收尾到顶。
    let lifting = 0;
    for (let index = 1; index < 100; index += 1) {
        const ratio = index / 100;
        const frame = atT(ratio);
        assert.ok(frame.liftY >= lifting - 1e-9, `t=${ratio} 上飘回落了（${lifting} → ${frame.liftY}）`);
        assert.ok(frame.liftY <= TERRITORY_CLOUD_DISSOLVE_LIFT_PX + 1e-9, `t=${ratio} 上飘越界`);
        lifting = frame.liftY;
    }
    const last = atT(0.99);
    assert.ok(Math.abs(last.scale - TERRITORY_CLOUD_DISSOLVE_BURST_SCALE) < 0.02,
        `收尾缩放 ${last.scale} 应炸到 ${TERRITORY_CLOUD_DISSOLVE_BURST_SCALE}`);
    assert.ok(last.liftY > TERRITORY_CLOUD_DISSOLVE_LIFT_PX * 0.9, '收尾应该飘到顶');
    assert.ok(last.opacity > 0 && last.opacity < 0.2, '临近收尾应该是"快没了"而不是 0');

    // ④ 淡出：hold 段全不透明，之后**单调不增**（不许回涨）。
    assert.equal(atT(0.01).opacity, 1);
    // 按住到 hold 末尾还是全不透明（用 0.99 留一点余量避开边界抖动）。
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_HOLD * 0.99).opacity, 1);
    let previous = 1.0001;
    for (let index = 1; index < 100; index += 1) {
        const frame = atT(index / 100);
        assert.ok(frame.opacity <= previous + 1e-9, `t=${index / 100} 不透明度回涨了`);
        previous = frame.opacity;
    }

    // ⑤ 影子：裂开段与云体同缩放同透明（同一朵云），碎块段**收小 + 更早消失**。
    //    🔴 预览图里看出来的：两者同透明度一起淡到 100% 时，最后 0.2s 是"云只剩几缕、
    //    地上还挂一大团灰"—— 物理上也说不通（云升空，投影先没）。
    assert.equal(start.shadowScale, 1);
    assert.equal(start.shadowOpacity, 1);
    assert.ok(TERRITORY_CLOUD_DISSOLVE_SHADOW_SCALE < TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE,
        '影子的碎块段收尾必须比 CRUSH 更小，否则"收小"是假的');
    for (const ratio of [0.05, 0.2, 0.29]) {
        const frame = atT(ratio);
        assert.ok(Math.abs(frame.shadowScale - frame.scale) < 1e-9,
            `裂开段影子必须与云体同缩放（t=${ratio}）`);
        // hold 段之内两者都还是全不透明；过了 hold 影子就走它自己那条更陡的淡出曲线。
        assert.equal(frame.shadowOpacity, frame.opacity, `hold 段体 / 影同透明度（t=${ratio}）`);
    }
    for (const ratio of [0.6, 0.7, 0.9]) {
        const frame = atT(ratio);
        assert.ok(frame.shadowScale < frame.scale,
            `碎块段影子要收小、不许跟着炸开（t=${ratio}：体 ${frame.scale} / 影 ${frame.shadowScale}）`);
        assert.ok(frame.shadowOpacity <= frame.opacity,
            `碎块段影子不许比云体更实（t=${ratio}）`);
    }
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE).shadowOpacity, 0,
        `影子必须在 ${TERRITORY_CLOUD_DISSOLVE_SHADOW_GONE} 之前归零`);
    assert.ok(atT(0.99).opacity > 0, '云体要留到最后才没（影子才用"更早"那条曲线）');

    // 到点即 null（收云的唯一信号）；之后也一直 null。
    assert.equal(territoryCloudDissolveFrame(TERRITORY_CLOUD_DISSOLVE_SECONDS, n), null);
    assert.equal(territoryCloudDissolveFrame(TERRITORY_CLOUD_DISSOLVE_SECONDS * 3, n), null);
    // 没有消散帧 ⇒ 直接 null（视图那条"没帧也照样按时间收掉"靠它）。
    assert.equal(territoryCloudDissolveFrame(0.1, 0), null);
    // 脏参数不产 NaN（NaN 的坐标会让节点静默消失，连报错都没有）。
    for (const dirty of [Number.NaN, Number.NEGATIVE_INFINITY, 'x' as unknown as number]) {
        const frame = territoryCloudDissolveFrame(dirty, n);
        assert.ok(frame === null || (Number.isFinite(frame.scale) && Number.isFinite(frame.liftY)
            && Number.isFinite(frame.opacity)), `脏秒数 ${String(dirty)} 产出了 NaN 姿态`);
    }
});

// ============================================================
// ③ 云谱参数
// ============================================================

test('云谱参数：云洞缩小倍率按"整朵云（含影子）+ 15px"算，y 偏移随倍率走', () => {
    assert.ok(TERRITORY_CLOUD_SCALE > 0 && TERRITORY_CLOUD_SCALE <= 2,
        `倍率 ${TERRITORY_CLOUD_SCALE} 越界：0 会让云消失且零报错`);
    // 美术图 200×240、云体（含投影）占 y=0…198 ⇒ 重心比画布中心高 21.5，取负值压回来。
    assert.ok(TERRITORY_CLOUD_ART_OFFSET_Y < 0 && TERRITORY_CLOUD_ART_OFFSET_Y > -40,
        `y 偏移 ${TERRITORY_CLOUD_ART_OFFSET_Y} 不合理`);
    assert.ok(TERRITORY_CLOUD_DISSOLVE_HOLD > 0 && TERRITORY_CLOUD_DISSOLVE_HOLD < 1);

    // 🔴 y 偏移必须**按倍率**算：写死常数时，缩得越小云整体越往下漂（云洞就是这么跑到下面那格去的）。
    assert.ok(Math.abs(territoryCloudArtOffsetY(1) - TERRITORY_CLOUD_ART_OFFSET_Y) < 1e-9,
        '1.0 倍必须与 `TERRITORY_CLOUD_ART_OFFSET_Y` 同一个值');
    assert.ok(Math.abs(territoryCloudArtOffsetY(0.5) - TERRITORY_CLOUD_ART_OFFSET_Y / 2) < 1e-9,
        '半倍时偏移也要减半，否则重心与格面中心对不上');
    assert.equal(territoryCloudArtOffsetY(Number.NaN), TERRITORY_CLOUD_ART_OFFSET_Y,
        '脏倍率要退回 1.0 倍的值，不许产出 NaN 坐标');

    // 云洞可用空间 = 格面 + 四周 15px。
    const room = {
        width: gridLayout.HEX_GRID_FACE_WIDTH + TERRITORY_CLOUD_KEEP_OUT_PX * 2,
        height: gridLayout.HEX_GRID_FACE_HEIGHT + TERRITORY_CLOUD_KEEP_OUT_PX * 2,
    };
    assert.ok(TERRITORY_CLOUD_POCKET_SCALE > 0 && TERRITORY_CLOUD_POCKET_SCALE < 1, '必须是"缩小"，不是放大');
    // ⚠️ 判据是**整朵云**（云体 200×120 + 地面投影 = 198 高），不是只有云体：
    //    老口径按 120 算出来的 0.74 实机高 147，比洞的 120 高出 27 ⇒ 糊到上下相邻地块上（2026-10-26 截图）。
    assert.ok(TERRITORY_CLOUD_BODY_WIDTH === TERRITORY_CLOUD_ART_WIDTH, '云体宽就是画布宽（200）');
    assert.ok(TERRITORY_CLOUD_FULL_HEIGHT > TERRITORY_CLOUD_BODY_HEIGHT, '整朵云比云体高（下面还有影子）');
    assert.ok(TERRITORY_CLOUD_BODY_WIDTH * TERRITORY_CLOUD_POCKET_SCALE < room.width,
        `云洞云宽 ${TERRITORY_CLOUD_BODY_WIDTH * TERRITORY_CLOUD_POCKET_SCALE} 压到了 15px 间隔（可用 ${room.width}）`);
    assert.ok(TERRITORY_CLOUD_FULL_HEIGHT * TERRITORY_CLOUD_POCKET_SCALE < room.height,
        `云洞云高 ${TERRITORY_CLOUD_FULL_HEIGHT * TERRITORY_CLOUD_POCKET_SCALE} 压到了 15px 间隔（可用 ${room.height}）`);
    // 但也不能小到变成孤立小白点：云体至少占洞宽的一半。
    assert.ok(TERRITORY_CLOUD_BODY_WIDTH * TERRITORY_CLOUD_POCKET_SCALE > room.width / 2,
        '缩过头了，读不出"这里被雾盖着"');
});

// ============================================================
// ④ 铺满背景的虚拟格点
// ============================================================

test('铺满：虚拟格点与真实格**同间距同相位**（延伸同一张格网，不是另铺一层）', () => {
    const rows = 6;
    const columns = 7;
    const width = columns * gridLayout.HEX_GRID_VIEW_COLUMN_SPACING + 600;
    const height = rows * gridLayout.HEX_GRID_VIEW_ROW_SPACING + 600;
    // `occupied` = 真实云层已经盖了的格（这里假设只有 0 号格有内容）。
    const occupied = new Set<number>([0]);
    const points = territoryCloudFillPoints(rows, columns, width, height, occupied);
    assert.ok(points.length > 0, '留白那圈必须有云，否则滚到边缘就露底图');

    const real = new Map<string, number>();
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const point = gridLayout.hexGridViewPoint(row, column, rows, columns);
            real.set(`${point.x}|${point.y}`, row * columns + column);
        }
    }
    for (const point of points) {
        const cellId = real.get(`${point.x}|${point.y}`);
        if (cellId === undefined) continue;
        assert.notEqual(cellId, 0, '真实云层已经盖了的格不许重复铺（同一处两朵会更亮、边界一眼可见）');
    }
    // 🔴 2026-10-26 回归守卫：格网里**没有内容**的格也必须铺到。
    //    章节图 20×20 / 400 格里只有 ~117 格配了内容，老口径只铺格网外那圈 ⇒ 地图上留下
    //    整条裸露的沙漠底图（用户截图左侧红框：「未解锁的地块没有云层遮挡，空了一块背景图」）。
    const covered = new Set(points.map((point) => `${point.x}|${point.y}`));
    let bare = 0;
    for (let cellId = 0; cellId < rows * columns; cellId += 1) {
        if (cellId === 0) continue;
        const point = gridLayout.hexGridViewPoint(Math.floor(cellId / columns), cellId % columns, rows, columns);
        if (!covered.has(`${point.x}|${point.y}`)) bare += 1;
    }
    assert.equal(bare, 0, `${bare} 个"格内空格"没被铺满层盖住 ⇒ 那里会直接露出底图`);
    // 相位对齐：每个点的 x 一定落在真实格的列距网格上（差值为 92.25 的整数倍）。
    const spacing = gridLayout.HEX_GRID_VIEW_COLUMN_SPACING;
    const baseX = gridLayout.hexGridViewPoint(0, 0, rows, columns).x;
    for (const point of points) {
        const steps = (point.x - baseX) / spacing;
        assert.ok(Math.abs(steps - Math.round(steps)) < 1e-6, `x=${point.x} 不在列距网格上（${steps} 格）`);
    }
    // 铺满的边界必须**盖过内容层**：内容层四周那一圈才是"滚到边缘不露底图"的关键。
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    assert.ok(Math.min(...xs) < -width / 2 + TERRITORY_CLOUD_ART_WIDTH, '左边那圈没铺到');
    assert.ok(Math.max(...xs) > width / 2 - TERRITORY_CLOUD_ART_WIDTH, '右边那圈没铺到');
    assert.ok(Math.min(...ys) < -height / 2 + TERRITORY_CLOUD_ART_HEIGHT, '下边那圈没铺到');
    assert.ok(Math.max(...ys) > height / 2 - TERRITORY_CLOUD_ART_HEIGHT, '上边那圈没铺到');
    // 脏参数不崩。
    assert.deepEqual(territoryCloudFillPoints(0, 0, 100, 100), []);
    assert.deepEqual(territoryCloudFillPoints(rows, columns, Number.NaN, height), []);
});

// ============================================================
// ⑤ 云洞判定
// ============================================================

/** 造一个 rows×columns 的格网，返回「已解锁」集合（按 `keep` 决定谁留成未解锁）。 */
function revealedGrid(rows: number, columns: number, unrevealed: readonly number[]): Set<number> {
    const blocked = new Set(unrevealed);
    const revealed = new Set<number>();
    for (let cellId = 0; cellId < rows * columns; cellId += 1) {
        if (!blocked.has(cellId)) revealed.add(cellId);
    }
    return revealed;
}

test('云洞判定：被包围的单格 / 两格算洞；连到边缘的雾不算；全解锁就没有洞', () => {
    const rows = 5;
    const columns = 5;
    const middle = 2 * columns + 2;
    // 只剩中间一格：四周全是已解锁 ⇒ 是洞。
    assert.deepEqual(territoryCloudPocketCells(rows, columns, revealedGrid(rows, columns, [middle])), [middle]);
    // 中间相邻两格：整块被包围 ⇒ 都算洞。
    const pair = [middle, middle + 1];
    assert.deepEqual(territoryCloudPocketCells(rows, columns, revealedGrid(rows, columns, pair)).sort(), pair.sort());
    // 贴边那一格（0 号）连到地图外 ⇒ 不封闭，不算洞。
    assert.deepEqual(territoryCloudPocketCells(rows, columns, revealedGrid(rows, columns, [0])), []);
    // 全解锁 ⇒ 没有未解锁格，自然没有洞。
    assert.deepEqual(territoryCloudPocketCells(rows, columns, revealedGrid(rows, columns, [])), []);
});

test('云洞判定：超过封顶的大片未探索区不当洞（不然半张图会被搬到 UI 之上）', () => {
    const rows = 8;
    const columns = 8;
    // 中间挖一块 3×3（9 格）的雾：四周都被解锁包住，但超过封顶 ⇒ 不处理。
    const block: number[] = [];
    for (let row = 3; row <= 5; row += 1) {
        for (let column = 3; column <= 5; column += 1) block.push(row * columns + column);
    }
    assert.ok(block.length > TERRITORY_CLOUD_POCKET_MAX_CELLS);
    assert.deepEqual(territoryCloudPocketCells(rows, columns, revealedGrid(rows, columns, block)), []);
    // 封顶值本身要合理：太小会漏掉"两格大的洞"，太大会把半张图搬上去。
    assert.ok(TERRITORY_CLOUD_POCKET_MAX_CELLS >= 2 && TERRITORY_CLOUD_POCKET_MAX_CELLS <= 16);
});

// ============================================================
// ⑥ 盖云格位：只盖「配了内容的格」（山猫口径）
// ============================================================

test('territoryCloudCells：只盖 sites + candidateCells + 起始格，空白格不盖（山猫口径）', () => {
    const rows = 5;
    const columns = 5;
    const points = new Map<number, { x: number; y: number }>();
    for (let cellId = 0; cellId < rows * columns; cellId += 1) {
        const point = gridLayout.hexGridViewPoint(Math.floor(cellId / columns), cellId % columns, rows, columns);
        points.set(cellId, point);
    }
    const cells = cloud.territoryCloudCells(
        {
            sites: [{ cellId: 1 }, { cellId: 7 }],
            randomSites: { candidateCells: [11, 13] },
            startCellId: 12,
        },
        points,
    );
    assert.deepEqual(
        cells.map((cell) => cell.cellId),
        [1, 7, 11, 12, 13],
        '只盖配置格 + 起始格，且升序去重',
    );
    // 坐标 = 布局点（未加 HEX_GRID_CONTENT_LIFT，视图侧 sync 统一加）。
    const p12 = points.get(12)!;
    assert.equal(cells.find((cell) => cell.cellId === 12)!.x, p12.x);
    assert.equal(cells.find((cell) => cell.cellId === 12)!.y, p12.y);
    // 空白格（不在 sites / candidates / start）不盖 —— 盖了也永远散不掉，纯噪声。
    assert.equal(cells.some((cell) => cell.cellId === 0), false);
    assert.equal(cells.some((cell) => cell.cellId === 24), false);
});

test('territoryCloudCells：重复格只出一朵；points 缺格跳过不崩', () => {
    const points = new Map([
        [1, { x: 10, y: 20 }],
        [2, { x: 30, y: 40 }],
    ]);
    const cells = cloud.territoryCloudCells(
        {
            sites: [{ cellId: 1 }, { cellId: 2 }],
            randomSites: { candidateCells: [1] }, // 与 site 重复
            startCellId: 2, // 与 site 重复
        },
        points,
    );
    assert.deepEqual(cells.map((cell) => cell.cellId), [1, 2], '去重后仍升序');
    // points 里缺的格（防御：布局与地图不同源）⇒ 跳过，不产出 NaN 坐标；
    // 有 point 的格照常盖（points 缺的是 startCellId 5，不是 site 99）。
    const sparse = new Map([[99, { x: 1, y: 2 }]]);
    const out = cloud.territoryCloudCells({ sites: [{ cellId: 99 }], startCellId: 5 }, sparse);
    assert.deepEqual(out.map((cell) => cell.cellId), [99], '有 point 的 site 要盖，缺 point 的 start 跳过');
    assert.ok(out.every((cell) => Number.isFinite(cell.x) && Number.isFinite(cell.y)), '不许产出 NaN 坐标');
});

// ============================================================
// 视图接线（vm + cc 桩）
// ============================================================

class NodeStub {
    name: string;
    isValid = true;
    active = true;
    layer = 33554432;
    parent: NodeStub | null = null;
    children: NodeStub[] = [];
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    worldPosition = { x: 0, y: 0, z: 0 };
    worldScale = { x: 1, y: 1, z: 1 };
    private readonly components = new Map<unknown, unknown>();

    constructor(name = '') {
        this.name = name;
    }

    setParent(parent: NodeStub): void {
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
        }
        this.parent = parent;
        parent.children.push(this);
    }

    getSiblingIndex(): number {
        return this.parent ? this.parent.children.indexOf(this) : -1;
    }

    setSiblingIndex(index: number): void {
        if (!this.parent) return;
        const list = this.parent.children;
        const from = list.indexOf(this);
        if (from >= 0) list.splice(from, 1);
        list.splice(Math.max(0, Math.min(index, list.length)), 0, this);
    }

    getChildByName(name: string): NodeStub | null {
        return this.children.find((child) => child.name === name) ?? null;
    }

    setPosition(x: number, y: number, z: number): void {
        this.position = { x, y, z };
    }

    setScale(x: number, y: number, z: number): void {
        this.scale = { x, y, z };
    }

    setWorldPosition(value: { x: number; y: number; z: number } | number, y?: number, z?: number): void {
        // `cc.Node.setWorldPosition` 两种签名都收（Vec3 / 三个数）；视图两条分支都会用到。
        this.worldPosition = typeof value === 'number'
            ? { x: value, y: y ?? 0, z: z ?? 0 }
            : { x: value.x, y: value.y, z: value.z };
    }

    setWorldScale(value: { x: number; y: number; z: number } | number, y?: number, z?: number): void {
        this.worldScale = typeof value === 'number'
            ? { x: value, y: y ?? 1, z: z ?? 1 }
            : { x: value.x, y: value.y, z: value.z };
    }

    addComponent(ctor: new () => unknown): any {
        const component = new ctor() as { node?: NodeStub };
        // 视图是 `sprite.node` 拿节点的（不再单独维护 nodes 表）⇒ 桩必须补这条反向引用。
        component.node = this;
        this.components.set(ctor, component);
        return component;
    }

    getComponent(ctor: unknown): any {
        return this.components.get(ctor) ?? null;
    }

    destroy(): void {
        this.isValid = false;
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
        }
        this.parent = null;
    }
}

class SpriteStub {
    static SizeMode = { CUSTOM: 0, TRIMMED: 1, RAW: 2 };
    node: NodeStub | null = null;
    trim = true;
    sizeMode = 0;
    /** 桩里用 `any`：用例要直接读 `.name`，`unknown` 会让 tsc 报 TS2339。 */
    spriteFrame: any = null;
    private _color = { r: 255, g: 255, b: 255, a: 255 };

    /**
     * 真 `Sprite.color` 是个 setter，会把值**拷进**组件内部。
     *
     * 桩必须照抄这个语义：视图为了不在 `update` 里造垃圾，复用同一个 `Color` 容器写多个节点
     * （`this.tint.a = value; sprite.color = this.tint`）—— 桩若直接存引用，体 / 影就**共享**同一个
     * 对象，后写的那个会把前一个的 alpha 覆盖掉（用例里表现为"云体的 a 跟着影子变成 0"）。
     */
    get color(): { r: number; g: number; b: number; a: number } {
        return this._color;
    }

    set color(value: { r: number; g: number; b: number; a: number }) {
        this._color = { r: value.r, g: value.g, b: value.b, a: value.a };
    }
}

/**
 * `UIOpacity` 桩（铺满层的淡出时间轴写它）。
 *
 * ⚠️ `opacity` 是 **0~255** 的整数（`cc.UIOpacity` 的口径），不是 0~1 ——
 *    视图里那句 `× 255` 正是靠这条桩来钉的（写成 0~1 用例立刻红）。
 */
class UIOpacityStub {
    node: NodeStub | null = null;
    opacity = 255;
}

class UITransformStub {
    /** 节点反向引用（`NodeStub.addComponent` 会写进来）。 */
    node: NodeStub | null = null;

    /**
     * 局部点 → 世界点（只做**平移 + 缩放**，桩里没有旋转）。
     *
     * 视图用它把「内容层偏移 150px」换算到世界坐标 —— 少了这条，云洞层会整体低 150
     * （2026-10-26 实机红圈就是这个）。
     */
    convertToWorldSpaceAR(point: { x: number; y: number; z?: number }): { x: number; y: number; z: number } {
        const node = this.node;
        if (!node) return { x: point.x, y: point.y, z: point.z ?? 0 };
        return {
            x: node.worldPosition.x + point.x * node.worldScale.x,
            y: node.worldPosition.y + point.y * node.worldScale.y,
            z: node.worldPosition.z,
        };
    }
}

class Vec3Stub {
    constructor(
        public x = 0,
        public y = 0,
        public z = 0,
    ) {}
}

class ColorStub {
    constructor(
        public r = 255,
        public g = 255,
        public b = 255,
        public a = 255,
    ) {}
}

class MaskStub {
    static Type = { GRAPHICS_RECT: 0, GRAPHICS_ELLIPSE: 1, GRAPHICS_STENCIL: 2, SPRITE_STENCIL: 3 };
    node: NodeStub | null = null;
    type = MaskStub.Type.GRAPHICS_RECT;
    inverted = false;
    enabled = true;
}

/** `Graphics` 桩：只记"被画了什么"，用来验挡云多边形真的写进去了。 */
class GraphicsStub {
    node: NodeStub | null = null;
    fillColor = new ColorStub();
    clearCalls = 0;
    fillCalls = 0;
    /** 依次记录 moveTo / lineTo / close，便于数多边形与顶点。 */
    readonly ops: { op: string; x?: number; y?: number }[] = [];

    clear(): void {
        this.clearCalls += 1;
        this.ops.length = 0;
    }

    moveTo(x: number, y: number): void {
        this.ops.push({ op: 'moveTo', x, y });
    }

    lineTo(x: number, y: number): void {
        this.ops.push({ op: 'lineTo', x, y });
    }

    close(): void {
        this.ops.push({ op: 'close' });
    }

    fill(): void {
        this.fillCalls += 1;
    }

    /** 画了几个多边形（= 几个 moveTo）。一个外扩六边形 = 1 个多边形。 */
    get polygonCount(): number {
        return this.ops.filter((item) => item.op === 'moveTo').length;
    }

    /** 一共落了多少个顶点（moveTo + lineTo）。一个外扩六边形 = 6 个顶点。 */
    get vertexCount(): number {
        return this.ops.filter((item) => item.op === 'moveTo' || item.op === 'lineTo').length;
    }
}

const ccStub = {
    Node: NodeStub,
    Sprite: SpriteStub,
    UITransform: UITransformStub,
    Color: ColorStub,
    Graphics: GraphicsStub,
    Mask: MaskStub,
    Vec3: Vec3Stub,
    UIOpacity: UIOpacityStub,
};

/** 视图类在 vm 里跑：`cc` 换桩，模型与几何常量用真模块。 */
function viewClass(): any {
    const source = read('assets/script/app/territory/view/TerritoryCloudView.ts');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, {
        exports,
        console,
        require: (name: string) => {
            if (name === 'cc') return ccStub;
            if (name === '../model/TerritoryCloud') return cloud;
            // 云洞层要用「内容层偏移」对齐 `MapLayer`（`applyContentShift` 写在孩子上的 150px）。
            if (name === '../model/TerritoryMapLayout') return layout;
            if (name === '../../../core/hex/HexGridLayout') return gridLayout;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return exports;
}

/** 每个用例都会 `new` 一次视图：模块只转译一次（不然一个文件几十次 `transpileModule`）。 */
let viewExportsCache: Record<string, any> | null = null;
function viewModule(): Record<string, any> {
    if (!viewExportsCache) viewExportsCache = viewClass();
    return viewExportsCache;
}

/** 云图帧桩：视图只认 `name`（云体 / 影子 / 消散各一套图，不再有 rect 换算）。 */
function frames(prefix: string, count: number): { name: string }[] {
    return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index}` }));
}

/**
 * 一套标准的四组云图 —— 与 `image/territory/cloud/` 下的真实文件名逐一对应
 * （由 `tools/split_cloud_layers.py` 从 `cloud_idle_0` / `cloud_dissolve_0…1` 拆出来）。
 */
function cloudFrames() {
    return {
        body: frames('cloud_body_', 1),
        shadow: frames('cloud_shadow_', 1),
        dissolveBody: frames('cloud_dissolve_body_', 2),
        dissolveShadow: frames('cloud_dissolve_shadow_', 2),
    };
}

/** 层里的云节点（跳过常驻的 `CloudShadow` 影子分组）。 */
function cloudNodes(layer: NodeStub | null): NodeStub[] {
    const shadowName = viewModule().TERRITORY_CLOUD_SHADOW_NODE;
    return (layer?.children ?? []).filter((child) => child.name !== shadowName);
}

/** 按名字取一朵云（体 / 影都行）。 */
function findNode(layer: NodeStub | null, name: string): NodeStub | null {
    return (layer?.children ?? []).find((child) => child.name === name) ?? null;
}

/** 帧名（云体 / 影子各是一张独立图：`cloud_body_0` / `cloud_shadow_0`）。 */
function frameName(sprite: SpriteStub | null): string {
    return String(sprite?.spriteFrame?.name ?? '');
}

/** 一张 3 格的布局：格 0/1/2 依次排开（坐标只要不同就行）。 */
function cells(count = 3): { cellId: number; x: number; y: number }[] {
    return Array.from({ length: count }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
}

/** 一套标准舞台：MapLayer 下依次是底图 / 格子 / 站点 / 飘字。 */
function stage() {
    const mapLayer = new NodeStub('MapLayer');
    const background = new NodeStub('MapBackground');
    background.setParent(mapLayer);
    const gridLayer = new NodeStub('GridLayer');
    gridLayer.setParent(mapLayer);
    const stationIconLayer = new NodeStub('StationIconLayer');
    stationIconLayer.setParent(mapLayer);
    const gainLayer = new NodeStub('GainLayer');
    gainLayer.setParent(mapLayer);
    const mod = viewModule();
    const view = new mod.TerritoryCloudView();
    view.attach(gridLayer);
    view.setFrames(cloudFrames());
    return { mapLayer, gridLayer, view, cloud: mod };
}

/** 一套带页面根的舞台（云洞层要挂在 `MapLayer.parent.parent` 上）。 */
function stageWithPage() {
    const page = new NodeStub('Page');
    const viewport = new NodeStub('MapViewport');
    viewport.setParent(page);
    // 模拟顶部 UI（玩家信息 / 资源栏）：云洞层必须排在它**之后**才压得住。
    const playerInfo = new NodeStub('PlayerInfo');
    playerInfo.setParent(page);
    const mapLayer = new NodeStub('MapLayer');
    mapLayer.setParent(viewport);
    const gridLayer = new NodeStub('GridLayer');
    gridLayer.setParent(mapLayer);
    const gainLayer = new NodeStub('GainLayer');
    gainLayer.setParent(mapLayer);
    const mod = viewModule();
    const view = new mod.TerritoryCloudView();
    view.attach(gridLayer);
    view.setFrames(cloudFrames());
    return { page, viewport, playerInfo, mapLayer, gridLayer, view, cloud: mod };
}

test('层序：格子 → 挡云遮罩(云层在它下面) → 消散层 → 站点 → 飘字', () => {
    const { mapLayer, view, cloud: mod } = stage();
    const names = mapLayer.children.map((child: NodeStub) => child.name);
    assert.deepEqual(names, [
        'MapBackground',
        'GridLayer',
        mod.TERRITORY_CLOUD_KEEP_OUT_NODE,
        mod.TERRITORY_CLOUD_DISSOLVE_NODE,
        'StationIconLayer',
        'GainLayer',
    ], `层序必须是「底图 → 格子 → 挡云(云) → 消散 → 站点 → 飘字」，实际 ${names.join('/')}`);
    // 云层必须是遮罩的子节点 —— 否则反向遮罩管不到它，"15px 间隔"根本不存在。
    assert.equal(view.layerNode.parent.name, mod.TERRITORY_CLOUD_KEEP_OUT_NODE);
    assert.equal(view.keepOutNode, mapLayer.children[2]);
    assert.equal(view.dissolveLayerNode, mapLayer.children[3]);
    // 幂等：再 attach 一次不会建出第二套。
    view.attach(mapLayer.children[1]);
    assert.equal(mapLayer.children.length, 6);
});

test('遮罩组件：GRAPHICS_STENCIL + 反向，且模具填充色必须是全透明', () => {
    const { view } = stage();
    const mask = view.keepOutNode.getComponent(MaskStub) as MaskStub;
    assert.equal(mask.type, MaskStub.Type.GRAPHICS_STENCIL, '必须用图形模板，不是矩形');
    assert.equal(mask.inverted, true, '反向：画到哪，哪里就看不见云');
    assert.equal(mask.enabled, false, '还没有已解锁格 ⇒ 空模具先关掉');
    // 默认 fillColor 是不透明白：Mask 自己建的 Graphics 才会改成 alpha 0，
    // 我们先建了就必须自己写，否则 fill() 会画出一块实心白多边形。
    const graphics = view.keepOutNode.getComponent(GraphicsStub) as GraphicsStub;
    assert.equal(graphics.fillColor.a, 0, '模具填充必须全透明');
});

test('未解锁格盖云；已解锁格首帧不建云、不补播消散', () => {
    const { view } = stage();
    // 首帧：格 1 已经是历史已解锁（进页面就是这样），不许把它当成"刚解锁"。
    view.sync(cells(3), new Set([1]));
    assert.equal(view.cloudCount, 2, '格 0 / 2 该盖云');
    assert.equal(view.dissolvingCount, 0, '首帧不许播消散');

    const layer = view.layerNode!;
    assert.equal(cloudNodes(layer).length, 2);
    for (const node of cloudNodes(layer)) {
        assert.equal(node.active, true);
        // 落点 = 布局点 + 格面中心抬升 + 云体偏移（压在格面上，不是压在格心锚点）。
        const cellId = Number(node.name.replace('Cloud_', ''));
        assert.equal(node.position.x, cellId * 92.25);
        assert.equal(node.position.y, gridLayout.HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y);
        assert.equal(node.scale.x, TERRITORY_CLOUD_SCALE);
        const sprite = node.getComponent(SpriteStub) as SpriteStub;
        // 同画布 ⇒ RAW（尺寸跟帧走），trim 关掉（否则各帧 rect 不同、云会抖）。
        assert.equal(sprite.sizeMode, SpriteStub.SizeMode.RAW);
        assert.equal(sprite.trim, false);
        assert.equal(frameName(sprite), 'cloud_body_0', '未解锁必须是**静止**云体图（`cloud_body_0`）');
        assert.equal(sprite.color.a, 255);
    }
});

test('格子露出的那一帧：挪进消散层 → 整朵炸一下 → 体 / 影同步换帧 + 收缩/炸开 + 淡出 → 播完收掉', () => {
    const { view } = stage();
    view.sync(cells(3), new Set());
    assert.equal(view.cloudCount, 3);

    // 格 1 露出 ⇒ 进消散（这一帧云还在，不能立刻消失）。
    view.sync(cells(3), new Set([1]));
    assert.equal(view.dissolvingCount, 1);
    assert.equal(view.cloudCount, 2, '消散中的那朵不算待机');
    const node = findNode(view.dissolveLayerNode, 'Cloud_1');
    assert.ok(node, '消散中的云必须挪到 CloudDissolveLayer（留在遮罩层会被自己的挡云区擦掉）');
    assert.equal(node.active, true, '消散起手这一帧必须还看得见');
    const sprite = node.getComponent(SpriteStub) as SpriteStub;
    const baseY = gridLayout.HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y;
    // 🔴 2026-10-26 六版：起手是**整朵云**（`index = -1`），不是第 0 帧消散图。
    //    老口径第一帧就换成 `cloud_dissolve_body_0`（中间已裂出洞的环）⇒ 整朵 → 断环是瞬间跳变。
    assert.equal(frameName(sprite), 'cloud_body_0', '起手必须还是整朵云，不许一上来就换成裂开的环');
    assert.ok(Math.abs(node.scale.x - TERRITORY_CLOUD_SCALE) < 1e-9, '起手缩放 = 基础倍率');
    assert.equal(node.position.y, baseY, '起手上飘为 0');
    const shadowNode = findNode(view.dissolveLayerNode!.getChildByName('CloudShadow'), 'CloudShadow_1');
    assert.ok(shadowNode, '消散中的影子要跟着挪进解散分组的');

    // 炸开段（前 12%）：帧不换、云**放大**、影子跟着一起放大（同一朵云）。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.1);
    assert.equal(frameName(sprite), 'cloud_body_0', '炸开段不许换帧');
    assert.ok(node.scale.x > TERRITORY_CLOUD_SCALE, `炸开段应放大到 >1，实际 ${node.scale.x}`);
    assert.equal(shadowNode!.scale.x, node.scale.x, '影子与云体同一个缩放（同一朵云）');

    // 裂开段（hold 之内，还没开始淡）：换第 0 帧、壳**收缩**（"变小"）、云体已经开始上飘。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.18);
    assert.equal(frameName(sprite), 'cloud_dissolve_body_0', '裂开段用第 0 帧（裂出洞的环）');
    assert.ok(node.scale.x < TERRITORY_CLOUD_SCALE,
        `裂开段壳要往回收（< ${TERRITORY_CLOUD_SCALE}），实际 ${node.scale.x}`);
    assert.ok(node.scale.x >= TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE - 1e-9,
        `壳不许缩过 ${TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE}（再小就成"碎块往中心缩"）`);
    assert.equal(sprite.color.a, 255, '裂开段还不许淡（hold 段之内）');
    assert.equal(shadowNode!.getComponent(SpriteStub)!.color.a, 255, '影子这时候也还全不透明');
    assert.ok(node.position.y > baseY, '云体要上飘（"散开"的方向感）');
    assert.equal(shadowNode!.position.y, baseY, '影子是贴地投影，不许跟着飘');

    // 碎块段（后半）：换成碎块帧、缩放**掉头向外炸**，开始淡出。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.52);
    assert.equal(view.dissolvingCount, 1);
    assert.equal(frameName(sprite), 'cloud_dissolve_body_1');
    assert.ok(sprite.color.a < 255 && sprite.color.a > 0, `淡出中 a=${sprite.color.a}`);
    assert.ok(node.scale.x > TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE,
        `碎块段必须掉头向外炸（> ${TERRITORY_CLOUD_DISSOLVE_CRUSH_SCALE}），实际 ${node.scale.x}`);
    const shadowSprite = shadowNode!.getComponent(SpriteStub) as SpriteStub;
    assert.equal(frameName(shadowSprite), 'cloud_dissolve_shadow_1', '影子要和云体同步换到同一帧');
    assert.ok(shadowSprite.color.a < sprite.color.a,
        `影子必须比云体**更早**没（云端已经升空）；实际 体=${sprite.color.a} 影=${shadowSprite.color.a}`);
    assert.ok(shadowNode!.scale.x < node.scale.x,
        `影子不许跟着向外炸，反而要收小；实际 体=${node.scale.x} 影=${shadowNode!.scale.x}`);
    assert.equal(shadowNode!.position.y, baseY, '影子始终留在原地');

    // 到点：收掉（隐藏 + 缩放 / 不透明 / 位置全部复位，下次若又变未解锁能正常显形）。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.3);
    assert.equal(view.dissolvingCount, 0);
    assert.equal(node.active, false);
    assert.equal(sprite.color.a, 255);
    assert.ok(Math.abs(node.scale.x - TERRITORY_CLOUD_SCALE) < 1e-9,
        '收尾必须把倍率复位，否则回退时留下一朵"半缩的云"');
    assert.equal(node.position.y, baseY, '收尾位置也要复位（上飘量不能留在节点上）');
    assert.ok(Math.abs(shadowNode!.scale.x - TERRITORY_CLOUD_SCALE) < 1e-9, '影子同样复位');

    // 之后再 sync 也不会把它重新拉起来（它已经露出来了）。
    view.sync(cells(3), new Set([1]));
    assert.equal(node.active, false);
    assert.equal(view.dissolvingCount, 0);
});

test('回退：那一格又变回未解锁 ⇒ 挪回云层、恢复静止图与不透明度', () => {
    const { view } = stage();
    view.sync(cells(3), new Set());
    view.sync(cells(3), new Set([1]));
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.8);
    const node = findNode(view.dissolveLayerNode, 'Cloud_1')!;
    const sprite = node.getComponent(SpriteStub) as SpriteStub;
    assert.ok(sprite.color.a < 255);

    // 服务端快照改口径 / 撤销解锁：这一格又盖回云。
    view.sync(cells(3), new Set());
    assert.equal(view.cloudCount, 3);
    assert.equal(view.dissolvingCount, 0, '回退必须取消消散');
    assert.equal(node.parent, view.layerNode, '必须挪回遮罩层，否则它不会被 15px 约束');
    assert.equal(node.active, true);
    assert.equal(frameName(sprite), 'cloud_body_0', '回退要恢复静止云体图');
    assert.equal(sprite.color.a, 255, '回退要恢复不透明（否则一朵半透明的云）');
    // 影子也得跟着回家（否则它留在消散层，被那张"擦邻居"的遮罩管着）。
    const shadow = findNode(view.shadowGroupNode, 'CloudShadow_1');
    assert.ok(shadow, '回退后影子必须回到云层的影子分组');
    assert.equal(shadow!.active, true);
    assert.equal(frameName(shadow!.getComponent(SpriteStub) as SpriteStub), 'cloud_shadow_0');
});

test('挡云区：已解锁集合变了才重画；没有已解锁格时遮罩关闭', () => {
    const { view } = stage();
    const mask = view.keepOutNode.getComponent(MaskStub) as MaskStub;
    const graphics = view.keepOutNode.getComponent(GraphicsStub) as GraphicsStub;

    view.sync(cells(3), new Set());
    assert.equal(mask.enabled, false, '全未解锁 ⇒ 挡云区是空的');
    const clears = graphics.clearCalls;

    view.sync(cells(3), new Set([0]));
    assert.equal(mask.enabled, true);
    assert.equal(graphics.polygonCount, 1, '一格 = 一个闭合六边形');
    assert.equal(graphics.vertexCount, 6, '一个格面外扩六边形 = 6 个顶点');
    // 同一集合再 sync 一次 ⇒ 不许重画（站点每秒刷新，重画几百个多边形会掉帧）。
    const fills = graphics.fillCalls;
    view.sync(cells(3), new Set([0]));
    assert.equal(graphics.clearCalls, clears + 1, '集合没变就不该再 clear');
    assert.equal(graphics.fillCalls, fills, '集合没变就不该再 fill');

    // 再解锁一格 ⇒ 两个格子的并集在**一次** fill 里画完（相邻格不留缝）。
    view.sync(cells(3), new Set([0, 1]));
    assert.equal(graphics.polygonCount, 2);
    assert.equal(graphics.vertexCount, 12);
    assert.equal(graphics.fillCalls, fills + 1, '一次 fill 合成并集');
});

test('换章 / 无帧：复位清空，一张帧都没取到时不建任何云节点（降级不报错）', () => {
    const { view } = stage();
    view.sync(cells(4), new Set());
    assert.equal(view.cloudCount, 4);

    view.reset();
    assert.equal(view.cloudCount, 0);
    assert.equal(cloudNodes(view.layerNode).length, 0, 'reset 必须销毁云节点（换章后 cellId 变了含义）');
    assert.equal(cloudNodes(view.dissolveLayerNode).length, 0, '消散层的残留也要清掉');
    assert.equal(view.shadowGroupNode!.children.length, 0, '影子也要清掉（留着就是一圈灰斑）');

    // 帧全空（美术没导入 / 目录读失败）⇒ 整条表现静默关闭。
    view.setFrames({ body: [], shadow: [], dissolveBody: [], dissolveShadow: [] });
    view.sync(cells(4), new Set());
    assert.equal(view.cloudCount, 0);
    assert.equal(cloudNodes(view.layerNode).length, 0);
    // 而且 step 不能抛（每帧都在跑）。
    view.step(0.016);
});

// ============================================================
// 四版：影子在所有云体之下 / 云洞不裁剪 / 铺满层
// ============================================================

test('视图：影子统一住进「影子层」（= 画在所有云体之下，跨层也不许漏）', () => {
    const { view } = stage();
    const layer = view.layerNode!;
    const group = view.shadowGroupNode!;
    assert.ok(group, '云层必须有影子分组');
    // 🔴 2026-10-26：判据从"层里第 0 个孩子"升级成"住在遮罩的第 0 个孩子（影子层）里"——
    //    老口径只管层内顺序，`CloudLayer` 的影子照样会画到 `CloudFillLayer` 的云体上（灰云带）。
    const keepOut = view.keepOutNode!;
    assert.equal(view.shadowLayerNode, keepOut.children[0], '影子层必须是遮罩的第 0 个孩子');
    assert.equal(group.parent, view.shadowLayerNode, '影子必须住在影子层里');
    assert.ok(keepOut.children.indexOf(layer) > keepOut.children.indexOf(view.shadowLayerNode!),
        '所有云体层都排在影子层之后');

    view.sync(cells(3), new Set([1]));
    assert.equal(cloudNodes(layer).length, 2);
    assert.equal(group.children.length, 2, '每朵云一个影子');

    for (const node of cloudNodes(layer)) {
        const shadow = findNode(group, `CloudShadow_${node.name.replace('Cloud_', '')}`);
        assert.ok(shadow, `「${node.name}」缺影子`);
        // 两张图同画布 200×240、同锚点 ⇒ 体 / 影共用同一个坐标与缩放（这是"不歪"的唯一保证）。
        assert.deepEqual(shadow!.position, node.position, '影子必须与云体同坐标');
        assert.equal(shadow!.scale.x, node.scale.x);
        const sprite = shadow!.getComponent(SpriteStub) as SpriteStub;
        assert.equal(frameName(sprite), 'cloud_shadow_0', '影子那一层只能画影子图，不能画云体图');
        assert.equal(sprite.color.a, 255);
    }
});

test('视图：消散层自带"排除自己"的挡云遮罩（自己那格留白、邻居照旧 15px）', () => {
    const { view } = stage();
    const layer = view.dissolveLayerNode!;
    const mask = layer.getComponent(MaskStub) as MaskStub;
    const graphics = layer.getComponent(GraphicsStub) as GraphicsStub;

    view.sync(cells(3), new Set());
    assert.equal(mask.enabled, false, '没有正在消散的云就别开遮罩');
    assert.equal(mask.inverted, true, '反向擦除（画到哪、哪里就不显示）');

    // 格 0/1 解锁并散完 ⇒ 它们变成"已解锁但不散"，格 2 随后解锁才开始散。
    view.sync(cells(3), new Set([0, 1]));
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS);
    assert.equal(view.dissolvingCount, 0);
    const fills = graphics.fillCalls;
    view.sync(cells(3), new Set([0, 1, 2]));
    assert.equal(view.dissolvingCount, 1);

    assert.equal(mask.enabled, true);
    assert.equal(graphics.polygonCount, 2, '只画已解锁且**不在消散**的 0 / 1 —— 正在散的 2 要留白');
    assert.equal(graphics.fillCalls, fills + 1, '一次 fill 合成并集');
    assert.equal(graphics.fillColor.a, 0, '模具填充必须全透明');
    // 影子和云体一起挪进消散层，且影子仍在解散分组的第 0 位（= 在云体之下）。
    const dissolveShadow = findNode(layer.getChildByName('CloudShadow'), 'CloudShadow_2');
    assert.ok(dissolveShadow, '消散中的影子要跟着挪');
    assert.equal(findNode(layer, 'Cloud_2')!.getSiblingIndex() > dissolveShadow!.getSiblingIndex(), true);

    // 散完 ⇒ 遮罩关掉。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS);
    assert.equal(mask.enabled, false);
});

test('视图：云洞层挂在页面根、压在 UI 之上，且**不裁剪**（没有遮罩）', () => {
    const { view, page, playerInfo } = stageWithPage();
    const pocket = view.pocketLayerNode!;
    assert.ok(pocket, '有页面根就该建云洞层');
    assert.equal(pocket.parent, page, '云洞层必须挂在页面根（不是地图层）');
    assert.equal(pocket.getSiblingIndex() > playerInfo.getSiblingIndex(), true, '必须排在顶部 UI 之后才压得住');
    // 四版口径：云洞不裁剪 —— 原来那块"洞外扩 15px"的正像遮罩会把云裁成白色六边形。
    assert.equal(pocket.getComponent(MaskStub), null, '云洞层不许挂遮罩（用户：云洞部分的不裁剪）');
    assert.equal(pocket.getComponent(GraphicsStub), null, '遮罩模具也不该留');
    // 不注册触摸监听、不挂拦截组件 ⇒ 不影响点击（属性里也没有 `BlockInputEvents`）。
    assert.ok(!('on' in pocket), '云洞层不许挂事件监听');
    // 影子分组仍然是第 0 个孩子。
    const shadow = pocket.getChildByName(viewModule().TERRITORY_CLOUD_SHADOW_NODE);
    assert.ok(shadow, '云洞层要有影子分组');
    assert.equal(shadow!.getSiblingIndex(), 0, '影子同样在云体之下');
});

test('视图：云洞每格**只放一朵**、缩到 POCKET_SCALE，且跟着地图的世界变换走', () => {
    const { view, mapLayer } = stageWithPage();
    const rows = 5;
    const columns = 5;
    view.setFillArea(900, 1200, rows, columns);
    // `cells` 是**全部**布局格（`syncClouds` 就是这么传的）；`revealed` 才是"露出哪些"。
    const list = Array.from({ length: rows * columns }, (_, cellId) => {
        const point = gridLayout.hexGridViewPoint(Math.floor(cellId / columns), cellId % columns, rows, columns);
        return { cellId, x: point.x, y: point.y };
    });
    const revealed = list.map((cell) => cell.cellId).filter((cellId) => cellId !== 12);
    view.sync(list, new Set(revealed), [12]);

    assert.equal(view.pocketCount, 1, '12 号格被包围 ⇒ 应当认成一个洞');
    const pocket = view.pocketLayerNode!;
    // 四版口径：不再"洞格 + 六邻"铺 7 朵，而是**一洞一格一朵**（少放几朵）。
    const clouds = cloudNodes(pocket);
    assert.equal(clouds.length, 1, `一个洞格只该放一朵云，实际 ${clouds.length}`);
    const node = clouds[0];
    const point = gridLayout.hexGridViewPoint(Math.floor(12 / columns), 12 % columns, rows, columns);
    assert.equal(node.position.x, point.x);
    // 云洞的 y 偏移必须**按它自己的倍率**算（写死 1.0 倍的值会让缩小后的云整体往下漂）。
    const scale = TERRITORY_CLOUD_SCALE * cloud.TERRITORY_CLOUD_POCKET_SCALE;
    assert.equal(
        node.position.y,
        point.y + gridLayout.HEX_GRID_CONTENT_LIFT + territoryCloudArtOffsetY(scale),
    );
    assert.ok(Math.abs(node.scale.x - scale) < 1e-9, `云洞云应缩到 ${scale}，实际 ${node.scale.x}`);
    assert.equal(frameName(node.getComponent(SpriteStub) as SpriteStub), 'cloud_body_0',
        '云洞里的云也必须是静止云体图（不轮播）');
    const pocketShadow = findNode(pocket.getChildByName('CloudShadow'), 'CloudPocketShadow_12');
    assert.ok(pocketShadow, '云洞云同样要有影子');
    assert.deepEqual(pocketShadow!.position, node.position, '影子与云体同坐标（两张同画布图贴同一处）');

    // 洞格在**正常云层**里那朵要收起来：否则洞心叠两朵（正常层那朵被邻格 15px 啃一圈，更亮）。
    const parked = findNode(view.layerNode, 'Cloud_12');
    assert.ok(parked, '洞格仍然要建节点（解锁时它负责播消散）');
    assert.equal(parked!.active, false, '洞格的正常云必须收起，由云洞层那朵顶班');

    // 每帧对齐 MapLayer 的世界变换：地图滑动 / 推镜时云洞得跟着走。
    // 🔴 还要**加上内容层偏移**（`territoryMapContentShiftY` = 150）—— 那 150px 是
    //    `applyContentShift` 写在 `MapLayer` 的**孩子**上的，`MapLayer.worldPosition` 里没有它；
    //    少了这一项，云洞整层比地块低 150（≈ 一排半格，实机就是"云没落在洞里"）。
    const shift = layout.territoryMapContentShiftY();
    assert.ok(shift > 0, '内容层偏移必须是正的（否则下面那条断言等于没测）');
    mapLayer.setWorldPosition({ x: -120, y: 340, z: 0 });
    mapLayer.setWorldScale({ x: 1.35, y: 1.35, z: 1 });
    view.step(1 / 60);
    assert.deepEqual(pocket.worldPosition, { x: -120, y: 340 + shift * 1.35, z: 0 },
        '云洞层的世界坐标 = MapLayer 的世界坐标 + 内容层偏移（按世界缩放换算）');
    assert.deepEqual(pocket.worldScale, { x: 1.35, y: 1.35, z: 1 });

    // 洞补上（那一格解锁了）⇒ 云洞清空，那朵云**原地转成消散**（不是瞬间消失）。
    // 🔴 2026-10-26 六版：老口径是 rebuildPocket 把云连节点一起销毁、同时正常层那朵以 1.0 倍点亮
    //    ⇒ 实机看到"一朵小云凭空没 + 一朵大云凭空来"。现在消散由云洞那朵自己播（倍率仍是 0.6）。
    view.sync(list, new Set(list.map((cell) => cell.cellId)), []);
    assert.equal(view.pocketCount, 0);
    assert.equal(cloudNodes(pocket).length, 0, '没有洞就不该在云洞层留着云');
    assert.equal(findNode(pocket.getChildByName('CloudShadow'), 'CloudPocketShadow_12'), null);
    assert.equal(parked!.active, false, '洞格解锁后正常层那朵仍是收着的（消散交给云洞那朵自己播）');
    assert.equal(view.dissolvingCount, 1, '洞格解锁也必须播一段消散');
    const escapee = findNode(view.dissolveLayerNode, 'CloudPocket_12');
    assert.ok(escapee, '云洞那朵要挪进消散层原地散，不许跟着洞一起被销毁');
    assert.ok(Math.abs(escapee!.scale.x - scale) < 1e-9,
        `消散起手仍是云洞那档倍率（${scale}），不许"啪"地变成 1.0 倍，实际 ${escapee!.scale.x}`);
    assert.equal(frameName(escapee!.getComponent(SpriteStub) as SpriteStub), 'cloud_body_0',
        '起手是整朵云（先炸一下再裂）');

    // 散完 ⇒ 借来的临时节点销毁（云洞层会自己重建），正常层那朵继续收着。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS);
    assert.equal(view.dissolvingCount, 0);
    assert.equal(findNode(view.dissolveLayerNode, 'CloudPocket_12'), null,
        '云洞借来的节点散完必须销毁，否则图外飘一颗孤儿云');
    assert.equal(parked!.active, false);
});

test('视图：铺满层建在挡云遮罩里（一起吃 15px 擦除）+ 影子在影子层里，全解锁后整层关闭', () => {
    const { view } = stage();
    const mod = viewModule();
    const keepOut = view.keepOutNode!;
    const fill = keepOut.getChildByName(mod.TERRITORY_CLOUD_FILL_NODE);
    assert.ok(fill, '铺满层必须建在 CloudKeepOut 里');

    // 🔴 跨层顺序：**影子层必须是遮罩的第 0 个孩子**，两个云体层都排在它之后。
    //    老口径"每层各带一个影子分组、分组在层内第 0"只保证层内顺序 ——
    //    `CloudLayer` 的影子会画到 `CloudFillLayer` 的云体之上，实机是一条灰云带（2026-10-26 截图）。
    const order = keepOut.children.map((child: NodeStub) => child.name);
    assert.deepEqual(order, [
        mod.TERRITORY_CLOUD_SHADOW_NODE,
        mod.TERRITORY_CLOUD_FILL_NODE,
        mod.TERRITORY_CLOUD_LAYER_NODE,
    ], `遮罩下的顺序必须是「影子层 → 铺满云体 → 真实云体」，实际 ${order.join('/')}`);
    assert.ok(view.shadowLayerNode, '影子层必须建出来');
    // 两层影子都住在影子层里（各自可清空，互不干扰）。
    const shadowLayer = view.shadowLayerNode!;
    assert.equal(view.shadowGroupNode!.parent, shadowLayer, '真实云层的影子要住在影子层里');
    assert.equal(view.fillShadowGroupNode!.parent, shadowLayer, '铺满层的影子也要住进影子层');
    assert.notEqual(view.shadowGroupNode, view.fillShadowGroupNode, '两个影子子分组必须分开');

    view.setFillArea(900, 1200, 4, 5);
    assert.ok(view.fillCloudCount > 0, '留白那圈必须有云');
    assert.equal(view.fillShadowCount, view.fillCloudCount, '每朵铺满云一个影子（缺了说明美术没给 shadow 图）');
    // 同一个尺寸再调一次不重建（`renderMap` 每秒都在调）。
    const count = view.fillCloudCount;
    view.setFillArea(900, 1200, 4, 5);
    assert.equal(view.fillCloudCount, count);
    const shadow = view.fillShadowGroupNode;
    assert.equal(shadow!.children.length, view.fillShadowCount, '影子都挂在影子层的铺满子分组里');

    // 还差一格没解锁 ⇒ 铺满层继续展示。
    const total = 4 * 5;
    const partial = new Set<number>();
    for (let cellId = 0; cellId < total - 1; cellId += 1) partial.add(cellId);
    const list = Array.from({ length: total }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
    view.sync(list, partial);
    assert.equal(view.fillVisible, true, '没全解锁就得留着那圈雾');
    // 全解锁 ⇒ 走一条 0.5s 淡出，淡完才整层关掉（连影子一起），否则地图边缘还挂着一圈灰。
    view.sync(list, new Set(list.map((cell) => cell.cellId)));
    assert.equal(view.fillVisible, true, '刚起跑那一帧还在（正在淡，不是"啪"一下没）');
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false, '淡完之后铺满层必须关掉');
    assert.equal(shadow!.active, false, '影子分组要跟着一起关');
});

/**
 * 🔴 2026-10-27 用户：「该账号 chapter_01 的地块全部解锁后，云团没有消失」。
 *
 * 根因不是没关，而是**关不掉**：老判据是 `revealed.size >= rows × columns`，
 * 可 `revealed`（`territoryRevealedCells`）只可能包含**有内容的格** + 已占领格 ——
 * 20×20 的章节图里 117~262 格配了内容、剩下 138~283 格什么都没有，
 * 那些格永远不会出现在 `revealed` 里 ⇒ 400 这个分母**一辈子达不到**。
 *
 * 下面两条用「400 格 / 262 个内容格」复现真实配比。
 */
test('🔴 全解锁判据按「有内容的格」算，不是 rows × columns（否则云团永远不消失）', () => {
    const { view } = stage();
    const rows = 20;
    const columns = 20;
    view.setFillArea(1800, 1800, rows, columns);
    // 真实配比：chapter_01 = 152 站点 + 109 随机候选 + 起始格 = 262 格有内容。
    const content = Array.from({ length: 262 }, (_, index) => ({ cellId: index, x: 0, y: 0 }));
    const revealed = new Set(content.map((cell) => cell.cellId).concat([300, 301]));
    view.sync(content, revealed);
    assert.ok(revealed.size < rows * columns, '前提：真实配比凑不满 400');
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false,
        '有内容的格全露出来了 ⇒ 铺满层必须收掉（拿 rows×columns 当分母就永远关不掉）');
});

test('真·没解锁完时铺满层不许提前关（差一格也不关）', () => {
    const { view } = stage();
    view.setFillArea(1800, 1800, 20, 20);
    const content = Array.from({ length: 262 }, (_, index) => ({ cellId: index, x: 0, y: 0 }));
    const revealed = new Set(content.map((cell) => cell.cellId));
    // 少露最后一格 ⇒ 还有东西没探索，云得留着。
    revealed.delete(content[content.length - 1].cellId);
    view.sync(content, revealed);
    assert.equal(view.fillVisible, true, '还差一格没露出来，铺满层必须还在');
});

test('一格内容都没有的退化图：不回退成「一进去就把云全撤了」', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.sync([], new Set([0, 1, 2]));
    assert.equal(view.fillVisible, true, '没有内容格时老判据（revealed < totalCells）说了算');
});

// ============================================================
// 铺满层的淡出时间轴（2026-10-27 用户：「给铺满层挂 UIOpacity 走一条淡出时间轴」）
// ============================================================

test('铺满层退场曲线：起手全不透明 → 单调变透 → 到点全透（纯函数、脏参数不产 NaN）', () => {
    assert.equal(territoryCloudFillOpacity(0), 1, '起手必须全不透明');
    assert.equal(territoryCloudFillOpacity(-1), 1, '负数（还没起跑）按全不透明');
    assert.equal(territoryCloudFillOpacity(Number.NaN), 1, 'NaN 按全不透明，不许产出 NaN');
    assert.equal(territoryCloudFillOpacity(TERRITORY_CLOUD_FILL_FADE_SECONDS), 0, '到点必须全透');
    assert.equal(territoryCloudFillOpacity(TERRITORY_CLOUD_FILL_FADE_SECONDS * 10), 0, '超时也是全透');
    let previous = 1;
    for (let step = 1; step < 20; step += 1) {
        const value = territoryCloudFillOpacity((TERRITORY_CLOUD_FILL_FADE_SECONDS * step) / 20);
        assert.ok(Number.isFinite(value), '退场曲线不许产出 NaN');
        assert.ok(value < previous, `第 ${step} 步必须比上一步更透（${value} >= ${previous}）`);
        assert.ok(value > 0, `第 ${step} 步还没到点，不该已经全透`);
        previous = value;
    }
    // 快起慢收：前半段掉的比后半段多（与消散同一条缓动，读起来才像"雾一下就散了"）。
    const half = territoryCloudFillOpacity(TERRITORY_CLOUD_FILL_FADE_SECONDS / 2);
    assert.ok(1 - half > half, `半程应该已经掉了大半（剩 ${half}）`);
    // 刻意与最后一朵云的消散同长 ⇒ 边界那圈雾与那朵云一起散尽。
    assert.equal(TERRITORY_CLOUD_FILL_FADE_SECONDS, TERRITORY_CLOUD_DISSOLVE_SECONDS,
        '铺满层退场时长必须与消散同长（比消散长会"云散完了还挂着一层灰"）');
});

test('雾散扩散波：波次 = 到最近地块的距离归一化（脏参数当"贴着地块"）', () => {
    assert.equal(territoryCloudFillWaveOrder(0, 100), 0, '贴着地块 = 波次 0');
    assert.equal(territoryCloudFillWaveOrder(100, 100), 1, '最远 = 1');
    assert.equal(territoryCloudFillWaveOrder(50, 100), 0.5, '线性归一化');
    assert.equal(territoryCloudFillWaveOrder(200, 100), 1, '越界夹到 1');
    // 脏距离一律当"贴着地块"：宁可早散一点，也不要 NaN 让某朵雾永远停在半透明上。
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -5]) {
        assert.equal(territoryCloudFillWaveOrder(bad, 100), 0, `distance=${bad} 应退回 0`);
    }
    // 分母非法 ⇒ 不归一化（否则 = 除 0 / NaN）。
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(territoryCloudFillWaveOrder(50, bad), 0, `maxDistance=${bad} 不许当分母`);
    }
});

test('雾散扩散波：近端先起、还更快；远端后起、更慢，但都收在整条时长以内', () => {
    const total = TERRITORY_CLOUD_DOLLY_FADE_SECONDS;
    const near = territoryCloudFillWaveWindow(0, total);
    const far = territoryCloudFillWaveWindow(1, total);
    assert.equal(near.delay, 0, '贴着地块的那朵立刻起淡');
    assert.ok(far.delay > 0, '最远那朵要等一会儿才轮到它');
    assert.ok(far.duration > near.duration, '远的淡得慢（窗口更长）');
    // 🔴 远端刚好在整条时长收尾 —— 收工那一帧才 `active = false`，只要有一朵没淡完，
    //    它就会跟着节点一起"啪"掉。
    assert.ok(Math.abs(far.delay + far.duration - total) < 1e-9, `远端应收到 ${total}`);
    assert.ok(near.delay + near.duration < total, '近端更早就淡完了（这才是"先后"）');
    // 两个手感参数的方向：推迟必须小于近端缩短，否则窗长随距离**变短**、远的反而更快。
    assert.ok(TERRITORY_CLOUD_FILL_WAVE_SPREAD > 0 && TERRITORY_CLOUD_FILL_WAVE_SPREAD < 1,
        '近端缩短必须是 (0,1)');
    assert.ok(TERRITORY_CLOUD_FILL_WAVE_STAGGER > 0 && TERRITORY_CLOUD_FILL_WAVE_STAGGER < 1,
        '远端推迟必须是 (0,1)');
    assert.ok(TERRITORY_CLOUD_FILL_WAVE_STAGGER < TERRITORY_CLOUD_FILL_WAVE_SPREAD,
        '推迟 >= 近端缩短 ⇒ 远的比近的淡得更快，方向就反了');
    // 单调：（起淡越来越晚、窗长越来越长、右端不越界）。
    let previousDelay = -1;
    let previousDuration = -1;
    for (let index = 0; index <= 10; index += 1) {
        const window = territoryCloudFillWaveWindow(index / 10, total);
        assert.ok(window.delay >= previousDelay, `第 ${index} 步起淡不该提前`);
        assert.ok(window.duration >= previousDuration, `第 ${index} 步窗长不该变短`);
        assert.ok(window.delay + window.duration <= total + 1e-9,
            `第 ${index} 步右端超出整条时长（${window.delay + window.duration} > ${total}）`);
        assert.ok(window.duration > 0, `第 ${index} 步窗长必须为正`);
        previousDelay = window.delay;
        previousDuration = window.duration;
    }
    // 脏总时长 ⇒ 退化成一帧淡完，绝不产出 NaN。
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        const window = territoryCloudFillWaveWindow(0.5, bad);
        assert.ok(Number.isFinite(window.delay) && Number.isFinite(window.duration),
            `totalSeconds=${bad} 不许产出 NaN`);
        assert.equal(window.delay, 0, '没有时长就谈不上推迟');
    }
});

test('雾散扩散波：同一时刻**近的比远的更透**，整条走完一律为 0', () => {
    const total = TERRITORY_CLOUD_DOLLY_FADE_SECONDS;
    assert.equal(territoryCloudFillWaveOpacity(-1, 0, total), 1, '还没起跑必须全不透明');
    assert.equal(territoryCloudFillWaveOpacity(Number.NaN, 1, total), 1, '脏秒数不许产出 NaN');
    const quarter = total / 4;
    const near = territoryCloudFillWaveOpacity(quarter, 0, total);
    const middle = territoryCloudFillWaveOpacity(quarter, 0.5, total);
    const far = territoryCloudFillWaveOpacity(quarter, 1, total);
    assert.ok(near < middle && middle < far,
        `近→远必须越来越不透明（近 ${near} / 中 ${middle} / 远 ${far}）`);
    assert.equal(far, 1, '最远那朵这一刻还没起淡 ⇒ 仍是全不透明（这就是"扩散"边界外的雾）');
    // 整条走完：每一朵都是 0（收工那一帧才 `active = false`，不许留半透明残影）。
    for (const order of [0, 0.3, 0.7, 1]) {
        assert.equal(territoryCloudFillWaveOpacity(total, order, total), 0, `order=${order} 到点必须全透`);
        assert.equal(territoryCloudFillWaveOpacity(total * 3, order, total), 0, `order=${order} 超时也是全透`);
    }
});

test('视图：全解锁后铺满层淡出 0.5s 再收，不透明度与 active 都在时间轴上', () => {
    const { view } = stage();
    const mod = viewModule();
    view.setFillArea(900, 1200, 4, 5);
    const list = Array.from({ length: 20 }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
    const all = new Set(list.map((cell) => cell.cellId));
    const fill = view.keepOutNode!.getChildByName(mod.TERRITORY_CLOUD_FILL_NODE)!;
    const shadow = view.fillShadowGroupNode!;
    /** 铺满层所有云体的 alpha（0~255）。 */
    const alphas = (): number[] => cloudNodes(fill)
        .map((node) => (node.getComponent(SpriteStub) as SpriteStub).color.a);

    // 没起跑之前：不透明度是默认的 255，而且**不许挂 UIOpacity**（逐朵写 `Sprite.color.a`，
    // 几百个组件会让节点退出静态合批）。
    view.sync(list, new Set());
    assert.equal(fill.getComponent(UIOpacityStub), null, '铺满层不许再用 UIOpacity（逐朵走 color.a）');
    assert.ok(alphas().every((alpha) => alpha === 255), '没淡过时全是默认全不透明');

    // ① 起跑那一帧：还在画、而且还是全不透明。
    view.sync(list, all);
    assert.equal(view.fillVisible, true, '刚起跑还在画（正在淡）');
    assert.equal(view.fillOpacityValue, 1, '起手是全不透明');

    // ② 中途：**逐朵**各自变透（不是整层一个 alpha），云体与影子同一个读数。
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS / 2);
    const mid = alphas();
    assert.ok(mid.every((alpha) => alpha >= 0 && alpha < 255), `中途该是半透明，实际 ${mid.slice(0, 6)}`);
    assert.ok(new Set(mid).size > 1, '🔴 逐朵错峰：中途不该是"整层一个 alpha"');
    const shadowAlphas = shadow.children.map((node) => (node.getComponent(SpriteStub) as SpriteStub).color.a);
    assert.deepEqual(shadowAlphas, mid, '影子与云体必须同步淡（只淡云体会浮一层灰）');

    // ③ 淡完：整层收掉（active=false），不透明度归 0。
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false, '淡完必须收掉');
    assert.equal(shadow.active, false, '影子分组跟着一起收');
    assert.ok(alphas().every((alpha) => alpha === 0), '收掉时每一朵都必须归 0');
    // ④ 收掉之后再 sync 不许又亮起来（renderMap 会反复调）。
    view.sync(list, all);
    assert.equal(view.fillVisible, false, '已经收工了就不许再亮');
});

test('视图：铺满层**逐朵**错峰 —— 靠近地块的先散、留白那圈最后才散（扩散感）', () => {
    const { view } = stage();
    const mod = viewModule();
    view.setFillArea(900, 1200, 4, 5);
    // 地块只占左边一小块 ⇒ 铺满层里"近"和"远"差得很明显。
    const list = [{ cellId: 0, x: -300, y: 0 }, { cellId: 1, x: -200, y: 0 }];
    view.sync(list, new Set([0, 1]));
    const fill = view.keepOutNode!.getChildByName(mod.TERRITORY_CLOUD_FILL_NODE)!;
    const nodes = cloudNodes(fill);
    assert.ok(nodes.length > 8, `前提：铺满层要铺出足够多的雾（实际 ${nodes.length}）`);
    assert.equal(view.fillWaveCount, nodes.length, '每一朵都要编出波次（否则退回整层一条曲线）');

    const distance = (node: NodeStub): number => Math.min(
        ...list.map((cell) => Math.hypot(node.position.x - cell.x, node.position.y - cell.y)),
    );
    const sorted = [...nodes].sort((a, b) => distance(a) - distance(b));
    const nearest = sorted[0];
    const farthest = sorted[sorted.length - 1];
    const alphaOf = (node: NodeStub): number => (node.getComponent(SpriteStub) as SpriteStub).color.a;

    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS / 4);
    assert.ok(alphaOf(nearest) < alphaOf(farthest),
        `🔴 近的必须先散（近 ${alphaOf(nearest)} / 远 ${alphaOf(farthest)}）`);
    assert.equal(alphaOf(farthest), 255, '最远那朵这一刻还没轮到它起淡');
    assert.ok(alphaOf(nearest) > 0, '四分之一处近端还没散尽（否则读不出"逐渐"）');

    // 收工：每一朵都归 0，然后整层才收 —— 不许留半透明残影。
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false);
    assert.ok(nodes.every((node) => alphaOf(node) === 0), '收工时每一朵都得淡到 0');
});

test('视图：淡出中途回退（撤销解锁）⇒ 立刻复原成全不透明，不走动画', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    const list = Array.from({ length: 20 }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
    const all = new Set(list.map((cell) => cell.cellId));
    view.sync(list, all);
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS / 2);
    assert.ok(view.fillOpacityValue < 1, '前提：已经淡掉一半');

    // 服务端快照改口径 / 撤销解锁 ⇒ 这一格又没露出来。
    const partial = new Set(all);
    partial.delete(list[0].cellId);
    view.sync(list, partial);
    assert.equal(view.fillOpacityValue, 1, '回退不该有动画，立刻复原成全不透明');
    assert.equal(view.fillVisible, true, '回退后铺满层要重新展示');
});

test('视图：淡完后再重建铺满层（换章 / 尺寸变了）不许把雾又点亮', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    const list = Array.from({ length: 20 }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
    view.sync(list, new Set(list.map((cell) => cell.cellId)));
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false, '前提：已经淡完收工');
    // 换章后内容层尺寸变了 ⇒ 铺满层重建（`rebuildFill` 会重新写 active）。
    view.setFillArea(1200, 1600, 6, 7);
    view.sync(list, new Set(list.map((cell) => cell.cellId)));
    assert.equal(view.fillVisible, false, '重建后仍是收工状态（active 不许被 rebuildFill 顶回来）');
});

test('视图：`setFillOccupied` 会重算铺满格点 —— 有真实云的格不重复铺，其余空格必须补上', () => {
    const { view } = stage();
    const rows = 5;
    const columns = 5;
    // 先只有尺寸：铺满层自己铺满整张格网（含所有空格）。
    view.setFillArea(900, 1200, rows, columns);
    const all = view.fillCloudCount;
    assert.ok(all > rows * columns, `铺满层至少要覆盖整张格网（${all} <= ${rows * columns}）`);

    const point = (cellId: number) => gridLayout.hexGridViewPoint(
        Math.floor(cellId / columns), cellId % columns, rows, columns,
    );
    const fillLayer = view.keepOutNode!.getChildByName(viewModule().TERRITORY_CLOUD_FILL_NODE)!;
    const at = (cellId: number): NodeStub[] => {
        const p = point(cellId);
        return cloudNodes(fillLayer).filter((node) => node.position.x === p.x
            && node.position.y === p.y + gridLayout.HEX_GRID_CONTENT_LIFT + territoryCloudArtOffsetY(TERRITORY_CLOUD_SCALE));
    };
    assert.equal(at(6).length, 1, '没有真实云的格，铺满层要补一朵');

    // 6 号格交给真实云层（有内容）⇒ 铺满层那一朵必须撤掉，否则同一处两朵、更亮。
    view.setFillOccupied([6, 7]);
    assert.equal(view.fillCloudCount, all - 2, '有真实云的格不许重复铺');
    assert.equal(at(6).length, 0, '6 号格已经由真实云层负责，铺满层要让开');
    assert.equal(at(8).length, 1, '别的空格不受影响');
    // 同集合再喂一次不重建（每帧都可能调）。
    const count = view.fillCloudCount;
    view.setFillOccupied([6, 7]);
    assert.equal(view.fillCloudCount, count);
});

// ============================================================
// 资源：拆图产物
// ============================================================

/** PNG 头里 IHDR 的第 1、2 个字段就是宽高（大端 32 位），不用解像素。 */
function pngSize(path: string): { width: number; height: number } {
    const head = readFileSync(path);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

test('美术拆图：云体 / 影子是**两张同画布** 200×240 的图，且都按 trimType=none 导入', () => {
    const dir = 'assets/resources/image/territory/cloud';
    // 原图留着当母版（拆图脚本的输入；别再手改它们）。
    for (let index = 0; index < 5; index += 1) {
        assert.ok(readFileSync(`${dir}/cloud_idle_${index}.png`).length > 0, `缺 cloud_idle_${index}.png`);
    }
    for (let index = 0; index < 2; index += 1) {
        assert.ok(readFileSync(`${dir}/cloud_dissolve_${index}.png`).length > 0,
            `缺 cloud_dissolve_${index}.png`);
    }

    const pairs = [
        ['cloud_body_0', 'cloud_shadow_0'],
        ['cloud_dissolve_body_0', 'cloud_dissolve_shadow_0'],
        ['cloud_dissolve_body_1', 'cloud_dissolve_shadow_1'],
    ];
    for (const [body, shadow] of pairs) {
        const bodySize = pngSize(`${dir}/${body}.png`);
        const shadowSize = pngSize(`${dir}/${shadow}.png`);
        assert.deepEqual(bodySize, { width: TERRITORY_CLOUD_ART_WIDTH, height: TERRITORY_CLOUD_ART_HEIGHT },
            `${body} 的画布必须是 ${TERRITORY_CLOUD_ART_WIDTH}×${TERRITORY_CLOUD_ART_HEIGHT}`);
        assert.deepEqual(shadowSize, bodySize,
            `${shadow} 必须与 ${body} 同画布 —— 不同画布就摆不齐，又得回去算 offset`);
        for (const name of [body, shadow]) {
            const meta = JSON.parse(read(`${dir}/${name}.png.meta`)) as any;
            const sprite = (Object.values(meta.subMetas) as any[])
                .find((sub) => sub.importer === 'sprite-frame');
            assert.ok(sprite, `${name}.meta 缺 sprite-frame 子资源（编辑器没导入）`);
            // 自动裁剪会把全透明的边切掉 ⇒ rect/offset 变了 ⇒ 体 / 影又错位。
            assert.equal(sprite.userData.trimType, 'none', `${name} 必须 trimType=none`);
            assert.equal(sprite.userData.rawWidth, TERRITORY_CLOUD_ART_WIDTH);
            assert.equal(sprite.userData.rawHeight, TERRITORY_CLOUD_ART_HEIGHT);
        }
    }

    // 图集口径：`image/territory/` 树最外层那一份 pac 递归覆盖子目录，父子同放会打架。
    assert.equal(existsSync(`${dir}/auto-atlas.pac`), false, 'cloud/ 目录不许再放自己的 auto-atlas.pac');
    assert.equal(existsSync('assets/resources/image/territory/auto-atlas.pac'), true,
        'image/territory 树最外层那份 auto-atlas 必须在（同帧的云才能合批）');
    assert.ok(existsSync('tools/split_cloud_layers.py'), '拆图脚本不见了（美术换图后要重拆）');
});

// ============================================================
// 反向守卫：被推翻的做法不许回来
// ============================================================

test('四版口径：运行时刻 rect 那套 / 云洞正像遮罩 / 补片 都已整条删除（不留回头路）', () => {
    const modelSource = stripComments(read('assets/script/app/territory/model/TerritoryCloud.ts'));
    assert.doesNotMatch(modelSource, /territoryCloudBandRect/,
        '切片换算必须删掉（`SpriteFrame.rect` 是自上而下的，按"原点在左下"推 y 会把体/影互换）');
    assert.doesNotMatch(modelSource, /TERRITORY_CLOUD_(BODY|SHADOW)_BAND/, '切片行号常量也要删掉');
    assert.doesNotMatch(modelSource, /territoryCloudPocketPatchPoints/, '云洞补片函数应已删除（改成每格一朵 + 缩小）');
    assert.doesNotMatch(modelSource, /territoryCloudIdleFrame|TERRITORY_CLOUD_IDLE_FRAME_SECONDS/,
        '待机轮播已退役（未解锁状态是一张静止图）');

    const viewSource = stripComments(read('assets/script/app/territory/view/TerritoryCloudView.ts'));
    assert.doesNotMatch(viewSource, /new SpriteFrame|originalSize|\.packable/,
        '视图不许再造切片帧（一个 rect 都不该算）');
    assert.doesNotMatch(viewSource, /PocketPatch|pocketMask|pocketGraphics/,
        '云洞层的正像遮罩 / 补片也要删掉（会把云裁成白色六边形）');
    assert.ok(/TERRITORY_CLOUD_POCKET_SCALE/.test(viewSource), '云洞的缩小倍率必须走模型常量');
    assert.ok(/TERRITORY_CLOUD_SHADOW_NODE/.test(viewSource), '影子分组名要是导出常量');
});

// ============================================================
// 接线守卫
// ============================================================

test('接线：renderMap 按「格子 → 云 → 翻格」的顺序，update 每帧推进云', () => {
    const source = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    const renderAt = source.indexOf('renderMap(input: ITerritoryMapRenderInput): void {');
    assert.ok(renderAt > 0, 'renderMap 不见了');
    const body = source.slice(renderAt, renderAt + 1200);
    const order = ['this.syncGrid(input);', 'this.syncClouds(input);', 'this.syncFlip(input);']
        .map((call) => body.indexOf(call));
    for (const [index, at] of order.entries()) assert.ok(at >= 0, `renderMap 里缺第 ${index} 步`);
    assert.ok(order[0] < order[1] && order[1] < order[2], 'renderMap 顺序必须是 格子 → 云 → 翻格');
    assert.ok(/update\(dt: number\)[\s\S]{0,400}this\.clouds\.step\(dt\);/.test(source),
        'update 里必须推进云（否则消散永远播不完）');
    // 换章重建：云必须跟着复位，否则旧图的云会飘在新图的格位上、挡云区也留着旧格。
    assert.ok(/this\.clouds\.reset\(\);/.test(source), 'syncGrid 的换图分支必须 clouds.reset()');
    assert.ok(/this\.clouds\.attach\(this\.gridLayer\);/.test(source),
        'initialize 里必须 attach 云层（懒建会让层序变成隐式时序依赖）');
    // 🔴 2026-10-26：铺满层只知道尺寸、不知道「哪些格已经有真实云」⇒ 必须由页面在换图时喂进去。
    //    少了这条，格网里的空格要么叠两朵云（更亮）、要么一格都没有（露出底图）。
    assert.ok(/this\.clouds\.setFillOccupied\(/.test(source),
        'syncClouds 必须把云格集合喂给铺满层（`setFillOccupied`），否则格内的空格没有云');
});

test('接线：页面按**四个**前缀分组加载（混在一起排序会让消散帧跑到待机帧前面）', () => {
    const source = stripComments(read('assets/script/app/main/MainTerritoryMap.ts'));
    assert.ok(/TERRITORY_CLOUD_ART_ROOT/.test(source), '页面没引用云图目录常量');
    assert.ok(/startsWith\(prefix\)/.test(source), '必须按前缀分组，不能一把 sort');
    assert.ok(/setCloudFrames\(\{/.test(source), '没把四组帧（体 / 影 / 消散体 / 消散影）注入视图');
    for (const prefix of ['cloud_body_', 'cloud_shadow_', 'cloud_dissolve_body_', 'cloud_dissolve_shadow_']) {
        assert.ok(source.includes(prefix), `页面没有按 \`${prefix}\` 分组（云体 / 影子必须分开注入）`);
    }
    // 大前缀会连影子一起捞：`cloud_dissolve_` 同时命中 `cloud_dissolve_shadow_0`。
    assert.doesNotMatch(source, /'(cloud_idle|cloud_dissolve)_'/, '不许再用大前缀分组');
});

// ============================================================
// 全解锁「镜头散场」（2026-10-27 用户）
// ============================================================
//
// 原话：「优化云层消失效果，拉高摄像机，观看云层逐渐消失的过程，屏幕内囊括了所有地块，
//        云雾消失后重新拉进镜头，回到初始高度」
//
// 三段：拉远 1.1s（抬到整张图入画）→ 淡出 2s（在拉远视角里慢慢淡）→ 拉回 0.7s。
// 2026-10-27 第二轮（用户）：「拉远 0.7s 改成 1.1s，雾淡阶段 1.4s 改成 2s」。

test('散场三段时长：1.1 / 2 / 0.7，总计 3.8s（淡出**不能**复用 0.5s 那条）', () => {
    assert.equal(TERRITORY_CLOUD_DOLLY_OUT_SECONDS, 1.1, '拉远 1.1s');
    assert.equal(TERRITORY_CLOUD_DOLLY_FADE_SECONDS, 2, '淡出 2s（要看得出"逐渐"）');
    assert.equal(TERRITORY_CLOUD_DOLLY_IN_SECONDS, 0.7, '拉回 0.7s');
    assert.equal(territoryCloudDollyTotalSeconds(), 3.8, '总时长 = 三段之和');
    // 🔴 两条时长各有各的约束，不许合并：0.5 是"没人看"时的默认值，且刻意与最后一朵云的
    //    消散同长；演出里必须放慢，否则"拉远看雾散"这个过程根本读不出来。
    assert.notEqual(TERRITORY_CLOUD_DOLLY_FADE_SECONDS, TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(TERRITORY_CLOUD_DOLLY_FIT_MARGIN, 0.94, '四周留 6% 呼吸感');
});

test('拉远曲线：0 → 1（easeOut）→ 恒 1 → 1 → 0（对称）；越界 / 脏值一律 0', () => {
    const total = territoryCloudDollyTotalSeconds();
    assert.equal(territoryCloudDollyZoom(0), 0, '起手必须还是初始高度');
    assert.equal(territoryCloudDollyZoom(TERRITORY_CLOUD_DOLLY_OUT_SECONDS), 1, '拉远到位 = 整张图入画');
    assert.equal(territoryCloudDollyZoom(TERRITORY_CLOUD_DOLLY_OUT_SECONDS + 0.7), 1, '淡出全程都停在最远处');
    assert.equal(territoryCloudDollyZoom(total), 0, '收工 = 回到初始高度');
    assert.equal(territoryCloudDollyZoom(total * 10), 0, '超时也不许留在远处');
    assert.equal(territoryCloudDollyZoom(-1), 0, '负数（还没起跑）按初始高度');
    assert.equal(territoryCloudDollyZoom(Number.NaN), 0, 'NaN 不许污染镜头倍率');

    // 回程对称：`1 - easeOut` ⇒ 末段慢、不会"啪"一下砸回原位。
    const halfIn = TERRITORY_CLOUD_DOLLY_OUT_SECONDS + TERRITORY_CLOUD_DOLLY_FADE_SECONDS
        + TERRITORY_CLOUD_DOLLY_IN_SECONDS / 2;
    const atHalf = territoryCloudDollyZoom(halfIn);
    assert.ok(atHalf > 0 && atHalf < 1, `回程半程应在 (0,1)，实际 ${atHalf}`);
    assert.ok(Math.abs(atHalf - (1 - territoryCloudDollyZoom(TERRITORY_CLOUD_DOLLY_OUT_SECONDS / 2))) < 1e-9,
        '拉远与拉回必须是同一条缓动的镜像');

    // 单调：拉远段只增、拉回段只减（中间不许抖）。
    let previous = -1;
    for (let index = 0; index <= 14; index += 1) {
        const value = territoryCloudDollyZoom((TERRITORY_CLOUD_DOLLY_OUT_SECONDS * index) / 14);
        assert.ok(value >= previous, `拉远段第 ${index} 步不该回落（${value} < ${previous}）`);
        previous = value;
    }
    previous = 2;
    for (let index = 0; index <= 14; index += 1) {
        const seconds = TERRITORY_CLOUD_DOLLY_OUT_SECONDS + TERRITORY_CLOUD_DOLLY_FADE_SECONDS
            + (TERRITORY_CLOUD_DOLLY_IN_SECONDS * index) / 14;
        const value = territoryCloudDollyZoom(seconds);
        assert.ok(value <= previous, `拉回段第 ${index} 步不该回升（${value} > ${previous}）`);
        previous = value;
    }
});

test('起淡时机：拉远**到位**那一下才起，早一帧都不行', () => {
    assert.equal(territoryCloudDollyFadeDue(0), false, '起手就淡 = 玩家还没看到全图');
    assert.equal(territoryCloudDollyFadeDue(TERRITORY_CLOUD_DOLLY_OUT_SECONDS - 0.01), false);
    assert.equal(territoryCloudDollyFadeDue(TERRITORY_CLOUD_DOLLY_OUT_SECONDS), true);
    assert.equal(territoryCloudDollyFadeDue(TERRITORY_CLOUD_DOLLY_OUT_SECONDS + 0.1), true,
        '之后一直算"该淡了"');
});

test('「整张图入画」倍率：只缩不放、尺寸含最外圈半格、非法入参退回 1', () => {
    const faceW = gridLayout.HEX_GRID_FACE_WIDTH;
    const faceH = gridLayout.HEX_GRID_FACE_HEIGHT;
    const mapWidth = 1800;
    const mapHeight = 1800;
    const viewport = { width: 720, height: 1112 };
    const expected = Math.min(
        viewport.width / (mapWidth + faceW),
        viewport.height / (mapHeight + faceH),
    ) * TERRITORY_CLOUD_DOLLY_FIT_MARGIN;
    const fit = territoryCloudDollyFitScale(mapWidth, mapHeight, viewport.width, viewport.height);
    assert.ok(Math.abs(fit - expected) < 1e-9, `倍率应是 ${expected}，实际 ${fit}`);
    assert.ok(fit < 1, '2000px 级的图放进 720×1112 视口，必然是缩小');
    // 包围盒量的是格心，最外圈地块的图还往外探半格 ⇒ 分母必须加一整格。
    const withoutFace = Math.min(viewport.width / mapWidth, viewport.height / mapHeight)
        * TERRITORY_CLOUD_DOLLY_FIT_MARGIN;
    assert.ok(fit < withoutFace, '把最外圈那半格算进去 ⇒ 倍率必须比"只按包围盒"更小');

    // 大视口 / 小图：只缩不放（否则会把图放大糊掉）。
    assert.equal(territoryCloudDollyFitScale(400, 400, 4000, 4000), 1, '图比视口小 ⇒ 不缩不放');
    // 脏参数绝不能让地图塌成 0（返回 1 = 不缩放）。
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assert.equal(territoryCloudDollyFitScale(bad, 1800, 720, 1112), 1, `mapWidth=${bad} 应退回 1`);
        assert.equal(territoryCloudDollyFitScale(1800, 1800, bad, 1112), 1, `viewport=${bad} 应退回 1`);
    }
});

test('视图：全图激活那一帧先演镜头 —— 雾要等拉远到位才起淡，且淡 2s', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.setDollyFitScale(0.6);
    const list = cells(3);
    view.sync(list, new Set([0, 1, 2]), [], () => true);

    assert.equal(view.dollyActive, true, '有拉远余量 ⇒ 必须先演镜头');
    assert.equal(view.dollyZoom, 0, '第一帧还在初始高度');
    assert.equal(view.fillVisible, true, '拉远还没到位，雾不许开始淡');
    assert.equal(view.fillFadeDuration, TERRITORY_CLOUD_FILL_FADE_SECONDS, '还没进演出档');

    view.step(TERRITORY_CLOUD_DOLLY_OUT_SECONDS - 0.02);
    assert.equal(view.fillVisible, true, '差 0.02s 也不许起淡');

    view.step(0.02);
    assert.equal(view.fillFadeDuration, TERRITORY_CLOUD_DOLLY_FADE_SECONDS, '起淡就要切到 2s');
    assert.equal(view.dollyZoom, 1, '此刻整张图已经入画');

    view.step(TERRITORY_CLOUD_DOLLY_FADE_SECONDS / 2);
    const half = view.fillOpacityValue;
    assert.ok(view.fillVisible, '半程还没淡完');
    assert.ok(half > 0 && half < 1, `半程应在 (0,1)，实际 ${half}`);

    view.step(TERRITORY_CLOUD_DOLLY_FADE_SECONDS / 2);
    assert.equal(view.fillVisible, false, '2s 到点必须淡完');
    assert.equal(view.dollyActive, true, '雾散完还要拉回镜头');

    view.step(TERRITORY_CLOUD_DOLLY_IN_SECONDS);
    assert.equal(view.dollyActive, false, '总时长到了就收工');
    assert.equal(view.dollyZoom, 0, '收工 = 回到初始高度（地图视图据此还原 MapLayer）');
});

test('视图：没有拉远余量（图本来就比视口小）⇒ 不演镜头，退回 0.5s 淡出', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.setDollyFitScale(1);
    view.sync(cells(3), new Set([0, 1, 2]), [], () => true);
    assert.equal(view.dollyActive, false, '没法拉远就别动镜头（否则是"原地不动 2.8 秒"）');
    assert.equal(view.fillFadeDuration, TERRITORY_CLOUD_FILL_FADE_SECONDS);
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false);
});

test('🔴 判据用「已激活」而不是 `revealed`：前沿看得见、还没开的格不许让云提前散', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.setDollyFitScale(0.6);
    const list = cells(3);
    // 三格全都"看得见"（`revealed` 全含）—— 前沿的随机候选格就是这样：能看见、还没买。
    const revealed = new Set([0, 1, 2]);
    view.sync(list, revealed, [], (cellId) => cellId !== 2);
    assert.equal(view.dollyActive, false, '还有一格没激活 ⇒ 不许开场');
    assert.equal(view.fillVisible, true, '🔴 用户报的就是这一条：还没激活完，雾已经散了');
    view.step(5);
    assert.equal(view.fillVisible, true, '再等也不会自己散（判据只看激活，不看时间）');

    // 最后一格激活 ⇒ 才开始。
    view.sync(list, revealed, [], () => true);
    assert.equal(view.dollyActive, true);
});

test('接线：`sync` 的第四个参数就是激活探针；不给探针才退回 `revealed` 口径', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    const list = cells(3);
    const revealed = new Set([0, 1, 2]);
    // 不传探针（老调用点）⇒ 退回 `revealed`：这是**兼容**路径，不是推荐路径。
    view.sync(list, revealed);
    view.step(TERRITORY_CLOUD_FILL_FADE_SECONDS);
    assert.equal(view.fillVisible, false, '老口径仍然认 `revealed`（兼容），但不是线上调用方式');

    const mapSource = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.ok(/this\.clouds\.sync\(this\.cloudCells, revealed, pockets,/.test(mapSource),
        '线上必须把激活探针传进去（第三个参数之后就是它）');
    assert.ok(/private isCellActivated\(cellId: number/.test(mapSource), '激活口径要有单独的方法');
    assert.ok(/progress\.isCellUnlocked\(cellId\) \|\| progress\.isOwned\(cellId\)/.test(mapSource),
        '激活 = 服务端允许点 / 已占领（都是服务端确认过的状态，判据不会死锁）');
});

test('回退 / 换章：演出立刻收，铺满层马上恢复全不透明（回退不带动画）', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.setDollyFitScale(0.6);
    const list = cells(3);
    view.sync(list, new Set([0, 1, 2]), [], () => true);
    // 跨过"拉远 1.1s"那一刻 ⇒ 雾已经在淡了（起淡前时长仍是默认 0.5s 档）。
    view.step(TERRITORY_CLOUD_DOLLY_OUT_SECONDS + 0.1);
    assert.equal(view.fillFadeDuration, TERRITORY_CLOUD_DOLLY_FADE_SECONDS, '前提：已经在淡了');

    view.sync(list, new Set([0, 1, 2]), [], (cellId) => cellId !== 1);
    assert.equal(view.dollyActive, false, '回退要把镜头演出一起收掉（否则地图卡在远处）');
    assert.equal(view.fillVisible, true, '雾要立刻回来');
    assert.equal(view.fillFadeDuration, TERRITORY_CLOUD_FILL_FADE_SECONDS, '时长也要退回默认档');
    assert.equal(view.fillOpacityValue, 1, '回退不带动画：立刻全不透明');

    // 换章（`reset`）同样清掉演出。
    view.sync(list, new Set([0, 1, 2]), [], () => true);
    view.step(0.8);
    view.reset();
    assert.equal(view.dollyActive, false, 'reset 必须把演出时钟清掉');
});

test('视图：演出进行中不接受新的倍率（半路改倍率会让镜头跳一下）', () => {
    const { view } = stage();
    view.setFillArea(900, 1200, 4, 5);
    view.setDollyFitScale(0.6);
    view.sync(cells(3), new Set([0, 1, 2]), [], () => true);
    view.setDollyFitScale(0.3);
    assert.equal(view.dollyScale, 0.6, '演出中写倍率必须被忽略');
    view.setDollyFitScale(Number.NaN);
    assert.equal(view.dollyScale, 0.6, '脏值也不许把倍率打成 1');
});

test('接线：MapLayer 用 (1+(fit-1)·zoom, zoom) 推镜头，输入锁与还原各只有一条路径', () => {
    const source = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.ok(/private stepCloudDolly\(\): void \{/.test(source), '缺散场镜头推进');
    assert.ok(/this\.clouds\.dollyZoom/.test(source) && /this\.clouds\.dollyScale/.test(source),
        '镜头要读云层那只表（同一只时钟才不会漂）');
    assert.ok(/this\.applyChestCamera\(1 \+ \(fit - 1\) \* zoom, zoom, this\.cloudDollyOrigin\)/.test(source),
        '倍率与对焦必须是同一条曲线插值：k: 1→fit、f: 0→1；对焦点覆盖成地图中心');
    assert.ok(/if \(!this\.chestCameraActive\) this\.captureChestCamera\(center\);/.test(source),
        '基准只量一次：开箱还在播时复用它的基准（动画中途量基准会把地图永久停偏）');
    assert.ok(/private mapCenterInOverlay\(\): Vec3 \| null/.test(source), '对焦点 = 地图包围盒中心');
    assert.ok(/this\.cloudDollyOrigin = center;/.test(source),
        '对焦点只取一次（镜头一动它每帧都在变，每帧重量就是反馈环）');
    assert.ok(/this\.setInputLocked\(true\)/.test(source), '推镜头时必须锁拖动（MapLayer 是 content）');
    // 收尾只留一条：`cameraBusy` 同时管开箱与散场，谁在播都不还原。
    assert.ok(/const cameraBusy = this\.chestView\?\.isPlaying === true \|\| this\.clouds\.dollyActive;/.test(source),
        '开箱与散场共用同一套镜头基准，还原判据必须同时看两边');
    // 散场要排在 `clouds.step` 之后：拿到的才是这一帧的拉远程度。
    const updateAt = source.indexOf('update(dt: number): void {');
    assert.ok(updateAt > 0);
    const updateBody = source.slice(updateAt, updateAt + 3000);
    assert.ok(updateBody.indexOf('this.clouds.step(dt);') < updateBody.indexOf('this.stepCloudDolly();'),
        'stepCloudDolly 必须排在 clouds.step 之后（否则镜头比雾晚一帧）');
});

test('接线：页面把**视口尺寸**注入视图（算不出倍率 ⇒ 退化成不演镜头）', () => {
    const source = stripComments(read('assets/script/app/main/MainTerritoryMap.ts'));
    assert.ok(/mapView\.setViewportSize\(viewport\.width, viewport\.height\)/.test(source),
        '页面要在量留白的同一处注入视口尺寸（同源刷新，换屏不会一个新一个旧）');
    const viewSource = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    assert.ok(/setViewportSize\(width: number, height: number\): void \{/.test(viewSource),
        '视图要有单独入口（不猜、不从 prefab 反查）');
    assert.ok(/territoryCloudDollyFitScale\(/.test(viewSource), '倍率必须走模型纯函数');
});

test('镜头对焦点可覆盖：k=1/f=0 与 O 无关，k=fit/f=1 时把 O 摆到屏幕正中', () => {
    // 独立复算 `applyChestCamera` 的两句（不依赖 `cc`）：
    //   target   = O × (1 - f) - k × (O - layerOrigin)
    //   position = basePos + (target - layerOrigin)
    //   屏幕位置 = target + k × (O - layerOrigin)      // 点 O 落在哪
    const layerOrigin = { x: -120, y: 340 };
    const basePos = { x: 5, y: -7 };
    const target = (O: { x: number; y: number }, k: number, f: number) => ({
        x: O.x * (1 - f) - k * (O.x - layerOrigin.x),
        y: O.y * (1 - f) - k * (O.y - layerOrigin.y),
    });
    const onScreen = (O: { x: number; y: number }, k: number, f: number) => {
        const t = target(O, k, f);
        return { x: t.x + k * (O.x - layerOrigin.x), y: t.y + k * (O.y - layerOrigin.y) };
    };
    // 对焦点换成地图中心（宝箱那套量的是格心）不影响"首末两帧回原位"这条。
    for (const O of [{ x: 0, y: 0 }, { x: 233, y: -451 }]) {
        const t = target(O, 1, 0);
        assert.deepEqual(
            { x: basePos.x + (t.x - layerOrigin.x), y: basePos.y + (t.y - layerOrigin.y) },
            basePos,
            'k=1 / f=0 必须是恒等变换（起手与收工都精确回原位）',
        );
        const spot = onScreen(O, 0.6, 1);
        assert.ok(Math.abs(spot.x) < 1e-9 && Math.abs(spot.y) < 1e-9,
            `k=fit / f=1 时对焦点必须落在覆盖层原点（屏幕正中），实际 ${spot.x},${spot.y}`);
    }
});
