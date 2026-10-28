import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 建筑产金飘字「coin + 数字从建筑顶部往上升 50px 并淡出」（2026-10-27 用户口径）。
 *
 * > 「建筑生成金币的动画效果需要和单位被击杀掉落金币的动画效果区分开来，
 * >  建筑生成金币动画是播放金币 icon 和对应的数字 UI 从建筑的顶部往上升起 50px，并且变透明消失」
 *
 * 改前两种金币**共用** `kind: 'gold'`，所以建筑产出也在播「落到地面 → 停一下 → 缩小消失」，
 * 而且没有数字（2026-10-23 为掉落把数字整个拿掉了）。产出读起来像"从地里掉出来一枚硬币"。
 *
 * 现在拆成两个 kind，各走一条**方向相反**的曲线：
 *
 * | kind | 来处 | 曲线 | 数字 | 方向 |
 * | --- | --- | --- | --- | --- |
 * | `gold` | 击杀 / 拆建筑掉落 | `floatTextGoldDrop` | 无 | 往下落（`drop >= 0` 单调不增） |
 * | `goldincome` | 主城 / 金矿产出 | `floatTextGoldRise` | `+N` | 往上升（`rise >= 0` 单调不减） |
 *
 * 本用例钉五件事：
 *  1. 上升量端点精确：起点 0、终点正好 50px、全程在 `[0, 50]`；
 *  2. 单调：`rise` 只增不减、`fade` 只减不增（不许"升一半又掉下来"）；
 *  3. **建筑顶部基准是真的建筑顶部** —— 直接拿地块 prefab 的 BuildingIcon 几何算一遍对齐；
 *  4. 视图接线：`goldincome` 显示数字、从「建筑顶 + rise」起步、硬币排在数字左侧不自转；
 *     而 `gold` 那条一个字都不许变（无数字、落点仍是角色中心 + drop）；
 *  5. 模型接线：只有 `economyContext.grantGold`（主城 / 金矿）走新 kind，两个"掉落"调用点保持默认。
 */

const VIEW_PATH = 'assets/script/app/zcds/view/ZCFloatTextView.ts';
const UTIL_PATH = 'assets/script/app/zcds/view/ZCGameViewUtil.ts';
const MODEL_PATH = 'assets/script/app/zcds/model/ZCGameModel.ts';
const HEX_PREFAB_PATH = 'assets/bundles/battle/ui/game/ZCGameHex.prefab';

function util() {
    return loadViews().load('./ZCGameViewUtil') as Record<string, any>;
}

/** 按 1/240 采样整条（含两端），抓边界与抖动。 */
function sample(step = 1 / 240): number[] {
    const out: number[] = [];
    for (let p = 0; p <= 1 + 1e-9; p += step) out.push(Number(p.toFixed(4)));
    out.push(1);
    return out;
}

// ---------------------------------------------------------------- 曲线本身

test('上升量：起点 0、终点正好 50px、全程落在 [0, 50]', () => {
    const { floatTextGoldRise, FLOAT_TEXT_GOLD_RISE_PX } = util();
    assert.equal(FLOAT_TEXT_GOLD_RISE_PX, 50, '用户口径就是 50px，别自己改');

    const start = floatTextGoldRise(0);
    assert.equal(start.rise, 0, '起手必须贴在建筑顶上（不是凭空高一截）');
    assert.equal(start.fade, 1, '起手全不透明 —— 数字要先看得清');

    const end = floatTextGoldRise(1);
    assert.equal(end.rise, FLOAT_TEXT_GOLD_RISE_PX, '末尾必须正好升起 50px');
    assert.equal(end.fade, 0, '末尾必须淡到 0（不能留残影）');

    for (const progress of sample()) {
        const frame = floatTextGoldRise(progress);
        assert.ok(frame.rise >= -1e-9, `t=${progress} 的 rise=${frame.rise}，产金不许往下掉`);
        assert.ok(frame.rise <= FLOAT_TEXT_GOLD_RISE_PX + 1e-9,
            `t=${progress} 升过头了（${frame.rise} > 50）`);
    }
});

test('单调：只往上、只变淡（升起一半又掉下来 = 读成两个动作）', () => {
    const { floatTextGoldRise } = util();
    let lastRise = -Infinity;
    let lastFade = Infinity;
    for (const progress of sample(1 / 480)) {
        const frame = floatTextGoldRise(progress);
        assert.ok(frame.rise >= lastRise - 1e-9,
            `t=${progress} 上升回弹（${lastRise} → ${frame.rise}）`);
        assert.ok(frame.fade <= lastFade + 1e-9,
            `t=${progress} 变淡后又被调回不透明（${lastFade} → ${frame.fade}）`);
        lastRise = frame.rise;
        lastFade = frame.fade;
    }
});

test('淡出起点：上升段前一截保持全不透明，不会一起步就虚', () => {
    const { floatTextGoldRise, FLOAT_TEXT_GOLD_FADE_START } = util();
    const start = FLOAT_TEXT_GOLD_FADE_START as number;
    assert.ok(start > 0 && start < 1, 'fadeStart 必须在 (0,1) 之间才有意义');
    for (const progress of [0, start * 0.3, start * 0.7, start]) {
        assert.equal(floatTextGoldRise(progress).fade, 1,
            `t=${progress} 还没到淡出起点就不该变淡`);
    }
    assert.ok(floatTextGoldRise(start + (1 - start) * 0.35).fade < 1, '过了起点必须真的开始淡');
});

test('脏数据不产出 NaN、也不反向', () => {
    const { floatTextGoldRise } = util();
    for (const progress of [Number.NaN, -1, -0.5, 2, Number.POSITIVE_INFINITY]) {
        const frame = floatTextGoldRise(progress);
        for (const [key, value] of Object.entries(frame)) {
            assert.ok(Number.isFinite(value as number), `t=${progress} 的 ${key} 不是有限数：${value}`);
        }
        assert.ok(frame.rise >= 0 && frame.rise <= 50, `t=${progress} 的 rise=${frame.rise} 越界`);
        assert.ok(frame.fade >= 0 && frame.fade <= 1, `t=${progress} 的 fade=${frame.fade} 越界`);
    }
    // 越界的进度直接夹到两端（不是"回到起点"——那会让飘字在末尾倒放一次）
    assert.deepEqual(floatTextGoldRise(-1), floatTextGoldRise(0));
    assert.deepEqual(floatTextGoldRise(2), floatTextGoldRise(1));
});

test('两条曲线方向相反：掉落只往下（单调不增）、产金只往上（单调不减）', () => {
    const { floatTextGoldDrop, floatTextGoldRise } = util();
    let lastDrop = Infinity;
    let lastRise = -Infinity;
    let dropMoved = false;
    let riseMoved = false;
    for (const progress of sample(1 / 480)) {
        const drop = floatTextGoldDrop(progress).drop;
        const rise = floatTextGoldRise(progress).rise;
        assert.ok(drop <= lastDrop + 1e-9, `掉落回弹：${lastDrop} → ${drop}`);
        assert.ok(rise >= lastRise - 1e-9, `产金回弹：${lastRise} → ${rise}`);
        if (drop < lastDrop - 1e-9) dropMoved = true;
        if (rise > lastRise + 1e-9) riseMoved = true;
        lastDrop = drop;
        lastRise = rise;
    }
    // 两条都必须"真的动过"，否则就是某一条被接成了常量（表现上等于没动画）
    assert.ok(dropMoved, '掉落曲线必须在动');
    assert.ok(riseMoved, '产金曲线必须在动');
});

// ---------------------------------------------------------------- 建筑顶部基准

test('「建筑顶部」基准 = 地块 prefab 里建筑图的上边缘（不许手填一个好看的数字）', () => {
    const { FLOAT_TEXT_GOLD_INCOME_TOP_PX } = util();
    const raw = JSON.parse(readFileSync(HEX_PREFAB_PATH, 'utf8')) as Array<Record<string, any>>;

    // 找 ZCHexView 组件上的 buildingSprite（已建建筑外观图），而不是凭名字猜哪个 BuildingIcon ——
    // prefab 里有两个同名节点（一个是可开发的占位图标，挂在 BuildingLayer 下）。
    const comp = raw.find((o) => o && o.__type__ && !String(o.__type__).startsWith('cc.')
        && o.buildingSprite !== undefined);
    assert.ok(comp, '地块 prefab 上找不到 ZCHexView 组件');
    const sprite = raw[comp!.buildingSprite.__id__];
    assert.equal(sprite.__type__, 'cc.Sprite', 'buildingSprite 必须指向 Sprite');
    const node = raw[sprite.node.__id__];
    const uit = raw[node._components.find((c: { __id__: number }) => raw[c.__id__].__type__ === 'cc.UITransform').__id__];

    // `applyBuildingScale` 是唯一写入口，静止态恒为 BUILDING_ICON_SCALE（0.72 × 1）。
    const viewSrc = readFileSync('assets/script/app/zcds/view/ZCHexView.ts', 'utf8');
    const scale = Number(/const BUILDING_ICON_SCALE = ([\d.]+);/.exec(viewSrc)?.[1]);
    assert.ok(Number.isFinite(scale), '找不到 BUILDING_ICON_SCALE');

    const top = node._lpos.y + (uit._contentSize.height * scale) / 2;
    // 允许 1px 以内的取整（48.05 → 48）。
    assert.ok(Math.abs(top - FLOAT_TEXT_GOLD_INCOME_TOP_PX) <= 1,
        `建筑顶在格心上方 ${top.toFixed(2)}px，常量却是 ${FLOAT_TEXT_GOLD_INCOME_TOP_PX}px`
        + ' —— 换建筑图或改 BUILDING_ICON_SCALE 后要重标');
});

// ---------------------------------------------------------------- 视图接线（跑真代码）

const VIEW_CID = '5f5d73+cpZKJaf1c3R7eavp';

function createView() {
    class UIOpacity { opacity = 255; }
    class UITransform { width = 0; }
    class Color {
        constructor(public r = 0, public g = 0, public b = 0, public a = 255) {}
        set(r: number, g: number, b: number, a = 255) {
            this.r = r; this.g = g; this.b = b; this.a = a;
            return this;
        }
    }
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
        Component: class {}, Label: class {}, Sprite: class {}, Color, UIOpacity, UITransform,
    };
    const compiled = ts.transpileModule(readFileSync(VIEW_PATH, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText;
    // 曲线一律转发**真模块**：在本文件里再实现一遍等于把曲线复制成两份，源码改了用例还照样绿。
    const realUtil = util();
    const loaded = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        if (name === 'cc') return cc;
        assert.equal(name, './ZCGameViewUtil');
        return { ...realUtil, mapToViewX: (x: number) => x, mapToViewY: (y: number) => y };
    }, loaded, loaded.exports);

    const makeNode = () => {
        const components: any[] = [];
        return {
            components,
            getComponent: (type: unknown) => components.find((c) => c instanceof type) ?? null,
            addComponent: (type: any) => { const c = new type(); components.push(c); return c; },
        };
    };
    const textPositions: Array<{ x: number; y: number }> = [];
    const textScales: Array<{ x: number; y: number }> = [];
    const iconPositions: Array<{ x: number; y: number }> = [];
    const iconAngles: number[] = [];

    const textNode = Object.assign(makeNode(), {
        setPosition(x: number, y: number) { textPositions.push({ x, y }); },
        setScale(x: number, y: number) { textScales.push({ x, y }); },
        // 模拟「引擎已在上一帧按文字内容刷新过 contentSize」。
        getComponent(type: unknown) { return type === UITransform ? { width: 40 } : null; },
    });
    const iconNode = Object.assign(makeNode(), {
        setPosition(x: number, y: number) { iconPositions.push({ x, y }); },
        setRotationFromEuler(_x: number, _y: number, z: number) { iconAngles.push(z); },
    });

    const view = new loaded.exports.ZCFloatTextView();
    (view as unknown as { node: unknown }).node = { setPosition() {} };
    view.textLabel = { string: '', fontSize: 30, color: null, enabled: true, node: textNode };
    view.goldIcon = { enabled: false, node: iconNode };
    return {
        view, iconPositions, iconAngles, textPositions, textScales, realUtil,
        lastText: () => textPositions[textPositions.length - 1],
    };
}

/** 一条飘字；`durationSeconds` 1s，方便用秒数当进度。 */
function floatText(kind: string, elapsed: number) {
    return { id: 1, kind, owner: 'player', value: 16, x: 0, y: 0, startedAt: -elapsed, durationSeconds: 1 } as never;
}

test('视图：产金飘字有数字（+16），硬币不自转且排在数字左侧', () => {
    const { view, iconPositions, iconAngles } = createView();
    const label = view.textLabel as unknown as { string: string; enabled: boolean };

    view.render(floatText('goldincome', 0), 0);
    assert.equal(label.string, '+16', '产金必须显示数字 —— 用户要的就是「coin 和对应的数字 UI」');
    assert.equal(label.enabled, true, '起手数字就要可见');
    assert.equal((view.goldIcon as unknown as { enabled: boolean }).enabled, true, '硬币也要在');

    // 硬币不自转（掉落那圈是"翻找战利品"的语义，产出不该有）。
    for (const elapsed of [0, 0.2, 0.5, 1]) {
        view.render(floatText('goldincome', elapsed), 0);
        assert.equal(iconAngles[iconAngles.length - 1], 0, `t=${elapsed} 产金硬币不该自转`);
    }
    const icon = iconPositions[iconPositions.length - 1];
    // 数字宽 40 ⇒ -(40/2 + 间距 4 + 半硬币 15) = -39；必须真在数字左边，否则会盖住「+」。
    assert.equal(icon.y, 0, '硬币竖直方向与数字对齐');
    assert.ok(icon.x < -20, `硬币应在数字左侧，实测 x=${icon.x}`);
});

test('视图：产金从「建筑顶部」起跑，升起量来自曲线、末尾是 50px', () => {
    const { view, realUtil, lastText } = createView();
    const top = realUtil.FLOAT_TEXT_GOLD_INCOME_TOP_PX as number;

    view.render(floatText('goldincome', 0), 0);
    assert.equal(lastText().x, 0, '水平居中在格心，产金只做纵向');
    assert.equal(lastText().y, top, `起手应贴在建筑顶（${top}px），实测 ${lastText().y}`);

    let lastY = -Infinity;
    for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
        view.render(floatText('goldincome', progress), 0);
        const expected = top + (realUtil.floatTextGoldRise(progress).rise as number);
        assert.ok(Math.abs(lastText().y - expected) < 1e-9,
            `t=${progress} 应在 ${expected}，实测 ${lastText().y}`);
        assert.ok(lastText().y >= lastY - 1e-9, `t=${progress} 产金飘字倒退了`);
        lastY = lastText().y;
    }
    assert.ok(Math.abs(lastText().y - (top + 50)) < 1e-9, '末尾必须比建筑顶高 50px');
});

test('视图：产金末尾透明度归 0，且缩放写回 1（对象池里上一条可能是掉落）', () => {
    const { view, realUtil, textScales } = createView();
    const opacity = () => (view.goldIcon as unknown as { node: { components: any[] } }).node.components[0].opacity as number;
    const scale = () => textScales[textScales.length - 1];

    // 先跑一条掉落到末尾：那会把 Text 的 scale 收到 0。
    view.render(floatText('gold', 1), 0);
    assert.equal(scale().x, 0, '掉落末尾必须缩到 0（既有口径）');
    // 复用来一条产金：scale 必须显式写回 1，否则整条飘字是"看不见但透明度满"的。
    view.render(floatText('goldincome', 0.2), 0);
    assert.equal(scale().x, 1, '产金复用掉落的节点后必须把缩放写回 1');
    assert.equal(scale().y, 1);
    assert.equal(opacity(), 255, 't=0.2 还在全不透明段');

    for (const progress of [0.6, 0.8, 0.95]) {
        view.render(floatText('goldincome', progress), 0);
        assert.equal(opacity(), Math.round(255 * (realUtil.floatTextGoldRise(progress).fade as number)),
            `t=${progress} 硬币透明度应等于曲线的 fade`);
    }
    view.render(floatText('goldincome', 1), 0);
    assert.equal(opacity(), 0, '末尾必须淡到 0');
});

test('视图：`gold`（掉落）一个字都没变 —— 仍然无数字、仍然落在角色中心', () => {
    const { view, realUtil, lastText } = createView();
    const label = view.textLabel as unknown as { string: string; enabled: boolean };
    const center = (view as unknown as { damageTargetSize: number }).damageTargetSize * 0.5;
    view.render(floatText('gold', 0.5), 0);
    assert.equal(label.string, '', '掉落不显示数字（2026-10-23 口径，不许被产金需求带回来）');
    assert.equal(label.enabled, false, '掉落要把数字 Label 关掉');
    // 落点仍是「角色中心 + drop」，不是建筑顶。
    const expected = center + (realUtil.floatTextGoldDrop(0.5).drop as number);
    assert.ok(Math.abs(lastText().y - expected) < 1e-9,
        `掉落必须是「角色中心 + drop」= ${expected}，实测 ${lastText().y}`);
    // 同一进度下两条飘字必须在不同高度，否则「区分开」就没做到。
    view.render(floatText('goldincome', 0.5), 0);
    assert.notEqual(lastText().y, expected, '产金与掉落在同一时刻不能落在同一高度');
});

test('源码守卫：两条分支各走各的曲线，且产金分支显式写回 scale', () => {
    const src = readFileSync(VIEW_PATH, 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.match(body, /text\.kind === 'gold' \? floatTextGoldDrop\(progress\) : null/,
        '掉落必须只认 gold');
    assert.match(body, /text\.kind === 'goldincome' \? floatTextGoldRise\(progress\) : null/,
        '产金必须只认 goldincome（共用 kind 就又会互相串）');
    assert.match(body, /FLOAT_TEXT_GOLD_INCOME_TOP_PX \+ goldIncome\.rise/,
        '产金定位必须是「建筑顶 + 上升量」');
    // 反向守卫：产金分支不许再用掉落的 drop / scale。
    assert.doesNotMatch(body, /goldIncome\.drop/, '产金不该有下落量');
    const utilSrc = readFileSync(UTIL_PATH, 'utf8');
    assert.match(utilSrc, /export function floatTextGoldRise\(/);
    assert.match(utilSrc, /export const FLOAT_TEXT_GOLD_RISE_PX = 50;/);
});

// ---------------------------------------------------------------- 模型接线

test('模型：只有主城 / 金矿产出走 goldincome，两个掉落点保持默认 gold', () => {
    const src = readFileSync(MODEL_PATH, 'utf8');
    // 产金：economyContext.grantGold 唯一一处，且用独立的时长常量。
    assert.match(src, /this\.grantGold\(owner, amount, center\.x, center\.y,\s*\n?\s*FLOAT_TEXT_GOLD_INCOME_SECONDS, 'goldincome'\);/,
        '建筑产金必须显式传 goldincome');
    // 掉落：击杀 / 拆建筑两处仍是 FLOAT_TEXT_GOLD_SECONDS，且**不传 kind**（默认 gold）。
    const drops = src.match(/this\.grantGold\([^)]*FLOAT_TEXT_GOLD_SECONDS\);/g) ?? [];
    assert.equal(drops.length, 2, `击杀与拆建筑两处掉落应保持默认，实测 ${drops.length} 处`);
    assert.doesNotMatch(src, /this\.grantGold\([^)]*FLOAT_TEXT_GOLD_SECONDS, 'goldincome'\)/,
        '掉落不许被改成产金表现');
    // 时长：产金要比掉落从容（50px 塞进 0.62s 会像被弹出去）。
    const income = Number(/const FLOAT_TEXT_GOLD_INCOME_SECONDS = ([\d.]+);/.exec(src)?.[1]);
    const drop = Number(/const FLOAT_TEXT_GOLD_SECONDS = ([\d.]+);/.exec(src)?.[1]);
    assert.ok(Number.isFinite(income) && Number.isFinite(drop));
    assert.ok(income > drop, `产金 ${income}s 应比掉落 ${drop}s 慢`);
});

test('prefab：飘字共用同一套节点（产金没有额外美术资源）', () => {
    // 产金复用 GoldIcon + Text，两者都挂在 Text 下 ⇒ 移动父节点即可让 coin 与数字一起升。
    // 若哪天有人为产金另建一套节点，这条会先红，强制重新审视「一起升」的假设。
    const prefab: Array<Record<string, any>> = JSON.parse(
        readFileSync('assets/bundles/battle/ui/game/ZCGameFloatText.prefab', 'utf8'));
    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp, `prefab 上找不到 ZCFloatTextView 组件（cid=${VIEW_CID}）`);
    const iconNode = prefab[prefab[comp!.goldIcon.__id__].node.__id__];
    assert.equal(prefab[iconNode._parent.__id__]._name, 'Text',
        '硬币必须是 Text 的子节点，产金的「coin 与数字一起升」靠的就是这层父子关系');
});
