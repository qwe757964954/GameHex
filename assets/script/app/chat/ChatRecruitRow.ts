/**
 * 「聊天 · 招募」列表里的**一行**（`530×259`）—— 频道 0（招募）专用。
 *
 * 真源 = FGUI `聊天/组件/组件_聊天_招募项.xml`。节点结构：
 *
 * ```
 * ChatRecruitRow (530×259)
 * ├─ Bg          Sprite   ct_recruit_bg（九宫格）
 * ├─ Head        Node     ← 位置随「自己 / 别人」变
 * │   ├─ Frame   Sprite   img_Touxiang_01（头像框）
 * │   └─ Icon    Sprite   运行时按 img 加载
 * ├─ Name        Label    玩家名（自己右对齐、别人左对齐）
 * └─ InfoGroup   Node     ← 整组随「自己 / 别人」平移（FGUI `group n77` 的 gearXY）
 *     ├─ Stage   Label    关卡名（1-1-藏宝海湾）
 *     ├─ Declare Label    宣言（老端恒写空串）
 *     ├─ Power   Label    战力：3833
 *     └─ JoinBtn Button   点击加入
 * ```
 *
 * ## 为什么「自己」用代码挪位置，而不是两份 prefab
 *
 * FGUI 原稿是靠 `自己` 控制器的 4 处 `gearXY` 切档的（底板 / 头像 / 名字 / 组）。
 * Cocos 没有 controller ⇒ 与 `FriendRow.shiftGroup` 同一处置：
 * **两档坐标进 `ChatTable.recruitLayout()`（纯函数、可单测），本类只负责 `setPosition`。**
 * prefab 里存的是「别人」那一档（= FGUI 的 `default`）。
 *
 * ## 三处易漏（都不报错、只是看着不对）
 *
 * ① `Head` 必须整节点挪（框 + 头像一起），只挪 `Icon` 会「框走了头像没走」；
 * ② `Name` 的对齐方式要跟着换 —— 老端 `tf.align = isSelf ? RIGHT : LEFT`，
 *    只挪位置不换对齐，名字会贴着底板边缘往外溢；
 * ③ `InfoGroup` 是**整组**平移，组内 4 件坐标不变（FGUI 的 `gearXY` 作用在组上）。
 */

import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';
import { recruitLayout } from './ChatTable';

const { ccclass, property } = _decorator;

@ccclass('ChatRecruitRow')
export class ChatRecruitRow extends Component {
    @property({ type: Sprite, tooltip: 'Bg：招募项底板（ct_recruit_bg，九宫格）' })
    background: Sprite = null!;

    @property({ type: Node, tooltip: 'Head：头像框整节点（框 + 头像一起挪）' })
    headNode: Node = null!;

    @property({ type: Sprite, tooltip: 'Head/Icon：头像（运行时按 img 加载）' })
    headIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Name：玩家名（自己右对齐、别人左对齐）' })
    nameLabel: Label = null!;

    @property({ type: Node, tooltip: 'InfoGroup：关卡名 / 宣言 / 战力 / 加入按钮 的容器（整组平移）' })
    infoGroup: Node = null!;

    @property({ type: Label, tooltip: 'InfoGroup/Stage：关卡名（如 1-1-藏宝海湾）' })
    stageLabel: Label = null!;

    @property({ type: Label, tooltip: 'InfoGroup/Declare：宣言（老端恒写空串）' })
    declareLabel: Label = null!;

    @property({ type: Label, tooltip: 'InfoGroup/Power：战力文案' })
    powerLabel: Label = null!;

    @property({ type: Node, tooltip: 'InfoGroup/JoinBtn：点击加入（挂 cc.Button）' })
    joinButton: Node = null!;

    @property({ type: Label, tooltip: 'InfoGroup/JoinBtn/Label：按钮文案' })
    joinLabel: Label = null!;

    /**
     * 两个回调，**由宿主在每次铺行时重设**（`ChatPage.renderRecruitRow`）。
     *
     * ⚠️ 不能在 `render()` 里绑监听：同一个实例会被虚拟列表复用到别的下标，
     * 回调里必须按 `index` 现取当前行，否则会「点第 3 行加入了第 1 个队伍」。
     */
    onJoin: (() => void) | null = null;
    onHead: (() => void) | null = null;

    /** 头像异步加载器（防「虚拟列表复用 ⇒ 头像串行」，见 `FriendAvatar` 文件头）。 */
    private avatar: FriendAvatarLoader | null = null;

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.headIcon);
        this.joinButton.on(Button.EventType.CLICK, this.emitJoin, this);
        this.headNode.on(Node.EventType.TOUCH_END, this.emitHead, this);
    }

    /**
     * 铺一行。**所有状态绝对赋值**（虚拟列表 clone 复用，条件式赋值会把上一行的状态带过来）。
     *
     * @param name      玩家名
     * @param stageName 关卡名（`ChatRepository` 已解析好；空串时只关节点不清框）
     * @param powerText 战力文案
     * @param avatarId  头像 id（空串 = 清空帧，**不能留着上一行的图**）
     * @param isSelf    是不是我自己（决定两档版面 + 名字对齐 + 按钮可用性）
     * @param buttonText 按钮文案（唯一来源 `ChatTexts.joinTeam`）
     */
    render(
        name: string,
        stageName: string,
        powerText: string,
        avatarId: string,
        isSelf: boolean,
        buttonText: string,
    ): void {
        const layout = recruitLayout(isSelf);

        this.background.node.setPosition(layout.background.x, layout.background.y, 0);
        this.headNode.setPosition(layout.head.x, layout.head.y, 0);
        this.nameLabel.node.setPosition(layout.name.x, layout.name.y, 0);
        this.infoGroup.setPosition(layout.infoGroup.x, layout.infoGroup.y, 0);

        this.nameLabel.string = name;
        this.nameLabel.horizontalAlign = layout.nameAlign === 'right'
            ? Label.HorizontalAlign.RIGHT
            : Label.HorizontalAlign.LEFT;

        this.stageLabel.string = stageName;
        // 老端 `item.tm("宣言").setText("")` —— 逐字照抄：**恒空**，不是没写完
        this.declareLabel.string = '';
        this.powerLabel.string = powerText;

        this.avatar?.apply(avatarId);

        this.joinLabel.string = buttonText;
        const button = this.joinButton.getComponent(Button);
        if (button) button.interactable = !isSelf;
    }

    /** 整行藏掉（列表数据不足时由宿主调用）。 */
    hide(): void {
        this.node.active = false;
    }

    private emitJoin(): void {
        this.onJoin?.();
    }

    private emitHead(): void {
        this.onHead?.();
    }

    protected onDestroy(): void {
        this.avatar?.invalidate();
        this.avatar = null;
    }
}
