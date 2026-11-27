/**
 * `RoleStatRow` 的状态写入规则（装备弹窗里的一行属性）。
 *
 * ## 为什么要有这条
 *
 * 2026-11-27 删掉 `setData` 里的三处冗余判空（`if (this.lineNode)` / `if (this.tagNode)` /
 * `if (this.tagLabel && tag)`），顺手把「有 tag 才写标签文字」改成**全量写**：
 *
 * - 判空是多余的 —— 六个字段都是 prefab 绑定的 `@property`，绑错就该当场抛；
 * - 「有值才写」会留残影：`RoleEquipInfoPopup` 的 7 行共用同一套 prefab 实例，
 *   `tagLabel` 的静态初值是「宝石」，非宝石行如果不清空，内部状态会一直挂着上一个值。
 *
 * 视觉上看不出（`tagNode.active=false` 时标签不可见），所以只能靠这条用例钉住。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ccStub, loadTsModule } from './helpers/cc-sandbox';

interface ILabel {
    string: string;
    color: unknown;
}

interface INodeLike {
    active: boolean;
}

interface IRow {
    node: INodeLike;
    keyLabel: ILabel;
    valueLabel: ILabel;
    dotLabel: ILabel;
    lineNode: INodeLike;
    tagNode: INodeLike;
    tagLabel: ILabel;
    setData(key: string, value: string, tone?: string, tag?: string): void;
    setLine(line: string, tone?: string, tag?: string): void;
    clear(): void;
}

const { exports, unresolved } = loadTsModule<{ RoleStatRow: new () => IRow }>(
    'assets/script/app/role/RoleStatRow.ts',
    { modules: { cc: ccStub() } },
);
assert.deepEqual(unresolved, [], '桩表必须覆盖 RoleStatRow 的全部依赖（漏桩会静默回空对象）');

/** 按 prefab 真实初值造一行：`tagLabel` 静态初值就是「宝石」（见 RoleEquipInfoPopup.prefab）。 */
function makeRow(): IRow {
    const row = new exports.RoleStatRow();
    row.node = { active: false };
    row.keyLabel = { string: '' };
    row.valueLabel = { string: '', color: null };
    row.dotLabel = { string: '', color: null };
    row.lineNode = { active: false };
    row.tagNode = { active: true };
    row.tagLabel = { string: '宝石' };
    return row;
}

test('setData 全量写：行显示、键值落字、色点与值同色', () => {
    const row = makeRow();
    row.setData('攻击', '+12', 'attack');
    assert.equal(row.node.active, true);
    assert.equal(row.keyLabel.string, '攻击');
    assert.equal(row.valueLabel.string, '+12');
    assert.equal(row.dotLabel.string, '●');
    assert.equal(row.lineNode.active, true);
    assert.equal(row.valueLabel.color, row.dotLabel.color, '色点与数值必须同色');
});

test('setData 无 tag 时必须清空标签文字（prefab 初值是「宝石」，不清就会残影）', () => {
    const row = makeRow();
    row.setData('生命', '+30', 'life');
    assert.equal(row.tagNode.active, false);
    assert.equal(row.tagLabel.string, '', '非宝石行不能留着上一行的「宝石」');
});

test('setData 带 tag 时显示标签并落字', () => {
    const row = makeRow();
    row.setData('攻击', '+12', 'gem', '宝石');
    assert.equal(row.tagNode.active, true);
    assert.equal(row.tagLabel.string, '宝石');
});

test('setLine 按前缀拆分；空行直接收起，不写残留', () => {
    const row = makeRow();
    row.setLine('攻击 +12');
    assert.equal(row.keyLabel.string, '攻击');
    assert.equal(row.valueLabel.string, '+12');

    row.setLine('  ');
    assert.equal(row.node.active, false, '空行必须收起');
});

test('clear 只收起行，不动文字（下次 setData 会全量覆盖）', () => {
    const row = makeRow();
    row.setData('攻击', '+12');
    row.clear();
    assert.equal(row.node.active, false);
    assert.equal(row.keyLabel.string, '攻击');
});
