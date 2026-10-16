/**
 * 好友行头像的加载器 —— 三个行组件（`FriendRow` / `FriendApplyRow` / `FriendGetEndRow`）共用。
 *
 * ## 为什么要单独一个类，而不是每行组件里写一遍
 *
 * 头像加载是**异步**的，而行是**虚拟列表 clone 复用**的：同一份节点会在几帧内先后表示
 * 「第 1 行」和「第 5 行」。若不加保护，第 1 行的头像会在加载完成后落到已经复用成第 5 行的
 * 那个节点上 —— 界面**不报错**，只是**头像串行**（谁先加载完谁赢）。这是记忆里
 * 「对象池复用必须绝对赋值」那条规则的异步版本。
 *
 * 保护用两道：
 *   ① `appliedId` —— 同一个 id 不重复加载（也顺带把「同一行重渲染」变成零成本）；
 *   ② `generation` —— 每次换 id 递增；回调里对不上就丢弃（在途的旧结果不许落地）。
 *
 * ## 取图口径
 *
 * `CmdFriend.img` 是**头像 id**（老端 `ModelPlayer.GetPlayerIcon(info.img)` →
 * `head.json` 按 `resId` 查 → `icon`），对应新端的 `HeadArt.loadHeadFrame(avatarId)`
 * —— 那是「头像 id → SpriteFrame」的唯一入口（两层查表 + 包名分流都在它里面）。
 * 不要自己拼路径：`icon.json` 的目录由**包名**决定，拼错会静默留白。
 */

import { Sprite } from 'cc';
import { HeadArt } from '../HeadArt';

/**
 * 一个头像槽位。
 *
 * ⚠️ 用法是「每次渲染都调 `apply(row.avatarId)`」——**绝对赋值**，不是增量。
 *    空串会**清空帧**（无头像时只留框，不能留着上一行的图）。
 */
export class FriendAvatarLoader {
    /** 当前已生效 / 正在加载的 id。 */
    private appliedId = '';

    /** 递增代号：换 id 后旧的在途结果一律作废。 */
    private generation = 0;

    constructor(private readonly getSprite: () => Sprite | null) {}

    /** 铺一次头像。`avatarId` 空串 = 清空。 */
    apply(avatarId: string): void {
        const id = typeof avatarId === 'string' ? avatarId : '';
        // 同一个 id 直接返回：既省一次加载，也**不会**误伤正在路上的那次加载
        // （若先递增 generation 再判等，会把同 id 的在途结果作废 ⇒ 永久留白）
        if (this.appliedId === id) return;
        this.appliedId = id;

        const sprite = this.getSprite();
        if (!sprite || !sprite.isValid) return;
        if (!id) {
            sprite.spriteFrame = null;
            return;
        }

        const generation = ++this.generation;
        const previous = sprite.spriteFrame;
        void HeadArt.loadHeadFrame(id).then((frame) => {
            // 组件已销毁 / 期间又换了 id ⇒ 丢弃
            if (generation !== this.generation) return;
            if (!sprite.isValid) return;
            if (this.appliedId !== id) return;
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
