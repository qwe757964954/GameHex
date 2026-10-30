import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 角色页装备栏的**一格**（挂 `ui/Role/Role.prefab` 下的 `Equip1`..`Equip6`）。
 *
 * 老端对应 `TabRoleMain.updateEquip(cmdEquip)` 里的那份 `组件_角色_装备项`：
 *   · 图标 + 品质框 —— `com_goods.UpdateByGoods(voEquipPart.GetEquip())`
 *   · 等级        —— `text_level` 的 `Lv.{level}`（`level` 来自 `CmdEquip.level`）
 *   · 红点        —— `com_rd.OnRDUpdate(...)`（本节**不接**，见下）
 *
 * ## 与老端的差异（刻意留下，不造假）
 *
 * 老端每格还有 `组件_宝石`（5 个宝石镶嵌孔，按 `cmdEquip.tlCmdGemInfo` 切品质页）。
 * 本轮按需求只做「图标 + 品质框 + Lv」，**宝石孔不接** —— prefab 里那 5 个 `com1..com5`
 * 保持静态，别写「按空数据切页」的假接线。
 *
 * ## 状态一律无条件写（规则 82）
 *
 * 槽位会被「换装」复用，条件式赋值会留下上一格的品质框 / Lv 文字。
 */
@ccclass('RoleEquipSlot')
export class RoleEquipSlot extends Component {
    @property({ type: Node, tooltip: 'QualityFrame：品质框节点（其上挂 cc.Sprite）' })
    frameNode: Node = null;

    @property({ type: Node, tooltip: 'Icon：装备图标节点（其上挂 cc.Sprite）' })
    iconNode: Node = null;

    @property({ type: Label, tooltip: 'LevelLabel：等级文字（Lv.x，空位不显示）' })
    levelLabel: Label = null;

    /** 缓存：品质框 Sprite（{@link ensureInit} 里取）。 */
    private frameSprite: Sprite = null;

    /** 缓存：图标 Sprite。 */
    private iconSprite: Sprite = null;

    /** {@link ensureInit} 是否跑过（幂等标记）。 */
    private inited = false;

    protected onLoad(): void {
        this.ensureInit();
    }

    /**
     * 拿两个 Sprite（幂等）。
     *
     * ⚠️ 不能只依赖 {@link onLoad}：宿主节点若初始是非激活的，`onLoad` 要等第一次激活才跑
     * ⇒ 缓存恒为空、图静默不显示。{@link render} 开头再兜一次。
     */
    private ensureInit(): void {
        if (this.inited) return;
        this.inited = true;
        // prefab 已绑好，不判空：绑错应当场抛出来，而不是静默留个死界面（规则 109）。
        this.frameSprite = this.frameNode.getComponent(Sprite);
        this.iconSprite = this.iconNode.getComponent(Sprite);
    }

    /**
     * 铺一格。
     *
     * @param frame    品质框（宿主预加载；`null` = 该品质没有框图）
     * @param icon     装备图标（`null` = 图没导进工程 ⇒ 只隐藏图标，**品质框照显示**）
     * @param level    装备等级（`CmdEquip.level`；`0` = 不显示）
     * @param hasEquip 该部位是否穿着装备（`false` = 空位，只留槽底）
     */
    render(frame: SpriteFrame | null, icon: SpriteFrame | null, level: number, hasEquip: boolean): void {
        this.ensureInit();

        this.frameSprite.spriteFrame = frame;
        this.frameSprite.node.active = hasEquip;

        this.iconSprite.spriteFrame = icon;
        this.iconSprite.node.active = hasEquip && icon != null;

        const text = hasEquip && level > 0 ? `Lv.${level}` : '';
        this.levelLabel.string = text;
        this.levelLabel.node.active = text !== '';
    }
}
