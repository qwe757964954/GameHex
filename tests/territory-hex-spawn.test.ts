import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as model from '../assets/script/app/territory/model/TerritoryHexSpawn';
import {
    TERRITORY_HEX_SPAWN_FROM_SCALE,
    TERRITORY_HEX_SPAWN_OPACITY_PORTION,
    TERRITORY_HEX_SPAWN_SECONDS,
    TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_SPAWN_STAGGER_SECONDS,
    territoryHexSpawnBatchSeconds,
    territoryHexSpawnDelays,
    territoryHexSpawnFrame,
} from '../assets/script/app/territory/model/TerritoryHexSpawn';

/**
 * 「新地块生成」判据（2026-10-22 需求，三句话）：
 *   ① 整个节点由透明渐变 → `territoryHexSpawnFrame().opacity` 单调 0→1，且**先铺满再长大**；
 *   ② 地块由小变大 → `scale` 从 `FROM_SCALE` 单调 → 1，端点精确；
 *   ③ 多个地块有先后落差 → `territoryHexSpawnDelays` 按簇心铺开、有间隔、有上限、可复现。
 * 外加视图接线守卫（`step` 顺序、比翻格先掐、换章复位）。
 */

/** 视图类（`view/TerritoryHexSpawn`）在 vm 里跑：`cc` 换成最小桩，模型用真模块。 */
function viewClass(): any {
    const source = readFileSync('assets/script/app/territory/view/TerritoryHexSpawn.ts', 'utf8');
    const code = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, {
        exports,
        console,
        require: (name: string) => {
            if (name === 'cc') return { Node: class {}, UIOpacity: class {} };
            if (name === '../model/TerritoryHexSpawn') return model;
            throw new Error(`未预期依赖 ${name}`);
        },
    });
    return exports.TerritoryHexSpawn;
}

function fakeNode(name = 'Hex_1'): any {
    return {
        name,
        isValid: true,
        scale: { x: 1, y: 1, z: 1 },
        setScale(x: number, y: number, z: number) { this.scale = { x, y, z }; },
        getComponent: () => null,
        addComponent: () => ({ opacity: 255, isValid: true }),
    };
}

// ============================================================
// ① 透明度
// ============================================================

test('起手是全透明 + 最小，落位是 1 + 不透明（端点必须精确）', () => {
    const start = territoryHexSpawnFrame(0);
    assert.equal(start.opacity, 0, '第 0 秒必须完全透明（否则看不到渐变）');
    assert.equal(start.scale, TERRITORY_HEX_SPAWN_FROM_SCALE);

    const end = territoryHexSpawnFrame(TERRITORY_HEX_SPAWN_SECONDS);
    assert.equal(end.opacity, 1);
    assert.equal(end.scale, 1);

    const after = territoryHexSpawnFrame(TERRITORY_HEX_SPAWN_SECONDS + 5);
    assert.deepEqual(after, { scale: 1, opacity: 1 }, '超时后必须停在终态，不能继续zoom');
});

test('透明度与缩放都单调不减，且透明度**先铺满**', () => {
    let lastScale = 0;
    let lastOpacity = 0;
    let solidAt = -1;
    const steps = 40;
    for (let index = 0; index <= steps; index += 1) {
        const t = (TERRITORY_HEX_SPAWN_SECONDS * index) / steps;
        const frame = territoryHexSpawnFrame(t);
        assert.ok(frame.scale >= lastScale - 1e-9, `缩放在 t=${t} 回退了`);
        assert.ok(frame.opacity >= lastOpacity - 1e-9, `透明度在 t=${t} 回退了`);
        assert.ok(frame.scale <= 1 + 1e-9 && frame.opacity <= 1 + 1e-9, '不得越界');
        lastScale = frame.scale;
        lastOpacity = frame.opacity;
        if (solidAt < 0 && frame.opacity >= 1 - 1e-9) solidAt = index / steps;
    }
    assert.ok(solidAt > 0, '必须存在「已铺满」的时刻');
    // 需求口径：先实体化再长大 —— 铺满的时刻要明显早于结束（否则读作「半透明地长完」）。
    assert.ok(solidAt <= TERRITORY_HEX_SPAWN_OPACITY_PORTION + 1e-9,
        `铺满时刻 ${solidAt} 必须不晚于 ${TERRITORY_HEX_SPAWN_OPACITY_PORTION}`);
    assert.ok(solidAt < 1, '铺满时刻不得拖到整段结束');
});

test('脏数据一律退回起手帧，不抛错也不给出 NaN', () => {
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, -1, undefined as unknown as number]) {
        const frame = territoryHexSpawnFrame(bad);
        assert.equal(frame.opacity, 0, `${String(bad)} 应退回全透明`);
        assert.equal(frame.scale, TERRITORY_HEX_SPAWN_FROM_SCALE);
    }
    const infinite = territoryHexSpawnFrame(Number.POSITIVE_INFINITY);
    assert.equal(infinite.scale, 1);
    assert.equal(infinite.opacity, 1);
});

// ============================================================
// ③ 错峰
// ============================================================

test('单格没有延迟；空格返回空表', () => {
    assert.equal(territoryHexSpawnDelays([{ cellId: 7, x: 0, y: 0 }]).get(7), 0);
    assert.equal(territoryHexSpawnDelays([]).size, 0);
});

test('多格从簇心向外铺开，间隔为 STAGGER 且顺序可复现', () => {
    // 3×3 的一批新格（间距 100）⇒ 中间那格（5）最先，四角最后。
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
        cellId: index,
        x: (index % 3) * 100,
        y: Math.floor(index / 3) * 100,
    }));
    const delays = territoryHexSpawnDelays(cells);
    assert.equal(delays.size, 9);
    assert.equal(delays.get(4), 0, '簇心（正中间）必须第一个出现');
    assert.ok((delays.get(0) ?? 0) > (delays.get(4) ?? 0), '角上的必须晚于簇心');
    // 相邻档期 = 一个 stagger（取排序后的前两个不为 0 的），且都不是负的
    const sorted = [...delays.values()].sort((a, b) => a - b);
    for (let index = 1; index < sorted.length; index += 1) {
        assert.ok(sorted[index] >= sorted[index - 1], '延迟序列必须单调');
    }
    assert.ok(Math.abs(sorted[1] - sorted[0] - TERRITORY_HEX_SPAWN_STAGGER_SECONDS) < 1e-9,
        '第二个出场必须正好晚一个 stagger');

    // 同一批输入两次调用结果完全一致（顺序不能随对象地址漂）
    assert.deepEqual([...territoryHexSpawnDelays(cells)], [...delays]);
});

test('等距时按 cellId 兜底排序，结果确定', () => {
    const delays = territoryHexSpawnDelays([
        { cellId: 30, x: 0, y: 0 },
        { cellId: 10, x: 0, y: 0 },
        { cellId: 20, x: 0, y: 0 },
    ]);
    assert.equal(delays.get(10), 0);
    assert.ok((delays.get(20) ?? 0) > (delays.get(10) ?? 0));
    assert.ok((delays.get(30) ?? 0) > (delays.get(20) ?? 0));
});

test('一整排格子也不会把总时长拖长：错峰封顶', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ cellId: index, x: index * 10, y: 0 }));
    const delays = territoryHexSpawnDelays(many);
    const max = Math.max(...delays.values());
    assert.ok(max <= TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS + 1e-9, `最大延迟 ${max} 超上限`);
    assert.equal(max, TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS, '格子足够多时必须顶到上限（否则会拖成卡顿）');
    assert.equal(territoryHexSpawnBatchSeconds(40), TERRITORY_HEX_SPAWN_STAGGER_MAX_SECONDS + TERRITORY_HEX_SPAWN_SECONDS);
});

test('负 / 非法的 stagger 按 0 处理，不会倒序进场', () => {
    const cells = [{ cellId: 1, x: 0, y: 0 }, { cellId: 2, x: 10, y: 0 }, { cellId: 3, x: 20, y: 0 }];
    for (const stagger of [-1, Number.NaN]) {
        for (const delay of territoryHexSpawnDelays(cells, stagger).values()) assert.equal(delay, 0);
    }
    assert.equal(territoryHexSpawnBatchSeconds(0), 0);
    assert.equal(territoryHexSpawnBatchSeconds(1), TERRITORY_HEX_SPAWN_SECONDS);
});

// ============================================================
// 视图：逐帧写节点、收口、打断
// ============================================================

test('play 起手就写「全透明 + 最小」，不会先闪一帧满尺寸', () => {
    const Spawn = viewClass();
    const spawn = new Spawn();
    const node = fakeNode();
    assert.equal(spawn.play(node, 0), true);
    assert.equal(node.scale.x, TERRITORY_HEX_SPAWN_FROM_SCALE);
    assert.equal(spawn.opacityOf(node), 0);
});

test('延迟期内不动，跨过 0 才开始长；到时长收口为 1 / 255', () => {
    const Spawn = viewClass();
    const spawn = new Spawn();
    const node = fakeNode();
    const opacities: number[] = [];
    spawn.play(node, 0.1, (value: number) => opacities.push(value));

    spawn.step(0.05);
    assert.equal(node.scale.x, TERRITORY_HEX_SPAWN_FROM_SCALE, '还没轮到它，必须保持起手态');
    spawn.step(0.1);   // 累计 0.15 ⇒ 延迟 0.1 已过，正片走了 0.05
    assert.ok(node.scale.x > TERRITORY_HEX_SPAWN_FROM_SCALE && node.scale.x < 1, '应该正在长大');
    assert.ok(spawn.isPlaying(node));

    spawn.step(1);
    assert.equal(node.scale.x, 1);
    assert.equal(spawn.isPlaying(node), false, '播完必须出列');
    assert.equal(spawn.opacityOf(node), null);
    assert.equal(opacities.at(-1), 1, '收口必须把「不透明」递出去，站点才不会停在半透明');
});

test('stop / reset 立刻收口（翻格接管与换章重建都走这条路）', () => {
    const Spawn = viewClass();
    const spawn = new Spawn();
    const a = fakeNode('a');
    const b = fakeNode('b');
    spawn.play(a, 0);
    spawn.play(b, 0);
    spawn.step(0.1);
    spawn.stop(a);
    assert.equal(a.scale.x, 1, 'stop 后缩放必须复位');
    assert.equal(spawn.isPlaying(a), false);
    assert.ok(spawn.isPlaying(b), 'stop 只影响那一格');
    spawn.reset();
    assert.equal(b.scale.x, 1);
    assert.equal(spawn.playingCount, 0);
});

test('同一格重复 play 不会重置进度；节点被销毁时自动出列', () => {
    const Spawn = viewClass();
    const spawn = new Spawn();
    const node = fakeNode();
    spawn.play(node, 0);
    spawn.step(0.2);
    const midway = node.scale.x;
    assert.equal(spawn.play(node, 0), false, '重复 play 必须被拒');
    assert.equal(node.scale.x, midway, '被拒时不得把进度打回起手帧');

    node.isValid = false;
    spawn.step(0.016);
    assert.equal(spawn.playingCount, 0, '死节点必须自动出列，不能一直往它身上写');
});

// ============================================================
// 接线守卫（读源码，防"优化"时接错顺序）
// ============================================================

test('地图视图：生成动画排在翻格之后 step，并在翻格起播时让位', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const update = source.slice(source.indexOf('update(dt: number): void {'));
    const flipAt = update.indexOf('this.hexFlip.step(dt);');
    const spawnAt = update.indexOf('this.hexSpawn.step(dt);');
    assert.ok(flipAt >= 0 && spawnAt > flipAt, '`hexFlip.step` 必须仍在最前，`hexSpawn.step` 紧随其后');
    assert.match(source, /this\.hexSpawn\.stop\(node\);/, '翻格起播时必须掐掉同格的生成动画');
});

test('地图视图：diff 触发 + 首帧只做快照 + 换章复位', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    assert.match(source, /private syncHexSpawn\(/);
    assert.match(source, /if \(!this\.spawnBootstrapped\)/);
    assert.match(source, /this\.hexSpawn\.reset\(\);/, '换章 / 布局重建必须复位生成动画');
    assert.match(source, /this\.revealedSnapshot\.clear\(\);/, '换章必须清掉「已露出」快照');
    assert.match(source, /if \(this\.hexFlip\.isPlaying\(node\)\) continue;/, '正在翻的格子让给翻格');
    // 站点比格节点晚建一拍 ⇒ 必须补写一次当前进度
    assert.match(source, /this\.applyHexSpawnFade\(/);
});

test('站点视图：整站透明度是四个视觉节点各挂一个 UIOpacity', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    assert.match(source, /setSpawnOpacity\(value: number\): void/);
    assert.match(source, /iconSprite\.node, this\.captionSprite\.node, this\.captionLabel\.node, this\.badgeLabel\.node/);
    assert.match(source, /private spawnOpacities: UIOpacity\[\] \| null = null;/);
});
