import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('assets/script/app/card/CardLineupPage.ts', 'utf8');
const cardSource = readFileSync('assets/script/app/card/CardLineupCard.ts', 'utf8');
//  卡库条目与站台都在 `main-pages` 分包里（`assets/resources/ui/card/` 已不存在 ——
//  这是本用例在 2026-10-27 之前一直红着的根因，与业务无关）。
const prefab = JSON.parse(readFileSync('assets/bundles/main-pages/ui/card/CardLineupCard.prefab', 'utf8')) as Array<Record<string, any>>;
const nodes = prefab.filter((item) => item.__type__ === 'cc.Node');
const nodeNamed = (name: string) => nodes.find((node) => node._name === name);
const components = (node: Record<string, any>) => node._components.map((ref: { __id__: number }) => prefab[ref.__id__]);

test('卡库进度使用升级所需卡牌数量，进度条绑定在对应节点', () => {
    assert.match(source, /const cardRequirement = status\.requirements\.find\(\(item\) => item\.key === 'card'\)/);
    assert.doesNotMatch(source, /status\.requirements\.find\(\(item\) => item\.key === 'exp'\)/);
    const track = nodeNamed('CardFragmentProgress');
    const fill = nodeNamed('CardFragmentFill');
    const label = nodeNamed('CardFragmentCountLabel');
    assert.ok(track && fill && label);
    const bar = components(track).find((component: Record<string, any>) => component.__type__ === 'cc.ProgressBar');
    assert.ok(bar);
    assert.equal(prefab[bar._barSprite.__id__].node.__id__, prefab.indexOf(fill));
    assert.match(cardSource, /this\.progressBar\.progress\s*=/);
});

test('等级底板包含等级标签，0 级时整体隐藏', () => {
    const plate = nodeNamed('LevelPlate');
    const label = nodeNamed('LevelLabel');
    assert.ok(plate && label);
    assert.equal(label._parent.__id__, prefab.indexOf(plate));
    assert.match(cardSource, /this\.levelPlate\.active\s*=\s*normalizedLevel\s*>\s*0/);
});

// ============================================================================
// 上阵站台的空台默认值
//
// 背景（2026-10-27）：进角色页到服务端回包之间，8 个站台显示的是 `LineupSlot.prefab` 的
// 字面默认值 —— 全是一个同款雕像 + 一律「3级」。玩家会把它读成「我的阵容就是这样」，
// 回包后整体换掉就是一次明显的跳变。所以默认值本身必须是**空台**：任何人把预设立绘 /
// 预设文案写回 prefab，下面的断言都要拦住。
// ============================================================================

const slotPrefab = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/card/LineupSlot.prefab', 'utf8'),
) as Array<Record<string, any>>;
const slotNode = (name: string) =>
    slotPrefab.find((item) => item.__type__ === 'cc.Node' && item._name === name);
const slotComponent = (node: Record<string, any>, type: string) =>
    node._components
        .map((ref: { __id__: number }) => slotPrefab[ref.__id__])
        .find((component: Record<string, any>) => component.__type__ === type);

test('站台默认外观必须是空台：不带「N级」文案、不带预设立绘与职业角标', () => {
    const levelNode = slotNode('LevelLabel');
    const heroNode = slotNode('Hero');
    const badgeNode = slotNode('ClassBadge');
    assert.ok(levelNode && heroNode && badgeNode, '站台结构变了（LevelLabel / Hero / ClassBadge 缺一）');

    const label = slotComponent(levelNode, 'cc.Label');
    assert.equal(label?._string, '',
        'LevelLabel 默认文案必须为空：写着「3级」等于把假等级塞进加载空窗，且与 fallbackLevel=3 完全同形');

    const hero = slotComponent(heroNode, 'cc.Sprite');
    assert.equal(hero?._spriteFrame, null,
        'Hero 默认不许挂立绘：数据没到就画一个同款雕像，玩家会当成自己的上阵兵种');

    const badge = slotComponent(badgeNode, 'cc.Sprite');
    assert.equal(badge?._spriteFrame, null,
        'ClassBadge 默认不许挂角标：会给出一个假的职业');
});

test('首屏先收起站台再取数，且走「快照 → 权威值」两段式', () => {
    assert.match(source, /this\.renderLoading\(\);\s*\n\s*void this\.bootstrap\(\)/,
        'start() 必须先 renderLoading()（收起 8 个站台）再 bootstrap()，否则首帧会露 prefab 默认外观');
    assert.match(source, /private async bootstrap\(\)[\s\S]{0,200}?loadLineupSnapshot\(\)[\s\S]{0,200}?await this\.refresh\(\)/,
        'bootstrap 必须是「先本地快照、再权威值」；只 await refresh 会丢掉快照秒开');
    assert.match(source, /cards\.length > 0 \? this\.preparePool/,
        '快照的 catalog 为空，卡库必须跳过而不是清空（否则卡库会先被刷成 0 条再刷回来）');
    assert.doesNotMatch(source, /slotsRevision/,
        '旧的 slotsRevision 早退已由 presentRevision 取代，别把它加回来（它挡不住快照与权威值交错）');
});

// ============================================================================
// 「队伍编辑」入口的绑定方式
//
// 全工程 375 个 `cc.Button` 没有一个用 prefab 的 clickEvents（拖拽绑定），185 处都是代码 `on` ——
// 所以这里不引入第二套风格。代价是「漏绑」只能靠断言当场逮住，不能靠运行期兜底藏起来。
// ============================================================================

const pagePrefab = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/card/CardLineup.prefab', 'utf8'),
) as Array<Record<string, any>>;

test('「队伍编辑」按钮必须绑在 prefab 上（代码不再按路径兜底）', () => {
    // 脚本组件在 prefab 里是 uuid 键，按字段名定位最稳（字段改名时这条先红，比运行期静默好）。
    const page = pagePrefab.find((item) => item && typeof item === 'object' && 'teamEditButton' in item);
    assert.ok(page, 'prefab 里找不到 CardLineupPage 组件（字段全改名了？）');

    const ref = page!.teamEditButton as { __id__?: number } | null;
    assert.ok(ref && typeof ref.__id__ === 'number',
        'teamEditButton 未绑定：代码已不判空，漏绑就是点了没反应且零报错');

    // 字段声明是 `cc.Button` ⇒ 这里必须指向【组件】而不是节点（存成节点会一路静默）。
    const button = pagePrefab[ref!.__id__!];
    assert.equal(button.__type__, 'cc.Button',
        'teamEditButton 必须直接绑 cc.Button 组件，不是 MidBar/TeamEdit 节点');
    assert.equal(pagePrefab[button.node.__id__]._name, 'TeamEdit',
        '这个 cc.Button 必须挂在 MidBar/TeamEdit 上');

    assert.doesNotMatch(source, /getChildByPath\(/,
        '别再给 @property 加按路径查找的兜底：那会把「漏绑」变成静默成功');
});
// ============================================================================
// 站台顺序的真源：Layout 的兄弟顺序
//
// `cc.Layout` 按**子节点顺序**从左上排到右下，那些 `_lpos` 就是它算出来的产物。
// 于是「再按坐标排序」是原地转圈：兄弟顺序真错了，坐标也跟着错，排序只会还原成同一个顺序。
// 顺序契约因此落在两件事上：容器必须挂 Layout，且代码不按坐标反推。
// 反例：`PresetRow` 那 4 个页签**没有** Layout，坐标是唯一真源，必须继续按 x 排。
// ============================================================================

const boardSource = readFileSync('assets/script/app/card/LineupBoardPage.ts', 'utf8');
const boardPrefab = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/card/LineupBoard.prefab', 'utf8'),
) as Array<Record<string, any>>;

const layoutOf = (items: Array<Record<string, any>>, nodeName: string) => {
    const node = items.find((item) => item.__type__ === 'cc.Node' && item._name === nodeName);
    if (!node) return undefined;
    return node._components
        .map((ref: { __id__: number }) => items[ref.__id__])
        .find((component: Record<string, any>) => component.__type__ === 'cc.Layout');
};

test('站台顺序靠 Layout 的兄弟顺序，不再按坐标反推', () => {
    const teamLayout = layoutOf(pagePrefab, 'TeamArea');
    assert.ok(teamLayout, 'TeamArea 必须挂 cc.Layout —— 站台顺序的契约就是它的兄弟顺序');
    assert.equal(teamLayout!._layoutType, 3, 'TeamArea 的 Layout 必须是 GRID（3）');
    assert.equal(teamLayout!._cellSize?.width, 154, 'cellSize 变了要同步这条断言');

    assert.doesNotMatch(source, /static gridOrder/,
        'CardLineupPage 不再按坐标排序：Layout 的坐标就是兄弟顺序的产物，反推是原地转圈');

    assert.ok(layoutOf(boardPrefab, 'Slots'), 'Arena/Slots 必须挂 Layout（布阵面板 8 个站台靠它排）');
    assert.ok(layoutOf(boardPrefab, 'ClassRow'), 'ClassRow 必须挂 Layout（职业计数那一行）');
    assert.equal(layoutOf(boardPrefab, 'PresetRow'), undefined,
        'PresetRow 没有 Layout：4 个页签的坐标是手摆的，顺序只能靠坐标');
    assert.match(boardSource, /gridOrder\(/,
        'PresetRow 仍要按坐标排序 —— 删了它就等于赌节点树顺序，而它没有 Layout 兜底');
    assert.match(boardSource, /private arenaSlots\(\)[\s\S]{0,220}?getComponentsInChildren\(LineupBoardSlot\)/,
        '布阵面板的站台顺序也直接取节点树，别把坐标排序加回来');
});
// ============================================================================
// 布阵保存的结果走事件，不走「共享字段 + onClose」
//
// `PopupDef.onClose` 是框架契约（只有一个 reason），装不下业务结果；以前用
// `session.saved` 补位，代价是「结果绑在关闭上」+ 两边靠共享可变字段互相猜。
// 现在：面板保存成功当场 emit，页面 start 订阅、onDestroy 摘掉。
// ============================================================================

const boardPageSource = readFileSync('assets/script/app/card/LineupBoardPage.ts', 'utf8');
const eventsSource = readFileSync('assets/script/app/card/CardLineupEvents.ts', 'utf8');

test('布阵保存结果走事件，不再用 session.saved + onClose 回调', () => {
    assert.doesNotMatch(source, /session\.saved/,
        'CardLineupPage 不许再用 session.saved 判断「这轮存没存」—— 那是共享可变字段');
    assert.doesNotMatch(source, /onClose:\s*\(/,
        'CardLineupPage 不许再传 onClose 回调（框架契约只有一个 reason，装不下业务结果）');
    assert.match(source, /EventMgr\.instance\.on\(CardLineupEvent\.DeckSaved, this\.onDeckSaved, this\)/,
        '订阅要挂在 start() 里，且 target 传 this（不然 offTarget 摘不掉）');
    assert.match(source, /EventMgr\.instance\.offTarget\(this\)/,
        'onDestroy 必须 offTarget(this)：EventMgr 是全局单例，页面切 tab 就销毁重建');

    assert.match(boardPageSource, /EventMgr\.instance\.emit\(CardLineupEvent\.DeckSaved/,
        '面板保存成功后要当场派发，不要等关闭');
    assert.doesNotMatch(boardPageSource, /saved\s*=\s*true/,
        '面板不许再往共享对象上写 saved');

    // 契约文件必须零引擎依赖（纯 TS 才能被单测直接 require）
    assert.doesNotMatch(eventsSource, /from 'cc'/, 'CardLineupEvents 不许 import cc');
});
// ============================================================================
// 一次性动画不进常驻 update
//
// `update` 是每帧都进的：`enterFxStartedAt === 0` 也得进函数判断一次，而落位淡入整页
// 生命期只播一次。改用 `schedule`，播完 `unschedule` 自己收掉。
// （规范仍要求「startedAt + 纯函数算进度」，禁的是散建 tween 与 dt 累加，不是禁时间轴。）
// ============================================================================

test('站台动画不用 tween', () => {
    assert.doesNotMatch(source, /tween\(/,
        '站台是长期存活的 prefab 实例，别用 tween：播到一半被切页会留悬空回调');
});
// ============================================================================
// 长屏适配：按设计值钉顶，多出来的高度全给卡库
//
// 曾用 `RatioTopLayout` 把「设计稿距顶」按 `实高/1280` 等比放大，想让长屏上的相对位置一致。
// 实测相反：它只放大**距顶距离**、块自身高度不变 ⇒ 块与块的**空隙**被放大 2~3 倍
// （TeamArea 底边到 MidBar 顶边设计稿 58.6，长屏 k=1.25 时变成 165.7）——「上阵区和
// 队伍编辑之间一大片草地」就是这么来的。现在：四块按设计值钉顶，多出来的高度全给 `CardGrid`。
// ============================================================================

test('长屏适配：四块按设计值钉顶，多出来的高度只进卡库', () => {
    const widgetOf = (name: string) => {
        const node = pagePrefab.find((item) => item.__type__ === 'cc.Node' && item._name === name);
        assert.ok(node, `prefab 里找不到 ${name}`);
        const widget = (node as Record<string, any>)._components
            .map((ref: { __id__: number }) => pagePrefab[ref.__id__])
            .find((component: Record<string, any>) => component.__type__ === 'cc.Widget');
        assert.ok(widget, `${name} 必须挂 cc.Widget`);
        return widget as Record<string, any>;
    };

    const expected: Array<[string, number]> = [
        ['TeamArea', 132.5],
        ['MidBar', 561.09],
        ['Banner', 638.857],
        ['CardGrid', 704.137],
    ];
    for (const [name, designTop] of expected) {
        assert.equal(widgetOf(name)._top, designTop,
            `${name} 的 Widget.top 必须保持设计值 ${designTop}：按比例放大会把块间距放大 2~3 倍`);
    }

    //  剩余高度只能落在卡库上：它必须同时对齐顶(1)和底(4)，否则长屏底部会空一块。
    const gridFlags = widgetOf('CardGrid')._alignFlags as number;
    assert.ok((gridFlags & 1) !== 0 && (gridFlags & 4) !== 0,
        `CardGrid 必须同时对齐顶和底（alignFlags 含 1 和 4），实际 ${gridFlags}`);
});
// ============================================================================
// 布阵面板的三个按钮：字段声明成 `cc.Button`，prefab 里就必须存组件
//
// 与 `teamEditButton` 同一条规则：声明 `cc.Button` 而 prefab 存节点 ⇒ 运行时字段里是
// `cc.Node`，`.interactable = x` 不报错但也不生效（静默失效）。
// 页签（`PresetRow`）那 4 个例外：它们没有 @property，只能遍历 children + getComponent。
// ============================================================================

test('布阵面板三个按钮直接绑 cc.Button，不再 getComponent', () => {
    const board = boardPrefab.find((item) => item && typeof item === 'object' && 'resetButton' in item);
    assert.ok(board, 'prefab 里找不到 LineupBoardPage 组件');

    const expected: Array<[string, string]> = [
        ['resetButton', 'BtnReset'],
        ['saveButton', 'BtnSave'],
        ['closeButton', 'CloseBtn'],
    ];
    for (const [key, nodeName] of expected) {
        const ref = (board as Record<string, any>)[key] as { __id__?: number } | null;
        assert.ok(ref && typeof ref.__id__ === 'number', `${key} 未绑定：漏绑就是点了没反应且零报错`);
        const component = boardPrefab[ref!.__id__!];
        assert.equal(component.__type__, 'cc.Button', `${key} 必须直接绑 cc.Button 组件，不是节点`);
        assert.equal(boardPrefab[(component.node as { __id__: number }).__id__]._name, nodeName,
            `${key} 必须指向 ${nodeName}`);
    }

    assert.doesNotMatch(boardSource, /(resetButton|saveButton|closeButton)\.getComponent\(/,
        '字段已是 cc.Button，别再 getComponent —— 页签那种没有 @property 的场景才需要');
});
// ============================================================================
// 升级结果也走事件（`CardLineupEvent.HeroUpgraded`）
//
// 原来：`ICardUpgradeOpenData.onUpgraded` 让升级弹窗持有调用方的闭包 —— 漏传就是
// 「升完级外面等级不更新，零报错」。现在弹窗只管派发，卡牌页订阅后回写等级缓存。
// ============================================================================

const presentationsSource = readFileSync('assets/script/app/card/CardPresentations.ts', 'utf8');

test('升级结果走事件，不再用 onUpgraded 回调', () => {
    assert.doesNotMatch(presentationsSource, /onUpgraded/,
        'ICardUpgradeOpenData 不许再有 onUpgraded：弹窗不该持有调用方闭包');
    assert.match(upgradePageSource, /EventMgr\.instance\.emit\(CardLineupEvent\.HeroUpgraded/,
        '升级成功要当场派发，不要等弹窗关闭（这条在弹窗自己身上，不再有 Presenter）');
    assert.match(source, /EventMgr\.instance\.on\(CardLineupEvent\.HeroUpgraded, this\.onHeroUpgraded, this\)/,
        '卡牌页要在 start() 里订阅，target 传 this（offTarget 才摘得掉）');
    assert.doesNotMatch(source, /onUpgraded:/,
        'openUpgrade 不许再传回调，userData 只带 card / cardId / level');
});
// ============================================================================
// 列表字段直接绑 VirtualScrollView
//
// `cardGrid` 原来是 `@property(Node)` + `getComponent(VirtualScrollView)`，`iconList` 早就直接绑组件 ——
// 同一件事两种写法。统一成绑组件后：
//   - 不需要 `getComponent`，也不需要 `!list` 判空；
//   - `!list.node.isValid` 是死分支：列表是页面节点的后代，页面活 ⇒ 它必然也活。
// ============================================================================

test('列表字段直接绑 VirtualScrollView，且不再多判一层节点存活', () => {
    const page = pagePrefab.find((item) => item && typeof item === 'object' && 'cardGrid' in item);
    assert.ok(page, 'prefab 里找不到 CardLineupPage 组件');

    const cardGrid = pagePrefab[(page as Record<string, any>).cardGrid.__id__];
    const iconList = pagePrefab[(page as Record<string, any>).iconList.__id__];
    assert.equal(cardGrid.__type__, iconList.__type__,
        'cardGrid 与 iconList 必须绑同一类组件（VirtualScrollView），别一个绑组件一个绑节点');
    assert.equal(pagePrefab[(cardGrid.node as { __id__: number }).__id__]._name, 'CardGrid',
        'cardGrid 必须指向 CardGrid 节点上的那个列表组件');

    assert.doesNotMatch(source, /getComponent\(VirtualScrollView\)/,
        '字段已是 VirtualScrollView，别再 getComponent');
    assert.doesNotMatch(source, /list\.node\.isValid/,
        '列表是页面节点的后代，页面活它就活 —— 别再补节点存活判空');
});
// ============================================================================
// 列表条目渲染必须「无条件赋图」
//
// 虚拟列表的槽位是复用出来的：条目 A 占到槽位后，滚走时这个槽位会直接换成条目 B。
// 渲染时若图带 `if (frames.x)` 条件跳过，"没有图的条目"就会留着上一项的图（串图）——
// 阵营图标现在正好拿不到图，于是职业格子滑过去之后阵营格子还顶着职业图标。
// 宿主组件都是 `@property` 必绑，所以只判数据、不判组件。
// ============================================================================

const bondSource = readFileSync('assets/script/app/card/CardLineupBond.ts', 'utf8');
const boardCardSource = readFileSync('assets/script/app/card/LineupBoardCard.ts', 'utf8');
const headViewSource = readFileSync('assets/script/app/card/CardHeadView.ts', 'utf8');

test('列表条目渲染无条件赋图（有条件的写法会在复用槽位上留下上一项的图）', () => {
    assert.doesNotMatch(bondSource, /if \(icon\)/,
        'CardLineupBond：icon 为 null 时必须清空，不能保留上一项的图标');
    assert.match(bondSource, /this\.icon\.spriteFrame = icon;/,
        'CardLineupBond 要无条件写 spriteFrame');
    assert.doesNotMatch(cardSource, /if \(frames\./,
        'CardLineupCard：face / badge 必须无条件写');
    assert.doesNotMatch(boardCardSource, /if \(frames\./,
        'LineupBoardCard：frame / badge 必须无条件写');
    assert.doesNotMatch(headViewSource, /if \(heroFrame\)/,
        'applyCardHeadArt：两张图都没有时也要显式写 null（否则 hero 节点会显示上一张卡的立绘）');
    assert.match(headViewSource, /slots\.hero\.spriteFrame = heroFrame;/,
        'applyCardHeadArt 的 hero 赋值不带条件');
});
// ============================================================================
// 条目 prefab 也不许预置立绘 / 头像
//
// 跟 `LineupSlot` 同一条原则（347）：prefab 里存着的图会被编辑器预览、也会在
// 「代码还没渲染」的那一帧被看见，而且它显示的是**别人**（camp 雕像），不是这张卡。
// 运行期真正的图由 `applyCardHeadArt` 决定（`frames.hero` / `frames.head`）。
// ============================================================================

test('条目 prefab 的 Hero / HeadIcon 不许预置图片', () => {
    const cases: Array<[string, string[]]> = [
        ['CardLineupCard', ['Hero', 'HeadIcon']],
        ['LineupBoardCard', ['Hero', 'HeadIcon']],
        ['LineupBoardSlot', ['Hero']],
        ['CardUpgrade', ['Hero']],
    ];
    for (const [fileName, nodeNames] of cases) {
        const items = JSON.parse(
            readFileSync(`assets/bundles/main-pages/ui/card/${fileName}.prefab`, 'utf8'),
        ) as Array<Record<string, any>>;
        const nodes = items.filter((item) => item.__type__ === 'cc.Node');
        for (const nodeName of nodeNames) {
            const node = nodes.find((item) => item._name === nodeName);
            assert.ok(node, `${fileName} 里找不到 ${nodeName} 节点`);
            const sprite = (node as Record<string, any>)._components
                .map((ref: { __id__: number }) => items[ref.__id__])
                .find((component: Record<string, any>) => component.__type__ === 'cc.Sprite');
            assert.ok(sprite, `${fileName}/${nodeName} 上应有 cc.Sprite`);
            assert.equal(sprite!._spriteFrame, null,
                `${fileName}/${nodeName} 不许预置图：编辑器里会显示别人的立绘，实际由 applyCardHeadArt 决定`);
        }
    }
});
// ============================================================================
// Presenter 不持有 View（`isAlive` 契约已删）
//
// 原来的形态是 `presenter.refresh(autoLoadDecks, view)` + `await view.presentLineup(data)`，
// 于是每个 `await` 之后都要 `view.isAlive()` 判一次。现在 Presenter 只负责「取数 → 派发事件」，
// 页面在 `start()/onOpen()` 里订阅、`onDestroy()/onClose()` 里 `offTarget` —— 判活由订阅生命周期兜。
// ============================================================================

test('没有 Presenter 层：四个页面自己取数、自己渲染，事件只剩跨对象的三个', () => {
    assert.doesNotMatch(presentationsSource, /export class \w*Presenter/,
        'CardPresentations 里不许再有 Presenter 类（它现在只剩展示模型的类型定义）');
    assert.doesNotMatch(presentationsSource, /isAlive/, '不许再出现 isAlive 契约');

    //  四个页面各自持有取数逻辑与轮次校验：`cardRepository.<method>` 直接出现在页面里。
    const pages: Array<[string, RegExp]> = [
        ['CardLineupPage.ts', /cardRepository\.loadLineup\(/],
        ['LineupBoardPage.ts', /cardRepository\.loadBoard\(/],
        ['CardSkillPage.ts', /cardRepository\.loadSkillList\(/],
        ['CardUpgradePage.ts', /cardRepository\.loadUpgradeStatus\(/],
    ];
    for (const [fileName, pattern] of pages) {
        const pageSource = readFileSync(`assets/script/app/card/${fileName}`, 'utf8');
        assert.match(pageSource, pattern, `${fileName} 应自己调 repository 取数`);
        assert.match(pageSource, /Revision\b/, `${fileName} 要有轮次校验字段`);
        assert.doesNotMatch(pageSource, /this\.presenter\b/, `${fileName} 不许再有 presenter 字段`);
    }

    //  数据 Ready 事件是"Presenter 通知 View"的产物，层没了就该一起消失。
    const eventsSource = readFileSync('assets/script/app/card/CardLineupEvents.ts', 'utf8');
    for (const gone of ['LineupReady', 'BoardReady', 'SkillsReady', 'UpgradeReady']) {
        assert.doesNotMatch(eventsSource, new RegExp(`${gone}:`),
            `${gone} 应随 Presenter 一起删除：同一个人取数又渲染，不需要自己通知自己`);
    }
    //  剩下的事件必须都是跨对象的。
    for (const kept of ['DeckSaved', 'HeroUpgraded', 'SkillStep']) {
        assert.match(eventsSource, new RegExp(`${kept}:`), `${kept} 是跨对象的，必须保留`);
    }
});
// ============================================================================
// 升级弹窗的按钮：字段声明成 `cc.Button`，prefab 里就必须存组件
//
// 与 `teamEditButton` / 布阵面板三个按钮同一条规则：声明 `cc.Button` 而 prefab 存节点
// ⇒ 运行时字段里是 `cc.Node`，`upgradeButton.interactable = x` 不报错但也不生效。
// ============================================================================

const upgradePageSource = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
const upgradePrefab = JSON.parse(
    readFileSync('assets/bundles/main-pages/ui/card/CardUpgrade.prefab', 'utf8'),
) as Array<Record<string, any>>;

test('升级弹窗的按钮直接绑 cc.Button，不再 getComponent', () => {
    const page = upgradePrefab.find((item) => item && typeof item === 'object' && 'closeButton' in item);
    assert.ok(page, 'prefab 里找不到 CardUpgradePage 组件');

    for (const [key, nodeName] of [['closeButton', 'CloseBtn'], ['upgradeButton', 'BtnUpgrade']]) {
        const ref = page![key] as { __id__?: number } | null;
        assert.ok(ref && typeof ref.__id__ === 'number', `${key} 未绑定`);
        const component = upgradePrefab[ref!.__id__!];
        assert.equal(component.__type__, 'cc.Button', `${key} 必须直接绑 cc.Button 组件，不是节点`);
        assert.equal(upgradePrefab[(component.node as { __id__: number }).__id__]._name, nodeName,
            `${key} 必须指向 ${nodeName}`);
    }

    assert.doesNotMatch(upgradePageSource, /(closeButton|upgradeButton|skillButton)\.getComponent\(/,
        '字段已是 cc.Button，别再 getComponent');
    //  `skillButton` 允许留空（prefab 里就是 null），所以保留可选链。
    assert.match(upgradePageSource, /this\.skillButton\?\.node\.on\(/,
        'skillButton 可空，用可选链；但只要非空就是组件，不该再 getComponent');
});
// ============================================================================
// 技能槽位：六个引用全部直接绑组件（`setLabel` 那套已删）
//
// 旧写法绑的是**节点**，运行时 `getComponent(Label)` + 往子节点找 Label，找不到就静默跳过
// ⇒ 表现是「技能行文字空白、日志一个字都没有」。现在每个文字位直接绑 `cc.Label`，
// 升级按钮绑 `cc.Button`，绑定错了打开面板就抛错。
// 注意 prefab 里有 **4 个槽位实例**（Row1~Row4 各一个 `Left`），每个都要绑自己的子树。
// ============================================================================

test('技能槽位的六个引用直接绑组件，四个槽位实例都要绑全', () => {
    const slotViewSource = readFileSync('assets/script/app/card/CardSkillSlotView.ts', 'utf8');
    assert.doesNotMatch(slotViewSource, /this\.[A-Za-z]+\.getComponent\(/,
        'CardSkillSlotView 不许再用 getComponent —— 六个引用都直接绑组件');
    assert.doesNotMatch(slotViewSource, /^function setLabel/m,
        'setLabel 辅助函数已删：找不到 Label 就静默跳过，是"文字空白且零日志"的来源');

    const skillPrefab = JSON.parse(
        readFileSync('assets/bundles/main-pages/ui/card/CardSkill.prefab', 'utf8'),
    ) as Array<Record<string, any>>;
    const slotUuid = (JSON.parse(
        readFileSync('assets/script/app/card/CardSkillSlotView.ts.meta', 'utf8'),
    ) as Record<string, any>).uuid as string;
    const slotHead = String(slotUuid).replace(/-/g, '').slice(0, 5);
    const slotNodes = skillPrefab.filter((item) => item.__type__ === 'cc.Node');

    const expected: Array<[string, string, string]> = [
        ['nameLabel', 'cc.Label', 'NameLabel'],
        ['levelLabel', 'cc.Label', 'LevelLabel'],
        ['descLabel', 'cc.Label', 'DescLabel'],
        ['lockTip', 'cc.Label', 'LockTip'],
        ['nextButton', 'cc.Button', 'NextBtn'],
        ['nextLabel', 'cc.Label', 'Label'],
    ];
    const slots = skillPrefab.filter((item) =>
        item && typeof item === 'object' && String(item.__type__).startsWith(slotHead) && 'nameLabel' in item);
    assert.equal(slots.length, 4, 'prefab 里应有 4 个技能槽位实例（Row1~Row4）');

    for (const slot of slots) {
        for (const [key, expectType, expectNode] of expected) {
            const ref = slot[key] as { __id__?: number } | undefined;
            assert.ok(ref && typeof ref.__id__ === 'number', `${key} 未绑定`);
            const component = skillPrefab[ref!.__id__!];
            assert.equal(component.__type__, expectType, `${key} 必须绑 ${expectType}`);
            assert.equal(skillPrefab[(component.node as { __id__: number }).__id__]._name, expectNode,
                `${key} 必须指向 ${expectNode}`);
        }
        assert.equal('nameNode' in slot, false, '旧属性名 nameNode 应已清理');
    }
});
// ============================================================================
// 技能行的点击走事件（`CardLineupEvent.SkillStep`）
//
// 原来是三层注入式回调：`CardSkillPage` → `CardSkillListView.host` → `CardSkillRowView.host`
// → `onSkillStep`；为了兜住「注入失败」还写了沿父链**鸭子类型反射**找宿主的 `findHostUpward()`。
// 现在行只派发意图，页面订阅 —— "找不到宿主"这个状态从根上不存在。
// ============================================================================

const skillRowSource = readFileSync('assets/script/app/card/CardSkillRowView.ts', 'utf8');
const skillListSource = readFileSync('assets/script/app/card/CardSkillListView.ts', 'utf8');
const skillPageSource = readFileSync('assets/script/app/card/CardSkillPage.ts', 'utf8');

test('技能行点击走事件，注入式宿主回调已删', () => {
    assert.doesNotMatch(skillRowSource, /ICardSkillRowHost/, 'CardSkillRowView 不许再有宿主接口');
    assert.doesNotMatch(skillRowSource, /this\.host/, '不许再读写注入的宿主');
    assert.doesNotMatch(skillRowSource, /private findHostUpward/, '鸭子类型反射找宿主的兜底必须删');
    assert.match(skillRowSource, /EventMgr\.instance\.emit\(CardLineupEvent\.SkillStep/,
        '行要派发 SkillStep');

    assert.doesNotMatch(skillListSource, /ICardSkillRowHost/, 'CardSkillListView 不许再有宿主接口');
    assert.doesNotMatch(skillListSource, /this\.host/, '列表不再中转宿主');

    assert.match(skillPageSource, /EventMgr\.instance\.on\(CardLineupEvent\.SkillStep, this\.onSkillStep, this\)/,
        '页面要订阅 SkillStep，target 传 this（offTarget 才摘得掉）');
    assert.doesNotMatch(skillPageSource, /skillList\.host\s*=/, '页面不许再往列表注入宿主');
});
