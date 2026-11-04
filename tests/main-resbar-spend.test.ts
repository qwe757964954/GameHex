/**
 * 资源栏「**扣除**」反馈：白色闪烁 → 跳一下 → **然后**才扣；上方同时飘一条 `-N`。
 *
 * 需求演进（两版）：
 *
 * | 日期 | 用户原话 | 落地 |
 * | :-- | :-- | :-- |
 * | 2026-11-02 | 「当发生资源扣除时，对应资源栏的数字显红，跳动再扣除」 | 数字**显红** + 跳，跳完才扣 |
 * | 2026-11-03 | 「1. 数字不显示红色，白色闪烁<br>2. 在资源栏的上方 2px 的位置，播放【-】符号和扣除数字 UI 一起上移消失的提示」 | 红 → **白色闪烁**（白度 + 透明度闪 2 下）+ 上方 `-N` 飘字 |
 *
 * 这条需求的**全部难点都在顺序上**，不在画面上：
 *
 *  · 数值真值来自 `CmdRole`，服务端一推、`ResBar.reload` 一跑，label 上就已经是**扣后**的值了
 *    ⇒ 什么都不做的话，玩家看到的是「数字直接掉下去、然后才闪一下」，与需求正好相反；
 *  · 所以这条反馈必须先把 label **钉回扣前值**、演完闪与跳，最后才滚到扣后值。
 *
 * 因此本文件分三层：
 *
 *  1. `resBarSpendFx` 的**曲线口径**（`countRatio` 在一段窗口内恒 0 是"跳完再扣"的机器证明）；
 *  2. `resBarSpendFloatFx` 的**飘字口径**（起点 2px、单调上移、尾巴淡没）；
 *  3. 把 `MainResBarSlot` 的真代码塞进沙箱（只有 `cc` 是桩），验**实际写出来的节点状态**：
 *     第一帧不许掉数字、白字要闪、飘字要出现并往上走、收尾要复原。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as feedback from '../assets/script/app/main/MainResBarFeedback';
import {
    RES_BAR_SPEND_BLINKS,
    RES_BAR_SPEND_BLINK_MIN_ALPHA,
    RES_BAR_SPEND_FLASH,
    RES_BAR_SPEND_FLASH_FADE_SECONDS,
    RES_BAR_SPEND_FLASH_RISE_SECONDS,
    RES_BAR_SPEND_FLASH_SECONDS,
    RES_BAR_SPEND_FLOAT_FADE_FROM,
    RES_BAR_SPEND_FLOAT_GAP,
    RES_BAR_SPEND_FLOAT_RISE,
    RES_BAR_SPEND_FLOAT_SECONDS,
    RES_BAR_SPEND_HOLD_SECONDS,
    RES_BAR_SPEND_ICON_POP,
    RES_BAR_SPEND_LABEL_POP,
    RES_BAR_SPEND_SECONDS,
    parseResBarCountText,
    resBarSpendFlashColor,
    resBarSpendFloatFx,
    resBarSpendFx,
} from '../assets/script/app/main/MainResBarFeedback';

// ---------------------------------------------------------------------------
// ① 曲线口径
// ---------------------------------------------------------------------------

test('时长常量：扣的反馈比加的**长**（它多一段「先不扣」的定格），但仍在 1s 量级', () => {
    assert.ok(RES_BAR_SPEND_SECONDS > feedback.RES_BAR_HIT_SECONDS,
        '扣除要多演一段「闪烁 + 跳」，不能比加还短');
    assert.ok(RES_BAR_SPEND_SECONDS > 0.6 && RES_BAR_SPEND_SECONDS <= 1.2, '再长就挡住玩家操作了');
    assert.equal(RES_BAR_SPEND_FLASH_SECONDS, RES_BAR_SPEND_HOLD_SECONDS,
        '闪烁必须在定格段内收掉 —— 数字一边滚一边闪，读数会被打断');
    assert.ok(RES_BAR_SPEND_FLASH_RISE_SECONDS < RES_BAR_SPEND_FLASH_SECONDS,
        '变白要在窗口内完成');
    assert.ok(RES_BAR_SPEND_FLASH_FADE_SECONDS < RES_BAR_SPEND_FLASH_SECONDS,
        '白度淡出窗口不能吃掉整个闪烁段');
    assert.ok(RES_BAR_SPEND_LABEL_POP > RES_BAR_SPEND_ICON_POP,
        '扣东西时玩家读的是数字 ⇒ 数字比图标的弹跳大一点');
    assert.equal(RES_BAR_SPEND_FLOAT_SECONDS, RES_BAR_SPEND_SECONDS,
        '飘字与扣除同一个窗口：数字落地的同时它正好飘没');
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
    assert.equal(first.whiteStrength, 0, '白是"渐变出来"的，第 0 帧还没白');
    assert.equal(first.labelAlpha, 1, '第 0 帧不许是半透明的（那会闪一下黑）');
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

test('白色闪烁：闪 BLINKS 下，窗口起止都是「全不透明」，最暗不低于常量', () => {
    // 起止必须是 1 —— 否则动画结束会把数字留在半透明状态（除非有归位帧，而本模块没有）。
    assert.equal(resBarSpendFx(0)!.labelAlpha, 1);
    assert.ok(Math.abs(resBarSpendFx(RES_BAR_SPEND_FLASH_SECONDS - 1e-9)!.labelAlpha - 1) < 1e-6,
        '闪烁窗口末尾必须回到全不透明');

    // 数一遍"暗下去"的次数：相邻两帧由降转升就是一个波谷。
    let dips = 0;
    let previous = 1;
    let previousDelta = 0;
    let darkest = 1;
    for (let i = 1; i <= 600; i += 1) {
        const fx = resBarSpendFx((RES_BAR_SPEND_FLASH_SECONDS * i) / 600)!;
        const delta = fx.labelAlpha - previous;
        if (previousDelta < 0 && delta >= 0) dips += 1;
        previousDelta = delta;
        previous = fx.labelAlpha;
        darkest = Math.min(darkest, fx.labelAlpha);
    }
    assert.equal(dips, RES_BAR_SPEND_BLINKS, `该闪 ${RES_BAR_SPEND_BLINKS} 下，实测 ${dips}`);
    assert.ok(Math.abs(darkest - RES_BAR_SPEND_BLINK_MIN_ALPHA) < 0.02,
        `最暗要到 ${RES_BAR_SPEND_BLINK_MIN_ALPHA}，实测 ${darkest}`);
    assert.ok(darkest > 0.15, '别把数字闪没 —— 玩家会以为这笔资源被扣光了');
});

test('白度：RISE 秒到 1、定格到窗口末尾前淡回 0；扣减段恒 0（不许一边滚一边变色）', () => {
    assert.equal(resBarSpendFx(0)!.whiteStrength, 0);
    assert.ok(Math.abs(resBarSpendFx(RES_BAR_SPEND_FLASH_RISE_SECONDS)!.whiteStrength - 1) < 1e-9,
        '变白要在 RISE 秒时到顶');
    const fadeStart = RES_BAR_SPEND_FLASH_SECONDS - RES_BAR_SPEND_FLASH_FADE_SECONDS;
    assert.equal(resBarSpendFx(fadeStart)!.whiteStrength, 1, '淡出之前要一直在白');
    assert.ok(resBarSpendFx(RES_BAR_SPEND_FLASH_SECONDS - 1e-6)!.whiteStrength < 0.02,
        '窗口闭合时必须几乎不白了');
    for (const t of [RES_BAR_SPEND_FLASH_SECONDS, RES_BAR_SPEND_HOLD_SECONDS + 0.1,
        RES_BAR_SPEND_SECONDS - 1e-6]) {
        assert.equal(resBarSpendFx(t)!.whiteStrength, 0, `扣减段 ${t}s 不该还在变色`);
    }
});

test('resBarSpendFlashColor：0 ⇒ 原色原样，1 ⇒ 纯白，中间线性，脏输入不产 NaN', () => {
    const base: [number, number, number] = [200, 120, 60];
    assert.deepEqual(resBarSpendFlashColor(base, 0), [200, 120, 60],
        'strength=0 必须**逐位**等于原色（否则收尾会对不上）');
    assert.deepEqual(resBarSpendFlashColor(base, 1), [...RES_BAR_SPEND_FLASH]);
    assert.deepEqual([...RES_BAR_SPEND_FLASH], [255, 255, 255], '目标色必须是纯白 —— 红已经被需求否掉了');
    const half = resBarSpendFlashColor(base, 0.5);
    assert.ok(half.every((channel, i) => channel > base[i] && channel < 255), '中间应该更白、但还没全白');
    // 越界 / 脏值一律夹紧，绝不把 `undefined` 混成 NaN（NaN 颜色会让 Label 静默变黑）。
    assert.deepEqual(resBarSpendFlashColor(base, -1), [200, 120, 60]);
    assert.deepEqual(resBarSpendFlashColor(base, 2), [...RES_BAR_SPEND_FLASH]);
    assert.deepEqual(resBarSpendFlashColor(base, Number.NaN), [200, 120, 60]);
    for (const channel of resBarSpendFlashColor([Number.NaN, -20, 400], 0.5)) {
        assert.ok(Number.isFinite(channel) && channel >= 0 && channel <= 255);
    }
    // 已经纯白的格子（资源栏就是）混完还是纯白 —— 所以"白"必须靠透明度来体现。
    assert.deepEqual(resBarSpendFlashColor([255, 255, 255], 0.3), [255, 255, 255]);
});

// ---------------------------------------------------------------------------
// ①' 飘字口径（需求第 2 条）
// ---------------------------------------------------------------------------

test('飘字：从「上沿 + 2px」起、单调上移、45% 后淡出，窗口闭合即 null', () => {
    assert.equal(RES_BAR_SPEND_FLOAT_GAP, 2, '需求原文就是 2px');
    assert.equal(resBarSpendFloatFx(-0.01), null);
    assert.equal(resBarSpendFloatFx(RES_BAR_SPEND_FLOAT_SECONDS), null, '窗口闭合后必须 null（视图据此藏节点）');

    const first = resBarSpendFloatFx(0)!;
    assert.equal(first.rise, 0, '起手压在上沿 + 2px 处，不许先弹一下');
    assert.equal(first.alpha, 1, '起手要看得清');

    let previous = -1;
    let previousAlpha = 2;
    for (let i = 0; i < 300; i += 1) {
        const p = i / 300;
        const fx = resBarSpendFloatFx(RES_BAR_SPEND_FLOAT_SECONDS * p)!;
        assert.ok(fx.rise >= previous - 1e-9, `上移回头了（p=${p}）`);
        assert.ok(fx.alpha <= previousAlpha + 1e-9, `淡出回头了（p=${p}）`);
        previous = fx.rise;
        previousAlpha = fx.alpha;
    }
    const last = resBarSpendFloatFx(RES_BAR_SPEND_FLOAT_SECONDS - 1e-6)!;
    assert.ok(last.rise > RES_BAR_SPEND_FLOAT_RISE * 0.99, '收尾要飘满整个距离');
    assert.ok(last.alpha < 0.02, '收尾必须几乎看不见了');
    assert.equal(resBarSpendFloatFx(RES_BAR_SPEND_FLOAT_SECONDS * RES_BAR_SPEND_FLOAT_FADE_FROM)!.alpha, 1,
        '淡出之前保持全不透明（那是给玩家读的窗口）');
});

test('飘字文本：`-` + 扣除数字，不带千分位（与资源栏自身同口径）', () => {
    assert.equal(feedback.formatResBarSpendFloat(30), '-30');
    assert.equal(feedback.formatResBarSpendFloat(1234), '-1234', '别加逗号：上下两处排版要一致');
    assert.equal(feedback.formatResBarSpendFloat(-30), '-30', '传负数也只输出一个减号');
    assert.equal(feedback.formatResBarSpendFloat(0.4), '-0');
    assert.equal(feedback.formatResBarSpendFloat(Number.NaN), '-0');
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
    isValid = true;
    children: FakeNode[] = [];
    position = { x: 0, y: 0, z: 0 };
    scale = { x: 1, y: 1, z: 1 };
    readonly components: FakeComponent[] = [];
    private attachedTo: FakeNode | null = null;
    constructor(name = '') {
        this.name = name;
    }
    get parent(): FakeNode | null {
        return this.attachedTo;
    }
    set parent(value: FakeNode | null) {
        this.attachedTo = value;
        if (value && !value.children.includes(this)) value.children.push(this);
    }
    setScale(x: number, y: number, z = 1): void {
        this.scale = { x, y, z };
    }
    setPosition(x: number, y: number, z = 0): void {
        this.position = { x, y, z };
    }
    /** 飘字节点是运行时 `new Node()` + `addComponent` 建的 ⇒ 桩必须支持这两条。 */
    addComponent<T extends FakeComponent>(Type: new () => T): T {
        const component = new Type();
        component.node = this;
        this.components.push(component);
        return component;
    }
    getComponent<T extends FakeComponent>(Type: new () => T): T | null {
        return (this.components.find((item) => item instanceof Type) as T | undefined) ?? null;
    }
}

class FakeComponent {
    node!: FakeNode;
    isValid = true;
}

class FakeUITransform extends FakeComponent {
    width = 132;
    height = 40;
    anchorX = 0.5;
    anchorY = 0.5;
    setAnchorPoint(x: number, y: number): void {
        this.anchorX = x;
        this.anchorY = y;
    }
}

class FakeLabelOutline extends FakeComponent {
    color = new FakeColor(0, 0, 0, 255);
    width = 0;
}

class FakeLabel extends FakeComponent {
    static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
    string = '';
    color = new FakeColor(255, 255, 255, 255);
    // 飘字会照抄数字那一格的排版，这些字段必须可写（桩里只管接住，不校验）。
    useSystemFont = true;
    font: unknown = null;
    fontFamily = 'Arial';
    fontSize = 22;
    lineHeight = 24;
    isBold = false;
    isItalic = false;
    horizontalAlign = 2;
    verticalAlign = 1;
    enableWrapText = false;
    overflow = 2;
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
                    LabelOutline: FakeLabelOutline,
                    Node: FakeNode,
                    Sprite: FakeSprite,
                    SpriteFrame: class {},
                    UITransform: FakeUITransform,
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
    /** 上方飘字节点（还没播过扣除时是 `undefined`：它是懒建的）。 */
    floatNode: () => FakeNode | undefined;
    floatLabel: () => FakeLabel | undefined;
} {
    const SlotClass = loadSlotClass();
    const slot = new SlotClass();
    slot.node = new FakeNode('Res0');
    // 槽位 132×40 ⇒ 上沿在 y=+20；飘字起点 = 20 + 2 = 22。
    slot.node.addComponent(FakeUITransform);
    slot.icon = new FakeSprite();
    slot.icon.node = new FakeNode('Icon');
    slot.valueLabel = new FakeLabel();
    slot.valueLabel.node = new FakeNode('Value');
    slot.valueLabel.node.position = { x: 25.5, y: -3, z: 0 };
    slot.onLoad();
    slot.render({ key: 'end', iconArt: '', valueText: initialText, showPlus: true });
    const floatNode = (): FakeNode | undefined => slot.node.children.find((child) => child.name === 'SpendFloat');
    return {
        slot,
        labelNode: slot.valueLabel.node,
        iconNode: slot.icon.node,
        floatNode,
        floatLabel: () => floatNode()?.getComponent(FakeLabel) ?? undefined,
    };
}

test('★★★沙箱：先钉回扣前值 → 白闪 + 跳 + 上方飘字 → 才滚下去（顺序反了这条会红）', () => {
    const { slot, labelNode, floatNode, floatLabel } = makeSlot('137/30');
    assert.equal(slot.spendDeltaOf('137/30'), 0, '同一个值不是扣除');
    assert.equal(slot.spendDeltaOf('150/30'), 0, '涨了不是扣除（不该演闪）');
    assert.equal(slot.spendDeltaOf('107/30'), 30, '降了 30 ⇒ 扣了 30');
    assert.equal(floatNode(), undefined, '还没播扣除时不许先把飘字节点建出来');

    slot.playSpendFeedback(30, '107/30');
    // ① 第一帧：文本必须还是**扣前**值（实机 label 此前已被 CmdRole 写成 107）。
    assert.equal(slot.valueLabel.string, '137/30', '播扣除的第一帧就把数字改了 = 玩家看到"先扣再闪"');
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '第 0 帧还没开始闪');
    assert.equal(labelNode.position.y, -3, '起手不该已经跳起来');

    // ①' 飘字同时出现：压在「资源栏上沿 + 2px」，与数字同一列，文本是 `-30`。
    const float = floatNode();
    assert.ok(float, '播扣除必须建出飘字节点');
    assert.equal(float!.active, true, '飘字要立刻可见');
    assert.equal(floatLabel()?.string, '-30', '文本 = 【-】符号 + 扣除数字');
    assert.equal(float!.position.y, 20 + RES_BAR_SPEND_FLOAT_GAP,
        '起点必须是槽位上沿（半高 20）+ 2px，低了就压在数字上');
    assert.equal(float!.position.x, 25.5, '飘字要与数字同一列（读的是"哪个数字扣了多少"）');

    // ② 定格段：数字仍然不动，但已经在闪、在跳；飘字在往上走。
    let elapsed = 0;
    const stepTo = (target: number): void => {
        while (elapsed < target) {
            elapsed += 1 / 60;
            slot.step(1 / 60);
        }
    };
    stepTo(RES_BAR_SPEND_FLASH_SECONDS * 0.25);
    assert.equal(slot.valueLabel.string, '137/30', '定格段内数字必须一动不动');
    assert.ok(slot.valueLabel.color.a < 200, `闪烁时必须看得见透明度在掉，实测 a=${slot.valueLabel.color.a}`);
    assert.equal(slot.valueLabel.color.r, 255, '不允许再出现红色（需求第 1 条）');
    assert.ok(labelNode.scale.x > 1, '数字要放大（跳）');
    assert.ok(labelNode.position.y > -3, '数字要往上跳');
    assert.ok(float!.position.y > 20 + RES_BAR_SPEND_FLOAT_GAP, '飘字要往上走');

    // ③ 扣减段结束：文本落到扣后值，一切复原，飘字收起。
    stepTo(RES_BAR_SPEND_SECONDS + 0.1);
    assert.equal(slot.valueLabel.string, '107/30', '收尾必须精确落在扣后值（含后缀）');
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '白闪必须收回常态色 + 全不透明');
    assert.equal(labelNode.position.y, -3, '位移必须复原');
    assert.equal(labelNode.scale.x, 1);
    assert.equal(float!.active, false, '飘字必须收起来（不然它会一直挂在资源栏上方）');
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

test('★★沙箱：整格隐藏要把白闪 / 位移 / 飘字一起复原（否则再显示时是一格半透明数字）', () => {
    const { slot, labelNode, floatNode } = makeSlot('137/30');
    slot.playSpendFeedback(30, '107/30');
    for (let i = 0; i < 6; i += 1) slot.step(1 / 60);
    assert.ok(slot.valueLabel.color.a < 255, '先确认它确实在闪');
    assert.equal(floatNode()?.active, true, '先确认飘字确实在飘');
    slot.render(null);
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '隐藏后必须复原常态色 + 全不透明');
    assert.equal(labelNode.position.y, -3);
    assert.equal(floatNode()?.active, false, '隐藏后飘字也必须收掉');
    assert.equal(slot.isFeedbackPlaying, false);
    // 重新显示：第一次渲染**不该**判成扣除（落定值已被清空）。
    slot.render({ key: 'end', iconArt: '', valueText: '50/30', showPlus: true });
    assert.equal(slot.spendDeltaOf('50/30'), 0);
});

test('★沙箱：加 / 扣两条时间轴互斥（后到的接管，前一条不许留在节点上）', () => {
    const { slot, iconNode, floatNode } = makeSlot('100');
    slot.playSpendFeedback(30, '70');
    for (let i = 0; i < 3; i += 1) slot.step(1 / 60);
    slot.playGainFeedback(20);
    // 加的那条接管：数字从 90 滚到 100（扣那条被打断，闪与位移、飘字都已复原）。
    assert.equal(slot.valueLabel.color.toString(), '255,255,255,255', '切到"加"的时候白闪必须撤掉');
    assert.equal(floatNode()?.active, false, '切到"加"的时候飘字必须收掉');
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

test('★源码契约：`reload` 里「判扣除」必须排在 `render` 之前（顺序反了就演成"先扣再闪"）', () => {
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
        '必须先判扣除再 render：反过来的话 label 已经被写成新值，动画只能"先扣再闪"');
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
