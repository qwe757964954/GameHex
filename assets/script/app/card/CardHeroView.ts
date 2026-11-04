/** 卡牌只展示角色立绘；图未提供时清空，虚拟列表复用不能残留上一张卡。 */
import type { Sprite, SpriteFrame, UITransform } from 'cc';

/** Sprite.SizeMode.RAW；保持 type-only 引用，让展示逻辑可直接做离线行为测试。 */
const RAW_SIZE_MODE = 2;

/** prefab 给定方形展示框，换图后保持相同的可见包围尺寸，支持 390×300 等宽幅画布。 */
export function applyCardHeroArt(hero: Sprite, transform: UITransform, frame: SpriteFrame | null): void {
    hero.enabled = true;
    hero.node.active = true;
    if (!frame) {
        hero.spriteFrame = null;
        return;
    }
    const scale = hero.node.scale;
    // RAW 换图会改写节点宽高；用换图前的显示尺寸恢复设计框，复用时也不会累乘缩放。
    const displaySize = Math.max(transform.width * Math.abs(scale.x), transform.height * Math.abs(scale.y));
    const size = frame.originalSize;
    const factor = displaySize / Math.max(size.width, size.height);
    const scaleZ = scale.z;
    hero.sizeMode = RAW_SIZE_MODE;
    hero.trim = false;
    hero.spriteFrame = frame;
    hero.node.setScale(factor, factor, scaleZ);
}
