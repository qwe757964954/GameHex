import type { ZCAttackTrait } from './ZCCombatCatalog';
import type {
    ZCBuildingDestruction, ZCBuildingShake, ZCBuildingType, ZCCardReveal, ZCFloatText, ZCFloatTextKind,
    ZCHexActivation, ZCHitFx, ZCNeutralReward,
} from './ZCGameTypes';
import type { ZCOwner } from './ZCMapConfig';
import {
    HEX_FLIP_SECONDS,
    HEX_PULSE_WAVE_SECONDS,
} from '../../../core/hex/HexFlipPresentation';
import {
    ZC_NEUTRAL_BURST_COUNT,
    zcNeutralBurstTotalSeconds,
} from './ZCNeutralBurst';

const FLOAT_TEXT_CAP = 96;
const CARD_REVEAL_CAP = 24;
const HEX_ACTIVATION_CAP = 24;
/**
 * 受击特效队列上限。
 *
 * 比飘字小一个量级：受击特效是**贴在被打者身上的一次性闪光**，视觉上更抢眼，一屏里
 * 同时铺几十个会糊成一片；超出的直接丢最旧的（与飘字同策略：丢最旧、不阻塞新事件）。
 * 一波 4 个兵的齐射也只占 4~8 个，远没到上限 —— 这个上限是给「塔防守城高频互射」兜底的。
 */
const HIT_FX_CAP = 64;
/**
 * 建筑抖动通知的上限。
 *
 * 比其它队列都小：这是**一次性、取走即空**的通道（见 `drainBuildingShakes`），正常一帧最多
 * 攒下「一局里所有主城 + 所有金矿同时到点」的那个数（个位数）。上限只兜「渲染层整段没在跑
 * （切后台 / 结算弹窗期间）还一直产金」这种极端情况 —— 丢最旧的，不许它涨成内存泄漏。
 */
const BUILDING_SHAKE_CAP = 32;
/** 空抖动队列的共享实例（常态返回它 ⇒ 渲染层不必判 null，也不产生分配）。 */
const EMPTY_BUILDING_SHAKES: readonly Readonly<ZCBuildingShake>[] = [];
/**
 * 建筑摧毁通知的上限。
 *
 * 与抖动同口径：一次性、取走即空；正常一帧最多攒下「同一拍被拆掉的建筑」那个数。
 * 上限只兜「渲染层整段没在跑还一直拆楼」这种极端情况 —— 丢最旧的。
 */
const BUILDING_DESTRUCTION_CAP = 16;
/** 空摧毁队列的共享实例（同上）。 */
const EMPTY_BUILDING_DESTRUCTIONS: readonly Readonly<ZCBuildingDestruction>[] = [];
/**
 * 中立资源领取通知队列的上限。
 *
 * 比飘字小：一局里「同时段被领的中立资源」撑死个位数（`claimAdjacentNeutralResources`
 * 一轮最多领一圈邻格），上限只兜「渲染层整段没在跑还持续领」的极端情况 —— 丢最旧。
 */
const NEUTRAL_REWARD_CAP = 16;

/**
 * 中立资源获取表现的**时长口径**（秒）—— 队列生命周期与视图动画共用的真源。
 *
 * 两条通道各自的时间轴，事件总长取**较长的那条**（prune 按它摘，视图同时收节点）：
 *   ① 神器（2026-10-20 需求）：飞行段 `ZC_NEUTRAL_REWARD_FLY_SECONDS` + 落地淡出；
 *   ② 金币（2026-10-26 改口径）：**格心喷发** —— 12 枚错峰出发 + 最长生命，
 *      见 `model/ZCNeutralBurst.zcNeutralBurstTotalSeconds`（含「+N」读数的 1.15s)。
 *
 * ⚠️ 别为了让 total 变短去压 ②：喷发还没落干净就被 prune 摘掉，实机就是
 *    「粒子刚出来就整束消失」——这是 UID 上一个正是本次要修的现象。
 */
export const ZC_NEUTRAL_REWARD_FLY_SECONDS = 0.6;
/** 金币事件的老上飘段（保留给曲线自身的引用）；现在的事件总长已改由喷发那条决定。 */
export const ZC_NEUTRAL_REWARD_RISE_SECONDS = 0.6;
/** 金币逐枚出发的错峰（秒）。 */
export const ZC_NEUTRAL_REWARD_COIN_STAGGER = 0.04;
/** 金币堆 / 宝箱共用的一把飞行金币数。 */
export const ZC_NEUTRAL_REWARD_COIN_COUNT = 6;
/** 神器那条通道的时长（飞行 + 落地淡出）。 */
const ZC_NEUTRAL_REWARD_ARTIFACT_TOTAL_SECONDS =
    ZC_NEUTRAL_REWARD_FLY_SECONDS
    + ZC_NEUTRAL_REWARD_COIN_STAGGER * (ZC_NEUTRAL_REWARD_COIN_COUNT - 1)
    + ZC_NEUTRAL_REWARD_RISE_SECONDS;
export const ZC_NEUTRAL_REWARD_TOTAL_SECONDS = Math.max(
    ZC_NEUTRAL_REWARD_ARTIFACT_TOTAL_SECONDS,
    zcNeutralBurstTotalSeconds(ZC_NEUTRAL_BURST_COUNT),
);

/**
 * 地块**脉冲段**的时长（秒）—— 激活轴的第 ① 段（点击动画）：播一道美术脉冲序列帧。
 *
 * 2026-10-19 起 **段长与「波多长」解耦**：
 *   · 段长 = 本值 **0.7s** —— 它决定**卡牌什么时候弹**（`ZC_CARD_START_SECONDS`）、
 *     首批兵什么时候能站上来、邻格生成动画的**起点**，是整条时间轴的锚，不跟着换美术动；
 *   · 波 = `HEX_PULSE_WAVE_SECONDS` **0.5s**（5 帧 × 10fps）—— 一段里**只播一道**，
 *     播完直接消失，段内剩下的 0.2s 只剩缩没段在收格子。
 *   · 缩没（阶段 2）从 `HEX_PULSE_SHRINK_START_SECONDS`（脉冲中间帧）才开始，见 `ZCHexView`。
 *
 * 所以别再把本值写成 `HEX_PULSE_WAVE_SECONDS`：那会把卡牌提前到 0.5s、
 * 总长从 1.856s 缩到 1.656s —— 用户 2026-10-15 选的是 1.856s，换美术不该顺带改节奏。
 *
 *  首批兵的推迟时刻（`ZCGameModel.scheduleFirstBarracksUnit`）也跟这一段走 ——
 * 单位是实体、没有「未开始」态，波纹还在扩的时候不能让兵提前站上来。
 */
export const ZC_HEX_PULSE_SECONDS = 0.7;
/**
 * 地块**缩没段**的时长（秒）—— 激活轴的 ②：整格**原地等比缩到 `HEX_SHRINK_MIN_SCALE`**。
 *
 * 🔴 2026-10-15 row13 用户口径：「② 缩没段和 ① 脉冲段 **同步播放**」⇒ 两段**并发**（同起同收），
 * 不再像先前那样「脉冲播完才轮到缩没」。所以长度取的是脉冲段的 `ZC_HEX_PULSE_SECONDS`，
 * **不是** core 那份「抬手 → 收场」的 `HEX_FLIP_SECONDS`：缩没收得比波快，就会剩一段
 * 「格子已经没了、波还在原地扩」的空窗。
 * 曲线仍是 `hexShrinkFx`（**零位移**、只缩不压扁，见 `HexFlipPresentation`）。
 *
 * 语义位置：点击那一刻，波纹从中心扩散、地块同时开始收；`ZC_HEX_PULSE_SECONDS` 末两者一起收干净，
 * 舞台随即交给卡牌。两段都**不许抬起**（`tileLift` 恒 0）。
 */
export const ZC_HEX_SHRINK_SECONDS = ZC_HEX_PULSE_SECONDS;
/**
 * **建筑生成段**（秒）：卡牌开始淡出的那一刻衔接播，**与卡牌淡出重叠**。
 *
 * 为什么是「跟卡牌淡出重叠」而不是排在卡牌之后：卡牌最后一段淡出时，格子如果还空着
 * （建筑隐藏、也没图标）就是一片空白六边形，观众看到的是「卡没了 → 空的 → 建筑才冒出来」。
 * 建筑从淡出开始那一刻起由小变大，卡牌淡完时建筑已经长起来了，中间没有空窗。
 *
 * 取 0.36s ≈ 1.5 倍卡牌生成段（卡牌的弹入占它自己时长的 0.1），
 * 两条曲线同一个形状，节奏看起来就是一回事。它只是**建筑自己的生长时长**，
 * 不单独占一段激活时间轴 —— 建筑在卡牌淡出窗内就长完了。
 */
export const ZC_HEX_BUILDING_SECONDS = 0.36;
/**
 * **卡牌弹出时刻**（从点击起算的秒数）= **点击动画**（① 脉冲 ∥ ② 缩没）的结束。
 *
 * 🔴 需求原话（2026-10-15 row13）：「带 ui 和 icon 的地块缩小动画与脉动动画同步播放，
 * **点击动画即将结束时，再展示卡牌生成动画**」⇒ 点击动画 = max(脉冲, 缩没) = `ZC_HEX_PULSE_SECONDS`，
 * 卡牌就在这一刻接棒。
 *
 * 🔴 这是「卡牌起点」的**唯一真源**：`pushCardReveal` 的 `startedAt`、兵营首批兵的推迟时刻
 * （`ZCGameModel`）都必须锚它 —— 2026-10-15 吃过一次亏：迁移时只改了其中一处，
 * 另一处仍锚旧段，整条链路偏了半截。
 * ⚠️ 邻格的生成动画**已不再锚这里**（2026-10-26 改口径）：它跟点击那一拍的**脉冲起点**同步，
 * 见 `ZC_HEX_NEIGHBOR_SPAWN_SECONDS`。
 */
export const ZC_CARD_START_SECONDS = ZC_HEX_PULSE_SECONDS;
/**
 * 抽卡小卡牌的生命周期（秒）—— 卡牌段**固定 1.156s**。
 *
 * 🔴 与上一版（总长钉 2.24、卡牌段由总长反推）的差别：现在**卡牌段是固定的**，总长由它
 * 加上点击动画推出来。起因是 row13 把「脉冲 + 缩没」由串行改成并发，点击动画从 1.084s
 * 缩到 0.7s ⇒ 总长自然从 2.24 缩到 **1.856**
 * （用户 2026-10-15 在「总长缩到 1.856s」与「缩没拉伸到 0.7s / 总长 2.24」之间选了这个）。
 *
 * ⚠️ 别为了把总长凑回 2.24 去改本值：卡牌的弹入 / 淡出节奏都按它算，
 * 拉长会让「弹出 → 淡出」的手感整个变慢。
 */
export const ZC_CARD_REVEAL_SECONDS = 1.156;
/**
 * 地块激活表现的总时长（秒）—— **也是卡牌淡出结束的那一刻**。
 *
 * 轴上是**两段**：① 脉冲 ∥ ② 缩没（**并发**，合起来 `ZC_HEX_PULSE_SECONDS` 0.7s）→ ③ 卡牌 1.156s；
 * 建筑在卡牌淡出窗内长完、不占段。现值 = 0.7 + 1.156 = **1.856**。
 *
 * 🔴 由 2.24 改成 1.856（2026-10-15，row13 的「同步播放」）：点击动画少掉串行时缩没那 0.384s。
 * 旧的 2.24 是上一版口径「卡牌淡出结束从 2.784 加快到 2.24」，已被本次并发改动取代。
 */
export const ZC_HEX_ACTIVATION_SECONDS = ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS;
/**
 * 卡牌段起点的轴占比 = 点击动画 / 总长。
 *
 * ⚠️ 换算「卡牌进度 → 激活进度」必须用本常量（用例里的 `atCard` 走的就是它）。
 * （旧版另有一个 `ZC_HEX_FLIP_RATIO`「缩没段占比」，并发之后缩没不再独占一段，已删除。）
 */
export const ZC_CARD_START_RATIO = ZC_CARD_START_SECONDS / ZC_HEX_ACTIVATION_SECONDS;
/**
 * 卡牌轴在激活总时长里的占比 —— 卡牌段起点之后、激活结束之前正好是整段卡牌。
 */
export const ZC_CARD_AXIS_RATIO = ZC_CARD_REVEAL_SECONDS / ZC_HEX_ACTIVATION_SECONDS;
/**
 * 卡牌开始淡出的进度（0~1），与 `ZCGameCardReveal.prefab` 上 `fadeStartProgress` 同值。
 *
 * 地块要**正好在卡牌开始淡出这一刻**原尺寸回场：早了会在不透明的卡牌底下白弹一次、
 * 晚了卡牌已经透出棋盘底色（那一瞬间地里是空的）。所以两边必须同值，
 * `ZCHexView` 用它切「整格隐藏 → 地块回场」。
 */
export const ZC_CARD_FADE_START_PROGRESS = 0.62;
/**
 * 「新点亮的邻格」生成动画的**时长**（秒）—— **与地块脉冲同起同收**（需求 2026-10-26）。
 *
 * 需求原话：「战斗中，新格子的生成动画和地块脉冲动画同步播放」。
 *
 * 取代 2026-10-15 row6 的「延迟 0.2s、等卡牌生成动画开始播放后再展示」那套按住窗
 * （`ZC_CARD_START_SECONDS + 0.2` = 0.9s）：那一版的图标 / 价格要等到卡牌弹出后才出现，
 * 与点击那一拍的脉冲完全错开。现在改成——点击那一拍邻格就和脉冲一起亮，
 * 并在本值内由小到大 + 淡入长齐。
 *
 * 为什么取 `HEX_PULSE_WAVE_SECONDS`（5 帧 × 10fps = 0.5s）而不是脉冲**段长** 0.7s：
 * 要同收的是**那道波**。0.7s 里最后 0.2s 只剩缩没在收格子，再让邻格继续长就会拖住
 * 点击动画的收口（卡牌 / 首批兵 / 邻格三处都锚 `ZC_CARD_START_SECONDS`）。
 */
export const ZC_HEX_NEIGHBOR_SPAWN_SECONDS = HEX_PULSE_WAVE_SECONDS;

/** 飘字入参（世界坐标像素 + 存活时长）。 */
export interface IZCFloatTextOptions {
    readonly now: number;
    readonly kind: ZCFloatTextKind;
    readonly owner: ZCOwner;
    readonly value: number;
    readonly x: number;
    readonly y: number;
    readonly durationSeconds: number;
}

/** 受击特效入参（世界坐标像素 + 存活时长 + **攻击方**职业）。 */
export interface IZCHitFxOptions {
    readonly now: number;
    readonly trait: ZCAttackTrait;
    readonly owner: ZCOwner;
    readonly x: number;
    readonly y: number;
    readonly durationSeconds: number;
}

/** 卡牌弹出入参（位置由视图以 hexId 对齐，这里同时给出世界坐标）。 */
export interface IZCCardRevealOptions {
    readonly now: number;
    readonly owner: ZCOwner;
    readonly hexId: number;
    readonly cardId: string;
    readonly building: ZCBuildingType;
    readonly tier: number;
    readonly cardName: string;
    readonly unitId: string | null;
    readonly luckText: string;
    readonly x: number;
    readonly y: number;
}

/** 中立资源领取通知入参（金额/充能由模型按奖励表现取，不在视图猜）。 */
export interface IZCNeutralRewardOptions {
    readonly now: number;
    readonly hexId: number;
    /** 领取的资源项 id（`neutralResourceGroup.id`）。 */
    readonly itemId: number;
    readonly owner: ZCOwner;
    readonly gold: number;
    readonly artifactCharge: number;
}

/** 每局的可视化表现事件；这些队列刻意不进对局快照。 */
export class ZCBattlePresentationQueue {
    private readonly floatingTexts: ZCFloatText[] = [];
    private readonly hitFxQueue: ZCHitFx[] = [];
    private readonly cardRevealQueue: ZCCardReveal[] = [];
    private readonly hexActivationQueue: ZCHexActivation[] = [];
    /**
     * 抖动通知队列。⚠️ **不能标 `readonly`**：`drainBuildingShakes` 要把它整条**换掉**
     * （交出去的必须是原来那条、调用方才能安全遍历，见那里的说明）。
     */
    private buildingShakeQueue: ZCBuildingShake[] = [];
    /** 建筑摧毁通知队列（同抖动：取走即空，不能标 `readonly`）。 */
    private buildingDestructionQueue: ZCBuildingDestruction[] = [];
    private neutralRewardQueue: ZCNeutralReward[] = [];
    private nextFloatTextId = 1;
    private nextHitFxId = 1;
    private nextCardRevealId = 1;
    private nextHexActivationId = 1;
    private nextBuildingShakeId = 1;
    private nextBuildingDestructionId = 1;
    private nextNeutralRewardId = 1;

    get floatTexts(): readonly Readonly<ZCFloatText>[] { return this.floatingTexts; }
    get hitFxs(): readonly Readonly<ZCHitFx>[] { return this.hitFxQueue; }
    get cardReveals(): readonly Readonly<ZCCardReveal>[] { return this.cardRevealQueue; }
    get hexActivations(): readonly Readonly<ZCHexActivation>[] { return this.hexActivationQueue; }
    get neutralRewards(): readonly Readonly<ZCNeutralReward>[] { return this.neutralRewardQueue; }

    pushFloatText(input: Readonly<IZCFloatTextOptions>): ZCFloatText | null {
        if (!Number.isFinite(input.value) || (input.value <= 0 && input.kind !== 'miss')) return null;
        const text: ZCFloatText = {
            id: this.nextFloatTextId++,
            kind: input.kind,
            owner: input.owner,
            value: Math.max(0, Math.round(input.value)),
            x: input.x,
            y: input.y,
            startedAt: input.now,
            durationSeconds: input.durationSeconds,
        };
        this.floatingTexts.push(text);
        while (this.floatingTexts.length > FLOAT_TEXT_CAP) this.floatingTexts.shift();
        return text;
    }

    /**
     * 推一条受击特效。
     *
     * 坐标 / 时长非有限值一律拒收 —— 这两个值渲染层是**逐帧**拿去算节点位置的，
     * 混进 `NaN` 会让那个节点永远算不出「过期」，直接变成永驻的幽灵节点（不报错，只是
     * 永不回收、跨局累积）。飘字那边不需要这道闸是因为它只用于飘字文案、不参与回收判定。
     */
    pushHitFx(input: Readonly<IZCHitFxOptions>): ZCHitFx | null {
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
        if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return null;
        const fx: ZCHitFx = {
            id: this.nextHitFxId++,
            trait: input.trait,
            owner: input.owner,
            x: input.x,
            y: input.y,
            startedAt: input.now,
            durationSeconds: input.durationSeconds,
        };
        this.hitFxQueue.push(fx);
        while (this.hitFxQueue.length > HIT_FX_CAP) this.hitFxQueue.shift();
        return fx;
    }

    removeFloatText(id: number): number {
        const index = this.floatingTexts.findIndex((text) => text.id === id);
        if (index < 0) return 0;
        const value = this.floatingTexts[index].value;
        this.floatingTexts.splice(index, 1);
        return value;
    }

    pushCardReveal(input: Readonly<IZCCardRevealOptions>): void {
        this.cardRevealQueue.push({
            id: this.nextCardRevealId++,
            cardId: input.cardId,
            owner: input.owner,
            building: input.building,
            tier: input.tier,
            cardName: input.cardName,
            unitId: input.unitId,
            luckText: input.luckText,
            hexId: input.hexId,
            x: input.x,
            y: input.y,
            // 卡牌等**点击动画（脉冲 ∥ 缩没）**播完才弹 —— 用户口径「点击动画即将结束时衔接卡牌段」。
            // 起点落在未来 ⇒ 视图侧 `now < startedAt` 时**整卡不渲染**（写绝对 active = false），
            // 不是把进度 clamp 到 0 干等（那样会留一张 0.2 缩放却可见的静止小卡）。
            startedAt: input.now + ZC_CARD_START_SECONDS,
            durationSeconds: ZC_CARD_REVEAL_SECONDS,
        });
        while (this.cardRevealQueue.length > CARD_REVEAL_CAP) this.cardRevealQueue.shift();
    }

    pushHexActivation(now: number, hexId: number, hasCardReveal: boolean, cardRarity = 0): void {
        this.hexActivationQueue.push({
            id: this.nextHexActivationId++,
            hexId,
            hasCardReveal,
            // 0 = 没抽到卡（脉冲按绿走，见 `ZCHexView.pulseTintForRarity`）
            cardRarity: Number.isFinite(cardRarity) ? cardRarity : 0,
            startedAt: now,
            // 含并发的脉冲段 + 缩没段、随后的卡牌段、末尾的建筑生成段（见 `ZC_HEX_ACTIVATION_SECONDS`）。
            durationSeconds: ZC_HEX_ACTIVATION_SECONDS,
        });
        while (this.hexActivationQueue.length > HEX_ACTIVATION_CAP) this.hexActivationQueue.shift();
    }

    /**
     * 推一条「中立资源被领取」的通知：`grantNeutralResourceReward` 发奖那一拍调。
     *
     * 与 `ZCFloatText` 同型：**带起点、带时长**、参与 `prune`（幂等，可重复读）。
     * 视图按 `startedAt + durationSeconds` 播「金币飞向金币栏 → 上飘 +N」等动画；
     * 非玩家领取（AI 拿到资源）同样入队，由视图自行决定是否只对玩家播飞行。
     *
     * 金额 / 充能**非有限或为负**一律拒收 —— 数值会直接变成「+N」文案，不能脏。
     */
    pushNeutralReward(input: Readonly<IZCNeutralRewardOptions>): ZCNeutralReward | null {
        if (!Number.isFinite(input.gold) || input.gold < 0) return null;
        if (!Number.isFinite(input.artifactCharge) || input.artifactCharge < 0) return null;
        const reward: ZCNeutralReward = {
            id: this.nextNeutralRewardId++,
            hexId: input.hexId,
            itemId: input.itemId,
            owner: input.owner,
            gold: Math.round(input.gold),
            artifactCharge: Math.round(input.artifactCharge),
            startedAt: input.now,
            durationSeconds: ZC_NEUTRAL_REWARD_TOTAL_SECONDS,
        };
        this.neutralRewardQueue.push(reward);
        while (this.neutralRewardQueue.length > NEUTRAL_REWARD_CAP) this.neutralRewardQueue.shift();
        return reward;
    }

    /**
     * 推一条「这一格的建筑该抖一下了」：主城 / 金矿的**金币倒计时结束**时调
     * （需求 2026-10-15 row12 / row13）。
     *
     * 与其它队列不同，这里**不看时间、不设时长**：它是一条通知，不是一段时间。
     * 起点由渲染层收走它那一帧落定（见 `ZCBuildingShake` 的说明）。
     */
    pushBuildingShake(hexId: number): void {
        if (!Number.isFinite(hexId)) return;
        this.buildingShakeQueue.push({ id: this.nextBuildingShakeId++, hexId });
        while (this.buildingShakeQueue.length > BUILDING_SHAKE_CAP) this.buildingShakeQueue.shift();
    }

    /**
     * **取走**全部待播的建筑抖动（返回后队列即空）。
     *
     *  为什么是取走而不是像飘字那样"读快照 + 按时间 prune"：抖动不幂等 ——
     *  `playBuildingShake` 会把起点重置到"现在"，同一条通知被读两次就等于**重头再抖一遍**；
     *  而抖动只有 0.24s、又必须逐帧推进，读-清两个动作必须原子。
     *
     * ⚠️ 交出去的是**原来那条数组本身**、内部换一条新的接手：这样调用方可以安全地遍历
     * 交出来的那条（`length = 0` 会把正在读的内容清掉）。只有"真有事件"时才走这条路
     * —— 空队列直接返回共享的空数组，常态零分配；而有事件意味着这一帧本来就在发金币
     * （飘字 + 数字 + 抖动一起上），多一条小数组无足轻重。
     */
    drainBuildingShakes(): readonly Readonly<ZCBuildingShake>[] {
        if (!this.buildingShakeQueue.length) return EMPTY_BUILDING_SHAKES;
        const drained = this.buildingShakeQueue;
        this.buildingShakeQueue = [];
        return drained;
    }

    /**
     * 推一条「这一格的建筑被拆掉了」：`damageBuilding` 判定 HP 归零、把地块改成废墟的那一拍调。
     *
     * 同抖动：**不看时间、不设时长**，它是一条通知；起点由渲染层收走它那一帧落定。
     */
    pushBuildingDestruction(hexId: number): void {
        if (!Number.isFinite(hexId)) return;
        this.buildingDestructionQueue.push({ id: this.nextBuildingDestructionId++, hexId });
        while (this.buildingDestructionQueue.length > BUILDING_DESTRUCTION_CAP) this.buildingDestructionQueue.shift();
    }

    /**
     * **取走**全部待播的建筑摧毁通知（返回后队列即空）。理由同 `drainBuildingShakes`：
     * 摧毁特效不幂等（同一条通知读两次 = 同一格播两团烟雾），读-清必须原子。
     */
    drainBuildingDestructions(): readonly Readonly<ZCBuildingDestruction>[] {
        if (!this.buildingDestructionQueue.length) return EMPTY_BUILDING_DESTRUCTIONS;
        const drained = this.buildingDestructionQueue;
        this.buildingDestructionQueue = [];
        return drained;
    }

    activationOf(hexId: number): Readonly<ZCHexActivation> | null {
        for (let index = this.hexActivationQueue.length - 1; index >= 0; index -= 1) {
            const activation = this.hexActivationQueue[index];
            if (activation.hexId === hexId) return activation;
        }
        return null;
    }

    prune(now: number): void {
        for (let index = this.floatingTexts.length - 1; index >= 0; index -= 1) {
            const text = this.floatingTexts[index];
            if (now >= text.startedAt + text.durationSeconds) this.floatingTexts.splice(index, 1);
        }
        for (let index = this.hitFxQueue.length - 1; index >= 0; index -= 1) {
            const fx = this.hitFxQueue[index];
            if (now >= fx.startedAt + fx.durationSeconds) this.hitFxQueue.splice(index, 1);
        }
        for (let index = this.cardRevealQueue.length - 1; index >= 0; index -= 1) {
            const reveal = this.cardRevealQueue[index];
            if (now >= reveal.startedAt + reveal.durationSeconds) this.cardRevealQueue.splice(index, 1);
        }
        for (let index = this.hexActivationQueue.length - 1; index >= 0; index -= 1) {
            const activation = this.hexActivationQueue[index];
            if (now >= activation.startedAt + activation.durationSeconds) this.hexActivationQueue.splice(index, 1);
        }
        for (let index = this.neutralRewardQueue.length - 1; index >= 0; index -= 1) {
            const reward = this.neutralRewardQueue[index];
            if (now >= reward.startedAt + reward.durationSeconds) this.neutralRewardQueue.splice(index, 1);
        }
    }

    reset(): void {
        this.floatingTexts.length = 0;
        this.hitFxQueue.length = 0;
        this.cardRevealQueue.length = 0;
        this.hexActivationQueue.length = 0;
        this.buildingShakeQueue.length = 0;
        // 建筑摧毁队列也要清：它是 2026-10-19 新增的那条通知，别漏在这份 reset 之外
        // （漏了的表现是「换局后第一发摧毁通知的 id 接着上一局往下编」，判据见
        // `tests/zcds-battle-presentation-queue.test.ts`）。
        this.buildingDestructionQueue.length = 0;
        this.neutralRewardQueue.length = 0;
        this.nextFloatTextId = 1;
        this.nextHitFxId = 1;
        this.nextCardRevealId = 1;
        this.nextHexActivationId = 1;
        this.nextBuildingShakeId = 1;
        this.nextBuildingDestructionId = 1;
        this.nextNeutralRewardId = 1;
    }
}
