/**
 * 资源栏「**扣除**」反馈：数字显红 → 跳一下 → **然后**才扣。
 *
 * 用户 2026-11-02 原话（附顶部资源栏截图，红框圈着 `2670` 银币 / `137/30` 体力）：
 * > 「当发生资源扣除时，对应资源栏的数字显红，跳动再扣除」
 *
 * 这条需求的**全部难点都在顺序上**，不在画面上：
 *
 *  · 数值真值来自 `CmdRole`，服务端一推、`ResBar.reload` 一跑，label 上就已经是**扣后**的值了
 *    ⇒ 什么都不做的话，玩家看到的是「数字直接掉下去、然后才红一下」，与需求正好相反；
 *  · 所以这条反馈必须先把 label **钉回扣前值**、演完红与跳，最后才滚到扣后值。
 *
 * 因此本文件分两层：
 *
 *  1. `resBarSpendFx` 的**曲线口径**（`countRatio` 在一段窗口内恒 0 是"跳完再扣"的机器证明）；
 *  2. 把 `MainResBarSlot` 的真代码塞进沙箱（只有 `cc` 是桩），验**实际写出来的节点状态**：
 *     第一帧不许掉数字、红要出现、收尾要复原成常态色。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as feedback from '../assets/script/app/main/MainResBarFeedback';
import {
    RES_BAR_SPEND_HOLD_SECONDS,
    RES_BAR_SPEND_ICON_POP,
    RES_BAR_SPEND_LABEL_POP,
    RES_BAR_SPEND_RED,
    RES_BAR_SPEND_RED_FADE_SECONDS,
    RES_BAR_SPEND_RED_RISE_SECONDS,
    RES_BAR_SPEND_SECONDS,
    parseResBarCountText,
    resBarSpendColor,
    resBarSpendFx,
} from '../assets/script/app/main/MainResBarFeedback';

// ---------------------------------------------------------------------------
// ① 曲线口径
// ---------------------------------------------------------------------------

test('时长常量：扣的反馈比加的**长**（它多一段「先不扣」的定格），但仍在 1s 量级', () => {
    assert.ok(RES_BAR_SPEND_SECONDS > feedback.RES_BAR_HIT_SECONDS,
        '扣除要多演一段「显红 + 跳」，不能比加还短');
    assert.ok(RES_BAR_SPEND_SECONDS > 0.6 && RES_BAR_SPEND_SECONDS <= 1.2, '再长就挡住玩家操作了');
    assert.ok(RES_BAR_SPEND_HOLD_SECONDS > RES_BAR_SPEND_RED_RISE_SECONDS,
        '变红必须**在**定格段之内完成，否则玩家还没看清红就开始扣了');
    assert.ok(RES_BAR_SPEND_HOLD_SECONDS < RES_BAR_SPEND_SECONDS, '定格段不能吃掉整个窗口');
    assert.ok(RES_BAR_SPEND_RED_FADE_SECONDS < RES_BAR_SPEND_SECONDS - RES_BAR_SPEND_HOLD_SECONDS,
        '红色淡出窗口必须落在扣减段之内（否则红还没退数字就落地了）');
    assert.ok(RES_BAR_SPEND_LABEL_POP > RES_BAR_SPEND_ICON_POP,
        '扣东西时玩家读的是数字 ⇒ 数字比图标的弹跳大一点');
});

test('resBarSpendFx：窗口外 null，起手「三个 1 / 一个 0」', () => {
    assert.equal(resBarSpendFx(-0.001), null);
    assert.equal(resBarSpendFx(RES_BAR_SPEND_SECONDS), null);
    assert.equal(resBarSpendFx(Number.NaN), null);
    const first = resBarSpendFx(0)!;
    assert.ok(first);
    assert.equal(first.iconScale, 1, '起手图标不许已经放大');
    assert.equal(first.labelScale, 1);
    assert.equal(first.labelHop, 0);
    assert.equal(first.countRatio, 0, '第一帧数字必须还是扣前值');
    assert.equal(first.redStrength, 0, '红是"渐变出来"的，第 0 帧还没红');
});

test('★★★「跳动**再**扣除」：countRatio 在前 HOLD 秒恒 0，之后才单调涨到 1', () => {
    // 这条就是需求原文那句「跳动再扣除」的机器证明 —— 把 HOLD 改小 / 改大都会在这里红。
    let previousText = -1;
    let previousRatio = -1;
    const samples = 400;
    for (let i = 0; i <= samples; i += 1) {
        const elapsed = (RES_BAR_SPEND_SECONDS * i) / (samples + 1);
        const fx = resBarSpendFx(elapsed);
        if (!fx) continue;
        if (elapsed <= RES_BAR_SPEND_HOLD_SECONDS) {
            assert.equal(fx.countRatio, 0, `${elapsed.toFixed(3)}s 还没跳完就开始扣了`);
            // 定格段里数字文本必须是**同一个值**（不是"扣得很慢"）。
            const text = feedback.resBarCountValue(1000, 970, fx.countRatio);
            assert.equal(text, 1000);
            assert.equal(previousText === -1 ? 1000 : text, 1000);
            previousText = text;
        }
        assert.ok(fx.countRatio >= previousRatio - 1e-9,
            `countRatio 回头了：${previousRatio} → ${fx.countRatio}`);
        assert.ok(fx.countRatio >= 0 && fx.countRatio <= 1);
        previousRatio = fx.countRatio;
    }
    const last = resBarSpendFx(RES_BAR_SPEND_SECONDS - 1e-9)!;
    assert.ok(last.countRatio > 0.999, '收尾必须已经滚到扣后值');
});

test('弹跳：定格段里的单峰，峰值是常量，收尾回到原位', () => {
    let iconPeak = 0;
    let labelPeak = 0;
    let hopPeak = 0;
    for (let i = 0; i < 200; i += 1) {
        const fx = resBarSpendFx((RES_BAR_SPEND_HOLD_SECONDS * i) / 200)!;
        iconPeak = Math.max(iconPeak, fx.iconScale);
        labelPeak = Math.max(labelPeak, fx.labelScale);
        hopPeak = Math.max(hopPeak, fx.labelHop);
    }
    assert.ok(Math.abs(iconPeak - (1 + RES_BAR_SPEND_ICON_POP)) < 1e-6, `图标峰值该是常量，实测 ${iconPeak}`);
    assert.ok(Math.abs(labelPeak - (1 + RES_BAR_SPEND_LABEL_POP)) < 1e-6);
    assert.ok(hopPeak > 0, '「跳」必须有位移，只放大读起来是"胀"不是"跳"');
    // 扣减段不再跳（跳完就归位，别让数字一边掉一边抖）。
    const duringCount = resBarSpendFx(RES_BAR_SPEND_HOLD_SECONDS + 0.1)!;
    assert.equal(duringCount.iconScale, 1);
    assert.equal(duringCount.labelScale, 1);
    assert.equal(duringCount.labelHop, 0);
});

test('红色：RISE 秒内升到 1、定格段保持、末段淡回 0（红色是临时标签，不许留）', () => {
    assert.ok(Math.abs(resBarSpendFx(RES_BAR_SPEND_RED_RISE_SECONDS)!.redStrength - 1) < 1e-9,
        '变红要在 RISE 秒时到顶');
    for (const t of [0.12, 0.2, RES_BAR_SPEND_HOLD_SECONDS]) {
        assert.equal(resBarSpendFx(t)!.redStrength, 1, `定格段 ${t}s 应该还在红`);
    }
    // 末段单调淡出，窗口闭合时归 0。
    let previous = 1;
    const fadeStart = RES_BAR_SPEND_SECONDS - RES_BAR_SPEND_RED_FADE_SECONDS;
    for (const t of [fadeStart, fadeStart + 0.06, fadeStart + 0.12, RES_BAR_SPEND_SECONDS - 1e-6]) {
        const strength = resBarSpendFx(t)!.redStrength;
        assert.ok(strength <= previous + 1e-9, `红色在 ${t}s 处回去了`);
        previous = strength;
    }
    assert.ok(resBarSpendFx(RES_BAR_SPEND_SECONDS - 1e-6)!.redStrength < 0.01, '收尾必须几乎不红了');
});

test('resBarSpendColor：0 ⇒ 原色原样，1 ⇒ 目标红，中间线性，脏输入不产 NaN', () => {
    const base: [number, number, number] = [255, 255, 255];
    assert.deepEqual(resBarSpendColor(base, 0), [255, 255, 255], 'strength=0 必须**逐位**等于原色（否则收尾会对不上）');
    assert.deepEqual(resBarSpendColor(base, 1), [...RES_BAR_SPEND_RED]);
    const half = resBarSpendColor(base, 0.5);
    assert.ok(half[0] < 255 && half[0] > RES_BAR_SPEND_RED[0]);
    // 越界 / 脏值一律夹紧，绝不把 `undefined` 混成 NaN（NaN 颜色会让 Label 静默变黑）。
    assert.deepEqual(resBarSpendColor(base, -1), [255, 255, 255]);
    assert.deepEqual(resBarSpendColor(base, 2), [...RES_BAR_SPEND_RED]);
    assert.deepEqual(resBarSpendColor(base, Number.NaN), [255, 255, 255]);
    for (const channel of resBarSpendColor([Number.NaN, -20, 400], 0.5)) {
        assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255);
    }
});

test('端到端：扣 30 的整条文本链 —— 前段不动、之后单调降、首尾精确', () => {
    const base = parseResBarCountText('137/30');
    const amount = 30;
    const to = base.value - amount;
    assert.equal(to, 107);
    let previous = Number.POSITIVE_INFINITY;
    let frozenFrames = 0;
    for (let i = 0; i <= 200; i += 1) {
        const elapsed = (RES_BAR_SPEND_SECONDS * i) / 201;
        const fx = resBarSpendFx(elapsed)!;
        const value = feedback.resBarCountValue(base.value, to, fx.countRatio);
        assert.ok(value <= previous, `数字涨了（扣的过程不许回头）：${previous} → ${value}`);
        if (value === base.value) frozenFrames += 1;
        previous = value;
    }
    assert.ok(frozenFrames > 20, '「先不扣」的那段必须真的存在（帧数不该是 0）');
    const last = resBarSpendFx(RES_BAR_SPEND_SECONDS - 1e-9)!;
    assert.equal(feedback.formatResBarCountText(base, feedback.resBarCountValue(base.value, to, last.countRatio)),
        '107/30', '后缀不许在滚动里丢掉');
});

// ---------------------------------------------------------------------------
// ② 真代码沙箱：MainResBarSlot 实际写出来的节点状态
// ---------------------------------------------------------------------------

class FakeColor {
    r: number;
    g: number;
    b: number;
    a: number;
    constructor(r = 0, g = 0, b = 0, a = 255) {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }
    set(other: { r: number; g: number; b: number; a: number }): FakeColor {
        this.r = other.r;
        this.g = other.g;
        this.b = other.b;
        this.a = other.a;
        return this;
    }
    clone(): FakeColor {
        return new FakeColor(this.r, this.g, this.b, this.a);
    }
    toString(): string {
        return `${this.r},${this.g},${this.b},${this.a}`;
    }
}

class FakeNode {
    name: string;
    active = true;
    layer = 0;
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    constructor(name = '') {
        this.name = name;
    }
    setScale(x: number, y: number, z = 1): void {
        this.scale = { x, y, z };
    }
    setPosition(x: number, y: number, z = 0): void {
        this.position = { x, y, z };
    }
}

class FakeComponent {
    node!: FakeNode;
    isValid = true;
}

class FakeLabel extends FakeComponent {
    string = '';
    color = new FakeColor(255, 255, 255, 255);
}

class FakeSprite extends FakeComponent {
    static SizeMode = { CUSTOM: 0 };
    trim = true;
    sizeMode = 0;
    spriteFrame: unknown = null;
}

const SLOT = 'assets/script/app/main/MainResBarSlot.ts';

/** 把 `MainResBarSlot.ts` 转译后塞进沙箱（真代码，只有 `cc` 与取图那一层是桩）。 */
function loadSlotClass(): new () => {
    node: FakeNode;
    icon: FakeSprite;
    valueLabel: FakeLabel;
    plus: null;
    onLoad(): void;
    render(slot: unknown): void;
    step(dt: number): boolean;
    playGainFeedback(amount: number): void;
    playSpendFeedback(amount: number, valueText?: string): void;
    spendDeltaOf(valueText: string): number;
    cancelFeedback(): void;
    readonly isFeedbackPlaying: boolean;
} {
    const code = ts.transpileModule(readFileSync(SLOT, 'utf8'), {
        compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(code, {
        exports,
        require: (id: string) => {
            if (id === 'cc') {
                return {
                    _decorator: { ccclass: () => (target: unknown) => target, property: () => () => undefined },
                    Color: FakeColor,
                    Component: FakeComponent,
                    Label: FakeLabel,
                    Node: FakeNode,
                    Sprite: FakeSprite,
                    SpriteFrame: class {},
                };
            }
            // 曲线用**真模块**：模型改了这里立刻跟着变，不抄常量。
            if (id.endsWith('/MainResBarFeedback')) return feedback;
            // 取图那一层与本文件判据无关（沙箱里拿不到 assets）⇒ 给个永远不 resolve 的壳。
            if (id.endsWith('/MainResBarArt')) return { loadResBarSprite: () => Promise.resolve(null) };
            throw new Error(`Unexpected dependency: ${id}`);
        },
    });
    return exports.MainResBarSlot as never;
}

/** 造一个「label 已经是扣后值」的格子（实机就是这个顺序：`CmdRole` 先到）。 */
function makeSlot(initialText: string): {
    slot: ReturnType<typeof loadSlotClass> extends new () => infer T ? T : never;
    labelNode: FakeNode;
    iconNode: FakeNode;
} {
    const SlotClass = loadSlotClass();
    const slot = new SlotClass();
    slot.node = new FakeNode('Res0');
    slot.icon = new FakeSprite();
    slot.icon.node = new FakeNode('Icon');
    slot.valueLabel = new FakeLabel();
    slot.valueLabel.node = new FakeNode('Value');
    slot.valueLabel.node.position = { x: 0, y: -3, z: 0 };
    slot.onLoad();
    slot.render({ key: 'end', iconArt: '', valueText: initialText, showPlus: true });
    return { slot, labelNode: slot.valueLabel.node, iconNode: slot.icon.node };
}

test('★★★沙箱：先钉回扣前值 → 变红 + 跳 → 才滚下去（顺序反了这条会红）', () => {
    const { slot, labelNode } = makeSlot('137/30');
    assert.equal(slot.spendDeltaOf('137/30'), 0, '同一个值不是扣除');
    assert.equal(slot.spendDeltaOf('150/30'), 0, '涨了不是扣除（不该演红）');
    assert.equal(slot.spendDeltaOf('107/30'), 30, '降了 30 ⇒ 扣了 30');

    slot.playSpendFeedback(30, '107/30');
    // ① 第一帧：文本必须还是**扣前**值（实机 label 此前已被 CmdRole 写成 107）。
    assert.equal(slot.valueLabel.string, '137/30', '播扣除的第一帧就把数字改了 = 玩家看到"先扣再红"');
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '第 0 帧还没红');
    assert.equal(labelNode.position.y, -3, '起手不该已经跳起来');

    // ② 定格段中段：数字仍然不动，但已经红、已经跳。
    let elapsed = 0;
    const stepTo = (target: number): void => {
        while (elapsed < target) {
            elapsed += 1 / 60;
            slot.step(1 / 60);
        }
    };
    stepTo(RES_BAR_SPEND_HOLD_SECONDS * 0.5);
    assert.equal(slot.valueLabel.string, '137/30', '定格段内数字必须一动不动');
    assert.equal(slot.valueLabel.color.r, RES_BAR_SPEND_RED[0], '定格段里必须已经红到顶');
    assert.ok(labelNode.scale.x > 1, '数字要放大（跳）');
    assert.ok(labelNode.position.y > -3, '数字要往上跳');

    // ③ 扣减段结束：文本落到扣后值，一切复原。
    stepTo(RES_BAR_SPEND_SECONDS + 0.1);
    assert.equal(slot.valueLabel.string, '107/30', '收尾必须精确落在扣后值（含后缀）');
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '红色必须淡回常态色');
    assert.equal(labelNode.position.y, -3, '位移必须复原');
    assert.equal(labelNode.scale.x, 1);
    assert.equal(slot.isFeedbackPlaying, false);
    assert.equal(slot.spendDeltaOf('107/30'), 0, '落定后再比一次不该再判成扣除（否则会循环播）');
});

test('★★沙箱：扣的过程中 CmdRole 又推包 ⇒ 只暂存，收尾才落地（不许半路跳数）', () => {
    const { slot } = makeSlot('137/30');
    slot.playSpendFeedback(30, '107/30');
    for (let i = 0; i < 4; i += 1) slot.step(1 / 60);
    // 期间来了个更新的值（比如别的系统又改了体力）。
    slot.render({ key: 'end', iconArt: '', valueText: '100/30', showPlus: true });
    assert.notEqual(slot.valueLabel.string, '100/30', '反馈途中不许被推包改写');
    while (slot.step(1 / 60)) { /* 播完 */ }
    assert.equal(slot.valueLabel.string, '100/30', '收尾必须落到最新值');
});

test('★★沙箱：整格隐藏要把红字 / 位移一起复原（否则再显示时是一格红数字）', () => {
    const { slot, labelNode } = makeSlot('137/30');
    slot.playSpendFeedback(30, '107/30');
    for (let i = 0; i < 6; i += 1) slot.step(1 / 60);
    assert.notEqual(slot.valueLabel.color.r, 255, '先确认它确实红了');
    slot.render(null);
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '隐藏后必须复原常态色');
    assert.equal(labelNode.position.y, -3);
    assert.equal(slot.isFeedbackPlaying, false);
    // 重新显示：第一次渲染**不该**判成扣除（落定值已被清空）。
    slot.render({ key: 'end', iconArt: '', valueText: '50/30', showPlus: true });
    assert.equal(slot.spendDeltaOf('50/30'), 0);
});

test('★沙箱：加 / 扣两条时间轴互斥（后到的接管，前一条不许留在节点上）', () => {
    const { slot, iconNode } = makeSlot('100');
    slot.playSpendFeedback(30, '70');
    for (let i = 0; i < 3; i += 1) slot.step(1 / 60);
    slot.playGainFeedback(20);
    // 加的那条接管：数字从 90 滚到 100（扣那条被打断，红与位移已复原）。
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '切到"加"的时候红色必须撤掉');
    while (slot.step(1 / 60)) { /* 播完 */ }
    assert.equal(slot.valueLabel.string, '100');
    // 反向：加的播放途中来一次扣，扣接管。
    slot.playGainFeedback(20);
    slot.step(1 / 60);
    slot.playSpendFeedback(20, '80');
    assert.equal(slot.valueLabel.string, '100', '扣接管时先从扣前值（100）演');
    while (slot.step(1 / 60)) { /* 播完 */ }
    assert.equal(slot.valueLabel.string, '80');
    assert.equal(iconNode.scale.x, 1);
});

// ---------------------------------------------------------------------------
// ③ 源码契约：接线顺序与"唯一心跳"
// ---------------------------------------------------------------------------

test('★源码契约：`reload` 里「判扣除」必须排在 `render` 之前（顺序反了就演成"先扣再红"）', () => {
    const src = readFileSync('assets/script/app/common/ResBar.ts', 'utf8');
    // ⚠️ 这条守卫盯的是**唯一**的扣除入口：不在这里判，就得让每个花钱的地方各自调一次
    //   `playSpendFeedback`（漏一处就少一处反馈，而且零报错）。
    const start = src.indexOf('this.hostSlots().forEach');
    assert.ok(start > 0, '找不到逐格渲染那一段');
    const body = src.slice(start, start + 800);
    const spendAt = body.indexOf('slot.spendDeltaOf(');
    const renderAt = body.indexOf('slot.render(slots[i] ?? null)');
    assert.ok(spendAt > 0, '`reload` 里没有扣除检测 ⇒ 这条需求等于没接');
    assert.ok(renderAt > spendAt,
        '必须先判扣除再 render：反过来的话 label 已经被写成新值，动画只能"先扣再变红"');
    // 多余槽位仍要传 null（整格隐藏），这条是既有契约，别被上面的改动带塌。
    assert.match(body, /slot\.render\(slots\[i\] \?\? null\)/);
});

test('★源码契约：单格不许自己挂 update，也不许用 tween（心跳只在 `ResBar.update`）', () => {
    // 注释里会写「不用 tween」，所以先剥注释再判 —— 否则这条永远红。
    const slotSrc = readFileSync(SLOT, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.doesNotMatch(slotSrc, /^\s+update\s*\(/m, '槽位自己挂 update ⇒ 一条栏会有 N 个心跳，时序必然打架');
    assert.doesNotMatch(slotSrc, /tween/i, '池化 / 复用的节点上挂 tween 会在回收后继续跑（规则 106/247）');
    // 收尾与中止都必须复原字色：这两处漏一处，资源栏就会留一格红数字。
    const restores = slotSrc.match(/this\.valueLabel\.color = new Color\(/g) ?? [];
    assert.ok(restores.length >= 3, `字色复原点只有 ${restores.length} 处（至少要：收尾 / 中止扣 / 切换）`);
});
