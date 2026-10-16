import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

test('领地编辑器支持滚轮缩放和中键拖动画布', () => {
  assert.match(source, /setAttribute\('viewBox'/);
  assert.match(source, /addEventListener\('wheel'/);
  assert.match(source, /event\.button === 1/);
  assert.match(source, /setPointerCapture\?\./);
  assert.match(source, /function resetView/);
  assert.match(source, /zoom = Math\.max\(0\.5, Math\.min\(4/);
  assert.match(html, /id="fit"/);
  assert.match(html, /id="zoomInfo"/);
  assert.match(html, /svg \{ display:block; margin:18px auto;/);
});
