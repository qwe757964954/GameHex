import { Animation, instantiate, Node, Prefab } from 'cc';
import type { ZCAttackTrait } from '../model/ZCCombatCatalog';
import type { ZCHitFx } from '../model/ZCGameTypes';
import { ZCNodePool } from './ZCNodePool';

/** 资源在构造前准备好；对象池、挂载层和资源的所有权归调用方。 */
export interface IZCEffectPoolDeps {
    /** 对象池（复用 hitFx / deathFx / spawnFx 节点）。 */
    readonly pool: ZCNodePool<Node>;
    /** 特效挂载的父节点（mapLayer）。 */
    readonly mapLayer: Node;
    readonly spawnFxPrefab: Prefab | null;
    readonly deathFxPrefab: Prefab | null;
    readonly hitFxPrefabs: ReadonlyMap<ZCAttackTrait, Prefab>;
    /** 棋盘坐标 → 视图坐标换算（命中特效用）。 */
    mapToViewX: (x: number) => number;
    mapToViewY: (y: number) => number;
}

interface SpawnFxEntry {
    node: Node;
    host: Node;
    startedAt: number;
    duration: number;
}

interface HitFxEntry {
    node: Node;
    prefabKey: string;
    startedAt: number;
    duration: number;
}

interface DeathFxEntry {
    node: Node;
    startedAt: number;
    duration: number;
}

/**
 * 出生特效拿不到 clip 时的兜底显示时长（秒）。
 * 正常路径时长从 `clip.duration` 读（出生特效 24 帧 @16fps = 1.5s），改美术帧率不受影响；
 * 只在 prefab 被改坏、连 `defaultClip` 都没有时兜底。
 */
const SPAWN_FX_FALLBACK_DURATION = 1.5;
/**
 * 阵亡特效拿不到 clip 时的兜底显示时长（秒）。
 * 正常路径从 `clip.duration` 读（死亡特效 13 帧 @12fps = 1.0833s）；仅在 prefab 损坏时兜底。
 */
const DEATH_FX_FALLBACK_DURATION = 1.1;

/**
 * 对局特效池：受击闪白、阵亡特效、出生光柱。
 *
 * 三类特效各自独立的时间轴回收，全部走对象池复用，不 destroy 节点。
 * - 命中特效：挂 mapLayer、自己算坐标，与宿主存活无关
 * - 阵亡特效：挂 mapLayer、按 unitId 去重只播一次
 * - 出生光柱：挂单位节点下，跟随宿主插值移动
 */
export class ZCEffectPool {
    private readonly spawnFxNodes: SpawnFxEntry[] = [];
    private readonly hitFxNodes: HitFxEntry[] = [];
    private readonly deathFxNodes: DeathFxEntry[] = [];
    /** 阵亡去重：单位在快照里消失后 renderUnitSystem 还会再走几帧，不去重会连播好几个。 */
    private readonly deadFxPending = new Set<number>();

    constructor(private readonly deps: IZCEffectPoolDeps) {}

    /**
     * 每帧调用：回收所有播完的特效。
     */
    update(now: number): void {
        this.recycleSpawnFx(now);
        this.recycleHitFx(now);
        this.recycleDeathFx(now);
    }

    /**
     * 播放受击闪白特效。
     * 挂 mapLayer 而不挂被打单位：被打的单位可能在同一帧被击杀移除，挂宿主会跟着一起没了。
     */
    playHitFx(fx: Readonly<ZCHitFx>, now: number): void {
        const prefabs = this.deps.hitFxPrefabs;
        if (!prefabs || prefabs.size === 0) return;
        const prefab = prefabs.get(fx.trait);
        // 这个职业没交资源 ⇒ 跳过这一下（不猜默认职业，也不复用别的职业的闪白）。
        if (!prefab) return;
        const key = `hitFx:${fx.trait}`;
        const node = this.deps.pool.acquire(key, () => instantiate(prefab));
        node.setParent(this.deps.mapLayer);
        node.setSiblingIndex(this.deps.mapLayer.children.length - 1);
        node.layer = this.deps.mapLayer.layer;
        // 必须过 mapToViewX/Y：ZCHitFx.x/y 是模型的棋盘坐标，node.setPosition 吃的是视图局部坐标。
        node.setPosition(this.deps.mapToViewX(fx.x), this.deps.mapToViewY(fx.y), 0);
        node.name = `HitFx_${fx.trait}_${fx.id}`;
        const animation = node.getComponent(Animation);
        const clip = animation?.defaultClip ?? null;
        // 池里复用回来的节点停在上一轮末帧，必须 stop/play 一遍，否则会先闪一帧旧画面。
        if (animation && clip) animation.play(clip.name);
        this.hitFxNodes.push({
            node,
            prefabKey: key,
            startedAt: now,
            duration: clip?.duration ?? fx.durationSeconds,
        });
    }

    /**
     * 播放阵亡特效。按 unitId 去重，同一次阵亡只播一次。
     * 挂 mapLayer、不挂宿主：宿主 0.45s 后就被移除，挂它身上会中途消失。
     *
     *  ⚠️ **显示大小不在这里改**：尺寸烘在 prefab 根的 `_lscale`（535×1092 @ 0.16448 ⇒ 屏上 88×179.6）。
     *  反馈「缩小成 0.8」= 把这个数整体乘 0.8，改的是 prefab 不是代码。
     *  在这里 `setScale` 会 ① 覆盖掉美术烘焙值（同 `playSpawnFx` 的坑，改了"没效果"还不报错），
     *  ② 节点是**池化复用**的 —— 每次播放乘一次会逐次缩水。
     *  位置反而是唯一必须在这里写的：`x/y` 来自模型快照，prefab 的 `_lpos` 是 (0,0,0)。
     */
    playDeathFx(x: number, y: number, unitId: number, now: number): void {
        const prefab = this.deps.deathFxPrefab;
        if (!prefab) return;
        if (this.deadFxPending.has(unitId)) return;
        this.deadFxPending.add(unitId);
        const node = this.deps.pool.acquire('deathFx', () => instantiate(prefab));
        node.setParent(this.deps.mapLayer);
        node.setSiblingIndex(this.deps.mapLayer.children.length - 1);
        node.layer = this.deps.mapLayer.layer;
        node.setPosition(x, y, 0);
        const animation = node.getComponent(Animation);
        const clip = animation?.defaultClip ?? null;
        if (animation && clip) {
            animation.stop();
            animation.play(clip.name);
        }
        this.deathFxNodes.push({
            node,
            startedAt: now,
            duration: clip?.duration ?? DEATH_FX_FALLBACK_DURATION,
        });
    }

    /**
     * 播放出生光柱。挂单位节点下，跟随宿主插值移动。
     *
     *  **刻意不写 `setPosition`/`setScale`**：垂直落位与缩放都烘在 prefab 的 `_lpos`/`_lscale`
     * 里（美术对着真机调的，比如把光柱重心从头顶压到胸口）。这里 `setPosition(0,0,0)` 会直接
     * 覆盖掉它，表现为「改了 prefab 完全没效果」且不报错。池化复用天然保留上一次的 `_lpos`。
     */
    playSpawnFx(host: Node, now: number): void {
        const prefab = this.deps.spawnFxPrefab;
        if (!prefab) return;
        const node = this.deps.pool.acquire('spawnFx', () => instantiate(prefab));
        node.setParent(host);
        node.setSiblingIndex(host.children.length - 1);
        node.layer = host.layer;
        node.active = true;
        const animation = node.getComponent(Animation);
        const clip = animation?.defaultClip ?? null;
        if (animation && clip) {
            animation.stop();
            animation.play(clip.name);
            this.spawnFxNodes.push({ node, host, startedAt: now, duration: clip.duration });
            return;
        }
        // 拿不到 clip（prefab 被改坏）：按兜底时长。
        this.spawnFxNodes.push({ node, host, startedAt: now, duration: SPAWN_FX_FALLBACK_DURATION });
    }

    /**
     * 单位实体被移除时，摘掉挂在它身上的出生特效。
     * 不摘的话光柱会跟着宿主进池，直到计时到了才消失 —— 表现为「人没了原地还立着光柱」。
     */
    detachSpawnFxOf(host: Node): void {
        for (let i = this.spawnFxNodes.length - 1; i >= 0; i--) {
            if (this.spawnFxNodes[i].host === host) this.recycleSpawnFxEntry(i);
        }
    }

    /** 阵亡单位已从快照移除后，清掉去重记录。 */
    clearDeadFxPending(unitId: number): void {
        this.deadFxPending.delete(unitId);
    }

    /** 清空所有特效（换局 / destroy 时调用）。 */
    clear(): void {
        for (const entry of this.spawnFxNodes) {
            if (!entry.node.isValid) continue;
            entry.node.removeFromParent();
            this.deps.pool.release('spawnFx', entry.node);
        }
        this.spawnFxNodes.length = 0;
        for (const entry of this.hitFxNodes) {
            if (!entry.node.isValid) continue;
            entry.node.removeFromParent();
            this.deps.pool.release(entry.prefabKey, entry.node);
        }
        this.hitFxNodes.length = 0;
        for (const entry of this.deathFxNodes) {
            if (!entry.node.isValid) continue;
            entry.node.removeFromParent();
            this.deps.pool.release('deathFx', entry.node);
        }
        this.deathFxNodes.length = 0;
        this.deadFxPending.clear();
    }

    /**
     * 销毁所有**正在播放**的特效节点（渲染世界 `destroy()` 时调用）。
     *
     * 与 `clear()` 的区别：这里**直接 destroy、不回池** —— 调用方紧接着会
     * `pool.destroy()` 销毁整个对象池，回池没有意义。在播节点此刻不在池里，
     * 必须显式 destroy，否则会泄漏到下一局。
     */
    destroy(): void {
        for (const entry of this.spawnFxNodes) {
            if (entry.node.isValid) entry.node.destroy();
        }
        this.spawnFxNodes.length = 0;
        for (const entry of this.hitFxNodes) {
            if (entry.node.isValid) entry.node.destroy();
        }
        this.hitFxNodes.length = 0;
        for (const entry of this.deathFxNodes) {
            if (entry.node.isValid) entry.node.destroy();
        }
        this.deathFxNodes.length = 0;
        this.deadFxPending.clear();
    }

    /** 回收播完的出生特效。 */
    recycleSpawnFx(now: number): void {
        for (let i = this.spawnFxNodes.length - 1; i >= 0; i--) {
            const entry = this.spawnFxNodes[i];
            if (now < entry.startedAt + entry.duration) continue;
            this.recycleSpawnFxEntry(i);
        }
    }

    /**
     * 把第 index 条出生特效摘下来回池 —— 播完、或它的宿主单位已经没了。
     *
     *  **回池前必须 `removeFromParent`**：光柱是单位节点的子节点，而单位节点自己也在池里
     * （key = `unit:<unitId>`）。不摘就等于把光柱塞进别人的子树，池复用时它会跟着一个**完全
     * 无关的单位**一起被 setParent 到新父节点，光柱凭空出现在地图中间。
     */
    private recycleSpawnFxEntry(index: number): void {
        const entry = this.spawnFxNodes[index];
        this.spawnFxNodes.splice(index, 1);
        if (!entry.node.isValid) return;
        entry.node.removeFromParent();
        this.deps.pool.release('spawnFx', entry.node);
    }

    /** 回收播完的受击特效。 */
    recycleHitFx(now: number): void {
        for (let i = this.hitFxNodes.length - 1; i >= 0; i -= 1) {
            const entry = this.hitFxNodes[i];
            if (now < entry.startedAt + entry.duration) continue;
            if (entry.node.isValid) {
                entry.node.removeFromParent();
                this.deps.pool.release(entry.prefabKey, entry.node);
            }
            this.hitFxNodes.splice(i, 1);
        }
    }

    /** 回收播完的阵亡特效。 */
    recycleDeathFx(now: number): void {
        for (let i = this.deathFxNodes.length - 1; i >= 0; i -= 1) {
            const entry = this.deathFxNodes[i];
            // 兜底：节点被别处销毁过就直接丢，别回池一个已销毁的壳。
            if (!entry.node.isValid) {
                this.deathFxNodes.splice(i, 1);
                continue;
            }
            if (now < entry.startedAt + entry.duration) continue;
            entry.node.removeFromParent();
            this.deps.pool.release('deathFx', entry.node);
            this.deathFxNodes.splice(i, 1);
        }
    }
}
