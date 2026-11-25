/**
 * 「获得英雄」全屏展示页（蓝湖 720×1610 → 全屏弹窗）。
 *
 * ## 四段动画（时间轴真源在 `model/HeroObtainLayout.ts`）
 *
 * 1. **入场**：底图淡入 → 放射光放大淡入（同时回正角度）→ 标题从上方落下回弹；
 * 2. **卡片展示**：英雄从下方浮起 + 淡入（Spine 播 idle，影子随骨骼自带）→ 名牌弹入 →
 *    职业徽标 / 名字错峰淡入；
 * 3. **光效与进度**：进度条底淡入 → 填充从左长满 + 数字同步滚动；
 * 4. **收尾**：「点击屏幕继续」淡入 → 落到设计稿静止态（此后不再有常驻动画）。
 *
 * ## 稳定口径（防「飘」）
 *
 *  · 所有位移 / 缩放 / 透明度都从 **`startedAt` + 纯函数**算，视图只写节点，不做累加；
 *  · 动画节点**不挂 `cc.Widget`**（Widget 每帧重排会和 tween/位移互相拉扯 ⇒ 抖动）；
 *  · 整页只有一个 `Stage` 挂 Widget（上下左右居中），设计稿 1610 高在 1280 屏上
 *    上下各溢出 165，不缩放子节点 ⇒ 提示自然落在屏内，也不会出现「某个元素越动越偏」；
 *  · 底图 `Bg` 固定 720×1610、Widget 居中，长宽比不变，短屏上下对称裁切。
 *
 * ## 打开方式
 *
 * ```ts
 * await HeroObtainPage.open({ userData: { heroId: 68005, progressCurrent: 8, progressMax: 53 } });
 * ```
 */
import {
    _decorator,
    Button,
    Label,
    Node,
    Prefab,
    Sprite,
    SpriteFrame,
    UIOpacity,
    Vec3,
} from 'cc';
import { bundleForPath } from '../../../core/asset/BundleCatalog';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import type { PopupOpenContext } from '../../../framework/ui/PopupBase';
import { VIEW_LIFECYCLE } from '../../../framework/ui/ViewLifecycle';
import { HERO_OBTAIN_ARTS, heroObtainArtPathOf, spriteFramePathOf } from '../../ArtPaths';
import { CardUnitPreview } from '../CardUnitPreview';
import { resolveHeroObtainData } from '../HeroObtainData';
import type { IHeroObtainData, IHeroObtainUserData } from '../HeroObtainData';
import {
    heroObtainBarVisualOf,
    heroObtainBgAlphaOf,
    heroObtainCountTextOf,
    heroObtainCountUpOf,
    heroObtainFillRatioOf,
    heroObtainHeroVisualOf,
    heroObtainHintAlphaOf,
    heroObtainNameAlphaOf,
    heroObtainPlateVisualOf,
    heroObtainRaysVisualOf,
    heroObtainTitleVisualOf,
    heroObtainTotalSeconds,
} from '../model/HeroObtainLayout';

const { ccclass, property } = _decorator;

/** 页面固定文案（设计稿）。 */
export const HERO_OBTAIN_TEXTS = {
    hint: '点击屏幕继续',
} as const;

/** 设计稿里英雄立绘高 426 —— Spine 归一化的可见高按它算。 */
const HERO_VISIBLE_HEIGHT = 426;

type ArtFrames = Partial<Record<keyof typeof HERO_OBTAIN_ARTS, SpriteFrame | null>>;

@ccclass('HeroObtainPage')
export class HeroObtainPage extends PopupBase {
    static prefabPath = 'ui/heroObtain/HeroObtain';

    /**
     * 本页自带整套入场编排（底图 / 放射光 / 标题 / 英雄 / 名牌各走各的 `startedAt` 曲线，
     * 见 `heroObtainBgAlphaOf` 等纯函数）。再叠一层整页淡入会变成「页面先半透明 0.24s，
     * 里面的东西才逐个出现」，节奏被拉长一倍，所以关掉全局统一过渡。
     */
    motionEnabled = false;

    @property({ type: Node, tooltip: '缩放舞台（锚点 0.5/1，屏高不足 1610 时整体缩）' })
    stage: Node = null!;

    @property({ type: UIOpacity, tooltip: '全屏底图透明度（入场淡入）' })
    bgOpacity: UIOpacity = null!;

    @property({ type: Node, tooltip: '放射光节点（缩放 + 角度）' })
    raysNode: Node = null!;

    @property({ type: UIOpacity, tooltip: '放射光透明度' })
    raysOpacity: UIOpacity = null!;

    @property({ type: Node, tooltip: '标题节点（落下位移 + 缩放）' })
    titleNode: Node = null!;

    @property({ type: UIOpacity, tooltip: '标题透明度' })
    titleOpacity: UIOpacity = null!;

    @property({ type: Node, tooltip: '英雄根（浮起 / 缩放；Spine 挂在这里面）' })
    heroRoot: Node = null!;

    @property({ type: UIOpacity, tooltip: '英雄透明度' })
    heroOpacity: UIOpacity = null!;

    @property({ type: Sprite, tooltip: '英雄宿主 Sprite（Spine 失败时显示头图）' })
    heroSprite: Sprite = null!;

    @property({ type: Node, tooltip: '名牌节点（弹入）' })
    plateNode: Node = null!;

    @property({ type: UIOpacity, tooltip: '名牌透明度' })
    plateOpacity: UIOpacity = null!;

    @property({ type: Sprite, tooltip: '职业徽标' })
    badgeSprite: Sprite = null!;

    @property({ type: UIOpacity, tooltip: '职业徽标透明度' })
    badgeOpacity: UIOpacity = null!;

    @property({ type: Label, tooltip: '英雄名（30pt 雅黑 Bold + 2px 黑描边）' })
    nameLabel: Label = null!;

    @property({ type: UIOpacity, tooltip: '英雄名透明度' })
    nameOpacity: UIOpacity = null!;

    @property({ type: Node, tooltip: '碎片进度整行（无进度数据时隐藏）' })
    progressRow: Node = null!;

    @property({ type: UIOpacity, tooltip: '进度条底 / 碎片图标透明度' })
    progressOpacity: UIOpacity = null!;

    @property({ type: Sprite, tooltip: '进度条底' })
    barBgSprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '进度填充（FILLED，从左长满）' })
    barFillSprite: Sprite = null!;

    @property({ type: UIOpacity, tooltip: '进度填充透明度' })
    barFillOpacity: UIOpacity = null!;

    @property({ type: Label, tooltip: '进度数字（`current/max`）' })
    countLabel: Label = null!;

    @property({ type: UIOpacity, tooltip: '进度数字透明度' })
    countOpacity: UIOpacity = null!;

    @property({ type: Sprite, tooltip: '碎片图标' })
    shardSprite: Sprite = null!;

    @property({ type: UIOpacity, tooltip: '底部提示透明度' })
    hintOpacity: UIOpacity = null!;

    @property({ type: Label, tooltip: '底部提示「点击屏幕继续」' })
    hintLabel: Label = null!;

    @property({ type: Button, tooltip: '全屏点击（入场期间收尾、静止后关闭）' })
    touchButton: Button = null!;

    /** 入场的时钟（只累加，不回读节点状态）。 */
    private _elapsed = 0;
    private _playing = false;
    private _done = false;
    /** 入场落定后放射光继续自转；关闭 / 重置时熄火（`_done` 被 onClose 占用，不能复用）。 */
    private _raysSpinning = false;
    /** 动画节点的 prefab 初始位置：每帧从它算绝对位置 ⇒ 反复打开也不会越飘越远。 */
    private readonly _basePos = new Map<Node, Vec3>();
    private _progress: { current: number; max: number } | null = null;
    private _preview: CardUnitPreview | null = null;

    protected onInit(): void {
        this.touchButton.node.on(Button.EventType.CLICK, this.onTouch, this);
        this._basePos.set(this.titleNode, this.titleNode.position.clone());
        this._basePos.set(this.heroRoot, this.heroRoot.position.clone());
        this._basePos.set(this.plateNode, this.plateNode.position.clone());
        this._basePos.set(this.raysNode, this.raysNode.position.clone());
    }

    protected async onOpen(userData?: any, context?: PopupOpenContext): Promise<void> {
        // 先报「我在前台」再加载：新手引导层要立刻让位（否则它的遮罩压在这一页上，
        // 「点击屏幕继续」点不动），关掉这一页后再回来接着播。
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'enabled' }, this);
        this.resetState();
        const data = await resolveHeroObtainData((userData ?? {}) as IHeroObtainUserData);
        if (!context || context.cancelled) return;

        const [frames, heroPrefab, badgeFrame, headFrame] = await Promise.all([
            this.loadArtFrames(),
            this.loadUnitPrefab(data.unitPrefabPath),
            this.loadFrame(data.badgePath),
            this.loadFrame(data.headIconPath),
        ]);
        if (!context || context.cancelled) return;

        this.renderStatic(data, frames, badgeFrame, headFrame);
        this.bindHero(heroPrefab, headFrame);
    }

    protected onViewReady(): void {
        this.startReveal();
    }

    protected onClose(): void {
        this._playing = false;
        this._done = true;
        this._raysSpinning = false;
        this._preview?.clear();
        this._preview = null;
        // 多个橙卡碎片要**逐个**播：关掉这一页之后引导层 / 下一张才轮到。
        EventMgr.instance.emit(VIEW_LIFECYCLE, { phase: 'disabled' }, this);
    }

    /** 入场期间点任意处 = 直接落静止态；静止后 = 关闭。 */
    private onTouch(): void {
        if (!this._done) {
            this.finishReveal();
            return;
        }
        this.closeByButton();
    }

    protected update(dt: number): void {
        // 被别的弹窗盖住时整个时钟停走（掀开时从原处接着转，不跳角度）。
        if (this.isCovered) return;
        if (this._playing) {
            this._elapsed += dt;
            this.applyVisual();
            if (this._elapsed >= heroObtainTotalSeconds()) this.finishReveal();
            return;
        }
        // 入场落定后只剩放射光自转：每帧只写一个角度，不整份重放 `applyVisual`。
        if (!this._raysSpinning) return;
        this._elapsed += dt;
        this.raysNode.angle = heroObtainRaysVisualOf(this._elapsed).angle;
    }

    // 资源

    private async loadArtFrames(): Promise<ArtFrames> {
        const names = Object.keys(HERO_OBTAIN_ARTS) as (keyof typeof HERO_OBTAIN_ARTS)[];
        const entries = await Promise.all(names.map(async (key) => {
            const frame = await this.loadFrame(heroObtainArtPathOf(HERO_OBTAIN_ARTS[key]));
            return [key, frame] as const;
        }));
        const frames: ArtFrames = {};
        for (const [key, frame] of entries) frames[key] = frame;
        return frames;
    }

    private loadFrame(path: string | null | undefined): Promise<SpriteFrame | null> {
        if (!path) return Promise.resolve(null);
        return this.assets.load(spriteFramePathOf(path), SpriteFrame, { bundle: bundleForPath(path) })
            .catch((error: unknown) => {
                console.warn('[HeroObtainPage] 图片加载失败：' + path, error);
                return null;
            });
    }

    private loadUnitPrefab(path: string | null): Promise<Prefab | null> {
        if (!path) return Promise.resolve(null);
        return this.assets.load(path, Prefab, { bundle: bundleForPath(path) })
            .catch((error: unknown) => {
                console.warn('[HeroObtainPage] 英雄预制体加载失败：' + path, error);
                return null;
            });
    }

    // 静态渲染，幂等，全量赋值。

    private resetState(): void {
        this._elapsed = 0;
        this._playing = false;
        this._done = false;
        this._raysSpinning = false;
        this._progress = null;
        this._preview?.clear();
        this._preview = null;
        this.progressRow.active = false;
        this.touchButton.interactable = true;
        // 起手态必须在 `onOpen` 的 await 之前落盘：弹窗节点先于资源加载 active，
        // 否则会露一帧全亮的标题 / 名牌 / 提示条，再缩回去重播 ⇒ 闪一下（看起来就是「飘」）。
        this.applyVisual();
    }

    private renderStatic(
        data: IHeroObtainData,
        frames: ArtFrames,
        badgeFrame: SpriteFrame | null,
        headFrame: SpriteFrame | null,
    ): void {
        this.spriteOf(this.bgOpacity.node).spriteFrame = frames.bg ?? null;
        this.spriteOf(this.raysNode).spriteFrame = frames.rays ?? null;
        this.spriteOf(this.titleNode).spriteFrame = frames.title ?? null;
        this.spriteOf(this.plateNode).spriteFrame = frames.plate ?? null;
        this.shardSprite.spriteFrame = frames.shard ?? null;
        this.barBgSprite.spriteFrame = frames.barBg ?? null;
        this.barFillSprite.spriteFrame = frames.barFill ?? null;

        this.badgeSprite.spriteFrame = badgeFrame;
        this.badgeSprite.node.active = badgeFrame !== null;

        this.heroSprite.spriteFrame = headFrame;
        this.heroSprite.enabled = true;

        this.nameLabel.string = data.name;

        this._progress = data.progress;
        this.progressRow.active = data.progress !== null;
        if (data.progress) {
            this.countLabel.string = heroObtainCountTextOf(0, data.progress.max);
        }
    }

    /** 进度条底不是脚本引用（只在 renderStatic 里写一次，这里按名字取）。 */
    private spriteOf(node: Node): Sprite {
        // 目标节点（Rays/Title/Plate/BarFill）均已核实带 Sprite；没有可回退的第二来源。
        return node.getComponent(Sprite);
    }

    private bindHero(prefab: Prefab | null, headFrame: SpriteFrame | null): void {
        if (!prefab) {
            this.heroSprite.spriteFrame = headFrame;
            return;
        }
        this._preview ??= new CardUnitPreview(this.heroSprite, HERO_VISIBLE_HEIGHT);
        // 体型系数传 1：全屏展示按设计稿 421×426 定尺寸，`pvpCard.prefabSize` 是对局体型，
        // 乘进来会把立绘放大约 1.2 倍、越过名牌与标题之间的留白。
        if (!this._preview.show(prefab, 1)) {
            this.heroSprite.spriteFrame = headFrame;
            return;
        }
        const scope = this.resourceScope;
        scope.defer(() => { this._preview?.clear(); });
    }

    // 入场动画

    private startReveal(): void {
        this._elapsed = 0;
        this._playing = true;
        this._done = false;
        this.applyVisual();
    }

    /** 按当前时钟把所有节点写到对应状态（幂等；`elapsed = 0` 也走这里，避免闪一帧静止态）。 */
    private applyVisual(): void {
        const elapsed = this._elapsed;
        this.bgOpacity.opacity = Math.round(255 * heroObtainBgAlphaOf(elapsed));

        const rays = heroObtainRaysVisualOf(elapsed);
        this.raysOpacity.opacity = Math.round(255 * rays.alpha);
        this.raysNode.setScale(rays.scale, rays.scale, 1);
        this.raysNode.angle = rays.angle;

        const title = heroObtainTitleVisualOf(elapsed);
        this.titleOpacity.opacity = Math.round(255 * title.alpha);
        this.titleNode.setScale(title.scale, title.scale, 1);
        this.placeWithRise(this.titleNode, title.rise);

        const hero = heroObtainHeroVisualOf(elapsed);
        this.heroOpacity.opacity = Math.round(255 * hero.alpha);
        this.heroRoot.setScale(hero.scale, hero.scale, 1);
        this.placeWithRise(this.heroRoot, hero.rise);

        const plate = heroObtainPlateVisualOf(elapsed);
        this.plateOpacity.opacity = Math.round(255 * plate.alpha);
        this.plateNode.setScale(plate.scale, plate.scale, 1);

        const nameAlpha = heroObtainNameAlphaOf(elapsed);
        this.badgeOpacity.opacity = Math.round(255 * nameAlpha);
        this.nameOpacity.opacity = Math.round(255 * nameAlpha);

        const bar = heroObtainBarVisualOf(elapsed);
        this.progressOpacity.opacity = Math.round(255 * bar.bgAlpha);
        this.barFillOpacity.opacity = Math.round(255 * bar.countAlpha);
        const ratio = this._progress ? heroObtainFillRatioOf(this._progress.current, this._progress.max) : 0;
        this.barFillSprite.fillRange = bar.fillRange * ratio;
        this.countOpacity.opacity = Math.round(255 * bar.countAlpha);
        if (this._progress) {
            this.countLabel.string = heroObtainCountUpOf(elapsed, this._progress.current, this._progress.max);
        }

        this.hintOpacity.opacity = Math.round(255 * heroObtainHintAlphaOf(elapsed));
    }

    private placeWithRise(node: Node, rise: number): void {
        const base = this._basePos.get(node);
        if (!base) return;
        node.setPosition(base.x, base.y - rise, base.z);
    }

    /** 直接落到设计稿静止态（跳过 / 播完都走这里）。 */
    private finishReveal(): void {
        if (this._done) return;
        this._done = true;
        this._playing = false;
        this._elapsed = heroObtainTotalSeconds();
        this.applyVisual();
        // 收尾之后仍然要跟时钟：放射光从这一刻开始匀速顺时针转。
        this._raysSpinning = true;
    }
}
