#!/usr/bin/env node
/**
 * tests/README.md 前缀索引生成器（只读统计 + 可选回写）。
 *
 * 用法：
 *   node tools/test-index.mjs           # 打印统计
 *   node tools/test-index.mjs --write   # 回写 README 的 TEST-INDEX 区块
 *
 * 统计口径：
 *   - 文件：tests/*.test.ts，平铺，不递归
 *   - 用例：test( / it( 声明数（不区分 skip/todo）
 *   - 行数：换行符个数
 *   - 已进路由表：docs/agent/规范路由与最小验证.md 中显式出现的 tests/*.test.ts
 *   - 前缀：文件名第一个 '-' 之前的部分；无 '-' 的算单文件前缀
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = path.join(ROOT, 'tests');
const ROUTE_DOC = path.join(ROOT, 'docs', 'agent', '规范路由与最小验证.md');
const README = path.join(TESTS, 'README.md');
const BEGIN = '<!-- TEST-INDEX:BEGIN -->';
const END = '<!-- TEST-INDEX:END -->';

const files = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith('.test.ts') && fs.statSync(path.join(TESTS, f)).isFile())
  .sort();

const routeText = fs.readFileSync(ROUTE_DOC, 'utf8');
const routeRefs = new Set(
  [...routeText.matchAll(/tests\/[\w\-./]+?\.test\.ts/g)].map((m) => m[0].replace(/\\/g, '/')),
);

const prefixOf = (f) => f.slice(0, -'.test.ts'.length).split('-')[0];

const index = new Map();
const titles = new Map();
let lines = 0;
let cases = 0;
let describeFiles = 0;

for (const f of files) {
  const txt = fs.readFileSync(path.join(TESTS, f), 'utf8');
  lines += (txt.match(/\n/g) || []).length;
  const c = (txt.match(/^\s*(?:test|it)\s*\(/gm) || []).length;
  cases += c;
  if (/\bdescribe\s*\(/.test(txt)) describeFiles += 1;
  for (const m of txt.matchAll(/^\s*(?:test|it)\s*\(\s*['"]([^'"]+)['"]/gm)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    titles.set(t, (titles.get(t) || 0) + 1);
  }
  const p = prefixOf(f);
  const row = index.get(p) || { files: 0, cases: 0, route: 0 };
  row.files += 1;
  row.cases += c;
  if (routeRefs.has(`tests/${f}`)) row.route += 1;
  index.set(p, row);
}

const multi = [...index.entries()]
  .filter(([, v]) => v.files > 1)
  .sort((a, b) => b[1].files - a[1].files || a[0].localeCompare(b[0]));
const singles = [...index.entries()].filter(([, v]) => v.files === 1);
const singleCases = singles.reduce((s, [, v]) => s + v.cases, 0);
const singleRoute = singles.reduce((s, [, v]) => s + v.route, 0);
const dupGroups = [...titles.values()].filter((n) => n > 1).length;

const summary =
  `共 ${files.length} 个测试文件、${lines.toLocaleString('en-US')} 行、` +
  `${cases.toLocaleString('en-US')} 条用例（2026-11-16 实测；\`npm run index:tests\` 可重算）。`;

const table = [
  '| 前缀 | 文件 | 用例 | 已进路由表 |',
  '| --- | --- | --- | --- |',
  ...multi.map(([p, v]) => `| \`${p}\` | ${v.files} | ${v.cases} | ${v.route} |`),
  `| 其余 ${singles.length} 个单文件前缀 | ${singles.length} | ${singleCases} | ${singleRoute} |`,
].join('\n');

if (process.argv.includes('--write')) {
  const readme = fs.readFileSync(README, 'utf8');
  if (!readme.includes(BEGIN) || !readme.includes(END)) {
    console.error(`❌ ${README} 缺少 ${BEGIN} / ${END} 标记，拒绝回写。`);
    process.exit(2);
  }
  const block = `${BEGIN}\n${summary}\n\n${table}\n${END}`;
  const next = readme.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}`), block);
  fs.writeFileSync(README, next);
  console.log(`✅ 已回写 ${path.relative(ROOT, README)}`);
} else {
  console.log(summary);
  console.log(table);
  console.log(`\n单文件前缀 ${singles.length} 个；重名用例 ${dupGroups} 组；describe 文件 ${describeFiles} 个。`);
}
