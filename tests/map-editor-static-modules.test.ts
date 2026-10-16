// 地图编辑器的「静态模块白名单」守卫。
//
// 2026-09-29 踩过：给章节编辑器新增 formats/territory-issue-cells.js 时忘了改
// tools/map-editor/server.mjs 的静态路由 —— 那是**硬编码白名单**，没列到的路径
// 一律回落成 index.html。于是浏览器把 HTML 当 ES module 解析 ⇒ import 失败 ⇒
// 整个 territory-app.js 不执行：window.__territoryEditor 都不存在、地图空白，
// 而服务端 / 控制台**零报错**（只有浏览器控制台一行 MIME/parse 错误）。
// ⇒ 判据：app 里 import 的每个 `./formats/*.js` 都必须被路由正则覆盖、且文件真实存在。
//
// 零旗标命名导入（tests/ 没开 allowSyntheticDefaultImports）
import * as assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const server = readFileSync('tools/map-editor/server.mjs', 'utf8');

test('编辑器 HTML 和 JS 每次重载都从服务端获取最新版本', () => {
    assert.match(server, /res\.writeHead\(200, \{ 'Content-Type': filename\.endsWith\('\.js'\)[^\n]+, 'Cache-Control': 'no-store' \}\)/);
});

function importedFormats(entry: string) {
    const source = readFileSync(entry, 'utf8');
    return [...source.matchAll(/from '(\.\/formats\/[^']+)'/g)].map((match) => match[1].replace('./', ''));
}

test('两个编辑器 import 的 formats/*.js 都被静态路由覆盖', () => {
    // 从源码里取出那条路由正则的字面量，再当正则用（别用正则去匹配正则，转义会绕死）
    const literal = server.match(/const formatModule = (\/[^\n]*?\/)\.exec\(url\.pathname\);/);
    assert.ok(literal, 'server.mjs 应有 formats/*.js 的路由正则');
    const pattern = new RegExp(literal[1].slice(1, -1));
    assert.equal(pattern.test('/formats/territory-issue-cells.js'), true, `路由正则认不出模块名：${literal[1]}`);

    const modules = [...importedFormats('tools/map-editor/territory-app.js'), ...importedFormats('tools/map-editor/app.js')];
    assert.ok(modules.length >= 2, `应该 import 到 formats 下的模块，实际 ${JSON.stringify(modules)}`);
    for (const module of modules) {
        const pathname = `/${module}`;
        assert.ok(pattern.test(pathname), `静态路由没放行 ${pathname}（页面会拿到 index.html ⇒ 整编辑器挂掉）`);
        assert.ok(existsSync(`tools/map-editor/${module}`), `${pathname} 对应的文件不存在`);
    }
});

// ⚠️ 只断言「源码里有那条正则」会漏掉真 bug：条件里不引用它，正则就是死代码
// （2026-09-29 变异检验逮到过一次 —— 把条件退回硬编码白名单，用例照样绿）。
test('那条正则真的接进了路由：条件判断 + 文件名拼接都必须用到 formatModule', () => {
    const start = server.indexOf('const formatModule');
    const route = server.slice(start, server.indexOf('const content = await readFile', start));
    assert.ok(route.length > 0, '取不到路由分支');
    assert.match(route, /if \(req\.method === 'GET' && \([\s\S]*formatModule\)\) \{/);
    assert.match(route, /: formatModule \? `formats\/\$\{formatModule\[1\]\}` : 'index\.html';/);
});

test('入口三件套在白名单里，且正则不许穿出 formats/', () => {
    // 入口三件套也必须在白名单里
    for (const entry of ['/territory.html', '/territory-app.js', '/app.js']) {
        assert.ok(server.includes(`url.pathname === '${entry}'`), `白名单缺入口 ${entry}`);
    }
    // 正则不许放行带路径分隔符的名字（否则能穿出 formats/）
    const pattern = /^\/formats\/([a-z0-9-]+\.js)$/;
    assert.equal(pattern.test('/formats/../server.mjs'), false);
    assert.equal(pattern.test('/formats/territory-issue-cells.js'), true);
});
