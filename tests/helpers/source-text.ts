/**
 * 源码文本断言的统一读取入口（2026-11-11）。
 *
 * 工程里 61 处跨行源码文本断言硬编码换行符（换行切片、含换行的正则等），
 * 一旦被断言的源码被整份 LF→CRLF，这些断言会集体假红 —— 2026-11-11 实测
 * `tests/zcds-status-resolution.test.ts` 两条行为用例就是这样被误判成「新增红」。
 *
 * 根因已由 `tests/definition-integrity.test.ts` F7 守卫从源头挡住（基线 LF → 现 CRLF 即红），
 * 因此不逐一迁移历史 61 处（避免触碰并行编辑中的文件，也不制造大面积无关 diff）。
 * 新增或改动源码文本断言时请走本 helper，让用例对换行符形态免疫，形成双保险。
 *
 * 用法：const source = readSource('assets/script/app/card/CardUpgradePage.ts');
 * 之后所有 assert.match 与换行切片都按 LF 语义书写即可。
 */
import { readFileSync } from 'node:fs';

/** 把 CRLF 与孤立 CR 统一成 LF；只改换行形态，不改任何文本语义。 */
export function normalizeSource(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

/** 读取源码并归一换行符；路径相对工程根（与既有测试的 readFileSync 用法一致）。 */
export function readSource(file: string): string {
    return normalizeSource(readFileSync(file, 'utf8'));
}
