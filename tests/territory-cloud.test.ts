import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as gridLayout from '../assets/script/core/hex/HexGridLayout';
import * as cloud from '../assets/script/app/territory/model/TerritoryCloud';
import {
    TERRITORY_CLOUD_ART_HEIGHT,
    TERRITORY_CLOUD_ART_OFFSET_Y,
    TERRITORY_CLOUD_ART_WIDTH,
    TERRITORY_CLOUD_DISSOLVE_HOLD,
    TERRITORY_CLOUD_DISSOLVE_SECONDS,
    TERRITORY_CLOUD_KEEP_OUT_PX,
    TERRITORY_CLOUD_POCKET_MAX_CELLS,
    TERRITORY_CLOUD_POCKET_SCALE,
    TERRITORY_CLOUD_SCALE,
    territoryCloudDissolveFrame,
    territoryCloudFillPoints,
    territoryCloudKeepOutPoints,
    territoryCloudPocketCells,
} from '../assets/script/app/territory/model/TerritoryCloud';

/**
 * 「章节地图未解锁云」判据（2026-10-23 第四版口径）
 * ------------------------------------------------------------------
 *   ① 云与地块留**固定 15px** 间隔、不遮挡地块 ⇒ 挡云遮罩 = 已解锁格面外扩 15px（反向 Mask）；
 *   ② 序列帧**只在消散时**用，未解锁是**静止图**（`cloud_body_0`，不轮播）；
 *   ③ 云体与影子是**两张同画布图**（`cloud_body_N` / `cloud_shadow_N`，美术层离线拆的），
 *      **所有影子画在所有云体之下**（`CloudShadow` 分组是层里的第 0 个孩子）；
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

test('挡云多边形：6 个点、逆时针、每条边**精确外移 15px**（不是靠顶点等比放大）', () => {
    const inset = TERRITORY_CLOUD_KEEP_OUT_PX;
    assert.equal(inset, 15, '用户口径是固定 15px');
    const face = faceOutline();
    const points = territoryCloudKeepOutPoints();
    assert.equal(points.length, face.length, '六边形就要 6 个点');

    // 每条边外移 inset ⇒ 用它自己的单位外法线量，两个端点到原边的距离都必须是 15。
    // ⚠️ 这条正是"按顶点等比放大"会挂的地方：那种做法在斜边上只有 ~7.5px。
    for (let index = 0; index < face.length; index += 1) {
        const a = face[index];
        const b = face[(index + 1) % face.length];
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
    // 方向对：外扩后的多边形一定把格面整个包住（面积更大）。
    const area = (list: readonly { x: number; y: number }[]): number => {
        let sum = 0;
        for (let index = 0; index < list.length; index += 1) {
            const p = list[index];
            const q = list[(index + 1) % list.length];
            sum += p.x * q.y - q.x * p.y;
        }
        return sum / 2;
    };
    assert.ok(area(points) > area(face), '外扩多边形的面积必须更大（方向反了就成缩小）');
});

test('挡云多边形：inset = 0 就是格面本身；脏参数不产出 NaN', () => {
    const zero = territoryCloudKeepOutPoints(0);
    const face = faceOutline();
    for (let index = 0; index < face.length; index += 1) {
        assert.ok(Math.abs(zero[index].x - face[index].x) < EPSILON);
        assert.ok(Math.abs(zero[index].y - face[index].y) < EPSILON);
    }
    // 脏参数分两条规矩，别混着断：
    //   ① 负数 ⇒ 按 0 处理（= 贴格面），不是"退回 15"；
    //   ② NaN / ±Infinity / 非数字 ⇒ 退回默认 15。
    // 共同点：绝不产出 NaN 坐标（NaN 会让整块遮罩静默消失，连报错都没有）。
    for (const dirty of [-5, -1e9]) {
        const points = territoryCloudKeepOutPoints(dirty);
        for (let index = 0; index < face.length; index += 1) {
            assert.ok(Math.abs(points[index].x - face[index].x) < EPSILON, `负数 inset ${dirty} 应按 0 处理`);
            assert.ok(Math.abs(points[index].y - face[index].y) < EPSILON, `负数 inset ${dirty} 应按 0 处理`);
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

test('消散：起手第 0 帧全不透明，中段换帧并淡出，到点返回 null（该收云了）', () => {
    assert.ok(TERRITORY_CLOUD_DISSOLVE_SECONDS > 0 && TERRITORY_CLOUD_DISSOLVE_SECONDS <= 1.5,
        `消散时长 ${TERRITORY_CLOUD_DISSOLVE_SECONDS}s 不合理（太长会读成"点了没反应"）`);
    const n = 2;
    // ⚠️ `TERRITORY_CLOUD_DISSOLVE_HOLD` 是**进度比例**（0.3 = 前 30%），不是秒；
    // 这里按比例算秒再喂进去，别把 0.3 当 0.3s 用（那样已经走到 57% 了）。
    const total = TERRITORY_CLOUD_DISSOLVE_SECONDS;
    const at = (seconds: number) => {
        const frame = territoryCloudDissolveFrame(seconds, n);
        assert.ok(frame, `k=${seconds} 不该是 null`);
        return frame!;
    };
    const atT = (ratio: number) => at(ratio * total);
    // hold 段（前 30%）不许提前淡 —— 云还没裂开就变淡会读成"凭空消失"。
    assert.equal(at(0).opacity, 1);
    assert.equal(atT(0.01).opacity, 1);
    // 按住到 hold 末尾还是全不透明（用 0.99 留一点余量避开边界抖动）。
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_HOLD * 0.99).opacity, 1);
    // 两帧必须都用到，并且顺序递增（裂成环 → 散尽）。
    assert.equal(atT(0.1).index, 0);
    assert.equal(atT(TERRITORY_CLOUD_DISSOLVE_HOLD).index, 0);
    assert.equal(atT(0.8).index, 1);
    assert.equal(atT(0.99).index, n - 1);

    // 淡出**单调不增**，且终点前还没完全透明（留最后一截收尾，不要提前变 0 再空等）。
    let previous = 1.0001;
    // 只扫到 0.99（1.0 就是终点，按契约返回 null，不该在这里比不透明度）。
    for (let index = 1; index < 100; index += 1) {
        const frame = atT(index / 100);
        assert.ok(frame.opacity <= previous + 1e-9, `t=${index / 100} 不透明度回涨了`);
        previous = frame.opacity;
    }
    assert.ok(atT(0.9).opacity > 0 && atT(0.9).opacity < 0.2, '临近收尾应该是"快没了"而不是 0');
    // 到点即 null（收云的唯一信号）；之后也一直 null。
    assert.equal(territoryCloudDissolveFrame(TERRITORY_CLOUD_DISSOLVE_SECONDS, n), null);
    assert.equal(territoryCloudDissolveFrame(TERRITORY_CLOUD_DISSOLVE_SECONDS * 3, n), null);
    // 没有消散帧 ⇒ 直接 null（视图那条"没帧也照样按时间收掉"靠它）。
    assert.equal(territoryCloudDissolveFrame(0.1, 0), null);
});

// ============================================================
// ③ 云谱参数
// ============================================================

test('云谱参数：倍率 / y 偏移有界，云洞缩小倍率是按"洞 + 15px"算出来的 0.74', () => {
    assert.ok(TERRITORY_CLOUD_SCALE > 0 && TERRITORY_CLOUD_SCALE <= 2,
        `倍率 ${TERRITORY_CLOUD_SCALE} 越界：0 会让云消失且零报错`);
    // 美术图 200×240、云体（含投影）占 y=0…198 ⇒ 重心比画布中心高约 21px，取负值压回来。
    assert.ok(TERRITORY_CLOUD_ART_OFFSET_Y < 0 && TERRITORY_CLOUD_ART_OFFSET_Y > -40,
        `y 偏移 ${TERRITORY_CLOUD_ART_OFFSET_Y} 不合理`);
    assert.ok(TERRITORY_CLOUD_DISSOLVE_HOLD > 0 && TERRITORY_CLOUD_DISSOLVE_HOLD < 1);

    // 云洞：云体 200×120、格面 123×90、四周留 15px ⇒ 洞内可用 153×120。
    const bodyWidth = 200;
    const bodyHeight = 120;
    const room = {
        width: gridLayout.HEX_GRID_FACE_WIDTH + TERRITORY_CLOUD_KEEP_OUT_PX * 2,
        height: gridLayout.HEX_GRID_FACE_HEIGHT + TERRITORY_CLOUD_KEEP_OUT_PX * 2,
    };
    assert.ok(TERRITORY_CLOUD_POCKET_SCALE > 0 && TERRITORY_CLOUD_POCKET_SCALE < 1, '必须是"缩小"，不是放大');
    assert.ok(bodyWidth * TERRITORY_CLOUD_POCKET_SCALE < room.width,
        `云洞云宽 ${bodyWidth * TERRITORY_CLOUD_POCKET_SCALE} 压到了 15px 间隔（可用 ${room.width}）`);
    assert.ok(bodyHeight * TERRITORY_CLOUD_POCKET_SCALE < room.height,
        `云洞云高 ${bodyHeight * TERRITORY_CLOUD_POCKET_SCALE} 压到了 15px 间隔（可用 ${room.height}）`);
    // 但也不能小到变成孤立小白点：至少占洞宽的一半。
    assert.ok(bodyWidth * TERRITORY_CLOUD_POCKET_SCALE > room.width / 2, '缩过头了，读不出"这里被雾盖着"');
});

// ============================================================
// ④ 铺满背景的虚拟格点
// ============================================================

test('铺满：虚拟格点与真实格**同间距同相位**（延伸同一张格网，不是另铺一层）', () => {
    const rows = 6;
    const columns = 7;
    const width = columns * gridLayout.HEX_GRID_VIEW_COLUMN_SPACING + 600;
    const height = rows * gridLayout.HEX_GRID_VIEW_ROW_SPACING + 600;
    const points = territoryCloudFillPoints(rows, columns, width, height);
    assert.ok(points.length > 0, '留白那圈必须有云，否则滚到边缘就露底图');

    const real = new Set<string>();
    for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
            const point = gridLayout.hexGridViewPoint(row, column, rows, columns);
            real.add(`${point.x}|${point.y}`);
        }
    }
    for (const point of points) {
        assert.equal(real.has(`${point.x}|${point.y}`), false, '真实格由 sync 那套负责，不许重复铺');
    }
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

    setWorldPosition(value: { x: number; y: number; z: number }): void {
        this.worldPosition = { x: value.x, y: value.y, z: value.z };
    }

    setWorldScale(value: { x: number; y: number; z: number }): void {
        this.worldScale = { x: value.x, y: value.y, z: value.z };
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
    color = { r: 255, g: 255, b: 255, a: 255 };
}

class UITransformStub {}

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

test('格子露出的那一帧：挪进消散层（不受遮罩裁）→ 体 / 影同 index 换帧 → 播完收掉', () => {
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
    assert.equal(frameName(sprite), 'cloud_dissolve_body_0');

    // 中途：换到第二帧并开始淡出。影子必须**同 index** 换帧、一起淡出。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.8);
    assert.equal(view.dissolvingCount, 1);
    assert.equal(frameName(sprite), 'cloud_dissolve_body_1');
    assert.ok(sprite.color.a < 255 && sprite.color.a > 0, `淡出中 a=${sprite.color.a}`);
    const shadowNode = findNode(
        view.dissolveLayerNode!.getChildByName('CloudShadow'),
        'CloudShadow_1',
    );
    assert.ok(shadowNode, '消散中的影子要跟着挪进解散分组的');
    const shadowSprite = shadowNode!.getComponent(SpriteStub) as SpriteStub;
    assert.equal(frameName(shadowSprite), 'cloud_dissolve_shadow_1', '影子要和云体同步换到同一帧');
    assert.equal(shadowSprite.color.a, sprite.color.a, '体 / 影同透明度，否则散一半影子还挂在下面');

    // 到点：收掉（隐藏 + 不透明复位，下次若又变未解锁能正常显形）。
    view.step(TERRITORY_CLOUD_DISSOLVE_SECONDS * 0.3);
    assert.equal(view.dissolvingCount, 0);
    assert.equal(node.active, false);
    assert.equal(sprite.color.a, 255);

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
// 四版：影子分组在云体之下 / 云洞不裁剪 / 铺满层
// ============================================================

test('视图：影子统一放进层里的第 0 个分组（= 画在所有云体之下）', () => {
    const { view } = stage();
    const layer = view.layerNode!;
    const group = view.shadowGroupNode!;
    assert.ok(group, '云层必须有影子分组');
    assert.equal(group.getSiblingIndex(), 0, '影子分组必须是第 0 个孩子，否则会压到别人的云体上');

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
    assert.equal(node.position.y, point.y + gridLayout.HEX_GRID_CONTENT_LIFT + TERRITORY_CLOUD_ART_OFFSET_Y);
    // 轻微缩小：留出与地块的观感空隙（不裁剪以后只能靠尺寸）。
    const scale = TERRITORY_CLOUD_SCALE * cloud.TERRITORY_CLOUD_POCKET_SCALE;
    assert.ok(Math.abs(node.scale.x - scale) < 1e-9, `云洞云应缩到 ${scale}，实际 ${node.scale.x}`);
    assert.equal(frameName(node.getComponent(SpriteStub) as SpriteStub), 'cloud_body_0',
        '云洞里的云也必须是静止云体图（不轮播）');
    const pocketShadow = findNode(pocket.getChildByName('CloudShadow'), 'CloudPocketShadow');
    assert.ok(pocketShadow, '云洞云同样要有影子');
    assert.deepEqual(pocketShadow!.position, node.position, '影子与云体同坐标（两张同画布图贴同一处）');

    // 洞格在**正常云层**里那朵要收起来：否则洞心叠两朵（正常层那朵被邻格 15px 啃一圈，更亮）。
    const parked = findNode(view.layerNode, 'Cloud_12');
    assert.ok(parked, '洞格仍然要建节点（解锁时它负责播消散）');
    assert.equal(parked!.active, false, '洞格的正常云必须收起，由云洞层那朵顶班');

    // 每帧对齐 MapLayer 的世界变换：地图滑动 / 推镜时云洞得跟着走。
    mapLayer.setWorldPosition({ x: -120, y: 340, z: 0 });
    mapLayer.setWorldScale({ x: 1.35, y: 1.35, z: 1 });
    view.step(1 / 60);
    assert.deepEqual(pocket.worldPosition, { x: -120, y: 340, z: 0 });
    assert.deepEqual(pocket.worldScale, { x: 1.35, y: 1.35, z: 1 });

    // 洞补上（那一格解锁了）⇒ 云洞清空，正常层那朵点亮并照常播消散。
    view.sync(list, new Set(list.map((cell) => cell.cellId)), []);
    assert.equal(view.pocketCount, 0);
    assert.equal(cloudNodes(pocket).length, 0, '没有洞就不该留着云');
    assert.equal(findNode(pocket.getChildByName('CloudShadow'), 'CloudPocketShadow'), null);
    assert.equal(parked!.active, true, '洞格解锁要靠正常层那朵播消散（起手点亮）');
    assert.equal(view.dissolvingCount, 1);
});

test('视图：铺满层建在挡云遮罩里（一起吃 15px 擦除）+ 影子在它自己那层之下，全解锁后整层关闭', () => {
    const { view } = stage();
    const fill = view.keepOutNode!.getChildByName(viewModule().TERRITORY_CLOUD_FILL_NODE);
    assert.ok(fill, '铺满层必须建在 CloudKeepOut 里');
    const shadow = fill!.getChildByName(viewModule().TERRITORY_CLOUD_SHADOW_NODE);
    assert.ok(shadow, '铺满层也要有影子分组');
    assert.equal(shadow!.getSiblingIndex(), 0, '铺满层的影子同样在它自己那层云体之下');

    view.setFillArea(900, 1200, 4, 5);
    assert.ok(view.fillCloudCount > 0, '留白那圈必须有云');
    assert.equal(view.fillShadowCount, view.fillCloudCount, '每朵铺满云一个影子（缺了说明美术没给 shadow 图）');
    // 同一个尺寸再调一次不重建（`renderMap` 每秒都在调）。
    const count = view.fillCloudCount;
    view.setFillArea(900, 1200, 4, 5);
    assert.equal(view.fillCloudCount, count);

    // 还差一格没解锁 ⇒ 铺满层继续展示。
    const total = 4 * 5;
    const partial = new Set<number>();
    for (let cellId = 0; cellId < total - 1; cellId += 1) partial.add(cellId);
    const list = Array.from({ length: total }, (_, cellId) => ({ cellId, x: cellId * 92.25, y: 0 }));
    view.sync(list, partial);
    assert.equal(view.fillVisible, true, '没全解锁就得留着那圈雾');
    // 全解锁 ⇒ 整层关掉（连影子一起），否则地图边缘还挂着一圈灰。
    view.sync(list, new Set(list.map((cell) => cell.cellId)));
    assert.equal(view.fillVisible, false, '全地图解锁后铺满层必须关掉');
    assert.equal(shadow!.active, false, '影子分组要跟着一起关');
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
