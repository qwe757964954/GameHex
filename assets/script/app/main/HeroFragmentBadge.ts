import {
    Color,
    Graphics,
    Node,
    Sprite,
    UIOpacity,
    UITransform,
    Vec3,
    type SpriteFrame,
} from 'cc';
import type { TabButton } from '../common/TabButton';
import {
    TERRITORY_HERO_BADGE_TOTAL_SECONDS,
    sortTerritoryHeroBadges,
    territoryHeroBadgeFrame,
    type ITerritoryHeroBadgeItem,
} from '../territory/model/TerritoryHeroReward';

/**
 * 底栏「英雄」按钮上方的**碎片进度徽标**（2026-11-10 需求 ③）。
 *
 * 截图口径：左边一颗碎片 icon（方框），右边一条白底圆角槽 + 绿色填充；
 * 播放时填充从该英雄**当前** `owned / need` 长到 100%，随后整个 UI 淡出消失。
 * 多个英雄**串行**：一个演完（{@link TERRITORY_HERO_BADGE_TOTAL_SECONDS}）才轮到下一个。
 *
 * ## 为什么是纯表现视图、不是 Component
 *
 * 底栏是 `MainRoot / BottomNav`，与领地页 `Content / ArenaRoot` 平级；徽标由页面
 * （`MainTerritoryMap`）在需要时惰性创建、由它的 `update(dt)` 统一推进。做成 Component 会
 * 让「节点 active=false 时 update 不跑」与「演完要隐藏」互相打架。
 *
 * ## 为什么用 Graphics 而不是 cc.ProgressBar
 *
 * 工程既有口径（见 `RechargeProgressBar` / `BattleTokenProgressBar`）：进度条按**宽度拉伸**，
 * `cc.ProgressBar` 在 `Sprite` 的 RAW/CUSTOM 尺寸模式下会被 prefab 声明的尺寸回写覆盖。
 * 这里每帧 `clear()` + `roundRect()` 重画，与 `TerritoryChestView` 的 Graphics 同一套路。
 */

/** 徽标根节点名（运行时建，不进 prefab）。 */
export const HERO_FRAGMENT_BADGE_NODE = 'HeroFragmentBadge';

/** 整块宽 / 高（设计像素）。 */
export const HERO_FRAGMENT_BADGE_WIDTH = 150;
export const HERO_FRAGMENT_BADGE_HEIGHT = 44;
/** 徽标中心相对英雄按钮图标中心的上抬量。 */
export const HERO_FRAGMENT_BADGE_LIFT_PX = 58;
/** 左侧碎片 icon 边长。 */
export const HERO_FRAGMENT_BADGE_ICON_SIZE = 44;
/** 进度条左缘相对徽标左缘的间距（给 icon 让位）。 */
export const HERO_FRAGMENT_BADGE_BAR_INSET = 50;
/** 进度条高度。 */
export const HERO_FRAGMENT_BADGE_BAR_HEIGHT = 24;

const BAR_BG_COLOR = new Color(255, 255, 255, 255);
const BAR_FILL_COLOR = new Color(60, 200, 40, 255);

interface IHeroBadgeQueued {
    readonly item: ITerritoryHeroBadgeItem;
    readonly frame: SpriteFrame | null;
}

/** 页面异步把碎片图备好后按 `cardId` 传进来；没有图只是空图标，不阻断进度条。 */
export type HeroFragmentBadgeFrames = ReadonlyMap<string, SpriteFrame | null>;

export class HeroFragmentBadge {
    readonly node: Node;

    private readonly barBg: Graphics;
    private readonly barFill: Graphics;
    private readonly iconSprite: Sprite;
    private readonly opacity: UIOpacity;

    private readonly queue: IHeroBadgeQueued[] = [];
    private current: IHeroBadgeQueued | null = null;
    /** < 0 = 空闲。 */
    private elapsed = -1;

    constructor(navBar: Node, heroButton: TabButton) {
        this.node = new Node(HERO_FRAGMENT_BADGE_NODE);
        this.node.layer = navBar.layer;
        this.node.setParent(navBar);
        this.node.addComponent(UITransform).setContentSize(
            HERO_FRAGMENT_BADGE_WIDTH, HERO_FRAGMENT_BADGE_HEIGHT);
        // 🔴 底栏子节点顺序 = 渲染序：徽标必须压在七格按钮之上。
        this.node.setSiblingIndex(navBar.children.length - 1);
        this.opacity = this.node.addComponent(UIOpacity);
        this.node.active = false;

        this.barBg = this.createGraphics('BadgeBarBg');
        this.barFill = this.createGraphics('BadgeBarFill');

        const iconNode = new Node('BadgeIcon');
        iconNode.layer = this.node.layer;
        iconNode.setParent(this.node);
        iconNode.addComponent(UITransform).setContentSize(
            HERO_FRAGMENT_BADGE_ICON_SIZE, HERO_FRAGMENT_BADGE_ICON_SIZE);
        iconNode.setPosition(
            -HERO_FRAGMENT_BADGE_WIDTH / 2 + HERO_FRAGMENT_BADGE_ICON_SIZE / 2, 0, 0);
        this.iconSprite = iconNode.addComponent(Sprite);
        this.iconSprite.trim = false;
        this.iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;

        this.placeAboveHeroButton(navBar, heroButton);
    }

    /**
     * 入队一批「本次新达成」的英雄；已排好优先级的真源是 `sortTerritoryHeroBadges`。
     * 空闲时立刻起播第一个，播完才在 `step` 里出下一个 —— 绝不叠着一起演。
     */
    enqueue(items: readonly ITerritoryHeroBadgeItem[], frames: HeroFragmentBadgeFrames): void {
        for (const item of sortTerritoryHeroBadges(items)) {
            this.queue.push({ item, frame: frames.get(item.cardId) ?? null });
        }
        if (!this.current && this.elapsed < 0) this.startNext();
    }

    /** 每帧推进（由 `MainTerritoryMap.update` 在所有早退之前调用）。 */
    step(dt: number): void {
        if (!this.current) return;
        const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
        this.elapsed += step;
        const fx = territoryHeroBadgeFrame(this.current.item.from, this.elapsed);
        if (!fx) {
            // 这一位演完 ⇒ 同一帧起下一位，中间不留空档；队列空了才真正收起整个 UI。
            this.current = null;
            this.elapsed = -1;
            if (this.queue.length) this.startNext();
            else this.node.active = false;
            return;
        }
        this.apply(fx.progress, fx.opacity);
    }

    /** 换页 / 页面销毁：立刻收起，队列清空（纯表现，不碰任何业务状态）。 */
    dispose(): void {
        this.current = null;
        this.elapsed = -1;
        this.queue.length = 0;
        if (this.node.active) this.node.active = false;
        if (this.node.isValid) this.node.destroy();
    }

    private startNext(): void {
        const next = this.queue.shift();
        if (!next) {
            this.current = null;
            this.elapsed = -1;
            this.node.active = false;
            return;
        }
        this.current = next;
        this.elapsed = 0;
        this.node.active = true;
        if (this.iconSprite.spriteFrame !== next.frame) this.iconSprite.spriteFrame = next.frame;
        this.apply(territoryHeroBadgeFrame(next.item.from, 0)?.progress ?? 0, 1);
    }

    /** 全量写这一帧：两条 Graphics 清掉重画，整体透明度交给根节点的 `UIOpacity`。 */
    private apply(progress: number, alpha: number): void {
        const left = -HERO_FRAGMENT_BADGE_WIDTH / 2 + HERO_FRAGMENT_BADGE_BAR_INSET;
        const width = HERO_FRAGMENT_BADGE_WIDTH - HERO_FRAGMENT_BADGE_BAR_INSET;
        const half = HERO_FRAGMENT_BADGE_BAR_HEIGHT / 2;
        const radius = half;

        this.barBg.clear();
        this.barBg.fillColor = BAR_BG_COLOR;
        this.barBg.roundRect(left, -half, width, HERO_FRAGMENT_BADGE_BAR_HEIGHT, radius);
        this.barBg.fill();

        this.barFill.clear();
        const filled = Math.max(0, Math.min(1, progress)) * width;
        if (filled > 0) {
            this.barFill.fillColor = BAR_FILL_COLOR;
            // 填充太窄时半径跟着收，否则圆角会鼓出槽的左端。
            this.barFill.roundRect(left, -half, filled, HERO_FRAGMENT_BADGE_BAR_HEIGHT,
                Math.min(radius, filled / 2));
            this.barFill.fill();
        }
        const value = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        if (this.opacity.opacity !== value) this.opacity.opacity = value;
    }

    private createGraphics(name: string): Graphics {
        const node = new Node(name);
        node.layer = this.node.layer;
        node.setParent(this.node);
        node.addComponent(UITransform);
        return node.addComponent(Graphics);
    }

    /** 摆在英雄按钮图标正上方（`BottomNav` 局部坐标，走引擎矩阵换算）。 */
    private placeAboveHeroButton(navBar: Node, heroButton: TabButton): void {
        const icon = heroButton.icon;
        const iconTransform = icon?.isValid ? icon.node.getComponent(UITransform) : null;
        const navTransform = navBar.getComponent(UITransform);
        if (!iconTransform || !navTransform) return;
        const world = iconTransform.convertToWorldSpaceAR(new Vec3(0, 0, 0), new Vec3());
        const local = navTransform.convertToNodeSpaceAR(world, new Vec3());
        this.node.setPosition(local.x, local.y + HERO_FRAGMENT_BADGE_LIFT_PX, 0);
    }
}
