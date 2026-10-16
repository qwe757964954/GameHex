import { _decorator, Component, Label, Sprite, UIOpacity, type SpriteFrame } from 'cc';
import {
    territoryGainFx,
    type ITerritoryGainFx,
} from '../model/TerritoryResourceGain';

const { ccclass, property } = _decorator;

/**
 * 领地「资源获得」飘字 —— **icon + 数字从格心升起、边升边淡出**。
 *
 *  挂在 `ui/territory/TerritoryResourceGain.prefab` 的根上，由 `TerritoryMapView` 池化复用：
 *  每次 `play()` 前调用方先 `setPosition` 定好起点（格心上方），本类只负责从起点往上飘。
 *
 *  表现参数全部在 `model/TerritoryResourceGain`（纯函数、零 cc），本文件只做**逐帧写节点**，
 *  不自己算曲线 —— 与 `TerritoryHexFlip` 同一套路（真源单一，单测直接测纯函数）。
 *
 * ⚠️ **不建 tween**：飘字是池化节点，`tween` 挂在复用节点上会在回收后继续跑
 *  （见规则 106 / 247）；逐帧 `step(dt)` 由 `TerritoryMapView.update` 统一推进，
 *  回收时把 `elapsed` 置 -1 即可，没有需要显式销毁的定时器。
 */
@ccclass('TerritoryResourceGainView')
export class TerritoryResourceGainView extends Component {
    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：资源图标（银币 / 体力）' })
    iconSprite: Sprite = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Amount：+N 数值' })
    amountLabel: Label = null!;

    @property({ type: UIOpacity, group: '节点引用', tooltip: '挂在根节点上的 cc.UIOpacity（整条一起淡出）' })
    opacity: UIOpacity = null!;

    /** < 0 = 空闲（可被复用）。 */
    private elapsed = -1;
    private baseY = 0;

    /**
     * 从**节点当前的 y** 起飘。
     *
     * ⚠️ 起点必须在 `play()` **之前**由调用方写好：本类每帧写的是「起点 + 位移」，
     * 池化复用时上一次的位移还留在节点上，不重设起点就会越飘越高。
     */
    play(frame: SpriteFrame | null, amount: number): void {
        this.baseY = this.node.position.y;
        this.elapsed = 0;
        this.node.active = true;
        if (this.iconSprite.spriteFrame !== frame) this.iconSprite.spriteFrame = frame;
        const text = `+${Math.max(0, Math.round(amount))}`;
        if (this.amountLabel.string !== text) this.amountLabel.string = text;
        this.apply(territoryGainFx(0) as ITerritoryGainFx);
    }

    /** 每帧推进。@returns 是否还在播（false = 已播完，调用方可回收）。 */
    step(dt: number): boolean {
        if (this.elapsed < 0) return false;
        this.elapsed += dt;
        const fx = territoryGainFx(this.elapsed);
        if (!fx) {
            this.stop();
            return false;
        }
        this.apply(fx);
        return true;
    }

    /** 立刻收尾（换章 / 重渲染前调）：节点回池，位置留给下次 play 重设。 */
    stop(): void {
        this.elapsed = -1;
        this.node.active = false;
    }

    private apply(fx: ITerritoryGainFx): void {
        const node = this.node;
        node.setPosition(node.position.x, this.baseY + fx.offsetY, 0);
        node.setScale(fx.scale, fx.scale, 1);
        const alpha = Math.max(0, Math.min(255, Math.round(fx.opacity * 255)));
        if (this.opacity.opacity !== alpha) this.opacity.opacity = alpha;
    }
}
