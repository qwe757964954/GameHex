import { _decorator, Color, Component, instantiate, Material, Node, Prefab, sp, Sprite, UIOpacity, UITransform } from 'cc';
import { CardGlowSync } from './CardGlowSync';
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
 * 发光副本相对本体的放大倍数。
 *
 * 2026-11-24：升级弹窗要「角色本体叠加一层发光颜色」。副本与本体同形状 ⇒ 大出来的这一圈
 * 就是角色外缘的辉光（≈ 角色高 426 × 3.5% ≈ 15px 的环形光）。
 * 再大就不像「本体在发光」而像「身后站了个大一圈的影子」。
 */
const GLOW_COPY_SCALE = 1.035;

/**
 * 上阵站台使用对局同一份兵种预制体，脚点对齐在立绘区域底部。
 * 先按画布高度归一，再乘 pvpCard.prefabSize；顺序反了会把策划的体型意图抵消。
 * 大于 1 的兵允许高过站台，这是刻意的体型表达，不要加 clamp。
 */
export class CardUnitPreview {
    private visual: Node | null = null;
    private prefab: Prefab | null = null;
    /** 发光副本（与美术同 prefab、同缩放，排在美术后一格）与它的骨架/透明度。 */
    private glowNode: Node | null = null;
    private glowSkeleton: sp.Skeleton | null = null;
    private glowOpacity: UIOpacity | null = null;
    private glowMaterial: Material | null = null;
    private visualSkeleton: sp.Skeleton | null = null;
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
        this.visualSkeleton = skeleton;
        this.prefab = prefab;
        this.appliedSize = Number.NaN;
        this.applySize(prefabSize);
        player.playIdle();
        return true;
    }

    clear(): void {
        this.clearGlow();
        this.visual?.destroy();
        this.visual = null;
        this.visualSkeleton = null;
        this.prefab = null;
        this.appliedSize = Number.NaN;
        this.sourceHeight = Number.NaN;
        if (this.hero.isValid) this.hero.enabled = true;
    }

    // ============================================================
    // 发光副本（角色本体叠一层发光颜色）
    // ============================================================

    /**
     * 建一层「整只角色形状」的发光副本：**同一份 prefab 的第二个实例**，同缩放、同一拍 idle，
     * 挂 `shaders/unit-outline-copy`（只采样 alpha、输出顶点色）⇒ 顶点色 = 纯色剪影。
     *
     * 2026-11-24 用户口径：「角色本体叠加一层发光颜色，颜色依旧使用与进度相似的白色或绿黄色」。
     * 为什么不是「给骨架本身染个色」：spine 的顶点色是**乘**在原色上的，只能压暗、永远亮不起来；
     * 要「亮起来」只能另起一层纯色剪影盖在上面（与巡逻宝箱 `ChestWhite` 同一套路）。
     *
     * 材质为空 ⇒ 不建这一层（降级成只有外圈光晕，绝不退化成「一个和本体同色的复制品」）。
     */
    attachGlow(material: Material | null, tint: Readonly<Color>): boolean {
        const visual = this.visual;
        const prefab = this.prefab;
        if (!material || !prefab || !visual || !visual.isValid) {
            this.clearGlow();
            return false;
        }
        if (this.glowNode && this.glowNode.isValid && this.glowNode.parent === this.hero.node) {
            this.syncGlow(material, tint);
            return true;
        }
        const copy = instantiate(prefab);
        const spineNode = copy.getChildByName(SPINE_NODE_NAME);
        const skeleton = spineNode?.getComponent(sp.Skeleton);
        if (!spineNode || !skeleton) {
            copy.destroy();
            return false;
        }
        copy.name = `${copy.name}_Glow`;
        copy.setParent(this.hero.node);
        copy.setSiblingIndex(Math.min(visual.getSiblingIndex() + 1, this.hero.node.children.length - 1));
        // 副本里带着 prefab 自己的 `CardUnitPreviewPlayer`：它在 `start()` 会 `setAnimation('idle')`
        // 从 0 重播。而副本是 `active = false` 建的，`start()` 恰好被推迟到「点亮」那一帧才跑
        // ⇒ 刚抄好的 `trackTime` 立刻被归零，剪影与本体错开一大截（2026-11-25 截图：白斑飘在脸右侧）。
        // 副本的动画从这里开始只由 `CardGlowSync` 管，不许有第二个起播者。
        const autoPlay = spineNode.getComponent(CardUnitPreviewPlayer);
        if (autoPlay) autoPlay.destroy();
        skeleton.customMaterial = material;
        // 与 `ZCUnitView.attachOutlineCopy` 同口径：shader 按预乘输出，别依赖 prefab 上的勾选。
        skeleton.premultipliedAlpha = true;
        this.glowNode = copy;
        this.glowSkeleton = skeleton;
        this.glowOpacity = copy.addComponent(UIOpacity);
        this.glowOpacity.opacity = 0;
        copy.active = false;
        this.syncGlowTransform();
        this.syncGlow(material, tint);
        skeleton.addComponent(CardGlowSync).bind(this.visualSkeleton);
        return true;
    }

    /**
     * 写发光层的材质与颜色，并做**第一次**对齐：起播动画段 + 抄本体的播放头。
     *
     * `setAnimation` 会让轨道从头计时，所以这里只能建好时调一次。之后每一帧的跟随由
     * `CardGlowSync.lateUpdate` 负责 —— 副本是晚于本体建出来的（材质异步到），只对齐一次
     * 挡不住后续的漂移，叠在角色上就是重影（2026-11-25 用户：「叠加的白色会歪」）。
     */
    private syncGlow(material: Material, tint: Readonly<Color>): void {
        const skeleton = this.glowSkeleton;
        if (!skeleton || !skeleton.isValid) return;
        if (this.glowMaterial !== material) {
            this.glowMaterial = material;
            skeleton.customMaterial = material;
        }
        skeleton.color = new Color(tint.r, tint.g, tint.b, tint.a);
        // 起播的那一段抄本体的，别写死 `idle`：本体可能已经不是待机（比如刚进场还没切回来）。
        const main = this.visualSkeleton?.getCurrent(0) ?? null;
        const name = main?.animation?.name || UNIT_IDLE_ANIMATION;
        const entry = skeleton.setAnimation(0, name, main ? !!main.loop : true);
        if (main) {
            if (entry) entry.trackTime = main.trackTime;
            skeleton.timeScale = this.visualSkeleton!.timeScale;
        }
    }

    /** 发光层的不透明度（0..1）；0 时整层不参与渲染。 */
    setGlowAlpha(alpha: number): void {
        const node = this.glowNode;
        const opacity = this.glowOpacity;
        if (!node || !node.isValid || !opacity || !opacity.isValid) return;
        const value = alpha > 0 ? (alpha >= 1 ? 1 : alpha) : 0;
        const visible = value > 0.004;
        if (node.active !== visible) node.active = visible;
        const byte = Math.round(255 * value);
        if (opacity.opacity !== byte) opacity.opacity = byte;
    }

    clearGlow(): void {
        if (this.glowNode && this.glowNode.isValid) this.glowNode.destroy();
        this.glowNode = null;
        this.glowSkeleton = null;
        this.glowOpacity = null;
        this.glowMaterial = null;
    }

    /**
     * 发光副本跟住本体的缩放与脚点，并把「放大」从绕脚点改成绕角色中部。
     *
     * 骨架原点烘焙在脚底，直接放大 3.5% ⇒ 头顶白出去一整个 `0.035 × 身高`（426 高的角色约 15px），
     * 脚下一分不多，看起来是「白色在往上飘」。把整体下移半个身高 ×（k-1），放大就变成绕中部，
     * 四周一圈等宽 —— 读成描边辉光，而不是头上一坨白。
     */
    private syncGlowTransform(): void {
        const visual = this.visual;
        const glow = this.glowNode;
        if (!visual || !visual.isValid || !glow || !glow.isValid) return;
        const scale = visual.scale;
        glow.setScale(scale.x * GLOW_COPY_SCALE, scale.y * GLOW_COPY_SCALE, scale.z);
        const halfHeight = this.sourceHeight * Math.abs(scale.y) * 0.5;
        const lift = Number.isFinite(halfHeight) ? halfHeight * (GLOW_COPY_SCALE - 1) : 0;
        glow.setPosition(visual.position.x, visual.position.y - lift, visual.position.z);
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
        // 发光副本跟住本体的缩放与脚点（它可能比美术先建好，那时的系数还是旧的）。
        this.syncGlowTransform();
    }
}
