import {_decorator, Button, Component, Node, Sprite, SpriteFrame} from 'cc';
import { BT_SPRITE_SIMPLE } from './BattleTokenArt';
import type { IRewardSlotState } from './BattleTokenTable';

const { ccclass, property } = _decorator;

/**
 * 战令列表里**一个奖励格**（FGUI `组件_战令_项Item.xml`，90×90 缩到 70×70）。
 *
 * FGUI 原稿的 5 个控制器 → 这里的**布尔字段**：
 *
 * | FGUI 控制器 | FGUI 页 | 语义 | 这里 |
 * |---|---|---|---|
 * | `状态` | 0 未领取 / 1 已领取 | 打勾 | `checkMark.active` |
 * | `遮罩` | 0 否 / 1 是 | 置灰 | `mask.active` |
 * | `解锁` | 0 是 / 1 否（**反的**） | 显示锁 | `lockIcon.active = !unlocked` |
 *
 * ⚠️ FGUI 的 `解锁` 控制器 `pages="0,是,1,否"` 是**反序**的 ⇒ 老端写 `setSelectedPage("解锁","是")`
 * 命中的是 page 1。移植时别把方向搞反（症状 = 已解锁的格子反而挂锁）。
 *
 * ⚠️ **每一个状态都必须绝对赋值**（规则 10）：整行会被虚拟列表 clone 复用，同一实例会被
 * 赋予别的等级 / 别的方案，漏赋值的字段会保留上一趟的状态。
 */
@ccclass('BattleTokenRewardSlot')
export class BattleTokenRewardSlot extends Component {
    @property({ type: Sprite, tooltip: '品质框（`image/frame/common_img_pzk_*`）' })
    frame: Sprite = null;

    @property({ type: Sprite, tooltip: '道具图标（`item` / `roleProperty` 两支分流解析）' })
    icon: Sprite = null;

    @property({ type: Node, tooltip: '已领取对勾（复用 sevenDay/sd_check）' })
    checkMark: Node = null;

    @property({ type: Node, tooltip: '置灰遮罩（bt_icon_mask）' })
    mask: Node = null;

    @property({ type: Node, tooltip: '未解锁的锁标（bt_lock）' })
    lockIcon: Node = null;

    @property({ type: Node, tooltip: '可领取红点（common/cm_red_dot）' })
    redDot: Node = null;

    @property({ type: Button, tooltip: '整格的按钮（可领取时才 interactable）' })
    button: Button = null;

    private _onTake: (() => void) | null = null;

    /** 绑定本格的领取回调（点击时才用）。 */
    bindTake(handler: (() => void) | null): void {
        this._onTake = handler;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this._handleClick, this);
    }

    protected onDestroy(): void {
        // ⚠️ 判 `isValid` 后再摘监听：宿主销毁时子节点可能已先被拆（规则 60 的同类问题）
        if (this.node && this.node.isValid) this.node.off(Button.EventType.CLICK, this._handleClick, this);
    }

    private _handleClick(): void {
        if (this._onTake) this._onTake();
    }

    /**
     * 铺一次状态。
     *
     * @param state      纯函数 `BattleTokenTable.rewardSlotState` 的结果
     * @param frame      品质框（`null` ⇒ 保留当前，不覆盖）
     * @param iconFrame  道具图标（`null` ⇒ 隐藏 IcoN 节点）
     */
    render(state: IRewardSlotState, frame: SpriteFrame | null, iconFrame: SpriteFrame | null): void {
        if (this.frame) {
            if (frame) this.frame.spriteFrame = frame;
            this.frame.type = BT_SPRITE_SIMPLE;
        }
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = !!iconFrame;
        }
        // 绝对赋值（规则 10）—— 复用节点上残留的是上一趟的状态
        if (this.checkMark) this.checkMark.active = state.taken;
        if (this.mask) this.mask.active = state.masked;
        if (this.lockIcon) this.lockIcon.active = !state.unlocked;
        if (this.redDot) this.redDot.active = state.claimable;
        if (this.button) this.button.interactable = state.canTake;
    }

    /** 空格子（该行没有这个方案，或者奖励 resId 解析不出）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
