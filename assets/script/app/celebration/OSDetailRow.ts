import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { HeadArt } from '../HeadArt';
import { numAbbrOf } from './CelebrationRepository';
import type { ICelebrationRankEntry } from './CelebrationRepository';

const { ccclass, property } = _decorator;

/** 未上榜的 `CmdRankRole.rank`（老端 `CL_NOT_IN_RANK`）。 */
export const OS_NOT_IN_RANK = -1;

/**
 * 头像加载器 —— 虚拟列表行的**异步绝对赋值**守卫。
 *
 * ## 为什么要单独一个类（而不是在 `render` 里直接 load）
 *
 * 头像是**异步**的，而行是**clone 复用**的：同一份节点会在几帧内先后表示「第 1 名」和
 * 「第 5 名」。不加保护的话第 1 名的头像会在加载完成后落到已经复用成第 5 名的节点上 ——
 * **不报错**，只是**头像串行**（谁先加载完谁赢）。这是「对象池复用必须绝对赋值」的异步版本。
 *
 * 两道保护（与 `FriendAvatarLoader` / `friend/FriendAvatar.ts` 同一算法，各模块自持一份）：
 *   ① `appliedId` —— 同一个 id 不重复加载（顺带把「同一行重渲染」变成零成本）；
 *   ② `generation` —— 每次换 id 递增；回调里对不上就丢弃（**在途的旧结果不许落地**）。
 *
 * ## 取图口径
 *
 * `CmdRankRole.usedSkinResId` 是**头像 id**（老端 `ModelPlayer.GetPlayerIcon(id)` →
 * `head` 表按 `resId` 查 → `icon`，查不到退 `resId=70001`）。
 * Demo3.8 里那条链的唯一入口是 `HeadArt.loadHeadFrame(avatarId: string)` ——
 * **不要自己拼路径**：`icon.json` 的目录由**包名**决定，拼错会静默留白。
 *
 * ⚠️ 参数是**字符串**（`Long` 的十进制口径，规则 23）：`Long` 直接 `String()` 可能得到
 * `"[object Object]"`，所以调用方一律先用 `toIdString` 同族口径转好再传。
 */
export class OSAvatarLoader {
    /** 当前已生效 / 正在加载的 id。 */
    private appliedId = '';

    /** 递增代号：换 id 后旧的在途结果一律作废。 */
    private generation = 0;

    constructor(private readonly getSprite: () => Sprite | null) {}

    /** 铺一个头像 id；空串 ⇒ 清空帧（不留上一行的图）。 */
    apply(avatarId: string): void {
        if (avatarId === this.appliedId) return;
        this.appliedId = avatarId;
        const generation = ++this.generation;

        if (!avatarId) {
            this._setFrame(null);
            return;
        }

        void HeadArt.loadHeadFrame(avatarId).then((frame) => {
            // 在途结果过期（行已被复用成别的名次）⇒ 直接丢弃。
            if (generation !== this.generation) return;
            this._setFrame(frame);
        });
    }

    private _setFrame(frame: SpriteFrame | null): void {
        const sprite = this.getSprite();
        if (!sprite || !sprite.isValid) return;
        sprite.spriteFrame = frame;
        sprite.node.active = !!frame;
    }
}

/**
 * 详细排名列表的**一行**（prefab `ui/Celebration/OSRankDetailRow`，550×130，
 * 也是 `OSRankRankDetail/HeroRow` 自己那行的模板）。
 *
 * ## 名次徽章：`标签` 控制器只有 5 页，老端只用了 2 页
 *
 * FGUI `组件_开服冲榜_排名.xml`：`<controller name="标签" pages="0,第一名,1,第二名,2,第三名,3,第N名,4,未上榜"/>`
 * —— 但老端 `LayerOSRankDetailUI.renderItem` 只写：
 *
 * ```ts
 * rank_com.setSelectedPage("标签", data.rank == -1 ? "未上榜" : "第一名");
 * ```
 *
 * ⇒ 只有「未上榜」（`n10`，89×60）和「第一名」（`lab`，60×60，即数字）两页真的会被选中。
 * `lab` 的 gearDisplay 是 `pages="0,1,2,3"`（前四种名次都是它），`n10` 是 `pages="4"`。
 * 所以 Cocos 里就是：**`rank == -1` ⇒ 显示 `RankNone`、隐藏 `RankNum`；否则反过来**。
 * 页名那 5 个分区在界面上**没有任何额外表现**（没有金/银/铜奖章图）——
 * 别照 `pages` 去实现 5 种样式，那是设计期留的位、运行时没用。
 *
 * ## 战力文案：`StringUtil.numAbbr`
 *
 * ⚠️ 用 `CelebrationTable.numAbbrOf`（老端 `StringUtil.numAbbr` 的逐字复刻），
 * **不是** `StringUtil.formatNumberToKMBT`（阈值差 1000 倍，见 `numAbbrOf` 的注释）。
 */
@ccclass('OSDetailRow')
export class OSDetailRow extends Component {
    @property({ type: Label, tooltip: 'RankNum：名次数字（FGUI `rank/lab`，`标签` 页 0..3）' })
    rankNum: Label = null;

    @property({ type: Label, tooltip: 'RankNone：`未上榜`（FGUI `rank/n10`，`标签` 页 4）' })
    rankNone: Label = null;

    @property({ type: Label, tooltip: 'NameText：玩家名（FGUI `userName`）' })
    nameText: Label = null;

    @property({ type: Sprite, tooltip: 'HeadFrame/icon：头像（异步加载，走 `HeadArt.loadHeadFrame`）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'PowerText：战力（`numAbbr`）' })
    powerText: Label = null;

    /** 头像加载器（`onLoad` 里建，`onEnable` 后可用）。 */
    private _avatar: OSAvatarLoader | null = null;

    protected onLoad(): void {
        this._avatar = new OSAvatarLoader(() => this.headIcon);
    }

    /**
     * 铺一行。
     *
     * ⚠️ 每一处状态都**绝对赋值**（规则 10）—— 行会被 clone 复用。
     */
    render(entry: ICelebrationRankEntry): void {
        const notInRank = entry.rank === OS_NOT_IN_RANK;
        // 🔴 显隐**无条件写**（规则 82）—— prefab 里 `RankNum` 是可见、`RankNone` 是隐藏，
        //    而「未上榜」是常态，只在翻转时写会让首次 `false === 缓存初值` 短路。
        if (this.rankNum) this.rankNum.node.active = !notInRank;
        if (this.rankNone) this.rankNone.node.active = notInRank;
        if (this.rankNum) this.rankNum.string = notInRank ? '' : String(entry.rank);
        if (this.nameText) this.nameText.string = entry.roleName;
        if (this.powerText) this.powerText.string = numAbbrOf(entry.power);

        // 头像是异步的 ⇒ 走带防串行守卫的加载器；`usedSkinResId <= 0` 当空头像。
        this._avatar?.apply(entry.usedSkinResId > 0 ? String(entry.usedSkinResId) : '');
    }
}
