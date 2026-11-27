import { ZCTileSystem } from './ZCTileSystem';
import { findCatalogCard, type ZCDeckCard, type ZCUnitDefinition } from '../ZCCombatCatalog';
import type { IZCNeutralFeatureState, IZCMonsterPatrolState, ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ownersForPlayerCount, type ZCOwner } from '../ZCMapConfig';
import type { ZCMatchMap, ZCMatchConfig } from '../ZCMatchConfig';
import { ZCMapGeometry } from '../ZCMapGeometry';
import type { ZCMonsterFocusBlock } from '../ZCMonsterPresentation';
import { neutralResourceItemOf, ZCNeutralResourceType, type IZCNeutralFeatureConfig } from '../ZCNeutralResourceGroup';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import { ZCTargetingSystem } from './ZCTargetingSystem';
import type { IZCBarracksSpawn } from './ZCEconomySystem';
import { hexGridDistance, HEX_GRID_LOGICAL_ROW_STEP } from '../../../../core/hex/HexGridLayout';

export interface IZCNeutralFeatureContext {
    readonly ownerBuildingLevels?: ZCMatchConfig['ownerBuildingLevels'];
    readonly rules: Pick<ZCRuntimeRules, 'neutralMonsterFocusSwitchCdSeconds' | 'neutralMonsterRegenDelaySeconds' | 'neutralMonsterRegenRate' | 'combatDistanceScale' | 'wallMaxHp'>;
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
        && hex.neutralFeature?.awake === true && !hex.neutralFeature.claimed && hex.hp > 0;
}

/** 身份仍是出生格；战斗与渲染共享这一段逻辑时间轴。*/
export function zcMonsterPosition(
    map: Pick<ZCMatchMap, 'hexes'>,
    hex: { readonly id: number; readonly neutralFeature?: { readonly claimed?: boolean; readonly patrol?: Readonly<IZCMonsterPatrolState> } },
    now: number,
    result = { x: 0, y: 0 },
): { x: number; y: number } {
    const point = map.hexes[hex.id];
    result.x = point.x;
    result.y = point.y;
    return result;
}

/** 每局实例；资源的可恢复状态保存在格子快照，脚点仅缓存本逻辑拍。*/
export class ZCNeutralFeatureSystem {
    private readonly previous = new Map<number, { x: number; y: number }>();
    private readonly geometry: ZCMapGeometry;
    private hasFeatures = false;
    private hasGates = false;
    private readonly monsterHexes: ZCHexState[] = [];
    private focusableMonsters: readonly ZCHexState[] | null = null;
    private monsterTerritoryIds: ReadonlySet<number> | null = null;
    private readonly monsterTerritories = new Map<number, readonly number[]>();
    private readonly patrolMonsterIds: number[] = [];
    get patrolOrigins(): readonly number[] { return this.patrolMonsterIds; }
    constructor(private readonly map: ZCMatchMap, private readonly context: IZCNeutralFeatureContext) {
        this.geometry = new ZCMapGeometry(map);
    }

    initialize(state: ZCSnapshot): void {
        this.previous.clear();
        this.patrolMonsterIds.length = 0;
        this.monsterHexes.length = 0;
        this.monsterTerritoryIds = null;
        this.monsterTerritories.clear();
        this.invalidateTerrain();
        this.hasFeatures = this.hasGates = false;
        for (const hex of state.hexes) {
            const item = neutralResourceItemOf(hex.neutralResourceId);
            if (item?.resourceType === ZCNeutralResourceType.Monster || hex.neutralFeature?.monsterResourceId !== undefined) {
                this.monsterHexes.push(hex);
            }
            if (!item?.feature) continue;
            if (item.resourceType === ZCNeutralResourceType.Portal && (this.map.playerCount ?? 2) !== 2) {
                hex.neutralResourceId = null;
                continue;
            }
            this.hasFeatures = true;
            if (item.resourceType === ZCNeutralResourceType.Gate) this.hasGates = true;
            if (hex.neutralFeature) {
                // 旧对局的号角和割草机已消耗但未标记开发。只补结算一次，避免修复被打掉的墙。
                const feature = hex.neutralFeature;
                if (feature.claimed && (item.resourceType === ZCNeutralResourceType.Horn || item.resourceType === ZCNeutralResourceType.Extension)) {
                    if (!hex.developmentResolved && hex.owner !== 'neutral') {
                        ZCTileSystem.finishDevelopment(hex, this.context.rules.wallMaxHp, this.context.ownerBuildingLevels?.[hex.owner]?.wall);
                    }
                    if (item.resourceType === ZCNeutralResourceType.Horn || feature.lineProgress >= feature.lineHexIds?.length) {
                        hex.neutralResourceId = null;
                        delete hex.neutralFeature;
                        continue;
                    }
                }
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
            delete hex.wallLevel;
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
                hex.neutralFeature.monsterResourceId = item.id;
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
            if (item.resourceType === ZCNeutralResourceType.Monster) {
                this.unlockMonster(state, hex);
                continue;
            }
            const neighborId = this.map.hexes[hex.id].neighbors.find(id => state.hexes[id].owner !== 'neutral'
                && state.hexes[id].developmentResolved);
            if (neighborId === undefined) continue;
            const owner = state.hexes[neighborId].owner as ZCOwner;
            hex.owner = owner;
            feature.claimed = true;
            if (item.resourceType === ZCNeutralResourceType.Extension || item.resourceType === ZCNeutralResourceType.Horn) {
                ZCTileSystem.finishDevelopment(hex, this.context.rules.wallMaxHp, this.context.ownerBuildingLevels?.[owner]?.wall);
            }
            if (item.resourceType === ZCNeutralResourceType.Extension) this.extend(state, hex, neighborId, owner);
            if (item.resourceType === ZCNeutralResourceType.Horn) {
                for (const barracks of state.hexes) {
                    if (barracks.owner === owner) this.context.spawnBatch(barracks);
                }
                hex.neutralResourceId = null;
                delete hex.neutralFeature;
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
        // 本拍要读很多次命中集合：先建 Set，避免每个单位都线性扫 `hitUnitIds`。
        const hitUnitIds = new Set(feature.hitUnitIds);
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
                    || hitUnitIds.has(unit.id) || this.geometry.hexIdAt(unit.freeX, unit.freeY) !== hex.id) continue;
                hitUnitIds.add(unit.id);
                feature.hitUnitIds.push(unit.id);
                this.context.damageUnit(unit, feature.lineDamage, feature.mowerOwner);
            }
            if (hex.owner === 'neutral' && hex.building === 'none' && !hex.neutralResourceId && hex.wallHp <= 0) {
                this.context.capture(hex, feature.mowerOwner);
            }
        }
        feature.lineProgress = progress;
        if (progress >= line.length) {
            resource.neutralResourceId = null;
            delete resource.neutralFeature;
            this.context.changed();
        }
    }

    /** 每批只选一次出生格；出口兵营、普通兵团奖励和路过的单位不再传送。*/
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
            const distance = Math.sqrt((unit.freeX - origin.x) ** 2 + (unit.freeY - origin.y) ** 2);
            if (distance < best) { target = unit; best = distance; }
        }
        const owners = ownersForPlayerCount(2);
        const home = this.map.hexes[this.map.homes[owners.findIndex(owner => owner !== barracks.owner)]];
        const goal = target ? { x: target.freeX, y: target.freeY } : home;
        const distance = Math.sqrt((goal.x - origin.x) ** 2 + (goal.y - origin.y) ** 2);
        const ratio = distance > 0 ? target ? 1 : config.range * HEX_GRID_LOGICAL_ROW_STEP / distance : 0;
        const x = origin.x + (goal.x - origin.x) * ratio;
        const y = origin.y + (goal.y - origin.y) * ratio;
        let exit = entrance.id;
        best = Infinity;
        for (const point of this.map.hexes) {
            if (!point.playable || this.geometry.distance(entrance.id, point.id) > config.range
                || state.hexes[point.id].building !== 'none') continue;
            const d = Math.sqrt((point.x - x) ** 2 + (point.y - y) ** 2);
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
            const samples = Math.max(1, Math.ceil(Math.sqrt((unit.freeX - from.x) ** 2 + (unit.freeY - from.y) ** 2) / 2));
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

    private nextEffect(gate: IZCNeutralFeatureState, config: IZCNeutralFeatureConfig): void {
        if (config.gates.length === 1) return;
        const choices = config.gates.filter(option => option.id !== gate.gateId);
        const next = choices[Math.min(choices.length - 1, Math.floor(Math.max(0, this.context.random()) * choices.length))];
        gate.gateId = next.id;
        gate.effect = next.effect;
    }

    get monsterTerritory(): ReadonlySet<number> {
        if (this.monsterTerritoryIds === null) {
            const ids = new Set<number>();
            for (const monster of this.monsterHexes) {
                for (const id of this.territory(monster)) ids.add(id);
            }
            this.monsterTerritoryIds = ids;
        }
        return this.monsterTerritoryIds;
    }

    territory(hex: Readonly<ZCHexState>): readonly number[] {
        const config = neutralResourceItemOf(hex.neutralResourceId ?? hex.neutralFeature?.monsterResourceId)?.feature;
        if (!config || config.wakeRange === undefined) return [];
        let cells = this.monsterTerritories.get(hex.id);
        if (!cells) {
            cells = this.map.hexes.filter(point => point.playable
                && hexGridDistance(this.map.hexes[hex.id], point) <= config.wakeRange).map(point => point.id);
            this.monsterTerritories.set(hex.id, cells);
        }
        return cells;
    }

    private unlockMonster(state: ZCSnapshot, hex: ZCHexState): void {
        const feature = hex.neutralFeature;
        if (feature.claimed) return;
        const unlocked = feature.unlockedOwners ?? (feature.unlockedOwners = []);
        const previousCount = unlocked.length;
        for (const id of this.territory(hex)) {
            const building = state.hexes[id];
            if (building.owner === 'neutral' || building.building === 'none' || building.hp <= 0
                || unlocked.includes(building.owner)) continue;
            unlocked.push(building.owner);
        }
        if (unlocked.length !== previousCount) this.context.changed();
    }

    /**
     * 「这一下为什么切不了集火」—— `null` 表示能切。
     *
     * 2026-11-26 第 56 批：按钮从「点不动」改成**恒可点**，点不成必须能给出一句话，
     * 所以判据要能单独问出来。开关（`toggleFocus`）与提示（控制器）都收敛到这一个函数，
     * 不会出现「按钮说不能集火、模型却切了」或者反过来的错位。
     *
     * 🔴 会顺手跑一遍 `unlockMonster`：解锁是**按棋盘实时算**的（相邻地块有我方已建成地块
     * 就解锁），上一拍建的房子这一拍才出现在 `unlockedOwners` 里。不刷这一遍，
     * 刚建好相邻地块的玩家会被误判成 `not-adjacent`。`unlockMonster` 幂等，
     * 和 `toggleFocus` 里那次重复调用不会多派 `changed()`。
     *
     * 非野怪 / 已被收下的格子也回 `not-adjacent`：按钮只长在醒着的野怪上，
     * 真正走到这里的情况不存在（点击路由有 `isMonsterFocusHex` 挡），不额外造第三种原因。
     */
    focusBlockReason(state: ZCSnapshot, hex: ZCHexState, owner: ZCOwner): ZCMonsterFocusBlock | null {
        const item = neutralResourceItemOf(hex.neutralResourceId);
        if (item?.resourceType !== ZCNeutralResourceType.Monster || hex.neutralFeature.claimed) return 'not-adjacent';
        this.unlockMonster(state, hex);
        const feature = hex.neutralFeature;
        if (!feature.unlockedOwners?.includes(owner)) return 'not-adjacent';
        if ((feature.focusReadyAt?.[owner] ?? 0) > state.elapsedSeconds) return 'cooldown';
        return null;
    }

    toggleFocus(state: ZCSnapshot, hex: ZCHexState, owner: ZCOwner): boolean {
        if (this.focusBlockReason(state, hex, owner) !== null) return false;
        const feature = hex.neutralFeature;
        const focused = feature.focusOwners ?? (feature.focusOwners = []);
        const index = focused.indexOf(owner);
        if (index < 0) {
            focused.push(owner);
            feature.awake = true;
        } else {
            focused.splice(index, 1);
        }
        feature.focusReadyAt ??= {};
        feature.focusReadyAt[owner] = state.elapsedSeconds + (this.context.rules?.neutralMonsterFocusSwitchCdSeconds ?? 3);
        this.invalidateTerrain();
        this.context.changed();
        return true;
    }

    invalidateTerrain(): void {
        this.focusableMonsters = null;
    }

    hasFocusableMonster(): boolean {
        this.focusableMonsters ??= this.monsterHexes.filter(isZCAwakeMonster);
        return this.focusableMonsters.length > 0;
    }

    /** Only live current attackers count; old hatred is not a retaliation order. */
    priorityTarget(state: ZCSnapshot, unit: ZCUnitState): number | null {
        if (!this.hasFocusableMonster()) return null;
        for (const hex of this.focusableMonsters) {
            if (!isZCAwakeMonster(hex) || !hex.neutralFeature.focusOwners?.includes(unit.owner)) continue;
            const definition = this.context.definition(unit);
            const center = this.map.hexes[hex.id];
            const reach = ZCTargetingSystem.attackReach(definition, 80, this.context.rules?.combatDistanceScale ?? 1);
            const unitHex = this.geometry.hexIdAt(unit.freeX, unit.freeY);
            const committed = unitHex !== null && this.territory(hex).includes(unitHex)
                || Math.sqrt((unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2) <= reach;
            if (committed) return hex.id;
            let opponent = false;
            for (const candidate of state.units) {
                if (candidate.owner === unit.owner || candidate.hp <= 0 || candidate.battleState === 'dead') continue;
                const distance = Math.sqrt((unit.freeX - candidate.freeX) ** 2 + (unit.freeY - candidate.freeY) ** 2);
                const reach = ZCTargetingSystem.attackReach(definition, this.context.definition(candidate).bodyRadius,
                    this.context.rules?.combatDistanceScale ?? 1);
                if (candidate.id === unit.targetUnitId && distance <= reach * 1.3
                    || (definition.canAttackAir || !this.context.definition(candidate).flying) && distance <= reach) {
                    opponent = true;
                    break;
                }
            }
            if (!opponent) return hex.id;
        }
        return null;
    }

    private tickMonster(state: ZCSnapshot, hex: ZCHexState, config: IZCNeutralFeatureConfig): void {
        if (!isZCAwakeMonster(hex)) return;
        const feature = hex.neutralFeature;
        const definition = this.context.monsterDefinition(findCatalogCard(config.resId));
        const center = this.map.hexes[hex.id];
        const eligible = (unit: ZCUnitState) => unit.hp > 0 && unit.battleState !== 'dead'
            && (definition.canAttackAir || !this.context.definition(unit).flying);
        const reachOf = (unit: ZCUnitState) => ZCTargetingSystem.attackReach(definition, this.context.definition(unit).bodyRadius,
            this.context.rules?.combatDistanceScale ?? 1);
        feature.retaliationUnitIds = (feature.retaliationUnitIds ?? []).filter(id => {
            const unit = state.units.find(u => u.id === id && eligible(u));
            if (!unit) return false;
            const dist = Math.sqrt((unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2);
            return dist <= reachOf(unit) * 3;
        });
        const inRange = (unit: ZCUnitState) => eligible(unit) && (feature.retaliationUnitIds.includes(unit.id)
            || Math.sqrt((unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2) <= reachOf(unit));
        let target = state.units.find(unit => unit.id === feature.targetUnitId && inRange(unit));
        if (!target) {
            let best = Infinity;
            for (const unit of state.units) {
                if (!inRange(unit)) continue;
                const distance = Math.sqrt((unit.freeX - center.x) ** 2 + (unit.freeY - center.y) ** 2);
                if (distance < best || (distance === best && target && unit.id < target.id)) { target = unit; best = distance; }
            }
            feature.targetUnitId = target?.id ?? null;
        }
        const now = state.elapsedSeconds;
        const attacked = state.units.some(unit => eligible(unit) && unit.targetBuildingHexId === hex.id
            && (unit.battleState === 'attack' || unit.battleState === 'waitAttack'));
        if (target || attacked) {
            delete feature.disengagedAt;
            feature.regenUpdatedAt = now;
        } else {
            feature.disengagedAt ??= now;
            const start = feature.disengagedAt + (this.context.rules?.neutralMonsterRegenDelaySeconds ?? 3);
            const delta = Math.max(0, now - Math.max(start, feature.regenUpdatedAt ?? now));
            hex.hp = Math.min(hex.maxHp, hex.hp + hex.maxHp * (this.context.rules?.neutralMonsterRegenRate ?? 0) / 10000 * delta);
            feature.regenUpdatedAt = now;
        }
        if (feature.attackStartedAt !== undefined) {
            const elapsed = now - feature.attackStartedAt + 1e-9;
            if (feature.attackTargetUnitId !== undefined && elapsed >= definition.attackHitTime) {
                const hit = target && target.id === feature.attackTargetUnitId;
                delete feature.attackTargetUnitId;
                if (hit) this.context.damageUnit(target, definition.attack);
            }
            if (elapsed < definition.attackDuration || feature.attackTargetUnitId !== undefined) return;
            delete feature.attackStartedAt;
            return;
        }
        if (!target || now + 1e-9 < feature.nextAttackAt) return;
        const dx = target.freeX - center.x;
        const dy = target.freeY - center.y;
        // 与士兵一样取八方向。正上、正下或脚点重合时保留上次出手的朝向。
        const octant = Math.abs(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)));
        if (dx !== 0 && octant !== 2) feature.monsterFacing = dx < 0 ? -1 : 1;
        feature.nextAttackAt = now + definition.attackInterval;
        feature.attackStartedAt = now;
        feature.attackTargetUnitId = target.id;
    }

}
