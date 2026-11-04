import { _decorator, Button, Color, Label, Sprite } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 详情页技能链的一格（`SkillChain/Hex0..4` 上的组件）。
 *
 * 只持有节点引用；填写由 `CardUpgradePage.renderDetail` 统一做。
 * 点击由宿主页在 onInit 统一绑定，格子不持有业务回调。
 */
@ccclass('CardDetailHexSlot')
export class CardDetailHexSlot extends Button {
    @property({ type: Sprite, tooltip: 'HexSprite：六边形底（hex_open / hex_lock）' })
    hexSprite: Sprite = null!;

    @property({ type: Label, tooltip: 'NameLabel：格内技能名 / 未解锁' })
    nameLabel: Label = null!;

    @property({ type: Sprite, tooltip: 'Badge：左上角数字角标（hex_num_badge，可空）' })
    badgeSprite: Sprite | null = null;

    @property({ type: Label, tooltip: 'BadgeLabel：角标数字（解锁等级，可空）' })
    badgeLabel: Label | null = null;

    @property({ type: Color })
    unlockedColor: Color = new Color(255, 239, 202, 255);
}
