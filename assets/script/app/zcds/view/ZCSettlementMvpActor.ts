import { _decorator, Component, instantiate, Node, Prefab, sp, UITransform } from 'cc';
import { cardPreviewFactor } from '../../card/CardPreviewScale';
import { ZC_SETTLEMENT_STYLE } from '../model/ZCSettlementStyle';
import { measureSpineArtBounds, type ISpineArtBounds, type ISpineArtSkeleton } from './ZCSpineArtBounds';

const { ccclass } = _decorator;
const SPINE_NODE_NAME = ZC_SETTLEMENT_STYLE.mvpArt.spineNodeName;
const UNIT_IDLE_ANIMATION = ZC_SETTLEMENT_STYLE.mvpArt.idleAnimation;
const SPINE_VISIBLE_HEIGHT_RATIO = ZC_SETTLEMENT_STYLE.mvpArt.canvasFallbackRatio;
const MVP_ART_HEIGHT_RATIO = ZC_SETTLEMENT_STYLE.mvpArt.artHeightRatio;

/** 骨骼待机：等骨架完成 onLoad 后再起播，避免首次 `setAnimation` 打在未就绪的骨架上。*/
@ccclass('ZCSettlementMvpActorPlayer')
class ZCSettlementMvpActorPlayer extends Component {
    protected start(): void {
        this.playIdle();
    }

    playIdle(): void {
        // 只挂到已核实的 `spine` 子节点上，节点必带 sp.Skeleton。
        this.node.getComponent(sp.Skeleton).setAnimation(0, UNIT_IDLE_ANIMATION, true);
    }
}

/**
 * 结算页 MVP 立绘位：把「本局输出最高的卡」的骨骼模型摆进 `MvpActor` 宿主节点播 `idle`。
 *
 * 与对局内兵种同一个 prefab 契约（36 套单位都是「根节点 + 子节点 `spine`」+ `idle`），
 * 高度按 **idle 首帧美术包围盒** 归一（设计稿 288 可见高 / 265 宿主高），再乘
 * `pvpCard.prefabSize` 的体型系数；脚点用包围盒 `minY` 对齐宿主底边，影子不会压出框。
 * 宿主持久、每局只换模型 —— 换数据时 `clear()` 掉上一只，不重建宿主。
 *
 * 不复用 `app/card/CardUnitPreview`：那个绑定 `Hero` 的 `cc.Sprite` 且会 `enabled=false`，
 * 结算立绘位是裸 `Node`（不带 Sprite），跨 feature 借用运行期组件也会破坏分层。
*/
export class ZCSettlementMvpActor {
    private visual: Node | null = null;
    private prefab: Prefab | null = null;
    /** 角色 idle 首帧的可见美术高（不是骨架 canvas 高）；NaN = 尚未建立模型。*/
    private artHeight = Number.NaN;
    /** 角色包围盒最低点（骨架本地坐标）；用于把影子/脚底压到宿主底边。*/
    private artMinY = 0;
    /** 模型脚点在宿主坐标系里的 Y。*/
    private footY = 0;
    private hostScale = 1;
    /** prefab 自带缩放：必须存原值，节点上那个已是「乘过系数」的。*/
    private readonly assetScale = { x: 1, y: 1, z: 1 };
    /** 已写入的体型系数；NaN = 还没写。*/
    private appliedSize = Number.NaN;

    constructor(private readonly host: Node) {}

    /** 换成 `prefab` 的骨骼模型；同 prefab 重复调用只按新系数重写缩放。*/
    show(prefab: Prefab | null, prefabSize = 1): boolean {
        if (!prefab) {
            this.clear();
            return false;
        }
        if (this.prefab === prefab && this.visual && this.visual.isValid) {
            this.applySize(prefabSize);
            return true;
        }
        this.clear();
        const visual = instantiate(prefab);
        const spineNode = visual.getChildByName(SPINE_NODE_NAME);
        if (!spineNode) {
            visual.destroy();
            throw new Error(`ZCSettlementMvpActor：prefab「${prefab.name}」缺少固定子节点 ${SPINE_NODE_NAME}`);
        }
        const skeleton = spineNode.getComponent(sp.Skeleton);
        if (!skeleton) {
            visual.destroy();
            throw new Error(`ZCSettlementMvpActor：prefab「${prefab.name}」的 ${SPINE_NODE_NAME} 节点缺少 sp.Skeleton`);
        }
        const skeletonData = skeleton.skeletonData;
        if (!skeletonData) {
            visual.destroy();
            throw new Error(`ZCSettlementMvpActor：prefab「${prefab.name}」的 sp.Skeleton 未绑定 SkeletonData`);
        }
        const runtime = skeletonData.getRuntimeData(true);
        const animations = runtime.animations;
        if (!(runtime.height > 0) || !animations.some((clip) => clip.name === UNIT_IDLE_ANIMATION)) {
            visual.destroy();
            throw new Error(`ZCSettlementMvpActor：prefab「${prefab.name}」动画契约不符`
                + `（canvas=${runtime.height}，动画=${animations.map((clip) => clip.name).join('/') || '空'}，需要 ${UNIT_IDLE_ANIMATION}）`);
        }

        const hostTransform = this.host.getComponent(UITransform);
        if (!hostTransform) {
            visual.destroy();
            throw new Error('ZCSettlementMvpActor：MvpActor 宿主缺少 UITransform（prefab 必须带）');
        }
        this.footY = -hostTransform.height * hostTransform.anchorY;
        const art = this.measureArt(runtime);
        this.artHeight = art ? art.height : runtime.height * SPINE_VISIBLE_HEIGHT_RATIO;
        this.artMinY = art ? art.minY : 0;
        this.hostScale = Math.abs(this.host.scale.y);
        const scale = visual.scale;
        this.assetScale.x = scale.x;
        this.assetScale.y = scale.y;
        this.assetScale.z = scale.z;

        const player = spineNode.addComponent(ZCSettlementMvpActorPlayer);
        this.host.active = true;
        visual.setParent(this.host);
        this.visual = visual;
        this.prefab = prefab;
        this.appliedSize = Number.NaN;
        this.applySize(prefabSize);
        player.playIdle();
        return true;
    }

    clear(): void {
        if (this.visual) this.visual.destroy();
        this.visual = null;
        this.prefab = null;
        this.appliedSize = Number.NaN;
        this.artHeight = Number.NaN;
        this.artMinY = 0;
    }

    /**
     * 量 idle 首帧的可见包围盒（骨架本地坐标）。
     * `SkeletonData.height` 是 canvas，磁电菇 canvas 1798，setup pose 还会算进
     * `sg*` 闪光件（1772）；idle 首帧只留下角色本体 772×980，才是画面真实占地。
     * 运行时骨架已经带动画状态，另起一个探针不动正在播放的 idle。
     */
    private measureArt(runtimeData: sp.spine.SkeletonData): ISpineArtBounds | null {
        const instance = new sp.spine.SkeletonInstance();
        try {
            const probe = instance.initSkeleton(runtimeData) as sp.spine.Skeleton;
            if (runtimeData.defaultSkin) probe.setSkin(runtimeData.defaultSkin);
            if (!instance.setAnimation(0, UNIT_IDLE_ANIMATION, true)) return null;
            instance.updateAnimation(0);
            probe.updateWorldTransform();
            return measureSpineArtBounds(probe as unknown as ISpineArtSkeleton);
        } catch {
            return null;
        } finally {
            instance.destroy();
        }
    }

    /** 「归一 × 体型」写进模型节点；系数没变就跳过（`setScale` 会置脏）。*/
    private applySize(prefabSize: number): void {
        const visual = this.visual;
        if (!visual || prefabSize === this.appliedSize) return;
        this.appliedSize = prefabSize;
        const factor = cardPreviewFactor(
            this.host.getComponent(UITransform).height * MVP_ART_HEIGHT_RATIO, prefabSize,
            this.artHeight, 1, this.hostScale);
        visual.setScale(this.assetScale.x * factor, this.assetScale.y * factor, this.assetScale.z * factor);
        // 包围盒最低点（影子/脚底）落在立绘底边；骨架原点不一定在脚底，不能直接贴原点。
        visual.setPosition(0, this.footY - this.artMinY * factor * this.assetScale.y, 0);
    }
}
