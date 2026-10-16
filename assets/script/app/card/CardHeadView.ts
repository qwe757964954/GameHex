/**
 * 卡牌头像 / Hero 立绘互斥落图。
 * 有头像铺头像、藏立绘；没头像反过来。纯函数，零引擎依赖。
 */
import type { Sprite, SpriteFrame } from 'cc';

export interface CardHeadSlots {
    readonly hero: Sprite;
    readonly headIcon: Sprite;
}

/**
 * @param headFrame null = 退回立绘；heroFrame null = 保留 prefab 现图。
 */
export function applyCardHeadArt(
    slots: CardHeadSlots,
    heroFrame: SpriteFrame | null,
    headFrame: SpriteFrame | null,
): void {
    if (headFrame) {
        slots.headIcon.spriteFrame = headFrame;
        slots.headIcon.node.active = true;
        slots.hero.node.active = false;
        return;
    }
    if (heroFrame) slots.hero.spriteFrame = heroFrame;
    slots.headIcon.node.active = false;
    slots.hero.node.active = true;
}
