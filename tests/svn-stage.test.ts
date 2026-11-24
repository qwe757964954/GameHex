import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  addFiles,
  removeFiles,
  loadStagedFiles,
  saveStagedFiles,
  clearFiles,
  commitFiles,
  pickFiles,
} from '../tools/dev/svn-stage.mjs';

const ROOT = process.cwd();
const TMP_DIR = path.join(ROOT, 'tmp');
const STAGE_FILE = path.join(TMP_DIR, 'svn-staged.txt');

test('svn-stage: 增量暂存、去重与伴生 meta 识别', () => {
  const originalContent = fs.existsSync(STAGE_FILE) ? fs.readFileSync(STAGE_FILE) : null;

  try {
    clearFiles();
    assert.equal(loadStagedFiles().length, 0, '清理后清单应为空');

    // 1. 添加普通文件
    addFiles(['package.json', 'AGENTS.md']);
    let list = loadStagedFiles();
    assert.equal(list.length, 2, '应成功暂存 2 个文件');
    assert.ok(list.some((p) => p.endsWith('package.json')));
    assert.ok(list.some((p) => p.endsWith('AGENTS.md')));

    // 暂存单官方规定为无 BOM 的 UTF-16LE，严禁写入 0xFF 0xFE，否则 TortoiseProc 会报 svn_dirent_is_absolute 断言崩溃
    const raw = fs.readFileSync(STAGE_FILE);
    assert.notEqual(raw[0], 0xff, '暂存单严禁包含 BOM (0xFF)');
    assert.notEqual(raw[1], 0xfe, '暂存单严禁包含 BOM (0xFE)');
    assert.equal(raw[1], 0x00, 'ASCII 字符高位字节应为 0x00 (UTF-16LE)');

    // 2. 去重测试
    addFiles(['package.json']);
    list = loadStagedFiles();
    assert.equal(list.length, 2, '重复添加应自动去重');

    // 3. 测试 assets 伴生 .meta 自动关联
    const testScript = 'assets/script/app/ArtPaths.ts';
    if (fs.existsSync(path.resolve(ROOT, testScript))) {
      addFiles([testScript]);
      list = loadStagedFiles();
      assert.ok(list.some((p) => p.endsWith('ArtPaths.ts')), '应包含脚本本身');
      assert.ok(list.some((p) => p.endsWith('ArtPaths.ts.meta')), '应自动附带伴生 .meta');
    }

    // 4. 移除测试
    removeFiles(['package.json']);
    list = loadStagedFiles();
    assert.ok(!list.some((p) => p.endsWith('package.json')), '已被移除的文件不应存在');

    // 5. 校验 dry-run 纯中文提交
    assert.doesNotThrow(() => {
      commitFiles(['--dry-run', '-m', '版本库暂存与提交工具优化测试']);
    }, '纯中文日志配合 --dry-run 应当通过校验');

    // 6. 校验英文日志被拦截
    assert.throws(() => {
      execSync('node tools/dev/svn-stage.mjs commit -m "English log test"', { stdio: 'pipe' });
    }, /Command failed/, '包含英文的日志必须被拦截并退出');

    // 7. 测试 pickFiles 秒级抓取
    const picked = pickFiles('tools/dev');
    assert.ok(picked.length > 0, '应成功抓取 tools/dev 下的改动');
    assert.ok(picked.some((p) => p.endsWith('svn-stage.mjs')), '应包含当前改动脚本');

    // 8. 测试 commit --all 一键秒级对齐并 dry-run 验证
    assert.doesNotThrow(() => {
      commitFiles(['--all', '--dry-run', '-m', '全量秒级对齐提交测试']);
    }, 'commit --all 应当自动完成抓取并通过校验');

    // 9. 测试坏字符与空字符过滤净化
    saveStagedFiles(['package.json\0corrupt', 'AGENTS.md\r']);
    const sanitized = loadStagedFiles();
    assert.ok(sanitized.every((p) => !p.includes('\0') && !p.includes('\r')), '暂存单应彻底过滤清洗坏字符');
    assert.ok(sanitized.some((p) => p.endsWith('AGENTS.md')), '清洗后合法路径应保留');
  } finally {
    if (originalContent !== null) {
      fs.writeFileSync(STAGE_FILE, originalContent);
    } else {
      clearFiles();
    }
  }
});
