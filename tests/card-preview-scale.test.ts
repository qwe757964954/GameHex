/**
 * 阵容页 / 布阵页「兵种预览」吃 `pvpCard.prefabSize` 的三层守卫。
 *
 * 背景：站台预览原本把每个兵种都归一到同一个可见高度，于是「这张卡的兵本来就比别的大」
 * 被抹平了 —— 爆锤莲王和魔术师并排一样高，跟对局里的体型对不上。修法是**归一之后**
 * 再乘一次 `prefabSize`（与 `ZCUnitView.applyVisualSize` 同一个系数、同一张表）。
 *
 * 为什么值得单独一个文件：这条链每一层断了都**不报错** ——
 *  ① `parseCard` 漏了这一列 ⇒ 阵容页永远拿到 `undefined` ⇒ 全部按 1 画；
 *  ② `CardUnitPreview` 把系数乘在归一**之前** ⇒ 画布大的兵反而更小（策划写 1.5 得到反向结果）；
 *  ③ 复用分支（同一份 prefab 换一张卡）忘了重写缩放 ⇒ 第二张卡带着第一张的尺寸。
 * 三种都只表现为「看着有点不对」，没有人眼对比根本发现不了。所以：
 *
 *  - A：`cardPreviewFactor` 纯函数（顺序、非法值兜底）；
 *  - B：真 `CardUnitPreview` 源码跑在假 `cc` 上，读**节点上实际的 scale/position**；
 *  - C：真表 —— 每一行的 `prefabSize` 都如实进到 `ZCDeckCard`，且这次调的两个值没被回滚。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { cardPreviewFactor, FRAME_FOOT_FROM_CENTER_Y } from '../assets/script/app/card/CardPreviewScale';
import { parseCardCatalogRow } from '../assets/script/app/zcds/model/ZCPvpTableParser';

// ==================== A. 纯函数 ====================

/** 爆锤莲王那份骨架的 canvas 高（prefab `UITransform` 941），站台 120、宿主缩放 1。 */
const LILY = { height: 120, canvas: 941, ratio: 0.97, host: 1 };

test('A1 归一之后再乘体型：比值就是 prefabSize 本身', () => {
    const normal = cardPreviewFactor(LILY.height, 1, LILY.canvas, LILY.ratio, LILY.host);
    for (const size of [1.5, 1.2, 0.85, 0.8]) {
        const scaled = cardPreviewFactor(LILY.height, size, LILY.canvas, LILY.ratio, LILY.host);
        assert.ok(Math.abs(scaled / normal - size) < 1e-9,
            `prefabSize=${size} 的相对体型应为 ${size}，实际 ${scaled / normal}`);
    }
    // 归一本身没被破坏：canvas 越大，压得越小
    assert.ok(Math.abs(normal - LILY.height / (LILY.canvas * LILY.ratio)) < 1e-9);
});

test('A2 顺序不能反：先归一再乘体型 ≠ 先乘体型再归一（会得到反向结论）', () => {
    // 反序等价于把 canvas 高也乘上系数 —— 画布大的兵会「表里写 1.5、屏幕上更小」。
    const correct = cardPreviewFactor(120, 1.5, 941, 0.97, 1);
    const reversed = cardPreviewFactor(120, 1, 941 * 1.5, 0.97, 1);
    assert.ok(Math.abs(correct - reversed * 2.25) < 1e-9, '反序会把系数平方着抵消掉');
});

test('A3 非法值兜成 1（缩放 0 会让模型凭空消失，且控制台干干净净）', () => {
    const base = cardPreviewFactor(120, 1, 941, 0.97, 1);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined as unknown as number, null as unknown as number]) {
        assert.equal(cardPreviewFactor(120, bad, 941, 0.97, 1), base, `prefabSize=${String(bad)} 应兜成 1`);
    }
    // 源尺寸退化（0 / 负数）不能除出 Infinity
    assert.ok(Number.isFinite(cardPreviewFactor(120, 1, 0, 0, 1)));
    // 宿主缩放在分母：宿主放大几倍，模型就得缩几倍才能保持屏幕尺寸
    assert.ok(Math.abs(cardPreviewFactor(120, 1, 941, 0.97, 2) - base / 2) < 1e-9);
});

// ==================== B. 真组件（假 cc） ====================

/**
 * 把真实 `CardUnitPreview` 源码跑起来：只替换 `cc`（节点/组件/`instantiate`），
 * `./CardPreviewScale` 用本文件顶部 import 的**真模块** —— 这样验的是「组件有没有把
 * 系数写进节点」，而不是又测一遍纯函数。
 *
 * 同时把假的 `Skeleton` / `Animation` 类暴露出来，让下面的 prefab 桩能造出
 * `instanceof` 为真的组件（组件里是用 `getComponent(sp.Skeleton)` 判美术形态的）。
 */
function loadPreviewClass(): {
    Preview: new (hero: any, visibleHeight: number) => any;
    Kinds: { Skeleton: new () => any; Animation: new () => any; UITransform: new () => any };
} {
    const moduleExports: Record<string, unknown> = {};

    class Component { node: any = null; }
    class Skeleton {}
    class Animation { clips: any[] = []; play(): void {} }
    class UITransform { height = 0; anchorY = 0.5; }

    class FakeNode {
        name: string;
        isValid = true;
        destroyed = false;
        parent: FakeNode | null = null;
        scale = { x: 1, y: 1, z: 1 };
        position = { x: 0, y: 0, z: 0 };
        readonly components: any[] = [];
        constructor(name = 'visual') { this.name = name; }
        setScale(x: number, y: number, z: number): void { this.scale = { x, y, z }; }
        setPosition(x: number, y: number, z: number): void { this.position = { x, y, z }; }
        setParent(parent: FakeNode): void { this.parent = parent; }
        addComponent(type: new () => any): any {
            const component = new type();
            component.node = this;
            this.components.push(component);
            return component;
        }
        getComponent(type: any): any { return this.components.find((entry) => entry instanceof type) ?? null; }
        getComponentInChildren(type: any): any { return this.getComponent(type); }
        destroy(): void { this.destroyed = true; this.isValid = false; }
    }

    const cc = {
        _decorator: { ccclass: () => (target: unknown) => target, property: () => () => {} },
        Component, Skeleton, Animation, UITransform, Node: FakeNode,
        sp: { Skeleton },
        instantiate: (prefab: any) => prefab.make(FakeNode),
    };

    runInNewContext(ts.transpileModule(readFileSync('assets/script/app/card/CardUnitPreview.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, experimentalDecorators: true },
    }).outputText, {
        exports: moduleExports,
        require: (id: string) => id === 'cc'
            ? cc
            : { cardPreviewFactor, FRAME_FOOT_FROM_CENTER_Y },
        console: { log() {}, warn() {} },
    });
    return {
        Preview: moduleExports.CardUnitPreview as new (hero: any, visibleHeight: number) => any,
        Kinds: { Skeleton, Animation, UITransform },
    };
}

/**
 * 造一份 spine 美术 prefab 桩。
 * @param rootScale prefab 根节点自带缩放（爆锤莲王是 1.2，全表只有它和火龙果不是 1）。
 */
function spinePrefab(Skeleton: new () => any, canvasHeight: number, rootScale = 1): any {
    return {
        make: (FakeNode: any) => {
            const node = new FakeNode('spine');
            const skeleton: any = new Skeleton();
            skeleton.node = node;
            skeleton.skeletonData = { getRuntimeData: () => ({ height: canvasHeight, animations: [{ name: 'idle' }] }) };
            skeleton.setAnimation = () => true;
            node.components.push(skeleton);
            node.scale = { x: rootScale, y: rootScale, z: 1 };
            return node;
        },
    };
}

/** 造一份序列帧美术 prefab 桩：`Animation` 带 `-idle` 剪辑，节点高 128（无 canvas）。 */
function framePrefab(Animation: new () => any, UITransform: new () => any, nodeHeight = 128): any {
    return {
        make: (FakeNode: any) => {
            const node = new FakeNode('frame');
            //  组件必须是**真的** `instanceof Animation` / `UITransform`：
            //  组件源码用 `getComponent(Animation)` 找待机剪辑、用 `getComponent(UITransform)` 读节点高。
            const animation: any = new Animation();
            animation.node = node;
            animation.clips = [{ name: 'frame-idle' }];
            node.components.push(animation);
            const transform: any = new UITransform();
            transform.height = nodeHeight;
            node.components.push(transform);
            return node;
        },
    };
}

/** 站台立绘节点（模型挂在它下面，所以要抵消它的缩放）。 */
function heroSprite(height = 155, anchorY = 0, scaleY = 1): any {
    const node = { active: true, scale: { x: scaleY, y: scaleY, z: 1 } };
    return {
        node: Object.assign(node, { getComponent: () => ({ height, anchorY }) }),
        enabled: true,
    };
}

test('B1 系数真的乘进了节点缩放；复用同 prefab 换卡时必须按新体型重写', () => {
    const { Preview, Kinds } = loadPreviewClass();
    const preview = new Preview(heroSprite(), 120);
    const prefab = spinePrefab(Kinds.Skeleton, 941);

    assert.equal(preview.show(prefab, 1), true);
    const visual = preview.visual;
    const plain = visual.scale.y;
    assert.ok(Math.abs(plain - 120 / (941 * 0.97)) < 1e-9, `归一系数不对：${plain}`);

    // 同一份 prefab 被另一张卡复用（萨满 = 萨尔 / 雷蕉，体型按卡不同）⇒ 早退分支也要重写
    preview.show(prefab, 1.5);
    assert.ok(Math.abs(visual.scale.y / plain - 1.5) < 1e-9,
        `复用同 prefab 时也必须按新体型缩放，实际比值 ${visual.scale.y / plain}`);
    assert.ok(Math.abs(visual.scale.x / visual.scale.y - 1) < 1e-9, '等比缩放，x/y 不能分叉');

    preview.show(prefab, 0.85);
    assert.ok(Math.abs(visual.scale.y / plain - 0.85) < 1e-9, '反向缩小同样生效');
});

test('B2 prefab 根节点自带的缩放只乘一次（不能越调越小）', () => {
    const { Preview, Kinds } = loadPreviewClass();
    const preview = new Preview(heroSprite(), 120);
    // 爆锤莲王的 prefab 根 scale = 1.2
    preview.show(spinePrefab(Kinds.Skeleton, 941, 1.2), 1);
    const first = preview.visual.scale.y;
    preview.show(preview.prefab, 1);
    assert.equal(preview.visual.scale.y, first, '同样的入参重复调 show 不得把根缩放再乘一遍');
    assert.ok(Math.abs(first / (120 / (941 * 0.97)) - 1.2) < 1e-9, '根缩放要参与，且只参与一次');
});

test('B3 非法系数不写 0 缩放（否则模型消失）', () => {
    const { Preview, Kinds } = loadPreviewClass();
    const preview = new Preview(heroSprite(), 120);
    const prefab = spinePrefab(Kinds.Skeleton, 941);
    preview.show(prefab, 1);
    const normal = preview.visual.scale.y;
    preview.show(prefab, 0);
    assert.equal(preview.visual.scale.y, normal, '0 应兜成 1');
    preview.show(prefab, Number.NaN);
    assert.equal(preview.visual.scale.y, normal, 'NaN 应兜成 1');
});

test('B4 序列帧美术的脚点偏移跟着体型走（不缩的话 1.5 倍的兵会陷进站台里）', () => {
    const { Preview, Kinds } = loadPreviewClass();
    const preview = new Preview(heroSprite(), 120);
    const prefab = framePrefab(Kinds.Animation, Kinds.UITransform, 128);

    assert.equal(preview.show(prefab, 1), true, '带 -idle 剪辑的序列帧美术应当被接受');
    const normal = preview.visual.position.y;
    const factorNormal = cardPreviewFactor(120, 1, 128, 0.686, 1);
    assert.ok(Math.abs(normal - FRAME_FOOT_FROM_CENTER_Y * factorNormal) < 1e-9,
        `序列帧脚点应为 ${FRAME_FOOT_FROM_CENTER_Y} × 归一系数，实际 ${normal}`);

    preview.show(prefab, 1.5);
    assert.ok(Math.abs(preview.visual.position.y / normal - 1.5) < 1e-9,
        `脚点偏移必须随体型等比放大，实际比值 ${preview.visual.position.y / normal}`);
});

test('B5 换 prefab（不同兵种）重建节点，体型按新卡重算', () => {
    const { Preview, Kinds } = loadPreviewClass();
    const preview = new Preview(heroSprite(), 120);
    preview.show(spinePrefab(Kinds.Skeleton, 941), 1.5);
    const lily = preview.visual.scale.y;
    // 魔术师 canvas 976、体型 0.85 —— 两个维度都变了，不能残留上一张的系数
    preview.show(spinePrefab(Kinds.Skeleton, 976), 0.85);
    const magician = preview.visual.scale.y;
    assert.ok(Math.abs(magician / lily - (0.85 / 1.5) * (941 / 976)) < 1e-9,
        `换卡后应按新 canvas + 新体型重算，实际比值 ${magician / lily}`);
});

// ==================== C. 真表 ====================

function readRows(name: string): Record<string, unknown>[] {
    const raw = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Record<string, unknown>[]
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(raw)) return raw;
    return raw.v.map((row) => Object.fromEntries(raw.k.map((key, i) => [key, row[i]])));
}

test('C1 真表：每一行的 prefabSize 都如实进到 ZCDeckCard（留空 = 1）', () => {
    const rows = readRows('pvpCard');
    const mismatched: string[] = [];
    let sized = 0;
    for (const row of rows) {
        const card = parseCardCatalogRow(row);
        const raw = row.prefabSize;
        const expected = typeof raw === 'number' ? raw : 1;
        if (card.prefabSize !== expected) {
            mismatched.push(`${row.id}「${String(row.name)}」：表 ${String(raw)} vs 卡 ${String(card.prefabSize)}`);
        }
        if (expected !== 1) sized += 1;
    }
    assert.deepEqual(mismatched, [], `prefabSize 未如实透传：\n${mismatched.join('\n')}`);
    // 防空转：判据退化成「全表都是 1」时会安静地永远通过。
    // 当前 35 张兵种卡里有 10 张非 1（豌豆游侠 0.8 / 火焰树妖 1.2 / 爆锤莲王 1.5 / 魔术师 0.85…），
    // 取 8 是留了改表余量：真正的下限是「不能一张都没有」。
    assert.ok(sized >= 8, `应有 8+ 张卡配了非 1 的体型，实际 ${sized}`);
});

test('C2 真表：这次调的两个值没被回滚（爆锤莲王 1.5 / 魔术师 0.85）', () => {
    const rows = readRows('pvpCard');
    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const lily = byId.get('68027');
    const magician = byId.get('68034');
    assert.equal(lily?.name, '爆锤莲王');
    assert.equal(magician?.name, '魔术师', '68034 换过皮，id 没变');
    assert.equal(parseCardCatalogRow(lily!).prefabSize, 1.5,
        '爆锤莲王要调大（原来 1.35，比对局里别的 1.2 兵还小）');
    assert.equal(parseCardCatalogRow(magician!).prefabSize, 0.85, '魔术师要调小');
});

test('C2b 真表：大威天芦（68025）在基准上放大 20%（1 → 1.2）', () => {
    //  用户口径：「模型本来就按卡表的 prefabSize 走」。落到表里是 **1.2**（放大 20%），
    //  而不是 1.5 那种量级 —— 站台上跟旁边的卡比只差一点。
    //
    //  🔴 这里原来钉的是 1.05（「再轻微放大 5%」）。源表 `PVP-卡牌.xlsx / 卡牌配置` 已经改到 1.2，
    //  `doc/塔防数据配置/json/client/pvpCard.json` 同步是 1.2，只有 `assets/remoteRef` 漏了 →
    //  「运行时按旧值画、用例按新值断言」两边都不报错。2026-11-11 把 remoteRef 补齐，期望值随源表走。
    //  真正的红线没变：**不能被回滚成 1**。
    const byId = new Map(readRows('pvpCard').map((row) => [String(row.id), row]));
    const card = byId.get('68025');
    assert.equal(card?.name, '大威天芦');
    assert.equal(parseCardCatalogRow(card!).prefabSize, 1.2,
        '大威天芦要按源表 1.2 画；改回 1 就是这次需求被回滚了');

    //  这个系数在阵容页与布阵页都是线性的（`cardPreviewFactor` 里只有乘积），
    //  所以 1.2 落到两边都是整 20%，不会因为可见高度不同而变。
    const lineup = cardPreviewFactor(120, 1.2, 256, 1, 0.5) / cardPreviewFactor(120, 1, 256, 1, 0.5);
    const board = cardPreviewFactor(90, 1.2, 256, 1, 0.4) / cardPreviewFactor(90, 1, 256, 1, 0.4);
    assert.ok(Math.abs(lineup - 1.2) < 1e-9, `阵容页应是 ×1.2，实际 ×${lineup}`);
    assert.ok(Math.abs(board - 1.2) < 1e-9, `布阵页应是 ×1.2，实际 ×${board}`);
});

test('C3 两端同口径：阵卡与战场单位读的是同一列的同一个值', () => {
    // 阵容页（`parseCard.prefabSize`）与对局（`ZCUnitDefinition.prefabSize`）必须一致 ——
    // 不一致的表现是「同一张卡在站台上和在战场里大小不同」，而且两边各自看着都合理。
    const rows = readRows('pvpCard');
    const drifted: string[] = [];
    for (const row of rows) {
        const card = parseCardCatalogRow(row);
        if (!card.unitId) continue;
        const unit = rows.find((candidate) => String(candidate.unitId) === card.unitId);
        if (!unit) continue;
        const unitSize = typeof unit.prefabSize === 'number' ? unit.prefabSize : 1;
        if (card.prefabSize !== unitSize) {
            drifted.push(`${row.id}「${String(row.name)}」：卡 ${String(card.prefabSize)} vs 单位 ${String(unitSize)}`);
        }
    }
    assert.deepEqual(drifted, []);
});

// ==================== D. 调用点 ====================

/**
 * 系数一路通到 `CardUnitPreview.show` 的**最后一个环节是调用点传参**。
 * 这一步退回默认值（`show(prefab)`）不会报错、不会崩，只是所有兵种又变回等高 ——
 * 和「压根没做这个需求」表现完全一致，所以用源码断言钉住两处站台。
 *
 * 另外两处是**有意**不传的，一并钉住免得被后来人「顺手补齐」：
 *  - `CardUpgradePage` 详情弹窗（Hero 区 365px，270 基准乘 1.5 会顶出 Header）；
 *  - `CardUnitPreview` 自己的默认参数 1（给这类不比较体型的场景用）。
 */
test('D1 两处并排站台都把 prefabSize 传给了预览', () => {
    const lineup = readFileSync('assets/script/app/card/CardLineupSlot.ts', 'utf8');
    //  模型是「先画立绘、后补模型」两段提交的，`applyPreview` 拿不到卡数据 ⇒ 系数必须记在字段里
    assert.match(lineup, /this\.previewSize = card\.prefabSize \?\? 1;/,
        'CardLineupSlot.render 必须先把体型记下来');
    assert.match(lineup, /\.show\(prefab, this\.previewSize\)/,
        'CardLineupSlot.applyPreview 必须把体型传给预览');

    const board = readFileSync('assets/script/app/card/LineupBoardSlot.ts', 'utf8');
    assert.match(board, /\.show\(prefab, card\.prefabSize \?\? 1\)/,
        '布阵站台必须把体型传给预览');
});

test('D2 详情弹窗有意不乘体型（乘了会顶出 Header），别被顺手补齐', () => {
    const upgrade = readFileSync('assets/script/app/card/CardUpgradePage.ts', 'utf8');
    // r1224 重构后待机预览画布 270 -> 390；展示栏压缩后收到 318（与 Hero 节点 _lscale 同步）。
    // 尺寸与「乘不乘体型」无关，语义由下面 doesNotMatch(.show(prefab, <size>)) 守住。
    assert.match(upgrade, /const HERO_PREVIEW_HEIGHT = 318;/);
    assert.match(upgrade, /new CardUnitPreview\(this\.heroSprite, HERO_PREVIEW_HEIGHT\)/);
    assert.doesNotMatch(upgrade, /\.show\(prefab, /,
        '详情弹窗一次只展示一个兵种、没有并排对比，不参与体型差');
});
