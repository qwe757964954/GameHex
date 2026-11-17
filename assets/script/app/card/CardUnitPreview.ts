import { _decorator, Component, instantiate, Node, Prefab, sp, Sprite, UITransform } from 'cc';
import { cardPreviewFactor } from './CardPreviewScale';

const { ccclass } = _decorator;
const SPINE_VISIBLE_HEIGHT_RATIO = 0.97;
/**
 * 上阵单位美术 prefab 的固定骨架子节点与待机动画名。
 *
 * 37 套 `resources/skel/**` 中，36 套单位统一为「根节点 + 子节点 `spine`」，
 * SkeletonData 里都是 `idle` / `move` / `attack`；`skel/yueka` 的 Skeleton 挂在根节点、
 * 只有 `animation`，属月卡 UI，不进上阵预览。
 */
const SPINE_NODE_NAME = 'spine';
const UNIT_IDLE_ANIMATION = 'idle';

/** 上阵预览的骨架待机：等骨架完成 onLoad 后再起播，避免首次 `setAnimation` 打在未就绪的骨架上。 */
@ccclass('CardUnitPreviewPlayer')
class CardUnitPreviewPlayer extends Component {
    protected start(): void {
        this.playIdle();
    }

    playIdle(): void {
        // `show` 只把本组件挂到已核实的 `spine` 子节点上，节点上必有 sp.Skeleton。
        this.node.getComponent(sp.Skeleton).setAnimation(0, UNIT_IDLE_ANIMATION, true);
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
    /** 骨架 canvas 高（建节点时读一次，之后只按体型系数重乘，不重建）；NaN = 尚未建立预览。 */
    private sourceHeight = Number.NaN;
    private hostScale = 1;
    /** 美术 prefab 自带的缩放。必须存原值 —— 节点上那个已经是「乘过系数」的，读它会越乘越小。 */
    private readonly assetScale = { x: 1, y: 1, z: 1 };
    /** 模型脚点在宿主（Hero Sprite）坐标系里的 Y。 */
    private footY = 0;
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
        const spineNode = visual.getChildByName(SPINE_NODE_NAME);
        if (!spineNode) {
            visual.destroy();
            throw new Error(`CardUnitPreview：prefab「${prefab.name}」缺少固定子节点 ${SPINE_NODE_NAME}`);
        }
        const skeleton = spineNode.getComponent(sp.Skeleton);
        if (!skeleton) {
            visual.destroy();
            throw new Error(`CardUnitPreview：prefab「${prefab.name}」的 ${SPINE_NODE_NAME} 节点缺少 sp.Skeleton`);
        }
        const skeletonData = skeleton.skeletonData;
        if (!skeletonData) {
            visual.destroy();
            throw new Error(`CardUnitPreview：prefab「${prefab.name}」的 sp.Skeleton 未绑定 SkeletonData`);
        }
        const runtime = skeletonData.getRuntimeData(true);
        const animations = runtime.animations;
        if (!(runtime.height > 0) || !animations.some((clip) => clip.name === UNIT_IDLE_ANIMATION)) {
            visual.destroy();
            throw new Error(`CardUnitPreview：prefab「${prefab.name}」动画契约不符`
                + `（canvas=${runtime.height}，动画=${animations.map((clip) => clip.name).join('/') || '空'}，需要 ${UNIT_IDLE_ANIMATION}）`);
        }

        // Hero 是 Sprite：`UIRenderer` 强制 requireComponent(UITransform)，四类宿主 prefab 也已逐一核实。
        const hostTransform = this.hero.node.getComponent(UITransform);
        this.footY = -hostTransform.height * hostTransform.anchorY;
        this.sourceHeight = runtime.height;
        // 模型挂在立绘节点下；RAW 立绘已归一缩放，模型高度必须抵消宿主缩放。
        this.hostScale = Math.abs(this.hero.node.scale.y);
        const scale = visual.scale;
        this.assetScale.x = scale.x;
        this.assetScale.y = scale.y;
        this.assetScale.z = scale.z;

        this.hero.node.active = true;
        this.hero.enabled = false;
        const player = spineNode.addComponent(CardUnitPreviewPlayer);
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
        this.sourceHeight = Number.NaN;
        if (this.hero.isValid) this.hero.enabled = true;
    }

    /** 把「归一 × 体型」写进美术节点；系数没变就跳过（`setScale` 会置脏）。 */
    private applySize(prefabSize: number): void {
        const visual = this.visual;
        if (!visual || prefabSize === this.appliedSize) return;
        this.appliedSize = prefabSize;
        const factor = cardPreviewFactor(
            this.visibleHeight, prefabSize, this.sourceHeight, SPINE_VISIBLE_HEIGHT_RATIO, this.hostScale);
        visual.setScale(this.assetScale.x * factor, this.assetScale.y * factor, this.assetScale.z * factor);
        // 骨架原点已经烘焙在脚底，直接落在立绘底边。
        visual.setPosition(0, this.footY, 0);
    }
}
