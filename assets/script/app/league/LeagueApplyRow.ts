/**
 * 「联盟 · 申请列表」里的一行申请 —— `540×128`
 * （`ui/League/LeagueApplyList.prefab` 的 `ApplyListView/content/ApplyRow`）。
 *
 * 结构逐节点对齐 FGUI `主界面_联盟/组件/组件_联盟_联盟角色申请.xml`：
 *
 * | FGUI 节点 | 本节点 | 说明 |
 * |---|---|---|
 * | `n6` 行底框 `frame_Zhikuang01`（155×113 九宫格，显示 **540×128**） | 本节点自己的 `cc.Sprite` | 九宫格 |
 * | `n9` 头像 loader（84×84，`fill=scaleFree`） | `Avatar` | 运行时按 `view.img` 取图 |
 * | `n8` 头像外框 `img_Touxiang_01`（73×73） | `HeadFrame` | 静态，压在头像之上 |
 * | `n10` 等级徽章 `lt_pic07`（48×47） | `LevelBadge` | 静态，压在 `Level` 下 |
 * | `n2` `lab_lv`（24px `#fcf0d6` 居中 + 描边） | `Level` | 纯数字，**不带「级」后缀** |
 * | `n11` 战力条底 `zx_zl_pic01`（113×27） | `PowerBar` | 静态，压在 `Power` 下 |
 * | `n12` 战力条左端小徽记 `bb_pic13`（34×33，显示 scale 0.8） | `PowerDeco` | ⚠️ **详情行没有这个节点** |
 * | `n13` `lab_power`（22px `#fcf0d6` + 描边） | `Power` | 战力数字 |
 * | `n1` `lab_name`（26px `#3a1e08` 左对齐） | `Name` | 申请人名 |
 * | `n16` `btn_kick`（`按钮_公共_通用`，`TY_btn07`，显示 scale 0.8） | `RejectBtn` | ⚠️ 文案「拒绝」，发 `agree=false` |
 * | `n17` `btn_sure`（`按钮_公共_通用`，`TY_btn10`，显示 scale 0.8） | `AgreeBtn` | 文案「同意」，发 `agree=true` |
 *
 * ## 与详情行（`LeagueMemberRow`）的三处**必须区别对待**
 *
 * 1. **行宽不同**：FGUI 这个组件的 `<component size>` 写的是 `662,109`（**与详情行一样**），
 *    但行底框 `n6` 却是 `540×128`，而外层列表 `requestList` 正好也是 **540 宽**
 *    （`组件_联盟_大厅_申请列表.xml`：`(90,349) 540×446`）——即底框宽度**精确等于**列表视口宽度。
 *    所以这里的真值是「**底框定义的那块 540×128**」，`662,109` 是设计稿从详情行复制过来的残留
 *    （`designImageOffsetX="-38"` 也是那时候留下的）。本端按 **540×128** 落，
 *    行内所有坐标按「底框左上角为原点」折算（见下表口径注释）。
 *    ——若照抄 662，`VirtualScrollView` 的槽位是**水平居中**放进 content 的（`n.parent = content`
 *    保留局部 x），底框会整体左移 61px、右边空一截。
 * 2. **等级 / 战力只有数字**（同详情行），FGUI 原稿如此，**不要**自己补「级」/「战力」后缀。
 * 3. **两个按钮的语义与底图别按名字接**：`btn_kick` 是**拒绝**（`TY_btn07`）、
 *    `btn_sure` 是**同意**（`TY_btn10` / 亮）—— 老端 `renderApply` 里
 *    `btn_kick → RequestLeagueApproveJoin(applyId, false)`、`btn_sure → (applyId, true)` 可证。
 *    ⚠️ 底图**不是**弹窗按钮那对 `TY_btn09/TY_btn10`：申请行两个按钮的 FGUI `icon` 分别是
 *    `ui://w3m64m87n44q1yxnaki`（回查 `package.xml` = `TY_btn07`）与 `…hknq1yxnakl`（= `TY_btn10`）
 *    —— 即**拒绝用的是和角色操作浮层同一张「中性」底图**，只有同意是亮色底。
 *    写成 `TY_btn09` 会与设计稿不符（两张底图一个亮一个暗，肉眼可辨）。
 *
 * ## 坐标折算口径
 *
 * 以 FGUI 底框 `n6` 的矩形 `(0,3)-(540,131)` 为行盒（540×128），行锚点 `(0.5,0.5)`：
 *
 * ```
 * rel.x = fx + w/2 − 270
 * rel.y = 67 − (fy + h/2)          // 67 = 3 + 128/2 = 底框竖向中点
 * ```
 *
 * ## 为什么两个按钮的点击由**行脚本自己**接
 *
 * 整行会被虚拟列表 clone 复用（`VScrollView` 的槽位池），宿主要在 `renderItemFn` 里
 * **每帧现取**数据、**不能**按 index 捕获回调。行脚本在 `onLoad` 里绑一次自己的按钮，
 * 点击时读 `this.current` —— 槽位复用到哪一行就读哪一行，天然不会串。
 * （与 `LeagueOpsBar` 同一套口径：组件自己接按钮，只把「点了什么」回调出去。）
 */

import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { ILeagueApplyView } from './LeagueTable';

const { ccclass, property } = _decorator;

/** 行内的两种审批动作（宿主据此发包）。 */
export type LeagueApplyAction = 'agree' | 'reject';

@ccclass('LeagueApplyRow')
export class LeagueApplyRow extends Component {
    @property({ type: Label, tooltip: 'lab_name：申请人名（26px 左对齐）' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_lv：等级（纯数字，无后缀）' })
    levelLabel: Label = null;

    @property({ type: Label, tooltip: 'lab_power：战力（纯数字）' })
    powerLabel: Label = null;

    @property({ type: Sprite, tooltip: 'icon：头像（宿主按 view.img 取图后调 applyAvatar）' })
    avatarSprite: Sprite = null;

    @property({ type: Node, tooltip: 'btn_sure：同意（⚠️ 发 agree=true）' })
    agreeButton: Node = null;

    @property({ type: Node, tooltip: 'btn_kick：拒绝（⚠️ 名字叫 kick，语义是「拒绝」、发 agree=false）' })
    rejectButton: Node = null;

    /** 点「同意 / 拒绝」的回调（`view` 是**点击那一刻**这一槽位上的行数据）。 */
    onAction: ((action: LeagueApplyAction, view: ILeagueApplyView) => void) | null = null;

    /** 点头像的回调（老端 `CtrlMgr.CtrlPlayer.openOtherPlayerInfo(...)` —— 看申请人的信息）。 */
    onAvatar: ((view: ILeagueApplyView) => void) | null = null;

    /** 当前铺在这一行上的申请（`null` = 空槽）。 */
    private current: ILeagueApplyView | null = null;

    /** 头像令牌：每次 `render` 自增，用来作废在飞的头像结果。 */
    private avatarSeq = 0;

    private bound = false;

    protected onLoad(): void {
        this.bind();
    }

    /** 当前行的 `applyId`（没铺数据时为空串）。 */
    get applyId(): string {
        return this.current?.applyId ?? '';
    }

    /** 当前行的数据（供宿主在回调外用）。 */
    get view(): ILeagueApplyView | null {
        return this.current;
    }

    /**
     * 铺一行（所有状态**绝对赋值**）。
     *
     * 传 `null` 等价于藏掉整行 —— 数据不够时宿主可以直接 `render(null)`。
     */
    render(view: ILeagueApplyView | null): void {
        this.current = view;
        this.avatarSeq += 1;

        if (!view) {
            this.hide();
            return;
        }

        if (this.nameLabel) this.nameLabel.string = view.name;
        if (this.levelLabel) this.levelLabel.string = view.levelText;
        if (this.powerLabel) this.powerLabel.string = view.powerText;

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
     * ⚠️ 令牌对不上说明这个槽位已经被**下一行**占用了 ⇒ 直接丢弃，否则会把 A 的头像贴到 B 身上。
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

    /** 两个按钮 + 头像，各接一次（克隆体各绑自己的，`bound` 保证只绑一次）。 */
    private bind(): void {
        if (this.bound) return;
        this.bound = true;
        this.bindClick(this.agreeButton, () => this.emit('agree'));
        this.bindClick(this.rejectButton, () => this.emit('reject'));
        this.bindClick(this.avatarSprite ? this.avatarSprite.node : null, () => {
            const view = this.current;
            if (view && this.onAvatar) this.onAvatar(view);
        });
    }

    private bindClick(node: Node | null, handler: () => void): void {
        if (!node) {
            console.warn('[LeagueApplyRow] 行内某个可点节点缺失（生成器漏了？），该处点击不会生效');
            return;
        }
        const button = node.getComponent(Button);
        if (button) button.node.on(Button.EventType.CLICK, handler, this);
        else node.on(Node.EventType.TOUCH_END, handler, this);
    }

    /** 只有一个「点了什么」出口：空槽（`current === null`）时按一次不发。 */
    private emit(action: LeagueApplyAction): void {
        const view = this.current;
        if (!view) return;
        if (this.onAction) this.onAction(action, view);
    }
}
