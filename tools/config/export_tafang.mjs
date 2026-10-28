import {
    copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { printValidationResult, validateSkillPipeline } from './validate_skill_pipeline.mjs';
import { projectSkillPlan } from './project_skill_plan.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const cityRoot = resolve(repositoryRoot, '..');
const defaultOutputDirectory = resolve(repositoryRoot, 'outputs', 'skill_pipeline_20260926');
const defaultOverlays = [
    resolve(defaultOutputDirectory, 'J-技能表_PVP技能升级闭环版.xlsx'),
    resolve(defaultOutputDirectory, 'K-卡牌升级_PVP技能引用闭环版.xlsx'),
    resolve(defaultOutputDirectory, 'PVP-修改器适配_技能状态闭环版.xlsx'),
];

function usage() {
    console.log(`塔防配置命令行导表

用法：
  npm run config:export
  npm run config:validate
  node tools/config/export_tafang.mjs [选项]

选项：
  --engine <eson|tf>         导表内核；默认 eson
  --validate-only           只校验现有 assets/remoteRef
  --doc-root <目录>         Excel 配置根目录
  --eson-dir <目录>         eSon 安装目录
  --overlay <Excel>         在主目录导出后覆盖导入一份兼容表，可重复
  --no-default-overlays     不自动叠加本仓库 outputs 下的三份闭环表
  --json-dir <目录>         策划 JSON 中间目录
  --sync-server-run         同步服务端 JSON 到本机 run/city-server
  --server-run-dir <目录>   指定后端运行资源目录（隐含 --sync-server-run）
  --server-source-dir <目录>同步一份服务端 JSON 到指定源码资源目录
  --generator <文件>        engine=tf 时指定 TFDocGenerator.exe
  --client-dir <目录>       engine=tf 时指定客户端 JSON 输出目录
  --ts-dir <目录>           engine=tf 时指定 TypeScript 输出目录
  --keep-config             保留本次临时目录，便于排查
  --help                    显示帮助

默认流程：eSon 原生解析 -> 技能升级投影 -> 临时目录校验 -> 发布策划 JSON
-> 生成客户端压缩 JSON/类型 -> 最终校验。不会请求 update-db，也不会刷新进程。`);
}

function parseArgs(argv) {
    const options = {
        engine: 'eson',
        validateOnly: false,
        syncServerRun: false,
        keepConfig: false,
        useDefaultOverlays: true,
        overlays: [],
        docRoot: resolve(cityRoot, 'doc', '塔防数据配置'),
        esonDirectory: resolve(cityRoot, 'doc', 'eson'),
        clientDirectory: resolve(repositoryRoot, 'assets', 'remoteRef'),
        tsDirectory: resolve(repositoryRoot, 'assets', 'script', 'app', 'generated', 'refGen'),
        jsonDirectory: resolve(cityRoot, 'doc', '塔防数据配置', 'json'),
        serverRunDirectory: resolve(cityRoot, 'run', 'city-server', 'target', 'classes', 'res', 'tafang'),
        serverSourceDirectory: '',
        generator: resolve(cityRoot, 'doc', '塔防数据配置', '转表工具', 'TFDocGenerator.exe'),
    };
    const take = (index, name, path = true) => {
        const value = argv[index + 1];
        if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`);
        return path ? resolve(value) : value;
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--help') options.help = true;
        else if (arg === '--validate-only') options.validateOnly = true;
        else if (arg === '--sync-server-run') options.syncServerRun = true;
        else if (arg === '--keep-config') options.keepConfig = true;
        else if (arg === '--no-default-overlays') options.useDefaultOverlays = false;
        else if (arg === '--engine') options.engine = take(index++, arg, false).toLowerCase();
        else if (arg === '--doc-root') options.docRoot = take(index++, arg);
        else if (arg === '--eson-dir') options.esonDirectory = take(index++, arg);
        else if (arg === '--overlay') options.overlays.push(take(index++, arg));
        else if (arg === '--client-dir') options.clientDirectory = take(index++, arg);
        else if (arg === '--ts-dir') options.tsDirectory = take(index++, arg);
        else if (arg === '--json-dir') options.jsonDirectory = take(index++, arg);
        else if (arg === '--server-run-dir') {
            options.serverRunDirectory = take(index++, arg);
            options.syncServerRun = true;
        } else if (arg === '--server-source-dir') options.serverSourceDirectory = take(index++, arg);
        else if (arg === '--generator') options.generator = take(index++, arg);
        else throw new Error(`未知参数：${arg}`);
    }
    if (!['eson', 'tf'].includes(options.engine)) throw new Error(`不支持的导表内核：${options.engine}`);
    return options;
}

function requirePath(path, label) {
    if (!existsSync(path)) throw new Error(`${label}不存在：${path}`);
}

function runCommand(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd || repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
        env: options.env || process.env,
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${options.label || command} 执行失败，退出码 ${result.status}`);
    return result;
}

function compileEsonCli(esonDirectory, classesDirectory) {
    const classpath = `${resolve(esonDirectory, 'lib', '*')};${resolve(esonDirectory, 'lib64', '*')}`;
    mkdirSync(classesDirectory, { recursive: true });
    runCommand('javac', [
        '--release', '8', '-encoding', 'UTF-8', '-cp', classpath,
        '-d', classesDirectory, resolve(scriptDirectory, 'EsonCli.java'),
    ], { label: 'eSon CLI 编译' });
    return classpath;
}

function runEson(esonDirectory, classesDirectory, classpath, input, output) {
    requirePath(input, 'eSon 输入');
    console.log(`[eSon] 输入：${input}`);
    runCommand('java', [
        '-Dfile.encoding=UTF-8', '-cp', `${classesDirectory};${classpath}`,
        'EsonCli', input, output,
    ], { cwd: esonDirectory, label: 'eSon 导表' });
}

/**
 * 递归复制并**覆盖**目标已有文件（发布策划 JSON 用）。
 *
 * 🔴 不能退化成 `cpSync(src, dst, { recursive: true, force: true })`：本机 Node 22.22.2 在
 * **跨卷**（C: 临时目录 → D: 工程/文档目录）且目标文件**已存在**时静默跳过 ——
 * 不复制、不报错、退出码 0。2026-10-28 实测：`before 23731 / after 23731`，
 * 而 `copyFileSync` 同场景 `23731 → 47590` 正常。于是 `doc/塔防数据配置/json/**`
 * 这一跳一直发布的是旧内容（只有同卷 tmp→tmp 才正常）。逐文件 `copyFileSync` 跨卷可靠。
 */
function copyJsonTree(source, destination) {
    requirePath(source, '待发布 JSON 目录');
    copyDirectory(source, destination);
}

function copyDirectory(source, destination) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
        const from = join(source, entry.name);
        const to = join(destination, entry.name);
        if (entry.isDirectory()) copyDirectory(from, to);
        else copyFileSync(from, to);
    }
}

function generateClientRef(jsonClientDirectory) {
    const python = process.env.PYTHON || 'python';
    const refDirectory = resolve(repositoryRoot, 'tools', 'ref');
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const steps = [
        ['ref_compress_json.py', [jsonClientDirectory]],
        ['ref_ref_type_all_gen.py', [jsonClientDirectory]],
        ['ref_RefBase_gen.py', []],
        ['ref_enum_gen.py', [jsonClientDirectory]],
    ];
    for (const [script, args] of steps) {
        console.log(`[客户端生成] ${script}`);
        runCommand(python, [resolve(refDirectory, script), ...args], {
            cwd: refDirectory, env, label: script,
        });
    }
    runCommand(python, [resolve(repositoryRoot, 'tools', 'pvp_card_check.py')], {
        cwd: repositoryRoot, env, label: 'PVP 卡牌守卫',
    });
}

function exportWithEson(options, tempDirectory) {
    requirePath(options.docRoot, 'Excel 配置目录');
    requirePath(options.esonDirectory, 'eSon 目录');
    requirePath(resolve(options.esonDirectory, 'lib'), 'eSon lib 目录');
    requirePath(resolve(options.esonDirectory, 'lib64'), 'eSon lib64 目录');

    const stageJsonDirectory = resolve(tempDirectory, 'json');
    const stageClientDirectory = resolve(stageJsonDirectory, 'client');
    const stageServerDirectory = resolve(stageJsonDirectory, 'sever');
    const classesDirectory = resolve(tempDirectory, 'classes');
    const classpath = compileEsonCli(options.esonDirectory, classesDirectory);
    runEson(options.esonDirectory, classesDirectory, classpath, options.docRoot, stageJsonDirectory);

    const overlays = [
        ...(options.useDefaultOverlays ? defaultOverlays.filter(existsSync) : []),
        ...options.overlays,
    ];
    for (const overlay of [...new Set(overlays)]) {
        runEson(options.esonDirectory, classesDirectory, classpath, overlay, stageJsonDirectory);
    }

    requirePath(stageClientDirectory, 'eSon 客户端 JSON 输出');
    requirePath(stageServerDirectory, 'eSon 服务端 JSON 输出');
    const projection = projectSkillPlan(stageClientDirectory);
    if (!projection.skipped) console.log(`[技能投影] 已关联 ${projection.linked} 个 K 表技能等级修改器`);

    const stagedValidation = validateSkillPipeline(stageClientDirectory, {
        serverDirectory: stageServerDirectory,
    });
    printValidationResult(stagedValidation);
    if (!stagedValidation.ok) throw new Error('临时导表校验未通过，未发布任何 JSON');

    copyJsonTree(stageClientDirectory, resolve(options.jsonDirectory, 'client'));
    copyJsonTree(stageServerDirectory, resolve(options.jsonDirectory, 'sever'));
    generateClientRef(stageClientDirectory);

    if (options.syncServerRun) copyJsonTree(stageServerDirectory, options.serverRunDirectory);
    if (options.serverSourceDirectory) copyJsonTree(stageServerDirectory, options.serverSourceDirectory);
}

function exportWithTf(options, tempDirectory) {
    requirePath(options.docRoot, 'Excel 配置目录');
    requirePath(options.generator, 'TFDocGenerator');
    const configPath = join(tempDirectory, 'config.json');
    const config = {
        docPath: options.docRoot,
        docOutPath: options.clientDirectory,
        tsOutPath: options.tsDirectory,
        jsonPath: options.jsonDirectory,
        serverRunPath: options.syncServerRun ? options.serverRunDirectory : '',
        serverPath: options.serverSourceDirectory,
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    const result = runCommand(options.generator, ['gen', '--config', configPath], {
        cwd: dirname(options.generator),
        label: 'TFDocGenerator',
        env: { ...process.env, DOTNET_ROLL_FORWARD: process.env.DOTNET_ROLL_FORWARD || 'Major' },
    });
    if (`${result.stdout ?? ''}\n${result.stderr ?? ''}`.includes('导出失败')) {
        throw new Error('TFDocGenerator 报告导出失败（旧工具仍返回退出码 0）');
    }
    const projection = projectSkillPlan(options.clientDirectory);
    if (!projection.skipped) console.log(`[技能投影] 已关联 ${projection.linked} 个 K 表技能等级修改器`);
}

function run() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        usage();
        return;
    }
    if (options.validateOnly) {
        const validation = validateSkillPipeline(options.clientDirectory, {
            serverDirectory: options.syncServerRun ? options.serverRunDirectory : undefined,
        });
        printValidationResult(validation);
        if (!validation.ok) process.exitCode = 1;
        return;
    }

    if (options.syncServerRun) requirePath(options.serverRunDirectory, '服务端运行目录');
    if (options.serverSourceDirectory) requirePath(options.serverSourceDirectory, '服务端源码资源目录');
    const tempDirectory = mkdtempSync(join(tmpdir(), 'tafang-export-'));
    try {
        console.log(`[导表] 内核：${options.engine}`);
        console.log(`[导表] Excel：${options.docRoot}`);
        console.log(`[导表] Server Run：${options.syncServerRun ? options.serverRunDirectory : '未同步'}`);
        if (options.engine === 'eson') exportWithEson(options, tempDirectory);
        else exportWithTf(options, tempDirectory);

        const validation = validateSkillPipeline(options.clientDirectory, {
            serverDirectory: options.syncServerRun ? options.serverRunDirectory : undefined,
        });
        printValidationResult(validation);
        if (!validation.ok) process.exitCode = 1;
        else console.log('[导表完成] Excel、客户端 JSON、技能升级引用与后端配置契约已闭环');
    } finally {
        if (options.keepConfig) console.log(`[导表] 临时目录保留在：${tempDirectory}`);
        else rmSync(tempDirectory, { recursive: true, force: true });
    }
}

try {
    run();
} catch (error) {
    console.error(`[导表失败] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
