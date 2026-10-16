/** 有界节点池；停用时保留子节点，离开场景时统一销毁。 */
export class ZCNodePool<T extends { active: boolean; isValid: boolean; destroy(): unknown }> {
    private readonly buckets = new Map<string, T[]>();
    private size = 0;
    constructor(private readonly capacity = 192, private readonly perKeyCapacity = 32) {}

    acquire(key: string, create: () => T): T {
        const bucket = this.buckets.get(key);
        let node: T | undefined;
        while (bucket?.length) {
            const candidate = bucket.pop()!;
            this.size--;
            if (candidate.isValid) { node = candidate; break; }
        }
        if (bucket?.length === 0) this.buckets.delete(key);
        node ??= create();
        node.active = true;
        return node;
    }

    release(key: string, node: T): void {
        if (!node.isValid) return;
        const bucket = this.buckets.get(key);
        if (this.size >= this.capacity || (bucket?.length ?? 0) >= this.perKeyCapacity) {
            node.destroy();
            return;
        }
        node.active = false;
        if (bucket) bucket.push(node);
        else this.buckets.set(key, [node]);
        this.size++;
    }

    destroy(): void {
        for (const bucket of this.buckets.values()) for (const node of bucket) if (node.isValid) node.destroy();
        this.buckets.clear();
        this.size = 0;
    }
}
