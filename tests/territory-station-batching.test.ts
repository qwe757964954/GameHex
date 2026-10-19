/**
 * `TerritoryStationView` 的三条硬约束：
 *  1. 四个视觉节点必须 reparent 到**共享 layer** 上（合批），并保留 prefab 的偏移；
 *  2. 未解锁格「银币图标 ×1.1 / 数值 ×1.5 / 间距恒 2px」的成对排布；
 *  3. 切 tab 销毁页面时，`cc.Button` 先于本组件被 `_destruct()`（`onDestroy` 不许抛）。
 *
 * ⚠️ VM 夹具（Fake* / loader）已挪到 `tests/helpers/territory-station-fixtures.ts` ——
 *    2026-10-16 的建筑生成抖动用例（`territory-building-shake.test.ts`）要吃同一套桩。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    FakeButton,
    FakeColor,
    FakeLabel,
    FakeNode,
    FakeSprite,
    attach,
    loadTerritoryStationView,
    withTransform,
    type StationLayers,
    type StationView,
} from './helpers/territory-station-fixtures';

/** 本文件只关心「节点摆放 + 排布」，名字沿用旧调用点。 */
const loadStationView = loadTerritoryStationView;

test('station visuals move into contiguous global render layers and preserve prefab offsets', () => {
    const View = loadStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = withTransform(attach(new FakeNode('Icon'), root, 0, 0), 128, 128);
    const caption = withTransform(attach(new FakeNode('CaptionBg'), root, 0, 52), 40, 40);
    const text = withTransform(attach(new FakeNode('CaptionLabel'), root, 0, 52), 92, 28);
    const badge = attach(new FakeNode('BadgeLabel'), root, 35, 35);
    const button = new FakeButton();
    button.node = root;
    const iconSprite = new FakeSprite();
    iconSprite.node = icon;
    const captionSprite = new FakeSprite();
    captionSprite.node = caption;
    const captionFrame = { name: 'caption background' };
    captionSprite.spriteFrame = captionFrame;
    const captionLabel = new FakeLabel();
    captionLabel.node = text;
    const badgeLabel = new FakeLabel();
    badgeLabel.node = badge;
    Object.assign(view, {
        node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel,
        iconTransform: icon.uiTransform,
        captionIconTransform: caption.uiTransform,
        captionTextTransform: text.uiTransform,
    });

    const layers: StationLayers = {
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    };
    view.initialize(layers);
    view.initialize(layers);
    view.setMapPosition(100, 200, 0);
    const tint = new FakeColor(20, 40, 60, 255);
    view.render({ site: {}, icon: {}, caption: '关卡 1', tint, badge: '锁', interactive: false });

    assert.equal(root.parent, layers.hit);
    assert.equal(icon.parent, layers.icon);
    assert.equal(caption.parent, layers.caption);
    assert.equal(text.parent, layers.text);
    assert.equal(badge.parent, layers.badge);
    assert.deepEqual([root.position.x, root.position.y], [100, 200]);
    assert.deepEqual([caption.position.x, caption.position.y], [100, 252]);
    assert.deepEqual([badge.position.x, badge.position.y], [135, 235]);
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 1, 'initialize must be idempotent');
    assert.equal(captionSprite.color, tint);
    assert.equal(captionLabel.string, '关卡 1');
    assert.equal(caption.active, false, 'building art hides its name background');
    assert.equal(text.active, false, 'building art hides its name');
    assert.equal(badge.active, false, 'building art hides its badge');
    assert.equal(button.interactable, false);
    const silverIcon = { name: 'silver' };
    const red = new FakeColor(230, 30, 24, 255);
    view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
        conditionTextColor: red, caption: '399', tint, badge: '', interactive: false });
    assert.equal(iconSprite.enabled, false);
    assert.equal(captionSprite.spriteFrame, silverIcon);
    assert.equal(captionSprite.type, FakeSprite.Type.SIMPLE);
    assert.equal(caption.active, true, 'locked condition restores the cost icon');
    assert.equal(text.active, true, 'locked condition restores the cost value');
    // 条件格的位置现在**按实测文本宽算**（图标 ×1.1、数值 ×1.5、间距 2px），不再是两个固定偏移。
    // 这一帧 Label 的宽还是 prefab 出厂宽 92 ⇒ 视图按「引擎还没量过」退回**按位数估**的宽
    // （「399」3 位 ⇒ 28.5）⇒ 数值可见宽 42.75、图标可见宽 44、总宽 88.75
    // ⇒ 图标中心 100−44.375+22、数值中心 100+44.375−21.375。
    // 完整的不变量（间距恒 2px、与位数无关、出厂宽的处理）在下面那条用例里。
    // ⚠️ 用容差而不是 `deepEqual`：`40 × 1.1` 在浮点下不是精确的 44。
    assert.ok(Math.abs(caption.position.x - 77.625) < 1e-9, `图标中心应在 77.625，实际 ${caption.position.x}`);
    assert.deepEqual([caption.position.y], [200]);
    assert.ok(Math.abs(text.position.x - 123) < 1e-9, `数值中心应在 123，实际 ${text.position.x}`);
    assert.deepEqual([text.position.y], [200]);
    assert.deepEqual([caption.scale.x, caption.scale.y], [1.1, 1.1]);
    assert.deepEqual([text.scale.x, text.scale.y], [1.5, 1.5]);
    assert.equal(captionLabel.overflow, FakeLabel.Overflow.NONE);
    assert.equal(captionLabel.color, red);
    view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
        caption: '', tint, badge: '', interactive: false, isLoading: true });
    assert.equal(caption.active, false, 'pending cell hides the cost icon');
    assert.equal(text.active, false, 'pending cell hides the cost text');
    assert.equal(button.interactable, false);
    view.render({ site: {}, icon: {}, caption: '资源点', tint, badge: '可领取', interactive: true });
    assert.equal(caption.active, false, 'opening a condition cell hides the cost icon under building art');
    assert.equal(text.active, false, 'opening a condition cell hides the cost value under building art');
    assert.equal(badge.active, false, 'opening a condition cell hides the badge under building art');
    view.render({ site: {}, icon: null, caption: '待配置', tint, badge: '', interactive: true });
    assert.equal(captionSprite.spriteFrame, captionFrame, 'reused caption must regain its normal frame');
    assert.equal(captionSprite.type, FakeSprite.Type.SLICED);
    assert.equal(caption.active, true, 'missing art retains the text fallback');
    assert.equal(text.active, true, 'missing art retains the text fallback');
    assert.deepEqual([caption.position.x, caption.position.y], [100, 252]);
    assert.deepEqual([text.position.x, text.position.y], [100, 252]);
    // 池化复用的硬要求：退出条件模式必须把「放大」与「overflow = NONE」都还给 prefab 原值，
    // 否则下一个借到这个节点的名称格会莫名放大、且盒子不再受 SHRINK 保护。
    assert.deepEqual([caption.scale.x, caption.scale.y], [1, 1]);
    assert.deepEqual([text.scale.x, text.scale.y], [1, 1]);
    assert.equal(captionLabel.overflow, FakeLabel.Overflow.SHRINK);
    assert.ok(captionLabel.color.equals(new FakeColor(62, 43, 30, 255)));
    assert.equal(iconSprite.enabled, false);
    assert.equal(badgeLabel.node.active, false);

    view.dispose();
    view.dispose();
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 0);
    for (const node of [icon, caption, text, badge]) assert.equal(node.destroyCount, 1);
    assert.equal(root.destroyCount, 0, 'owner destroys the station hit root');
});

/**
 * 未解锁格「银币图标 + 数值」的排布口径（2026-10-16 冒险模块 UI 优化）：
 * **图标 ×1.1、数字 ×1.5、两者间距恒 2px**。
 *
 * 这里钉的不是「某两个固定坐标」——那正是旧实现的写法（`−24` / `+22`），间距会随位数漂。
 * 钉的是**不变量**：
 *   1. 数值左缘 − 图标右缘 === 2（对 1 / 3 / 5 位数都成立）；
 *   2. 这一对**以格心为中心**（总数位变化时整体不漂，只是图标往左让位）；
 *   3. 缩放与 `overflow` 在退出条件模式时全部还原（站点节点池化复用）。
 *
 * ⚠️ 引擎按文本刷新 `contentSize` 有**一帧延迟**，用例里靠改 `FakeUITransform.contentSize.width`
 * 来模拟「引擎已经把实测文本宽写回来了」；把宽留在 prefab 出厂值 92 就是「还没量过」那一帧。
 */
test('locked-cell cost shows icon ×1.1 / value ×1.5 with a constant 2px gap, centered on the cell', () => {
    const View = loadStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = withTransform(attach(new FakeNode('Icon'), root, 0, 0), 128, 128);
    const caption = withTransform(attach(new FakeNode('CaptionBg'), root, 0, 52), 40, 40);
    const text = withTransform(attach(new FakeNode('CaptionLabel'), root, 0, 52), 92, 28);
    const badge = attach(new FakeNode('BadgeLabel'), root, 35, 35);
    const button = new FakeButton();
    button.node = root;
    const iconSprite = new FakeSprite();
    iconSprite.node = icon;
    const captionSprite = new FakeSprite();
    captionSprite.node = caption;
    const captionLabel = new FakeLabel();
    captionLabel.node = text;
    const badgeLabel = new FakeLabel();
    badgeLabel.node = badge;
    Object.assign(view, {
        node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel,
        iconTransform: icon.uiTransform,
        captionIconTransform: caption.uiTransform,
        captionTextTransform: text.uiTransform,
    });
    view.initialize({
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    });
    view.setMapPosition(100, 200, 0);

    const tint = new FakeColor(20, 40, 60, 255);
    const silverIcon = { name: 'silver' };
    const ICON_BASE_WIDTH = 40;
    const ICON_SCALE = 1.1;
    const VALUE_SCALE = 1.5;
    const GAP = 2;
    const iconWidth = ICON_BASE_WIDTH * ICON_SCALE;

    /** 按「引擎量到的文本宽」渲染一格条件，并返回两个节点的可见区间。 */
    const renderCondition = (measuredTextWidth: number, captionText: string) => {
        text.uiTransform!.contentSize.width = measuredTextWidth;
        view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
            conditionTextColor: tint, caption: captionText, tint, badge: '', interactive: false });
        const valueWidth = measuredTextWidth * VALUE_SCALE;
        return {
            iconLeft: caption.position.x - iconWidth / 2,
            iconRight: caption.position.x + iconWidth / 2,
            valueLeft: text.position.x - valueWidth / 2,
            valueRight: text.position.x + valueWidth / 2,
        };
    };

    // `fontSize 17`（Arial，数字等宽 0.556em ⇒ 每位 9.45px）下 1 / 3 / 5 位数字的近似实测宽。
    // 这里故意用 `位数 × 9.5`（= 视图兜底用的 `CONDITION_DIGIT_WIDTH`），下面才好直接对照。
    for (const [measured, captionText] of [[9.5, '9'], [28.5, '399'], [47.5, '12000']] as const) {
        const box = renderCondition(measured, captionText);
        assert.ok(Math.abs(box.valueLeft - box.iconRight - GAP) < 1e-9,
            `「${captionText}」的数值左缘应距图标右缘 ${GAP}px，实际 ${box.valueLeft - box.iconRight}`);
        assert.ok(Math.abs((box.iconLeft + box.valueRight) / 2 - 100) < 1e-9,
            `「${captionText}」这一对应以格心为中心`);
        assert.deepEqual([caption.position.y, text.position.y], [200, 200], '纵向仍在格心');
        assert.deepEqual([caption.scale.x, caption.scale.y], [ICON_SCALE, ICON_SCALE]);
        assert.deepEqual([text.scale.x, text.scale.y], [VALUE_SCALE, VALUE_SCALE]);
        assert.equal(captionLabel.overflow, FakeLabel.Overflow.NONE, '量文本必须先把盒子切成 NONE');
    }

    // 「这一对以格心为中心」的另一种说法：数字越长，图标越往左让位，而数值**左缘**始终贴着图标。
    // 位数变化时数值中心相对格心恒定在 `(图标宽 + 间距) / 2`。
    const oneDigit = renderCondition(9.5, '9');
    const fiveDigits = renderCondition(47.5, '12000');
    assert.ok(oneDigit.iconLeft > fiveDigits.iconLeft, '位数变多 ⇒ 图标往左让位');
    assert.ok(Math.abs((oneDigit.valueLeft + oneDigit.valueRight) / 2 - (100 + (iconWidth + GAP) / 2)) < 1e-9);
    assert.ok(Math.abs((fiveDigits.valueLeft + fiveDigits.valueRight) / 2 - (oneDigit.valueLeft + oneDigit.valueRight) / 2) < 1e-9,
        '数值中心与位数无关');

    // 引擎还没量过的那一帧：读到的还是 prefab 出厂宽 92 ⇒ 按**位数**估宽（3 位 ⇒ 28.5，
    // 真值 3×17×0.556 = 28.36，差 0.15px）。把 92 当成真实文本宽会把图标推到格子外面去。
    const stubFrame = renderCondition(92, '399');
    const measuredFrame = renderCondition(28.5, '399');
    assert.ok(Math.abs(stubFrame.iconLeft - measuredFrame.iconLeft) < 1e-9,
        '出厂宽必须按「还没量过」处理、按位数估，而不是当成真实文本宽');

    // 每秒一次的 `setMapPosition`（地图滑动 / 刷新）之后口径必须一致，否则这一对会「归位」到旧坐标。
    const valueWidth = 28.5 * VALUE_SCALE;
    view.render({ site: null, icon: null, isCondition: true, conditionIcon: silverIcon,
        conditionTextColor: tint, caption: '399', tint, badge: '', interactive: false });
    view.setMapPosition(300, 400, 0);
    const iconRight = caption.position.x + iconWidth / 2;
    const valueLeft = text.position.x - valueWidth / 2;
    assert.ok(Math.abs(valueLeft - iconRight - GAP) < 1e-9, '滑动后间距仍是 2px');
    assert.ok(Math.abs((caption.position.x - iconWidth / 2 + text.position.x + valueWidth / 2) / 2 - 300) < 1e-9,
        '滑动后仍以新格心为中心');
    assert.deepEqual([caption.position.y, text.position.y], [400, 400]);
});

/**
 * 回归：切 tab 销毁页面时，站点节点上的 `cc.Button` 排在 `TerritoryStationView` **之前**
 * 被引擎 `_destruct()`（prefab `_components` 数组序：UITransform → Sprite → cc.Button → 本脚本），
 * 于是 `Button.node` 已被置 `null`。此时 `onDestroy` 里若再 `button.node.off(...)` 就会抛
 * `Cannot read properties of null (reading 'off')`，异常打断组件销毁循环还会连带刷
 * 「destroy an object twice or more」。这里按引擎的销毁序复现并断言不抛。
 */
test('station survives the engine destroy order where cc.Button is destructed before the view', () => {
    const View = loadStationView();
    const view = new View();
    const root = new FakeNode('TerritoryStation');
    const icon = attach(new FakeNode('Icon'), root, 0, 0);
    const caption = attach(new FakeNode('CaptionBg'), root, 0, 52);
    const text = attach(new FakeNode('CaptionLabel'), root, 0, 52);
    const badge = attach(new FakeNode('BadgeLabel'), root, 35, 35);
    const button = new FakeButton();
    button.node = root;
    const iconSprite = new FakeSprite();
    iconSprite.node = icon;
    const captionSprite = new FakeSprite();
    captionSprite.node = caption;
    const captionLabel = new FakeLabel();
    captionLabel.node = text;
    const badgeLabel = new FakeLabel();
    badgeLabel.node = badge;
    Object.assign(view, {
        node: root, button, iconSprite, captionSprite, captionLabel, badgeLabel,
        iconTransform: icon.uiTransform,
        captionIconTransform: caption.uiTransform,
        captionTextTransform: text.uiTransform,
    });

    const layers: StationLayers = {
        icon: new FakeNode('StationIconLayer'),
        caption: new FakeNode('StationCaptionLayer'),
        text: new FakeNode('StationTextLayer'),
        badge: new FakeNode('StationBadgeLayer'),
        hit: new FakeNode('StationHitLayer'),
    };
    view.initialize(layers);
    assert.equal(root.listenerCount(FakeButton.EventType.CLICK), 1);

    // 引擎销毁序：先跑 cc.Button 的 _destruct()，Component.node 被重置为 null。
    button.node = null;

    assert.doesNotThrow(() => view.onDestroy());
    for (const node of [icon, caption, text, badge]) {
        assert.equal(node.destroyCount, 0, 'shared-layer visuals are destroyed with the page, not by the station');
    }
});
