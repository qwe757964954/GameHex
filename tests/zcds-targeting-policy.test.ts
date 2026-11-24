import assert from 'node:assert/strict';
import test from 'node:test';
import type { ZCUnitDefinition } from '../assets/script/app/zcds/model/ZCCombatCatalog';
import type { ZCUnitState } from '../assets/script/app/zcds/model/ZCGameTypes';
import type { ZCMatchMap } from '../assets/script/app/zcds/model/ZCMatchConfig';
import { ZCMapGeometry } from '../assets/script/app/zcds/model/ZCMapGeometry';
import { ZCTargetingSystem } from '../assets/script/app/zcds/model/systems/ZCTargetingSystem';
import { ZCUnitTargeting } from '../assets/script/app/zcds/model/systems/ZCUnitTargeting';
import { ZCUnitSystem, type IZCUnitContext } from '../assets/script/app/zcds/model/systems/ZCUnitSystem';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../assets/script/core/hex/HexGridLayout';
import { compileZCNeutralResourceCatalog } from '../assets/script/app/zcds/model/ZCNeutralResourceGroup';
import { ZC_RUNTIME_CONFIG } from '../assets/script/app/zcds/model/ZCRuntimeConfigStore';

function fixture() {
    const definition = { unitId: 'u', canAttackAir: true, flying: false, bodyRadius: 20, attackRange: 100,
        attackInterval: 1, attackHitTime: 0.1, attackDuration: 0.2, attackProfile: {} } as ZCUnitDefinition;
    const unit = (id: number, x: number): ZCUnitState => ({
        id, owner: id === 1 ? 'player' : 'enemy', unitId: 'u', cardId: 'u', tier: 1, sourceHexId: 0,
        freeX: x, freeY: 0, hp: 100, maxHp: 100, targetHexId: null, progress: 0,
        targetUnitId: null, targetWallHexId: null, targetBuildingHexId: null, battleState: 'target',
        stateTime: 0, nextAttackAt: 0, waitUntil: 0, attackHitDone: false, hatredUnitId: null, hatredUntil: 0,
        facingRadians: 0, deathRemoveAt: 0, marchAngle: null,
    });
    const me = unit(1, 0), attacker = unit(2, 100), nearest = unit(3, 60);
    const units = [me, attacker, nearest];
    const byId = new Map(units.map(value => [value.id, value]));
    const map = { hexes: [{ id: 0, x: 0, y: 0, neighbors: [], playable: true }] } as unknown as ZCMatchMap;
    let now = 0;
    const position = (value: ZCUnitState, out = { x: 0, y: 0 }) => {
        out.x = value.freeX; out.y = value.freeY; return out;
    };
    const targetContext = {
        get now() { return now; }, units, hexes: [], unitById: (id: number) => byId.get(id) ?? null,
        effectiveDefinition: () => definition, baseDefinition: () => definition, unitPosition: position,
        hexPosition: () => ({ x: 0, y: 0 }), hasExposedWall: () => false,
    };
    let hexProvider = (_id: number): any => null;
    const targeting = new ZCUnitTargeting({
        map, geometry: new ZCMapGeometry(map), units: byId, targeting: targetContext, combatDistanceScale: 1,
        effectiveDefinition: () => definition, baseDefinition: () => definition, unitPosition: position,
        hex: (id: number) => hexProvider(id), hasExposedWall: () => false,
    });
    const context: IZCUnitContext = {
        now: () => now, effectiveDefinition: () => definition, random: () => 0, controlOf: () => null,
        unitById: byId, targeting, sendAttack: value => { value.attackHitDone = true; },
        movement: { advanceTowardUnit: () => {}, advanceUnitMovement: () => {},
            startMarch: value => { value.marchAngle = 0; }, advanceMarch: value => { value.freeX += 1; } },
    };
    return { me, attacker, nearest, targeting, targetContext, context, definition, setNow: (value: number) => { now = value; }, setHexProvider: (fn: (id: number) => any) => { hexProvider = fn; } };
}

test('仇恨评分在有效期内×0.25，过期回到最近，同分先保持当前目标再按 id', () => {
    const f = fixture();
    f.me.hatredUnitId = f.attacker.id; f.me.hatredUntil = 5;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.attacker.id);
    f.setNow(5.01);
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.nearest.id);
    f.attacker.freeX = 60; f.me.targetUnitId = f.nearest.id;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.nearest.id);
    f.me.targetUnitId = null;
    assert.equal(ZCTargetingSystem.acquire(f.me, f.targetContext)?.id, f.attacker.id);
});

test('射程 A 连续跨过 100，统一补一半目标半径并只缩放一次', () => {
    const f = fixture();
    for (const range of [60, 100, 101, 120, 500]) {
        f.definition.attackRange = range;
        assert.equal(ZCTargetingSystem.attackReach(f.definition, 20, 0.3), (range + 10) * 0.3);
    }
});

test('卡牌价值与距离、仇恨相乘，索引和普通扫描一致，技能仍取最近', () => {
    const f = fixture();
    f.attacker.unitId = 'valuable';
    f.nearest.unitId = 'tank';
    f.attacker.freeX = 80;
    const baseDefinition = (id: string) => ({ ...f.definition, valueFactor: id === 'valuable' ? 0.65 : 1.25 });
    const context = { ...f.targetContext, baseDefinition };
    const indexed = { ...context, unitsOf: owner => context.units.filter(unit => unit.owner === owner) };
    for (const candidate of [context, indexed]) {
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.attacker.id, '80px 高价值优于60px坦克');
        f.attacker.freeX = 90;
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.nearest.id, '价值不能压过足够大的距离差');
        f.me.hatredUnitId = f.attacker.id;
        f.me.hatredUntil = 5;
        assert.equal(ZCTargetingSystem.acquire(f.me, candidate)?.id, f.attacker.id, '仇恨与价值同时生效');
        f.attacker.freeX = 80;
        f.me.hatredUnitId = null;
    }
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, context.units, 200, context)?.id, f.nearest.id);
});

test('仇恨快捷候选也乘价值系数，等评分保持当前再按 id', () => {
    const f = fixture();
    f.attacker.unitId = 'low';
    const context = { ...f.targetContext,
        baseDefinition: (id: string) => ({ ...f.definition, valueFactor: id === 'low' ? 4 : 1 }) };
    f.me.hatredUnitId = f.attacker.id; f.me.hatredUntil = 5;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.nearest.id);
    f.me.hatredUnitId = null;
    f.attacker.freeX = 30;
    f.me.targetUnitId = f.nearest.id;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.nearest.id);
    f.me.targetUnitId = null;
    assert.equal(ZCTargetingSystem.acquire(f.me, context)?.id, f.attacker.id);
});

test('等待出手和追击时保持合法目标，不因更近单位出现而换人', () => {
    const f = fixture();
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'waitAttack';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.battleState, 'attack');
    f.me.battleState = 'move'; f.attacker.freeX = 200;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, f.attacker.id);
});

test('追击满 5 秒即脱战，原目标回射程前不再锁，回射程恢复', () => {
    const f = fixture();
    f.nearest.hp = 0; f.attacker.freeX = 200;
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.setNow(5);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.battleState, 'moveForward');
    assert.equal(f.me.targetUnitId, null);
    f.targeting.acquire(f.me);
    assert.equal(f.me.targetUnitId, null);
    f.attacker.freeX = f.me.freeX + 100;
    f.targeting.acquire(f.me);
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.disengagedUnitIds, undefined);
});

test('追击离开起点 3 格即脱战；射程内战斗清掉追击计时', () => {
    const f = fixture();
    f.nearest.hp = 0; f.attacker.freeX = 500;
    f.me.targetUnitId = f.attacker.id; f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.me.freeX = 3 * HEX_GRID_LOGICAL_ROW_STEP;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, null);
    f.attacker.freeX = f.me.freeX + 50;
    f.targeting.acquire(f.me); f.me.battleState = 'move';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.chase, undefined);
});

test('技能独立选敌：Range 限半径，All 全场；不改普攻锁定，同距按 id，过滤无效目标', () => {
    const f = fixture();
    f.me.targetWallHexId = 9;
    const units = [f.me, f.nearest, f.attacker];
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 50, f.targetContext), null);
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 50, f.targetContext, 2)?.id, f.nearest.id);
    f.attacker.freeX = f.nearest.freeX;
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 100, f.targetContext)?.id, f.attacker.id);
    f.attacker.battleState = 'dead'; f.nearest.hp = 0;
    assert.equal(ZCTargetingSystem.acquireSkillUnit(f.me, units, 100, f.targetContext, 2), null);
    assert.equal(f.me.targetWallHexId, 9);
});

test('追击后在 idle 近身交战会清除旧追击，新追击重新计时', () => {
    const f = fixture();
    f.me.targetUnitId = f.attacker.id;
    f.me.battleState = 'idle';
    f.me.nextAttackAt = 100;
    f.me.chase = { x: 0, y: 0, startedAt: 0 };
    f.setNow(10);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.chase, undefined);
    f.attacker.freeX = 200;
    f.setNow(11);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    f.setNow(11.05);
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.battleState, 'move');
    assert.equal(f.me.targetUnitId, f.attacker.id);
    assert.equal(f.me.chase?.startedAt, 11.05);
});

test('受击仇恨打断对城墙建筑的锁定并反击近身攻击者', () => {
    const f = fixture();
    f.me.targetWallHexId = 5;
    f.me.battleState = 'idle';
    f.me.hatredUnitId = f.attacker.id;
    f.me.hatredUntil = 10;
    f.attacker.freeX = 50;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.targetUnitId, f.attacker.id, '受击仇恨应当打破对墙的锁定转而攻击近身敌人');
    assert.equal(f.me.targetWallHexId, null);
});

test('脱战单位攻击我方时受击仇恨解除脱战限制并允许反击', () => {
    const f = fixture();
    f.nearest.hp = 0; // 排除 nearest 干扰
    f.me.disengagedUnitIds = [f.attacker.id];
    f.me.hatredUnitId = f.attacker.id;
    f.me.hatredUntil = 10;
    f.attacker.freeX = 150; // 在普攻射程外
    f.targeting.acquire(f.me);
    assert.equal(f.me.targetUnitId, f.attacker.id, '受击仇恨应允许反击脱战单位');
    assert.equal(f.me.disengagedUnitIds, undefined, '攻击我方的单位应从脱战名单中移除');
});

test('寻路返回 null 时单位目标立即脱战避免 idle-move 无限震荡', () => {
    const f = fixture();
    f.nearest.hp = 0;
    f.attacker.sourceHexId = 2; // 不同地块以触发寻路 findStepToward
    f.me.targetUnitId = f.attacker.id;
    f.me.battleState = 'move';
    f.attacker.freeX = 500;
    // 模拟目标处于不可达位置导致 findStepToward 返回 null
    f.targeting.findStepToward = () => null;
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.battleState, 'target', '无路可达应切回 target 避免卡死在 move/idle');
    assert.equal(f.me.targetUnitId, null, '目标应被清除');
    assert.ok(f.me.disengagedUnitIds?.includes(f.attacker.id), '不可达目标应被加入脱战名单');
});

test('等距评分时 Hex ID 不会因 ID 较小而踩掉已选中的单位', () => {
    const f = fixture();
    f.nearest.hp = 0; // 排除 nearest 干扰
    f.attacker.freeX = 100;
    const hexPosition = (id: number) => ({ x: 100, y: 0 }); // 距离完全相同 (100)
    const targetContext = {
        ...f.targetContext,
        hexPosition,
        candidateHexes: () => [{ id: 1, owner: 'enemy' as const, building: 'none' as const, wallHp: 100, hp: 100 }] as any,
        hasExposedWall: () => true,
    };
    const selection = ZCTargetingSystem.acquire(f.me, targetContext as any);
    assert.equal(selection?.kind, 'unit', '同等距离下单位优先于地块，不能因为 hexId 较小被覆盖');
    assert.equal(selection?.id, f.attacker.id);
});

test('取消 BOSS 集火后 refreshPriorityTarget 能解绑并重选目标', () => {
    ZC_RUNTIME_CONFIG.updateCatalogs({
        neutralResources: compileZCNeutralResourceCatalog([
            { groupId: 1, id: 1400101, groupName: 'monster', resourceType: 11, weight: 10000, param: { resId: 'u', wakeRange: 2, reviveRate: 1 } },
        ], new Map([['u', { id: 'u', type: 2 }]] as any)),
    });
    try {
        const f = fixture();
        f.nearest.hp = 0;
        f.me.targetBuildingHexId = 9;
        const hex = {
            id: 9,
            neutralResourceId: 1400101,
            neutralFeature: {
                awake: true,
                claimed: false,
                focusOwners: [] as string[], // 玩家已取消集火
            },
            hp: 1000,
            maxHp: 1000,
        };
        (f.targeting as any).context.hex = (id: number) => id === 9 ? hex : null;
        (f.targeting as any).context.priorityMonster = () => null;
        (f.targeting as any).context.hasFocusableMonster = () => true;

        const refreshed = f.targeting.refreshPriorityTarget(f.me);
        assert.equal(refreshed, true, '取消集火应返回 true 表示目标发生更新');
        assert.equal(f.me.targetBuildingHexId, null, 'BOSS 地块应被清空');
        assert.equal(f.me.targetUnitId, f.attacker.id, '应重新索敌并锁定敌方小兵');
    } finally {
        ZC_RUNTIME_CONFIG.updateCatalogs({ neutralResources: undefined });
    }
});

test('仇恨垃圾回收：过期或目标死亡时主动置空 hatredUnitId', () => {
    const f = fixture();
    f.me.hatredUnitId = f.attacker.id;
    f.me.hatredUntil = 2; // 当前时间是 0，2 秒后过期
    
    // 1. 仇恨有效时
    ZCTargetingSystem.acquire(f.me, f.targetContext as any);
    assert.equal(f.me.hatredUnitId, f.attacker.id, '未过期时保留');

    // 2. 推进时间至过期后
    f.setNow(3);
    ZCTargetingSystem.acquire(f.me, f.targetContext as any);
    assert.equal(f.me.hatredUnitId, null, '过期后 acquire 应主动置空 hatredUnitId');
    assert.equal(f.me.hatredUntil, 0);

    // 3. 目标死亡主动清理
    f.me.hatredUnitId = f.attacker.id;
    f.me.hatredUntil = 10;
    f.attacker.hp = 0;
    f.attacker.battleState = 'dead';
    ZCUnitSystem.update([f.me], 0.05, f.context);
    assert.equal(f.me.hatredUnitId, null, '目标死亡后帧更新应主动置空 hatredUnitId');
    assert.equal(f.me.hatredUntil, 0);

    // 4. removeUnit 批量清理
    f.me.hatredUnitId = f.nearest.id;
    f.me.hatredUntil = 10;
    f.targeting.removeUnit(f.nearest.id);
    assert.equal(f.me.hatredUnitId, null, 'removeUnit 时应清空关联存活单位的仇恨引用');
});

test('硬控期间仇恨窗口顺延：受控时间不损耗仇恨寿命，解控后正常反击', () => {
    const f = fixture();
    f.nearest.hp = 0; // 排除干扰
    f.me.hatredUnitId = f.attacker.id;
    f.me.hatredUntil = 5; // 5 秒仇恨窗口 (当前 now = 0)
    f.attacker.freeX = 80;

    let isStunned = true;
    (f.context as any).controlOf = () => isStunned ? { kind: 'stun', defId: 's1' } : null;

    // 模拟被硬控 3 秒 (共 30 帧，每帧 0.1s)
    for (let i = 0; i < 30; i++) {
        f.setNow(Math.round(((i + 1) * 0.1) * 10) / 10);
        ZCUnitSystem.update([f.me], 0.1, f.context);
    }

    assert.equal(f.targetContext.now, 3);
    assert.equal(f.me.hatredUnitId, f.attacker.id, '受控期间仇恨目标不丢失');
    // 原仇恨截至 5s，经 3s 硬控顺延后应为 8s (剩余窗口依旧是 5s)
    assert.equal(Math.round(f.me.hatredUntil), 8, '受控期间仇恨到期时刻应随硬控时长顺延');

    // 解除硬控
    isStunned = false;
    f.setNow(3.1);
    ZCUnitSystem.update([f.me], 0.1, f.context);

    // 解控后成功锁定仇恨攻击者
    assert.equal(f.me.targetUnitId, f.attacker.id, '解控后应顺利反击仇恨目标');
});

test('近身拆家威胁打破追击锁：走位追人状态下近身敌人攻击我方城墙时转火守家', () => {
    const f = fixture();
    f.setHexProvider((id: number) => id === 10 ? { id: 10, owner: 'player', building: 'none', wallHp: 100, hp: 100 } : null);

    // 1. 我方小兵 me (id=1, freeX=0, 射程 100px)，原本锁定了远处的敌方 nearest (freeX=250)，处于 move 追人状态
    f.nearest.freeX = 250;
    f.nearest.owner = 'enemy';
    f.me.targetUnitId = f.nearest.id;
    f.me.battleState = 'move';

    // 2. 近身 80px 处的敌方 attacker (id=2, freeX=80)，正在攻击我方城墙 (targetWallHexId=10)
    f.attacker.freeX = 80;
    f.attacker.targetWallHexId = 10;
    f.attacker.battleState = 'attack';

    // 3. 推进一帧
    ZCUnitSystem.update([f.me], 0.05, f.context);

    // 4. 验证成功打破对远处目标的追击锁定，转而锁定近身拆家的 attacker
    assert.equal(f.me.targetUnitId, f.attacker.id, '近身有敌方攻击我方建筑时，应打破对远处目标的追击锁');
    assert.equal(f.me.hatredUnitId, f.attacker.id, '应自动获得对拆家怪的仇恨');
});

test('建筑受击求援广播（Guard Aggro）：守家半径内空闲或追击友军被唤醒并锁定拆迁者', () => {
    const f = fixture();
    f.nearest.hp = 0; // 排除干扰
    // 模拟建筑位于 (0, 0)
    const buildingHex = { id: 1, owner: 'player' as const, building: 'hq' as const, hp: 1000, wallHp: 0 };
    f.setHexProvider((id: number) => id === 1 ? buildingHex : null);

    // 守卫 A：距离建筑 80px (在 150px 守家半径内)，处于 idle 态
    f.me.freeX = 80;
    f.me.freeY = 0;
    f.me.battleState = 'idle';

    // 守卫 B：距离建筑 260px (超出 150px 守家半径)，处于 idle 态
    const farGuard = { ...f.me, id: 4, freeX: 260, freeY: 0, hatredUnitId: null, hatredUntil: 0, targetUnitId: null };

    // 攻击者：敌方小兵 attacker (id=2)，攻击建筑
    f.attacker.freeX = 20;
    f.attacker.freeY = 0;

    // 模拟 ZCGameModel.broadcastStructureGuardAggro 的逻辑
    const units = [f.me, farGuard, f.attacker];
    const center = { x: 0, y: 0 };
    const GUARD_RADIUS_SQ = 150 * 150;
    const now = 10;
    for (const unit of units) {
        if (unit.owner !== buildingHex.owner || unit.battleState === 'dead' || unit.hp <= 0) continue;
        const distSq = (unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2;
        if (distSq > GUARD_RADIUS_SQ) continue;
        unit.hatredUnitId = f.attacker.id;
        unit.hatredUntil = now + 5;
        f.targeting.acquire(unit);
    }

    assert.equal(f.me.hatredUnitId, f.attacker.id, '守家半径内的友军应获得对攻击者的仇恨');
    assert.equal(f.me.targetUnitId, f.attacker.id, '守家半径内的友军应主动锁定攻击者');
    assert.equal(farGuard.hatredUnitId, null, '超出守家半径的远处友军不应被惊动');
    assert.equal(farGuard.targetUnitId, null);
});
