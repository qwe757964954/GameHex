/**
 * `pvpCard.prefabSize`（兵种美术等比缩放）的两端守卫。
 *
 * **表侧**（r534 起，35 张兵种卡有值 0.8~1.2，建筑卡留空）：
 * 策划按美术实际体量给每个兵种配一个缩放系数，客户端把它乘在战场单位的美术缩放上。
 * 这类「表现参数」列天生脆弱 —— 漏填不报错、填 0 会让单位凭空消失、填错也只表现为「大小不对」，
 * 而大小不对在棋盘上很难一眼归因。所以这里三层钉住：
 *
 *  ① **解析层**（本文件 C1~C3）：留空 ⇒ 1；非正数 ⇒ **当场抛**（不是静默兜底）；
 *  ② **视图层**（V1~V3）：系数真的乘进了节点缩放，且与 spine 的 canvas 归一**相乘而非覆盖**；
 *  ③ **表侧真源**（T1~T2）：真表里每个兵种卡都有合法值，且解析层读出来的与表里逐字一致。
 *
 * ⚠️ 判「视图层真的缩放了」不能只断言 `visualBaseScale` 字段 —— 那是私有实现。
 * 必须驱动 `initialize(prefab, size)` 后读**节点上实际的 scale**，否则改成别处乘也一样绿。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseUnits } from '../assets/script/app/zcds/model/ZCGameRuntimeConfig';
import { loadViews } from './helpers/zcds-view-fixtures';

// ==================== 表侧读取 ====================

/** 读 remoteRef 表 → 行对象数组。两种形态都认：未压缩行数组 / 列存 `{k, v}`。 */
function readPvpRows(name: string): Array<Record<string, unknown>> {
    const source = JSON.parse(readFileSync(`assets/remoteRef/${name}.json`, 'utf8')) as
        | Array<Record<string, unknown>>
        | { k: string[]; v: unknown[][] };
    if (Array.isArray(source)) return source;
    return source.v.map((values) => Object.fromEntries(source.k.map((key, index) => [key, values[index]])));
}

/** 与 `parseUnits` 同源的「是不是兵种卡」判据（两列任一非空）。 */
function isUnitRow(row: Record<string, unknown>): boolean {
    return Boolean(row.unitPrefabPath) || row.unitSkillId !== null && row.unitSkillId !== undefined;
}

/** 一行最小可解析的兵种卡；`over` 覆盖任意列（用来喂 prefabSize）。 */
function unitRow(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 90001,
        name: '样例兵',
        unitId: 90001,
        unitPrefabPath: 'units/样例兵/样例兵',
        unitSkillId: 1001,
        unitMaxHp: 10,
        unitAttack: 1,
        unitMoveSpeed: 1,
        unitAttackRange: 1,
        unitAttackInterval: 1,
        unitAttackDuration: 1,
        unitAttackHitTime: 1,
        ...over,
    };
}

/** 跑一遍解析层，返回该兵种卡解出来的 `prefabSize`。 */
function parsePrefabSizeOf(row: Record<string, unknown>): number {
    const skills = new Map([[1001, { skillId: 1001 }]]) as unknown as Parameters<typeof parseUnits>[1];
    const units = parseUnits([row], skills);
    const definition = units.get('90001');
    assert.ok(definition, '样例行应当被解析成一个单位');
    return definition.prefabSize;
}

// ==================== 视图夹具 ====================

/**
 * `ZCUnitView` 的桩：补齐 prefab 上全部必填引用（口径同 `zcds-progress` 的 `stubUnitView`）。
 * `bar()` 造的节点带 `position` / `setScale`，够读回实际写入的缩放。
 */
/** 驱动 `initialize(definition)` 用：视图只读 `unitId`（拿去向控制器取 prefab）与 `prefabSize`。 */
function unitDefinition(prefabSize: number): any {
    return { unitId: '90001', prefabSize };
}

function stubUnitView(load: (name: string) => any, bar: () => any): any {
    const view = new (load('./ZCUnitView').ZCUnitView)();
    const node = bar().node;
    //  引擎侧 `Component.node`：spine 美术挂载会往它上面写 `layer`（帧图那条路径不碰）。
    view.node = node;
    view.rootTransform = { setContentSize: () => {} };
    view.visualRoot = bar().node;
    view.sprite = { enabled: true, spriteFrame: null };
    view.fallback = { node, clear: () => {}, circle: () => {}, fill: () => {} };
    view.fallbackLabel = { node, enabled: true, string: '' };
    view.healthBar = bar();
    return view;
}

/** 造一个「prefab 自带缩放 = 1、序列帧形态（无 Animation/Skeleton）」的美术 prefab 桩。 */
function framePrefab(FakeNode: any): any {
    return {
        make: () => {
            const node = new FakeNode('visual');
            node.getComponent = () => null;
            return node;
        },
    };
}

/** 造一个 spine 形态的美术 prefab 桩：带 `skeletonData.getRuntimeData().height`。 */
function spinePrefab(FakeNode: any, canvasHeight: number): any {
    const skeleton = makeSkeleton(canvasHeight);
    return {
        make: () => {
            const node = new FakeNode('spine-visual');
            node.getComponent = (type: any) => (type?.name === 'Skeleton' ? skeleton : null);
            return node;
        },
    };
}

function makeSkeleton(canvasHeight: number): any {
    return {
        skeletonData: { getRuntimeData: () => ({ height: canvasHeight, animations: [{ name: 'idle' }] }) },
        setAnimation: () => true,
        color: null,
    };
}

// ==================== 解析层 ====================

test('C1 解析层：prefabSize 留空按 1（不缩放），填了就按填的来', () => {
    assert.equal(parsePrefabSizeOf(unitRow()), 1, '整列缺失 ⇒ 1');
    assert.equal(parsePrefabSizeOf(unitRow({ prefabSize: null })), 1, '显式 null ⇒ 1');
    assert.equal(parsePrefabSizeOf(unitRow({ prefabSize: '' })), 1, '空串 ⇒ 1');
    assert.equal(parsePrefabSizeOf(unitRow({ prefabSize: 1.2 })), 1.2);
    assert.equal(parsePrefabSizeOf(unitRow({ prefabSize: 0.8 })), 0.8);
});

test('C2 解析层：填 0 或负数当场抛错（缩放 0 = 单位凭空消失，且不报错）', () => {
    // 0 是最危险的一个：scale 全 0 ⇒ 什么都画不出来，控制台干干净净。
    assert.throws(() => parsePrefabSizeOf(unitRow({ prefabSize: 0 })), /prefabSize/);
    assert.throws(() => parsePrefabSizeOf(unitRow({ prefabSize: -1 })), /prefabSize/);
    // 非数字（转表串列 / 填了单位）同样当场炸。
    assert.throws(() => parsePrefabSizeOf(unitRow({ prefabSize: '1.2' })), /prefabSize/);
});

test('C3 解析层：建筑卡（无单位预设）整行跳过，不因缺 prefabSize 抛错', () => {
    const skills = new Map([[1001, { skillId: 1001 }]]) as unknown as Parameters<typeof parseUnits>[1];
    // 混喂一张兵种卡（否则 `parseUnits` 末尾「一张单位都没有」那道守卫会先抛，
    // 报错点指不到本用例真正想验的东西 —— 建筑卡被跳过这件事）。
    const units = parseUnits([
        unitRow(),
        { id: 2002, name: '主城', type: '5', baseHp: 1500, goldDigTime: 6 },
    ], skills);
    assert.deepEqual([...units.keys()], ['90001'], '建筑卡不该产出单位');
    assert.equal(units.get('90001')?.prefabSize, 1);
});

// ==================== 视图层 ====================

test('V1 视图层：prefabSize 真的乘进了节点的实际缩放', () => {
    const { load, bar, FakeNode, procedureGame } = loadViews();
    const view = stubUnitView(load, bar);
    procedureGame.current = { resolveUnitPrefab: () => framePrefab(FakeNode) };
    view.initialize(unitDefinition(1));
    assert.equal(view.visualNode.scale.x, 1, '系数 1 ⇒ 原样');

    // 换一个池化复用节点：同一 prefab、不同体型，走 initialize 的「复用美术子树」早退分支。
    view.initialize(unitDefinition(1.2));
    assert.equal(view.visualNode.scale.x, 1.2, '复用同 prefab 时也必须按新体型缩放');
    assert.equal(view.visualNode.scale.y, 1.2);
    view.initialize(unitDefinition(0.8));
    assert.equal(view.visualNode.scale.x, 0.8, '反向缩小同样生效');
});

test('V2 视图层：与 spine 的 canvas 归一**相乘**，不是互相覆盖', () => {
    const { load, bar, FakeNode, procedureGame } = loadViews();
    // 基准：SPINE_CANVAS_TARGET_HEIGHT = 69.4（ZCUnitView 模块常量），canvas 高 916.29
    // ⇒ 归一系数 ≈ 0.07574。prefabSize=1.2 应该在它之上再乘 1.2，而不是把它顶掉。
    const canvasHeight = 916.29;
    const base = 69.4 / canvasHeight;

    //  prefab 由视图向控制器现取（`ProcedureGame.current`），这里把它钉成同一个 spine prefab。
    procedureGame.current = { resolveUnitPrefab: () => spinePrefab(FakeNode, canvasHeight) };
    const plain = stubUnitView(load, bar);
    plain.initialize(unitDefinition(1));
    const withSize = stubUnitView(load, bar);
    withSize.initialize(unitDefinition(1.2));

    const ratio = withSize.visualNode.scale.y / plain.visualNode.scale.y;
    assert.ok(Math.abs(ratio - 1.2) < 1e-6, `spine 归一之上还要再乘 prefabSize，实际比值 ${ratio}`);
    // 顺带钉住归一本身没被破坏（canvas 归一照旧生效）
    assert.ok(Math.abs(plain.visualNode.scale.y - base) < 1e-6, `spine 归一系数应仍是 ${base}`);
});

test('V3 视图层：血条 Y 跟着体型走（不缩的话 1.2 倍的兵血条会陷进头顶）', () => {
    const { load, bar, FakeNode, procedureGame } = loadViews();
    const presentation = () => ({
        unit: { hp: 100, maxHp: 100, battleState: 'idle', facingRadians: 0, completedAttackCount: 0, owner: 'player' },
        definition: { hero: false, attackRange: 50, prefabSize: 1 },
        x: 0, y: 0, now: 0,
    });

    procedureGame.current = { resolveUnitPrefab: () => framePrefab(FakeNode) };
    const big = stubUnitView(load, bar);
    big.initialize(unitDefinition(1.2));
    big.render(presentation() as any);

    const normal = stubUnitView(load, bar);
    normal.initialize(unitDefinition(1));
    normal.render(presentation() as any);

    const ratio = big.healthBar.node.position.y / normal.healthBar.node.position.y;
    assert.ok(Math.abs(ratio - 1.2) < 1e-6, `血条高度应随体型等比缩放，实际比值 ${ratio}`);
});

// ==================== 真表 ====================

test('T1 真表：每个兵种卡的 prefabSize 都是合法正数，建筑卡留空', () => {
    const rows = readPvpRows('pvpCard');
    const issues: string[] = [];
    let unitRows = 0;
    for (const row of rows) {
        const label = `${row.id} 「${String(row.name)}」`;
        if (!isUnitRow(row)) {
            // 建筑卡：不该有 prefabSize（填了也不影响，但说明表口径乱了，值得报出来）
            if (row.prefabSize !== null && row.prefabSize !== undefined) {
                issues.push(`${label} 是建筑卡却有 prefabSize=${String(row.prefabSize)}`);
            }
            continue;
        }
        unitRows += 1;
        const size = row.prefabSize;
        if (typeof size !== 'number' || !(size > 0)) {
            issues.push(`${label} 的 prefabSize=${String(size)} 不是正数（转表后应为 number）`);
        }
    }
    assert.deepEqual(issues, [], `pvpCard.prefabSize 体检未通过：\n${issues.join('\n')}`);
    // 防空转：判据退化成「零行」时会安静地永远通过。
    assert.ok(unitRows > 0, 'pvpCard 里应当有兵种卡');
});

test('T2 真表：解析层读出的 prefabSize 与表里逐字一致（不是各算各的）', () => {
    const rows = readPvpRows('pvpCard');
    const skills = new Map<number, unknown>(rows
        .filter((row) => typeof row.unitSkillId === 'number')
        .map((row) => [Number(row.unitSkillId), { skillId: Number(row.unitSkillId) }]));
    const units = parseUnits(rows, skills as unknown as Parameters<typeof parseUnits>[1]);

    const mismatched: string[] = [];
    for (const [unitId, definition] of units) {
        const row = rows.find((candidate) => String(candidate.unitId) === unitId || String(candidate.id) === unitId);
        const expected = Number(row?.prefabSize);
        if (definition.prefabSize !== expected) {
            mismatched.push(`${String(row?.name)}：表 ${expected} vs 解析 ${definition.prefabSize}`);
        }
    }
    assert.deepEqual(mismatched, [], `prefabSize 未如实透传：\n${mismatched.join('\n')}`);
    assert.ok(units.size > 0, '应当解析出可上场单位');
});
