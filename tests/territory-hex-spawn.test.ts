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
    TERRITORY_HEX_SPAWN_TIMING,
    TERRITORY_HEX_SPAWN_VICTORY_SECONDS,
    TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS,
    TERRITORY_HEX_SPAWN_VICTORY_TIMING,
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
// ② 胜利通过那一批：同一套曲线，节奏更重（2026-11-03）
// ============================================================

/**
 * 需求原文：*「胜利通过的地块动画节奏感需要比普通的地块生成动画更强，更明显」*。
 *
 * 这里不测"好不好看"（那是验收的事），只钉住**可比较的量**：
 * 更长、起手更小、有且只有一次过冲、错峰分得更开、亮得更早 —— 这五条任何一条被"优化"掉，
 * 胜利档就和普通档没区别了。
 */
test('★★★胜利档每一项都比普通档更重（时长/起手/错峰/透明度）', () => {
    const normal = TERRITORY_HEX_SPAWN_TIMING;
    const victory = TERRITORY_HEX_SPAWN_VICTORY_TIMING;
    assert.ok(victory.seconds > normal.seconds, `胜利档时长 ${victory.seconds} 必须长于 ${normal.seconds}`);
    assert.ok(victory.fromScale < normal.fromScale, '起手必须更小（落差更大才读得出"从地里长出来"）');
    assert.ok(victory.stagger > normal.stagger, '错峰必须更宽，否则一格一格分不开、听不出节拍');
    assert.ok(victory.staggerMax > normal.staggerMax, '上限也要放宽，否则十几格会全挤在 0.3s 里变成"一坨"');
    assert.ok(victory.opacityPortion < normal.opacityPortion, '透明度必须更早铺满（先亮起来再长大）');
    // 过冲只在胜利档存在：普通档 `peakScale = 1 / peakPortion = 1` ⇒ 走"缓出长到底"那支。
    assert.equal(normal.peakScale, 1, '普通档不得有过冲（背景事件，弹一下会挡视线）');
    assert.equal(normal.peakPortion, 1);
    assert.ok(victory.peakScale > 1, '胜利档必须长过头再收回');
    assert.ok(victory.peakPortion > 0 && victory.peakPortion < 1, '过冲点必须在段中间，否则收不回来 / 看不出弹性');
});

test('★★★胜利档：唯一过冲峰值精确等于 peakScale，末帧精确回到 1', () => {
    const timing = TERRITORY_HEX_SPAWN_VICTORY_TIMING;
    const steps = 200;
    let lastScale = -Infinity;
    let peakIndex = -1;
    for (let index = 0; index <= steps; index += 1) {
        const t = (timing.seconds * index) / steps;
        const frame = territoryHexSpawnFrame(t, timing);
        assert.ok(frame.scale <= timing.peakScale + 1e-9, `t=${t} 越过了过冲峰值`);
        assert.ok(frame.opacity <= 1 + 1e-9);
        // 前段递增、后段递减 —— 中间只允许一个拐点（有第二个拐点就是"抖"，不是"砸"）。
        if (index > 0 && frame.scale < lastScale - 1e-9 && peakIndex < 0) peakIndex = index;
        if (peakIndex > 0) assert.ok(frame.scale <= lastScale + 1e-9, `t=${t} 过冲之后又涨回去了`);
        lastScale = frame.scale;
    }
    assert.ok(peakIndex > 0, '必须存在峰值拐点');
    const peakPortionAt = peakIndex / steps;
    assert.ok(Math.abs(peakPortionAt - timing.peakPortion) < 1.5 / steps,
        `峰值出现在 ${peakPortionAt}，应接近 peakPortion=${timing.peakPortion}`);
    const peak = territoryHexSpawnFrame(timing.seconds * timing.peakPortion, timing);
    assert.ok(Math.abs(peak.scale - timing.peakScale) < 1e-9, `峰值必须是精确的 ${timing.peakScale}`);

    const start = territoryHexSpawnFrame(0, timing);
    assert.equal(start.scale, timing.fromScale);
    assert.equal(start.opacity, 0, '起手仍必须全透明');
    const end = territoryHexSpawnFrame(timing.seconds, timing);
    assert.deepEqual(end, { scale: 1, opacity: 1 }, '落位必须精确回到 1（否则格子会永久停在 1.14）');
    assert.deepEqual(territoryHexSpawnFrame(timing.seconds + 3, timing), { scale: 1, opacity: 1 });
});

test('★胜利档透明度在 opacityPortion 就已铺满（先亮、后长大）', () => {
    const timing = TERRITORY_HEX_SPAWN_VICTORY_TIMING;
    const solidAt = timing.seconds * timing.opacityPortion;
    assert.equal(territoryHexSpawnFrame(solidAt, timing).opacity, 1, '过半就该完全不透明');
    assert.ok(territoryHexSpawnFrame(solidAt * 0.5, timing).opacity < 1, '前半段必须是渐显（不是一步到位）');
    // 铺满的那一刻，缩放还在半路（说明"亮"与"长大"是两段，不是一起完成）。
    const scaleAtSolid = territoryHexSpawnFrame(solidAt, timing).scale;
    assert.ok(scaleAtSolid > timing.fromScale && scaleAtSolid < timing.peakScale,
        `铺满时缩放应在半路，实际 ${scaleAtSolid}`);
});

test('★胜利档一批的总时长明显长于普通档（同格数对比）', () => {
    for (const count of [1, 3, 8]) {
        const normal = territoryHexSpawnBatchSeconds(count, TERRITORY_HEX_SPAWN_TIMING);
        const victory = territoryHexSpawnBatchSeconds(count, TERRITORY_HEX_SPAWN_VICTORY_TIMING);
        assert.ok(victory > normal, `${count} 格的胜利档 ${victory} 没有比普通档 ${normal} 长`);
    }
    // 单格就是自己的时长；多格才叠加错峰，且有上限。
    assert.equal(territoryHexSpawnBatchSeconds(1, TERRITORY_HEX_SPAWN_VICTORY_TIMING),
        TERRITORY_HEX_SPAWN_VICTORY_SECONDS);
    assert.equal(territoryHexSpawnBatchSeconds(40, TERRITORY_HEX_SPAWN_VICTORY_TIMING),
        TERRITORY_HEX_SPAWN_VICTORY_STAGGER_MAX_SECONDS + TERRITORY_HEX_SPAWN_VICTORY_SECONDS);
});

test('★胜利档错峰：间隔按胜利档算，且仍按簇心铺开', () => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => ({
        cellId: index,
        x: (index % 3) * 100,
        y: Math.floor(index / 3) * 100,
    }));
    const timing = TERRITORY_HEX_SPAWN_VICTORY_TIMING;
    const delays = territoryHexSpawnDelays(cells, timing.stagger, timing.staggerMax);
    assert.equal(delays.get(4), 0, '簇心仍然第一个');
    const sorted = [...delays.values()].sort((a, b) => a - b);
    assert.ok(Math.abs(sorted[1] - sorted[0] - timing.stagger) < 1e-9,
        `第二格必须晚 ${timing.stagger}s（不是普通档的 ${TERRITORY_HEX_SPAWN_STAGGER_SECONDS}）`);
    assert.ok((delays.get(0) ?? 0) > (territoryHexSpawnDelays(cells).get(0) ?? 0),
        '同一个角落在胜利档里必须更晚出现');
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

test('★★★刚解锁的格子也要播生成动画（关卡格花银币解锁，2026-10-28）', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    // 🔴 为什么不能只靠 `revealed` 的 diff：`revealed` 里本来就含「前沿看得见、还没花钱开」的格子，
    // 关卡格从「锁着（银币 + 数字）」变「已解锁（关卡建筑）」时**前后都在 revealed 里**
    // ⇒ 露出集合的 diff 恒为 0，外观直接换、没有过渡（用户：「点击地块消耗银币，播放地块切换成
    // 关卡地块的动画（与其他新生成的地块动画一致）」）。
    assert.match(source, /private readonly unlockedSnapshot = new Set<number>\(\);/,
        '要单独记一份「上一帧已解锁」的集合');
    assert.match(source,
        /if \(!progress\.isCellUnlocked\(cellId\) \|\| this\.unlockedSnapshot\.has\(cellId\)\) continue;/,
        '「这一帧才变已解锁」的格子必须进场');
    assert.match(source, /this\.unlockedSnapshot\.clear\(\);/, '换章 / 布局重建必须清掉解锁快照');
    assert.match(source, /this\.unlockedSnapshot\.add\(cellId\)/, '每帧都要把快照推到最新');
    // 同一格可能两条都命中（新露出 + 同帧解锁）⇒ 必须去重，否则播两次（缩放会打架）。
    assert.match(source, /const entered = new Set<number>\(\);/, '两条触发要合到一个去重集合里');
});

test('站点视图：整站透明度覆盖全部视觉根，气泡背景与文字共同淡入', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryStationView.ts', 'utf8');
    assert.match(source, /setSpawnOpacity\(value: number\): void/);
    assert.match(source, /private spawnOpacities: UIOpacity\[\] \| null = null;/);
    const start = source.indexOf('setSpawnOpacity(value: number)');
    assert.ok(start > 0, 'setSpawnOpacity 必须存在');
    const body = source.slice(start, source.indexOf('setGhostOpacity(', start));
    // 四个固定的视觉根：Icon / 银币图标 / 数字 / 气泡（没有气泡时退回角标）。
    for (const root of [
        'this.iconSprite.node',
        'this.captionSprite.node',
        'this.captionLabel.node',
        'this.levelBubble?.node ?? this.badgeLabel.node',
    ]) {
        assert.ok(body.includes(root), `${root} 必须在淡入名单里`);
    }
    // 第五个是 2026-11-10 起才有的宝箱图标（`conditionChestIcon`），**惰性创建** ⇒
    // 只有存在时才进名单；建节点那一步必须把 `spawnOpacities` 置空重建，否则它永远不跟着淡入。
    assert.ok(body.includes('...(this.conditionChest ? [this.conditionChest.node] : [])'),
        '宝箱图标要条件加入淡入名单（没有它的格不许凭空多一个 UIOpacity）');
    assert.match(source, /this\.spawnOpacities = null;/,
        '新增视觉节点（宝箱图标）时必须重建缓存');
});

test('视图：play 第 4 参把节奏档位带进每一格（同一批可能混档）', () => {
    const Spawn = viewClass();
    const spawn = new Spawn();
    const node = fakeNode();
    // 起手帧按**这一档**的 fromScale 写，不是普通档的 0.55。
    assert.equal(spawn.play(node, 0, null, TERRITORY_HEX_SPAWN_VICTORY_TIMING), true);
    assert.equal(node.scale.x, TERRITORY_HEX_SPAWN_VICTORY_TIMING.fromScale);
    // 剩余时长也要按这一档算（页面靠它决定"播完再盖云"）。
    assert.ok(Math.abs(spawn.remainingSeconds() - TERRITORY_HEX_SPAWN_VICTORY_SECONDS) < 1e-9,
        `剩余时长应按胜利档 ${TERRITORY_HEX_SPAWN_VICTORY_SECONDS} 计`);
    // 走到普通档该结束的时刻，胜利档必须还在播。
    spawn.step(TERRITORY_HEX_SPAWN_SECONDS + 0.02);
    assert.ok(spawn.isPlaying(node), '胜利档还没播完，不能提前收口');
    spawn.step(TERRITORY_HEX_SPAWN_VICTORY_SECONDS);
    assert.equal(node.scale.x, 1);
    assert.equal(spawn.playingCount, 0);
});

test('★★★地图视图：胜利那一批整批走重档，不混着播', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const start = source.indexOf('private syncHexSpawn(');
    const body = source.slice(start, source.indexOf('private isCellPassed(', start));
    // 同一批里只要有一格是胜利格 ⇒ 整批按胜利档（混档播没有节拍）。
    assert.match(body, /fresh\.some\(\(cell\) => celebrate\.includes\(cell\.cellId\)\)/,
        '判定必须看「这批里有没有胜利格」，不能只看数量或第一格');
    assert.match(body, /TERRITORY_HEX_SPAWN_VICTORY_TIMING : TERRITORY_HEX_SPAWN_TIMING/,
        '选档必须落到 model 的两个 timing 常量上（不要在这里写死数字）');
    // ⚠️ 易错：`territoryHexSpawnDelays` 的第 2/3 参必须跟着档位走，否则时长是胜利档、
    //    错峰还是普通档 ⇒ 格子仍然挤在一起，用户看到的只是"变慢了"而不是"更有节奏"。
    assert.match(body, /territoryHexSpawnDelays\(fresh, timing\.stagger, timing\.staggerMax\)/,
        '错峰参数必须跟着档位走');
    assert.match(body, /this\.hexSpawn\.play\(cell\.node,[\s\S]*?timing\);/, '`play` 必须把 timing 传下去');
});

test('★地图视图：首帧（快照建立）不播胜利档，避免进页面就放大一遍', () => {
    const source = readFileSync('assets/script/app/territory/view/TerritoryMapView.ts', 'utf8');
    const start = source.indexOf('private syncHexSpawn(');
    const bootstrap = source.slice(start, source.indexOf('const celebrate = input.victoryClaimCells;', start));
    assert.ok(bootstrap.includes('return;'), '快照那一帧必须早退');
    assert.ok(!bootstrap.includes('VICTORY_TIMING'), '首帧不得走胜利档');
});


// ============================================================
// 模型：哪一批算「胜利通过」（读源码守卫，防"顺手简化"丢标记）
// ============================================================

test('★★★模型：只有「真的打赢且能开始探索」才置胜利标记', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    const start = source.indexOf('private applyStoredBattleResult(');
    const body = source.slice(start, source.indexOf('private settleProgress(', start));
    // ⚠️ 不能无条件置标记：`result.ok === false`（这一格已经在探索中 / 不满足条件）时
    //    并没有"新收进地盘"，放大播一遍纯属噪音。
    assert.match(body, /if \(result\.ok\) this\.victoryPending = true;/, '胜利标记必须挂在 `result.ok` 上');
    assert.match(source, /private victoryPending = false;/, '标记要有初值');
    assert.match(source, /private victoryClaimCells: number\[\] = \[\];/);
});

test('★★★模型：胜利格只兑现一次，且每次结算都先清空', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    const start = source.indexOf('private settleProgress(');
    const body = source.slice(start, source.indexOf('\n    /**', start));
    // ① 先清：上一次的胜利格不能漏到这一批（否则后面无关的生成也走重档）。
    const clearAt = body.indexOf('this.victoryClaimCells = [];');
    const claimAt = body.indexOf('if (this.victoryPending) {');
    assert.ok(clearAt > 0, '每次结算开头必须清空上一批胜利格');
    assert.ok(clearAt < claimAt, '必须先清空、再决定这一批要不要记');
    // ② 只在真的收进格子时兑现：`claimed` 为空（只是"没到期"）不能把标记吃掉。
    assert.ok(body.indexOf('if (claimed.length)') < claimAt, '兑现必须在 `claimed.length` 之内');
    assert.match(body, /this\.victoryClaimCells = claimed\.slice\(\);/);
    // ③ 兑现即消费：不清标记的话，下一批任意生成都会继续走重档。
    assert.match(body, /this\.victoryPending = false;/, '兑现后必须清掉标记');
});

test('★★★模型：切章 / 销毁都复位胜利标记（不能漏到下一章）', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    const reset = 'this.victoryClaimCells = [];';
    const loadAt = source.indexOf('private async loadChapter(');
    const bossResetAt = source.indexOf('this.bossBattleStart = null;', loadAt);
    const loadBody = source.slice(loadAt, bossResetAt);
    assert.ok(loadBody.includes(reset), '切章节必须清上一章的胜利格');
    assert.ok(loadBody.includes('this.victoryPending = false;'), '切章节必须清标记');
    assert.ok(source.indexOf(reset, loadAt) < bossResetAt,
        '复位要跟着其它 pending 集合一起做（在导航/加载之前）');
    const disposeAt = source.indexOf('dispose(): void {');
    const disposeBody = source.slice(disposeAt, source.indexOf('this.outputs.clear();', disposeAt));
    assert.ok(disposeBody.includes(reset), '销毁也要清（同一实例被重新 start 时不能带旧标记）');
});

test('★模型：视图状态里透出 victoryClaimCells（视图拿不到就没有档位可切）', () => {
    const source = readFileSync('assets/script/app/territory/application/TerritoryModel.ts', 'utf8');
    assert.match(source, /readonly victoryClaimCells: readonly number\[\];/, '渲染输入的类型要有这个字段');
    assert.match(source, /victoryClaimCells: this\.victoryClaimCells,/, '状态里必须真的带上它');
});
