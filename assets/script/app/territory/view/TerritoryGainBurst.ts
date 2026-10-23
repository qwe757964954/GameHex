import { Node, Sprite, UIOpacity, UITransform, type SpriteFrame } from 'cc';
import {
    TERRITORY_GAIN_BURST_COUNT,
    territoryBurstParticle,
    territoryBurstTotalSeconds,
} from '../model/TerritoryResourceGain';

/**
 * 领地「获得银币 / 体力」时那一下**喷发** —— 需求 2026-10-16 row17，2026-10-17 细化：
 *
 *   「获得银币或者体力时，播放喷发的效果，喷发**多个图标**，多个图片的喷发范围
 *     限制在一个**倒圆锥**的图形，喷发的坐标点对应**点击地块的中心点坐标**，
 *     图标和数字 ui 增加上移的动画放在例子效果坐标点的**上方间隔 40px**」
 *
 *   细化口径：12 颗 / 错峰 0.025s / 出射 ±26° 的倒锥 / 初速 650±12% / 重力 1500 /
 *   飞行中 icon **绕自身水平轴上下翻面**（`scaleY = baseScale·cos(ωt+phase)`，`scaleX` 恒定）/
 *   落回台面即 0.12s 快速淡出、不穿模。
 *
 * ## 本文件负责哪半句
 *
 *  · 「喷发多个图标」+「限制在倒圆锥」+「喷发坐标点」+「翻面」+「落地淡出」 → **这里**
 *    （一把粒子 + 原点容器；曲线全在 `model/TerritoryResourceGain`）；
 *  · 「图标和数字 ui …上方 40px 上移」        → `TerritoryResourceGainView`（另一条时间线，
 *    起点由 `TerritoryMapView.playResourceGain` 摆在原点上方 40px）。
 *
 * ## 与 `TerritoryHexFlip` 同一套路（**不是** `Component`）
 *
 *  曲线在 `model/TerritoryResourceGain`（纯函数、零 cc），本文件只做**逐帧写节点**；
 *  粒子节点则是**现建**的 —— 与 `TerritoryMapView.createHex`、`ZCSEffectPool` 同一口径。
 *
 *  ⚠️ 为什么这套**没有** prefab：一粒粒子只有「一张可换的图 + 位置 / 缩放 / 透明度」，
 *    没有任何图集布局参数，而图本来就要由页面注入（飘字 prefab 里那句
 *    「帧由代码注入，prefab 里不许写死」的同一理由）⇒ 建 prefab 等于把同一张图的占位写十二遍。
 *
 * ⚠️ **不建 tween**：粒子和飘字一样是池化复用的，`tween` 挂在复用节点上会在回收后继续跑
 *    （见规则 106 / 247）。逐帧 `step(dt)` 由 `TerritoryMapView.update` 统一推进，
 *    回收时把 `elapsed` 置 -1 即可，没有需要显式销毁的定时器。
 */

/** 原点容器的节点名（仅供编辑器 / 日志排查；取节点一律走 `TerritoryGainBurst.node`）。 */
export const TERRITORY_GAIN_BURST_NODE = 'GainBurst';

/**
 * 一粒喷发图标的边长（像素，设计值 = 需求的默认 64）。
 *
 *  ⚠️ 这是画布上的相对大小，与「喷多远 / 喷多高」无关（那是模型里的速度与重力）。
 *    觉得 12×64 太满就只改这一个数 —— 喷发曲线不受影响。
 */
export const TERRITORY_GAIN_BURST_ICON_SIZE = 64;

interface ITerritoryBurstParticleNode {
    readonly node: Node;
    readonly sprite: Sprite;
    /** 每颗粒子**各自**淡出 ⇒ 一颗一个 `UIOpacity`（根上一个管不了错峰）。 */
    readonly opacity: UIOpacity;
}

/**
 * 一次喷发 = 一个「原点容器」+ `TERRITORY_GAIN_BURST_COUNT` 颗粒子。
 *
 *  容器摆在**喷发原点**（= 点击地块的中心点，由 `play()` 传入），粒子的位移直接写成
 *  容器的局部坐标 ⇒ 「相对原点」这件事只在一个地方表达。
 */
export class TerritoryGainBurst {
    /** 喷发原点容器；`active = false` 就是整喷收起（粒子都是它的子节点）。 */
    readonly node: Node;

    private readonly particles: ITerritoryBurstParticleNode[] = [];
    private seed = 0;
    /** 本次喷发的粒子数（`play` 传入；池里节点按**满喷**建好，多出来的收起来）。 */
    private count = TERRITORY_GAIN_BURST_COUNT;
    /** < 0 = 空闲（可被复用）。 */
    private elapsed = -1;

    constructor(layer: Node) {
        this.node = new Node(TERRITORY_GAIN_BURST_NODE);
        this.node.layer = layer.layer;
        this.node.setParent(layer);
        this.node.active = false;
        this.node.addComponent(UITransform);
        // ⚠️ 按**满喷**预建：粒子数按奖励量分级（5 / 9 / 12），池化节点不能每次重建，
        //   所以统一建满、`play` 时只亮前 `count` 颗。多建的 7 颗只是几个空节点，代价可忽略。
        for (let index = 0; index < TERRITORY_GAIN_BURST_COUNT; index += 1) {
            this.particles.push(this.createParticle(index));
        }
    }

    /**
     * 从 `(originX, originY)` 喷一次（**世界外的局部坐标**：与格子同坐标系，由调用方给）。
     *
     * @param frames 本次喷发要用的图，按粒子序**轮流取**（同时给银币 + 体力时两种图各喷一半）。
     *   空数组 = 图还没加载出来 ⇒ 粒子是空的（不闪不报错），与飘字「缺图仍照常升」同一口径。
     * @param seed   抖动种子：调用方每次点击换一个 ⇒ 同一格连点两次图案不同（纯函数可复现）。
     * @param count  本次吐几颗（按奖励总量分级，见 `territoryBurstCountForTotal`）；
     *   缺省满喷。超出池容量的值按满喷算，绝不越界。
     */
    play(
        originX: number,
        originY: number,
        seed: number,
        frames: readonly (SpriteFrame | null)[],
        count: number = TERRITORY_GAIN_BURST_COUNT,
    ): void {
        this.node.setPosition(originX, originY, 0);
        this.node.active = true;
        this.seed = Math.floor(seed) | 0;
        this.count = Math.max(1, Math.min(this.particles.length, Math.floor(count) || 1));
        this.elapsed = 0;
        for (let index = 0; index < this.particles.length; index += 1) {
            const particle = this.particles[index];
            // 超出本次个数的槽位：图也清掉，免得下次少喷时留着上一喷的残影。
            const frame = index < this.count && frames.length ? frames[index % frames.length] ?? null : null;
            if (particle.sprite.spriteFrame !== frame) particle.sprite.spriteFrame = frame;
            if (index >= this.count && particle.node.active) particle.node.active = false;
        }
        this.apply(0);
    }

    /**
     * 每帧推进。@returns 是否还在喷（false = 整喷放完，调用方可回收）。
     *
     * 收尾判据是「**一颗活着的都没有**」，而不是死等到 `TOTAL_SECONDS`：
     * 12 颗是按错峰各自抛物线落回台面就收的，最后一颗通常 1.2s 左右就没了，
     * 硬等到上限（1.54s）会让容器白挂 0.3s 的空帧。
     * `TOTAL_SECONDS` 只作**硬上限**兜底（脏数据让某颗永不到期时不至于挂死）。
     */
    step(dt: number): boolean {
        if (this.elapsed < 0) return false;
        this.elapsed += dt;
        if (this.elapsed >= territoryBurstTotalSeconds(this.count)) {
            this.stop();
            return false;
        }
        if (!this.apply(this.elapsed)) {
            this.stop();
            return false;
        }
        return true;
    }

    /** 立刻收尾（换章 / 重渲染前调）：整喷收起，位置留给下次 `play` 重设。 */
    stop(): void {
        this.elapsed = -1;
        if (this.node.active) this.node.active = false;
        // ⚠️ 不只收容器：池里躺着的粒子组必须是「一颗粒子都不亮」的干净状态。
        // 只收容器的话，上一喷先出场的几颗会留着 `active = true`，
        // 谁要是复用前忘了 `play`（或将来有人直接读粒子状态）就会看到上一喷的残影。
        for (const particle of this.particles) {
            if (particle.node.active) particle.node.active = false;
        }
    }

    private createParticle(index: number): ITerritoryBurstParticleNode {
        const node = new Node(`GainBurstParticle_${index}`);
        node.layer = this.node.layer;
        node.setParent(this.node);
        node.active = false;
        node.addComponent(UITransform).setContentSize(TERRITORY_GAIN_BURST_ICON_SIZE, TERRITORY_GAIN_BURST_ICON_SIZE);
        const sprite = node.addComponent(Sprite);
        // 与飘字 icon 同一口径：尺寸由**这里**定（CUSTOM + 不裁剪），图只提供画面。
        sprite.trim = false;
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        return { node, sprite, opacity: node.addComponent(UIOpacity) };
    }

    /**
     * 把这一帧的表现写进节点。
     *
     * @returns 是否还有活着的粒子（`false` = 整喷可以收）。
     */
    private apply(elapsed: number): boolean {
        let alive = false;
        for (let index = 0; index < this.particles.length; index += 1) {
            const { node, opacity } = this.particles[index];
            // 本次没打算喷这么多颗 ⇒ 这一槽一律收起（不参与「还活着吗」的判定）。
            const fx = index < this.count ? territoryBurstParticle(this.seed, index, elapsed, this.count) : null;
            // null = 这颗还没出发（错峰）或已经消失 ⇒ 直接收起，别让它停在上一帧的位置上。
            if (!fx) {
                if (node.active) node.active = false;
                continue;
            }
            alive = true;
            if (!node.active) node.active = true;
            node.setPosition(fx.offsetX, fx.offsetY, 0);
            // 需求原话：`setScale(baseScale, baseScale * cos(...), 1)` —— 翻面只压 `y`，
            // 横向宽度必须保持原样，否则「翻面」会读成「整体缩小」。
            node.setScale(fx.scaleX, fx.scaleY, 1);
            const alpha = Math.max(0, Math.min(255, Math.round(fx.opacity * 255)));
            if (opacity.opacity !== alpha) opacity.opacity = alpha;
        }
        return alive;
    }
}
