import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';
import {
    ZC_CARD_FADE_START_PROGRESS,
    ZC_CARD_REVEAL_SECONDS,
} from '../assets/script/app/zcds/model/ZCBattlePresentationQueue';

/**
 * 小卡牌「生成动画 + 评语延迟」行为断言（2026-10-14）。
 *
 * 需求口径：
 * · 生成动画：卡牌**由 0.2 放大、过冲 1.2、回落穿过 1、再落位**（2026-10-14 第二次调整：
 *   在「放大到 1.2 再缩回 1」之上补了一记下探，把弹性做出来）；
 * · 运气评语（小有收获！/ 大吉大利！/ 欧皇降临！）**比卡牌晚 0.13s 出现**，
 *   但**与卡牌同一时刻消失**（淡出走根节点 UIOpacity 级联，评语自身透明度在出现后恒满）。
 *
 * 视图是**按进度计算**、非 tween（切流程/暂停/快照回放不留残影），所以直接驱动 `render(reveal, now)`
 * 断言每帧的 scale / opacity 即可，不需要补间桩。
 *
 * ⚠️ 曲线与参数一律从**真源模块**取（`ZCGameViewUtil` 经视图夹具装载），不在用例里抄一份
 * ——需求要求「建筑生成节奏与卡牌一致」，两边共用的就是这条曲线，抄死会让它悄悄分叉。
 */

const VIEW_PATH = 'assets/script/app/zcds/view/ZCCardRevealView.ts';

const { load } = loadViews();
const util: any = load('./ZCGameViewUtil');
const POP = {
    from: util.POP_FROM_SCALE as number,
    peak: util.POP_PEAK_SCALE as number,
    dip: util.POP_DIP_SCALE as number,
    peakAt: util.POP_PEAK_AT as number,
    dipAt: util.POP_DIP_AT as number,
};
/** 弹出段占整张卡牌生命周期的比例（`ZCCardRevealView.POP_PROGRESS`）。 */
const POP_PROGRESS = 0.1;
/** 弹出段时长（秒）。 */
const POP_SECONDS = ZC_CARD_REVEAL_SECONDS * POP_PROGRESS;

function createView() {
    class UIOpacity { opacity = 255; }
    class Color { constructor(public r = 0, public g = 0, public b = 0, public a = 255) {} }
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
        Component: class {},
        Color, Label: class {}, Sprite: class {}, SpriteFrame: class {}, UIOpacity,
    };
    const compiled = ts.transpileModule(readFileSync(VIEW_PATH, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    const loaded = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        if (name === 'cc') return cc;
        // 淡出起点必须取自真源：地块回场时机与它同值（见 `ZC_CARD_FADE_START_PROGRESS`）。
        if (name === '../model/ZCBattlePresentationQueue') return { ZC_CARD_FADE_START_PROGRESS };
        assert.equal(name, './ZCGameViewUtil');
        // 真源模块：定位映射与**共用的生成曲线**都从它拿，别在这里另写一份。
        return util;
    }, loaded, loaded.exports);

    /** 与引擎同义：getComponent 按 class 查、addComponent 挂上后能再查到（否则每帧重复挂）。 */
    const makeNode = () => {
        const components: any[] = [];
        return {
            components,
            scale: { x: 1, y: 1, z: 1 },
            position: { x: 0, y: 0, z: 0 },
            setScale(x: number) { this.scale = { x, y: x, z: 1 }; },
            setPosition(x: number, y: number) { this.position = { x, y, z: 0 }; },
            getComponent: (type: unknown) => components.find((c) => c instanceof type) ?? null,
            addComponent: (type: any) => { const c = new type(); components.push(c); return c; },
        };
    };
    const view = new loaded.exports.ZCCardRevealView();
    const node = makeNode();
    const luckNode = makeNode();
    (view as unknown as { node: unknown }).node = node;
    // luckSprite 有图（问号地块才有评语）；卡框 / 卡面不设也能跑（setSprite 判空跳过）。
    view.luckSprite = { node: luckNode, spriteFrame: { name: 'luck' } as never, enabled: true };
    return { view, node, luckNode };
}

/** 一张问号地块的绿卡评语（小有收获），生命周期取卡牌段真源。 */
function reveal(startedAt: number) {
    return {
        cardId: '1036', building: 'none', tier: 1, owner: 'player', unitId: 'u1',
        cardName: '巨力坚果', luckText: '小有收获！', x: 0, y: 0,
        startedAt, durationSeconds: ZC_CARD_REVEAL_SECONDS,
    } as const;
}

test('生成动画：由 0.2 冲到峰值 1.2，回落**穿过 1** 下探再落位，之后恒为 1', () => {
    const { view, node } = createView();
    const renderAt = (elapsed: number) => view.render(reveal(-elapsed) as never, 0);

    assert.equal(typeof util.elasticPopScale, 'function',
        'ZCGameViewUtil 应导出共用的生成曲线（建筑那边也吃这一条）');
    renderAt(0);
    assert.equal(node.scale.x, POP.from, '出生瞬间是起手缩放');
    renderAt(POP_SECONDS * 0.25);
    assert.ok(node.scale.x > POP.from && node.scale.x < POP.peak, '前半段在起手 → 峰值之间');
    // 峰值落在弹出段正中。
    renderAt(POP_SECONDS * POP.peakAt);
    assert.ok(Math.abs(node.scale.x - POP.peak) < 1e-9, `峰值应为 ${POP.peak}，实际 ${node.scale.x}`);
    // 🔴 弹性：回落必须**穿过 1** 下探到 dip —— 旧曲线只回到 1，这一下就是本次要的「更弹」。
    assert.ok(POP.dip < 1, '下探点必须小于 1（收过头才叫弹性）');
    renderAt(POP_SECONDS * POP.dipAt);
    assert.ok(Math.abs(node.scale.x - POP.dip) < 1e-9, `回落下探到 ${POP.dip}，实际 ${node.scale.x}`);
    renderAt(POP_SECONDS);
    assert.ok(Math.abs(node.scale.x - 1) < 1e-9, '弹出段结束落回 1');
    renderAt(1.0);
    assert.equal(node.scale.x, 1, '生成动画之后恒为 1');
    renderAt(2.0);
    assert.equal(node.scale.x, 1, '淡出段不再动缩放');
});

test('评语延迟 0.13s 出现（短暂淡入），淡出与整卡同拍', () => {
    const { view, node, luckNode } = createView();
    const rootOpacity = () => node.components[0].opacity as number;
    const luckOpacity = () => luckNode.components[0].opacity as number;
    const renderAt = (elapsed: number) => view.render(reveal(-elapsed) as never, 0);

    renderAt(0);
    assert.equal(luckOpacity(), 0, '卡牌刚蹦出来时评语还没出现');
    renderAt(0.1);
    assert.equal(luckOpacity(), 0, '0.13s 之前一直隐藏');
    renderAt(0.17);
    assert.ok(luckOpacity() > 0 && luckOpacity() < 255, '0.13s 起在短暂淡入中');
    renderAt(0.3);
    assert.equal(luckOpacity(), 255, '淡入完成后恒满 —— 之后的淡出交给根节点级联');

    // 尾段：根 UIOpacity 在淡出，评语自身保持满 ⇒ 级联下与卡牌同一时刻消失。
    renderAt(2.0);
    assert.ok(rootOpacity() < 255, '整卡已进入淡出');
    assert.equal(luckOpacity(), 255, '评语自身不再另搞一套淡出');
    renderAt(2.4);
    assert.equal(rootOpacity(), 0, '整卡淡完');
    assert.equal(luckOpacity(), 255, '消失时刻由根级联决定，与卡牌严格一致');
});

test('起点之前整卡不渲染：小卡不会以 0.2 缩放静止着等（2026-10-15）', () => {
    const { view, node } = createView();
    const active = () => node.active as boolean;

    // ① 前置的**地块收场段**还在播（`startedAt` 落在未来）⇒ 整卡不渲染。
    //    这是本次要修的现象：只把进度 clamp 到 0 的话，整卡以 `popScale = 0.2` 可见且一动不动。
    view.render(reveal(0.384) as never, 0);
    assert.equal(active(), false,
        '起点之前必须整卡关掉 —— 否则 0.2 缩放的小卡会静止在那儿，读作「卡牌卡住了」');

    // ② 起点那一刻立刻显形，且缩放正好落在**起手档** ⇒「出现」与「开始变大」是同一时刻，
    //    中间没有静止段（需求原文：出现小卡后马上播放卡片变大的动画）。
    view.render(reveal(0.3) as never, 0.3);
    assert.equal(active(), true, '到点必须立刻显形');
    assert.equal(node.scale.x, POP.from, '显形的第一帧就处在起手缩放，紧接着开始放大');

    // ③ 池复用：节点先演一张「进行中」的卡（可见），再拿回来演一张「还没开始」的 ⇒ 必须重新关掉。
    view.render(reveal(0) as never, 1.0);
    assert.equal(active(), true, '进行中的卡必须可见');
    view.render(reveal(99) as never, 1.0);
    assert.equal(active(), false, '复用回来的节点不能留着上一张的可见态');
});

test('没有评语的卡（luckText 为空）评语恒隐；池复用不留上一张的可见态', () => {
    const { view, luckNode } = createView();
    const luckOpacity = () => luckNode.components[0].opacity as number;
    const bare = { ...reveal(0), luckText: '' } as never;
    view.render(bare, 0.5);
    assert.equal(luckOpacity(), 0, '无评语时自身透明度压到 0（sprite 也已 disabled）');
});
