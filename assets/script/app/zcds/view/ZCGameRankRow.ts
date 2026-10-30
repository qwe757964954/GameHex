import { _decorator, Component, Label, Sprite, type SpriteFrame } from 'cc';
import type { IRankSeat } from '../model/ZCRankBoard';
import { RANK_PLAYING_TEXT } from '../model/ZCRankBoard';

/**
 * 对局内排行榜的**一行**（prefab `ui/game/ZCGameRankRow`，628×128，行高 138 = 128 + 10 间距）。
 *
 * 行内元素与切图（设计稿坐标）：行底板 `phb_list_01/02`（**第一名单独一张高亮底**）、
 * 名次徽章 `icon_01/02/03`（**只有前三名有图**）、头像圆框 `common_txk` 96×96 + `icons/head` 头像、
 * 玩家名 Label（24.5px 深藏青 rgb(58,53,81)、左对齐不换行）、地块图标 `icon_tile` 48×50、
 * 右侧底板 `di_01`（地块数）/ `di_02`（比赛中…）。
 *
 * ## 地块数与「比赛中…」必须拆两个 Label
 *
 * 设计稿实测两者样式差异大：地块数 = 白字 24px **+黑描边**（压在 `di_01` 米色底上），
 * 「比赛中…」 = 深藏青 32px（压在 `di_02` 上）⇒ 各占一个 prefab 节点、由代码切 `enabled`。
 * 🔴 曾经共用一个 Label 按状态改 `fontSize`/`color` —— prefab 只存得下一套，
 * 虚拟列表回收复用时会残留上一态的样式。
 *
 * ## 两条易踩口径
 *
 * - `isPlaying` 为 true 时**地块数一律不显示**（不是显示 0）：对局中数字会跳变，画出来等于给假承诺。
 * - 第四名起**没有徽章图** ⇒ `badgeRoot` 关掉、`rankText` 显出来；别拿第 3 张图糊过去
 *   （那会让 4~N 名看起来都是铜牌）。
 *
 * 规则 162：视图与结构一律由 prefab 承载，这里**只做全量赋值**，不 `addComponent`、不 `new Node`。
 */
const { ccclass, property } = _decorator;

@ccclass('ZCGameRankRow')
export class ZCGameRankRow extends Component {
    @property({ type: Sprite, tooltip: 'Bg：行底板（第一名 phb_list_01，其余 phb_list_02）' })
    bg: Sprite = null;

    @property({ type: Sprite, tooltip: 'Badge：名次徽章（前三名显 icon_01/02/03，第 4 名起关掉改显数字）' })
    badgeIcon: Sprite = null;

    @property({ type: Label, tooltip: 'RankText：第 4 名起显示的纯数字名次（与徽章同位，互斥显示）' })
    rankText: Label = null;

    @property({ type: Sprite, tooltip: 'Head：头像圆框底 common_txk（运行时叠玩家头像）' })
    headFrame: Sprite = null;

    @property({ type: Sprite, tooltip: 'Head/HeadIcon：玩家头像（icons/head 的键；空则留框）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'NameText：玩家昵称' })
    nameText: Label = null;

    @property({ type: Sprite, tooltip: 'TileIcon：地块图标 icon_tile' })
    tileIcon: Sprite = null;

    @property({ type: Sprite, tooltip: 'CountBg：右侧底板（正常 di_01 / 比赛中 di_02）' })
    countBg: Sprite = null;

    @property({ type: Label, tooltip: 'CountText：地块数（白色 24px + 黑描边，与 PlayingText 互斥）' })
    countText: Label = null;

    @property({ type: Label, tooltip: 'PlayingText：「比赛中…」（深藏青 32px，与 CountText 互斥）' })
    playingText: Label = null;

    /** 当前渲染的帧缓存；空表示"还没 render 过"（虚拟列表首帧会先拿未初始化的行）。 */
    private frames: IRankRowFrames | null = null;

    /** 全量赋值。**必须同步**（虚拟列表按 index 现取行节点，见规则 55/146）。 */
    render(seat: IRankSeat, frames: IRankRowFrames): void {
        this.frames = frames;
        this.bg.spriteFrame = frames.rowBg[seat.rank === 1 ? 'first' : 'normal'];
        // 名次：前三名走徽章图，第 4 名起显数字（同位互斥）。
        //  用 `enabled` 而不是 `active` —— `active=false` 的节点不参与渲染，
        //  虚拟列表回收复用时会残留上一次的显隐状态（规则 106）。
        const hasBadge = seat.rank <= 3;
        this.badgeIcon.enabled = hasBadge;
        this.rankText.enabled = !hasBadge;
        if (hasBadge) {
            this.badgeIcon.spriteFrame = frames.rankBadge[seat.rank];
            this.rankText.string = '';
        } else {
            this.rankText.string = String(seat.rank);
        }
        // 头像：没有帧就保留 prefab 上的默认（清空会变成一个空框）。
        if (seat.headKey) {
            this.headIcon.spriteFrame = frames.head[seat.headKey] ?? this.headIcon.spriteFrame;
        }
        this.nameText.string = seat.name;
        this.tileIcon.spriteFrame = frames.tileIcon;
        // 右侧：比赛中 ⇒ di_02 + 提示文案且**不显地块数**（数字会跳变，画出来等于给假承诺）；
        // 正常 ⇒ di_01 + 数字。两个 Label 样式差异大，互斥显示，详见类注释。
        const playing = seat.isPlaying;
        this.countBg.spriteFrame = playing ? frames.countBg.playing : frames.countBg.normal;
        this.countText.enabled = !playing;
        this.playingText.enabled = playing;
        this.countText.string = playing ? '' : String(seat.territoryCount);
        this.playingText.string = playing ? RANK_PLAYING_TEXT : '';
    }
}

/**
 * 一次打开期间加载好的全部帧。
 *
 * `render` 拿到帧表才能跑 ⇒ 弹窗 `onOpen` 要**先加载完再 `setTotalCount`**，
 * 否则虚拟列表会用空帧渲染一遍再刷（表现为先闪一帧默认头像）。
 * 帧表挂在行组件上（而不是当参数层层传）是为了让 `render` 签名保持一行。
 */
export interface IRankRowFrames {
    readonly rowBg: { readonly first: SpriteFrame | null; readonly normal: SpriteFrame | null };
    readonly rankBadge: Readonly<Record<number, SpriteFrame | null>>;
    readonly head: Readonly<Record<string, SpriteFrame>>;
    readonly tileIcon: SpriteFrame | null;
    readonly countBg: { readonly normal: SpriteFrame | null; readonly playing: SpriteFrame | null };
}
