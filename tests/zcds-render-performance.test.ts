import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { configureZCMap, ZC_HEX_CONFIG } from '../assets/script/app/zcds/model/ZCMapConfig';
import { ZC_HEX_TOP_VERTICES } from '../assets/script/app/zcds/model/ZCHexTopGeometry';
import { ZCNodePool } from '../assets/script/app/zcds/view/ZCNodePool';
import { ZCBattlePhaseController } from '../assets/script/app/zcds/application/ZCBattlePhaseController';
import { ZCPathWorkspace, ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { loadViews } from './helpers/zcds-view-fixtures';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')));

function makeWallFrame(
    terrainRevision: number,
    hexes: Array<{ id: number }>,
    connectedDevelopedHexIds: (id: number) => readonly number[],
) {
    return {
        terrainRevision,
        snapshot: { hexes },
        hexesById: new Map(hexes.map(state => [state.id, {
            connectedDevelopedHexIds: connectedDevelopedHexIds(state.id),
        }])),
    };
}

test('单位整体轮廓只建一份共享材质，并随对局渲染层销毁', () => {
    const { load } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({
        unitOutlineCopyEffect: { name: 'unit-outline-copy' },
    });
    const material = world.unitOutlineCopyMaterial;
    assert.ok(material);
    assert.equal(material.isValid, true);
    world.destroy();
    assert.equal(material.isValid, false);
});

test('城墙只在地形变化时重绘，耐久减少不重绘，击破缺口即时更新', () => {
    const { makeWallRenderer } = loadViews();
    const { renderer, wallGeometry, tiles } = makeWallRenderer();
    const hexes = ZC_HEX_CONFIG.map(hex => ({ id: hex.id, owner: 'neutral', building: 'none', developmentResolved: false, wallHp: 0, wallBreachedEdge: null }));
    const hex = hexes[ZC_HEX_CONFIG.find(hex => hex.playable)!.id];
    Object.assign(hex, { owner: 'player', developmentResolved: true, wallHp: 100 });
    let scans = 0;
    const makeFrame = (terrainRevision: number) => makeWallFrame(terrainRevision, hexes,
        id => id === hex.id ? (scans++, [id]) : []);
    let frame = makeFrame(0);
    renderer.render(frame);
    const laid = () => tiles().filter(tile => tile.enabled).length;
    assert.equal(laid(), 6);
    for (let index = 0; index < 120; index++) renderer.render(frame);
    hex.wallHp = 50;
    renderer.render(frame);
    assert.equal(scans, 1);
    assert.equal(laid(), 6);
    const cached = wallGeometry.edges(hex.id);
    Object.assign(hex, { wallHp: 0, wallBreachedEdge: 2 });
    frame = makeFrame(frame.terrainRevision + 1);
    renderer.render(frame);
    assert.equal(laid(), 5, '击破 edge2 后只显示五段墙，第六块隐藏');
    assert.equal(tiles().length, 6, '墙砖节点按固定下标池复用：缺口后不新建，只把第六块隐藏');
    assert.equal(scans, 2);
    assert.equal(wallGeometry.edges(hex.id), cached);
    renderer.render({ ...frame });
    assert.equal(scans, 2, '同地形版本的帧复用已投影的连通区');
    const tileNodes = tiles().map(tile => tile.node);
    renderer.destroy();
    assert.ok(tileNodes.every(node => !node.isValid), '墙砖不进 ECS，自管池在 destroy 时显式销毁');
});

test('城墙按 6 边方向贴专属墙砖，横向上下墙段预留端点覆盖，缺图回退拉伸', () => {
    const { makeWallRenderer } = loadViews();
    const hexes = ZC_HEX_CONFIG.map(hex => ({ id: hex.id, owner: 'neutral', building: 'none', developmentResolved: false, wallHp: 0, wallBreachedEdge: null }));
    const hex = hexes[ZC_HEX_CONFIG.find(hex => hex.playable)!.id];
    Object.assign(hex, { owner: 'player', developmentResolved: true, wallHp: 100 });
    const wallFrames = new Map(['up', 'down', 'rightUp', 'rightDown'].map(name => [name, { name }]));
    const { renderer, wallGeometry, tiles } = makeWallRenderer({ wallFrames });
    const frame = {
        terrainRevision: 0,
        snapshot: { hexes },
        hexesById: new Map(hexes.map(state => [state.id, { connectedDevelopedHexIds: [state.id] }])),
    };
    renderer.render(frame);
    const records: any[] = tiles();
    assert.equal(records.length, 6);
    // 布局顺序 = 屏幕 y 降序（越下方的砖排在越后面 ⇒ siblingIndex 越大 ⇒ 后画 ⇒ 压住上方砖）。
    // 单格 6 条的落点 y 次序是 edge1 > edge0/edge2 > edge3/edge5 > edge4，所以 `records` 的下标
    // **不再等于 edge**；这里按落点反查回边号再逐边断言，既不依赖排序实现细节，
    // 又顺带把「下方砖层级更高」这条规则本身钉住。
    const geometry = wallGeometry.edges(hex.id);
    const edgeOf = (record: any): number => {
        let best = -1;
        let bestDistance = Infinity;
        for (let edge = 0; edge < 6; edge += 1) {
            const distance = Math.hypot(
                record.node.position.x - geometry[edge].x,
                record.node.position.y - geometry[edge].y);
            if (distance < bestDistance) { bestDistance = distance; best = edge; }
        }
        return best;
    };
    const laidOut = records.map(record => ({ edge: edgeOf(record), record }));
    assert.equal(new Set(laidOut.map(item => item.edge)).size, 6, '6 块砖的落点各不相同，能一一反查回边号');
    const yDescending = Array.from({ length: 6 }, (_, edge) => edge)
        .sort((a, b) => geometry[b].y - geometry[a].y || a - b);
    assert.deepEqual(laidOut.map(item => item.edge), yDescending,
        '墙砖按屏幕 y 降序布局：越下方的城墙层级越高、盖住上方的城墙');
    const byEdge = new Map(laidOut.map(item => [item.edge, item.record]));
    const expectedArts = ['rightUp', 'up', 'rightUp', 'rightDown', 'up', 'rightDown'];
    const expectedFlip = [false, false, true, true, false, false];
    // 砖以边中点为锚点、RAW 尺寸整图等比缩放；本图块非正六边形，但 6 条边只有**两种长度**
    // （水平边 = 顶面半宽 61.5px；斜边 = √(30.75² + 45²) ≈ 54.5px，上下斜边**等长**）。
    // 砖身沿图片对角线（BODY）而非图宽，scale 必须按 BODY 标定：
    // 砖身显示长 = BODY × scale = 边长 + 两端各伸出 ~6px，让两段砖在顶点外角处叠压闭合
    // （旧实现误用图宽 96/97/148 推导，斜砖被放大 1.4 倍，砖端伸出 18px 后两个端面
    // 在顶点外相距近 30px、外角尖反而漏缝——2026-10-12 截图实证）。
    // 砖图中心还按 offsetX/Y 做法向偏移，让砖顶面中线对齐六边形边；
    // 重叠处深色端帽描边/端面阴影由 shaders/wall-tile.effect 取墙体内部颜色覆盖。
    //
    // 🔴 2026-10-14：这里**不再钉死 scale 数值**，改成按几何真源（顶点表 ⇒ 每条边的长度）
    // 与实测 BODY 反推期望值。原先钉死的 `[0.420, 0.529, 0.420, 0.491, 0.529, 0.491]`
    // 把错值一起锁死了 —— 两条斜边明明等长却拿到 0.420 / 0.491 两个值，右上/左上斜墙
    // 比下斜墙短 10px ⇒ 砖端在顶点处接不上（「城墙断了」）。守机制才挡得住这类回归：
    // **同长度的边必须得到同一 scale**。
    const WALL_TILE_OVERHANG_PX = 6;
    // 实测砖身长（`tmp/_sprite_geo.py` 的 min-area-rect，2026-10-14）：
    // up 139.00 / rightUp 135.58 / rightDown 135.58。
    const wallTileBody: Readonly<Record<string, number>> = {
        up: 139.00, rightUp: 135.58, rightDown: 135.58,
    };
    const edgeLengths = ZC_HEX_TOP_VERTICES.map((point, edge) => {
        const next = ZC_HEX_TOP_VERTICES[(edge + 1) % ZC_HEX_TOP_VERTICES.length];
        return Math.hypot(next[0] - point[0], next[1] - point[1]);
    });
    assert.ok(Math.abs(edgeLengths[0] - edgeLengths[3]) < 1e-9,
        '上下斜边必须等长（顶面顶点 = CONTENT_LIFT ± 半高，上下对称）');
    const expectedAngle = [-4.4, 0, 4.4, -4.2, 0, 4.2];
    for (let edge = 0; edge < 6; edge += 1) {
        const record = byEdge.get(edge);
        assert.ok(record, `edge${edge} 应铺到一块墙砖`);
        assert.equal(record.spriteFrame.name, expectedArts[edge], `edge${edge} 墙砖图`);
        assert.equal(record.node.scale.x < 0, expectedFlip[edge], `edge${edge} 水平镜像`);
        const body = wallTileBody[expectedArts[edge]];
        const expectedScale = (edgeLengths[edge] + WALL_TILE_OVERHANG_PX * 2) / body;
        assert.ok(Math.abs(record.node.scale.y - expectedScale) < 0.001,
            `edge${edge} 缩放应 =（边长 ${edgeLengths[edge].toFixed(1)} + 两端伸出 ${WALL_TILE_OVERHANG_PX * 2}）`
            + `/ 砖身 ${body} = ${expectedScale.toFixed(4)}，实际 ${record.node.scale.y}`);
        // 🔴 「城墙断了」的**直接**判据：砖身显示长必须比边长多出 2×6px。
        // 相邻两段砖各越出顶点 6px 才能在顶点外角处叠压闭合；只越出 1px 时
        // 端面在外角处接不上、露出一条缝（2026-10-14 截图：右上/左上斜墙断开）。
        const tileLength = body * Math.abs(record.node.scale.y);
        const overhang = (tileLength - edgeLengths[edge]) / 2;
        assert.ok(overhang >= 5 && overhang <= 8,
            `edge${edge} 砖端应越过顶点 5~8px（目标 6：少了接不上、多了端面在顶点外汇聚出错牙），`
            + `实际 ${overhang.toFixed(2)}px（砖身 ${body} × ${Math.abs(record.node.scale.y)}`
            + ` = ${tileLength.toFixed(1)}px，边长 ${edgeLengths[edge].toFixed(1)}px）`);
        assert.ok(Math.abs(record.node.angle - expectedAngle[edge]) < 0.01, `edge${edge} 角度`);
    }
    assert.ok(records.every(record => record.customMaterial === null), '材质缺失时显式回退 Sprite 默认材质');
    assert.ok(records.every(record => record.color.a === 255), '默认材质路径不把 alpha 用作连接编码');

    // 缺某张墙砖图（只给 up）→ 缺图的边走回退拉伸，不抛错。
    // edge 1/4 都用 up（有帧）；edge 0/2（rightUp）、edge 3/5（rightDown）缺图 → 4 边回退。
    const fallback = makeWallRenderer({ wallFrames: new Map([['up', { name: 'up' }]]) });
    fallback.renderer.render(frame);
    // 缺图回退不设 spriteFrame（保持 null），并按边长 setContentSize；有图的 edge1/4 已挂 up 帧。
    const stretched = fallback.tiles().filter(tile => tile.spriteFrame === null);
    assert.equal(stretched.length, 4, '缺图的 4 边回退到通用墙砖拉伸');
    assert.ok(stretched.every(tile => tile.node.size.width > 30),
        '回退路径按边长 setContentSize（水平 61.5 / 斜边 54.5），而不是按专属砖图缩放');
});

test('跨格城墙统一按屏幕 y 降序：下方地块的墙砖全部排在上方地块之后', () => {
    const { makeWallRenderer } = loadViews();
    // 同列、上下相邻且互为邻居的一对真实地块（fixture 地图里 row0/row1 的第 0 列）：
    // 上下格顶面恰好相接（行距 90 = 顶面高 90），于是公共边两侧各只有一条外墙被吃掉，
    // 两格合起来正好 10 块可见砖 —— 很适合验证「跨格也走同一条 y 排序规则」。
    const upperId = ZC_HEX_CONFIG.find(hex => hex.row === 0 && hex.column === 0)!.id;
    const lowerId = ZC_HEX_CONFIG.find(hex => hex.row === 1 && hex.column === 0)!.id;
    const upper = ZC_HEX_CONFIG[upperId];
    const lower = ZC_HEX_CONFIG[lowerId];
    assert.ok(upper.y > lower.y, '前置：上方地块的 y 必须更大（y 向上为正，越大越靠屏幕上方）');

    const hexes = ZC_HEX_CONFIG.map(hex => ({ id: hex.id, owner: 'neutral', building: 'none', developmentResolved: false, wallHp: 0, wallBreachedEdge: null }));
    for (const id of [upperId, lowerId]) Object.assign(hexes[id], { owner: 'player', developmentResolved: true, wallHp: 100 });
    const wallFrames = new Map(['up', 'down', 'rightUp', 'rightDown'].map(name => [name, { name }]));
    const { renderer, wallGeometry, tiles } = makeWallRenderer({ wallFrames });
    // 两格同属一个连通簇：`connectedDevelopedHexIds` 对任一端都返回这两格。
    const frame = makeWallFrame(0, hexes, id => [upperId, lowerId].includes(id) ? [upperId, lowerId] : []);
    renderer.render(frame);
    const records: any[] = tiles();
    assert.equal(records.length, 10, '两格各留一圈外墙（公共边被同簇吃掉），共 10 块砖');

    // 按落点反查每块砖属于哪格的哪条边（落点 = 边中点 + 图中心偏移，自己那条边必然最近）。
    const candidates = [upperId, lowerId].flatMap(hexId => wallGeometry.edges(hexId).map((edge: any, index: number) => ({ hexId, index, x: edge.x, y: edge.y })));
    const matched = records.map((record) => {
        let best = candidates[0];
        let bestDistance = Infinity;
        for (const candidate of candidates) {
            const distance = Math.hypot(record.node.position.x - candidate.x, record.node.position.y - candidate.y);
            if (distance < bestDistance) { bestDistance = distance; best = candidate; }
        }
        assert.ok(bestDistance < 15, '落点必须贴近某条边的中点，反查才可信');
        return { ...best, distance: bestDistance };
    });
    assert.equal(new Set(matched.map(item => `${item.hexId}:${item.index}`)).size, 10, '10 块砖一一对应到 10 条不同的边');

    // ① 全局按屏幕 y 降序 ⇒ 后画的砖永远不比先画的更高，即「越下方的城墙层级越高」。
    for (let i = 1; i < matched.length; i += 1) {
        assert.ok(matched[i].y <= matched[i - 1].y + 1e-9,
            `第 ${i} 块砖(y=${matched[i].y.toFixed(1)}) 不该高于第 ${i - 1} 块(y=${matched[i - 1].y.toFixed(1)})`);
    }
    // ② 具体到这两格：上方格的砖全部排在下方格之前 —— 跨格的上下遮挡关系也是统一的。
    const lastUpper = matched.map(item => item.hexId).lastIndexOf(upperId);
    const firstLower = matched.map(item => item.hexId).indexOf(lowerId);
    assert.ok(firstLower > lastUpper, '下方地块的墙砖必须全部排在上方地块之后（层级更高）');
});

test('同阵营连通的无墙地块不能吞掉邻格真实城墙', () => {
    const { makeWallRenderer } = loadViews();
    const builtId = ZC_HEX_CONFIG.find(hex => hex.row === 0 && hex.column === 0)!.id;
    const emptyNeighborId = ZC_HEX_CONFIG.find(hex => hex.row === 1 && hex.column === 0)!.id;
    const hexes = ZC_HEX_CONFIG.map(hex => ({
        id: hex.id,
        owner: 'neutral',
        building: 'none',
        developmentResolved: false,
        wallHp: 0,
        wallBreachedEdge: null,
    }));
    Object.assign(hexes[builtId], { owner: 'player', developmentResolved: true, wallHp: 100 });
    // 被占领的已开发空格没有墙，但仍属于同阵营的开发连通区。
    Object.assign(hexes[emptyNeighborId], { owner: 'player', developmentResolved: true });
    const { renderer, tiles } = makeWallRenderer();
    const frame = makeWallFrame(0, hexes,
        id => [builtId, emptyNeighborId].includes(id) ? [builtId, emptyNeighborId] : []);

    renderer.render(frame);

    assert.equal(tiles().length, 6, '无墙邻格没有可见共边，建造格的六条墙边都应保留');
});

test('城墙接缝材质只标记相连端，断墙裸露端保留完整描边', () => {
    const { cc, makeWallRenderer } = loadViews();
    const hexes = ZC_HEX_CONFIG.map(hex => ({
        id: hex.id,
        owner: 'neutral',
        building: 'none',
        developmentResolved: false,
        wallHp: 0,
        wallBreachedEdge: null as number | null,
    }));
    const hex = hexes[ZC_HEX_CONFIG.find(config => config.playable)!.id];
    Object.assign(hex, {
        owner: 'player',
        developmentResolved: true,
        wallHp: 0,
        wallBreachedEdge: 2,
    });
    const wallFrames = new Map(['up', 'rightUp', 'rightDown'].map(name => [name, {
        name,
        uv: [0, 0, 1, 0, 0, 1, 1, 1],
        packable: true,
    }]));
    const wallMaterial = new cc.Material();
    const { renderer, wallGeometry, tiles } = makeWallRenderer({ wallFrames, wallMaterial });
    const frame = makeWallFrame(0, hexes, id => [id]);

    renderer.render(frame);

    const records: any[] = tiles();
    assert.equal(records.length, 5, '击破 edge2 后只绘制其余五段墙');
    // 墙砖统一按屏幕 y 降序布局，`records` 下标不再等于 edge，
    // 所以先按落点反查边号，再逐边断言连接标记与帧索引。
    const geometry = wallGeometry.edges(hex.id);
    const byEdge = new Map<number, any>();
    for (const record of records) {
        let edge = -1;
        let bestDistance = Infinity;
        for (let candidate = 0; candidate < 6; candidate += 1) {
            const distance = Math.hypot(record.node.position.x - geometry[candidate].x, record.node.position.y - geometry[candidate].y);
            if (distance < bestDistance) { bestDistance = distance; edge = candidate; }
        }
        assert.ok(bestDistance < 15, '落点必须贴近某条边的中点，反查才可信');
        assert.ok(!byEdge.has(edge), `edge${edge} 不该铺到第二块砖`);
        byEdge.set(edge, record);
    }
    const drawnEdges = [0, 1, 3, 4, 5];
    assert.deepEqual([...byEdge.keys()].sort((a, b) => a - b), drawnEdges, '击破的是 edge2，其余五边都在');
    // alpha 的 2-bit 标记：两端都接=255、仅一端接=170/85、无连接=0。edge2 被击破后
    // 与它相邻的 edge1（v2 端裸露）和 edge3（v3 端裸露）各只剩一端连接。
    const alphaByEdge: Record<number, number> = { 0: 255, 1: 170, 3: 85, 4: 255, 5: 255 };
    for (const edge of drawnEdges) {
        assert.equal(byEdge.get(edge).color.a, alphaByEdge[edge],
            `edge${edge} 的连接标记应区分完整连接、仅右端连接、仅左端连接`);
    }
    // 蓝通道编码的是「共享材质里的帧槽」（slot × 85），供 shader 选对应 UV 变换。
    // ⚠️ 槽号按**首次取用顺序**分配，而这个顺序跟着绘制顺序走（现在墙砖按屏幕 y 降序画），
    // 所以不能把「哪张图占哪个槽」写死；改成断言槽分配的不变量：同图同槽、三图三槽，
    // 再用槽号把 joinProfile 和砖图对上（见下）。
    const artByEdge: Record<number, string> = { 0: 'rightUp', 1: 'up', 3: 'rightDown', 4: 'up', 5: 'rightDown' };
    const slotByArt = new Map<string, number>();
    for (const edge of drawnEdges) {
        const slot = byEdge.get(edge).color.b / 85;
        assert.ok(Number.isInteger(slot) && slot >= 0 && slot < 3, `edge${edge} 的帧槽必须是 0..2 的整数`);
        const known = slotByArt.get(artByEdge[edge]);
        if (known === undefined) slotByArt.set(artByEdge[edge], slot);
        else assert.equal(slot, known, `同一张砖图必须落在同一个帧槽（edge${edge}）`);
    }
    assert.equal(new Set(slotByArt.values()).size, 3, 'rightUp / up / rightDown 三张图必须各占一个不同的帧槽');
    assert.ok(records.every(record => record.customMaterial === wallMaterial), '所有墙段共享传入材质以保留批处理');
    const joinProfileOf = (index: number): number[] => {
        const profile = wallMaterial.properties.get(`wallJoinProfile${index}`) as {
            x: number;
            y: number;
            z: number;
            w: number;
        } | undefined;
        return profile ? [profile.x, profile.y, profile.z, profile.w] : [];
    };
    // 端帽范围随槽号走：按槽号取回 profile，必须等于「占这个槽的那张砖图」自己的范围。
    const profileByArt: Record<string, number[]> = {
        rightUp: [0.14, 0.30, 0.18, 0.34], // 右端帽明显更长
        up: [0.08, 0.08, 0.12, 0.12], // edge 1/4 共用，旋转 180°
        rightDown: [0.30, 0.14, 0.34, 0.18], // 左端帽明显更长
    };
    for (const [art, slot] of slotByArt) {
        assert.deepEqual(joinProfileOf(slot), profileByArt[art],
            `${art} 的左右端帽范围必须写进它占的帧槽，不能共用一个对称 feather`);
    }
    assert.deepEqual(joinProfileOf(3), [], 'down 不再使用，只占 3 个帧槽');
    assert.ok(
        Array.from(wallFrames.values()).every(frame => frame.packable === false),
        '自定义 UV shader 必须禁用动态图集二次搬移；静态 auto-atlas 不受影响',
    );
});

test('城墙轴向坐标由 SpriteFrame 四角 UV 还原，兼容图集旋转与斜墙对角线', () => {
    const { load } = loadViews();
    const { wallAxisTransform } = load('./ZCWallGeometry');
    const frame = {
        // Cocos simple assembler 顺序：left-bottom, right-bottom, left-top, right-top。
        // 这里局部 x 在旋转图集中沿 atlas v 负方向增长。
        uv: [0.25, 0.75, 0.25, 0.50, 0.50, 0.75, 0.50, 0.50],
    };
    const transform = wallAxisTransform(frame, 1, 0);

    assert.ok(transform);
    const localX = (u: number, v: number) => transform[0] * u + transform[1] * v + transform[2];
    assert.ok(Math.abs(localX(0.25, 0.75)) < 1e-6, '左端映射到 0');
    assert.ok(Math.abs(localX(0.25, 0.50) - 1) < 1e-6, '右端映射到 1');

    const diagonal = wallAxisTransform(frame, 1, -1);
    assert.ok(diagonal);
    const axisT = (u: number, v: number) => diagonal[0] * u + diagonal[1] * v + diagonal[2];
    assert.ok(Math.abs(axisT(0.50, 0.75)) < 1e-6, '斜墙左上端映射到 0');
    assert.ok(Math.abs(axisT(0.25, 0.50) - 1) < 1e-6, '斜墙右下端映射到 1');
    assert.ok(Math.abs(axisT(0.25, 0.75) - 0.5) < 1e-6, '非端点角落不能被竖向误切成端部');
});

test('城墙端点连接统计按阵营隔离，同阵营仅顶点接触也要融合', () => {
    const { load } = loadViews();
    const { wallEndpointOwnerKey } = load('./ZCWallGeometry');

    assert.equal(
        wallEndpointOwnerKey('player', 12, 34),
        wallEndpointOwnerKey('player', 12 + 1e-4, 34 - 1e-4),
        '同阵营即使属于不同边连通块，只要几何同点就归并融合',
    );
    assert.notEqual(
        wallEndpointOwnerKey('player', 12, 34),
        wallEndpointOwnerKey('enemy', 12, 34),
        '不同阵营即使几何同点也不能互相淡化裸露端',
    );
});

test('城墙接缝 shader 保持实体 alpha，用墙体内部颜色覆盖深色端帽', () => {
    const effect = readFileSync('assets/resources/shaders/wall-tile.effect', 'utf8');
    const fragment = effect.match(/vec4 frag \(\) \{([\s\S]*?)return result;/)?.[1] ?? '';

    assert.equal(
        Array.from(fragment.matchAll(/CCSampleWithAlphaSeparated/g)).length,
        2,
        '接缝端必须额外采样一次墙体内部颜色',
    );
    assert.doesNotMatch(
        fragment,
        /\bresult\.a\s*[*+\-/]?=/,
        '连接端不得降低墙砖实体 alpha，否则底层墙段覆盖不满时会直接露出地块形成断口',
    );
    assert.match(
        fragment,
        /\bresult\.rgb\s*=/,
        '深色端帽应替换颜色而不是挖掉像素',
    );
});

// 2026-10-15：这条判据已被 `tests/zcds-log-switch.test.ts` 取代并删除。
// 原因：诊断开关从模块私有 `ZC_WALL_DIAGNOSTICS` 收编成统一 `ZCDC_LOG_DIAGNOSTICS` 后，
// 只盯 [ZCWall] 前缀就漏了 ZCCapture / ZCGameLoader / ZCGame 等其余日志点；
// 新判据用同一套 AST 扫描**整个 zcds 目录**，覆盖面更大且不用两处同步前缀口径。

test('有界节点池按类型复用、恢复 active，超容量销毁，场景退出清空', () => {
    const { FakeNode } = loadViews();
    const pool = new ZCNodePool<InstanceType<typeof FakeNode>>(2, 1);
    let created = 0;
    const create = () => { created++; return new FakeNode(); };
    const first = pool.acquire('arrow', create);
    pool.release('arrow', first);
    assert.equal(first.active, false);
    const second = pool.acquire('arrow', create);
    assert.equal(second, first);
    assert.equal(second.active, true);
    const melee = pool.acquire('melee', create);
    assert.notEqual(melee, first);
    pool.release('arrow', first);
    const excess = create();
    pool.release('arrow', excess);
    assert.equal(excess.isValid, false);
    pool.release('melee', melee);
    const overTotal = create();
    pool.release('area', overTotal);
    assert.equal(overTotal.isValid, false);
    pool.destroy();
    assert.equal(first.isValid, false);
    assert.equal(melee.isValid, false);
    assert.equal(created, 4);
});

test('单位逻辑帧之间连续插值，攻击状态不改动，长帧与结束状态直接定位', () => {
    const { load } = loadViews();
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({});
    const rendered: any[] = [];
    world.unitEntityBySource.set(4, 1);
    world.unitViews.set(1, { render: (value: any) => rendered.push(value) });
    const unit = { id: 4, unitId: 'test', freeX: 0, freeY: 0, battleState: 'move' };
    const frame = {
        unitDefinitionsById: new Map([['test', {}]]),
        hexesById: new Map(),
        interpolationAlpha: 0,
        simulationStepSeconds: 0.05,
        snapshot: { elapsedSeconds: 0, pendingSeconds: 0, status: 'playing' },
    };
    world.renderUnitEntity(unit, frame);
    unit.freeX = 10; unit.battleState = 'attack';
    frame.snapshot.elapsedSeconds = .05;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.at(-1).x, 0);
    frame.snapshot.pendingSeconds = .025;
    frame.interpolationAlpha = 0.5;
    world.renderUnitEntity(unit, frame);
    const scale = load('./ZCGameViewUtil').mapToViewX(1);
    assert.equal(rendered.at(-1).x, 5 * scale);
    assert.equal(unit.freeX, 10);
    assert.equal(rendered.at(-1).unit.battleState, 'attack');
    frame.snapshot.elapsedSeconds = .1; frame.snapshot.pendingSeconds = 0; frame.interpolationAlpha = 0; unit.freeX = 20;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.at(-1).x, 10 * scale);
    frame.snapshot.elapsedSeconds = 1; unit.freeX = 50;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.at(-1).x, 50 * scale);
    frame.snapshot.status = 'victory'; frame.interpolationAlpha = 1; unit.freeX = 60; frame.snapshot.elapsedSeconds = 1.05;
    world.renderUnitEntity(unit, frame);
    assert.equal(rendered.at(-1).x, 60 * scale);
});

test('特效节点按视觉类型复用，初始化重置，表现时间包含不足逻辑步的余量', () => {
    const { load, FakeNode } = loadViews();
    const nodes: any[] = [], calls: any[] = [];
    const prefab = { make: () => {
        const node = new FakeNode();
        node.getComponent = (() => ({ initialize: (visual: any) => calls.push(['init', visual]), render: (event: any, now: number) => calls.push([event.id, now]) })) as any;
        nodes.push(node); return node;
    } };
    const visual = {};
    const world = new (load('./ZCGameRenderWorld').ZCGameRenderWorld)({ mapLayer: new FakeNode(), effectPrefab: prefab, effectVisualPrefabs: new Map([['arrow', visual]]) });
    const event = { id: 1, skillId: 'test', fromX: 0, fromY: 0, effectPrefabPath: 'arrow' };
    const model = { snapshot: { combatEvents: [event], elapsedSeconds: 1, pendingSeconds: .025, status: 'playing' } };
    world.renderEffectSystem(model);
    assert.deepEqual(calls.at(-1), [1, 1.025]);
    model.snapshot.combatEvents = [];
    world.renderEffectSystem(model);
    assert.equal(nodes[0].active, false);
    model.snapshot.combatEvents = [{ ...event, id: 2 }];
    world.renderEffectSystem(model);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].active, true);
    assert.equal(calls.filter(call => call[0] === 'init').length, 2);
    model.snapshot.combatEvents = [{ ...event, id: 3, effectPrefabPath: 'slash' }];
    world.renderEffectSystem(model);
    assert.equal(nodes.length, 2, '不同视觉类型必须使用不同池');
    world.destroy();
    assert.ok(nodes.every(node => !node.isValid));
});

test('复用单位和特效视觉子树，同时从头播放动画', () => {
    for (const name of ['ZCUnitView', 'ZCCombatEffectView']) {
        const { load, FakeNode } = loadViews();
        let created = 0, played = 0, stopped = 0;
        const prefab = { make: () => {
            created++;
            const node = new FakeNode();
            const animation = { clips: [{ name: 'unit-idle' }], stop: () => stopped++, play: () => played++ };
            node.getComponent = ((type: { name?: string }) => type?.name === 'Animation' ? animation : null) as any;
            return node;
        } };
        const view = new (load(`./${name}`)[name])();
        // ZCUnitView 的 visualRoot 是 prefab 绑定的固定容器（不再运行时兜底新建），桩按同一形态给一份。
        if (name === 'ZCUnitView') view.visualRoot = new FakeNode('VisualRoot');
        view.initialize(prefab);
        if (name === 'ZCUnitView') {
            assert.equal(view.visualRoot.position.y, 45.7);
            assert.equal(view.visualNode.parent, view.visualRoot, '兵种美术必须挂在脚点校准容器下');
        }
        view.initialize(prefab);
        assert.equal(created, 1, name);
        assert.equal(played, 2, name);
        assert.ok(stopped >= 1, name);
        const previous = view.visualNode;
        view.initialize(null);
        assert.equal(previous.isValid, false, name);
    }
});

test('技能视觉只走 prefab：矢量绘制已全删，弹道仍每帧移动', () => {
    // 2026-10-15：`pvpSkill.json` 43/43 行都填了 effectPrefabPath 且 prefab 全部入库
    // ⇒ `visualNode` 恒非空，原来的 Graphics 兜底（弹道箭头 / 刀光 / area 椭圆）已删除。
    // 这条判据钉住新口径：**没有 `moveTo/lineTo/ellipse/fill` 任何一处绘制调用**，
    // 且清屏（graphics.clear）仍只在首帧与非弹道事件发生。
    const src = readFileSync('assets/script/app/zcds/view/ZCCombatEffectView.ts', 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const banned of ['moveTo', 'lineTo', 'ellipse', '.fill(', 'drawProjectileFallback', 'drawMeleeFallback']) {
        assert.doesNotMatch(code, new RegExp(banned.replace(/[.()]/g, '\\$&')),
            `矢量绘制已删干净，不该再出现 ${banned}`);
    }
    // 反向占位：确认不是「注释里说删了、代码还在」。
    assert.match(code, /this\.graphics\.clear\(\)/, '仍应保留 clear（prefab 里可能烘焙了几何）');

    const { load, FakeNode } = loadViews();
    const view = new (load('./ZCCombatEffectView').ZCCombatEffectView)();
    let clears = 0;
    const drawn = [];
    view.spriteNode = new FakeNode();
    view.sprite = {};
    view.graphics = {
        clear: () => clears++,
        // 这几个方法只用来「证明它们没被调用」。
        moveTo: (...a) => drawn.push(['moveTo', ...a]),
        lineTo: (...a) => drawn.push(['lineTo', ...a]),
        ellipse: (...a) => drawn.push(['ellipse', ...a]),
        fill: () => drawn.push(['fill']),
        stroke: () => drawn.push(['stroke']),
    };
    const event = { id: 1, type: 'projectile', owner: 'player', empowered: false, fromX: 0, fromY: 0, toX: 10, toY: 0, startedAt: 1, durationSeconds: 1 };
    view.initialize(null);
    view.render(event, 1);
    view.render(event, 1.5);
    // 首帧清一次；第二帧是 projectile ⇒ 不再清（与旧口径一致）。
    assert.equal(clears, 1, '弹道每帧只移动，不每帧重画');
    assert.deepEqual(drawn, [], '弹道移动不得触发任何矢量绘制');
    assert.equal(view.node.position.x, load('./ZCGameViewUtil').mapToViewX(5));
    // area 型同样不再画椭圆，但仍要清屏、仍要定位到命中点。
    view.render({ ...event, id: 2, type: 'area', radius: 3 }, 1);
    assert.equal(clears, 2, '非弹道事件仍走一次 clear');
    assert.deepEqual(drawn, [], 'area 型不得再画椭圆');
});

test('地块内容不变时不重复写 Sprite，生命和建筑冷却仍更新', () => {
    const { load, bar } = loadViews();
    const view = new (load('./ZCHexView').ZCHexView)();
    // render 每帧都走 renderHealthBar（下面只覆盖了 terrain / content / cooldown 三段），
    // 而它现在按「Inspector 绑定即必填」直接读 healthBar。
    view.healthBar = bar();
    // `applyActivationFx` 每帧也会把建筑外观缩放复位到基准值 ⇒ 同样按 prefab 的真实绑定补节点，
    // 否则这条用例会撞 `buildingSprite` 为 null（桩缺哪个引用，哪个用例当场红）。
    view.buildingSprite = { node: bar().node, enabled: true, spriteFrame: null, color: null };
    let terrain = 0, content = 0, cooldown = 0;
    view.renderTerrain = () => terrain++;
    view.renderContent = () => content++;
    view.renderCooldown = () => cooldown++;
    const presentation = { state: { owner: 'player', state: 'developable', hp: 100, maxHp: 100, developmentCost: 25 }, playerGold: 24, canDevelop: true, cooldown: null };
    view.render(presentation);
    for (let frame = 0; frame < 10; frame++) view.render(presentation);
    assert.equal(terrain, 1); assert.equal(content, 1); assert.equal(cooldown, 11);
    presentation.playerGold = 25;
    view.render(presentation);
    assert.equal(content, 2, '金币达到开发价格时刷新提示颜色');
    presentation.state.owner = 'enemy';
    view.render(presentation);
    assert.equal(terrain, 3);
});

test('BFS 工作区与原算法在阻挡变化、排序平局和标记溢出时首步一致', () => {
    const neighbors = [[1, 2], [0, 3, 4], [0, 4], [1, 5], [1, 2, 5], [3, 4]];
    const workspace = new ZCPathWorkspace(neighbors.length);
    for (let mask = 0; mask < 64; mask++) for (let goal = 1; goal < 6; goal++) {
        const canEnter = (id: number) => !(mask & (1 << id));
        const rank = (id: number) => id % 2;
        const original = ZCTargetingSystem.findPathStep({
            start: 0, isGoal: id => id === goal, neighborsOf: id => neighbors[id], canEnter, rank,
        });
        const optimized = ZCTargetingSystem.findPathStep({
            start: 0, isGoal: id => id === goal, neighborsOf: id => neighbors[id], canEnter, rank, workspace,
        });
        assert.equal(optimized, original);
    }
    workspace.generation = 0xffffffff;
    assert.equal(ZCTargetingSystem.findPathStep({
        start: 0, isGoal: id => id === 5, neighborsOf: id => neighbors[id],
        canEnter: () => true, rank: () => 0, workspace,
    }), 1);
    assert.equal(workspace.generation, 1);
});

test('游戏每帧更新动态表现，地块和 HUD 保持 0.15 秒节奏', () => {
    const { cc } = loadViews();
    const context = {
        exports: {} as any,
        require: (name: string) => name === 'cc' ? cc
            : name === './application/ZCBattlePhaseController' ? { ZCBattlePhaseController }
                : {},
    };
    const code = ts.transpileModule(readFileSync('assets/script/app/zcds/ZCGame.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    runInNewContext(code, context);
    const game = new context.exports.ZCGame();
    let ticks = 0, dynamic = 0, terrain = 0, hud = 0, drained = 0;
    const snapshot = { status: 'playing' };
    const event = { id: 1, hexId: 4 };
    let pendingEvents = { buildingShakes: [event] };
    const receivedEvents: Array<{ buildingShakes: typeof event[] }> = [];
    game.model = {
        snapshot,
        tick: () => ticks++,
        createRenderFrame: () => ({ snapshot }),
        drainPresentationEvents: () => {
            drained++;
            const events = pendingEvents;
            pendingEvents = { buildingShakes: [] };
            return events;
        },
    };
    game.renderWorld = {
        renderDynamic: (_frame: unknown, events: { buildingShakes: typeof event[] }) => {
            dynamic++;
            receivedEvents.push(events);
        },
        renderStatic: () => terrain++,
    };
    game.hudView = { render: () => hud++ };
    for (let frame = 0; frame < 60; frame++) game.update(1 / 60);
    assert.equal(ticks, 60); assert.equal(dynamic, 60);
    assert.equal(terrain, 6); assert.equal(hud, 6);
    assert.equal(drained, 60, '对局编排层每次模拟更新只取一次表现事件');
    assert.deepEqual(receivedEvents[0].buildingShakes, [event]);
    assert.ok(receivedEvents.slice(1).every(events => events.buildingShakes.length === 0), '事件不会在后续渲染帧重复播放');
});

test('城墙边→邻格匹配不得把同一个邻格分给两条边（阈值 ≥0.85）', () => {
    const { load } = loadViews();
    const { ZCWallGeometry } = load('./ZCWallGeometry');
    const fallback = JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8'));
    // 本图块不是正六边形（face 123×90 ⇒ 水平边 61.5 / 斜边 54.5），相邻两条边的法线只差 49.4°：
    // 实测邻居偏移 (36,21)（轴角 30.3°）相对 edge5 法线（-12.2°）的 cos 高达 0.737。
    // 阈值用 0.7 时，棋盘边缘「右下方向没有邻居」的边会误选右上邻格，而城墙渲染
    // 一旦发现 connected.has(adjacentId) 就当「同簇内部边」跳过 ⇒ 外轮廓缺一段（「靠近外层会断」）。
    // 判据：正确匹配的 cos 实测最小 0.951、误匹配 0.737 ⇒ 同一邻格不该被方向不同的两条边同时选中。
    try {
        for (const file of ['standard.json', 'standard_3.json', 'standard_4.json']) {
            configureZCMap(JSON.parse(readFileSync(`assets/resources/config/maps/${file}`, 'utf8')));
            const hexes = ZC_HEX_CONFIG;                    // configureZCMap 之后的真源
            // 每张地图独立一个几何缓存（等价于产品路径 initialize 时 setMap）。
            const geometry = new ZCWallGeometry();
            geometry.setMap(hexes);
            const duplicated: string[] = [];
            for (const hex of hexes) {
                if (!hex.playable) continue;
                const seen = new Map<number, number[]>();
                geometry.edges(hex.id).forEach((segment: { adjacentId: number | null }, edge: number) => {
                    if (segment.adjacentId === null) return;
                    const list = seen.get(segment.adjacentId) ?? [];
                    list.push(edge);
                    seen.set(segment.adjacentId, list);
                });
                for (const [id, edges] of seen) {
                    if (edges.length > 1) duplicated.push(`hex=${hex.id} 邻格${id}←edge${edges.join(',')}`);
                }
            }
            assert.equal(duplicated.length, 0,
                `${file}：同一邻格被两条边同时选中 ${duplicated.length} 处（阈值被调松？）\n  ${duplicated.slice(0, 5).join('\n  ')}`);
        }
    } finally {
        configureZCMap(fallback);
    }
});
