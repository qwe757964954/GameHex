import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('tools/map-editor/territory-app.js', 'utf8');
const html = readFileSync('tools/map-editor/territory.html', 'utf8');

test('领地校验警告会定位到站点地块并漂浮淡出', () => {
  assert.match(source, /function warningMarkersFor\(result\)/);
  assert.match(source, /has \(\\d\+\) fixed sites; expected \(\\d\+\) levels/);
  assert.match(source, /appendWarningText\(svg/);
  assert.match(source, /window\.setTimeout\(\(\) => node\.remove\(\), 2200\)/);
  assert.match(html, /validationFloat/);
  assert.match(html, /territoryWarningFloat/);
});
