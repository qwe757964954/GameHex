/**
 * 「联盟 · 大厅 · 详情」列表里的**一行成员** —— `662×109`
 * （`ui/League/LeagueHall.prefab` 的 `TabDetail/DetailList/content/MemberRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_联盟角色item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n6` 行底框 `frame_Zhikuang01`（155×113 九宫格） | 本节点自己的 `cc.Sprite` | 显示 662×109 |
 * | `n8` 头像外框 `img_Touxiang_01`（73×73） | `HeadFrame` | 静态 |
 * | `icon` 头像 loader（80×80，`fill=scaleFree`） | `Avatar` | 运行时按 `view.img` 取图 |
 * | `n10` 等级徽章 `lt_pic07`（47×47） | `LevelBadge` | 静态，压在 `lab_lv` 下 |
 * | `lab_lv`（24px `#fcf0d6` 居中 + 描边） | `Level` | 纯数字，**不带「级」后缀** |
 * | `n11` 战力条底 `zx_zl_pic01`（113×27） | `PowerBar` | 静态，压在 `lab_power` 下 |
 * | `lab_power`（13px `#fcf0d6` + 描边） | `Power` | 战力数字 |
 * | `lab_name`（26px `#1b1410` 左对齐） | `Name` | |
 * | `lab_time`（25px `#1b1410` 居中） | `Time` | 「在线」或「N分/小时/天前」 |
 * | `n18`（25px `#1b1410`，静态 `text="成员:"`） | `ContributePrefix` | **写死的静态文本**，见 `LeagueTexts.LEAGUE_MEMBER_ROW_PREFIX` |
 * | `lab_usercount`（26px `#1b1410` 居中） | `Contribute` | `今日贡献/累计贡献` |
 * | `n14` 职务标 `lm_pic04`（57×75） | `PositionTag` | `gearDisplay pages="1,2"` ⇒ 仅盟主 / 副盟主可见 |
 * | `n15` 职务字（22px `#dbd4c5` shrink + 描边） | `Position` | 盟主 / 副盟主 |
 *
 * ## 三个容易踩的点
 *
 * 1. **整行会被虚拟列表 clone 复用** ⇒ `render()` 里每一处状态都要**绝对赋值**
 *    （含「普通成员行把 `PositionTag` 关掉」这种「不显示」也要显式写），
 *    否则上一行的残留会留在复用槽位上。
 * 2. **头像异步加载要防串行**：等图回来时槽位可能已经被下一行复用 ⇒ 用 `avatarSeq`
 *    做令牌，`applyAvatar` 只认最后一次 `render` 发出的序号（同 `LeagueLevelPreviewPage` 的 `revision` 思路）。
 * 3. `lab_lv` 只有数字、`lab_power` 只有数字 —— FGUI 原稿如此，**不要**自己补「级」/「战力」后缀。
 */

import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { LeaguePosition, type ILeagueMemberView } from './LeagueTable';
import { LEAGUE_POSITION_ADMIN, LEAGUE_POSITION_LEADER } from './LeagueTexts';

const { ccclass, property } = _decorator;

@ccclass('LeagueMemberRow')
export class LeagueMemberRow extends Component {
    @property({ type: Label, tooltip: 'lab_name：成员名（26px 左对齐）' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_lv：等级（纯数字，无后缀）' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_power：战力（纯数字）' })
    powerLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_time：「在线」或「N分/小时/天前」' })
    timeLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_usercount：今日贡献/累计贡献' })
    contributeLabel: Label = null;

    @property({ type: Label, tooltip: 'n15：职务字（盟主 / 副盟主）' })
    positionLabel: Label = null;

    @property({ type: Sprite, tooltip: 'icon：头像（宿主按 view.img 取图后调 applyAvatar）' })
    avatarSprite: Sprite = null;

    @property({ type: Node, tooltip: 'n14：职务标底图（仅盟主 / 副盟主显示）' })
    positionTag: Node = null;

    /** 当前铺在这一行上的成员（`roleId` 供宿主做「是不是自己」的判断）。 */
    private current: ILeagueMemberView | null = null;

    /** 头像令牌：每次 `render` 自增，用来作废在飞的头像结果。 */
    private avatarSeq = 0;

    /** 当前行的 `roleId`（没铺数据时为空串）。 */
    get roleId(): string {
        return this.current?.roleId ?? '';
    }

    /** 当前行是不是盟主 / 副盟主（供宿主提示「查看自己」等）。 */
    get hasPosition(): boolean {
        return this.current != null && this.isLeaderOrAdmin(this.current);
    }

    /**
     * 铺一行（所有状态**绝对赋值**）。
     *
     * 传 `null` 等价于藏掉整行 —— 列表数据不够时宿主可以直接 `render(null)`，
     * 不必再单独调 `hide()`。
     */
    render(view: ILeagueMemberView | null): void {
        this.current = view;
        this.avatarSeq += 1;

        if (!view) {
            this.hide();
            return;
        }

        this.nameLabel.string = view.name;
        this.levelLabel.string = view.levelText;
        this.powerLabel.string = view.powerText;
        this.timeLabel.string = view.timeText;
        this.contributeLabel.string = view.contributeText;

        const showPosition = this.isLeaderOrAdmin(view);
        const isAdmin = view.position === LeaguePosition.ADMIN;
        if (this.positionTag) this.positionTag.active = showPosition;
        if (this.positionLabel) {
            this.positionLabel.node.active = showPosition;
            // ⚠️ 不显示时把字**清掉**：节点虽 `active=false`，但槽位是复用的、
            //    留着「盟主」会让「探针/核对器读到的字符串」与「肉眼所见」对不上（排查时极易误判）。
            this.positionLabel.string = showPosition
                ? (isAdmin ? LEAGUE_POSITION_ADMIN : LEAGUE_POSITION_LEADER)
                : '';
        }

        // 先清头像：槽位是复用的，不清的话新行会短暂顶着上一行的头像
        if (this.avatarSprite) this.avatarSprite.spriteFrame = null;
    }

    /** 本次铺行对应的头像令牌（宿主取图时带走，回来时原样交给 `applyAvatar`）。 */
    get avatarToken(): number {
        return this.avatarSeq;
    }

    /**
     * 头像异步返回时调用。
     *
     * ⚠️ 令牌对不上说明这个槽位已经被**下一行**占用了 ⇒ 直接丢弃，
     *    否则会把 A 的头像贴到 B 身上。
     */
    applyAvatar(frame: SpriteFrame | null, token: number): void {
        if (token !== this.avatarSeq) return;
        if (this.avatarSprite) this.avatarSprite.spriteFrame = frame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }

    private isLeaderOrAdmin(view: ILeagueMemberView): boolean {
        return view.position === LeaguePosition.LEADER || view.position === LeaguePosition.ADMIN;
    }
}
