/**
 * 「解绑不得懒创建 cache」的回归网 —— 钉住一个**升级成事故级**的框架缺陷。
 *
 * ## 事故现场（2026-09-28，本刀实测）
 *
 * 现象：**在主界面里点底部第 0 格（商店）后，`Content` 是空的** —— 页面实例被创建、
 * `setParent(Content)` 也真的成功了（`CHILD_ADDED` 事件有），但下一帧就没了。
 * `host.currentPage` 还指着它、`parent` 也指着 `Content`，可 `Content.children.length === 0`，
 * 且**从场景根遍历根本找不到这个节点**。全程**一句错都不报**。
 *
 * 根因链：
 *   1. `MainTabHost.showPage()` 先 `currentPage.destroy()` 掉上一页（竞技页 `ArenaRoot`）；
 *   2. `ArenaRoot` 的 `onDestroy` → `MainEntranceList.onDestroy` →
 *      `CacheMgr.removeEventUpdate('CmdRole', …)` → `GameCacheMgr.removeEvent` →
 *      **`this.getCache(cacheName)`**；
 *   3. `getCache()` 在缺缓存时会 **`new GameCache('CmdRole')`**，而 `GameCache` 的构造会
 *      `init()` 去读协议描述表（`GameCacheMgr.protoCacheMessage`）；预览页停在热更/未登录态时
 *      表没加载 ⇒ `TypeError: Cannot read properties of undefined (reading 'CmdRole')`；
 *   4. 这个异常抛在 `onDestroy` 里 ⇒ 节点拿不到「已销毁」标记 ⇒
 *      **卡在 `CCObject._deferredDestroy` 队列里逐帧重试**（实测 163 次 / 2.5s，
 *      伴随海量 `You are trying to destroy a object twice or more.`）；
 *   5. 每次重试都对父节点发一次 `CHILD_REMOVED`，而 Cocos 的 `Node._removeChild` 实现是
 *      `splice(indexOf(child), 1)` —— 此时该子节点早已不在数组里，`indexOf === -1`
 *      ⇒ **`splice(-1, 1)` 删掉父节点的最后一个子节点**；
 *   6. 于是**每次切 tab，刚切进来的页面都会被上一页的销毁循环吃掉**。
 *
 * 这不是商城独有的：**任何** tab 切换（`showPage` → `destroy` 旧页）都会中招，
 * 命中的前提只是「那一帧协议表还没加载 / 缓存还没建」。
 *
 * ## 修法（最小且语义正确）
 *
 * **解绑路径一律「存在才操作」**：新增 `peekCache()`（只 `cacheDictionary.get()`，不创建），
 * `removeEvent` / `removeEventCaller` / `removeEventAll` 全改走它并先判空返回。
 * 没有缓存就说明从来没绑过，解绑本来也不该有副作用。
 * `setEvent`（绑定）**保持**走 `getCache()` —— 绑定时该创建。
 *
 * ## ⚠️ 写断言时的一个坑
 *
 * 修法旁边写了长注释解释事故链，注释里**本身就出现 `getCache(` 字样**。
 * ⇒ 所有「方法体内不许出现 `getCache(`」的断言**必须先去注释**，否则断言自己被注释绊倒。
 * 本文件的 `stripComments()` 是个带字符串状态机的手写剥离器（单引号 / 双引号 / 模板串 / 转义）。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const MGR_PATH = path.join(ROOT, 'assets/script/framework/cache/GameCacheMgr.ts');
const SRC = readFileSync(MGR_PATH, 'utf8');

/**
 * 剥离 `//` 行注释与 `/* … *​/` 块注释。
 * 用一个「当前是否在字符串里」的状态机，避免把字符串里的 `//` / `/*` 当成注释。
 */
function stripComments(code: string): string {
    let out = '';
    let i = 0;
    let quote: string | null = null;
    while (i < code.length) {
        const c = code[i];
        const n = code[i + 1];
        if (quote) {
            out += c;
            if (c === '\\') { out += n ?? ''; i += 2; continue; }
            if (c === quote) quote = null;
            i += 1;
            continue;
        }
        if (c === '/' && n === '/') { while (i < code.length && code[i] !== '\n') i += 1; continue; }
        if (c === '/' && n === '*') {
            i += 2;
            while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
            i += 2;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
        out += c;
        i += 1;
    }
    return out;
}

const CODE = stripComments(SRC);

/**
 * 取一个类方法的**方法体**（花括号配对，含 `//`/`/*` 剥离后的文本）。
 * 用 `^\s{4}[修饰符]名字(` 定位方法头，避免匹配到调用点。
 * ⚠️ 必须允许 `private` / `protected` / `static` / `async` 这些修饰符 ——
 * `peekCache` 就是 `private`，漏了这一步会报「找不到方法」。
 */
function methodBody(source: string, name: string): string {
    const head = new RegExp(`\\n {4}(?:(?:private|protected|public|static|async|readonly|get|set)\\s+)*${name}\\s*\\(`);
    const m = head.exec(source);
    assert.ok(m, `GameCacheMgr 里找不到方法 ${name}()（是不是被改名/删了？）`);
    const open = source.indexOf('{', m.index + m[0].length);
    assert.ok(open > 0, `${name}() 找不到方法体起始 {`);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
        const c = source[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
            depth -= 1;
            if (depth === 0) return source.slice(open, i + 1);
        }
    }
    throw new Error(`${name}() 花括号不配对`);
}

/** 三个「解绑」入口 —— 事故就是从 `removeEvent` 进去的。 */
const UNBIND_METHODS = ['removeEvent', 'removeEventCaller', 'removeEventAll'] as const;

// ---------------------------------------------------------------- A. 解绑路径
test('A1 解绑三兄弟体内不得出现 getCache( —— 解绑不许创建缓存', () => {
    for (const name of UNBIND_METHODS) {
        const body = methodBody(CODE, name);
        assert.ok(!/\bgetCache\s*\(/.test(body), `${name}() 里还有 getCache( ⇒ 会在 onDestroy 里抛错，把销毁循环引回来`);
    }
});

test('A2 解绑三兄弟必须走 peekCache() 且先判空返回', () => {
    for (const name of UNBIND_METHODS) {
        const body = methodBody(CODE, name);
        assert.match(body, /const cache = this\.peekCache\(cacheName\)/, `${name}() 没走 peekCache()`);
        assert.match(body, /if \(cache == null\) return;/, `${name}() 缺「缓存不存在就直接返回」的护栏`);
    }
});

test('A3 peekCache 只读字典、不创建，且返回 null 而非 undefined', () => {
    const body = methodBody(CODE, 'peekCache');
    assert.match(body, /cacheDictionary\.get\(cacheName\)/, 'peekCache 必须走 cacheDictionary.get()');
    assert.match(body, /\?\?\s*null/, 'peekCache 必须把 undefined 归一成 null');
    assert.ok(!/new\s+GameCache/.test(body), 'peekCache 绝不能 new GameCache');
    assert.ok(!/\bgetCache\s*\(/.test(body), 'peekCache 绝不能回头调 getCache()');
});

test('A4 解绑时 eventProxy 用可选链兜底（缓存被 destroy 过会是 null）', () => {
    for (const name of UNBIND_METHODS) {
        const body = methodBody(CODE, name);
        assert.match(body, /cache\.eventProxy\?\./, `${name}() 应对 cache.eventProxy 用 ?.（销毁过的缓存 eventProxy 为 null）`);
    }
});

// ---------------------------------------------------------------- B. 绑定侧不许被顺手改坏
test('B1 setEvent 必须仍然走 getCache() —— 绑定时就该把缓存建出来', () => {
    const body = methodBody(CODE, 'setEvent');
    assert.match(body, /this\.getCache\(cacheName\)/, 'setEvent 丢了 getCache() ⇒ 绑定不再自动建缓存，行为会变');
});

test('B2 getCache 必须保留懒创建语义（缺则 new GameCache）', () => {
    const body = methodBody(CODE, 'getCache');
    assert.match(body, /cacheDictionary\.get\(cacheName\)/, 'getCache 应先查字典');
    assert.match(body, /cache == null/, 'getCache 应判断是否缺');
    assert.match(body, /new\s+GameCache\(cacheName\)/, 'getCache 丢了懒创建 ⇒ 绑定路径会拿到 null');
    assert.match(body, /cacheDictionary\.set\(cacheName, cache\)/, 'getCache 建完必须写回字典');
});

// ---------------------------------------------------------------- C. 调用点护栏
test('C1 三个 onDestroy 解绑点都还在（别把解绑删成泄漏）', () => {
    const sites: Array<[string, string]> = [
        ['assets/script/app/main/MainEntranceList.ts', 'removeEventUpdate'],
        ['assets/script/app/main/MainResBar.ts', 'removeEventUpdate'],
        ['assets/script/app/firstRecharge/FirstRechargePage.ts', 'removeEventUpdate'],
    ];
    for (const [rel, needle] of sites) {
        const text = readFileSync(path.join(ROOT, rel), 'utf8');
        assert.ok(text.includes(needle), `${rel} 里的 ${needle} 解绑不见了`);
    }
});

test('C2 事故链的说明必须留在源码里（防后来人把 peekCache 改回 getCache）', () => {
    assert.match(SRC, /deferred destroy/, '请保留「卡在 deferred destroy 队列逐帧重试」这段说明');
    assert.match(SRC, /splice\(-1/, '请保留「splice(-1,1) 会删掉父节点最后一个子节点」这个机制说明');
    assert.match(SRC, /CHILD_REMOVED/, '请保留 CHILD_REMOVED 这个中间环节');
});
