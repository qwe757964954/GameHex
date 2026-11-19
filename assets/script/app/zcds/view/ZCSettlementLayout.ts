import { _decorator, Component, Node, UITransform } from 'cc';
import { ZC_SETTLEMENT_STYLE } from '../model/ZCSettlementStyle';

const { ccclass, property } = _decorator;

/**
 * 结算面板的「段位行收起」补位组件。
 *
 * 设计稿的段位行是常驻的；失败 / 章节局服务端没有段位数据时，`RankRow` 会整组收起，
 * 但 `RewardSection` 仍停在有段位行时的位置，中间会空出一整行。这里把奖励区按
 * 「段位行实际高度 + 设计间距」上移，数据回来后原样落回。
 *
 * 只做显隐补偿，不改 prefab 的基础布局：基准 Y 在第一次调用时从 prefab 读取，
 * 不是另一份写死的坐标；位置/尺寸仍以 prefab 为真源。
 */
@ccclass('ZCSettlementLayout')
export class ZCSettlementLayout extends Component {
    @property({ type: Node, tooltip: 'Panel/RankRow：段位行整组' })
    rankRow: Node = null!;

    @property({ type: Node, tooltip: 'Panel/RewardSection：通关奖励区整组' })
    rewardSection: Node = null!;

    @property({ tooltip: '段位行收起时，奖励区与上方内容之间保留的设计间距' })
    rankRewardGap = ZC_SETTLEMENT_STYLE.layout.rankRewardGap;

    /** prefab 里奖励区的原始 Y；null = 还没量过。*/
    private baseY: number | null = null;
    /** 段位行实际高度；取不到 UITransform 时用设计稿兜底。*/
    private rankHeight: number = ZC_SETTLEMENT_STYLE.layout.rankRowHeight;

    /** 段位行显示/收起后同步奖励区位置；重复同态调用不产生多余 setPosition。*/
    apply(hasRank: boolean): void {
        const baseY = this.measure();
        if (baseY === null) return;
        const targetY = hasRank ? baseY : baseY + this.rankHeight + this.rankRewardGap;
        const position = this.rewardSection.position;
        if (position.y === targetY) return;
        this.rewardSection.setPosition(position.x, targetY, position.z);
    }

    /** 页面关闭时落回 prefab 原位，避免缓存复用把上移后的位置带给下一局。*/
    reset(): void {
        if (this.baseY === null) return;
        const position = this.rewardSection.position;
        if (position.y === this.baseY) return;
        this.rewardSection.setPosition(position.x, this.baseY, position.z);
    }

    private measure(): number | null {
        if (!this.rewardSection) return null;
        if (this.baseY === null) {
            this.baseY = this.rewardSection.position.y;
            const transform = this.rankRow ? this.rankRow.getComponent(UITransform) : null;
            this.rankHeight = transform ? transform.height : ZC_SETTLEMENT_STYLE.layout.rankRowHeight;
        }
        return this.baseY;
    }
}
