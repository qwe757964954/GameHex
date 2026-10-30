/**
 * 测试侧的资源路径解析 —— 不写死 `assets/resources/`，改为按分包根自动探测。
 *
 * ## 为什么要有这个文件
 *
 * 美术与 prefab 从 `assets/resources/` 迁到 `assets/bundles/{main-pages,battle,bigmap}/` 之后，
 * 测试里 464 处硬编码的 `assets/resources/...` 一夜之间全部落到不存在的路径上，
 * 表现为 **291 个 ENOENT 失败 / 零报错语义**：测试不是「跑挂了」，而是「根本没找到要断言的东西」。
 *
 * 更麻烦的是它**不可自愈**：以后再搬一次分包，同一批测试会再红一遍，
 * 而红之前没有任何信号（`existsSync` 只是返回 false）。
 *
 * 所以判据必须从「路径等于某个字面量」改成「按已知分包根能解析到」。
 * 搬家只改本文件的 {@link BUNDLE_ROOTS}，353 处调用点不用动。
 *
 * ## 三条纪律
 *
 * 1. **正向读取用 {@link assetPath}** —— 找不到就抛。静默返回拼好的假路径是最坏结果：
 *    调用方的 `existsSync` 会二次误判，错误离现场更远。
 * 2. **存在性断言用 {@link assetExists}** —— 返回 bool 不抛（有测试就是要断言「不该存在」，
 *    例如 `ui/League/LeagueExitConfirm.prefab` 必须查不到）。
 * 3. **`new URL(...)` / `readFileSync(URL)` 场景用 {@link assetUrl}** —— 直接给 file URL，
 *    别再手工 `new URL('../assets/resources/...', import.meta.url)`（那等于把根又写死一次）。
 *
 * ## 优先级
 *
 * {@link BUNDLE_ROOTS} 的顺序即探测顺序。当前实测 118 个被引用的字面路径**各自只命中一个根**，
 * 不存在歧义；若将来出现同名文件跨包，靠顺序定胜负，并在本文件补一行注释说明为什么是这个顺序。
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 资源根目录，按优先级探测。
 *
 * - 分包在前：`resources/` 里残留的都是还没搬走的旧位置，不该优先命中。
 * - `main-pages` 最先：它是大头（57 个唯一命中），命中率最高，少走几次 `existsSync`。
 */
export const BUNDLE_ROOTS = [
    'assets/bundles/main-pages',
    'assets/bundles/battle',
    'assets/bundles/bigmap',
    'assets/resources',
] as const;

/** `existsSync` 结果缓存 —— 同一次测试进程内资源树不变，重复探测没有意义。 */
const probed = new Map<string, string | null>();

/** 把 `assets/resources/` 之后的相对路径解析成真实磁盘路径；找不到返回 null。 */
function probe(rel: string): string | null {
    const cached = probed.get(rel);
    if (cached !== undefined) return cached;
    let hit: string | null = null;
    for (const root of BUNDLE_ROOTS) {
        const candidate = `${root}/${rel}`;
        if (existsSync(candidate)) {
            hit = candidate;
            break;
        }
    }
    probed.set(rel, hit);
    return hit;
}

/**
 * 解析资源路径（正向读取用）。**找不到直接抛** —— 让错误停在调用点，
 * 而不是让调用方对着一个不存在的路径继续 `readFileSync` / 断言。
 *
 * @param rel 相对资源根的路径，例如 `ui/ShowReward/ShowReward.prefab`
 * @throws 四个根下都不存在时抛错，错误信息列出探测过的根
 */
export function assetPath(rel: string): string {
    const hit = probe(rel);
    if (hit === null) {
        throw new Error(
            `资源不在任何分包根下: ${rel}\n  已探测: ${BUNDLE_ROOTS.join(', ')}`,
        );
    }
    return hit;
}

/**
 * 资源是否存在（存在性断言用，包括「断言不存在」的负向用例）。
 * 不抛异常 —— 负向用例靠 false 才是通过。
 */
export function assetExists(rel: string): boolean {
    return probe(rel) !== null;
}

/** 解析成 file URL，给 `new URL(...)` / `readFileSync(url)` 这类调用用。 */
export function assetUrl(rel: string): URL {
    return pathToFileURL(resolve(assetPath(rel)));
}

/**
 * 清空探测缓存。只给「同一个测试进程里改动了资源树」的场景用
 * （例如先把 prefab 移走再断言找不到）；普通用例不需要调用。
 */
export function resetAssetPathCache(): void {
    probed.clear();
}

/**
 * 目录下的**条目名并集**（跨所有分包根合并、去重）。
 *
 * 为什么要单独一个函数：`ui`、`image` 这两个**顶层目录**是分裂的
 * （实测 `ui` 分布在 main-pages 42 / battle 2 / bigmap 2 / resources 14，
 * `image` 分布在 main-pages 40 / battle 10 / bigmap 2 / resources 40）。
 * 对它们调 {@link assetPath} 只会锁定**第一个命中**的根，另一半永远看不到 ——
 * 于是「目录列举里必须有 Hang」这类大小写守卫会假红或假绿。
 *
 * 子目录（`image/league`、`ui/Gift` 等）目前都只存在于单一分包，
 * 用 {@link assetPath} 即可；只有**顶层**需要这个。
 *
 * @param rel 相对资源根、无尾斜杠的目录，例如 `ui`
 */
export function assetDirNames(rel: string): string[] {
    const names = new Set<string>();
    for (const root of BUNDLE_ROOTS) {
        const dir = `${root}/${rel}`;
        if (!existsSync(dir)) continue;
        for (const name of readdirSync(dir)) names.add(name);
    }
    return [...names];
}
