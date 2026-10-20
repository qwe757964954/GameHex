import type { ZCMatchConfig, ZCMatchMap } from './ZCMatchConfig';
import { isZCNeutralResourceId } from './ZCNeutralResourceReward';
import type { ZCNeutralResourceId } from './ZCNeutralResourceReward';
import {
    defaultZCSectionAt,
    ownersForPlayerCount,
    type ZCDepth,
    type ZCMapResolvedResource,
    type ZCMapResourcePoint,
    type ZCOwner,
    type ZCPlayerCount,
    type ZCSection,
} from './ZCMapConfig';

export const ZC_SPAWN_SELECTION_SECONDS = 10;
export const ZC_SPAWN_COMPRESSED_SECONDS = 3;
export const ZC_SPAWN_AI_MIN_DELAY_SECONDS = 4;
export const ZC_SPAWN_AI_MAX_DELAY_SECONDS = 6;
export const ZC_SPAWN_AI_FOLLOW_DELAY_SECONDS = 1;

export interface ZCSpawnOwnerSelection {
    selectedHexId: number | null;
    confirmedHexId: number | null;
    invalidReason: string | null;
}

export interface ZCSpawnSelectionSnapshot {
    readonly elapsedSeconds: number;
    readonly remainingSeconds: number;
    readonly finished: boolean;
    readonly selections: Readonly<Record<ZCOwner, Readonly<ZCSpawnOwnerSelection>>>;
}

export interface ZCSpawnSelectionResult {
    readonly homes: Readonly<Record<ZCOwner, number>>;
    readonly resolvedResources: readonly ZCMapResolvedResource[];
}

export interface ZCSpawnActionResult {
    ok: boolean;
    message: string;
}

/**
 * 开局自选主城的纯逻辑状态机。
 *
 * 它不创建战斗快照，因此选点耗时不会进入单局时长。所有 AI 与资源抽取都消费调用方
 * 注入的同一随机源，服务端种子仍能完整复现「选点 + 正式对局」。
 *
 * 玩家一进来就带一个**默认落点**（`defaultHexFor`，通常 = 地图声明的默认主城）：
 * 需求要求「进入时在该位置展示基地建筑模型 + 高亮周边 6 格」，没有落点就无从展示。
 * 所以玩家侧的 `selectedHexId` 在构造后即非空，「请先选择落点」只对没预置的 AI 生效。
 */
export class ZCSpawnSelection {
    private readonly owners: readonly ZCOwner[];
    private readonly resourceByHex = new Map<number, ZCMapResourcePoint>();
    private readonly states: Record<ZCOwner, ZCSpawnOwnerSelection>;
    private readonly aiConfirmAt = new Map<ZCOwner, number>();
    private readonly homeRegionCells = new Map<number, Set<number>>();
    private readonly usesDepthRegionsForHomeSelection: boolean;
    /** 地图自己画了分区（`sections` 出现非 0）时以地图为准，没画才按布局推导半区。 */
    private readonly hasPaintedSections: boolean;
    private elapsed = 0;
    private remaining = ZC_SPAWN_SELECTION_SECONDS;
    private completed = false;
    private finalResult: ZCSpawnSelectionResult | null = null;

    constructor(
        readonly map: ZCMatchMap,
        private readonly random: () => number = Math.random,
    ) {
        if ((map.cityMode ?? 'fixed') !== 'select') throw new Error('只有自选主城地图才能进入选点阶段');
        this.owners = ownersForPlayerCount(map.playerCount ?? 2);
        this.hasPaintedSections = (map.sections ?? []).some((section) => section > 0);
        this.usesDepthRegionsForHomeSelection = !!map.regions?.length;
        for (const region of map.regions ?? []) {
            const cells = this.homeRegionCells.get(region.section);
            if (cells) {
                region.cells.forEach((cell) => cells.add(cell));
            } else {
                this.homeRegionCells.set(region.section, new Set(region.cells));
            }
        }
        this.states = Object.fromEntries(this.owners.map((owner) => [owner, {
            selectedHexId: null,
            confirmedHexId: null,
            invalidReason: null,
        }])) as Record<ZCOwner, ZCSpawnOwnerSelection>;
        for (const point of map.resourcePoints ?? []) {
            this.resourceByHex.set(point.row * map.columns + point.column, point);
        }
        const ownerWithoutSpawnCells = this.owners.find((owner) => this.legalHexes(owner, false).length === 0);
        if (ownerWithoutSpawnCells) throw new Error(`${ownerWithoutSpawnCells} 未配置可选主城区域`);
        for (const owner of this.owners.slice(1)) {
            const delay = ZC_SPAWN_AI_MIN_DELAY_SECONDS
                + this.clampedRandom() * (ZC_SPAWN_AI_MAX_DELAY_SECONDS - ZC_SPAWN_AI_MIN_DELAY_SECONDS);
            this.aiConfirmAt.set(owner, delay);
        }
        for (const owner of this.owners) {
            if (!this.legalHexes(owner, false).length) throw new Error(`${owner} 所属分区没有合法出生格`);
        }
        // 玩家一进选点阶段就要**看到自己的基地**（需求：「进入时在该位置展示基地建筑模型」），
        // 所以这里直接把落点预置到默认位置 —— 不是"没选"，而是"已预选默认位置"。
        //  只预置**玩家**：给 AI 也预置会让 `autoConfirm` 不再摇随机格，
        // 从而错开整局唯一那条随机源的消耗次序（AI 确认时机 / 资源点抽取全部跟着漂）。
        this.states.player.selectedHexId = this.defaultHexFor('player');
    }

    get snapshot(): ZCSpawnSelectionSnapshot {
        return {
            elapsedSeconds: this.elapsed,
            remainingSeconds: this.remaining,
            finished: this.completed,
            selections: this.states,
        };
    }

    get result(): ZCSpawnSelectionResult | null { return this.finalResult; }

    isResourcePoint(hexId: number): boolean { return this.resourceByHex.has(hexId); }

    /**
     * 该席位**当前落点**相邻的六边形格子（选点阶段把基地周围高亮成深蓝用的）。
     *
     * 返回地图上**真实存在**的邻格：贴着地图边缘的落点只有 3~4 个，往里才是 6 个
     * —— 需求写的「相邻的 6 个」是内圈的满值，边缘格没有第 6 个邻格可指。
     * 地图关系只由 `map.hexes[].neighbors` 给出，渲染层别自己按行列推。
     */
    baseNeighborIds(owner: ZCOwner): readonly number[] {
        const hexId = this.states[owner]?.selectedHexId ?? null;
        if (hexId === null) return [];
        return this.map.hexes[hexId]?.neighbors ?? [];
    }

    /**
     * 该席位是否还在「摆基地」—— 高亮与跟随按钮的显示判据。
     *
     * 一旦确认（或选点阶段整体结束）就不再是「正在选」，玩家点【确认位置】后
     * 高亮与按钮要一起收掉（需求 4：「退出选基地模式，基地落定，高亮消失」）。
     */
    isPlacing(owner: ZCOwner): boolean {
        const state = this.states[owner];
        return !this.completed && state !== undefined
            && state.confirmedHexId === null && state.selectedHexId !== null;
    }

    /** 资源点的代表资源 id（权重最高者；通常只配一个），选点阶段用它显示资源图标。 */
    resourceIdAt(hexId: number): ZCNeutralResourceId | null {
        const point = this.resourceByHex.get(hexId);
        if (!point) return null;
        let best: [ZCNeutralResourceId, number] | null = null;
        for (const [id, weight] of Object.entries(point.pool)) {
            if (weight <= 0 || !isZCNeutralResourceId(id)) continue;
            if (!best || weight > best[1]) best = [id, weight];
        }
        return best ? best[0] : null;
    }

    /**
     * 该格属于哪个分区（1 ~ playerCount）。地图自己画了分区就以地图为准；没有画时按布局
     * 推导半区（`defaultZCSectionAt`，与地图编辑器同口径）。返回 0 = 不属于任何分区。
     */
    regionSectionOf(hexId: number): ZCSection {
        const painted = this.map.sections?.[hexId] ?? 0;
        if (painted > 0) return painted;
        if (this.hasPaintedSections) return 0;
        const hex = this.map.hexes[hexId];
        if (!hex) return 0;
        return defaultZCSectionAt(
            this.owners.length as ZCPlayerCount, this.map.rows, this.map.columns, hex.row, hex.column,
        );
    }

    /** 该格的半区归属席位；`null` = 不属于任何分区。选点界面按它给双方半区着色。 */
    regionOwnerOf(hexId: number): ZCOwner | null {
        const section = this.regionSectionOf(hexId);
        return section >= 1 && section <= this.owners.length ? this.owners[section - 1] : null;
    }

    /** 该格是否落在**别的玩家**的半区里 —— 这种格一律不能放主城。 */
    private outsideOwnRegion(owner: ZCOwner, hexId: number): boolean {
        const section = this.regionSectionOf(hexId);
        return section !== 0 && section !== this.owners.indexOf(owner) + 1;
    }

    /** 当前格对该席位是否可选；确认后的其他主城会即时形成 R4 禁用面。 */
    invalidReason(owner: ZCOwner, hexId: number): string | null {
        const hex = this.map.hexes[hexId];
        if (!hex?.playable) return '该位置不可通行';
        if (this.resourceByHex.has(hexId)) return '资源点位所在格不可放置主城';
        if (this.outsideOwnRegion(owner, hexId)) return '不能放置到对方的区域';
        const section = this.owners.indexOf(owner) + 1;
        const regionReason = this.homeRegionInvalidReason(section, hexId);
        if (regionReason) return regionReason;
        for (const other of this.owners) {
            if (other === owner) continue;
            const confirmed = this.states[other].confirmedHexId;
            if (confirmed === null) continue;
            // 文档口径是「两城中间至少空 N 格」，故最短路径必须 >= N + 1 步。
            if (this.hexDistance(hexId, confirmed) <= (this.map.spacing?.homeMinDistance ?? 2)) {
                return '与已确认主城距离过近';
            }
        }
        return null;
    }

    select(owner: ZCOwner, hexId: number): ZCSpawnActionResult {
        if (this.completed) return this.fail('选点阶段已经结束');
        const state = this.states[owner];
        if (!state) return this.fail('该席位不在本局中');
        if (state.confirmedHexId !== null) return this.fail('主城位置已经锁定');
        const reason = this.invalidReason(owner, hexId);
        if (reason) return this.fail(reason);
        state.selectedHexId = hexId;
        state.invalidReason = null;
        return this.success('已选择主城位置');
    }

    confirm(owner: ZCOwner): ZCSpawnActionResult {
        if (this.completed) return this.fail('选点阶段已经结束');
        const state = this.states[owner];
        if (!state) return this.fail('该席位不在本局中');
        if (state.confirmedHexId !== null) return this.success('主城位置已经锁定');
        if (state.selectedHexId === null) return this.fail('请先在地图上选择落点');
        const reason = this.invalidReason(owner, state.selectedHexId);
        state.invalidReason = reason;
        if (reason) return this.fail(`${reason}，请重新选择`);

        const firstConfirmation = !this.owners.some((candidate) => this.states[candidate].confirmedHexId !== null);
        state.confirmedHexId = state.selectedHexId;
        state.invalidReason = null;
        if (firstConfirmation) this.remaining = Math.min(this.remaining, ZC_SPAWN_COMPRESSED_SECONDS);
        if (owner === 'player') {
            for (const ai of this.owners.slice(1)) {
                if (this.states[ai].confirmedHexId === null) {
                    this.aiConfirmAt.set(ai, Math.min(
                        this.aiConfirmAt.get(ai) ?? Infinity,
                        this.elapsed + ZC_SPAWN_AI_FOLLOW_DELAY_SECONDS,
                    ));
                }
            }
        }
        this.refreshSelectedValidity();
        this.finishIfReady();
        return this.success('主城位置已确认');
    }

    tick(dt: number): void {
        if (this.completed || !(dt > 0)) return;
        const step = Math.min(dt, this.remaining);
        this.elapsed += step;
        this.remaining = Math.max(0, this.remaining - step);

        for (const owner of this.owners.slice(1)) {
            if (this.states[owner].confirmedHexId !== null) continue;
            if (this.elapsed + 1e-9 < (this.aiConfirmAt.get(owner) ?? Infinity)) continue;
            this.autoConfirm(owner);
            if (this.completed) return;
        }
        if (this.remaining <= 0) {
            // 同一帧归零时按席位顺序结算；越晚结算的席位自然承担 R4 约束。
            for (const owner of this.owners) {
                if (this.states[owner].confirmedHexId === null) this.autoConfirm(owner);
            }
            this.remaining = 0;
            this.finishIfReady();
        }
    }

    legalHexes(owner: ZCOwner, applyConfirmedSpacing = true): number[] {
        return this.map.hexes
            .filter((hex) => hex.playable)
            .map((hex) => hex.id)
            .filter((id) => applyConfirmedSpacing
                ? this.invalidReason(owner, id) === null
                : this.baseInvalidReason(owner, id) === null);
    }

    /**
     * 该席位的**默认落点**（进选点阶段就摆出来的那一座基地）。
     *
     * 优先用地图声明的默认主城（`homes` 下标对应分区，与 `autoConfirm` 的兜底同源）——
     * 自选图的 `homes` 就是策划摆好的「默认位置」，镜头落点 `buildPlayerHomeFocus` 也读它。
     * 地图没声明（或声明的那格被资源点 / 分区规则否掉）时退到本席位候选集的**第一格**。
     *
     *  退路必须**确定**，不能摇随机数：整局只有一条随机源，在这里多消耗一次会把
     * AI 的确认时机与资源点抽取的次序整体错开（表现是「换个默认落点，资源就变了」）。
     */
    private defaultHexFor(owner: ZCOwner): number | null {
        const declared = this.map.homes?.[this.owners.indexOf(owner)];
        if (declared !== undefined && declared !== null && declared >= 0
            && this.invalidReason(owner, declared) === null) return declared;
        const legal = this.legalHexes(owner, false);
        return legal.length ? legal[0] : null;
    }

    private baseInvalidReason(owner: ZCOwner, hexId: number): string | null {
        const hex = this.map.hexes[hexId];
        if (!hex?.playable) return '该位置不可通行';
        if (this.resourceByHex.has(hexId)) return '资源点位不可选';
        if (this.outsideOwnRegion(owner, hexId)) return '不能放置到对方的区域';
        const section = this.owners.indexOf(owner) + 1;
        return this.homeRegionInvalidReason(section, hexId);
    }

    private homeRegionInvalidReason(section: number, hexId: number): string | null {
        if (this.usesDepthRegionsForHomeSelection) {
            const candidates = this.homeRegionCells.get(section);
            if (!candidates?.size) return '本区未配置前 / 中 / 后区域';
            return candidates.has(hexId) ? null : '该位置不在本方前 / 中 / 后区域内';
        }
        const legacyGroups = this.map.homeCandidates;
        const legacyCandidates = legacyGroups?.find((entry) => entry.section === section)?.cells;
        if (legacyGroups?.length && !legacyCandidates) return '本区未配置主城候选范围';
        if (!legacyCandidates) return '本区未配置前 / 中 / 后区域';
        return !legacyCandidates.includes(hexId) ? '该位置不在主城候选范围内' : null;
    }

    private autoConfirm(owner: ZCOwner): void {
        const state = this.states[owner];
        const selected = state.selectedHexId;
        if (selected === null || this.invalidReason(owner, selected) !== null) {
            // 优先用地图声明的默认主城（homes 下标对应分区）；该位置若被其他已确认主城
            // 挤掉（间距约束）或落在资源点上，再退到随机合法格。
            const fallback = this.map.homes?.[this.owners.indexOf(owner)];
            if (fallback !== undefined && fallback !== null && fallback >= 0 && this.invalidReason(owner, fallback) === null) {
                state.selectedHexId = fallback;
            } else {
                const legal = this.legalHexes(owner);
                if (!legal.length) throw new Error(`${owner} 没有满足主城间距约束的合法出生格`);
                state.selectedHexId = legal[Math.min(legal.length - 1, Math.floor(this.clampedRandom() * legal.length))];
            }
        }
        this.confirm(owner);
    }

    private refreshSelectedValidity(): void {
        for (const owner of this.owners) {
            const state = this.states[owner];
            if (state.confirmedHexId !== null || state.selectedHexId === null) continue;
            state.invalidReason = this.invalidReason(owner, state.selectedHexId);
        }
    }

    private finishIfReady(): void {
        if (this.completed || this.owners.some((owner) => this.states[owner].confirmedHexId === null)) return;
        const homes = Object.fromEntries(this.owners.map((owner) => [owner, this.states[owner].confirmedHexId!])) as Record<ZCOwner, number>;
        this.finalResult = { homes, resolvedResources: this.drawResources() };
        this.completed = true;
    }

    private drawResources(): ZCMapResolvedResource[] {
        return resolveZCMapResources(this.map, this.random);
    }

    private sectionOf(hexId: number): number {
        const explicit = this.map.sections?.[hexId];
        if (explicit !== undefined) return explicit;
        const owner = this.map.owners[hexId];
        const index = this.owners.indexOf(owner as ZCOwner);
        return index < 0 ? 0 : index + 1;
    }

    private depthOf(hexId: number): ZCDepth | undefined {
        return this.map.regions?.find((region) => region.cells.includes(hexId))?.depth;
    }

    /** 按地图邻接关系做 BFS；虚空造成的绕路也会被正确计入。 */
    private hexDistance(fromId: number, toId: number): number {
        if (fromId === toId) return 0;
        const seen = new Set<number>([fromId]);
        const queue = [{ id: fromId, distance: 0 }];
        for (let head = 0; head < queue.length; head += 1) {
            const current = queue[head];
            for (const next of this.map.hexes[current.id]?.neighbors ?? []) {
                if (seen.has(next)) continue;
                if (next === toId) return current.distance + 1;
                seen.add(next);
                queue.push({ id: next, distance: current.distance + 1 });
            }
        }
        return Infinity;
    }

    private clampedRandom(): number {
        const value = this.random();
        return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999999, value)) : 0;
    }

    private success(message: string): ZCSpawnActionResult { return { ok: true, message }; }
    private fail(message: string): ZCSpawnActionResult { return { ok: false, message }; }
}

/**
 * 在对局开始时冻结地图资源点的抽取结果。固定主城和自选主城共用，避免资源点只在选点流程中生效。
 */
export function resolveZCMapResources(map: ZCMatchMap, random: () => number): ZCMapResolvedResource[] {
    const resolved: ZCMapResolvedResource[] = [];
    for (const point of map.resourcePoints ?? []) {
        // 池 key 来自地图 JSON（不可信）：不认识的一律剔除，正常路径上 `ZCMapConfig` 校验已拒绝，
        // 这里只保证运行时不会把非法 id 写进快照。
        const entries = Object.entries(point.pool).filter(
            (entry): entry is [ZCNeutralResourceId, number] => entry[1] > 0 && isZCNeutralResourceId(entry[0]),
        );
        if (!entries.length) continue;
        const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
        let cursor = clampedZCResourceRandom(random) * total;
        let resourceId = entries[entries.length - 1][0];
        for (const [candidate, weight] of entries) {
            cursor -= weight;
            if (cursor < 0) { resourceId = candidate; break; }
        }
        const hexId = point.row * map.columns + point.column;
        const depth = point.depth ?? depthForZCResource(map, hexId);
        resolved.push({
            hexId,
            section: point.section ?? sectionForZCResource(map, hexId),
            ...(depth === undefined ? {} : { depth }),
            resourceId,
        });
    }
    return resolved;
}

function sectionForZCResource(map: ZCMatchMap, hexId: number): number {
    const explicit = map.sections?.[hexId];
    if (explicit !== undefined) return explicit;
    const owner = map.owners[hexId];
    const index = ownersForPlayerCount(map.playerCount ?? 2).indexOf(owner as ZCOwner);
    return index < 0 ? 0 : index + 1;
}

function depthForZCResource(map: ZCMatchMap, hexId: number): ZCDepth | undefined {
    return map.regions?.find((region) => region.cells.includes(hexId))?.depth;
}

function clampedZCResourceRandom(random: () => number): number {
    const value = random();
    return Number.isFinite(value) ? Math.max(0, Math.min(0.999999999999, value)) : 0;
}

/** 把选点结果冻结进正式对局配置；从这一刻起地图按 fixed 模式进入战斗模型。 */
export function resolveZCSpawnMatchConfig(
    source: ZCMatchConfig,
    result: ZCSpawnSelectionResult,
): ZCMatchConfig {
    const owners = ownersForPlayerCount(source.map.playerCount ?? 2);
    const homes = owners.map((owner) => result.homes[owner]);
    if (homes.some((id) => !Number.isInteger(id) || !source.map.hexes[id]?.playable)) {
        throw new Error('选点结果包含无效主城格');
    }
    const map: ZCMatchMap = {
        ...source.map,
        cityMode: 'fixed',
        homes,
        playerHomeId: homes[0],
        enemyHomeId: homes[1],
        resolvedResources: result.resolvedResources,
    };
    return { ...source, map };
}
