import { _decorator, Button, Color, Label, Node, Sprite, SpriteFrame, UITransform, Widget } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 详情页技能链滚动列表的一格。
 *
 * 填写由 `CardUpgradePage.renderDetail` 统一做，拖动交给外层列表。
 * 点击由宿主页在创建条目时绑定，格子不持有业务回调。
 */
@ccclass('CardDetailHexSlot')
export class CardDetailHexSlot extends Button {
    skillId = 0;
    @property({ type: Sprite, tooltip: 'HexSprite：六边形底（hex_open / hex_lock）' })
    hexSprite: Sprite = null!;

    @property(Sprite)
    skillArt: Sprite = null!;

    @property(Node)
    lockRoot: Node = null!;

    @property(Sprite)
    namePlate: Sprite = null!;

    @property(SpriteFrame)
    normalNamePlateFrame: SpriteFrame = null!;

    @property(SpriteFrame)
    activeNamePlateFrame: SpriteFrame = null!;

    @property(UITransform)
    namePlateTransform: UITransform = null!;

    @property(UITransform)
    badgeTransform: UITransform = null!;

    @property(Widget)
    badgeWidget: Widget = null!;

    @property({ type: Label, tooltip: 'NameLabel：格内技能名 / 未解锁' })
    nameLabel: Label = null!;

    @property(UITransform)
    nameTransform: UITransform = null!;

    @property({ type: Sprite, tooltip: 'Badge：左上角数字角标（hex_num_badge，可空）' })
    badgeSprite: Sprite | null = null;

    @property({ type: Label, tooltip: 'BadgeLabel：角标数字（解锁等级，可空）' })
    badgeLabel: Label | null = null;

    @property({ type: Color })
    unlockedColor: Color = new Color(255, 239, 202, 255);

}
