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

function createEditor(options: { hash?: string; fetch?: (path: string, options?: any) => Promise<any>; confirm?: boolean } = {}) {
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
    const confirmCalls: string[] = [];
    const window: any = {
        addEventListener() {}, location: { hash: options.hash || '' },
        confirm(message: string) { confirmCalls.push(message); return options.confirm !== false; },
    };
    const code = readFileSync('tools/map-editor/app.js', 'utf8');
    runInNewContext(code, {
        document, window, fetch: options.fetch || (() => new Promise(() => {})),
        setTimeout: () => 0, clearTimeout() {}, console,
    });
    return { editor: window.__editor, element, confirmCalls };
}

test('区域清空只删除当前分区与纵深，确认后可撤销恢复倾向与其他区域', () => {
    const { editor, element, confirmCalls } = createEditor();
    editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
    });
    editor.setRegionBrush(1, 'front');
    editor.paint(7, 0, 'region');
    editor.setRegionBrush(1, 'mid');
    editor.setRegionTendency('develop');
    editor.paint(7, 1, 'region');
    editor.setRegionBrush(2, 'front');
    editor.paint(7, 2, 'region');
    editor.setRegionBrush(1, 'front');

    element('btnClearRegion').listeners.click();

    assert.equal(confirmCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.state().regions)), [
        { section: 1, depth: 'mid', cells: [85], tendency: 'develop' },
        { section: 2, depth: 'front', cells: [86], tendency: 'rush' },
    ]);
    assert.equal(editor.undo(), true);
    assert.equal(editor.state().regions.length, 3, '撤销恢复已清区域及其倾向');
});

test('装饰批量清空需确认、清除选择与检查器，并可撤销恢复全部装饰', () => {
    const { editor, element, confirmCalls } = createEditor();
    const first = editor.addFreeDecor('image/decor/rock/a', 10, 20);
    editor.addFreeDecor('image/decor/rock/b', 30, 40);
    editor.selectFreeDecor(first);

    element('btnClearDecorations').listeners.click();

    assert.equal(confirmCalls.length, 1);
    assert.equal(editor.state().freeDecor.length, 0);
    assert.equal(editor.state().selectedFreeDecorId, null);
    assert.equal(element('freeDecorInspector').hidden, true);
    assert.equal(editor.undo(), true);
    assert.equal(editor.state().freeDecor.length, 2);
});

test('中立资源批量清空只移除资源点，取消确认不改动且不入撤销栈', () => {
    const cancelled = createEditor({ confirm: false });
    cancelled.editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('NNNNNNNNNNNN'),
    });
    cancelled.editor.addResourcePoint(2, 1, 'chest', 1);
    cancelled.editor.addResourcePoint(2, 7, 'gold', 2);
    const before = JSON.stringify(cancelled.editor.state().resourcePoints);
    cancelled.element('btnClearResources').listeners.click();
    assert.equal(cancelled.confirmCalls.length, 1);
    assert.equal(JSON.stringify(cancelled.editor.state().resourcePoints), before);
    assert.equal(cancelled.editor.undo(), true);
    assert.equal(cancelled.editor.state().resourcePoints.length, 1,
        '取消清空没有入历史；撤销只撤回此前最后一次资源点编辑');

    const accepted = createEditor();
    accepted.editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('NNNNNNNNNNNN'),
    });
    accepted.editor.addResourcePoint(2, 1, 'chest', 1);
    accepted.editor.addResourcePoint(2, 7, 'gold', 2);
    accepted.editor.setRegionBrush(1, 'front');
    accepted.editor.paint(3, 3, 'region');
    accepted.element('btnClearResources').listeners.click();
    assert.equal(accepted.editor.state().resourcePoints.length, 0);
    assert.equal(accepted.editor.state().regions.length, 1, '区域数据不受影响');
    assert.equal(accepted.editor.undo(), true);
    assert.equal(accepted.editor.state().resourcePoints.length, 2);
});

test('全图清空始终由可见地图操作按钮触发并在确认后可撤销', () => {
    const { editor, element, confirmCalls } = createEditor();
    editor.addFreeDecor('image/decor/rock/a', 10, 20);
    element('btnClearMap').listeners.click();
    assert.equal(confirmCalls.length, 1);
    assert.match(confirmCalls[0], /重置地形、主城落点与自由装饰/);
    assert.match(confirmCalls[0], /保留区域标记和中立资源点/);
    assert.equal(editor.state().freeDecor.length, 0);
    assert.equal(editor.undo(), true);
    assert.equal(editor.state().freeDecor.length, 1);

    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    assert.match(html, /id="btnClearMap"/);
    assert.doesNotMatch(html, /id="btnClear"/);
});

test('空范围清空不弹确认、不创建撤销记录；各分类面板提供批量清空按钮', () => {
    const { editor, element, confirmCalls } = createEditor();
    assert.equal(editor.clearSelectedRegion(), false);
    assert.equal(editor.clearFreeDecor(), false);
    assert.equal(editor.clearResourcePoints(), false);
    assert.equal(confirmCalls.length, 0);
    assert.equal(editor.undo(), false);

    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    assert.match(html, /id="btnClearRegion"/);
    assert.match(html, /id="btnClearDecorations"/);
    assert.match(html, /id="btnClearResources"/);
    assert.match(html, /data-tool-category="decor"[^]*id="btnClearDecorations"/);
    assert.match(html, /data-tool-category="resources"[^]*id="btnClearResources"/);
    assert.match(html, /data-tool-category="regions"[^]*id="btnClearRegion"/);
    assert.equal(typeof element('btnClearRegion').listeners.click, 'function');
    assert.equal(typeof element('btnClearDecorations').listeners.click, 'function');
    assert.equal(typeof element('btnClearResources').listeners.click, 'function');
    assert.equal(typeof element('btnClearMap').listeners.click, 'function');
});

test('清空当前区域时，无匹配标记和清空成功都会给出可见反馈', () => {
    const empty = createEditor();
    empty.editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
    });
    empty.editor.setRegionBrush(1, 'front');
    empty.element('btnClearRegion').listeners.click();
    assert.match(empty.element('libFlash').textContent, /前区.*没有区域标记/);
    assert.equal(empty.confirmCalls.length, 0);

    const populated = createEditor();
    populated.editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
    });
    populated.editor.setRegionBrush(1, 'front');
    populated.editor.paint(7, 0, 'region');
    populated.element('btnClearRegion').listeners.click();
    assert.match(populated.element('libFlash').textContent, /已清空.*前区/);
});

test('左栏长说明收纳为可点击的问号帮助气泡', () => {
    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    assert.match(html, /<details class="helpTip">/);
    assert.match(html, /查看中立资源说明/);
    assert.match(html, /查看操作说明/);
    assert.match(html, /\.helpBubble/);
});

test('左侧分类工具箱切换面板并保持地图画布常驻', () => {
    const { editor, element } = createEditor();
    assert.equal(element('groupTerrain').hidden, false);
    assert.equal(element('groupRegions').hidden, true);
    assert.equal(element('stage').hidden, false);

    element('categoryRegions').listeners.click();

    assert.equal(element('groupTerrain').hidden, true);
    assert.equal(element('groupRegions').hidden, false);
    assert.equal(element('categoryRegions').className.includes('on'), true);
    assert.equal(element('stage').hidden, false);

    element('categoryAdvanced').listeners.click();
    assert.equal(element('groupRegions').hidden, true);
    assert.equal(element('groupZoom').hidden, false);
    assert.equal(element('categoryAdvanced').className.includes('on'), true);
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

    // 🔴 除了尺寸，**落点**也要钉住：台面在 `hexCenter`（整图中心）上方 topLift，而本文件 y 向下
    //    ⇒ 轮廓中心 y = hexCenter.y − topLift。写成 +topLift 会把整张网格画低 25px，
    //    与"装饰贴在格面上"（decorMarkup 的 `center.y - yShift`）差出 2×topLift —— 点一格摆装饰、
    //    装饰却浮在六边形外面。这条断言就是为了让那个符号反了立刻变红。
    const row = Number(path![2]);
    const column = Number(path![3]);
    const center = editor.hexCenter(row, column);
    const outlineCenterY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const outlineCenterX = (Math.min(...xs) + Math.max(...xs)) / 2;
    assert.ok(Math.abs(outlineCenterX - center.x) < 0.05, `轮廓中心 x 应落在格心 ${center.x}`);
    assert.ok(Math.abs(outlineCenterY - (center.y - editor.geometry.topLift)) < 0.05,
        `轮廓中心 y 应为格心 − topLift = ${center.y - editor.geometry.topLift}（不是格心本身、也不是格心 + topLift），实际 ${outlineCenterY}`);
});

// ---- 场景装饰 -------------------------------------------------------------------
test('自由装饰层排在所有格之后', () => {
    const { editor, element } = createEditor();
    editor.setSize(20, 11);
    const html = String(element('board').__html || '');
    const decorLayer = html.indexOf('<g class="freeDecorLayer">');
    assert.ok(decorLayer > 0, '网格里没有自由装饰层');
    assert.ok(decorLayer > html.lastIndexOf('class="hex"'));
});

test('选中装饰后四角都有缩放柄：视觉小圆 + 更大的透明命中圆（角点外部也能抓住）', () => {
    const { editor } = createEditor();
    editor.setDecorLibrary(['image/decor/rock/large'], [], {});
    const id = editor.addFreeDecor('image/decor/rock/large', 12, 34);
    editor.selectFreeDecor(id);
    const markup = editor.freeDecorMarkup();
    // 四角 ×（视觉圆 + 命中圆）= 8 个 scale 手柄，每个都带角符号。
    const handles = markup.match(/data-handle="scale"/g) || [];
    assert.equal(handles.length, 8, '四个角各一个视觉圆 + 一个命中圆');
    const corners = markup.match(/data-cx="-?1" data-cy="-?1"/g) || [];
    assert.equal(corners.length, 8, '每个手柄都带角符号（左上/右上/左下/右下各两次）');
    // 命中圆比视觉圆大：视觉 r=6、命中 r=14。
    assert.ok(markup.includes('r="6"') && markup.includes('r="14"'), '命中圆半径必须大于视觉圆');
    assert.ok(markup.includes('class="freeDecorHandleHit"'), '命中圆要带独立 class 供样式透明化');
    // 未选中时不画手柄。
    editor.selectFreeDecor(id);
    editor.selectFreeDecor(-999);
    assert.ok(!editor.freeDecorMarkup().includes('data-handle="scale"'), '取消选中后手柄消失');
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

// ---- art.background --------------------------------------------------------------
test('art.background：默认 = image/zdbg1；地图 JSON 里写了的就拿出来；落盘非默认时写出', () => {
    const { editor } = createEditor();
    // 默认 = image/zdbg1 ⇒ 默认值不写盘，art 字段也可能省略（看 art 内是否有别的东西）。
    assert.equal(editor.buildJSON().art?.background, undefined, '默认值不写盘，省一次写');
    editor.applyLayout({
        version: 3, id: 'bg', name: 'bg', rows: 8, columns: 8,
        playerCount: 2, cityMode: 'fixed',
        mirrorVertical: false, mirrorHorizontal: false, mirror180: false,
        ascii: Array.from({ length: 8 }, (_, row) => row === 2 ? '000.0000' : '00000000'),
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

test('自由装饰可放在可通行格并保存地图坐标与视觉变换', () => {
    const { editor } = createEditor();
    editor.setSize(20, 11);
    const center = editor.hexCenter(10, 5);
    const id = editor.addFreeDecor('image/decor/rock/large', center.x + 21, center.y - 13);
    const json = editor.buildJSON();

    assert.equal(json.art.freeDecor.length, 1);
    assert.deepEqual({ ...json.art.freeDecor[0] }, {
        id, art: 'image/decor/rock/large', x: center.x + 21, y: center.y - 13,
        width: 276.75, height: 90, rotation: 0, flipX: false, flipY: false, locked: false,
    });
    assert.equal(json.art.tiles?.['10,5'], undefined, '自由装饰不写入格子装饰表');
    assert.equal(editor.state().freeDecor.length, 1);
    assert.equal(editor.validate().decor, 1, '统计面板按自由装饰对象计数');
    assert.ok(editor.validate().checks.some((check: string[]) => check[1].startsWith('场景装饰：1 个')));
});

test('新摆放装饰默认按图片原始像素 1:1 落地；无尺寸（未出图）时回退旧默认', () => {
    const { editor } = createEditor();
    editor.setDecorLibrary(['image/decor/rock/large'], [], {
        'image/decor/rock/large': { width: 512, height: 384 },
    });
    const id = editor.addFreeDecor('image/decor/rock/large', 12, 34);
    let item = editor.state().freeDecor.find((entry: any) => entry.id === id);
    assert.equal(item.width, 512, '已出图的装饰默认宽 = 图片原始像素');
    assert.equal(item.height, 384, '已出图的装饰默认高 = 图片原始像素');
    assert.equal(editor.state().decorSizes['image/decor/rock/large'].width, 512,
        '尺寸映射要随清单一起暴露');

    // 没出图的自定义名没有尺寸键 → 旧默认（3 列距 × 1 行距）占位，出图后重摆即 1:1。
    const pendingId = editor.addFreeDecor('image/decor/not_yet', 60, 60);
    item = editor.state().freeDecor.find((entry: any) => entry.id === pendingId);
    assert.equal(item.width, editor.geometry.column * 3);
    assert.equal(item.height, editor.geometry.row);
});

test('自由装饰可选中移动、等比缩放、旋转、翻转，锁定后不动且操作可撤销', () => {
    const { editor } = createEditor();
    const id = editor.addFreeDecor('image/decor/rock/large', 12, 34);
    editor.moveSelectedFreeDecor(100, -80);
    editor.updateSelectedFreeDecor({ width: 400, height: 260, rotation: 18, flipX: true });
    let object = editor.state().freeDecor[0];
    assert.deepEqual(
        { x: object.x, y: object.y, width: object.width, height: object.height, rotation: object.rotation, flipX: object.flipX },
        { x: 100, y: -80, width: 400, height: 260, rotation: 18, flipX: true },
    );

    assert.equal(editor.setFreeDecorLocked(id, true), true);
    assert.equal(editor.moveSelectedFreeDecor(5, 6), false, '锁定后拖动必须无效');
    object = editor.state().freeDecor[0];
    assert.deepEqual({ x: object.x, y: object.y }, { x: 100, y: -80 });
    editor.undo();
    object = editor.state().freeDecor[0];
    assert.equal(object.locked, false, '撤销回退锁定动作');
    assert.equal(object.rotation, 18, '撤销锁定时保留之前的变换');

    editor.selectFreeDecor(id);
    const duplicateId = editor.duplicateFreeDecor(id);
    assert.notEqual(duplicateId, id);
    assert.equal(editor.state().freeDecor.length, 2);
    assert.equal(editor.deleteFreeDecor(duplicateId), true);
    assert.equal(editor.state().freeDecor.length, 1);
    editor.undo();
    assert.equal(editor.state().freeDecor.length, 2, '撤销恢复删除的副本');
    editor.redo();
    assert.equal(editor.state().freeDecor.length, 1, '重做再次删除副本');
});

test('自由装饰吸附开关只影响放置坐标，编辑器提供自由摆放工具', () => {
    const { editor, element } = createEditor();
    editor.setSize(20, 11);
    editor.setFreeDecorSnap(true);
    const id = editor.addFreeDecor('image/decor/rock/large', 2, 3);
    const snapped = editor.state().freeDecor.find((item: any) => item.id === id);
    assert.ok(snapped);
    const nearest = editor.cellAtLocal(2, 3);
    assert.ok(nearest);
    const nearestCenter = editor.hexCenter(nearest.row, nearest.column);
    assert.equal(snapped.x, nearestCenter.x);
    assert.equal(snapped.y, nearestCenter.y);

    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    assert.match(html, /id="decorList"/, '两种摆放模式共用同一套装饰资源清单');
    assert.match(html, /id="freeDecorInspector"/);
    assert.match(html, /id="freeDecorSnap"/);
    assert.match(String(element('board').__html || ''), /freeDecorLayer/);
});

test('装饰面板统一为自由摆放，选择资源后直接进入自由装饰笔刷', () => {
    const { editor } = createEditor();
    const html = readFileSync('tools/map-editor/index.html', 'utf8');

    assert.doesNotMatch(html, /id="segDecorKind"/, '不再让用户选择格子装饰或自由装饰');
    assert.doesNotMatch(html, /id="segDecorShape"/, '自由装饰不需要占格形状');
    assert.doesNotMatch(html, /id="freeDecorTileControls"/);
    assert.equal(editor.state().decorKind, 'free');

    editor.setDecorBrush('image/decor/rock/large');
    assert.equal(editor.state().brush, 'freeDecor');
});

test('装饰图库异步到达后重画装饰层：占位矩形换成真图 image', () => {
    const { editor } = createEditor();
    // 图库未到时先摆装饰 ⇒ 画布上是占位矩形（`loadDecorLibrary` 异步竞态的败方）。
    const id = editor.addFreeDecor('image/decor/wasteland/st3', 0, 0);
    assert.ok(id);
    const before = editor.freeDecorMarkup();
    assert.match(before, /freeDecorPlaceholder/, '图库未加载时画占位矩形');
    assert.doesNotMatch(before, /freeDecorImage/, '此时不应画图');
    // 图库到达：`setDecorLibrary` 注入有图清单 ⇒ 装饰层必须重画成真图。
    editor.setDecorLibrary(['image/decor/wasteland/st3'], [],
        { 'image/decor/wasteland/st3': { width: 247, height: 201 } });
    const after = editor.freeDecorMarkup();
    assert.match(after, /freeDecorImage/, '图库到达后必须画真图');
    assert.doesNotMatch(after, /freeDecorPlaceholder/, '占位矩形应被替换');
});

test('载入旧地图时忽略 art.tiles 的按格装饰，保存后只保留地块贴图和自由装饰', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3, id: 'legacy-decor', name: '旧装饰', rows: 8, columns: 8,
        playerCount: 2, cityMode: 'select', mirrorVertical: false, mirrorHorizontal: false,
        ascii: Array.from({ length: 8 }, (_, row) => row === 0 ? '.0000000' : '00000000'),
        art: {
            tiles: { neutral: 'image/tiles/neutral', '0,0': 'image/decor/legacy-rock' },
        },
    });

    assert.equal(editor.state().freeDecor.length, 0, '旧按格装饰不导入编辑器，策划重新自由摆放');
    const id = editor.addFreeDecor('image/decor/new-rock', 30, 40);
    const art = editor.buildJSON().art;
    assert.equal(art.tiles.neutral, 'image/tiles/neutral');
    assert.equal(art.tiles['0,0'], undefined);
    assert.equal(art.freeDecor[0].id, id);
});

test('背景图盒 = viewBox：始终全景铺满视口，平移时与棋盘一起拖动', () => {
    const { editor } = createEditor();
    const geometry = editor.geometry;
    const state = editor.state();

    // 基半宽 / 半高由棋盘尺寸直接推出（buildBoard 的公式，pad = 3）——
    // 用例自己算一遍，才能挡住"图盒与 viewBox 各算各的"这类漂移（曾经只遮住左上四分之一）。
    const PAD = 3;
    const baseHalfW = ((state.cols - 1) * geometry.column + geometry.imageWidth) / 2 + PAD;
    const baseHalfH = ((state.rows - 1) * geometry.row + geometry.imageHeight + 2 * geometry.phase) / 2 + PAD;
    const expectedHalfW = baseHalfW / state.zoom, expectedHalfH = baseHalfH / state.zoom;

    const rect = editor.viewportRect();
    assert.ok(Math.abs(rect.width - expectedHalfW * 2) < 1e-9, `图盒宽 = 2×视口半宽，实际 ${rect.width}`);
    assert.ok(Math.abs(rect.height - expectedHalfH * 2) < 1e-9, `图盒高 = 2×视口半高，实际 ${rect.height}`);
    // 视口以 (panX, panY) 为中心。
    assert.ok(Math.abs(rect.x + rect.width / 2 - state.panX) < 1e-9, '视口 x 中心应落在 panX');
    assert.ok(Math.abs(rect.y + rect.height / 2 - state.panY) < 1e-9, '视口 y 中心应落在 panY');

    // 图盒必须把棋盘整个盖住（否则就是"右半边没底图"）。
    assert.ok(rect.x <= -baseHalfW + 1e-9, `图盒左边界 ${rect.x} 应 ≤ 棋盘左边界 ${-baseHalfW}`);
    assert.ok(rect.x + rect.width >= baseHalfW - 1e-9, '图盒右边界应 ≥ 棋盘右边界（右侧不许露空）');
    assert.ok(rect.y + rect.height >= baseHalfH - 1e-9, '图盒下边界应 ≥ 棋盘下边界（下侧不许露空）');

    // 落盘的 <image> 属性：默认（zoom=1, pan=0）背景 = max(viewBox, 包围盒) = viewBox，
    // 中心锚定棋盘中心 —— 此时与 viewportRect 完全一致（drawBackground 不许另算一套）。
    const markup = editor.backgroundMarkup();
    const attr = (name: string): number => {
        const matched = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(markup);
        assert.ok(matched, `背景 <image> 缺 ${name} 属性：${markup}`);
        return Number(matched![1]);
    };
    assert.equal(attr('x'), Number(rect.x.toFixed(1)), 'image.x 必须等于视口 x');
    assert.equal(attr('y'), Number(rect.y.toFixed(1)), 'image.y 必须等于视口 y');
    assert.equal(attr('width'), Number(rect.width.toFixed(2)), 'image.width 必须等于视口宽');
    assert.equal(attr('height'), Number(rect.height.toFixed(2)), 'image.height 必须等于视口高');
    // 背景随 viewBox 平移（中心锚定棋盘 ⇒ 与棋盘一起拖动），缩放时保持全景铺满不裁切。
    assert.match(markup, /href="\/bg\/image\/zdbg1"/, '默认背景应请求 /bg/image/zdbg1');
    assert.match(markup, /preserveAspectRatio="xMidYMid slice"/, '必须是等比 cover，不是拉伸');
});

test('放大后背景锚定棋盘包围盒：与格子一起缩放，格子稳稳在背景上', () => {
    const { editor } = createEditor();
    const geometry = editor.geometry;
    const state = editor.state();
    const boardWidth = (state.cols - 1) * geometry.column + geometry.imageWidth;
    const boardHeight = (state.rows - 1) * geometry.row + geometry.imageHeight + 2 * geometry.phase;

    // 放大 2 倍 ⇒ viewBox 世界尺寸减半、小于包围盒 ⇒ 背景应锚定包围盒（随格子同比例放大）。
    editor.zoomAt(500, 500, 2);
    const rect = editor.viewportRect();
    assert.ok(rect.width < boardWidth, `放大后视口 ${rect.width} 应小于包围盒 ${boardWidth}`);
    const markup = editor.backgroundMarkup();
    const attr = (name: string): number => {
        const matched = new RegExp(`\\b${name}="([-\\d.]+)"`).exec(markup);
        assert.ok(matched, `背景 <image> 缺 ${name} 属性：${markup}`);
        return Number(matched![1]);
    };
    assert.ok(Math.abs(attr('width') - boardWidth) < 0.05,
        `背景宽应为包围盒 ${boardWidth}，实际 ${attr('width')}`);
    assert.ok(Math.abs(attr('height') - boardHeight) < 0.05,
        `背景高应为包围盒 ${boardHeight}，实际 ${attr('height')}`);
    assert.ok(Math.abs(attr('x') - (-boardWidth / 2)) < 0.05,
        `背景 x 应为 -包围盒/2（中心锚定棋盘），实际 ${attr('x')}`);
});

test('画布元素比例 = viewBox 比例：背景铺满画布，四周不露深色底', () => {
    const { editor, element } = createEditor();
    const board = element('board');
    // 模拟真实 DOM：画布挂在 `.stage` 容器下（初始桩没有父节点 ⇒ fitCanvas 自动跳过，
    // 这里补上后手动触发一次）。
    board.parentElement = { clientWidth: 900, clientHeight: 700 };
    board.style = { width: '', height: '' };
    editor.fitCanvas();
    const rect = editor.viewportRect();
    const width = Number.parseFloat(board.style.width);
    const height = Number.parseFloat(board.style.height);
    assert.ok(width > 0 && height > 0, `画布应有非零尺寸，实际 ${width}×${height}`);
    assert.ok(Math.abs(width / height - rect.width / rect.height) < 1e-6,
        `画布比例 ${(width / height).toFixed(4)} 应等于 viewBox 比例 ${(rect.width / rect.height).toFixed(4)}`);
    // contain 语义：画布不超出容器（stage 是 flex 居中，尺寸超了会被截掉）。
    assert.ok(width <= 900 + 1e-6 && height <= 700 + 1e-6, '画布必须 contained 在容器内');
    // 同值守卫：重复调用不重设样式（避免每次 render 都触发重排）。
    const before = `${board.style.width} ${board.style.height}`;
    editor.fitCanvas();
    assert.equal(`${board.style.width} ${board.style.height}`, before, '同值不应重设');
});

test('same neutral cell accumulates weighted resource choices and preserves them in undo/export', () => {
    const { editor } = createEditor();
    editor.addResourcePoint(12, 1, 'gold', 2);
    editor.addResourcePoint(12, 1, 'chest', 3);

    assert.deepEqual(JSON.parse(JSON.stringify(editor.state().json.resourcePoints[0].pool)), { gold: 2, chest: 3 });
    assert.match(editor.resourceMarkup(), /resourceChoiceCount/);
    assert.equal(editor.undo(), true);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.state().json.resourcePoints[0].pool)), { gold: 2 });
});

test('region brush edits round-trip through layout export and undo', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
    });

    let before = editor.snapshot();
    editor.setRegionBrush(1, 'front');
    editor.paint(7, 0);
    editor.commitUndo(before);

    assert.deepEqual(JSON.parse(JSON.stringify(editor.state().json.regions)), [{ section: 1, depth: 'front', cells: [84], tendency: 'rush' }]);
    assert.match(editor.mapMetadataMarkup(), /前区/);
    assert.equal(editor.undo(), true);
    assert.equal(editor.state().json.regions, undefined);
    assert.equal(editor.redo(), true);
    assert.equal(editor.state().json.regions[0].cells[0], 84);
});

test('镜像控件位于顶栏且自选主城范围由纵深区域定义', () => {
    const html = readFileSync('tools/map-editor/index.html', 'utf8');
    const headerStart = html.indexOf('<header>');
    const headerEnd = html.indexOf('</header>', headerStart);
    const header = html.slice(headerStart, headerEnd);
    const advancedStart = html.indexOf('id="groupAdvancedMirror"');
    const advancedEnd = html.indexOf('</div>', advancedStart);
    assert.match(header, /id="optMirrorV"/);
    assert.match(header, /id="optMirrorH"/);
    assert.ok(advancedStart < 0 || advancedStart >= headerEnd, '高级设置中不应再放镜像控件');
    assert.doesNotMatch(html, /homeCandidateSection|btnHomeCandidates|groupHomeCandidates/);
    assert.ok(advancedEnd < 0 || !html.slice(advancedStart, advancedEnd).includes('optMirrorV'));

    const { editor } = createEditor();
    editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [{ section: 1, depth: 'front', cells: [84] }],
        homeCandidates: [{ section: 1, cells: [85] }],
    });
    assert.deepEqual(JSON.parse(JSON.stringify(editor.buildJSON().regions)), [
        { section: 1, depth: 'front', cells: [84], tendency: 'rush' },
    ]);
    assert.equal(editor.buildJSON().homeCandidates, undefined, '旧字段可导入，但编辑器不再导出独立主城范围');
});

test('自选模式编辑默认主城时只允许放在对应分区的前中后区格', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3, rows: 8, columns: 12, playerCount: 2, cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [
            { section: 1, depth: 'front', cells: [84, 85] },
            { section: 2, depth: 'back', cells: [0, 1] },
        ],
    });
    editor.paint(7, 2, 'home');
    assert.equal(editor.state().homes[0], null, '区域以外的默认主城落点不应写入');
    editor.paint(7, 1, 'home');
    assert.equal(editor.state().homes[0].row, 7);
    assert.equal(editor.state().homes[0].column, 1);
    editor.paint(0, 0, 'home');
    assert.equal(editor.state().homes[1].row, 0);
    assert.equal(editor.state().homes[1].column, 0);
});

test('region tendency defaults by depth and legacy region exports gain that default', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [
            { section: 1, depth: 'front', cells: [84] },
            { section: 1, depth: 'mid', cells: [85] },
            { section: 1, depth: 'back', cells: [86] },
        ],
    });

    assert.deepEqual(JSON.parse(JSON.stringify(editor.buildJSON().regions)), [
        { section: 1, depth: 'front', cells: [84], tendency: 'rush' },
        { section: 1, depth: 'mid', cells: [85], tendency: 'control' },
        { section: 1, depth: 'back', cells: [86], tendency: 'develop' },
    ]);
});

test('unknown region tendency rejects import without replacing the current editor state', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [{ section: 1, depth: 'front', cells: [84], tendency: 'rush' }],
    });
    const before = JSON.parse(JSON.stringify(editor.state()));

    assert.throws(() => editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('222222222222'),
        regions: [{ section: 1, depth: 'front', cells: [84], tendency: 'unknown' }],
    }), /倾向/);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.state())), before);
});

test('duplicate section-depth regions reject import without replacing the current editor state', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [{ section: 1, depth: 'front', cells: [84], tendency: 'rush' }],
    });
    const before = JSON.parse(JSON.stringify(editor.state()));

    assert.throws(() => editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('222222222222'),
        regions: [
            { section: 1, depth: 'front', cells: [84], tendency: 'rush' },
            { section: 1, depth: 'front', cells: [85], tendency: 'control' },
        ],
    }), /区域/);
    assert.deepEqual(JSON.parse(JSON.stringify(editor.state())), before);
});

test('changing current region tendency preserves its cells and supports undo, redo, and import', () => {
    const { editor, element } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [
            { section: 1, depth: 'front', cells: [84, 85], tendency: 'rush' },
            { section: 2, depth: 'front', cells: [86], tendency: 'control' },
        ],
    });
    editor.setRegionBrush(1, 'front');

    element('regionTendency').value = 'develop';
    element('regionTendency').listeners.change.call(element('regionTendency'));
    assert.deepEqual(JSON.parse(JSON.stringify(editor.buildJSON().regions[0])), {
        section: 1, depth: 'front', cells: [84, 85], tendency: 'develop',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(editor.buildJSON().regions[1])), {
        section: 2, depth: 'front', cells: [86], tendency: 'control',
    });
    assert.equal(editor.undo(), true);
    assert.equal(editor.buildJSON().regions[0].tendency, 'rush');
    assert.equal(editor.redo(), true);
    const exported = JSON.parse(JSON.stringify(editor.buildJSON()));
    const imported = createEditor().editor;
    imported.applyLayout(exported);
    assert.equal(imported.buildJSON().regions[0].tendency, 'develop');
    assert.equal(imported.buildJSON().regions[1].tendency, 'control');
});

test('region tendency selected before the first region is painted is used for the new region', () => {
    const { editor } = createEditor();
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
    });
    editor.setRegionBrush(1, 'back');
    editor.setRegionTendency('rush');
    editor.paint(7, 0);

    assert.deepEqual(JSON.parse(JSON.stringify(editor.buildJSON().regions)), [
        { section: 1, depth: 'back', cells: [84], tendency: 'rush' },
    ]);
});

test('region map markup distinguishes each depth and labels the nearest in-region cell', () => {
    const { editor } = createEditor();
    const editorHtml = readFileSync('tools/map-editor/index.html', 'utf8');
    const frontCells = [0, 84, 86];
    editor.applyLayout({
        version: 3,
        rows: 8,
        columns: 12,
        playerCount: 2,
        cityMode: 'select',
        ascii: Array(8).fill('111111111111'),
        regions: [
            { section: 1, depth: 'front', cells: frontCells },
            { section: 1, depth: 'mid', cells: [72, 73, 74], tendency: 'develop' },
            { section: 1, depth: 'back', cells: [60, 61, 62], tendency: 'control' },
            { section: 2, depth: 'front', cells: [87, 88], tendency: 'control' },
        ],
    });

    const markup = editor.mapMetadataMarkup();
    assert.match(markup, /region-front[^>]*fill-opacity="0\.16"[^>]*stroke-opacity="0\.9"[^>]*stroke-width="2\.5"[^>]*stroke-dasharray="none"/);
    assert.match(markup, /region-mid[^>]*stroke-dasharray="6 3"/);
    assert.match(markup, /region-back[^>]*stroke-dasharray="1 3"[^>]*stroke-linecap="round"/);
    assert.match(markup, /class="regionBadge regionBadge-front"[^>]*fill="#14213d"[^>]*pointer-events="none"/);
    assert.match(markup, /<text class="regionLabel"[^>]*font-size="14"[^>]*font-weight="700"[^>]*fill="#fff"[^>]*pointer-events="none">前区 · 速攻<\/text>/);
    assert.match(markup, /<text class="regionLabel"[^>]*>中区 · 发育<\/text>/);
    assert.match(markup, /<text class="regionLabel"[^>]*>后区 · 控场<\/text>/);
    assert.equal((markup.match(/class="regionBadge regionBadge-front"/g) || []).length, 2,
        'same-depth regions from separate sections both get badges');

    const frontCenters = frontCells.map((id) => editor.hexCenter(Math.floor(id / 12), id % 12));
    const centroid = frontCenters.reduce((sum, center) => ({ x: sum.x + center.x, y: sum.y + center.y }), { x: 0, y: 0 });
    centroid.x /= frontCenters.length;
    centroid.y /= frontCenters.length;
    const nearestCenter = frontCenters.reduce((nearest, center) => {
        const distance = (center.x - centroid.x) ** 2 + (center.y - centroid.y) ** 2;
        const nearestDistance = (nearest.x - centroid.x) ** 2 + (nearest.y - centroid.y) ** 2;
        return distance < nearestDistance ? center : nearest;
    });
    const badge = markup.match(/<rect class="regionBadge regionBadge-front" x="([^"]+)" y="([^"]+)" width="([^"]+)"/);
    assert.ok(badge, 'front region has a badge');
    const badgeWidth = Number(badge[3]);
    assert.ok(badgeWidth <= editor.geometry.column, 'badge must fit within one cell pitch');
    assert.deepEqual([
        Number((Number(badge[1]) + badgeWidth / 2).toFixed(1)),
        Number((Number(badge[2]) + 13).toFixed(1)),
    ], [Number(nearestCenter.x.toFixed(1)), Number(nearestCenter.y.toFixed(1))],
    'a disconnected region badge stays centered on its nearest actual region cell');
    assert.match(markup, /class="regionBadge regionBadge-front"[^>]*width="90" height="26"/,
        'the longest depth/tendency text stays within one cell pitch');
    assert.match(editorHtml, /\.regionLabel\s*\{[^}]*font:\s*700 14px sans-serif/,
        'the CSS class rule sets the winning font size instead of losing to presentation attributes');
});

test('editor accepts every PVP neutral-resource pool id', () => {
    const { editor } = createEditor();
    for (const id of ['gold', 'mine', 'chest', 'unit_cap', 'artifact_charge']) {
        editor.setResourceBrush(id);
        assert.equal(editor.state().resourceBrush, id);
    }
});
