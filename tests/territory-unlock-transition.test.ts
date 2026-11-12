/**
 * 「未解锁 → 可激活」的 1s 过渡（用户 2026-11-09）：
 *
 *  1. 锁放大 1.2，再缩小消失，动画总时间 1s；
 *  2. 银币和数字 UI 生成动画，总时间 1s。
 *
 * 三层各钉一段：
 *  · **曲线**（`model/TerritoryUnlockTransition`，纯函数）—— 端点、峰值位置、1s 收工；
 *  · **视图**（`TerritoryStationView`）—— 系数乘在两个基准缩放上，退出条件模式必须归 1；
 *  · **接线**（`TerritoryMapView`）—— 谁记录「锁刚消失」、谁起播、谁推进、换章怎么清。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    TERRITORY_UNLOCK_LOCK_PEAK,
    TERRITORY_UNLOCK_PRICE_PEAK,
    TERRITORY_UNLOCK_TRANSITION_SECONDS,
    territoryUnlockLockScale,
    territoryUnlockPriceScale,
} from '../assets/script/app/territory/model/TerritoryUnlockTransition';
import { FakeColor, loadTerritoryStationModule, makeStationView } from './helpers/territory-station-fixtures';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

const MAP_VIEW = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');

/**
 * 条件格两个节点的**基准缩放**，一律取 `TerritoryStationView` 的真导出。
 *
 * 2026-11-10 用户第二轮把这一组缩小过（图标 1.1 → 0.85、数值 1.5 → 1.2）：当时用例里硬编码的
 * `1.1 / 1.5` 与派生值（`0.55 / 0.75 / 0.44 / 0.6`）一起全红 —— 抄一遍数字等于两边各改一半也能
 * 一起绿，所以这里读模块。
 */
const STATION_MODULE = loadTerritoryStationModule();
const ICON_SCALE = STATION_MODULE.CONDITION_ICON_SCALE as number;
const VALUE_SCALE = STATION_MODULE.CONDITION_VALUE_SCALE as number;

/** 取 `[from, to)` 之间的源码（`to` 缺省 = 文件尾），用来钉「某段逻辑写在哪个方法里」。 */
function slice(source: string, from: string, to?: string): string {
    const start = source.indexOf(from);
    assert.ok(start >= 0, `源码里找不到 ${from}`);
    const end = to ? source.indexOf(to, start + from.length) : source.length;
    assert.ok(!to || end > start, `源码里找不到 ${to}（在 ${from} 之后）`);
    return source.slice(start, end);
}

// ============================================================
// 一、曲线
// ============================================================

test('两段动画都是 1s（用户口径「总时间 1s」，不是首尾相接的 2s）', () => {
    assert.equal(TERRITORY_UNLOCK_TRANSITION_SECONDS, 1);
    // 同一时刻起手 ⇒ 1s 那一刻两段都必须已经收工，总时长才可能只有 1s。
    for (const at of [1, 1.0001, 2, 10]) {
        assert.equal(territoryUnlockLockScale(at), 0, `锁在 ${at}s 后必须已经消失`);
        assert.equal(territoryUnlockPriceScale(at), 1, `价格在 ${at}s 后必须已经完全展开`);
    }
});

test('锁：1 → 1.2 → 0，放大在前、消失拖得久一点', () => {
    assert.equal(TERRITORY_UNLOCK_LOCK_PEAK, 1.2);
    // 还没起播（负数 / 非数）⇒ 保持原样，绝不能一上来就是 0（否则锁会先闪一下才出现）。
    assert.equal(territoryUnlockLockScale(-1), 1);
    assert.equal(territoryUnlockLockScale(Number.NaN), 1);
    assert.equal(territoryUnlockLockScale(0), 1);
    // 峰值：曲线里那一段的第 35% 正好是 1.2（`LOCK_GROW_PORTION`）。
    assert.ok(Math.abs(territoryUnlockLockScale(0.35) - TERRITORY_UNLOCK_LOCK_PEAK) < 1e-9);
    // 前段单调增、后段单调减。
    let previous = territoryUnlockLockScale(0);
    for (let t = 0.02; t < 0.35; t += 0.02) {
        const current = territoryUnlockLockScale(t);
        assert.ok(current > previous, `${t}s 时锁应还在长大：${previous} → ${current}`);
        previous = current;
    }
    previous = territoryUnlockLockScale(0.36);
    for (let t = 0.38; t < 1; t += 0.02) {
        const current = territoryUnlockLockScale(t);
        assert.ok(current < previous, `${t}s 时锁应开始消失：${previous} → ${current}`);
        previous = current;
    }
    // 全程不许超过 1.2（"放大 1.2"是上限，不是过冲）。
    for (let t = 0; t < 1; t += 0.01) {
        const scale = territoryUnlockLockScale(t);
        assert.ok(scale >= 0 && scale <= TERRITORY_UNLOCK_LOCK_PEAK + 1e-9, `${t}s 越界：${scale}`);
    }
    // 后段要"缩得越来越快"（`easeInCubic`）：中点之后的下降速度大于之前。
    const early = territoryUnlockLockScale(0.5) - territoryUnlockLockScale(0.55);
    const late = territoryUnlockLockScale(0.9) - territoryUnlockLockScale(0.95);
    assert.ok(late > early, '越接近 1s 缩得越快，才读得出"嗖"地消失');
});

test('价格：0 → 1.15 → 1，起播那一刻必须是 0（不是"全尺寸闪一帧再缩"）', () => {
    assert.equal(TERRITORY_UNLOCK_PRICE_PEAK, 1.15);
    assert.equal(territoryUnlockPriceScale(-1), 0);
    assert.equal(territoryUnlockPriceScale(Number.NaN), 0);
    assert.equal(territoryUnlockPriceScale(0), 0, '起播帧必须完全没长出来');
    assert.ok(Math.abs(territoryUnlockPriceScale(0.55) - TERRITORY_UNLOCK_PRICE_PEAK) < 1e-9);
    // 先增后减，且全程非负、峰值不超过 1.15。
    let previous = 0;
    for (let t = 0.01; t < 0.55; t += 0.01) {
        const current = territoryUnlockPriceScale(t);
        assert.ok(current > previous, `${t}s 时价格应还在长：${previous} → ${current}`);
        previous = current;
    }
    previous = territoryUnlockPriceScale(0.56);
    for (let t = 0.58; t < 1; t += 0.01) {
        const current = territoryUnlockPriceScale(t);
        assert.ok(current < previous, `${t}s 时价格应回落：${previous} → ${current}`);
        previous = current;
    }
    for (let t = 0; t < 1; t += 0.01) {
        const scale = territoryUnlockPriceScale(t);
        assert.ok(scale >= 0 && scale <= TERRITORY_UNLOCK_PRICE_PEAK + 1e-9, `${t}s 越界：${scale}`);
    }
    // 锁还在放大（前半段）的时候价格就已经在长了 —— 两段同时起手，锁只是压在它上面。
    assert.ok(territoryUnlockPriceScale(0.2) > 0, '价格不能等到锁消失才开始长');
});

// ============================================================
// 二、视图：系数乘在两个基准缩放上
// ============================================================

/** 条件格（银币 + 数字）的一帧渲染数据。 */
function conditionContent(caption = '399') {
    return {
        site: null,
        icon: null,
        isCondition: true,
        conditionIcon: { name: 'silver' },
        conditionTextColor: new FakeColor(20, 40, 60, 255),
        caption,
        tint: new FakeColor(20, 40, 60, 255),
        badge: '',
        interactive: false,
    };
}

test(`价格生成系数乘在「图标 ×${ICON_SCALE} / 数值 ×${VALUE_SCALE}」上，且位置不跟着缩`, () => {
    const { view, caption, text } = makeStationView();
    view.setMapPosition(100, 200);
    // 引擎还没量过文本（出厂宽 92）⇒ 视图按位数估宽，位置是确定的。
    view.render(conditionContent());
    const settled = { x: caption.position.x, valueX: text.position.x };
    assert.deepEqual([caption.scale.x, text.scale.x], [ICON_SCALE, VALUE_SCALE]);

    view.setConditionSpawnScale(0);
    assert.deepEqual([caption.scale.x, caption.scale.y], [0, 0], '系数 0 ⇒ 完全没长出来');
    assert.deepEqual([text.scale.x, text.scale.y], [0, 0]);

    view.setConditionSpawnScale(0.5);
    assert.ok(Math.abs(caption.scale.x - ICON_SCALE * 0.5) < 1e-9,
        `图标应 ${ICON_SCALE}×0.5，实际 ${caption.scale.x}`);
    assert.ok(Math.abs(text.scale.x - VALUE_SCALE * 0.5) < 1e-9,
        `数值应 ${VALUE_SCALE}×0.5，实际 ${text.scale.x}`);

    view.setConditionSpawnScale(TERRITORY_UNLOCK_PRICE_PEAK);
    assert.ok(Math.abs(caption.scale.x - ICON_SCALE * TERRITORY_UNLOCK_PRICE_PEAK) < 1e-9);
    assert.ok(Math.abs(text.scale.x - VALUE_SCALE * TERRITORY_UNLOCK_PRICE_PEAK) < 1e-9);

    view.setConditionSpawnScale(1);
    assert.deepEqual([caption.scale.x, text.scale.x], [ICON_SCALE, VALUE_SCALE],
        '收工必须落回基准，别停在过冲值');
    // 位置永远按**展开后**的宽度算：缩放不等于重排，否则放大时会左右乱窜。
    assert.equal(caption.position.x, settled.x);
    assert.equal(text.position.x, settled.valueX);
});

test('过渡中途的整帧重绘不能把系数顶掉（每秒一次的 render 不许闪回全尺寸）', () => {
    const { view, caption, text } = makeStationView();
    view.setMapPosition(100, 200);
    view.render(conditionContent());
    view.setConditionSpawnScale(0.4);
    view.render(conditionContent('3999'));
    assert.ok(Math.abs(caption.scale.x - ICON_SCALE * 0.4) < 1e-9,
        `重绘后图标仍是 ${ICON_SCALE}×0.4，实际 ${caption.scale.x}`);
    assert.ok(Math.abs(text.scale.x - VALUE_SCALE * 0.4) < 1e-9,
        `重绘后数值仍是 ${VALUE_SCALE}×0.4，实际 ${text.scale.x}`);
    // 同一帧里 `setMapPosition` 也会走一遍排布，同样不许把它掰回 1。
    view.setMapPosition(140, 260);
    assert.ok(Math.abs(caption.scale.x - ICON_SCALE * 0.4) < 1e-9);
});

test('退出条件模式 ⇒ 系数归 1（站点节点池化复用，别把 0.4 倍带给名称底条）', () => {
    const { view, caption, text } = makeStationView();
    view.setMapPosition(100, 200);
    view.render(conditionContent());
    view.setConditionSpawnScale(0.4);
    // 下一格借到同一个节点：普通建筑（名称底条）。
    view.render({ site: {}, icon: {}, caption: '资源点', tint: new FakeColor(1, 2, 3, 255), badge: '', interactive: true });
    assert.deepEqual([caption.scale.x, text.scale.x], [1, 1], '非条件模式必须还原成 1');
    // 再切回条件格：不能带着上一轮的系数（否则这一格会以 0.34 / 0.48 倍开局、看着像没画完）。
    view.render(conditionContent());
    assert.deepEqual([caption.scale.x, caption.scale.y], [ICON_SCALE, ICON_SCALE]);
    assert.deepEqual([text.scale.x, text.scale.y], [VALUE_SCALE, VALUE_SCALE]);
});

// ============================================================
// 三、地图接线
// ============================================================

test('「锁刚消失」只在 applyHexLock 里记录（锁显隐的唯一交汇点）', () => {
    const body = slice(MAP_VIEW, 'private applyHexLock(', 'private shouldRecolor(');
    // 上一帧还 active、这一帧被摘掉 ⇒ 记一笔；同一个地方还得挡住"过渡在播时别掐掉锁"。
    assert.match(body, /if \(sprite && sprite\.node\.active\)/);
    assert.match(body, /this\.lockVanishedCells\.add\(cellId\)/);
    assert.match(body, /if \(this\.unlockTransitions\.has\(cellId\)\) return;/,
        '过渡在播时不许把锁关掉（paintHexes 每秒全量走一遍，会闪回一帧）');
    // 起播时锁节点刚被关掉，这里要记下来而不是直接返回。
    assert.ok(body.indexOf('this.lockVanishedCells.add(cellId)') > body.indexOf('sprite.node.active = false'),
        '必须先关节点再记账（顺序反了会把"本来就没锁"也算成刚消失）');
});

test('站点格与随机格都在 render 之前起播，且本帧记账在 syncStations 末尾清空', () => {
    const body = slice(MAP_VIEW, 'private syncStations(', 'private syncGhosts(');
    const starts = body.split('this.startUnlockTransitionIfNeeded(').length - 1;
    assert.equal(starts, 2, '站点格 + 随机资源格两条路都要起播');
    // 必须排在 `view.render` 之前：视图先把系数记下来，那次 applyCaptionPlacement 才按它摆。
    for (const renderCall of ['this.startUnlockTransitionIfNeeded(site.cellId', 'this.startUnlockTransitionIfNeeded(cellId']) {
        const at = body.indexOf(renderCall);
        assert.ok(at > 0, `找不到 ${renderCall}`);
        const renderAt = body.indexOf('view.render(content)', at);
        assert.ok(renderAt > at, `${renderCall} 必须排在 view.render(content) 之前`);
    }
    assert.match(body, /this\.lockVanishedCells\.clear\(\);/);
});

test('起播判据：有价可长 + 视图在才演；推进在 update 里、排在 stepLockPops 之后', () => {
    const start = slice(MAP_VIEW, 'private startUnlockTransitionIfNeeded(', 'private stepUnlockTransitions(');
    assert.match(start, /if \(!this\.lockVanishedCells\.delete\(cellId\)\) return;/,
        '「锁刚消失」是一次性票据，读一次就消费掉');
    assert.match(start, /if \(!priceVisible\) return;/, '没有价格可长就别演');
    assert.match(start, /if \(!this\.stationViews\.has\(cellId\)\) return;/);
    assert.match(start, /this\.lockPops\.delete\(cellId\);/, '得先让位给过场里的锁弹跳（同一颗节点的 scale）');

    const step = slice(MAP_VIEW, 'private stepUnlockTransitions(', 'private applyUnlockTransitionFrame(');
    assert.match(step, /TERRITORY_UNLOCK_TRANSITION_SECONDS/, '收工时间必须是那 1s 常量');
    assert.match(step, /this\.unlockTransitions\.delete\(cellId\);/);

    const update = slice(MAP_VIEW, 'update(dt: number): void {', 'private resolveBuildingReveal(');
    const pops = update.indexOf('this.stepLockPops(dt);');
    const unlock = update.indexOf('this.stepUnlockTransitions(dt);');
    assert.ok(pops > 0 && unlock > pops, '过渡推进必须排在锁弹跳之后（本帧以过渡为准）');
});

test('收尾把那颗锁复位成 1 再关节点，且换章清空秒表', () => {
    const frame = slice(MAP_VIEW, 'private applyUnlockTransitionFrame(', '// 「进战斗 / 匹配」整页过场：地图那半');
    assert.match(frame, /sprite\.node\.setScale\(1, 1, 1\);\s*\n\s*sprite\.node\.active = false;/,
        '留一个 scale = 0 的隐藏节点，下一把锁会以 0 尺寸长出来（肉眼等于丢了）');
    assert.match(frame, /setConditionSpawnScale\(territoryUnlockPriceScale\(elapsed\)\)/);

    const cancel = slice(MAP_VIEW, 'private cancelPreviewCinema(', 'private stepLockPops(');
    assert.match(cancel, /this\.unlockTransitions\.clear\(\);/);
    assert.match(cancel, /this\.lockVanishedCells\.clear\(\);/);
});

// ============================================================
// 四、状态机（真跑一遍：锁消失 → 1.2 → 0 与 价格 0 → 1）
// ============================================================

/** 只带状态机需要的字段的实例（字段初始化器不跑，全部手工铺）。 */
function makeMapStateMachine() {
    const MapView = loadTerritoryMapViewClass();
    const view = Object.create(MapView.prototype) as Record<string, any>;
    const lockNode = {
        active: true,
        isValid: true,
        layer: 0,
        parent: null as unknown,
        scale: { x: 1, y: 1, z: 1 },
        setScale(x: number, y: number) { this.scale.x = x; this.scale.y = y; },
        setParent(parent: unknown) { this.parent = parent; },
        setPosition() {},
    };
    const sprite = { node: lockNode, spriteFrame: null };
    const priceScales: number[] = [];
    const stationView = { setConditionSpawnScale: (scale: number) => priceScales.push(scale) };
    view.hexLocks = new Map([[7, sprite]]);
    view.stationViews = new Map([[7, stationView]]);
    view.unlockTransitions = new Map<number, number>();
    view.lockVanishedCells = new Set<number>();
    view.lockPops = new Map<number, number>();
    // 锁层懒建要读 `gridLayer.parent`，这里不搭场景 ⇒ 直接给一个壳（`applyHexLock` 只用它当父节点）。
    view.ensureHexLockLayer = () => ({ layer: 0 });
    return { view, lockNode, priceScales };
}

test('状态机：锁消失 ⇒ 1.2 → 0，价格 0 → 1，1s 后两件都收工', () => {
    const { view, lockNode, priceScales } = makeMapStateMachine();

    // ① 锁还在 —— 只是普通显示，不该记任何东西。
    view.applyHexLock(7, false, null, undefined);
    assert.equal(lockNode.active, false, '锁被摘掉');
    assert.ok(view.lockVanishedCells.has(7), '要记下「这一格刚变成可激活」');

    // ② 起播：锁重新点亮（尺寸 1），价格归 0（还没长出来）。
    view.startUnlockTransitionIfNeeded(7, true);
    assert.ok(view.unlockTransitions.has(7));
    assert.equal(view.unlockTransitions.get(7), 0);
    assert.equal(lockNode.active, true, '起播这一帧锁必须重新点亮，否则那半段白做');
    assert.deepEqual([lockNode.scale.x, lockNode.scale.y], [1, 1]);
    assert.deepEqual(priceScales, [0], '最初一帧价格完全没长出来');

    // ③ 票据是一次性的：同一帧再调一次不会把秒表拍回 0。
    view.startUnlockTransitionIfNeeded(7, true);
    assert.equal(view.unlockTransitions.get(7), 0);

    // ④ 过渡在播时，每秒一次的 paintHexes 不许把锁关机（否则会闪回一帧）。
    lockNode.active = true;
    view.applyHexLock(7, false, null, undefined);
    assert.equal(lockNode.active, true, '在播时 applyHexLock 必须让位');
    assert.equal(view.lockVanishedCells.has(7), false, '不能再记第二张票据');

    // ⑤ 推进：锁先大到 1.2、后缩没；价格先长后落。
    view.stepUnlockTransitions(0.3);
    assert.ok(Math.abs(lockNode.scale.x - territoryUnlockLockScale(0.3)) < 1e-9);
    assert.ok(lockNode.scale.x > 1, '前半段是放大的');
    assert.ok(priceScales[priceScales.length - 1] > 0, '价格同时已经在长（不是等锁消失才动）');
    view.stepUnlockTransitions(0.5);
    assert.ok(lockNode.scale.x < 1, '过了峰值开始缩小');
    assert.ok(priceScales[priceScales.length - 1] > 1, '价格此时正处在过冲段');

    // ⑥ 收工（累计 1s）：锁复位成 1 并关机，价格落回 1 并**留在** 1。
    view.stepUnlockTransitions(0.2);
    assert.equal(view.unlockTransitions.has(7), false, '秒表要自己摘掉');
    assert.equal(lockNode.active, false);
    assert.deepEqual([lockNode.scale.x, lockNode.scale.y], [1, 1], '不能留 0 缩放的隐藏节点');
    assert.equal(priceScales[priceScales.length - 1], 1);
});

test('状态机：没有价格可长 / 视图不在 ⇒ 只把锁收掉，不起播', () => {
    // ① 锁消失但这一格没有价格（例如已被别的途径解锁）。
    const a = makeMapStateMachine();
    a.view.applyHexLock(7, false, null, undefined);
    a.view.startUnlockTransitionIfNeeded(7, false);
    assert.equal(a.view.unlockTransitions.size, 0);
    assert.equal(a.lockNode.active, false);
    assert.deepEqual(a.priceScales, [], '没起播就不该写价格系数');

    // ② 视图不在（这格没有站点视图 / 已被回收）。
    const b = makeMapStateMachine();
    b.view.stationViews.clear();
    b.view.applyHexLock(7, false, null, undefined);
    b.view.startUnlockTransitionIfNeeded(7, true);
    assert.equal(b.view.unlockTransitions.size, 0, '价格那两颗节点长在视图上，没视图就别演');
});

test('状态机：又锁回去 ⇒ 半路的退场就地收掉，价格回满', () => {
    const { view, lockNode, priceScales } = makeMapStateMachine();
    view.applyHexLock(7, false, null, undefined);
    view.startUnlockTransitionIfNeeded(7, true);
    view.stepUnlockTransitions(0.3);
    assert.ok(view.unlockTransitions.has(7));
    // 前置被退回 ⇒ 同一格重新要求画锁。
    view.applyHexLock(7, true, { name: 'lock' } as never, { x: 10, y: 20 } as never);
    assert.equal(view.unlockTransitions.has(7), false, '秒表要清掉，否则两套曲线抢同一颗节点的 scale');
    assert.equal(priceScales[priceScales.length - 1], 1, '价格系数必须回满（下一帧它就该消失）');
    assert.equal(lockNode.active, true);
});

