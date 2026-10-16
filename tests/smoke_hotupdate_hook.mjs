/**
 * 构建扩展冒烟测试：在 tmp/ 下造一个最小原生构建目录，直接调 hook.onAfterBuild，
 * 校验 ①main.js 注入幂等 ②随包 project.manifest 生成正确 ③构建进程的 require 限制下仍能拿到生成器。
 * 不碰 build/ 下的真实产物。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const fixture = join(root, 'tmp', 'hook-smoke', 'data');

// 必须在 require hook.js **之前**设好：hook.js 在模块顶层就把留档目录读成常量。
// 不改道的话，本用例会把真实的 outputs/hotupdate-local/ 覆盖成 fixture 内容。
process.env.CITY1001_HOTUPDATE_LOCAL_OUT = join(root, 'tmp', 'hook-smoke', 'local');

rmSync(join(root, 'tmp', 'hook-smoke'), { recursive: true, force: true });
mkdirSync(join(fixture, 'src', 'chunks'), { recursive: true });
mkdirSync(join(fixture, 'assets', 'main'), { recursive: true });
mkdirSync(join(fixture, 'jsb-adapter'), { recursive: true });
writeFileSync(join(fixture, 'main.js'), '// SystemJS support.\nconst x = 1;\n', 'utf8');
writeFileSync(join(fixture, 'application.js'), 'export const Application = 1;\n', 'utf8');
writeFileSync(join(fixture, 'src', 'chunks', 'bundle.js'), 'console.log("chunk");\n', 'utf8');
writeFileSync(join(fixture, 'src', 'settings.json'), '{"a":1}\n', 'utf8');
writeFileSync(join(fixture, 'assets', 'main', 'index.js'), 'export default {};\n', 'utf8');
writeFileSync(join(fixture, 'jsb-adapter', 'jsb-builtin.js'), '// builtin\n', 'utf8');

const hook = require(join(root, 'extensions', 'hot-update', 'builder', 'hook.js'));
const { hasInjection } = require(join(root, 'extensions', 'hot-update', 'builder', 'inject.js'));

const failures = [];
const check = (label, condition) => {
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
    if (!condition) failures.push(label);
};

await hook.onAfterBuild({ platform: 'android', md5Cache: false }, { dest: fixture });
const once = readFileSync(join(fixture, 'main.js'), 'utf8');
check('main.js 已被注入', hasInjection(once));
check('注入片段在文件最前（先于 SystemJS 引导）', once.trimStart().startsWith('/* CITY1001_HOTUPDATE_INJECT_START */'));
check('原内容保留', once.includes('// SystemJS support.'));

await hook.onAfterBuild({ platform: 'android', md5Cache: false }, { dest: fixture });
const twice = readFileSync(join(fixture, 'main.js'), 'utf8');
check('重复构建不叠加注入块', twice.split('CITY1001_HOTUPDATE_INJECT_START').length - 1 === 1);
check('重复构建内容完全一致（幂等）', twice === once);

const localManifestPath = join(fixture, 'project.manifest');
check('随包 project.manifest 已写入构建根目录', existsSync(localManifestPath));
if (existsSync(localManifestPath)) {
    /**
     * 期望的渠道根目录，**从 hot_update.json 推导**而不是写死一个 IP。
     *
     * 钉死具体地址的坏处很实际：换热更服务器（内网 IP → COS）就得手改这条断言，
     * 忘了改就红，而红的原因看着像「清单生成坏了」、其实只是地址变了 ——
     * 久而久之就会有人为了让测试变绿去改断言，而不是去改配置。
     * 这里断言真正该保证的性质：**packageUrl 就是 latestUrlTemplate 去掉尾部那条模板后缀**。
     */
    const hotUpdateConfig = JSON.parse(
        readFileSync(join(root, 'assets', 'resources', 'config', 'hot_update.json'), 'utf8'),
    );
    const LATEST_URL_SUFFIX = '/{platform}/{channel}/latest.json';
    const template = String(hotUpdateConfig.latestUrlTemplate ?? '');
    const channelBase = template.endsWith(LATEST_URL_SUFFIX)
        ? template.slice(0, -LATEST_URL_SUFFIX.length).replace(/\/+$/, '')
        : '';
    check('hot_update.json 的 latestUrlTemplate 是可推导的渠道模板（带 {platform}/{channel}）',
        channelBase !== '' && /^https?:\/\//.test(channelBase));

    const manifest = JSON.parse(readFileSync(localManifestPath, 'utf8'));
    check('packageUrl 指向渠道根目录',
        manifest.packageUrl === `${channelBase}/android/${hotUpdateConfig.channel}/`);
    check('remoteManifestUrl 由 packageUrl 派生', manifest.remoteManifestUrl === `${manifest.packageUrl}project.manifest`);
    check('包内主版本号 = clientVersion', manifest.version === '0.6.0.0');
    check('清单覆盖 src/assets/jsb-adapter', Object.keys(manifest.assets).some((k) => k.startsWith('src/'))
        && Object.keys(manifest.assets).some((k) => k.startsWith('assets/'))
        && Object.keys(manifest.assets).some((k) => k.startsWith('jsb-adapter/')));
    check('main.js/application.js 不进清单（否则热更会自锁）', !manifest.assets['main.js'] && !manifest.assets['application.js']);
    check('每个条目都有 md5 + size', Object.values(manifest.assets).every((v) => typeof v.md5 === 'string' && v.md5.length === 32 && Number.isInteger(v.size)));
}

await hook.onAfterBuild({ platform: 'web-mobile', md5Cache: false }, { dest: fixture });
check('非原生平台不改动产物', readFileSync(join(fixture, 'main.js'), 'utf8') === once);

/* ---------------------------------------------------------------------------------------------
 * 回归：构建进程里的 require 只认扩展目录内的相对说明符。
 *
 * 线上现象（2026-09-28 那次 android 构建）：
 *   [hot-update] 无法加载清单生成器：D:\City1001\Demo3.8\tools\hotupdate\hotupdate_manifest.js
 *   [hot-update]                                                     ← error.message 是空的
 * 而同一份 hook.js 的 require('./inject.js') 是成功的（注入片段确实落盘了）。
 * 原生 node 下两种写法都能加载，所以这里手工把「绝对路径被拒」造出来 ——
 * 不然这条只会以"包内少了 project.manifest"的形式静默漏到线上。
 *
 * 本段**必须放在最后**：它 patch 的是 Module.prototype.require，改动静是进程级的。
 * ------------------------------------------------------------------------------------------- */
const Module = require('module');
const originalRequire = Module.prototype.require;
const EXTENSION_DIR = join(root, 'extensions', 'hot-update');
const manifestCacheEntries = () => Object.keys(require.cache).filter((key) => key.includes('hotupdate_manifest'));

const runWithBlockedRequire = async (label, shouldBlock) => {
    let blocked = 0;
    Module.prototype.require = function (request, ...rest) {
        if (typeof request === 'string' && shouldBlock(request)) {
            blocked += 1;
            throw new Error(); // 复刻线上：连 message 都是空的
        }
        return originalRequire.call(this, request, ...rest);
    };
    try {
        for (const key of manifestCacheEntries()) delete require.cache[key];
        rmSync(join(fixture, 'project.manifest'), { force: true });
        await hook.onAfterBuild({ platform: 'android', md5Cache: false }, { dest: fixture });
        const regenerated = existsSync(join(fixture, 'project.manifest'));
        check(`${label}：清单仍能生成`, regenerated);
        if (regenerated) {
            const manifest = JSON.parse(readFileSync(join(fixture, 'project.manifest'), 'utf8'));
            check(`${label}：清单内容正确`, manifest.version === '0.6.0.0'
                && Object.keys(manifest.assets).some((k) => k.startsWith('src/')));
        }
        return { blocked, cached: manifestCacheEntries().length };
    } finally {
        Module.prototype.require = originalRequire;
    }
};

// ① 只拦「跨扩展目录的绝对路径」—— 正是线上那一刀。
//    首选是「读源码求值」，压根不经过 require ⇒ blocked 应为 0。
const round1 = await runWithBlockedRequire(
    '轮① 绝对路径被拒',
    (request) => isAbsolute(request) && !request.startsWith(EXTENSION_DIR),
);
check('轮① 完全不依赖宿主 require（blocked=0）', round1.blocked === 0);

// ② 更狠：只要说明符里带 hotupdate_manifest 就拦 ⇒ 宿主 require 策略再严也不影响。
//    判据：清单照样生成，且 require 缓存里**没有**生成器条目（说明是 fs 求值拿到的）。
const round2 = await runWithBlockedRequire(
    '轮② 所有说明符都被拒',
    (request) => request.includes('hotupdate_manifest'),
);
check('轮② 宿主 require 全拒也不影响（blocked=0）', round2.blocked === 0);
check('轮② 由「读源码求值」拿到生成器（不进 require 缓存）', round2.cached === 0);

// 静态：三路都在，且最可靠的那路排第一；相对说明符作为兜底不能被删掉
const hookSource = readFileSync(join(root, 'extensions', 'hot-update', 'builder', 'hook.js'), 'utf8');
check('hook.js 首选「读源码求值」（顺序正确）',
    hookSource.indexOf("attempt('读源码求值'") >= 0
    && hookSource.indexOf("attempt('读源码求值'") < hookSource.indexOf("attempt('相对说明符 require'"));
check('hook.js 保留相对说明符作兜底',
    hookSource.includes("'../../../tools/hotupdate/hotupdate_manifest.js'"));
check('hook.js 带版本指纹（改完没重启编辑器时能一眼看出来）',
    /const HOOK_REVISION = '\d{4}-\d{2}-\d{2}\.\d+'/.test(hookSource)
    && hookSource.includes('rev ${HOOK_REVISION}'));

console.log('');
console.log(failures.length ? `失败 ${failures.length} 项：${failures.join(' / ')}` : '全部通过');
process.exitCode = failures.length ? 1 : 0;
