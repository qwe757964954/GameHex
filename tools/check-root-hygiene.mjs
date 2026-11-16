#!/usr/bin/env node
/**
 * 根目录卫生检查：根目录只允许工程入口与配置，文档/测试/日志/脚本必须归档。
 * 用法：node tools/check-root-hygiene.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ALLOWED = new Set([
  '.gitignore',
  '.mcp.json',
  'AGENTS.md',
  'README.md',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'funplay-cocos-mcp.config.json',
]);

const suggestions = (name) => {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.log') return 'logs/2026-11-16/（活跃）或 logs/archive/2026-11-16/（归档）';
  if (ext === '.md') return 'docs/agent|design|spec|ops|reports|history/';
  if (ext === '.csv') return 'docs/design/（迁移清单）或 docs/spec/（规格数据）';
  if (ext === '.docx') return 'docs/spec/';
  if (ext === '.html') return 'docs/ops/';
  if (ext === '.txt') return 'docs/reports/';
  if (ext === '.py') return 'tools/probes/';
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return 'tools/dev/';
  if (ext === '.json') return '工程配置白名单之外请放 tools/ 或 docs/';
  return 'docs/ 或 tmp/';
};

const files = fs.readdirSync(ROOT, { withFileTypes: true }).filter((e) => e.isFile());
const violations = files.filter((e) => !ALLOWED.has(e.name));

if (violations.length > 0) {
  console.error(`根目录出现 ${violations.length} 个非白名单文件：`);
  for (const entry of violations) {
    console.error(`  - ${entry.name}  ->  ${suggestions(entry.name)}`);
  }
  console.error('\n根目录只放工程入口与配置；归档规则见 docs/README.md，日志见 logs/README.md。');
  process.exit(1);
}

console.log(`root hygiene OK: ${files.length} 个白名单文件`);
