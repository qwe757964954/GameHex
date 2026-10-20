import { Color, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import {
    ZC_NEUTRAL_REWARD_COIN_COUNT,
    ZC_NEUTRAL_REWARD_COIN_STAGGER,
    ZC_NEUTRAL_REWARD_FLY_SECONDS,
    ZC_NEUTRAL_REWARD_RISE_SECONDS,
} from '../model/ZCBattlePresentationQueue';
import { ZCNeutralResourceId } from '../model/ZCNeutralResourceReward';
import type { ZCNeutralReward } from '../model/ZCGameTypes';

/**
 * 中立资源获取特效（2026-10-20 需求）：
 *   · 金币（金币堆 / 宝箱）：一把金币从格子**飞向金币栏**，落地后「+N」原地升起并淡出；
 *   · 神器（神器充能）：神器图标从格子**飞向神器按钮**，落地小幅放大后淡出；
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
}

/** 事件 id → 表现条目；事件被模型 `prune` 摘掉那一帧，条目节点销毁。 */
export class ZCNeutralRewardFx {
    private readonly entries = new Map<number, ZCNeutralRewardFxEntry>();
    /** 本帧存活事件 id 的复用集合（`render` 逐帧对齐用，见 `renderFloatTexts` 同口径）。 */
    private readonly activeIds = new Set<number>();

    constructor(
        private readonly host: Node | null,
        private readonly goldCoinFrame: SpriteFrame | null,
        private readonly artifactFrame: SpriteFrame | null,
    ) {}

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
            if (event.owner !== 'player') continue;
            const kind = this.kindOf(event.resourceId);
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

    /** 哪种资源播哪种飞行；其余（金矿激活 / 兵力出生）不在本类。 */
    private kindOf(resourceId: string): 'gold' | 'artifact' | null {
        if (resourceId === ZCNeutralResourceId.Gold || resourceId === ZCNeutralResourceId.Chest) return 'gold';
        if (resourceId === ZCNeutralResourceId.ArtifactCharge) return 'artifact';
        return null;
    }

    private buildEntry(
        event: Readonly<ZCNeutralReward>,
        kind: 'gold' | 'artifact',
        start: Readonly<{ x: number; y: number }>,
        target: Readonly<{ x: number; y: number }>,
    ): ZCNeutralRewardFxEntry | null {
        const root = new Node(`NeutralReward_${event.id}`);
        root.setParent(this.host!);
        root.layer = this.host!.layer;
        root.active = true;
        let coins: readonly IZCNeutralRewardFxCoin[] = [];
        let label: Label | null = null;
        let labelNode: Node | null = null;
        let labelOpacity: UIOpacity | null = null;
        let artifact: Sprite | null = null;
        let artifactNode: Node | null = null;
        let artifactOpacity: UIOpacity | null = null;
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
        };
    }

    private createCoin(root: Node, index: number): IZCNeutralRewardFxCoin {
        const sprite = this.createSprite(root, this.goldCoinFrame, ZC_NEUTRAL_REWARD_COIN_SIZE);
        sprite.node.name = `NeutralRewardCoin_${index}`;
        return { node: sprite.node, opacity: sprite.opacity, index };
    }

    private createSprite(
        root: Node,
        frame: SpriteFrame | null,
        size: number,
    ): { node: Node; sprite: Sprite; opacity: UIOpacity } {
        const node = new Node();
        node.setParent(root);
        node.layer = root.layer;
        const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
        transform.setContentSize(size, size);
        const sprite = node.addComponent(Sprite);
        sprite.spriteFrame = frame;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.trim = false;
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

    private stepEntry(entry: ZCNeutralRewardFxEntry, now: number): void {
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
        if (!entry.artifact || !entry.artifactNode || !entry.artifactOpacity) return;
        const frame = neutralRewardArtifactFrame(
            entry.startedAt, now, entry.start, entry.target,
        );
        if (!frame.visible) {
            if (entry.root.active) entry.root.active = false;
            return;
        }
        entry.root.active = true;
        entry.artifactNode.active = true;
        entry.artifactNode.setPosition(frame.x, frame.y, 0);
        entry.artifactNode.setScale(frame.scale, frame.scale, 1);
        entry.artifactOpacity.opacity = Math.round(frame.opacity * 255);
    }
}
