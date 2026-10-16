/**
 * 构建后钩子（构建进程执行）。
 *
 * 对 android / ios 两个原生平台做两件事：
 *
 *   1. 给构建产物的 `main.js` 注入搜索路径恢复片段（幂等，重复构建不会叠加）。
 *      这一步必须做，否则热更下载下来的脚本不会被加载 —— 引擎仍走安装包里的旧脚本。
 *   2. 在构建数据根目录生成随包的 `project.manifest`（本地基线清单），让客户端
 *      AssetsManager 有"包内版本"可比。远端清单由发布脚本生成，两边共用
 *      `tools/hotupdate/hotupdate_manifest.js` 的同一实现。
 *
 * 官方要求构建时关闭 MD5 Cache：raw 资源带 hash 后缀会让 manifest 的路径对不上。
 * 本项目 android 构建已默认 `md5Cache: false`；若在构建面板里手动勾了 MD5 Cache，
 * 这里只告警不阻断（发布脚本还会再拦一次）。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { applyInjection } = require('./inject.js');

/**
 * 模块加载即打一行。这是判断「hooks 路径有没有被构建进程正确解析到本文件」的**唯一信号**：
 * 构建日志里看不到这一行，就说明扩展没被加载、或 `configs['*'].hooks` 解析到了别的路径，
 * 此时注入与随包清单都会静默不做 —— 而构建本身照样成功、没有任何报错。
 */
/**
 * 指纹行 —— 用来判断「构建进程用的到底是哪一版 hook.js」。
 *
 * ⚠️ **改过本文件 / index.js / inject.js 之后，必须重启编辑器才生效。**
 * 实测：14:13 改完本文件，14:17 重新构建，日志里报的还是改前的三行、
 * 第三行（`error.message`）依旧为空 —— 构建进程跑的是编辑器启动时加载的**内存副本**。
 * 换了实现之后如果指纹没变，就别再往下查业务逻辑了，先去重启编辑器。
 */
const HOOK_REVISION = '2026-09-28.2';
console.log(`[hot-update] 构建钩子已载入（hook.js 被构建进程 require 成功，rev ${HOOK_REVISION}）`);

/** builder/hook.js → hot-update → extensions → 工程根 */
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
const NATIVE_PLATFORMS = ['android', 'ios'];
const HOT_UPDATE_CONFIG = path.join(PROJECT_ROOT, 'assets', 'resources', 'config', 'hot_update.json');

/**
 * 随包清单的本地留档目录。
 * 允许用环境变量改道：冒烟用例把构建目录换成 `tmp/` 下的 fixture，不改道的话
 * 它会把这个**真实留档目录**覆盖成 fixture 内容（曾因此把一次冒烟误读成"真机构建成功过"）。
 */
const LOCAL_MANIFEST_OUTPUT = process.env.CITY1001_HOTUPDATE_LOCAL_OUT
    ? path.resolve(process.env.CITY1001_HOTUPDATE_LOCAL_OUT)
    : path.join(PROJECT_ROOT, 'outputs', 'hotupdate-local');

/**
 * 清单生成器的两种定位方式（同一个文件的两种说明符）。
 *
 * ⚠️ 2026-09-28 实测：**构建进程不认跨目录的绝对路径**（相对说明符只是推演可行、尚无实测背书）。
 * 证据来自同一次 android 构建：同一个 hook.js 中
 *   - `require('./inject.js')`（同目录、相对说明符）→ 成功，注入片段确实落进了 `build/android/data/main.js`；
 *   - `require('<工程根>\\tools\\hotupdate\\hotupdate_manifest.js')`（跨目录、绝对路径）→ 抛错，
 *     而且 `error.message` 是**空的**（非标准 Error）。
 * 那次日志里还出现过 `...\Creator\3.8.8\file:\D:\City1001\...` 这种
 * `file:` URL 与 Windows 路径混拼 ⇒ 该进程的 require 大概率按 URL 语义解析说明符，
 * 而 `D:\...` 不是合法说明符。
 *
 * 更坑的是**本地永远测不出**：原生 node 下两种写法都成功，`node tests/smoke_hotupdate_hook.mjs` 全绿。
 * 所以下面走三层兜底，并在冒烟里手工把「绝对路径被拒」造出来做回归。
 */
const MANIFEST_MODULE_RELATIVE = '../../../tools/hotupdate/hotupdate_manifest.js';
const MANIFEST_MODULE_ABSOLUTE = path.join(PROJECT_ROOT, 'tools', 'hotupdate', 'hotupdate_manifest.js');

exports.onAfterBuild = async function (options, result) {
    const platform = String((options && options.platform) || (result && result.platform) || '');
    if (!NATIVE_PLATFORMS.includes(platform)) {
        console.log(`[hot-update] 平台 ${platform || '(未知)'} 非原生，跳过热更新后处理`);
        return;
    }

    const dest = resolveBuildDataRoot(result);
    if (!dest) {
        console.error('[hot-update] 找不到构建数据根目录，跳过热更新后处理');
        return;
    }
    console.log(`[hot-update] 构建数据根目录：${dest}`);

    if (options && options.md5Cache === true) {
        console.warn('[hot-update] 本次构建开启了 MD5 Cache；原生热更新要求关闭它，否则清单路径与产物对不上');
    }

    injectMainJs(dest);
    generateLocalManifest(dest, platform);
};

/**
 * 定位真正装着 main.js / src / assets 的目录。
 * 不同平台/版本的 result.dest 语义不同（可能是 build/<platform>、可能是 build/<platform>/data），
 * 所以按候选逐个探测，并用 realpath 去重（本项目 build/android/assets 是指向 data 的 junction）。
 */
function resolveBuildDataRoot(result) {
    const candidates = ['dest', 'buildPath']
        .map((key) => (result && typeof result[key] === 'string' ? result[key] : null))
        .filter(Boolean);
    for (const candidate of candidates) {
        for (const relative of ['', 'data', 'assets']) {
            const directory = relative ? path.join(candidate, relative) : candidate;
            if (isFile(path.join(directory, 'main.js')) && fs.existsSync(path.join(directory, 'src'))) {
                return directory;
            }
        }
    }
    return null;
}

function injectMainJs(dest) {
    const seen = new Set();
    const targets = [];
    for (const relative of ['main.js', 'data/main.js', 'assets/main.js']) {
        const file = path.join(dest, relative);
        if (!isFile(file)) continue;
        const identity = realPath(file);
        if (seen.has(identity)) continue;
        seen.add(identity);
        targets.push(file);
    }
    if (!targets.length) {
        console.error(`[hot-update] 在 ${dest} 下没找到 main.js，跳过注入`);
        return;
    }
    for (const file of targets) {
        const original = fs.readFileSync(file, 'utf8');
        const { text, changed } = applyInjection(original);
        if (!changed) {
            console.log(`[hot-update] ${path.relative(PROJECT_ROOT, file)} 已是最新注入片段`);
            continue;
        }
        fs.writeFileSync(file, text, 'utf8');
        console.log(`[hot-update] 已注入搜索路径恢复片段：${path.relative(PROJECT_ROOT, file)}`);
    }
}

function generateLocalManifest(dest, platform) {
    const config = readHotUpdateConfig();
    const channel = config && typeof config.channel === 'string' && config.channel ? config.channel : 'dev';
    const clientVersion = config && typeof config.clientVersion === 'string' && config.clientVersion ? config.clientVersion : '0.0.0';
    const channelBase = deriveChannelBase(config, platform, channel);

    let generateManifests;
    try {
        ({ generateManifests } = loadManifestGenerator());
    } catch (error) {
        // 这里吞掉异常，构建本身仍然会成功 —— 只有包内少了 project.manifest。
        // 所以必须把「试过哪几条路、各自为什么失败」全打出来，否则只剩一句无从查起的报错。
        console.error(`[hot-update] 无法加载清单生成器：${MANIFEST_MODULE_ABSOLUTE}`);
        console.error('[hot-update]   ', describeError(error));
        console.error(`[hot-update]   诊断：rev=${HOOK_REVISION} ｜ __dirname=${__dirname} ｜ cwd=${process.cwd()}`);
        console.error('[hot-update]   该文件被移动过？它现在应在 tools/hotupdate/ 下。');
        return;
    }

    try {
        const outcome = generateManifests({
            srcRoot: dest,
            // 包内基线版本用客户端版本号；远端 release 用 releaseId，两者必然不同，
            // 客户端因此总会进入文件级 md5 比对。
            version: clientVersion,
            packageUrl: channelBase,
            outputDir: path.join(LOCAL_MANIFEST_OUTPUT, platform, channel),
            // 随包清单：客户端在找不到更权威的 control 文件时也要能自举
            writeLocalManifestToSrcRoot: true,
        });
        console.log(`[hot-update] 已生成随包 project.manifest：${outcome.fileCount} 个文件 / ${outcome.totalBytes} 字节 / 版本 ${outcome.projectManifest.version}`);
        console.log(`[hot-update] 远端基线地址：${outcome.projectManifest.packageUrl}`);
    } catch (error) {
        console.error('[hot-update] 生成随包 project.manifest 失败：', error && error.message ? error.message : error);
    }
}

function readHotUpdateConfig() {
    try {
        if (!isFile(HOT_UPDATE_CONFIG)) return null;
        return JSON.parse(fs.readFileSync(HOT_UPDATE_CONFIG, 'utf8'));
    } catch (error) {
        console.warn('[hot-update] 读取 hot_update.json 失败：', error && error.message ? error.message : error);
        return null;
    }
}

/**
 * 从 hot_update.json 的 latestUrlTemplate 推导渠道根地址。
 * `.../hotupdate/{platform}/{channel}/latest.json` → `.../hotupdate/<platform>/<channel>/`
 */
function deriveChannelBase(config, platform, channel) {
    const template = config && typeof config.latestUrlTemplate === 'string' ? config.latestUrlTemplate : '';
    const suffix = '/{platform}/{channel}/latest.json';
    const normalized = template.replace(/\{platform\}/g, platform).replace(/\{channel\}/g, channel);
    if (normalized.endsWith('/latest.json')) return normalized.slice(0, -'/latest.json'.length) + '/';
    if (template.endsWith(suffix)) return template.slice(0, -suffix.length) + `/${platform}/${channel}/`;
    console.warn('[hot-update] latestUrlTemplate 不符合 {platform}/{channel}/latest.json 约定，随包清单将使用兜底地址');
    return 'https://hotupdate.invalid/';
}

function isFile(file) {
    try {
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

function realPath(file) {
    try {
        return fs.realpathSync.native(file);
    } catch {
        return file;
    }
}

/**
 * 三层兜底加载清单生成器，任一成功即返回。
 *
 *   ① **读源码求值** —— 首选。不经过宿主的模块系统，只要文件在磁盘上就能跑。
 *      之所以放第一：构建进程的 require 行为已经证伪了一种说明符（跨目录绝对路径必败），
 *      相对说明符只是**推演**应该可行、没有实测背书，而这一路是环境无关的。
 *   ② 相对说明符 require —— 正常 node 下的常规路径，也是加载器"能生效"的旁证。
 *   ③ `createRequire(工程根)` —— 万一 require 被宿主包装过，这里再试一次。
 *
 * `new Function` 是唯一的软肋（理论上会被 CSP 拦），所以 require 两路必须留着兜。
 * 三层全失败时抛出的 Error 带 `failures`，逐条记录每层失败的原因。
 */
function loadManifestGenerator() {
    const failures = [];
    const attempt = (label, load) => {
        try {
            const loaded = load();
            if (!loaded || typeof loaded.generateManifests !== 'function') {
                throw new Error('模块没导出 generateManifests');
            }
            return loaded;
        } catch (error) {
            failures.push(`${label} → ${describeError(error)}`);
            return null;
        }
    };

    const loaded = attempt('读源码求值', () => evaluateCommonJs(MANIFEST_MODULE_ABSOLUTE))
        || attempt('相对说明符 require', () => require(MANIFEST_MODULE_RELATIVE))
        || attempt('createRequire(工程根)', () => require('node:module')
            .createRequire(path.join(PROJECT_ROOT, 'package.json'))('./tools/hotupdate/hotupdate_manifest.js'));
    if (loaded) return loaded;

    const error = new Error(failures.join(' ｜ '));
    error.failures = failures;
    throw error;
}

/**
 * 把文件当纯 CommonJS 求值。
 * 生成器内部只 require `node:crypto` / `node:fs` / `node:path`（hook.js 已在用，必可解析），
 * 它的 CLI 分支是 `require.main === module` —— 这里传进去的 module 不是 main，不会进。
 *
 * ⚠️ 必须自己剥掉 shebang 和 BOM：Node 的 CJS loader 会剥，`new Function` 不会 ——
 * 留着 `#!` 就是一个 `Invalid or unexpected token` 语法错。
 */
function evaluateCommonJs(file) {
    const source = fs.readFileSync(file, 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/^#![^\n]*\r?\n/, '');
    const module = { exports: {} };
    const evaluate = new Function('exports', 'require', 'module', '__filename', '__dirname', source);
    evaluate(module.exports, require, module, file, path.dirname(file));
    return module.exports;
}

/** 把错误压成一行可读文本 —— 线上遇到的非标准 Error 连 `message` 都是空的。 */
function describeError(error) {
    if (!error) return String(error);
    const parts = [];
    if (error.code) parts.push(`code=${error.code}`);
    if (error.message) parts.push(error.message);
    else if (error.name) parts.push(error.name);
    if (!parts.length) {
        const firstLine = typeof error.stack === 'string' ? error.stack.split('\n')[0] : '';
        parts.push(firstLine || String(error));
    }
    return parts.join(' ');
}
