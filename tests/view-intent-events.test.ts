import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 护栏：**视图层只派发意图，不持有控制器回调**。
 *
 * 规范真源：`docs/AI架构与代码规范.md` §2.1 + `AGENTS.md`「实现硬约束」。
 * 反例就是 `ZCSettlementPage` 2026-10-27 之前的写法：
 *
 * ```ts
 * private onDoubleRewardClicked(): void { this.options?.onDoubleReward?.(); }   // ❌
 * ```
 *
 * 「可选回调 + 可选调用」的坑在于**漏传一个就是点了没反应且零报错** —— 没人会发现，
 * 只能靠人肉点一遍。正确写法是视图 `EventMgr.emit(...)`、控制器集中订阅；
 * 「接了没接」用 `hasXxx?: boolean` 门闩，不要拿回调的有没有值当门闩。
 *
 * 扫描范围刻意限死 `app/<feature>/view/**` 与 `app/<feature>/ui/**`（页面组件都在 `ui/`）：
 * - `app/procedure/**` 的主界面加载状态由独立事件契约通知，不放进路由参数；
 * - 引擎/Cocos 侧的 `node.on(...)`、`skeleton?.skeletonData?...` 也不会命中这个模式。
 */
const APP_ROOT = join(__dirname, '..', 'assets', 'script', 'app');

/** 去掉块注释与行注释 —— 注释里举例的反例不该被算成违规。 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 递归收集视图层文件（路径含 `/view/` 或 `/ui/` 的 `.ts`，`.meta` 不算）。 */
function collectViewFiles(directory: string, into: string[] = []): string[] {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) {
            collectViewFiles(path, into);
            continue;
        }
        if (!name.endsWith('.ts')) continue;
        if (/\/(view|ui)\//.test(path.replace(/\\/g, '/'))) into.push(path);
    }
    return into;
}

/** 「可选回调 + 可选调用」：`this.options?.onXxx?.(...)`、`params?.onSave?.(...)`。 */
const OPTIONAL_CALLBACK_CALL = /\?\.[A-Za-z]*[Oo]n[A-Z][A-Za-z]*\?\.\(/;

const viewFiles = collectViewFiles(APP_ROOT);

test('护栏自检：扫描范围必须扫到视图层文件（防路径写错导致「空扫恒绿」）', () => {
    assert.ok(viewFiles.length >= 20,
        `只扫到 ${viewFiles.length} 个视图层文件 —— 扫描范围写错了，本判据会变成永远绿的摆设`);
    for (const required of [
        'assets/script/app/zcds/ui/ZCSettlementPage.ts',
        'assets/script/app/zcds/view/ZCGameHUDView.ts',
    ]) {
        assert.ok(
            viewFiles.some((path) => path.replace(/\\/g, '/').endsWith(required)),
            `${required} 必须落在扫描范围内`,
        );
    }
});

test('视图层不许「可选回调 + 可选调用」—— 意图必须走 EventMgr 派发', () => {
    const violations: string[] = [];
    for (const path of viewFiles) {
        const code = stripComments(readFileSync(path, 'utf8'));
        for (const [index, line] of code.split(/\r?\n/).entries()) {
            if (!OPTIONAL_CALLBACK_CALL.test(line)) continue;
            violations.push(`${path.replace(/\\/g, '/')}:${index + 1}  ${line.trim()}`);
        }
    }
    assert.deepEqual(violations, [],
        '视图不得持有控制器回调：改成 EventMgr.instance.emit(...)、由控制器订阅；'
        + '需要用「接了没接」决定显隐时用 hasXxx?: boolean 门闩（规范 §2.1）');
});
