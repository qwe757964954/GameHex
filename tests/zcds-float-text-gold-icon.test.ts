import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 金币飘字左侧的金币图标（2026-10-14）。
 *
 * 口径：
 * · 只有 `gold` 飘字显示图标；伤害 / 治疗等一律隐藏（节点来自对象池，必须**每帧绝对赋值**，
 *   否则复用回来会残留上一条的可见状态）；
 * · 图标挂在 `Text` 节点下 ⇒ 位置与弹出缩放自动跟随数字一起上浮；
 * · 水平位置由数字**实际宽度**反推（`-(文字宽/2 + 间距 + 图标半宽)`），不用固定偏移 ——
 *   `+5` 与 `+1.2K` 宽度差一倍，固定偏移会让图标时而压在数字上、时而飘太远；
 * · 上升途中绕自身旋转（屏幕平面内 `rotation.z`），整条飘字正好 1 圈。
 */

const VIEW_PATH = 'assets/script/app/zcds/view/ZCFloatTextView.ts';
const PREFAB_PATH = 'assets/resources/ui/game/ZCGameFloatText.prefab';
/** `ZCFloatTextView` 的压缩 cid（= `.ts.meta` uuid 经 compressUuid）。 */
const VIEW_CID = '5f5d73+cpZKJaf1c3R7eavp';
const COIN_FRAME_UUID = 'b14fa327-8a00-4264-a31b-d71fb24ed3c0@f9941';

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
    // ⚠️ 曲线一律转发**真模块**：入场 / 淡出的真源在 `ZCGameViewUtil`，
    // 在桩里再实现一遍等于把「快进慢出」复制成两份 —— 源码改了用例还照样绿。
    // 只把坐标换算桩成恒等（本用例不验世界定位）。
    const util = loadViews().load('./ZCGameViewUtil');
    const loaded = { exports: {} as Record<string, any> };
    new Function('require', 'module', 'exports', compiled)((name: string) => {
        if (name === 'cc') return cc;
        assert.equal(name, './ZCGameViewUtil');
        return { ...util, mapToViewX: (x: number) => x, mapToViewY: (y: number) => y };
    }, loaded, loaded.exports);

    const iconPositions: Array<{ x: number; y: number }> = [];
    const iconAngles: number[] = [];
    const makeNode = () => {
        const components: any[] = [];
        return {
            components,
            getComponent: (type: unknown) => components.find((c) => c instanceof type) ?? null,
            addComponent: (type: any) => { const c = new type(); components.push(c); return c; },
        };
    };
    const textNode = Object.assign(makeNode(), {
        setPosition() {},
        setScale() {},
        getComponent(type: unknown) {
            // Text 的 UITransform：宽度模拟「引擎已在上一帧按文字内容刷新过」。
            if (type === UITransform) return { width: 40 };
            return null;
        },
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
        view, textNode, iconNode, iconPositions, iconAngles, uitClass: UITransform,
        entrance: util.FLOAT_TEXT_ENTRANCE_PROGRESS as number,
        util,
    };
}

/** 一条飘字；`durationSeconds` 1s，方便用秒数当进度。 */
function floatText(kind: string, elapsed: number) {
    return { id: 1, kind, owner: 'player', value: 16, x: 0, y: 0, startedAt: -elapsed, durationSeconds: 1 } as never;
}

test('只有金币飘字显示图标；伤害飘字一律隐藏（池复用不留残态）', () => {
    const { view } = createView();
    const enabled = () => (view.goldIcon as unknown as { enabled: boolean }).enabled;
    view.render(floatText('gold', 0.2), 0);
    assert.equal(enabled(), true, '金币飘字要显示图标');

    view.render(floatText('damage', 0.2), 0);
    assert.equal(enabled(), false, '伤害飘字不该挂着金币图标');

    // 复用回金币飘字：必须重新显形（上一帧的 false 不能残留）。
    view.render(floatText('critical', 0.2), 0);
    assert.equal(enabled(), false);
    view.render(floatText('gold', 0.2), 0);
    assert.equal(enabled(), true);
});

test('图标落在数字左侧，间距随数字宽度走（不是固定偏移）', () => {
    const { view, iconPositions, uitClass } = createView();
    view.render(floatText('gold', 0.2), 0);
    const first = iconPositions[iconPositions.length - 1];
    // -(40/2 + 4 + 15) = -39：直径 30 的图标整块落在文字左边缘之外。
    assert.equal(first.x, -39, '图标应在数字左侧（负 x）且不压住文字');
    assert.equal(first.y, 0, '垂直与数字居中（上浮由父节点 Text 承担）');

    // 文字变宽（+1234.5K）时图标同步左移。
    (view.textLabel as unknown as { node: { getComponent: unknown } }).node.getComponent = (type: unknown) =>
        (type === uitClass ? { width: 120 } : null);
    view.render(floatText('gold', 0.2), 0);
    const wider = iconPositions[iconPositions.length - 1];
    assert.ok(wider.x < first.x, `文字更宽时图标要更靠左（${wider.x} < ${first.x}）`);
    assert.equal(wider.x, -(120 / 2 + 4 + 15));
});

test('上升途中绕自身旋转：入场段内（前 45%）转满一圈，之后停住', () => {
    const { view, iconAngles, entrance } = createView();
    const angle = () => iconAngles[iconAngles.length - 1];
    view.render(floatText('gold', 0), 0);
    assert.equal(angle(), 0, '起步不预转');
    // 入场进度 = easeOutCubic(progress / entranceProgress)：半程处已走了 87.5%。
    view.render(floatText('gold', entrance * 0.5), 0);
    assert.equal(angle(), 315);
    view.render(floatText('gold', entrance), 0);
    assert.equal(angle(), 360, '入场段一结束就转满一圈（与上浮同步收住）');
    // 🔴 之后必须**停住**：上浮收进前 45%，自转若还铺满整条时长就会「数字停住、金币自己转」。
    for (const elapsed of [entrance + 0.1, 0.8, 1]) {
        view.render(floatText('gold', elapsed), 0);
        assert.equal(angle(), 360, `入场结束后（t=${elapsed}）不该再转`);
    }
});

test('图标淡出与数字同步（Label 的 color.a 管不到独立 Sprite）', () => {
    const { view, iconNode, entrance, util } = createView();
    const opacity = () => iconNode.components[0].opacity as number;
    // 入场段恒满，之后在剩下的时长里线性淡出（判据跟着 entrance 走，别写死 0.45/0.55）。
    view.render(floatText('gold', entrance), 0);
    assert.equal(opacity(), 255, '入场段不许同时变淡');
    // 期望值按真曲线算，不写死 128 —— `255 × 0.5` 的取整会随浮点尾数在 127/128 之间跳。
    const mid = entrance + (1 - entrance) * 0.5;
    view.render(floatText('gold', mid), 0);
    assert.equal(opacity(), Math.round(255 * util.floatTextFade(mid, entrance)), '慢出段中点约半透明（线性淡出）');
    assert.ok(opacity() > 0 && opacity() < 255, '尾段应与数字一起淡');
    view.render(floatText('gold', 1), 0);
    assert.equal(opacity(), 0, '结束时淡到 0，不能比数字多留一帧');
});

test('prefab：Prefix 前缀 Label 挂在 Text 下、绑定 prefixLabel，字号取数字的一半（2026-10-17）', () => {
    const prefab = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, any>>;
    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp, `prefab 上找不到 ZCFloatTextView 组件（cid=${VIEW_CID}）`);

    const ref = comp!.prefixLabel;
    assert.ok(ref?.__id__ !== undefined, 'prefixLabel 没绑 —— 暴击 / 克制 / 抵抗 / 秒杀 的前缀不会出现');
    const label = prefab[ref.__id__];
    assert.equal(label.__type__, 'cc.Label', 'prefixLabel 必须指向 Label 组件（指向节点是静默失效）');

    const node = prefab[label.node.__id__];
    assert.equal(node._name, 'Prefix');
    const parent = prefab[node._parent.__id__];
    assert.equal(parent._name, 'Text', 'Prefix 必须是 Text 的子节点 —— 才跟随上浮 / 散落 / 弹出缩放');
    assert.ok(parent._children.some((c: { __id__: number }) => c.__id__ === label.node.__id__),
        'Text 的 _children 里必须有 Prefix（漏了就不参与渲染）');

    // 15 = 数字 30 的一半（`PREFIX_FONT_RATIO = 0.5`）。
    assert.equal(label._fontSize, 15, '前缀字号必须是数字字号的一半');
    assert.equal(label._overflow, 0, '前缀也按内容自适应宽度，否则 UITransform 恒为容器宽');
    assert.equal(label._isBold, true, '与数字同为粗体，小字号才不糊');
    assert.equal(label._enableOutline, true, '小字号要靠描边压在战场地皮上');
});

test('prefab：GoldIcon 挂在 Text 下、绑定金币图、尺寸与数字相近', () => {
    const prefab = JSON.parse(readFileSync(PREFAB_PATH, 'utf8')) as Array<Record<string, any>>;
    const comp = prefab.find((o) => o?.__type__ === VIEW_CID);
    assert.ok(comp, `prefab 上找不到 ZCFloatTextView 组件（cid=${VIEW_CID}）`);

    const spriteRef = comp.goldIcon;
    assert.ok(spriteRef?.__id__ !== undefined, 'goldIcon 没绑 —— 金币飘字旁边不会有图标');
    const sprite = prefab[spriteRef.__id__];
    assert.equal(sprite.__type__, 'cc.Sprite', 'goldIcon 必须指向 Sprite 组件（指向节点是静默失效）');
    assert.equal(sprite._spriteFrame.__uuid__, COIN_FRAME_UUID, '应绑 icon_jinbi 的金币帧');
    assert.equal(sprite._sizeMode, 0, 'CUSTOM 尺寸：图标大小由 contentSize 定，不被原图 43×43 撑开');
    assert.equal(sprite._isTrimmedMode, false, 'CUSTOM 尺寸必须关掉 trimmed（否则尺寸被 trim 结果覆盖）');

    const iconNode = prefab[sprite.node.__id__];
    assert.equal(iconNode._name, 'GoldIcon');
    const textNode = prefab[iconNode._parent.__id__];
    assert.equal(textNode._name, 'Text', 'GoldIcon 必须是 Text 的子节点 —— 这样才自动跟随上浮与弹出缩放');
    assert.ok(textNode._children.some((c: { __id__: number }) => c.__id__ === sprite.node.__id__),
        'Text 的 _children 里必须有 GoldIcon（漏了就不参与渲染）');

    const uitRef = iconNode._components.find((c: { __id__: number }) => prefab[c.__id__].__type__ === 'cc.UITransform');
    const uit = prefab[uitRef.__id__];
    assert.deepEqual([uit._contentSize.width, uit._contentSize.height], [30, 30], '图标 30×30，与数字字号 30 相近');

    // Label 必须开成「按内容自适应宽度」，否则 UITransform 恒为容器宽 240、图标定位失准。
    const label = prefab.find((o) => o?.__type__ === 'cc.Label');
    assert.equal(label._overflow, 0, 'Text 的 overflow 应为 NONE（0），contentSize 才反映真实文字宽度');
});
