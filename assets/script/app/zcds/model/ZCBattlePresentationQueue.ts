import type { ZCAttackTrait } from './ZCCombatCatalog';
import type {
    ZCBuildingDestruction, ZCBuildingShake, ZCBuildingType, ZCCardReveal, ZCFloatText, ZCFloatTextKind,
    ZCHexActivation, ZCHitFx, ZCHitFxSurface, ZCNeutralReward, ZCSkillAnnounce,
} from './ZCGameTypes';
import type { ZCFaction, ZCOwner } from './ZCMapConfig';
import {
    HEX_PULSE_WAVE_SECONDS
} from '../../../core/hex/HexFlipPresentation';

const FLOAT_TEXT_CAP = 96;
export const ZC_PORTAL_FLIGHT_SECONDS = 0.6;
const CARD_REVEAL_CAP = 24;
const HEX_ACTIVATION_CAP = 24;
/**
 * 受击特效队列上限。
 *
 * 比飘字小一个量级：受击特效是贴在被打者身上的一次性闪光，视觉上更抢眼，一屏里
 * 同时铺几十个会糊成一片；超出的直接丢最旧的（与飘字同策略：丢最旧、不阻塞新事件）。
 * 一波 4 个兵的齐射也只占 4~8 个，远没到上限 —— 这个上限是给「塔防守城高频互射」兜底的。
*/
const HIT_FX_CAP = 64;
/**
 * 建筑抖动通知的上限。
 *
 * 比其它队列都小：这是一次性、取走即空的通道（见 `drainBuildingShakes`），正常一帧最多
 * 攒下「一局里所有主城 + 所有金矿同时到点」的那个数（个位数）。上限只兜「渲染层整段没在跑
 * （切后台 / 结算弹窗期间）还一直产金」这种极端情况 —— 丢最旧的，不许它涨成内存泄漏。
*/
const BUILDING_SHAKE_CAP = 32;
/** 空抖动队列的共享实例（常态返回它 ⇒ 渲染层不必判 null，也不产生分配）。*/
const EMPTY_BUILDING_SHAKES: readonly Readonly<ZCBuildingShake>[] = [];
/**
 * 建筑摧毁通知的上限。
 *
 * 与抖动同口径：一次性、取走即空；正常一帧最多攒下「同一拍被拆掉的建筑」那个数。
 * 上限只兜「渲染层整段没在跑还一直拆楼」这种极端情况 —— 丢最旧的。
*/
const BUILDING_DESTRUCTION_CAP = 16;
/** 空摧毁队列的共享实例（同上）。*/
const EMPTY_BUILDING_DESTRUCTIONS: readonly Readonly<ZCBuildingDestruction>[] = [];
/**
 * 中立资源领取通知队列的上限。
 *
 * 比飘字小：一局里「同时段被领的中立资源」撑死个位数（`claimAdjacentNeutralResources`
 * 一轮最多领一圈邻格），上限只兜「渲染层整段没在跑还持续领」的极端情况 —— 丢最旧。
*/
const NEUTRAL_REWARD_CAP = 16;
/**
 * 大招通报**同时存活**的上限。
 *
 * 用户口径 2026-11-25：「播报在玩家名字下方往下依次排队不重叠，间隔 3px，超过 3 个时，
 * 后面的不展示了」。与样式层的 `ZC_SKILL_ANNOUNCE_STACK_MAX` 同值 —— 刻意各写一份
 * （样式层是 `view|ui` 侧要用的零依赖模块，模型反向 import 会绕成环），一致性由
 * `tests/zcds-skill-announce.test.ts` 直接断言两者相等来兜住。
 */
const SKILL_ANNOUNCE_LIVE_CAP = 3;
/**
 * 大招通报的存活时长（秒）—— 队列生命周期与视图动画共用的真源。
 *
 * 用户口径（2026-11-25）：「每次展示 2.3s」。
 * 拆成两段：0~{@link ZC_SKILL_ANNOUNCE_HOLD_SECONDS} 全显（形象 + 名字），
 * 之后淡出到结束。别压到 1s 以内：技能名刚看清就被摘掉节点，实机读不出名字。
*/
export const ZC_SKILL_ANNOUNCE_HOLD_SECONDS = 1.66;
export const ZC_SKILL_ANNOUNCE_SECONDS = 2.3;

/**
 * 中立资源获取表现的总时长（秒）—— 队列生命周期与视图动画共用的真源。
 * 取两条通道中较长的一条：神器飞行 + 落地淡出；金币 FLY + STAGGER×(COUNT−1) + RISE = 1.4s。
 * 不要压短：金币还在飞就被 prune 摘掉，实机会出现「粒子飞到一半消失」。
*/
export const ZC_NEUTRAL_REWARD_FLY_SECONDS = 0.6;
/** 「+N」读数上飘段（等最后一颗金币落地后开始）。*/
export const ZC_NEUTRAL_REWARD_RISE_SECONDS = 0.6;
/** 金币逐枚出发的错峰（秒）。*/
export const ZC_NEUTRAL_REWARD_COIN_STAGGER = 0.04;
/** 金币堆 / 宝箱共用的一把飞行金币数。*/
export const ZC_NEUTRAL_REWARD_COIN_COUNT = 6;
/** 金币通道总时长：最后一颗落地 + 「+N」读完。*/
const ZC_NEUTRAL_REWARD_COIN_TOTAL_SECONDS =
    ZC_NEUTRAL_REWARD_FLY_SECONDS
    + ZC_NEUTRAL_REWARD_COIN_STAGGER * (ZC_NEUTRAL_REWARD_COIN_COUNT - 1)
    + ZC_NEUTRAL_REWARD_RISE_SECONDS;
/** 神器通道总时长（飞行 + 落地淡出 0.2s，见 `ZCNeutralRewardFx`）。*/
const ZC_NEUTRAL_REWARD_ARTIFACT_TOTAL_SECONDS = ZC_NEUTRAL_REWARD_FLY_SECONDS + 0.2;
export const ZC_NEUTRAL_REWARD_TOTAL_SECONDS = Math.max(
    ZC_NEUTRAL_REWARD_COIN_TOTAL_SECONDS,
    ZC_NEUTRAL_REWARD_ARTIFACT_TOTAL_SECONDS,
);

/**
 * 地块脉冲段时长（秒），点击动画第 1 段：播一道美术脉冲序列帧。
 * 它是整条时间轴的锚（卡牌弹出、首批兵、邻格生成都按它推），不随美术波长短变化。
 * 波本身是 `HEX_PULSE_WAVE_SECONDS` 0.5s，段内剩下 0.2s 留给缩没收尾。
*/
export const ZC_HEX_PULSE_SECONDS = 0.7;
/**
 * 缩没段时长（秒）：与脉冲段同起同收，整格原地等比缩到 `HEX_SHRINK_MIN_SCALE`。
 * 长度取脉冲段，避免「格子没了、波还在扩」的空窗；两段都不抬升。
*/
export const ZC_HEX_SHRINK_SECONDS = ZC_HEX_PULSE_SECONDS;
/**
 * 建筑生成段（秒）：从卡牌淡出开始播，与淡出重叠，避免中间出现空六边形。
 * 值≈卡牌生成段的 1.5 倍，建筑在淡出窗内长完，不单独占激活时间轴。
*/
export const ZC_HEX_BUILDING_SECONDS = 0.36;
/**
 * 卡牌弹出时刻（从点击起算秒数）= 点击动画（脉冲 ∥ 缩没）结束，也是卡牌起点的唯一真源。
 * 兵营首批兵的推迟时刻同样锚它；邻格生成动画已改为锚点击那一拍的脉冲起点。
*/
export const ZC_CARD_START_SECONDS = ZC_HEX_PULSE_SECONDS;
/**
 * 抽卡小卡牌的生命周期（秒），卡牌段固定 1.156s；总长由它加点击动画推出。
 * 卡牌的弹入/淡出节奏都按它算，不要为凑总长改这个值。
*/
export const ZC_CARD_REVEAL_SECONDS = 1.156;
/**
 * 地块激活表现总时长（秒）= 脉冲 ∥ 缩没 0.7s + 卡牌 1.156s = 1.856s，也是卡牌淡出结束时刻。
*/
export const ZC_HEX_ACTIVATION_SECONDS = ZC_CARD_START_SECONDS + ZC_CARD_REVEAL_SECONDS;
/**
 * 卡牌段起点的轴占比 = 点击动画 / 总长。
 *
 * 换算「卡牌进度 → 激活进度」必须用本常量（用例里的 `atCard` 走的就是它）。
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
 * 地块要正好在卡牌开始淡出这一刻原尺寸回场：早了会在不透明的卡牌底下白弹一次、
 * 晚了卡牌已经透出棋盘底色（那一瞬间地里是空的）。所以两边必须同值，
 * `ZCHexView` 用它切「整格隐藏 → 地块回场」。
*/
export const ZC_CARD_FADE_START_PROGRESS = 0.62;
/**
 * 新点亮邻格的生成动画时长（秒），与地块脉冲同起同收。
 * 取波本身的 0.5s 而不是脉冲段 0.7s：最后 0.2s 只剩缩没收尾，再长会拖住点击动画。
*/
export const ZC_HEX_NEIGHBOR_SPAWN_SECONDS = HEX_PULSE_WAVE_SECONDS;

/** 飘字入参（世界坐标像素 + 存活时长）。*/
export interface IZCFloatTextOptions {
    readonly now: number;
    readonly kind: ZCFloatTextKind;
    readonly owner: ZCOwner;
    /** 本机席位被扣血 ⇒ 红字 + 负号（攻方是玩家或 NPC 都一样，见 `ZCFloatText.takenFromPlayer`）。*/
    readonly takenFromPlayer?: true;
    /** 玩家席位打出去的伤害 ⇒ 才带暴击 / 克制 / 抵抗 / 秒杀前缀（见 `ZCFloatText.dealtByPlayer`）。*/
    readonly dealtByPlayer?: true;
    readonly value: number;
    readonly appliedDamage?: number;
    readonly x: number;
    readonly y: number;
    readonly durationSeconds: number;
}

/** 受击特效入参（世界坐标像素 + 存活时长 + 攻击方职业）。*/
export interface IZCHitFxOptions {
    readonly now: number;
    readonly trait: ZCAttackTrait;
    readonly owner: ZCFaction;
    /**
     * 打在什么上；缺省 `'unit'`（老调用点不用改）。
     * 结构物用 `'building'` / `'wall'`，视图据此把锚点从格心抬到建筑图中心。
    */
    readonly surface?: ZCHitFxSurface;
    /** 被打那一方的模型等比缩放（`pvpCard.prefabSize`）；缺省 1 = 保持 prefab 烘焙尺寸。*/
    readonly targetScale?: number;
    readonly x: number;
    readonly y: number;
    readonly durationSeconds: number;
}

/** 卡牌弹出入参（位置由视图以 hexId 对齐，这里同时给出世界坐标）。*/
export interface IZCCardRevealOptions {
    readonly monsterClaim?: boolean;
    readonly randomTile?: boolean;
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

/** 大招通报入参（卡面形象 + 技能名，坐标是棋盘逻辑坐标）。*/
export interface IZCSkillAnnounceOptions {
    readonly now: number;
    readonly cardId: string;
    readonly skillId: number;
    readonly skillName: string;
    readonly x: number;
    readonly y: number;
}

/** 中立资源领取通知入参（金额/充能由模型按奖励表现取，不在视图猜）。*/
export interface IZCNeutralRewardOptions {
    readonly now: number;
    readonly hexId: number;
    /** 领取的资源项 id（`neutralResourceGroup.id`）。*/
    readonly itemId: number;
    readonly owner: ZCOwner;
    readonly gold: number;
    readonly artifactCharge: number;
}

/** 每局的可视化表现事件；这些队列刻意不进对局快照。*/
export class ZCBattlePresentationQueue {
    private readonly floatingTexts: ZCFloatText[] = [];
    private readonly hitFxQueue: ZCHitFx[] = [];
    private readonly cardRevealQueue: ZCCardReveal[] = [];
    private readonly hexActivationQueue: ZCHexActivation[] = [];
    /**
     * 抖动通知队列。 不能标 `readonly`：`drainBuildingShakes` 要把它整条换掉
     * （交出去的必须是原来那条、调用方才能安全遍历，见那里的说明）。
    */
    private buildingShakeQueue: ZCBuildingShake[] = [];
    /** 建筑摧毁通知队列（同抖动：取走即空，不能标 `readonly`）。*/
    private buildingDestructionQueue: ZCBuildingDestruction[] = [];
    private neutralRewardQueue: ZCNeutralReward[] = [];
    /** 通报队列 = 当前还在屏幕上的那几条（并列展示，过期即摘，见 `pushSkillAnnounce`）。*/
    private readonly skillAnnounceQueue: ZCSkillAnnounce[] = [];
    private nextFloatTextId = 1;
    private nextHitFxId = 1;
    private nextCardRevealId = 1;
    private nextHexActivationId = 1;
    private nextBuildingShakeId = 1;
    private nextBuildingDestructionId = 1;
    private nextNeutralRewardId = 1;
    private nextSkillAnnounceId = 1;

    get floatTexts(): readonly Readonly<ZCFloatText>[] { return this.floatingTexts; }
    get hitFxs(): readonly Readonly<ZCHitFx>[] { return this.hitFxQueue; }
    get cardReveals(): readonly Readonly<ZCCardReveal>[] { return this.cardRevealQueue; }
    get hexActivations(): readonly Readonly<ZCHexActivation>[] { return this.hexActivationQueue; }
    get neutralRewards(): readonly Readonly<ZCNeutralReward>[] { return this.neutralRewardQueue; }
    get skillAnnounces(): readonly Readonly<ZCSkillAnnounce>[] { return this.skillAnnounceQueue; }

    pushFloatText(input: Readonly<IZCFloatTextOptions>): ZCFloatText | null {
        if (!Number.isFinite(input.value) || (input.value <= 0 && input.kind !== 'miss')) return null;
        const text: ZCFloatText = {
            id: this.nextFloatTextId++,
            kind: input.kind,
            owner: input.owner,
            ...(input.takenFromPlayer ? { takenFromPlayer: true as const } : {}),
            ...(input.dealtByPlayer ? { dealtByPlayer: true as const } : {}),
            value: Math.max(0, Math.round(input.value)),
            ...(input.appliedDamage === undefined ? {} : { appliedDamage: input.appliedDamage }),
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
     * 坐标 / 时长非有限值一律拒收 —— 这两个值渲染层是逐帧拿去算节点位置的，
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
            //  缺省 = 打在单位身上（老调用点行为逐字不变）。
            surface: input.surface ?? 'unit',
            // 非有限值 / 非正数一律归 1：尺寸系数是渲染层直接乘进 `setScale` 的，
            // 混进 NaN 会让节点缩放变成 NaN（整只特效消失，且不报错）。
            targetScale: Number.isFinite(input.targetScale) && (input.targetScale as number) > 0
                ? (input.targetScale as number) : 1,
            x: input.x,
            y: input.y,
            startedAt: input.now,
            durationSeconds: input.durationSeconds,
        };
        this.hitFxQueue.push(fx);
        while (this.hitFxQueue.length > HIT_FX_CAP) this.hitFxQueue.shift();
        return fx;
    }

    /**
     * 推一条大招通报。
     *
     * 坐标 / 时长非有限值一律拒收，理由同 `pushHitFx`：这两个值渲染层会拿去算节点，
     * 混进 `NaN` 会让那条通报永远算不出「过期」，变成跨局累积的幽灵节点。
     * （位置已经改成「HUD 里按槽位排」，坐标只留作日志/调试，但校验照旧。）
     *
     * 技能名空串同样拒收 —— 没有名字的通报只剩一张悬在空中的卡面，比不播更糟。
     *
     * 🔴 **并列展示、最多 3 条**（用户口径 2026-11-25 改口径）：
     *
     * 旧口径是串行排队（`startedAt = max(now, 上一条结束)`），一次只有一条在屏幕上。
     * 现在改成**同时起跳、纵向排队**：`startedAt` 一律取 `now`，槽位由视图按存活顺序排
     * （`ZCGameRenderWorld.renderSkillAnnounces`）。所以：
     *
     * - 已满 {@link SKILL_ANNOUNCE_LIVE_CAP} 条 ⇒ **丢新来的**（用户：「超过 3 个时，
     *   后面的不展示了」）。不能丢最旧：那等于把正在演的那条掐掉；
     * - 入队前先摘掉过期的。并列之后没有「串行游标」帮忙自清，不摘会让 3 条
     *   永久占位 ⇒ 后面一辈子进不来（这个坑不报错，只是「再也不弹了」）。
     */
    pushSkillAnnounce(input: Readonly<IZCSkillAnnounceOptions>): ZCSkillAnnounce | null {
        if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) return null;
        if (!input.cardId || !input.skillName) return null;
        this.pruneSkillAnnounces(input.now);
        if (this.skillAnnounceQueue.length >= SKILL_ANNOUNCE_LIVE_CAP) return null;
        const announce: ZCSkillAnnounce = {
            id: this.nextSkillAnnounceId++,
            cardId: input.cardId,
            skillId: input.skillId,
            skillName: input.skillName,
            x: input.x,
            y: input.y,
            startedAt: input.now,
            durationSeconds: ZC_SKILL_ANNOUNCE_SECONDS,
        };
        this.skillAnnounceQueue.push(announce);
        return announce;
    }

    /**
     * 摘掉已经过期的通报（保序，就地压缩）。
     *
     * 对外暴露给渲染层做同样的准入判断没意义 —— 视图看的是同一份队列，跳过过期即可；
     * 这里只保证队列长度等价于「当前还在屏幕上的条数」。
     */
    private pruneSkillAnnounces(now: number): void {
        const queue = this.skillAnnounceQueue;
        let write = 0;
        for (const item of queue) {
            if (now >= item.startedAt + item.durationSeconds) continue;
            queue[write] = item;
            write += 1;
        }
        queue.length = write;
    }

    removeFloatText(id: number): number {
        const index = this.floatingTexts.findIndex((text) => text.id === id);
        if (index < 0) return 0;
        const text = this.floatingTexts[index];
        this.floatingTexts.splice(index, 1);
        return text.appliedDamage ?? text.value;
    }

    pushCardReveal(input: Readonly<IZCCardRevealOptions>): void {
        this.cardRevealQueue.push({
            id: this.nextCardRevealId++,
            cardId: input.cardId,
            ...(input.monsterClaim ? { monsterClaim: true } : {}),
            ...(input.randomTile ? { randomTile: true } : {}),
            owner: input.owner,
            building: input.building,
            tier: input.tier,
            cardName: input.cardName,
            unitId: input.unitId,
            luckText: input.luckText,
            hexId: input.hexId,
            x: input.x,
            y: input.y,
            // 卡牌等点击动画（脉冲 ∥ 缩没）播完才弹 —— 用户口径「点击动画即将结束时衔接卡牌段」。
            // 起点落在未来 ⇒ 视图侧 `now < startedAt` 时整卡不渲染（写绝对 active = false），
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
     * 推一条「中立资源被领取」的通知，发奖当拍调用；带起点、时长，参与 prune。
     * 非玩家领取同样入队，由视图决定是否只对玩家播飞行动画。
     * 金额/充能非有限或为负直接拒收。
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
     * 推一条「这一格的建筑该抖一下了」：主城 / 金矿的金币倒计时结束时调
     * （需求 2026-10-15 row12 / row13）。
     *
     * 与其它队列不同，这里不看时间、不设时长：它是一条通知，不是一段时间。
     * 起点由渲染层收走它那一帧落定（见 `ZCBuildingShake` 的说明）。
    */
    pushBuildingShake(hexId: number): void {
        if (!Number.isFinite(hexId)) return;
        this.buildingShakeQueue.push({ id: this.nextBuildingShakeId++, hexId });
        while (this.buildingShakeQueue.length > BUILDING_SHAKE_CAP) this.buildingShakeQueue.shift();
    }

    /**
     * 取走全部待播的建筑抖动，返回后队列即空。
     * 抖动不幂等且只有 0.24s，读-清必须原子；交出原数组、内部换新数组，避免遍历时被清空。
     * 空队列返回共享空数组，常态零分配。
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
     * 同抖动：不看时间、不设时长，它是一条通知；起点由渲染层收走它那一帧落定。
    */
    pushBuildingDestruction(hexId: number): void {
        if (!Number.isFinite(hexId)) return;
        this.buildingDestructionQueue.push({ id: this.nextBuildingDestructionId++, hexId });
        while (this.buildingDestructionQueue.length > BUILDING_DESTRUCTION_CAP) this.buildingDestructionQueue.shift();
    }

    /**
     * 取走全部待播的建筑摧毁通知（返回后队列即空）。理由同 `drainBuildingShakes`：
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
        for (let index = this.skillAnnounceQueue.length - 1; index >= 0; index -= 1) {
            const announce = this.skillAnnounceQueue[index];
            if (now >= announce.startedAt + announce.durationSeconds) this.skillAnnounceQueue.splice(index, 1);
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
        this.skillAnnounceQueue.length = 0;
        //  串行游标也要归零：留着上一局的时间点会让新一局第一条通报永远排在未来。
        this.nextFloatTextId = 1;
        this.nextHitFxId = 1;
        this.nextCardRevealId = 1;
        this.nextHexActivationId = 1;
        this.nextBuildingShakeId = 1;
        this.nextBuildingDestructionId = 1;
        this.nextNeutralRewardId = 1;
        this.nextSkillAnnounceId = 1;
    }
}
