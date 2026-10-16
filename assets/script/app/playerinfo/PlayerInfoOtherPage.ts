import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { ChatPage } from '../chat/ChatPage';
import { ChatChannel } from '../chat/ChatTable';
import { Toast } from '../common/Toast';
import { friendRepository } from '../friend/FriendRepository';
import type { IFriendRepository, IFriendSnapshot } from '../friend/FriendRepository';
import { HeadArt } from '../HeadArt';
import { buildOtherListData, formatBattleLevel, formatPower, formatServerWithParen, formatUid, formatUnionName, writeFailText } from './PlayerInfoTable';
import type { IOtherEquipEntry } from './PlayerInfoTable';
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';
import { playerInfoRepository, toIdText } from './PlayerInfoRepository';
import type { IPlayerInfoRepository, IPlayerInfoSnapshot } from './PlayerInfoRepository';

const { ccclass, property } = _decorator;

/** `PlayerInfoOtherPage.open()` 的 `userData`。 */
export interface IOtherInfoParams {
    /** 目标玩家角色 id（十进制字符串；`uint64` 已在调用方转好）。 */
    roleId: string;
    /** 目标玩家所在服 id（老端 `params.serverId`）。 */
    serverId: number;
}

/**
 * 「玩家信息」（他人信息）弹窗 —— 老端 `LayeroOtherPlayerInfo`（`LayeroOtherPlayerInfoUI`），
 * FGUI `个人信息/组件/组件_查看信息_界面.xml`（720×1280；弹窗底 `popBg` 633×998）。
 *
 * ⚠️ **不是** `LayerPlayerInfo` 的「他人模式」—— 老端那是同一份 FGUI 切「自己」控制器，
 * 数据也来自本地缓存；他人信息走的是**另一张原稿**（`组件_查看信息_界面`）+ **一次请求**
 * （`CmdRoleInfoViewReqMsg`）。所以本工程把它做成独立 prefab，与 `PlayerInfoPage` 分开。
 *
 * 版面：弹窗底 + 标题「玩家信息」→ 立绘大图（`n114`）+ 模型位（`iconHalf`）
 * → 头像 + 名字 + uid +（区服）→ 攻击力 / 关卡进度 / 联盟名
 * → 6 件装备（`equipType1..6`）→ 底部列表（`list`）
 * → 拉黑 / 好友 / 私聊。
 *
 * ## 四个已知缺口（有意留下，不造假）
 *
 * ① **区服名恒空**：老端 `ModelServer.getServerInfo(selectServerId).name`；本工程 `remoteRef`
 *    里**没有 `server` 表**（只有 `serverRank`）⇒ `text_serverid` 只会显示空括号。
 *    与 `PlayerInfoRepository` 文件头缺口 ① 是同一件事。
 * ② **装备图标画不出来**：`equip.icon` 是 FGUI 图标名（`图标_装备_帽子6`），而
 *    `assets/resources/` 下**一张 `图标_装备_*` 都没有**（`find` = 0 条），并且
 *    `ArtPaths.ICON_PACKAGE_ART_ROOT` 把包名 `图标` 指向 `icons/head`（头像目录）。
 *    ⇒ 6 个装备格只画底框，**不写「塞一张恒为 null 的图」那种假装接上的代码**。
 *    数据照常进 `snapshot.equip`（`equipOf(部位号)` 可读），美术补齐后在 `presentEquip` 接一处即可。
 * ③ **立绘 / 骨骼模型不渲染**：老端 `iconHalf.SetUrlByModel(ref.model)` 走的是 FGUI 的
 *    骨骼模型加载器（`skin` 表 → `PrefabKey`）；本工程没有对应渲染路径 ⇒ 只留节点引用 `modelHost`，
 *    不挂 `sp.Skeleton`、不假装能显示。
 * ④ **底部列表（`list`）不铺项**：老端那 5 类（基础 / 联盟 / 民兵皮肤 / 武将 / 军师）由
 *    独立 prefab `组件_查看信息_项` 渲染，而其中 0/1 两类在老端**就是注释掉的**
 *    （数据直接写在主面板上）。本工程把「类型 + 条数」的组装做成了纯函数
 *    `buildOtherListData`（可单测），显示层留空 —— 需要 `PlayerInfoOtherItem` prefab
 *    才能铺（那是第 7 个 prefab，见 Task 清单）。
 *
 * ## 按钮：比老端多做了两支
 *
 * 老端 `按钮_拉黑` 只调 `requetBlack`（**解除那一支没写**，`blackRemove` 有接口但这段代码从不调），
 * 玩家点一次就再也解不开；`按钮_好友` 的「已拉黑」分支只弹提示。本页把解除分支补上，
 * 其余提示文案**逐条照抄 mL.json**（`NOT_CHAT_SELF` / `NOT_PRIVATE_CHAT` / `BLACK_TARGET_FRIEND`）。
 */
@ccclass('PlayerInfoOtherPage')
export class PlayerInfoOtherPage extends PopupBase {
    /** 预制体路径（目录名必须与磁盘一致，热更新 zip 内大小写敏感）。 */
    static prefabPath = 'ui/PlayerInfo/PlayerInfoOther';

    // ---------- 弹窗框 ----------
    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮（FGUI 原稿里是老端隐藏的那个；没有就留 null）' })
    closeButton: Node = null!;

    // ---------- 身份区 ----------
    @property({ type: Sprite, tooltip: 'HeadBox/HeadIcon：头像（`com_head.icon`，80×74）' })
    headIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'NameLabel：玩家名（`text_name`）' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'UidLabel：玩家 ID（`text_uid`）' })
    uidLabel: Label = null!;

    @property({ type: Label, tooltip: 'ServerLabel：区服名（`text_serverid`，本工程恒空，见文件头 ①）' })
    serverLabel: Label = null!;

    // ---------- 数值区 ----------
    @property({ type: Label, tooltip: 'AttackLabel：攻击力（`文本_攻击力`）' })
    attackLabel: Label = null!;

    @property({ type: Label, tooltip: 'BattleLevelLabel：关卡进度（`文本_关卡进度`）' })
    battleLevelLabel: Label = null!;

    @property({ type: Label, tooltip: 'UnionLabel：联盟名（`联盟名`）' })
    unionLabel: Label = null!;

    // ---------- 立绘 / 装备 / 列表 ----------
    @property({ type: Node, tooltip: 'ModelHost：骨骼模型位（`iconHalf`），本工程不渲染（文件头 ③）' })
    modelHost: Node = null!;

    @property({ type: [Node], tooltip: 'EquipSlots：6 个装备格（`equipType1`..`equipType6`，按部位号顺序）' })
    equipSlots: Node[] = [];

    @property({ type: Node, tooltip: 'ListHost：底部列表容器（`list`），本工程不铺项（文件头 ④）' })
    listHost: Node = null!;

    // ---------- 按钮 ----------
    @property({ type: Node, tooltip: 'BlackBtn：拉黑 / 解除拉黑（`按钮_拉黑`）' })
    blackButton: Node = null!;

    @property({ type: Label, tooltip: 'BlackBtn/Label：拉黑按钮文字' })
    blackLabel: Label = null!;

    @property({ type: Node, tooltip: 'FriendBtn：加好友 / 删好友（`按钮_好友`）' })
    friendButton: Node = null!;

    @property({ type: Label, tooltip: 'FriendBtn/Label：好友按钮文字' })
    friendLabel: Label = null!;

    @property({ type: Node, tooltip: 'ChatBtn：私聊（`按钮_私聊`）' })
    chatButton: Node = null!;

    /** 个人信息的数据端口；测试 / 探针可替换。 */
    private repo: IPlayerInfoRepository = playerInfoRepository;
    /** 好友的数据端口（好友 / 黑名单 / 申请三张表都在它后面）。 */
    private friendRepo: IFriendRepository = friendRepository;

    /** 目标角色 id。 */
    private roleId = '';
    /** 目标所在服。 */
    private serverId = 0;
    /** 自己的角色 id（判「不能私聊自己」）。 */
    private selfId = '';
    /** 最近一次快照（探针可读）。 */
    private snapshot: IPlayerInfoSnapshot | null = null;
    /** 头像图（预加载）。 */
    private headFrame: SpriteFrame | null = null;
    /** 是不是好友 / 是不是已拉黑 / 我有没有申请过。 */
    private isFriend = false;
    private isBlack = false;
    private isApplied = false;
    /** 每次取数递增，丢弃过期结果。 */
    private loadRevision = 0;
    /** 三个按钮各自的请求进行中标记（防连点）。 */
    private acting = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.friendButton, () => { void this.onFriendClick(); });
        this.bindButton(this.blackButton, () => { void this.onBlackClick(); });
        this.bindButton(this.chatButton, () => { void this.onChatClick(); });
    }

    protected async onOpen(userData?: IOtherInfoParams): Promise<void> {
        this.roleId = toIdText(userData?.roleId);
        this.serverId = Number(userData?.serverId) || 0;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.loadRevision += 1;
        this.snapshot = null;
        this.headFrame = null;
        this.roleId = '';
        this.selfId = '';
        this.isFriend = false;
        this.isBlack = false;
        this.isApplied = false;
        this.acting = false;
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IPlayerInfoRepository): void {
        this.repo = repository;
    }

    /** 供测试 / 探针注入替身好友端口。 */
    setFriendRepository(repository: IFriendRepository): void {
        this.friendRepo = repository;
    }

    /** 弹窗还活着吗（异步回来时页面可能已被关掉）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }

    /**
     * 绑按钮。
     * ⚠️ FGUI `<loader>` / `<image>` 迁过来**没有 `cc.Button`**（规则 81b），
     * 那种节点绑 `Button.EventType.CLICK` 是**静默死按钮**。按实际组件分流。
     */
    private bindButton(node: Node | null | undefined, handler: () => void): void {
        if (!node) return;
        const button = node.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, handler, this);
            return;
        }
        node.on(Node.EventType.TOUCH_END, handler, this);
    }

    // ============================================================
    // 取数与渲染
    // ============================================================

    /**
     * 拉数据。
     *
     * ⚠️ 老端 `UpdateData()` 拿不到玩家数据就**直接 `unload()`**（分服没开的情形）。
     * 本工程照抄「关掉」，但先给一句提示 —— 老端那种「界面自己消失」在 Demo3.8 的
     * 预览 / 离线环境下太像崩溃（见 `PlayerInfoRepository.loadOther` 的三态）。
     */
    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;
        if (!this.roleId) {
            Toast.show(PLAYER_INFO_TEXTS.otherLoadFailed);
            this.close(PopupCloseReason.Manual);
            return;
        }

        const [other, self, friends] = await Promise.all([
            this.repo.loadOther(this.roleId, this.serverId),
            this.repo.loadSelf(),
            this.friendRepo.load(),
        ]);
        if (!this.alive || revision !== this.loadRevision) return;

        if (other.status !== 'ok' || !other.snapshot) {
            // 断线（`offline`）= 包没发出去，与「发出去了拿不到」分开提示（同 `writeFailText`）。
            Toast.show(writeFailText(other.status, PLAYER_INFO_TEXTS.otherLoadFailed));
            this.close(PopupCloseReason.Manual);
            return;
        }

        this.selfId = toIdText(self.roleId);
        this.snapshot = other.snapshot;
        this.applyFriends(friends);

        // 图先 await 完再铺（与 `PlayerInfoPage.reload` 同一口径）。
        this.headFrame = await this.loadHeadFrameBy(String(other.snapshot.img));
        if (!this.alive || revision !== this.loadRevision) return;

        this.present(other.snapshot);
    }

    private async loadHeadFrameBy(resId: string): Promise<SpriteFrame | null> {
        if (!resId) return null;
        try {
            return await HeadArt.loadHeadFrame(resId);
        } catch (error) {
            console.warn('[PlayerInfo] 头像图加载失败', resId, error);
            return null;
        }
    }

    // ---------- 铺界面 ----------

    private present(snapshot: IPlayerInfoSnapshot): void {
        if (this.headIcon) this.headIcon.spriteFrame = this.headFrame;

        // 全部**无条件写**（规则 82）。
        if (this.nameLabel) this.nameLabel.string = snapshot.roleName;
        if (this.uidLabel) this.uidLabel.string = formatUid(snapshot.roleId);
        // 缺口 ①：没有 `server` 表 ⇒ `formatServerWithParen('')` 给空串（不是「()」）。
        if (this.serverLabel) this.serverLabel.string = formatServerWithParen(snapshot.serverName);
        if (this.attackLabel) this.attackLabel.string = formatPower(snapshot.power);
        if (this.battleLevelLabel) this.battleLevelLabel.string = formatBattleLevel(snapshot.battleLevel);
        if (this.unionLabel) this.unionLabel.string = formatUnionName(snapshot.unionName);

        this.presentEquip();
        this.presentButtons();
    }

    /**
     * 装备格。
     *
     * ⚠️ 只做两件**真实**的事（缺口 ②）：
     *   ① 6 个格子一律 `active = true` —— 老端也是恒在（按 `GetEquipType()` 往对应格里填，不隐藏空位）
     *   ② 数据照常进 `snapshot.equip`，`equipOf(部位号)` 可读
     * **不**写「塞一张恒为 `null` 的图」那种代码：那不是接线，是假装接了。
     * 美术补齐 `图标_装备_*` 之后，在这里按部位号取 `equipOf(slot)` 塞图即可（一处）。
     */
    private presentEquip(): void {
        for (const node of this.equipSlots) {
            if (node) node.active = true;
        }
    }

    /** 三个按钮的文案（等于老端 `refreshBtn()` 的两个控制器切换）。 */
    private presentButtons(): void {
        const T = PLAYER_INFO_TEXTS;
        if (this.friendLabel) {
            this.friendLabel.string = this.isFriend ? T.otherFriendButtonActive : T.otherFriendButton;
        }
        if (this.blackLabel) {
            this.blackLabel.string = this.isBlack ? T.otherBlackButtonActive : T.otherBlackButton;
        }
    }

    private applyFriends(snapshot: IFriendSnapshot): void {
        this.isFriend = snapshot.friendRows.some((row) => row.id === this.roleId);
        this.isBlack = snapshot.blackRows.some((row) => row.id === this.roleId);
        this.isApplied = snapshot.appliedIds.has(this.roleId);
    }

    // ============================================================
    // 交互
    // ============================================================

    /**
     * 加 / 删好友。
     *
     * 老端 `onFriendClick`：
     * ```js
     * if (isFriend)      { requetRemove([roleId]); if (ok) refreshBtn() }
     * else if (isBlack)  { showTip(G_W("BLACK_TARGET_FRIEND")) }   // 「您已拉黑对方，请先从黑名单移除」
     * else if (!isApplied) { requetApply(roleId) }
     * ```
     */
    private async onFriendClick(): Promise<void> {
        if (this.acting || !this.alive) return;
        this.acting = true;
        try {
            if (this.isFriend) {
                const result = await this.friendRepo.remove([this.roleId]);
                if (!this.alive) return;
                if (result !== 'ok') {
                    Toast.show(PLAYER_INFO_TEXTS.otherActionFailed);
                    return;
                }
                await this.reload();
                return;
            }
            if (this.isBlack) {
                Toast.show(PLAYER_INFO_TEXTS.otherBlackTargetFriend);
                return;
            }
            if (this.isApplied) return;
            const result = await this.friendRepo.apply(this.roleId);
            if (!this.alive) return;
            if (result !== 'ok') Toast.show(PLAYER_INFO_TEXTS.otherActionFailed);
            else await this.reload();
        } finally {
            this.acting = false;
        }
    }

    /**
     * 拉黑 / 解除拉黑。
     *
     * 老端只写了「拉黑」那一支（`requetBlack`），解除的分支**没有**（`blackRemove` 有接口但
     * 这段代码从不调）⇒ 玩家拉黑一次就再也解不开。本页把解除补上（超集，不影响老端行为）。
     */
    private async onBlackClick(): Promise<void> {
        if (this.acting || !this.alive) return;
        this.acting = true;
        try {
            const result = this.isBlack
                ? await this.friendRepo.blackRemove(this.roleId)
                : await this.friendRepo.black(this.roleId);
            if (!this.alive) return;
            if (result !== 'ok') {
                Toast.show(PLAYER_INFO_TEXTS.otherActionFailed);
                return;
            }
            await this.reload();
        } finally {
            this.acting = false;
        }
    }

    /**
     * 私聊。
     *
     * 老端 `onChatClick`：自己 → `NOT_CHAT_SELF`；不是好友或已拉黑 → `NOT_PRIVATE_CHAT`；
     * 否则 `CtrlChat.openLayerChat(CHAT_CHANNEL_PRIVATE, privateRole)` 然后 `unload()`。
     *
     * ⚠️ 本工程 `ChatPage.open({ userData: { channel, roleId } })` 就是这里的等价入口
     * （`ChatPage.onPlayerInfo` 里原本写着「Demo3.8 没有对应界面」的那句，现在两边对上了）。
     */
    private async onChatClick(): Promise<void> {
        if (!this.alive) return;
        if (this.selfId && this.roleId === this.selfId) {
            Toast.show(PLAYER_INFO_TEXTS.otherNotChatSelf);
            return;
        }
        if (!this.isFriend || this.isBlack) {
            Toast.show(PLAYER_INFO_TEXTS.otherNotPrivateChat);
            return;
        }
        const roleId = this.roleId;
        this.close(PopupCloseReason.Manual);
        await ChatPage.open({ userData: { channel: ChatChannel.Private, roleId } });
    }

    // ============================================================
    // 探针 / 测试
    // ============================================================

    /** 探针：当前展示的装备数据（按部位号）。 */
    equipOf(slot: number): IOtherEquipEntry | undefined {
        return this.snapshot?.equip.find((entry) => entry.slot === slot);
    }

    /** 探针：底部列表的「类型 + 条数」（显示层未铺，见文件头 ④）。 */
    get otherListData(): readonly { type: number; count: number }[] {
        // 老端那三类来自 `CmdRoleInfoViewRspMsg`；本工程 `IPlayerInfoSnapshot` 目前只带了
        // 攻击力 / 关卡进度 / 联盟名三样主面板字段，这三类数组还没进快照 ⇒ 恒空。
        // 保留调用点是为了让「接数据」这件事只有一个落点（`buildOtherListData` 已可单测）。
        return buildOtherListData({});
    }

    /** 探针：三个按钮的当前状态。 */
    get socialState(): { isFriend: boolean; isBlack: boolean; isApplied: boolean } {
        return { isFriend: this.isFriend, isBlack: this.isBlack, isApplied: this.isApplied };
    }
}
