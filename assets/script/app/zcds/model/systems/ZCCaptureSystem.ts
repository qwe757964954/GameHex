import { ZCDC_LOG_DIAGNOSTICS } from '../../ZCDCLogSwitch';
import type { ZCRuntimeRules } from '../ZCGameRuntimeConfig';
import type { ZCHexState, ZCSnapshot, ZCUnitState } from '../ZCGameTypes';
import { ZC_OWNER_ORDER, ZCOwner } from '../ZCMapConfig';
import type { ZCMapGeometry } from '../ZCMapGeometry';
import type { ZCMatchMap } from '../ZCMatchConfig';

type Occupants = Partial<Record<ZCOwner, number>>;

/** 脚点轨迹采样间距；远小于六边形边长，避免高移速单位一拍跨格时漏记。 */
const FOOTPRINT_SAMPLE_STEP = 2;

/**
 * 空地占领状态机。
 *
 * - `freeX/freeY` 是小兵脚点；本拍脚点轨迹经过的格都会参与本拍控制；
 * - 双方同时驻留时暂停；无人时衰减；原地块所属方会更快清除敌方进度；
 * - 多兵提供有限加速；目标格需要与主城连通领地相邻；
 * - 建筑、未击破城墙不参与驻留占领；废墟格已放开，可被驻留易手。
 */
export class ZCCaptureSystem {
    private readonly occupants = new Map<number, Occupants>();
    /** 驻留计数对象池：每帧归还复用，替代为每个有兵格新建 `{}`。 */
    private readonly occupantsPool: Occupants[] = [];
    /** 脚点拆成两个平行 Map，替代每单位每帧一个 `[x, y]` 临时数组。 */
    private readonly previousFootX = new Map<number, number>();
    private readonly previousFootY = new Map<number, number>();
    /** 帧内补给缓存 + 回收池：Set 和 BFS 队列跨帧复用，每帧只清空内容。 */
    private readonly supplied = new Map<ZCOwner, Set<number>>();
    private readonly supplyPool: Set<number>[] = [];
    private readonly supplyQueue: number[] = [];
    /** [ZCCapture] 临时诊断节流计数（随诊断代码一起删）。 */
    private diagStep = 0;

    constructor(
        private readonly geometry: ZCMapGeometry,
        private readonly map: ZCMatchMap,
        private readonly rules: Readonly<ZCRuntimeRules>,
    ) {}

    /** 在移动和战斗结算前记录脚点，update 时用来覆盖本拍完整位移轨迹。 */
    beginStep(units: readonly ZCUnitState[]): void {
        this.previousFootX.clear();
        this.previousFootY.clear();
        for (const unit of units) {
            if (!isActive(unit)) continue;
            this.previousFootX.set(unit.id, unit.freeX);
            this.previousFootY.set(unit.id, unit.freeY);
        }
    }

    update(state: ZCSnapshot, dt: number, capture: (hex: ZCHexState, owner: ZCOwner) => void): void {
        this.collectFootprints(state.units);
        // 回收上一帧的补给集合：缓存只在帧内有效，避免跨帧复用过期连通性。
        for (const set of this.supplied.values()) {
            set.clear();
            this.supplyPool.push(set);
        }
        this.supplied.clear();

        for (const hex of state.hexes) {
            if (!this.canBeCaptured(hex)) {
                this.clearProgress(hex);
                continue;
            }
            const occupants = this.occupants.get(hex.id);
            // 标量扫描替代 `ZC_OWNER_ORDER.map(...).filter(...)`：
            // 下游只用到「驻留阵营数」与「第一个阵营及其人数」，原写法每格要造
            // 1 个数组 + 4 个对象字面量 + 2 个闭包，是全帧最大的短命对象来源。
            let presentCount = 0;
            let firstOwner: ZCOwner = ZC_OWNER_ORDER[0];
            let firstCount = 0;
            for (let oi = 0; oi < ZC_OWNER_ORDER.length; oi += 1) {
                const owner = ZC_OWNER_ORDER[oi];
                const count = occupants?.[owner] ?? 0;
                // 与 `filter(entry => entry.count > 0)` 逐字等价：NaN 也必须被排除。
                if (!(count > 0)) continue;
                if (presentCount === 0) { firstOwner = owner; firstCount = count; }
                presentCount += 1;
            }

            // 废墟：一方小兵经过即变成该方占有（双方同格争夺时不归属），不累计驻留时间；
            // 即使废墟已经归属该方，经过也要把废墟「激活」成占有地（废墟图消失）。
            if (hex.state === 'ruins') {
                if (presentCount === 1) {
                    capture(hex, firstOwner);
                    this.clearProgress(hex);
                }
                continue;
            }

            // 两个及以上阵营同格属于争夺状态：保留但不推进任何一方的进度。
            if (presentCount > 1) continue;
            if (presentCount === 0) {
                this.reduceProgress(hex, dt * this.rules.captureDecayMultiplier);
                continue;
            }

            const owner = firstOwner;
            const speed = this.speedMultiplier(firstCount);

            // 原地块所属方驻留时，按防守倍率清除正在形成的敌方进度。
            if (hex.owner === owner) {
                this.reduceProgress(hex, dt * speed * this.rules.captureDefendMultiplier);
                continue;
            }

            if (this.rules.captureRequireSupply && !this.supplied.has(owner)) {
                this.supplied.set(owner, this.suppliedHexes(state, owner));
            }
            const hasSupply = !this.rules.captureRequireSupply || this.hasSuppliedNeighbor(hex.id, owner);
            if (!hasSupply) {
                this.reduceProgress(hex, dt * this.rules.captureDecayMultiplier);
                continue;
            }

            // 另一阵营接管时先清掉旧进度，下一拍再开始积累自己的进度。
            if (hex.captureOwner && hex.captureOwner !== owner) {
                this.reduceProgress(hex, dt * speed * this.rules.captureDefendMultiplier);
                continue;
            }
            hex.captureOwner = owner;
            hex.captureSeconds = rounded(Math.min(
                this.rules.captureSeconds,
                hex.captureSeconds + dt * speed,
            ));
            if (hex.captureSeconds + 1e-9 < this.rules.captureSeconds) continue;
            capture(hex, owner);
            this.clearProgress(hex);
        }
        if (ZCDC_LOG_DIAGNOSTICS) this.diagUncaptured(state);
    }

    /**
     * [ZCCapture] 临时诊断：有本机玩家的兵、格子却还不是本机的，逐格报出命中的拦截原因
     * （不可占 / 争夺 / 无补给 / 换手）。用来区分「判据挡住的」与「只是没累积够」。
     *
     * 🔴 挂在 `ZCDC_LOG_DIAGNOSTICS`（统一开关，默认关）后面：它每 60 拍扫全盘，
     * 一局能刷几百行，开着会把真问题埋掉。定位完把本方法 + `diagStep` 整块删掉即可。
     */
    private diagUncaptured(state: ZCSnapshot): void {
        // 🔴 守卫写在**方法内**而不是只靠调用点：调用点守卫一旦有人新增第二个调用点就会漏，
        // 早退形态让本方法整体变成诊断体（`zcds-log-switch` 判据认这两种形态）。
        if (!ZCDC_LOG_DIAGNOSTICS) return;
        this.diagStep += 1;
        if (this.diagStep % 60 !== 0) return;
        for (const hex of state.hexes) {
            if (hex.owner === ZCOwner.Player) continue;
            const occupants = this.occupants.get(hex.id);
            if (!occupants?.player) continue;
            const reasons: string[] = [];
            if (!this.canBeCaptured(hex)) {
                reasons.push(`不可占(building=${hex.building},wallHp=${hex.wallHp})`);
            }
            const present = ZC_OWNER_ORDER
                .map((owner) => ({ owner, count: occupants[owner] ?? 0 }))
                .filter((entry) => entry.count > 0);
            if (present.length > 1) {
                reasons.push(`争夺(${present.map((entry) => `${entry.owner}:${entry.count}`).join(',')})`);
            }
            if (this.rules.captureRequireSupply) {
                const supplied = this.suppliedHexes(state, ZCOwner.Player);
                const ok = this.map.hexes[hex.id].neighbors.some((id) => supplied.has(id));
                this.supplyPool.push(supplied);
                if (!ok) {
                    const near = this.map.hexes[hex.id].neighbors
                        .map((id) => `${id}:${state.hexes[id].owner}`).join(',');
                    reasons.push(`无补给(邻格 ${near})`);
                }
            }
            if (hex.captureOwner && hex.captureOwner !== ZCOwner.Player) {
                reasons.push(`换手中(captureOwner=${hex.captureOwner})`);
            }
            console.warn(`[ZCCapture] hex=${hex.id} 有我方兵但未占领：owner=${hex.owner} state=${hex.state} `
                + `captureOwner=${hex.captureOwner ?? 'null'} captureSeconds=${hex.captureSeconds} `
                + `兵数=${occupants.player} ⇒ ${reasons.length ? reasons.join(' | ') : '未命中任何拦截（只是没累积够 / 刚被清过）'}`);
        }
    }

    reset(): void {
        this.occupants.clear();
        this.previousFootX.clear();
        this.previousFootY.clear();
        this.supplied.clear();
        this.supplyQueue.length = 0;
    }

    /**
     * 统计脚点轨迹经过的格。同一单位可能在一拍内经过多个格，但每格只贡献一个兵力计数。
     * 单拍轨迹是直线、六边形是凸多边形，因此格 ID 只需连续去重，不必为每个单位分配 Set。
     */
    private collectFootprints(units: readonly ZCUnitState[]): void {
        for (const counts of this.occupants.values()) {
            // 赋 undefined 而非 delete：保住 hidden class，且 `?? 0` 与诊断读值都与改前一致。
            for (let oi = 0; oi < ZC_OWNER_ORDER.length; oi += 1) counts[ZC_OWNER_ORDER[oi]] = undefined;
            this.occupantsPool.push(counts);
        }
        this.occupants.clear();
        for (const unit of units) {
            if (!isActive(unit)) continue;
            const fromX = this.previousFootX.get(unit.id) ?? unit.freeX;
            const fromY = this.previousFootY.get(unit.id) ?? unit.freeY;
            const dx = unit.freeX - fromX;
            const dy = unit.freeY - fromY;
            const samples = Math.max(1, Math.ceil(Math.hypot(dx, dy) / FOOTPRINT_SAMPLE_STEP));
            let previousHexId: number | null = null;
            for (let index = 0; index <= samples; index += 1) {
                const ratio = index / samples;
                const id = this.geometry.hexIdAt(fromX + dx * ratio, fromY + dy * ratio);
                if (id === null || id === previousHexId) continue;
                previousHexId = id;
                let counts = this.occupants.get(id);
                if (!counts) {
                    counts = this.occupantsPool.pop() ?? {};
                    this.occupants.set(id, counts);
                }
                counts[unit.owner] = (counts[unit.owner] ?? 0) + 1;
            }
        }
    }

    /** 手写循环替代 `neighbors.some(id => ...)`，去掉每格一个闭包。 */
    private hasSuppliedNeighbor(hexId: number, owner: ZCOwner): boolean {
        const supplied = this.supplied.get(owner);
        if (!supplied) return false;
        const neighbors = this.map.hexes[hexId].neighbors;
        for (let index = 0; index < neighbors.length; index += 1) {
            if (supplied.has(neighbors[index])) return true;
        }
        return false;
    }

    private suppliedHexes(state: ZCSnapshot, owner: ZCOwner): Set<number> {
        const ownerIndex = ZC_OWNER_ORDER.indexOf(owner);
        const homeId = this.map.homes?.[ownerIndex]
            ?? (owner === ZCOwner.Player ? this.map.playerHomeId : this.map.enemyHomeId);
        const supplied = this.supplyPool.pop() ?? new Set<number>();
        supplied.clear();
        if (state.hexes[homeId]?.owner !== owner) return supplied;
        supplied.add(homeId);
        const queue = this.supplyQueue;
        queue.length = 0;
        queue.push(homeId);
        for (let head = 0; head < queue.length; head += 1) {
            const neighbors = this.map.hexes[queue[head]].neighbors;
            for (let index = 0; index < neighbors.length; index += 1) {
                const neighborId = neighbors[index];
                if (supplied.has(neighborId) || state.hexes[neighborId].owner !== owner) continue;
                supplied.add(neighborId);
                queue.push(neighborId);
            }
        }
        return supplied;
    }

    private speedMultiplier(count: number): number {
        return Math.min(
            this.rules.captureMaxSpeedMultiplier,
            1 + Math.max(0, count - 1) * this.rules.captureExtraUnitRate,
        );
    }

    private canBeCaptured(hex: ZCHexState): boolean {
        return hex.building === 'none' && hex.wallHp <= 0;
    }

    private reduceProgress(hex: ZCHexState, amount: number): void {
        if (!hex.captureOwner || hex.captureSeconds <= 0) {
            this.clearProgress(hex);
            return;
        }
        hex.captureSeconds = rounded(Math.max(0, hex.captureSeconds - amount));
        if (hex.captureSeconds <= 1e-9) this.clearProgress(hex);
    }

    private clearProgress(hex: ZCHexState): void {
        hex.captureOwner = null;
        hex.captureSeconds = 0;
    }
}

function isActive(unit: ZCUnitState): boolean {
    return unit.hp > 0 && unit.battleState !== 'dead'
        && Number.isFinite(unit.freeX) && Number.isFinite(unit.freeY);
}

function rounded(value: number): number {
    return Math.round(value * 1e9) / 1e9;
}
