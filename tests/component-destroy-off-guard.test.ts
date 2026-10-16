import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * `onDestroy` 里 `.off(...)` 的守卫（2026-09-30 真引擎实测，见 `tmp/_territory_destroy_probe.mjs`）。
 *
 * 引擎事实（这一版引擎）：
 *  - `Node.off` 的实现是 `this._eventProcessor.off(...)`，**不判空**；
 *  - `Node._onPreDestroyBase()` **先销毁子节点，再跑自身组件的 `onDestroy`**；
 *  - 节点销毁时 `_eventProcessor` 被置 `null`。
 *
 * ⇒ 在 `onDestroy` 里对**已被拆掉的子节点/别的节点**调 `off` 必抛
 *   `Cannot read properties of null (reading 'off')`；而且异常会打断 `NodeActivator.destroyComp`，
 *   引擎下一帧**重试销毁** ⇒ 同一个报错刷两遍（`TerritoryPage` 就是这么炸的）。
 *
 * 边界（探针实测）：
 *  - `this.node.off(...)` **安全** —— 组件 `onDestroy` 跑在自身节点释放 `_eventProcessor` 之前
 *    （实测 `this.node._eventProcessor` 仍存活、`isValid === true`）；
 *  - 对子节点 / 其它 `@property` 节点调 `off` **不安全**，除非确有 `isValid` 守卫。
 *
 * 节点销毁时 EventTarget 随之释放，监听不会泄漏 ⇒ 这类 `off` 本来就不需要写。
 */

function collectSources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) collectSources(path, out);
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
    }
    return out;
}

/** 取出 `onDestroy` 方法体（含签名行），用于扫描。 */
function onDestroyBodies(source: string): Array<{ line: number; body: string[] }> {
    const lines = source.split('\n');
    const found: Array<{ line: number; body: string[] }> = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!/(protected|private|public)?\s*onDestroy\s*\(/.test(lines[index])) continue;
        const body: string[] = [];
        let depth = 0;
        let started = false;
        for (let cursor = index; cursor < Math.min(index + 60, lines.length); cursor += 1) {
            body.push(lines[cursor]);
            depth += (lines[cursor].match(/\{/g) ?? []).length - (lines[cursor].match(/\}/g) ?? []).length;
            if (lines[cursor].includes('{')) started = true;
            if (started && depth <= 0) break;
        }
        found.push({ line: index + 1, body });
    }
    return found;
}

/** 允许在 `onDestroy` 里 `off` 的接收者：自己的节点、全局输入、FGUI 全局对象。 */
const SAFE_RECEIVERS = new Set(['this.node', 'input', 'gcom']);

/** 去掉注释再断言（规则 104：反向断言必须先剥注释，否则注释里的示例会被当成违规）。 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
}

test('onDestroy 里只允许对 this.node / 全局 input 摘监听，别的节点必须有 isValid 守卫', () => {
    const offenders: string[] = [];
    const checked: string[] = [];
    for (const file of [...collectSources('assets/script/app'), ...collectSources('assets/script/framework')]) {
        const source = stripComments(readFileSync(file, 'utf8'));
        for (const { line, body } of onDestroyBodies(source)) {
            const guarded = body.some((text) => text.includes('isValid'));
            for (let index = 0; index < body.length; index += 1) {
                const match = body[index].match(/^[^/]*?([A-Za-z_$][\w$.]*?)\.off\(/);
                if (!match) continue;
                const receiver = match[1];
                checked.push(`${file}:${line + index} → ${receiver}`);
                if (SAFE_RECEIVERS.has(receiver)) continue;
                if (guarded) continue;
                offenders.push(`${file}:${line + index}  receiver=${receiver}（无 isValid 守卫，销毁时子节点已先被拆 ⇒ 必抛 reading 'off'）`);
            }
        }
    }
    assert.ok(checked.length > 0, '至少要扫到几处 off（否则说明扫描逻辑失效了）');
    assert.deepEqual(offenders, [], `onDestroy 里摘监听的写法不合规：\n  ${offenders.join('\n  ')}`);
    // 反向确认：`TerritoryPage` 那处（子节点 MapViewport）已经删掉了
    const page = stripComments(readFileSync('assets/script/app/territory/view/TerritoryPage.ts', 'utf8'));
    assert.ok(
        !/mapViewport\.off\(/.test(page),
        'TerritoryPage.onDestroy 不能再对子节点 mapViewport 调 off（会抛 reading \'off\'）',
    );
});
