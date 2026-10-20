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
    /** 建筑被拆掉时那团白烟雾（`units/effects/建筑死亡特效`）。缺失则这层表现直接跳过。 */
    readonly buildingDestroyFxPrefab: Prefab | null;
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

interface BuildingDestroyFxEntry {
    node: Node;
    startedAt: number;
    duration: number;
}

/**
 * 出生特效的**目标总时长**（秒）—— 2026-10-19 用户口径两改：
 * 先是「播放速度加快，动画总时长缩短成 80%」（2.0s → 1.6s），紧接着「再加速，1.6s → **1.25s**」。
 *
 * 🔴 与受击特效的 `HIT_FX_TARGET_SECONDS` 同一套做法：**锁总时长**，播放倍速由
 * `clip.duration / 目标时长` 反推（美术原速 2.0s ⇒ speed **1.6×**；24 帧 / sample 12 = 2.0s）。
 * 只动 `AnimationState.speed`，**不改资产的 `_duration`** —— 那是「帧数 / sample」的美术真值，
 * 改它等于把后半段关键帧直接丢掉（曲线时间戳不会跟着重排）。
 *
 * ⚠️ 回收点必须用**加速后**的时长（= 本值）：wrapMode 是 once，动画播完 `Normal` 会停在末帧，
 * 仍按 2.0s 回收就多出 0.75s 冻在最后一帧的残影。
 * ⚠️ 拿不到 clip 时（prefab 被改坏）也按本值挂着 —— 那种情况下没有动画可播，只是个占位时长。
 */
const SPAWN_FX_TARGET_SECONDS = 1.25;
/**
 * 阵亡特效拿不到 clip 时的兜底显示时长（秒）。
 * 正常路径从 `clip.duration` 读（死亡特效 13 帧 @12fps = 1.0833s）；仅在 prefab 损坏时兜底。
 */
const DEATH_FX_FALLBACK_DURATION = 1.1;
/**
 * 建筑摧毁特效拿不到 clip 时的兜底时长（秒）。
 * 正常路径从 `clip.duration` 读（4 帧 @12fps = 0.3333s）；仅在 prefab 损坏时兜底。
 */
const BUILDING_DESTROY_FX_FALLBACK_DURATION = 0.35;
/**
 * 受击特效的**固定总时长**（秒）—— 2026-10-17 需求「所有职业受击效果总时长固定 0.15s」。
 *
 * 🔴 **加速只动 `AnimationState.speed`，不改资产**：四条 anim 的 `_duration` 仍是
 * 「帧数 / 18fps」的美术真值（射手 0.4444s、法师 0.7222s），播放时把 speed 设成
 * `clip.duration / 0.15` 把整段压进 0.15s。美术以后改帧数/帧率，总时长照样锁死，
 * 不用回头改这里；反过来若把 0.4444 改到 anim 里，那是**截断**不是加速 ——
 * 曲线关键帧的时间戳按原 clip 长度排布，缩短 duration 等于把后半段帧直接丢掉。
 *
 * 为什么不改 `state.duration` / `clip.duration`：同上，关键帧时间戳不会跟着重排。
 * 为什么不走 `play(name, startTime)`：3.8.8 的签名只有 `play(name?)`，没有第二参。
 * `speed` 只在 `AnimationState.initialize()` 里从 `clip.speed` 取一次，`play()` / `stop()`
 * 都不重置它 ⇒ 每次播放重算同一个值是安全且幂等的（节点池化复用也不会累乘）。
 */
const HIT_FX_TARGET_SECONDS = 0.15;

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
    private readonly buildingDestroyFxNodes: BuildingDestroyFxEntry[] = [];
    /** 阵亡去重：单位在快照里消失后 renderUnitSystem 还会再走几帧，不去重会连播好几个。 */
    private readonly deadFxPending = new Set<number>();
    /**
     * 受击去重：**已经播过的**那几条 fx（存**对象引用**，不存 `fx.id`）。
     *
     * 🔴 不去重会**停顿**（2026-10-16 山猫「受击会停顿在角色上」）：模型层的 `hitFxQueue` 是
     * **按帧判定过期**的（`now >= startedAt + durationSeconds` 才出队），而渲染世界每帧把
     * **整条队列**送进来 ⇒ 同一个 fx 至少在队列里出现两帧。每帧对它 `animation.play()` 一次，
     * 而 `play()` → `AnimationState.onPlay()` → `setTime(0)` **无条件把动画 seek 回 0**
     * （真引擎实测：每 tick 重播 ⇒ 8 帧只出现第 0 帧；只播一次 ⇒ 8 帧全出）⇒ 动画被钉死在
     * 起始帧，看着就是一坨静止的特效。
     *
     * 🔴 **2026-10-17 起队列与动画同为 0.15s，去重依然必需**：0.15s 在 60fps 下是 9 帧、
     * 30fps 下也有 4~5 帧，同一个 fx 一定被推进来好几帧。别因为"两边时长相等"就把这一层删掉。
     *
     * 两个约束：
     *  - 记录必须**保留到 fx 从模型队列消失**（不是到动画播完）：否则"已播完但还在队列"的那几帧
     *    会把它**重播一次**（快闪两下）；
     *  - 用**对象引用**而不是 `fx.id`：模型层 `nextHitFxId` 换局会**从 1 重新开始**，存 id 会让
     *    新局第一个特效被上一局的记录挡掉（见 `ZCBattlePresentationQueue.reset`）。
     */
    private readonly hitFxPlayed = new Set<Readonly<ZCHitFx>>();
    /** `syncHitFx` 的暂存：本帧模型队列里还活着的 fx（用来摘掉 `hitFxPlayed` 里的过期项）。 */
    private readonly hitFxAlive = new Set<Readonly<ZCHitFx>>();

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
     * 播放本帧仍然存活的受击特效 —— **幂等**：同一个 fx 对象只播一次。
     *
     * 渲染世界每帧把模型层的**整条存活队列**送进来（队列按 `durationSeconds` 逐帧判过期），
     * 所以去重必须在这一层做。见 `hitFxPlayed` 的注释：不去重 = 每帧 `play()` 把动画钉死在第 0 帧。
     */
    syncHitFx(fxs: readonly Readonly<ZCHitFx>[], now: number): void {
        this.hitFxAlive.clear();
        for (const fx of fxs) this.hitFxAlive.add(fx);
        // 模型队列里已经没有的 ⇒ 这个 fx 彻底结束，从去重表摘掉（否则这 Set 只增不减）。
        for (const fx of this.hitFxPlayed) {
            if (!this.hitFxAlive.has(fx)) this.hitFxPlayed.delete(fx);
        }
        for (const fx of fxs) {
            if (this.hitFxPlayed.has(fx)) continue;
            this.hitFxPlayed.add(fx);
            this.playHitFx(fx, now);
        }
    }

    /**
     * 播放受击闪白特效。
     * 挂 mapLayer 而不挂被打单位：被打的单位可能在同一帧被击杀移除，挂宿主会跟着一起没了。
     *
     * ⚠️ **渲染循环里别直接调它** —— 同一个 fx 会跨很多帧一直躺在模型队列里，逐个直接调会让
     * 动画每帧被 seek 回 0。走 `syncHitFx`。
     *
     * 尺寸（需求「统一缩小 0.7」）**不在这里改**：烘在 prefab 根的 `_lscale` 里。同 `playDeathFx`
     * 的坑 —— 这里 `setScale` 会 ① 覆盖美术烘焙值 ② 池化复用每次乘一遍会逐次缩水。
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
        if (animation && clip) {
            // 池里复用回来的节点停在上一轮末端。`play()` 内部走 `crossFade(name, 0)`
            // ⇒ 先 `clear()`（stop 掉残留状态）再 `state.play()` ⇒ `setTime(0)` 从第 0 帧重走，
            // 不会先闪一帧旧画面。（不用额外 `stop()`：duration 为 0 时 crossFade 必定 clear。）
            animation.play(clip.name);
            // 🔴 统一压到 0.15s：把整段 clip 的播放速率抬到 `clip.duration / 0.15`。
            const state = animation.getState(clip.name);
            if (state) state.speed = clip.duration / HIT_FX_TARGET_SECONDS;
        }
        this.hitFxNodes.push({
            node,
            prefabKey: key,
            startedAt: now,
            // 🔴 回收点必须跟着**加速后**的时长走，不能再用 `clip.duration`：
            // 动画已被压到 0.15s，却还按 0.4444s 回收 ⇒ 后 0.29s 是 Normal(只播一遍) 定住的末帧，
            // 看着就是「闪完了还剩一坨东西杵在角色身上」—— 正是需求①要消掉的定格。
            // 拿不到 clip（prefab 损坏）时才退回模型层给的兜底时长。
            duration: clip ? HIT_FX_TARGET_SECONDS : fx.durationSeconds,
        });
    }

    /**
     * 播放建筑被拆掉的白烟雾爆炸。挂 mapLayer、坐标是该格中心（模型只给 hexId）。
     *
     * 从「废墟 spr 直接切过来」那一帧起补一层交代：建筑消失得有个爆点，否则就是凭空变废墟。
     * 尺寸烘在 prefab 根的 `_lscale`（195×195 @ 0.5641 ⇒ 屏上 110px，与受击 / 出生同基准），
     * 这里**不写 scale**，只写位置 —— 与 `playHitFx` 同一套口径（池化复用下写 scale 会逐次缩水）。
     */
    playBuildingDestroyFx(x: number, y: number, hexId: number, now: number): void {
        const prefab = this.deps.buildingDestroyFxPrefab;
        if (!prefab) return;
        const node = this.deps.pool.acquire('buildingDestroyFx', () => instantiate(prefab));
        node.setParent(this.deps.mapLayer);
        node.setSiblingIndex(this.deps.mapLayer.children.length - 1);
        node.layer = this.deps.mapLayer.layer;
        node.active = true;
        node.setPosition(x, y, 0);
        node.name = `BuildingDestroyFx_${hexId}`;
        const animation = node.getComponent(Animation);
        const clip = animation?.defaultClip ?? null;
        if (animation && clip) {
            // 池里复用回来的节点停在上一轮末尾：先 stop 清残留状态，再从头播。
            animation.stop();
            animation.play(clip.name);
        }
        this.buildingDestroyFxNodes.push({
            node,
            startedAt: now,
            duration: clip?.duration ?? BUILDING_DESTROY_FX_FALLBACK_DURATION,
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
     *
     *  **播放速度**：整段 clip 压进 `SPAWN_FX_TARGET_SECONDS`（1.25s，speed = 1.6×），
     * 存活时长同步用这个目标值。
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
            // 加速：把整段 clip 压进 `SPAWN_FX_TARGET_SECONDS`（2.0s → 1.25s ⇒ speed 1.6×）。
            // `speed` 只在 `AnimationState.initialize()` 里从 `clip.speed` 取一次，
            // `play()` / `stop()` 都不重置它 ⇒ 每次播放重算同一个值是幂等的，
            // 节点池化复用也不会累乘（同 `playHitFx` 的口径）。
            const state = animation.getState(clip.name);
            if (state) state.speed = clip.duration / SPAWN_FX_TARGET_SECONDS;
            this.spawnFxNodes.push({
                node,
                host,
                startedAt: now,
                // 🔴 回收点 = 加速后的总时长（不是 clip 原速，见 `SPAWN_FX_TARGET_SECONDS` 的说明）。
                duration: SPAWN_FX_TARGET_SECONDS,
            });
            return;
        }
        // 拿不到 clip（prefab 被改坏）：没有动画可播，只按目标时长占位。
        this.spawnFxNodes.push({
            node,
            host,
            startedAt: now,
            duration: SPAWN_FX_TARGET_SECONDS,
        });
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
        for (const entry of this.buildingDestroyFxNodes) {
            if (!entry.node.isValid) continue;
            entry.node.removeFromParent();
            this.deps.pool.release('buildingDestroyFx', entry.node);
        }
        this.buildingDestroyFxNodes.length = 0;
        this.deadFxPending.clear();
        // 去重表显式清掉：换局后模型层推的是全新的 fx 对象，旧局的没必要继续被这两个 Set 持有。
        this.hitFxPlayed.clear();
        this.hitFxAlive.clear();
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
        for (const entry of this.buildingDestroyFxNodes) {
            if (entry.node.isValid) entry.node.destroy();
        }
        this.buildingDestroyFxNodes.length = 0;
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

    /** 回收播完的建筑摧毁特效（与 `recycleDeathFx` 同口径）。 */
    recycleBuildingDestroyFx(now: number): void {
        for (let i = this.buildingDestroyFxNodes.length - 1; i >= 0; i -= 1) {
            const entry = this.buildingDestroyFxNodes[i];
            if (!entry.node.isValid) {
                this.buildingDestroyFxNodes.splice(i, 1);
                continue;
            }
            if (now < entry.startedAt + entry.duration) continue;
            entry.node.removeFromParent();
            this.deps.pool.release('buildingDestroyFx', entry.node);
            this.buildingDestroyFxNodes.splice(i, 1);
        }
    }
}
