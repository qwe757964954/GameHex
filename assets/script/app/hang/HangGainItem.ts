import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { HJ_SPRITE_SIMPLE } from './HangArt';

const { ccclass, property } = _decorator;

/**
 * 收益条 —— 进度条上方那两个「`16/h` / `1/h`」小条（FGUI 挂机包 `组件_挂机收益.xml`，102×44）。
 *
 * 一屏两份（`挂机收益1` / `挂机收益2`），分别吃 `mergedRewards[0]` / `mergedRewards[1]`：
 *
 * ```ts
 * // 老端 LayerHang.initView
 * rewardCom1.tm<AppGloaderEx>("icon").SetUrlByIcon(GetGoodsIconKeyByRefId(mergedRewards[0].resId));
 * rewardCom1.tm("text").setText(mergedRewards[0].number + "/h");
 * ```
 *
 * ⚠️ FGUI 原稿里的 `邮件信息` 控制器（`0,无 / 1,有`）挂在 `text` 上：`gearDisplay pages="0"`
 * 且 `selected="0"` ⇒ **默认就是「无」这一页、文字可见**。老端从头到尾**没有**动这个控制器
 * （`initView` 只 `setText`）⇒ 移植时把它当「一直显示」处理，不要额外接控制器。
 */
@ccclass('HangGainItem')
export class HangGainItem extends Component {
    @property({ type: Sprite, tooltip: '货币图标（`icons/resource/*`，`roleProperty.icon`）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: '`16/h` 形态的每小时产出' })
    text: Label = null!;

    /**
     * 铺一条。
     *
     * @param iconFrame 货币图标（`null` ⇒ 整条隐藏）
     * @param perHour   `HangTable.perHourText` 的结果（形如 `16/h`）
     */
    render(iconFrame: SpriteFrame | null, perHour: string): void {
        const usable = !!iconFrame;
        this.node.active = usable;
        if (!usable) return;
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.type = HJ_SPRITE_SIMPLE;
        }
        if (this.text) this.text.string = perHour;
        if (this.icon) this.icon.node.active = true;
        if (this.text) this.text.node.active = true;
    }

    /** 没有对应奖励（本关产出不足两条）：整条隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
