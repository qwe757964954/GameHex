import { Color, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import { ZCOwner } from '../model/ZCMapConfig';
import {
    ZC_NEUTRAL_REWARD_COIN_COUNT,
    ZC_NEUTRAL_REWARD_COIN_STAGGER,
    ZC_NEUTRAL_REWARD_FLY_SECONDS,
    ZC_NEUTRAL_REWARD_RISE_SECONDS,
} from '../model/ZCBattlePresentationQueue';
import { neutralResourceVisualOf, ZCNeutralResourceVisual } from '../model/ZCNeutralResourceGroup';
import type { ZCNeutralReward } from '../model/ZCGameTypes';

/**
 * 中立资源获取特效（2026-10-20 需求）：
 *   · 金币（金币堆 / 宝箱）：一把金币从格子**飞向金币栏**，落地后「+N」原地升起并淡出；
 *   · 神器（神器充能）：格心**原地炸一下**蓝色爆炸（18 帧序列帧），同时神器图标从格子
 *     **飞向神器按钮**，落地小幅放大后淡出；
 *   · 金矿：走「建筑被开发」的激活动画（模型推 `hexActivation`），不进本类；
 *   · 兵力：直接产兵、走出生表现，不进本类。
 *
 * 与 `TerritoryGainBurst` 同一套口径：**纯类、非 Component、逐帧 `render`、禁 tween**，
 * 曲线全部写成可复现的纯函数（同一 seed 每帧结果一致），节点在构造时建好、动画里只写
 * position / scale / opacity。
 *
 * 坐标口径：入参 `start` / `target` 都是 **host（全屏演出层）局部坐标**，由渲染层把
 * 格子世界坐标 / 金币栏世界坐标换算过来；本类只管在 host 下的局部位移。
 */
export const ZC_NEUTRAL_REWARD_COIN_SIZE = 34;
/** 每颗金币在起点附近的最大随机偏移（px，双轴）。 */
export const ZC_NEUTRAL_REWARD_COIN_JITTER_PX = 14;
/** 飞行弧线的上抬量（px，贝塞尔控制点在起终点中点正上方）。 */
export const ZC_NEUTRAL_REWARD_ARC_PX = 42;
/** 金币落地后的淡出时长（秒）。 */
export const ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS = 0.12;
/** 「+N」上飘的总抬升（px）。 */
export const ZC_NEUTRAL_REWARD_RISE_LIFT_PX = 40;
export const ZC_NEUTRAL_REWARD_LABEL_FONT_SIZE = 26;
export const ZC_NEUTRAL_REWARD_LABEL_WIDTH = 160;
export const ZC_NEUTRAL_REWARD_LABEL_HEIGHT = 36;
export const ZC_NEUTRAL_REWARD_ARTIFACT_SIZE = 40;
/** 神器落地后的淡出时长（秒）。 */
export const ZC_NEUTRAL_REWARD_ARTIFACT_FADE_SECONDS = 0.2;
/** 神器落地时的小幅放大（相对 1）。 */
export const ZC_NEUTRAL_REWARD_ARTIFACT_POP = 0.35;
/**
 * 神器领取爆炸的播放帧率（`image/effects/artifact_claim_burst` 原稿 24fps）。
 *
 * 18 帧 ÷ 24fps = **0.75s**，正好落在这条事件的存活窗（≈1.4s）里：
 * 爆炸先炸，神器图标同时起飞，收尾时两样都已经收干净。
 */
export const ZC_ARTIFACT_CLAIM_BURST_FPS = 24;
/**
 * 爆炸在屏上的边长（px）。
 *
 * 🔴 2026-10-27 用户口径「缩小成 0.6，不超过一个单元格」⇒ 150 → **90**（0.6 × 150）。
 * 一格顶面是 `core/hex/HexGridLayout` 的 **123×90**、整块地砖脚印 130×119
 * （`ZCGameHex.prefab` 的 `TileBackground`），90 稳在**一格之内**（0.73 个顶面宽），
 * 美术四周还带留白 ⇒ 屏上真正看得见的那团雾约 **0.6 个格子**，
 * 不会盖住邻格的资源图标与造价数字。
 *
 * ⚠️ 这个值**只决定屏上大小**，与图片像素无关（`Sprite` 是 `CUSTOM` + `trim=false`，
 * 按 `UITransform` 拉满）。当前序列帧为 90×90、四周留白很足 ——
 * 别拿「图多大」当「显示多大」，也别为了"把画面补回来"把这里放大。
 * 更别再按 220 算比例：那是 2026-10-26 之前的旧值。
 *
 * 🔴🔴 **220 / 150 / 90 三次改动在屏上全都没生效过**（2026-10-27 二次返工才查出来）：
 * `createSprite` 里「先赋 `spriteFrame`、后设 `sizeMode = CUSTOM`」的顺序，
 * 让引擎在赋图那一刻按 TRIMMED 把 `contentSize` 回写成**原图 300×300**，之后再设 CUSTOM
 * **不会把尺寸还回来** ⇒ 用户看到的永远是 300（≈2.4 格），所以他两次都说"没改小"。
 * 现在 `createSprite` 已改成「先 CUSTOM → 再赋图 → 最后兜一次 setContentSize」，
 * 90 才真的落到屏上。**判据是 `tests/zcds-artifact-claim-burst.test.ts` 里那条赋值顺序断言**
 * —— 只断言 `contentSize` 是假绿（夹具的 Sprite 桩不模拟这条引擎行为）。
 *
 * 🟢 问号状态（`ArtifactHexSpine`：六边形底 + 问号指示器，prefab 里 168×166.8，走 Spine 循环动画）
 * **不随这里变** —— 2026-10-27 明确要求「问号状态下的特效大小保持不变」。
 */
export const ZC_ARTIFACT_CLAIM_BURST_SIZE = 90;
/**
 * 收尾淡出时长（秒）。
 *
 * 末两帧原图已经基本透明，这一段只负责**防硬切**：万一换了一套尾帧不透明的图，
 * 也不会出现「啪一下没了」。
 */
export const ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS = 0.1;

/** 一次爆炸的总时长（秒）= `frameCount / FPS`；帧数非正 ⇒ `0`（不播）。 */
export function artifactClaimBurstTotalSeconds(frameCount: number): number {
    if (!Number.isFinite(frameCount) || frameCount <= 0) return 0;
    return Math.floor(frameCount) / ZC_ARTIFACT_CLAIM_BURST_FPS;
}

export interface IZCArtifactClaimBurstFrame {
    /** 该帧在序列里的下标；`visible=false` 时为 `-1`。 */
    readonly index: number;
    readonly opacity: number;
    readonly visible: boolean;
}

/**
 * 爆炸序列在 `now` 的表现帧：`[startedAt, startedAt + frameCount/FPS)` 内按 24fps 选帧，
 * 末 `ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS` 线性淡出。
 *
 * 纯函数（同一个 `now` 每帧结果一致）—— 视图只按它写 `spriteFrame` / `opacity`，
 * **不许**在节点上另叠 tween 或靠 `dt` 累加。
 */
export function artifactClaimBurstFrame(
    frameCount: number,
    startedAt: number,
    now: number,
): IZCArtifactClaimBurstFrame {
    const total = artifactClaimBurstTotalSeconds(frameCount);
    if (total <= 0) return { index: -1, opacity: 0, visible: false };
    const local = now - startedAt;
    if (!Number.isFinite(local) || local < 0 || local >= total) return { index: -1, opacity: 0, visible: false };
    const count = Math.floor(frameCount);
    const index = Math.min(count - 1, Math.floor(local * ZC_ARTIFACT_CLAIM_BURST_FPS));
    const tail = total - local;
    const opacity = tail < ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS
        ? tail / ZC_ARTIFACT_CLAIM_BURST_FADE_SECONDS
        : 1;
    return { index, opacity, visible: true };
}

/** 确定性的伪随机（[0,1)）：同一 (seed, salt) 每帧可复现，不依赖 `Math.random()`。 */
function pseudoRandom(seed: number, salt: number): number {
    const raw = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return raw - Math.floor(raw);
}

/** 事件级种子 + 序号 → 该颗金币的起点抖动（px）。 */
export function neutralRewardJitter(seed: number, index: number): { x: number; y: number } {
    return {
        x: (pseudoRandom(seed, index * 2) - 0.5) * 2 * ZC_NEUTRAL_REWARD_COIN_JITTER_PX,
        y: (pseudoRandom(seed, index * 2 + 1) - 0.5) * 2 * ZC_NEUTRAL_REWARD_COIN_JITTER_PX,
    };
}

/** 二次贝塞尔弧线上的点：起 → 目标，控制点在两点中点正上方 `ARC_PX`（轻微拱起）。 */
export function neutralRewardArcPoint(
    start: Readonly<{ x: number; y: number }>,
    target: Readonly<{ x: number; y: number }>,
    t: number,
): { x: number; y: number } {
    const controlX = (start.x + target.x) / 2;
    const controlY = (start.y + target.y) / 2 + ZC_NEUTRAL_REWARD_ARC_PX;
    const u = 1 - t;
    return {
        x: u * u * start.x + 2 * u * t * controlX + t * t * target.x,
        y: u * u * start.y + 2 * u * t * controlY + t * t * target.y,
    };
}

/** 某颗金币的弧线点（起点带该颗自己的抖动）。 */
export function neutralRewardCoinPoint(
    seed: number,
    index: number,
    start: Readonly<{ x: number; y: number }>,
    target: Readonly<{ x: number; y: number }>,
    t: number,
): { x: number; y: number } {
    const jitter = neutralRewardJitter(seed, index);
    return neutralRewardArcPoint({ x: start.x + jitter.x, y: start.y + jitter.y }, target, t);
}

export interface IZCNeutralRewardCoinFrame {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly opacity: number;
    readonly visible: boolean;
}

/**
 * 第 `index` 颗金币在 `now` 的表现帧。
 *
 * 时间轴（错峰出发）：`local = now - startedAt - index × STAGGER`；
 * 飞行段 `[0, FLY)` 走弧线、整体收缩；到达后 `[FLY, FLY + FADE)` **位置冻在落点**、
 * 线性淡出（与领地喷发「落地后位置冻结」同一口径）。
 */
export function neutralRewardCoinFrame(
    seed: number,
    index: number,
    startedAt: number,
    now: number,
    start: Readonly<{ x: number; y: number }>,
    target: Readonly<{ x: number; y: number }>,
): IZCNeutralRewardCoinFrame {
    const local = now - startedAt - index * ZC_NEUTRAL_REWARD_COIN_STAGGER;
    if (local < 0 || local > ZC_NEUTRAL_REWARD_FLY_SECONDS + ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS) {
        return { x: start.x, y: start.y, scale: 0, opacity: 0, visible: false };
    }
    const t = Math.min(local / ZC_NEUTRAL_REWARD_FLY_SECONDS, 1);
    const point = neutralRewardCoinPoint(seed, index, start, target, t);
    const after = local - ZC_NEUTRAL_REWARD_FLY_SECONDS;
    const opacity = after > 0 ? 1 - after / ZC_NEUTRAL_REWARD_COIN_FADE_SECONDS : 1;
    return { ...point, scale: 1 - 0.3 * t, opacity, visible: true };
}

export interface IZCNeutralRewardRiseFrame {
    readonly y: number;
    readonly opacity: number;
    readonly visible: boolean;
}

/**
 * 「+N」在 `now` 的表现帧：等**最后一颗金币到达**才开始，`[0, RISE)` 内
 * `easeOutCubic` 向上飘 `RISE_LIFT_PX`，前 15% 淡入、后 30% 淡出。
 */
export function neutralRewardRiseFrame(startedAt: number, now: number): IZCNeutralRewardRiseFrame {
    const labelStart = ZC_NEUTRAL_REWARD_FLY_SECONDS
        + ZC_NEUTRAL_REWARD_COIN_STAGGER * (ZC_NEUTRAL_REWARD_COIN_COUNT - 1);
    const local = now - startedAt - labelStart;
    if (local < 0 || local > ZC_NEUTRAL_REWARD_RISE_SECONDS) {
        return { y: 0, opacity: 0, visible: false };
    }
    const t = Math.min(local / ZC_NEUTRAL_REWARD_RISE_SECONDS, 1);
    const easeOut = 1 - Math.pow(1 - t, 3);
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = Math.min(1, (1 - t) / 0.3);
    return { y: ZC_NEUTRAL_REWARD_RISE_LIFT_PX * easeOut, opacity: Math.min(fadeIn, fadeOut), visible: true };
}

export interface IZCNeutralRewardArtifactFrame {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly opacity: number;
    readonly visible: boolean;
}

/**
 * 神器图标在 `now` 的表现帧：飞行段 `[0, FLY)` 走弧线（前 15% 淡入）；
 * 落地后 `[FLY, FLY + FADE)` 位置冻在落点、小幅放大（`ARTIFACT_POP`）并淡出。
 */
export function neutralRewardArtifactFrame(
    startedAt: number,
    now: number,
    start: Readonly<{ x: number; y: number }>,
    target: Readonly<{ x: number; y: number }>,
): IZCNeutralRewardArtifactFrame {
    const local = now - startedAt;
    if (local < 0 || local > ZC_NEUTRAL_REWARD_FLY_SECONDS + ZC_NEUTRAL_REWARD_ARTIFACT_FADE_SECONDS) {
        return { x: start.x, y: start.y, scale: 1, opacity: 0, visible: false };
    }
    const t = Math.min(local / ZC_NEUTRAL_REWARD_FLY_SECONDS, 1);
    const point = neutralRewardArcPoint(start, target, t);
    const after = local - ZC_NEUTRAL_REWARD_FLY_SECONDS;
    let opacity = t < 0.15 ? t / 0.15 : 1;
    let scale = 1;
    if (after > 0) {
        const fade = Math.min(after / ZC_NEUTRAL_REWARD_ARTIFACT_FADE_SECONDS, 1);
        opacity = Math.min(opacity, 1 - fade);
        scale = 1 + ZC_NEUTRAL_REWARD_ARTIFACT_POP * fade;
    }
    return { ...point, scale, opacity, visible: true };
}

/** 飞行目标（host 局部坐标）；`null` = 该目标不可用（HUD 节点缺失时整条飞行不播）。 */
export interface IZCNeutralRewardFxTargets {
    readonly goldCounter: Readonly<{ x: number; y: number }> | null;
    readonly artifactSlot: Readonly<{ x: number; y: number }> | null;
}

interface IZCNeutralRewardFxCoin {
    readonly node: Node;
    readonly opacity: UIOpacity;
    readonly index: number;
}

interface IZCNeutralRewardFxEntry {
    readonly root: Node;
    readonly id: number;
    readonly startedAt: number;
    readonly kind: 'gold' | 'artifact';
    readonly seed: number;
    readonly start: Readonly<{ x: number; y: number }>;
    readonly target: Readonly<{ x: number; y: number }>;
    readonly coins: readonly IZCNeutralRewardFxCoin[];
    readonly label: Label | null;
    readonly labelNode: Node | null;
    readonly labelOpacity: UIOpacity | null;
    readonly artifact: Sprite | null;
    readonly artifactNode: Node | null;
    readonly artifactOpacity: UIOpacity | null;
    /** 神器领取的格心爆炸（序列帧）；没配帧 / 非神器事件时为 `null`。 */
    readonly burst: Sprite | null;
    readonly burstNode: Node | null;
    readonly burstOpacity: UIOpacity | null;
}

/** 事件 id → 表现条目；事件被模型 `prune` 摘掉那一帧，条目节点销毁。 */
export class ZCNeutralRewardFx {
    private readonly entries = new Map<number, IZCNeutralRewardFxEntry>();
    /** 本帧存活事件 id 的复用集合（`render` 逐帧对齐用，见 `renderFloatTexts` 同口径）。 */
    private readonly activeIds = new Set<number>();

    constructor(
        private readonly host: Node | null,
        private readonly goldCoinFrame: SpriteFrame | null,
        private readonly artifactFrame: SpriteFrame | null,
        /**
         * 神器领取的格心爆炸序列帧（`image/effects/artifact_claim_burst`，已按帧序）。
         *
         * 空数组 ⇒ 这一层整条跳过（神器图标照常飞），不报错。缺省空数组是为了让只关心
         * 金币 / 飞行曲线的用例不必构造这套帧。
         */
        private burstFrames: readonly SpriteFrame[] = [],
    ) {}

    /** 仅改变后续领取事件的资源；既有事件继续使用原 startedAt，不重播。 */
    setBurstFrames(frames: readonly SpriteFrame[]): void { this.burstFrames = frames; }

    /** 当前存活的条目数（用例断言「建了多少个特效」用）。 */
    get size(): number {
        return this.entries.size;
    }

    /**
     * 每帧对齐事件队列并推进动画。
     *
     * @param events 本帧存活的中立资源领取事件（`frame.neutralRewards`）。
     * @param now 与模型共用的对局时钟（`visualTime`）。
     * @param resolveStart 格子中心 → host 局部坐标；格子视图不在场景里时返回 null（跳过）。
     */
    render(
        events: readonly Readonly<ZCNeutralReward>[],
        now: number,
        resolveStart: (hexId: number) => Readonly<{ x: number; y: number }> | null,
        targets: Readonly<IZCNeutralRewardFxTargets>,
    ): void {
        if (!this.host) return;
        this.activeIds.clear();
        for (const event of events) this.activeIds.add(event.id);
        for (const [id, entry] of this.entries) {
            if (!this.activeIds.has(id)) {
                if (entry.root.isValid) entry.root.destroy();
                this.entries.delete(id);
            }
        }
        for (const event of events) {
            // 非玩家领取不播飞行：金币 / 神器目标都在**玩家自己的** HUD 上（2026-10-20 口径）。
            if (event.owner !== ZCOwner.Player) continue;
            const kind = this.kindOf(event.itemId);
            if (!kind) continue;
            let entry = this.entries.get(event.id);
            if (!entry) {
                const start = resolveStart(event.hexId);
                if (!start) continue;
                const target = kind === 'gold' ? targets.goldCounter : targets.artifactSlot;
                if (!target) continue;
                entry = this.buildEntry(event, kind, start, target);
                if (!entry) continue;
                this.entries.set(event.id, entry);
            }
            this.stepEntry(entry, now);
        }
    }

    /** 销毁全部条目（换局 / 渲染世界销毁时调，避免节点跨局泄漏）。 */
    clear(): void {
        for (const entry of this.entries.values()) {
            if (entry.root.isValid) entry.root.destroy();
        }
        this.entries.clear();
    }

    /** 哪种资源播哪种飞行（按资源项的**表现键**判）；其余（建筑激活 / 兵力出生）不在本类。 */
    private kindOf(itemId: number): 'gold' | 'artifact' | null {
        const visual = neutralResourceVisualOf(itemId);
        if (visual === ZCNeutralResourceVisual.Gold || visual === ZCNeutralResourceVisual.Chest) return 'gold';
        if (visual === ZCNeutralResourceVisual.ArtifactCharge) return 'artifact';
        return null;
    }

    private buildEntry(
        event: Readonly<ZCNeutralReward>,
        kind: 'gold' | 'artifact',
        start: Readonly<{ x: number; y: number }>,
        target: Readonly<{ x: number; y: number }>,
    ): IZCNeutralRewardFxEntry | null {
        const host = this.host;
        if (!host) return null;
        const root = new Node(`NeutralReward_${event.id}`);
        root.setParent(host);
        root.layer = host.layer;
        root.active = true;
        let coins: readonly IZCNeutralRewardFxCoin[] = [];
        let label: Label | null = null;
        let labelNode: Node | null = null;
        let labelOpacity: UIOpacity | null = null;
        let artifact: Sprite | null = null;
        let artifactNode: Node | null = null;
        let artifactOpacity: UIOpacity | null = null;
        let burst: Sprite | null = null;
        let burstNode: Node | null = null;
        let burstOpacity: UIOpacity | null = null;
        if (kind === 'gold') {
            const built: IZCNeutralRewardFxCoin[] = [];
            for (let index = 0; index < ZC_NEUTRAL_REWARD_COIN_COUNT; index += 1) {
                built.push(this.createCoin(root, index));
            }
            coins = built;
            const labelView = this.createLabel(root, event.gold);
            label = labelView.label;
            labelNode = labelView.node;
            labelOpacity = labelView.opacity;
        } else {
            // 爆炸先建、压在同一 root 的最底层：神器图标随后飞走时从爆炸上掠过。
            if (this.burstFrames.length > 0) {
                const burstView = this.createSprite(root, this.burstFrames[0], ZC_ARTIFACT_CLAIM_BURST_SIZE);
                burstView.node.name = 'ArtifactClaimBurst';
                // 位置钉死格心（**不**跟飞行图标走）：爆炸是「这一格被领取」的落点标记。
                burstView.node.setPosition(start.x, start.y, 0);
                burst = burstView.sprite;
                burstNode = burstView.node;
                burstOpacity = burstView.opacity;
            }
            const spriteView = this.createSprite(root, this.artifactFrame, ZC_NEUTRAL_REWARD_ARTIFACT_SIZE);
            artifact = spriteView.sprite;
            artifactNode = spriteView.node;
            artifactOpacity = spriteView.opacity;
        }
        return {
            root,
            id: event.id,
            startedAt: event.startedAt,
            kind,
            seed: event.id,
            start,
            target,
            coins,
            label,
            labelNode,
            labelOpacity,
            artifact,
            artifactNode,
            artifactOpacity,
            burst,
            burstNode,
            burstOpacity,
        };
    }

    private createCoin(root: Node, index: number): IZCNeutralRewardFxCoin {
        const sprite = this.createSprite(root, this.goldCoinFrame, ZC_NEUTRAL_REWARD_COIN_SIZE);
        sprite.node.name = `NeutralRewardCoin_${index}`;
        return { node: sprite.node, opacity: sprite.opacity, index };
    }

    /**
     * 建一个「无 prefab、纯代码」的 Sprite 节点，屏上边长恒为 `size`。
     *
     * 🔴 **顺序铁律：`sizeMode` 必须先设成 CUSTOM，再赋 `spriteFrame`，最后再兜一遍
     *    `setContentSize`**。`Sprite._sizeMode` 出厂是 `TRIMMED`（引擎 `sprite.ts`：
     *    `protected _sizeMode = SizeMode.TRIMMED`），`spriteFrame` 的 setter 会走
     *    `_applySpriteFrame() → _applySpriteSize()`，TRIMMED 分支直接
     *    `setContentSize(frame.rect.width, frame.rect.height)` —— 把节点尺寸回写成**原图尺寸**；
     *    而 `sizeMode = CUSTOM` 的 setter 只在 **非 CUSTOM** 时才重算，**不会把尺寸还回来**。
     *
     *    所以旧写法（先赋图、后 CUSTOM）里 `transform.setContentSize(size, size)` 是**死代码**：
     *    · 爆炸 `artifact_claim_burst` 原图 **300×300** ⇒ 一直画 300px（用户口径"没改小"的真因），
     *      常量从 220 → 150 → 90 三次都没落到屏上；
     *    · 神器图标原图最大 **655×557** ⇒ 飞行图标一直是原图大小，从没按 40px 画过；
     *    · 金币 `34` 也从没生效（原图 43×43）。
     *
     *    仓库里同一条坑：`app/gm/GMManager.ts`（"旧代码里写的 104×44 从来没生效过"）、
     *    `app/activity/ActivityProgressBox.ts`（"不关掉这个回写，render() 每次换脸都会把尺寸冲回 100"）。
     */
    private createSprite(
        root: Node,
        frame: SpriteFrame | null,
        size: number,
    ): { node: Node; sprite: Sprite; opacity: UIOpacity } {
        const node = new Node();
        node.setParent(root);
        node.layer = root.layer;
        const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
        const sprite = node.addComponent(Sprite);
        // ① 先关掉「按贴图回写尺寸」，`trim` 也一起关：CUSTOM 下尺寸只认 contentSize。
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
        // ② 再赋图 —— 此刻 `_applySpriteSize()` 走的是 CUSTOM 分支，不会动 contentSize。
        sprite.spriteFrame = frame;
        // ③ 最后兜一遍：万一将来有人在中间插了改 sizeMode 的代码，尺寸仍归这里说了算。
        transform.setContentSize(size, size);
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 0;
        node.active = false;
        return { node, sprite, opacity };
    }

    private createLabel(root: Node, amount: number): { node: Node; label: Label; opacity: UIOpacity } {
        const node = new Node('NeutralRewardLabel');
        node.setParent(root);
        node.layer = root.layer;
        const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
        transform.setContentSize(ZC_NEUTRAL_REWARD_LABEL_WIDTH, ZC_NEUTRAL_REWARD_LABEL_HEIGHT);
        const label = node.addComponent(Label);
        label.string = `+${Math.max(0, Math.round(amount))}`;
        label.fontSize = ZC_NEUTRAL_REWARD_LABEL_FONT_SIZE;
        label.lineHeight = ZC_NEUTRAL_REWARD_LABEL_HEIGHT;
        label.color = new Color(255, 205, 90, 255);
        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 0;
        node.active = false;
        return { node, label, opacity };
    }

    private stepEntry(entry: IZCNeutralRewardFxEntry, now: number): void {
        if (entry.kind === 'gold') {
            let anyVisible = false;
            for (const coin of entry.coins) {
                const frame = neutralRewardCoinFrame(entry.seed, coin.index, entry.startedAt, now, entry.start, entry.target);
                if (!frame.visible) {
                    if (coin.node.active) coin.node.active = false;
                    continue;
                }
                anyVisible = true;
                coin.node.active = true;
                coin.node.setPosition(frame.x, frame.y, 0);
                coin.node.setScale(frame.scale, frame.scale, 1);
                coin.opacity.opacity = Math.round(frame.opacity * 255);
            }
            const rise = neutralRewardRiseFrame(entry.startedAt, now);
            if (entry.label && entry.labelNode && entry.labelOpacity) {
                if (!rise.visible) {
                    if (entry.labelNode.active) entry.labelNode.active = false;
                } else {
                    anyVisible = true;
                    entry.labelNode.active = true;
                    entry.labelNode.setPosition(entry.target.x, entry.target.y + rise.y, 0);
                    entry.labelOpacity.opacity = Math.round(rise.opacity * 255);
                }
            }
            if (entry.root.active !== anyVisible) entry.root.active = anyVisible;
            return;
        }
        if (!entry.artifactNode && !entry.burstNode) return;
        const burstVisible = this.stepBurst(entry, now);
        let flyingVisible = false;
        if (entry.artifact && entry.artifactNode && entry.artifactOpacity) {
            const frame = neutralRewardArtifactFrame(
                entry.startedAt, now, entry.start, entry.target,
            );
            if (frame.visible) {
                flyingVisible = true;
                entry.artifactNode.active = true;
                entry.artifactNode.setPosition(frame.x, frame.y, 0);
                entry.artifactNode.setScale(frame.scale, frame.scale, 1);
                entry.artifactOpacity.opacity = Math.round(frame.opacity * 255);
            } else if (entry.artifactNode.active) {
                entry.artifactNode.active = false;
            }
        }
        const anyVisible = burstVisible || flyingVisible;
        if (entry.root.active !== anyVisible) entry.root.active = anyVisible;
    }

    /**
     * 推进格子中心那套爆炸序列帧；返回它此刻是否可见。
     *
     * 只换 `spriteFrame` + 写 `UIOpacity`：**不建 tween、不播 `cc.Animation`**，
     * 帧序号由纯函数 `artifactClaimBurstFrame` 从 (startedAt, now) 推出来。
     */
    private stepBurst(entry: IZCNeutralRewardFxEntry, now: number): boolean {
        if (!entry.burst || !entry.burstNode || !entry.burstOpacity) return false;
        const frame = artifactClaimBurstFrame(this.burstFrames.length, entry.startedAt, now);
        if (!frame.visible) {
            if (entry.burstNode.active) entry.burstNode.active = false;
            return false;
        }
        const spriteFrame = this.burstFrames[frame.index];
        // 同帧只写一次：Sprite 换 frame 会触发一次重绘（与 `ZCHexView` 换脉冲帧同口径）。
        if (spriteFrame && entry.burst.spriteFrame !== spriteFrame) entry.burst.spriteFrame = spriteFrame;
        entry.burstNode.active = true;
        entry.burstOpacity.opacity = Math.round(frame.opacity * 255);
        return true;
    }
}
