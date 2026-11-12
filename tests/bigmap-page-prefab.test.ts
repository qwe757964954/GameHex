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
    // 卡片贴底、不能被导航钮压住（ModeNode bottom = nav+20、高 96）。
    const widget = card._components
        .map((r: { __id__: number }) => objects[r.__id__])
        .find((c: { __type__: string }) => c.__type__ === 'cc.Widget');
    assert.ok(widget, 'PlotCard 必须挂 cc.Widget');
    // `_alignFlags = 20` = BOT(4) + CENTER(16)：贴底 + 水平居中。
    // ⚠️ 不校验 prefab 里的 `_bottom` 数值 —— Widget 保存时会按当前 position 重算它，
    // 真正生效的是 `applyNavigationHeight` 里按导航高算的那次赋值（与 ModeNode 同一套）。
    assert.equal(widget._alignFlags, 20, '卡片必须贴底 + 水平居中');
    assert.match(readFileSync('assets/script/app/bigmap/view/BigMapPageLayout.ts', 'utf8'),
        /cardWidget\.bottom = navigationHeight \+ 124/, '贴底间距必须按导航高算，避免压住模式钮');

    const layout = objects.find((o: object) => 'plotCard' in o && 'baseView' in o);
    assert.ok(layout, 'BigMapPageLayout 应持有 plotCard');
    assert.ok(objects[layout.plotCard.__id__], 'plotCard 引用必须能解析');
});

test('页面模板引用完整，所有 UI 节点都有尺寸组件，CUSTOM Sprite 禁止裁剪回写', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8'));
    const bindings = objects.find((o: object) => 'resourceLabels' in o && 'buildMenuButton' in o);
    assert.ok(bindings);
    assert.equal(bindings.resourceLabels.length, 5);
    assert.equal(bindings.resourceIcons.length, 5);
    for (const [name, ref] of Object.entries(bindings)) {
        if (ref && typeof ref === 'object' && '__id__' in ref) assert.ok(objects[ref.__id__ as number], name);
    }
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

test('建造目录是独立 Popup：prefab 完整、引用已绑、页面不再内嵌面板', () => {
    const popupPath = 'assets/bundles/bigmap/ui/bigmap/BigMapBuildMenuPopup.prefab';
    assert.ok(existsSync(popupPath), '建造目录应有独立 prefab（不再内嵌在页面里）');
    const popupObjects = JSON.parse(readFileSync(popupPath, 'utf8')) as Record<string, unknown>[];

    // 页面侧：面板与手写遮罩都已移除 —— 遮罩由 `PopupBase.ensureBlankCatcher` 自动接管。
    const pageObjects = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    for (const name of ['BuildPanel', 'BuildMenuDim', 'BuildRowTemplate']) {
        assert.equal(pageObjects.some((item) => item.__type__ === 'cc.Node' && item._name === name), false,
            `页面里不该再有 ${name} —— 它已经搬进弹窗`);
    }

    // 弹窗侧：行容器 / 行模板两个引用必须绑上（留空就是运行时空指针）。
    // ⚠️ 这里**不再断言 `titleLabel`**：`PopupBase` 已无这个 `@property`（`framework/ui` 里零命中），
    //    `Title` 节点也随 2026-11 的标题改造删掉了；旧 prefab 里剩下的 `titleLabel` 是孤儿字段，
    //    编辑器一保存就会整键丢弃 ⇒ 继续断言它必然永久红，只会被当成基线红吞掉。
    const script = popupObjects.find((item) => 'rowTemplate' in item && 'rowsRoot' in item) as Record<string, unknown> | undefined;
    assert.ok(script, '弹窗脚本应有 rowsRoot / rowTemplate');
    for (const key of ['rowsRoot', 'rowTemplate']) {
        const ref = script[key] as { __id__?: number } | undefined;
        assert.ok(ref && typeof ref.__id__ === 'number', `${key} 必须绑定，不能留空`);
    }

    // 行模板默认隐藏，靠 `onInit` 复制使用。
    const template = popupObjects.find((item) => item.__type__ === 'cc.Node' && item._name === 'BuildRowTemplate');
    assert.ok(template, '弹窗里必须有行模板');
    assert.equal(template._active, false, '行模板应默认隐藏');

    // 弹窗必须在 UI_2D 层，否则整棵子树不渲染。
    for (const node of popupObjects.filter((item) => item.__type__ === 'cc.Node')) {
        assert.equal(node._layer, 33554432, node._name as string);
    }
});

test('建造目录每行 Name / Detail 上下分栏：位置重合就会叠成一坨', () => {
    // 2026-11-11 实测：两个 Label 都在 (0,0) 且都居中，整列文本叠成一片看不清。
    const popupPath = 'assets/bundles/bigmap/ui/bigmap/BigMapBuildMenuPopup.prefab';
    const objects = JSON.parse(readFileSync(popupPath, 'utf8')) as Record<string, unknown>[];
    const template = objects.find((item) => item.__type__ === 'cc.Node' && item._name === 'BuildRowTemplate') as Record<string, unknown> | undefined;
    assert.ok(template, '弹窗里必须有行模板');
    const children = (template._children as { __id__: number }[])
        .map((ref) => objects[ref.__id__] as Record<string, unknown>);
    const find = (name: string) => {
        const node = children.find((item) => item._name === name) as Record<string, unknown> | undefined;
        assert.ok(node, `行模板要有 ${name}`);
        return node!;
    };
    const labelOf = (node: Record<string, unknown>) => {
        const label = (node._components as { __id__: number }[])
            .map((ref) => objects[ref.__id__] as Record<string, unknown>)
            .find((item) => item.__type__ === 'cc.Label');
        assert.ok(label, `${node._name} 要有 cc.Label`);
        return label!;
    };
    const y = (node: Record<string, unknown>) => (node._lpos as { y: number }).y;

    const nameNode = find('Name');
    const detailNode = find('Detail');
    assert.ok(y(nameNode) > y(detailNode), 'Name 必须在上、Detail 在下');
    // 两行半高之和 = 22/2 + 18/2 = 20，再留 4 像素缝。
    assert.ok(y(nameNode) - y(detailNode) >= 24,
        `两行中心距只有 ${y(nameNode) - y(detailNode)}，会互相压字`);

    // 正文更长（`粮10 木20 铁5 · 30s · 第3章`）：必须 SHRINK 且不换行，否则溢出整行。
    const detail = labelOf(detailNode);
    assert.equal(detail._overflow, 2, 'Detail 必须 SHRINK，长文本不能溢出到行外');
    assert.equal(detail._enableWrapText, false, 'SHRINK 前必须关自动换行，否则会被压成多行');
    assert.ok((detail._fontSize as number) < (labelOf(nameNode)._fontSize as number), '正文要比名字小一号');
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
    const popup = JSON.parse(readFileSync('assets/bundles/bigmap/ui/bigmap/BigMapBuildMenuPopup.prefab', 'utf8')) as Record<string, unknown>[];
    for (const [file, objects] of [['BigMapPage.prefab', page], ['BigMapBuildMenuPopup.prefab', popup]] as const) {
        assert.equal(objects.filter((item) => item.__type__ === 'b8a05X1iStIKZKq2Ksls5lW').length, 0,
            `${file} 不该再挂 BigMapPanel —— 底板色直接写在 Sprite 的 _color 上`);
    }

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
        ResourceCard: [72, 73, 83, 232],
        QueueStatus: [46, 47, 55, 240],
        ModeFrameFallback: [245, 224, 172, 255],
    };
    for (const [name, rgba] of Object.entries(expected)) {
        assert.deepEqual(spriteColor(page, name), rgba, `${name} 的底板色不能跟着删组件一起变`);
    }
    const popupRoot = popup[(popup[0] as { data: { __id__: number } }).data.__id__] as Record<string, unknown>;
    const popupSprite = (popupRoot._components as { __id__: number }[])
        .map((ref) => popup[ref.__id__])
        .find((item) => item.__type__ === 'cc.Sprite') as Record<string, unknown> | undefined;
    assert.ok(popupSprite, '弹窗根节点必须有 cc.Sprite 当底板');
    const popupColor = popupSprite._color as Record<string, number>;
    assert.deepEqual([popupColor.r, popupColor.g, popupColor.b, popupColor.a], [72, 73, 83, 232],
        '弹窗底板色必须仍是 (72,73,83,232) —— 删组件不能顺带改颜色');
});

test('建造队列拆成槽位点 + 摘要文本：不再是一行长文本', () => {
    const objects = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>[];
    const queue = objects.find((item) => item.__type__ === 'cc.Node' && item._name === 'QueueStatus');
    assert.ok(queue, '必须有 QueueStatus');
    const children = (queue._children as { __id__: number }[]).map((ref) => objects[ref.__id__]);
    const slots = children.filter((child) => (child._name as string).startsWith('QueueSlot'));
    // 槽位数 = bigmapQueue.maxBuildQueue（当前 3）；增删要同步改代码里的兜底名单。
    assert.equal(slots.length, 3, '队列槽位数应与 maxBuildQueue 一致');
    for (const slot of slots) {
        const components = (slot._components as { __id__: number }[]).map((ref) => objects[ref.__id__]);
        const sprite = components.find((item) => item.__type__ === 'cc.Sprite') as Record<string, unknown> | undefined;
        assert.ok(sprite, `${slot._name} 要有 Sprite 才看得见`);
        // `_type = 3`(FILLED)：建造中用 `fillRange` 表达进度。
        assert.equal(sprite._type, 3, `${slot._name} 必须是 FILLED，否则进度显示不出来`);
        const transform = components.find((item) => item.__type__ === 'cc.UITransform') as Record<string, unknown>;
        assert.equal((transform._contentSize as { height: number }).height, 32);
    }
    // 摘要文本固定宽度、没有 Widget —— 有 Widget 时 MCP 存盘会按 left/right 重算成 0 宽。
    const text = children.find((child) => child._name === 'QueueText');
    assert.ok(text, '摘要文本必须还在');
    const textComponents = (text._components as { __id__: number }[]).map((ref) => objects[ref.__id__]);
    assert.equal(textComponents.some((item) => item.__type__ === 'cc.Widget'), false, 'QueueText 不该挂 Widget');
});
