#!/usr/bin/env node
/**
 * 官方格式热更新清单生成器（Cocos Creator 原生全构建目录方案）。
 *
 * 与官方范例 `version_generator.js` 对齐：遍历原生构建目录下的
 * `src` / `assets` / `jsb-adapter`，逐文件取 md5 + size，产出
 *
 *   - `project.manifest`：含 assets 列表，随包发给客户端做本地基线
 *   - `version.manifest`：不含 assets，只用于版本探测
 *
 * 构建扩展（extensions/hot-update）与发布脚本（tools/hotupdate/publish_hotupdate.py）
 * 共用本文件的同一实现，保证两边产出的清单逐字节一致。
 *
 * 注意：`main.js` / `application.js` 故意**不**进清单 —— 它们必须在热更新
 * 生效之前就把搜索路径恢复好，一旦被替换就会自锁。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** 默认纳入清单的构建子目录，相对构建数据根目录。 */
const DEFAULT_INCLUDE = ['src', 'assets', 'jsb-adapter'];

/** 官方清单顶层字段，project.manifest 与 version.manifest 共享。 */
function createManifest({ version, packageUrl, remoteManifestUrl, remoteVersionUrl, searchPaths }) {
    return {
        packageUrl: ensureTrailingSlash(packageUrl),
        remoteManifestUrl: remoteManifestUrl || `${ensureTrailingSlash(packageUrl)}project.manifest`,
        remoteVersionUrl: remoteVersionUrl || `${ensureTrailingSlash(packageUrl)}version.manifest`,
        version,
        assets: {},
        searchPaths: Array.isArray(searchPaths) ? searchPaths.slice() : [],
    };
}

function ensureTrailingSlash(value) {
    const text = String(value ?? '');
    if (!text) throw new Error('packageUrl 不能为空');
    return text.endsWith('/') ? text : `${text}/`;
}

/**
 * 递归收集目录下所有文件的相对路径（正斜杠、URI 编码），与官方一致地跳过点开头的条目。
 * @returns {string[]} 相对 root 的路径（已排序，保证多次生成结果稳定）
 */
function collectRelativeFiles(root, relative = '', out = []) {
    const entries = fs.readdirSync(path.join(root, relative), { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const child = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) collectRelativeFiles(root, child, out);
        else if (entry.isFile()) out.push(child);
    }
    return out;
}

function md5OfFile(file) {
    return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

/**
 * 生成 project.manifest / version.manifest。
 *
 * @param {object} options
 * @param {string} options.srcRoot 原生构建数据根目录（含 src/assets/jsb-adapter）
 * @param {string} options.version 主版本号（客户端拿它与本地比较；本项目用 releaseId）
 * @param {string} options.packageUrl 远端资源根地址，必须以 / 结尾（缺失会自动补）
 * @param {string} [options.remoteManifestUrl]
 * @param {string} [options.remoteVersionUrl]
 * @param {string[]} [options.searchPaths]
 * @param {string[]} [options.include] 纳入清单的子目录，默认 src/assets/jsb-adapter
 * @param {string} options.outputDir 清单输出目录
 * @param {boolean} [options.writeLocalManifestToSrcRoot] 是否同时把 project.manifest 写进构建目录（随包）
 * @param {string} [options.localPackageUrl] 随包清单专用的远端根地址（渠道地址而非 release 地址）
 * @param {string} [options.localVersion] 随包清单专用的版本号，默认与 version 相同
 * @returns {{projectManifest: object, versionManifest: object, projectManifestText: string, versionManifestText: string, fileCount: number, totalBytes: number, include: string[]}}
 */
function generateManifests(options) {
    const srcRoot = path.resolve(required(options, 'srcRoot'));
    if (!fs.existsSync(srcRoot) || !fs.statSync(srcRoot).isDirectory()) {
        throw new Error(`构建数据根目录不存在：${srcRoot}`);
    }
    const version = String(required(options, 'version'));
    const include = (options.include && options.include.length ? options.include : DEFAULT_INCLUDE).slice();
    const manifest = createManifest({
        version,
        packageUrl: required(options, 'packageUrl'),
        remoteManifestUrl: options.remoteManifestUrl,
        remoteVersionUrl: options.remoteVersionUrl,
        searchPaths: options.searchPaths,
    });

    const missing = [];
    let totalBytes = 0;
    for (const directory of include) {
        const absolute = path.join(srcRoot, directory);
        if (!fs.existsSync(absolute)) {
            missing.push(directory);
            continue;
        }
        for (const relative of collectRelativeFiles(srcRoot, directory)) {
            const file = path.join(srcRoot, relative);
            const size = fs.statSync(file).size;
            totalBytes += size;
            manifest.assets[encodeURI(relative)] = { size, md5: md5OfFile(file) };
        }
    }
    if (missing.length === DEFAULT_INCLUDE.length) {
        throw new Error(
            `在 ${srcRoot} 下没有找到任何待清单化目录（${DEFAULT_INCLUDE.join(' / ')}）；请确认这是原生构建产物目录`,
        );
    }

    const fileCount = Object.keys(manifest.assets).length;
    if (!fileCount) throw new Error(`清单为空：${srcRoot} 下 ${include.join(' / ')} 没有任何文件`);

    const projectManifestText = `${JSON.stringify(manifest)}\n`;
    const versionManifest = { ...manifest };
    delete versionManifest.assets;
    delete versionManifest.searchPaths;
    const versionManifestText = `${JSON.stringify(versionManifest)}\n`;

    const outputDir = options.outputDir ? path.resolve(options.outputDir) : null;
    if (outputDir) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(path.join(outputDir, 'project.manifest'), projectManifestText, 'utf8');
        fs.writeFileSync(path.join(outputDir, 'version.manifest'), versionManifestText, 'utf8');
    }
    if (options.writeLocalManifestToSrcRoot) {
        // 随包清单要和远端清单"文件列表一致、地址/版本不同"：
        //   - 地址指向**渠道目录**（渠道目录才是可变指针），否则包一装上就锁死在某个 release 上；
        //   - 版本用**客户端版本号**（localVersion），不是 releaseId —— 它描述的是"打包进安装包的这份内容"，
        //     而不是"远端某个 release"。两者都用 release-stamp 比较函数，语义上包内版本永远早于后续 release，
        //     首次启动因此会正常进入文件级比对（内容一致时下载量为 0）。
        const localManifest = options.localPackageUrl || options.localVersion
            ? createManifest({
                version: options.localVersion ? String(options.localVersion) : version,
                packageUrl: options.localPackageUrl || manifest.packageUrl,
                searchPaths: options.searchPaths,
            })
            : manifest;
        localManifest.assets = manifest.assets;
        fs.writeFileSync(path.join(srcRoot, 'project.manifest'), `${JSON.stringify(localManifest)}\n`, 'utf8');
    }

    return {
        projectManifest: manifest,
        versionManifest,
        projectManifestText,
        versionManifestText,
        fileCount,
        totalBytes,
        include,
        localManifestVersion: options.writeLocalManifestToSrcRoot
            ? (options.localVersion ? String(options.localVersion) : version)
            : null,
    };
}

function required(options, name) {
    const value = options && options[name];
    if (value == null || value === '') throw new Error(`缺少必填参数：${name}`);
    return value;
}

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) throw new Error(`未知参数：${item}`);
        const [name, inline] = item.slice(2).split('=', 2);
        if (inline !== undefined) {
            result[name] = inline;
            continue;
        }
        const next = argv[index + 1];
        if (next == null || next.startsWith('--')) {
            result[name] = true;
            continue;
        }
        result[name] = next;
        index += 1;
    }
    return result;
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) {
        printUsage();
        return 0;
    }
    const outcome = generateManifests({
        srcRoot: args.src,
        version: args.version,
        packageUrl: args['package-url'],
        remoteManifestUrl: args['remote-manifest-url'],
        remoteVersionUrl: args['remote-version-url'],
        localPackageUrl: args['local-package-url'],
        localVersion: args['local-version'],
        searchPaths: args['search-paths'] ? String(args['search-paths']).split(',').map((item) => item.trim()).filter(Boolean) : [],
        include: args.include ? String(args.include).split(',').map((item) => item.trim()).filter(Boolean) : undefined,
        outputDir: args.dest,
        writeLocalManifestToSrcRoot: args['in-place'] === true || args['in-place'] === 'true',
    });
    const summary = {
        version: outcome.projectManifest.version,
        packageUrl: outcome.projectManifest.packageUrl,
        remoteManifestUrl: outcome.projectManifest.remoteManifestUrl,
        fileCount: outcome.fileCount,
        totalBytes: outcome.totalBytes,
        include: outcome.include,
        projectManifestSha256: crypto.createHash('sha256').update(outcome.projectManifestText).digest('hex'),
        versionManifestSha256: crypto.createHash('sha256').update(outcome.versionManifestText).digest('hex'),
    };
    if (args.report) {
        fs.mkdirSync(path.dirname(path.resolve(args.report)), { recursive: true });
        fs.writeFileSync(path.resolve(args.report), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
}

function printUsage() {
    process.stdout.write([
        '用法：node tools/hotupdate/hotupdate_manifest.js --src <构建数据根目录> --version <主版本号> --package-url <远端根地址> [--dest <输出目录>]',
        '',
        '  --src                  构建数据根目录（含 src/assets/jsb-adapter），如 build/android/data',
        '  --version              主版本号，建议直接用 releaseId（客户端按“不相同即更新”处理）',
        '  --package-url          远端资源根地址，须与本 release 目录一致，末尾 / 可省略',
        '  --dest                 清单输出目录（写 project.manifest + version.manifest）',
        '  --in-place             true 时额外把 project.manifest 写进 --src 根（随包发给客户端）',
        '  --local-package-url    随包清单专用的远端根地址（一般是渠道目录，而非 release 目录）',
        '  --local-version        随包清单专用的版本号，默认同 --version；',
        '                         发布脚本应传客户端版本号（包内基线 describe 的是"打进包的那份内容"）',
        '  --remote-manifest-url  覆盖清单里的 remoteManifestUrl',
        '  --remote-version-url   覆盖清单里的 remoteVersionUrl',
        '  --search-paths         逗号分隔，写入清单的 searchPaths（一般留空）',
        '  --include              逗号分隔，覆盖默认的 src,assets,jsb-adapter',
        '  --report               把摘要 JSON 写到该路径',
        '',
    ].join('\n'));
}

module.exports = {
    DEFAULT_INCLUDE,
    collectRelativeFiles,
    generateManifests,
    parseArgs,
};

if (require.main === module) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`生成热更新清单失败：${error && error.message ? error.message : error}\n`);
        process.exitCode = 1;
    }
}
