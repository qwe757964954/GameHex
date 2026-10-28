/**
 * 开局「点击金矿」提示：金矿那一格的**整体描边呼吸**。
 *
 * 起源是 2026-10-15 row10：「进入游戏初始时，给金矿图标所在的地块格子增加一个整体的描边闪烁，
 * 提示玩家点击金矿」。之后两次改口径：
 *  - 2026-10-26 ①：**一直呼吸到被点**（去掉 4.4s 窗口），节奏放慢加深（1.6s、1 ↔ 0.15）；
 *  - 2026-10-26 ②（用户贴图）：「换成绿色更显眼、描边 +2px、覆盖在最上层」，且目标是
 *    **金矿地块**（`tileType = mine`，画 `icon_jk` + 造价）而不是只认资源点。
 *
 *  三个层次各锁一遍：
 *   - 曲线（`zcNeutralHintAlpha`）：**没有窗口**，`elapsed >= 0` 就一直 `1 ↔ 0.15` 呼吸；
 *     负值 / NaN / Infinity 返回 0（调用方"看到 0 就先别画"）；
 *   - 几何（`ZCHexView.strokeHintOutline`）：>0 = 一圈 6 条边（绿、线宽 9），0 = 清空收画布，
 *     值与上一帧相差 < 2% 不重绘；
 *   - 通道（`ZCGameRenderWorld.renderNeutralHint`）：画布挂在棋盘**最上层** `CooldownOverlay`，
 *     跟着目标格心走；目标被开发/被领走或对局结束才收手，**"这一帧没找到"不许结账**。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import {
    zcNeutralHintAlpha,
    ZC_HINT_GLOW_RING_ALPHAS,
    ZC_NEUTRAL_HINT_CYCLE_SECONDS,
    ZC_NEUTRAL_HINT_MIN_ALPHA,
} from '../assets/script/app/zcds/view/ZCGameViewUtil';
import {
    neutralResourceVisualOf,
    ZCNeutralResourceVisual,
} from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { installZCNeutralTestCatalog, ZC_TEST_ITEM } from './helpers/zcds-neutral-catalog';

configureZCMap(JSON.parse(readFileSync('tests/fixtures/zcds-legacy-map.json', 'utf8')) as ZCMapLayout);
installZCNeutralTestCatalog();
/** 提示目标 = 金矿类资源项（组合 13005 / 资源项 1300501）。 */
const ZC_NEUTRAL_HINT_ITEM_ID = ZC_TEST_ITEM.Mine;

const NEUTRAL_HEX_STATE = {
    id: 7, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
    hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
    developmentCost: 25, tileType: ZCPvpTileType.Mine, developmentResolved: false,
    neutralResourceId: ZC_NEUTRAL_HINT_ITEM_ID as number | null, cardId: null,
};

test('★提示曲线：没有窗口，进场即最亮，一直 1 ↔ 下限呼吸', () => {
    assert.equal(neutralResourceVisualOf(ZC_NEUTRAL_HINT_ITEM_ID), ZCNeutralResourceVisual.Mine,
        '提示对象是中立资源组合里的「金矿」项');

    // ① 进场第一帧就是**最亮**（`cos` 相位）：玩家一进对局就看得见，而不是先暗一拍。
    assert.equal(zcNeutralHintAlpha(0), 1);
    // ② 半个周期后落到呼吸下限。
    const dip = zcNeutralHintAlpha(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 0.5);
    assert.ok(Math.abs(dip - ZC_NEUTRAL_HINT_MIN_ALPHA) < 1e-9, `谷值应等于下限，实际 ${dip}`);
    // ③ 一个周期回到最亮（周期是整数个）。
    assert.ok(Math.abs(zcNeutralHintAlpha(ZC_NEUTRAL_HINT_CYCLE_SECONDS) - 1) < 1e-9);

    // ④ 🔴 没有窗口：很久以后仍然在呼吸（这正是「一直呼吸到被点」的判据）。
    for (const seconds of [5, 20, 120, 3600]) {
        const value = zcNeutralHintAlpha(seconds);
        assert.ok(value >= ZC_NEUTRAL_HINT_MIN_ALPHA - 1e-9 && value <= 1 + 1e-9,
            `t=${seconds}s 仍应在呼吸区间内，实际 ${value}`);
    }
    assert.ok(Math.abs(zcNeutralHintAlpha(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 1200.5) - ZC_NEUTRAL_HINT_MIN_ALPHA) < 1e-9,
        '半小时后（整 1200 个周期 + 半周期）的谷值也必须还在下限 —— 不许被某个窗口截断成 0');

    // ⑤ 非法时间才返回 0 —— 调用方"看到 0 就先别画"这条判定仍然安全。
    assert.equal(zcNeutralHintAlpha(-0.01), 0);
    assert.equal(zcNeutralHintAlpha(Number.NaN), 0);
    assert.equal(zcNeutralHintAlpha(Number.POSITIVE_INFINITY), 0);

    // ⑥ 全周期逐点取值落在 [下限, 1]。
    for (let t = 0; t < ZC_NEUTRAL_HINT_CYCLE_SECONDS * 4; t += 0.02) {
        const value = zcNeutralHintAlpha(t);
        assert.ok(value >= ZC_NEUTRAL_HINT_MIN_ALPHA - 1e-9 && value <= 1 + 1e-9, `t=${t} 越界：${value}`);
    }

    // ⑦ 外发光的每一环必须**从外到内严格递增**（外淡内浓），这是"渐变到边缘"的唯一保证；
    //    任何一环取 1 都会把光晕画成一条实心粗线。
    assert.ok(ZC_HINT_GLOW_RING_ALPHAS.length >= 2, '至少两环才叫渐变');
    for (let index = 0; index < ZC_HINT_GLOW_RING_ALPHAS.length; index += 1) {
        const ring = ZC_HINT_GLOW_RING_ALPHAS[index];
        assert.ok(ring > 0 && ring < 1, `第 ${index} 环系数必须在 (0, 1)：${ring}`);
        if (index > 0) {
            assert.ok(ring > ZC_HINT_GLOW_RING_ALPHAS[index - 1],
                `第 ${index} 环比外一环更浓，否则中间会出现硬边`);
        }
    }
});

test('★几何：绿色、线宽 9 + 两侧 2px 外发光，2% 死区与关掉都幂等', () => {
    const { load, cc } = loadViews();
    const { ZCHexView } = load('./ZCHexView') as any;
    // `enabled` 是 `cc.Component` 上的运行期属性，桩里靠赋值出现；用 `any` 免得被类型挡住。
    const graphics: any = new cc.Graphics();

    // 关着 + alpha=0：什么都不碰。
    ZCHexView.strokeHintOutline(graphics, 0, 0);
    assert.equal(graphics.commands.length, 0);
    assert.notEqual(graphics.enabled, true);

    ZCHexView.strokeHintOutline(graphics, 1, 0);
    assert.equal(graphics.enabled, true, '有提示时画布必须开');
    const strokes = (): any[] => graphics.commands.filter((c: any) => c.kind === 'stroke');
    const moves = (): any[] => graphics.commands.filter((c: any) => c.kind === 'moveTo');
    const lines = (): any[] => graphics.commands.filter((c: any) => c.kind === 'lineTo');

    // 🔴 多笔叠加：4 环外发光 + 1 笔核心线（`cc.Graphics` 的描边没有渐变，只能一层层叠）。
    assert.equal(strokes().length, 5, '4 环光晕 + 1 条核心线');
    assert.equal(moves().length, 30, '5 笔 × 6 条边');
    assert.equal(lines().length, 30);
    assert.equal(graphics.lineCap, cc.Graphics.LineCap.ROUND,
        '六边形是 6 条独立线段，平头会在顶点留楔形缺口（与共享轮廓层同口径）');

    const widths = strokes().map((c: any) => c.lineWidth);
    assert.deepEqual(widths, [13, 12, 11, 10, 9], '由外到内逐笔收窄：核心 9 + 单侧 2px 光晕');
    const alphas = strokes().map((c: any) => c.color.a);
    assert.deepEqual(alphas, [20, 28, 38, 51, 255], '外环淡、核心满不透明（0.08/0.11/0.15/0.20 × 255）');
    for (let i = 1; i < alphas.length; i += 1) {
        assert.ok(alphas[i] > alphas[i - 1], `第 ${i} 笔必须比外一环更亮 —— 否则会出现硬边`);
    }
    // 颜色是主题里的**提示绿**（用户口径「换成绿色，更显眼」）。
    for (const stroke of strokes()) {
        assert.deepEqual(stroke.color, { r: 62, g: 227, b: 111, a: stroke.color.a });
    }

    // 🔴 内缩用提示线自己的 0.94（不是领地轮廓的 0.98）：用户 2026-10-26「提示线用 0.94 左右」。
    // 9px 的线在 0.98 下会压到邻格边缘、盖住邻格的造价数字；0.94 让外沿基本落在格界内侧。
    // 光晕与核心线必须**同一份顶点**，否则光晕会在格角错开半个像素。
    const { ZC_OUTLINE_HEX_POINTS } = load('./ZCOutlineLayer') as any;
    const scaled = ZC_OUTLINE_HEX_POINTS.map((point: number[]) => ({ x: point[0] * 0.94, y: point[1] * 0.94 }));
    for (const move of moves()) {
        const hit = scaled.some((point: any) => Math.abs(point.x - move.x) < 1e-9 && Math.abs(point.y - move.y) < 1e-9);
        assert.ok(hit, `光晕与核心线必须共用同一份顶点（且内缩 0.94）：(${move.x}, ${move.y}) 不在顶点表里`);
    }
    const vertex = ZC_OUTLINE_HEX_POINTS[0];
    const first = moves()[0];
    assert.ok(Math.abs(first.x - vertex[0]) > 1,
        '必须比格界明显往里收（0.98 那版只内缩 2%，等于没缩）');

    // 透明度只变一点点（< 2%）时**连 Graphics 都不碰**：呼吸是每帧重绘，必须挡住这种噪声。
    // ⚠️ 判据用 `commands` 的**数组引用**而不是长度：`clear()` 是换一个新数组，长度回到同一个数。
    const before = graphics.commands;
    ZCHexView.strokeHintOutline(graphics, 1.01, 1);
    assert.equal(graphics.commands, before, '透明度几乎没变时不应重绘');

    // 真的变了才重绘，并且透明度跟着走（核心线仍是最亮的那一笔）。
    ZCHexView.strokeHintOutline(graphics, 0.5, 1);
    assert.notEqual(graphics.commands, before, '透明度明显变化要重绘');
    const half = strokes();
    assert.equal(half[half.length - 1].lineWidth, 9);
    assert.equal(half[half.length - 1].color.a, 128, '核心线透明度 = 255 × 呼吸值');
    assert.ok(half[0].color.a <= 20, '光晕最外环跟着呼吸变淡');
    for (let i = 1; i < half.length; i += 1) {
        assert.ok(half[i].color.a > half[i - 1].color.a, '半透明时也必须是外淡内浓');
    }

    // 关掉：清空 + 收起画布（绝不留一条静态的线挂在格子上）。
    ZCHexView.strokeHintOutline(graphics, 0, 0.5);
    assert.equal(graphics.commands.length, 0, '关掉时必须清空');
    assert.equal(graphics.enabled, false, '关掉时必须收起画布');
    // 幂等：已经关掉再关一次不炸、也不写节点。
    ZCHexView.strokeHintOutline(graphics, 0, 0);
    assert.equal(graphics.enabled, false);
    // 非法值按 0 处理（上一帧开着 ⇒ 要真的收掉，不能留一条静态线）。
    ZCHexView.strokeHintOutline(graphics, Number.NaN, 1);
    assert.equal(graphics.enabled, false);
});

test('★源码守卫：画布挂棋盘最上层，顶点与领地轮廓同源但内缩自己算', () => {
    const hexSource = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
    assert.match(hexSource, /ZC_OUTLINE_HEX_POINTS/,
        '提示描边必须和领地轮廓共用同一份顶面顶点（自己抄一份会和轮廓错开）');
    assert.match(hexSource, /HINT_OUTLINE_INSET_SCALE = 0\.94/,
        '内缩必须是提示线自己的 0.94 —— 领地轮廓的 0.98 在 9px 线宽下会压到邻格造价数字');
    assert.doesNotMatch(hexSource, /private hintOutlineAlpha/,
        '提示透明度状态已搬到渲染层（画布不再属于单格），别在视图里留第二份');

    const worldSource = readFileSync('assets/script/app/zcds/view/ZCGameRenderWorld.ts', 'utf8');
    assert.match(worldSource, /getChildByName\('CooldownOverlay'\)/,
        '🔴 提示画布必须建在棋盘最后一个图层（CooldownOverlay）上，否则会被邻格底色 / 建筑盖住');
    assert.match(worldSource, /node\.setParent\(layer\);[\s\S]{0,160}?this\.hintOutlineNode = node;/,
        '画布节点必须 setParent 到该图层（setParent 追加到子节点序末尾 = 压在同层之上）');
});

test('★通道：画布挂最上层、跟格心走，一直呼吸；金矿被点或对局结束才收手', () => {
    const { load, cc } = loadViews();
    const { world, modelFor } = makeHintWorld(load, cc, [{ id: 3 }, { id: 4 }]);

    world.renderNeutralHint(modelFor(0, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.equal(world.hintTargetHexId, 3, '进场第一帧就该锁定金矿格');
    assert.equal(world.hintOutlineAlpha, 1, '第一帧就是最亮');
    const graphics = world.hintOutlineGraphics;
    assert.equal(graphics.enabled, true, '描边画布必须开');
    assert.equal(world.hintOutlineNode.parent.name, 'CooldownOverlay',
        '🔴 描边必须画在棋盘最上层，不能留在格子自带的 TerritoryOutline 上');
    const siblings = world.hintOutlineNode.parent.children;
    assert.equal(siblings[siblings.length - 1], world.hintOutlineNode,
        '同层里还要排在最后（压过冷却环 / 血条）');
    assert.deepEqual(
        { x: world.hintOutlineNode.position.x, y: world.hintOutlineNode.position.y },
        { x: 30, y: 15 },
        '画布要摆在目标格心上（顶点口径是格心局部坐标）',
    );

    // 半个周期后到谷值，仍然在推。
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 0.5, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.ok(Math.abs(world.hintOutlineAlpha - ZC_NEUTRAL_HINT_MIN_ALPHA) < 1e-9, '半个周期后应该到谷值');
    assert.equal(graphics.enabled, true);

    // 🔴 旧口径在 4.4s 就收手；现在必须继续推（这就是「一直呼吸到被点」）。
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 20, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.equal(graphics.enabled, true, '28s 之后仍要在呼吸（没有窗口）');
    assert.ok(world.hintOutlineAlpha > 0, '长时间之后透明度也不该是 0');

    // 金矿被领取：模型里 `neutralResourceId` 被清空 ⇒ 提示立刻收手并结账。
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 21, null));
    assert.equal(world.hintTargetHexId, null, '目标没了要清掉缓存的 hexId');
    assert.equal(world.hintOutlineAlpha, 0, '领取后必须把描边收掉');
    assert.equal(graphics.enabled, false, '收掉后画布要关（不留一条静态线）');
    assert.equal(world.hintOutlineSettled, true, '收手后通道要结账，别再每帧查');
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 22, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.equal(graphics.enabled, false, '结账后不该再开画布');

    // 对局结束（结算演出）⇒ 收手：提示不该压在胜利扫场上。
    const { world: world4, modelFor: modelFor4 } = makeHintWorld(load, cc, [{ id: 3 }]);
    world4.renderNeutralHint(modelFor4(0, ZC_NEUTRAL_HINT_ITEM_ID));
    const finished = modelFor4(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 2, ZC_NEUTRAL_HINT_ITEM_ID);
    finished.snapshot.status = 'finished';
    world4.renderNeutralHint(finished);
    assert.equal(world4.hintOutlineGraphics.enabled, false, '结算开始后要把描边收掉');
    assert.equal(world4.hintOutlineSettled, true, '结算开始也要结账');

    // 🔴 这一刻还没有金矿格 ⇒ 不画，但**绝不结账**：开局头几帧目标格可能还没翻成可开发。
    const { world: world3, modelFor: modelFor3 } = makeHintWorld(load, cc, [{ id: 3 }]);
    world3.renderNeutralHint(modelFor3(0, null));
    assert.equal(world3.hintOutlineAlpha, 0, '这一帧没有金矿格时不应有描边');
    assert.equal(world3.hintOutlineSettled, false, '没找到目标不许结账，要留到下一帧继续找');
    // 目标随后出现（资源晚一拍落位）⇒ 立刻接着呼吸。
    world3.renderNeutralHint(modelFor3(0.1, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.ok(Math.abs(world3.hintOutlineAlpha - zcNeutralHintAlpha(0.1)) < 1e-9, '目标出现后必须马上接上');
    assert.equal(world3.hintOutlineSettled, false);
});

test('★通道：优先挂「金矿地块」（icon_jk + 造价），不是只有资源点才算金矿', () => {
    const { load, cc } = loadViews();

    // 🔴 2026-10-26 用户原话「初始生成的金矿图标」= 开局那圈里 `tileType = mine` 的地块
    // （画 `icon_jk` + 造价）。它 `neutralResourceId` 是 null，纯资源点口径根本找不到它
    // ⇒ 描边一格都没闪过。这里钉死「地块优先」。
    const { world, modelFor } = makeHintWorld(load, cc, [{ id: 11 }]);
    world.renderNeutralHint(modelFor(0, null, true));
    assert.equal(world.hintTargetHexId, 11,
        '可开发的金矿地块必须被认成提示目标（哪怕它没有中立资源 id）');
    assert.equal(world.hintTargetKind, 'tile', '地块口径要记成 tile');
    assert.equal(world.hintOutlineAlpha, 1);
    assert.equal(world.hintOutlineGraphics.enabled, true);

    // 这一格被开发掉（不再是可开发的金矿地块）⇒ 收手结账。
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS, null, false));
    assert.equal(world.hintOutlineAlpha, 0, '开发完成后必须把描边收掉');
    assert.equal(world.hintOutlineGraphics.enabled, false);
    assert.equal(world.hintOutlineSettled, true);

    // 同一张图里既有可开发金矿地块、又有中立金矿资源点时，优先地块（玩家点它才算开发金矿）。
    const { world: world2, modelFor: modelFor2 } = makeHintWorld(load, cc, [{ id: 11 }]);
    world2.renderNeutralHint(modelFor2(0, ZC_NEUTRAL_HINT_ITEM_ID, true));
    assert.equal(world2.hintTargetKind, 'tile');
    assert.equal(world2.hintTargetHexId, 11);

    // 只有资源点（地块不可开发）时退回资源口径，并且仍然一直呼吸。
    const { world: world5, modelFor: modelFor5 } = makeHintWorld(load, cc, [{ id: 11 }]);
    world5.renderNeutralHint(modelFor5(0, ZC_NEUTRAL_HINT_ITEM_ID, false));
    assert.equal(world5.hintTargetKind, 'resource', '没有可开发金矿地块时退回资源点口径');
    assert.equal(world5.hintOutlineAlpha, 1);
});

/**
 * 提示通道用到的假世界：棋盘只搭 `CooldownOverlay` 一层（画布要挂它），地块视图只给
 * `node.position`（画布跟着格心走）。
 */
function makeHintWorld(
    load: (name: string) => unknown,
    cc: any,
    hexes: readonly any[],
): {
    world: any;
    board: any;
    modelFor: (elapsedSeconds: number, resourceId: number | null, canDevelop?: boolean) => any;
} {
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld') as any;
    const board = new cc.Node('ZCGameBoard');
    const cooldownLayer = new cc.Node('CooldownOverlay');
    cooldownLayer.setParent(board);
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } }, board });
    for (const hex of hexes) {
        const entityId = hex.id + 1000;
        const node = new cc.Node(`hex_${hex.id}`);
        node.setPosition(hex.id * 10, hex.id * 5, 0);
        world.hexEntityBySource.set(hex.id, entityId);
        world.hexViews.set(entityId, {
            node,
            render: () => {},
            setSweepOwner: () => {},
            isDevelopableSpawning: () => false,
        });
    }
    const modelFor = (elapsedSeconds: number, resourceId: number | null, canDevelop = false): any => {
        const state = { ...NEUTRAL_HEX_STATE, id: hexes[0].id, neutralResourceId: resourceId };
        return {
            snapshot: { hexes: [state], elapsedSeconds, status: 'playing', pendingSeconds: 0 },
            // 真帧有 `hexesById`：提示通道靠它找目标、并判断"这一格还值不值得提示"。
            hexesById: new Map([[hexes[0].id, { state, canDevelop, cooldown: null, activation: null }]]),
            mapConfig: { cityMode: 'battle' },
            canPlayerDevelop: () => canDevelop,
            activationOf: () => null,
            buildingCooldown: () => null,
        };
    };
    return { world, board, modelFor };
}
