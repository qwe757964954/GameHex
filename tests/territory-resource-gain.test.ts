import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    isTerritoryWalletResId,
    splitTerritoryRewards,
    territoryBurstLaunch,
    territoryBurstParticle,
    territoryGainFx,
    TERRITORY_GAIN_BURST_COUNT,
    TERRITORY_GAIN_BURST_FADE_SECONDS,
    TERRITORY_GAIN_BURST_FLIP_MAX_HZ,
    TERRITORY_GAIN_BURST_FLIP_MIN_HZ,
    TERRITORY_GAIN_BURST_GRAVITY,
    TERRITORY_GAIN_BURST_HALF_ANGLE_DEG,
    TERRITORY_GAIN_BURST_LIFE_JITTER,
    TERRITORY_GAIN_BURST_LIFE_SECONDS,
    TERRITORY_GAIN_BURST_SCALE_JITTER,
    TERRITORY_GAIN_BURST_SPEED,
    TERRITORY_GAIN_BURST_SPEED_JITTER,
    TERRITORY_GAIN_BURST_STAGGER_SECONDS,
    TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS,
    TERRITORY_GAIN_BURST_TOTAL_SECONDS,
    TERRITORY_GAIN_ENTRANCE_RATIO,
    TERRITORY_GAIN_FROM_SCALE,
    TERRITORY_GAIN_POP_SCALE,
    TERRITORY_GAIN_RISE_PX,
    TERRITORY_GAIN_SECONDS,
    TERRITORY_GAIN_STACK_GAP_PX,
    TERRITORY_GAIN_START_LIFT_PX,
    TERRITORY_WALLET_RES_IDS,
} from '../assets/script/app/territory/model/TerritoryResourceGain';

const read = (path: string): string => readFileSync(path, 'utf8');

// ── 奖励分流：7 / 9 走飘字，其余走弹窗 ────────────────────────────────────

test('银币(7) 与体力(9) 判为钱包资源，其余不是', () => {
    assert.deepEqual([...TERRITORY_WALLET_RES_IDS], [7, 9]);
    assert.equal(isTerritoryWalletResId(7), true);
    assert.equal(isTerritoryWalletResId(9), true);
    assert.equal(isTerritoryWalletResId(10), false, '金币(10) 是道具口径，仍要弹窗');
    assert.equal(isTerritoryWalletResId(18003), false);
    assert.equal(isTerritoryWalletResId(0), false);
    assert.equal(isTerritoryWalletResId(undefined), false);
});

test('分流：一批奖励里钱包类进飘字、其余进弹窗，且各自保持原顺序', () => {
    const split = splitTerritoryRewards([
        { resId: 18003, amount: 2 },
        { resId: 7, amount: 120 },
        { resId: 9, amount: 3 },
        { resId: 1001, amount: 1 },
    ]);
    assert.deepEqual(split.gains.map((g) => g.resId), [7, 9]);
    assert.deepEqual(split.popup.map((g) => g.resId), [18003, 1001]);
    assert.deepEqual(split.gains, [{ resId: 7, amount: 120 }, { resId: 9, amount: 3 }]);
});

test('分流边界：全是钱包资源 ⇒ 弹窗为空（整批跳过奖励弹窗）', () => {
    const split = splitTerritoryRewards([{ resId: 7, amount: 50 }, { resId: 9, amount: 1 }]);
    assert.equal(split.popup.length, 0);
    assert.equal(split.gains.length, 2);
    assert.deepEqual(splitTerritoryRewards([]).gains, []);
    assert.deepEqual(splitTerritoryRewards([]).popup, []);
});

// ── 升起曲线 ────────────────────────────────────────────────────────────

test('升起：从 0 单调升到满程，末段收尾返回 null（可回收）', () => {
    const start = territoryGainFx(0);
    assert.ok(start, '第 0 帧必须有值');
    assert.equal(start?.offsetY, 0);
    assert.ok(Math.abs((start?.scale ?? 0) - TERRITORY_GAIN_FROM_SCALE) < 1e-9);
    assert.equal(start?.opacity, 1);

    let previous = -1;
    for (let t = 0; t < TERRITORY_GAIN_SECONDS; t += TERRITORY_GAIN_SECONDS / 24) {
        const fx = territoryGainFx(t);
        assert.ok(fx, `t=${t} 不该提前结束`);
        assert.ok(fx.offsetY >= previous - 1e-9, '位移必须单调不回退');
        previous = fx.offsetY;
    }
    const last = territoryGainFx(TERRITORY_GAIN_SECONDS - 1e-6);
    assert.ok((last?.offsetY ?? 0) > TERRITORY_GAIN_RISE_PX * 0.9);
    assert.equal(territoryGainFx(TERRITORY_GAIN_SECONDS), null, '整条时长到点即结束');
    assert.equal(territoryGainFx(TERRITORY_GAIN_SECONDS + 0.5), null);
    assert.equal(territoryGainFx(-1), null);
    assert.equal(territoryGainFx(Number.NaN), null);
});

test('升起：入场段弹出到峰值缩放，淡出段回落并淡到全透明', () => {
    const entranceEnd = territoryGainFx(TERRITORY_GAIN_SECONDS * TERRITORY_GAIN_ENTRANCE_RATIO - 1e-6);
    assert.ok(Math.abs((entranceEnd?.scale ?? 0) - TERRITORY_GAIN_POP_SCALE) < 1e-3,
        '入场段末尾应到峰值');
    assert.equal(entranceEnd?.opacity, 1, '入场段不淡出');

    const fadeHalf = territoryGainFx(
        TERRITORY_GAIN_SECONDS * (TERRITORY_GAIN_ENTRANCE_RATIO + (1 - TERRITORY_GAIN_ENTRANCE_RATIO) / 2));
    assert.ok((fadeHalf?.opacity ?? 1) < 1 && (fadeHalf?.opacity ?? 0) > 0, '淡出段中间是半透明');
    assert.ok((fadeHalf?.scale ?? 0) < TERRITORY_GAIN_POP_SCALE, '淡出段缩放回落');

    const end = territoryGainFx(TERRITORY_GAIN_SECONDS - 1e-6);
    assert.ok((end?.opacity ?? 1) < 0.01, '末尾几乎全透明');
    assert.ok(Math.abs((end?.scale ?? 0) - 1) < 1e-2, '末尾回到原尺寸');
});

// ── prefab 结构（离线读盘，不需要引擎） ──────────────────────────────────

const GAIN_PREFAB = 'assets/resources/ui/territory/TerritoryResourceGain.prefab';
const PAGE_PREFAB = 'assets/resources/ui/main/MainTerritoryMap.prefab';

interface IPrefabObject { __type__?: string; _name?: string; [key: string]: unknown }
const load = (path: string): IPrefabObject[] => JSON.parse(read(path)) as IPrefabObject[];

test('飘字 prefab：根节点挂视图脚本 + UIOpacity，三个节点全是 UI_2D', () => {
    const data = load(GAIN_PREFAB);
    const nodes = data.filter((o) => o.__type__ === 'cc.Node');
    assert.equal(nodes.length, 3);
    assert.equal(nodes[0]._name, 'TerritoryResourceGain');
    for (const node of nodes) {
        assert.equal(node._layer, 33554432, `${node._name} 必须 UI_2D`);
    }
    const root = nodes[0];
    const rootComps = (root._components as { __id__: number }[]).map((c) => data[c.__id__].__type__);
    assert.ok(rootComps.includes('cc.UITransform'), '缺 UITransform');
    assert.ok(rootComps.includes('cc.UIOpacity'), '缺 UIOpacity（整条一起淡出靠它）');
    assert.ok(rootComps.some((t) => typeof t === 'string' && !t.startsWith('cc.')),
        '根节点必须挂视图脚本');
});

test('飘字 prefab：脚本三个引用分别指向 Icon 的 Sprite / Amount 的 Label / 根的 UIOpacity', () => {
    const data = load(GAIN_PREFAB);
    const script = data.find((o) => typeof o.__type__ === 'string'
        && !o.__type__.startsWith('cc.') && 'iconSprite' in o);
    assert.ok(script, '找不到视图脚本组件');
    const typeOf = (ref: unknown): string | undefined => {
        const id = (ref as { __id__?: number }).__id__;
        return typeof id === 'number' ? data[id].__type__ : undefined;
    };
    assert.equal(typeOf(script.iconSprite), 'cc.Sprite');
    assert.equal(typeOf(script.amountLabel), 'cc.Label');
    assert.equal(typeOf(script.opacity), 'cc.UIOpacity');
});

test('飘字 prefab：图标 Sprite 是 CUSTOM + 不裁剪（图标尺寸由 prefab 定），数字是金色且带 + 号', () => {
    const data = load(GAIN_PREFAB);
    const sprite = data.find((o) => o.__type__ === 'cc.Sprite');
    assert.equal(sprite?._sizeMode, 0, 'CUSTOM：贴图不该改写节点尺寸');
    assert.equal(sprite?._isTrimmedMode, false);
    assert.equal(sprite?._spriteFrame, null, '帧由代码注入，prefab 里不许写死');

    const label = data.find((o) => o.__type__ === 'cc.Label');
    assert.match(String(label?._string), /^\+/);
    assert.equal(label?._color?.r, 245);
    assert.equal(label?._color?.g, 201);
    assert.equal(label?._color?.b, 92);
});

test('飘字 prefab：icon + 数字整体居中（按中心摆，不能共用左边界 x）', () => {
    // 🔴 规则 4.3：一组宽度不同的子件（图标 40 / 数字按字数变宽）必须按**中心**摆。
    // 两个子节点共用同一个 `x` 会把整条飘字推到格子左边（图标偏 47px），
    // 而结构 / 尺寸 / 贴图全对，单看 prefab 看不出来 —— 只能靠这条算出来的中心值卡住。
    const data = load(GAIN_PREFAB);
    const nodeByName = (name: string): IPrefabObject =>
        data.find((o) => o.__type__ === 'cc.Node' && o._name === name)!;
    const transformOf = (node: IPrefabObject): IPrefabObject => {
        const ids = (node._components as { __id__: number }[]).map((c) => c.__id__);
        return data[ids.find((id) => data[id].__type__ === 'cc.UITransform')!];
    };
    const spanOf = (name: string): [number, number] => {
        const node = nodeByName(name);
        const transform = transformOf(node);
        const size = transform._contentSize as { width: number; height: number };
        const anchor = transform._anchorPoint as { x: number; y: number };
        const x = (node._lpos as { x: number }).x;
        return [x - size.width * anchor.x, x + size.width * (1 - anchor.x)];
    };
    const [iconLeft, iconRight] = spanOf('Icon');
    const [textLeft, textRight] = spanOf('Amount');
    assert.ok(iconRight <= textLeft, `图标右缘 ${iconRight} 不能压到数字左缘 ${textLeft}`);
    const center = (Math.min(iconLeft, textLeft) + Math.max(iconRight, textRight)) / 2;
    assert.ok(Math.abs(center) <= 1,
        `飘字内容没居中：整体中心 ${center.toFixed(2)}（root anchor 0.5 ⇒ 应 ≈ 0）`);
});

test('领地页 prefab：MapView 绑到 GainLayer，且 GainLayer 是 MapLayer 最后一个子节点', () => {
    const data = load(PAGE_PREFAB);
    const mapLayer = data.find((o) => o.__type__ === 'cc.Node' && o._name === 'MapLayer');
    assert.ok(mapLayer);
    const childNames = (mapLayer._children as { __id__: number }[]).map((c) => data[c.__id__]._name);
    assert.equal(childNames[childNames.length - 1], 'GainLayer',
        '飘字层必须排在最后（子节点顺序 = 渲染顺序，否则被站点盖住）');

    const view = data.find((o) => typeof o.__type__ === 'string'
        && !o.__type__.startsWith('cc.') && 'gainLayer' in o);
    assert.ok(view, 'TerritoryMapView 上没有 gainLayer 字段');
    const gainLayerId = (view.gainLayer as { __id__: number }).__id__;
    assert.equal(data[gainLayerId]._name, 'GainLayer');
    assert.equal(data[gainLayerId]._layer, 33554432);
    const prefabUuid = (view.gainPrefab as { __uuid__?: string }).__uuid__;
    assert.match(String(prefabUuid), /^[0-9a-f-]{36}$/, 'gainPrefab 必须是 prefab 资源 uuid');
});

// ── 页面接线：7 / 9 必须「跳过奖励弹窗」 ─────────────────────────────────

test('页面只对「非钱包类」奖励弹窗：全是 7/9 时整批跳过 ShowReward', () => {
    // 反例断言先剥注释（规则 104）—— 类注释里提到旧写法是合法的。
    const src = read('assets/script/app/main/MainTerritoryMap.ts')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.match(src, /const \{ gains, popup \} = splitTerritoryRewards\(rewards\)/);
    assert.match(src, /playResourceGain\(/, '钱包类要走格子上方飘字');
    assert.match(src, /if \(!popup\.length\) return;/, '全是 7/9 ⇒ 一条都不该弹窗');
    assert.match(src, /FW\.ShowReward\(popup\.map/);
    assert.doesNotMatch(src, /FW\.ShowReward\(rewards/, '不能把未分流的整批奖励喂给弹窗');
});

// ── 喷发曲线（需求 2026-10-16 row17） ────────────────────────────────────
//
// 原话：「获得银币或者体力时，播放喷发的效果，喷发多个图标，多个图片的喷发范围限制在
//   一个倒圆锥的图形，喷发的坐标点对应点击地块的中心点坐标，图标和数字 ui 增加上移的
//   动画放在例子效果坐标点的上方间隔 40px」
// 本节验「喷发」这半句（曲线 + 粒子组）；「上方间隔 40px」在最后一节按源码钉死。

const stripComments = (src: string): string => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** 半顶角的正切 —— 出射角判据的斜率，从常量算，不在测试里另抄一个角度。 */
const CONE_TAN = Math.tan((TERRITORY_GAIN_BURST_HALF_ANGLE_DEG * Math.PI) / 180);
const SEEDS = [0, 1, 2, 7, 42, 12345, 999983, -5];

test('喷发出射：12 颗、错峰 0.025s、绝不与首颗同帧出现', () => {
    assert.equal(TERRITORY_GAIN_BURST_COUNT, 12, '需求口径：每次喷发 12 个粒子');
    assert.equal(TERRITORY_GAIN_BURST_STAGGER_SECONDS, 0.025, '需求口径：错峰约 0.025s');
    assert.ok(TERRITORY_GAIN_BURST_COUNT * TERRITORY_GAIN_BURST_STAGGER_SECONDS > 1 / 60,
        '12 颗按 0.025s 铺开必须超过一帧，否则等于同一帧全部生成');

    // 第 0 帧：只有第 0 颗已经出发（正好在原点）。
    const first = territoryBurstParticle(11, 0, 0);
    assert.ok(first);
    assert.ok(Math.abs(first.offsetX) < 1e-9, `第 0 帧必须在原点，实测 x=${first.offsetX}`);
    assert.ok(Math.abs(first.offsetY) < 1e-9, `第 0 帧必须在原点，实测 y=${first.offsetY}`);
    for (let index = 1; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
        assert.equal(territoryBurstParticle(11, index, 0), null, `第 ${index} 颗不该和第 0 颗同时出现`);
    }
    // 每一颗都在自己的出发时刻准时出现，早一瞬还没有。
    for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
        const delay = index * TERRITORY_GAIN_BURST_STAGGER_SECONDS;
        assert.ok(territoryBurstParticle(11, index, delay), `第 ${index} 颗在自己的出发时刻必须有值`);
        assert.equal(territoryBurstParticle(11, index, delay - 1e-9), null, `第 ${index} 颗提前出场`);
        // 整喷上限那一帧一颗都不剩
        assert.equal(territoryBurstParticle(11, index, TERRITORY_GAIN_BURST_TOTAL_SECONDS), null,
            `第 ${index} 颗在整喷上限之后还在`);
    }
});

test('喷发：总时长 = 最后一颗的出发时刻 + 最长生命（只是硬上限，实际更早收）', () => {
    assert.equal(
        TERRITORY_GAIN_BURST_TOTAL_SECONDS,
        (TERRITORY_GAIN_BURST_COUNT - 1) * TERRITORY_GAIN_BURST_STAGGER_SECONDS
        + TERRITORY_GAIN_BURST_LIFE_SECONDS * (1 + TERRITORY_GAIN_BURST_LIFE_JITTER),
    );
    // 每颗的生命都落在 1.1s ±15% 里。
    for (const seed of SEEDS) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const life = territoryBurstLaunch(seed, index)!.life;
            assert.ok(life >= TERRITORY_GAIN_BURST_LIFE_SECONDS * (1 - TERRITORY_GAIN_BURST_LIFE_JITTER) - 1e-9
                && life <= TERRITORY_GAIN_BURST_LIFE_SECONDS * (1 + TERRITORY_GAIN_BURST_LIFE_JITTER) + 1e-9,
                `life=${life} 越出 1.1s ±15%`);
        }
    }
});

test('喷发：出射方向**恒**在左右各 26° 的倒锥里（|vx|/vy ≤ tan 半顶角），初速 650 ±12%', () => {
    let widest = 0;
    let minPhi = 0;
    let maxPhi = 0;
    let minVx = 0;
    let maxVx = 0;
    for (const seed of SEEDS) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const launch = territoryBurstLaunch(seed, index)!;
            // phi 是需求原式 `random(-1,1) * coneHalfAngle` 的直接产物。
            const halfAngle = (TERRITORY_GAIN_BURST_HALF_ANGLE_DEG * Math.PI) / 180;
            assert.ok(Math.abs(launch.phi) <= halfAngle + 1e-12, `phi=${launch.phi} 越出半顶角`);
            // 由 phi 反算的 vx / vy 必须复现需求给的公式。
            assert.ok(Math.abs(launch.vx - launch.speed * Math.sin(launch.phi)) < 1e-9);
            assert.ok(Math.abs(launch.vy - launch.speed * Math.cos(launch.phi)) < 1e-9);
            // 倒锥的方向判据（这才是「开口朝上的倒锥」在数学上的表述）。
            const ratio = Math.abs(launch.vx) / launch.vy;
            assert.ok(ratio <= CONE_TAN + 1e-9, `|vx|/vy = ${ratio} > tan(${TERRITORY_GAIN_BURST_HALF_ANGLE_DEG}°)`);
            widest = Math.max(widest, ratio / CONE_TAN);
            // 初速抖动幅度。
            assert.ok(Math.abs(launch.speed / TERRITORY_GAIN_BURST_SPEED - 1) <= TERRITORY_GAIN_BURST_SPEED_JITTER + 1e-9,
                `初速 ${launch.speed} 越出 ±12%`);
            minPhi = Math.min(minPhi, launch.phi);
            maxPhi = Math.max(maxPhi, launch.phi);
            minVx = Math.min(minVx, launch.vx);
            maxVx = Math.max(maxVx, launch.vx);
        }
    }
    assert.ok(widest > 0.8, `几乎没有粒子贴到锥边，扇形没铺开（最宽只到锥的 ${widest.toFixed(3)}）`);
    // 左右对称：两侧都要有人，且角度的绝对值范围要覆盖半个锥。
    assert.ok(minPhi < -CONE_TAN * 0.2 && maxPhi > CONE_TAN * 0.2,
        `出射角要左右都铺开（实测 phi ∈ [${minPhi.toFixed(3)}, ${maxPhi.toFixed(3)}]）`);
    assert.ok(minVx < 0 && maxVx > 0, `vx 必须左右都有（实测 [${minVx.toFixed(1)}, ${maxVx.toFixed(1)}]）`);
    // 整体无水平偏向：分摊到**很多次喷发**上看，vx 的均值必须趋近 0（单次 12 颗是小样本，
    // 光看一次会随机偏一侧）。
    let sum = 0;
    let magnitude = 0;
    for (let seed = 0; seed < 200; seed += 1) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const launch = territoryBurstLaunch(seed, index)!;
            sum += launch.vx;
            magnitude += Math.abs(launch.vx);
        }
    }
    assert.ok(Math.abs(sum) / magnitude < 0.06,
        `200 次喷发整体存在水平偏向：Σvx / Σ|vx| = ${(sum / magnitude).toFixed(4)}`);
});

test('喷发：重力抛物线 —— 先升后降、顶点在 vy/g、落回台面后不再往下（不穿模）', () => {
    let sawApexAbove = 0;
    let maxY = 0;
    for (const seed of SEEDS) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const launch = territoryBurstLaunch(seed, index)!;
            const apexTime = launch.vy / TERRITORY_GAIN_BURST_GRAVITY;
            const apexHeight = (launch.vy * launch.vy) / (2 * TERRITORY_GAIN_BURST_GRAVITY);
            sawApexAbove = Math.max(sawApexAbove, apexHeight);
            const delay = index * TERRITORY_GAIN_BURST_STAGGER_SECONDS;

            let previous = -1;
            let peak = -1;
            for (let t = delay; t < delay + TERRITORY_GAIN_BURST_LIFE_SECONDS; t += 0.002) {
                const fx = territoryBurstParticle(seed, index, t);
                if (!fx) continue;
                // 任何时刻都不许穿进地块：y 恒 ≥ 0。
                assert.ok(fx.offsetY >= 0, `粒子穿进地块：y = ${fx.offsetY}`);
                maxY = Math.max(maxY, fx.offsetY);
                const local = t - delay;
                if (local <= apexTime) {
                    // 上升段必须单调不减。
                    assert.ok(fx.offsetY >= previous - 1e-9, `上升段掉头了：${previous} → ${fx.offsetY}`);
                }
                peak = Math.max(peak, fx.offsetY);
                previous = fx.offsetY;
                // 水平包络：抛物线在落点处的横向位移 = `vx · 2vy/g ≤ 2·tan(半顶角)·vy²/g`，
                // 换成顶点高度 apex 就是 `4·tan·apex`（顶点那一刻 x = 2·tan·apex，落点是它的两倍）。
                assert.ok(Math.abs(fx.offsetX) <= 2 * CONE_TAN * launch.vy * launch.vy / TERRITORY_GAIN_BURST_GRAVITY + 1e-6,
                    `横向越出倒锥包络：|x| = ${Math.abs(fx.offsetX)}`);
            }
            // 先升后降：峰值必须显著高于「落回台面」时的 0，且顶点确实出现在 vy/g 附近。
            assert.ok(peak > apexHeight * 0.8, `这颗几乎没升起来（峰值 ${peak.toFixed(1)}，理论 ${apexHeight.toFixed(1)}）`);
        }
    }
    assert.ok(maxY > 80, `喷得最高的那颗也太矮了（实测 ${maxY.toFixed(1)}px）`);
});

test('喷发：icon 绕自身水平轴翻面 —— scaleX 恒定、scaleY 走余弦、能看到侧立最窄且无硬切', () => {
    const sawFront = { value: false };
    const sawBack = { value: false };
    const sawSideOn = { value: false };
    for (const seed of SEEDS) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const launch = territoryBurstLaunch(seed, index)!;
            const delay = index * TERRITORY_GAIN_BURST_STAGGER_SECONDS;
            const dt = 1 / 60;
            let previousY = Number.NaN;
            let previousScaleY = Number.NaN;
            for (let t = delay; t < delay + TERRITORY_GAIN_BURST_LIFE_SECONDS; t += dt) {
                const fx = territoryBurstParticle(seed, index, t);
                if (!fx) continue;
                const local = t - delay;
                // scaleX 恒为基础缩放（翻面不许把宽度也压掉）。
                assert.equal(fx.scaleX, launch.baseScale, 'scaleX 必须恒等于基础缩放');
                // scaleY 就是余弦曲线本身（需求的实现方式）。
                const expected = launch.baseScale
                    * Math.cos(launch.flipHz * Math.PI * 2 * local + launch.phase);
                assert.ok(Math.abs(fx.scaleY - expected) < 1e-9, `scaleY 与余弦式不符：${fx.scaleY} ≠ ${expected}`);
                assert.ok(Math.abs(fx.scaleY) <= launch.baseScale + 1e-9, '|scaleY| 不许超过基础缩放');
                // 相邻帧不许硬切（正负互跳必须经过 0 附近的小值）。
                if (Number.isFinite(previousScaleY)) {
                    assert.ok(Math.abs(fx.scaleY - previousScaleY) <= launch.baseScale * 0.75,
                        `翻面出现硬切：${previousScaleY.toFixed(3)} → ${fx.scaleY.toFixed(3)}`);
                }
                // 正 / 负 / 侧立三种状态在一颗的生命里都要出现。
                if (fx.scaleY > launch.baseScale * 0.9) sawFront.value = true;
                if (fx.scaleY < -launch.baseScale * 0.9) sawBack.value = true;
                if (Math.abs(fx.scaleY) < launch.baseScale * 0.05) sawSideOn.value = true;
                previousScaleY = fx.scaleY;
                previousY = fx.offsetY;
            }
            assert.ok(Number.isFinite(previousY));
            // 翻面频率落在 2~4 次/秒。
            assert.ok(launch.flipHz >= TERRITORY_GAIN_BURST_FLIP_MIN_HZ - 1e-9
                && launch.flipHz <= TERRITORY_GAIN_BURST_FLIP_MAX_HZ + 1e-9, `flipHz=${launch.flipHz} 越界`);
        }
    }
    assert.ok(sawFront.value, '必须看到「正面」');
    assert.ok(sawBack.value, '必须看到「倒面」（scaleY 为负）');
    assert.ok(sawSideOn.value, '必须看到「侧立最窄」的中间态（余弦过零）');
});

test('喷发：各粒子翻面节奏不同步（频率与初相都随机），基础缩放落在 0.8~1.2', () => {
    const launches = Array.from({ length: TERRITORY_GAIN_BURST_COUNT }, (_, index) => territoryBurstLaunch(7, index)!);
    assert.equal(new Set(launches.map((launch) => launch.phase.toFixed(6))).size, TERRITORY_GAIN_BURST_COUNT,
        '12 颗的初始相位必须两两不同（同步翻面一眼就假）');
    assert.equal(new Set(launches.map((launch) => launch.flipHz.toFixed(6))).size, TERRITORY_GAIN_BURST_COUNT,
        '12 颗的翻面频率必须两两不同');
    for (const launch of launches) {
        assert.ok(launch.baseScale >= 1 - TERRITORY_GAIN_BURST_SCALE_JITTER - 1e-9
            && launch.baseScale <= 1 + TERRITORY_GAIN_BURST_SCALE_JITTER + 1e-9,
            `baseScale=${launch.baseScale} 越出 0.8~1.2`);
        assert.ok(launch.phase >= 0 && launch.phase <= Math.PI * 2 + 1e-9, `phase=${launch.phase} 越界`);
    }
});

test('喷发：落回台面即 0.12s 快速淡出；飞得久的那颗走生命末段 0.25s 淡出', () => {
    // ⚠️ 「生命先到期」只有 0.3% 的样本命中（要初速贴近 +12% 上限且生命贴近 -15% 下限），
    // SEEDS 那 8 个 seed 里一颗都没有 ⇒ 显式补几个已实测命中的 seed，否则那条分支等于没覆盖。
    const END_SEEDS = [...SEEDS, 24, 77, 125, 127, 141];
    let surfaceEnds = 0;
    let lifeEnds = 0;
    for (const seed of END_SEEDS) {
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const launch = territoryBurstLaunch(seed, index)!;
            const delay = index * TERRITORY_GAIN_BURST_STAGGER_SECONDS;
            const surfaceTime = (2 * launch.vy) / TERRITORY_GAIN_BURST_GRAVITY;
            const reachesSurface = surfaceTime < launch.life;
            if (reachesSurface) surfaceEnds += 1;
            else lifeEnds += 1;

            const endTime = reachesSurface ? surfaceTime + TERRITORY_GAIN_BURST_SURFACE_FADE_SECONDS : launch.life;
            // 收尾那一帧必须已经消失（可回收）。⚠️ 加 1e-6：`delay + endTime` 减回 `local` 有浮点误差。
            assert.equal(territoryBurstParticle(seed, index, delay + endTime + 1e-6), null, '收尾后这颗还在');
            // 收尾前一帧还活着、且几乎透明（不是「跳没」）。
            const last = territoryBurstParticle(seed, index, delay + endTime - 1e-4)!;
            assert.ok(last, '收尾前一瞬不该已经消失');
            assert.ok(last.opacity < 0.02, `收尾时应该几乎透明，实测 ${last.opacity}`);
            // 落回台面的那颗：淡出全程 offsetY 都钉在 0。
            if (reachesSurface) {
                const atSurface = territoryBurstParticle(seed, index, delay + surfaceTime + 0.06)!;
                assert.ok(atSurface, '落地后还在淡出窗口里');
                assert.equal(atSurface.offsetY, 0, '落地后必须停在台面上淡出，不许继续往下穿');
            } else {
                // 生命更早到期 ⇒ 淡出窗口就是末段 0.25s。
                const before = territoryBurstParticle(seed, index, delay + launch.life - TERRITORY_GAIN_BURST_FADE_SECONDS - 0.01)!;
                assert.equal(before.opacity, 1, '末段淡出开始之前应当是不透明的');
            }
        }
    }
    assert.ok(surfaceEnds > 0, '绝大多数粒子应该落回台面（否则「落回地面淡出」这条就没被覆盖）');
    assert.ok(lifeEnds > 0, '也要有「飞得久、生命先到期」的样本，否则末段淡出这条没被覆盖');
});

test('喷发：同一 (seed, index) 可复现、换 seed 换图案', () => {
    for (const [seed, index, t] of [[5, 2, 0.3], [5, 2, 0.6], [0, 0, 0.1]] as const) {
        assert.deepEqual(territoryBurstParticle(seed, index, t), territoryBurstParticle(seed, index, t),
            '纯函数：同一输入必须同一结果（否则单测验不了倒锥，池化复用也没法复现）');
        assert.deepEqual(territoryBurstLaunch(seed, index), territoryBurstLaunch(seed, index),
            '出射参数同样必须可复现');
    }
    const a = territoryBurstLaunch(3, 3)!;
    const b = territoryBurstLaunch(4, 3)!;
    assert.ok(a.vx !== b.vx || a.vy !== b.vy || a.phase !== b.phase, '换 seed 后图案必须变（每次点击不一样）');
});

test('喷发：脏输入一律返回 null（负时间 / NaN / 越界或非整数 index）', () => {
    assert.equal(territoryBurstParticle(1, 0, -1), null);
    assert.equal(territoryBurstParticle(1, 0, Number.NaN), null);
    assert.equal(territoryBurstParticle(1, 0, Number.POSITIVE_INFINITY), null);
    assert.equal(territoryBurstParticle(1, -1, 0.1), null);
    assert.equal(territoryBurstParticle(1, TERRITORY_GAIN_BURST_COUNT, 0.1), null);
    assert.equal(territoryBurstParticle(1, 1.5, 0.1), null);
    assert.equal(territoryBurstLaunch(1, -1), null);
    assert.equal(territoryBurstLaunch(1, TERRITORY_GAIN_BURST_COUNT), null);
    assert.equal(territoryBurstLaunch(1, 2.5), null);
    // seed 脏只是图案不同，不该整颗不出现（哈希内部会把它规整成 32 位整数）。
    assert.ok(territoryBurstParticle(Number.NaN, 0, 0.2));
});

// ── 喷发粒子组：离线转译真代码 + cc 打桩（结构与逐帧落点） ──────────────

class FakeNode {
    name: string;
    layer = 0;
    active = true;
    parent: FakeNode | null = null;
    readonly children: FakeNode[] = [];
    readonly components: FakeComponent[] = [];
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };

    constructor(name = '') {
        this.name = name;
    }

    setParent(parent: FakeNode): void {
        if (this.parent) {
            const index = this.parent.children.indexOf(this);
            if (index >= 0) this.parent.children.splice(index, 1);
        }
        this.parent = parent;
        parent.children.push(this);
    }

    setSiblingIndex(index: number): void {
        if (!this.parent) return;
        const from = this.parent.children.indexOf(this);
        if (from < 0) return;
        this.parent.children.splice(from, 1);
        this.parent.children.splice(Math.max(0, Math.min(index, this.parent.children.length)), 0, this);
    }

    addComponent(type: new () => FakeComponent): FakeComponent {
        const component = new type();
        component.node = this;
        this.components.push(component);
        return component;
    }

    setPosition(x: number, y: number, z = 0): void {
        this.position = { x, y, z };
    }

    setScale(x: number, y: number, z = 1): void {
        this.scale = { x, y, z };
    }

    componentOf<T>(type: new () => T): T | undefined {
        return this.components.find((entry) => entry instanceof type) as T | undefined;
    }
}

class FakeComponent {
    node!: FakeNode;
}

class FakeUITransform extends FakeComponent {
    size = { width: 0, height: 0 };
    setContentSize(width: number, height: number): void {
        this.size = { width, height };
    }
}

class FakeSprite extends FakeComponent {
    static SizeMode = { CUSTOM: 0, RAW: 1, TRIMMED: 2 };
    trim = true;
    sizeMode = 0;
    spriteFrame: unknown = null;
}

class FakeUIOpacity extends FakeComponent {
    opacity = 255;
}

interface IBurstLike {
    node: FakeNode;
    play(originX: number, originY: number, seed: number, frames: readonly unknown[]): void;
    step(dt: number): boolean;
    stop(): void;
}

let burstModule: Record<string, unknown> | null = null;

/** 把 `TerritoryGainBurst.ts` 转译后塞进沙箱跑（真代码，只有 `cc` 是桩）；单次求值后缓存。 */
function loadBurstModule(): Record<string, unknown> {
    if (burstModule) return burstModule;
    const code = ts.transpileModule(
        read('assets/script/app/territory/view/TerritoryGainBurst.ts'),
        { compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        } },
    ).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') {
                return {
                    Node: FakeNode,
                    Sprite: FakeSprite,
                    UITransform: FakeUITransform,
                    UIOpacity: FakeUIOpacity,
                };
            }
            // 曲线用**真模块**（不是抄一份常量）：模型改了这里立刻跟着变。
            if (id.endsWith('/TerritoryResourceGain')) {
                return {
                    TERRITORY_GAIN_BURST_COUNT,
                    TERRITORY_GAIN_BURST_TOTAL_SECONDS,
                    territoryBurstParticle,
                };
            }
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    burstModule = moduleExports;
    return moduleExports;
}

function loadBurstClass(): new (layer: FakeNode) => IBurstLike {
    return loadBurstModule().TerritoryGainBurst as new (layer: FakeNode) => IBurstLike;
}

const SILVER = { name: 'silver' };
const STAMINA = { name: 'stamina' };

test('粒子组：一个原点容器 + COUNT 颗粒子（每颗独立 UIOpacity），容器落在喷发原点', () => {
    const module = loadBurstModule();
    const TerritoryGainBurst = loadBurstClass();
    const iconSize = module.TERRITORY_GAIN_BURST_ICON_SIZE as number;
    const layer = new FakeNode('GainLayer');
    const burst = new TerritoryGainBurst(layer);

    assert.equal(iconSize, 64, '需求口径：icon 边长默认 64px');
    assert.equal(layer.children.length, 1, '一次喷发 = 一个容器');
    assert.equal(burst.node.name, module.TERRITORY_GAIN_BURST_NODE);
    assert.equal(burst.node.children.length, TERRITORY_GAIN_BURST_COUNT,
        '粒子数必须等于模型常量（需求：12 颗）');
    for (const particle of burst.node.children) {
        assert.ok(particle.componentOf(FakeSprite), '每颗粒子要能换图（Sprite）');
        assert.ok(particle.componentOf(FakeUIOpacity), '每颗粒子要能**各自**淡出（一颗一个 UIOpacity）');
        assert.equal(particle.active, false, '建出来先收起（由 play 决定谁出场）');
        assert.equal(particle.componentOf(FakeUITransform)?.size.width, iconSize);
        assert.equal(particle.componentOf(FakeUITransform)?.size.height, iconSize);
    }
    assert.equal(burst.node.active, false, '容器建出来是收起的');

    burst.play(120, -30, 7, [SILVER, STAMINA]);
    assert.deepEqual(burst.node.position, { x: 120, y: -30, z: 0 }, '容器必须落在喷发原点（格心）');
    assert.equal(burst.node.active, true);
    // 图标按粒子序轮流取：同时给银币 + 体力时两种图各喷一半。
    assert.equal(burst.node.children[0].componentOf(FakeSprite)?.spriteFrame, SILVER);
    assert.equal(burst.node.children[1].componentOf(FakeSprite)?.spriteFrame, STAMINA);
    assert.equal(burst.node.children[2].componentOf(FakeSprite)?.spriteFrame, SILVER);
});

test('粒子组：逐帧写节点 = 模型的 scaleX / scaleY，落点不穿模，错峰可见，放完提前收起', () => {
    const TerritoryGainBurst = loadBurstClass();
    const burst = new TerritoryGainBurst(new FakeNode('GainLayer'));
    const seed = 21;
    burst.play(0, 0, seed, [SILVER]);

    const dt = 1 / 60;
    let frames = 0;
    let elapsed = 0;
    let sawStagger = false;
    let sawFlipSideOn = false;
    let sawNegativeScaleY = false;
    const baseScaleOf: number[] = [];
    while (burst.step(dt)) {
        elapsed += dt;
        frames += 1;
        assert.ok(frames < 200, '喷发不该超过 3 秒还在跑');
        const visible = burst.node.children.filter((child) => child.active);
        if (visible.length > 0 && visible.length < TERRITORY_GAIN_BURST_COUNT) sawStagger = true;
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            const child = burst.node.children[index];
            if (!child.active) continue;
            const fx = territoryBurstParticle(seed, index, elapsed);
            assert.ok(fx, '视图点亮的粒子必须在模型里也是活的');
            // 视图不许自己算曲线：位置与两个缩放都要逐位等于模型。
            assert.ok(Math.abs(child.position.x - fx.offsetX) < 1e-9, '横向位移必须来自模型');
            assert.ok(Math.abs(child.position.y - fx.offsetY) < 1e-9, '纵向位移必须来自模型');
            assert.ok(child.position.y >= 0, '粒子只能停在台面之上（不穿模）');
            assert.equal(child.scale.x, fx.scaleX, 'scaleX 必须逐位等于模型（翻面不许压宽度）');
            assert.equal(child.scale.y, fx.scaleY, 'scaleY 必须逐位等于模型（翻面走余弦）');
            assert.notEqual(child.scale.z, 0);
            // 同一颗粒子逐帧的 scaleX 必须**一个值都不变**（翻面只压 y）。
            if (baseScaleOf[index] === undefined) baseScaleOf[index] = child.scale.x;
            else assert.equal(child.scale.x, baseScaleOf[index], `第 ${index} 颗的 scaleX 逐帧变了（翻面不该压宽度）`);
            if (Math.abs(child.scale.y) < child.scale.x * 0.05) sawFlipSideOn = true;
            if (child.scale.y < 0) sawNegativeScaleY = true;
            // 不存在平面自转：旋转角恒为 0（节点桩没有 angle 字段 ⇒ 视图不该去写它）。
            assert.equal((child as unknown as { angle?: number }).angle ?? 0, 0, '不许叠平面自转');
        }
    }
    assert.ok(frames > 0, '至少推进过一帧');
    assert.ok(sawStagger, '需要出现「只亮了一部分粒子」的中间帧 —— 那颗就是还在错峰等待的');
    assert.ok(sawFlipSideOn, '必须出现「侧立最窄」的帧（scaleY 过零）');
    assert.ok(sawNegativeScaleY, '必须出现翻到背面的帧（scaleY 为负）');
    assert.equal(burst.node.active, false, '放完要整喷收起（回收只改 active，不销毁节点）');
});

test('粒子组：池化复用 —— 再喷一次要能把上一喷收起的粒子重新点亮，且换成新图案', () => {
    const TerritoryGainBurst = loadBurstClass();
    const burst = new TerritoryGainBurst(new FakeNode('GainLayer'));
    burst.play(0, 0, 1, [SILVER]);
    while (burst.step(1 / 60)) { /* 放完 */ }
    assert.equal(burst.node.children.every((child) => !child.active), true, '放完每颗粒子都要收起');

    burst.play(50, 60, 2, [STAMINA]);
    assert.deepEqual(burst.node.position, { x: 50, y: 60, z: 0 }, '复用时原点必须重设');
    assert.ok(burst.node.children.some((child) => child.active), '复用后粒子要重新出场');
    assert.equal(burst.node.children[0].componentOf(FakeSprite)?.spriteFrame, STAMINA,
        '复用后贴图必须换成这一次的（12 颗全是同一张）');
    assert.equal(burst.node.children[TERRITORY_GAIN_BURST_COUNT - 1].componentOf(FakeSprite)?.spriteFrame, STAMINA);

    // 换 seed 后轨迹必须不一样：跑到 12 颗全部出场（> 0.275s）再比落点。
    const sample = (): number[] => {
        for (let i = 0; i < 24; i += 1) burst.step(1 / 60);
        return burst.node.children.map((child) => Number(child.position.x.toFixed(4)));
    };
    const secondPattern = sample();
    burst.play(0, 0, 1, [SILVER]);
    const firstPattern = sample();
    assert.notDeepEqual(secondPattern, firstPattern, '换了 seed 图案就该不一样');
});

test('粒子组：没有可用图标时粒子是空的（不闪不报错），与「缺图仍照常升」同一口径', () => {
    const TerritoryGainBurst = loadBurstClass();
    const burst = new TerritoryGainBurst(new FakeNode('GainLayer'));
    burst.play(0, 0, 5, []);
    assert.equal(burst.node.active, true, '图缺失不该把整喷关掉（照常走时间线）');
    assert.equal(burst.node.children.every((child) => child.componentOf(FakeSprite)?.spriteFrame === null), true);
});

// ── MapView 接线：喷发原点 = 点击地块中心点，读数在其上方 40px（row17 原话） ──

test('接线：喷发原点取「点击地块的中心点」，图标 + 数字 ui 在原点上方 40px、且喷发只喷一次', () => {
    const src = stripComments(read('assets/script/app/territory/view/TerritoryMapView.ts'));
    // 落点换算：原点 = 格心（布局点 + HEX_GRID_CONTENT_LIFT），读数 = 原点 + 40。
    assert.match(src, /const originX = hex\.position\.x;/);
    assert.match(src, /const originY = hex\.position\.y \+ HEX_GRID_CONTENT_LIFT;/);
    assert.match(src, /const baseY = originY \+ TERRITORY_GAIN_START_LIFT_PX;/);
    assert.doesNotMatch(src, /hex\.position\.y \+ HEX_GRID_CONTENT_LIFT \+ TERRITORY_GAIN_START_LIFT_PX/,
        '别把「原点上方的 40px」写成「格心上一段固定高度」—— 两处相加必须是 origin + 40，不是格心 + 70');
    // 需求原话就是 40px；这个值同时是「栈间距」，两条飘字之间的缝也正好一格。
    assert.equal(TERRITORY_GAIN_START_LIFT_PX, 40, '需求原话：「上方间隔 40px」');
    assert.equal(TERRITORY_GAIN_STACK_GAP_PX, 40);

    // 喷发只有**一次**（多条奖励轮流取图），而且排在飘字之前 —— 粒子先出来，读数随后升。
    const burstAt = src.indexOf('this.playGainBurst(originX, originY, entries)');
    const loopAt = src.indexOf('entries.forEach((entry, index)');
    assert.ok(burstAt > 0, 'playResourceGain 必须真的播喷发');
    assert.ok(loopAt > burstAt, '喷发要排在飘字之前（且只有一次，不是每条奖励各喷一次）');

    // 粒子层必须是飘字层的**第一个**子节点：子节点顺序 = 渲染顺序，粒子要画在读数之下。
    assert.match(src, /root\.setSiblingIndex\(0\)/, '喷发层要坐稳 GainLayer 的第一个子节点');
    assert.match(src, /new Node\(TERRITORY_GAIN_BURST_NODE\)/);

    // 逐帧推进 + 换章收尾：喷发与飘字各走各的时间线，但一起收。
    assert.match(src, /this\.stepGains\(dt\);\s*this\.stepBursts\(dt\);/);
    assert.match(src, /burst\.stop\(\);/);
});

test('接线：喷发粒子不用 prefab（贴图由页面注入），飘字 prefab 仍是 3 个节点', () => {
    // 喷发粒子只有「一张可换的图 + 位置/缩放/透明度」⇒ 现建节点（与 createHex 同一口径），
    // 与飘字 prefab「帧由代码注入」的理由一致；这条守卫防止有人回头又把它塞进 prefab。
    const src = stripComments(read('assets/script/app/territory/view/TerritoryGainBurst.ts'));
    assert.match(src, /new Node\(TERRITORY_GAIN_BURST_NODE\)/);
    assert.match(src, /sprite\.spriteFrame = frame/, '图必须由 play() 注入');
    assert.doesNotMatch(src, /Prefab|instantiate/, '粒子组不该去 instantiate 任何 prefab');
    assert.doesNotMatch(src, /tween/i, '池化节点上不许挂 tween（规则 106 / 247），逐帧 step 由 MapView 推');

    const page = stripComments(read('assets/script/app/main/MainTerritoryMap.ts'));
    assert.match(page, /setGainIcons\(/, '页面只注入一次图标表，喷发与飘字共用');
});

