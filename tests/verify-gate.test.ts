/**
 * 提交前门禁的结构与行为护栏（代码审查规范 §9 第 3 期）。
 *
 * 2026-11-05 15:59 口径：**Git 相关不处理** —— 不启用 pre-commit hook、不跑 GitHub Actions，
 * `.github/workflows/verify.yml` 已移除；G1 由人工执行 `npm run verify:gate`，SVN 走 TortoiseProc。
 * 所以护栏一律不读 `.github/`，也不能靠 `if (existsSync(...))` 跳过断言（规则 407 的假绿）。
 *
 * 核心防假绿点：
 *  1. `changedFiles()` 必须保留「外部改动集注入」入口，否则查 0 个文件也是假绿；
 *  2. `tmp/verify/baseline.json` 是本地快照，`check` 不能自建基线
 *     —— 否则「相对基线零新增」恒真，门禁形同虚设；
 *  3. gate 必须三道门都过才放行，且原始输出要能归档复看；
 *  4. 护栏用例清单只在 `package.json` 的 `verify:guards` 维护一份，且必须含本文件自己。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedFiles, writeGateReport, testCommand, tapSummaryOk, parseTestRun, splitTestBatches, baselineSentinelFiles } from '../tools/verify/verify.mjs';

const ROOT = join(__dirname, '..');
const VERIFY_MJS = join(ROOT, 'tools/verify/verify.mjs');

function withInjected(value: string | undefined, fn: () => void) {
    const saved = process.env.VERIFY_CHANGED_FILES;
    try {
        if (value === undefined) delete process.env.VERIFY_CHANGED_FILES;
        else process.env.VERIFY_CHANGED_FILES = value;
        fn();
    } finally {
        if (saved === undefined) delete process.env.VERIFY_CHANGED_FILES;
        else process.env.VERIFY_CHANGED_FILES = saved;
    }
}

const PASS_OUTPUTS = [
    { name: 'route', label: '路由覆盖', code: 0, out: '改动 2 个文件\n' },
    { name: 'defs', label: '定义完整性', code: 0, out: '检查 3 个引用\n' },
    { name: 'check', label: '相对基线零新增', code: 0, out: 'PASS：相对基线零新增\n' },
];

// 护栏用例清单的期望集。真源只有 package.json 的 verify:guards；
// 这里作为「第二只眼睛」，防止新增用例只加一边、另一边静默不跑。
const GUARD_TESTS = [
    'tests/verify-route.test.ts',
    'tests/auto-atlas-capacity.test.ts',
    'tests/isolated-compile-import.test.ts',
    'tests/sprite-frame-null.test.ts',
    'tests/definition-integrity.test.ts',
    'tests/verify-gate.test.ts',
];

test('G1 外部注入的改动集优先于本地 status 扫描', () => {
    withInjected('assets/script/app/zcds/ZCGame.ts\r\ntests/foo.test.ts\r\n', () => {
        assert.deepEqual(changedFiles(), [
            'assets/script/app/zcds/ZCGame.ts',
            'tests/foo.test.ts',
        ]);
    });
});

test('G2 注入内容逐行清理：空行、首尾空白、CRLF 都不能混进改动集', () => {
    withInjected('\n  assets/script/a.ts  \n\n  tests/b.test.ts\n', () => {
        assert.deepEqual(changedFiles(), ['assets/script/a.ts', 'tests/b.test.ts']);
    });
    withInjected('   \n  ', () => {
        const files = changedFiles();
        assert.ok(Array.isArray(files), '空注入必须回落到工作副本扫描，不能把空串当「零改动」放行');
        assert.ok(files.every((f) => typeof f === 'string' && f.length > 0));
    });
});

test('G3 gate 归档：判据汇总 + 三段原始输出 + 审查报告骨架，且骨架不被覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-gate-'));
    try {
        const report = writeGateReport(['assets/a.ts'], PASS_OUTPUTS, 0, dir);
        assert.ok(existsSync(report));
        const text = readFileSync(report, 'utf8');
        assert.match(text, /PASS（三道门全过）/);
        assert.match(text, /verify route/);
        assert.match(text, /改动 2 个文件/);
        assert.match(text, /PASS：相对基线零新增/);
        assert.ok(existsSync(join(dir, '审查报告.md')), '应顺手生成审查报告骨架');
        assert.match(readFileSync(join(dir, '审查报告.md'), 'utf8'), /三条判据/);

        writeFileSync(join(dir, '审查报告.md'), 'KEEP', 'utf8');
        const failReport = writeGateReport([], PASS_OUTPUTS, 1, dir);
        assert.equal(readFileSync(join(dir, '审查报告.md'), 'utf8'), 'KEEP',
            '骨架已存在时不能被模板覆盖（人工填过的内容不能丢）');
        assert.match(readFileSync(failReport, 'utf8'), /FAIL（1 道门未过）/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('G4 Git 通道不启用：判据只走本地 gate，check 不能自建基线', () => {
    const source = readFileSync(VERIFY_MJS, 'utf8');
    assert.ok(!existsSync(join(ROOT, '.github/workflows/verify.yml')),
        'Git CI 通道已明确不启用；若恢复该通道，须同步把 G4 改回校验它的口径，别留 ENOENT 红灯');
    assert.match(source, /const BASELINE = path\.join\(ROOT, 'tmp', 'verify', 'baseline\.json'\)/,
        'check 必须读本地基线快照，不能改成运行时自建');
    assert.match(source, /if \(!fs\.existsSync\(BASELINE\)\) return null;/,
        '没有基线必须返回 null 让 check 退出 2，不能悄悄造一份（否则判据恒真）');
    assert.match(source, /if \(mode === 'baseline'\)/,
        'baseline 必须是独立模式，不能被 check 顺带调用');
    assert.match(source, /VERIFY_CHANGED_FILES/,
        '外部改动集注入口要保留，否则改动集为空也是假绿');
});

test('G5 本地提交前入口：verify:gate 指向 gate，判据不依赖 Git 钩子', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    assert.match(scripts['verify:gate'] ?? '', /verify\.mjs gate/,
        'SVN 无客户端钩子，本地人工执行 gate 的入口不能丢');
    assert.match(scripts['verify'] ?? '', /verify\.mjs check/,
        'npm run verify 仍须落到 check，不能退化成只看路由');
    // 刻意不读 tools/hooks/：Git 通道不启用，hook 文件在不在都不影响本判据。
});

test('G6 gate 三道门顺序固定，任一门非 0 即不放行', () => {
    const source = readFileSync(VERIFY_MJS, 'utf8');
    const start = source.indexOf('const GATE_STEPS');
    const end = source.indexOf('function runGate');
    assert.ok(start >= 0 && end > start);
    const order = [...source.slice(start, end).matchAll(/name: '(\w+)'/g)].map((m) => m[1]);
    assert.deepEqual(order, ['route', 'defs', 'check']);
    assert.match(source, /if \(code !== 0\) bad\+\+;/);
    assert.match(source, /return bad === 0 \? 0 : 1;/);
});

test('G7 护栏用例单一真源：清单完整、含自身、别处不许另抄一份', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    const script: string = scripts['verify:guards'] ?? '';
    assert.ok(script, 'package.json 必须提供 verify:guards 作为本地护栏回归唯一入口');
    assert.match(script, /tsx --test/, '走 --test 才能拿到 TAP 汇总与逐条用例名');

    const listed = [...script.matchAll(/tests\/[\w.-]+\.test\.ts/g)].map((m) => m[0]).sort();
    assert.deepEqual(listed, [...GUARD_TESTS].sort(),
        '清单漂移：新增护栏用例只加一边，另一边就会静默不跑');
    for (const file of GUARD_TESTS) {
        assert.ok(existsSync(join(ROOT, file)), `${file} 在清单里但磁盘上不存在`);
    }
    assert.ok(listed.includes('tests/verify-gate.test.ts'),
        '守门禁自己的这组用例必须进清单，否则 G1–G7 全部静默不跑');

    // 只抓「护栏用例的具体文件名」：`test` / `test:hotupdate*` 等全量或模块脚本是合法共存的，
    // 它们用 glob 或自己的用例，不是第二份护栏清单。
    const duplicates = Object.entries(scripts)
        .filter(([key]) => key !== 'verify:guards')
        .filter(([, value]) => GUARD_TESTS.some((file) => String(value).includes(file)))
        .map(([key]) => key);
    assert.deepEqual(duplicates, [],
        '别在别的 npm 脚本里再抄一份护栏清单：两份清单必然漂移');
});

test('G8 采集器：TAP 汇总必须完整自洽，-1/-1 或缺项一律判不可信', () => {
    assert.equal(tapSummaryOk({ tests: 5046, pass: 4948, fail: 98 }), true);
    assert.equal(tapSummaryOk({ tests: 0, pass: 0, fail: 0 }), true, '零用例是合法空跑');
    assert.equal(tapSummaryOk({ tests: -1, pass: -1, fail: -1 }), false,
        '2026-11-05 假 PASS 的 -1/-1 形态必须拦住');
    assert.equal(tapSummaryOk({ tests: 10, pass: 9, fail: 0 }), false,
        'pass + fail 与 tests 不符 = 输出被截断或 reporter 不对');
    assert.equal(tapSummaryOk(null), false);
});

test('G9 采集器：显式 TAP、stderr 纳入解析、进程未起要拦、正常红不误杀', () => {
    const cmd = testCommand('"tests/**/*.test.ts"');
    assert.match(cmd, /--test-reporter=tap/, '不依赖「非 TTY 默认 tap」的环境巧合');
    assert.match(cmd, /tests\/\*\*\/\*\.test\.ts/, '命令要保留传入的用例集');

    const empty = parseTestRun({ status: 0, stdout: '', stderr: '' }, cmd);
    assert.equal(empty.summaryOk, false, 'stdout 无汇总 ⇒ 必须判不可信');
    assert.deepEqual(empty.failures, [], '空名单恰恰是「零新增」恒真的成因');

    const failing = parseTestRun({
        status: 1,
        stdout: 'not ok 1 - 用例A\n1..1\n# tests 1\n# pass 0\n# fail 1\n',
        stderr: '',
    }, cmd);
    assert.equal(failing.summaryOk, true, '用例失败是「正常的红」，仍要走基线差集');
    assert.equal(failing.spawnFailed, false, '退出码 1 不等于采集失败');
    assert.deepEqual(failing.failures, ['用例A']);

    const inStderr = parseTestRun({
        status: 1,
        stdout: '',
        stderr: 'not ok 1 - 用例B\n1..1\n# tests 1\n# pass 0\n# fail 1\n',
    }, cmd);
    assert.equal(inStderr.summaryOk, true, '汇总 / 失败名落在 stderr 也要采到');
    assert.deepEqual(inStderr.failures, ['用例B']);

    const broken = parseTestRun({ status: null, error: new Error('spawn ENOENT') }, cmd);
    assert.equal(broken.spawnFailed, true, '进程没起来不能当成「零失败」');

    const source = readFileSync(VERIFY_MJS, 'utf8');
    assert.match(source, /if \(t\.spawnFailed \|\| !t\.summaryOk\)/,
        'check / full / baseline 都必须先过采集器自检');
    assert.match(source, /console\.error\('\\n❌ 中止：测试采集失败/,
        '采集失败必须硬失败，不能带病打印 PASS');
});

test('G10 platform 只实现 core 端口，不反向依赖 app 业务层', () => {
    function collect(dir: string): string[] {
        const out: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) out.push(...collect(full));
            else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
        }
        return out;
    }
    const root = join(ROOT, 'assets', 'script', 'platform');
    const violations = collect(root)
        .filter((file) => /from\s+['"][^'"]*app\//.test(readFileSync(file, 'utf8')))
        .map((file) => file.slice(ROOT.length + 1));
    assert.deepEqual(violations, [],
        'platform 反向依赖 app 会把业务编排带进适配层；装配编排器留在 app 组合层');
});

test('G11 全量分批：文件不丢、单批有超时、任一批不可信整次失败', () => {
    const files = Array.from({ length: 145 }, (_, i) => `tests/f${i}.test.ts`);
    const batches = splitTestBatches(files, 60);
    assert.deepEqual(batches.map((b) => b.length), [60, 60, 25]);
    assert.deepEqual(batches.flat(), files, '分批不能丢文件，也不能重复');
    assert.deepEqual(splitTestBatches([], 60), []);
    assert.throws(() => splitTestBatches(files, 0), /批大小非法/);

    const source = readFileSync(VERIFY_MJS, 'utf8');
    assert.match(source, /timeout: FULL_TEST_TIMEOUT_MS/,
        '单批必须有墙钟超时，否则一个挂起的批次又会拖死整次 full/baseline');
    assert.match(source, /if \(r\.spawnFailed \|\| !r\.summaryOk\)/,
        '任一批采集失败必须立即整次失败，不能拿半截数据比基线');
    assert.match(source, /summaryOk: false/);
    assert.match(source, /console\.warn\(`\[verify\] 批次采集异常/,
        '重试必须显式打日志，不能悄悄把偶发抖动吞掉');
    assert.doesNotMatch(source, /testCommand\('"tests\/\*\*\/\*\.test\.ts"'\)/,
        '全量不再走单进程一次性 glob（那个路径会挂住）');
});


test('G12 基线红哨兵：改动集为空也不许零用例跑出「零新增」', () => {
    const source = readFileSync(VERIFY_MJS, 'utf8');
    assert.match(source, /function baselineSentinelFiles\(\)/,
        'check 必须有基线红反查，否则「改动 0 文件」时判据恒绿');
    const files = baselineSentinelFiles();
    assert.ok(files.length > 0, '基线 97 红必须反查到测试文件，空哨兵等于没守');
    assert.ok(files.every((f) => /^tests\/[\w.-]+\.test\.ts$/.test(f)));
    assert.match(source, /new Set\(\[\.\.\.selection\.tests, \.\.\.sentinels\]\)/,
        '哨兵必须并入 check 的 picked，不能只打印不跑');
    assert.match(source, /基线红哨兵：/, '判据要显式声明本次覆盖边界');
});

test('G13 check 大集走分批：与 full 共用采集器，杜绝 TAP -1/-1', () => {
    const source = readFileSync(VERIFY_MJS, 'utf8');
    assert.match(source, /function runBatchedTests\(/, '分批采集器必须存在');
    assert.match(source, /picked\.length > FULL_TEST_BATCH_SIZE/, 'check 必须有大集判定');
    assert.match(source, /runBatchedTests\(picked,/, 'check 大集必须真的走分批');
    assert.match(source, /return runBatchedTests\(files,/, 'full 复用同一采集器，别维护两套');
    const batches = splitTestBatches(Array.from({ length: 145 }, (_, i) => `tests/f${i}.test.ts`), 60);
    assert.deepEqual(batches.map((b) => b.length), [60, 60, 25]);
});
