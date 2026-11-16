import type { ZCUnitState } from '../ZCGameTypes';
import { ZC_OWNER_ORDER, type ZCOwner } from '../ZCMapConfig';

const EMPTY_OWNER_BUCKET: ReadonlySet<ZCUnitState> = new Set();

/** 所有单位生命周期操作同时维护 ID、所在格、owner 和存活数量索引。*/
export class ZCUnitRegistry {
    readonly byId = new Map<number, ZCUnitState>();
    readonly byHex = new Map<number, Set<ZCUnitState>>();
    private readonly byOwner = new Map<ZCOwner, Set<ZCUnitState>>();
    private readonly alive = new Set<number>();
    private readonly counts: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };

    register(unit: ZCUnitState): void {
        if (this.byId.has(unit.id)) throw new Error(`重复单位 ID：${unit.id}`);
        this.byId.set(unit.id, unit);
        this.hexBucket(unit.sourceHexId).add(unit);
        this.ownerBucket(unit.owner).add(unit);
        if (unit.battleState !== 'dead' && unit.hp > 0) {
            this.alive.add(unit.id);
            this.counts[unit.owner] += 1;
        }
    }

    move(unit: ZCUnitState, hexId: number): void {
        if (unit.sourceHexId === hexId) return;
        this.removeFromHex(unit);
        unit.sourceHexId = hexId;
        this.hexBucket(hexId).add(unit);
    }

    /**
     * 阵营变化必须走这里：owner 桶与存活计数一起迁移，避免索敌仍从旧桶里找或漏掉新桶。
     * 当前玩法没有改阵营的入口；保留该 API 供后续转换/招募类效果使用。
     */
    changeOwner(unit: ZCUnitState, owner: ZCOwner): void {
        if (unit.owner === owner) return;
        const wasAlive = this.alive.has(unit.id);
        if (wasAlive) this.counts[unit.owner] -= 1;
        const oldBucket = this.byOwner.get(unit.owner);
        oldBucket?.delete(unit);
        if (oldBucket?.size === 0) this.byOwner.delete(unit.owner);
        unit.owner = owner;
        this.ownerBucket(owner).add(unit);
        if (wasAlive) this.counts[owner] += 1;
    }

    markDead(unit: ZCUnitState): void {
        if (this.alive.delete(unit.id)) this.counts[unit.owner] -= 1;
    }

    remove(unit: ZCUnitState): void {
        this.markDead(unit);
        this.byId.delete(unit.id);
        this.removeFromHex(unit);
        const bucket = this.byOwner.get(unit.owner);
        bucket?.delete(unit);
        if (bucket?.size === 0) this.byOwner.delete(unit.owner);
    }

    count(owner: ZCOwner): number { return this.counts[owner]; }

    /** 索敌只遍历敌方 owner；返回的集合包含尸体，候选资格仍由 acquire 逐条过滤。*/
    unitsOf(owner: ZCOwner): ReadonlySet<ZCUnitState> {
        return this.byOwner.get(owner) ?? EMPTY_OWNER_BUCKET;
    }

    clear(): void {
        this.byId.clear(); this.byHex.clear(); this.byOwner.clear(); this.alive.clear();
        for (const owner of ZC_OWNER_ORDER) this.counts[owner] = 0;
    }

    private hexBucket(hexId: number): Set<ZCUnitState> {
        let bucket = this.byHex.get(hexId);
        if (!bucket) { bucket = new Set(); this.byHex.set(hexId, bucket); }
        return bucket;
    }

    private ownerBucket(owner: ZCOwner): Set<ZCUnitState> {
        let bucket = this.byOwner.get(owner);
        if (!bucket) { bucket = new Set(); this.byOwner.set(owner, bucket); }
        return bucket;
    }

    private removeFromHex(unit: ZCUnitState): void {
        const bucket = this.byHex.get(unit.sourceHexId);
        bucket?.delete(unit);
        if (bucket?.size === 0) this.byHex.delete(unit.sourceHexId);
    }
}
