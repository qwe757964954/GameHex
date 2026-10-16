/**
 * 注入片段：与官方范例 `extensions/hot-update/builder/hook.js` 里的 inject_script 等价，
 * 但做了两处加固（语义不变，只是更耐操）：
 *
 *   1. 取全局对象改为 `window || globalThis`，并显式判空——官方版直接写 `window.jsb`，
 *      在渲染进程/测试环境里没有 window 会抛。
 *   2. 恢复中断的更新时用 `charAt(length - 1)` 判断目录。官方版写的是
 *      `srcPath[srcPath.length] === '/'`，下标越界恒为 undefined，分支永远不进，
 *      目录项会掉进 renameFile 分支——在父目录尚未创建时失败。这里修正为标准写法。
 *
 * 除此之外逐行保持一致，尤其是：
 *   - 必须在 `System.import('./application.js')` **之前**执行，否则包装的还是旧脚本；
 *   - 键名 `HotUpdateSearchPaths` 必须与客户端写入时一致；
 *   - 恢复完成后写 `_temp` 目录残留（断点续传收尾）。
 *
 * 本文件是注入逻辑的唯一来源，构建扩展与 Python 发布脚本都从这里取。
 */
'use strict';

const START_MARKER = '/* CITY1001_HOTUPDATE_INJECT_START */';
const END_MARKER = '/* CITY1001_HOTUPDATE_INJECT_END */';

const INJECT_SNIPPET = `${START_MARKER}
(function () {
    var g = typeof window === 'object' && window ? window : (typeof globalThis === 'object' ? globalThis : null);
    if (!g || typeof g.jsb !== 'object' || !g.jsb || !g.jsb.fileUtils) {
        return;
    }
    var storage = g.localStorage || (g.sys && g.sys.localStorage);
    if (!storage) {
        return;
    }
    var hotUpdateSearchPaths = storage.getItem('HotUpdateSearchPaths');
    if (!hotUpdateSearchPaths) {
        return;
    }
    var paths = JSON.parse(hotUpdateSearchPaths);
    g.jsb.fileUtils.setSearchPaths(paths);

    var fileList = [];
    var storagePath = paths[0] || '';
    var tempPath = storagePath + '_temp/';
    var baseOffset = tempPath.length;

    if (g.jsb.fileUtils.isDirectoryExist(tempPath) && !g.jsb.fileUtils.isFileExist(tempPath + 'project.manifest.temp')) {
        g.jsb.fileUtils.listFilesRecursively(tempPath, fileList);
        fileList.forEach(function (srcPath) {
            var relativePath = srcPath.substr(baseOffset);
            var dstPath = storagePath + relativePath;

            if (srcPath.charAt(srcPath.length - 1) === '/') {
                g.jsb.fileUtils.createDirectory(dstPath);
            }
            else {
                if (g.jsb.fileUtils.isFileExist(dstPath)) {
                    g.jsb.fileUtils.removeFile(dstPath);
                }
                g.jsb.fileUtils.renameFile(srcPath, dstPath);
            }
        });
        g.jsb.fileUtils.removeDirectory(tempPath);
    }
})();
${END_MARKER}`;

/** 是否已经注入过（靠标记判断，不靠内容 diff）。 */
function hasInjection(text) {
    return typeof text === 'string' && text.includes(START_MARKER);
}

/** 去掉历史注入块（允许注入片段本身升级后重新写入）。 */
function stripInjection(text) {
    const start = text.indexOf(START_MARKER);
    if (start < 0) return text;
    const end = text.indexOf(END_MARKER, start);
    if (end < 0) return text;
    return text.slice(0, start) + text.slice(end + END_MARKER.length);
}

/**
 * 幂等地把恢复片段放到 JS 文件最前面。
 *
 * 先按标记剥掉历史注入块，再重新写入当前片段——这样注入片段本身升级后能自动替换，
 * 而不是"检测到标记就跳过"把旧片段永久留在产物里。
 * 剥离后要吃掉残留的空行，否则每次构建都会在片段和正文之间多攒一个换行，
 * 产物就不是逐字节稳定的了。
 *
 * @param {string} text 原始文件内容
 * @returns {{text: string, changed: boolean}}
 */
function applyInjection(text) {
    const source = typeof text === 'string' ? text : '';
    const stripped = stripInjection(source).replace(/^\uFEFF/, '').replace(/^\n+/, '');
    const next = `${INJECT_SNIPPET}\n${stripped}`;
    return { text: next, changed: next !== source };
}

module.exports = {
    END_MARKER,
    INJECT_SNIPPET,
    START_MARKER,
    applyInjection,
    hasInjection,
    stripInjection,
};

/**
 * 命令行入口：`node extensions/hot-update/builder/inject.js <main.js> [...]`
 *
 * 给发布脚本用 —— `--skip-build` 复用别人（或更早版本构建扩展）产出的目录时，
 * main.js 里可能没有恢复片段，那样热更会"下载成功但永不生效"，必须在发布前补齐。
 * 幂等：已注入的文件不会被改坏，输出里会标出来。
 */
if (require.main === module) {
    const fs = require('node:fs');
    const path = require('node:path');

    const targets = process.argv.slice(2);
    if (!targets.length) {
        process.stderr.write('用法：node extensions/hot-update/builder/inject.js <main.js> [...]\n');
        process.exitCode = 1;
    } else {
        const injected = [];
        const unchanged = [];
        const missing = [];
        try {
            for (const target of targets) {
                const file = path.resolve(target);
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
                    missing.push(target);
                    continue;
                }
                const original = fs.readFileSync(file, 'utf8');
                const result = applyInjection(original);
                if (!result.changed) {
                    unchanged.push(target);
                    continue;
                }
                fs.writeFileSync(file, result.text, 'utf8');
                injected.push(target);
            }
            if (missing.length) throw new Error(`main.js 不存在：${missing.join(' / ')}`);
            process.stdout.write(`${JSON.stringify({ injected, unchanged })}\n`);
        } catch (error) {
            process.stderr.write(`注入失败：${error && error.message ? error.message : error}\n`);
            process.exitCode = 1;
        }
    }
}
