import { Color, instantiate, Label, Node, Prefab, sp, Sprite, UITransform } from 'cc';
import type { SpriteFrame } from 'cc';
import {
    zcSkillAnnounceAnimationOf,
    zcSkillAnnounceArtWidth,
    zcSkillAnnounceGlowScale,
    zcSkillAnnounceOpacity,
    zcSkillAnnouncePopScale,
    ZC_SKILL_ANNOUNCE_ART_HEIGHT,
} from '../model/ZCSkillAnnounceStyle';
import { ZCSkillAnnounceView } from './ZCSkillAnnounceView';

/**
 * 大招通报（传说卡本局第一次放主动技能）的预制体实例化与帧刷新。
 *
 * 结构、字体、描边、位置与底光骨架均由 `大招技能提示特效.prefab` 声明并通过
 * `ZCSkillAnnounceView` 绑定；运行时只注入卡面帧、技能名与入场/淡出曲线。
 */

export interface IZCSkillAnnounceNode {
    readonly cardId: string;
    readonly root: Node;
    readonly head: Sprite;
    readonly label: Label;
    readonly spine: sp.Skeleton | null;
    readonly headHeight: number;
    lastScale: number;
    lastAlpha: number;
}

/** 递归写层：`new` / `instantiate` 后的子节点层位必须与宿主层一致，否则 UI 相机静默剔除。 */
function applyLayerRecursive(node: Node, layer: number): void {
    node.layer = layer;
    for (const child of node.children) {
        applyLayerRecursive(child, layer);
    }
}

/** 按卡面原图比例调整形象与根节点宽度，高度沿用 prefab 声明值。 */
function applyHeadFrame(node: IZCSkillAnnounceNode, frame: SpriteFrame | null): void {
    const artWidth = zcSkillAnnounceArtWidth(frame, node.headHeight);
    node.head.spriteFrame = frame;
    const headTransform = node.head.getComponent(UITransform);
    if (headTransform) headTransform.setContentSize(artWidth, node.headHeight);
    const rootTransform = node.root.getComponent(UITransform);
    if (rootTransform) rootTransform.setContentSize(Math.max(artWidth, 1), rootTransform.height);
}

/**
 * 实例化大招通报预制体并注入运行时卡面与技能名。
 */
export function createZCSkillAnnounceNode(
    prefab: Prefab,
    cardId: string,
    skillName: string,
    frame: SpriteFrame | null,
    layer: number,
): IZCSkillAnnounceNode {
    const root = instantiate(prefab);
    applyLayerRecursive(root, layer);

    const view = root.getComponent(ZCSkillAnnounceView);
    const head = view.headSprite;
    const label = view.nameLabel;
    const spine = view.glowSpine;
    const headTransform = head.getComponent(UITransform);
    const headHeight = headTransform && headTransform.height > 0
        ? headTransform.height
        : ZC_SKILL_ANNOUNCE_ART_HEIGHT;

    label.string = skillName;
    if (spine && spine.skeletonData) {
        const glowScale = zcSkillAnnounceGlowScale(spine.skeletonData, headHeight);
        spine.node.setScale(glowScale, glowScale, 1);
        const animationName = zcSkillAnnounceAnimationOf(spine.skeletonData);
        if (animationName) spine.setAnimation(0, animationName, spine.loop);
    }

    const node: IZCSkillAnnounceNode = {
        cardId,
        root,
        head,
        label,
        spine,
        headHeight,
        lastScale: -1,
        lastAlpha: -1,
    };
    applyHeadFrame(node, frame);
    return node;
}

/**
 * 卡面帧异步到货后补刷已上屏的通报节点，避免整段 2.3s 只显示文字。
 */
export function refreshZCSkillAnnounceFrame(
    node: IZCSkillAnnounceNode,
    frame: SpriteFrame | null,
): void {
    if (!frame || !node.root.isValid || node.head.spriteFrame === frame) return;
    applyHeadFrame(node, frame);
}

/**
 * 把一帧的进度写到节点上（缩放 + 透明度），中间全显段数值未变时跳过组件赋值。
 */
export function renderZCSkillAnnounce(
    node: IZCSkillAnnounceNode,
    progress: number,
    alphaScratch: Color,
): void {
    const scale = zcSkillAnnouncePopScale(progress);
    if (node.lastScale !== scale) {
        node.lastScale = scale;
        node.root.setScale(scale, scale, 1);
    }
    const alpha = Math.round(255 * zcSkillAnnounceOpacity(progress));
    if (node.lastAlpha !== alpha) {
        node.lastAlpha = alpha;
        alphaScratch.a = alpha;
        node.head.color = alphaScratch;
        node.label.color = alphaScratch;
        if (node.spine) node.spine.color = alphaScratch;
    }
}
