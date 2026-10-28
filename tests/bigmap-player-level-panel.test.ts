import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 「别人玩家的关卡」弹窗（领地页）：`Dim` / `Panel` 的 `cc.BlockInputEvents` 归 **prefab** 管。
 *
 * 2026-10-28 之前是运行时 `addComponent` 补挂的 —— 两个组件都该在 prefab 里配好：
 * 组件是「界面结构」的一部分，Inspector 里看得见、改得动；写进代码只会让 prefab 看起来没配，
 * 下一个人去 Inspector 里找还找不到。
 *
 * ⚠️ 但**不能只删代码不验 prefab**：`BlockInputEvents` 缺了不报错，只表现为「点遮罩没反应 /
 * 点击穿透到地图上」—— 所以这条用例直接查 prefab 结构。
 * 与 `territory-async-player-panel.test.ts`（行为）互补：那条守 rebind / 遮罩点击，
 * 这条守「组件到底配在哪」。
 */

const PREFAB = 'assets/resources/ui/territory/BigMapPlayerLevelPanel.prefab';
const SCRIPT = 'assets/script/app/territory/view/BigMapPlayerLevelPanel.ts';

interface IPrefabObject {
    __type__?: string;
    _name?: string;
    node?: { __id__: number };
}

test('遮罩与面板的 BlockInputEvents 配在 prefab 上，脚本里不再运行时补挂', () => {
    const objects = JSON.parse(readFileSync(PREFAB, 'utf8')) as IPrefabObject[];
    const blockedNodes = objects
        .filter((object) => object.__type__ === 'cc.BlockInputEvents')
        .map((object) => objects[object.node!.__id__]._name)
        .sort();
    assert.deepEqual(blockedNodes, ['Dim', 'Panel'],
        'Dim / Panel 必须在 prefab 里挂 cc.BlockInputEvents（拦点击穿透），缺了不报错、只表现为漏点');

    // 剥注释：本文件的说明文字里就写着 `addComponent`，不剥会假红。
    const code = readFileSync(SCRIPT, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
    assert.ok(!/addComponent\(\s*BlockInputEvents\s*\)/.test(code),
        'prefab 已经配好 ⇒ 不许再运行时补挂（绑好的引用不写兜底，绑错应当场炸）');
    assert.match(code, /dimTransform\.node\.on\(Node\.EventType\.TOUCH_END/,
        '「点遮罩关闭」仍由脚本绑定 —— BlockInputEvents 只拦穿透，不替它关闭');
});
