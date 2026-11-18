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
 *   8-1             → pageOpened:task ← MainTaskDetailPage.onOpen
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

test('8-1：玩家自己点开主线任务面板就算完成（不再由引导代开、也不等关闭）', () => {
    const src = read('assets/script/app/maintask/MainTaskDetailPage.ts');
    assert.match(src, /protected async onOpen\(\)[\s\S]{0,400}?reportGuideComplete\('pageOpened', 'task'\)/,
        '面板一开就要上报 pageOpened:task —— 8-1 的完成条件就是「玩家自己把入口点开」');
    assert.doesNotMatch(src, /reportGuideComplete\('popupClosed'\)/,
        '旧口径（关闭面板才算完成）已废：玩家要能点开看任务，不该被逼着关掉');
    // 引导侧不许再替玩家开面板（2026-11-18 第 27 条）。
    assert.doesNotMatch(read('assets/script/app/bootstrap/guide/GuideComposition.ts'),
        /focusNode === 'Popup\/MainGoal'/,
        '8-1 的焦点改成底栏任务入口；组合层再代开面板就等于绕过玩家这一下点击');
});

test('引导奖励由后端推送，组合层和控制器不模拟发奖或弹出本地奖励', () => {
    for (const path of ['assets/script/app/bootstrap/guide/GuideComposition.ts',
        'assets/script/app/guide/application/GuideController.ts']) {
        const src = read(path);
        assert.doesNotMatch(src, /\bgrant\s*[?:]|\bgrantRewards\b|FW\.ShowReward\(|ShowRewardPage\.open\(/, path);
    }
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
    // 第 17 条：关卡格子的「1-1」气泡挂在角标层，和地块不是父子 ⇒ 必须单独交给引导层做并集，
    // 否则光圈只能圈住地块、气泡永远在圈外。
    assert.match(map, /getGuideFocusExtraNodes/, '关卡气泡没有出口，光圈永远圈不到它');
    const bubble = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    assert.match(bubble, /getLevelBubbleNode\(cellId: number\)/, '地图视图要能按格号取气泡节点');
    const station = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    assert.match(station, /getLevelBubbleNode\(\): Node \| null/, '站点视图要暴露气泡节点');
    const composition = readFileSync('assets/script/app/bootstrap/guide/GuideComposition.ts', 'utf8');
    assert.match(composition, /extra: this\.territoryView\?\.getGuideFocusExtraNodes\(key\)/,
        '组合层必须把气泡一起交给视图（只查不传等于没做）');
});

test('回到主页面：引导要等领地页首帧（第 23 条）', () => {
    const src = readFileSync('assets/script/app/bootstrap/guide/GuideComposition.ts', 'utf8');
    // 结算点「确定」= 先上报 backToMap 再 navigate ⇒ 组合层比领地页早建，
    // 不压住首帧的话 6-1 会浮在一片裸底上开口说话（用户 2026-11-18 第 23 条）。
    assert.match(src, /const waitingForMap = !state\.finished && !!this\.territoryView && !this\.mapPresented/,
        '缺「等地图首帧」的闸门：6-1 会在章节地图出来之前就渲染');
    assert.match(src, /\|\| waitingForMap/, '闸门必须真的接进 view.hide() 那条分支，写了不用等于没做');
    assert.match(src, /owner === this\.territoryView && phase === 'presented'/,
        '必须认领地页首帧的 presented 事件（那是 state.ready && map && progress 都到位的时刻）');
    assert.match(src, /private markMapPresented\(\): void/, 'presented 与兜底计时要走同一个幂等入口');
    // 兜底：章节数据永远拉不下来时不能把整条引导钉死（与 MainTabHost 首屏兜底同一个思路）。
    assert.match(src, /territoryView\?\.scheduleOnce\(\(\) => this\.markMapPresented\(\), MAP_PRESENTED_FALLBACK_SECONDS\)/,
        '兜底计时丢了 = 一次网络失败就让引导永不出现');
    // 信号源必须还在（别把 MainTerritoryMap 的 presented 移除 / 改成每帧都发）。
    const map = readFileSync('assets/script/app/main/MainTerritoryMap.ts', 'utf8');
    assert.match(map, /firstReadyNotified[\s\S]{0,160}phase: 'presented'/,
        '领地页首帧只发一次 presented，改成每帧发会让引导层反复 render');
});

test('hole 步：立绘挡住焦点孔就必须让开（650×940 会把焦点地块整个罩住）', () => {
    const src = readFileSync('assets/script/app/guide/ui/GuideDialogView.ts', 'utf8');
    // 第 25 条：判据从「maskType 一刀切」换成「几何相交」（见下一条用例），但**结论不能丢** ——
    // 挡住那一刻必须真的把立绘收起来，否则玩家点不到焦点地块。
    assert.match(src, /private applyPortraitPlacement\(side: 1 \| -1, suppress: boolean\): void \{[\s\S]{0,400}?this\.portraitNode\.active = !suppress/,
        '挡孔时要把立绘收起来（骨骼挂在宿主下，关宿主一起走）');
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
    // 同一焦点键内先认已选格（两遍扫的第一遍），避免呼吸光圈每帧乱跳。
    assert.match(src, /const previousCell = this\.guideFocusKey === focusNode \? this\.guideFocusCell : null;/);
    assert.match(src, /if \(previousCell !== null\) \{[\s\S]{0,200}?this\.guideFocusCell = previousCell;[\s\S]{0,40}?return node;/);
    assert.doesNotMatch(src, /for \(const cellId of view.getCellIds\(\)\)/);
});

test('焦点格按候选顺序取第一个可见的，不再按「离屏幕中心最近」挑', () => {
    const src = read('assets/script/app/main/MainTerritoryMap.ts');
    // 按「最近」挑时，3-1 / 4-1 拿到的是同一份候选池 ⇒ 连续两步指向同一格，
    // 手指看着像没动，要等宝箱被点开、池子变了才跳（用户 2026-11-17 第 13 条 ①）。
    assert.doesNotMatch(src, /bestDistance/, '回到「取最近」会让连续两步指同一格');
    assert.match(src, /if \(previousCell !== null\)/, '同一焦点键内仍要保持已选格，避免光圈每帧乱跳');
    assert.match(src, /for \(const cellId of candidates\)[\s\S]{0,240}?this\.guideFocusCell = cellId;[\s\S]{0,40}?return node;/,
        '拿不到已选格时按顺序取第一个可见的');
});

test('焦点晚到会重试：底栏 / 地块节点晚几帧出现时，不靠「下一次换步」才补上', () => {
    const src = read('assets/script/app/guide/ui/GuideDialogView.ts');
    assert.match(src, /FOCUS_RETRY_INTERVAL_MS/, '重试间隔要落常量');
    assert.match(src, /private hasLiveFocus\(\): boolean \{[\s\S]{0,200}?activeInHierarchy/, '先判目标是否真的活着');
    assert.match(src, /private reacquireFocus\(\): boolean \{[\s\S]{0,420}?this\.resolveFocus\(\)/, '重试要重新走业务侧解析');
    assert.match(src, /if \(this\.focusKey\) \{[\s\S]{0,260}?this\.reacquireFocus\(\)/, 'update 里要接上重试');
    // 换步清零节流：否则新一步的第一个 150ms 白等。
    assert.match(src, /this\.focusRetryAt = 0;/, '换步要重置重试节流');
});

test('立绘不按 maskType 一刀切：hole 步先换边、两侧都挡才收（2026-11-18 第 25 条）', () => {
    const src = read('assets/script/app/guide/ui/GuideDialogView.ts');
    // 旧口径：`applyPortrait` 开头 `if (currentMaskType === 'hole') hidePortrait()` ——
    // 6-3（升级按钮，孔在右下）的立绘在对话框上方靠右，根本不重叠，却整段没了形象。
    assert.doesNotMatch(src, /if \(this\.currentMaskType === 'hole'\) \{\s*\n\s*this\.hidePortrait\(\);/,
        '立绘不许再按 maskType 一刀切藏掉');
    assert.match(src, /private syncPortraitSuppression\(focusVisible: boolean, halfWidth: number, halfHeight: number\): void \{/,
        '避让判据要有独立入口（每帧被 placeFocusRing 调）');
    // 三级让位：右侧站得下 → 换左侧 → 两侧都挡才收。能不收就不收，形象优先。
    assert.match(src, /if \(!this\.portraitHitsFocus\(halfWidth, halfHeight, 1\)\) this\.applyPortraitPlacement\(1, false\);[\s\S]{0,200}?else if \(!this\.portraitHitsFocus\(halfWidth, halfHeight, -1\)\) this\.applyPortraitPlacement\(-1, false\);[\s\S]{0,140}?else this\.applyPortraitPlacement\(this\.portraitSide, true\);/,
        '三级让位：右 → 左 → 才收');
    assert.match(src, /this\.syncPortraitSuppression\(visible, focusHalfWidth, focusHalfHeight\);/,
        '`placeFocusRing` 末尾必须调它（孔和立绘都是那一帧刚算出来的）');
    assert.match(src, /if \(side === this\.portraitSide && suppress === this\.portraitSuppressed\) return;/,
        '值没变不写节点（逐帧调用）');
});
