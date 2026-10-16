import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');

test('领地编辑器为站点生成以站点 id 命名的 SVG 图标', () => {
    assert.match(source, /group\.setAttribute\('id', id\)/);
    for (const type of ['stage', 'boss', 'asyncPvp', 'fixedResource', 'bonus']) assert.match(source, new RegExp(`type === '${type}'`));
    // ⚠️ 别绑函数名：2026-09-29 渲染重构把 appendMarker 换成了 createMarker（不再自己 append，
    //    改由 render() 的 diff 层接管）。这条断言的**意图**是「站点规格里带 site.id / site.type」，
    //    所以断言规格对象的形状，而不是某个调用点。
    assert.match(source, /\{ id: site\.id, type: site\.type/);
});
