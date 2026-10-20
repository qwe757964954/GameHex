import type { ZCUnitState } from '../ZCGameTypes';
import { ZC_OWNER_ORDER, type ZCOwner } from '../ZCMapConfig';

/** 所有单位生命周期操作同时维护 ID、所在格和存活数量索引。 */
export class ZCUnitRegistry {
    readonly byId = new Map<number, ZCUnitState>();
    readonly byHex = new Map<number, Set<ZCUnitState>>();
    private readonly alive = new Set<number>();
    private readonly counts: Record<ZCOwner, number> = { player: 0, enemy: 0, enemy2: 0, enemy3: 0 };

    register(unit: ZCUnitState): void {
        if (this.byId.has(unit.id)) throw new Error(`重复单位 ID：${unit.id}`);
        this.byId.set(unit.id, unit);
        this.bucket(unit.sourceHexId).add(unit);
        if (unit.battleState !== 'dead' && unit.hp > 0) {
            this.alive.add(unit.id);
            this.counts[unit.owner] += 1;
        }
    }

    move(unit: ZCUnitState, hexId: number): void {
        if (unit.sourceHexId === hexId) return;
        this.removeFromHex(unit);
        unit.sourceHexId = hexId;
        this.bucket(hexId).add(unit);
    }

    markDead(unit: ZCUnitState): void {
        if (this.alive.delete(unit.id)) this.counts[unit.owner] -= 1;
    }

    remove(unit: ZCUnitState): void {
        this.markDead(unit);
        this.byId.delete(unit.id);
        this.removeFromHex(unit);
    }

    count(owner: ZCOwner): number { return this.counts[owner]; }

    clear(): void {
        this.byId.clear(); this.byHex.clear(); this.alive.clear();
        for (const owner of ZC_OWNER_ORDER) this.counts[owner] = 0;
    }

    private bucket(hexId: number): Set<ZCUnitState> {
        let bucket = this.byHex.get(hexId);
        if (!bucket) { bucket = new Set(); this.byHex.set(hexId, bucket); }
        return bucket;
    }

    private removeFromHex(unit: ZCUnitState): void {
        const bucket = this.byHex.get(unit.sourceHexId);
        bucket?.delete(unit);
        if (bucket?.size === 0) this.byHex.delete(unit.sourceHexId);
    }
}
