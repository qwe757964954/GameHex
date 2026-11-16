import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { HeadArt } from '../HeadArt';
import { CL_NOT_IN_RANK, numAbbrOf } from './CelebrationRepository';
import type { ICelebrationRankEntry } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/**
 * 头像加载器：虚拟列表行的异步绝对赋值守卫。
 *
 * 头像是异步的，行是 clone 复用的，同一份节点会在几帧内先后表示「第 1 名」和「第 5 名」。
 * 不加保护时第 1 名的头像会在加载完成后落到已复用成第 5 名的节点上，不报错，只是头像串行。
 *
 * 两道保护（与 `FriendAvatarLoader` 同一算法，各模块自持一份）：
 * 1. `appliedId`：同一个 id 不重复加载；
 * 2. `generation`：换 id 时递增，回调里对不上就丢弃，在途的旧结果不许落地。
 *
 * `CmdRankRole.usedSkinResId` 是头像 id，取图统一走 `HeadArt.loadHeadFrame(avatarId: string)`，
 * 不要自己拼路径：`icon.json` 的目录由包名决定，拼错是静默留白。
 * 参数是十进制字符串（`Long` 直接 `String()` 可能得到 `"[object Object]"`），调用方先用 `toIdString` 转好。
 */
export class OSAvatarLoader {
    /** 当前已生效 / 正在加载的 id。 */
    private appliedId = '';

    /** 递增代号：换 id 后旧的在途结果一律作废。 */
    private generation = 0;

    constructor(private readonly getSprite: () => Sprite) {}

    /** 铺一个头像 id；空串清空帧，不留上一行的图。 */
    apply(avatarId: string): void {
        if (avatarId === this.appliedId) return;
        this.appliedId = avatarId;
        const generation = ++this.generation;

        if (!avatarId) {
            this._setFrame(null);
            return;
        }

        void HeadArt.loadHeadFrame(avatarId).then((frame) => {
            if (generation !== this.generation) return;
            this._setFrame(frame);
        });
    }

    private _setFrame(frame: SpriteFrame | null): void {
        const sprite = this.getSprite();
        if (!sprite.isValid) return;
        sprite.spriteFrame = frame;
        sprite.node.active = !!frame;
    }
}

/**
 * 详细排名列表的一行（prefab `ui/Celebration/OSRankDetailRow`，550×130，
 * 也是 `OSRankRankDetail/HeroRow` 自己那行的模板）。
 *
 * 名次徽章：FGUI 的 `标签` 控制器有 5 页（第一名 / 第二名 / 第三名 / 第N名 / 未上榜），
 * 但老端只写了 `setSelectedPage("标签", rank == -1 ? "未上榜" : "第一名")`，
 * 只有「未上榜」（`n10`）和「第一名」（`lab`，即数字）两页真的会被选中。
 * Cocos 里就是：`rank == -1` 显示 `RankNone`、隐藏 `RankNum`，否则反过来；
 * 其余三个页名没有额外表现（没有金银铜奖章），不要照着 `pages` 去做 5 种样式。
 *
 * 战力文案用 `numAbbrOf`（老端 `StringUtil.numAbbr`），不是 `formatNumberToKMBT`。
 */
@ccclass('OSDetailRow')
export class OSDetailRow extends Component {
    @property({ type: Label, tooltip: 'RankNum：名次数字（FGUI rank/lab，标签 页 0..3）' })
    rankNum: Label = null!;

    @property({ type: Label, tooltip: 'RankNone：未上榜（FGUI rank/n10，标签 页 4）' })
    rankNone: Label = null!;

    @property({ type: Label, tooltip: 'NameText：玩家名（FGUI userName）' })
    nameText: Label = null!;

    @property({ type: Sprite, tooltip: 'HeadFrame/icon：头像（异步加载，走 HeadArt.loadHeadFrame）' })
    headIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'PowerText：战力（numAbbr）' })
    powerText: Label = null!;

    private _avatar: OSAvatarLoader = null!;

    protected onLoad(): void {
        this._avatar = new OSAvatarLoader(() => this.headIcon);
    }

    /** 铺一行。行是 clone 复用的，每一处状态都要绝对赋值。 */
    render(entry: ICelebrationRankEntry): void {
        const notInRank = entry.rank === CL_NOT_IN_RANK;
        // 显隐无条件写：prefab 里 RankNum 可见、RankNone 隐藏，未上榜是常态。
        this.rankNum.node.active = !notInRank;
        this.rankNone.node.active = notInRank;
        this.rankNum.string = notInRank ? '' : String(entry.rank);
        this.nameText.string = entry.roleName;
        this.powerText.string = numAbbrOf(entry.power);

        // 头像是异步的，走带防串行守卫的加载器；usedSkinResId <= 0 当空头像。
        this._avatar.apply(entry.usedSkinResId > 0 ? String(entry.usedSkinResId) : '');
    }
}
