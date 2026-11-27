import { _decorator, Button, CCInteger, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { RedDot } from '../common/RedDot';
import { RoleEvent } from './RoleEvents';

const { ccclass, property } = _decorator;

/** 角色页单个装备部位，负责格子、宝石孔与红点的显示，并派发点击意图。 */
@ccclass('RoleEquipSlot')
export class RoleEquipSlot extends Component {
    @property({ type: CCInteger, tooltip: '部位号：1-6（顺序与 `RoleEquipRedDotTable` 一致）' })
    partId = 1;

    @property({ type: Sprite, tooltip: '装备品质框' })
    private frameSprite: Sprite = null!;

    @property({ type: Sprite, tooltip: '装备图标' })
    private iconSprite: Sprite = null!;

    @property({ type: Label, tooltip: '装备等级（空位隐藏）' })
    private levelLabel: Label = null!;

    @property({ type: Button, tooltip: 'com_goods：格子本体按钮（点开该部位详情）' })
    goodsButton: Button = null!;

    @property({ type: RedDot, tooltip: 'com_rd：本格红点（任一部位可强化 / 升品 / 洗炼）' })
    redDot: RedDot = null!;

    @property({ type: Node, tooltip: '宝石孔容器' })
    private gemGroup: Node = null!;

    @property({ type: [Button], tooltip: '按孔位 1–5 排列的按钮' })
    private gemButtons: Button[] = [];

    @property({ type: [Sprite], tooltip: '按孔位 1–5 排列的图标' })
    private gemSprites: Sprite[] = [];

    @property({ type: SpriteFrame, tooltip: '空宝石孔的默认图' })
    private emptyGemFrame: SpriteFrame = null!;

    protected onLoad(): void {
        this.goodsButton.node.on(Button.EventType.CLICK, this.onEquipClick, this);
        for (const button of this.gemButtons) {
            button.node.on(Button.EventType.CLICK, this.onGemClick, this);
        }
    }

    private onEquipClick(): void {
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'equipPart', partId: this.partId });
    }

    private onGemClick(button: Button): void {
        const order = this.gemButtons.indexOf(button) + 1;
        EventMgr.instance.emit(RoleEvent.Intent, { kind: 'socket', partId: this.partId, order });
    }

    /** 红点唯一入口（0 / false = 不显示）。 */
    setRedDot(value: number | boolean): void {
        this.redDot.setRedDot(value);
    }

    renderGems(frames: readonly (SpriteFrame | null)[]): void {
        this.gemGroup.active = frames.length > 0;
        for (let index = 0; index < this.gemSprites.length; index++) {
            this.gemSprites[index].spriteFrame = frames[index] ?? this.emptyGemFrame;
            this.gemButtons[index].interactable = index < frames.length;
        }
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
        this.frameSprite.spriteFrame = frame;
        this.frameSprite.node.active = hasEquip;

        this.iconSprite.spriteFrame = icon;
        this.iconSprite.node.active = hasEquip && icon != null;

        const text = hasEquip && level > 0 ? `Lv.${level}` : '';
        this.levelLabel.string = text;
        this.levelLabel.node.active = text !== '';
    }
}
