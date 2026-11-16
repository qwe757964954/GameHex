/**
 * 好友行头像的加载器，三个行组件共用。
 *
 * 头像加载是异步的，而行会被虚拟列表 clone 复用 —— 同一份节点几帧内可能先后表示
 * 「第 1 行」和「第 5 行」。不加保护的话，第 1 行的头像加载完会落到已经复用成第 5 行的
 * 节点上，界面不报错，只是「谁先加载完谁赢」。两道保护：
 *   1. `appliedId` —— 同一个 id 不重复加载（同一行重渲染也就零成本）；
 *   2. `generation` —— 每次换 id 递增，回调对不上就丢弃（在途的旧结果不许落地）。
 *
 * 取图统一走 `HeadArt.loadHeadFrame`：`CmdFriend.img` 是头像 id，不要自己拼路径
 * （`icon.json` 的目录由包名决定，拼错只会静默留白）。
 */

import { Sprite } from 'cc';
import { HeadArt } from '../HeadArt';

/**
 * 一个头像槽位。
 *
 * 用法是每次渲染都调 `apply(row.avatarId)`（绝对赋值，不是增量）：
 * 空串会清空帧 —— 无头像时只留框，不能留着上一行的图。
 */
export class FriendAvatarLoader {
    /** 当前已生效 / 正在加载的 id。 */
    private appliedId = '';

    /** 递增代号：换 id 后旧的在途结果一律作废。 */
    private generation = 0;

    constructor(private readonly getSprite: () => Sprite | null) {}

    /** 铺一次头像。`avatarId` 空串 = 清空。 */
    apply(avatarId: string): void {
        // 同一个 id 直接返回：既省一次加载，也不会误伤正在路上的那次加载
        // （若先递增 generation 再判等，会把同 id 的在途结果作废 ⇒ 永久留白）
        if (this.appliedId === avatarId) return;
        this.appliedId = avatarId;

        const sprite = this.getSprite();
        if (!sprite || !sprite.isValid) return;
        if (!avatarId) {
            sprite.spriteFrame = null;
            return;
        }

        const generation = ++this.generation;
        const previous = sprite.spriteFrame;
        void HeadArt.loadHeadFrame(avatarId).then((frame) => {
            // 组件已销毁 / 期间又换了 id ⇒ 丢弃
            if (generation !== this.generation) return;
            if (!sprite.isValid) return;
            if (this.appliedId !== avatarId) return;
            if (frame) {
                sprite.spriteFrame = frame;
                return;
            }
            // 加载失败（`HeadArt.loadHeadFrame` 内部已打 warn）：清掉旧帧。
            // 留着上一行的头像就是「串行」，比留白更难查。
            if (previous && sprite.spriteFrame === previous) sprite.spriteFrame = null;
        });
    }

    /** 组件销毁时调（让在途结果作废）。 */
    invalidate(): void {
        this.generation += 1;
        this.appliedId = '';
    }
}
