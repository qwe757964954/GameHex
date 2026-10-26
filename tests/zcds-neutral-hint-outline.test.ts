/**
 * 开局「点击金矿」提示：金矿那一格的**整体描边闪烁**（需求 2026-10-15 row10）。
 *
 * 需求原话：「参照图例，进入游戏初始时，给金矿图标所在的地块格子增加一个整体的描边闪烁，
 * 提示玩家点击金矿」。（本轮没有拿到图例，按「整格一圈描边 + 正弦脉冲」自主定稿。）
 *
 *  三个层次各锁一遍：
 *   - 曲线（`zcNeutralHintAlpha`）：窗口 = 周期 × 次数、进场即最亮、收尾淡出、窗口外恒 0；
 *   - 视图（`ZCHexView.renderHintOutline`）：0 = 关掉这份 per-cell 画布、>0 = 一圈 6 条边，
 *     值没变不重绘、对象池复用要复位；
 *   - 通道（`ZCGameRenderWorld.renderNeutralHint`）：挂到金矿格、金矿被领 / 窗口结束就收手。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadViews } from './helpers/zcds-view-fixtures';
import { configureZCMap, ZCMapLayout } from '../assets/script/app/zcds/model/ZCGameModel';
import { ZCPvpTileType } from '../assets/script/app/zcds/model/ZCPvpTileRules';
import {
    zcNeutralHintAlpha,
    ZC_NEUTRAL_HINT_CYCLE_SECONDS,
    ZC_NEUTRAL_HINT_CYCLES,
    ZC_NEUTRAL_HINT_MIN_ALPHA,
    ZC_NEUTRAL_HINT_SECONDS,
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

/** 与 `zcds-hex-neighbor-reveal-delay.test.ts` 同款：补齐 prefab 必填引用。 */
function stubHexView(load: (name: string) => unknown, cc: any, bar: () => any): any {
    const view = new (load('./ZCHexView') as any).ZCHexView();
    const sprite = () => ({ node: bar().node, enabled: true, spriteFrame: null, color: null });
    for (const key of ['tileSprite', 'buildingSprite', 'iconSprite', 'priceIcon']) view[key] = sprite();
    view.priceIcon.spriteFrame = { name: 'coin' };
    view.groundGlow = { ...sprite(), color: { r: 255, g: 255, b: 255, a: 180 }, customMaterial: null };
    for (const key of ['tileFrame', 'mineIconFrame', 'barracksIconFrame', 'mysteryFrame',
        'mineFrame', 'ruinsFrame', 'enemyDevelopFrame',
        'goldResourceFrame', 'mineResourceFrame', 'chestResourceFrame']) view[key] = { name: key };
    view.buildingLayer = bar().node;
    view.iconLabel = { node: bar().node, string: '', enabled: true, color: null };
    view.outlineGraphics = new cc.Graphics();
    view.healthBar = bar();
    view.cooldownBar = bar();
    return view;
}

const NEUTRAL_HEX_STATE = {
    id: 7, owner: 'neutral', state: 'occupiable', building: 'none', tier: 0,
    hp: 0, maxHp: 0, wallHp: 0, wallMaxHp: 0, wallBreachedEdge: null,
    developmentCost: 25, tileType: ZCPvpTileType.Mine, developmentResolved: false,
    neutralResourceId: ZC_NEUTRAL_HINT_ITEM_ID, cardId: null,
};

test('★提示曲线：窗口 = 周期 × 次数，进场即最亮，收尾淡出到 0，窗口外恒 0', () => {
    assert.equal(neutralResourceVisualOf(ZC_NEUTRAL_HINT_ITEM_ID), ZCNeutralResourceVisual.Mine,
        '提示对象是中立资源组合里的「金矿」项');
    assert.equal(ZC_NEUTRAL_HINT_SECONDS, ZC_NEUTRAL_HINT_CYCLE_SECONDS * ZC_NEUTRAL_HINT_CYCLES);

    // ① 进场第一帧就是**最亮**（`cos` 相位）：玩家一进对局就看得见，而不是先暗一拍。
    assert.equal(zcNeutralHintAlpha(0), 1);
    // ② 半个周期后落到脉冲下限。
    const dip = zcNeutralHintAlpha(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 0.5);
    assert.ok(Math.abs(dip - ZC_NEUTRAL_HINT_MIN_ALPHA) < 1e-9, `谷值应等于下限，实际 ${dip}`);
    // ③ 一个周期回到最亮（周期是**整数个**）。
    assert.ok(Math.abs(zcNeutralHintAlpha(ZC_NEUTRAL_HINT_CYCLE_SECONDS) - 1) < 1e-9);

    // ④ 窗口外（含负值 / NaN）恒 0 —— 「看到 0 就收手」的判定依赖这一条。
    assert.equal(zcNeutralHintAlpha(-0.01), 0);
    assert.equal(zcNeutralHintAlpha(ZC_NEUTRAL_HINT_SECONDS), 0);
    assert.equal(zcNeutralHintAlpha(ZC_NEUTRAL_HINT_SECONDS + 5), 0);
    assert.equal(zcNeutralHintAlpha(Number.NaN), 0);
    assert.equal(zcNeutralHintAlpha(Number.POSITIVE_INFINITY), 0);

    // ⑤ 收尾整周期淡出：整段严格单调下降、且收尾处已经贴到 0（不硬切）。
    //    ⚠️ 包络必须是平方而不是线性：线性时脉冲在收尾后半段回升会把乘出来的值**带涨**，
    //    表现为「最后一下闪两下再灭」。
    const tailStart = ZC_NEUTRAL_HINT_SECONDS - ZC_NEUTRAL_HINT_CYCLE_SECONDS;
    let previous = Number.POSITIVE_INFINITY;
    for (let t = tailStart; t < ZC_NEUTRAL_HINT_SECONDS; t += 0.02) {
        const value = zcNeutralHintAlpha(t);
        assert.ok(value < previous, `收尾段必须单调下降：t=${t} ${previous} → ${value}`);
        previous = value;
    }
    assert.ok(previous < 1e-6, '收尾处的透明度必须已经到 0（否则窗口结束会硬切）');

    // ⑥ 脉冲段取值落在 [下限, 1]；收尾段被包络压到下限之下（一路到 0）也合法，但不得为负。
    for (let t = 0; t < ZC_NEUTRAL_HINT_SECONDS; t += 0.02) {
        const value = zcNeutralHintAlpha(t);
        assert.ok(value >= 0 && value <= 1 + 1e-9, `t=${t} 越界：${value}`);
        if (t <= tailStart) {
            assert.ok(value >= ZC_NEUTRAL_HINT_MIN_ALPHA - 1e-9, `t=${t} 低于脉冲下限：${value}`);
        }
    }
});

test('★视图：alpha>0 画整格一圈描边，alpha=0 关掉这份画布，值没变不重绘', () => {
    const { load, cc, bar } = loadViews();
    const view = stubHexView(load, cc, bar);
    const graphics = view.outlineGraphics;

    // 初始（没提示）：不碰 Graphics。
    assert.equal(graphics.commands.length, 0);

    view.renderHintOutline(1);
    assert.equal(graphics.enabled, true, '有提示时这份 per-cell 画布必须开');
    const strokeCount = (): number => graphics.commands.filter((c: any) => c.kind === 'stroke').length;
    assert.equal(strokeCount(), 1, '整格描边只提交一笔 stroke');
    const moves = graphics.commands.filter((c: any) => c.kind === 'moveTo');
    const lines = graphics.commands.filter((c: any) => c.kind === 'lineTo');
    assert.equal(moves.length, 6, '六边形 = 6 条边');
    assert.equal(lines.length, 6);
    assert.equal(graphics.lineWidth, 7, '提示线比领地轮廓（6px）更粗');
    // 颜色是主题里的金币金，透明度随脉冲走。
    assert.equal(graphics.strokeColor.r, 255);
    assert.equal(graphics.strokeColor.g, 198);
    assert.equal(graphics.strokeColor.b, 45);
    assert.equal(graphics.strokeColor.a, 255);

    // 透明度只变一点点（< 2%）时**连 Graphics 都不碰**：闪烁是每帧重绘，必须挡住这种噪声。
    // ⚠️ 判据用 `commands` 的**数组引用**而不是长度：`clear()` 是换一个新数组，长度回到同一个数。
    const before = graphics.commands;
    view.renderHintOutline(1.01);
    assert.equal(graphics.commands, before, '透明度几乎没变时不应重绘');

    // 真的变了才重绘，并且透明度跟着走。
    view.renderHintOutline(0.5);
    assert.notEqual(graphics.commands, before, '透明度明显变化要重绘');
    assert.equal(graphics.strokeColor.a, 128);

    // 关掉：清空 + 收起画布（绝不留一条静态的线挂在格子上）。
    view.renderHintOutline(0);
    assert.equal(graphics.commands.length, 0, '关掉时必须清空');
    assert.equal(graphics.enabled, false, '关掉时必须收起画布');
    // 幂等：已经关掉再关一次不炸、也不写节点。
    view.renderHintOutline(0);
    assert.equal(graphics.enabled, false);
    // 非法值按 0 处理。
    view.renderHintOutline(Number.NaN);
    assert.equal(graphics.enabled, false);
});

test('★源码守卫：对象池复用必须复位提示透明度', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
    const initAt = source.indexOf('initialize(');
    const body = source.slice(initAt, source.indexOf('this.pulseMaterialApplied = false;', initAt));
    assert.match(body, /this\.hintOutlineAlpha = 0;/,
        'initialize 必须复位 hintOutlineAlpha（否则复用回来时上一局的闪烁还留在画布上）');
    assert.match(source, /ZC_OUTLINE_HEX_POINTS/,
        '提示描边必须和领地轮廓共用同一份顶面顶点（自己抄一份会和轮廓错开）');
});

/** 提示通道用到的假视图：只记「谁被推了多少透明度」。 */
function makeHintWorld(load: (name: string) => unknown, cc: any, hexes: readonly any[]): {
    world: any;
    calls: Array<{ hexId: number; alpha: number }>;
    modelFor: (elapsedSeconds: number, resourceId: string | null) => any;
} {
    const { ZCGameRenderWorld } = load('./ZCGameRenderWorld') as any;
    const world: any = new ZCGameRenderWorld({ mapLayer: { scale: { x: 1 } } });
    const calls: Array<{ hexId: number; alpha: number }> = [];
    for (const hex of hexes) {
        const entityId = hex.id + 1000;
        world.hexEntityBySource.set(hex.id, entityId);
        world.hexViews.set(entityId, {
            renderHintOutline: (alpha: number) => calls.push({ hexId: hex.id, alpha }),
            render: () => {},
            setSweepOwner: () => {},
            resolveDevelopableHold: () => false,
        });
    }
    const modelFor = (elapsedSeconds: number, resourceId: string | null): any => ({
        snapshot: {
            hexes: [{
                ...NEUTRAL_HEX_STATE,
                id: hexes[0].id,
                neutralResourceId: resourceId,
            }],
            elapsedSeconds,
            status: 'playing',
            pendingSeconds: 0,
        },
        mapConfig: { cityMode: 'battle' },
        canPlayerDevelop: () => false,
        activationOf: () => null,
        buildingCooldown: () => null,
    });
    return { world, calls, modelFor };
}

test('★通道：提示挂在金矿格上按脉冲推；金矿被领或窗口结束就收手', () => {
    const { load, cc } = loadViews();
    const { world, calls, modelFor } = makeHintWorld(load, cc, [{ id: 3 }, { id: 4 }]);

    world.renderNeutralHint(modelFor(0, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.deepEqual(calls, [{ hexId: 3, alpha: 1 }], '进场第一帧就该给金矿格推最亮的描边');

    calls.length = 0;
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS * 0.5, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].hexId, 3);
    assert.ok(Math.abs(calls[0].alpha - ZC_NEUTRAL_HINT_MIN_ALPHA) < 1e-9, '半个周期后应该到谷值');

    // 金矿被领取：模型里 `neutralResourceId` 被清空 ⇒ 提示立刻收手（推一次 0 把线清掉）。
    calls.length = 0;
    world.renderNeutralHint(modelFor(ZC_NEUTRAL_HINT_CYCLE_SECONDS, null));
    assert.deepEqual(calls, [{ hexId: 3, alpha: 0 }], '领取后必须把描边收掉');

    // 窗口结束：收手 + 通道结账（之后不再每帧扫快照）。
    const { world: world2, calls: calls2, modelFor: modelFor2 } =
        makeHintWorld(load, cc, [{ id: 3 }]);
    world2.renderNeutralHint(modelFor2(0, ZC_NEUTRAL_HINT_ITEM_ID));
    calls2.length = 0;
    world2.renderNeutralHint(modelFor2(ZC_NEUTRAL_HINT_SECONDS + 0.1, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.deepEqual(calls2, [{ hexId: 3, alpha: 0 }], '窗口结束要收掉');
    assert.equal(world2.hintOutlineSettled, true, '窗口结束后通道应结账');
    calls2.length = 0;
    world2.renderNeutralHint(modelFor2(ZC_NEUTRAL_HINT_SECONDS + 1, ZC_NEUTRAL_HINT_ITEM_ID));
    assert.deepEqual(calls2, [], '结账后不该再推任何一帧');

    // 没有金矿格：一格都不推（也不能因此把通道永久卡死在下一次换局的窗口里）。
    const { world: world3, calls: calls3, modelFor: modelFor3 } =
        makeHintWorld(load, cc, [{ id: 3 }]);
    world3.renderNeutralHint(modelFor3(0, null));
    assert.deepEqual(calls3, [], '这一盘没有金矿格时不应有任何提示');
});
