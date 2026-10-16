import { _decorator, Animation, Component, instantiate, Node, Prefab, sp, Sprite, UITransform } from 'cc';

const { ccclass } = _decorator;
const SPINE_VISIBLE_HEIGHT_RATIO = 0.97;
const FRAME_VISIBLE_HEIGHT_RATIO = 0.686;
const FRAME_FOOT_FROM_CENTER_Y = 45.7;
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

/** 上阵站台使用对局同一份兵种预制体，脚点对齐在原静态立绘区域底部。 */
export class CardUnitPreview {
    private visual: Node | null = null;
    private prefab: Prefab | null = null;

    constructor(private readonly hero: Sprite, private readonly visibleHeight: number) {}

    show(prefab: Prefab | null): boolean {
        if (!prefab) {
            this.clear();
            return false;
        }
        if (this.prefab === prefab && this.visual?.isValid) {
            this.hero.node.active = true;
            this.hero.enabled = false;
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
        const footY = hostTransform ? -hostTransform.height * hostTransform.anchorY : 0;
        const sourceHeight = skeleton?.skeletonData?.getRuntimeData(true)?.height
            ?? visual.getComponent(UITransform)?.height ?? FRAME_FALLBACK_HEIGHT;
        const visibleRatio = skeleton ? SPINE_VISIBLE_HEIGHT_RATIO : FRAME_VISIBLE_HEIGHT_RATIO;
        const factor = this.visibleHeight / Math.max(1, sourceHeight * visibleRatio);
        const scale = visual.scale;
        visual.setScale(scale.x * factor, scale.y * factor, scale.z);
        visual.setPosition(0, footY + (skeleton ? 0 : FRAME_FOOT_FROM_CENTER_Y * factor), 0);
        this.hero.node.active = true;
        this.hero.enabled = false;
        const player = visual.addComponent(CardUnitPreviewPlayer);
        visual.setParent(this.hero.node);
        player.playIdle();
        this.visual = visual;
        this.prefab = prefab;
        return true;
    }

    clear(): void {
        this.visual?.destroy();
        this.visual = null;
        this.prefab = null;
        if (this.hero?.isValid) this.hero.enabled = true;
    }
}
