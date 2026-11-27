/**
 * 装备锻造属性行（`EquipEvolveAttrItem`）的显隐与整行排版口径。
 *
 * 背景：改版前的升品行只建了名字与数值列，当前 `EquipEvolve.prefab` 四行均带四列，
 * 组件仍保留 `nextLabel` / `arrowNode` 可空兼容并统一做同帧测宽与列防撞顺排：
 *  - 没有「下一级」列时不抛错、也不显示孤立箭头；
 *  - 传 `next`（含 `0`）才显示下一级与箭头，传 `undefined` / `null` 则隐藏；
 *  - 隐藏后再次传 `next` 能重新显示（行被复用时靠自身幂等，不靠外部激活）；
 *  - 当前值支持 `anchorX = 0 / 1`，按实测名称宽度右扩，越过箭头原位时顺推箭头与下一级并可回弹。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { ccStub, loadTsModule } from './helpers/cc-sandbox';

class FakeUITransform {
    width = 0;
    height = 24;
    anchorX = 0;
}

class FakeNode {
    active = true;
    position = { x: 0, y: 0, z: 0 };
    uiTransform = new FakeUITransform();
    getComponent(type: unknown): FakeUITransform | null {
        return type === FakeUITransform ? this.uiTransform : null;
    }
    setPosition(x: number, y: number, z = 0): void {
        this.position = { x, y, z };
    }
}

class FakeLabel {
    static HorizontalAlign = { LEFT: 0, CENTER: 1, RIGHT: 2 };
    static Overflow = { NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 };
    string = '';
    horizontalAlign = FakeLabel.HorizontalAlign.RIGHT;
    overflow = FakeLabel.Overflow.NONE;
    node = new FakeNode();

    /** 仅在 `Overflow.NONE` 下按汉字 24px、半角 12px 模拟实测宽度；CLAMP 保持序列化宽度。 */
    updateRenderData(): void {
        if (this.overflow !== FakeLabel.Overflow.NONE) return;
        let width = 0;
        for (const ch of this.string) width += ch.charCodeAt(0) > 0x2e80 ? 24 : 12;
        this.node.uiTransform.width = width;
    }
}

class FakeComponent {
    node = new FakeNode();
}

interface IAttrItem extends FakeComponent {
    nameLabel: FakeLabel;
    curLabel: FakeLabel;
    nextLabel: FakeLabel | null;
    arrowNode: FakeNode | null;
    setData(name: string, cur: string | number, next?: string | number): void;
}

const { exports, unresolved } = loadTsModule<{ EquipEvolveAttrItem: new () => IAttrItem }>(
    'assets/script/app/role/EquipEvolveAttrItem.ts',
    { modules: { cc: ccStub({ Component: FakeComponent, Label: FakeLabel, Node: FakeNode, UITransform: FakeUITransform }) } },
);
assert.deepEqual(unresolved, [], '桩表应覆盖该组件的全部依赖');

/** `withNextColumns=false` 对应升品行：Prefab 里没有箭头与下一级节点。 */
function createItem(withNextColumns: boolean): IAttrItem {
    const item = new exports.EquipEvolveAttrItem();
    item.nameLabel = new FakeLabel();
    item.curLabel = new FakeLabel();
    // 对齐 Prefab `Cur`：x=95、宽 96、右对齐、CLAMP —— 数值列右缘 191。
    item.curLabel.overflow = FakeLabel.Overflow.CLAMP;
    item.curLabel.node.position.x = 95;
    item.curLabel.node.uiTransform.width = 96;
    if (withNextColumns) {
        item.nextLabel = new FakeLabel();
        item.nextLabel.node.position.x = 420;
        item.arrowNode = new FakeNode();
        item.arrowNode.position.x = 323;
        item.arrowNode.uiTransform.width = 40;
    }
    return item;
}

test('升品行（无下一级列）只显示当前值，且不抛错；有孤立箭头时也不会亮起', () => {
    const item = createItem(false);
    item.arrowNode = new FakeNode();
    assert.doesNotThrow(() => item.setData('附加属性', '攻击 +12', '+15'));
    assert.equal(item.node.active, true);
    assert.equal(item.nameLabel.string, '附加属性');
    assert.equal(item.curLabel.string, '攻击 +12');
    assert.equal(item.arrowNode.active, false);
});

test('传 next（含 0）才显示下一级与箭头，传 undefined / null 则隐藏', () => {
    const item = createItem(true);
    item.setData('攻击力', 100, 0);
    assert.equal(item.nextLabel!.node.active, true);
    assert.equal(item.nextLabel!.string, '0');
    assert.equal(item.arrowNode!.active, true);

    item.setData('攻击力', 100, null as unknown as number);
    assert.equal(item.nextLabel!.node.active, false);
    assert.equal(item.arrowNode!.active, false);

    item.setData('攻击力', 100, 105);
    assert.equal(item.nextLabel!.node.active, true);
    assert.equal(item.nextLabel!.string, '105');

    item.setData('攻击力', 100);
    assert.equal(item.nextLabel!.node.active, false);
    assert.equal(item.arrowNode!.active, false);
    assert.equal(item.curLabel.string, '100');
});

test('行被复用时再次传 next 能重新显示', () => {
    const item = createItem(true);
    item.setData('攻击力', 100);
    item.setData('攻击力', 100, 110);
    assert.equal(item.nextLabel!.node.active, true);
    assert.equal(item.nextLabel!.string, '110');
    assert.equal(item.arrowNode!.active, true);
});

test('当前值按实测名称宽度顺排，长词条不再压住名称尾部', () => {
    const item = createItem(false);
    item.setData('坦克职业攻击：', '+74', '+80');
    // 7 个全角字符 = 168；原 Prefab 固定列位右缘 191，+74 会盖住冒号。
    assert.equal(item.nameLabel.node.uiTransform.width, 168);
    assert.equal(item.curLabel.node.position.x, 178);
    assert.equal(item.curLabel.horizontalAlign, FakeLabel.HorizontalAlign.RIGHT);
});

test('短词条保持 Prefab 原数值列右缘，不清空列对齐', () => {
    const item = createItem(false);
    item.setData('主角攻击：', '+21', '+23');
    // 名称 120 + 间距 10 + 值宽 36 仍在 191 以左 ⇒ 右缘不动。
    assert.equal(item.curLabel.node.position.x, 155);
});

test('同一行先长后短也回到原数值列，右缘缓存不被自身排版污染', () => {
    const item = createItem(false);
    item.setData('坦克职业攻击：', '+74', '+80');
    item.setData('主角攻击：', '+21', '+23');
    assert.equal(item.curLabel.node.position.x, 155);
});

test('Cur 采用右锚点（anchorX = 1, x = 191, Overflow.NONE）时对齐结果一致', () => {
    const item = createItem(true);
    item.curLabel.overflow = FakeLabel.Overflow.NONE;
    item.curLabel.node.uiTransform.anchorX = 1;
    item.curLabel.node.position.x = 191;

    item.setData('主角攻击：', '+21', '+23');
    assert.equal(item.curLabel.node.position.x, 191);

    item.setData('坦克职业攻击：', '+74', '+80');
    assert.equal(item.curLabel.node.position.x, 214);

    item.setData('主角攻击：', '+21', '+23');
    assert.equal(item.curLabel.node.position.x, 191);
});

test('空名称或负坐标右缘下不破坏 Cur 排版与基准右缘缓存', () => {
    const item = createItem(false);
    // 首次传空名：Cur 仍必须切回 Overflow.NONE，不被 96px CLAMP 框截断
    item.setData('', '+123456789');
    assert.equal(item.curLabel.overflow, FakeLabel.Overflow.NONE);
    assert.equal(item.curLabel.node.position.x, 191 - 120);

    // 居中坐标系下初始右缘 <= 0 时也只采集一次，不反复重采
    const centered = createItem(false);
    centered.nameLabel.node.position.x = -200;
    centered.curLabel.node.position.x = -150;
    centered.curLabel.node.uiTransform.width = 96; // 初始右缘 = -54
    centered.setData('坦克职业攻击：', '+74'); // nameRight = -32, right = -32 + 10 + 36 = 14, x = -22
    assert.equal(centered.curLabel.node.position.x, -22);
    centered.setData('甲：', '+1'); // 回退到初始右缘 -54 => x = -54 - 24 = -78
    assert.equal(centered.curLabel.node.position.x, -78);
});

test('Cur 右扩越过箭头原位时顺推箭头与 Next，切回短文案后归位', () => {
    const item = createItem(true);
    item.setData('超长极限属性词条名称：', '+12345678', '+99999999');
    // nameWidth = 11 * 24 = 264, valueWidth = 9 * 12 = 108 => right = 264 + 10 + 108 = 382
    // arrow 原位 323，需右移 382 + 12 - 323 = 71
    assert.equal(item.curLabel.node.position.x, 274);
    assert.equal(item.arrowNode!.position.x, 394);
    assert.equal(item.nextLabel!.node.position.x, 491);

    item.setData('主角攻击：', '+21', '+23');
    assert.equal(item.curLabel.node.position.x, 155);
    assert.equal(item.arrowNode!.position.x, 323);
    assert.equal(item.nextLabel!.node.position.x, 420);
});
