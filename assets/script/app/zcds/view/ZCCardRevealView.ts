import { _decorator, Color, Component, Label, Sprite, SpriteFrame, UIOpacity } from 'cc';
import type { ZCBuildingType, ZCCardReveal } from '../model/ZCGameTypes';
import type { ZCOwner } from '../model/ZCMapConfig';
import { ZC_CARD_FADE_START_PROGRESS } from '../model/ZCBattlePresentationQueue';
import { ProcedureGame } from '../../procedure/ProcedureGame';
import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { elasticPopScale, mapToViewX, mapToViewY, POP_FROM_SCALE } from './ZCGameViewUtil';

const { ccclass, property } = _decorator;

/**
 * 「抽到卡牌」的小卡牌表现，由 `ZCGameCardReveal.prefab` 拥有。
 *
 * 和 `ZCFloatTextView` / `ZCCombatEffectView` 一样是**按进度计算**、不是 tween：
 * 每帧重算，切流程 / 暂停 / 快照回放都不会留下补间残影；过期回收由渲染层按 id 对齐完成
 * （`ZCGameRenderWorld.renderCardReveals`）。
 *
 * 卡框由 prefab 绑定；建筑图由渲染层按卡表 `buildIcon` 注入解析，
 * 本脚本只负责「选哪张图 + 文字 + 位移 / 缩放 / 透明度」。
 *
 * 时间结构（2026-10-15 定）：`startedAt` 之前**整卡不渲染**，到点才出现并**立刻**开始变大 ——
 * 卡牌的起点是「地块收场段结束」那一刻（`ZCBattlePresentationQueue.pushCardReveal`），
 * 中间没有「可见但不动」的等待段。
 */
@ccclass('ZCCardRevealView')
export class ZCCardRevealView extends Component {
    
    /**
     * 弹出段占整张卡牌生命周期的比例（2.4s ⇒ 0.24s）：这段时间内走完
     * `elasticPopScale` 的「0.2 → 1.2 → 0.92 → 1」。
     */
    private static readonly POP_PROGRESS = 0.1;

    /**
     * 运气评语（小有收获！/ 大吉大利！/ 欧皇降临！）相对卡牌出现的延迟（秒）：
     * 略慢于生成动画 —— 卡牌先蹦出来、评语随后补上，节奏感比同时出现强。
     * 淡出**不走**这条延迟：评语跟整卡同一个根 UIOpacity 级联，和卡牌同一时刻消失。
     */
    private static readonly LUCK_DELAY_SECONDS = 0.13;
    /** 评语出现的淡入时长（秒）：很短，只是不让字硬切出现。 */
    private static readonly LUCK_FADE_IN_SECONDS = 0.08;

    /** 卡名字色固定白；深浅对比靠 prefab 里那条深色描边。 */
    private static readonly CARD_NAME_COLOR = new Color(255, 255, 255, 255);

    @property({ type: Sprite, group: '节点引用', tooltip: 'Frame：品级卡框（按品级换图）。设计稿 103x126，底部有一条 27px 深色横条承载卡名' })
    frameSprite: Sprite | null = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：卡面。**角色卡牌图**（卡表 headIcon → icons/cardHead/**，与卡牌阵容同一张）；取不到才回退建筑图' })
    iconSprite: Sprite | null = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'LuckSprite：卡牌上方那行字，**美术切图**（运气评语：小有收获！/ 大吉大利！/ 欧皇降临！）。恒显，唯一例外是品级没有对应评语' })
    luckSprite: Sprite | null = null;

    @property({ type: Label, group: '节点引用', tooltip: 'NameLabel：卡名（卡表 name，如「精灵弓箭手」），落在卡框底部那条深色横条里' })
    nameLabel: Label | null = null;

    @property({ type: SpriteFrame, group: '建筑图', tooltip: '金矿：mine' })
    mineFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '品级卡框', tooltip: '绿品级（普通）：common_img_pzk_03' })
    greenFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '品级卡框', tooltip: '蓝品级（稀有）：common_img_pzk_04' })
    blueFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '品级卡框', tooltip: '紫品级（史诗）：common_img_pzk_02' })
    purpleFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '品级卡框', tooltip: '金品级（传说）：common_img_pzk_01' })
    goldFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '品级卡框', tooltip: '资源点专用（灰蓝，设计稿 kp_01）：common_img_pzk_05。优先于品级色 —— 金矿这类「不是卡牌」的地块用它' })
    resourceFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '运气评语切图', tooltip: '绿品级 问号地块：小有收获！' })
    luckTextGreenFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '运气评语切图', tooltip: '紫品级 问号地块：大吉大利！' })
    luckTextPurpleFrame: SpriteFrame | null = null;

    @property({ type: SpriteFrame, group: '运气评语切图', tooltip: '金品级 问号地块：欧皇降临！' })
    luckTextGoldFrame: SpriteFrame | null = null;

    @property({ group: '卡牌表现', tooltip: '卡牌中心相对地块中心的向上偏移（像素）。参考图里卡牌正压在地块上，所以默认 0' })
    offsetY = 0;

    @property({ group: '卡牌表现', tooltip: '起手缩放（0.2 = 由小放大；1 = 不弹）。生成动画先过冲 1.2、回落穿过 1、再落位' })
    popScale = POP_FROM_SCALE;

    @property({ group: '卡牌表现', tooltip: '从哪个进度开始淡出（0~1）。 与 ZCBattlePresentationQueue.ZC_CARD_FADE_START_PROGRESS 同值 —— 地块正是在这一刻原尺寸回场' })
    fadeStartProgress = ZC_CARD_FADE_START_PROGRESS;

    /** 上一次 render 到的卡面组合（建筑 | 品级 | 阵营 | 兵种 | 两行文案）；没变就跳过选图选字，只在首帧与换卡时写。 */
    private contentKey = '';
    /** 有没有运气评语切图可显（上方那行只由它决定）。 */
    private hasLuckText = false;
    /**
     * 整卡淡出走根节点 UIOpacity（opacity 级联到卡框 / 卡面 / 评语 / 卡名全部子节点），
     * 懒取一次；prefab 上没挂时运行时补挂，不依赖编辑器接线。
     */
    private cardOpacity: UIOpacity | null = null;
    /**
     * 运气评语**自己的** UIOpacity（挂在 LuckSprite 节点上，懒取）：只承担「延迟出现」，
     * 淡出仍由根节点级联 —— 这样文字和卡牌**消失时间必然一致**，两处各自独立可调。
     */
    private luckOpacityComp: UIOpacity | null = null;
    /**
     * 卡面图 / 建筑帧都**不再由渲染层注入闭包**：按 id 现取控制器的只读出口
     * （`ProcedureGame.current?.resolveCardArt / resolveBuildingFrame`）—— 数据本来就在控制器手里
     * （`legendCardArtFrames` / `preparedResources.buildingFrames`），少一层逐实例闭包。
     */
    invalidateArt(): void {
        // 卡面图是异步加载的，可能晚于小卡牌弹出才到 —— 不作废内容键，那条卡会一直停在建筑图上。
        this.contentKey = '';
    }

    render(reveal: Readonly<ZCCardReveal>, now: number): void {
        const duration = Math.max(0.001, reveal.durationSeconds);
        const elapsedSeconds = now - reveal.startedAt;
        // 「未开始」＝还在等前置的**地块收场段**走完（`startedAt` 落在未来）。
        //
        //  这段**必须整卡不渲染**，不能只把进度 clamp 到 0：进度 0 对应 `popScale = 0.2`
        // 且 alpha 满 —— 那就是一张小卡**可见却一动不动**地干等，读作「卡牌卡住了」。
        // 需求方口径（2026-10-15）：「卡牌生成阶段不需要等待静止不动的阶段，
        // 出现小卡后马上播放卡片变大的动画」⇒ 出现的那一刻就是开始变大的那一刻。
        //
        // 写**绝对** active（不是缩成 0 留着占一次绘制），与建筑 `buildingPopScale = 0` 同一套惯例。
        if (elapsedSeconds < 0) {
            this.node.active = false;
            return;
        }
        this.node.active = true;
        const progress = Math.min(1, elapsedSeconds / duration);
        this.renderContent(reveal);
        // 世界定位一律由**根节点**承担（和 ZCUnitView / ZCFloatTextView 同惯例），
        // 子节点只做局部偏移；两处都写绝对坐标会让卡牌跑到两倍远处。
        // 卡牌**整段原地不动**（不像飘字那样边飘边升）：位置只由格心 + offsetY 决定，
        // 弹出与淡出都叠在同一个点上，观众视线不用跟着跑。
        this.node.setPosition(
            mapToViewX(reveal.x),
            mapToViewY(reveal.y) + this.offsetY,
            0,
        );
        this.node.setScale(this.popScaleAt(progress), this.popScaleAt(progress), 1);
        this.applyAlpha(progress, elapsedSeconds);
    }

    /**
     * 生成动画曲线（进度式）：弹出段内把 `progress / POP_PROGRESS` 喂给共用的
     * `elasticPopScale`（`popScale` → 1.2 → 0.92 → 1）。
     *
     *  **不要在这里另写一条曲线**：建筑生成（`ZCHexView` 的建筑段）用的就是同一条
     * —— 需求要求两处「节奏类似」，共用才不会再分开跑。POP 段之外恒为 1，淡出段不再动缩放。
     */
    private popScaleAt(progress: number): number {
        const t = progress / ZCCardRevealView.POP_PROGRESS;
        return t >= 1 ? 1 : elasticPopScale(t, this.popScale);
    }

    /** 卡框 / 卡面 / 两行文案只在换卡时写一次；每帧只动位置、缩放与透明度。 */
    private renderContent(reveal: Readonly<ZCCardReveal>): void {
        const key = `${reveal.cardId}|${reveal.building}|${reveal.tier}|${reveal.owner}|${reveal.unitId ?? ''}|${reveal.cardName}|${reveal.luckText}`;
        if (key === this.contentKey) return;
        this.contentKey = key;
        this.setSprite(this.frameSprite, this.frameFor(reveal));
        this.setSprite(this.iconSprite, this.frameForArt(reveal));
        // 上方那行只由 `luckText` 决定：运气评语美术切图；没有评语就没有字（`setSprite` 收到 null 关掉 Sprite）。
        this.hasLuckText = reveal.luckText !== '';
        this.setSprite(this.luckSprite, this.hasLuckText ? this.luckTextFrameForTier(reveal.tier) : null);
        if (this.nameLabel) {
            if (this.nameLabel.string !== reveal.cardName) this.nameLabel.string = reveal.cardName;
            //  enabled 必须绝对赋值：节点来自对象池，复用回来时上一次的 enabled=false 会残留
            // （只表现为「卡牌时有时无」）。淡出由根节点 UIOpacity 承担，卡名颜色固定白。
            this.nameLabel.enabled = reveal.cardName !== '';
            this.nameLabel.color = ZCCardRevealView.CARD_NAME_COLOR;
        }
    }

    /** 尾段整体淡出：根节点 UIOpacity 的 opacity 级联到整棵子树，一个组件管住全部子节点。 */
    private applyAlpha(progress: number, elapsedSeconds: number): void {
        const fade = progress <= this.fadeStartProgress
            ? 1
            : Math.max(0, 1 - (progress - this.fadeStartProgress) / (1 - this.fadeStartProgress));
        this.getCardOpacity().opacity = Math.round(255 * fade);
        // 运气评语延迟出现（LUCK_DELAY_SECONDS，略慢于生成动画），出现后保持 1 ——
        // 之后的淡出**只由根节点 UIOpacity 级联承担**，所以文字和卡牌消失时间必然一致。
        // 池复用/无评语时写 0，避免上一张卡的可见态残留。
        const luck = this.getLuckOpacity();
        if (!luck) return;
        if (!this.hasLuckText) {
            luck.opacity = 0;
            return;
        }
        const show = Math.max(0, Math.min(1,
            (elapsedSeconds - ZCCardRevealView.LUCK_DELAY_SECONDS) / ZCCardRevealView.LUCK_FADE_IN_SECONDS));
        luck.opacity = Math.round(255 * show);
    }

    private getCardOpacity(): UIOpacity {
        if (this.cardOpacity) return this.cardOpacity;
        this.cardOpacity = this.node.getComponent(UIOpacity) ?? this.node.addComponent(UIOpacity);
        return this.cardOpacity;
    }

    /** 评语节点的 UIOpacity 懒取；prefab 没挂时运行时补挂（与 `getCardOpacity` 同惯例）。 */
    private getLuckOpacity(): UIOpacity | null {
        if (!this.luckSprite) return null;
        if (!this.luckOpacityComp) {
            this.luckOpacityComp = this.luckSprite.node.getComponent(UIOpacity)
                ?? this.luckSprite.node.addComponent(UIOpacity);
        }
        return this.luckOpacityComp;
    }

    private setSprite(sprite: Sprite | null, frame: SpriteFrame | null): void {
        if (!sprite) return;
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = frame !== null;
    }

    /** 卡框选图：资源点优先用灰蓝专用框（表达「资源点」而非品级），缺图退回按品级。 */
    private frameFor(reveal: Readonly<ZCCardReveal>): SpriteFrame | null {
        if (reveal.building === 'mine' && this.resourceFrame) return this.resourceFrame;
        return this.frameForTier(reveal.tier);
    }

    private frameForTier(tier: number): SpriteFrame | null {
        switch (tier) {
            case 1: return this.greenFrame;
            case 2: return this.blueFrame;
            case 3: return this.purpleFrame;
            case 4: return this.goldFrame;
            default: return null;
        }
    }

    /** 卡面主图优先角色图；金矿已确定使用建筑图，缺角色图不再告警。 */
    private frameForArt(reveal: Readonly<ZCCardReveal>): SpriteFrame | null {
        const cardArt = ProcedureGame.current?.resolveCardArt(reveal.cardId) ?? null;
        if (cardArt) return cardArt;
        // if (ZCDC_LOG_WARNINGS) {
        //     console.warn(
        //         `[ZCCardRevealView] 卡牌 ${reveal.cardId}（${reveal.cardName}）没有角色卡面图，已回退建筑图`
        //         + '；请检查卡表 headIcon 是否配置、或图片是否已进包',
        //     );
        // }
        const configured = ProcedureGame.current?.resolveBuildingFrame(reveal.cardId, reveal.building) ?? null;
        return configured ?? this.frameForBuilding(reveal.building, reveal.owner);
    }

    /**
     * 建筑类型的通用外观兜底（**只在注入的解析器给不出图时**才走）。
     *  没有 `hq` 分支：主城卡被 `isHqCard` 从牌堆过滤（`ZCGameRuntimeConfig.ts:672`），
     * `pushCardReveal` 永远拿不到 `building === 'hq'`。
     */
    private frameForBuilding(building: ZCBuildingType, _owner: ZCOwner): SpriteFrame | null {
        switch (building) {
            case 'mine': return this.mineFrame;
            default: return null;
        }
    }

    /**
     * 运气评语切图，按品级；蓝品级（2）暂借绿品级那张（美术只导了 3 张）。
     * 美术补出蓝评语切图后把 `case 2` 拆成独立字段即可（卡框 `frameForTier` 的 `case 2` 别一起动）。
     */
    private luckTextFrameForTier(tier: number): SpriteFrame | null {
        switch (tier) {
            case 1:
            case 2: return this.luckTextGreenFrame;
            case 3: return this.luckTextPurpleFrame;
            case 4: return this.luckTextGoldFrame;
            default: return null;
        }
    }
}
