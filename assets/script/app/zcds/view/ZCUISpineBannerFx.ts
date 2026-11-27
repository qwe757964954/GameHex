import { instantiate, Node, Prefab, sp, UITransform } from 'cc';
import {
    zcUiBannerCenterOf,
    zcUiBannerClipSecondsOf,
    zcUiBannerTimeScale,
} from '../model/ZCUISpineBannerStyle';

/**
 * 全屏 UI spine 横幅的预制体实例化与生命周期管理（结算胜负 / 对局开始共用）。
 *
 * 骨架、720 屏宽缩放、预乘透明与基准偏移全部由各自 `.prefab` 声明；
 * 运行时只负责实例化、置顶挂到 HUD 根节点、按传入的片段名与总时长起播并在结束时停轨销毁。
 */

export interface IZCUISpineBannerNode {
    readonly root: Node;
    readonly skeleton: sp.Skeleton;
}

export interface IZCUISpineBannerOptions {
    /**
     * 让这段动画正好铺满多少秒（`timeScale = duration / clip`）。
     *
     * 缺省 / `<= 0` = 原速播一遍；结算那条传扫场总时长，好让横幅与地块翻转同起同落。
     */
    readonly durationSeconds?: number;
    /** 中心相对 prefab 基准位置的额外竖直偏移（逻辑 px，正数上移）。*/
    readonly centerY?: number;
    /** 节点名（排障用；缺省保留 prefab 根节点名）。*/
    readonly name?: string;
}

function applyLayerRecursive(node: Node, layer: number): void {
    node.layer = layer;
    for (const child of node.children) {
        applyLayerRecursive(child, layer);
    }
}

/**
 * 实例化一条横幅 prefab 并起播指定动画。
 */
export function createZCUISpineBannerNode(
    prefab: Prefab,
    animation: string,
    parent: Node,
    options: IZCUISpineBannerOptions = {},
): IZCUISpineBannerNode {
    const root = instantiate(prefab);
    if (options.name) root.name = options.name;
    applyLayerRecursive(root, parent.layer);
    root.setParent(parent);
    root.setSiblingIndex(parent.children.length - 1);

    const skeleton = root.getComponent(sp.Skeleton);
    skeleton.timeScale = zcUiBannerTimeScale(
        zcUiBannerClipSecondsOf(skeleton.skeletonData, animation),
        options.durationSeconds ?? 0,
    );
    skeleton.setAnimation(0, animation, skeleton.loop);

    const transform = parent.getComponent(UITransform);
    const basePosition = root.position;
    root.setPosition(
        zcUiBannerCenterOf(transform?.width ?? 0, transform?.anchorX ?? 0.5) + basePosition.x,
        zcUiBannerCenterOf(transform?.height ?? 0, transform?.anchorY ?? 0.5) + basePosition.y + (options.centerY ?? 0),
        basePosition.z,
    );
    return { root, skeleton };
}

/**
 * 收掉横幅：先停播放再销毁节点，避免 destroy 生效前的尾帧继续吃 update。
 */
export function destroyZCUISpineBanner(node: IZCUISpineBannerNode | null): void {
    if (!node) return;
    node.skeleton.clearTracks();
    if (node.root.isValid) node.root.destroy();
}

/** 节点是否还能用（已销毁的引用不能当"还在播"）。 */
export function isZCUISpineBannerAlive(node: IZCUISpineBannerNode | null): boolean {
    return node !== null && node.root.isValid;
}
