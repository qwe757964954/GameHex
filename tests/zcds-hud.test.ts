import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { buildSeatProfiles, RANK_FALLBACK_NAMES } from '../assets/script/app/zcds/model/ZCRankBoard';

/**
 * ZCGameViewUtil 在**模块作用域**就 `new Color(...)` 建了四个血表配色常量，
 * 所以 `cc` 桩必须给出真能 new 的类 —— 只给 `{}` 会在 require 期就抛
 * `Color is not a constructor`，挂在 import 链上表现为「整条用例莫名崩」。
 */
const STUB_CC = {
    Color: class { constructor(public r = 0, public g = 0, public b = 0, public a = 255) {} },
    Graphics: class { moveTo() {} lineTo() {} close() {} stroke() {} fill() {} clear() {} },
    ProgressBar: class {},
    // 下面三个是「装饰器组件模块」（`ZCGameHudScoreSlot`）在**类定义期**要用的 ——
    // 少了 `_decorator` 就 `@ccclass(...)` 直接抛，整个模块 require 失败。
    // ⚠️ `ccclass` 必须返回**装饰器函数**：`@ccclass('X')` 展开后是 `__decorate([ccclass('X')], Y)`，
    //    `ccclass` 直接把入参（字符串 'X'）返回的话，`__decorate` 会拿字符串当函数调 ⇒
    //    运行期抛 `d is not a function`（踩过，报错信息完全指不到真因）。
    _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
    Component: class {},
    Label: class {},
    Sprite: class {},
    SpriteFrame: class {},
    // `ZCGameHudScoreSlot` 在**模块顶层**就 `new Vec3(...)` 造弹跳的缩放常量
    // （2026-10-14 数字变化弹跳），桩里没有就 `Vec3 is not a constructor`、整条用例崩。
    Vec3: class { constructor(public x = 1, public y = 1, public z = 1) {} },
};

/**
 * 加载纯逻辑模块：按工程真源逐个解析相对路径。
 *
 * ⚠️ 别用 `require: () => cc` 一把梭给全部依赖 —— 那样 `HexGridLayout` 的格距常量
 * 会变成 undefined，`mapToViewX/Y` 全返回 NaN，而 **NaN 的任何比较都是 false**，
 * 表现为「断言莫名失败」而不是「数值不对」，极难归因。
 */
function loadPureModule(entry: string) {
    const cache = new Map<string, any>();
    const exists = (path: string): boolean => {
        try { readFileSync(path); return true; } catch { return false; }
    };
    const load = (rel: string): any => {
        if (cache.has(rel)) return cache.get(rel);
        const code = ts.transpileModule(readFileSync(rel, 'utf8'), {
            // ⚠️ `experimentalDecorators` 必开：要load 的 `ZCGameHudScoreSlot` 是 `@ccclass` 装饰器组件，
            //    不开的话 tsc 按新语义降级成 `__esDecorate` 的 polyfill 形式，
            //    运行期直接抛 `(0 , decorators[i]) is not a function`（踩过）。
            //    对纯逻辑模块无副作用 —— 它们本来就没装饰器。
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
                experimentalDecorators: true,
            },
        }).outputText;
        const module = { exports: {} as any };
        const fromDir = dirname(rel);
        new Function('require', 'module', 'exports', code)((name: string) => {
            if (name === 'cc') return STUB_CC;
            const abs = join(fromDir, name);
            return load(exists(abs + '.ts') ? abs + '.ts' : abs + '/index.ts');
        }, module, module.exports);
        cache.set(rel, module.exports);
        return module.exports;
    };
    return load(entry);
}

// 运行真实 HUD 脚本，仅替换 Cocos 的节点和事件基础设施。
function createHud(
    hexes = [{ x: -500, y: -700 }, { x: 500, y: 700 }],
    headFrameResult: unknown = null,
) {
    const tweenRuns: Array<{
        startScale: { x: number; y: number; z: number };
        startPosition: { x: number; y: number; z: number };
        endScale: { x: number; y: number; z: number };
        endPosition: { x: number; y: number; z: number };
        delay: number; duration: number;
    }> = [];
    class FakeNode {
        static EventType = { TOUCH_START: 'start', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel', MOUSE_WHEEL: 'mouse-wheel', SIZE_CHANGED: 'size' };
        listeners: Array<{ event: string; callback: Function; target: unknown; capture: boolean }> = [];
        position = { x: 0, y: 0, z: 0 };
        scale = { x: 1, y: 1, z: 1 };
        //  `UITransform` 桩要够 `fitMapBackground` 用：它读 width/height 并回写 setContentSize。
        //  `convertToNodeSpaceAR` 是双指 / 滚轮缩放的锚点换算（规则里视口局部坐标），
        //  夹具里视口恒等于屏幕、原点也重合 ⇒ 恒等映射就够，别在这里模拟相机矩阵。
        transform = {
            width: 720, height: 1280,
            setContentSize(width: number, height: number) { this.width = width; this.height = height; },
            convertToNodeSpaceAR(point: { x: number; y: number }) { return { x: point.x, y: point.y }; },
        };
        getComponent() { return this.transform; }
        getChildByPath() { return null; }
        //  `fitMapBackground` 要按名字取 `MapLayer/content/Background`（那边缺节点会抛），
        // 夹具给一个**按名字稳定**的假子节点（反复取拿到同一个，和真引擎一致）。
        private childByName = new Map<string, FakeNode>();
        getChildByName(name: string) {
            let child = this.childByName.get(name);
            if (!child) { child = new FakeNode(); this.childByName.set(name, child); }
            return child;
        }
        setScale(x: any, y?: number, z?: number) { this.scale = typeof x === 'object' ? x : { x, y, z }; }
        setPosition(x: any, y?: number, z?: number) { this.position = typeof x === 'object' ? x : { x, y, z }; }
        on(event: string, callback: Function, target: unknown, capture = false) { this.listeners.push({ event, callback, target, capture }); }
        off(event: string, callback: Function, target: unknown, capture = false) {
            this.listeners = this.listeners.filter(item => !(item.event === event && item.callback === callback && item.target === target && item.capture === capture));
        }
        emit(event: string, argument?: unknown) {
            for (const item of [...this.listeners]) if (item.event === event) item.callback.call(item.target, argument);
        }
    }
    class FakeButton { static EventType = { CLICK: 'click' }; node = new FakeNode(); interactable = true; }
    class FakeComponent {
        enabledInHierarchy = true;
        node = new FakeNode();
        scheduled: Function[] = [];
        unschedule(callback: Function) { this.scheduled = this.scheduled.filter(fn => fn !== callback); }
        scheduleOnce(callback: Function) { this.scheduled.push(callback); }
    }
    const fakeTween = (target: FakeNode) => {
        let delay = 0;
        let duration = 0;
        let properties: Record<string, any> = {};
        let callback = () => {};
        const chain = {
            delay(value: number) { delay = value; return chain; },
            to(value: number, next: Record<string, any>) { duration = value; properties = next; return chain; },
            call(next: () => void) { callback = next; return chain; },
            start() {
                // endScale / endPosition 记 tween 的**目标**，与 start 分离 ——
                // 入场镜头起点是整盘全景、终点才是己方落点，两者缩放不同；
                // 只看 start 会把"起始居中"错当成"收尾居中"。
                tweenRuns.push({
                    startScale: { ...target.scale },
                    startPosition: { ...target.position },
                    endScale: { ...(properties.scale ?? target.scale) },
                    endPosition: { ...(properties.position ?? target.position) },
                    delay,
                    duration,
                });
                if (properties.scale) target.setScale(properties.scale);
                if (properties.position) target.setPosition(properties.position);
                callback();
                return chain;
            },
            stop() { return chain; },
        };
        return chain;
    };
    const cc = {
        _decorator: { ccclass: () => (value: unknown) => value, property: () => () => {} },
        Component: FakeComponent, Node: FakeNode, Button: FakeButton,
        Vec3: class { constructor(public x: number, public y: number, public z: number) {} },
        Label: class {}, Sprite: class {}, SpriteFrame: class {}, ScrollView: class {}, UITransform: class {},
        Color: class { constructor(public r: number, public g: number, public b: number, public a: number) {} },
        tween: fakeTween,
    };
    // 纯逻辑模块跑工程真源（`cc` 才走桩）—— 见 loadPureModule 的警告：
    // 旧写法 `require: () => cc` 会让格距常量变 undefined，`mapToViewX/Y` 全是 NaN。
    const view = loadPureModule('assets/script/app/zcds/view/ZCGameViewUtil.ts');
    assert.ok(Number.isFinite(view.mapToViewX(36)), '夹具自检：mapToViewX 必须是有限数');
    // 界面意图事件契约（`ZCGameUiEvent`）：用例拿它当事件名，也断言"点了哪个按钮"。
    const events = loadPureModule('assets/script/app/zcds/view/ZCGameHudEvents.ts');
    // 事件中控（`framework/event/EventMgr`，纯 TS 单例）：视图 `emit` 到它、控制器在它上面订阅，
    // 所以用例也拿**同一个单例**断言"点了哪个按钮"。夹具必须把同一个模块对象喂给视图，单例才是同一个。
    const managerModule = loadPureModule('assets/script/framework/event/EventMgr.ts');
    const mgr = managerModule.EventMgr.instance;
    assert.ok(events.ZCGameUiEvent?.OpenRank, '夹具自检：契约必须能加载出 ZCGameUiEvent');
    const dependencies: Record<string, unknown> = {
        cc,
        // 「多队伍」改造后 HUD 不再引用 GamePlayerItem / GameVS（两方版节点已从 prefab 删除），
        // 改为引用两个新的行组件 + 头像加载器。
        // 顶部尺寸与数字互斥由真实组件负责，夹具只记录 HUD 的派发数据。
        './ZCGameHudScoreSlot': loadPureModule('assets/script/app/zcds/view/ZCGameHudScoreSlot.ts'),
        './ZCGameHudPlayerRow': { ZCGameHudPlayerRow: class {} },
        '../../../vscrollview/VScrollView': { VirtualScrollView: class {} },
        '../../HeadArt': { HeadArt: { loadHeadFrame: async () => headFrameResult } },
        '../model/ZCCombatCatalog': { getPlayerDeck: () => [{ name: '测试卡' }] },
        '../model/ZCGameModel': { ZC_HEX_CONFIG: hexes },
        // R22 相机：HUD 的倍率**默认值**直接从模型层取（`ZC_MAP_ZOOM_*_DEFAULT`），
        // 所以这是**值导入**、不是 `import type`，夹具必须给（不给会在 require 期断言炸掉）。
        '../model/ZCMapConfig': loadPureModule('assets/script/app/zcds/model/ZCMapConfig.ts'),
        './ZCGameViewUtil': view,
        './ZCGameHudEvents': events,
        '../../../framework/event/EventMgr': managerModule,
    };
    const source = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true } }).outputText;
    const context = { exports: {} as any, require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; } };
    runInNewContext(code, context);
    const hud = new context.exports.ZCGameHUDView();
    hud.mapViewport = new FakeNode();
    hud.mapLayer = new FakeNode();
    // 铺底大图：`fitMapBackground` 现在走 prefab 绑定的 `mapBackground`（不再按名找子节点）。
    hud.mapBackground = new FakeNode();
    hud.mapScrollView = { enabled: true, stopAutoScroll() {} };
    // 三块「按模式收起」的面板：`render()` 现在会按「是否守城局」开关 `topInfoPanel`
    // （守城局顶部信息带整个收起），夹具必须把节点给上，否则第一帧就炸在 `.active` 上。
    for (const key of ['topInfoPanel', 'bottomInfoPanel', 'leftPanel']) hud[key] = new FakeNode();
    for (const key of ['artifactButton', 'rankButton', 'guideButton', 'damageButton', 'retreatButton', 'resetCameraButton']) {
        hud[key] = new FakeButton();
    }
    for (const key of ['timeLabel', 'goldLabel', 'logLabel', 'deckLabel']) hud[key] = { string: '' };
    // 金币不足时跳动的那个图标（`BottomInfoPanel/CoinPanel/coin`）：`flashInsufficientGold` 会读它的
    // position / scale，缺了就是运行期崩 —— 与 prefab 上「必填引用」同一口径。
    hud.goldIcon = new FakeNode();
    hud.artifactIcon = { grayscale: false };
    hud.artifactProgress = { fillRange: 0, grayscale: false };
    hud.artifactCountLabel = { string: '' };
    // 「多队伍」：顶部四格 + 左侧玩家列表。
    // 左侧是**虚拟列表**：条目由 `setTotalCount` 造、`getItemByIndex` 取，行的 `render`
    // 通过条目节点的 `getComponent` 拿到（与真引擎的取法一致）。
    hud.scoreCalls = [];
    hud.layoutUpdates = 0;
    hud.scoreLayout = { updateLayout() { hud.layoutUpdates++; } };
    hud.rowCalls = [];
    for (let i = 1; i <= 4; i++) {
        const slot = {
            node: new FakeNode(),
            render(data: unknown) { hud.scoreCalls.push(data); return true; },
        };
        hud[`scoreSlot${i}`] = slot;
    }
    const rowNodes: { getComponent: () => unknown }[] = [];
    const makeRowNode = (index: number) => ({
        getComponent: () => ({
            node: new FakeNode(),
            render(data: Record<string, unknown>) { hud.rowCalls.push({ index, ...data }); },
        }),
    });
    hud.playerList = {
        totalCount: 0,
        isValid: true,
        setTotalCount(count: number) {
            this.totalCount = count;
            while (rowNodes.length < count) rowNodes.push(makeRowNode(rowNodes.length));
        },
        getItemByIndex(index: number) { return rowNodes[index] ?? null; },
    };
    // ⚠️ 不要在这里覆盖 `scheduleOnce`/`unschedule` —— 夹具的 `FakeComponent` 已经把它们
    // 记进 `hud.scheduled`，测试靠 `hud.scheduled` 手动跑"下一帧"的回调（覆盖会让拖动用例变红）。
    const model = {
        snapshot: { playerGold: 123.9, artifactReadyUses: 1, artifactCharge: 0, artifactCooldown: 0, status: 'playing', resultReason: '', units: [
            { owner: 'player', battleState: 'idle' }, { owner: 'player', battleState: 'dead' },
            { owner: 'enemy', battleState: 'attack' }, { owner: 'enemy', battleState: 'move' },
        ] },
        remainingSeconds: 60.1, unitCap: 100, playerTerritoryCount: 70, enemyTerritoryCount: 68, playerBonds: ['羁绊A'],
        artifactChargeFull: 100, artifactMaxStored: 2, artifactCooldownDuration: 1,
        // 「多队伍」后 HUD 按**席位**渲染：`owners` 给席位序，`territoryCountOf` 给逐席地块数。
        // 2 人局只给 2 席（后两格应被 render 关掉）。
        owners: ['player', 'enemy'] as const,
        territoryCountOf(owner: string) { return owner === 'player' ? 70 : owner === 'enemy' ? 68 : 0; },
    };
    return { hud, model, mgr, tweenRuns, view, events, hudModule: context.exports };
}

test('开局先以居中全景展示完整棋盘，再放大到居中的原始倍率', () => {
    const { hud, tweenRuns, mgr } = createHud();
    hud.initialize();
    assert.equal(tweenRuns.length, 1);
    assert.ok(tweenRuns[0].startScale.x < 1);
    assert.equal(tweenRuns[0].startScale.x, tweenRuns[0].startScale.y);
    assert.equal(tweenRuns[0].startPosition.x, 0);
    assert.equal(tweenRuns[0].startPosition.y, 0);
    assert.equal(hud.mapLayer.scale.x, 1);
    assert.equal(hud.mapLayer.scale.y, 1);
    assert.equal(hud.mapLayer.position.x, 0);
    assert.equal(hud.mapLayer.position.y, 0);
    hud.initialize();
    assert.equal(tweenRuns.length, 1, '重复初始化不应重复播放开局镜头');
});

test('开局镜头停在我方主城那一格，而不是整盘中心（3 / 4 人图上中心落在中立空白处）', () => {
    // 复刻 3 人图（standard_3）的取样：主城在左下角，明显偏离整盘中心。
    const hexes = [{ x: -500, y: -500 }, { x: 500, y: 700 }];
    const { hud, tweenRuns, view, mgr } = createHud(hexes);
    // 落点按工程真源换算（`mapToViewX/Y`），别手抄数字 —— 抄错会静默变成"断言在测一个错的东西"。
    const home = { x: view.mapToViewX(-300), y: view.mapToViewY(-400) };
    // centerAt 复刻 HUD 的 mapCenterAtScale，**连 `|| 0` 一起抄** ——
    // 少了它期望值是 -0 而实际是 0，assert.equal 用 Object.is 判 -0 !== 0，
    // 报出来是"0 不等于 -0"，完全看不出是公式抄漏了一个归一化。
    const centerAt = (scale: number) => ({
        x: -(view.mapToViewX(-500) + view.mapToViewX(500)) / 2 * scale || 0,
        y: -(view.mapToViewY(-500) + view.mapToViewY(700)) / 2 * scale || 0,
    });
    const center = centerAt(1);
    hud.setMapFocus(home);
    hud.initialize();

    assert.notEqual(hud.mapLayer.position.x, center.x, '落点不应停在整盘中心 X');
    assert.notEqual(hud.mapLayer.position.y, center.y, '落点不应停在整盘中心 Y');
    // 镜头要真的朝己方挪（不是换了个中心那么简单）：主城那一格必须落在视口内。
    const onScreenX = home.x + hud.mapLayer.position.x;
    const onScreenY = home.y + hud.mapLayer.position.y;
    assert.ok(Math.abs(onScreenX) <= 360, `主城应落在视口内 X，实际 ${onScreenX}`);
    assert.ok(Math.abs(onScreenY) <= 640, `主城应落在视口内 Y，实际 ${onScreenY}`);
    assert.ok(
        Math.abs(hud.mapLayer.position.x - center.x) + Math.abs(hud.mapLayer.position.y - center.y) > 1,
        '镜头相对整盘中心必须有位移',
    );
    // 全景起始仍是整盘中心（要看得见完整棋盘），只有收尾落点改。
    // 全景用 overviewScale（不是 1），按 `位置 / 缩放` 断言 —— 那个比值才是与缩放无关的整盘中心。
    const startScale = tweenRuns[0].startScale.x;
    assert.ok(startScale > 0 && startScale < 1, `全景应是缩小的整盘视图，实际 ${startScale}`);
    assert.equal(tweenRuns[0].startPosition.x / startScale, centerAt(1).x);
    assert.equal(tweenRuns[0].startPosition.y / startScale, centerAt(1).y);
});

test('落点必须活过 resize 夹取：夹取后再夹一次不动，否则镜头会自己弹回整盘中心', () => {
    const hexes = [{ x: -500, y: -500 }, { x: 500, y: 700 }];
    const { hud, view, mgr } = createHud(hexes);
    hud.onLoad(); // 引擎在节点激活时触发一次：监听在此绑定（规范 7.2），initialize 不再负责绑事件
    hud.setMapFocus({ x: view.mapToViewX(-300), y: view.mapToViewY(-400) });
    hud.initialize();
    const settled = { x: hud.mapLayer.position.x, y: hud.mapLayer.position.y };
    // 触发一次视口尺寸变化 —— applyMapOffset 会重新夹取
    hud.mapViewport.transform.width = 900;
    hud.mapViewport.emit('size');
    assert.equal(hud.mapLayer.position.x, settled.x, 'resize 后落点不应被弹走');
    assert.equal(hud.mapLayer.position.y, settled.y, 'resize 后落点不应被弹走');
});

test('没给落点时退回整盘中心（2 人图与旧行为一致）', () => {
    const hexes = [{ x: -500, y: -500 }, { x: 500, y: 700 }];
    const { hud, view, mgr } = createHud(hexes);
    const center = {
        x: -(view.mapToViewX(-500) + view.mapToViewX(500)) / 2 || 0,
        y: -(view.mapToViewY(-500) + view.mapToViewY(700)) / 2 || 0,
    };
    hud.initialize();
    assert.equal(hud.mapLayer.position.x, center.x);
    assert.equal(hud.mapLayer.position.y, center.y);
});

test('结算拉远仍回整盘居中，不受开局落点影响', () => {
    const hexes = [{ x: -500, y: -500 }, { x: 500, y: 700 }];
    const { hud, view, tweenRuns, mgr } = createHud(hexes);
    const center = {
        x: -(view.mapToViewX(-500) + view.mapToViewX(500)) / 2 || 0,
        y: -(view.mapToViewY(-500) + view.mapToViewY(700)) / 2 || 0,
    };
    hud.setMapFocus({ x: view.mapToViewX(-300), y: view.mapToViewY(-400) });
    hud.initialize();
    const before = tweenRuns.length;
    hud.startSettlementOverview();
    // 结算拉到 overviewScale（不是 1），按 `位置 / 缩放` 断言整盘居中。
    const scale = tweenRuns[before].endScale.x;
    assert.ok(scale > 0 && scale < 1, `结算应拉远到整盘视图，实际 ${scale}`);
    assert.equal(tweenRuns[before].endPosition.x / scale, center.x, '结算要看整盘，必须居中');
    assert.equal(tweenRuns[before].endPosition.y / scale, center.y);
});

test('buildPlayerHomeFocus 恒取 homes[0]（我方主城），与人数无关；select 图未选点时不给落点', () => {
    const { buildPlayerHomeFocus, mapToViewX, mapToViewY } = loadPureModule('assets/script/app/zcds/view/ZCGameViewUtil.ts');

    // 3 / 4 人图：homes 有 3~4 项，落点必须始终是第 0 项（我方），不能被长度带偏。
    const hexes = [
        { x: -100, y: -100 }, { x: 0, y: 0 }, { x: 100, y: 100 },
        { x: -200, y: 200 }, { x: 200, y: -200 },
    ];
    for (const homes of [[0], [0, 2], [0, 2, 4], [0, 2, 4, 1]]) {
        const focus = buildPlayerHomeFocus({ homes, playerHomeId: -1, hexes });
        assert.deepEqual(focus, { x: mapToViewX(-100), y: mapToViewY(-100) }, `homes=${JSON.stringify(homes)}`);
    }
    // 无 homes 时退回 playerHomeId（v1 / v2 老图口径）
    assert.deepEqual(
        buildPlayerHomeFocus({ playerHomeId: 2, hexes }),
        { x: mapToViewX(100), y: mapToViewY(100) },
    );
    // select 图：homes 只是默认建议，真正主城要等选点 ⇒ 不给落点
    assert.equal(buildPlayerHomeFocus({ homes: [0], playerHomeId: 0, cityMode: 'select', hexes }), null);
    // 没定主城（homes 空 + playerHomeId = -1）
    assert.equal(buildPlayerHomeFocus({ homes: [], playerHomeId: -1, hexes }), null);
});

test('每张工程地图的开局落点都成立：主城在屏内、且不被 resize 弹走', () => {
    const { buildPlayerHomeFocus, mapToViewX, mapToViewY, ZC_HEX_VIEW_WIDTH, ZC_HEX_VIEW_HEIGHT } =
        loadPureModule('assets/script/app/zcds/view/ZCGameViewUtil.ts');
    const mapConfig = loadPureModule('assets/script/app/zcds/model/ZCMapConfig.ts');
    const dir = 'assets/resources/config/maps';
    // 与 HUD 的常量保持一致（ZCGameHUDView 的 MAP_EDGE_MARGIN_* 与 prefab 上的 720×1280 视口）
    const VIEW_W = 720, VIEW_H = 1280, MARGIN_X = 80, MARGIN_Y = 230;
    let checked = 0;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        mapConfig.configureZCMap(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        const hexes = mapConfig.ZC_HEX_CONFIG;
        const focus = buildPlayerHomeFocus({
            homes: mapConfig.ZC_MAP_HOMES,
            playerHomeId: mapConfig.ZC_PLAYER_HOME_ID,
            cityMode: mapConfig.ZC_MAP_CITY_MODE,
            hexes,
        });
        const xs = hexes.map((h: { x: number }) => mapToViewX(h.x));
        const ys = hexes.map((h: { y: number }) => mapToViewY(h.y));
        const bounds = {
            minX: Math.min(...xs) - ZC_HEX_VIEW_WIDTH / 2, maxX: Math.max(...xs) + ZC_HEX_VIEW_WIDTH / 2,
            minY: Math.min(...ys) - ZC_HEX_VIEW_HEIGHT / 2, maxY: Math.max(...ys) + ZC_HEX_VIEW_HEIGHT / 2,
        };
        const center = { x: -(bounds.minX + bounds.maxX) / 2, y: -(bounds.minY + bounds.maxY) / 2 };
        const limitX = Math.max(0, (bounds.maxX - bounds.minX) / 2 - VIEW_W / 2 + MARGIN_X);
        const limitY = Math.max(0, (bounds.maxY - bounds.minY) / 2 - VIEW_H / 2 + MARGIN_Y);
        const clamp = (x: number, y: number) => ({
            x: Math.max(center.x - limitX, Math.min(center.x + limitX, x)),
            y: Math.max(center.y - limitY, Math.min(center.y + limitY, y)),
        });
        // select 图未选点时没有落点，走整盘中心 —— 那是预期行为，不参与落点断言
        if (!focus) continue;
        const rest = clamp(-focus.x, -focus.y);
        // ① 主城那一格在视口内 ② 夹取幂等（resize 不会把镜头弹走）
        assert.ok(Math.abs(focus.x + rest.x) <= VIEW_W / 2, `${file}: 主城 X 出屏 ${(focus.x + rest.x).toFixed(1)}`);
        assert.ok(Math.abs(focus.y + rest.y) <= VIEW_H / 2, `${file}: 主城 Y 出屏 ${(focus.y + rest.y).toFixed(1)}`);
        const again = clamp(rest.x, rest.y);
        assert.ok(
            Math.abs(again.x - rest.x) < 0.01 && Math.abs(again.y - rest.y) < 0.01,
            `${file}: 落点会被 resize 弹走`,
        );
        checked += 1;
    }
    assert.ok(checked >= 8, `应至少覆盖 8 张固定主城图，实际 ${checked}`);
});

test('HUD 按区域刷新：顶部计时与金币、逐席位地块数与兵力', () => {
    const { hud, model, mgr } = createHud();
    hud.initialize();
    hud.setSeatProfiles(new Map([
        ['player', { name: '蓝方', headKey: '' }],
        ['enemy', { name: '红方', headKey: '' }],
    ]) as any);
    // ★★ 自选主城的**选点阶段**专用：那时 `ZCGame.update` 会在 `if (this.spawnSelection)` 里
    // 提前 return、`this.model` 也还没建 ⇒ `render` 一次都不会跑。
    // 所以 `setSeatProfiles` 必须**当场**把四行刷出来，否则左侧只有 prefab 默认的
    // 「四个圆盘 + 空名字、没头像」（真机实测症状）。
    assert.equal(hud.rowCalls.length, 2, '★setSeatProfiles 必须立刻刷行（选点阶段没有 render）');
    assert.equal(hud.rowCalls[0].name, '蓝方');
    assert.equal(hud.rowCalls[1].name, '红方');
    assert.equal(hud.rowCalls[0].unitText, null, '★选点阶段还没有兵力数据 ⇒ 兵力整组收掉');
    hud.rowCalls.length = 0;
    hud.render(model);
    assert.equal(hud.timeLabel.string, '1:01');
    assert.equal(hud.goldLabel.string, '123');
    // ⚠️ `scoreCalls` 是**累积**的（render 每帧都往里push），所以只 render 这一次再断言。
    //    之前多render 了一次却忘了清，结果条数翻倍（4 !== 2）。
    // 顶部四格：2 人局只给 2 席 ⇒ 只该渲染 2 格；地块数 70 / 68 都 > 0 ⇒ 都不显示红 X。
    // ⚠️ 逐字段 `assert.equal`，不用 `deepEqual`：`render` 里 new 出来的对象是在
    //    `runInNewContext` 的**另一个 realm** 里造的，原型不同 ⇒ deepEqual 会报
    //    "same structure but not reference-equal"（踩过）。
    assert.equal(hud.scoreCalls.length, 2, '只有 2 个席位 ⇒ 只该渲染 2 格');
    assert.equal(hud.scoreCalls[0].value, 70);
    assert.equal(hud.scoreCalls[0].finished, false);
    assert.equal(hud.scoreCalls[1].value, 68);
    assert.equal(hud.scoreCalls[1].finished, false);
    // 70 > 68 ⇒ 第 1 格唯一领先；横向 Layout 自动居中。
    assert.equal(hud.scoreCalls[0].leading, true, '★地块数唯一领先的那格才变大');
    assert.equal(hud.scoreCalls[1].leading, false);
    assert.equal(hud.layoutUpdates, 1, '尺寸或人数变化后刷新 Layout');
    // 左侧四行：名字来自席位档案；**兵力四行都显示**（2026-10-09 用户要求，设计稿只画了第 1 行），
    // 按 `unit.owner` 现数活口（夹具里 player 1 个非 dead、enemy 2 个非 dead）。
    assert.equal(hud.rowCalls.length, 2);
    assert.equal(hud.rowCalls[0].name, '蓝方');
    assert.equal(hud.rowCalls[0].unitText, '1/100');
    assert.equal(hud.rowCalls[1].name, '红方');
    assert.equal(hud.rowCalls[1].unitText, '2/100', '★兵力四行都显示（不再只第 1 行）');
});

test('四格顶栏：领先者变化和并列时，尺寸状态同步交给 Layout', () => {
    const { hud, mgr } = createHud();
    const four = ['player', 'enemy', 'enemy2', 'enemy3'] as const;
    const counts: Record<string, number> = { player: 10, enemy: 20, enemy2: 30, enemy3: 40 };
    const model = {
        snapshot: {
            playerGold: 0, artifactReadyUses: 0, artifactCharge: 0, artifactCooldown: 0,
            artifactChargeFull: 100, artifactMaxStored: 3, artifactCooldownDuration: 1,
            status: 'playing', resultReason: '', units: [],
        },
        remainingSeconds: 60, unitCap: 100,
        owners: four,
        territoryCountOf: (owner: string) => counts[owner] ?? 0,
    };
    hud.scoreCalls.length = 0;
    hud.render(model);
    const lead = (i: number) => hud.scoreCalls[i].leading;
    // 第 4 席唯一领先，其余保持普通尺寸。
    assert.deepEqual([lead(0), lead(1), lead(2), lead(3)], [false, false, false, true]);
    assert.equal(hud.layoutUpdates, 1);

    // 换领先者：旧格恢复普通尺寸，新格变大。
    counts.enemy3 = 5;
    counts.enemy = 99;
    hud.scoreCalls.length = 0;
    hud.render(model);
    assert.deepEqual([lead(0), lead(1), lead(2), lead(3)], [false, true, false, false], '★换领先者后标记跟着换');
    assert.equal(hud.layoutUpdates, 2);

    // 并列第一 ⇒ 全部恢复普通尺寸。
    counts.enemy = 50;
    counts.enemy2 = 50;
    hud.scoreCalls.length = 0;
    hud.render(model);
    assert.deepEqual([lead(0), lead(1), lead(2), lead(3)], [false, false, false, false], '★并列第一不算领先');
    assert.equal(hud.layoutUpdates, 3);
});

test('神器三态与进度同步；不可充能时按钮仍可点，只有结算后才禁用', () => {
    const { hud, model, events, mgr } = createHud();
    let uses = 0;
    hud.onLoad(); // 引擎在节点激活时触发一次：按钮点击监听在此绑定（规范 7.2）
    // 控制器那侧就是这么接的（`ZCGame.bindHudEvents`）：视图只 emit，谁订阅谁处理。
    mgr.on(events.ZCGameUiEvent.UseArtifact, () => { uses += 1; });
    hud.initialize();
    for (const [usesCount, charge, cooldown, status, ready, progress] of [
        [0, 50, 0, 'playing', false, 0.5],
        [1, 0, 0.5, 'playing', false, 0.5],
        [1, 25, 0, 'playing', true, 0.25],
        [2, 0, 0, 'playing', true, 1],
        [2, 0, 0, 'victory', false, 1],
    ] as const) {
        Object.assign(model.snapshot, { artifactReadyUses: usesCount, artifactCharge: charge, artifactCooldown: cooldown, status, resultReason: '胜利' });
        hud.render(model);
        // 不可充能时按钮**仍须可点**：interactable=false 会让 Button 不再派发 CLICK，
        // 点击被整段静默吞掉，「神器尚未充满」这句原因就永远送不到玩家眼前。
        // 「不可用」的表达交给 grayscale，不靠 interactable。
        assert.equal(hud.artifactButton.interactable, status === 'playing');
        assert.equal(hud.artifactIcon.grayscale, !ready);
        assert.equal(hud.artifactProgress.fillRange, progress);
        assert.equal(hud.artifactCountLabel.string, `×${usesCount}`);
        hud.artifactButton.node.emit('click');
    }
    // 5 行里 4 行 status='playing' → 每一下点击都送达动作层（由模型决定成败与文案）；
    // 只有结算后那一行不再派发。
    assert.equal(uses, 4);
});

test('六个按钮各自派发对应意图事件（视图不再持有任何回调）', () => {
    // 事件化之后视图**不知道**上层有没有接：点一下就必须派发。
    // 「漏接」的风险从视图侧搬到了控制器侧（`ZCGame.bindHudEvents`），由 wiring 用例钉住。
    const { hud, model, events, mgr } = createHud();
    hud.onLoad();
    const seen: string[] = [];
    // 契约是**全界面共用**的（还含结算页 / 选点的意图），这里只取 HUD 那 6 个来对表。
    const hudEvents = ['UseArtifact', 'OpenGuide', 'OpenDamageStats', 'OpenRank', 'Retreat', 'ResetCamera'] as const;
    for (const key of hudEvents) {
        mgr.on(events.ZCGameUiEvent[key], () => seen.push(events.ZCGameUiEvent[key]));
    }
    hud.initialize();
    hud.render(model);
    hud.rankButton.node.emit('click');
    hud.guideButton.node.emit('click');
    hud.damageButton.node.emit('click');
    hud.artifactButton.node.emit('click');
    hud.retreatButton.node.emit('click');
    hud.resetCameraButton.node.emit('click');
    assert.deepEqual(
        [...seen].sort(),
        hudEvents.map((key) => events.ZCGameUiEvent[key]).sort(),
        '★六个按钮必须各自派发自己的意图事件 —— 少一个就是那个按钮点了没反应',
    );
});

test('神器 / 撤退在非对局进行中不派发（按钮也置灰）', () => {
    const { hud, model, events, mgr } = createHud();
    hud.onLoad();
    const seen: string[] = [];
    mgr.on(events.ZCGameUiEvent.UseArtifact, () => seen.push('artifact'));
    mgr.on(events.ZCGameUiEvent.Retreat, () => seen.push('retreat'));
    hud.initialize();
    model.snapshot.status = 'victory';
    hud.render(model);
    assert.equal(hud.artifactButton.interactable, false);
    assert.equal(hud.retreatButton.interactable, false);
    hud.artifactButton.node.emit('click');
    hud.retreatButton.node.emit('click');
    assert.deepEqual(seen, [], '结算后神器与撤退都不该再派发');
});

test('视口组件由 prefab 保证：全类只在缓存 getter 里查一次，且直写不再判空', () => {
    const HUD_SRC = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    // MapScrollView/view 在 ZCGameHUD.prefab 上静态挂着 UITransform，且全工程无人给 mapViewport 赋值
    // ⇒取不到就是 prefab 错误，应当场爆，不需要降级分支。
    // 2026-10-16（R22 相机）：`mapOverviewScale` / `fitMapBackground` / `clampMapOffset` 各查一遍，
    // 再加双指缩放的锚点换算就是四处 ⇒ 收敛成 `mapViewportTransform` 一处缓存。
    // 不收敛的话，每多一个调用点就多一次「顺手判个空」的机会，这条用例也就守不住了。
    const probes = HUD_SRC.match(/mapViewport\.getComponent\(UITransform\)/g) ?? [];
    assert.equal(probes.length, 1, `只该有 1 处（mapViewportTransform getter），实际 ${probes.length} 处`);
    // 唯一那一处必须是 `!`：判空不赚功力、只多一次 getComponent，且不留「判了不用」的死代码。
    assert.equal((HUD_SRC.match(/mapViewport\.getComponent\(UITransform\)!/g) ?? []).length, 1, '这一处应写 `!`');
    assert.match(
        HUD_SRC, /private get mapViewportTransform\(\): UITransform/,
        '视口查询要收在 mapViewportTransform getter 里（缓存 + 唯一入口）',
    );
    assert.ok(!/getComponent\(UITransform\);\s*\n\s*if \(!viewport/.test(HUD_SRC), '不应再有「取到不去就退回」的判空分支');
    // 视口尺寸由 Widget 四边拉伸 + ON_WINDOW_RESIZE 决定，恒等于窗口宽高 ⇒ 不可能是 0，
    // 所以 mapOverviewScale 里不应存在 `width > 0` 尺寸兜底。
    assert.ok(!/viewport\.width > 0/.test(HUD_SRC), '不应再有「视口宽高为 0」的尺寸兜底');
    // 正常路径不受影响：视口有尺寸时照常走下去。
    const { hud, model, mgr } = createHud();
    hud.onLoad();
    hud.initialize();
    Object.assign(model.snapshot, { status: 'victory', resultReason: '胜利' });
    hud.render(model);
    hud.startSettlementOverview();
    assert.equal(hud.mapLayer.scale.x > 0, true, '镜头应正常带一个正缩放');
});

test('视口只查一次：缓存之后每帧（applyMapOffset）不再 getComponent', () => {
    const { hud, mgr } = createHud();
    // `applyMapOffset` 每次拖动都跑，`fitMapBackground` 还要再问一次全景倍率 ——
    // 缓存之前这几条路径各查一遍视口；缓存之后整个生命周期只查一次。
    let probes = 0;
    // 必须在 onLoad 之前替换：SIZE_CHANGED 正是 onLoad 里绑到 applyMapOffset 的。
    const viewport = hud.mapViewport as unknown as { getComponent: () => unknown };
    viewport.getComponent = () => { probes += 1; return { width: 720, height: 1280 }; };
    hud.onLoad();
    hud.initialize();
    assert.equal(probes, 1, `initialize 期间应恰好查 1 次视口（缓存），实际 ${probes} 次`);
    probes = 0; // 跳过 initialize 期间的查询，只算运行期的
    hud.mapViewport.emit('size');
    assert.equal(probes, 0, `applyMapOffset 应完全走缓存、一次都不再查视口，实际 ${probes} 次`);
    //  换一局要重新取：`initialize` 把缓存清掉（同一个 HUD 实例复用、万一换了视口节点）。
    hud.initialize();
    assert.equal(probes, 1, '重新 initialize 应重新取一次视口（缓存不跨局复用）');

    // 整个类里只该有 getter 那一处查询。任何地方再往 mapViewport 上加 getComponent 都会红。
    const HUD_SRC = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    const probesInSrc = (HUD_SRC.match(/mapViewport\.getComponent\(UITransform\)/g) ?? []).length;
    assert.equal(probesInSrc, 1, `mapViewport.getComponent 只该有 1 处（mapViewportTransform），实际 ${probesInSrc} 处`);
});

test('SLG 空名字 NPC 在选点阶段和正式战斗均显示第二行敌方信息', async () => {
    const { hud, model } = createHud();
    hud.onLoad();
    hud.initialize();
    const profiles = buildSeatProfiles([
        { campId: 1, roleId: '22211', name: '指挥官:22211', avatarId: '10001' },
        { campId: 2, roleId: '0', name: '', avatarId: '0' },
    ], '22211');
    hud.setSeatProfiles(profiles);
    assert.equal(hud.playerList.totalCount, 2);
    assert.equal(hud.rowCalls[1].name, RANK_FALLBACK_NAMES.enemy);
    hud.rowCalls.length = 0;
    hud.render(model);
    assert.equal(hud.rowCalls[1].owner, 'enemy');
    assert.equal(hud.rowCalls[1].name, RANK_FALLBACK_NAMES.enemy);
    assert.equal(hud.rowCalls[1].unitText, '2/100');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(hud.playerList.totalCount, 2, '空头像异步返回不能删除 NPC 行');
});

test('头像异步到货：HUD 已销毁时不刷行（CCObject.isValid 不能删）', async () => {
    const hexes = [{ x: -500, y: -700 }, { x: 500, y: 700 }];
    const frame = { name: 'head.png' };
    const { hud, mgr } = createHud(hexes, frame);
    hud.onLoad();
    hud.initialize();
    // 头像是异步的：resolve 时 HUD 可能已经 destroy（退出对局）。
    // 此时再刷行就是向已销毁的节点树写了。
    hud.setSeatProfiles(new Map([['player', { name: '蓝方', headKey: 'blue' }]]) as never);
    hud.rowCalls.length = 0;
    hud.isValid = false;
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(hud.rowCalls.length, 0, '已销毁后不应再刷行（会向已销毁节点树写入）');
    // headKey 为空时直接 continue，不走异步分支。
    const { hud: hud2 } = createHud(hexes, frame);
    hud2.onLoad();
    hud2.initialize();
    hud2.setSeatProfiles(new Map([['player', { name: '蓝方', headKey: '' }]]) as never);
    assert.equal(hud2.rowCalls.length, 1, 'headKey 为空时仍要当场刷一遍（选点阶段靠这一遍）');
});

test('重绘回调是稳定引用：unschedule 能撤掉重复排程（方法不是箭头字段时也成立）', () => {
    const { hud, model, mgr } = createHud();
    hud.onLoad();
    hud.initialize();
    hud.setSeatProfiles(new Map([['player', { name: '蓝方', headKey: '' }]]));
    // paintPlayerRows 里是`unschedule(...)` + `scheduleOnce(...)` 配对，靠的是两次拿到同一个函数引用。
    // 若把 repaintPlayerRows 改成每次新建的闭包，unschedule 就拿不到、会重复排程。
    assert.equal(hud.scheduled.length, 1, '应只有一个待跑回调');
    hud.setSeatProfiles(new Map([['player', { name: '蓝方', headKey: '' }]]));
    assert.equal(hud.scheduled.length, 1, '重复设置不得重复排程');
    for (const callback of hud.scheduled) callback.call(hud);
    assert.ok(hud.rowCalls.length > 0, '排程回调应当跑出行数据');
    hud.render(model);
});

test('绑定只在 onLoad 完成一次；重复 initialize 不重复注册；onDestroy 不碰业务状态', () => {
    const { hud, model, events, mgr } = createHud();
    let ranks = 0;
    mgr.on(events.ZCGameUiEvent.OpenRank, () => { ranks += 1; });
    hud.onLoad(); // 引擎保证 onLoad 每实例只跑一次 ⇒ 没有 bound 守卫（规范 7.2）
    hud.initialize();
    hud.initialize();
    hud.render(model);
    // 三个左侧面板按钮整局都可点（不再按"上层有没有接"来置灰）；神器 / 撤退只在进行中可点。
    assert.equal(hud.rankButton.interactable, true);
    assert.equal(hud.guideButton.interactable, true);
    assert.equal(hud.retreatButton.interactable, true);
    hud.rankButton.node.emit('click');
    assert.equal(ranks, 1);
    // 重复 initialize 不重复注册监听 ⇒ 再点一次只 +1
    hud.rankButton.node.emit('click');
    assert.equal(ranks, 2);
    assert.equal(hud.mapScrollView.enabled, false);
    // 6 = 三条触摸 + 一条 TOUCH_CANCEL + 滚轮缩放（R22）+ SIZE_CHANGED；只在 onLoad 绑一次。
    assert.equal(hud.mapViewport.listeners.length, 6, '棋盘触摸/滚轮监听仍只在 onLoad 绑一次');
    assert.equal(hud.rankButton.node.listeners.length, 1, '按钮点击监听不被 initialize 重复注册');
    //  `onDestroy` 现在**不碰任何业务状态**（视图没有回调可清）⇒ 只要不抛就算过。
    //  ⚠️ 别拿"销毁后再 emit 一次，看 ranks 变不变"当判据：真引擎里监听随节点销毁回收，
    //  而夹具的 `FakeNode` 不会模拟回收，拿它断言等于把一个**夹具假象**固化成设计（规则 263c）。
    hud.onDestroy();
});

test('地图拖动标记保持到触摸结束派发后，并随视口尺寸重新约束', () => {
    const { hud, mgr } = createHud();
    hud.onLoad(); // 引擎在节点激活时触发一次：棋盘触摸监听在此绑定（规范 7.2）
    hud.initialize();
    hud.mapViewport.emit('start');
    hud.mapViewport.emit('move', { getUIDelta: () => ({ x: 10000, y: 10000 }) });
    assert.equal(hud.dragMoved, true);
    const oldX = hud.mapLayer.position.x;
    hud.mapViewport.transform.width = 1000;
    hud.mapViewport.emit('size');
    assert.ok(hud.mapLayer.position.x < oldX);
    hud.mapViewport.emit('end');
    assert.equal(hud.dragMoved, true);
    for (const callback of hud.scheduled) callback.call(hud);
    assert.equal(hud.dragMoved, false);
});

test('HUD prefab 的直接引用与嵌套组件引用完整且没有旧字段', () => {
    const read = (name: string) => JSON.parse(readFileSync(`assets/resources/ui/game/${name}.prefab`, 'utf8'));
    const data = read('ZCGameHUD');
    const component = data.find((o: any) => o.mapViewport && o.mapLayer && o.artifactButton);
    for (const key of ['statLabel', 'hintLabel', 'artifactLabel', 'resetButton']) assert.ok(!(key in component));
    // ⚠️ `resetButton` 是**旧字段黑名单**里的名字（历史遗留），和 R22 新加的 `resetCameraButton`
    // 是两回事 —— 别因为名字像就被顺手并进黑名单，那样会把真的绑定当成残留删掉。
    assert.ok('resetCameraButton' in component, '★R22 相机：一键复位按钮必须绑上');
    for (const key of ['mapScrollView', 'mapViewport', 'mapLayer', 'mapBackground', 'timeLabel', 'goldLabel', 'artifactButton', 'artifactIcon', 'artifactProgress', 'artifactCountLabel', 'rankButton', 'guideButton', 'damageButton', 'retreatButton', 'resetCameraButton', 'topInfoPanel', 'bottomInfoPanel', 'leftPanel']) {
        const target = data[component[key].__id__];
        assert.ok(target, key);
        if (target.__type__ !== 'cc.Node') assert.ok(target.node && data[target.node.__id__], key);
    }
    const artifactProgressNode = data.find((o: any) => o.__type__ === 'cc.Node' && o._name === 'ArtifactChargeFill');
    const artifactCountNode = data.find((o: any) => o.__type__ === 'cc.Node' && o._name === 'ArtifactCountLabel');
    assert.ok(artifactProgressNode && artifactCountNode, '神器进度与次数节点由 MCP 创建');
    const artifactButtonNode = data[data[component.artifactButton.__id__].node.__id__];
    assert.equal(data[artifactProgressNode._parent.__id__], artifactButtonNode);
    assert.equal(data[artifactCountNode._parent.__id__], artifactButtonNode);
    const baseSprite = data.find((o: any) => o.__type__ === 'cc.Sprite' && data[o.node?.__id__] === artifactButtonNode);
    const progressSprite = data.find((o: any) => o.__type__ === 'cc.Sprite' && data[o.node?.__id__] === artifactProgressNode);
    assert.equal(baseSprite._spriteFrame.__uuid__, '9ef09ba7-9265-485d-96fa-b971d1a5bc39@f9941');
    assert.equal(progressSprite._spriteFrame.__uuid__, '22abdb6f-a24c-49d2-b5e2-6f42047a48a3@f9941');
    assert.equal(progressSprite._type, 3, '充能层必须使用 FILLED Sprite');
    assert.equal(progressSprite._fillType, 2, '充能层必须使用 RADIAL 填充');
    assert.ok(data.some((o: any) => o.__type__ === 'cc.Label' && data[o.node?.__id__] === artifactCountNode));
    // 两方时代的三个嵌套实例（LeftPlayer / RightPlayer / GameVS）已随 HUD 多队伍改造删除，
    // 根节点上的 `targetOverrides` 必须**一起清干净**。
    //
    // ⚠️ 旧断言是「遍历这三个 key，检查条目存在 + source 指向本组件 + targetInfo.localID 能在源 prefab 里找到」
    // —— 这三条对 **`target: null` 的悬空条目**同样成立（source 还在、targetInfo 还在），
    // 所以实例删掉之后它**照样是绿的**（实测：3 条悬空条目溜过去一整轮）。
    // 正确判据是「一条都不该有」。
    const rootInfo = data[data[1]._prefab.__id__];
    const dangling = (rootInfo.targetOverrides ?? []).length;
    assert.equal(
        dangling, 0,
        `★根 PrefabInfo 上不该再有 targetOverrides（实测残留 ${dangling} 条悬空条目：`
        + 'propertyPath 指向的字段在组件上已不存在、target 为 null）',
    );
});

test('ZCGameHUDView 的 25 个引用全部声明为 null! 且不再运行时按名找节点', () => {
    const source = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    // 反例断言先剥注释（规则 104）：类注释里会讲旧实现
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 「多队伍 + 虚拟列表」后：左侧四行不再是四个静态引用，改成**一个** `playerList`（虚拟列表）。
    // 2026-10-16（R22 相机）：+`mapBackground`（背景改为 prefab 绑定、不再按名找）、
    //   +`resetCameraButton`（镜头一键复位）⇒ 23 → 25。
    const refs = ['mapScrollView', 'mapViewport', 'mapLayer', 'mapBackground',
        'scoreLayout', 'scoreSlot1', 'scoreSlot2', 'scoreSlot3', 'scoreSlot4',
        'playerList', 'timeLabel',
        'goldIcon', 'goldLabel', 'artifactButton', 'artifactIcon', 'artifactProgress', 'artifactCountLabel',
        'rankButton', 'guideButton', 'damageButton', 'retreatButton', 'resetCameraButton',
        'topInfoPanel', 'bottomInfoPanel', 'leftPanel'];
    assert.equal(refs.length, 25, '引用清单应与本条用例的标题同步');
    for (const key of refs) {
        assert.match(code, new RegExp(`${key}: [A-Za-z]+ = null!;`), `${key} 应声明为 null!`);
        assert.doesNotMatch(code, new RegExp(`this\\.${key}\\?\\.`), `${key} 是必填引用，不该有 ?.`);
    }
    assert.doesNotMatch(code, /getChildByName\(|getChildByPath\(/, '视图结构由 prefab 承载，不再按名找节点');
    assert.doesNotMatch(code, /private artifactProgress|private artifactCountLabel/, '神器两个子节点已收进 @property');
});

/**
 * 金币栏「钱不够」反馈：`ZCGame.onHexClick` 判定 `reason === 'insufficientGold'` 时调。
 *
 * 判据钉三件事：
 *  1. 图标确实起了一段跳动，且**起止都在静止态**（半路被打断也不会歪在半空）；
 *  2. 幅度就是需求口径 —— 放大缩小（峰值 > 1）+ 轻微 1~2 px 位移；
 *  3. 数字闪红是**跳变**、且偶数拍收尾 ⇒ 一定回到原色，不留一块红字在屏幕上。
 */
test('金币不足：金币图标跳动（1~2px）+ 数字闪红，收尾落回静止态', () => {
    const { hud, tweenRuns, hudModule, mgr } = createHud();
    hud.goldIcon.setPosition(11, 22, 0);
    hud.goldLabel.color = { r: 10, g: 20, b: 30, a: 255 };
    const before = tweenRuns.length;

    hud.flashInsufficientGold();

    // ① 起了一段跳动，收尾两轴同值回到原大小、原位置
    assert.equal(tweenRuns.length, before + 1, '应起一段金币图标跳动');
    const run = tweenRuns[tweenRuns.length - 1];
    assert.ok(run.duration > 0, '跳动得有长度');
    assert.deepEqual(
        [run.endScale.x, run.endScale.y, run.endScale.z],
        [1, 1, 1],
        '最后一帧就落在静止态，收尾必须回到原大小',
    );
    assert.deepEqual(
        [run.endPosition.x, run.endPosition.y, run.endPosition.z],
        [11, 22, 0],
        '收尾必须回到原位置',
    );

    // ② 幅度即需求：「放大缩小」+「轻微 1~2 px」。数值导出给用例读，别把魔法数钉进断言。
    assert.ok(hudModule.ZC_GOLD_DENY_POP_SCALE > 1, '要「放大再缩回」，峰值倍率必须 > 1');
    assert.ok(
        hudModule.ZC_GOLD_DENY_LIFT_PIXELS >= 1 && hudModule.ZC_GOLD_DENY_LIFT_PIXELS <= 2,
        `位移要「轻微 1~2 px」，实际 ${hudModule.ZC_GOLD_DENY_LIFT_PIXELS}`,
    );

    // ③ 第一拍数字就是红的（跳变，不是补间渐变）
    assert.deepEqual(
        [hud.goldLabel.color.r, hud.goldLabel.color.g, hud.goldLabel.color.b],
        [255, 91, 91],
        '第一拍数字应变红',
    );

    // ④ 把剩下的拍子跑完 ⇒ 回到原色
    // （本用例不调 render / initialize，`scheduled` 里只有这一次闪红排下的定时器链。
    //  ⚠️ 必须 `.call(hud)`：引擎侧 `Component.scheduleOnce` 是以**组件**为 receiver 调的，
    //  夹具里裸调会丢 `this`，表现为 `stepGoldLabelDenyFlash` 读私有字段直接崩。）
    let guard = 32;
    while (hud.scheduled.length > 0 && guard-- > 0) hud.scheduled.shift()!.call(hud);
    assert.deepEqual(
        [hud.goldLabel.color.r, hud.goldLabel.color.g, hud.goldLabel.color.b],
        [10, 20, 30],
        '闪完必须回到静止色，不能留一块红字',
    );
});

test('金币不足：连点不叠定时器，也不把图标留在半空', () => {
    const { hud, tweenRuns, mgr } = createHud();
    hud.goldIcon.setPosition(11, 22, 0);

    const before = tweenRuns.length;
    hud.flashInsufficientGold();
    const pending = hud.scheduled.length;
    hud.flashInsufficientGold();
    hud.flashInsufficientGold();

    assert.equal(tweenRuns.length, before + 3, '每次点击各起一段跳动（旧的先 stop，不叠加长度）');
    assert.equal(hud.scheduled.length, pending, '闪红定时器先 unschedule 再重排，连点不会越排越多');
    assert.deepEqual([hud.goldIcon.scale.x, hud.goldIcon.scale.y], [1, 1], '连点后仍是原大小');
    assert.deepEqual([hud.goldIcon.position.x, hud.goldIcon.position.y], [11, 22], '连点后仍停在原位置');
});

/**
 * 🔴 `onDestroy` 里**只能**取消驱动（tween / 定时器），一个子节点都不许碰。
 *
 * 真机栈（2026-10-14 结算页点「确定」→ 退出对局）：
 * `ZCGameHUDView.onDestroy:603 → stopGoldDenyFx:542 → Node.setScale:2559 → Vec3.set:102`
 * ⇒ `Cannot set properties of null (setting 'x')`。
 *
 * 机理：Cocos 销毁节点是**先子节点、再组件**（`Node._onPreDestroyBase` → 子节点
 * `_destroyImmediate` → `Component._onPreDestroy`），所以组件 `onDestroy` 跑的时候
 * `this.goldIcon._lscale` 已经是 **null**。而那个异常会**打断组件销毁循环**
 * ⇒ 引擎随后再销毁一遍 ⇒ 成片 `You are trying to destroy a object twice or more`
 * —— 两条日志是同一个根因。
 *
 * 判据写成**源码切片 + 反注释**（MEMORY 104）：注释里就写着 `stopGoldDenyFx` 这个词
 * （说明「为什么不能用」），连注释一起匹配会永远红。
 * 同类先例：`HangEntryButton._stopShake` 用 `isValid` 守卫、`ActivityProgressBox.stopBreath`
 * 用 `chestButton.isValid` 守卫 —— 都是这个坑，HUD 这次漏了。
 */
test('HUD 销毁期不许碰子节点：onDestroy 只调 cancelGoldDenyFx，禁止 stopGoldDenyFx', () => {
    const src = readFileSync('assets/script/app/zcds/view/ZCGameHUDView.ts', 'utf8');
    const codeOnly = (from: string, to: string): string => {
        const body = src.slice(src.indexOf(from), src.indexOf(to));
        assert.ok(body.length > 0, `切片失败：找不到 ${from} … ${to}`);
        return body
            .split('\n')
            .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//')
                && !line.trim().startsWith('/*'))
            .join('\n');
    };

    const onDestroyBody = codeOnly('protected onDestroy()', 'private updateButtons()');
    assert.ok(!onDestroyBody.includes('this.stopGoldDenyFx()'),
        'onDestroy 不能调 stopGoldDenyFx —— 它会 setScale/setPosition 到已被引擎销毁的子节点上，'
        + `抛 vec3 null 并打断销毁循环（连带 destroy twice）。当前：\n${onDestroyBody}`);
    assert.ok(onDestroyBody.includes('this.cancelGoldDenyFx()'),
        'onDestroy 必须调 cancelGoldDenyFx 收掉 tween 与定时器，否则金币栏的 tween 会漏到下一局');

    // 反方向：cancelGoldDenyFx 自己也不许碰节点（它是销毁期专用分支）。
    // ⚠️ 切片终点要用**带类型标注**的定义串：`resetMapPosition()` 在文件里有调用点（214 行）
    // 早于它的定义（568 行），用裸名字会切出空串。
    const cancelBody = codeOnly('private cancelGoldDenyFx()', 'resetMapPosition(): void');
    for (const forbidden of ['setScale', 'setPosition', 'setRotation', '.color =', '.active =']) {
        assert.ok(!cancelBody.includes(forbidden),
            `cancelGoldDenyFx 里不能出现 ${forbidden}（销毁期子节点已失效，只能取消驱动）`);
    }

    // 但「恢复静止态」的能力不能被删掉：重复初始化仍要走 stopGoldDenyFx（那时节点还活着）。
    const rebuildBody = codeOnly('private stopGoldDenyFx()', 'private cancelGoldDenyFx()');
    assert.ok(rebuildBody.includes('this.goldIcon.setScale(1, 1, 1)'),
        'stopGoldDenyFx 必须保留复位逻辑（重复初始化 / 重置时用，节点还活着）');
});


/**
 * ────────────────────────────── R22「【战斗】相机」相机行为 ──────────────────────────────
 *
 * 需求原文（`v0.1战斗DEMO` 第 22 行，功能/低）：
 *   1. 局内战斗的支持地图缩放（每个地图配置对应的最大和最小倍率
 *   2. 开场动画：进入战场推镜头（展示全地图，推进放大到默认的相机高度
 *   3. 镜头一键复位，回到初始点位，主城位于中心点下方100px
 *   4. 结算拉高镜头看占据格子变化动画
 *
 * 第 2、4 条是既有的 `playMapIntro` / `startSettlementOverview`（另有用例钉住），
 * 这里补的是第 1、3 条：**倍率区间**与**一键复位**。
 */

/** 滚轮事件桩：`getUILocation` 给锚点位置（夹具里视口原点与屏幕中心重合）。 */
function wheelEvent(scrollY: number, x = 0, y = 0) {
    return { getScrollY: () => scrollY, getUILocation: () => ({ x, y }) };
}

/** 触点桩（只需要 `getAllTouches` 里元素的 `getID` / `getUILocation`）。 */
function touchAt(x: number, y: number) {
    return { getID: () => 1, getUILocation: () => ({ x, y }) };
}

/** 双指事件桩：两根触点对称摆在 `±half` 上 ⇒ 中点恒为视口原点、指间距 = 2×half。 */
function pinchEvent(half: number, extra: Record<string, unknown> = {}) {
    return { getAllTouches: () => [touchAt(-half, 0), touchAt(half, 0)], ...extra };
}

test('★镜头一键复位：回到开局初始点位，主城落在视口中心点下方 100px', () => {
    const { hud, view } = createHud();
    hud.onLoad();
    // 主城取**整盘正中那一格**：这样"不设偏移"时镜头就停在 (0,0)，
    // 断言 -100 才是在测那个偏移本身，而不是在测"主城本来就不居中"。
    hud.setMapFocus({
        x: (view.mapToViewX(-500) + view.mapToViewX(500)) / 2,
        y: (view.mapToViewY(-700) + view.mapToViewY(700)) / 2,
    });
    hud.initialize();
    assert.equal(Math.round(hud.mapLayer.position.x), 0);
    assert.equal(Math.round(hud.mapLayer.position.y), -100, '★主城应落在中心点下方 100px（屏幕 y 向上为正）');
    const initial = { x: hud.mapLayer.position.x, y: hud.mapLayer.position.y };

    // 拖走 + 滚轮缩一下，再一键复位。
    hud.mapViewport.emit('start');
    hud.mapViewport.emit('move', { getUIDelta: () => ({ x: 137, y: 89 }) });
    hud.mapViewport.emit('end');
    hud.mapViewport.emit('mouse-wheel', wheelEvent(1));
    assert.notEqual(hud.mapLayer.scale.x, 1, '滚一下应当真的缩放了');
    assert.notDeepEqual({ x: hud.mapLayer.position.x, y: hud.mapLayer.position.y }, initial, '拖动+缩放后不该还在原点');

    hud.resetCamera();
    assert.deepEqual(
        { x: hud.mapLayer.position.x, y: hud.mapLayer.position.y }, initial,
        '★一键复位必须回到开局那一帧的初始点位（同一个公式，不是另算一个）',
    );
    assert.equal(hud.mapLayer.scale.x, 1, '★复位也要把倍率放回默认机位');
});

test('★局内缩放夹在本图倍率区间内：滚轮与双指同一套约束', () => {
    const { hud } = createHud();
    hud.onLoad();
    // 一张"只能小幅缩放"的地图：区间 0.8~0.9，不含默认机位 1。
    hud.setMapZoomRange(0.8, 0.9);
    hud.initialize();
    assert.equal(
        hud.mapLayer.scale.x, 0.9,
        '★默认机位 1 落在区间外 ⇒ 入场收尾应停在 zoomMax，而不是硬停 1（否则开局第一帧就捏不动）',
    );
    for (let i = 0; i < 12; i += 1) hud.mapViewport.emit('mouse-wheel', wheelEvent(1));
    assert.equal(hud.mapLayer.scale.x, 0.9, '放到顶就停在 zoomMax');
    for (let i = 0; i < 24; i += 1) hud.mapViewport.emit('mouse-wheel', wheelEvent(-1));
    assert.equal(hud.mapLayer.scale.x, 0.8, '缩到底就停在 zoomMin');

    // 双指猛张同样只能到 zoomMax（两条输入路径共用一个 clamp）。
    hud.mapViewport.emit('start', pinchEvent(40));
    hud.mapViewport.emit('move', pinchEvent(4000));
    assert.equal(hud.mapLayer.scale.x, 0.9, '★双指猛张也只能到 zoomMax');
});

test('★双指缩放钉住两指中点，且不算棋盘拖动（松手不会被当成点选地块）', () => {
    const { hud } = createHud();
    hud.onLoad();
    hud.initialize();
    // 视口原点处的棋盘坐标 —— 锚点就是两指中点（夹具里 = 视口原点），缩放前后它必须不动。
    const anchorBefore = hud.mapLayer.position.y / hud.mapLayer.scale.y;

    hud.mapViewport.emit('start', pinchEvent(50));
    assert.equal(hud.dragMoved, true, '★双指落下就应标记"已移动"，否则松手会被当成点选地块');
    hud.mapViewport.emit('move', pinchEvent(100)); // 指间距翻倍 ⇒ 目标 ×2，被夹到默认上限 1.2
    assert.equal(hud.mapLayer.scale.x, 1.2, '指间距翻倍应放大（并被夹到默认 zoomMax 1.2）');
    assert.ok(
        Math.abs(hud.mapLayer.position.y / hud.mapLayer.scale.y - anchorBefore) < 1e-6,
        '★锚点处的棋盘坐标必须不动 —— 不钉锚点的缩放会变成"缩放 + 平移"混合，手感是地图被推了一下',
    );

    // 抬掉一根手指：剩下的单指只能拖动，不许再缩放。
    hud.mapViewport.emit('end', { getAllTouches: () => [touchAt(-100, 0)] });
    hud.mapViewport.emit('move', {
        getAllTouches: () => [touchAt(-100, 0)],
        getUIDelta: () => ({ x: 0, y: 0 }),
    });
    assert.equal(hud.mapLayer.scale.x, 1.2, '★只剩一根手指就不该再缩放');
});

test('★一键复位同时收掉结算镜头（否则复位完又被结算拉走）', () => {
    const { hud, model, mgr } = createHud();
    hud.onLoad();
    hud.initialize();
    hud.render(model);
    hud.startSettlementOverview();
    assert.equal(hud.settlementOverviewSettled, true, '夹具的假 tween 是同步落地的');
    hud.resetCamera();
    assert.equal(hud.settlementOverviewSettled, false, '★复位后不该还停在"结算已拉远"的状态上');
    // 也不能还留着"结算镜头正在跑"的忙标记 —— 否则复位后棋盘直接拖不动。
    const before = hud.mapLayer.position.x;
    hud.mapViewport.emit('move', { getUIDelta: () => ({ x: 60, y: 0 }) });
    assert.notEqual(hud.mapLayer.position.x, before, '复位后棋盘必须能拖动（忙标记已清）');
});

test('倍率区间注入顺序颠倒不炸整局（模型层已拦，视图只做就地纠正）', () => {
    const { hud } = createHud();
    hud.setMapZoomRange(1.1, 0.9);
    hud.initialize();
    assert.equal(hud.mapLayer.scale.x, 1, '区间写成 1.1~0.9 时按 0.9~1.1 理解，默认机位 1 仍在区间内');
});

test('没注入倍率区间时走模型层的缺省 0.6/1.2（不写死第二份默认值）', () => {
    const { hud, hudModule } = createHud();
    hud.onLoad();
    hud.initialize();
    for (let i = 0; i < 40; i += 1) hud.mapViewport.emit('mouse-wheel', wheelEvent(1));
    // 缺省上限取自 `ZCMapConfig.ZC_MAP_ZOOM_MAX_DEFAULT`（HUD 侧不重复写 1.2）。
    assert.equal(hud.mapLayer.scale.x, 1.2, '缺省上限应为模型层的 ZC_MAP_ZOOM_MAX_DEFAULT');
    assert.equal(
        hudModule.ZC_MAP_HOME_CENTER_OFFSET_Y, 100,
        '「主城位于中心点下方100px」的偏移量导出给用例读，别把 100 钉进断言里',
    );
});
