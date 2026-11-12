import { Node, Sprite, UIOpacity, UITransform, type SpriteFrame } from 'cc';
import {
    TERRITORY_HERO_FLIGHT_MAX_COUNT,
    territoryHeroFlightArriveAt,
    territoryHeroFlightCountOf,
    territoryHeroFlightFx,
    territoryHeroFlightTotalSeconds,
} from '../model/TerritoryHeroReward';

/**
 * 随机格「碎片 / 种族经验 → 飞向底部英雄按钮」的**轻量飞行**（2026-11-10 需求 ②）。
 *
 * ## 为什么不是复用 `TerritoryChestView` 的 Fly 层
 *
 * 那套 Fly 活在开箱覆盖层里，与三档镜头 / 光柱 /  input 锁 / `onDone` 结算绑成一整台戏；
 * 随机格是「解锁即发奖」，本来就有格心喷发 + 一条合成读数，只需要**补一段**飞行。
 * 借它的壳会把「不弹窗、不锁输入」的随机格语义一起改掉。
 *
 * ⇒ 曲线另立真源 `model/TerritoryHeroReward`，但**贝塞尔公式与固定格同款**
 * （`TerritoryChestView.applyFly`），玩家看到的是同一种「奖励被收进按钮」的语言。
 *
 * ## 与 `TerritoryGainBurst` 同一套路
 *
 * 非 `Component`、不是 tween：逐帧 `step(dt)` 由 `TerritoryMapView.update` 统一推进，
 * 节点池化（换章 / 复位时 `stop()` 只收不销毁），时钟置 `-1` 即空闲。
 */

export const TERRITORY_HERO_FLIGHT_NODE = 'HeroRewardFlight';
/** 单枚飞行图标的边长（像素）。与格心喷发 64px 同量级，略小一点免得盖住读数。 */
export const TERRITORY_HERO_FLIGHT_ICON_SIZE = 56;

export interface ITerritoryHeroFlightEntry {
    readonly frame: SpriteFrame | null;
}

/** 覆盖层局部坐标（页面坐标系，不跟地图镜头缩放）。 */
export interface ITerritoryHeroFlightPoint {
    readonly x: number;
    readonly y: number;
}

interface ITerritoryHeroFlightSlot {
    readonly node: Node;
    readonly sprite: Sprite;
    readonly opacity: UIOpacity;
}

export class TerritoryHeroFlight {
    readonly node: Node;

    private readonly slots: ITerritoryHeroFlightSlot[] = [];
    private entries: readonly ITerritoryHeroFlightEntry[] = [];
    private origin: ITerritoryHeroFlightPoint = { x: 0, y: 0 };
    private target: ITerritoryHeroFlightPoint = { x: 0, y: 0 };
    private count = 0;
    /** < 0 = 空闲（可被复用）。 */
    private elapsed = -1;
    /** 本批只通知一次落地（第一枚到达时），避免按钮被连抖 8 次。 */
    private landed = false;
    private onLanded: (() => void) | null = null;

    constructor(layer: Node) {
        this.node = new Node(TERRITORY_HERO_FLIGHT_NODE);
        this.node.layer = layer.layer;
        this.node.setParent(layer);
        this.node.active = false;
        this.node.addComponent(UITransform);
        for (let index = 0; index < TERRITORY_HERO_FLIGHT_MAX_COUNT; index += 1) {
            this.slots.push(this.createSlot(index));
        }
    }

    /**
     * 起播一次飞行。
     *
     * @param origin 格心（覆盖层局部坐标，`TerritoryMapView.cellPointInOverlay` 给）
     * @param target 英雄按钮图标中心（覆盖层局部坐标，`setHeroRewardTargetWorld` 换算好）
     * @param entries 要飞的奖励图标，按 `index % entries.length` 轮流取；查不到图只是空图标
     * @param onLanded 第一枚落地时回调一次（页面据此让英雄按钮抖一下）
     */
    play(
        origin: ITerritoryHeroFlightPoint,
        target: ITerritoryHeroFlightPoint,
        entries: readonly ITerritoryHeroFlightEntry[],
        onLanded: (() => void) | null,
    ): boolean {
        if (!entries.length) return false;
        this.origin = { x: origin.x, y: origin.y };
        this.target = { x: target.x, y: target.y };
        this.entries = entries;
        this.count = territoryHeroFlightCountOf(entries.length);
        this.elapsed = 0;
        this.landed = false;
        this.onLanded = onLanded;
        this.node.active = true;
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index];
            const frame = index < this.count
                ? this.entries[index % this.entries.length]?.frame ?? null
                : null;
            if (slot.sprite.spriteFrame !== frame) slot.sprite.spriteFrame = frame;
        }
        this.apply(0);
        return true;
    }

    /** 每帧推进。@returns 是否还在飞（false = 已收工，调用方可回池）。 */
    step(dt: number): boolean {
        if (this.elapsed < 0) return false;
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.elapsed += step;
        // 🔴 按**显式到达时刻**判，而不是看 `fx` 变 null 的隐式窗口（掉帧会漏）。
        if (!this.landed && this.elapsed >= territoryHeroFlightArriveAt(0, this.count)) {
            this.landed = true;
            this.onLanded?.();
        }
        if (this.elapsed >= territoryHeroFlightTotalSeconds(this.count)) {
            this.stop();
            return false;
        }
        this.apply(this.elapsed);
        return true;
    }

    /** 立刻收尾（换章 / 地图重建前调）：整批收起，节点留着给下次 `play` 复用。 */
    stop(): void {
        this.elapsed = -1;
        this.landed = false;
        this.onLanded = null;
        if (this.node.active) this.node.active = false;
        for (const slot of this.slots) {
            if (slot.node.active) slot.node.active = false;
        }
    }

    private createSlot(index: number): ITerritoryHeroFlightSlot {
        const node = new Node(`HeroRewardFlightSlot_${index}`);
        node.layer = this.node.layer;
        node.setParent(this.node);
        node.active = false;
        node.addComponent(UITransform).setContentSize(
            TERRITORY_HERO_FLIGHT_ICON_SIZE, TERRITORY_HERO_FLIGHT_ICON_SIZE);
        const sprite = node.addComponent(Sprite);
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        return { node, sprite, opacity: node.addComponent(UIOpacity) };
    }

    /** 把这一帧写进节点；二次贝塞尔与 `TerritoryChestView.applyFly` 同款。 */
    private apply(elapsed: number): void {
        for (let index = 0; index < this.slots.length; index += 1) {
            const slot = this.slots[index];
            const fx = index < this.count ? territoryHeroFlightFx(elapsed, index, this.count) : null;
            if (!fx) {
                if (slot.node.active) slot.node.active = false;
                continue;
            }
            if (!slot.node.active) slot.node.active = true;
            const jitterX = (index % 2 === 0 ? -1 : 1) * (6 + (index % 5) * 2);
            const startX = this.origin.x + jitterX;
            const startY = this.origin.y + 16 + (index % 6) * 5;
            const dx = this.target.x - startX;
            const dy = this.target.y - startY;
            const controlX = startX + dx * 0.3;
            const controlY = startY + Math.abs(dy) * fx.arcRatio;
            const inv = 1 - fx.progress;
            const x = inv * inv * startX + 2 * inv * fx.progress * controlX
                + fx.progress * fx.progress * this.target.x;
            const y = inv * inv * startY + 2 * inv * fx.progress * controlY
                + fx.progress * fx.progress * this.target.y;
            slot.node.setPosition(x, y, 0);
            slot.node.setScale(fx.scale, fx.scale, 1);
            const alpha = Math.max(0, Math.min(255, Math.round(fx.opacity * 255)));
            if (slot.opacity.opacity !== alpha) slot.opacity.opacity = alpha;
        }
    }
}
