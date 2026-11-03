/**
 * 🔴 **临时探针（2026-11-03）**：定位「切进战场首帧后整屏渲染崩」
 *
 * > `frame should not be invalid, it may have been released`
 * > `TypeError: Cannot read properties of null (reading 'getGFXTexture')`
 * > @ `SpriteFrame.getGFXTexture` → `Batcher2D.commitComp` → `Sprite._render`
 *
 * 崩溃本身只告诉我们"有一张图被释放了、还有 Sprite 在用它"，**不告诉我们是哪一个**。
 * 而这个工程的帧可能来自七八条不同的加载链（preload 作用域 / 匹配页作用域 / 全局缓存 /
 * 弹窗自持…），靠读代码猜已经猜错一次了。
 *
 * 所以在**每一次资源释放之后**扫一遍场景，把"挂着已释放贴图"的 Sprite 按节点路径点名，
 * 顺便把它置空 —— `Batcher2D` 会跳过空帧，于是这一屏还能继续画，不再整屏崩。
 *
 * 定位完（拿到路径、修掉真正的持有方之后）**整段删掉**，连同
 * `CocosAssetService.releaseAfterDraw` 里那一行调用。
 */

import { director, Node, Sprite } from 'cc';
import { DEBUG } from 'cc/env';

export interface IDeadSpriteFrame {
    /** 场景内路径（`Popup/xxx/Sprite` 这种），直接能在层级里找到它。 */
    readonly path: string;
    /** 那张已经没了的图叫什么（`SpriteFrame.name`）。 */
    readonly frame: string;
}

/** 找（并顺手置空）场景里挂着已释放贴图的 `Sprite`；只在调试构建里跑。 */
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
            // 让渲染器跳过它：一张坏图不该把整屏画到抛异常。
            sprite.spriteFrame = null;
        }
        for (const child of node.children) walk(child);
    };
    walk(scene);
    return hits;
}

/** 释放之后调用：有坏图就点名报出来（并临时置空）。 */
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
