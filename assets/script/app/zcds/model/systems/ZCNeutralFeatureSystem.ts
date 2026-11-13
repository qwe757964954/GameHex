import { findCatalogCard, type ZCDeckCard, type ZCUnitDefinition } from '../ZCCombatCatalog';
import type { IZCMonsterPatrolState, ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ownersForPlayerCount, type ZCOwner } from '../ZCMapConfig';
import type { ZCMatchMap } from '../ZCMatchConfig';
import { ZCMapGeometry } from '../ZCMapGeometry';
import { neutralResourceItemOf, ZCNeutralResourceType, type IZCNeutralFeatureConfig } from '../ZCNeutralResourceGroup';
import type { IZCBarracksSpawn } from './ZCEconomySystem';
import { HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';

export interface IZCNeutralFeatureContext {
    random(): number;
    definition(unit: ZCUnitState): ZCUnitDefinition;
    monsterDefinition(card: ZCDeckCard): ZCUnitDefinition;
    cloneUnit(unit: ZCUnitState): ZCUnitState | void;
    spawnBatch(hex: ZCHexState): void;
    damageUnit(unit: ZCUnitState, damage: number, owner?: ZCOwner): void;
    damageStructure(hex: ZCHexState, damage: number, owner: ZCOwner, fromId: number): void;
    capture(hex: ZCHexState, owner: ZCOwner): void;
    changed(): void;
}

export function isZCAwakeMonster(hex: Readonly<ZCHexState>): boolean {
    return neutralResourceItemOf(hex.neutralResourceId)?.resourceType === ZCNeutralResourceType.Monster
        && hex.neutralFeature?.awake === true && hex.hp > 0;
}

/** 身份仍是出生格；战斗与渲染共享这一段逻辑时间轴。 */
export function zcMonsterPosition(
    map: Pick<ZCMatchMap, 'hexes'>,
    hex: { readonly id: number; readonly neutralFeature?: { readonly claimed?: boolean; readonly patrol?: Readonly<IZCMonsterPatrolState> } },
    now: number,
    result = { x: 0, y: 0 },
): { x: number; y: number } {
    const patrol = hex.neutralFeature?.claimed ? undefined : hex.neutralFeature?.patrol;
    const from = map.hexes[patrol?.fromHexId ?? hex.id];
    const to = map.hexes[patrol?.toHexId ?? hex.id];
    const progress = patrol && patrol.durationSeconds > 0
        ? Math.max(0, Math.min(1, ((patrol.pausedAt ?? now) - patrol.startedAt) / patrol.durationSeconds)) : 1;
    result.x = from.x + (to.x - from.x) * progress;
    result.y = from.y + (to.y - from.y) * progress;
    return result;
}

/** 每局实例；资源的可恢复状态保存在格子快照，脚点仅缓存本逻辑拍。 */
export class ZCNeutralFeatureSystem {
    private readonly previous = new Map<number, { x: number; y: number }>();
    private readonly geometry: ZCMapGeometry;
    private hasFeatures = false;
    private hasGates = false;
    private readonly patrolCells = new Map<number, ReadonlySet<number>>();
    private readonly patrolMonsterIds: number[] = [];
    get patrolOrigins(): readonly number[] { return this.patrolMonsterIds; }
    constructor(private readonly map: ZCMatchMap, private readonly context: IZCNeutralFeatureContext) {
        this.geometry = new ZCMapGeometry(map);
    }

    initialize(state: ZCSnapshot): void {
        this.previous.clear();
        this.patrolCells.clear();
        this.patrolMonsterIds.length = 0;
        for (const point of this.map.resourcePoints ?? []) {
            if (point.patrolCells?.length) this.patrolCells.set(point.row * this.map.columns + point.column, new Set(point.patrolCells));
        }
        this.hasFeatures = this.hasGates = false;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (!item?.feature) continue;
            if (item.resourceType === ZCNeutralResourceType.Monster && this.patrolCells.has(hex.id)) this.patrolMonsterIds.push(hex.id);
            if (item.resourceType === ZCNeutralResourceType.Portal && (this.map.playerCount ?? 2) !== 2) {
                hex.neutralResourceId = null;
                continue;
            }
            this.hasFeatures = true;
            if (item.resourceType === ZCNeutralResourceType.Gate) this.hasGates = true;
            if (hex.neutralFeature) {
                if (item.feature.gates && hex.neutralFeature.gateId === undefined) {
                    const gate = item.feature.gates.find(gate => gate.effect === hex.neutralFeature.effect) ?? item.feature.gates[0];
                    hex.neutralFeature.gateId = gate.id;
                    hex.neutralFeature.effect = gate.effect;
                }
                if (item.resourceType === ZCNeutralResourceType.Extension && hex.neutralFeature.startedAt === undefined) {
                    hex.neutralFeature.lineHexIds = [];
                }
                continue;
            }
            hex.neutralFeature = { claimed: false };
            hex.wallHp = hex.wallMaxHp = 0;
            if (item.resourceType === ZCNeutralResourceType.Gate) {
                const gates = item.feature.gates;
                const gate = gates[gates.length === 1 ? 0 : Math.min(gates.length - 1, Math.floor(this.context.random() * gates.length))];
                hex.neutralFeature.gateId = gate.id;
                hex.neutralFeature.effect = gate.effect;
                hex.neutralFeature.readyAt = 0;
                hex.neutralFeature.windowUntil = 0;
                hex.neutralFeature.insideUnitIds = [];
            }
            if (item.resourceType === ZCNeutralResourceType.Portal) {
                hex.neutralFeature.usesRemaining = item.feature.uses;
                hex.neutralFeature.readyAt = 0;
            }
            if (item.resourceType === ZCNeutralResourceType.Monster) {
                const card = findCatalogCard(item.feature.resId);
                const definition = this.context.monsterDefinition(card);
                hex.hp = hex.maxHp = definition.maxHp;
                hex.neutralFeature.awake = false;
                hex.neutralFeature.nextAttackAt = 0;
            }
        }
    }

    beginStep(state: ZCSnapshot): void {
        if (!this.hasGates) return;
        this.previous.clear();
        for (const unit of state.units) this.previous.set(unit.id, { x: unit.freeX, y: unit.freeY });
    }

    claim(state: ZCSnapshot): void {
        if (!this.hasFeatures) return;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            const feature = hex.neutralFeature;
            if (!item?.feature || !feature || feature.claimed) continue;
            const neighborId = this.map.hexes[hex.id].neighbors.find(id => state.hexes[id].owner !== 'neutral'
                && state.hexes[id].developmentResolved
                && (item.resourceType !== ZCNeutralResourceType.Extension || !state.hexes.some(resource =>
                    resource.neutralFeature?.mowerOwner === state.hexes[id].owner
                    && resource.neutralFeature.startedAt !== undefined)));
            if (neighborId === undefined) continue;
            const owner = state.hexes[neighborId].owner as ZCOwner;
            if (item.resourceType === ZCNeutralResourceType.Monster) {
                this.wakeMonster(state, hex, item.feature);
                continue;
            }
            hex.owner = owner;
            feature.claimed = true;
            if (item.resourceType === ZCNeutralResourceType.Extension) this.extend(state, hex, neighborId, owner);
            if (item.resourceType === ZCNeutralResourceType.Horn) {
                for (const barracks of state.hexes) {
                    if (barracks.owner === owner) this.context.spawnBatch(barracks);
                }
            }
            this.context.changed();
        }
    }

    private extend(state: ZCSnapshot, resource: ZCHexState, fromId: number, owner: ZCOwner): void {
        const feature = resource.neutralFeature;
        const from = this.map.hexes[fromId];
        const origin = this.map.hexes[resource.id];
        const dx = origin.x - from.x;
        const dy = origin.y - from.y;
        const line: number[] = [];
        let previous = fromId;
        let current = resource.id;
        while (current !== null) {
            const hex = state.hexes[current];
            if (!this.map.hexes[current].playable) break;
            line.push(hex.id);
            const point = this.map.hexes[current];
            const next = point.neighbors.find(id => id !== previous
                && Math.abs(this.map.hexes[id].x - point.x - dx) < 2
                && Math.abs(this.map.hexes[id].y - point.y - dy) < 2);
            previous = current;
            current = next ?? null;
        }
        feature.lineHexIds = line;
        feature.mowerOwner = owner;
        feature.startedAt = state.elapsedSeconds;
        feature.lineProgress = 0;
        feature.hitUnitIds = [];
        let attack = 0;
        for (const unit of state.units) {
            if (unit.owner === owner && unit.hp > 0 && unit.battleState !== 'dead') attack += this.context.definition(unit).attack;
        }
        feature.lineDamage = attack * neutralResourceItemOf(resource.neutralResourceId).feature.damageRate;
    }

    private tickMower(state: ZCSnapshot, resource: ZCHexState, config: IZCNeutralFeatureConfig): void {
        const feature = resource.neutralFeature;
        if (!feature.claimed || !feature.lineHexIds?.length) return;
        const line = feature.lineHexIds;
        if (feature.lineProgress >= line.length) return;
        const progress = Math.min(line.length, (state.elapsedSeconds - feature.startedAt) * config.speed);
        const end = Math.min(line.length - 1, Math.floor(progress));
        // 覆盖本拍扫过的整段；每个单位只受伤一次，伤害结算后再判断能否占地。
        for (let i = Math.floor(feature.lineProgress); i <= end; i += 1) {
            const hex = state.hexes[line[i]];
            // 路径进度即结构命中记录；读档或同格多拍时不重复扣血。
            if (i > feature.lineProgress && hex.owner !== feature.mowerOwner
                && (hex.wallHp > 0 || hex.building !== 'none')) {
                this.context.damageStructure(hex, feature.lineDamage, feature.mowerOwner, line[i - 1]);
            }
            for (const unit of state.units) {
                if (unit.owner === feature.mowerOwner || unit.hp <= 0 || unit.battleState === 'dead'
                    || feature.hitUnitIds.includes(unit.id) || this.geometry.hexIdAt(unit.freeX, unit.freeY) !== hex.id) continue;
                feature.hitUnitIds.push(unit.id);
                this.context.damageUnit(unit, feature.lineDamage, feature.mowerOwner);
            }
            if (hex.owner === 'neutral' && hex.building === 'none') this.context.capture(hex, feature.mowerOwner);
        }
        feature.lineProgress = progress;
    }

    /** 每批只选一次出生格；出口兵营、普通兵团奖励和路过的单位不再传送。 */
    spawnHex(state: ZCSnapshot, barracks: ZCHexState): IZCBarracksSpawn {
        if ((this.map.playerCount ?? 2) !== 2 || barracks.owner === 'neutral') return { hexId: barracks.id };
        const entrance = state.hexes.find(hex => hex.owner === barracks.owner && hex.neutralFeature?.claimed
            && this.map.hexes[hex.id].neighbors.includes(barracks.id)
            && neutralResourceItemOf(hex.neutralResourceId)?.resourceType === ZCNeutralResourceType.Portal
            && !(hex.neutralFeature.readyAt > state.elapsedSeconds));
        if (!entrance) return { hexId: barracks.id };
        const config = neutralResourceItemOf(entrance.neutralResourceId).feature;
        const feature = entrance.neutralFeature;
        if (!feature.usesRemaining) feature.usesRemaining = config.uses;
        const origin = this.map.hexes[entrance.id];
        let target: ZCUnitState | undefined;
        let best = Infinity;
        for (const unit of state.units) {
            if (unit.owner === barracks.owner || unit.hp <= 0 || unit.battleState === 'dead') continue;
            const id = this.geometry.hexIdAt(unit.freeX, unit.freeY);
            if (id === null || this.geometry.distance(entrance.id, id) > config.range) continue;
            const distance = Math.hypot(unit.freeX - origin.x, unit.freeY - origin.y);
            if (distance < best) { target = unit; best = distance; }
        }
        const owners = ownersForPlayerCount(2);
        const home = this.map.hexes[this.map.homes[owners.findIndex(owner => owner !== barracks.owner)]];
        const goal = target ? { x: target.freeX, y: target.freeY } : home;
        const distance = Math.hypot(goal.x - origin.x, goal.y - origin.y);
        const ratio = distance > 0 ? target ? 1 : config.range * HEX_GRID_LOGICAL_ROW_STEP / distance : 0;
        const x = origin.x + (goal.x - origin.x) * ratio;
        const y = origin.y + (goal.y - origin.y) * ratio;
        let exit = entrance.id;
        best = Infinity;
        for (const point of this.map.hexes) {
            if (!point.playable || this.geometry.distance(entrance.id, point.id) > config.range
                || state.hexes[point.id].building !== 'none') continue;
            const d = Math.hypot(point.x - x, point.y - y);
            if (d < best) { exit = point.id; best = d; }
        }
        feature.portalExitId = exit;
        feature.portalAt = state.elapsedSeconds;
        feature.usesRemaining -= 1;
        if (!feature.usesRemaining) {
            feature.readyAt = state.elapsedSeconds + config.cooldownSeconds;
            feature.cooldownSeconds = config.cooldownSeconds;
        }
        return { hexId: exit, portalHexId: entrance.id };
    }

    tick(state: ZCSnapshot): void {
        if (!this.hasFeatures) return;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (!item?.feature) continue;
            if (item.resourceType === ZCNeutralResourceType.Gate && hex.neutralFeature.claimed) this.tickGate(state, hex, item.feature);
            if (item.resourceType === ZCNeutralResourceType.Extension) this.tickMower(state, hex, item.feature);
            if (item.resourceType === ZCNeutralResourceType.Portal && hex.neutralFeature.readyAt <= state.elapsedSeconds
                && hex.neutralFeature.usesRemaining === 0) hex.neutralFeature.usesRemaining = item.feature.uses;
            if (item.resourceType === ZCNeutralResourceType.Monster) this.tickMonster(state, hex, item.feature);
        }
    }

    private tickGate(state: ZCSnapshot, hex: ZCHexState, config: IZCNeutralFeatureConfig): void {
        const gate = hex.neutralFeature;
        config = config.gates.find(option => option.id === gate.gateId) ?? config.gates[0];
        const now = state.elapsedSeconds;
        if (gate.windowUntil > 0 && now >= gate.windowUntil) {
            gate.readyAt = gate.windowUntil + config.cooldownSeconds;
            gate.cooldownSeconds = config.cooldownSeconds;
            gate.windowUntil = 0;
            this.nextEffect(gate, neutralResourceItemOf(hex.neutralResourceId).feature);
            config = neutralResourceItemOf(hex.neutralResourceId).feature.gates.find(option => option.id === gate.gateId);
        }
        const inside: number[] = [];
        const count = state.units.length;
        let immediateActivated = false;
        for (let i = 0; i < count; i += 1) {
            const unit = state.units[i];
            if (unit.hp <= 0 || unit.battleState === 'dead') continue;
            const atHex = this.geometry.hexIdAt(unit.freeX, unit.freeY);
            if (atHex === hex.id) inside.push(unit.id);
            if (unit.battleState === 'born') continue;
            if (gate.insideUnitIds.includes(unit.id)) continue;
            const from = this.previous.get(unit.id) ?? { x: unit.freeX, y: unit.freeY };
            const samples = Math.max(1, Math.ceil(Math.hypot(unit.freeX - from.x, unit.freeY - from.y) / 2));
            let touched = atHex === hex.id;
            for (let sample = 0; !touched && sample <= samples; sample += 1) {
                touched = this.geometry.hexIdAt(from.x + (unit.freeX - from.x) * sample / samples,
                    from.y + (unit.freeY - from.y) * sample / samples) === hex.id;
            }
            if (!touched || now < gate.readyAt || immediateActivated) continue;
            const effect = gate.effect;
            if (effect === 'multiply' || effect === 'shrink') {
                if (!gate.windowUntil) gate.windowUntil = now + config.windowSeconds;
            } else {
                gate.readyAt = now + config.cooldownSeconds;
                gate.cooldownSeconds = config.cooldownSeconds;
            }
            if (effect === 'add' || effect === 'multiply') {
                const amount = effect === 'add' ? config.value : config.value - 1;
                for (let n = 0; n < amount; n += 1) {
                    const clone = this.context.cloneUnit(unit);
                    if (clone && this.geometry.hexIdAt(clone.freeX, clone.freeY) === hex.id) inside.push(clone.id);
                }
            } else if (effect === 'enlarge') {
                const baseHp = unit.maxHp - (unit.gateHpFlat ?? 0);
                const hpFlat = Math.round(baseHp * (config.hpRate - 1));
                unit.maxHp = Math.max(1, baseHp + hpFlat);
                unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(0, hpFlat - (unit.gateHpFlat ?? 0)));
                unit.gateSize = 'enlarge';
                unit.gateScale = config.scale;
                unit.gateHpFlat = unit.maxHp - baseHp;
                unit.gateMoveMultiplier = unit.gateAttackSpeedMultiplier = unit.gateDamageMultiplier = 1;
            } else if (unit.gateSize !== 'enlarge') {
                unit.gateSize = 'shrink';
                unit.gateScale = config.scale;
                unit.gateMoveMultiplier = config.moveMultiplier;
                unit.gateAttackSpeedMultiplier = config.attackSpeedMultiplier;
                unit.gateDamageMultiplier = config.damageMultiplier;
            }
            if (effect === 'add' || effect === 'enlarge') {
                immediateActivated = true;
                this.nextEffect(gate, neutralResourceItemOf(hex.neutralResourceId).feature);
            }
        }
        gate.insideUnitIds = inside;
    }

    private nextEffect(gate: ZCHexState['neutralFeature'], config: IZCNeutralFeatureConfig): void {
        if (config.gates.length === 1) return;
        const choices = config.gates.filter(option => option.id !== gate.gateId);
        const next = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, this.context.random()) * choices.length))];
        gate.gateId = next.id;
        gate.effect = next.effect;
    }

    private wakeMonster(state: ZCSnapshot, hex: ZCHexState, config: IZCNeutralFeatureConfig): void {
        if (hex.neutralFeature.awake || hex.neutralFeature.claimed) return;
        const seen = new Set<number>([hex.id]);
        let frontier = [hex.id];
        for (let depth = 1; depth <= config.wakeRange; depth += 1) {
            const next: number[] = [];
            for (const id of frontier) for (const neighbor of this.map.hexes[id].neighbors) {
                if (seen.has(neighbor)) continue;
                seen.add(neighbor);
                if (state.hexes[neighbor].owner !== 'neutral' && state.hexes[neighbor].developmentResolved) {
                    hex.neutralFeature.awake = true;
                    this.context.changed();
                    return;
                }
                next.push(neighbor);
            }
            frontier = next;
        }
    }

    private tickMonster(state: ZCSnapshot, hex: ZCHexState, config: IZCNeutralFeatureConfig): void {
        if (!isZCAwakeMonster(hex)) return;
        const feature = hex.neutralFeature;
        const definition = this.context.monsterDefinition(findCatalogCard(config.resId));
        const center = zcMonsterPosition(this.map, hex, state.elapsedSeconds);
        const inRange = (unit: ZCUnitState) => unit.hp > 0 && unit.battleState !== 'dead'
            && (definition.canAttackAir || !this.context.definition(unit).flying)
            && (feature.patrol
                ? Math.round(Math.hypot(unit.freeX - center.x, unit.freeY - center.y) / HEX_GRID_LOGICAL_ROW_STEP)
                : this.geometry.distance(hex.id, this.geometry.hexIdAt(unit.freeX, unit.freeY) ?? unit.sourceHexId)) <= config.attackRange;
        let target = state.units.find(unit => unit.id === feature.targetUnitId && inRange(unit));
        if (!target) {
            let best = Infinity;
            for (const unit of state.units) {
                if (!inRange(unit)) continue;
                const distance = Math.hypot(unit.freeX - center.x, unit.freeY - center.y);
                if (distance < best) { target = unit; best = distance; }
            }
            feature.targetUnitId = target?.id ?? null;
        }
        this.tickPatrol(state, hex, definition.moveSpeed, !!target);
        if (!target || state.elapsedSeconds < feature.nextAttackAt) return;
        feature.nextAttackAt = state.elapsedSeconds + definition.attackInterval;
        this.context.damageUnit(target, definition.attack);
    }

    private tickPatrol(state: ZCSnapshot, hex: ZCHexState, speed: number, attacking: boolean): void {
        const cells = this.patrolCells.get(hex.id);
        if (!cells || cells.size < 2 || speed <= 0) return;
        const feature = hex.neutralFeature;
        const patrol = feature.patrol ?? (feature.patrol = {
            fromHexId: hex.id, toHexId: hex.id, startedAt: state.elapsedSeconds, durationSeconds: 0,
        });
        const canEnter = (id: number): boolean => cells.has(id) && state.hexes[id].building === 'none'
            && state.hexes[id].wallHp <= 0 && (id === hex.id || state.hexes[id].neutralResourceId === null);
        if (attacking || !canEnter(patrol.toHexId)) {
            if (patrol.pausedAt === undefined) patrol.pausedAt = state.elapsedSeconds;
            return;
        }
        if (patrol.pausedAt !== undefined) {
            patrol.startedAt += state.elapsedSeconds - patrol.pausedAt;
            delete patrol.pausedAt;
        }
        if (state.elapsedSeconds < patrol.startedAt + patrol.durationSeconds) return;
        const neighbors = this.map.hexes[patrol.toHexId].neighbors.filter(canEnter).sort((a, b) => a - b);
        const onward = neighbors.filter(id => id !== patrol.fromHexId);
        const choices = onward.length ? onward : neighbors;
        if (!choices.length) return;
        patrol.fromHexId = patrol.toHexId;
        patrol.toHexId = choices[Math.min(choices.length - 1, Math.floor(this.context.random() * choices.length))];
        const from = this.map.hexes[patrol.fromHexId];
        const to = this.map.hexes[patrol.toHexId];
        patrol.startedAt = state.elapsedSeconds;
        patrol.durationSeconds = Math.hypot(to.x - from.x, to.y - from.y) / speed;
    }
}
