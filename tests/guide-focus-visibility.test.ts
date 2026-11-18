import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { guideDialogBottom, unionGuideFocusRects } from '../assets/script/app/guide/model/GuidePresentation';

// 执行真实定位方法，隔离引擎渲染；覆盖贴边按钮与滚动视口的裁剪判断。
const VIEW_PATH = 'assets/script/app/guide/ui/GuideDialogView.ts';
const viewText = readFileSync(VIEW_PATH, 'utf8');
const source = ts.createSourceFile('GuideDialogView.ts', viewText, ts.ScriptTarget.Latest, true);
const view = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'GuideDialogView') as ts.ClassDeclaration;
const methodOf = (name: string) =>
    view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)!;
const method = methodOf('placeFocusRing');
// `placeFocusRing` 会把孔画出来 ⇒ 描边那个方法要一起搬进沙箱（尺寸没变不重画的逻辑也在里面）；
// 附加节点（关卡编号气泡）的并集同理。
const shapeMethod = methodOf('drawFocusShape');
const unionMethod = methodOf('unionWithExtras');
// 第 19 条：整屏点击区与对话条的取舍统一走 `needsFullScreenBlock()`，`placeFocusRing` 要问它。
const blockMethod = methodOf('needsFullScreenBlock');
// 第 25 条：立绘挡不挡孔也在 `placeFocusRing` 末尾判（`hole` 步不再「一律藏立绘」）。
// 判定要用到立绘的摆放公式，所以这一组方法得一起搬进来。
// 第 27 条：对话条一关，立绘必须跟着收（`placeFocusRing` 里逐帧兜底）⇒ `hidePortrait` 也要搬。
const portraitMethods = ['syncPortraitSuppression', 'applyPortraitPlacement', 'portraitHitsFocus',
    'placePortrait', 'portraitFoot', 'portraitDropX', 'hidePortrait']
    .map(methodOf).map(node => node.getText(source)).join(' ');

// `placeFocusRing` 会把模块级常量直接读进来，沙箱里必须补上；从源码里抠真值，改口径时不会静默脱钩。
function numberConst(name: string): number {
    const hit = viewText.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)`));
    if (!hit) throw new Error(`GuideDialogView 里找不到常量 ${name}`);
    return Number(hit[1]);
}
function stringArrayConst(name: string): string[] {
    const hit = viewText.match(new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`));
    if (!hit) throw new Error(`GuideDialogView 里找不到常量 ${name}`);
    return [...hit[1].matchAll(/'([^']*)'/g)].map(match => match[1]);
}

const exports: { Cls?: { prototype: object } } = {};
runInNewContext(ts.transpileModule(
    `exports.Cls = class { ${method.getText(source)} ${shapeMethod.getText(source)} ${unionMethod.getText(source)} ${blockMethod.getText(source)} ${portraitMethods} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, {
    exports, HEX_GRID_CONTENT_LIFT: 0, guideDialogBottom, unionGuideFocusRects,
    PORTRAIT_FOCUS_GAP: numberConst('PORTRAIT_FOCUS_GAP'),
    // 立绘摆放公式也读这两个（右对齐留白 / 脚点下沉比例）。
    PORTRAIT_RIGHT_INSET: numberConst('PORTRAIT_RIGHT_INSET'),
    PORTRAIT_SINK_RATIO: numberConst('PORTRAIT_SINK_RATIO'),
    // `unionWithExtras` 会 `node.getComponent(UITransform)`；沙箱里只要一个可用的类型令牌。
    UITransform: class {},
    HINT_ABOVE_FOCUS: numberConst('HINT_ABOVE_FOCUS'),
    HINT_HIDDEN_PREFIXES: stringArrayConst('HINT_HIDDEN_PREFIXES'),
});

/**
 * 把一个桩宿主包成「沙箱类的实例」。
 *
 * 真实组件是**同一个实例逐帧跑**，状态（`narrationPending` / `focusShapeDrawn` / `focusWidth`…）
 * 要跨帧留着 —— 每帧重建等于每帧都是首帧，「放过了就不再放」「值没变不重画」这类守卫就测不出来。
 *
 * 用 Proxy 而不是 `Object.assign` 拷贝：用例中途改 `host.xxx`（`canAdvance` / `focusTransform.width`
 * …）要和视图里读到的**是同一个值**，视图写回的标量也要能从 `host` 读回来。
 * 宿主没有的键回落到原型（`placeFocusRing` / `unionWithExtras` / `drawFocusShape` / `needsFullScreenBlock`）。
 */
function viewOf(host: object): { placeFocusRing(): void } {
    const base = Object.create(exports.Cls!.prototype) as object;
    return new Proxy(base, {
        get: (target, prop) => (Object.prototype.hasOwnProperty.call(host, prop)
            ? (host as Record<string | symbol, unknown>)[prop] : Reflect.get(target, prop)),
        set: (target, prop, value) => (Object.prototype.hasOwnProperty.call(host, prop)
            ? ((host as Record<string | symbol, unknown>)[prop] = value, true) : Reflect.set(target, prop, value)),
    }) as { placeFocusRing(): void };
}

function fixture(x: number, y: number) {
    const point = () => ({ x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } });
    // `placeFocusRing` 现在会先比较再写（每帧不重复标脏），所以桩节点要有 `position`。
    // `setPosition` 真写值：第 25 条的「立绘换边」靠它验（换了哪一侧）。
    const node = () => ({
        active: false, position: { x: 0, y: 0, z: 0, equals: () => false },
        setPosition(x: number | { x: number; y: number }, y?: number) {
            const point = typeof x === 'object' && x ? { x: x.x, y: x.y } : { x, y };
            this.position = { x: point.x, y: point.y as number, z: 0, equals: () => false };
        },
        setScale() {},
    });
    const transform = { width: 100, height: 152, anchorX: 0.5, anchorY: 0.5,
        convertToWorldSpaceAR: (p: { x: number; y: number }, out: object) => Object.assign(out, { x: p.x + x, y: p.y + y }) };
    const masks: number[][] = [];
    // 立绘宿主桩：所有立绘方法共用这一个节点（`portraitNode` / `portraitSprite.node`）。
    const portraitHost = node();
    const host = {
        focusTarget: { shape: 'rect', node: { isValid: true, activeInHierarchy: true } }, focusTransform: transform,
        hostTransform: { width: 720, height: 1560, convertToNodeSpaceAR: (p: object, out: object) => Object.assign(out, p) },
        // `focusWidth/Height` 是「描边画多大」（会被附加节点撑大），`focusBase*` 是地块自身的逻辑尺寸
        // —— 四角的屏幕尺寸只能按 base 推，否则第二帧会拿上一帧的并集尺寸越滚越大。
        focusWidth: 108, focusHeight: 160, focusBaseWidth: 108, focusBaseHeight: 160,
        focusClips: [] as object[], focusKey: 'Main/CardEntry',
        // 第 17 条：焦点可以带附加节点（关卡编号气泡），并集要用得到这几个临时向量。
        focusExtra: [] as object[], extraWorld: point(), extraCornerWorld: point(), extraCornerLocal: point(),
        focusGraphics: { clear() {}, stroke() {}, moveTo() {}, lineTo() {}, close() {}, roundRect() {} },
        focusShapeHex: false, focusShapeDrawn: false, focusShapeDrawnHex: false, focusShapeWidth: 0, focusShapeHeight: 0,
        focusCorner: point(), focusWorld: point(), focusLocal: point(), focusEdgeWorld: point(), clipCenter: point(), clipCorner: point(),
        focusRing: node(), focusHand: node(), mapHint: node(), dimNode: node(), dialogBox: node(), blockerNode: node(),
        // 立绘宿主与它身上的 Sprite 必须是**同一个节点**（真实组件也是这么绑的）：
        // `hidePortrait` 关的是 `portraitSprite.node`，只关 `npcNode` 的话宿主还亮着。
        portraitNode: portraitHost,
        portraitSprite: { spriteFrame: {} as unknown, node: portraitHost, enabled: true },
        npcNode: null as unknown,
        focusMasks: [node(), node(), node(), node()], hintTransform: { width: 250 }, dialogTransform: { width: 660, height: 184 },
        dialogWidget: { bottom: 168 }, defaultDialogBottom: 168, queue: [{}], currentMaskType: 'full',
        // 第 24 条：`placeFocusRing` 里「光圈等到了才开口」的待播标记；这里的桩默认不在等待态，
        // 需要覆盖时由用例自己置真。`playLine` 只记次数，验证「只在光圈可见那一帧放第一句」。
        narrationPending: false, narrationLines: [] as number[],
        playLine(index: number) { host.narrationLines.push(index); },
        // 第 25 条：立绘遮挡判定。默认 `portraitShown: false`（这一句没配立绘）⇒ 判定直接短路，
        // 既有用例的节点状态不该被它改动。`portraitSide` 是「站哪一侧」（1 右 / -1 左）。
        portraitShown: false, portraitSuppressed: false, portraitSide: 1 as 1 | -1,
        portraitDisplayWidth: 0, portraitDisplayHeight: 0,
        layoutFocusMasks(x: number, y: number, w: number, h: number) { masks.push([x, y, w, h]); },
        // `placePortrait` 用沙箱里的真实现（第 25 条要验它摆到哪一侧），桩里不能留空壳 ——
        // Proxy 优先取 host 自己的键，留个空函数会把真方法整个遮掉。
        layoutBlocker() {},
    };
    // 视图实例整个 fixture 只建一次（真实组件是同一实例逐帧跑），字段经 Proxy 代理到 host。
    const view = viewOf(host);
    return { host, masks, place: () => { view.placeFocusRing(); },
        // 第 25 条：直接驱动「立绘避让」决策（绕开 `placeFocusRing` 里对话框为焦点让位那一层，
        // 否则焦点一挪，对话框就把立绘一起抬走，永远测不到「挡」）。
        // 只摆立绘位置（不动对话框留白），给「避让决策」用例打底。
        layout: () => { (view as unknown as { placePortrait(): void }).placePortrait(); },
        sync: (visible: boolean, halfWidth: number, halfHeight: number) => {
            (view as unknown as { syncPortraitSuppression(v: boolean, w: number, h: number): void })
                .syncPortraitSuppression(visible, halfWidth, halfHeight);
        } };
}

test('底栏卡牌入口贴屏幕底边时，装饰留白不得隐藏高亮和手指', () => {
    const f = fixture(-200, -704);
    f.place();
    assert.equal(f.host.focusRing.active, true);
    assert.equal(f.host.focusHand.active, true);
    assert.equal(f.host.dimNode.active, false);
    assert.ok(f.host.focusMasks.every(node => node.active));
    assert.equal(f.host.dialogWidget.bottom, 392, '底栏入口的手指与提示条上方留出对话位置');
    f.host.focusTarget.node.activeInHierarchy = false;
    f.place();
    assert.equal(f.host.dialogWidget.bottom, 168, '焦点失活后恢复预制体留白');
});

test('横向贴边也可高亮，真实控件离屏或失活仍隐藏', () => {
    const f = fixture(310, 0);
    f.place();
    assert.equal(f.host.focusRing.active, true);
    f.host.focusTransform.width = 102;
    f.place();
    assert.equal(f.host.focusRing.active, false);
    f.host.focusTransform.width = 100;
    f.host.focusTarget.node.activeInHierarchy = false;
    f.place();
    assert.equal(f.host.focusHand.active, false);
});

test('卡牌贴滚动视口边缘时忽略装饰留白，真实内容被裁剪时仍隐藏', () => {
    const f = fixture(0, -124);
    f.host.focusClips.push({ width: 300, height: 400, anchorX: 0.5, anchorY: 0.5,
        convertToNodeSpaceAR: (p: object, out: object) => Object.assign(out, p) });
    f.place();
    assert.equal(f.host.focusRing.active, true);
    f.host.focusTransform.height = 154;
    f.place();
    assert.equal(f.host.focusRing.active, false);
});

test('结算步（BattleResult/*）只留光圈与手指，不给「点击高亮区域」气泡', () => {
    const f = fixture(0, -300);
    f.host.focusKey = 'Main/CardEntry';
    f.place();
    assert.equal(f.host.mapHint.active, true, '普通步照常弹气泡');
    f.host.focusKey = 'BattleResult/BtnOk';
    f.place();
    assert.equal(f.host.mapHint.active, false, '结算那颗确定不弹气泡（台词语义已经说明）');
    assert.equal(f.host.focusRing.active, true, '光圈和手指仍要指出点哪');
    assert.equal(f.host.focusHand.active, true);
});

// 第 24 条：`Map/Level_*` 的步要「等手指落到关卡地块上再开口」，否则台词先于光圈出现，
// 玩家读到「点击关卡」却看不出该点哪一格（现场：光圈跑到隔壁价格格、甚至压根没画）。
test('关卡步等光圈：焦点没解析出来时不开对话条、不放第一句，解析出来那一帧才开口', () => {
    const f = fixture(310, 0);
    f.host.focusKey = 'Map/Level_10001';
    f.host.narrationPending = true;
    f.host.canAdvance = false;
    // 横向离屏 ⇒ 光圈不可见。
    f.host.focusTransform.width = 102;
    f.place();
    assert.equal(f.host.focusRing.active, false);
    assert.equal(f.host.dialogBox.active, false, '光圈没到就不许亮对话条（否则台词比手指早）');
    assert.deepEqual(f.host.narrationLines, [], '一句都不许放');

    // 地块进入可解析状态 ⇒ 同一帧放第一句，并清掉待播标记（不会重复放）。
    f.host.focusTransform.width = 100;
    f.place();
    assert.equal(f.host.focusRing.active, true);
    assert.deepEqual(f.host.narrationLines, [0]);
    assert.equal(f.host.narrationPending, false, '放出去之后待播标记要清掉');
    assert.equal(f.host.dialogBox.active, true, '光圈到位后对话条跟着亮');
    f.place();
    assert.deepEqual(f.host.narrationLines, [0], '已经放过了就不再放第二遍');
});

test('焦点没就绪时「点对话条推进」的步铺满屏；等世界动作的步只守对话条、绝不铺满（否则宝箱点不动）', () => {
    const f = fixture(310, 0);
    // 横向离屏 ⇒ 没有孔。
    f.host.focusTransform.width = 102;
    f.host.dialogClosed = false;
    f.host.canAdvance = true;
    f.place();
    assert.equal(f.host.focusRing.active, false);
    assert.equal(f.host.blockerNode.active, true, '台词步没有孔也要挡：孔外点哪都算点对话条');
    assert.equal(f.host.dimNode.active, true);

    // 2-1/2-2 这类等的是「点地块 / 点宝箱」，铺满屏等于把玩家唯一能点的目标锁在外面。
    f.host.canAdvance = false;
    f.place();
    assert.equal(f.host.dimNode.active, false, '不压暗、不铺满屏，否则点屏幕任意地方都无反馈');
    // 但对话条自己那一块仍要能点：第 19 条现场（6-2 焦点解析不出来）就是这里空着，
    // 点它没反应、8s 超时推到末句也收不掉 —— 尺寸由 `layoutBlocker` 收缩到对话条。
    assert.equal(f.host.blockerNode.active, true, '对话条那一块必须留点击区，否则是死区');
});

// 第 25 条：`hole` 步不再「一律藏立绘」。6-3（升级按钮）的孔在右下、立绘在对话框上方靠右，
// 旧口径下「升级卡牌」整段的 NPC 形象都没了（用户截图：立绘位置空着，只剩气泡和手指）。
// 新口径三级让位：右侧站得下就站右侧 → 挡住就换左侧 → 两侧都挡才收起来。
test('hole 步的立绘三级让位：站右侧 → 换左侧 → 两侧都挡才收', () => {
    // 对话框宽 660、立绘宽 108 ⇒ 右对齐 x = ±(330 − 54) = ±276；
    // 脚点 y = −468、高 160 ⇒ 立绘占 y ∈ [−468, −308]。
    // 这里直接驱动「避让决策」，绕开 `placeFocusRing` 里「对话框为焦点让位」那一层 ——
    // 否则焦点一挪，对话框连带立绘一起被抬走，永远造不出「挡」。
    const f = fixture(0, -400);
    f.host.currentMaskType = 'hole';
    f.host.portraitShown = true;
    f.host.portraitDisplayWidth = 108;
    f.host.portraitDisplayHeight = 160;
    f.host.portraitNode.active = true;   // 已由 `applyPortrait` 点亮
    f.layout();                          // `applyPortrait` 会顺手摆一次位置，这里手动补上

    // ① 孔在屏幕中间、立绘在右侧 ⇒ 不挡，站右侧（默认位置）。
    f.host.focusLocal.x = 0;
    f.host.focusLocal.y = -400;
    f.sync(true, 54, 80);
    assert.equal(f.host.portraitNode.active, true, '不挡孔就不许藏 —— 旧口径按 maskType 一刀切会白丢立绘');
    assert.equal(f.host.portraitNode.position.x, 276, '默认站右侧');

    // ② 孔挪到右边（6-3 的「升级」按钮就在右下）⇒ 换到左侧，**仍然露脸**。
    f.host.focusLocal.x = 276;
    f.sync(true, 54, 80);
    assert.equal(f.host.portraitNode.active, true, '换边能站下就不许收');
    assert.equal(f.host.portraitNode.position.x, -276, '让到孔的左侧');

    // ③ 立绘宽到两侧都压住孔（660 宽的卡牌详情那种）⇒ 只好收起来，这时它真的没有落脚处。
    f.host.portraitDisplayWidth = 440;
    f.host.focusLocal.x = 0;
    f.sync(true, 54, 80);
    assert.equal(f.host.portraitNode.active, false, '两侧都挡才收');

    // ④ `full` / `none` 步不参与判定：暗层已经把世界压住（`none` 连暗层都没有），立绘站着是设计要的。
    f.host.currentMaskType = 'full';
    f.sync(true, 54, 80);
    assert.equal(f.host.portraitNode.active, true);
    assert.equal(f.host.portraitSide, 1, '不参与判定时回到默认右侧（宽度还是上一轮的 440）');
});

// 2026-11-16「手指呼吸卡顿」：焦点静止时每帧重设遮罩尺寸会让 Sprite 重建顶点缓冲。
// 抽出真实的 placeMask，锁住「值没变就不写」这条。
const maskMethod = view.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'placeMask')!;
const maskExports: { place?: (this: object, index: number, x: number, y: number, width: number, height: number) => void } = {};
runInNewContext(ts.transpileModule(`exports.place = class { ${maskMethod.getText(source)} }.prototype.placeMask;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: maskExports });

function maskFixture() {
    let posWrites = 0, sizeWrites = 0;
    const node = {
        position: { x: 100, y: 200 },
        setPosition(x: number, y: number) { posWrites++; this.position = { x, y }; },
    };
    const size = {
        width: 300, height: 400,
        setContentSize(width: number, height: number) { sizeWrites++; this.width = width; this.height = height; },
    };
    const host = { focusMasks: [node], maskTransforms: [size] };
    return { host, place: (x: number, y: number, w: number, h: number) => maskExports.place!.call(host, 0, x, y, w, h),
        writes: () => ({ posWrites, sizeWrites }) };
}

test('关卡焦点把编号气泡一起圈进来：孔向上长，四块遮罩跟着长', () => {
    // 地块：焦点盒 108×160（中心落在 (0,0)）⇒ 孔 y ∈ [-80, 80]。
    // 气泡：94×45、中心抬到 (0,130) ⇒ 并集 y ∈ [-80, 152.5]。
    const bubble = {
        isValid: true, activeInHierarchy: true,
        getComponent: () => ({
            width: 94, height: 45, anchorX: 0.5, anchorY: 0.5,
            convertToWorldSpaceAR: (p: { x: number; y: number }, out: object) =>
                Object.assign(out, { x: p.x, y: p.y + 130 }),
        }),
    };
    const withBubble = fixture(0, 0);
    withBubble.host.focusExtra.push(bubble);
    withBubble.place();
    const [cx, cy, halfW, halfH] = withBubble.masks.at(-1)!;
    assert.equal(cx, 0);
    assert.equal(cy, 36.25, '并集中心被气泡抬上去');
    assert.equal(halfW, 54, '宽度还是地块的（气泡没超出）');
    assert.equal(halfH, 116.25, '高度吃到气泡上沿 152.5');

    // 没有附加节点 ⇒ 老口径一格不动（回归守卫）。
    const plain = fixture(0, 0);
    plain.place();
    assert.deepEqual(plain.masks.at(-1), [0, 0, 54, 80]);

    // 气泡没显示（例如这一格还没解锁 / 被隐藏）⇒ 退化成只圈地块。
    const hidden = fixture(0, 0);
    hidden.host.focusExtra.push({ ...bubble, activeInHierarchy: false });
    hidden.place();
    assert.deepEqual(hidden.masks.at(-1), [0, 0, 54, 80]);
});

test('焦点静止时遮罩不再逐帧重设尺寸/位置，只有真变化才写节点', () => {
    const f = maskFixture();
    f.place(100, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 0, sizeWrites: 0 }, '与当前值一致时不得写节点');
    f.place(100, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 0, sizeWrites: 0 }, '连帧重复调用同样不写');
    f.place(110, 200, 300, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 0 }, '只有位置变了才写位置');
    f.place(110, 200, 320, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 1 }, '只有尺寸变了才写尺寸');
    // 负尺寸夹成 0。
    f.place(110, 200, -5, 400);
    assert.deepEqual(f.writes(), { posWrites: 1, sizeWrites: 2 });
});

/**
 * 第 27 条现场（用户 2026-11-18）：7-1 弱引导把对话条点掉之后，豌豆游侠还杵在右下角 ——
 * 「已经没有相关的对话了，这个角色怎么突然出现」。
 *
 * 收对话条的口子不止一处（点哪都收 / 空台词 / 等光圈 / 战斗焦点 / 被全屏弹窗顶掉），
 * 逐个补 `hidePortrait()` 迟早漏一处。判据收到一处：**对话条不显示 ⇒ 立绘不显示**，
 * 由 `placeFocusRing` 逐帧兜底（节点 `active` 才是最终结果）。
 */
test('对话条一关，立绘跟着收：不许留一个没有台词的「光杆角色」', () => {
    const f = fixture(0, 0);
    // 这一句有立绘且正站着（骨骼立绘 `豌豆游侠` 的宿主就是 `portraitNode`）。
    f.host.portraitShown = true;
    f.host.portraitDisplayWidth = 120;
    f.host.portraitDisplayHeight = 200;
    f.host.portraitNode.active = true;
    // 对话条已经收掉（`dismissDialog` 把 `dialogClosed` 置真之后的状态）。
    f.host.dialogClosed = true;
    f.place();
    assert.equal(f.host.dialogBox.active, false);
    assert.equal(f.host.portraitNode.active, false, '对话条收掉后立绘必须一起收');
    assert.equal(f.host.portraitShown, false, '标记也要清：否则下一帧的遮挡判定会把它重新点亮');
});

test('对话条还在时不动立绘（别把「让位」逻辑的输入改没了）', () => {
    const f = fixture(0, 0);
    f.host.portraitShown = true;
    f.host.portraitDisplayWidth = 120;
    f.host.portraitDisplayHeight = 200;
    f.host.portraitNode.active = true;
    f.place();
    assert.equal(f.host.dialogBox.active, true, '台词还在播 ⇒ 对话条亮着');
    assert.equal(f.host.portraitNode.active, true, '立绘照站（挡不挡孔交给避让判定）');
});
