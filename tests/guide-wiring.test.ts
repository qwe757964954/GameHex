/**
 * 引导「完成判定」的接线守卫。
 *
 * 这些都是业务侧的**一行挂点**（`reportGuideComplete(...)`），逻辑测试覆盖不到
 * （要跑真机才验证得了），所以用源码结构断言钉住：
 * 谁删了、改错参数、或者把判据硬编码进代码，这里直接红。
 *
 * 对应关系见 `guideStep.completeCond`：
 *   2-1/3-1/4-1/7-1 → tileFlipped    ← TerritoryController 的 randomTap
 *   5-1/5-2         → siteTap        ← TerritoryController 的 siteTap
 *   6-1             → pageOpened:card ← GuideComposition（英雄卡牌页）
 *   6-2             → cardSelected:<id> ← CardPopupComposition 的实际就绪快照
 *   6-3             → cardLevelUp:<id>  ← Controller 直接订阅 HeroUpgraded
 *   8-1             → popupClosed    ← MainTaskDetailPage.onClose
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

test('翻格上报：只在受理成功时发（randomTap / siteTap 都要被返回值包住）', () => {
    const src = read('assets/script/app/territory/application/TerritoryController.ts');
    assert.match(
        src,
        /if \(this\.model\.selectRandomResource\(intent\.cellId\)\) reportGuideComplete\('tileFlipped'\)/,
        'tileFlipped 必须跟 selectRandomResource 的返回值绑定，否则"钱不够点一下"也算翻了一格',
    );
    assert.match(
        src,
        /if \(site && this\.model\.selectSite\(site\)\) \{[\s\S]*?if \(canFlip\) reportGuideComplete\('tileFlipped'\);[\s\S]*?else if \(isTerritoryBattleSite\(site\)\) reportGuideComplete\('siteTap'\)/,
        'siteTap 必须跟 selectSite 的返回值绑定，否则点"点不动的格子"也会推进 5-1',
    );
});

test('6-1：英雄卡牌页的引导启动后核对页面，队伍编辑弹窗不代替卡牌页', () => {
    assert.match(
        read('assets/script/app/bootstrap/guide/GuideComposition.ts'),
        /this\.root\.getComponent\(CardLineupPage\)\) controller\.notify\('pageOpened', 'card'\)/,
    );
    assert.doesNotMatch(read('assets/script/app/card/LineupBoardPage.ts'), /reportGuideComplete\('pageOpened'/);
});

test('6-2：选中卡牌上报 cardSelected:<cardId>，不得硬编码 id', () => {
    const src = read('assets/script/app/bootstrap/card/CardPopupComposition.ts');
    assert.match(src, /state\.phase === 'ready'[\s\S]*reportGuideComplete\('cardSelected', state\.cardId\)/);
    assert.doesNotMatch(read('assets/script/app/bootstrap/main/MainPageComposition.ts'), /reportGuideComplete\('cardSelected'/);
    // 硬编码 68001 等于把判据搬进代码：表里换英雄后代码不会跟着变
    assert.doesNotMatch(src, /reportGuideComplete\('cardSelected',\s*68001\)/);
});

test('卡牌详情开关报告生命周期，误开详情的引导暂停和恢复有真实入口', () => {
    const src = read('assets/script/app/card/CardUpgradePage.ts');
    assert.match(src, /protected onOpen\(\)[\s\S]*?emit\(VIEW_LIFECYCLE, \{ owner: this, phase: 'enabled' \}\)/);
    assert.match(src, /protected onClose\(\)[\s\S]*?emit\(VIEW_LIFECYCLE, \{ owner: this, phase: 'disabled' \}\)/);
});

test('8-1：主线任务详情页关闭上报 popupClosed', () => {
    assert.match(
        read('assets/script/app/maintask/MainTaskDetailPage.ts'),
        /reportGuideComplete\('popupClosed'\)/,
    );
});

test('发奖出口：组合层必须注入 grant（否则奖励只打日志、玩家什么也拿不到）', () => {
    const src = read('assets/script/app/bootstrap/guide/GuideComposition.ts');
    assert.match(src, /grant: \(rewards, stepId\) =>/, '没注入 grant 时 GuideController 只 console.log');
});

test('引导提示：TapHint 与 MapHint/Text 到位，且都是 Label + UI_2D', () => {
    const d = JSON.parse(readFileSync('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab', 'utf8')) as {
        __type__?: string; _name?: string; _layer?: number; _components?: { __id__: number }[]; _children?: { __id__: number }[];
    }[];
    const at = (name: string) => d.findIndex((o) => o?.__type__ === 'cc.Node' && o._name === name);
    for (const name of ['TapHint', 'MapHint']) {
        const i = at(name);
        assert.ok(i >= 0, `${name} 节点不存在`);
        const labelNode = name === 'MapHint' ? d[(d[i]._children ?? []).find(c => d[c.__id__]._name === 'Text').__id__] : d[i];
        const comps = (labelNode._components ?? []).map((c) => d[c.__id__]);
        assert.ok(comps.some((c) => c.__type__ === 'cc.Label'), `${name} 缺 cc.Label`);
        assert.equal(d[i]._layer, 33554432, `${name} 的 layer 不是 UI_2D，UI 相机不会渲染`);
    }
});

test('引导提示：显隐判据必须用 completeCond（用 requireAction 会误导玩家）', () => {
    const src = readFileSync('assets/script/app/guide/ui/GuideDialogView.ts', 'utf8');
    assert.match(src, /applyHints/, '缺少 applyHints');
    assert.match(src, /state\.completeCond === 'click'/, 'TapHint 的判据必须是 completeCond');
    // 2-1 是 hole + tileFlipped：拿 requireAction 判会把 MapHint 判成 TapHint
    assert.doesNotMatch(src, /requireAction === 'click' \? \(advance/, '不要再用 requireAction 判推进/提示');
});

test('焦点光圈：prefab 里存在，且层级在「遮罩之上、立绘之下」', () => {
    const d = JSON.parse(readFileSync('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab', 'utf8')) as {
        __type__?: string; _name?: string; _children?: { __id__: number }[]; _components?: { __id__: number }[];
    }[];
    const root = d.find((o) => o?.__type__ === 'cc.Node' && o._name === 'GuideDialog');
    assert.ok(root);
    const names = (root._children ?? []).map((c) => d[c.__id__]._name as string);
    const ring = names.indexOf('FocusRing');
    assert.ok(ring >= 0, 'FocusRing 节点不存在');
    // 在遮罩之上：否则光圈被 40%/60% 黑压住，看不出高亮
    assert.ok(ring > names.indexOf('Dim'), 'FocusRing 必须在 Dim 之后（更上层）');
    // 在立绘之上：立绘 650×940 落点 y ∈ [-640,300]，会把屏幕中部的焦点地块整个罩住
    // （2026-11-13 真机实锤：光圈在立绘之下 ⇒ 完全看不见）
    assert.ok(ring > names.indexOf('Portrait'), 'FocusRing 必须在 Portrait 之后（更上层）');
    // 在对话条之下：不能压住台词
    assert.ok(ring < names.indexOf('DialogBox'), 'FocusRing 必须在 DialogBox 之前（更下层）');
});

test('焦点光圈：坐标必须由地图侧提供（View 不得 import 地图）', () => {
    const view = readFileSync('assets/script/app/guide/ui/GuideDialogView.ts', 'utf8');
    assert.match(view, /setFocusProvider/, '缺注入入口');
    assert.match(view, /convertToNodeSpaceAR/, '世界坐标必须转成本地坐标');
    assert.doesNotMatch(view, /from '\.\.\/\.\.\/territory/, 'View 不能直接 import 地图模块');

    const map = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.match(map, /getGuideFocusNode/, '地图侧缺查询入口');
    assert.match(map, /guideMapFocusCells\(focusNode, state\)/, '焦点必须按配置取模型的可操作集合');
});

test('hole 步必须隐藏立绘（否则 650×940 会把焦点地块整个罩住）', () => {
    const src = readFileSync('assets/script/app/guide/ui/GuideDialogView.ts', 'utf8');
    assert.match(src, /currentMaskType === 'hole'/, 'applyPortrait 里缺 hole 判据');
    assert.match(src, /this\.currentMaskType = state\.maskType/, 'render 必须先记下当前 maskType');
});

test('手指提示：FocusHand 使用固定的透明白手套 Sprite，不能回退为系统 emoji', () => {
    const d = JSON.parse(readFileSync('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab', 'utf8')) as {
        __type__?: string; _name__?: string; _name?: string; _layer?: number; _components?: { __id__: number }[];
        _spriteFrame?: { __uuid__: string }; _isTrimmedMode?: boolean;
    }[];
    const i = d.findIndex((o) => o?.__type__ === 'cc.Node' && o._name === 'FocusHand');
    assert.ok(i >= 0, 'FocusHand 节点不存在');
    const comps = (d[i]._components ?? []).map((c) => d[c.__id__]);
    const sprite = comps.find(c => c.__type__ === 'cc.Sprite');
    assert.ok(sprite, 'FocusHand 必须是 Sprite');
    assert.ok(!comps.some(c => c.__type__ === 'cc.Label'));
    const meta = JSON.parse(read('assets/bundles/main-pages/image/guide/guide_hand.png.meta'));
    assert.equal(sprite._spriteFrame?.__uuid__, meta.subMetas.f9941.uuid);
    assert.equal(sprite._isTrimmedMode, false);
    assert.equal(d[i]._layer, 33554432, 'FocusHand 的 layer 不是 UI_2D');
});

test('样式与接线：描边不遮地块，底板和姓名牌复用九宫格，固定引用及按钮完整', () => {
    const d = JSON.parse(read('assets/bundles/main-pages/ui/Guide/GuideDialog.prefab'));
    const node = (name: string) => d.find(o => o.__type__ === 'cc.Node' && o._name === name);
    const comps = (n: { _components: { __id__: number }[] }) => n._components.map(c => d[c.__id__]);
    assert.ok(comps(node('FocusRing')).some(c => c.__type__ === 'cc.Graphics' && c._lineWidth >= 4));
    assert.ok(!comps(node('FocusRing')).some(c => c.__type__ === 'cc.Sprite'));
    assert.ok(comps(node('ContentLab')).some(c => c.__type__ === 'cc.RichText' && c._handleTouchEvent === false));
    for (const name of ['NamePlate', 'DialogBox']) {
        const n = name === 'DialogBox' ? d[node(name)._children[0].__id__] : node(name);
        assert.ok(comps(n).some(c => c.__type__ === 'cc.Sprite' && c._type === 1 && c._isTrimmedMode === false));
    }
    const root = node('GuideDialog');
    const view = comps(root).find(c => 'dialogBox' in c);
    for (const property of ['portraitNode', 'dialogBox', 'nameLabelNode', 'contentLabelNode', 'blockerNode',
        'dimNode', 'tapHint', 'mapHint', 'focusRing', 'focusHand', 'debugSkipNode']) {
        assert.equal(d[view[property].__id__].__type__, 'cc.Node', property);
    }
    for (const n of d.filter(o => o.__type__ === 'cc.Node')) {
        assert.ok(comps(n).some(c => c.__type__ === 'cc.UITransform'), n._name);
        assert.equal(n._layer, 33554432, n._name);
    }
    for (const name of ['Blocker', 'DebugSkip']) {
        const button = comps(node(name)).find(c => c.__type__ === 'cc.Button');
        assert.equal(button._transition, 0);
        assert.equal(button._target, null);
    }
    const source = read('assets/script/app/guide/ui/GuideDialogView.ts');
    assert.doesNotMatch(source, /private advance\s*:|ensureBound|Phase\s*\+=|new Node\('DebugSkip'/);
    assert.match(source, /emit\(GuideEvent\.Advance, \{ owner: this, stepId: this\.stepId \}\)/);
});

test('光圈坐标：取之前必须刷新世界矩阵（分帧建格时 worldPosition 是脏的）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    assert.match(src, /updateWorldTransform\(\)/, 'getCellWorldPosition 里缺 updateWorldTransform');
    // 越界兜底：算出来的点跑到屏幕外时必须隐藏，而不是摆上去
    const view = readFileSync('assets/script/app/guide/ui/GuideDialogView.ts', 'utf8');
    assert.match(view, /limitX/, '缺越界兜底');
});

test('焦点格限定在真实视口内，并保持本步选中的格子', () => {
    const src = read('assets/script/app/main/MainTerritoryMap.ts');
    assert.match(src, /viewport.convertToNodeSpaceAR/);
    assert.match(src, /viewport.width \/ 2 - HEX_GRID_FACE_WIDTH \/ 2/);
    assert.match(src, /cellId === previousCell/);
    assert.doesNotMatch(src, /for \(const cellId of view.getCellIds\(\)\)/);
});
