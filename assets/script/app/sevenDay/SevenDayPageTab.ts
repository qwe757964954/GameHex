import {_decorator, Component, Label, Sprite, SpriteFrame} from 'cc';
import { RedDot } from '../common/RedDot';

const { ccclass, property } = _decorator;

/**
 * 七日狂欢的**一个页签**（内联在 `SevenDay.prefab` 的 `TabBar` 下，198×65）。
 *
 * 结构对齐 FGUI `七日狂欢/自定义组件/按钮_七日狂欢_页签.xml`：
 *   本节点挂 `cc.Sprite` 当底板（选中 / 未选中两态换图），下面挂 `TitleLabel` / `RedDot`。
 *
 *  ⚠️ 页签**数量是数据驱动的**（`SevenDayTable.listDayTabs`）：今天的表里有几个 `typeName`
 *  就有几个页签，表里最多 3 个（今日福利 / 今日挑战 / 半价礼包）。prefab 预摆 3 个，
 *  运行时空槽位 `hide()` —— 别把数量写死在界面里，老端就是写死了 `[task]` 才只剩一个页签。
 */
@ccclass('SevenDayPageTab')
export class SevenDayPageTab extends Component {
    @property({ type: Label, tooltip: 'TitleLabel：页签名（表里的 typeName）' })
    titleLabel: Label = null;

    @property({ type: Sprite, tooltip: '背景：本节点上的 cc.Sprite（两态换图）' })
    background: Sprite = null;

    @property({ type: RedDot, tooltip: 'RedDot：该页签有可领取内容时的红点（默认隐藏）' })
    redDot: RedDot = null;

    @property({ type: SpriteFrame, tooltip: '选中底板（`sd_tab_on`）' })
    selectedFrame: SpriteFrame = null;

    @property({ type: SpriteFrame, tooltip: '未选中底板（`sd_tab_off`）' })
    normalFrame: SpriteFrame = null;

    render(title: string, selected: boolean, hasRedDot: boolean): void {
        if (!this.background) {
            const own = this.getComponent(Sprite);
            if (own) this.background = own;
        }
        this.titleLabel.string = title;
        // 绝对赋值（页签槽位在切天数时会被重填，见规则 10）
        this.background.spriteFrame = selected ? this.selectedFrame : this.normalFrame;
        this.redDot.setRedDot(hasRedDot);
    }

    hide(): void {
        this.node.active = false;
    }
}
