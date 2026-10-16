/**
 * 反向断言（规则 104）：`tween(...)` 的 target **不许**是裸量对象字面量。
 *
 * ## 为什么这条值得一个守卫
 *
 * `ActionManager` 只对 **Node 目标**注册 `NODE_DESTROYED`
 * （`cocos/tween/actions/action-manager.ts` `_registerNodeEvent`）——
 * 裸量 target（`tween({ v: 1 })`）**推不出任何停机时机**：
 *
 * ① 节点销毁**不会**停它；
 * ② `Tween.stopAllByTarget(this.node)` 也**打不到**它（target 不是这个节点）；
 * ③ 组件销毁时 `CCObject._destruct()` 会把组件所有 object 类型自有属性**置 null**
 *    （`cocos/core/data/object.ts` `compileDestruct`）；
 * ⇒ 回调里访问 `this.xxx`（如 `this.glow.color`）当场抛
 *    `Cannot set properties of null (setting '...')`，**且异常打断 `ActionManager.update`
 *    的整轮循环 ⇒ 同一帧其它补间全被跳过、错误每帧刷不停**。
 *
 * 2026-09-28 `ShowRewardItem` 的闪光淡出正是这个写法（关窗撞上补间必崩）。
 * 需要「tween 一个中间量」时，把 target 换成**本格某个节点**并用
 * `to(duration, {}, { onUpdate: (target, ratio) => ... })` 拿线性比例即可
 * （空 `props` 安全：`TweenAction.update` 的 props 循环为空，末句照调 `opts.onUpdate`）。
 */
import * as assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const APP_ROOT = 'assets/script';

function tsFiles(root: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (statSync(path).isDirectory()) out.push(...tsFiles(path));
        else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(path);
    }
    return out;
}

/** 剥注释（规则 104 ①）：本文件的文档就在讲这个反模式，不剥会自己命中自己。
 *  ⚠️ 块注释换成**等量换行**而不是空串 —— 否则报出来的行号被前移，对不上编辑器。 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

test('`tween(...)` 的 target 不是裸量对象字面量', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(APP_ROOT)) {
        const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
        lines.forEach((line, index) => {
            if (/\btween\s*\(\s*\{/.test(line)) offenders.push(`${file}:${index + 1}  ${line.trim()}`);
        });
    }
    assert.deepEqual(
        offenders,
        [],
        '这些 tween 的 target 是裸量对象 ⇒ 组件销毁后补间仍在跑、回调撞上被 `_destruct` 置 null 的属性：\n'
        + `${offenders.join('\n')}\n`
        + '改法：target 换成节点，用 `to(dur, {}, { onUpdate: (_t, ratio) => ... })`。',
    );
});
