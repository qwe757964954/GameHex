/**
 * 临时探针（2026-11-03）：定位「切进战场首帧后整屏渲染崩」
 * （frame should not be invalid, it may have been released）。
 * 每次资源释放后扫一遍场景，把挂着已释放贴图的 Sprite 按节点路径点名并置空；
 * Batcher2D 会跳过空帧，这一屏就能继续画，不整屏崩。
 * 定位到真正的持有方后，整段连同 CocosAssetService.releaseAfterDraw 里的调用一起删掉。
 */

import { director, Node, Sprite } from 'cc';
import { DEBUG } from 'cc/env';

export interface IDeadSpriteFrame {
    /** 场景内节点路径，可直接在层级面板定位。 */
    readonly path: string;
    /** 已释放贴图的 SpriteFrame.name。 */
    readonly frame: string;
}

/** 找出场景里挂着已释放贴图的 Sprite 并置空；仅调试构建执行。 */
export function findDeadSpriteFrames(limit = 20): IDeadSpriteFrame[] {
    if (!DEBUG) return [];
    const scene = director.getScene();
    if (!scene) return [];
    const hits: IDeadSpriteFrame[] = [];
    const walk = (node: Node): void => {
        if (hits.length >= limit) return;
        const sprite = node.getComponent(Sprite);
        const frame = sprite?.spriteFrame;
        if (sprite && frame && !frame.texture) {
            hits.push({ path: pathOf(node), frame: frame.name || '(unnamed)' });
            // 让渲染器跳过空帧，一张坏图不能拖垮整屏。
            sprite.spriteFrame = null;
        }
        for (const child of node.children) walk(child);
    };
    walk(scene);
    return hits;
}

/** 资源释放后调用：发现坏图点名报出并临时置空。 */
export function reportDeadSpriteFrames(reason: string): void {
    const hits = findDeadSpriteFrames();
    if (!hits.length) return;
    console.error(`[SpriteFrameGuard] ${reason}：${hits.length} 个 Sprite 挂着**已释放**的贴图`
        + '（已临时置空，避免整屏渲染崩；请把下面这些路径发回来定位真正的持有方）\n'
        + hits.map((hit) => `  · ${hit.path} ← ${hit.frame}`).join('\n'));
}

function pathOf(node: Node): string {
    const parts: string[] = [];
    let current: Node | null = node;
    while (current?.isValid && current.parent) {
        parts.unshift(current.name || '(unnamed)');
        current = current.parent;
    }
    return parts.join('/') || '(scene)';
}
