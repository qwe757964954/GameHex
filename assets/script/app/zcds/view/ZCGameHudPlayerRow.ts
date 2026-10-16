import { _decorator, Color, Component, Label, Sprite, SpriteFrame, UITransform } from 'cc';
import { zcFactionColor } from './ZCTheme';
import type { ZCOwner } from '../model/ZCMapConfig';

/**
 * 对局 HUD 左侧的玩家行（设计稿条目 308×88）。
 *
 * 三处「按席位」（由 `owner` 决定，不再用行号）：
 *  1. 圆盘图：`player → zd_txk_01`，`enemy/2/3 → zd_txk_02/03/04`；
 *  2. 圆盘/头像尺寸两档：我方 88/74，其余三席 77/66（必须跟着换，否则小图被撑或圆环只剩 1.5px）；
 *  3. 名字颜色：取 `zcFactionColor(owner)`（工程「席位色」唯一真源；设计稿四行都是深藏青，
 *     按席位配色是产品要求，便于把行和棋盘上的颜色对上）。
 */
const { ccclass, property } = _decorator;

/** 一行的渲染数据。字段都可空 —— 空就是"这一行没有这个信息"。 */
export interface IHudPlayerRowData {
    /** 席位（决定圆盘图、两处尺寸与名字颜色）。 */
    readonly owner: ZCOwner;
    /** 玩家名（空串则什么都不显示）。 */
    readonly name: string;
    /** 头像帧（`icons/head` 已加载好的 SpriteFrame；null 则保留 prefab 默认）。 */
    readonly head: SpriteFrame | null;
    /** 兵力文字 `14/100`；`null` 表示这一行不显示兵力（只有我方那一行显示）。 */
    readonly unitText: string | null;
    /** 两个 buff 的帧（null 各自隐藏）。 */
    readonly buffA: SpriteFrame | null;
    readonly buffB: SpriteFrame | null;
}

@ccclass('ZCGameHudPlayerRow')
export class ZCGameHudPlayerRow extends Component {
    /** 我方圆盘/头像边长（设计稿 88×88 与头像 74×74）。 */
    private static readonly SELF_DISC_SIZE = 88;
    private static readonly SELF_HEAD_SIZE = 74;
    /** 其余三席的圆盘/头像边长（77×77 与 66×66）。 */
    private static readonly OTHER_DISC_SIZE = 77;
    private static readonly OTHER_HEAD_SIZE = 66;

    @property({ type: Sprite, tooltip: 'HeadFrame：头像圆盘（图按席位换）' })
    headFrame: Sprite = null!;

    @property({ type: UITransform, tooltip: 'HeadFrame 的 UITransform（圆盘尺寸按席位换）' })
    discRect: UITransform = null!;

    @property({ type: Sprite, tooltip: 'HeadFrame/HeadIcon：玩家头像（icons/head 的键）' })
    headIcon: Sprite = null!;

    @property({ type: UITransform, tooltip: 'HeadIcon 的 UITransform（头像尺寸按席位换）' })
    headRect: UITransform = null!;

    @property({ type: Label, tooltip: 'NameText：玩家名（左对齐不换行，颜色按席位）' })
    nameText: Label = null!;

    @property({ type: Sprite, tooltip: 'Info/UnitIcon：兵力图标 zd_icon_shibing' })
    unitIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Info/UnitText：兵力 14/100' })
    unitText: Label = null!;

    @property({ type: Sprite, tooltip: 'Info/Buff1：第一个 buff' })
    buffA: Sprite = null!;

    @property({ type: Sprite, tooltip: 'Info/Buff2：第二个 buff' })
    buffB: Sprite = null!;

    // 四张圆盘图（`zd_txk_01~04`），按席位显式绑定（Inspector 拖拽约定不支持数组属性）。
    @property({ type: SpriteFrame, tooltip: 'zd_txk_01：我方圆盘' })
    disc01: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: 'zd_txk_02：2 号席位圆盘' })
    disc02: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: 'zd_txk_03：3 号席位圆盘' })
    disc03: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: 'zd_txk_04：4 号席位圆盘' })
    disc04: SpriteFrame = null!;

    /**
     * 全量赋值（列表刷新每帧调）。条目复用（虚拟列表回收），字段必须显式写、
     * 不能"没变就跳过"，否则残留上一席的显示。
     */
    render(data: IHudPlayerRowData): void {
        // 圆盘：图与尺寸都按席位换。
        const frame = this.discOf(data.owner);
        if (frame) this.headFrame.spriteFrame = frame;
        const isSelf = data.owner === 'player';
        const discSize = isSelf
            ? ZCGameHudPlayerRow.SELF_DISC_SIZE : ZCGameHudPlayerRow.OTHER_DISC_SIZE;
        const headSize = isSelf
            ? ZCGameHudPlayerRow.SELF_HEAD_SIZE : ZCGameHudPlayerRow.OTHER_HEAD_SIZE;
        this.discRect.setContentSize(discSize, discSize);
        this.headRect.setContentSize(headSize, headSize);

        // 头像：没帧就保留上一张（清空会变成空框）。
        if (data.head) this.headIcon.spriteFrame = data.head;

        // 名字：文字 + 席位色。
        this.nameText.string = data.name;
        const tint = zcFactionColor(data.owner);
        this.nameText.color = new Color(tint.r, tint.g, tint.b, tint.a);

        // 兵力整组同显同隐：用 active 一次收掉图标+文字两个组件，避免"图标灭文字还在"。
        const hasUnits = data.unitText !== null && data.unitText !== '';
        this.unitIcon.node.active = hasUnits;
        this.unitText.node.active = hasUnits;
        if (hasUnits) this.unitText.string = data.unitText!;

        // 两个 buff 各自判空。
        this.buffA.node.active = data.buffA !== null;
        if (data.buffA) this.buffA.spriteFrame = data.buffA;
        this.buffB.node.active = data.buffB !== null;
        if (data.buffB) this.buffB.spriteFrame = data.buffB;
    }

    /** 席位 → 圆盘图。 */
    private discOf(owner: ZCOwner): SpriteFrame | null {
        if (owner === 'player') return this.disc01;
        if (owner === 'enemy') return this.disc02;
        if (owner === 'enemy2') return this.disc03;
        return this.disc04;
    }
}
