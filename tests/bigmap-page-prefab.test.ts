import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const path = 'assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab';
test('页面、基地与公共样式不再运行时搭建 UI', () => {
    for (const file of readdirSync('assets/script/app/bigmap/view').filter((name) => name.endsWith('.ts'))) {
        const source = readFileSync(`assets/script/app/bigmap/view/${file}`, 'utf8');
        assert.doesNotMatch(source, /new Node\(|\.addComponent\(|createUiNode|createLabel|createButton|createBigMapSprite|destroyAllChildren/);
    }
    assert.ok(existsSync(path), '固定界面必须落为可编辑 Prefab');
});

test('基地建筑走贴底卡：不再进居中 InfoPopup，点空地能收起，卡片节点与引用完整', () => {
    const page = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    // 卡片是**非模态**的那一层，必须由页面主动驱动。
    assert.match(page, /renderPlotCard/);
    // 旧路径：基地建筑曾走 `mode === 'base' && selectedPlotHexId >= 0` 分支塞进居中详情弹窗。
    assert.doesNotMatch(page, /this\.mode === 'base' && this\.selectedPlotHexId >= 0/,
        '基地建筑不该再走居中 InfoPopup');
    // 非模态没有"点空白关闭"的天然时机，必须在地图侧补一条 clear。
    assert.match(readFileSync('assets/script/app/bigmap/view/BigMapBaseView.ts', 'utf8'), /kind: 'clear'/);

    const objects = JSON.parse(readFileSync(path, 'utf8'));
    const card = objects.find((o: { __type__: string; _name?: string }) => o.__type__ === 'cc.Node' && o._name === 'PlotCard');
    assert.ok(card, '页面预制体必须有 PlotCard 节点');
    const widget = card._components
        .map((r: { __id__: number }) => objects[r.__id__])
        .find((c: { __type__: string }) => c.__type__ === 'cc.Widget');
    assert.ok(widget, 'PlotCard 必须挂 cc.Widget');
    assert.equal(widget._alignFlags, 20, '卡片必须贴底 + 水平居中');
    assert.match(readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8'),
        /cardWidget\.bottom = dockHeight \+ 12/, '详情应放在基地底栏上方');

    const layout = objects.find((o: object) => 'plotCard' in o && 'baseView' in o);
    assert.ok(layout, 'BigMapPageLayout 应持有 plotCard');
    assert.ok(objects[layout.plotCard.__id__], 'plotCard 引用必须能解析');
});

test('页面模板引用完整，所有 UI 节点都有尺寸组件，CUSTOM Sprite 禁止裁剪回写', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8'));
    const bindings = objects.find((o: object) => 'topHud' in o && 'buildMenuButton' in o);
    assert.ok(bindings);
    for (const [name, ref] of Object.entries(bindings)) {
        if (ref && typeof ref === 'object' && '__id__' in ref) assert.ok(objects[ref.__id__ as number], name);
    }
    const topHud = objects.find((o: object) => 'resourceValues' in o && 'playerCard' in o) as {
        resourceValues: { __id__: number }[]; resourceIcons: { __id__: number }[]; playerCard: { __id__: number };
    } | undefined;
    assert.ok(topHud, 'TopHud 组件必须持有 5 格资源与玩家卡');
    assert.equal(topHud.resourceValues.length, 5);
    assert.equal(topHud.resourceIcons.length, 5);
    for (const ref of [...topHud.resourceValues, ...topHud.resourceIcons]) assert.ok(objects[ref.__id__]);
    for (const node of objects.filter((o: { __type__: string }) => o.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, node._name);
        assert.ok(node._components.some((r: { __id__: number }) => objects[r.__id__].__type__ === 'cc.UITransform'), node._name);
    }
    for (const sprite of objects.filter((o: { __type__: string; _sizeMode: number }) => o.__type__ === 'cc.Sprite' && o._sizeMode === 0)) {
        assert.equal(sprite._isTrimmedMode, false);
    }
    // 贴图引用的**类型**必须是 SpriteFrame。
    // 2026-11-11 踩过：MCP 用 png 主 uuid 设 `spriteFrame`，落盘成
    // `__expectedType__: cc.ImageAsset`，于是 `Sprite.__preload` → `Simple.updateUVs`
    // 读 `imageAsset.uv[0]` 直接崩（编辑器打 prefab 就一串 `Cannot read properties of undefined (reading '0')`）。
    // 正确写法是 spriteFrame 子资源 uuid：`<pngUuid>@f9941`。
    for (const sprite of objects.filter((o: { __type__: string }) => o.__type__ === 'cc.Sprite')) {
        const frame = sprite._spriteFrame;
        if (!frame) continue;
        assert.equal(frame.__expectedType__, 'cc.SpriteFrame',
            `Sprite 的 spriteFrame 类型写成 ${frame.__expectedType__}，运行时会崩在 Simple.updateUVs`);
    }
    assert.ok(objects.some((o: object) => 'plotTemplate' in o && 'viewport' in o));
    assert.ok(objects.some((o: object) => 'selection' in o && 'resource' in o && 'badgeTransform' in o));
});

test('页面宿主也走 prefab：入口不再用代码 new 节点 / addComponent 搭 UI', () => {
    const source = readFileSync('assets/script/app/bigmap/application/BigMapEntry.ts', 'utf8');
    // 注释里提到 `addComponent` 是允许的（说明历史做法），只查真实代码行。
    const code = source.split('\n').filter((line) => {
        const text = line.trim();
        return !text.startsWith('*') && !text.startsWith('//') && !text.startsWith('/*');
    });
    assert.equal(code.some((line) => /new\s+Node\(/.test(line)), false,
        '入口不该 new Node 搭页面宿主 —— 应使用 ui/bigmap/BigMapPageHost.prefab');
    assert.equal(code.some((line) => /\.addComponent\(/.test(line)), false,
        '入口不该 addComponent 搭 UI —— 组件配置应在 prefab 里');
});

test('建造目录已下线独立弹窗，统一收归底栏 DesignDock：Popup 已彻底移除，DesignDock 承载完整建造与升级', () => {
    const popupPath = 'assets/bundles/bigmap/ui/bigmap/BigMapBuildMenuPopup.prefab';
    const popupScriptPath = 'assets/script/app/bigmap/view/BigMapBuildMenuPopup.ts';
    assert.equal(existsSync(popupPath), false, 'BigMapBuildMenuPopup.prefab 必须已删除');
    assert.equal(existsSync(popupScriptPath), false, 'BigMapBuildMenuPopup.ts 必须已删除');

    // 页面侧：面板与手写遮罩都已移除，BigMapPage.ts 中不再引用或打开独立弹窗
    const pageObjects = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    for (const name of ['BuildPanel', 'BuildMenuDim', 'BuildRowTemplate', 'Backdrop']) {
        assert.equal(pageObjects.some((item) => item.__type__ === 'cc.Node' && item._name === name), false,
            `页面里不该再有 ${name}`);
    }

    // 验证 DesignDock 结构完整
    const dock = pageObjects.find((item) => item.__type__ === 'cc.Node' && item._name === 'DesignDock');
    assert.ok(dock, '页面预制体中必须存在 DesignDock');
    const topRow = pageObjects.find((item) => item.__type__ === 'cc.Node' && item._name === 'TopRow');
    assert.ok(topRow, 'DesignDock 必须包含 TopRow');
    const cards = pageObjects.find((item) => item.__type__ === 'cc.Node' && item._name === 'Cards');
    assert.ok(cards, 'DesignDock 必须包含 Cards 建筑卡容器');

    const pageSource = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(pageSource, /BigMapBuildMenuPopup/, 'BigMapPage.ts 不得再引用 BigMapBuildMenuPopup');
    assert.doesNotMatch(pageSource, /refreshBuildMenu/, 'BigMapPage.ts 不得再有 refreshBuildMenu');
});

test('建筑卡主按钮两段式：取消建造 / 升级必须二次确认', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPlotCard.ts', 'utf8');
    assert.match(source, /confirmPending/, '主按钮要有确认态');
    assert.match(source, /确认取消？/, '取消建造的确认文案');
    assert.match(source, /确认升级？/, '升级的确认文案');
    // 第一下只改文案，不能直接发意图 —— 否则「点错就丢资源」的老问题会回来。
    assert.doesNotMatch(source, /private handlePrimary\(\): void \{ this\.sendIntent/,
        'handlePrimary 不能一进来就发意图');
    // 500ms 全量 refresh 会覆盖按钮文案，确认态必须优先。
    assert.match(source, /if \(this\.confirmPending\) \{[\s\S]{0,120}primaryLabel\.string/,
        'render 里确认态要盖过常规文案');
});

test('底板染色代理 BigMapPanel 已整文件移除：prefab 不再挂它，底板色只留在 Sprite 的 _color 上', () => {
    // 2026-11-12 彻底清：`BigMapPanel` 只做一件事 —— `onEnable` 把 `background.color` 写成 `fill`。
    // 它挂过的 5 个节点（BigMapPage 的 BaseFallback / ResourceCard / QueueStatus / ModeFrameFallback
    // ＋ 建造目录弹窗根节点）Sprite `_color` **全都恰好等于自己的 `fill`** ⇒ 运行时是 no-op 复写，
    // 而且还和 Sprite 构成两个真源（改 Sprite 的颜色会被 `onEnable` 刷回 `fill`）。
    // 全工程 `getComponent(BigMapPanel)` 零命中 ⇒ 脚本与 meta 一并 svn delete。
    assert.equal(existsSync('assets/script/app/bigmap/view/BigMapPanel.ts'), false,
        'BigMapPanel.ts 必须已删除 —— 留着会被当成活代码，也让下面的计数守卫失去意义');

    const page = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapPage.prefab', 'utf8')) as Record<string, unknown>[];
    assert.equal(page.filter((item) => item.__type__ === 'b8a05X1iStIKZKq2Ksls5lW').length, 0,
        'BigMapPage.prefab 不该再挂 BigMapPanel —— 底板色直接写在 Sprite 的 _color 上');

    // 视觉不能跟着组件一起删：5 处底板色原样留在 Sprite 上（数值取自删除前的 `fill`）。
    const spriteColor = (objects: Record<string, unknown>[], nodeName: string) => {
        const node = objects.find((item) => item.__type__ === 'cc.Node' && item._name === nodeName) as Record<string, unknown> | undefined;
        assert.ok(node, `${nodeName} 节点必须还在（底板是它，不是组件）`);
        const sprite = (node._components as { __id__: number }[])
            .map((ref) => objects[ref.__id__])
            .find((item) => item.__type__ === 'cc.Sprite') as Record<string, unknown> | undefined;
        assert.ok(sprite, `${nodeName} 必须有 cc.Sprite 才看得见`);
        const color = sprite._color as Record<string, number>;
        return [color.r, color.g, color.b, color.a];
    };
    const expected: Record<string, [number, number, number, number]> = {
        BaseFallback: [246, 176, 82, 255],
        ModeFrameFallback: [245, 224, 172, 255],
    };
    for (const [name, rgba] of Object.entries(expected)) {
        assert.deepEqual(spriteColor(page, name), rgba, `${name} 的底板色不能跟着删组件一起变`);
    }
});

test('建造队列改由设计稿底栏顶行显示，旧队列条已清理', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    const node = (name: string) => objects.find((item) => item.__type__ === 'cc.Node' && item._name === name) as Record<string, unknown> | undefined;
    assert.equal(node('QueueStatus'), undefined, '旧队列条节点必须删除');
    assert.equal(node('QueueText'), undefined, '旧队列摘要文本必须删除');
    const queueValue = node('QueueValue');
    assert.ok(queueValue, '设计稿顶行的队列数值必须存在');
    const label = (queueValue._components as { __id__: number }[]).map((ref) => objects[ref.__id__])
        .find((item) => item.__type__ === 'cc.Label') as Record<string, unknown> | undefined;
    assert.ok(label, 'QueueValue 必须是 Label');
    assert.equal(label._string, '0/1');
    const topRow = node('TopRow');
    assert.ok(topRow, 'DesignDock/TopRow 必须存在');
});

test('世界与基地共用一套 TopHud：玩家卡 + 5 格资源 + 基地队列，旧 Header 已删除', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8'));
    const node = (name: string) => objects.find((item: any) => item.__type__ === 'cc.Node' && item._name === name);
    const refName = (ref: any): string | null => {
        if (!ref || ref.__id__ == null) return null;
        const item = objects[ref.__id__];
        if (item._name) return item._name;
        return item.node ? refName(item.node) : item.__type__;
    };
    const component = (owner: any, predicate: (item: any) => boolean) => owner._components
        .map((ref: any) => objects[ref.__id__]).find(predicate);

    assert.ok(node('TopHud'), '页面必须有唯一的 TopHud');
    assert.equal(node('DesignHud'), undefined, '基地旧顶栏名应已并入 TopHud');
    assert.equal(node('Header'), undefined, '世界旧顶栏 Header 必须删除');
    assert.equal(node('ResourceCard'), undefined, '旧 568 宽资源条必须删除');

    const topHud = component(node('TopHud'), (item: any) => 'resourceValues' in item && 'playerCard' in item);
    assert.ok(topHud, 'TopHud 节点必须挂 BigMapTopHud');
    assert.deepEqual(topHud.resourceValues.map(refName), ['GrainValue', 'WoodValue', 'IronValue', 'CoinValue', 'StaminaValue']);
    assert.deepEqual(topHud.resourceIcons.map(refName), ['GrainIcon', 'WoodIcon', 'IronIcon', 'CoinIcon', 'StaminaIcon']);
    assert.equal(refName(topHud.playerCard), 'PlayerCard');
    assert.equal(refName(topHud.queueCard), 'QueueCard');
    assert.equal(refName(topHud.buildQueueValue), 'QueueBuildValue');
    assert.equal(refName(topHud.researchQueueValue), 'QueueResearchValue');
    assert.deepEqual(topHud.coinNodes.map(refName), ['CoinPanel', 'CoinIcon', 'CoinValue']);
    assert.deepEqual(topHud.plusNodes.map(refName), ['GrainPlus', 'WoodPlus', 'IronPlus', 'StaminaPlus']);

    // 队列卡的所有可见内容必须在 QueueCard 子树里：TopHud 在世界模式只关这个节点，
    // 图标 / 标题 / 数值若留在 TopHud 下会继续浮在 SLG 顶栏上。
    const queueCard = node('QueueCard');
    for (const queueName of ['QueueBuildIcon', 'QueueResearchIcon', 'QueueBuildLabelBg', 'QueueBuildTitle',
        'QueueBuildValue', 'QueueResearchTitle', 'QueueResearchValue']) {
        assert.equal(refName(node(queueName)._parent), 'QueueCard', `${queueName} 必须挂在 QueueCard 子树内`);
    }
    assert.equal(queueCard._active, true, 'QueueCard 本体保留，由 BigMapTopHud.render 按模式切换');

    // 世界模式是 5 格 2×3 网格：金币补在第 2 列第 3 行，不能只落右列留空左格。
    assert.equal(node('CoinPanel')._lpos.x, 110.5, '金币应与粮/铁同列');
    assert.equal(node('CoinIcon')._lpos.x, 63.5);
    assert.equal(node('CoinValue')._lpos.x, 118);

    const player = node('PlayerCard');
    const bar = component(player, (item: any) => 'avatarIcon' in item && 'powerLabel' in item);
    assert.ok(bar, 'PlayerCard 必须挂 MainResBar（复用主界面 CmdRole 数据链）');
    assert.equal(refName(bar.avatarIcon), 'AvatarHead');
    assert.equal(refName(bar.nameLabel), 'NameLabel');
    assert.equal(refName(bar.levelLabel), 'LevelLabel');
    assert.equal(refName(bar.expFill), 'ExpFill');
    assert.equal(refName(bar.powerLabel), 'PowerLabel');

    for (const valueName of ['GrainValue', 'WoodValue', 'IronValue', 'CoinValue', 'StaminaValue']) {
        const value = node(valueName);
        assert.ok(value, `${valueName} 必须存在`);
        assert.ok(value._children.some((ref: any) => refName(ref) === 'SpendFloat'), `${valueName} 要预置反馈飘字`);
    }

    for (const name of ['GrainPanel', 'WoodPanel', 'IronPanel', 'StaminaPanel', 'CoinPanel']) assert.ok(node(name), name + ' 必须存在');
    const iconFrame = (name: string) => component(node(name), (item: any) => item.__type__ === 'cc.Sprite')._spriteFrame.__uuid__;
    const expectedFrames: Record<string, string> = {
        GrainIcon: '736907cd-9e2a-4f34-b589-1cc0be55c89c@f9941',
        WoodIcon: '7f9770fd-2f7e-4860-acda-7bafc1c97671@f9941',
        IronIcon: '8f324deb-ed43-4a78-9a53-bf04d53bc468@f9941',
        StaminaIcon: '600c3877-e900-4bb2-82c5-0e36076049ff@f9941',
        // 2026-11-26：`concept/sprites/coin.png` 删库，金币改用同目录的 `top_coin`（与 item 表 18504 同源）。
        CoinIcon: 'db512b1d-b61d-4954-b1ee-2dc2da2990a9@f9941',
    };
    for (const [name, uuid] of Object.entries(expectedFrames)) {
        assert.equal(iconFrame(name), uuid, `${name} 必须用 concept/ui/top_* 设计切图，不能回落到背包道具图标`);
    }
    for (const name of ['GrainPlus', 'WoodPlus', 'IronPlus', 'StaminaPlus']) {
        assert.equal(iconFrame(name), 'd2c42dfc-55c7-4861-b674-36532b03df7a@f9941', `${name} 使用设计稿绿色加号切图`);
        const transform = component(node(name), (item: any) => item.__type__ === 'cc.UITransform');
        assert.deepEqual([transform._contentSize.width, transform._contentSize.height], [28, 29],
            `${name} 必须按设计稿 1x 尺寸落位，不能按切图 2x 放大盖住数值`);
    }
    const coinSprite = component(node('CoinPanel'), (item: any) => item.__type__ === 'cc.Sprite');
    const grainSprite = component(node('GrainPanel'), (item: any) => item.__type__ === 'cc.Sprite');
    assert.equal(coinSprite._spriteFrame.__id__, grainSprite._spriteFrame.__id__, '金币底板沿用资源胶囊底图');
    assert.deepEqual([coinSprite._color.r, coinSprite._color.g, coinSprite._color.b, coinSprite._color.a], [255, 255, 255, 255]);
    for (const name of ['CoinPanel', 'CoinIcon', 'CoinValue']) {
        assert.equal(node(name)._active, false, `${name} 在基地设计稿里不显示，世界模式由 render 展开`);
    }
    // 基地设计稿只有 4 格，加号是设计的一部分；世界模式由 render 收起加号、展开金币。
    for (const name of ['GrainPlus', 'WoodPlus', 'IronPlus', 'StaminaPlus']) {
        assert.equal(node(name)._active, true, name + ' 按基地设计稿显示');
    }
    assert.equal(node('CoinPlus')._active, false, '金币格不带加号，和旧世界顶栏一致');

    const layout = component(node('BigMapPage'), (item: any) => 'topHud' in item && 'harvestButton' in item);
    assert.ok(layout, 'BigMapPageLayout 必须绑定唯一 TopHud');
    assert.equal(refName(layout.topHud), 'TopHud');
    for (const key of ['resourceLabels', 'resourceIcons', 'legacyHeader', 'designHud', 'designResourceLabels',
        'designBuildQueueValue', 'designResearchQueueValue']) {
        assert.equal(key in layout, false, `旧顶栏字段 ${key} 应已从 Layout 移除`);
    }

    // QueueCard 必须挂 cc.Button，且 TopHud 绑定 queueButton
    const queueCardNode = node('QueueCard');
    const queueBtn = component(queueCardNode, (item: any) => item.__type__ === 'cc.Button');
    assert.ok(queueBtn, 'QueueCard 必须挂 cc.Button（用于点击呼出/收起底部建造面板）');
    assert.equal(queueBtn._transition, 0, 'QueueCard 按钮 transition 必须是 NONE(0)');
    assert.equal(queueBtn._target, null, 'QueueCard 按钮 target 必须是 null');
    assert.equal(refName(topHud.queueButton), 'QueueCard', 'TopHud 必须持有 queueButton 引用');

    // 建造面板空白接收层（DockBlankCatcher）：全屏尺寸、Widget、Button 完整，且默认隐藏
    const catcherNode = node('DockBlankCatcher');
    assert.ok(catcherNode, '页面必须有 DockBlankCatcher 节点（用于点击空白隐藏建造面板）');
    assert.equal(catcherNode._active, false, 'DockBlankCatcher 默认必须隐藏');
    assert.equal(catcherNode._layer, 33554432, 'DockBlankCatcher 必须在 UI_2D 层');
    const catcherBtn = component(catcherNode, (item: any) => item.__type__ === 'cc.Button');
    assert.ok(catcherBtn, 'DockBlankCatcher 必须挂 cc.Button');
    assert.equal(catcherBtn._transition, 0);
    assert.equal(catcherBtn._target, null);
    assert.ok(component(catcherNode, (item: any) => item.__type__ === 'cc.Widget'), 'DockBlankCatcher 必须挂 cc.Widget');
    assert.equal(refName(layout.dockBlankCatcher), 'DockBlankCatcher', 'BigMapPageLayout 必须绑定 dockBlankCatcher 引用');

    // 检查所有 Label：当 _overflow=SHRINK (2) 时禁止开启 _enableWrapText
    for (const label of objects.filter((o: any) => o.__type__ === 'cc.Label')) {
        if (label._overflow === 2) {
            const ownerNode = objects[label.node.__id__];
            assert.equal(label._enableWrapText, false, `Label on ${ownerNode._name} overflow 为 SHRINK 时必须关掉 enableWrapText`);
        }
    }

    const harvest = node('HarvestAll');
    assert.equal(refName(harvest._parent), 'BigMapPage', '收获按钮挂在页面根，基地模式由 Layout 隐藏');
    assert.equal(harvest._active, false, 'Prefab 默认基地态：一键收获由 world 模式展开');
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8');
    assert.match(source, /this\.harvestButton\.node\.active = !base/);

    // 未开放页签（赛季、战争）必须挂载 cc.Button，包含 LockIcon 锁图标，且 Layout 绑定引用
    const seasonBtn = node('SeasonButton');
    assert.ok(seasonBtn, 'Nav 下必须有 SeasonButton 节点');
    assert.ok(component(seasonBtn, (item: any) => item.__type__ === 'cc.Button'), 'SeasonButton 必须挂载 cc.Button');
    const warBtn = node('WarButton');
    assert.ok(warBtn, 'Nav 下必须有 WarButton 节点');
    assert.ok(component(warBtn, (item: any) => item.__type__ === 'cc.Button'), 'WarButton 必须挂载 cc.Button');

    assert.equal(refName(layout.seasonButton), 'SeasonButton', 'Layout 必须绑定 seasonButton');
    assert.equal(refName(layout.warButton), 'WarButton', 'Layout 必须绑定 warButton');

    for (const parent of [seasonBtn, warBtn]) {
        const lockChild = parent._children
            .map((c: any) => objects[c.__id__])
            .find((c: any) => c._name === 'LockIcon');
        assert.ok(lockChild, `${parent._name} 必须有 LockIcon 子节点`);
        const sprite = component(lockChild, (item: any) => item.__type__ === 'cc.Sprite');
        assert.ok(sprite, 'LockIcon 必须挂载 cc.Sprite');
        assert.equal(sprite._spriteFrame.__uuid__, 'bf2cde12-f4ce-4761-bcd5-e114aa22dba8@f9941', '锁图标必须使用统一 icon_lock');
    }
});

test('Layout控件引用私有，宿主只调用展示接口，不持有控件或渲染其内容', () => {
    const source = readFileSync('assets/script/app/bigmap/view/BigMapPage.ts', 'utf8');
    assert.doesNotMatch(source, /this\.(?:resLabels|resourceIcons|buildRows|buildPanel|harvestButton|buildMenuButton|queueLabel|queuePanel|modeButton|baseView)\b/);
    assert.doesNotMatch(source, /(?:ui|this\.layout)\.(?:resourceLabels|resourceIcons|baseView|harvestButton|buildMenuButton|modeNode|modeLabel|modeIcon|modeFrame|modeFallback|buildPanel|buildRowTemplate|exploreButton|queuePanel|queueLabel|topHud)\b/);
    for (const file of ['BigMapPageLayout.ts', 'BigMapTopHud.ts']) {
        const layout = readFileSync(`assets/script/app/bigmap/view/${file}`, 'utf8');
        const lines = layout.split('\n');
        for (let index = 0; index < lines.length; index += 1) {
            if (!lines[index].includes('@property(')) continue;
            assert.ok(/\)\s+private\s/.test(lines[index]) || /^\s*private\s/.test(lines[index + 1] ?? ''),
                `${file}: ${lines[index]}`);
        }
    }
});
