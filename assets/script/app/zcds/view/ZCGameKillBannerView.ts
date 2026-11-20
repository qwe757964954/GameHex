import { _decorator, Component, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import type { ZCCardReveal } from '../model/ZCGameTypes';
import { ZCOwner } from '../model/ZCMapConfig';

const { ccclass, property } = _decorator;

/** 横栏高度（设计 px）：截图 22px × 720/248 ≈ 64，取 70 与 88 高的玩家行成比例。*/
export const KILL_BANNER_HEIGHT = 70;
/** 横栏顶边距全屏层（HUD 根）顶的距离：玩家列表节点底边 519 + 41。*/
export const KILL_BANNER_TOP = 560;
/** 底板 + 文字的抬头角（度）。截图里 215px 横跨抬升 8px ⇒ 2.1°。*/
export const KILL_BANNER_SLANT_DEGREES = 2.1;
/** 头像盘心距屏幕左缘；截图 22% 宽 ⇒ 160。*/
export const KILL_BANNER_PORTRAIT_CENTER_X = 160;
/** 文字区左缘距屏幕左缘：头像右缘（160 + 44 = 204）+ 14。*/
export const KILL_BANNER_TEXT_LEFT = 218;
/** 文字区右缘留白。*/
export const KILL_BANNER_TEXT_RIGHT_MARGIN = 20;

/** 文字行高与字号（截图字符高 14px ⇒ 34~36 设计）。字号 / 描边 / 加粗由 prefab 声明。*/
const LABEL_LINE_HEIGHT = 44;
/** 视口兜底：拿不到全屏层 UITransform 时按工程 designResolution。*/
const FALLBACK_VIEW_WIDTH = 720;
const FALLBACK_VIEW_HEIGHT = 1280;
/** 头像弹入的起始缩放与时长：滑入的同时从小弹到 1，easeOutBack 带一点回弹。*/
const PORTRAIT_POP_FROM = 0.55;
const PORTRAIT_POP_SECONDS = 0.22;

/**
 * 击杀横栏：野怪被打掉时从左侧滑入的一整条细长横幅。
 *
 * 与 `ZCGameLegendBannerView` 的关系
 *
 *  - 节奏同源：`SLIDE / FADE_IN / FADE_START` 三个常量与传说卡横幅逐字一致，
 *    滑入曲线也共用「整条宽度从屏外滑到落位」的口径 ⇒ 同屏先后出现时观感是一套。
 *  - 结构同源：`UIOpacity` 负责整条淡入淡出，底板 `Sprite` 按 owner 换四色，
 *    文字用系统字体 + 描边。
 *  - 版面不同：传说卡横幅按人数竖排、占满屏高；击杀横栏是固定的一条（70 高），
 *    永远贴在左侧玩家列表下方，不参与分格。
 *
 * 截图口径（248×531 的游戏内截图，按 720 设计宽换算）
 *
 *  - 横栏可见高约 22px ⇒ 70 设计高；左端斜切、右端被屏幕边缘裁掉。
 *  - 横栏本身有约 2° 的抬头（右高左低），头像保持竖直 ⇒ 底板与文字一起放进
 *    `Slant` 节点旋转，`Portrait` 单独挂在根节点上，不跟着转。
 *  - 圆形头像用 `zd_txk_01..04`（与 `ZCGameHudPlayerRow` 同一套盘），盘心距屏幕左缘 160、
 *    直径 88（其他三席 77，与本方 HUD 行一致），头像明显高出横栏上下沿。
 *  - 文案「玩家名 击杀了 野怪名」白字 + 深藏青描边，左对齐，起点在头像右缘外 14。
 */
@ccclass('ZCGameKillBannerView')
export class ZCGameKillBannerView extends Component {

    /** 入场：从屏幕外一整个横幅宽度滑到落位（与传说卡横幅同节奏）。*/
    private static readonly SLIDE_PROGRESS = 0.18;
    /** 前段顺带淡入，避免横栏从屏幕边缘「凭空出现」。*/
    private static readonly FADE_IN_PROGRESS = 0.08;
    /** 尾段整体淡出。*/
    private static readonly FADE_START_PROGRESS = 0.78;
    private static readonly FADE_OUT_WINDOW = 1 - ZCGameKillBannerView.FADE_START_PROGRESS;

    @property({ type: UIOpacity, group: '节点引用', tooltip: '根节点 UIOpacity：整条横栏的淡入淡出由它承担' })
    bannerOpacity: UIOpacity = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Slant：底板与文字的斜切容器（抬头 2.1°）' })
    slantNode: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Slant/Plate：横栏底板，按 owner 换图（四色）' })
    plateSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Slant/Name：「玩家名 击杀了 野怪名」' })
    nameLabel: Label = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Portrait：圆形头像容器（不跟着横栏旋转）' })
    portraitNode: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Disc：zd_txk 圆盘，按 owner 换图' })
    discSprite: Sprite = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Head：玩家头像（CircleAvatar 圆裁）' })
    headSprite: Sprite = null!;

    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '我方（player，蓝）：kill_banner_02' })
    platePlayer: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '2 号（enemy，红）：kill_banner_01' })
    plateEnemy: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '3 号（enemy2，黄）：kill_banner_04' })
    plateEnemy2: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '4 号（enemy3，紫）：kill_banner_03' })
    plateEnemy3: SpriteFrame = null!;

    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '我方头像盘（88）：zd_txk_01' })
    discPlayer: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '2 号头像盘（77）：zd_txk_02' })
    discEnemy: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '3 号头像盘（77）：zd_txk_03' })
    discEnemy2: SpriteFrame = null!;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '4 号头像盘（77）：zd_txk_04' })
    discEnemy3: SpriteFrame = null!;

    private viewWidth = FALLBACK_VIEW_WIDTH;
    private viewHeight = FALLBACK_VIEW_HEIGHT;
    private appliedWidth = -1;
    private appliedPortraitScale = -1;
    private appliedBannerOpacity = -1;
    private contentKey = '';

    /** owner 名字（`seatProfiles`），由渲染层注入；拿不到时用席位本身（与传说卡横幅同一兜底）。*/
    private ownerNames: ReadonlyMap<ZCOwner, { readonly name: string }> | undefined;
    /** 玩家头像帧由渲染层按 owner 现取；拿不到就只留圆盘。*/
    private portraitResolver: ((owner: ZCOwner) => SpriteFrame | null) | null = null;
    /** owner → 底板 / 圆盘 / 盘径 查表，首次用到时按当前 @property 构建。*/
    private ownerFrames: Record<ZCOwner, {
        readonly plate: SpriteFrame;
        readonly disc: SpriteFrame;
        readonly discSize: number;
        readonly headSize: number;
    }> | null = null;

    /** 落位上下文：横栏贴屏幕左缘满宽，只关心层宽高。*/
    setLayout(placement: { readonly viewWidth: number; readonly viewHeight: number }): void {
        this.viewWidth = placement.viewWidth > 0 ? placement.viewWidth : FALLBACK_VIEW_WIDTH;
        this.viewHeight = placement.viewHeight > 0 ? placement.viewHeight : FALLBACK_VIEW_HEIGHT;
    }

    setOwnerNames(names: ReadonlyMap<ZCOwner, { readonly name: string }> | undefined): void {
        this.ownerNames = names;
        this.contentKey = '';
    }

    setPortraitResolver(resolver: ((owner: ZCOwner) => SpriteFrame | null) | undefined): void {
        this.portraitResolver = resolver ?? null;
        this.contentKey = '';
    }

    /** 头像异步到货：作废内容键，下一帧重新取头像（横栏可能正停在「只有圆盘」的那一版）。*/
    refreshPortrait(): void {
        this.contentKey = '';
    }

    render(reveal: Readonly<ZCCardReveal>, now: number): void {
        const duration = Math.max(0.001, reveal.durationSeconds);
        const progress = Math.max(0, Math.min(1, (now - reveal.startedAt) / duration));
        this.renderContent(reveal);
        this.applyLayout();
        // 滑入：从屏幕外一整个横幅宽度滑到落位，缓动 easeOutCubic（与传说卡横幅一致）。
        const startX = -this.viewWidth;
        const slide = Math.min(1, progress / ZCGameKillBannerView.SLIDE_PROGRESS);
        const eased = 1 - (1 - slide) ** 3;
        this.node.setPosition(startX + (0 - startX) * eased, killBannerYOf(this.viewHeight), 0);
        const opacity = Math.round(255 * this.alphaOf(progress));
        if (opacity !== this.appliedBannerOpacity) {
            this.appliedBannerOpacity = opacity;
            this.bannerOpacity.opacity = opacity;
        }
        // 头像弹入：从 0.55 起弹到 1，播得比整条横幅短，落位时已经站定。
        const popScale = killBannerPortraitScaleOf(
            killBannerPortraitPopProgress(now - reveal.startedAt));
        if (Math.abs(popScale - this.appliedPortraitScale) > 0.002) {
            this.appliedPortraitScale = popScale;
            this.portraitNode.setScale(popScale, popScale, 1);
        }
    }

    /** 底板 / 圆盘 / 头像 / 文案只在换击杀时写；每帧只动位置、透明度与头像缩放。*/
    private renderContent(reveal: Readonly<ZCCardReveal>): void {
        const key = `${reveal.id}|${reveal.owner}|${reveal.cardName}`;
        if (key === this.contentKey) return;
        this.contentKey = key;
        const frames = this.framesFor(reveal.owner);
        this.setSprite(this.plateSprite, frames.plate);
        this.setSprite(this.discSprite, frames.disc);
        // 我方 88 / 其他三席 77，头像随之 74 / 66 —— 与 `ZCGameHudPlayerRow` 同档。
        this.writeSize(this.discSprite.node, frames.discSize, frames.discSize);
        this.writeSize(this.headSprite.node, frames.headSize, frames.headSize);
        this.setSprite(this.headSprite, this.portraitResolver?.(reveal.owner) ?? null);
        this.nameLabel.string = killBannerTextOf(this.killerNameOf(reveal.owner), reveal.cardName);
    }

    private killerNameOf(owner: ZCOwner): string {
        // 与 `ZCGameLegendBannerView` 同一兜底：席位档案没名字时退回 owner 本身（不另造文案表）。
        return this.ownerNames?.get(owner)?.name || owner;
    }

    /** 尺寸只在层宽变化时重写（`setContentSize` 会置引擎变换脏标记，render 是每帧调的）。*/
    private applyLayout(): void {
        const width = this.viewWidth;
        if (Math.abs(width - this.appliedWidth) < 0.5) return;
        this.appliedWidth = width;
        this.writeSize(this.node, width, KILL_BANNER_HEIGHT);
        this.writeSize(this.slantNode, width, KILL_BANNER_HEIGHT);
        this.writeSize(this.plateSprite.node, width, KILL_BANNER_HEIGHT);
        // 头像盘心固定距屏幕左缘 160，横栏满宽 ⇒ 局部 x = -width / 2 + 160。
        this.portraitNode.setPosition(-width / 2 + KILL_BANNER_PORTRAIT_CENTER_X, 0, 0);
        const left = -width / 2 + KILL_BANNER_TEXT_LEFT;
        const right = width / 2 - KILL_BANNER_TEXT_RIGHT_MARGIN;
        this.writeSize(this.nameLabel.node, Math.max(1, right - left), LABEL_LINE_HEIGHT);
        this.nameLabel.node.setPosition((left + right) / 2, 0, 0);
    }

    private writeSize(node: Node, width: number, height: number): void {
        node.getComponent(UITransform).setContentSize(width, height);
    }

    private alphaOf(progress: number): number {
        const fadeIn = Math.min(1, progress / ZCGameKillBannerView.FADE_IN_PROGRESS);
        const fadeOut = progress <= ZCGameKillBannerView.FADE_START_PROGRESS
            ? 1
            : Math.max(0, 1 - (progress - ZCGameKillBannerView.FADE_START_PROGRESS)
                / ZCGameKillBannerView.FADE_OUT_WINDOW);
        return fadeIn * fadeOut;
    }

    /**
     * 四色底板与圆盘：底板按色相对齐（蓝 02 / 红 01 / 黄 04 / 紫 03，与传说卡横幅同一映射），
     * 圆盘按 HUD 席位（player 01 / enemy 02 / enemy2 03 / enemy3 04）。
     */
    private framesFor(owner: ZCOwner): {
        readonly plate: SpriteFrame;
        readonly disc: SpriteFrame;
        readonly discSize: number;
        readonly headSize: number;
    } {
        if (!this.ownerFrames) {
            this.ownerFrames = {
                [ZCOwner.Player]: { plate: this.platePlayer, disc: this.discPlayer, discSize: 88, headSize: 74 },
                [ZCOwner.Enemy]: { plate: this.plateEnemy, disc: this.discEnemy, discSize: 77, headSize: 66 },
                [ZCOwner.Enemy2]: { plate: this.plateEnemy2, disc: this.discEnemy2, discSize: 77, headSize: 66 },
                [ZCOwner.Enemy3]: { plate: this.plateEnemy3, disc: this.discEnemy3, discSize: 77, headSize: 66 },
            };
        }
        return this.ownerFrames[owner] ?? this.ownerFrames[ZCOwner.Enemy3];
    }

    /** `enabled` 绝对赋值：换席位时上一张图可能被禁用，不能只换 frame。*/
    private setSprite(sprite: Sprite, frame: SpriteFrame | null): void {
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = frame !== null;
    }
}

/** 横栏根节点中心 y（相对全屏层中心）：顶部固定距层顶 `KILL_BANNER_TOP`。*/
export function killBannerYOf(viewHeight: number): number {
    const height = viewHeight > 0 ? viewHeight : FALLBACK_VIEW_HEIGHT;
    return height / 2 - KILL_BANNER_TOP - KILL_BANNER_HEIGHT / 2;
}

/** 「玩家名 击杀了 野怪名」；野怪名缺失时退回「野怪」。*/
export function killBannerTextOf(killerName: string, monsterName: string): string {
    return `${killerName} 击杀了 ${monsterName || '野怪'}`;
}

/** 头像弹入段进度（0 = 起始缩放，1 = 站定）。*/
export function killBannerPortraitPopProgress(elapsedSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds)) return 0;
    const local = elapsedSeconds / PORTRAIT_POP_SECONDS;
    if (!(local > 0)) return 0;
    return local >= 1 ? 1 : local;
}

/** 头像缩放：0.55 → 1，easeOutBack（末尾略过冲再落回）。*/
export function killBannerPortraitScaleOf(progress: number): number {
    const k = !(progress > 0) ? 0 : progress >= 1 ? 1 : progress;
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const back = 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
    return PORTRAIT_POP_FROM + (1 - PORTRAIT_POP_FROM) * back;
}
