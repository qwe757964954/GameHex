import { _decorator, Component, Label, Node, Sprite } from 'cc';
import type { SpriteFrame } from 'cc';
import type { IMilitiaTalentCell } from './MilitiaTypes';

const { ccclass, property } = _decorator;

/**
 * 天赋列表的一格（`ui/Role/MilitiaTalentItem`，720×152）。
 *
 * 老端 `TabMilitiaTalent.renderListItem` 的直译：
 *   · 节点底图按三态换（未解锁 / 已解锁 / 当前）—— FGUI 里是 `icon` 组件的「状态」controller
 *     三页，生成器只能烘默认页那张 ⇒ 三态由 **这一层**换图（见 `MilitiaTalentPage.STATE_ART`）；
 *   · 有 effect 的行：右侧「框 + 名称 + 描述」整块显示，图标盒放大 **1.3**；
 *   · 「下一级」那一格挂红点（老端 `rd.OnRDUpdate(isNext ? canLevelUp : 0)`）。
 *
 * ⚠️ 属性**一律声明 `Node`**，组件在 {@link ensureInit} 里 `getComponent` 现取并缓存
 * （与 `RolePage` / `RoleBagPanel` 同一口径：prefab 上存的是节点，声明成组件类型会
 * 拿到一个 `cc.Node`（truthy）⇒ 运行时静默失效）。
 * ⚠️ 图**必须在外部 `await` 完再传进来**（`render` 是同步的，与 `RoleBagItem` 同一口径）。
 */
@ccclass('MilitiaTalentItem')
export class MilitiaTalentItem extends Component {
    @property({ type: Node, tooltip: 'NodeIcon/Frame：节点底图（三态换图，其上挂 cc.Sprite）' })
    frameNode: Node = null!;

    @property({ type: Node, tooltip: 'NodeIcon/Icon：天赋图标 50×50（其上挂 cc.Sprite）' })
    iconNode: Node = null!;

    @property({ type: Node, tooltip: 'NodeIcon：图标盒（有 effect 时整块放大 1.3）' })
    iconBox: Node = null!;

    @property({ type: Node, tooltip: 'Plate：右侧效果框（frame_Zhikuang04）' })
    plate: Node = null!;

    @property({ type: Node, tooltip: 'Name：效果名（其上挂 cc.Label）' })
    nameNode: Node = null!;

    @property({ type: Node, tooltip: 'Desc：效果描述（其上挂 cc.Label）' })
    descNode: Node = null!;

    @property({ type: Node, tooltip: 'RedDot：红点（只给「下一级」显示）' })
    redDot: Node = null!;

    /**
     * `BarFg`：节点之间的链条**前景**（`tf_bar_fg_3gong`）。
     *
     * 底图 `BarBg`（`tf_bar01_bg`）每格都有，前景在老端是 `gearDisplay controller="状态" pages="1,2"`
     * ⇒ **未解锁态不显示**（链条没点亮）。这里是同一条规则的直译。
     */
    @property({ type: Node, tooltip: 'BarFg：链条前景（未解锁态隐藏）' })
    barForeground: Node = null!;

    private frame: Sprite = null!;
    private icon: Sprite = null!;
    private nameLabel: Label = null!;
    private descLabel: Label = null!;
    private inited = false;

    protected onLoad(): void {
        this.ensureInit();
    }

    /** 取组件（幂等：宿主可能初始非激活 ⇒ `onLoad` 未必先跑）。 */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;
        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默留个死界面。
        this.frame = this.frameNode.getComponent(Sprite);
        this.icon = this.iconNode.getComponent(Sprite);
        this.nameLabel = this.nameNode.getComponent(Label);
        this.descLabel = this.descNode.getComponent(Label);
    }

    /**
     * 铺一格（**全部无条件写** —— 规则 82：比新旧会被 prefab 默认值短路）。
     *
     * @param cell      该格的判定结果（`MilitiaTable`，零 cc）
     * @param frame     节点底图（三态之一；`null` = 缺图留白）
     * @param iconFrame 天赋图标（`null` = 缺图留白）
     * @param redDot    红点数（0 = 不显示）
     */
    render(cell: IMilitiaTalentCell, frame: SpriteFrame | null, iconFrame: SpriteFrame | null, redDot: number): void {
        this.ensureInit();
        this.frame.spriteFrame = frame;
        this.icon.spriteFrame = iconFrame;
        // 老端：有 modify 的格子图标放大 1.3（视觉上区分「有效果」的节点）。
        this.iconBox.setScale(cell.hasEffect ? 1.3 : 1, cell.hasEffect ? 1.3 : 1, 1);

        this.plate.active = cell.hasEffect;
        this.nameLabel.string = cell.effectName;
        this.descLabel.string = cell.effectDesc;

        this.redDot.active = redDot > 0;
        // 链条前景：未解锁不点亮（老端 gearDisplay 状态=1,2）。
        this.barForeground.active = cell.state !== 'locked';
    }
}
