import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

test('修改地图 ID 为 chapter_02 时同步章节编号并可通过保存接口新建预设', () => {
  assert.match(source, /function inferChapterId\(id, fallback = 1\)/);
  assert.match(source, /map\.chapterId = inferChapterId\(map\.id, map\.chapterId\)/);
  assert.match(source, /fetch\(`\/api\/territory-presets\/\$\{encodeURIComponent\(value\.id\)\}`/);
  assert.match(source, /value\.chapterId = Number\(\$\('chapterId'\)\.value\)/);
  assert.match(html, /id="chapterId"/);
});
