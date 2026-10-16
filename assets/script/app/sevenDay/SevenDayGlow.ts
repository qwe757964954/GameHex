import { _decorator, Component } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 匀速自转的**特效占位**。
 *
 * FGUI 里「选中天数的光效」（`组件_特效_七日狂欢当前天.xml`）和「宝箱可领取的闪烁」
 * （`特效_七日狂欢_宝箱可领取.xml`）都是**序列帧/补间动画**，Demo3.8 没有 FGUI 的 transition
 * 系统，也没有这两套帧图。这里用「挂一张光效图 + 每帧匀速旋转」近似，
 * 视觉上够用，且**一行动画配置都不用写**。
 *
 *  ⚠️ 用 `Component.update` 而不是 `tween`：`tween` 要 `Tween.stopAllByTarget` 才能随节点
 *  销毁干净，而这种「常驻自转」的节点在弹窗关闭时会连着整棵树被 destroy，
 *  在 `update` 里转最不容易留下悬挂的 tween。
 */
@ccclass('SevenDayGlow')
export class SevenDayGlow extends Component {
    @property({ tooltip: '每秒旋转角度（负值 = 顺时针）' })
    degreesPerSecond: number = -90;

    protected update(deltaTime: number): void {
        this.node.angle += this.degreesPerSecond * deltaTime;
    }
}
