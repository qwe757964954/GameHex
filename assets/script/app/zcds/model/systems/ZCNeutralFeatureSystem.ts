import { findCatalogCard, type ZCDeckCard, type ZCUnitDefinition } from '../ZCCombatCatalog';
import type { ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ownersForPlayerCount, type ZCOwner } from '../ZCMapConfig';
import type { ZCMatchMap } from '../ZCMatchConfig';
import { ZCMapGeometry } from '../ZCMapGeometry';
import { neutralResourceItemOf, ZC_GATE_EFFECTS, ZCNeutralResourceType, type IZCNeutralFeatureConfig } from '../ZCNeutralResourceGroup';

export interface IZCNeutralFeatureContext {
    random(): number;
    definition(unit: ZCUnitState): ZCUnitDefinition;
    monsterDefinition(card: ZCDeckCard): ZCUnitDefinition;
    cloneUnit(unit: ZCUnitState): ZCUnitState | void;
    spawnBatch(hex: ZCHexState): void;
    damageUnit(unit: ZCUnitState, damage: number): void;
    changed(): void;
}

export function isZCAwakeMonster(hex: Readonly<ZCHexState>): boolean {
    return neutralResourceItemOf(hex.neutralResourceId)?.resourceType === ZCNeutralResourceType.Monster
        && hex.neutralFeature?.awake === true && hex.hp > 0;
}

/** 每局实例；资源的可恢复状态保存在格子快照，脚点仅缓存本逻辑拍。 */
export class ZCNeutralFeatureSystem {
    private readonly previous = new Map<number, { x: number; y: number }>();
    private readonly geometry: ZCMapGeometry;
    private hasFeatures = false;
    private hasGates = false;
    constructor(private readonly map: ZCMatchMap, private readonly context: IZCNeutralFeatureContext) {
        this.geometry = new ZCMapGeometry(map);
    }

    initialize(state: ZCSnapshot): void {
        this.previous.clear();
        this.hasFeatures = this.hasGates = false;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (!item?.feature) continue;
            if (item.resourceType === ZCNeutralResourceType.Portal && (this.map.playerCount ?? 2) !== 2) {
                hex.neutralResourceId = null;
                continue;
            }
            this.hasFeatures = true;
            if (item.resourceType === ZCNeutralResourceType.Gate) this.hasGates = true;
            if (hex.neutralFeature) continue;
            hex.neutralFeature = { claimed: false };
            hex.wallHp = hex.wallMaxHp = 0;
            if (item.resourceType === ZCNeutralResourceType.Gate) {
                hex.neutralFeature.effect = item.feature.effect;
                hex.neutralFeature.readyAt = 0;
                hex.neutralFeature.windowUntil = 0;
                hex.neutralFeature.insideUnitIds = [];
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
            const neighborId = this.map.hexes[hex.id].neighbors.find(id => state.hexes[id].owner !== 'neutral');
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
        // 野怪的唤醒范围独立于资源邻接领取规则。
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (item?.resourceType === ZCNeutralResourceType.Monster && !hex.neutralFeature?.awake) {
                this.wakeMonster(state, hex, item.feature);
            }
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
            if (hex.building === 'none' && hex.state !== 'ruins' && (!hex.neutralResourceId || hex.id === resource.id)) {
                hex.owner = owner;
                hex.developmentResolved = false;
                if (hex.id !== resource.id) line.push(hex.id);
            }
            const point = this.map.hexes[current];
            const next = point.neighbors.find(id => id !== previous
                && Math.abs(this.map.hexes[id].x - point.x - dx) < 2
                && Math.abs(this.map.hexes[id].y - point.y - dy) < 2);
            previous = current;
            current = next ?? null;
        }
        feature.lineHexIds = line;
        feature.buildOwner = owner;
        feature.buildUsed = false;
    }

    static canBuild(state: ZCSnapshot, hexId: number, owner: ZCOwner): boolean {
        return state.hexes.some(hex => hex.neutralFeature?.buildOwner === owner
            && !hex.neutralFeature.buildUsed && hex.neutralFeature.lineHexIds?.includes(hexId));
    }

    static consumeBuild(state: ZCSnapshot, hexId: number, owner: ZCOwner): void {
        for (const hex of state.hexes) {
            const feature = hex.neutralFeature;
            if (feature?.buildOwner === owner && !feature.buildUsed && feature.lineHexIds?.includes(hexId)) {
                feature.buildUsed = true;
                break;
            }
        }
    }

    /** 每批只选一次出生格；出口兵营、普通兵团奖励和路过的单位不再传送。 */
    spawnHex(state: ZCSnapshot, barracks: ZCHexState): number {
        if ((this.map.playerCount ?? 2) !== 2 || barracks.owner === 'neutral') return barracks.id;
        const portals = state.hexes.filter(hex => hex.owner === barracks.owner && hex.neutralFeature?.claimed
            && neutralResourceItemOf(hex.neutralResourceId)?.resourceType === ZCNeutralResourceType.Portal);
        if (portals.length < 2) return barracks.id;
        const entrance = portals.find(hex => this.map.hexes[hex.id].neighbors.includes(barracks.id));
        if (!entrance) return barracks.id;
        const owners = ownersForPlayerCount(2);
        const enemyHome = this.map.homes[owners.findIndex(owner => owner !== barracks.owner)];
        const goal = this.map.hexes[enemyHome];
        const distance = (hex: ZCHexState) => Math.hypot(this.map.hexes[hex.id].x - goal.x, this.map.hexes[hex.id].y - goal.y);
        let exit = portals.find(hex => hex.id === entrance.neutralFeature.portalExitId) ?? portals[0];
        for (const portal of portals) if (distance(portal) < distance(exit) - 1e-9) exit = portal;
        entrance.neutralFeature.portalExitId = exit.id;
        return this.map.hexes[exit.id].neighbors.includes(barracks.id) ? barracks.id : exit.id;
    }

    tick(state: ZCSnapshot): void {
        if (!this.hasFeatures) return;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (!item?.feature) continue;
            if (item.resourceType === ZCNeutralResourceType.Gate) this.tickGate(state, hex, item.feature);
            if (item.resourceType === ZCNeutralResourceType.Monster) this.tickMonster(state, hex, item.feature);
        }
    }

    private tickGate(state: ZCSnapshot, hex: ZCHexState, config: IZCNeutralFeatureConfig): void {
        const gate = hex.neutralFeature;
        const now = state.elapsedSeconds;
        if (gate.windowUntil > 0 && now >= gate.windowUntil) {
            gate.readyAt = gate.windowUntil + config.cooldownSeconds;
            gate.windowUntil = 0;
            this.nextEffect(gate, config);
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
            } else gate.readyAt = now + config.cooldownSeconds;
            if (effect === 'add' || effect === 'multiply') {
                const amount = effect === 'add' ? config.value : config.value - 1;
                for (let n = 0; n < amount; n += 1) {
                    const clone = this.context.cloneUnit(unit);
                    if (clone && this.geometry.hexIdAt(clone.freeX, clone.freeY) === hex.id) inside.push(clone.id);
                }
            } else if (effect === 'enlarge') {
                unit.maxHp = Math.max(1, unit.maxHp - (unit.gateHpFlat ?? 0) + config.hpFlat);
                unit.hp = Math.min(unit.maxHp, unit.hp + Math.max(0, config.hpFlat - (unit.gateHpFlat ?? 0)));
                unit.gateSize = 'enlarge';
                unit.gateScale = config.scale;
                unit.gateHpFlat = config.hpFlat;
                unit.gateMoveMultiplier = unit.gateAttackSpeedMultiplier = unit.gateDamageMultiplier = 1;
            } else if (unit.gateSize !== 'enlarge') {
                unit.gateSize = 'shrink';
                unit.gateScale = 1 / config.scale;
                unit.gateMoveMultiplier = config.moveMultiplier;
                unit.gateAttackSpeedMultiplier = config.attackSpeedMultiplier;
                unit.gateDamageMultiplier = config.damageMultiplier;
            }
            if (effect === 'add' || effect === 'enlarge') {
                immediateActivated = true;
                this.nextEffect(gate, config);
            }
        }
        gate.insideUnitIds = inside;
    }

    private nextEffect(gate: ZCHexState['neutralFeature'], config: IZCNeutralFeatureConfig): void {
        if (config.mode !== 'random') return;
        const effects = ZC_GATE_EFFECTS.filter(effect => effect !== gate.effect);
        gate.effect = effects[Math.min(effects.length - 1, Math.floor(Math.max(0, this.context.random()) * effects.length))];
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
                if (state.hexes[neighbor].owner !== 'neutral') {
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
        const inRange = (unit: ZCUnitState) => unit.hp > 0 && unit.battleState !== 'dead'
            && (definition.canAttackAir || !this.context.definition(unit).flying)
            && this.geometry.distance(hex.id, this.geometry.hexIdAt(unit.freeX, unit.freeY) ?? unit.sourceHexId) <= config.attackRange;
        let target = state.units.find(unit => unit.id === feature.targetUnitId && inRange(unit));
        if (!target) {
            const center = this.map.hexes[hex.id];
            let best = Infinity;
            for (const unit of state.units) {
                if (!inRange(unit)) continue;
                const distance = Math.hypot(unit.freeX - center.x, unit.freeY - center.y);
                if (distance < best) { target = unit; best = distance; }
            }
            feature.targetUnitId = target?.id ?? null;
        }
        if (!target || state.elapsedSeconds < feature.nextAttackAt) return;
        feature.nextAttackAt = state.elapsedSeconds + definition.attackInterval;
        this.context.damageUnit(target, definition.attack);
    }
}
