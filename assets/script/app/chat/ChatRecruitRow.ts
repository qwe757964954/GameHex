/**
 * 「聊天 · 招募」列表里的一行（530×259）—— 频道 0 专用。
 *
 * 节点结构（对齐 FGUI `组件_聊天_招募项`）：
 *
 * ```
 * ChatRecruitRow
 * ├─ Bg          Sprite   ct_recruit_bg（九宫格）
 * ├─ Head        Node     ← 整节点随「自己 / 别人」平移
 * │   ├─ Frame   Sprite   img_Touxiang_01
 * │   └─ Icon    Sprite   运行时按 img 加载
 * ├─ Name        Label    玩家名（自己右对齐、别人左对齐）
 * └─ InfoGroup   Node     ← 整组随「自己 / 别人」平移
 *     ├─ Stage   Label    关卡名
 *     ├─ Declare Label    宣言（老端恒写空串）
 *     ├─ Power   Label    战力文案
 *     └─ JoinBtn Button   点击加入
 * ```
 *
 * 「自己」态靠代码挪位置：FGUI 用 controller 的 `gearXY` 切档，Cocos 没有 controller，
 * 因此两档坐标放在 prefab 的 `SelfLayout` 子节点上（与 `FriendRow` 用锚点节点的处置一致），
 * 本类只负责 `setPosition`。三处易漏：
 * ① `Head` 要整节点挪，只挪 `Icon` 会「框走了头像没走」；
 * ② `Name` 的对齐方式要跟着换，否则名字贴到板边溢出；
 * ③ `InfoGroup` 是整组平移，组内 4 件坐标不变。
 *
 * 改 prefab 里这些坐标时注意 FGUI 的两个约定：`xy` 是 `pivot` 轴心点而非左上角；
 * `scale` 围绕 `pivot` 缩放，`xy` 仍是缩放前的左上角。
 */

import { _decorator, Button, Component, Label, Node, Sprite, Vec3 } from 'cc';
import { FriendAvatarLoader } from '../friend/FriendAvatar';

const { ccclass, property } = _decorator;

@ccclass('ChatRecruitRow')
export class ChatRecruitRow extends Component {
    @property({ type: Sprite, tooltip: 'Bg：招募项底板（ct_recruit_bg，九宫格）' })
    background: Sprite = null;

    @property({ type: Node, tooltip: 'Head：头像框整节点（框 + 头像一起挪）' })
    headNode: Node = null;

    @property({ type: Sprite, tooltip: 'Head/Icon：头像（运行时按 img 加载）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'Name：玩家名（自己右对齐、别人左对齐）' })
    nameLabel: Label = null;

    @property({ type: Node, tooltip: 'InfoGroup：关卡名 / 宣言 / 战力 / 加入按钮的容器（整组平移）' })
    infoGroup: Node = null;

    @property({ type: Label, tooltip: 'InfoGroup/Stage：关卡名' })
    stageLabel: Label = null;

    @property({ type: Label, tooltip: 'InfoGroup/Declare：宣言（老端恒写空串）' })
    declareLabel: Label = null;

    @property({ type: Label, tooltip: 'InfoGroup/Power：战力文案' })
    powerLabel: Label = null;

    @property({ type: Node, tooltip: 'InfoGroup/JoinBtn：点击加入（挂 cc.Button）' })
    joinButton: Node = null;

    @property({ type: Label, tooltip: 'InfoGroup/JoinBtn/Label：按钮文案' })
    joinLabel: Label = null;

    /**
     * 两个回调，由宿主在每次铺行时重设。
     *
     * 不能在 `render()` 里绑监听：同一个实例会被复用到别的下标，
     * 回调里必须按 index 现取当前行，否则会「点第 3 行加入了第 1 个队伍」。
     */
    onJoin: (() => void) | null = null;
    onHead: (() => void) | null = null;

    /** 头像异步加载器（防虚拟列表复用导致的头像串行）。 */
    private avatar: FriendAvatarLoader | null = null;
    /** 「自己」态坐标的来源；「别人」态用 prefab 初始坐标。 */
    private selfLayout: Node | null = null;
    private readonly normalPositions = new Map<Node, Vec3>();

    protected onLoad(): void {
        this.avatar = new FriendAvatarLoader(() => this.headIcon);
        this.selfLayout = this.node.getChildByName('SelfLayout');
        this.normalPositions.set(this.background.node, this.background.node.position.clone());
        this.normalPositions.set(this.headNode, this.headNode.position.clone());
        this.normalPositions.set(this.nameLabel.node, this.nameLabel.node.position.clone());
        this.normalPositions.set(this.infoGroup, this.infoGroup.position.clone());
        this.joinButton.on(Button.EventType.CLICK, this.emitJoin, this);
        this.headNode.on(Node.EventType.TOUCH_END, this.emitHead, this);
    }

    private applyLayout(isSelf: boolean): void {
        const apply = (node: Node, markerName: string): void => {
            const marker = isSelf ? this.selfLayout?.getChildByName(markerName) : null;
            const local = marker?.position ?? this.normalPositions.get(node);
            if (local) node.setPosition(local.x, local.y, node.position.z);
        };
        apply(this.background.node, 'Background');
        apply(this.headNode, 'Head');
        apply(this.nameLabel.node, 'Name');
        apply(this.infoGroup, 'InfoGroup');
    }

    /**
     * 铺一行。所有状态绝对赋值（虚拟列表 clone 复用，条件式赋值会把上一行的状态带过来）。
     *
     * @param name       玩家名
     * @param stageName  关卡名（`ChatRepository` 已解析好）
     * @param powerText  战力文案
     * @param avatarId   头像 id（空串 = 清空帧，不能留着上一行的图）
     * @param isSelf     是不是我自己（决定两档版面、名字对齐与按钮可用性）
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
        this.applyLayout(isSelf);

        this.nameLabel.string = name;
        this.nameLabel.horizontalAlign = isSelf ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.LEFT;

        this.stageLabel.string = stageName;
        // 老端这里恒写空串，不是漏写
        this.declareLabel.string = '';
        this.powerLabel.string = powerText;

        this.avatar?.apply(avatarId);

        this.joinLabel.string = buttonText;
        const button = this.joinButton.getComponent(Button);
        button.interactable = !isSelf;
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
