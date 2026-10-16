import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    HEX_GRID_CONTENT_LIFT,
    HEX_GRID_FACE_HEIGHT,
    HEX_GRID_FACE_WIDTH,
    HEX_GRID_IMAGE_HEIGHT,
    HEX_GRID_IMAGE_WIDTH,
    HEX_GRID_VIEW_COLUMN_SPACING,
    HEX_GRID_VIEW_ROW_SPACING,
    buildHexGridLayout,
} from '../assets/script/core/hex/HexGridLayout';
import { configureZCMap, ZCMapLayout, ZC_HEX_CONFIG, ZC_MAP_HOMES } from '../assets/script/app/zcds/model/ZCMapConfig';
import { loadPvpTables, ZCPvpTables } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import {
    ZC_HEX_TOP_EDGE_NORMALS,
    zcHexTopEdgeToward,
} from '../assets/script/app/zcds/model/ZCHexTopGeometry';
import { ZCDamageResolutionSystem } from '../assets/script/app/zcds/model/systems/ZCDamageResolutionSystem';
import type { ZCHexState } from '../assets/script/app/zcds/model/ZCGameTypes';

const columnSpacing = HEX_GRID_VIEW_COLUMN_SPACING;
const rowSpacing = HEX_GRID_VIEW_ROW_SPACING;
const mapToViewX = (x: number) => x * columnSpacing / 36;
const mapToViewY = (y: number) => y * rowSpacing / 42;

/**
 * 六个顶点 = `ZC_OUTLINE_HEX_POINTS` 的同款算法（由**顶面**锚点派生）。
 *
 * ⚠️ 立体地块的轮廓线画在**顶面**上（半宽 61.5 / 半高 44.5 / 中心上移 12.5），
 * 不是整图外形 —— 画整图会整条线陷进侧壁里。
 * 与 `appendEdges` / `ZCWallGeometry.edges` 共用同一份几何口径。
 */
function hexPoints(): ReadonlyArray<readonly [number, number]> {
    const hw = HEX_GRID_FACE_WIDTH / 2;
    const hh = HEX_GRID_FACE_HEIGHT / 2;
    const lift = HEX_GRID_CONTENT_LIFT;
    // ⚠️ 上边两点是 `lift + hh`（不是裸 `hh`）—— 漏 `lift` 会让轮廓比格子扁、整体下移。
    return [
        [hw, lift], [hw / 2, lift + hh], [-hw / 2, lift + hh],
        [-hw, lift], [-hw / 2, lift - hh], [hw / 2, lift - hh],
    ];
}

const tableNames = [
    'pvpGlobal', 'pvpArtifact', 'pvpCard', 'pvpSkill', 'pvpCounter', 'pvpBond',
    'pvpTile', 'pvpPity', 'pvpTileGen', 'pvpTileGenParams', 'pvpBaseTeamWeight',
];
const tables = Object.fromEntries(tableNames.map((name) => {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8'));
    return [name, Array.isArray(source) ? source : source.v.map((row: unknown[]) => (
        Object.fromEntries(source.k.map((key: string, index: number) => [key, row[index]]))
    ))];
})) as unknown as ZCPvpTables;
loadPvpTables(tables);

const layout = JSON.parse(readFileSync('assets/resources/config/maps/select_river.json', 'utf8')) as ZCMapLayout;
configureZCMap(layout);

test('城墙 6 条边各自朝向正确的邻格（贴合真实地块轮廓）', () => {
    const homeId = ZC_MAP_HOMES[0];
    const home = ZC_HEX_CONFIG[homeId];
    const cx = mapToViewX(home.x);
    const cy = mapToViewY(home.y);
    const points = hexPoints();
    // ⚠️ **别钉死「边中点 = 主城-邻格连线中点」** —— 那是**正六边形**的性质。
    // 2026-10-12 换成 `img_land_01_gray` 后顶面是 123×90（比例 1.367，正六边形该是
    // 1.155），顶面**偏扁** ⇒ 斜边中点与邻格连线的偏差是**几何固有的**（实测 ~6px），
    // 不是 bug。真正该守的是：**每条边的外法线都能找到朝向正确的邻格**
    // —— 这才是"墙贴在正确的边上"。
    const seen = new Set<number>();
    for (let edge = 0; edge < 6; edge += 1) {
        // 边 = 顶点[edge] → 顶点[edge+1]，与 `ZCWallGeometry.edges` / `appendEdges` 同一套。
        const from = points[edge];
        const to = points[(edge + 1) % points.length];
        // 该边的外法线 = 中点方向（扁六边形下不能再用 60° 倍角）。
        const normal = Math.atan2((from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
        let neighbor = null as null | typeof home;
        let best = -Infinity;
        for (const id of home.neighbors) {
            const n = ZC_HEX_CONFIG[id];
            const dx = n.x - home.x, dy = n.y - home.y;
            const align = (dx * Math.cos(normal) + dy * Math.sin(normal)) / Math.hypot(dx, dy);
            if (align > best) { best = align; neighbor = n; }
        }
        assert.ok(neighbor, `edge ${edge} 应能找到邻格`);
        // 邻格必须真的在这条边的外侧（对齐度足够高），否则墙会贴错边。
        assert.ok(best > 0.7,
            `edge ${edge} 的邻格对齐度应 > 0.7，实际 ${best.toFixed(3)}（墙会贴错边）`);
        // 邻格中心到主城中心的连线方向应与该边法线同向。
        const ncx = mapToViewX(neighbor!.x), ncy = mapToViewY(neighbor!.y);
        const linkAngle = Math.atan2(ncy - cy, ncx - cx);
        let diff = Math.abs(((linkAngle - normal + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        assert.ok(diff < Math.PI / 6,
            `edge ${edge} 的邻格方向应与边法线同向（±30°），实际偏 ${(diff * 180 / Math.PI).toFixed(1)}°`);
        seen.add(neighbor!.id);
    }
    // 6 条边要落在 6 个**不同**的邻格上；重复说明顶点序或邻居表错位。
    assert.equal(seen.size, 6, `6 条边应各对应一个不同邻格，实际只覆盖 ${seen.size} 个`);
});

/**
 * 🔴 轮廓/城墙顶点必须与地块图 face 同源。
 *
 * 踩过的坑：地块底图换过一次尺寸，`ZC_OUTLINE_HEX_POINTS` 仍写死旧值，
 * 轮廓线与墙砖都画到格子外面 —— **不报任何错，只能靠肉眼看图发现**。
 *
 * 顶点口径现在收敛在纯 TS 模块 `ZCHexTopGeometry`（由 core/hex 的 FACE 常量派生），
 * 视图（轮廓/墙砖）与破门模型共用这一份。这里**直接审源码表达式**：
 * 顶点表必须写成 FACE 常量的算式，一旦有人改回写死数字立刻红；视图只允许复用，
 * 不许再算一套。
 */
test('轮廓顶点表与地块顶面同源（写成 FACE 常量的算式，不再写死数字）', () => {
    const imageWidth = HEX_GRID_IMAGE_WIDTH;
    const imageHeight = HEX_GRID_IMAGE_HEIGHT;

    // ① 唯一来源模块的顶点表必须引用 FACE 常量，不许出现裸数字。
    const geometrySource = readFileSync('assets/script/app/zcds/model/ZCHexTopGeometry.ts', 'utf8');
    const table = /ZC_HEX_TOP_VERTICES[\s\S]*?\];/.exec(geometrySource);
    assert.ok(table, '没读到 ZC_HEX_TOP_VERTICES 的定义');
    assert.ok(/HEX_TOP_HALF_WIDTH/.test(table![0]) && /HEX_TOP_HALF_HEIGHT/.test(table![0])
        && /HEX_GRID_CONTENT_LIFT/.test(table![0]),
        `顶点表必须由 FACE_WIDTH/HEIGHT、CONTENT_LIFT 派生（当前：${table![0].replace(/\s+/g, ' ').slice(0, 200)}）`);
    // 裸数字 = 又写死了（写死的坐标不会跟着地块尺寸变）。
    // ⚠️ **必须先剥注释再匹配**（rule 104）：注释里的示例数值会被误伤。
    const tableCode = table![0]
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.ok(!/\[\s*-?\d/.test(tableCode),
        `顶点表不许出现写死坐标：${tableCode.replace(/\s+/g, ' ')}`);

    // ② 轮廓层只允许复用共享模块（重新导出同名），不许自己再写一份。
    const outlineSource = readFileSync('assets/script/app/zcds/view/ZCOutlineLayer.ts', 'utf8');
    assert.ok(/ZC_OUTLINE_HEX_POINTS[^=]*=\s*ZC_HEX_TOP_VERTICES/.test(outlineSource),
        'ZCOutlineLayer 应直接复用 ZC_HEX_TOP_VERTICES（作为 ZC_OUTLINE_HEX_POINTS）');

    // ③ 墙砖必须复用同一张顶点表，不许自己再算一套（几何已抽到 ZCWallGeometry.edges）。
    const wallGeometrySource = readFileSync('assets/script/app/zcds/view/ZCWallGeometry.ts', 'utf8');
    const wallFn = /edges\(hexId: number\)[\s\S]*?return edges;\n    }\n/.exec(wallGeometrySource);
    assert.ok(wallFn, '没读到 ZCWallGeometry.edges');
    assert.ok(/ZC_OUTLINE_HEX_POINTS/.test(wallFn![0]),
        '墙砖几何应复用 ZC_OUTLINE_HEX_POINTS 的顶点表，别自己再算一套');

    // ④ 肉眼判据：顶点必须落在整图范围内（线不能画到格子外面）。
    const points = hexPoints();
    assert.equal(points.length, 6, '六边形必须 6 个顶点');
    for (const [x, y] of points) {
        assert.ok(Math.abs(x) <= imageWidth / 2 + 1e-9, `顶点 x=${x} 超出整图宽 ${imageWidth}`);
        assert.ok(Math.abs(y) <= imageHeight / 2 + 1e-9, `顶点 y=${y} 超出整图高 ${imageHeight}`);
    }
    // 立体地块特有：顶面**小于整图**（底部有厚度），顶点不该贴到整图边界。
    const topHalfWidth = HEX_GRID_FACE_WIDTH / 2;
    assert.ok(topHalfWidth < imageWidth / 2,
        `顶面半宽 ${topHalfWidth} 应小于整图半宽 ${imageWidth / 2}（侧壁向内收）`);

    // ⑤ 🔴 立体地块的间距判据是「**露出棋盘橙底 = 0**」，不是「空洞率」。
    //
    // ⚠️ 空洞率量的是"有没有被任何格子盖到"，但**平面蒙版的缝隙露的是同色邻格**
    // （视觉无缝），**立体图的缝隙露的是棋盘橙底**（一眼可见）。
    // 实测同样「空洞 1% vs 13%」的两版，观感完全相反 —— 用错判据会把更差的当更好。
    //
    // 这里做**结构性校验**（离线像素判据在 `tmp/hexnor/show_through.mjs`）：
    // 列距与行距必须小于整图宽高，且相位为行距/4（蜂窝交错），
    // 否则格子之间必然露出底色。
    assert.ok(columnSpacing < imageWidth,
        `列距 ${columnSpacing} 必须小于整图宽 ${imageWidth}，否则格间露底色`);
    assert.ok(rowSpacing < imageHeight,
        `行距 ${rowSpacing} 必须小于整图高 ${imageHeight}，否则格间露底色`);
    const topHeight = HEX_GRID_FACE_HEIGHT;
    // ⚠️ 行距应 **≥ 顶面高**，标准蜂窝取**等于**（= 90）。
    // 行距 < 顶面高 ⇒ 相邻格顶面互相压盖、把上下两格挤在一起；
    // 行距 > 顶面高 ⇒ **每格侧壁都露出 (行距−顶面高) px，整片地图像一格格独立凸起的砖** ——
    // 这正是 2026-10-12 把行距加大到 105 时踩的坑（截图"所有地块连起来不是平整的"）。
    assert.ok(rowSpacing >= topHeight,
        `行距 ${rowSpacing} 不得小于顶面高 ${topHeight}（否则上下格顶面互相压盖）`);
    assert.equal(rowSpacing, topHeight,
        `行距应等于顶面高（标准蜂窝取 ${topHeight}）；大于它会让每格侧壁外露、地形不平整`);
    // 相位的真检查在 `map-editor.test.ts`（「相邻列相位差应为半行距」），
    // 那边直接读 `editor.geometry.phase`，这里不重复自证。
});

/**
 * 🔴 立体地块必须做**画家排序**（按屏幕 y 排 siblingIndex）。
 *
 * 2026-10-12 换 `img_land_01_gray` 时踩过：`initialize` 里有一段注释说
 * 「hex_nor 是纯 2D 蒙版……不再需要旧 3D 地块为遮抗锯齿重叠而做的画家排序，
 * 按地图顺序创建即可」—— 对**平面蒙版**成立（格子没厚度，谁盖谁一样），
 * 但立体地块**自带侧壁**，不排序时上排/下排的侧壁互相穿插，立体层次就乱了。
 *
 * 绘制顺序由共享布局计算，对局只按这份顺序设置地块 siblingIndex。
 */
test('地块按屏幕 y 做画家排序（立体地块的侧壁层次不能靠 id 序碰运气）', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    const start = source.indexOf('initialize(source?:');
    assert.ok(start > 0, '没读到 initialize');
    const body = source.slice(start, source.indexOf('\n    }\n', start));
    assert.match(body, /layout\.paintOrder\.flatMap\(/, '对局地块应消费共享布局的绘制顺序');
    assert.deepEqual(buildHexGridLayout(2, 2).paintOrder, [1, 0, 3, 2]);
    assert.ok(/setSiblingIndex/.test(body),
        '读取绘制顺序后必须真的 setSiblingIndex 重排');
});

/**
 * 🔴 破门缺口必须正对单位实际贴着的那根砖。
 *
 * 现象：单位从两格外沿角点打墙（攻击距离按格心测，停在角点附近），旧破门逻辑
 * 用标准正六边形法线 30°+60°·edge，而墙砖贴在顶面、外法线被 CONTENT_LIFT 偏移
 * （edge0=37.2° 而非 30°）。角点 63° 在标准口径里属 edge1、在顶面口径里属 edge0，
 * 于是缺口开在相邻的另一条边——"该断的没断、旁边少一根"。
 * 这里直接打真实的 damageWall，验证破门边 = 顶面边分类。
 */
test('破门缺口与墙砖顶面边一致（角点处不再错位一根）', () => {
    const centerX = 100;
    const centerY = 100;
    const attackRadius = 80;
    const damageContext = {
        damageDealt: { player: 0, enemy: 0, neutral: 0 },
        damageTaken: { player: 0, enemy: 0, neutral: 0 },
    } as unknown as ConstructorParameters<typeof ZCDamageResolutionSystem.damageWall>[5];

    const breachAt = (angleDeg: number): number => {
        const angle = angleDeg * Math.PI / 180;
        const wall = {
            id: 1, owner: 'player', wallHp: 1, wallMaxHp: 300, wallBreachedEdge: null,
        } as unknown as ZCHexState;
        const attacker = {
            owner: 'enemy' as const,
            freeX: centerX + Math.cos(angle) * attackRadius,
            freeY: centerY + Math.sin(angle) * attackRadius,
        };
        const result = ZCDamageResolutionSystem.damageWall(
            wall, 999, attacker, true, { x: centerX, y: centerY }, damageContext);
        assert.ok(result?.killed, '本次伤害应击破城墙');
        assert.ok(wall.wallBreachedEdge !== null, '击破后必须写入破门边');
        return wall.wallBreachedEdge as number;
    };

    // ① 斜边上的顶面外法线相对标准正六边形确有系统偏移（否则说明口径被改回公式）。
    const normalDeg = ZC_HEX_TOP_EDGE_NORMALS.map((a) => (a * 180 / Math.PI + 360) % 360);
    assert.ok(Math.abs(normalDeg[0] - 37.2) < 0.5, `edge0 顶面法线应≈37.2°，实际 ${normalDeg[0].toFixed(1)}`);
    assert.ok(Math.abs(normalDeg[2] - 142.8) < 0.5, `edge2 顶面法线应≈142.8°，实际 ${normalDeg[2].toFixed(1)}`);
    assert.ok(Math.abs(normalDeg[3] - 192.2) < 0.5, `edge3 顶面法线应≈192.2°，实际 ${normalDeg[3].toFixed(1)}`);
    assert.ok(Math.abs(normalDeg[5] - 347.8) < 0.5, `edge5 顶面法线应≈347.8°，实际 ${normalDeg[5].toFixed(1)}`);

    // ② 站在每条顶面边的法线方向 → 缺口就开在那条边。
    for (let edge = 0; edge < 6; edge += 1) {
        assert.equal(breachAt(normalDeg[edge]), edge,
            `单位正对 edge${edge} 时缺口应开在 edge${edge}`);
    }

    // ③ 复现角点 63°（旧逻辑判 edge1、顶面砖判 edge0）：现在必须与顶面分类一致 = edge0。
    for (const angle of [60.5, 61.5, 62.5, 63.4]) {
        const visual = zcHexTopEdgeToward(
            centerX + Math.cos(angle * Math.PI / 180) * attackRadius,
            centerY + Math.sin(angle * Math.PI / 180) * attackRadius,
            centerX, centerY);
        assert.equal(breachAt(angle), visual,
            `角点 ${angle}° 破门边应与顶面分类 edge${visual} 一致`);
    }
    // 明确旧 bug 的边界：63° 几何上贴 edge0（而不是被公式算成 edge1）。
    assert.equal(breachAt(63.4), 0, '63.4° 角点应开 edge0（旧逻辑错误开成 edge1）');
});
