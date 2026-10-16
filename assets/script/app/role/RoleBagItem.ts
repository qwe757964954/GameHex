import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 列表格状态标记（选中 / 已装备 / 升级箭头 / 红点）。 */
export interface IRoleBagItemMarks {
    readonly selected: boolean;
    readonly equipped: boolean;
    readonly upMark: boolean;
    readonly redDot: boolean;
}

/**
 * 背包列表里的**一个格子**（挂 `ui/Role/RoleBagItem.prefab` 根节点）。
 *
 * prefab 结构：
 * ```
 * RoleBagItem
 * ├── QualityFrame (110×110)   ← 品质框 Sprite（新增节点，渲染在最底层）
 * ├── ItemFrame (100×100)      ← 图标容器（原 prefab 本节点无 Sprite，只作布局容器）
 * │   └── Icon   (100×100)     ← 物品图标 Sprite
 * ├── CountLabel               ← 数量文字（宝石 / 道具右下角；装备不显示）
 * ├── RankLabel                ← 品阶文字（装备 `{rank}GRADE_RANK`；其余隐藏）
 * ├── Selected  (110×110)      ← 选中高亮
 * ├── RedDot     (30×30)       ← 红点（Dot / DotText）
 * ├── Equipped   (100×35)      ← 「装备中」横条
 * ├── Check / CheckMark        ← 多选态（本轮列表无多选，不接）
 * └── UpMark     (32×40)       ← 更优装备箭头
 * ```
 *
 * ⚠️ 所有状态在 `render()` 里**无条件写**（规则 82）：格子被虚拟列表复用，
 * 「有值才写」会让上一格的选中态 / 品质框残留，且不报错。
 *
 * 补齐口径（对照老端 `GObjGoods` 三种 behavior）：
 *   · 数量 —— 宝石 / 道具 `text_number`（`count > 1` 才显示，1 个不显示）；
 *   · 品阶 —— 装备 `text_rank`（`{rank}GRADE_RANK`，`rank > 0` 才显示）；
 *   · 等级 `Lv.x` / 道具星级 —— 老端仅穿戴态装备显示等级、道具星级默认隐藏（无数据源），
 *     本轮不接，留待后续（数据源需补 `CmdEquipPage`）。
 */
@ccclass('RoleBagItem')
export class RoleBagItem extends Component {
    // ⚠️ prefab 里这两个引用存的是【节点】（QualityFrame / Icon），声明成 `Sprite` 会拿到 cc.Node。
    //    （同 prefab 的 countLabel / rankLabel 存的是组件，所以那两个保持 `Label`。）
    @property({ type: Node, tooltip: 'Frame：品质框节点（QualityFrame，其上挂 cc.Sprite）' })
    frame: Node = null!;

    @property({ type: Node, tooltip: 'Icon：物品图标节点（ItemFrame/Icon，其上挂 cc.Sprite）' })
    icon: Node = null!;

    /** 缓存：品质框 Sprite（{@link ensureInit} 里取）。 */
    private frameSprite: Sprite = null!;

    /** 缓存：物品图标 Sprite。 */
    private iconSprite: Sprite = null!;

    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    @property({ type: Label, tooltip: 'CountLabel：数量文字（宝石/道具，count>1 显示）' })
    countLabel: Label = null!;

    @property({ type: Label, tooltip: 'RankLabel：品阶文字（装备 {rank}GRADE_RANK，rank>0 显示）' })
    rankLabel: Label = null!;

    @property({ type: Node, tooltip: 'Selected：选中高亮节点' })
    selected: Node = null!;

    @property({ type: Node, tooltip: 'Equipped：「装备中」横条' })
    equipped: Node = null!;

    @property({ type: Node, tooltip: 'UpMark：更优装备箭头' })
    upMark: Node = null!;

    @property({ type: Node, tooltip: 'RedDot：红点节点' })
    redDot: Node = null!;

    protected onLoad(): void {
        this.ensureInit();
    }

    /**
     * 拿两个 Sprite（幂等）。
     *
     * ⚠️ 不能只依赖 {@link onLoad}：条目由虚拟列表 `instantiate` 出来，
     * 若那一刻节点是非激活的，`onLoad` 要等第一次激活才跑 ⇒ 缓存恒为 null、图静默不显示。
     * {@link render} 开头再兜一次。
     */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;
        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默不显示图。
        this.frameSprite = this.frame.getComponent(Sprite);
        this.iconSprite = this.icon.getComponent(Sprite);
    }

    /**
     * 铺一格。
     *
     * @param frameFrame 品质框（宿主预加载；`null` 时保留 prefab 静态帧）
     * @param iconFrame  物品图标（`null` = 整块隐藏，不留旧图）
     * @param marks      四个状态标记
     * @param countText  数量文字（空串 = 隐藏；宝石/道具 count>1 时非空）
     * @param rankText   品阶文字（空串 = 隐藏；装备 rank>0 时非空）
     */
    render(
        frameFrame: SpriteFrame | null,
        iconFrame: SpriteFrame | null,
        marks: IRoleBagItemMarks,
        countText = '',
        rankText = '',
    ): void {
        this.ensureInit(); // 节点实例化时若未激活，onLoad 不会跑 ⇒ 这里兜住

        // 品质框：`frameFrame` 为 null 时保留 prefab 静态帧（这是业务语义，不是节点判空）。
        if (frameFrame) this.frameSprite.spriteFrame = frameFrame;

        this.iconSprite.spriteFrame = iconFrame;
        this.iconSprite.node.active = iconFrame != null;

        // 数量 / 品阶文字（无条件写：槽位复用，上一格的文字必须清掉）。
        this.countLabel.string = countText;
        this.countLabel.node.active = countText !== '';
        this.rankLabel.string = rankText;
        this.rankLabel.node.active = rankText !== '';

        // 四个状态标记同样无条件写（规则 82）。
        this.selected.active = marks.selected;
        this.equipped.active = marks.equipped;
        this.upMark.active = marks.upMark;
        this.redDot.active = marks.redDot;
    }
}
