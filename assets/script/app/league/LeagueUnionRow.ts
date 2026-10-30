/**
 * 「联盟 · 大厅 · 全服联盟」列表里的**一行联盟** —— `660×113`
 * （`ui/League/LeagueHall.prefab` 的 `TabAllServer/ServerList/content/ServerRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_联盟item.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n6` 行底框 `frame_Zhikuang01`（155×113 九宫格） | 本节点自己的 `cc.Sprite` | 显示 660×113 |
 * | `banner`（`组件_联盟_旗帜` 179×196，`scale=0.54`） | `Banner` | 与母面板头部同一套旗（Frame / Base / ColorIcon） |
 * | `lab_name`（25px `#1b1410` 居中） | `Name` | |
 * | `lab_lv`（25px `#1b1410` 居中） | `Level` | 已带「级」后缀（数据层拼好） |
 * | `lab_topuser`（25px `#1b1410` 左对齐） | `Leader` | `盟主:xxxx` |
 * | `lab_usercount`（25px `#1b1410`，`leading=-2`） | `Member` | `成员:45/46` |
 *
 * ## 旗面是「按颜色下标换图」而不是染色
 *
 * FGUI 用 `gearIcon controller="颜色"` 在 8 张 `img_Qizhi_0X` 之间**换图**
 * （不是给同一张图染 8 种色）⇒ 落地也照换图走：宿主用
 * `LeagueArt.leagueBannerArt(view.icon)` 取图名再 `loadArt`，拿到 frame 交给 `applyBanner`。
 *
 * ⚠️ 换图是**异步**的、而槽位会被虚拟列表复用 ⇒ 与 `LeagueMemberRow` 同一套令牌口径。
 */

import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import type { ILeagueUnionView } from './LeagueTable';

const { ccclass, property } = _decorator;

@ccclass('LeagueUnionRow')
export class LeagueUnionRow extends Component {
    @property({ type: Label, tooltip: 'lab_name：联盟名（25px 居中）' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_lv：等级（已带「级」后缀）' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_topuser：盟主:xxxx' })
    leaderLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_usercount：成员:45/46' })
    memberLabel: Label = null;

    @property({ type: Sprite, tooltip: 'banner/ColorIcon：旗面（按 view.icon 换图）' })
    bannerColor: Sprite = null;

    /** 当前铺在这一行上的联盟 id（点击时宿主用它去开「联盟信息」）。 */
    private current: ILeagueUnionView | null = null;

    /** 旗面令牌：每次 `render` 自增，用来作废在飞的换图结果。 */
    private bannerSeq = 0;

    /** 当前行的联盟 id（没铺数据时为空串）。 */
    get unionId(): string {
        return this.current?.id ?? '';
    }

    /** 铺一行（所有状态**绝对赋值**）。传 `null` 等价于藏掉整行。 */
    render(view: ILeagueUnionView | null): void {
        this.current = view;
        this.bannerSeq += 1;

        if (!view) {
            this.hide();
            return;
        }

        this.nameLabel.string = view.name;
        this.levelLabel.string = view.levelText;
        this.leaderLabel.string = view.leaderText;
        this.memberLabel.string = view.memberText;

        // 先清旗面：槽位复用，不清会顶着上一行的颜色闪一下
        if (this.bannerColor) this.bannerColor.spriteFrame = null;
    }

    /** 本次铺行对应的旗面令牌。 */
    get bannerToken(): number {
        return this.bannerSeq;
    }

    /** 旗面异步返回时调用（令牌对不上说明槽位已被下一行占用 ⇒ 丢弃）。 */
    applyBanner(frame: SpriteFrame | null, token: number): void {
        if (token !== this.bannerSeq) return;
        if (this.bannerColor) this.bannerColor.spriteFrame = frame;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.current = null;
        this.node.active = false;
    }
}
