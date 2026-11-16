import { _decorator, Animation, Component, instantiate, Node, Prefab, sp, Sprite, UITransform } from 'cc';
import { cardPreviewFactor, FRAME_FOOT_FROM_CENTER_Y } from './CardPreviewScale';

const { ccclass } = _decorator;
const SPINE_VISIBLE_HEIGHT_RATIO = 0.97;
const FRAME_VISIBLE_HEIGHT_RATIO = 0.686;
const FRAME_FALLBACK_HEIGHT = 98;

/** 部分 Spine 预制体默认动作不是 idle，等骨架完成 onLoad 后再强制切回待机。 */
@ccclass('CardUnitPreviewPlayer')
class CardUnitPreviewPlayer extends Component {
    protected start(): void {
        this.playIdle();
    }

    playIdle(): void {
        const skeleton = this.node.getComponent(sp.Skeleton) ?? this.node.getComponentInChildren(sp.Skeleton);
        if (skeleton) {
            skeleton.setAnimation(0, 'idle', true);
            return;
        }
        const animation = this.node.getComponent(Animation) ?? this.node.getComponentInChildren(Animation);
        const idle = animation?.clips.find((clip) => clip?.name?.endsWith('-idle'))?.name;
        if (idle) animation?.play(idle);
    }
}

/**
 * 上阵站台使用对局同一份兵种预制体，脚点对齐在立绘区域底部。
 * 先按画布高度归一，再乘 pvpCard.prefabSize；顺序反了会把策划的体型意图抵消。
 * 大于 1 的兵允许高过站台，这是刻意的体型表达，不要加 clamp。
 */
export class CardUnitPreview {
    private visual: Node | null = null;
    private prefab: Prefab | null = null;
    /** 这份美术的归一口径（建节点时算一次，之后只按体型系数重乘，不重建）。 */
    private sourceHeight = FRAME_FALLBACK_HEIGHT;
    private visibleRatio = FRAME_VISIBLE_HEIGHT_RATIO;
    private hostScale = 1;
    /** 美术 prefab 自带的缩放。必须存原值 —— 节点上那个已经是「乘过系数」的，读它会越乘越小。 */
    private readonly assetScale = { x: 1, y: 1, z: 1 };
    /** 模型脚点在宿主（Hero Sprite）坐标系里的 Y。 */
    private footY = 0;
    /** 这份美术是否 spine（序列帧要另外补一段脚点偏移）。 */
    private skeletonArt = false;
    /** 已写进节点的体型系数；NaN = 还没写（列表刷新会拿同样的入参重复调 `show`）。 */
    private appliedSize = Number.NaN;

    constructor(private readonly hero: Sprite, private readonly visibleHeight: number) {}

    /**
     * prefabSize 是该卡兵种的等比缩放；缺省 1，非法值由 cardPreviewFactor 兜成 1。
     */
    show(prefab: Prefab | null, prefabSize = 1): boolean {
        if (!prefab) {
            this.clear();
            return false;
        }
        if (this.prefab === prefab && this.visual?.isValid) {
            this.hero.node.active = true;
            this.hero.enabled = false;
            // 多张卡可能共用同一份 prefab，而 prefabSize 按卡配，早退也要按新系数重写缩放。
            this.applySize(prefabSize);
            return true;
        }
        this.clear();
        const visual = instantiate(prefab);
        const skeleton = visual.getComponent(sp.Skeleton) ?? visual.getComponentInChildren(sp.Skeleton);
        const animation = skeleton ? null : visual.getComponent(Animation) ?? visual.getComponentInChildren(Animation);
        const idleClip = animation?.clips.find((clip) => clip?.name?.endsWith('-idle'))?.name ?? '';
        const skeletonAnimations = skeleton?.skeletonData?.getRuntimeData(true)?.animations ?? [];
        if (skeleton ? !skeletonAnimations.some((clip) => clip.name === 'idle') : !idleClip) {
            visual.destroy();
            return false;
        }

        const hostTransform = this.hero.node.getComponent(UITransform);
        this.footY = hostTransform ? -hostTransform.height * hostTransform.anchorY : 0;
        this.sourceHeight = skeleton?.skeletonData?.getRuntimeData(true)?.height
            ?? visual.getComponent(UITransform)?.height ?? FRAME_FALLBACK_HEIGHT;
        this.visibleRatio = skeleton ? SPINE_VISIBLE_HEIGHT_RATIO : FRAME_VISIBLE_HEIGHT_RATIO;
        // 模型挂在立绘节点下；RAW 立绘已归一缩放，模型高度必须抵消宿主缩放。
        this.hostScale = Math.abs(this.hero.node.scale.y);
        this.skeletonArt = !!skeleton;
        const scale = visual.scale;
        this.assetScale.x = scale.x;
        this.assetScale.y = scale.y;
        this.assetScale.z = scale.z;

        this.hero.node.active = true;
        this.hero.enabled = false;
        const player = visual.addComponent(CardUnitPreviewPlayer);
        visual.setParent(this.hero.node);
        this.visual = visual;
        this.prefab = prefab;
        this.appliedSize = Number.NaN;
        this.applySize(prefabSize);
        player.playIdle();
        return true;
    }

    clear(): void {
        this.visual?.destroy();
        this.visual = null;
        this.prefab = null;
        this.appliedSize = Number.NaN;
        if (this.hero?.isValid) this.hero.enabled = true;
    }

    /** 把「归一 × 体型」写进美术节点；系数没变就跳过（`setScale` 会置脏）。 */
    private applySize(prefabSize: number): void {
        const visual = this.visual;
        if (!visual || prefabSize === this.appliedSize) return;
        this.appliedSize = prefabSize;
        const factor = cardPreviewFactor(
            this.visibleHeight, prefabSize, this.sourceHeight, this.visibleRatio, this.hostScale);
        visual.setScale(this.assetScale.x * factor, this.assetScale.y * factor, this.assetScale.z * factor);
        // 序列帧美术的原点是画布中心，要额外把脚点抬上去；spine 本身已按脚点烘焙。
        visual.setPosition(0, this.footY + (this.skeletonArt ? 0 : FRAME_FOOT_FROM_CENTER_Y * factor), 0);
    }
}
