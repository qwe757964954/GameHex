import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import {
    TERRITORY_CHEST_SPECS,
    territoryChestFlyArriveAt,
} from '../assets/script/app/territory/model/TerritoryChestAnimation';
import * as chestAnimationModule from '../assets/script/app/territory/model/TerritoryChestAnimation';
import {
    isTerritoryHeroRewardResId,
    collectTerritoryHeroRewards,
} from '../assets/script/app/territory/model/TerritoryHeroReward';
import * as heroRewardModule from '../assets/script/app/territory/model/TerritoryHeroReward';
import {
    TERRITORY_SILVER_RES_ID,
    TERRITORY_STAMINA_RES_ID,
} from '../assets/script/app/territory/model/TerritoryResourceGain';
import { loadTerritoryMapViewClass } from './helpers/territory-map-view-sandbox';

/**
 * 2026-11-19 用户口径：
 * > 「这个固定格宝箱打开奖励粒子往上飞的动画改成和随机格往卡牌 icon 飞的动画一致，
 * >   都是飞向底部菜单栏卡牌 icon，当对应的卡牌可升级时，也会触发进度动画」
 *
 * 截图红圈 = `TerritoryChestView` 的 `Fly/FlySlot`（奖励图标 + `+2` 数字）飞到屏幕顶部中央。
 * 根因不是曲线：页面侧旧的 `wireRewardCatch` / `setRewardCatchWorldPoint` 分流在 SVN 合并后
 * 整段缺失（且 `territory-hero-reward` 用例明确禁止把旧 ResBar 链路接回来），
 * 于是全部回落到构造时的 `setCatchPoint(0, height/2 - 46)`。
 *
 * 修法（与随机格**同一条**链路，不新造平行状态机）：
 *   页面 `runChestOpening` → mountRewardFxLayer(MainRoot 顶层) → setHeroRewardTargetWorld
 *   → setHeroRewardLandedHandler(按钮抖动) → armChestHeroFlight
 *   → `chest_seq_*` 走到 `spec.flyStart` 时由 `setFlyStartHook` 回调 `playHeroRewardFlight`
 *   → `TerritoryChestView.applyFly` / `fireLandings` 不再画非钱包类那一枚。
 *
 * 本文件分三层：
 *   ① 判据真值（非钱包类改道、钱包类留守）；
 *   ② VM 行为（起飞钩子只发一次、Fly 槽位 / 落地通知真的跳过、待飞批次只起播一次）；
 *   ③ 源码守卫（接线顺序、进度徽标仍在所有分流之前、旧 ResBar 链路不许复活）。
 */

const PAGE = 'assets/script/app/main/MainTerritoryMap.ts';
const VIEW = 'assets/script/app/territory/view/TerritoryMapView.ts';
const CHEST = 'assets/script/app/territory/view/TerritoryChestView.ts';

const src = (path: string): string => readFileSync(path, 'utf8');
/** 去注释只留真代码 —— 防止「注释里写了就算接线」的假绿。 */
const body = (path: string): string => src(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** 按大括号配对切方法体，不用固定字符窗口。 */
function methodBody(code: string, signature: string): string {
    const at = code.indexOf(signature);
    assert.ok(at >= 0, `找不到方法：${signature}`);
    const open = code.indexOf('{', at);
    assert.ok(open > at, `${signature} 后面没有方法体`);
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
        if (code[i] === '{') depth += 1;
        else if (code[i] === '}') {
            depth -= 1;
            if (depth === 0) return code.slice(at, i + 1);
        }
    }
    throw new Error(`${signature} 方法体没有闭合`);
}

// ============================================================
// ① 判据：谁改道、谁留守
// ============================================================

test('★ 固定格与随机格共用「非钱包类」判据：碎片 / 经验 / 道具改道，银币体力留守', () => {
    assert.equal(TERRITORY_SILVER_RES_ID, 7);
    assert.equal(TERRITORY_STAMINA_RES_ID, 9);
    for (const resId of [18001, 16001, 10010, 19001, 30401]) {
        assert.equal(isTerritoryHeroRewardResId(resId), true, `resId ${resId} 该飞向卡牌 icon`);
    }
    for (const resId of [TERRITORY_SILVER_RES_ID, TERRITORY_STAMINA_RES_ID]) {
        assert.equal(isTerritoryHeroRewardResId(resId), false, `resId ${resId} 仍归资源栏`);
    }
    for (const resId of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, 'abc']) {
        assert.equal(isTerritoryHeroRewardResId(resId), false, `脏值 ${String(resId)} 不许改道`);
    }
});

test('★ 一批混合奖励只挑非钱包类，且丢掉脏值 / 非正数', () => {
    const picked = collectTerritoryHeroRewards([
        { resId: 7, amount: 100 },
        { resId: 18001, amount: 2 },
        { resId: 9, amount: 3 },
        { resId: 16001, amount: 0 },
        { resId: 10010, amount: 5 },
    ]);
    assert.deepEqual(picked.map((item) => item.resId), [18001, 10010]);
});

test('★ 三档起飞时刻都在停播之前，且逐档更晚（钩子不能落到表演收尾之后）', () => {
    const tiers = ['weak', 'medium', 'strong'] as const;
    let previous = -1;
    for (const tier of tiers) {
        const spec = TERRITORY_CHEST_SPECS[tier];
        assert.ok(spec.flyStart > previous, `${tier} 起飞时刻必须比上一档晚`);
        assert.ok(spec.flyStart > 0);
        assert.ok(territoryChestFlyArriveAt(spec, 0) > spec.flyStart);
        previous = spec.flyStart;
    }
});

// ============================================================
// ② VM：开箱表演的起飞钩子 / Fly 槽位 / 落地通知
// ============================================================

/**
 * 把 `TerritoryChestView.ts` 装进一个只供本文件用的最小 VM 沙箱。
 *
 * 不跑构造函数（prefab 树 / Graphics 全在 prefab 里，夹具搭不出也不该搭）：
 * 用 `Object.create(prototype)` 只填被测方法真正读到的字段，其余方法在实例上覆盖掉。
 * `model/TerritoryChestAnimation` 与 `model/TerritoryHeroReward` 直接给**真模块** ——
 * 抄一份判据就变成「两边各改一半还能一起绿」。
 */
function loadChestViewClass(): any {
    const code = ts.transpileModule(src(CHEST), { compilerOptions: {
        experimentalDecorators: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    } }).outputText;
    const moduleExports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports: moduleExports,
        require: (id: string) => {
            if (id === 'cc') return {
                Color: class { constructor(public r = 0, public g = 0, public b = 0, public a = 255) {} },
                Graphics: class {},
                instantiate: () => ({}),
                Label: class {},
                Node: class {},
                Sprite: class {},
                SpriteFrame: class {},
                UIOpacity: class {},
                UITransform: class {},
                Vec3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
            };
            if (id === '../model/TerritoryChestAnimation') return chestAnimationModule;
            if (id === '../model/TerritoryHeroReward') return heroRewardModule;
            // 建筑归一宽度只影响 `CHEST_VISIBLE_WIDTH` 常量，本夹具不画箱体。
            if (id === './TerritoryStationView') return { BUILDING_VISIBLE_WIDTH: 84 };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return moduleExports.TerritoryChestView as any;
}

const ChestViewClass = loadChestViewClass();

function makeChestView(): any {
    const view = Object.create(ChestViewClass.prototype);
    view.spec = TERRITORY_CHEST_SPECS.weak;
    view.rewards = [];
    view.flyCount = 0;
    view.elapsed = 0;
    view.flyStartFired = false;
    view.flyStartHook = null;
    view.onLanded = null;
    view.landedResIds = new Set<number>();
    view.catchPoints = new Map<number, { x: number; y: number }>();
    view.catchX = 0;
    view.catchY = 500;
    view.stopped = 0;
    view.applied = [];
    view.stop = () => { view.stopped += 1; view.elapsed = -1; };
    view.apply = (t: number) => { view.applied.push(t); };
    return view;
}

test('★ 起飞钩子在 spec.flyStart 那一帧才发，掉帧跨过也只发一次', () => {
    const view = makeChestView();
    const spec = view.spec;
    let fired = 0;
    view.flyStartHook = () => { fired += 1; };

    view.step(spec.flyStart - 0.02);
    assert.equal(fired, 0, '箱子还没起飞就放图标 = 旧格坐标 + 抢在开盖前面');
    view.step(0.04);
    assert.equal(fired, 1, '跨过 flyStart 的那一帧必须补发，不能漏');
    view.step(0.10);
    assert.equal(fired, 1, '本场只发一次，别把按钮抖 30 次');
    assert.equal(view.stopped, 0, '钩子不该影响停播时刻');
});

test('★ 打断 / 重开都会复位钩子：停掉再播还能再发一次', () => {
    const view = makeChestView();
    let fired = 0;
    view.flyStartHook = () => { fired += 1; };
    view.step(view.spec.flyStart + 0.01);
    assert.equal(fired, 1);
    // `play()` 里除复位外还会碰 prefab 节点 / 应用首帧，夹具只把这几处挡掉。
    view.applyChestFrames = () => {};
    view.node = { active: false };
    view.chest = { active: true };
    ChestViewClass.prototype.play.call(view, 'weak', { x: 0, y: 0, z: 0 }, [], undefined);
    assert.equal(view.flyStartFired, false, 'play() 必须复位，否则第二场整段不飞');
    ChestViewClass.prototype.step.call(view, 0.01);
    assert.equal(fired, 1, '复位后的那一帧还没到 flyStart');
    ChestViewClass.prototype.step.call(view, view.spec.flyStart);
    assert.equal(fired, 2, '第二场到点必须还能发一次');
});

function fakeSlot(): any {
    return {
        node: { active: true, position: null, scale: null, setPosition(x: number, y: number) { this.position = { x, y }; }, setScale(x: number) { this.scale = x; } },
        sprite: { spriteFrame: null },
        opacity: { opacity: 255 },
        transform: {},
        label: { string: '' },
    };
}

test('★ Fly 层只画钱包类：非钱包类槽位被收起，不许一上一下飞两遍', () => {
    const view = makeChestView();
    const spec = view.spec;
    view.rewards = [
        { resId: 18001, amount: 2, frame: null },
        { resId: TERRITORY_SILVER_RES_ID, amount: 30, frame: null },
    ];
    view.flyCount = 2;
    view.flySlots = [fakeSlot(), fakeSlot()];
    view.origin = { x: 120, y: -80, z: 0 };
    view.cameraFocus = 1;
    view.tailFade = 1;
    view.ensureFlySlots = () => { /* 池子已经摆好 */ };
    // weak: flyStart 0.80 / flySeconds 0.80 / 2 枚错峰 0.06 ⇒ t=1.0 两枚都在飞。
    view.applyFly(spec, 1.0);
    assert.equal(view.flySlots[0].node.active, false, '卡牌碎片该让给顶层卡牌飞行链路');
    assert.equal(view.flySlots[1].node.active, true, '银币仍走原来的资源栏落点');
    assert.ok(view.flySlots[1].node.position, '留守那一枚必须照常被逐帧写位置');
    assert.equal(view.flySlots[0].node.position, null, '被让位的一枚不许还留在旧落点上');
});

test('★ 落地通知同样跳过改道的资源，钱包类仍只通知一次', () => {
    const view = makeChestView();
    const spec = view.spec;
    const landed: { resId: number; amount: number }[] = [];
    view.onLanded = (resId: number, amount: number) => { landed.push({ resId, amount }); };
    view.rewards = [
        { resId: 18001, amount: 2, frame: null },
        { resId: TERRITORY_SILVER_RES_ID, amount: 30, frame: null },
    ];
    view.flyCount = 2;
    view.flySlots = [];
    const arrive = territoryChestFlyArriveAt(spec, 1, 2);
    view.fireLandings(arrive + 0.01);
    view.fireLandings(arrive + 0.02);
    assert.deepEqual(landed, [{ resId: TERRITORY_SILVER_RES_ID, amount: 30 }]);
    assert.deepEqual(Array.from(view.landedResIds), [TERRITORY_SILVER_RES_ID],
        '改道资源不该占用「本场已通知」名额');
});

// ============================================================
// ② VM：地图视图的「待飞批次」只起播一次
// ============================================================

const MapViewClass = loadTerritoryMapViewClass();

function makeMapView(): any {
    const view = Object.create(MapViewClass.prototype);
    view.chestHeroFlight = null;
    view.heroRewardTarget = { x: 10, y: -20 };
    view.heroRewardLandedHandler = null;
    view.activeHeroFlights = [];
    view.heroFlightPool = [];
    view.calls = [];
    view.playHeroRewardFlight = (cellId: number, entries: unknown) => {
        view.calls.push({ cellId, entries });
        return true;
    };
    return view;
}

test('★ 固定格登记后由起飞钩子起播，起点/终点/图标全走随机格那条 playHeroRewardFlight', () => {
    const view = makeMapView();
    const entries = [{ frame: null }, { frame: null }];
    view.armChestHeroFlight(327, entries);
    assert.equal(view.chestHeroFlight.cellId, 327);
    view.launchChestHeroFlight();
    assert.deepEqual(view.calls.map((call: any) => call.cellId), [327]);
    assert.equal(view.calls[0].entries, entries, '同一批图标，不重新加载 / 不过滤第二遍');
    assert.equal(view.chestHeroFlight, null, '起播后必须清掉，下一场不许重播这一束');
    view.launchChestHeroFlight();
    assert.equal(view.calls.length, 1, '钩子被重复触发也不许飞两遍');
});

test('★ 空批次 / 非法格子 / 换章复位都会清掉待飞，不给下一场留残影', () => {
    const view = makeMapView();
    view.armChestHeroFlight(327, [{ frame: null }]);
    view.armChestHeroFlight(327, []);
    assert.equal(view.chestHeroFlight, null);
    view.armChestHeroFlight(-1, [{ frame: null }]);
    assert.equal(view.chestHeroFlight, null);
    view.armChestHeroFlight(327, [{ frame: null }]);
    view.resetHeroFlights();
    assert.equal(view.chestHeroFlight, null, '换章 / 顶层宿主换层时一并作废');
    view.launchChestHeroFlight();
    assert.equal(view.calls.length, 0);
});

// ============================================================
// ③ 源码守卫：接线顺序与边界
// ============================================================

test('★ 页面：固定格按「挂宿主 → 登记终点 → 落地抖动 → 登记待飞 → 开箱」接线', () => {
    const code = body(PAGE);
    const fn = methodBody(code, 'private async runChestOpening(');
    const collect = fn.indexOf('const heroEntries = entries.filter(');
    const mount = fn.indexOf('this.mapView.mountRewardFxLayer(');
    const target = fn.indexOf('this.mapView.setHeroRewardTargetWorld(');
    const landed = fn.indexOf('this.mapView.setHeroRewardLandedHandler(');
    const arm = fn.indexOf('this.mapView.armChestHeroFlight(');
    const play = fn.indexOf('this.mapView.playChestOpen(');
    assert.ok(collect >= 0 && mount > collect && target > mount && landed > target && arm > landed && play > arm,
        '顺序错了就会用旧宿主坐标起播 / 在飞行之前就开箱');
    assert.match(fn, /isTerritoryHeroRewardResId\(entry\.resId\)/, '判据与随机格同一条真源');
    assert.match(fn, /this\.mapView\.mountRewardFxLayer\(this\.rewardFxRoot\(\)\);/,
        '飞行图标必须画在 MainRoot 顶层，否则飞到底栏被盖住');
    assert.match(fn, /this\.mapView\.setHeroRewardTargetWorld\(this\.heroTabWorldPositionOf\(heroButton\)\)/);
    assert.match(fn, /heroButton\?\.isValid\) heroButton\.playHitFeedback\(\)/, '落地要抖卡牌 icon');
    assert.match(fn, /this\.mapView\.armChestHeroFlight\(cellId, heroEntries\);/);
    assert.match(fn, /if \(this\.mapView\.playChestOpen\(cellId, tier, entries, handOff\)\) return;\s*handOff\(\);/,
        '开箱表演 / 交棒链路一个字都不能改');
    assert.doesNotMatch(fn, /setRewardCatchWorldPoint|slotWorldPositionOf|bar\.playGainFeedback/,
        '旧的 ResBar 落点分流已被明确下线，不许借这次改动复活');
});

test('★ 进度徽标：固定格开箱也走 presentRewards 的统一触发点（所有分流之前）', () => {
    const code = body(PAGE);
    const trigger = code.indexOf('void this.playHeroBadges(rewards);');
    assert.ok(trigger >= 0, '「卡牌可升级 ⇒ 进度动画」的检测必须还在');
    const presentRewards = code.indexOf('private presentRewards(');
    const chestBranch = code.indexOf('this.presentChestRewards(rewards, cellId, tier)');
    assert.ok(presentRewards < trigger && trigger < chestBranch,
        '触发点必须在开箱分支之前：固定格 / 随机格 / 银币宝箱 / 挂机弹窗都要覆盖');
});

test('★ 视图：起飞钩子只在建开箱表演时注册一次，失败 / 打断都清待飞', () => {
    const code = body(VIEW);
    assert.match(methodBody(code, 'private ensureOverlayHost()'),
        /this\.chestView\?\.setFlyStartHook\?\.\(\(\) => this\.launchChestHeroFlight\(\)\);/,
        '空壳夹具没有这个方法 ⇒ 必须可选调用，否则 VM 用例整片红');
    assert.match(methodBody(code, 'armChestHeroFlight('),
        /entries\.length > 0/, '空批次不许留待飞');
    assert.match(methodBody(code, 'private launchChestHeroFlight()'),
        /this\.playHeroRewardFlight\(pending\.cellId, pending\.entries\);/,
        '固定格与随机格必须落在同一个飞行入口');
    const play = methodBody(code, 'playChestOpen(');
    assert.match(play, /this\.chestHeroFlight = null;/, '起播失败要作废');
    assert.match(methodBody(code, 'stopChestPlay()'),
        /this\.chestHeroFlight = null;/, '打断也要作废');
    assert.match(methodBody(code, 'private resetHeroFlights()'),
        /this\.chestHeroFlight = null;/, '换章也要作废');
});

test('★ 开箱视图：起飞钩子由 spec.flyStart 驱动，本场只发一次且不晚于停播判据', () => {
    const code = body(CHEST);
    const step = methodBody(code, 'step(dt: number): void');
    const hookAt = step.indexOf('this.flyStartHook?.()');
    const stopAt = step.indexOf('territoryChestEndSeconds(spec, this.flyCount)');
    assert.ok(hookAt >= 0 && stopAt > hookAt, '钩子必须排在停播判断之前');
    assert.match(step, /this\.elapsed >= spec\.flyStart/, '起飞时刻取参数表，不许抄数字');
    assert.match(step, /if \(!this\.flyStartFired/, '本场只发一次');
    assert.match(methodBody(code, '\n    play('), /this\.flyStartFired = false;/, '重开要复位');
    assert.match(methodBody(code, '\n    stop()'), /this\.flyStartFired = false;/, '打断也要复位');
});

test('★ 开箱视图：Fly 槽位与落地通知都按同一条判据让位，钱包类不受影响', () => {
    const code = body(CHEST);
    const applyFly = methodBody(code, 'private applyFly(');
    assert.match(applyFly, /isTerritoryHeroRewardResId\(this\.rewards\[index % this\.rewards\.length\]\?\.resId\)/,
        'applyFly 必须逐枚按 resId 判，不能整层一刀切（银币体力还要飞）');
    assert.match(methodBody(code, 'private fireLandings('),
        /if \(isTerritoryHeroRewardResId\(resId\)\) continue;/,
        '改道资源不该再触发资源栏那一格的落地反馈');
    assert.match(applyFly, /const count = this\.flyCount/, '粒子数真源不许被改动');
    assert.match(applyFly, /territoryChestFlyFx\(spec, index, t, count\)/, '曲线真源不许被改动');
});
