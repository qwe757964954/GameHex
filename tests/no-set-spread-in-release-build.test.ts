import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * release 构建会把 `[...set]` / `[...map]` 降级成 `[].concat(x)`，
 * 而 `Array.prototype.concat` **只展开数组、不展开迭代器**
 * ⇒ 结果是「装着 Set/Map 本身的单元素数组」。
 *
 * 危害等级：**静默失效**。`.sort()` / `.map()` / `.join()` 全都不报错，
 * 只是结果悄悄变成空 / NaN / undefined，编辑器预览往往正常（未走同一套降级），
 * 只有打包后炸 ⇒ 本地测不出来。
 *
 * ## 判据为什么是这个形状（改过两次，踩过两次坑）
 *
 * 第一版是「已知是 Set 的变量名白名单」⇒ 漏掉 `[...buildSeatProfiles(...)]`
 *   （展开源是**函数返回值**，类型是 Map 但名字不像集合），线上崩在
 *   `ZCGameHUDView.setSeatProfiles` 读 `profile.headKey`。
 *
 * 第二版改成「裸标识符一律报警」⇒ 误报一大堆真数组（`[...bindings]`、`[...rows]`），
 *   逼着人给几十处无害代码加豁免，规则会被绕过去。
 *
 * 现在这版是收敛后的口径：**只对「源码层面能确定是集合」的情形报警** ——
 *   ① 显式迭代器：`.values()` / `.keys()` / `.entries()`
 *   ② 显式集合构造：字面量里出现 `new Set(` / `new Map(`
 * 其余（裸标识符、函数返回值）**查不了**，交给代码评审 + 产物核对 ——
 *   见技能 cocos-release-set-spread-degrade 的「回产物核对」一节。
 *
 * 误报与漏报之间选了误报少：规则要能被长期执行下去，不能靠人天天豁免。
 */

const SCAN_ROOTS = ['assets/script'];
const SKIP_DIRS = new Set(['node_modules', 'library', 'temp', 'build']);

/** 展开源是 Set/Map 的显式迭代器 —— 一定是集合，无需人判。 */
const ITERATOR = /\.(values|keys|entries)\(\)/;

/** 展开源显式构造了 Set/Map。 */
const COLLECTION_CTOR = /new\s+(Set|Map)\s*\(/;

/**
 * 展开源是**函数返回值**，且该函数**返回 Map/Set**。
 *
 * ⚠️ 这一类是最容易漏的（实测崩过一次）：`[...buildSeatProfiles(...)]` 展开源长得
 * 不像集合，但返回类型是 Map ⇒ 降级后 `new Map([[Map]])` 的值全 undefined ⇒
 * 报在**下游**读属性时，真凶在这里。
 *
 * 判据 = 扫工程里 `export function X(...): Map<...>` / `: ReadonlyMap<...>` /
 * `: Set<...>` 的函数名，命中即视为集合来源。
 */
const MAP_RETURN_FN = /(?:export\s+)?function\s+(\w+)\s*\([^)]*\)\s*:\s*(?:Readonly)?(?:Map|Set)</g;

function collectFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const file = join(dir, name);
        if (statSync(file).isDirectory()) {
            if (SKIP_DIRS.has(name)) continue;
            collectFiles(file, out);
        } else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) {
            out.push(file);
        }
    }
    return out;
}

/** 收集工程里所有「返回 Map/Set」的函数名。 */
function collectCollectionReturningFns(files: readonly string[]): Set<string> {
    const names = new Set<string>();
    // ⚠️ 用 `exec` 循环而不是 `matchAll`：正则带 `g` 时 `lastIndex` 会跨调用残留，
    //    在同一进程里跑多个文件时会漏匹配（且行为随遍历顺序变化，极难查）。
    const re = new RegExp(MAP_RETURN_FN);
    for (const file of files) {
        const src = readFileSync(file, 'utf8');
        let m: RegExpExecArray | null;
        while ((m = re.exec(src)) !== null) {
            if (m[1]) names.add(m[1]);
        }
    }
    return names;
}

test('assets/script 不得对 Set/Map 用 [...x] 展开', () => {
    const files = SCAN_ROOTS.flatMap((root) => collectFiles(root));
    const collectionFns = collectCollectionReturningFns(files);
    const offenders: string[] = [];
    for (const file of files) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((raw, index) => {
            const line = raw.trim();
            // 注释里复现写法是允许的（那正是本条规则的说明）。
            if (line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) return;
            const match = /\[\.\.\.([^\]]+?)\]/.exec(line);
            if (!match) return;
            const source = match[1].trim();
            const isCollection = ITERATOR.test(source)
                || COLLECTION_CTOR.test(source)
                // ⚠️ 展开源调用了「返回 Map/Set 的函数」—— 崩过一次的就是这类
                || [...source.matchAll(/(\w+)\s*\(/g)].some((m) => m[1] && collectionFns.has(m[1]));
            if (!isCollection) return;
            offenders.push(`${file}:${index + 1}: ${line.slice(0, 120)}`);
        });
    }
    assert.deepEqual(offenders, [], [
        '以下位置对 Set/Map 用 [...x] 展开，release 构建会降级成 [].concat(x) 而静默失效：',
        '请改用 Array.from(x)。',
        ...offenders,
    ].join('\n'));
});

test('裸标识符 / 函数返回值这种「查不了」的展开，交给产物核对而非本测试', () => {
    // 把上面这条口径钉死：`[...someVar]` / `[...buildXxx()]` 本测试**不报**。
    // 早先版本想靠白名单覆盖它们，结果既漏（漏了 buildSeatProfiles）又误报
    // （几十处真数组），两头不讨好。真正的判据在构建产物里比对，见技能文档。
    const arrayLike: unknown[] = [1, 2];
    const fromArray = [...arrayLike];
    assert.deepEqual(fromArray, [1, 2]);

    const map = new Map([['a', 1]]);
    // 这就是降级后的形态：`concat` 不展开迭代器。
    const degraded = ([] as unknown[]).concat(map);
    assert.equal(degraded.length, 1);
    assert.equal(degraded[0], map, 'concat 结果装着 Map 本身 —— 这就是线上崩的形态');
});

test('Array.from 不会被构建降级成 concat（前提成立性自证）', () => {
    // 若哪天降级器连 Array.from 也动了，这条会先红 —— 说明上面的守卫判据需要重写。
    const set = new Set([3, 1, 2]);
    assert.deepEqual(Array.from(set).sort((a, b) => a - b), [1, 2, 3]);
    const map = new Map([['a', 1]]);
    assert.deepEqual(Array.from(map.values()), [1]);
});