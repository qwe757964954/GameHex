/**
 * 章节地图（主城 / 领地页）模块入场单测
 * ------------------------------------------------------------------
 * 需求（2026-11-18）③：*回到【章节地图】各模块的 UI 平滑进入*。
 *
 * 钉住四件事：
 *   1. **节奏表**：必须是 `ArenaRoot.prefab` 上的真实直接子节点名（改名会红），
 *      延迟递增、顶栏从上落下 / 底栏从下浮起；
 *   2. **进度公式**：各模块同帧推进、不同时刻收尾，边界不抛；
 *   3. **播放器行为**：起播当帧就写起始帧、走完逐项复位（绝不留半透明 HUD）、
 *      被打断（切 tab / 进战斗）同样复位；
 *   4. **接线**：由地图首帧就绪（`VIEW_LIFECYCLE presented`）触发，而不是 `onLoad`。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as UIMotion from '../assets/script/framework/ui/UIMotion';
import {
    MAIN_HUD_INTRO_PLAN,
    mainHudIntroProgress,
    mainHudIntroTotalSeconds,
} from '../assets/script/app/main/MainHudMotion';
import { assetPath } from './helpers/asset-paths';

// ---------------------------------------------------------------- 模块加载

function resolveSpecifier(fromFile: string, specifier: string): string {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
    const resolved = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
    return resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;
}

/** 可控时钟：`Date.now()` 由用例推进。 */
let clockMs = 0;

function loadModule(path: string, dependencies: Record<string, unknown>): any {
    const context = {
        exports: {} as any,
        console,
        Date: { now: () => clockMs },
        require: (name: string) => {
            if (name.endsWith('/UIMotion')) return UIMotion;
            const key = resolveSpecifier(path, name);
            assert.ok(key in dependencies, `${path} 引用了未提供的依赖：${name}（解析为 ${key}）`);
            return dependencies[key];
        },
    };
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            experimentalDecorators: true,
        },
    }).outputText;
    runInNewContext(output, context);
    return context.exports;
}

const classDecorator = () => (value: unknown) => value;
const propertyDecorator = () => () => {};

// ---------------------------------------------------------------- 假 cc 夹具

class Vec3 {
    constructor(public x = 0, public y = 0, public z = 0) {}
    set(x: number, y: number, z = 0): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }
}

class FakeUIOpacity {
    isValid = true;
    opacity = 255;
    node: FakeNode | null = null;
}

class FakeNode {
    isValid = true;
    activeInHierarchy = true;
    layer = 1;
    name = '';
    children: FakeNode[] = [];
    parent: FakeNode | null = null;
    position = new Vec3();
    scale = new Vec3(1, 1, 1);
    private components: any[] = [];

    constructor(name = '') {
        this.name = name;
    }

    attach(component: any): void {
        component.node = this;
        this.components.push(component);
    }

    getComponent<T>(cls: new (...args: any[]) => T): T | null {
        return this.components.find((component) => component instanceof cls) ?? null;
    }

    addComponent<T>(cls: new () => T): T {
        const component = new cls();
        this.attach(component);
        return component;
    }

    getChildByName(target: string): FakeNode | null {
        return this.children.find((child) => child.name === target) ?? null;
    }

    addChild(child: FakeNode): void {
        child.parent = this;
        this.children.push(child);
    }

    setScale(x: number | Vec3, y?: number, z = 1): void {
        if (x instanceof Vec3) {
            this.scale.set(x.x, x.y, x.z);
            return;
        }
        this.scale.set(x, y ?? x, z);
    }

    setPosition(x: number | Vec3, y = 0, z = 0): void {
        if (x instanceof Vec3) {
            this.position.set(x.x, x.y, x.z);
            return;
        }
        this.position.set(x, y, z);
    }

    destroy(): void {
        this.isValid = false;
    }
}

class FakeComponent {
    node!: FakeNode;
    isValid = true;
    private readonly scheduled = new Set<() => void>();
    private readonly once = new Set<() => void>();

    schedule(callback: () => void): void {
        this.scheduled.add(callback);
    }

    /** 兜底计时（`prepare` 用）；与逐帧调度分开记，用例可以单独触发。 */
    scheduleOnce(callback: () => void): void {
        this.once.add(callback);
    }

    unschedule(callback: () => void): void {
        this.scheduled.delete(callback);
        this.once.delete(callback);
    }

    runScheduled(): void {
        for (const callback of Array.from(this.scheduled)) callback();
    }

    /** 触发兜底计时（模拟"等太久了"）。 */
    runOnce(): void {
        for (const callback of Array.from(this.once)) {
            this.once.delete(callback);
            callback();
        }
    }

    get scheduledCount(): number {
        return this.scheduled.size;
    }

    get onceCount(): number {
        return this.once.size;
    }
}

function loadIntro(): any {
    return loadModule('assets/script/app/main/MainHudIntro.ts', {
        cc: {
            _decorator: { ccclass: classDecorator, property: propertyDecorator },
            Component: FakeComponent,
            Node: FakeNode,
            UIOpacity: FakeUIOpacity,
            Vec3,
        },
        'assets/script/app/main/MainHudMotion.ts': { MAIN_HUD_INTRO_PLAN, mainHudIntroProgress, mainHudIntroTotalSeconds },
    });
}

/** 按 `ArenaRoot` 的真实结构造一个页面根节点（模块都挂在根下）。 */
function buildRoot(withChestBar = false): { root: FakeNode; modules: Map<string, FakeNode> } {
    const root = new FakeNode('ArenaRoot');
    const modules = new Map<string, FakeNode>();
    for (const item of MAIN_HUD_INTRO_PLAN) {
        const node = new FakeNode(item.name);
        if (item.name === 'TopHud') node.setPosition(0, 400, 0);
        if (item.name === 'ChestBar' && !withChestBar) node.activeInHierarchy = false;
        root.addChild(node);
        modules.set(item.name, node);
    }
    return { root, modules };
}

// ---------------------------------------------------------------- 1. 节奏表

test('入场节奏表：模块名必须是 ArenaRoot 的真实直接子节点', () => {
    const prefab = JSON.parse(readFileSync(assetPath('ui/main/ArenaRoot.prefab'), 'utf8')) as Array<Record<string, any>>;
    const childIds = new Set<number>();
    for (const entry of prefab) {
        if (entry.__type__ !== 'cc.Node') continue;
        for (const child of (entry._children as Array<{ __id__: number }> | undefined) ?? []) childIds.add(child.__id__);
    }
    const rootIndex = prefab.findIndex((entry, index) => entry.__type__ === 'cc.Node' && !childIds.has(index));
    assert.ok(rootIndex >= 0, 'ArenaRoot.prefab 必须有一个根节点');
    const names = ((prefab[rootIndex]._children as Array<{ __id__: number }>) ?? [])
        .map((child) => prefab[child.__id__]._name as string);
    assert.ok(names.length > 0);

    const planned = MAIN_HUD_INTRO_PLAN.map((item) => item.name);
    assert.equal(new Set(planned).size, planned.length, '节奏表不许出现重名模块');
    for (const name of planned) {
        assert.ok(names.includes(name), `节奏表里的 ${name} 不在 ArenaRoot 的直接子节点里（改名了？）`);
    }
    // 顶栏 / 底栏这两块必须在，否则「各模块平滑进入」名不副实。
    for (const required of ['TopHud', 'BottomHud']) {
        assert.ok(planned.includes(required), `节奏表缺少 ${required}`);
    }
    // 🔴 `MapRoot` **不许**进节奏表：它是这一页的底图，加载期间必须一直在位。
    // 给它做位移 / 淡入就等于「等地图就绪了再把整屏推开」= 用户 2026-11-23 说的
    // 「出现一个空场景…画面会显得跳一下」。
    assert.ok(!planned.includes('MapRoot'), '节奏表不许再动 MapRoot（底图必须一到就在）');
});

test('入场节奏表：延迟递增，顶栏从上落下、底栏从下浮起', () => {
    let previousDelay = -1;
    for (const item of MAIN_HUD_INTRO_PLAN) {
        assert.ok(item.delay > previousDelay, `${item.name} 的延迟必须比前一个更大（同时起播就没有层次）`);
        previousDelay = item.delay;
        assert.ok(item.seconds > 0, `${item.name} 必须有正的时长`);
        assert.ok(item.scaleFrom > 0 && item.scaleFrom <= 1, `${item.name} 的起始缩放落在 (0, 1]`);
    }

    const byName = new Map(MAIN_HUD_INTRO_PLAN.map((item) => [item.name, item]));
    assert.ok(byName.get('TopHud')!.offsetY > 0, '顶栏从上往下落');
    assert.ok(byName.get('BottomHud')!.offsetY < 0, '底栏从下往上升');
});

test('入场进度：按各自的 delay / 时长推进，边界不抛', () => {
    assert.equal(mainHudIntroProgress(0.2, 0.4, 0), 0, '还没到自己的延迟');
    assert.equal(mainHudIntroProgress(0.2, 0.4, 0.2), 0, '刚到延迟那一刻是起点');
    assert.equal(mainHudIntroProgress(0.2, 0.4, 0.4), 0.5, '过半时长就是半程');
    assert.equal(mainHudIntroProgress(0.2, 0.4, 5), 1, '超过就停在终点');
    assert.equal(mainHudIntroProgress(0.2, 0, 5), 1, '零时长视为已经到位');
    assert.equal(mainHudIntroProgress(Number.NaN, 0.4, 0.5), 1, '脏延迟直接落终点（宁可不动，也不要卡住）');

    const total = mainHudIntroTotalSeconds();
    assert.ok(total > 0);
    assert.equal(total, Math.max(...MAIN_HUD_INTRO_PLAN.map((item) => item.delay + item.seconds)));
});

// ---------------------------------------------------------------- 2. 播放器

test('入场播放：起播当帧落起始态，走完逐项复位并停调度', () => {
    const { playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    assert.equal(playMainHudIntro(root), true);
    const topHud = modules.get('TopHud')!;
    const opacity = topHud.getComponent(FakeUIOpacity)!;
    assert.equal(opacity.opacity, 0, '起播当帧顶栏就该是透明的');
    assert.equal(topHud.position.y, 440, '起播当帧应当在上方 40px 处');

    const player = root.getComponent(MainHudIntroPlayer)!;
    clockMs += mainHudIntroTotalSeconds() * 1000;
    player.runScheduled();
    assert.equal(opacity.opacity, 255, '走完必须完全不透明');
    assert.equal(topHud.position.y, 400, '走完必须回到原始位置');
    assert.equal(topHud.scale.x, 1);
    assert.equal(player.scheduledCount, 0, '落位即停调度');
});

test('入场播放：收起的模块跳过，不影响别人的透明度', () => {
    const { playMainHudIntro } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 3_000;
    assert.equal(playMainHudIntro(root), true);
    const chestBar = modules.get('ChestBar')!;
    assert.equal(chestBar.getComponent(FakeUIOpacity), null, '收起的模块不该被挂上 UIOpacity');
});

test('入场播放：被打断（切 tab / 进战斗）也要复位，不留半透明 HUD', () => {
    const { playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 5_000;
    playMainHudIntro(root);
    const topHud = modules.get('TopHud')!;
    const player = root.getComponent(MainHudIntroPlayer)!;
    clockMs += 60;
    player.runScheduled();
    assert.ok(topHud.getComponent(FakeUIOpacity)!.opacity < 255, '中途确实是半透明');

    player.onDisable();
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 255, '打断必须立刻恢复不透明');
    assert.equal(topHud.position.y, 400, '打断必须把位置写回原位');
    assert.equal(player.scheduledCount, 0);
});

test('入场播放：页面里没有这些模块时安静返回 false', () => {
    const { playMainHudIntro } = loadIntro();
    const empty = new FakeNode('ArenaRoot');
    assert.equal(playMainHudIntro(empty), false);
    assert.equal(playMainHudIntro(null), false);
});

// ------------------------------------------------- 2b. 挂载先摆位、就绪只起表

test('入场预备：挂载当场就摆好起始姿态，但**不**开始播放（地图还没就绪）', () => {
    const { prepareMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    assert.equal(prepareMainHudIntro(root), true);
    const topHud = modules.get('TopHud')!;
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 0, '挂载时就要把顶栏藏好');
    assert.equal(topHud.position.y, 440, '挂载时就停在起始姿态（上方 40px）');

    const player = root.getComponent(MainHudIntroPlayer)!;
    assert.equal(player.scheduledCount, 0, '还没到就绪时刻，不许起表');
    assert.equal(player.onceCount, 1, '挂载时必须留一个"等太久就算了"的兜底计时');
});

test('入场预备 → 就绪起表：基准沿用挂载时抓的，走完回到**真正的原位**', () => {
    const { prepareMainHudIntro, playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 2_000;

    prepareMainHudIntro(root);
    const topHud = modules.get('TopHud')!;
    const player = root.getComponent(MainHudIntroPlayer)!;

    // 地图两三秒后才就绪：这段时间页面一直显示着（HUD 在起始姿态，玩家看不见）
    clockMs = 4_000;
    assert.equal(playMainHudIntro(root), true, '就绪即起表');
    assert.equal(player.onceCount, 0, '起表了就不需要兜底计时了');

    clockMs += mainHudIntroTotalSeconds() * 1000;
    player.runScheduled();
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 255);
    // 🔴 这一条就是"跳一下"的根：起表时**重抓一次基准**的话，基准会变成 440（起始姿态），
    //    走完就停在 440 —— 顶栏整块比原位置高 40px。
    assert.equal(topHud.position.y, 400, '必须回到挂载时抓的原位，不许把起始姿态当成原位');
    assert.equal(topHud.scale.x, 1);
});

test('入场预备：地图一直不就绪 ⇒ 到点把 HUD 放出来，并放弃这一轮动画', () => {
    const { prepareMainHudIntro, playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    prepareMainHudIntro(root);
    const topHud = modules.get('TopHud')!;
    const player = root.getComponent(MainHudIntroPlayer)!;
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 0);

    // 兜底时间到（地图数据失败 / 没有地图宿主）
    player.runOnce();
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 255, '宁可没有动画，也不能让玩家对着没有 HUD 的页面');
    assert.equal(topHud.position.y, 400, '放出来时必须回到原位');
    assert.equal(player.scheduledCount, 0);

    // 迟到的 `presented`：不许再摆一次（那正是"跳一下"）
    assert.equal(playMainHudIntro(root), false, '已经放出来了就不要再播');
    assert.equal(topHud.position.y, 400);
});

test('入场播放只播一次：重复的 presented 不许把 HUD 再推开一次', () => {
    const { playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    playMainHudIntro(root);
    const player = root.getComponent(MainHudIntroPlayer)!;
    clockMs += mainHudIntroTotalSeconds() * 1000;
    player.runScheduled();
    const topHud = modules.get('TopHud')!;
    assert.equal(topHud.position.y, 400);

    assert.equal(playMainHudIntro(root), false, '播完了再收到 presented 不许重播');
    assert.equal(topHud.position.y, 400, '重播会把顶栏再推到 440 —— 那就是跳一下');
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 255);
});

test('入场预备：`presented` 抢在 `start()` 前面到时，预备不许再摆位（顺序反了也不跳）', () => {
    const { prepareMainHudIntro, playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    // 章节数据在内存里 / 命中缓存 ⇒ 首帧就绪可能早于页面的 `start()`
    assert.equal(playMainHudIntro(root), true);
    const player = root.getComponent(MainHudIntroPlayer)!;
    clockMs += mainHudIntroTotalSeconds() * 1000;
    player.runScheduled();

    const topHud = modules.get('TopHud')!;
    assert.equal(prepareMainHudIntro(root), false, '入场已经了结过，不许再预备一次');
    assert.equal(topHud.getComponent(FakeUIOpacity)!.opacity, 255, 'HUD 不许被重新藏起来');
    assert.equal(topHud.position.y, 400);
    assert.equal(player.onceCount, 0, '也不该挂兜底计时');
});

test('入场预备：挂载时还没亮出来的模块（门禁未过）在起表时补进来，起手就落到起始姿态', () => {
    const { prepareMainHudIntro, playMainHudIntro, MainHudIntroPlayer } = loadIntro();
    const { root, modules } = buildRoot();
    clockMs = 1_000;

    // 快速寻敌（BeginGame）在 `onLoad` 里先被压住，门禁过了才亮 —— 挂载时它是收起的
    const begin = modules.get('BeginGame')!;
    begin.activeInHierarchy = false;
    prepareMainHudIntro(root);
    assert.equal(begin.getComponent(FakeUIOpacity), null, '挂载时收起的模块不碰它');

    // 门禁过了：此刻的位置就是基准
    begin.activeInHierarchy = true;
    begin.setPosition(0, -345, 0);
    assert.equal(playMainHudIntro(root), true);
    assert.equal(begin.getComponent(FakeUIOpacity)!.opacity, 0, '补进来的模块要立刻藏住，否则会先闪一帧');
    assert.equal(begin.scale.x, 0.8, '并按自己的起始缩放落位');

    const player = root.getComponent(MainHudIntroPlayer)!;
    clockMs += mainHudIntroTotalSeconds() * 1000;
    player.runScheduled();
    assert.equal(begin.getComponent(FakeUIOpacity)!.opacity, 255);
    assert.equal(begin.scale.x, 1);
    assert.equal(begin.position.y, -345, '回到它自己亮出来那一刻的位置');
});

// ---------------------------------------------------------------- 3. 接线

test('接线：由地图首帧就绪触发，而不是 onLoad', () => {
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.match(page, /EventMgr\.instance\.on\(VIEW_LIFECYCLE, this\.onViewLifecycle, this\)/, '必须订阅页面生命周期');
    assert.match(page, /event\.phase !== 'presented'/, '只接 presented');
    assert.match(page, /source !== this\.territoryMap/, '只认本章节地图实例');
    assert.match(page, /playMainHudIntro\(this\.node\)/, '就绪即播各模块入场');

    // `onLoad` 里不许直接起播：登录首屏时本页在登录图底下预挂载，那时演完等于白演。
    const onLoad = page.slice(page.indexOf('onLoad(): void {'), page.indexOf('start(): void {'));
    assert.doesNotMatch(onLoad, /playMainHudIntro/, 'onLoad 不许起播（会被登录图 / 加载态盖住）');
});

test('接线：有地图宿主时 `start()` 先摆位，等 presented 才起表', () => {
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    const start = page.slice(page.indexOf('start(): void {'), page.indexOf('onEnable(): void {'));
    // 2026-11-23 用户：「出现一个空场景，再加载了按钮，但是按钮的位置和空场景按钮的位置偏差，
    // 画面会显得跳一下」。根因是起播点（地图首帧就绪）远晚于页面显示 —— 到那一刻才摆起始姿态，
    // 等于把已经静止的 HUD 一把推开。所以挂载时就得先摆。
    assert.match(start, /if \(this\.hasTerritoryMap\) prepareMainHudIntro\(this\.node\);/,
        '有地图宿主 ⇒ 挂载时先摆成未入场姿态');
    assert.match(start, /else playMainHudIntro\(this\.node\);/,
        '没有地图宿主（测试桩 / 预览）没人发 presented ⇒ 当场播完');
});

