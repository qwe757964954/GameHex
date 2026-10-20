import { ZCArtifactSystem } from './systems/ZCArtifactSystem';
import { ZCEconomySystem } from './systems/ZCEconomySystem';
import { ZCCardType } from './ZCCombatCatalog';
import type { DeepReadonly, OwnerNumberRecord, ZCHexState, ZCSnapshot, ZCUnitState } from './ZCGameTypes';
import {
    ZCBuildingType, ZCCombatFloatTextKind, ZCCombatTargetKind,
    ZCGameStatus, ZCTileState, ZCUnitBattleState,
} from './ZCGameTypes';
import { ownersForPlayerCount, type ZCFaction, type ZCOwner } from './ZCMapConfig';
import type { ZCMatchConfig } from './ZCMatchConfig';
import { resolveZCUnitDefinition } from './ZCModifierRuntime';
import { ZCNeutralResourceId } from './ZCNeutralResourceReward';
import { createPvpTileTypes, ZCPvpTileType } from './ZCPvpTileRules';
import { ZCStatusSystem } from './ZCStatusEffect';

export type ZCSnapshotLoadResult =
    | { ok: true; snapshot: ZCSnapshot }
    | { ok: false; errors: readonly string[] };

/** 存档的校验、version 4 字段迁移和独立拷贝。 */
function createTypeCounts(): Record<ZCCardType, number> {
    return {
        [ZCCardType.Mine]: 0,
        [ZCCardType.Barracks]: 0,
        [ZCCardType.Tower]: 0,
        [ZCCardType.Wall]: 0,
        [ZCCardType.Hq]: 0,
    };
}

function ownerNumbers(owners: readonly ZCOwner[], value = 0): OwnerNumberRecord {
    return Object.fromEntries(owners.map((owner) => [owner, value])) as OwnerNumberRecord;
}

function ownerTypeCounts(owners: readonly ZCOwner[]): ZCSnapshot['builtTypeCounts'] {
    return Object.fromEntries(owners.map((owner) => [owner, createTypeCounts()])) as ZCSnapshot['builtTypeCounts'];
}

/**
 * 外部快照字段是否落在取值真源里。
 *
 * `value` 是 `unknown`（快照来自存档 / 网络，不可信），所以不带类型收窄、只做布尔判定；
 * 取值集合一律来自 `ZCGameTypes` 的 `as const` 数组，别在调用处再手写一份字面量数组。
 */
function oneOf(values: readonly string[], value: unknown): boolean {
    return typeof value === 'string' && values.includes(value);
}

export class ZCSnapshotCodec {
    /**
     * 旧存档曾允许的占领进度上限；只用于读档兼容校验，不再参与玩法判定。
     * 原在 `systems/ZCCaptureSystem.ts` 导出，但唯一消费方是本 codec ——
     * 按 §6.2 第 12 条内聚为私有静态。
     */
    private static readonly LEGACY_CAPTURE_MAX_SECONDS = 1;

    static createInitialState(match: ZCMatchConfig, random: () => number = Math.random): ZCSnapshot {
        const rules = match.rules;
        const owners = ownersForPlayerCount(match.map.playerCount ?? 2);
        // 统一主城列表（v3 homes 优先；兼容 legacy playerHomeId/enemyHomeId）。
        // select 模式未配置的默认主城为 -1 / null，过滤掉，对应下标不建归属。
        const homeIds: readonly number[] = match.map.homes?.length
            ? match.map.homes
            : [match.map.playerHomeId, match.map.enemyHomeId].filter((id) => Number.isInteger(id)) as number[];
        const tileTypes = createPvpTileTypes(random, match);
        const resolvedResources = new Map((match.map.resolvedResources ?? []).map((item) => [item.hexId, item.resourceId]));
        // select 地图的 owners 全是 neutral，主城格与主城邻格的归属必须按 homes 下标显式建立：
        // 主城格 owner=对应方（building=hq），周围 6 格 owner=对应方（已占领、未开发，可建造）。
        const homeOwnerById = new Map<number, ZCOwner>();
        const homeNeighborOwner = new Map<number, ZCOwner>();
        homeIds.forEach((homeId, index) => {
            if (homeId < 0) return;
            const homeOwner = owners[index];
            homeOwnerById.set(homeId, homeOwner);
            const homeConfig = match.map.hexes[homeId];
            for (const neighborId of homeConfig?.neighbors ?? []) {
                if (!homeNeighborOwner.has(neighborId)) homeNeighborOwner.set(neighborId, homeOwner);
            }
        });
        const hexes: ZCHexState[] = match.map.hexes.map((config) => {
            const neutralResourceId = resolvedResources.get(config.id) ?? null;
            //  这里**不再**按「与主城相邻」预置解锁（2026-10-08）。
            //   旧逻辑会把贴主城的资源格直接置成 `developed` + `developmentResolved`，
            //   于是它永远进不了 `ZCGameModel.claimAdjacentNeutralResources` 的自动领取循环
            //   ⇒ 奖励一次都不发（这正是「翻了没获取」的历史成因之一）。
            //   现在统一走「相邻自动领取」：初始一律中立未消费，由模型层在状态刷新时结算。
            const homeOwner = homeOwnerById.get(config.id);
            const neighborOwner = homeOwner === undefined ? homeNeighborOwner.get(config.id) : undefined;
            const isHome = homeOwner !== undefined;
            const owner: ZCFaction = neutralResourceId !== null ? 'neutral'
                : homeOwner ?? neighborOwner ?? match.map.owners[config.id];
            const building: ZCBuildingType = isHome ? 'hq' : 'none';
            // 主城耐久：卡表「主城」行（`baseHp + 品级1×cyclePerTierValue`），已拍进 rules。
            const maxHp = isHome ? rules.hqMaxHp : 0;
            const wallMaxHp = isHome ? rules.wallMaxHp : 0;
            const tileType = isHome || neutralResourceId !== null || !config.playable ? null : tileTypes[config.id];
            return {
                id: config.id,
                owner,
                state: isHome ? 'developed'
                    : owner === 'neutral' && config.playable ? 'occupiable' : 'occupied',
                building,
                tier: isHome ? 1 : 0,
                hp: maxHp,
                maxHp,
                wallHp: wallMaxHp,
                wallMaxHp,
                wallBreachedEdge: null,
                developmentCost: tileType ? match.tiles[tileType].price : 25,
                tileType,
                developmentResolved: isHome,
                cardId: null,
                neutralResourceId,
                constructionRemainingSeconds: 0,
                constructionTotalSeconds: 0,
                captureOwner: null,
                captureSeconds: 0,
            };
        });
        return {
            version: 4,
            mapId: match.map.id,
            configHash: match.configHash ?? 'legacy',
            elapsedSeconds: 0,
            pendingSeconds: 0,
            durationSeconds: rules.matchDurationSeconds,
            playerGold: rules.initialGold,
            enemyGold: rules.initialGold,
            goldByOwner: ownerNumbers(owners, rules.initialGold),
            artifactReadyUses: 0,
            artifactCharge: 0,
            artifactCooldown: 0,
            enemyFrozenSeconds: 0,
            status: 'playing',
            resultReason: '',
            hexes,
            units: [],
            nextUnitId: 1,
            incomeClock: 0,
            aiClock: 0,
            towerClock: 0,
            spawnClocks: {},
            drawCursor: ownerNumbers(owners),
            allRandomNonGoldDraws: ownerNumbers(owners),
            builtTypeCounts: ownerTypeCounts(owners),
            combatEvents: [],
            projectiles: [],
            nextCombatEventId: 1,
            statusEffects: { nextUid: 1, units: [] },
            groundZones: [],
        };
    }


    static errors(value: unknown, config: ZCMatchConfig): string[] {
        const errors: string[] = [];
        const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
        const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
        const integer = (v: unknown) => nonnegative(v) && Number.isSafeInteger(v);
        const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
        const check = (ok: boolean, path: string) => { if (!ok) errors.push(path); };
        if (!record(value)) return ['snapshot'];
        const data = value;
        const owners = ownersForPlayerCount(config.map.playerCount ?? 2);
        const ownerSet = new Set<string>(owners);
        const combatFloatTextKinds = new Set<string>(Object.values(ZCCombatFloatTextKind));
        check(data.version === 4, 'version');
        check(data.mapId === config.map.id, 'mapId');
        check(data.configHash === undefined || data.configHash === (config.configHash ?? 'legacy'), 'configHash');
        for (const key of ['elapsedSeconds', 'playerGold', 'enemyGold', 'incomeClock', 'aiClock', 'towerClock']) {
            check(nonnegative(data[key]), key);
        }
        check(data.goldByOwner === undefined || record(data.goldByOwner)
            && owners.every((owner) => nonnegative(data.goldByOwner[owner])), 'goldByOwner');
        check(nonnegative(data.durationSeconds) && data.durationSeconds > 0, 'durationSeconds');
        check(optional(data.pendingSeconds, nonnegative), 'pendingSeconds');
        check(oneOf(Object.values(ZCGameStatus), data.status), 'status');
        check(typeof data.resultReason === 'string', 'resultReason');
        check(record(data.spawnClocks) && Object.entries(data.spawnClocks).every(([key, clock]) => (
            /^(?:(?:mine|barracks|tower|hq):)?[0-9]+$/.test(key)
            && Number(key.split(':').pop()) < config.map.hexes.length && nonnegative(clock)
        )), 'spawnClocks');
        for (const key of ['drawCursor', 'allRandomNonGoldDraws']) {
            check(key === 'allRandomNonGoldDraws' && data[key] === undefined
                || record(data[key]) && owners.every((owner) => integer(data[key][owner])), key);
        }
        check(record(data.builtTypeCounts) && owners.every((owner) => (
            record(data.builtTypeCounts[owner]) && Object.values(ZCCardType).every((type) => integer(data.builtTypeCounts[owner][type]))
        )), 'builtTypeCounts');
        const validHexId = (id: unknown) => integer(id) && !!config.map.hexes[id as number]?.playable;
        const reference = (id: unknown) => id === null || validHexId(id);
        if (!Array.isArray(data.hexes) || data.hexes.length !== config.map.hexes.length) errors.push('hexes');
        else data.hexes.forEach((hex: unknown, index: number) => {
            const path = `hexes[${index}]`;
            if (!record(hex)) { errors.push(path); return; }
            check(hex.id === index, `${path}.id`);
            check(hex.owner === 'neutral' || ownerSet.has(hex.owner), `${path}.owner`);
            check(oneOf(Object.values(ZCTileState), hex.state), `${path}.state`);
            check(oneOf(Object.values(ZCBuildingType), hex.building), `${path}.building`);
            check(integer(hex.tier), `${path}.tier`);
            for (const key of ['hp', 'maxHp', 'developmentCost']) check(nonnegative(hex[key]), `${path}.${key}`);
            for (const key of ['wallHp', 'wallMaxHp', 'constructionRemainingSeconds', 'constructionTotalSeconds']) {
                check(optional(hex[key], nonnegative), `${path}.${key}`);
            }
            check(optional(hex.wallBreachedEdge, (v) => v === null || integer(v) && (v as number) <= 5), `${path}.wallBreachedEdge`);
            check(optional(hex.developmentResolved, (v) => typeof v === 'boolean'), `${path}.developmentResolved`);
            check(optional(hex.captureOwner, v => v === null || typeof v === 'string' && ownerSet.has(v)), `${path}.captureOwner`);
            const captureMax = Math.max(config.rules.captureSeconds, ZCSnapshotCodec.LEGACY_CAPTURE_MAX_SECONDS);
            check(optional(hex.captureSeconds, v => nonnegative(v) && v <= captureMax), `${path}.captureSeconds`);
            if (nonnegative(hex.captureSeconds) && hex.captureSeconds > 0) check(typeof hex.captureOwner === 'string' && ownerSet.has(hex.captureOwner), `${path}.captureOwner`);
            check(hex.cardId === null || typeof hex.cardId === 'string', `${path}.cardId`);
            check(optional(hex.neutralResourceId, (v) => v === null || oneOf(Object.values(ZCNeutralResourceId), v)), `${path}.neutralResourceId`);
            check(optional(hex.tileType, (v) => v === null || typeof v === 'number' && Object.prototype.hasOwnProperty.call(config.tiles, v)), `${path}.tileType`);
            const mapHex = config.map.hexes[index];
            if (!mapHex.playable) {
                check(hex.owner === 'neutral', `${path}.owner`);
                check(hex.building === 'none', `${path}.building`);
                // 早期 version 4 快照可能尚未写入 tileType；decode 后会统一补成 null。
                check(hex.tileType == null, `${path}.tileType`);
                check((hex.neutralResourceId ?? null) === null, `${path}.neutralResourceId`);
                check((hex.wallHp ?? 0) === 0 && (hex.wallMaxHp ?? 0) === 0, `${path}.wallHp`);
                check((hex.captureSeconds ?? 0) === 0 && (hex.captureOwner ?? null) === null, `${path}.captureSeconds`);
            }
        });
        const ids = new Set<number>();
        const definitions = new Set(config.units.map((unit) => unit.unitId));
        if (!Array.isArray(data.units)) errors.push('units');
        else data.units.forEach((unit: unknown, index: number) => {
            const path = `units[${index}]`;
            if (!record(unit)) { errors.push(path); return; }
            check(integer(unit.id) && unit.id > 0 && !ids.has(unit.id), `${path}.id`);
            ids.add(unit.id);
            check(ownerSet.has(unit.owner), `${path}.owner`);
            check(definitions.has(unit.unitId), `${path}.unitId`);
            check(typeof unit.cardId === 'string', `${path}.cardId`);
            check(validHexId(unit.sourceHexId), `${path}.sourceHexId`);
            check(reference(unit.targetHexId), `${path}.targetHexId`);
            check(integer(unit.tier) && unit.tier > 0, `${path}.tier`);
            for (const key of ['hp', 'maxHp', 'progress']) check(nonnegative(unit[key]), `${path}.${key}`);
            check(optional(unit.attackMultiplier, (value) => typeof value === 'number' && Number.isFinite(value) && value > 0), `${path}.attackMultiplier`);
            check(optional(unit.shield, nonnegative), `${path}.shield`);
            check(unit.progress <= 1, `${path}.progress`);
            check(optional(unit.battleState, (v) => oneOf(Object.values(ZCUnitBattleState), v)), `${path}.battleState`);
            for (const key of ['targetWallHexId', 'targetBuildingHexId']) check(optional(unit[key], reference), `${path}.${key}`);
            for (const key of ['targetUnitId', 'hatredUnitId']) check(optional(unit[key], (v) => v === null || integer(v) && (v as number) > 0), `${path}.${key}`);
            for (const key of ['stateTime', 'nextAttackAt', 'waitUntil', 'hatredUntil', 'deathRemoveAt', 'completedAttackCount', 'empoweredReadyAt']) {
                check(optional(unit[key], nonnegative), `${path}.${key}`);
            }
            for (const key of ['freeX', 'freeY', 'facingRadians']) check(optional(unit[key], Number.isFinite), `${path}.${key}`);
            check(optional(unit.marchAngle, (v) => v === null || Number.isFinite(v)), `${path}.marchAngle`);
            check(optional(unit.attackHitDone, (v) => typeof v === 'boolean'), `${path}.attackHitDone`);
        });
        let maxUnitId = 0;
        for (const id of ids) if (integer(id)) maxUnitId = Math.max(maxUnitId, id);
        check(integer(data.nextUnitId) && data.nextUnitId > maxUnitId, 'nextUnitId');
        const projectileIds = new Set<number>();
        if (data.projectiles !== undefined && !Array.isArray(data.projectiles)) errors.push('projectiles');
        else (data.projectiles ?? []).forEach((projectile: unknown, index: number) => {
            const path = `projectiles[${index}]`;
            if (!record(projectile)) { errors.push(path); return; }
            check(integer(projectile.id) && projectile.id > 0 && !projectileIds.has(projectile.id), `${path}.id`);
            projectileIds.add(projectile.id);
            check(projectile.type === 'projectile', `${path}.type`);
            check(ownerSet.has(projectile.owner), `${path}.owner`);
            check(integer(projectile.sourceUnitId) && projectile.sourceUnitId > 0 && projectile.sourceUnitId < data.nextUnitId, `${path}.sourceUnitId`);
            check(typeof projectile.sourceCardId === 'string', `${path}.sourceCardId`);
            check(oneOf(Object.values(ZCCombatTargetKind), projectile.targetKind), `${path}.targetKind`);
            check(projectile.targetKind === 'unit'
                ? integer(projectile.targetId) && projectile.targetId > 0 && projectile.targetId < data.nextUnitId
                : validHexId(projectile.targetId), `${path}.targetId`);
            check(projectile.targetUnitId === (projectile.targetKind === 'unit' ? projectile.targetId : null), `${path}.targetUnitId`);
            for (const key of ['x', 'y', 'previousX', 'previousY', 'fromX', 'fromY', 'toX', 'toY', 'velocityX', 'velocityY']) check(Number.isFinite(projectile[key]), `${path}.${key}`);
            check(Number.isFinite(projectile.velocityX) && Number.isFinite(projectile.velocityY) && Number.isFinite(Math.hypot(projectile.velocityX, projectile.velocityY)) && Math.hypot(projectile.velocityX, projectile.velocityY) > 0, `${path}.velocity`);
            for (const key of ['baseDamage', 'damage', 'radius', 'collisionRadius', 'startedAt']) check(nonnegative(projectile[key]), `${path}.${key}`);
            check(nonnegative(projectile.startedAt) && projectile.startedAt <= data.elapsedSeconds, `${path}.startedAt`);
            check(nonnegative(projectile.durationSeconds) && projectile.durationSeconds > 0, `${path}.durationSeconds`);
            for (const key of ['canHitAir', 'empowered']) check(typeof projectile[key] === 'boolean', `${path}.${key}`);
            check(optional(projectile.remainingPierces, integer), `${path}.remainingPierces`);
            check(optional(projectile.executeChance, v => nonnegative(v) && (v as number) <= 1), `${path}.executeChance`);
            check(optional(projectile.criticalHit, v => typeof v === 'boolean'), `${path}.criticalHit`);
            check(optional(projectile.splashRadius, nonnegative), `${path}.splashRadius`);
            check(optional(projectile.legacyBuffs, (value) => Array.isArray(value) && value.every((buff) =>
                record(buff) && typeof buff.legacyKey === 'string' && record(buff.params)
    && optional(buff.sourceAttack, nonnegative))), `${path}.legacyBuffs`);
            check(optional(projectile.zoneDamage, nonnegative), `${path}.zoneDamage`);
            check(optional(projectile.zoneDuration, nonnegative), `${path}.zoneDuration`);
            check(optional(projectile.zoneWaves, integer), `${path}.zoneWaves`);
            check(optional(projectile.zoneSlow, v => nonnegative(v) && (v as number) <= 1), `${path}.zoneSlow`);
            check(optional(projectile.hitUnitIds, v => Array.isArray(v)
                && v.every(id => integer(id) && (id as number) > 0 && (id as number) < data.nextUnitId)
                && new Set(v).size === v.length), `${path}.hitUnitIds`);
            check(integer(projectile.skillId), `${path}.skillId`);
            for (const key of ['skillName']) check(typeof projectile[key] === 'string', `${path}.${key}`);
            for (const key of ['effectKey', 'projectileKey']) check(projectile[key] === null || typeof projectile[key] === 'string', `${path}.${key}`);
            check(optional(projectile.effectPrefabPath, v => v === null || typeof v === 'string'), `${path}.effectPrefabPath`);
        });
        check(optional(data.groundZones, v => Array.isArray(v)), 'groundZones');
        if (Array.isArray(data.groundZones)) data.groundZones.forEach((zone: unknown, index: number) => {
            const path = `groundZones[${index}]`;
            if (!record(zone)) { errors.push(path); return; }
            for (const key of ['x', 'y']) check(Number.isFinite(zone[key]), `${path}.${key}`);
            for (const key of ['radius', 'remainingSeconds', 'nextWaveAt', 'waveInterval', 'damage']) check(nonnegative(zone[key]), `${path}.${key}`);
            check(ownerSet.has(zone.owner), `${path}.owner`);
            check(integer(zone.sourceUnitId) && zone.sourceUnitId > 0 && zone.sourceUnitId < data.nextUnitId, `${path}.sourceUnitId`);
            check(integer(zone.skillId), `${path}.skillId`);
            check(typeof zone.skillName === 'string', `${path}.skillName`);
            check(integer(zone.wavesLeft), `${path}.wavesLeft`);
            check(nonnegative(zone.slowRatio) && zone.slowRatio <= 1, `${path}.slowRatio`);
            check(optional(zone.floatTextKind, v => combatFloatTextKinds.has(String(v))), `${path}.floatTextKind`);
            check(optional(zone.effectPrefabPath, v => v === null || typeof v === 'string'), `${path}.effectPrefabPath`);
            check(optional(zone.expireDamage, nonnegative), `${path}.expireDamage`);
            check(optional(zone.expireStatusId, v => typeof v === 'string'), `${path}.expireStatusId`);
            check(optional(zone.expireStatusDuration, nonnegative), `${path}.expireStatusDuration`);
        });
        // 在途弹道复用战斗事件 ID，恢复时不能与后续表现事件冲突。
        check(optional(data.nextCombatEventId, (v) => integer(v) && (v as number) > 0), 'nextCombatEventId');
        for (const id of projectileIds) check(integer(data.nextCombatEventId) && data.nextCombatEventId > id, 'nextCombatEventId');
        if (data.statusEffects !== undefined) errors.push(...ZCStatusSystem.snapshotErrors(data.statusEffects));
        return errors;
    }

    static decode(value: unknown, config: ZCMatchConfig): ZCSnapshotLoadResult {
        const errors = this.errors(value, config);
        if (errors.length) return { ok: false, errors };
        try {
            const state = this.clone(value as ZCSnapshot);
            state.configHash ??= config.configHash ?? 'legacy';
            state.pendingSeconds ??= 0;
            state.projectiles ??= [];
            state.statusEffects ??= { nextUid: 1, units: [] };
            this.normalizeOwners(state, config);
            ZCArtifactSystem.normalize(state, config.rules);
            this.normalizePvpTiles(state, config);
            this.normalizeUnits(state, config);
            state.combatEvents = [];
            if (!Array.isArray(state.groundZones)) state.groundZones = [];
            return { ok: true, snapshot: state };
        } catch (error) {
            return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
        }
    }

    static clone(snapshot: DeepReadonly<ZCSnapshot>): ZCSnapshot {
        return JSON.parse(JSON.stringify(snapshot)) as ZCSnapshot;
    }
    private static normalizeUnits(state: ZCSnapshot, config: ZCMatchConfig): void {
        for (const unit of state.units) {
            const data = unit as ZCUnitState & Record<string, unknown>;
            const baseDefinition = config.units.find((definition) => definition.unitId === unit.unitId)!;
            const definition = resolveZCUnitDefinition(
                baseDefinition,
                config.modifiers?.[unit.owner] ?? [],
            );
            if (!data.battleState) data.battleState = 'target';
            if (!Number.isFinite(data.stateTime)) data.stateTime = 0;
            if (data.targetUnitId === undefined) data.targetUnitId = null;
            if (data.targetWallHexId === undefined) data.targetWallHexId = null;
            if (data.targetBuildingHexId === undefined) data.targetBuildingHexId = null;
            if (!Number.isFinite(data.nextAttackAt)) data.nextAttackAt = state.elapsedSeconds + definition.attackInterval;
            if (!Number.isFinite(data.waitUntil)) data.waitUntil = 0;
            if (typeof data.attackHitDone !== 'boolean') data.attackHitDone = false;
            if (data.hatredUnitId === undefined) data.hatredUnitId = null;
            if (!Number.isFinite(data.hatredUntil)) data.hatredUntil = 0;
            if (!Number.isFinite(data.facingRadians)) data.facingRadians = unit.owner === 'player' ? Math.PI / 2 : -Math.PI / 2;
            if (!Number.isFinite(data.deathRemoveAt)) data.deathRemoveAt = 0;
            //  旧 version 4 快照用 `attackCount`（已完成的普攻次数）——2026-10-13 改名 `completedAttackCount`，
            //  该名字现在归「一次普攻打几段」所有。读侧两种都认，写侧只写新名。
            if (data.completedAttackCount === undefined && Number.isFinite(data.attackCount)) {
                data.completedAttackCount = data.attackCount as number;
            }
            delete data.attackCount;
            if (!Number.isFinite(data.completedAttackCount)) data.completedAttackCount = 0;
            if (!Number.isFinite(data.shield) || (data.shield as number) < 0) data.shield = 0;
            if (!Number.isFinite(data.attackMultiplier) || (data.attackMultiplier as number) <= 0) data.attackMultiplier = 1;
            if (data.marchAngle === undefined) data.marchAngle = null;
            if (!Number.isFinite(data.freeX) || !Number.isFinite(data.freeY)) {
                const source = config.map.hexes[unit.sourceHexId];
                const target = unit.targetHexId === null ? source : config.map.hexes[unit.targetHexId];
                const progress = Number.isFinite(unit.progress) ? unit.progress : 0;
                data.freeX = source.x + (target.x - source.x) * progress;
                data.freeY = source.y + (target.y - source.y) * progress;
            }
        }
        const snapshot = state as ZCSnapshot & Record<string, unknown>;
        if (!Array.isArray(snapshot.combatEvents)) snapshot.combatEvents = [];
        if (!Number.isFinite(snapshot.nextCombatEventId)) snapshot.nextCombatEventId = 1;
    }

    /** 兼容功能开发期生成的 version 4 本地快照。 */
    private static normalizePvpTiles(state: ZCSnapshot, config: ZCMatchConfig): void {
        const owners = ownersForPlayerCount(config.map.playerCount ?? 2);
        const snapshot = state as ZCSnapshot & { allRandomNonGoldDraws?: OwnerNumberRecord };
        if (!snapshot.allRandomNonGoldDraws) snapshot.allRandomNonGoldDraws = ownerNumbers(owners);
        for (const owner of owners) {
            const count = snapshot.allRandomNonGoldDraws[owner];
            snapshot.allRandomNonGoldDraws[owner] = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
        }
        for (const hex of snapshot.hexes) {
            hex.captureOwner ??= null;
            hex.captureSeconds ??= 0;
            if (!config.map.hexes[hex.id].playable) {
                hex.tileType = null;
                continue;
            }
            if (!Number.isFinite(hex.constructionRemainingSeconds) || hex.constructionRemainingSeconds < 0) {
                hex.constructionRemainingSeconds = 0;
            }
            if (!Number.isFinite(hex.constructionTotalSeconds) || hex.constructionTotalSeconds < hex.constructionRemainingSeconds) {
                hex.constructionTotalSeconds = hex.constructionRemainingSeconds;
            }
            const legacyClock = snapshot.spawnClocks[String(hex.id)];
            if (Number.isFinite(legacyClock) && hex.building !== 'none') {
                const key = ZCEconomySystem.cycleKey(hex);
                if (!Number.isFinite(snapshot.spawnClocks[key])) snapshot.spawnClocks[key] = legacyClock;
                delete snapshot.spawnClocks[String(hex.id)];
            }
            if (typeof hex.developmentResolved !== 'boolean') {
                hex.developmentResolved = hex.building !== 'none' || hex.state === 'developed';
            }
            const hasDefendedDevelopment = hex.developmentResolved || hex.building !== 'none';
            if (!Number.isFinite(hex.wallMaxHp) || hex.wallMaxHp < 0) {
                hex.wallMaxHp = hasDefendedDevelopment ? config.rules.wallMaxHp : 0;
            }
            if (!Number.isFinite(hex.wallHp) || hex.wallHp < 0) {
                hex.wallHp = hex.wallMaxHp;
            }
            hex.wallHp = Math.min(hex.wallHp, hex.wallMaxHp);
            const breachedEdge = hex.wallBreachedEdge;
            if (typeof breachedEdge !== 'number' || !Number.isInteger(breachedEdge)
                || breachedEdge < 0 || breachedEdge > 5 || hex.wallHp > 0) {
                hex.wallBreachedEdge = null;
            }
            if (hex.building === 'hq') {
                hex.tileType = null;
                continue;
            }
            if (!hex.tileType || !Object.prototype.hasOwnProperty.call(config.tiles, hex.tileType)) {
                hex.tileType = tileTypeFromLegacyHex(hex);
            }
            hex.developmentCost = config.tiles[hex.tileType].price;
        }
    }

    /** 旧双人快照迁移为按席位记录；双人兼容字段始终作为 player/enemy 的权威值。 */
    private static normalizeOwners(state: ZCSnapshot, config: ZCMatchConfig): void {
        const owners = ownersForPlayerCount(config.map.playerCount ?? 2);
        state.drawCursor ??= ownerNumbers(owners);
        state.allRandomNonGoldDraws ??= ownerNumbers(owners);
        state.builtTypeCounts ??= ownerTypeCounts(owners);
        const gold = state.goldByOwner ?? ownerNumbers(owners, config.rules.initialGold);
        gold.player = state.playerGold;
        gold.enemy = state.enemyGold;
        state.goldByOwner = gold;
        for (const owner of owners) {
            if (!Number.isFinite(gold[owner])) gold[owner] = config.rules.initialGold;
            if (!Number.isFinite(state.drawCursor[owner])) state.drawCursor[owner] = 0;
            if (!Number.isFinite(state.allRandomNonGoldDraws[owner])) state.allRandomNonGoldDraws[owner] = 0;
            if (!state.builtTypeCounts[owner]) state.builtTypeCounts[owner] = createTypeCounts();
        }
    }

}

export function tileTypeFromLegacyHex(hex: Pick<ZCHexState, 'building' | 'developmentCost'>): ZCPvpTileType {
    if (hex.building === 'mine') return ZCPvpTileType.Mine;
    if (hex.developmentCost >= 250) return ZCPvpTileType.BarracksAdvanced;
    if (hex.developmentCost >= 100) return ZCPvpTileType.BarracksMedium;
    if (hex.developmentCost >= 50) return ZCPvpTileType.BarracksCommon;
    return ZCPvpTileType.AllRandom;
}
