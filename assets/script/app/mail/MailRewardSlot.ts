/**
 * 邮件详情里的**一个奖励格**（`90×90`，对齐 FGUI `组件_邮件_邮件内容奖励item.xml`）。
 *
 * 结构对齐 FGUI（那个 item 里就是 `物品框.xml` 的实例，`size="90,90"`）：
 *   本节点挂 `cc.Sprite` 当**品质框**，下面挂 `Icon`（道具图，居中）。
 *
 * ⚠️ 品质框与道具图**都必须由宿主预加载好再传进来**：在这里现加载会先闪一帧上一份奖励的图。
 *   宿主是 `MailDetailPage.loadRewardArt()`（一次性把 8 个格子要用的图都取好）。
 *
 * ⚠️ 与 `ActivityRewardSlot` / `SevenDayRewardSlot` 是同一份实现的**第三个副本**。
 *   没有合并成公共组件：三个模块的槽位尺寸与格子数都不同（活动 85×85 一行 5 格、
 *   七日固定 1 格、邮件 90×90 最多 8 格），共享类会把三边的 `@property` 绑成一个
 *   prefab 契约、不好各自演进 —— 与「好友/申请两个行脚本不合并」同一条理由。
 */

import { _decorator, Component, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

@ccclass('MailRewardSlot')
export class MailRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框底图（本节点上的 cc.Sprite）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Icon：道具图标（解析不出时整块隐藏）' })
    icon: Sprite = null;

    protected onLoad(): void {
        if (!this.frame) {
            const own = this.getComponent(Sprite);
            if (own) this.frame = own;
        }
    }

    /**
     * 铺一个奖励。
     *
     * `qualityFrame` 传 `null` 时**保留** prefab 上的静态框，不把它清成空白
     * （空白看着像「图丢了」，而静态框至少是个正常的品质框）。
     * `iconFrame` 传 `null` 时把图标整块藏掉 —— 不画问号占位（那更像「图坏了」）。
     */
    render(qualityFrame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        this.node.active = true;
        if (qualityFrame) this.frame.spriteFrame = qualityFrame;
        if (iconFrame) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = true;
        } else {
            this.icon.node.active = false;
        }
    }

    hide(): void {
        this.node.active = false;
    }
}
