import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { ZC_HEX_COLUMN_PHASE } from '../assets/script/app/zcds/model/ZCMapGeometry';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
} from '../assets/script/core/hex/HexGridLayout';

function createEditor(options: { hash?: string; fetch?: (path: string, options?: any) => Promise<any> } = {}) {
    const elements = new Map<string, any>();
    let paths: any[] = [];
    const element = (id: string): any => {
        if (!elements.has(id)) elements.set(id, {
            value: id === 'mapId' ? 'river' : id === 'mapName' ? '双岸河道' : '',
            textContent: '', innerHTML: '', hidden: false, checked: false,
            className: '', dataset: {}, classList: { add() {}, remove() {} },
            listeners: {} as Record<string, () => void>,
            addEventListener(name: string, handler: () => void) { this.listeners[name] = handler; },
            setAttribute() {}, querySelectorAll() { return []; },
        });
        return elements.get(id);
    };
    const board = element('board');
    Object.defineProperty(board, 'innerHTML', {
        get() { return ''; },
        set(value: string) {
            board.__html = value;
            paths = [];
            const expression = /<path d="[^"]*" data-r="(\d+)" data-c="(\d+)" class="hex"\/>/g;
            let match;
            while ((match = expression.exec(value))) {
                paths.push({ row: Number(match[1]), column: Number(match[2]), setAttribute() {} });
            }
        },
    });
    board.querySelectorAll = () => paths;
    const document = { getElementById: element, querySelectorAll: () => [] };
    const window: any = { addEventListener() {}, location: { hash: options.hash || '' } };
    const code = readFileSync('tools/map-editor/app.js', 'utf8');
    runInNewContext(code, {
        document, window, fetch: options.fetch || (() => new Promise(() => {})),
        setTimeout: () => 0, clearTimeout() {}, console,
    });
    return { editor: window.__editor, element };
}

test('左栏长说明收纳为可点击的问号帮助气泡', () => {
    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    assert.match(html, /<details class="helpTip">/);
    assert.match(html, /查看中立资源说明/);
    assert.match(html, /查看操作说明/);
    assert.match(html, /\.helpBubble/);
});

/** 内部格子编码：-1 = 虚空、0 = 中立（可通行、无分区）、1~4 = 分区号。 */
test('分区、中立和虚空笔刷立即上下镜像，行列都不再强制偶数', () => {
    const { editor, element } = createEditor();
    editor.setSize(20, 11);
    editor.paint(12, 3, 'void');
    let state = editor.state();
    assert.equal(state.grid[12][3], -1);
    assert.equal(state.grid[7][3], -1);
    editor.paint(7, 3, 1);
    state = editor.state();
    assert.equal(state.grid[12][3], 1);
    assert.equal(state.grid[7][3], 2);
    editor.paint(15, 8, 'void');
    state = editor.state();
    assert.equal(state.grid[15][8], -1);
    assert.equal(state.grid[4][8], -1);
    editor.paint(10, 4, 'neutral');
    state = editor.state();
    assert.equal(state.grid[10][4], 0);
    assert.equal(state.grid[9][4], 0);
    assert.equal(state.json.ascii[0][4], '0');
    assert.equal(state.json.version, 3);
    // 底图默认全中立，只留各方主城盘：中立格 = 全图 220 − 2 格虚空 − 两方主城盘各 8 格
    // （7 格蜂巢 + 手涂的那 1 格）。
    assert.equal(editor.validate().counts[0], 20 * 11 - 2 - 8 * 2);
    assert.equal(editor.validate().counts[1], editor.validate().counts[2]);
    editor.setSize(19, 13);
    state = editor.state();
    assert.equal(state.rows, 19);
    assert.equal(state.cols, 13);
    assert.equal(state.paths, 247);
    assert.equal(state.grid[14][9], -1);
    assert.equal(state.grid[4][9], -1);
    assert.equal(state.homes[0].column, 2);
    assert.equal(element('inCols').value, 13);
    assert.equal(element('inRows').value, 19);
});

/**
 * 2 人图上下镜像的当前口径：**默认开、可自行关闭**（2026-09-22 从"强制开"改过来）。
 *
 * 早先锁死成"必开"，理由是 1 区格数 = 该方开局领地（`ZC_INITIAL_TERRITORY`），镜像一关两家就可能不等。
 * 但策划摆装饰时要能关 —— 对折生成会把对侧的装饰一起长出来，想摆非对称的礁石 / 沉船就碍事。
 * 于是把「默认」和「强制」拆成两个口径：`defaultMirror(2)` 给默认值、`forcedMirror(2)` 给锁定项（现在是 null）。
 *
 * ⚠️ 代价：关掉之后"两家一样多"由策划自己保证，`validate()` 里那处 `balanced` 只报 warn 不拦
 * （它本来就写着"（不强制相等）"）。
 * ⚠️ 180° 旋转镜像对 2 人**仍然不成立**（会把 1 区转到对角），这条与锁不锁镜像无关，单独拦。
 */
test('2 人上下镜像：默认开着，但 UI 与 API 都能自己关掉', () => {
    const { editor, element } = createEditor();
    const preset = editor.defaultMirror(2);
    assert.equal(preset.vertical, true);
    assert.equal(preset.horizontal, false);
    assert.equal(editor.forcedMirror(2), null, '2 人不是"锁死"，只是"默认"');
    // UI：勾上且**可点** —— 不再是 disabled
    assert.equal(element('optMirrorV').disabled, false, '2 人时上下镜像勾选框必须可点');
    assert.equal(element('optMirrorV').checked, true);
    assert.equal(element('optMirrorH').disabled, true, '2 人没有左右方向的分区伙伴');

    // API：能真的关掉，存档也从半场变整场
    editor.setMirror(false, false);
    let state = editor.state();
    assert.equal(state.mirrorVertical, false, 'setMirror 必须能关掉 2 人的上下镜像');
    assert.equal(state.mirrorHorizontal, false);
    assert.equal(state.json.ascii.length, 20, '关掉镜像后存整场 20 行');
    assert.equal(element('optMirrorV').checked, false, 'UI 勾选状态要跟着镜像走');

    // 再开回来：回到半场
    editor.setMirror(true, false);
    state = editor.state();
    assert.equal(state.mirrorVertical, true);
    assert.equal(state.json.ascii.length, 10, '开着镜像存半场 = 20 / 2');
});

test('切到 2 人时落"默认开"（从 3 人切过来的场景）', () => {
    const { editor } = createEditor();
    editor.setPlayerCount(3);
    assert.equal(editor.state().mirrorVertical, false, '3 人一律关');
    editor.setPlayerCount(2);
    assert.equal(editor.state().mirrorVertical, true, '切回 2 人自动落默认：上下开');
});

test('3 人仍然锁死镜像：UI 置灰、API 绕不过、载入直接拒', () => {
    const { editor, element } = createEditor();
    editor.setPlayerCount(3);
    assert.ok(editor.forcedMirror(3), '3 人是"锁死"');
    assert.equal(element('optMirrorV').disabled, true, '3 人时上下镜像勾选框必须 disabled');
    assert.equal(element('optMirrorV').checked, false);
    editor.setMirror(true, true);
    const state = editor.state();
    assert.equal(state.mirrorVertical, false, '3 人的镜像开不起来');
    assert.equal(state.mirrorHorizontal, false);
    assert.throws(() => editor.applyLayout({
        version: 3, id: 'bad3p', rows: 8, columns: 8, playerCount: 3, cityMode: 'select',
        mirrorVertical: true, mirrorHorizontal: false, ascii: Array.from({ length: 4 }, () => '0'.repeat(8)),
    }), /必须关闭镜像/, '第三块分区没有镜像伙伴');
});

test('2 人整场图（镜像关）能正常载入，180° 旋转镜像仍然拒', () => {
    const { editor } = createEditor();
    // 镜像关 = 自己画整场，ascii 就是 rows 行
    editor.applyLayout({
        version: 3, id: 'whole2p', rows: 8, columns: 8, playerCount: 2, cityMode: 'select',
        mirrorVertical: false, mirrorHorizontal: false, ascii: Array.from({ length: 8 }, () => '0'.repeat(8)),
    });
    let state = editor.state();
    assert.equal(state.playerCount, 2);
    assert.equal(state.mirrorVertical, false);
    assert.equal(state.json.ascii.length, 8, '整场图原样存 8 行');
    // 镜像开的半场图照旧能载
    editor.applyLayout({
        version: 3, id: 'half2p', rows: 8, columns: 8, playerCount: 2, cityMode: 'select',
        mirrorVertical: true, mirrorHorizontal: false, ascii: Array.from({ length: 4 }, () => '0'.repeat(8)),
    });
    state = editor.state();
    assert.equal(state.mirrorVertical, true);
    assert.equal(state.json.ascii.length, 4);
    // 2 人的 180° 依旧不成立（会把 1 区转到对角），与"锁不锁镜像"无关
    assert.throws(() => editor.applyLayout({
        version: 3, id: 'bad180', rows: 8, columns: 8, playerCount: 2, cityMode: 'select',
        mirror180: true, ascii: Array.from({ length: 4 }, () => '0'.repeat(8)),
    }), /180°/, '2 人不能用 180° 旋转镜像');
});

test('服务连接失败时给出可迁移当前地图的链接', async () => {
    const { editor, element } = createEditor({
        fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(element('openServer').hidden, false);
    assert.match(element('libFlash').textContent, /open-editor\.cmd/);
    editor.paint(12, 3, 'void');
    const link = element('openServer');
    link.listeners.click.call(link);
    const transferred = JSON.parse(decodeURIComponent(link.href.split('#map=')[1]));
    assert.equal(transferred.ascii[2][3], '.');
});

test('从文件页转到服务页时保留当前地图', async () => {
    const river = JSON.parse(readFileSync('tools/map-editor/presets/river.json', 'utf8'));
    const custom = { ...river, id: 'migrated', ascii: [...river.ascii] };
    custom.ascii[2] = custom.ascii[2].slice(0, 3) + '.' + custom.ascii[2].slice(4);
    const { editor } = createEditor({
        hash: '#map=' + encodeURIComponent(JSON.stringify(custom)),
        fetch: async () => ({ ok: true, json: async () => ({ presets: [river] }) }),
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(editor.state().json.id, 'migrated');
    assert.equal(editor.state().grid[12][3], -1);
    assert.equal(editor.state().grid[7][3], -1);
});

test('预设只存 1 区半场，导入后重建其余分区和虚空', () => {
    const { editor } = createEditor();
    const river = JSON.parse(readFileSync('tools/map-editor/presets/river.json', 'utf8'));
    editor.applyLayout(river);
    const state = editor.state();
    assert.equal(state.cols, 11);
    assert.equal(state.rows, 20);
    assert.equal(state.json.mirrorVertical, true);
    assert.equal(state.json.mirrorHorizontal, false);
    assert.equal(state.json.ascii.length, 10);
    assert.equal(state.json.playerCount, 2);
    assert.equal(state.json.cityMode, 'fixed');
    assert.equal(state.homes[0].row, 15);
    assert.equal(state.homes[1].row, 4);
    assert.equal(state.grid[10][0], -1);
    assert.equal(state.grid[9][0], -1);
    assert.equal(state.grid[10][2], 1);
    assert.equal(state.grid[9][2], 2);
    assert.equal(editor.validate().connected, true);
    assert.equal(state.json.version, 3);
});

test('v2 中立格导入后保持可用、镜像和字符画，主城不能画到中立格', () => {
    const { editor } = createEditor();
    const neutral = JSON.parse(readFileSync('tools/map-editor/presets/neutral_standard.json', 'utf8'));
    editor.applyLayout(neutral);
    let state = editor.state();
    assert.equal(state.grid[9][5], 0);
    assert.equal(state.grid[8][5], 0);
    assert.equal(state.json.ascii[0], '00000000000');
    assert.equal(editor.validate().counts[0], 22);
    const oldHome = state.homes[0];
    editor.paint(9, 5, 'home');
    state = editor.state();
    assert.deepEqual(state.homes[0], oldHome);
    assert.equal(editor.validate().connected, true);
});

test('切换人数保留 1 区内容并重建镜像，4 人镜像图存四分之一', () => {
    const { editor } = createEditor();
    editor.setSize(20, 12);
    editor.setCityMode('fixed');
    editor.setPlayerCount(4);
    editor.clearGrid();
    let state = editor.state();
    assert.equal(state.playerCount, 4);
    assert.equal(state.mirrorVertical, true);
    assert.equal(state.mirrorHorizontal, true);
    // 四象限：1 = 下左、2 = 上左、3 = 下右、4 = 上右。
    assert.equal(state.grid[18][1], 1);
    assert.equal(state.grid[1][1], 2);
    assert.equal(state.grid[18][10], 3);
    assert.equal(state.grid[1][10], 4);
    assert.equal(state.homes.length, 4);
    assert.equal(state.json.ascii.length, 10);
    assert.equal(state.json.ascii[0].length, 6);
    assert.equal(state.json.homes.map((home: any) => home.row).join(','), '18,1,18,1');
    assert.equal(editor.validate().connected, true);
    assert.ok(editor.validate().checks.every((check: string[]) => check[0] === 'ok'),
        '默认四象限图不该有校验问题：' + JSON.stringify(editor.validate().checks));

    editor.setCityMode('select');
    state = editor.state();
    assert.equal(state.cityMode, 'select');
    assert.equal(state.json.homes, undefined);
    // 主城盘是布局产物、不是策划画的内容：切到自选主城就收回去，整张图回到全中立。
    assert.equal(editor.validate().counts[1], 0);
    assert.equal(editor.validate().counts[0], 20 * 12, '收回主城盘后 20×12 应全是中立格');

    editor.setPlayerCount(2);
    state = editor.state();
    assert.equal(state.playerCount, 2);
    assert.equal(state.mirrorHorizontal, false);
    assert.equal(state.json.ascii[0].length, 12);
});

/** 笔刷 = 指针位置映射到格 + 沿轨迹插值；这两步是"拖动不掉格"的全部依赖。 */
test('指针坐标映射到最近的六边形格，棋盘外不命中', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    const center = editor.hexCenter(12, 4);
    const hit = editor.cellAtLocal(center.x, center.y);
    assert.equal(hit.row, 12);
    assert.equal(hit.column, 4);
    // 格内偏移仍算同一格（最近中心即六边形 Voronoi）
    const near = editor.cellAtLocal(center.x + 20, center.y + 12);
    assert.equal(near.row, 12);
    assert.equal(near.column, 4);
    // 远离棋盘 → null，避免在空白处拖拽误涂边缘格
    assert.equal(editor.cellAtLocal(center.x + 4000, center.y), null);
});

test('拖动涂抹沿轨迹插值：横穿全宽不掉格，且相邻采样格必相邻', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    const from = editor.hexCenter(10, 0);
    const to = editor.hexCenter(10, 10);
    const seen = new Set<string>();
    const order: any[] = [];
    editor.walkStroke({ x: from.x, y: from.y }, { x: to.x, y: to.y }, 0, (cell: any) => {
        const key = cell.row + ',' + cell.column;
        if (seen.has(key)) return;
        seen.add(key);
        order.push(cell);
    });
    assert.ok(seen.has('10,0'), '起点格必须在覆盖范围里');
    assert.ok(seen.has('10,10'), '终点格必须在覆盖范围里');
    const columns = new Set(order.map((cell: any) => cell.column));
    assert.equal(columns.size, 11, '11 列必须全部命中，少一列就是跳格：' + [...columns].sort((a, b) => a - b).join(','));
    for (let i = 1; i < order.length; i += 1) {
        const previous = order[i - 1];
        const near = editor.hexNeighbors(previous.row, previous.column)
            .some((cell: any) => cell.row === order[i].row && cell.column === order[i].column);
        assert.ok(near, `第 ${i} 段跳格：(${previous.row}, ${previous.column}) → (${order[i].row}, ${order[i].column})`);
    }
});

test('笔刷半径决定覆盖格数，棋盘边界自动裁掉出界格', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    assert.equal(editor.brushCells(10, 5, 0).length, 1);
    assert.equal(editor.brushCells(10, 5, 1).length, 7);
    assert.equal(editor.brushCells(10, 5, 2).length, 19);
    // 角落：半径 1 只能覆盖自己 + 界内邻居
    assert.equal(editor.brushCells(19, 10, 1).length, editor.hexNeighbors(19, 10).length + 1);
    const corner = editor.brushCells(19, 10, 2);
    assert.ok(corner.every((cell: any) => cell.row >= 0 && cell.row < 20 && cell.column >= 0 && cell.column < 11),
        '覆盖范围必须全部落在棋盘内');
    assert.ok(corner.length < 19, '角落半径 2 的覆盖格数应少于中心');
    // 与"沿邻居扩两层"的期望集合一致
    const expected = new Set<string>(['19,10']);
    for (const cell of editor.hexNeighbors(19, 10)) {
        expected.add(cell.row + ',' + cell.column);
        for (const far of editor.hexNeighbors(cell.row, cell.column)) expected.add(far.row + ',' + far.column);
    }
    assert.equal(corner.length, expected.size);
});

test('笔刷半径可调且有上下限', () => {
    const { editor } = createEditor();
    assert.equal(editor.state().brushRadius, 0);
    editor.setBrushRadius(2);
    assert.equal(editor.state().brushRadius, 2);
    editor.setBrushRadius(9);
    assert.equal(editor.state().brushRadius, 2);
    editor.setBrushRadius(-1);
    assert.equal(editor.state().brushRadius, 0);
});

test('一次笔画只记一步历史，撤销与重做逐笔回放', () => {
    const { editor } = createEditor();
    editor.setSize(20, 12);
    editor.setPlayerCount(4);
    editor.clearGrid();
    const depth = editor.state().undoDepth;
    const before = editor.snapshot();
    // 一次拖动 = 多次批量写入 + 一次提交
    editor.paintCells([{ row: 18, column: 1 }, { row: 18, column: 2 }], 'void');
    editor.paintCells([{ row: 18, column: 3 }], 'void');
    assert.equal(editor.state().undoDepth, depth, '笔画未结束时不该进历史');
    editor.commitUndo(before);
    let state = editor.state();
    assert.equal(state.undoDepth, depth + 1, '整笔只记一步');
    assert.equal(state.grid[18][1], -1);
    assert.equal(state.grid[18][3], -1);
    // 撤销：回到这一笔之前
    assert.equal(editor.undo(), true);
    state = editor.state();
    assert.equal(state.redoDepth, 1);
    assert.notEqual(state.grid[18][1], -1);
    assert.notEqual(state.grid[18][3], -1);
    // 重做：把这一笔放回来
    assert.equal(editor.redo(), true);
    state = editor.state();
    assert.equal(state.grid[18][3], -1);
    assert.equal(editor.state().redoDepth, 0);
    // 没有可撤销内容时不报成功
    while (editor.undo()) { /* 清空历史 */ }
    assert.equal(editor.undo(), false);
});

test('笔刷批量写入走镜像映射，1 区一笔产出四个象限', () => {
    const { editor } = createEditor();
    editor.setSize(20, 12);
    editor.setPlayerCount(4);
    editor.clearGrid();
    assert.equal(editor.validate().empty, 0);
    editor.paintCells(editor.brushCells(18, 1, 1), 'void');
    // 1 区 7 格 + 上下/左右镜像出的三个象限
    assert.equal(editor.validate().empty, 28);
    assert.equal(editor.state().grid[1][1], -1, '2 区（上左）跟着变虚空');
    assert.equal(editor.state().grid[18][10], -1, '3 区（下右）跟着变虚空');
    assert.equal(editor.state().grid[1][10], -1, '4 区（上右）跟着变虚空');
});

/** 三人主城的三条边必须等长 —— 只要有一条偏短，短边两方就会提前接触、被第三家坐收。 */
function triangle(editor: any, state: any) {
    const centers = state.homes.slice(0, 3).map((home: any) => editor.hexCenter(home.row, home.column));
    const side = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);
    const sides = [side(centers[0], centers[1]), side(centers[1], centers[2]), side(centers[0], centers[2])];
    return { sides, spread: Math.max(...sides) / Math.min(...sides) - 1 };
}

/**
 * 独立枚举所有放得下的 (W, Δ)，算出三边极差的最小值，用来断言"编辑器给的就是最优解"。
 * 守的是**机制**（在可行域里挑最优），不是某一组具体坐标 —— 格子尺寸一改，最优解本身就会变，
 * 钉死坐标的用例只会变成返工来源。
 */
function bestTrio(editor: any, rows: number, cols: number) {
    const mid = Math.round((cols - 1) / 2);
    const maxWidth = Math.max(1, Math.min(mid - 1, cols - 2 - mid));
    const limit = Math.max(1, rows - 3);
    let best = Infinity;
    for (let width = 1; width <= maxWidth; width += 1) {
        for (let delta = 1; delta <= limit; delta += 1) {
            const upper = editor.hexCenter(0, mid);
            const left = editor.hexCenter(delta, mid - width);
            const right = editor.hexCenter(delta, mid + width);
            const sides = [
                Math.hypot(left.x - right.x, left.y - right.y),
                Math.hypot(upper.x - left.x, upper.y - left.y),
                Math.hypot(upper.x - right.x, upper.y - right.y),
            ];
            const spread = Math.max(...sides) / Math.min(...sides) - 1;
            if (spread < best) best = spread;
        }
    }
    return best;
}

test('三人主城默认排成等边三角形，且上点必须压中线列', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.setPlayerCount(3);
    const state = editor.state();
    assert.equal(state.playerCount, 3);
    assert.equal(state.mirrorVertical, false, '三人没有镜像伙伴，上下镜像也要关掉');
    assert.equal(state.mirrorHorizontal, false);
    assert.equal(state.homes[3], null, '三人图不该有第四个座位');
    // 上 1 下 2：2 区在上带中线列，1 / 3 区在下带左右对称
    assert.equal(state.homes[1].row < state.homes[0].row, true);
    assert.equal(state.homes[0].row, state.homes[2].row);
    assert.equal(state.homes[1].column, 5);
    assert.equal(state.homes[0].column + state.homes[2].column, 10);
    const { sides, spread } = triangle(editor, state);
    // ⚠️ **别钉死具体极差** —— 那是按当时几何定的阈值。
    // 换图会让 `threeHomes` 挑出的最优 (W, Δ) 变化、"视觉最接近等边"的最优解也跟着变
    // （正六边形 84/98 是 0.78%；`img_land_01_gray` 立体地块 98/115 是 **1.22%**）。
    // 这里守的是**机制**：取的是可行域里极差最小的那组，而不是某一组写死的坐标或阈值。
    // ⚠️ 参数是 (rows, cols)，**不是 (cols, rows)** —— `setSize(20, 11)` 的第一个参数是 rows。
    // 写反了会按错误的可行域算最优，得出「实际 1.08% ≠ 最优 0.10%」的假回归
    // （2026-10-12 实测：用 (20,11) 算出的最优正是实际的 `12,1 | 6,5 | 12,9`、1.08%，逐位一致）。
    const state0 = editor.state();
    const optimum = bestTrio(editor, state0.rows, state0.cols);
    assert.ok(Math.abs(spread - optimum) < 1e-9,
        `三人主城应是可行域内极差最小的解，实际 ${(spread * 100).toFixed(2)}% ≠ 最优 ${(optimum * 100).toFixed(2)}%`);
    assert.ok(spread < 0.03, `当前几何下等边只能是近似，三边极差应 <3%，实际 ${(spread * 100).toFixed(2)}%`);
    assert.ok(sides[0] > 250, `三人两两距离应接近 1v1 的 9 格量级，实际 ${sides[0].toFixed(0)}px`);
});

test('三人图默认只给三座主城盘上色、其余全是中立格，铺满时三块面积又近似相等', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.setPlayerCount(3);
    const state = editor.state();
    // 三座主城必须落在自己的分区里（主城盘 = 主城 + 6 邻格 = 7 格，三点相距 700px 不会重叠）
    for (let seat = 0; seat < 3; seat += 1) {
        const home = state.homes[seat];
        assert.equal(state.grid[home.row][home.column], seat + 1,
            `${seat + 1} 区主城 (${home.row}, ${home.column}) 落在了别的分区`);
        assert.equal(editor.validate().counts[seat + 1], 7, `${seat + 1} 区应只有主城盘 7 格`);
    }
    assert.equal(editor.validate().counts[0], 20 * 11 - 21, '除三座主城盘外应全是中立格');
    assert.equal(editor.validate().connected, true);

    // 铺满分区再看面积：把整张图铺上分区色，再切一次人数 —— 切人数会按分区规则重排归属，
    // 于是"三块各占约 1/3"这条产品判据才显露出来（默认底图全中立时看不出面积）。
    // 顺带守住切人数时的"旧主城盘回收"：不收的话这里会变成 14 / 14 / 7。
    const all = [] as Array<{ row: number; column: number }>;
    for (let row = 0; row < 20; row += 1) {
        for (let column = 0; column < 11; column += 1) all.push({ row, column });
    }
    editor.setPlayerCount(2);
    editor.paintCells(all, 1);
    editor.setPlayerCount(3);
    const counts = editor.validate().counts;
    const total = counts[1] + counts[2] + counts[3];
    for (const seat of [1, 2, 3]) {
        const share = counts[seat] / total;
        assert.ok(Math.abs(share - 1 / 3) < 0.08,
            `${seat} 区占 ${(share * 100).toFixed(1)}%，三种子应各占约 33%（实际 ${counts[1]}/${counts[2]}/${counts[3]}）`);
    }
    // 面积只要求"近似相等"，所以允许 warn（各方格数不强制相等），但不允许 err。
    assert.ok(editor.validate().checks.every((check: string[]) => check[0] !== 'err'),
        '默认三人图不该有校验错误：' + JSON.stringify(editor.validate().checks));
});

/**
 * 本作地图的中立格占比很高，所以"清空重画"给出的底图必须是"中立格 + 各方主城盘"，
 * 而不是一上来就铺满分区色。反着做的话策划每张图都要先把大片分区擦成中立，既费事又容易漏。
 */
test('清空重画只留各方主城盘，其余全是中立格', () => {
    const { editor } = createEditor();
    for (const [rows, cols, players] of [[20, 11, 2], [20, 11, 3], [20, 12, 4]] as const) {
        editor.setSize(rows, cols);
        editor.setPlayerCount(players);
        editor.clearGrid();
        const report = editor.validate();
        const colored = report.counts.slice(1, players + 1).reduce((sum: number, n: number) => sum + n, 0);
        assert.equal(colored, players * 7,
            `${players} 人图应只有 ${players} 座主城盘（主城 + 6 邻格），实际 ${colored} 格上色`);
        assert.equal(report.counts[0], rows * cols - players * 7,
            `${players} 人图除主城盘外应全是中立格`);
        assert.equal(report.empty, 0, '清空后的底图不该有虚空');
        assert.equal(report.connected, true);
        assert.ok(report.checks.every((check: string[]) => check[0] !== 'err'),
            `${players} 人默认底图不该有校验错误：` + JSON.stringify(report.checks));
    }
});

test('常见棋盘尺寸下三人主城都保持等边，且主城蜂巢不越界', () => {
    const { editor } = createEditor();
    for (const [rows, cols] of [[20, 11], [19, 15], [12, 15], [9, 11], [24, 21], [16, 16]]) {
        editor.setSize(rows, cols);
        editor.setPlayerCount(3);
        const state = editor.state();
        const { sides, spread } = triangle(editor, state);
        // 机制：默认三点必须是可行域里三边极差最小的一组。
        assert.ok(Math.abs(spread - bestTrio(editor, rows, cols)) < 1e-9,
            `${cols}×${rows} 默认三点不是最优解：实际极差 ${(spread * 100).toFixed(2)}%，可行域最优 ${(bestTrio(editor, rows, cols) * 100).toFixed(2)}%`);
        // 体验底线：小棋盘上行距只有整数行可选，最优解本身也可能到 2~3%
        // （11×9 只有 W≤3 可选，最好 2.66%）—— 那是棋盘太小，不是算法偷懒。
        // "够不够等边"由上面那条最优性断言兜住，这里只挡"明显崩了"的量级。
        assert.ok(spread < 0.03,
            `${cols}×${rows} 三边应近似等长，实际 ${sides.map((v) => v.toFixed(1)).join(' / ')}（极差 ${(spread * 100).toFixed(2)}%）`);
        for (const home of state.homes.slice(0, 3)) {
            assert.ok(home.row >= 1 && home.row <= rows - 2 && home.column >= 1 && home.column <= cols - 2,
                `${cols}×${rows} 主城 (${home.row}, ${home.column}) 贴边了，7 格蜂巢会越界`);
        }
    }
});

/**
 * 触发过线上 bug：默认载入的预设带虚空，切到 3 人时三座主城默认点里有落在虚空上的，
 * 而 applyMirror 顺手做的"主城失效检查"把它们当成"主城不在本区"全清成了 null。
 * 这里必须用一张真带虚空的图来切人数 —— 拿满格的新建图永远复现不出来。
 */
test('带虚空的旧图切到 3 人，默认三点必须保留（不能被主城失效检查误杀）', () => {
    const { editor } = createEditor();
    const river = JSON.parse(readFileSync('tools/map-editor/presets/river.json', 'utf8'));
    editor.applyLayout(river);
    const before = editor.state();
    assert.equal(before.playerCount, 2);
    // 这张图的 1 区左缘是虚空，正是会误杀默认主城的形状
    assert.equal(before.grid[12][1], -1, '夹具失效：river 预设的 (12, 1) 不是虚空，这条用例就白测了');

    editor.setPlayerCount(3);
    const state = editor.state();
    for (let seat = 0; seat < 3; seat += 1) {
        assert.ok(state.homes[seat], `${seat + 1} 区主城被清掉了：默认三点不该过失效检查`);
    }
    // ⚠️ **别钉死坐标** —— 几何一改（换图 / 调间距 / 调相位），`threeHomes` 挑出的
    // 最优 (W, Δ) 与最终 top 都会变，写死的三点立刻失效（2026-10-12 换了三轮几何，
    // 这条也跟着红三轮）。改为守**结构**：上 1 下 2、下两点同行、上点压中线、下两点对称。
    const h3 = state.homes.slice(0, 3);
    const midCol = Math.round((state.cols - 1) / 2);
    assert.ok(h3[1].row < h3[0].row, '上点（2 区）应在上带');
    assert.equal(h3[0].row, h3[2].row, '下两点（1 / 3 区）应同一行');
    assert.equal(h3[1].column, midCol, `上点应压中线列（${midCol}）`);
    assert.equal(h3[0].column + h3[2].column, midCol * 2, '下两点应左右对称');
    assert.ok(h3[0].column < h3[1].column && h3[1].column < h3[2].column, '三点列序应为 1 < 2 < 3');
    const { spread } = triangle(editor, state);
    // 同上：守「可行域内最优解」这个机制，不钉死具体极差（换图它就会变）。
    const optimum = bestTrio(editor, state.rows, state.cols);
    assert.ok(Math.abs(spread - optimum) < 1e-9,
        `三点应是可行域内极差最小的解，实际 ${(spread * 100).toFixed(2)}% ≠ 最优 ${(optimum * 100).toFixed(2)}%`);
    assert.ok(spread < 0.03, `当前几何下等边只能是近似，三边极差应 <3%，实际 ${(spread * 100).toFixed(2)}%`);
    // 主城压在虚空上时，校验面板要给出 err 且说清是"虚空"而不是笼统的"不在本区"；
    // 落在陆地上的那座不该被误报。三点坐标随画布几何走，所以按"实际压没压虚空"分别断言，
    // 不假设三座都压在上面（1:1 几何下上点已经从虚空挪到陆地了）。
    const homeChecks = editor.validate().checks.filter((check: string[]) => /区主城/.test(check[1]));
    assert.equal(homeChecks.length, 3);
    const onVoid = (check: string[]) => /压在虚空上/.test(check[1]);
    assert.ok(homeChecks.every((check: string[]) => (onVoid(check) ? check[0] === 'err' : check[0] !== 'err')),
        '主城压在虚空上却没说清原因：' + JSON.stringify(homeChecks.map((check: string[]) => check[1])));
    assert.ok(homeChecks.some(onVoid),
        '默认三点全落在陆地上，这条用例就测不到"默认主城被失效检查误杀"那条路径了');
    // 连通性那边也不能被虚空起点带歪（playable - reached 算成负数）
    const connectivity = editor.validate().checks.find((check: string[]) => /不连通|连通$/.test(check[1]));
    assert.ok(connectivity, '校验面板没有连通性那一行');
    assert.ok(!/-\d/.test(connectivity![1]), `连通性提示出现了负数：${connectivity![1]}`);

    // 用户真去改主城格时，失效检查仍然要生效（改的是编辑路径，不是布局重算）。
    // ⚠️ 坐标从**实际主城**读，不写死 (12, 1) —— 几何一改主城就不在那儿了（涂空 ⇒ 白测）。
    // 也不能拿"涂成虚空"来测：river 该格本来就是虚空，paint 判定没变化会直接返回。
    // （12, 1）是 **river 地图数据**里的虚空格 —— 它不随画布几何变，
    // 所以这里可以写死；而"主城压在虚空上"**正是这条用例要测的场景**，
    // 别加"必须在本区格上"的断言（那会把用例意图反过来）。
    editor.paint(12, 1, 2);
    assert.equal(editor.state().grid[12][1], 2, '涂改没落到主城格上，这条断言就白测了');
    assert.equal(editor.state().homes[0], null, '把主城格改画成别的分区后，主城必须作废');
});

/**
 * 画布必须与工程**渲染**间距 1:1 —— 不再是"把逻辑网格等比放大"。
 * 数字的唯一来源是 `core/hex/HexGridLayout`；编辑器的独立 JS 实现须与它保持一致。
 */
test('编辑器画布 = 工程渲染间距的 1:1（列距 / 行距 / 相位 / 格子外框）', () => {
    const columnPitch = HEX_GRID_VIEW_COLUMN_SPACING;
    const rowPitch = HEX_GRID_VIEW_ROW_SPACING;
    // 格子外框 = **顶面**（立体地块的可见台面），不是整图。
    const topHalfWidth = HEX_GRID_FACE_WIDTH / 2;
    const topHalfHeight = HEX_GRID_FACE_HEIGHT / 2;
    const topLift = HEX_GRID_CONTENT_LIFT;
    const imageWidth = HEX_GRID_IMAGE_WIDTH;
    const imageHeight = HEX_GRID_IMAGE_HEIGHT;
    const tileWidth = topHalfWidth * 2;
    const tileHeight = topHalfHeight * 2;
    assert.ok(columnPitch > 0 && rowPitch > 0 && tileWidth > 0 && tileHeight > 0,
        '没读到工程渲染间距，这条用例就白测了');
    // 立体地块的顶面必须**小于整图**（底部有厚度、左右略内收），否则说明图换了但锚点没更新。
    assert.ok(tileWidth <= imageWidth && tileHeight <= imageHeight,
        `顶面 (${tileWidth}×${tileHeight}) 不该大于整图 (${imageWidth}×${imageHeight})`);

    const { editor } = createEditor();
    editor.setSize(20, 11);
    const origin = editor.hexCenter(10, 0);
    const below = editor.hexCenter(11, 0);
    const right = editor.hexCenter(10, 1);
    assert.equal(Math.abs(right.x - origin.x), columnPitch, '列距必须等于工程的渲染列距');
    assert.equal(Math.abs(below.y - origin.y), rowPitch, '行距必须等于工程的渲染行距');
    // ⚠️ 相邻列垂直差 = **顶面半高**（斜邻居方向），不是「半行距」。
    // 正六边形时代两者相等（行距 = 面高）；换成 `img_land_01_gray` 的压扁六边形
    // （顶面 123×90、行距 105）后分家 —— 用「半行距 = 52.5」会多错开 7.5px，
    // 斜边留 ~12px 的口子（"格子没贴起来"）。
    assert.equal(Math.abs(right.y - origin.y), tileHeight / 2,
        '相邻列相位差应为顶面半高（压扁六边形的斜邻居方向）');
    // 跨 realm：VM 里造出来的对象原型与宿主不同，deepStrictEqual 会因为原型不等而失败，
    // 先转成同 realm 的纯对象再逐项比。
    assert.deepEqual(JSON.parse(JSON.stringify(editor.geometry)), {
        column: columnPitch, row: rowPitch, phase: tileHeight / 4,
        halfWidth: topHalfWidth, halfHeight: topHalfHeight,
        tileWidth, tileHeight,
        topLift, imageWidth, imageHeight,
    }, '画布几何必须与工程渲染间距逐项相等');
    // 相位 = **面高/4**（= 顶面半高的一半），不是「行步长/4」。
    // 对局逻辑相位与共享视图相位相乘换算后，应等于顶面高度的四分之一。
    const viewPhase = ZC_HEX_COLUMN_PHASE * (rowPitch / 42);
    assert.equal(viewPhase, tileHeight / 4,
        `逻辑相位 ${ZC_HEX_COLUMN_PHASE} × y缩放 ${(rowPitch / 42)} = ${viewPhase}，应等于面高/4 = ${tileHeight / 4}`);
});

/** 立体地块 img_land_01_gray：整图 130×119，顶面 123×90（轮廓线画顶面）。 */
test('格子按立体地块的顶面 123×90 轮廓绘制', () => {
    const { editor, element } = createEditor();
    editor.setSize(20, 11);
    const html = String(element('board').__html || '');
    const path = /<path d="([^"]+)" data-r="(\d+)" data-c="(\d+)" class="hex"\/>/.exec(html);
    assert.ok(path, '网格里没找到格子路径');
    const numbers = path![1].match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - editor.geometry.tileWidth) < 0.05,
        '格子宽应等于立体地块顶面宽 123');
    assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - editor.geometry.tileHeight) < 0.05,
        '格子高应等于立体地块顶面高 90');
});

// ---- 虚空装饰 -------------------------------------------------------------------
// 硬约束只有一条：**装饰格必须是虚空格**。落盘复用 art.tiles 的 'row,column' 键，
// 值 = 资源名（客户端 ZCMapArt 的注释里已经写明支持按格覆盖），不新增 v3 字段。

/**
 * "装饰必须在虚空格上面" 有两层意思，一层一个判据：
 *   约束层 —— 只有虚空格能放（`装饰只能摆在虚空格上` 那条用例）；
 *   渲染层 —— 装饰层的绘制顺序排在所有格子之后。SVG 按文档顺序绘制，排在后面才盖得住。
 */
test('装饰层的绘制顺序排在所有格之后（这就是"在虚空格上面"的实现）', () => {
    const { editor, element } = createEditor();
    editor.setSize(20, 11);
    const html = String(element('board').__html || '');
    const decorLayer = html.indexOf('<g class="decorLayer">');
    assert.ok(decorLayer > 0, '网格里没有装饰层');
    assert.ok(decorLayer > html.lastIndexOf('class="hex"'),
        '装饰层必须排在所有 hex 之后，否则装饰会被格子盖住');
});

test('资源图标笔刷独立于主城模式：只能放中立格，固定与自选地图均可保存', () => {
  const { editor } = createEditor();
  editor.setSize(20, 11);
  editor.setResourceBrush('chest');
  assert.equal(editor.paint(18, 1, 'resource'), false, '主城分区格不能放资源');
  assert.equal(editor.paint(12, 1, 'resource'), true);
  editor.setResourceBrush('gold');
  assert.equal(editor.paint(12, 5, 'resource'), true);
  editor.setResourceBrush('mine');
  assert.equal(editor.paint(12, 9, 'resource'), true);

    let state = editor.state();
    assert.equal(state.cityMode, 'fixed');
    assert.deepEqual(JSON.parse(JSON.stringify(state.json.resourcePoints)), [
        { row: 12, column: 1, pool: { chest: 1 } },
        { row: 12, column: 5, pool: { gold: 1 } },
        { row: 12, column: 9, pool: { mine: 1 } },
    ]);

    editor.setCityMode('select');
    state = editor.state();
    assert.equal(state.cityMode, 'select');
    assert.deepEqual(JSON.parse(JSON.stringify(state.json.resourcePoints)), [
        { row: 12, column: 1, pool: { chest: 1 } },
        { row: 12, column: 5, pool: { gold: 1 } },
        { row: 12, column: 9, pool: { mine: 1 } },
    ], '切换到自选主城不得丢失地图资源配置');
    assert.match(editor.resourceMarkup(), /map-resource\/image%2Fmap-resource%2Fchest/);

    editor.removeResourcePoint(1);
    assert.equal(editor.state().json.resourcePoints.length, 2);
    editor.undo();
    assert.equal(editor.state().json.resourcePoints.length, 3, '资源点删除应可撤销');
});

test('导入地图也拒绝落在分区格上的资源点', () => {
    const { editor } = createEditor();
    assert.throws(() => editor.applyLayout({
        version: 3, id: 'invalid-resource', rows: 8, columns: 8, playerCount: 2, cityMode: 'select',
        mirrorVertical: false, mirrorHorizontal: false,
        ascii: Array.from({ length: 8 }, () => '11111111'),
        resourcePoints: [{ row: 3, column: 3, pool: { chest: 1 } }],
    }), /中立格/);
});

test('装饰只能摆在虚空格上；可通行格一律拒绝', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.setDecorBrush('image/decor/reef');
    assert.equal(editor.paint(10, 5, 'decor'), false, '中立格不该接受装饰');
    assert.equal(editor.decorCount(), 0);
    assert.ok(!editor.validate().checks.some((check: string[]) => check[1].indexOf('虚空装饰') === 0),
        '一格装饰都没有时，校验面板不该出现装饰那一行');

    editor.paint(10, 5, 'void');
    assert.equal(editor.paint(10, 5, 'decor'), true, '虚空格应该能摆装饰');
    assert.equal(editor.state().decor[10][5], 'image/decor/reef');
    assert.equal(editor.buildJSON().art.tiles['10,5'], 'image/decor/reef');
});

test('装饰跟随镜像：只写存储侧，对侧由镜像生成，导出两侧都有键', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/rock');
    editor.paint(10, 5, 'decor');
    const state = editor.state();
    assert.equal(state.decor[10][5], 'image/decor/rock');
    assert.equal(state.decor[9][5], 'image/decor/rock', '对侧应由镜像生成，否则导出后只有半边有装饰');
    const tiles = editor.buildJSON().art.tiles;
    assert.equal(tiles['10,5'], 'image/decor/rock');
    assert.equal(tiles['9,5'], 'image/decor/rock');
});

test('虚空被涂成可通行格时，格上的装饰自动收回（装饰不能留在陆地上）', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/wreck');
    editor.paint(10, 5, 'decor');
    assert.equal(editor.decorCount(), 2, '存储侧 + 镜像侧各一格');
    editor.paint(10, 5, 'neutral');
    assert.equal(editor.decorCount(), 0, '陆地不该留着装饰');
    assert.equal(editor.buildJSON().art, undefined, '装饰清空后不该留一个空 art 对象');
    assert.ok(editor.validate().checks.every((check: string[]) => check[0] !== 'err'),
        '收回装饰后不该有校验错误：' + JSON.stringify(editor.validate().checks));
});

test('装饰笔刷右键擦装饰，不动虚空本身', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/reef');
    editor.paint(10, 5, 'decor');
    editor.paint(10, 5, 'decor-clear');
    assert.equal(editor.decorCount(), 0);
    assert.equal(editor.state().grid[10][5], -1, '擦装饰不该顺手把格子改成别的分区');
});

test('装饰笔刷受半径影响，但只落在虚空格上', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/reef');
    const cells = editor.brushCells(10, 5, 1);
    editor.paintCells(cells, 'decor');
    // 7 格笔刷里只有 (10, 5) 与镜像伙伴 (9, 5) 是虚空 —— 两格映射到同一个存储侧格。
    assert.equal(editor.decorCount(), 2, '可通行格上不该被写上装饰');
    assert.ok(editor.validate().checks.every((check: string[]) => check[0] !== 'err'),
        '装饰跳过可通行格不该产生校验错误：' + JSON.stringify(editor.validate().checks));
});

test('载入时按虚空格过滤装饰：压在陆地里的丢弃，虚空格上的保留', () => {
    const { editor } = createEditor();
    const ascii = [];
    for (let row = 0; row < 8; row += 1) ascii.push(row === 0 ? '.0000000' : '00000000');
    editor.applyLayout({
        version: 3, id: 'decor-load', name: '装饰载入', rows: 8, columns: 8,
        playerCount: 3, cityMode: 'select', mirrorVertical: false, mirrorHorizontal: false,
        ascii,
        art: {
            background: 'image/decor_bg',
            tiles: { neutral: 'image/neutral', '0,0': 'image/decor/reef', '3,3': 'image/decor/rock' },
        },
    });
    const state = editor.state();
    assert.equal(state.decor[0][0], 'image/decor/reef', '虚空格上的装饰必须保留');
    assert.equal(state.decor[3][3], '', '压在陆地里的装饰必须丢弃');
    assert.equal(editor.validate().decor, 1);
    const art = editor.buildJSON().art;
    assert.equal(art.tiles['0,0'], 'image/decor/reef');
    assert.equal(art.tiles['3,3'], undefined, '被丢弃的装饰不能再写回去');
    assert.equal(art.tiles.neutral, 'image/neutral', '分区键要原样透传，不能跟装饰互相顶掉');
    assert.equal(art.background, 'image/decor_bg');
});

test('装饰清单来自服务端扫描结果，也接受手填的资源名', () => {
    const { editor } = createEditor();
    editor.setDecorLibrary(['image/decor/reef', 'image/decor/rock', 'image/decor/reef']);
    assert.equal(Array.from(editor.state().decorLibrary).join('|'), 'image/decor/reef|image/decor/rock',
        '清单要去重');
    editor.setDecorBrush('image/decor/custom_01');
    assert.equal(editor.state().decorBrush, 'image/decor/custom_01');
    assert.ok(Array.from(editor.state().decorLibrary).includes('image/decor/custom_01'),
        '手填的资源名要并进清单，否则界面上会"选中了却看不到"');
});

test('撤销能回退装饰的摆放与收回', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/reef');
    const before = editor.snapshot();
    editor.paint(10, 5, 'decor');
    assert.equal(editor.decorCount(), 2);
    assert.ok(editor.commitUndo(before));
    editor.undo();
    assert.equal(editor.decorCount(), 0, '撤销后装饰应消失');
    editor.redo();
    assert.equal(editor.decorCount(), 2, '重做后装饰应回来');
});

// ---- 看到装饰 / 记住资源名 ---------------------------------------------------------
// 需求原话：「不能我一刷新又要重新定义资源，最好是能够在编辑器看到虚空格装饰」。

test('装饰清单分开收「已出图」与「自定义」：只有前者算有图', () => {
    const { editor } = createEditor();
    editor.setDecorLibrary(['image/decor/reef'], ['image/decor/custom_01', 'image/decor/reef']);
    assert.equal(Array.from(editor.state().decorLibrary).join('|'),
        'image/decor/reef|image/decor/custom_01', '两组并起来去重');
    assert.equal(Array.from(editor.state().decorImages).join('|'), 'image/decor/reef',
        '只有扫到美术的才算"有图"，自定义名仍是占位');
});

// 「decor 目录里有资源，弄个小组件显示出来」：面板从竖排文字列表改成按主题分组的缩略图网格。
// 分组本身做成纯函数，好在这里直接钉死顺序与归组口径。
test('装饰清单按 image/decor 下的子目录分组：主题各一组、散落归「其他」、不在资源目录下的归「自定义」', () => {
    const { editor } = createEditor();
    const groups = editor.groupDecorEntries([
        'image/decor/sea/reef',
        'image/decor/desert/rock',
        'image/decor/sea/whirlpool',
        'image/decor/loose_one',
        'reef_01',
        'image/decor/sea/reef',
    ], { 'image/decor/sea/reef': true, 'image/decor/desert/rock': true });

    assert.equal(
        groups.map((g: any) => `${g.title}:${g.items.map((i: any) => i.name).join(',')}`).join(' | '),
        'desert:image/decor/desert/rock | sea:image/decor/sea/reef,image/decor/sea/whirlpool | ' +
        '其他:image/decor/loose_one | 自定义:reef_01',
        '组按标题字典序（英文主题在前、中文组在后），组内按全名排序，重复名只留一次');

    const sea = groups.filter((g: any) => g.title === 'sea')[0];
    assert.equal(sea.items[0].label, 'reef', '卡片上只写末段名，全名留给 title');
    assert.equal(sea.items[0].hasArt, true);
    assert.equal(sea.items[1].hasArt, false, '没扫到图的仍是占位');
});

test('装饰面板渲染成缩略图网格：有组标题、有卡片、有图的用 <img>', () => {
    const { editor, element } = createEditor();
    editor.setDecorLibrary(['image/decor/sea/reef', 'image/decor/desert/rock'], []);
    const html = element('decorList').innerHTML as string;

    assert.ok(html.includes('<p class="decorGroupTitle">desert<em>1</em></p>'), '分组标题要带条数');
    assert.ok(html.includes('<p class="decorGroupTitle">sea<em>1</em></p>'));
    assert.ok(html.includes('class="decorGrid"'), '每组一个网格容器');
    assert.ok(html.includes('data-decor="image/decor/sea/reef"'));
    assert.ok(html.includes('class="swDecorImg"') && html.includes('src="/decor/image/decor/sea/reef"'),
        '出了图的画真缩略图');
    assert.ok(html.indexOf('data-decor=""') < html.indexOf('decorGroupTitle'),
        '「不摆装饰」固定在分组之前，不参与归组');
});

test('出了图的装饰在格子上画真图（按顶面 123×90），没出图的画占位菱形', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.setDecorLibrary(['image/decor/reef'], ['image/decor/custom_01']);
    editor.paint(10, 5, 'void');
    editor.paint(10, 3, 'void');
    editor.setDecorBrush('image/decor/reef');
    editor.paint(10, 5, 'decor');
    editor.setDecorBrush('image/decor/custom_01');
    editor.paint(10, 3, 'decor');

    const markup = editor.decorMarkup();
    assert.match(markup,
        /<image class="decorImage"[^>]*data-decor="image\/decor\/reef"[^>]*href="\/decor\/image\/decor\/reef"/,
        '出了图的装饰必须画真图，而不是让策划对着菱形猜');
    assert.ok(markup.includes('width="123.0"') && markup.includes('height="90.0"'),
        '装饰图按顶面 123×90 贴，编辑器里看到的大小就是游戏里的大小');
    assert.ok(markup.includes('preserveAspectRatio="xMidYMid meet"'), '等比缩，不能拉伸变形');
    assert.match(markup, /<path class="decorMark"[^>]*data-decor="image\/decor\/custom_01"/,
        '没出图的名字退回占位菱形');
    assert.ok(!markup.includes('href="/decor/image/decor/custom_01"'),
        '没出图的名字不该去拉一张不存在的图（控制台会刷 404）');
});

test('自定义装饰名会记到服务端 —— 刷新之后不用重新定义', async () => {
    const posts: Array<{ path: string; body: unknown }> = [];
    const { editor } = createEditor({
        fetch: async (path: string, options?: any) => {
            const method = (options && options.method) || 'GET';
            if (method === 'POST') posts.push({ path, body: options.body });
            // 页面初始化时编辑器自己会拉一次预设与装饰清单 —— 给一份稳定数据，
            // 免得它把用例中途设好的清单覆盖成空。
            return {
                ok: true,
                json: async () => path === '/api/decor'
                    ? { decor: ['image/decor/reef'], custom: [] }
                    : { presets: [] },
            };
        },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(posts.length, 0, '拉清单是 GET，不该被记成"新增自定义名"');

    await editor.rememberDecorName('image/decor/reef');
    assert.equal(posts.length, 0, '扫到美术的名字已经在清单里，不必再记一遍');
    await editor.rememberDecorName('image/decor/custom_01');
    assert.equal(posts.length, 1, '自定义名必须写回服务端，否则刷新就丢');
    assert.equal(posts[0].path, '/api/decor');
    assert.deepEqual(JSON.parse(String(posts[0].body)), { name: 'image/decor/custom_01' });
});

// ---- 多格装饰 + art.background（新格式） ----------------------------------------
//
// 装饰从单格单图扩展成「多格 + 像素偏移」是为了让礁石 / 沉船这种大图能跨多格。
// 数据格式：`art.tiles['行,列']` 的值可以是字符串（老格式 / 单格等价），
// 也可以是 `{ art, span, offset }`（多格装饰）—— 键固定是 anchor 格。
//
// 关键不变量：
//   1. span 缺省 = `[[0, 0]]`，offset 缺省 = `[0, 0]`，**单格等价**退化成字符串（与旧 art.tiles 兼容）。
//   2. 镜像侧 span 按镜像轴翻转（dr → -dr、dc → -dc），offset 整体保留 —— 不然镜像侧
//      装饰形状会反过来。
//   3. 加载外部 JSON 时多格装饰 = 整片 span cell 都必须在虚空格上；任一格不是虚空 → 整片丢。
//   4. art.background 默认 `image/zdbg1`（最常用的海岛沙地），不是默认时写出。
// 这些口径由下面五条用例守。任何一条红 = 装饰或背景的格式契约被打破。

test('parseDecorEntry 兼容三种输入：空、字符串、对象；非法输入 → null', () => {
    const { editor } = createEditor();
    assert.equal(editor.parseDecorEntry(null), null);
    assert.equal(editor.parseDecorEntry(undefined), null);
    assert.equal(editor.parseDecorEntry(''), null);
    assert.equal(editor.parseDecorEntry('image/decor/reef').art, 'image/decor/reef');
    assert.equal(JSON.stringify(editor.parseDecorEntry('image/decor/reef').span), JSON.stringify([[0, 0]]));
    assert.equal(JSON.stringify(editor.parseDecorEntry('image/decor/reef').offset), JSON.stringify([0, 0]));
    // span / offset 字段缺省时回退到默认；非法 span 项会被过滤掉，全坏掉才回退到 [[0,0]]。
    assert.equal(JSON.stringify(editor.parseDecorEntry({ art: 'image/decor/wreck' }).span), JSON.stringify([[0, 0]]));
    assert.equal(JSON.stringify(editor.parseDecorEntry({ art: 'image/decor/wreck' }).offset), JSON.stringify([0, 0]));
    assert.equal(JSON.stringify(editor.parseDecorEntry({ art: 'image/decor/wreck', span: [[0, 0], [0, 1], [1, 0]], offset: [10, -5] }).span), JSON.stringify([[0, 0], [0, 1], [1, 0]]));
    assert.equal(JSON.stringify(editor.parseDecorEntry({ art: 'image/decor/wreck', span: [[0, 0], [0, 1], [1, 0]], offset: [10, -5] }).offset), JSON.stringify([10, -5]));
    // span 项必须是数字数组，混进字符串 / null 都过滤。
    assert.equal(JSON.stringify(editor.parseDecorEntry({ art: 'image/x', span: [[0, 0], 'bad', [null, 1]] }).span), JSON.stringify([[0, 0]]));
    // 缺 art 直接 null。
    assert.equal(editor.parseDecorEntry({}), null);
    assert.equal(editor.parseDecorEntry({ span: [[0, 0]] }), null);
    // 数组 / 数字不是合法装饰。
    assert.equal(editor.parseDecorEntry([]), null);
    assert.equal(editor.parseDecorEntry(42), null);
});

test('mirrorDecorEntry 上下 / 左右翻转：dr → -dr、dc → -dc；不翻转时原样', () => {
    const { editor } = createEditor();
    const entry = { art: 'image/decor/wreck', span: [[0, 0], [0, 1], [1, 0], [1, 1]], offset: [10, -5] };
    // 不翻转 = 原样。
    assert.equal(JSON.stringify(editor.mirrorDecorEntry(entry, false, false).span), JSON.stringify([[0, 0], [0, 1], [1, 0], [1, 1]]));
    assert.equal(JSON.stringify(editor.mirrorDecorEntry(entry, false, false).offset), JSON.stringify([10, -5]));
    // 上下翻转：dr 取反，dc 不变。
    const v = editor.mirrorDecorEntry(entry, true, false);
    assert.equal(JSON.stringify(v.span), JSON.stringify([[-0, 0], [-0, 1], [-1, 0], [-1, 1]]));
    assert.equal(JSON.stringify(v.offset), JSON.stringify([10, -5]));
    // 左右翻转：dc 取反，dr 不变。
    const h = editor.mirrorDecorEntry(entry, false, true);
    assert.equal(JSON.stringify(h.span), JSON.stringify([[0, -0], [0, -1], [1, -0], [1, -1]]));
    assert.equal(JSON.stringify(h.offset), JSON.stringify([10, -5]));
    // 同时翻：dr、dc 都取反。
    const b = editor.mirrorDecorEntry(entry, true, true);
    assert.equal(JSON.stringify(b.span), JSON.stringify([[-0, -0], [-0, -1], [-1, -0], [-1, -1]]));
    assert.equal(JSON.stringify(b.offset), JSON.stringify([10, -5]));
});

test('多格装饰落点：整片 cell 必须都是虚空；任一格不是虚空 → 整片跳过', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    // 1×3 装饰：3 格连成一片。
    editor.setDecorBrush('image/decor/wreck');
    editor.setDecorShape('1x3');
    // 全部三格都是虚空 → 落点成功，写到 anchor (10, 5)。
    editor.paint(10, 5, 'void');
    editor.paint(10, 6, 'void');
    editor.paint(10, 7, 'void');
    assert.equal(editor.paint(10, 5, 'decor'), true);
    // 落盘 = `{ art, span, offset }` 对象（多格不再退化成字符串）。
    const tile = editor.buildJSON().art.tiles['10,5'];
    assert.equal(typeof tile, 'object');
    assert.equal(tile.art, 'image/decor/wreck');
    assert.equal(JSON.stringify(tile.span), JSON.stringify([[0, 0], [0, 1], [0, 2]]));
    assert.equal(JSON.stringify(tile.offset), JSON.stringify([0, 0]));
    // 第二格里已经有别的 art → 装饰 1×3 占的 (10, 5)~(10, 7) 中 (10, 6) 已被装饰本身占着，
    // 重新摆同一形状 = 等价（alreadySame）→ 不报 changed；摆 (10, 6) 这格 anchor = 跨 6,7,8，
    // (10, 7) 已被装饰 1 占了 → blocked。
    assert.equal(editor.paint(10, 6, 'decor'), false, '1×3 anchor 落在已有装饰的 (10, 6) → 整片跳过');
    // 中间一格 (10, 6) 改成可通行格 → 装饰 1 失去落脚点，自动 prune。
    editor.paint(10, 6, 'neutral');
    assert.equal(editor.decorCount(), 0, '中间一格被涂成可通行 → 整片装饰收回');
});

test('多格装饰跟随镜像：存储侧 anchor → 镜像侧 anchor 也摆多格；span 按镜像轴翻转', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(15, 5, 'void');
    editor.paint(15, 6, 'void');
    editor.setDecorBrush('image/decor/wreck');
    editor.setDecorShape('1x2');
    editor.paint(15, 5, 'decor');
    const tiles = editor.buildJSON().art.tiles;
    // 存储侧 = 多格对象。
    assert.equal(typeof tiles['15,5'], 'object');
    assert.equal(JSON.stringify(tiles['15,5'].span), JSON.stringify([[0, 0], [0, 1]]));
    // 上下镜像侧 = span dr 取反；用数字下标访问数组（'4,5' 字符串作下标 = undefined）。
    const mirrorRow = 20 - 1 - 15;
    const state = editor.state();
    assert.equal(typeof state.decor[mirrorRow][5], 'object');
    assert.equal(JSON.stringify(state.decor[mirrorRow][5].span), JSON.stringify([[-0, 0], [-0, 1]]));
    // offset 不翻转（像素偏移对镜像侧方向不变）。
    assert.equal(JSON.stringify(state.decor[mirrorRow][5].offset), JSON.stringify([0, 0]));
});

test('单格等价落盘退化成字符串；带 offset / 多格 span 一律写对象', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    editor.paint(10, 5, 'void');
    editor.setDecorBrush('image/decor/reef');
    // 单格等价 = 字符串。
    editor.paint(10, 5, 'decor');
    assert.equal(editor.buildJSON().art.tiles['10,5'], 'image/decor/reef');
    // 加 offset 后虽然 span 还是单格，但 offset 非零 → 必须写对象（保留 offset 字段）。
    editor.nudgeDecorOffset(10, -5);
    editor.paint(10, 5, 'decor');
    const withOffset = editor.buildJSON().art.tiles['10,5'];
    assert.equal(typeof withOffset, 'object');
    assert.equal(withOffset.offset[0], 10);
    assert.equal(withOffset.offset[1], -5);
});

test('载入外部 art.tiles：新格式 `{ art, span, offset }` 还原成多格装饰；非法 span 整片丢', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    // 行 10/15 的 5/6 列必须是虚空（VOID = '.'）—— 落盘装饰的宿主格约束与 paint 一致。
    // 全中立底图会把装饰整片丢，所以必须把目标格切到 '.' 才能验证"还原成多格"。
    const ascii: string[] = [];
    for (let row = 0; row < 20; row += 1) {
        ascii.push((row === 10 || row === 15) ? '00000..0000' : '00000000000');
    }
    editor.applyLayout({
        version: 3, id: 'multi-cell-decor', name: 'multi-cell', rows: 20, columns: 11,
        playerCount: 2, cityMode: 'fixed',
        mirrorVertical: false, mirrorHorizontal: false, mirror180: false,
        ascii,
        art: {
            tiles: {
                // 1×2 装饰，anchor 在 (10, 5) → 实际占 (10, 5)、(10, 6)。
                '10,5': { art: 'image/decor/wreck', span: [[0, 0], [0, 1]], offset: [3, -2] },
                // span 中有格子不在地图内 → 整片丢。
                '15,5': { art: 'image/decor/wreck', span: [[0, 0], [0, 1], [0, 100]] },
            },
        },
    } as any);
    const state = editor.state();
    assert.equal(JSON.stringify(state.decor[10][5].span), JSON.stringify([[0, 0], [0, 1]]));
    assert.equal(JSON.stringify(state.decor[10][5].offset), JSON.stringify([3, -2]));
    assert.equal(state.decor[10][5].art, 'image/decor/wreck');
    // 越界的整片丢。
    assert.equal(state.decor[15][5], '', '越界 span 整片丢，anchor 那格留空');
});

test('art.background：默认 = image/zdbg1；地图 JSON 里写了的就拿出来；落盘非默认时写出', () => {
    const { editor } = createEditor();
    // 默认 = image/zdbg1 ⇒ 默认值不写盘，art 字段也可能省略（看 art 内是否有别的东西）。
    assert.equal(editor.buildJSON().art?.background, undefined, '默认值不写盘，省一次写');
    editor.applyLayout({
        version: 3, id: 'bg', name: 'bg', rows: 8, columns: 8,
        playerCount: 2, cityMode: 'fixed',
        mirrorVertical: false, mirrorHorizontal: false, mirror180: false,
        ascii: Array.from({ length: 8 }, () => '00000000'),
        art: { background: 'image/zdbg2' },
    } as any);
    // 地图写了 image/zdbg2 → 拿出来。
    assert.equal(editor.buildJSON().art.background, 'image/zdbg2', '非默认 background 要写出');
    // 地图没写 → 回退到默认 image/zdbg1。
    editor.applyLayout({
        version: 3, id: 'bg2', name: 'bg2', rows: 8, columns: 8,
        playerCount: 2, cityMode: 'fixed',
        mirrorVertical: false, mirrorHorizontal: false, mirror180: false,
        ascii: Array.from({ length: 8 }, () => '00000000'),
        art: { tiles: { neutral: 'image/neutral' } },
    } as any);
    assert.equal(editor.buildJSON().art.background, undefined, '默认 background 不写出');
});
