import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame, UIOpacity, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 七日狂欢底部**一个积分宝箱**（100×120，内联在 `SevenDay.prefab` 的 `BoxBar` 下）。
 *
 * 结构对齐 FGUI `七日狂欢/组件/组件_七日狂欢_宝箱item.xml`：
 *   进度条（`sd_bar_bg` + `sd_bar`）+ 宝箱按钮（`sd_box_glow`，可领取时加旋转光效）
 *   + 达标积分数字（`title`）+ 已领取对勾（`sd_check`）。
 *
 *  ⚠️ 进度条**按宽度拉伸**，不是 `cc.ProgressBar`：
 *  FGUI 那个进度条是「上一档到本档」的区间进度（见 `SevenDayTable.boxProgressOf`），
 *  `cc.ProgressBar` 只能表达 `0..max` 的线性进度，还要额外引一个填充 Sprite 引用，
 *  在 prefab 里配它反而更容易配错。这里让 `ProgressBar` 节点锚点 `(0,0.5)`，
 *  改 `UITransform.width = 满宽 * ratio` 就等价 —— 一个属性、无隐藏状态。
 */
@ccclass('SevenDayPointBox')
export class SevenDayPointBox extends Component {
    @property({ type: Sprite, tooltip: 'BoxIcon：宝箱图（`sd_box_glow`）' })
    boxIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'BoxBtn：宝箱点击区（挂 cc.Button）' })
    boxButton: Node = null!;

    @property({ type: Node, tooltip: 'ProgressBar：填充条（锚点必须 (0,0.5)）' })
    progressBar: Node = null!;

    @property({ type: Node, tooltip: 'ProgressBg：进度条底（满宽，用来取宽度上限）' })
    progressBg: Node = null!;

    @property({ type: Label, tooltip: 'NeedLabel：达标积分数字' })
    needLabel: Label = null!;

    @property({ type: Node, tooltip: 'CheckMark：已领取对勾（默认隐藏）' })
    checkMark: Node = null!;

    @property({ type: Node, tooltip: 'Ray：可领取时的旋转光效（默认隐藏）' })
    ray: Node = null!;

    @property({ type: Sprite, tooltip: 'BoxBtn 里的品质框 Sprite（复用 `image/frame/common_img_pzk_*`）' })
    qualityFrame: Sprite = null!;

    @property({ type: Sprite, tooltip: 'BoxBtn/Icon：奖励物品图标（这一档能领到什么）；没有映射图时整块隐藏' })
    rewardIcon: Sprite = null!;

    @property({ type: Node, tooltip: 'BoxBtn/RedDot：可领取时的红点（默认隐藏）' })
    redDot: Node = null!;

    /**
     * 铺一个宝箱。
     *
     * @param need        达标积分
     * @param progress    `0..1`（`SevenDayTable.boxProgressOf`）
     * @param state       `locked` / `claimable` / `taken`
     * @param qualityFrame 品质框（宿主预加载；`null` 时保留 prefab 上的静态框）
     * @param iconFrame   奖励物品图标（宿主预加载；`null` 时隐藏图标节点）
     */
    render(
        need: number,
        progress: number,
        state: 'locked' | 'claimable' | 'taken',
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
    ): void {
        this.needLabel.string = String(need);
        if (qualityFrame) this.qualityFrame.spriteFrame = qualityFrame;

        // 奖励物品：老端 `按钮_七日狂欢_宝箱.xml` 里 `com_goods`（物品框）会把这个档位的奖励画出来，
        // 所以宝箱上必须能看到物品（图一里三个宝箱都带物品图）。没映射图就整块藏掉，不画问号占位。
        if (iconFrame) {
            this.rewardIcon.spriteFrame = iconFrame;
            this.rewardIcon.node.active = true;
        } else {
            this.rewardIcon.node.active = false;
        }

        // 进度条宽度：按**底条**宽度算，改 prefab 尺寸不用改代码
        const bgTransform = this.progressBg.getComponent(UITransform);
        const full = bgTransform ? bgTransform.contentSize.width : 0;
        const barTransform = this.progressBar.getComponent(UITransform);
        if (barTransform && full > 0) {
            barTransform.setContentSize(Math.max(0, Math.min(1, progress)) * full, barTransform.contentSize.height);
        }

        // 三态一律绝对赋值：宝箱会被 5 个槽位复用（规则 10）
        this.checkMark.active = state === 'taken';
        this.ray.active = state === 'claimable';
        // ⚠️ 宝箱**没有**红点 —— 老端 `自定义组件/按钮_七日狂欢_宝箱.xml` 的 displayList 只有
        //    `特效`（可领取光效）+ `com_goods`（物品框）+ `shaixuan_duigou`（已领取对勾），
        //    没有 `com_rd`。老端红点只出现在三处：天球（`UpdateDayBtn`）、页签 render、行内 `按钮_领取`。
        //    所以 prefab 里**故意不给宝箱建红点节点**，这里必须判空 —— 直接 `this.redDot.active`
        //    会在渲染路径上抛 `TypeError`（`null.active`）把整个界面带崩。
        if (this.redDot) this.redDot.active = state === 'claimable';
        this.boxButton.getComponent(Button)!.interactable = true;
        // 未开启时压暗宝箱本体（老端靠换「开启/未开启」两张图；这里压暗省一张美术）
        // `addComponent` 的返回类型带 `null` ⇒ 必须判一次，别直接 `!`（prefab 配错时宁可不变暗，也别在
        // 渲染路径上抛异常把整页带崩）。
        const opacity = this.boxIcon.getComponent(UIOpacity) ?? this.boxIcon.addComponent(UIOpacity);
        if (opacity) opacity.opacity = state === 'locked' ? 160 : 255;
    }

    hide(): void {
        this.node.active = false;
    }
}
