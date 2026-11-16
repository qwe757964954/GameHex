import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 联盟三个面板共用奖励格。同步渲染，帧由宿主预加载后传入，避免虚拟列表复用闪图。
 */
@ccclass('LeagueRewardSlot')
export class LeagueRewardSlot extends Component {
    @property({ type: Sprite, tooltip: 'Icon：道具图标（没有映射图时整节点隐藏）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Count：数量（showCount=false 或数量<=0 时隐藏）' })
    countLabel: Label = null;

    /** 品质框（本节点上的 `cc.Sprite`；`onLoad` 兜底自取）。 */
    private frame: Sprite | null = null;

    protected onLoad(): void {
        this.frame = this.getComponent(Sprite);
    }

    /** 品质框 Sprite（供宿主 / 探针取用）。 */
    get frameSprite(): Sprite | null {
        return this.frame;
    }

    /**
     * 铺一个奖励。
     *
     * @param qualityFrame 品质框（`null` ⇒ **保留** prefab 上的静态框，不清成空白）
     * @param iconFrame    道具图标（`null` ⇒ 隐藏 `Icon`，不画问号占位）
     * @param count        数量（`showCount=false` 或 `<= 0` 时隐藏 `Count`）
     * @param showCount    是否显示数量（默认显示）
     */
    render(
        qualityFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        count: number,
        showCount = true,
    ): void {
        if (qualityFrame && this.frame) this.frame.spriteFrame = qualityFrame;
        if (this.icon) {
            this.icon.spriteFrame = iconFrame;
            this.icon.node.active = !!iconFrame;
        }
        this.setCount(count, showCount);
    }

    /** 只改数量（宿主复用同一格时用；绝对赋值 —— 槽位复用不留上一行的残影）。 */
    setCount(count: number, showCount = true): void {
        if (!this.countLabel) return;
        const n = Number.isFinite(count) ? Math.trunc(count) : 0;
        const show = showCount && n > 0;
        this.countLabel.node.active = show;
        if (show) this.countLabel.string = String(n);
    }

    /** 空格子（解析不出奖励 / 该面板这一格本来就没有）：整格隐藏。 */
    hide(): void {
        this.node.active = false;
    }
}
