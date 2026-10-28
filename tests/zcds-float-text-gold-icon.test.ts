import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { loadViews } from './helpers/zcds-view-fixtures';

/**
 * 金币飘字的金币图标（2026-10-14 起，2026-10-23 两次改口径）。
 *
 * 口径：
 * · 只有 `gold` 飘字显示图标；伤害 / 治疗等一律隐藏（节点来自对象池，必须**每帧绝对赋值**，
 *   否则复用回来会残留上一条的可见状态）；
 * · 图标挂在 `Text` 节点下 ⇒ 位置与缩放自动跟随数字一起动；
 * · **图标居中压在落点上**（`x = y = 0`）—— 2026-10-23 起金币没有数字与加号了，
 *   没有文字可对齐，再按文字宽度往左偏只会让硬币凭空偏左；
 * · 自转在**掉落段**内转满一圈（屏幕平面内 `rotation.z`），落地即停。
 *
 * 2026-10-23 口径变更（同一天两轮）：
 *  ① 金币飘字从「上升 + 淡出」改成「掉落原地 + 迅速缩小消失」（`ZCGameViewUtil.floatTextGoldDrop`）；
 *  ② 移除金币的加号与数字 UI，落点改到**角色中心点**（`goldCenterY`）。
 */

const VIEW_PATH = 'assets/script/app/zcds/view/ZCFloatTextView.ts';
const PREFAB_PATH = 'assets/bundles/battle/ui/game/ZCGameFloatText.prefab';
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

test('图标居中压在落点上：没有数字可对齐，x/y 恒为 0（2026-10-23）', () => {
    const { view, iconPositions, uitClass } = createView();
    view.render(floatText('gold', 0.2), 0);
    const first = iconPositions[iconPositions.length - 1];
    // 数字与加号都移除了 ⇒ 硬币就是这条飘字的全部视觉，必须落在中心点上。
    assert.equal(first.x, 0, '硬币居中（原来按文字宽度推到左侧，现在没有文字可对齐）');
    assert.equal(first.y, 0, '垂直与落点对齐（下落由父节点 Text 承担）');

    // 文字宽度变化**不再**影响图标位置（以前 `-(宽/2 + 间距 + 半宽)` 会跟着跳）。
    (view.textLabel as unknown as { node: { getComponent: unknown } }).node.getComponent = (type: unknown) =>
        (type === uitClass ? { width: 120 } : null);
    view.render(floatText('gold', 0.2), 0);
    const wider = iconPositions[iconPositions.length - 1];
    assert.equal(wider.x, 0, '图标位置与数字宽度脱钩');
});

test('金币没有文字：加号与数字都不显示，且池复用后伤害数字能回来（2026-10-23）', () => {
    const { view } = createView();
    const label = view.textLabel as unknown as { string: string; enabled: boolean };

    view.render(floatText('gold', 0.2), 0);
    assert.equal(label.string, '', '金币不再拼「+」与数值');
    assert.equal(label.enabled, false, '数字 Label 必须关掉 —— 不能只把 alpha 压低');

    // 复用回伤害：文字与可见性都要恢复（对象池里上一帧的 false 不能残留）。
    view.render(floatText('damage', 0.2), 0);
    assert.equal(label.enabled, true, '伤害数字必须重新可见');
    assert.equal(label.string, '16', '伤害数字的文案照旧');
});

test('掉落途中绕自身旋转：掉落段（前 30%）转满一圈，落地后停住', () => {
    const { view, iconAngles, util } = createView();
    const span = util.FLOAT_TEXT_GOLD_DROP_SPAN as number;
    const angle = () => iconAngles[iconAngles.length - 1];
    view.render(floatText('gold', 0), 0);
    assert.equal(angle(), 0, '起步不预转');
    // 自转进度就是掉落进度（线性）：半程 180°。
    view.render(floatText('gold', span * 0.5), 0);
    assert.equal(angle(), 180);
    view.render(floatText('gold', span), 0);
    assert.equal(angle(), 360, '落地那一刻正好转满一圈');
    // 🔴 落地后必须**停住**：金币已经停在原地缩没了，图标还在转就是两个动作。
    for (const elapsed of [span + 0.05, span + 0.1, 1]) {
        view.render(floatText('gold', elapsed), 0);
        assert.equal(angle(), 360, `落地之后（t=${elapsed}）不该再转`);
    }
});

test('图标淡出与数字同步（Label 的 color.a 管不到独立 Sprite）', () => {
    const { view, iconNode, util } = createView();
    const opacity = () => iconNode.components[0].opacity as number;
    // 掉落 + 停住这两段恒满，只有在缩小段才跟着数字一起淡（判据取真曲线，不写死秒数）。
    const frame = (p: number) => util.floatTextGoldDrop(p);
    view.render(floatText('gold', 0.1), 0);
    assert.equal(opacity(), 255, '掉落途中不许变淡');
    view.render(floatText('gold', 0.4), 0);
    assert.equal(opacity(), 255, '落地停住那一段仍是全不透明');
    for (const progress of [0.6, 0.8, 0.95]) {
        view.render(floatText('gold', progress), 0);
        assert.equal(opacity(), Math.round(255 * frame(progress).fade),
            `t=${progress} 的透明度应等于缩小段的 fade`);
    }
    assert.ok(opacity() > 0, '缩小段中途还看得见（是"缩没"不是"提前透明"）');
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
