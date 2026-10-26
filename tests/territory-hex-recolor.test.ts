import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as model from '../assets/script/app/territory/model/TerritoryHexRecolor';
import {
    TERRITORY_HEX_RECOLOR_IN_FROM_SCALE,
    TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION,
    TERRITORY_HEX_RECOLOR_IN_START,
    TERRITORY_HEX_RECOLOR_OUT_END,
    TERRITORY_HEX_RECOLOR_OUT_SCALE,
    TERRITORY_HEX_RECOLOR_SECONDS,
    TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_RECOLOR_STAGGER_SECONDS,
    territoryHexRecolorBatchSeconds,
    territoryHexRecolorDelays,
    territoryHexRecolorFrame,
} from '../assets/script/app/territory/model/TerritoryHexRecolor';

/**
 * 「关卡通过后地皮换色」判据（2026-10-23 需求，四句话）：
 *   ① 旧地块变小、变透消失 → `outScale` 1 → 0.55 单调、`outOpacity` 1 → 0 单调；
 *   ② 新地块小变大 + 透明度变实 → `inScale` 0.6 → 1、`inOpacity` 0 → 1，且**先铺满再长满**；
 *   ③ 多格轻微时间落差 → `territoryHexRecolorDelays` 按簇心铺开、有间隔、有上限、可复现；
 *   ④ 地块上的建筑保持原地不动 → 视图**不许动格根**（只写两个临时子节点），格根缩放恒 1。
 * 外加「换色 / 翻格 / 生成」三方撞车时的让位顺序（翻格 > 生成 > 换色）。
 */

/** 视图类（`view/TerritoryHexRecolor`）在 vm 里跑：`cc` 换成最小桩，模型用真模块。 */
function viewClass(): any {
    const source = readFileSync('assets/script/app/territory/view/TerritoryHexRecolor.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, {
        exports,
        console,
        require: (name: string) => {
            if (name === 'cc') return ccStub;
            if (name === '../model/TerritoryHexRecolor') return model;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return exports.TerritoryHexRecolor;
}

class StubSprite {
    enabled = true;
    spriteFrame: any = null;
    trim = true;
    sizeMode = 0;
    node: any = null;
    /** `Component.isValid` —— 视图里 `ground?.isValid` 这条守卫依赖它（收口前先判活）。 */
    isValid = true;
}

class StubOpacity {
    opacity = 255;
    isValid = true;
}

class StubNode {
    name: string;
    isValid = true;
    active = true;
    scale = { x: 1, y: 1, z: 1 };
    children: StubNode[] = [];
    private readonly comps = new Map<unknown, any>();

    constructor(name = 'Node') {
        this.name = name;
    }

    setParent(parent: StubNode): void {
        parent.children.push(this);
    }

    getChildByName(name: string): StubNode | null {
        return this.children.find((child) => child.name === name) ?? null;
    }

    addComponent(Type: any): any {
        const component = Type === StubSprite ? new StubSprite() : new Type();
        component.node = this;
        this.comps.set(Type, component);
        return component;
    }

    getComponent(Type: any): any {
        return this.comps.get(Type) ?? null;
    }

    setScale(x: number, y: number, z: number): void {
        this.scale = { x, y, z };
    }

    destroy(): void {
        this.isValid = false;
    }
}

const ccStub = { Node: StubNode, Sprite: StubSprite, UIOpacity: StubOpacity };

/** 一格的替身：格根（地皮 Sprite）+ 两个临时层，与 `createHex` 建出来的结构一致。 */
function fakeHex(): {
    node: StubNode;
    ground: StubSprite;
    oldNode: StubNode;
    oldSprite: StubSprite;
    oldOpacity: StubOpacity;
    newNode: StubNode;
    newSprite: StubSprite;
    newOpacity: StubOpacity;
} {
    const node = new StubNode('Hex_1');
    const ground = node.addComponent(StubSprite);
    const oldNode = new StubNode('RecolorOld');
    oldNode.setParent(node);
    oldNode.active = false;
    const oldSprite = oldNode.addComponent(StubSprite);
    const oldOpacity = oldNode.addComponent(StubOpacity);
    const newNode = new StubNode('RecolorNew');
    newNode.setParent(node);
    newNode.active = false;
    const newSprite = newNode.addComponent(StubSprite);
    const newOpacity = newNode.addComponent(StubOpacity);
    return { node, ground, oldNode, oldSprite, oldOpacity, newNode, newSprite, newOpacity };
}

const LOCKED = { name: 'img_land_02' } as any;
const CLEARED = { name: 'img_land_01' } as any;

// ============================================================
// ① 旧地皮：变小 + 变透
// ============================================================

test('起手是「旧的满尺寸不透明、新的最小全透明」，落位正好反过来（端点精确）', () => {
    const start = territoryHexRecolorFrame(0);
    assert.equal(start.outScale, 1, '第 0 秒旧地皮必须原样（不然会先跳一下）');
    assert.equal(start.outOpacity, 1);
    assert.equal(start.inScale, TERRITORY_HEX_RECOLOR_IN_FROM_SCALE);
    assert.equal(start.inOpacity, 0, '新地皮必须从完全透明起（否则就是硬切）');

    const end = territoryHexRecolorFrame(TERRITORY_HEX_RECOLOR_SECONDS);
    assert.equal(end.outScale, TERRITORY_HEX_RECOLOR_OUT_SCALE);
    assert.equal(end.outOpacity, 0, '旧地皮必须彻底消失');
    assert.equal(end.inScale, 1);
    assert.equal(end.inOpacity, 1);

    assert.deepEqual(territoryHexRecolorFrame(TERRITORY_HEX_RECOLOR_SECONDS + 5), end, '超时停终态');
});

test('旧地皮全程单调：越缩越小、越化越淡', () => {
    const steps = 60;
    let lastScale = 1;
    let lastOpacity = 1;
    for (let index = 0; index <= steps; index += 1) {
        const t = (TERRITORY_HEX_RECOLOR_SECONDS * index) / steps;
        const frame = territoryHexRecolorFrame(t);
        assert.ok(frame.outScale <= lastScale + 1e-9, `缩放在 t=${t} 回弹了`);
        assert.ok(frame.outOpacity <= lastOpacity + 1e-9, `透明度在 t=${t} 回升了`);
        assert.ok(frame.outScale >= TERRITORY_HEX_RECOLOR_OUT_SCALE - 1e-9, '不得缩过头');
        assert.ok(frame.outOpacity >= -1e-9, '透明度不得为负');
        lastScale = frame.outScale;
        lastOpacity = frame.outOpacity;
    }
    assert.equal(lastScale, TERRITORY_HEX_RECOLOR_OUT_SCALE);
    assert.equal(lastOpacity, 0);
});

test('旧地皮在自己的窗口末尾就归零（不是拖到整段结束才消失）', () => {
    const atOutEnd = territoryHexRecolorFrame(TERRITORY_HEX_RECOLOR_SECONDS * TERRITORY_HEX_RECOLOR_OUT_END);
    assert.ok(Math.abs(atOutEnd.outOpacity) < 1e-9, `OUT_END 处透明度应为 0，实测 ${atOutEnd.outOpacity}`);
    assert.ok(Math.abs(atOutEnd.outScale - TERRITORY_HEX_RECOLOR_OUT_SCALE) < 1e-9);
    // 收得不能太早：前 30% 就没了的话，"缩小"这件事根本看不到
    const early = territoryHexRecolorFrame(TERRITORY_HEX_RECOLOR_SECONDS * 0.25);
    assert.ok(early.outOpacity > 0.5, '前 1/4 段旧地皮还应基本不透明');
    assert.ok(early.outScale > 0.6, `前 1/4 段旧地皮还该看得出尺寸（实测 ${early.outScale.toFixed(2)}）`);
});

// ============================================================
// ② 新地皮：小变大 + 变实
// ============================================================

test('新地皮全程单调：越涨越大、越变越实，且**先铺满再长满**', () => {
    const steps = 60;
    let lastScale = TERRITORY_HEX_RECOLOR_IN_FROM_SCALE;
    let lastOpacity = 0;
    let solidAt = -1;
    for (let index = 0; index <= steps; index += 1) {
        const t = (TERRITORY_HEX_RECOLOR_SECONDS * index) / steps;
        const frame = territoryHexRecolorFrame(t);
        assert.ok(frame.inScale >= lastScale - 1e-9, `缩放在 t=${t} 回退`);
        assert.ok(frame.inOpacity >= lastOpacity - 1e-9, `透明度在 t=${t} 回退`);
        assert.ok(frame.inScale <= 1 + 1e-9 && frame.inOpacity <= 1 + 1e-9, `t=${t} 越界`);
        lastScale = frame.inScale;
        lastOpacity = frame.inOpacity;
        if (solidAt < 0 && frame.inOpacity >= 1 - 1e-9 && index / steps > TERRITORY_HEX_RECOLOR_IN_START) {
            solidAt = index / steps;
        }
    }
    assert.ok(solidAt > 0, '必须存在「已铺满」的时刻');
    // 与「生成」同一口径：铺满明显早于结束，剩下一段是"实体继续长大"。
    // 容差 0.02 是**采样分辨率**（60 步覆盖整段，新地皮的窗口只占其中的 70%），不是放宽口径。
    const ownSpan = (solidAt - TERRITORY_HEX_RECOLOR_IN_START) / (1 - TERRITORY_HEX_RECOLOR_IN_START);
    assert.ok(ownSpan <= TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION + 0.02,
        `铺满时刻在自己的窗口里占 ${ownSpan.toFixed(2)}，应不晚于 ${TERRITORY_HEX_RECOLOR_IN_OPACITY_PORTION}`);
    assert.ok(solidAt < 1, '铺满不得拖到整段结束');
});

test('新地皮在 IN_START 之前完全不出现', () => {
    const before = territoryHexRecolorFrame(TERRITORY_HEX_RECOLOR_SECONDS * TERRITORY_HEX_RECOLOR_IN_START - 0.001);
    assert.equal(before.inOpacity, 0, '还没轮到它，必须仍全透明');
    assert.equal(before.inScale, TERRITORY_HEX_RECOLOR_IN_FROM_SCALE, '也别提前长大');
});

test('新旧**交叉**而不是硬切：有一段时间两层都看得见（不留一帧空格）', () => {
    // 完全错开（新地皮等旧地皮归零后才起）会在中间留一帧"格子空了"，一闪就是漏光。
    let overlapped = 0;
    for (let index = 0; index <= 200; index += 1) {
        const t = (TERRITORY_HEX_RECOLOR_SECONDS * index) / 200;
        const frame = territoryHexRecolorFrame(t);
        if (frame.outOpacity > 0.05 && frame.inOpacity > 0.05) overlapped += 1;
    }
    assert.ok(overlapped > 0, '新旧必须有一段同时可见（交叉淡入淡出）');
    // 也不能整段都叠着（那是"两张地皮各淡各的"，看不出换了一张）
    const overlapRatio = overlapped / 201;
    assert.ok(overlapRatio < 0.5, `重叠占比 ${overlapRatio.toFixed(2)} 太多，读不出"旧的退场"`);
    // 重叠区里新地皮必须比旧地皮大一圈，才读得出"从残影里顶出来"
    for (let index = 0; index <= 200; index += 1) {
        const t = (TERRITORY_HEX_RECOLOR_SECONDS * index) / 200;
        const frame = territoryHexRecolorFrame(t);
        if (frame.outOpacity > 0.5) continue;   // 旧地皮还是主体时不必比大小
        assert.ok(frame.inScale >= TERRITORY_HEX_RECOLOR_IN_FROM_SCALE - 1e-9);
    }
});

test('脏数据一律退回起手帧，不抛错也不给出 NaN', () => {
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, -1, undefined as unknown as number]) {
        const frame = territoryHexRecolorFrame(bad);
        assert.equal(frame.outScale, 1, `${String(bad)} 旧地皮应保持原样`);
        assert.equal(frame.outOpacity, 1);
        assert.equal(frame.inOpacity, 0);
        assert.equal(frame.inScale, TERRITORY_HEX_RECOLOR_IN_FROM_SCALE);
    }
    const infinite = territoryHexRecolorFrame(Number.POSITIVE_INFINITY);
    assert.equal(infinite.outOpacity, 0);
    assert.equal(infinite.inScale, 1);
});

// ============================================================
// ③ 多格的先后落差
// ============================================================

test('单格没有延迟；空格返回空表；批量时长 = 上限内延迟 + 单格时长', () => {
    assert.equal(territoryHexRecolorDelays([{ cellId: 7, x: 0, y: 0 }]).get(7), 0);
    assert.equal(territoryHexRecolorDelays([]).size, 0);
    assert.equal(territoryHexRecolorBatchSeconds(0), 0);
    assert.equal(territoryHexRecolorBatchSeconds(1), TERRITORY_HEX_RECOLOR_SECONDS);
    assert.equal(territoryHexRecolorBatchSeconds(3),
        TERRITORY_HEX_RECOLOR_STAGGER_SECONDS * 2 + TERRITORY_HEX_RECOLOR_SECONDS);
});

test('多格从簇心向外铺开，间隔为 STAGGER 且顺序可复现', () => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
        cellId: index,
        x: (index % 3) * 100,
        y: Math.floor(index / 3) * 100,
    }));
    const delays = territoryHexRecolorDelays(cells);
    assert.equal(delays.size, 9);
    assert.equal(delays.get(4), 0, '簇心（正中间）必须第一个换色');
    assert.ok((delays.get(0) ?? 0) > (delays.get(4) ?? 0), '角上的必须晚于簇心');
    const sorted = [...delays.values()].sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[1] - sorted[0] - TERRITORY_HEX_RECOLOR_STAGGER_SECONDS) < 1e-9,
        '第二个出场必须正好晚一个 stagger');
    assert.deepEqual([...territoryHexRecolorDelays(cells)], [...delays], '同一批输入两次结果必须一致');
});

test('等距时按 cellId 兜底排序，结果确定', () => {
    const delays = territoryHexRecolorDelays([
        { cellId: 30, x: 0, y: 0 },
        { cellId: 10, x: 0, y: 0 },
        { cellId: 20, x: 0, y: 0 },
    ]);
    assert.equal(delays.get(10), 0);
    assert.ok((delays.get(20) ?? 0) > (delays.get(10) ?? 0));
    assert.ok((delays.get(30) ?? 0) > (delays.get(20) ?? 0));
});

test('一次十几格也不会拖成卡顿：错峰封顶', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ cellId: index, x: index * 10, y: 0 }));
    const max = Math.max(...territoryHexRecolorDelays(many).values());
    assert.equal(max, TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS, '格子足够多时必须顶到上限');
    assert.equal(territoryHexRecolorBatchSeconds(40),
        TERRITORY_HEX_RECOLOR_STAGGER_MAX_SECONDS + TERRITORY_HEX_RECOLOR_SECONDS);
});

test('负 / 非法的 stagger 按 0 处理，不会倒序进场', () => {
    const cells = [{ cellId: 1, x: 0, y: 0 }, { cellId: 2, x: 10, y: 0 }, { cellId: 3, x: 20, y: 0 }];
    for (const stagger of [-1, Number.NaN]) {
        for (const delay of territoryHexRecolorDelays(cells, stagger).values()) assert.equal(delay, 0);
    }
});

// ============================================================
// 视图：藏格根、逐帧写两个临时层、收口
// ============================================================

test('play 起手就藏起格根地皮（否则满尺寸的新地皮会先闪一帧）', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const hex = fakeHex();
    assert.equal(recolor.play(hex.node, LOCKED, CLEARED, 0), true);
    assert.equal(hex.ground.enabled, false, '格根地皮必须立刻藏起来');
    // 旧的满尺寸不透明、新的最小全透明
    assert.equal(hex.oldNode.active, true);
    assert.equal(hex.oldSprite.spriteFrame, LOCKED, '旧层必须是换色前那张图');
    assert.equal(hex.oldNode.scale.x, 1);
    assert.equal(hex.oldOpacity.opacity, 255);
    assert.equal(hex.newSprite.spriteFrame, CLEARED);
    assert.equal(hex.newNode.scale.x, TERRITORY_HEX_RECOLOR_IN_FROM_SCALE);
    assert.equal(hex.newOpacity.opacity, 0, '新层必须从全透明起');
});

test('缺帧 / 缺临时节点 ⇒ 不播（静默降级成「直接换色」，不抛错）', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const hex = fakeHex();
    assert.equal(recolor.play(hex.node, null, CLEARED), false);
    assert.equal(recolor.play(hex.node, LOCKED, null), false);
    const bare = new StubNode('Hex_bare');
    bare.addComponent(StubSprite);
    assert.equal(recolor.play(bare, LOCKED, CLEARED), false);
    assert.equal(recolor.playingCount, 0);
});

test('延迟期内不动，跨过后旧的在缩、新的在长；到时长收口', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const hex = fakeHex();
    recolor.play(hex.node, LOCKED, CLEARED, 0.1);

    recolor.step(0.05);
    assert.equal(hex.oldOpacity.opacity, 255, '还没轮到它，旧地皮必须保持原样');
    assert.equal(hex.oldNode.scale.x, 1);
    assert.equal(hex.newOpacity.opacity, 0);

    // 累计 0.15 ⇒ 延迟 0.1 已过，正片走了 0.05s（= 整段的 14%）：旧地皮先动，新地皮还在等（IN_START=0.3）
    recolor.step(0.10);
    assert.ok(hex.oldOpacity.opacity < 255, '旧地皮该开始变淡了');
    assert.ok(hex.oldNode.scale.x < 1, '旧地皮该开始缩小了');
    assert.equal(hex.newOpacity.opacity, 0, '新地皮要等 IN_START 之后才出现');

    // 再走 0.1s ⇒ 正片 0.15s（整段的 42%）⇒ 新旧都在动
    recolor.step(0.10);
    assert.ok(hex.newOpacity.opacity > 0, '新地皮该开始变实了');
    assert.ok(hex.newNode.scale.x > TERRITORY_HEX_RECOLOR_IN_FROM_SCALE, '新地皮该开始长大了');
    assert.ok(recolor.isPlaying(hex.node));

    recolor.step(1);
    assert.equal(recolor.isPlaying(hex.node), false, '播完必须出列');
    // 收口三件事：格根地皮还回来（且是新帧）、两个临时层收起、缩放与透明度复位
    assert.equal(hex.ground.enabled, true, '格根地皮必须还回来，否则这一格永久空白');
    assert.equal(hex.ground.spriteFrame, CLEARED);
    assert.equal(hex.oldNode.active, false);
    assert.equal(hex.newNode.active, false);
    assert.equal(hex.oldNode.scale.x, 1);
    assert.equal(hex.newNode.scale.x, 1);
    assert.equal(hex.oldOpacity.opacity, 255);
    assert.equal(hex.newOpacity.opacity, 255);
});

test('stop / reset 立刻收口（翻格接管与换章重建都走这条路）', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const a = fakeHex();
    const b = fakeHex();
    recolor.play(a.node, LOCKED, CLEARED, 0);
    recolor.play(b.node, LOCKED, CLEARED, 0);
    recolor.step(0.05);
    assert.equal(recolor.playingCount, 2);

    recolor.stop(a.node);
    assert.equal(recolor.isPlaying(a.node), false);
    assert.equal(a.ground.enabled, true, '被掐掉也要把格根地皮还回来');
    assert.equal(a.ground.spriteFrame, CLEARED, '被掐掉时格根可能还停在旧帧，必须写回新的');
    assert.equal(recolor.playingCount, 1);

    recolor.reset();
    assert.equal(recolor.playingCount, 0);
    assert.equal(b.ground.enabled, true);
});

test('格节点被销毁（换章 / 关页）⇒ 自动出列，不往死节点上写', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const hex = fakeHex();
    recolor.play(hex.node, LOCKED, CLEARED, 0);
    hex.node.isValid = false;
    assert.equal(recolor.step(0.02), false);
    assert.equal(recolor.playingCount, 0);
});

test('hideGround 幂等（每秒一次的重绘后要把格根再藏回去）', () => {
    const Recolor = viewClass();
    const recolor = new Recolor();
    const hex = fakeHex();
    recolor.play(hex.node, LOCKED, CLEARED, 0);
    hex.ground.enabled = true;      // 模拟 `paintHexes` 里的 `applyTileFrame` 把它打开了
    recolor.hideGround(hex.node);
    assert.equal(hex.ground.enabled, false);
    recolor.hideGround(hex.node);   // 再调一次不该报错 / 不该翻转
    assert.equal(hex.ground.enabled, false);
});

// ============================================================
// ④ 接线：建筑不动（格根缩放恒 1）+ 三方让位顺序
// ============================================================

test('视图只写两个临时子节点，**不许动格根**（建筑原地不动靠的就是这条）', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryHexRecolor.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 缩放的写口只有 `applyLayer` / `hideLayer` —— 它们收到的都是临时层的节点
    assert.doesNotMatch(body, /active\.node\.setScale/, '格根缩放必须是 1，推镜/缩放只许写在临时层上');
    assert.doesNotMatch(body, /this\.node\.setScale/, '本类没有"格根"这个字段');
    // 格根地皮在播期间必须被藏起来（否则满尺寸的新地皮垫在下面，读不出"从小的长起来"）
    assert.match(body, /ground\.enabled = false/, '播期间要藏格根地皮');
    assert.match(body, /ground\.enabled = true/, '收口要还回来');
});

test('地图接线：建节点、判定、推进、换章复位、与翻格让位', () => {
    const src = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // ① createHex 建两个临时层，且 `RecolorOld` 必须排在 `RecolorNew` 之后（画在上面）
    const newAt = body.indexOf('TERRITORY_HEX_RECOLOR_NEW_NODE)');
    const oldAt = body.indexOf('TERRITORY_HEX_RECOLOR_OLD_NODE)');
    assert.ok(newAt > 0 && oldAt > 0, 'createHex 必须建出 RecolorNew / RecolorOld 两个节点');
    assert.ok(oldAt > newAt, 'RecolorOld 必须排在 RecolorNew 之后（子节点顺序 = 渲染序）');
    // ② 判定：帧→帧真变化 + 上一帧就可见 + 让开翻格/生成
    assert.match(body, /this\.recolorBootstrapped/, '首帧必须只做快照');
    assert.match(body, /ground\.spriteFrame !== nextFrame/, '判据是地皮帧真的变了');
    assert.match(body, /this\.revealedSnapshot\.has\(cellId\)/, '新露出的格子归「生成动画」，不算换色');
    assert.match(body, /!this\.hexFlip\.isPlaying\(node\)/, '正在翻格的格子让给翻格');
    assert.match(body, /!this\.hexSpawn\.isPlaying\(node\)/, '正在生成的格子让给生成');
    // ③ 重绘后同帧再藏一次格根（不然每秒一次的重绘会闪一帧满尺寸新地皮）
    assert.match(body, /if \(this\.hexRecolor\.isPlaying\(node\)\) this\.hexRecolor\.hideGround\(node\)/,
        'paintHexes 写完帧要把格根再藏回去');
    // ④ 逐帧推进 + 换章复位 + 翻格接管
    assert.match(body, /this\.hexRecolor\.step\(dt\)/, 'update 里要推进');
    assert.match(body, /this\.hexRecolor\.reset\(\)/, '换章 / 布局重建要复位');
    assert.match(body, /this\.hexRecolor\.stop\(node\)/, '翻格起播时要把同格的换色掐掉');
});
