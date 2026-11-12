/**
 * `CommonTips`「点两次才算确认」的守卫。
 *
 * 能力本身是为「提前结束需要 2 次确认」做的：第一次点确定只把按钮文案换成 `confirmAgainText`、
 * 窗口不关，第二次点才走 `onSure` + 关闭。
 *
 * 山猫 2026-11-11 实机改口径：**投降只留一次确认**（`confirmAgainText` 会让按钮变「再次确认」，
 * 看起来像第二层弹窗）。所以能力保留为通用可选项，但**投降不再接入** —— 见第三条用例。
 *
 * 为什么是源码断言而不是行为测试：`CommonTips` 直接 extends `PopupBase`，依赖
 * `cc` + `PopupManager` + `ProcedureManager` 整条链，Node 里起不了实例（本文件不 import 它）。
 * 这里钉住三个**缺一即静默失效**的点：
 *   ① 缺省不传 ⇒ 老行为（一次确认），改动默认行为会波及 league / mail 等 8 处调用；
 *   ② 每次打开重置 `armed` —— 实例复用时不重置，一打开就是「再点一次」态；
 *   ③ 第一次点确定**只换文案并 return**（不关闭、不回调），第二次才 close。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tips = readFileSync('assets/script/app/common/CommonTips.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const runtime = readFileSync('assets/script/app/zcds/application/ZCBattleRuntimeController.ts', 'utf8');

test('通用提示框支持「点两次才算确认」，缺省不传时仍是一次确认', () => {
    assert.match(tips, /confirmAgainText\?: string;/, '要有这个入参');
    // 判定条件必须是「配了 + 还没上膛」，缺前半段会让所有确认框都变成点两次
    assert.match(tips, /if \(options\?\.confirmAgainText && !this\.armed\)/, '第一次点确定只上膛');
    assert.match(tips, /this\.armed = true;[\s\S]{0,80}this\.sureLabel\.string = options\.confirmAgainText;[\s\S]{0,40}return;/,
        '上膛后只换按钮文案并立刻返回，不许关窗、不许回调 onSure');
});

test('每次打开重置上膛状态（实例复用不能带着上一轮的状态）', () => {
    assert.match(tips, /private armed = false;/, '要有上膛状态');
    assert.match(tips, /private apply\(options: CommonTipsOptions\): void \{[\s\S]{0,160}this\.armed = false;/,
        'apply 里必须重置，否则复用实例第二次打开一进来就是「再点一次」');
});

test('投降只确认一次：不再配「再次确认」，也不会串行弹两个框', () => {
    assert.doesNotMatch(runtime, /confirmAgainText: '再次确认'/, '投降已改为一次确认（2026-11-11 口径）');
    assert.equal((runtime.match(/popups\.confirm\(/g) ?? []).length, 1, 'confirm 只在一个地方调用（串行两次会变两个框）');
    assert.match(runtime, /content: '你确定放弃当前对局，提前退出嘛？'/, '文案是策划原文');
});
