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

    schedule(callback: () => void): void {
        this.scheduled.add(callback);
    }

    unschedule(callback: () => void): void {
        this.scheduled.delete(callback);
    }

    runScheduled(): void {
        for (const callback of Array.from(this.scheduled)) callback();
    }

    get scheduledCount(): number {
        return this.scheduled.size;
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
    // 反过来的漏项：顶栏 / 底栏 / 地图这三块必须都在，否则「各模块平滑进入」名不副实。
    for (const required of ['MapRoot', 'TopHud', 'BottomHud']) {
        assert.ok(planned.includes(required), `节奏表缺少 ${required}`);
    }
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
    assert.equal(byName.get('MapRoot')!.scaleFrom, 1, '地图本体不叠页面级缩放（会和相机推拉打架）');
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

// ---------------------------------------------------------------- 3. 接线

test('接线：由地图首帧就绪触发，而不是 onLoad', () => {
    const page = readFileSync('assets/script/app/main/MainPage.ts', 'utf8');
    assert.match(page, /EventMgr\.instance\.on\(VIEW_LIFECYCLE, this\.onViewLifecycle, this\)/, '必须订阅页面生命周期');
    assert.match(page, /event\.phase !== 'presented'/, '只接 presented');
    assert.match(page, /event\.owner !== this\.territoryMap/, '只认本章节地图实例');
    assert.match(page, /playMainHudIntro\(this\.node\)/, '就绪即播各模块入场');

    // `onLoad` 里不许直接起播：登录首屏时本页在登录图底下预挂载，那时演完等于白演。
    const onLoad = page.slice(page.indexOf('onLoad(): void {'), page.indexOf('start(): void {'));
    assert.doesNotMatch(onLoad, /playMainHudIntro/, 'onLoad 不许起播（会被登录图 / 加载态盖住）');
});
