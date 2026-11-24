import {
    Color,
    Graphics,
    instantiate,
    Label,
    Node,
    Prefab,
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
    territoryHeroBadgeShineFrame,
    type ITerritoryHeroBadgeItem,
    type ITerritoryHeroBadgeShineFrame,
} from '../territory/model/TerritoryHeroReward';

/**
 * 底栏「英雄 / 卡牌」按钮上方的**碎片进度徽标**（2026-11-10 需求 ③）。
 *
 * 截图口径：左边一颗碎片 icon，右边一条**深灰**圆角槽 + 绿色填充，槽正中央压一行白色
 * `NN%`；icon 与进度条**间隔 2px**，整组摆在按钮图标**上方 10px**（2026-11-22 用户口径）。
 * 播放时填充从该英雄**当前** `owned / need` 长到 100%，长满时一道白光沿绿条横扫一遍，
 * 随后整个 UI 淡出消失。多个英雄**串行**：一个演完（{@link TERRITORY_HERO_BADGE_TOTAL_SECONDS}）
 * 才轮到下一个。
 *
 * 🔴 **只有「本次新达成可升级（碎片 + 经验都满）」才展示**（11-10 用户当场确认、
 *    11-22 再次明确）。11-20 曾加过「本次进度涨了一截就播」的回落通道，
 *    实机变成「每次领奖都弹一个 26%」，已被用户否决并**整条撤掉**；
 *    判定真源仍是 `detectTerritoryHeroBadges`，这里只负责演，不参与判据。
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

/** 徽标 prefab 的 resources 路径。 */
export const HERO_FRAGMENT_BADGE_PREFAB = 'ui/main/HeroFragmentBadge';

/** 槽底：深灰（2026-11-20）。白字百分比压在白槽上会看不见，按截图改成深灰底。 */
const BAR_BG_COLOR = new Color(62, 64, 72, 255);
const BAR_FILL_COLOR = new Color(60, 200, 40, 255);
/** 刷光带宽度（逻辑 px），比槽高略窄地横扫，避免硬直角溢出圆角。 */
const BADGE_SHINE_WIDTH = 26;

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
    /** 百分比数字来自 prefab；prefab 被外部回滚时软降级为「只有进度条」，不抛错。 */
    private readonly percentLabel: Label | null;
    /** 每帧只改 `.a`，不在 step 里 new Color。 */
    private readonly shineColor = new Color(255, 255, 255, 0);
    /** 全部版面值来自 prefab：根尺寸、进度条左缘/宽/高、距图标顶边的间隔。 */
    private readonly barLeft: number;
    private readonly barWidth: number;
    private readonly barHeight: number;
    private readonly lift: number;

    private readonly queue: IHeroBadgeQueued[] = [];
    private current: IHeroBadgeQueued | null = null;
    /** < 0 = 空闲。 */
    private elapsed = -1;

    constructor(navBar: Node, heroButton: TabButton, prefab: Prefab) {
        this.node = instantiate(prefab);
        this.node.name = prefab.name;
        this.node.layer = navBar.layer;
        this.node.setParent(navBar);
        // 🔴 底栏子节点顺序 = 渲染序：徽标必须压在七格按钮之上。
        this.node.setSiblingIndex(navBar.children.length - 1);
        this.opacity = this.node.getComponent(UIOpacity);
        this.node.active = false;

        const rootTransform = this.node.getComponent(UITransform);
        const barNode = this.childNode('BadgeBarBg');
        this.barBg = barNode.getComponent(Graphics);
        const fillNode = this.childNode('BadgeBarFill');
        this.barFill = fillNode.getComponent(Graphics);
        const barTransform = barNode.getComponent(UITransform);
        this.barWidth = barTransform.width;
        this.barHeight = barTransform.height;
        this.barLeft = barNode.position.x - this.barWidth / 2;

        const iconNode = this.childNode('BadgeIcon');
        this.iconSprite = iconNode.getComponent(Sprite);
        this.iconSprite.trim = false;
        this.iconSprite.sizeMode = Sprite.SizeMode.CUSTOM;
        this.lift = this.childNode('LiftAnchor').position.y;
        const percentNode = this.node.getChildByName('BadgePercent');
        this.percentLabel = percentNode ? percentNode.getComponent(Label) : null;

        this.placeAboveHeroButton(navBar, heroButton, rootTransform);
    }

    private childNode(name: string): Node {
        const found = this.node.getChildByName(name);
        if (!found) throw new Error(`HeroFragmentBadge.prefab 缺少节点 ${name}`);
        return found;
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
        // 每一场都是「本次新达成」⇒ 一定长满到 100%，长满那一刻起刷光。
        this.apply(fx.progress, fx.opacity, territoryHeroBadgeShineFrame(this.elapsed));
    }

    /** 换页 / 页面销毁：立刻收起，队列清空（纯表现，不碰任何业务状态）。 */
    dispose(): void {
        this.current = null;
        this.elapsed = -1;
        this.queue.length = 0;
        // 与 `BigMapPlayerLevelPanel.dispose()` 同口径：节点可能已被父级连带销毁，
        // 对已销毁节点再写 `active` / 再 `destroy()` 会打「destroy twice」。
        if (!this.node?.isValid) return;
        this.node.active = false;
        this.node.destroy();
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
        this.apply(territoryHeroBadgeFrame(next.item.from, 0)?.progress ?? 0, 1, null);
    }

    /**
     * 全量写这一帧：两条 Graphics 清掉重画，百分比读写 Label，整体透明度交给根 `UIOpacity`。
     *
     * 刷光**不新建节点**：在 `barFill` 画完绿填充后，用同一支 Graphics 再叠一条白色半透明
     * 光带（位置 / 透明度全来自 `territoryHeroBadgeShineFrame`）。增长段 `shine` 为 `null`，
     * 长满到 100% 后才开始横扫 —— 徽标只在「新达成」时演，所以每场都会走到这一段。
     */
    private apply(progress: number, alpha: number, shine: ITerritoryHeroBadgeShineFrame | null): void {
        const left = this.barLeft;
        const width = this.barWidth;
        const half = this.barHeight / 2;
        const radius = half;
        const ratio = Math.max(0, Math.min(1, progress));

        this.barBg.clear();
        this.barBg.fillColor = BAR_BG_COLOR;
        this.barBg.roundRect(left, -half, width, this.barHeight, radius);
        this.barBg.fill();

        this.barFill.clear();
        const filled = ratio * width;
        if (filled > 0) {
            this.barFill.fillColor = BAR_FILL_COLOR;
            // 填充太窄时半径跟着收，否则圆角会鼓出槽的左端。
            this.barFill.roundRect(left, -half, filled, this.barHeight,
                Math.min(radius, filled / 2));
            this.barFill.fill();
            if (shine && shine.opacity > 0 && filled > 2) {
                const center = left + shine.offset * filled;
                const x0 = Math.max(left, center - BADGE_SHINE_WIDTH / 2);
                const x1 = Math.min(left + filled, center + BADGE_SHINE_WIDTH / 2);
                if (x1 > x0) {
                    this.shineColor.a = Math.round(200 * shine.opacity);
                    this.barFill.fillColor = this.shineColor;
                    this.barFill.rect(x0, -half + 1, x1 - x0, this.barHeight - 2);
                    this.barFill.fill();
                }
            }
        }
        const text = `${Math.round(ratio * 100)}%`;
        if (this.percentLabel && this.percentLabel.string !== text) this.percentLabel.string = text;
        const value = Math.max(0, Math.min(255, Math.round(alpha * 255)));
        if (this.opacity.opacity !== value) this.opacity.opacity = value;
    }

    /**
     * 摆在底部菜单栏「英雄 / 卡牌」按钮图标**正上方 10px**（2026-11-22 用户口径）。
     *
     * 🔴 旧写法是「图标中心 + 固定 58」：图标是 RAW Sprite，尺寸由 `spriteFrame` 回写，
     *    实际高度远大于徽标的 44 ⇒ 徽标被压在卡牌图标中间（11-22 截图里就压在「英雄」
     *    卡片上）。现在按**图标顶边的世界坐标**算：徽标底边 = 图标顶边 + `LiftAnchor.y`
     *    （= 10px），徽标中心 = 底边 + 自身半高。
     *    顶边与中心都走 `convertToWorldSpaceAR` / `convertToNodeSpaceAR`，把图标节点的
     *    scale 一起算进去，不自己猜截图高度；徽标根节点 scale 恒为 1。
     */
    private placeAboveHeroButton(navBar: Node, heroButton: TabButton, rootTransform: UITransform): void {
        const icon = heroButton.icon;
        const iconTransform = icon?.isValid ? icon.node.getComponent(UITransform) : null;
        const navTransform = navBar.getComponent(UITransform);
        if (!iconTransform || !navTransform || rootTransform.height <= 0) return;
        const iconCenter = iconTransform.convertToWorldSpaceAR(new Vec3(0, 0, 0), new Vec3());
        const iconTop = iconTransform.convertToWorldSpaceAR(
            new Vec3(0, iconTransform.height / 2, 0), new Vec3());
        const center = navTransform.convertToNodeSpaceAR(iconCenter, new Vec3());
        const top = navTransform.convertToNodeSpaceAR(iconTop, new Vec3());
        this.node.setPosition(center.x, top.y + this.lift + rootTransform.height / 2, 0);
    }
}
