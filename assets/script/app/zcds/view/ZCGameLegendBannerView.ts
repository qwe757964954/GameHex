import { _decorator, Color, Component, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';
import type { ZCCardReveal } from '../model/ZCGameTypes';
import { ZC_OWNER_ORDER, ZCOwner } from '../model/ZCMapConfig';

const { ccclass, property } = _decorator;

/** 横幅画布高度，按四方共用的设计稿规格。 */
const BANNER_HEIGHT = 417;

/**
 * 横幅的**设计稿宽度**（= 工程 `designResolution` 的 720，也是 4 张底图的原始宽度）。
 *
 * 只在拿不到「屏幕宽度」时兜底；正常情况下宽度由 `setLayout` 注入的 `viewWidth` 决定，
 * 见 `bannerWidth()`。
 */
const DESIGN_WIDTH = 720;

/** 横幅铺满屏幕宽度，因此统一水平居中。 */
const BANNER_X = 0;

/** HUD 根节点尺寸暂不可用时使用设计分辨率。 */
const FALLBACK_VIEW_HEIGHT = 1280;

/** 将人数限制到有效席位范围，至少保留两方。 */
export function clampCount(playerCount: number): number {
    if (!Number.isFinite(playerCount)) return 2;
    return Math.min(ZC_OWNER_ORDER.length, Math.max(2, Math.round(playerCount)));
}

/** 我方固定在 0 槽；对手按席位顺序从远端向我方排列。 */
export function slotOf(owner: ZCOwner, playerCount: number): number {
    const total = clampCount(playerCount);
    const index = ZC_OWNER_ORDER.indexOf(owner);
    if (index <= 0) return 0;
    return total - index;
}

/** 均分屏高，使各方横幅占满竖向空间。 */
export function bannerHeightOf(viewHeight: number, playerCount: number): number {
    const total = clampCount(playerCount);
    const height = (viewHeight > 0 ? viewHeight : FALLBACK_VIEW_HEIGHT) / total;
    // 至少留一点高度：`viewHeight <= 0` / NaN 已被 `> 0` 挡掉，这里兜的是
    //「层高小到除出来不足 1px」（异常注入）—— 退回设计稿单条高，横幅整体可见而不是 0 高不可见。
    return height > 1 ? height : BANNER_HEIGHT;
}

/** 返回横幅所在槽位的中心 y；我方在下，敌方按席位顺序向上排列。 */
export function layoutYOf(owner: ZCOwner, playerCount: number, viewHeight: number): number {
    const total = clampCount(playerCount);
    const height = viewHeight > 0 ? viewHeight : FALLBACK_VIEW_HEIGHT;
    return -height / 2 + (height * (slotOf(owner, total) + 0.5)) / total;
}

// role（立绘）的「生成动画」：整条横幅**扇入完成之后**才开始播（需求 2026-10-15 row11）。
//
// 需求原文：「预制体从屏幕外生成，从左往右快速扇入屏幕，当生成动画完成时，再展示 role 节点生成动画
//（role 初始透明度为 0 或不加载显示），role 节点初始位置 Y 轴为 80，**0.7s 内降至 0**，
//（X 轴根据父节点移动）」。
//
// 两条口径值得写清楚：
//  1. 「Y 轴 80 → 0」是**相对静止位**的偏移量，不是绝对坐标 —— prefab 里 Role 的静止位是
//     `y = -28.24`，若真按「绝对值 0 收」写，立绘会永久上移 28px、和设计稿对不上。
//     落地口径：`y = 静止位 + 80 × (1 - ease)`。
//  2. 「X 轴根据父节点移动」= 横向**不碰**：立绘的 x 由 prefab 的静止位给定，整条横幅滑入时
//     它自然跟着父节点走。所以这里只写 y 与透明度。


/** role 生成段的起手下落偏移（px，需求原文「初始位置 Y 轴为 80」）。 */
export const LEGEND_ROLE_DROP_Y = 80;
/** role 生成段的时长（秒，需求原文「0.7s 内降至 0」）。 */
export const LEGEND_ROLE_GENERATE_SECONDS = 0.7;

/**
 * role 生成段的进度（`0` = 还没开始 ⇒ 透明 + 高悬 80px；`1` = 落位 + 全不透明）。
 *
 * `elapsedSeconds` 从**横幅弹出那一刻**起算、`slideSeconds` 是扇入段时长：
 * 扇入没播完时进度恒 0（需求「当生成动画完成时，再展示 role 节点生成动画」），
 * 扇入结束后 0.7s 内线性推到 1。
 */
export function legendRoleProgress(elapsedSeconds: number, slideSeconds: number): number {
    if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(slideSeconds)) return 0;
    const local = (elapsedSeconds - slideSeconds) / LEGEND_ROLE_GENERATE_SECONDS;
    if (!(local > 0)) return 0;
    return local >= 1 ? 1 : local;
}

/**
 * 生成段的缓动（0→1）：**下落与淡入共用同一个值**，两者天然同步（不会出现"已经落位了还很淡"）。
 *
 * 取 easeOutCubic：出手快、落位稳，与全篇生成动画（`ZCGameViewUtil.elasticPopScale` 的出手段）同族。
 */
export function legendRoleEase(progress: number): number {
    const k = !(progress > 0) ? 0 : progress >= 1 ? 1 : progress;
    return 1 - (1 - k) ** 3;
}

/** 渲染传说卡出场横幅；位置和动画由 reveal 进度驱动，避免补间状态残留。 */
@ccclass('ZCGameLegendBannerView')
export class ZCGameLegendBannerView extends Component {

    /**
     * 落位用的视口宽兜底（prefab 设计稿 = 工程 `designResolution` 720×1280）。
     * 真源是横幅所在全屏层（HUD 根）的 `UITransform`，由渲染层注入；只有拿不到时才回退。
     */
    private static readonly FALLBACK_VIEW_WIDTH = DESIGN_WIDTH;

    /** 入场：从屏幕外一整个横幅宽度滑到落位，「出场」感来自这一段。 */
    private static readonly SLIDE_PROGRESS = 0.18;
    /** 前段顺带淡入，避免横幅从屏幕边缘「凭空出现」。 */
    private static readonly FADE_IN_PROGRESS = 0.08;
    /** 尾段整体淡出。 */
    private static readonly FADE_START_PROGRESS = 0.78;

    @property({ type: UIOpacity, group: '节点引用', tooltip: '根节点上的 UIOpacity：整条横幅的淡入淡出由它一个组件承担' })
    bannerOpacity: UIOpacity = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Banner：底板，按 owner 换图（四色）' })
    bannerSprite: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Role：立绘，运行时按卡注入（兵种 idle / 建筑图）' })
    roleSprite: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Title：固定的「传说卡牌」标题图' })
    titleSprite: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Ring：头像环，按 owner 换图（四色）' })
    ringSprite: Sprite = null;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Portrait/Ring/Head：玩家头像（CircleAvatar 圆裁）；拿不到头像时只留色环' })
    headSprite: Sprite = null;

    @property({ type: Label, group: '节点引用', tooltip: 'Name：卡名（卡表 name，如「吐豌豆骑手」）' })
    nameLabel: Label = null;

    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '我方（player，蓝）：legend_banner_02' })
    bannerPlayer: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '2 号（enemy，红）：legend_banner_01' })
    bannerEnemy: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '3 号（enemy2，黄）：legend_banner_04' })
    bannerEnemy2: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '4 号（enemy3，紫）：legend_banner_03' })
    bannerEnemy3: SpriteFrame = null;

    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '我方头像环（蓝）：legend_ring_02' })
    ringPlayer: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '2 号头像环（红）：legend_ring_01' })
    ringEnemy: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '3 号头像环（黄）：legend_ring_04' })
    ringEnemy2: SpriteFrame = null;
    @property({ type: SpriteFrame, group: '玩家配色', tooltip: '4 号头像环（紫）：legend_ring_03' })
    ringEnemy3: SpriteFrame = null;

    /** 上一次 render 到的内容组合；没变就跳过选图选字，只在首帧与换卡时写。 */
    private contentKey = '';
    /** 立绘解析：与卡面同一条链（兵种 idle → 建筑图），由渲染层注入一次。 */
    private artResolver: ((reveal: Readonly<ZCCardReveal>) => SpriteFrame | null) | null = null;
    /** 头像解析：玩家头像 SpriteFrame，由渲染层注入（拿不到就返回 null，只留色环）。 */
    private portraitResolver: ((owner: ZCOwner) => SpriteFrame | null) | null = null;
    /**
     * 落位用的本局人数、屏幕宽度与**屏幕高度**，**由渲染层在横幅弹出前注入**。
     *
     * 视图不自己猜人数：`ZCGameModel.activeOwners` 是唯一真源，而模型对象不传给视图
     * （视图只拿到 `ZCCardReveal`）。人数没注入时按 2 人兜底 —— 与 `ZCMapConfig` 里
     * 「未声明 playerCount 按 2 人」的既有口径一致。
     *
     *  `viewHeight` 是竖排均分的**唯一真源**（每格高 = 它 / 人数）；
     * `viewWidth` 只用于**滑入动画的起止位置**（弹出方式保持原样，仍是横向滑入）。
     */
    private playerCount = 2;
    private viewWidth = ZCGameLegendBannerView.FALLBACK_VIEW_WIDTH;
    private viewHeight = FALLBACK_VIEW_HEIGHT;
    /** 已写到节点上的横幅**宽 / 高**；变了才重设（`setContentSize` 会置引擎变换脏标记）。 */
    private appliedWidth = -1;
    private appliedHeight = -1;
    /**
     * 底板（`Banner`）的**原生高度**（prefab 的 417），第一次用到时从节点上读一次。
     *
     * 底板只跟屏幕宽度走，高度永远是它自己的设计值 —— 见 `applyLayout` 里的说明。
     */
    private plateHeight: number | null = null;
    /**
     * Role 节点的**静止位 y**（prefab 里写的那个值），生成动画是相对它做偏移。
     *
     * 懒捕一次：必须在**第一次写 y 之前**读，所以放在 `render` 里取、且只取一次。
     * 节点来自对象池（`release` 只把节点置灰、位置保留），但捕到的是 prefab 原值 ——
     * 组件实例与节点同生命周期，一局里只捕一次，之后复用不会读到"上一段动画的中间值"。
     */
    private roleRestY: number | null = null;
    /** 已写进 Role Sprite 的透明度；变了才写（透明度每帧都在变，但不必每帧都赋值）。 */
    private appliedRoleOpacity = -1;
    /** 写 `Sprite.color` 用的复用实例（每帧新建 Color 属于 update 路径分配）。取色板的原色：白。 */
    private readonly roleColorScratch = new Color(255, 255, 255, 255);

    /**
     * 注入落位上下文。**渲染层每帧都会调一次**（`renderLegendBanners` 在循环里对每条
     * 已存在的横幅重算落位上下文，好让人数变化时立刻重排），所以这里
     *  **绝不能顺手作废 `appliedWidth` / `appliedHeight`** —— 那会让 `applyLayout` 每帧都判定"尺寸变了"，
     * 每帧 `setContentSize`，等于把引擎变换脏标记按帧置满（AGENTS.md 禁update 路径的无谓写入）。
     *
     * 尺寸是否真变了由 `applyLayout` 自己按数值比对决定，人数 / 屏幕宽度变化时它自然会发现。
     *
     * 不用作废内容键 —— 落位上下文不影响选图选字。
     */
    setLayout(placement: {
        readonly playerCount: number;
        readonly viewWidth: number;
        readonly viewHeight: number;
    }): void {
        // 人数上限就是玩家席位上限（`ZC_OWNER_ORDER` 的长度）；异常值一并夹住，
        // 免得除出 NaN 把横幅甩出屏幕。
        this.playerCount = clampCount(placement.playerCount);
        this.viewWidth = placement.viewWidth > 0
            ? placement.viewWidth : ZCGameLegendBannerView.FALLBACK_VIEW_WIDTH;
        this.viewHeight = placement.viewHeight > 0 ? placement.viewHeight : FALLBACK_VIEW_HEIGHT;
    }

    setArtResolver(resolver: ((reveal: Readonly<ZCCardReveal>) => SpriteFrame | null) | undefined): void {
        this.artResolver = resolver ?? null;
        // 解析器可能在横幅已经弹出来之后才注入（立绘要等单位的 Prefab 池）；
        // 作废内容键强制下一帧重画，否则那一条横幅会一直空着立绘。
        this.contentKey = '';
    }

    setPortraitResolver(resolver: ((owner: ZCOwner) => SpriteFrame | null) | undefined): void {
        this.portraitResolver = resolver ?? null;
        this.contentKey = '';
    }

    render(reveal: Readonly<ZCCardReveal>, now: number): void {
        const duration = Math.max(0.001, reveal.durationSeconds);
        const progress = Math.max(0, Math.min(1, (now - reveal.startedAt) / duration));
        this.renderContent(reveal);
        // 尺寸先定：位置（滑入起止点）依赖它。
        this.applyLayout();
        // ── 扇形入场：**恒从屏幕外左侧**滑到落位（需求 2026-10-15 row11 原文
        //「预制体从屏幕外生成，**从左往右**快速扇入屏幕」）──
        // 从屏幕外一整个横幅宽度滑到落位（左缘贴左屏缘外）⇒ 无论屏幕多宽，横幅整个宽度
        // 都经历完整滑入。**不因为落位是竖排就换成上下滑入。**
        // ⚠️ 旧口径是「我方从左、敌方从右」，2026-10-15 row11 明确改成「一律从左往右」。
        const bannerHalfWidth = this.bannerWidth() / 2;
        const startX = -this.viewWidth / 2 - bannerHalfWidth;
        const slide = Math.min(1, progress / ZCGameLegendBannerView.SLIDE_PROGRESS);
        const eased = 1 - (1 - slide) ** 3;
        // 终点 x 恒为 0（横幅宽 720 = 竖屏逻辑宽，满宽摆放、不分列）；
        // 终点 y 是各自的竖向格心（按人数均分屏高）。
        const targetY = layoutYOf(reveal.owner, this.playerCount, this.viewHeight);
        this.node.setPosition(startX + (0 - startX) * eased, targetY, 0);
        this.bannerOpacity.opacity = Math.round(255 * this.alphaOf(progress));
        // ── 立绘生成动画：扇入**播完**才开始（时长以秒计，不随 reveal 时长缩放）──
        const slideSeconds = ZCGameLegendBannerView.SLIDE_PROGRESS * duration;
        this.renderRoleGenerate(now - reveal.startedAt, slideSeconds);
    }

    /**
     * role 节点的生成动画：扇入完成后，**0.7s 内从静止位上方 80px 落回静止位、同时淡入**
     * （需求 2026-10-15 row11）。
     *
     * 透明度走 `Sprite.color` 的 alpha 而不是给角色节点加 `UIOpacity`：这条链上
     * `renderContent` 只写 `spriteFrame` / `enabled`、从不碰 `color`，互不干扰；
     * 而加组件要改 prefab 序列化（编辑器一存就可能被覆盖掉）。
     */
    private renderRoleGenerate(elapsedSeconds: number, slideSeconds: number): void {
        const sprite = this.roleSprite;
        if (!sprite) return;
        const ease = legendRoleEase(legendRoleProgress(elapsedSeconds, slideSeconds));
        // ⚠️ 先取静止位、再写 y：取的时候节点上还是 prefab 的原值（第一次调到这一步时）。
        if (this.roleRestY === null) this.roleRestY = sprite.node.position.y;
        const y = this.roleRestY + LEGEND_ROLE_DROP_Y * (1 - ease);
        if (Math.abs(sprite.node.position.y - y) > 0.01) {
            sprite.node.setPosition(sprite.node.position.x, y, sprite.node.position.z);
        }
        const opacity = Math.round(255 * ease);
        if (opacity === this.appliedRoleOpacity) return;
        this.appliedRoleOpacity = opacity;
        this.roleColorScratch.a = opacity;
        sprite.color = this.roleColorScratch;
    }

    /**
     * 横幅当前应占的宽度 = **屏幕宽度**。
     *
     * 用户 2026-10-19 反馈：「传说牌弹出的 UI 提示应该对齐屏幕的宽度」——
     * 之前是固定 720（设计稿宽），且底板在 prefab 里整体左移 62.6 ⇒ 左边贴边、右边空一截。
     * `setLayout` 已把非法值兜成设计稿宽，这里直接用；单独抽一个方法是为了让
     * 「滑入起点」和「实际尺寸」读同一个数（两处各写一个 720 迟早对不上）。
     */
    private bannerWidth(): number {
        return this.viewWidth > 0 ? this.viewWidth : DESIGN_WIDTH;
    }

    /**
     * 把宽 / 高落到节点上：**根节点与底板同时铺满屏幕宽度**，立绘等其他子节点保持原尺寸。
     *
     * 🔴 底板必须跟着改宽：底图是 `_sizeMode = CUSTOM` 的 720×417 图，只改根不改底板的话
     * 图片仍是 720 宽、右边留一条缝 —— 那正是本次反馈的画面。
     * 🔴 底板必须回到 `x = 0`：它曾在 prefab 里被整体左移 62.6（连同标题 / 头像 / 卡名）。
     * prefab 已改回设计位，这里再兜一次，免得哪天又被挪回去。
     *
     * 跳过重复写入：`render` 每帧都调，`setContentSize` 会置引擎变换脏标记。
     */
    private applyLayout(): void {
        const width = this.bannerWidth();
        const height = bannerHeightOf(this.viewHeight, this.playerCount);
        if (Math.abs(width - this.appliedWidth) < 0.5 && Math.abs(height - this.appliedHeight) < 0.5) return;
        this.appliedWidth = width;
        this.appliedHeight = height;
        // 根节点是**布局格子**：高 = 屏高 / 人数，落位（`layoutYOf`）按它算。
        this.writeSize(this.node, width, height);
        const plate = this.bannerSprite?.node;
        if (!plate) return;
        // 🔴 底板只跟着**改宽**，高度必须保持 prefab 的 417：
        // 「格子高」是多人分屏用的，2 人局是 640 —— 把底板也拉到 640，横幅会平白长高一截、
        // 底边掉到屏幕中间去（2026-10-19 反馈「横幅底部的高度被修改了」就是这个）。
        if (this.plateHeight === null) {
            const transform = plate.getComponent(UITransform);
            this.plateHeight = transform ? transform.contentSize.height : BANNER_HEIGHT;
        }
        this.writeSize(plate, width, this.plateHeight);
        if (Math.abs(plate.position.x - BANNER_X) > 0.01) {
            plate.setPosition(BANNER_X, plate.position.y, plate.position.z);
        }
    }

    /** 写 `UITransform.contentSize`；取不到组件就跳过（测试桩 / prefab 损坏都不该抛）。 */
    private writeSize(node: Node | null, width: number, height: number): void {
        const transform = node?.getComponent(UITransform);
        if (transform) transform.setContentSize(width, height);
    }

    /** 底板 / 环 / 立绘 / 头像 / 卡名只在换卡时写一次；每帧只动位置与透明度。 */
    private renderContent(reveal: Readonly<ZCCardReveal>): void {
        const key = `${reveal.cardId}|${reveal.owner}|${reveal.cardName}|${reveal.unitId ?? ''}`;
        if (key === this.contentKey) return;
        this.contentKey = key;
        this.setSprite(this.bannerSprite, this.bannerFor(reveal.owner));
        this.setSprite(this.ringSprite, this.ringFor(reveal.owner));
        this.setSprite(this.roleSprite, this.artResolver?.(reveal) ?? null);
        this.setSprite(this.headSprite, this.portraitResolver?.(reveal.owner) ?? null);
        if (this.nameLabel.string !== reveal.cardName) this.nameLabel.string = reveal.cardName;
    }

    private alphaOf(progress: number): number {
        const fadeIn = Math.min(1, progress / ZCGameLegendBannerView.FADE_IN_PROGRESS);
        const fadeOut = progress <= ZCGameLegendBannerView.FADE_START_PROGRESS
            ? 1
            : Math.max(0, 1 - (progress - ZCGameLegendBannerView.FADE_START_PROGRESS) / (1 - ZCGameLegendBannerView.FADE_START_PROGRESS));
        return fadeIn * fadeOut;
    }

    /**
     * 四色底板。设计稿给的是四张固定底图，与工程里 `ZC_CLIENT_COLORS` 的四个玩家色一一对应：
     * 蓝（`player` #7e82ff ↔ legend_banner_02 蓝）、红（`enemy` ↦ 01）、
     * 黄（`enemy2` ↦ 04）、紫（`enemy3` ↦ 03）—— 按**色相**对齐而不是按设计稿组序，
     * 因为设计稿的组序（红蓝紫黄）与 `ZC_OWNER_ORDER`（我/2/3/4）不同。
     */
    private bannerFor(owner: ZCOwner): SpriteFrame | null {
        switch (owner) {
            case ZCOwner.Player: return this.bannerPlayer;
            case ZCOwner.Enemy: return this.bannerEnemy;
            case ZCOwner.Enemy2: return this.bannerEnemy2;
            default: return this.bannerEnemy3;
        }
    }

    private ringFor(owner: ZCOwner): SpriteFrame | null {
        switch (owner) {
            case ZCOwner.Player: return this.ringPlayer;
            case ZCOwner.Enemy: return this.ringEnemy;
            case ZCOwner.Enemy2: return this.ringEnemy2;
            default: return this.ringEnemy3;
        }
    }

    /**
     *  `enabled` 必须**绝对赋值**：横幅节点来自对象池（`ZCNodePool.release` 只置
     * `active = false`，实例状态全部保留）。上一次淡出到底若把某个子 Sprite 的 `enabled`
     * 置成 false，复用回来的同一节点就再也显示不出来 —— 症状是「横幅时有时无」。
     */
    private setSprite(sprite: Sprite, frame: SpriteFrame | null): void {
        if (sprite.spriteFrame !== frame) sprite.spriteFrame = frame;
        sprite.enabled = frame !== null;
    }
}
