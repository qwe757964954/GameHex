import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
    CHEST_DROP_ARC_RATIO,
    CHEST_DROP_CONTROL_X_RATIO,
    CHEST_DROP_FLIGHT_SECONDS,
    CHEST_DROP_HIT_SECONDS,
    CHEST_DROP_ICON_SIZE,
    CHEST_DROP_TRAIL_ALPHA,
    CHEST_DROP_TRAIL_GAP,
    CHEST_DROP_TRAIL_LENGTH,
    CHEST_DROP_TRAIL_ROOT_HALF_WIDTH,
    CHEST_DROP_TRAIL_SEGMENTS,
    chestDropFlightFrame,
    chestDropHitScale,
    chestDropTrailQuads,
} from '../assets/script/app/main/ChestDropFlight';
import {
    BUILDING_SHAKE_STRETCH,
    SPAWN_SHAKE_TOTAL_SECONDS,
    spawnShakeScaleX,
    spawnShakeScaleY,
} from '../assets/script/core/hex/ShakePresentation';
import * as chestTypes from '../assets/script/app/main/ChestTypes';
import { CHEST_EVENTS } from '../assets/script/app/main/ChestEvents';
import { readSource } from './helpers/source-text';

/**
 * 异步 PVP 战斗结束「战斗掉落宝箱获得动画」（2026-11-22，§3.54）。
 *
 * 用户原话：*「对应的宝箱icon带着三角形拖尾飞到 宝箱icon的位置，弧线的飞行轨迹；
 * 宝箱飞入后，icon抖动（类似卡牌icon），激活底部的绿点」*。
 *
 * 三组断言：① 纯时间轴（弧线 / 拖尾 / 抖动）；② 源码守卫（接线、层级、不建 tween）；
 * ③ 行为对拍（VM 沙箱里的 MainPage：绿点压住 → 落地激活 → 抖动）。
 */

const ORIGIN = { x: 0, y: 0 };
const TARGET = { x: 400, y: -600 };

// ── ① 纯时间轴 ──────────────────────────────────────────────

test('掉落飞行：常量口径（弧线 / 拖尾 / 抖动时长）', () => {
    assert.equal(CHEST_DROP_FLIGHT_SECONDS, 0.9, '跨屏弧线比英雄飞行 0.62s 长');
    assert.equal(CHEST_DROP_ARC_RATIO, 0.55);
    assert.equal(CHEST_DROP_CONTROL_X_RATIO, 0.3, '与 TerritoryHeroFlight 同款控制点');
    assert.equal(CHEST_DROP_TRAIL_SEGMENTS, 6);
    assert.ok(CHEST_DROP_TRAIL_LENGTH > 0 && CHEST_DROP_TRAIL_ROOT_HALF_WIDTH > 0);
    assert.ok(CHEST_DROP_TRAIL_GAP > 0 && CHEST_DROP_TRAIL_ALPHA > 0 && CHEST_DROP_TRAIL_ALPHA <= 1);
    assert.ok(CHEST_DROP_ICON_SIZE > 0 && CHEST_DROP_ICON_SIZE < 100, '不能比 HUD 上那颗 100×83 还大');
    assert.equal(CHEST_DROP_HIT_SECONDS, SPAWN_SHAKE_TOTAL_SECONDS, '抖动必须与卡牌 icon 同一条曲线');
});

test('掉落飞行：非数 / 负 / 超时一律 null，落点按显式到达时刻判定', () => {
    assert.equal(chestDropFlightFrame(-0.01, ORIGIN, TARGET), null);
    assert.equal(chestDropFlightFrame(NaN, ORIGIN, TARGET), null);
    assert.equal(chestDropFlightFrame(Infinity, ORIGIN, TARGET), null);
    assert.equal(chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS, ORIGIN, TARGET), null);
    assert.ok(chestDropFlightFrame(0, ORIGIN, TARGET), '0 秒那一帧必须画得出来');
    assert.ok(chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS - 1e-6, ORIGIN, TARGET));
    assert.equal(chestDropFlightFrame(0, { x: NaN, y: 0 }, TARGET), null, '坐标脏不许出 NaN 节点');
});

test('掉落飞行：从格心起飞、落到宝箱 icon，且确实是一条上抛弧线而非直线', () => {
    const start = chestDropFlightFrame(0, ORIGIN, TARGET)!;
    assert.equal(start.x, ORIGIN.x);
    assert.equal(start.y, ORIGIN.y);
    const end = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS - 1e-6, ORIGIN, TARGET)!;
    assert.ok(Math.abs(end.x - TARGET.x) < 0.05, `落点 x 要对上目标：${end.x}`);
    assert.ok(Math.abs(end.y - TARGET.y) < 0.05, `落点 y 要对上目标：${end.y}`);

    // smoothstep 在半程仍是 0.5，正好用来量拱高与控制点。
    const mid = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS / 2, ORIGIN, TARGET)!;
    const linearX = (ORIGIN.x + TARGET.x) / 2;
    const linearY = (ORIGIN.y + TARGET.y) / 2;
    assert.ok(mid.y > linearY + 100, `中点必须明显拱到直线之上：${mid.y} vs ${linearY}`);
    assert.ok(mid.x < linearX, `控制点偏终点 30% ⇒ 中点比直线更靠左：${mid.x} vs ${linearX}`);
});

test('掉落飞行：起飞由小变大、飞入末端收小并淡出', () => {
    const start = chestDropFlightFrame(0, ORIGIN, TARGET)!;
    const grown = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.4, ORIGIN, TARGET)!;
    const entering = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.97, ORIGIN, TARGET)!;
    assert.ok(start.scale < grown.scale, '起飞那一下要从小长到大');
    assert.ok(grown.scale > 1, '中段略微放大，飞着才看得清');
    assert.ok(entering.scale < grown.scale * 0.5, '终点前收小才有「飞进 icon」的感觉');
    assert.equal(grown.opacity, 1);
    assert.ok(entering.opacity > 0 && entering.opacity < 0.3, '末端渐隐');
});

test('掉落飞行：拖尾方向取贝塞尔切线，弧线上先朝上后朝下', () => {
    const start = chestDropFlightFrame(0, ORIGIN, TARGET)!;
    const end = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS - 1e-6, ORIGIN, TARGET)!;
    assert.ok(start.dirY > 0, '起手是上抛');
    assert.ok(end.dirY < 0, '落点前已经朝下');
    for (const frame of [start, end]) {
        assert.ok(Math.abs(Math.hypot(frame.dirX, frame.dirY) - 1) < 1e-9, '切线必须单位化');
        assert.ok(Number.isFinite(frame.x) && Number.isFinite(frame.y));
    }
    // 起终点重合时切线退化 ⇒ 必须给稳定默认朝向，不许出 NaN。
    const degenerate = chestDropFlightFrame(0.2, ORIGIN, ORIGIN)!;
    assert.equal(degenerate.dirX, 1);
    assert.equal(degenerate.dirY, 0);
    assert.ok(Number.isFinite(degenerate.x) && Number.isFinite(degenerate.y));
});

test('三角形拖尾：宽端贴宝箱、往外线性收成尖、逐段渐隐且整条跟着飞行淡出', () => {
    const frame = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.4, ORIGIN, TARGET)!;
    const quads = chestDropTrailQuads(frame);
    assert.equal(quads.length, CHEST_DROP_TRAIL_SEGMENTS);

    const halfWidthOf = (index: number): number => Math.hypot(
        quads[index].ax - quads[index].dx, quads[index].ay - quads[index].dy) / 2;
    const rootWidth = halfWidthOf(0);
    assert.ok(Math.abs(rootWidth - CHEST_DROP_TRAIL_ROOT_HALF_WIDTH) < 1e-6);
    for (let index = 1; index < quads.length; index += 1) {
        const root = halfWidthOf(index);
        const tip = Math.hypot(quads[index].bx - quads[index].cx, quads[index].by - quads[index].cy) / 2;
        assert.ok(tip < root, `第 ${index} 段必须往外收窄`);
        assert.ok(Math.abs(root - tip - CHEST_DROP_TRAIL_ROOT_HALF_WIDTH / CHEST_DROP_TRAIL_SEGMENTS) < 1e-6,
            '同一段内宽度是线性收窄（缓动会把锥边画成弧）');
        assert.ok(quads[index].alpha < quads[index - 1].alpha, 'alpha 逐段递减');
    }
    const tip = quads[quads.length - 1];
    assert.ok(Math.hypot(tip.bx - tip.cx, tip.by - tip.cy) < 1e-9, '最后一段必须收成尖角');
    assert.ok(quads[0].alpha <= CHEST_DROP_TRAIL_ALPHA * frame.opacity + 1e-9);
    // 整条都在宝箱后方（点积为负），根部的距离正是 GAP。
    const behind = (quads[0].ax - frame.x) * frame.dirX + (quads[0].ay - frame.y) * frame.dirY;
    assert.ok(Math.abs(behind + CHEST_DROP_TRAIL_GAP) < 1e-6);
    const tail = quads[quads.length - 1];
    const tailBehind = (tail.bx - frame.x) * frame.dirX + (tail.by - frame.y) * frame.dirY;
    assert.ok(Math.abs(tailBehind + CHEST_DROP_TRAIL_GAP + CHEST_DROP_TRAIL_LENGTH) < 1e-6);
});

test('三角形拖尾：飞入时随 opacity 一起消失，转向上时跟着切线转', () => {
    const entering = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.97, ORIGIN, TARGET)!;
    const mid = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.4, ORIGIN, TARGET)!;
    const enteringQuads = chestDropTrailQuads(entering);
    assert.ok(enteringQuads.length === CHEST_DROP_TRAIL_SEGMENTS);
    assert.ok(enteringQuads[0].alpha < chestDropTrailQuads(mid)[0].alpha);

    const fake = { ...mid, opacity: 0 };
    assert.equal(chestDropTrailQuads(fake).length, 0, '完全淡出时不该还在画');
    // 换一个右上抛的终点：拖尾法向要跟着旋转，不能固定在 ±Y。
    const rightUp = chestDropFlightFrame(CHEST_DROP_FLIGHT_SECONDS * 0.4, ORIGIN, { x: 400, y: 600 })!;
    const a = chestDropTrailQuads(mid)[0];
    const b = chestDropTrailQuads(rightUp)[0];
    assert.ok(Math.abs(a.ay - a.dy) > 0 && Math.abs(b.ay - b.dy) > 0);
    // 法向 = (-dirY, dirX)；两个场景 dirY 反号 ⇒ 法向的 X 分量必须反号。
    assert.notEqual(Math.sign(a.ax - a.dx), Math.sign(b.ax - b.dx), '两段弧线朝向相反，法向也要反过来');
});

test('落地抖动：与 TabButton.playHitFeedback 同一条「先 Y 后 X」曲线', () => {
    assert.equal(chestDropHitScale(-1), null);
    assert.equal(chestDropHitScale(CHEST_DROP_HIT_SECONDS), null);
    assert.equal(chestDropHitScale(NaN), null);
    const early = chestDropHitScale(0.06)!;
    assert.equal(early.y, spawnShakeScaleY(0.06, BUILDING_SHAKE_STRETCH));
    assert.equal(early.x, spawnShakeScaleX(0.06, BUILDING_SHAKE_STRETCH));
    assert.ok(early.y > 1.1, '第一段先拉 Y');
    assert.equal(early.x, 1, '第一段 X 还不动');
    const late = chestDropHitScale(0.18)!;
    assert.equal(late.x, spawnShakeScaleX(0.18, BUILDING_SHAKE_STRETCH));
    assert.ok(late.x > 1.1 && late.y === 1, '第二段才拉 X');
});

// ── ② 源码守卫 ──────────────────────────────────────────────

const page = readSource('assets/script/app/main/MainPage.ts');
const map = readSource('assets/script/app/main/MainTerritoryMap.ts');
const mapView = readSource('assets/script/app/territory/view/TerritoryMapView.ts');
const view = readSource('assets/script/app/main/ChestDropFlightView.ts');
const model = readSource('assets/script/app/main/ChestDropFlight.ts');

/** 源码守卫要判「有没有真调用」，注释里写「不建 `cc.tween`」不该把断言打红。 */
function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('守卫：真源在零 cc 的纯函数模型，视图不复制曲线、不建 tween', () => {
    assert.doesNotMatch(model, /from 'cc'|require\('cc'\)/);
    assert.doesNotMatch(withoutComments(view), /cc\.tween|tween\(/);
    assert.doesNotMatch(withoutComments(page), /cc\.tween/);
    assert.match(view, /chestDropFlightFrame\(/);
    assert.match(view, /chestDropTrailQuads\(fx\)/);
    assert.match(view, /sizeMode = Sprite\.SizeMode\.CUSTOM/, '运行时 new Sprite 必须显式 CUSTOM');
    assert.match(view, /setSiblingIndex\(layer\.children\.length - 1\)/, '必须排到 MainRoot 最后一位才盖得过 HUD');
    assert.match(view, /trail\.clear\(\)/, '每帧清屏，否则池化后留着上一场的拖尾');
    assert.match(view, /convertToNodeSpaceAR/, '起点 / 终点必须换到同一个宿主');
});

test('守卫：事件边沿来自 victoryBattleCells（战斗结算存档），优先 asyncPvp 格，起点取格心世界坐标', () => {
    // 🔴 11-23 修：原来认 `victoryClaimCells`（本地探索收地）。异步 PVP 胜利是服务端
    // 权威，`loadChapter` 先 mergeServerState 把格落成 owned ⇒ startExplore 必失败 ⇒
    // victoryClaimCells 恒空 ⇒ 事件永不 emit。真源必须换成「战斗结算存档」。
    assert.match(map, /emitChestDropFlight\(state\.victoryBattleCells, state\.map\.sites\)/);
    assert.doesNotMatch(map, /emitChestDropFlight\(state\.victoryClaimCells/);
    assert.match(map, /CHEST_EVENTS\.DROP_FLIGHT/);
    assert.match(map, /TERRITORY_SITE_TYPE\.asyncPvp/);
    assert.match(map, /cellWorldPoint\(cellId\)/);
    assert.match(map, /origin: origin \? \{ x: origin\.x, y: origin\.y \} : null/);
    // 回城会立刻把镜头滚到战斗格；起飞点必须在滚动之后量，否则世界坐标是旧镜头下的。
    const scrollAt = map.indexOf('this.scrollToCell(cellId, state.layout);');
    const emitAt = map.indexOf('this.emitChestDropFlight(state.victoryBattleCells');
    assert.ok(scrollAt > 0 && emitAt > scrollAt, 'emitChestDropFlight 必须排在 scrollToCell 之后');
    assert.equal(CHEST_EVENTS.DROP_FLIGHT, 'chest:drop-flight');
    assert.match(readSource('assets/script/app/main/ChestEvents.ts'), /DROP_FLIGHT: 'chest:drop-flight'/);
});

test('守卫：模型把「战斗赢了」与「本地收地」分成两条独立边沿', () => {
    const presenter = readSource('assets/script/app/territory/application/TerritoryModel.ts');
    assert.match(presenter, /readonly victoryBattleCells\?: readonly number\[\]/, '老快照 / 夹具可不带这个字段');
    assert.match(presenter, /private victoryBattleCells: number\[\] = \[\];/);
    assert.match(presenter, /if \(battle\.status === TERRITORY_BATTLE_STATUS\.victory\) \{\s*[\s\S]{0,800}this\.victoryBattleCells = \[battle\.cellId\];/,
        '胜利边沿必须直接落在结算存档分支里，不许依赖 startExplore 的返回值');
    assert.match(presenter, /victoryBattleCells: this\.victoryBattleCells,/, '视图状态要真的透出来');
    // 两处清空：切章 / dispose 都不许把上一局的胜利标记漏到下一章。
    assert.equal((presenter.match(/this\.victoryBattleCells = \[\];/g) ?? []).length, 2);
});

test('守卫：TerritoryMapView 的格心世界坐标是唯一取数口，局部坐标复用它', () => {
    assert.match(mapView, /cellWorldPoint\(cellId: number\): Vec3 \| null/);
    assert.match(mapView, /const world = this\.cellWorldPoint\(cellId\)/);
    assert.match(mapView, /HEX_GRID_CONTENT_LIFT/, '仍要按台面中心抬升');
    // 不许出现第二份「格心 → 世界」的换算（会造成两套坐标系漂移）。
    const lifts = mapView.match(/new Vec3\(0, HEX_GRID_CONTENT_LIFT, 0\)/g) ?? [];
    assert.equal(lifts.length, 1);
});

test('守卫：MainPage 订阅边沿、飞行期压住绿点、落地激活 + 抖动、生命周期收干净', () => {
    assert.match(page, /EventMgr\.instance\.on\(CHEST_EVENTS\.DROP_FLIGHT, this\.onChestDropFlight, this\)/);
    assert.match(page, /const visibleCount = this\.chestDropPending \? Math\.max\(0, count - 1\) : count/);
    assert.match(page, /this\.chestDropPending = false;\s*\n\s*this\.refreshTreasureDisplay\(\)/);
    assert.match(page, /this\.chestDropHitElapsed = 0/);
    assert.match(page, /chestDropFlight\?\.step\(dt\)/);
    assert.match(page, /stepChestDropHit\(dt\)/);
    assert.match(page, /chestDropFlight\?\.dispose\(\)/);
    assert.match(page, /getChildByName\('BottomNav'\)/, '顶层宿主必须认到 MainRoot');
    assert.match(page, /tryStartChestDrop\(\);\s*\n\s*if \(MainPage\.chestEntryCelebrated\)/, '闸门晚到也要补起播');
    assert.doesNotMatch(withoutComments(page), /cc\.tween/);
});

// ── ③ 行为对拍：MainPage 在沙箱里的绿点 / 落地 / 抖动 ──────────

interface IDropFlightPlay {
    origin: { x: number; y: number };
    target: { x: number; y: number };
    landed: (() => void) | null;
}

function createPageHarness() {
    const plays: IDropFlightPlay[] = [];
    const scales: { x: number; y: number }[] = [];
    let slots: readonly chestTypes.IChestSlotData[] = Array.from(
        { length: chestTypes.CHEST_SLOT_COUNT }, (_, index) => ({
            index: index + 1, state: chestTypes.ChestSlotState.Empty,
            action: chestTypes.ChestSlotAction.Battle, canActivate: false, name: '', remainSeconds: 0, totalSeconds: 0, cost: 0,
        }));

    class FlightViewStub {
        constructor(_layer: unknown, _frame: unknown) {}
        play(origin: { x: number; y: number }, target: { x: number; y: number },
            landed: (() => void) | null): boolean {
            plays.push({ origin, target, landed });
            return true;
        }
        step(): boolean { return false; }
        stop(): void {}
        dispose(): void {}
    }

    const exports: { MainPage?: new () => Record<string, unknown> } = {};
    const code = ts.transpileModule(readFileSync('assets/script/app/main/MainPage.ts', 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(code, { exports, require: (name: string) => {
        if (name === 'cc') return {
            _decorator: { ccclass: () => (type: unknown) => type, property: () => () => {} },
            Component: class {},
            // 沙箱里 getComponent(UITransform/Sprite) 靠这两个标记区分（不引真实 cc）。
            UITransform: 'UITransform', Sprite: 'Sprite',
            Vec2: class { constructor(public x = 0, public y = 0) {} static distance(): number { return 0; } },
            Vec3: class { constructor(public x = 0, public y = 0, public z = 0) {} },
        };
        if (name === '../../framework/event/EventMgr') return { EventMgr: { instance: {
            on: () => undefined, offTarget: () => undefined, emit: () => undefined,
        } } };
        if (name === './ChestEvents') return { CHEST_EVENTS };
        if (name === './ChestTypes') return chestTypes;
        if (name === './ChestDropFlightView') return { ChestDropFlightView: FlightViewStub };
        if (name === './ChestDropFlight') return {
            chestDropHitScale,
        };
        if (name === './NewTreasureRepository') return { NewTreasureRepository: class {
            get slots() { return slots; }
            async load(_caller: object, listener: (value: readonly chestTypes.IChestSlotData[]) => void) {
                listener(slots);
                return 'ok';
            }
            dispose(): void {}
        } };
        if (name === './MainHudIntro') return { playMainHudIntro: () => false, prepareMainHudIntro: () => false };
        if (name === '../../framework/ui/PopupManager') return { PopupManager: { inst: { get: () => null } } };
        if (name === '../net/CacheMgr') return { CacheMgr: { instance: {
            setEventUpdate: () => undefined, removeEventUpdate: () => undefined,
        } } };
        if (name === '../net/GameNet') return { GameNet: { instance: { removeCaller: () => undefined } } };
        return {};
    } });
    assert.ok(exports.MainPage);
    const Page = exports.MainPage!;

    const createPage = () => {
        const instance = new Page();
        const cells = Array.from({ length: chestTypes.CHEST_SLOT_COUNT }, () => ({
            spriteFrame: null as unknown, node: { active: true },
        }));
        // 让 `chestDropFxRoot()` 走到「认出 MainRoot」那条分支。
        const mainRoot = { getChildByName: (child: string) => (child === 'BottomNav' ? {} : null), parent: null };
        const content = { parent: mainRoot, getChildByName: () => null };
        const arena = { parent: content, getChildByName: () => null };
        const toggle = {
            active: true,
            isValid: true,
            scale: { x: 1, y: 1 },
            getComponent: (kind: unknown) => {
                if (kind === 'UITransform') {
                    return { convertToWorldSpaceAR: () => ({ x: 289.5, y: -335.5 }) };
                }
                if (kind === 'Sprite') return { spriteFrame: 'hud_chest' };
                return null;
            },
            setScale(x: number, y: number) { scales.push({ x, y }); },
        };
        Object.assign(instance, {
            isValid: true, node: arena, chestToggle: toggle,
            chestCell0: cells[0], chestCell1: cells[1], chestCell2: cells[2], chestCell3: cells[3],
            chestCellFilled: 'green', chestCellEmpty: 'gray',
            chestEntryUnlocked: true,
            startButton: { active: false },
            chestBar: { render() {}, setOpen() {} },
            schedule() {}, unschedule() {},
        });
        return {
            page: instance,
            colors: () => cells.map((cell) => cell.spriteFrame),
            emitDrop: (origin: { x: number; y: number } | null) => {
                const handler = (instance as Record<string, unknown>).onChestDropFlight as
                    ((payload: unknown) => void) | undefined;
                assert.ok(handler, 'MainPage 必须有 DROP_FLIGHT 处理函数');
                handler?.({ origin, cellId: 20001 });
            },
        };
    };
    const setCount = (occupied: number) => {
        slots = Array.from({ length: chestTypes.CHEST_SLOT_COUNT }, (_, index) => ({
            index: index + 1,
            state: index < occupied ? chestTypes.ChestSlotState.Ready : chestTypes.ChestSlotState.Empty,
            action: chestTypes.ChestSlotAction.Battle, canActivate: false, name: '', remainSeconds: 0, totalSeconds: 0, cost: 0,
        }));
    };
    return { createPage, setCount, plays, scales };
}

test('行为：掉落事件只起播一次，起点用地图格心、终点用 ChestEntry 世界坐标', () => {
    const h = createPageHarness();
    h.setCount(2);
    const { page, emitDrop } = h.createPage();
    (page.start as () => void)?.call(page);
    emitDrop({ x: -120, y: 260 });
    assert.equal(h.plays.length, 1);
    // 沙箱跨 realm：`deepStrictEqual` 会因原型不同而假红，逐字段比。
    assert.equal(h.plays[0].origin.x, -120);
    assert.equal(h.plays[0].origin.y, 260);
    assert.equal(h.plays[0].target.x, 289.5);
    assert.equal(h.plays[0].target.y, -335.5);
    emitDrop({ x: -100, y: 200 });
    assert.equal(h.plays.length, 1, '同一页只演一次，重复 render 不许连播');
});

test('行为：绿点在飞行期被压住，落地那一拍激活并触发抖动', () => {
    const h = createPageHarness();
    h.setCount(2);
    const { page, colors, emitDrop } = h.createPage();
    (page.start as () => void)?.call(page);
    assert.deepEqual(colors(), ['green', 'green', 'gray', 'gray'], '起播前两颗都亮');
    emitDrop({ x: -120, y: 260 });
    assert.deepEqual(colors(), ['green', 'gray', 'gray', 'gray'], '飞行期最后一颗压住');
    const landed = h.plays[0].landed;
    assert.ok(landed);
    landed?.();
    assert.deepEqual(colors(), ['green', 'green', 'gray', 'gray'], '落地立刻点亮');
    assert.equal(page.chestDropHitElapsed, 0, '落地同时起抖动');
    // 抖动写进 icon 的缩放：第一段先拉 Y，X 不动。
    (page.update as (dt: number) => void)?.call(page, 0.06);
    assert.ok(h.scales.length > 0);
    const last = h.scales[h.scales.length - 1];
    assert.ok(last.y > 1.1 && Math.abs(last.x - 1) < 1e-6, `先 Y 后 X：${JSON.stringify(last)}`);
});

test('行为：地图给不出格心时退回默认起飞点，不静默消失', () => {
    const h = createPageHarness();
    h.setCount(1);
    const { page, emitDrop } = h.createPage();
    (page.start as () => void)?.call(page);
    emitDrop(null);
    assert.equal(h.plays.length, 1);
    assert.equal(h.plays[0].origin.x, 289.5 - 260);
    assert.equal(h.plays[0].origin.y, -335.5 + 420);
});

test('行为：闸门未解锁 / 节点不就绪时不抢跑，解锁后补起播', () => {
    const h = createPageHarness();
    h.setCount(1);
    const { page, emitDrop } = h.createPage();
    (page.start as () => void)?.call(page);
    (page as Record<string, unknown>).chestEntryUnlocked = false;
    emitDrop({ x: 10, y: 20 });
    assert.equal(h.plays.length, 0, '入口还藏着不许把宝箱飞过去');
    (page as Record<string, unknown>).chestEntryUnlocked = true;
    (page.tryStartChestDrop as () => void)?.call(page);
    assert.equal(h.plays.length, 1, '闸门就绪后补起播');
    assert.equal(page.chestDropPlayed, true, '补起播也要落一次性闩，不能再播第二次');
});
