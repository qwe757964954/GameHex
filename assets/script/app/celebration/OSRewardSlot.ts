import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { OS_SPRITE_SIMPLE } from './CelebrationArt';

const { ccclass, property } = _decorator;

/**
 * 一个奖励格（prefab `ui/Celebration/OSRankRewardItem`，84×85）。
 *
 * FGUI 原稿里这块是设计期残件：`组件_开服冲榜_奖励项.xml` 只有一个指向 `物品框.xml` 的 `com_goods`，
 * 而后者正文只有一个裸 `loader`（`name="ui看效果用的"`），没有底板、品质框和数量文字。
 * 真正的格子由老端代码画：`ItemBehavior2.onUpdateByGoods` 里
 * `onFrameUpdate(quality)` + `SetUrlByIcon(iconKey)` + `onNumberUpdate(numberStr)`。
 *
 * 所以迁过来的 prefab 比原稿多两样，`Goods` 的兄弟序必须是 `[Frame, Icon, Num]`：
 * `Frame`（品质框）排在 `Icon` 之前才压在图标下面，写反不报错、只是框盖住图标。
 *
 * 格子会被虚拟列表 clone 复用，所以 `render()` 三个字段一律无条件赋值，`null` 当「没有、要清掉」，
 * 不能保留上一趟的图。图由宿主预加载好再传进来：在 `render()` 里现 load 会让图落到已复用的行上。
 */

/** 数量文案（老端 `Goods.GetNumberStr()`：0 显示空串，其余纯整数、不缩写）。 */
export function osNumberTextOf(number: number): string {
    if (!Number.isFinite(number) || Math.floor(number) === 0) return '';
    return String(Math.floor(number));
}

@ccclass('OSRewardSlot')
export class OSRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Frame：品质框（image/frame/common_img_pzk_0N），必须排在 Icon 之前。' })
    frame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Icon：道具 / 货币图标' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Num：数量（0 时为空串，老端 GetNumberStr）' })
    num: Label = null!;

    /**
     * 铺一格。两个帧参数都由宿主预加载好再传。
     *
     * @param iconFrame 奖励图标；`null` 隐藏 Icon，不留上一趟的图
     * @param qualityFrame 品质框；`null` 隐藏 Frame
     * @param number 数量；`0` 时文案为空串
     */
    render(iconFrame: SpriteFrame | null, qualityFrame: SpriteFrame | null, number: number): void {
        this.frame.spriteFrame = qualityFrame;
        this.frame.type = OS_SPRITE_SIMPLE;
        this.frame.node.active = !!qualityFrame;

        this.icon.spriteFrame = iconFrame;
        this.icon.type = OS_SPRITE_SIMPLE;
        this.icon.node.active = !!iconFrame;

        this.num.string = osNumberTextOf(number);
        this.node.active = true;
    }

    /** 空格子（`rewards` 不够 / `resId` 解析不出）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
