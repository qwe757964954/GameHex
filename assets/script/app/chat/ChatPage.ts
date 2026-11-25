/**
 * 「聊天」弹窗（老端 `LayerChat`，prefab `ui/Chat/Chat`）。
 *
 * 分为三块列表：公共频道消息（页签 1/2/4）、招募列表（页签 0）、
 * 私聊消息 + 联系人（页签 3）；底部输入条、表情弹窗与艾特弹窗按页签显隐。
 *
 * FGUI 的 `数据` / `页签` / `显示表情` / `艾特弹窗` 四个 controller 统一收进
 * `presentChannel()`：每个受控节点一行绝对赋值。漏一条不报错，只会让某个控件
 * 出现在错误的页签下，所以 `tests/chat.test.ts` 对这张开关表有单独断言。
 *
 * 两条时序约束：
 * ① 7 个列表的 `renderItemFn` 只在 `onInit` 里绑一次，回调按 `index` 现取当前行
 *   （闭包捕获本趟数据会导致「点第 3 行删掉第 1 个」）。
 * ② 异步预加载必须在铺行之前 `await` 完；这里预加载的是页签底图与 44 张表情帧，
 *   与行数据无关，天然安全。头像由行组件自己的 `FriendAvatarLoader` 异步补。
 */

import { _decorator, Button, EditBox, Label, Node, SpriteFrame } from 'cc';
import { FW } from '../../framework/FW';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { loadArt } from '../card/CardLineupIcons';
import {
    CHAT_ART_ROOT,
    CHAT_SHARED_TAB_OFF,
    CHAT_SHARED_TAB_ON,
    CHAT_SHARED_TAB_ROOT,
    emojiArtName,
    emojiRichSrc,
} from './ChatArt';
import { ChatAtRow } from './ChatAtRow';
import { ChatBubble } from './ChatBubble';
import { ChatEmojiItem } from './ChatEmojiItem';
import { ChatPrivateBubble } from './ChatPrivateBubble';
import { ChatPrivateHead } from './ChatPrivateHead';
import { ChatRecruitRow } from './ChatRecruitRow';
import { chatRepository } from './ChatRepository';
import type { IChatRepository, IChatSnapshot, IRecruitView } from './ChatRepository';
import {
    atTag,
    canSpeak,
    ChatChannel,
    CHAT_DEFAULT_CHANNEL,
    CHAT_THEATER_HEAD_ID,
    channelsFor,
    EMOJI_COUNT,
    emojiTags,
    IChatMessage,
    IChatRole,
    isPrivateChannel,
    isReadonlyChannel,
    isSelfMessage,
    isSelfRecruit,
    isSystemRoleId,
    normalizeFriends,
    parseEmoji,
} from './ChatTable';
import { CHAT_TEXTS, channelTitle, formatText } from './ChatTexts';
import { FriendTabButton } from '../friend/FriendTabButton';
import { CacheMgr } from '../net/CacheMgr';

const { ccclass, property } = _decorator;

@ccclass('ChatPage')
export class ChatPage extends PopupBase {
    /**
     * 目录名必须与磁盘一致（`ui/Chat/Chat`，C 大写）：热更新包内路径对大小写敏感，
     * 写错时编辑器照跑，真机 `resources.load` 失败后只剩一个空弹窗。
     */
    static prefabPath = 'ui/Chat/Chat';

    // ---- 弹窗框 ----
    @property({ type: Node, tooltip: 'PanelBg/CloseBtn：右上关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    // ---- 页签 ----
    @property({ type: VirtualScrollView, tooltip: 'TabBar：5 个频道页签（横向滚动）' })
    tabList: VirtualScrollView = null;

    // ---- 列表 ----
    @property({ type: VirtualScrollView, tooltip: 'RowView：公共频道消息（页签 1/2/4）' })
    rowList: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: 'ApplyList：招募列表（页签 0）' })
    applyList: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: 'PrivateList：私聊消息（页签 3）' })
    privateList: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: 'HeadList：私聊联系人（页签 3）' })
    headList: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: 'EmojiPopup/EmojiList：44 格表情' })
    emojiList: VirtualScrollView = null;

    @property({ type: VirtualScrollView, tooltip: 'AtPopup/RoleList：好友列表（艾特用）' })
    roleList: VirtualScrollView = null;

    // ---- 受 controller 控制的容器 ----
    @property({ type: Node, tooltip: 'BottomBg：底部黑色九宫底（页签 0/2/4）' })
    bottomBg: Node = null;

    @property({ type: Label, tooltip: 'Empty：「暂无聊天」（数据=空）' })
    emptyLabel: Label = null;

    @property({ type: Node, tooltip: 'SilentLabel：「该频道不可发言」（页签 0）' })
    silentLabel: Node = null;

    @property({ type: Node, tooltip: 'InputBar：输入条（页签 2/4）' })
    inputBar: Node = null;

    @property({ type: EditBox, tooltip: 'InputBar/Input：公共频道输入框' })
    inputBox: EditBox = null;

    @property({ type: Node, tooltip: 'InputBar/EmojiBtn：表情（页签 2/4）' })
    emojiButton: Node = null;

    @property({ type: Node, tooltip: 'InputBar/SendBtn：发送（页签 2/4）' })
    sendButton: Node = null;

    @property({ type: Node, tooltip: 'InputBar/AtBtn：艾特（页签 2/4）' })
    atButton: Node = null;

    @property({ type: Node, tooltip: 'PrivateBottomBg：底部黑色九宫底（页签 3 且有数据）' })
    privateBottomBg: Node = null;

    @property({ type: Node, tooltip: 'PrivateInputBar：输入条（页签 3 且有数据）' })
    privateInputBar: Node = null;

    @property({ type: EditBox, tooltip: 'PrivateInputBar/Input：私聊输入框' })
    privateInputBox: EditBox = null;

    @property({ type: Node, tooltip: 'PrivateInputBar/EmojiBtn：表情（私聊）' })
    privateEmojiButton: Node = null;

    @property({ type: Node, tooltip: 'PrivateInputBar/SendBtn：发送（私聊）' })
    privateSendButton: Node = null;

    @property({ type: Node, tooltip: 'Mask：点空白关掉表情 / 艾特弹窗（两个之一打开时）' })
    maskButton: Node = null;

    @property({ type: Node, tooltip: 'EmojiPopup：表情弹窗' })
    emojiPopup: Node = null;

    @property({ type: Node, tooltip: 'AtPopup：艾特弹窗' })
    atPopup: Node = null;

    /** 数据端口；测试可注入替身。 */
    private repo: IChatRepository = chatRepository;

    /** 最近一次快照。 */
    private snapshot: IChatSnapshot | null = null;

    /** 当前频道。 */
    private channel: ChatChannel = CHAT_DEFAULT_CHANNEL;

    /** 当前选中的私聊对象 id。 */
    private privateRoleId = '';

    /** 本次实际渲染出来的页签频道（联盟可能是动态追加的）。 */
    private channels: ChatChannel[] = [];

    /** 本趟列表数据（`renderItemFn` 按 index 现取，禁闭包捕获）。 */
    private messageRows: readonly IChatMessage[] = [];
    private recruitRows: readonly IRecruitView[] = [];
    private privateRows: readonly IChatMessage[] = [];
    private headRows: readonly IChatRole[] = [];
    private atRows: readonly IChatRole[] = [];

    /** 一个请求还没回来时忽略后续点击（避免连点发两次）。 */
    private busy = false;

    /** 每次取数 / 换页签递增，用来作废在飞的异步结果。 */
    private revision = 0;

    /** 静态帧（页签两态），首次用到后缓存。 */
    private tabFrames: { readonly on: SpriteFrame | null; readonly off: SpriteFrame | null } | null = null;

    /** 44 张表情帧（顺序 = `emojiTags()`）。 */
    private emojiFrames: (SpriteFrame | null)[] = [];

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bind(this.closeButton, this.onCloseClick);
        this.bind(this.maskButton, this.onMaskClick);
        this.bind(this.atButton, this.onAtClick);
        this.bind(this.emojiButton, this.onEmojiClick);
        this.bind(this.privateEmojiButton, this.onEmojiClick);
        this.bind(this.sendButton, () => void this.onSendClick());
        this.bind(this.privateSendButton, () => void this.onSendClick());

        // 回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）
        this.tabList.renderItemFn = (node, index) => this.renderTabNode(node, index);
        this.rowList.renderItemFn = (node, index) => this.renderMessageNode(node, index);
        this.applyList.renderItemFn = (node, index) => this.renderRecruitNode(node, index);
        this.privateList.renderItemFn = (node, index) => this.renderPrivateNode(node, index);
        this.headList.renderItemFn = (node, index) => this.renderHeadNode(node, index);
        this.emojiList.renderItemFn = (node, index) => this.renderEmojiNode(node, index);
        this.roleList.renderItemFn = (node, index) => this.renderAtNode(node, index);
    }

    /**
     * 打开。
     *
     * `userData`（都可省）：`{ channel?: number, roleId?: string | number }`。
     * 主界面按钮在有新消息时带 `channel` / `speaker` 进来；私聊 id 必须转成字符串
     * （`uint64` 传数字会被 `Long` 吃掉精度）。
     */
    protected async onOpen(userData?: any): Promise<void> {
        this.busy = false;
        this.revision += 1;

        const channel = Number(userData?.channel);
        this.channel = Number.isInteger(channel) && channel >= 0 && channel <= ChatChannel.Union
            ? (channel as ChatChannel)
            : CHAT_DEFAULT_CHANNEL;
        this.privateRoleId = String(userData?.roleId ?? '');

        this.closeSubPopup();
        this.repo.listen(this, () => void this.onBroadcast());
        await this.reload();
    }

    protected onClose(): void {
        this.repo.unlisten(this);
        // 关界面时把已读时间落盘
        this.repo.saveRead();
    }

    onDestroy(): void {
        this.repo.unlisten(this);
        super.onDestroy();
    }

    /** 供测试注入替身 Repository。 */
    setRepository(repository: IChatRepository): void {
        this.repo = repository;
    }

    // ============================================================
    // 取数与铺界面
    // ============================================================

    private async reload(): Promise<void> {
        const revision = ++this.revision;

        let snapshot = await this.repo.load(this.channel, this.privateRoleId);
        if (!this.alive || revision !== this.revision) return;

        // 首进该频道 ⇒ 补拉一页（每页只拉一次）
        if (this.shouldInitChannel(snapshot)) {
            const id = isPrivateChannel(this.channel) ? Number(snapshot.selectedRoleId || 0) : 0;
            const result = await this.repo.initChannel(this.channel, id, 1, this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'offline') FW.showTip(CHAT_TEXTS.offline);
            snapshot = await this.repo.load(this.channel, this.privateRoleId);
            if (!this.alive || revision !== this.revision) return;
        }

        // 招募是另一条协议，同样每个会话只拉一次
        if (this.channel === ChatChannel.Recruit && !this.repo.isRecruitsFetched()) {
            const result = await this.repo.initRecruits(this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'offline') FW.showTip(CHAT_TEXTS.offline);
            snapshot = await this.repo.load(this.channel, this.privateRoleId);
            if (!this.alive || revision !== this.revision) return;
        }

        this.privateRoleId = snapshot.selectedRoleId;
        this.snapshot = snapshot;

        // 静态帧先备好再铺界面，避免「先出框后补图」的闪烁
        await this.loadStaticFrames();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    /** 这个频道要不要补发一次 `Init`。 */
    private shouldInitChannel(snapshot: IChatSnapshot): boolean {
        if (isPrivateChannel(this.channel)) {
            // 没有私聊对象就不发
            const id = Number(snapshot.selectedRoleId || 0);
            if (id <= 0) return false;
            return !this.repo.isInited(this.channel, id);
        }
        return !this.repo.isInited(this.channel, 0);
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        this.presentTabs(snapshot);
        this.presentChannel(snapshot);
        this.presentBodies(snapshot);
    }

    /**
     * 四个 controller 的等价物（唯一入口，全部绝对赋值）。
     *
     * `数据` 按「实际能显示几条」算：私聊用过滤后的联系人条数，不用服务端原始条数，
     * 避免出现「数据=有 + 空列表」的形态。
     */
    private presentChannel(snapshot: IChatSnapshot): void {
        const channel = this.channel;
        const hasData = this.hasDataOf(snapshot);

        // n90 黑色九宫底：页签 0/2/4
        this.bottomBg.active = channel === ChatChannel.Recruit
            || channel === ChatChannel.World
            || channel === ChatChannel.Union;
        this.emptyLabel.string = CHAT_TEXTS.empty;
        this.emptyLabel.node.active = !hasData;
        this.silentLabel.active = isReadonlyChannel(channel);

        // 公共输入条只在 2/4 出现；艾特按钮虽是 1/2/4，但它挂在输入条里，实际也只在 2/4 可见
        const publicInput = canSpeak(channel) && !isPrivateChannel(channel);
        this.inputBar.active = publicInput;
        this.atButton.active = publicInput;
        this.inputBox.placeholder = CHAT_TEXTS.inputPrompt;

        // n106 + n105：页签 3 且有数据（没对象时连输入框都不给）
        const privateReady = isPrivateChannel(channel) && hasData;
        this.privateBottomBg.active = privateReady;
        this.privateInputBar.active = privateReady;
        this.privateInputBox.placeholder = CHAT_TEXTS.inputPrompt;

        // 换频道就清输入
        this.inputBox.string = '';
        this.privateInputBox.string = '';
    }

    /** 这一页有没有内容（招募看招募条数、私聊看联系人条数、其余看消息条数）。 */
    private hasDataOf(snapshot: IChatSnapshot): boolean {
        if (this.channel === ChatChannel.Recruit) return snapshot.recruits.length > 0;
        if (isPrivateChannel(this.channel)) return snapshot.heads.length > 0;
        return snapshot.page.list.length > 0;
    }

    private presentTabs(snapshot: IChatSnapshot): void {
        const channels = channelsFor(snapshot.joinedUnion);
        this.channels = channels;
        // 页签文案由 `channelTitle` 给（`renderTabNode` 里现取）
        this.tabList.refreshList(channels.map((channel) => channelTitle(channel)));
    }

    private presentBodies(snapshot: IChatSnapshot): void {
        const channel = this.channel;
        const hasData = this.hasDataOf(snapshot);

        const showMessages = hasData
            && (channel === ChatChannel.Theater || channel === ChatChannel.World || channel === ChatChannel.Union);
        this.rowList.node.active = showMessages;
        if (showMessages) {
            this.messageRows = snapshot.page.list;
            this.rowList.refreshList(this.messageRows as IChatMessage[]);
            // 进来先看到最新一条
            this.rowList.scrollToBottom(false);
        }

        const showApply = hasData && channel === ChatChannel.Recruit;
        this.applyList.node.active = showApply;
        if (showApply) {
            this.recruitRows = snapshot.recruits;
            this.applyList.refreshList(this.recruitRows as IRecruitView[]);
            this.applyList.scrollToTop(false);
        }

        const showPrivate = hasData && isPrivateChannel(channel);
        this.privateList.node.active = showPrivate;
        this.headList.node.active = showPrivate;
        if (showPrivate) {
            this.headRows = snapshot.heads;
            this.privateRows = snapshot.page.list;
            this.headList.refreshList(this.headRows as IChatRole[]);
            this.headList.scrollToTop(false);
            this.privateList.refreshList(this.privateRows as IChatMessage[]);
            this.privateList.scrollToBottom(false);
        }
    }

    // ============================================================
    // 行渲染（槽位被 clone 复用 ⇒ 回调里按 index 现取）
    // ============================================================

    private renderTabNode(node: Node, index: number): void {
        const button = node.getComponent(FriendTabButton);
        const channel = this.channels[index];
        if (channel === undefined) {
            node.active = false;
            return;
        }
        node.active = true;
        // 节点会被复用到别的下标，每次都要重设 index
        button.bind(index, (clicked) => void this.onTabClick(clicked));
        button.render(
            channelTitle(channel),
            channel === this.channel,
            this.tabFrames?.off ?? null,
            this.tabFrames?.on ?? null,
        );
    }

    private renderMessageNode(node: Node, index: number): void {
        const bubble = node.getComponent(ChatBubble);
        const message = this.messageRows[index];
        if (!message) {
            bubble.hide();
            return;
        }
        node.active = true;
        // 战区整块换成系统头像（说话人自带的是玩家头像，对系统播报无意义）
        const avatarId = this.channel === ChatChannel.Theater
            ? CHAT_THEATER_HEAD_ID
            : message.speaker.img;
        bubble.render(
            isSelfMessage(message, this.selfId),
            message.speaker.name,
            parseEmoji(message.content, emojiRichSrc),
            avatarId,
        );
    }

    private renderPrivateNode(node: Node, index: number): void {
        const bubble = node.getComponent(ChatPrivateBubble);
        const message = this.privateRows[index];
        if (!message) {
            bubble.hide();
            return;
        }
        node.active = true;
        bubble.render(
            isSelfMessage(message, this.selfId),
            message.speaker.name,
            parseEmoji(message.content, emojiRichSrc),
            message.speaker.img,
        );
    }

    private renderRecruitNode(node: Node, index: number): void {
        const row = node.getComponent(ChatRecruitRow);
        const view = this.recruitRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.onJoin = () => this.onRecruitJoin(index);
        // 头像点击带的是本行渲染时的 roleId（不是按下标重取，避免列表变短后取到别人的 id）
        row.onHead = () => this.onPlayerInfo(view.roleId);
        row.render(
            view.name,
            view.stageName,
            formatText(CHAT_TEXTS.powerTemplate, view.power),
            view.img,
            isSelfRecruit(view, this.selfId),
            CHAT_TEXTS.joinTeam,
        );
    }

    private renderHeadNode(node: Node, index: number): void {
        const row = node.getComponent(ChatPrivateHead);
        const view = this.headRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.onSelect = () => void this.onHeadSelect(index);
        row.onRemove = () => void this.onHeadRemove(index);
        row.render(view.name, view.img);
    }

    private renderEmojiNode(node: Node, index: number): void {
        const item = node.getComponent(ChatEmojiItem);
        if (index >= this.emojiFrames.length) {
            item.hide();
            return;
        }
        node.active = true;
        item.onPick = () => this.onEmojiPick(index);
        // 绝对赋值：`null` 也要写，否则复用的节点会留着上一格的图
        item.render(this.emojiFrames[index]);
    }

    private renderAtNode(node: Node, index: number): void {
        const row = node.getComponent(ChatAtRow);
        const view = this.atRows[index];
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.onPick = () => this.onAtPick(index);
        // 本工程没有区服表，按老端 fallback 直接显示区服 id
        row.render(view.name, String(view.selectServerId), view.img);
    }

    // ============================================================
    // 交互 —— 页签
    // ============================================================

    private async onTabClick(index: number): Promise<void> {
        const channel = this.channels[index];
        if (channel === undefined || channel === this.channel) return;
        this.channel = channel;
        this.closeSubPopup();
        await this.reload();
    }

    // ============================================================
    // 交互 —— 发送 / 表情 / 艾特
    // ============================================================

    private async onSendClick(): Promise<void> {
        if (this.busy) return;

        const isPrivate = isPrivateChannel(this.channel);
        const input = isPrivate ? this.privateInputBox : this.inputBox;
        const content = input.string.trim();
        if (!content) {
            FW.showTip(CHAT_TEXTS.emptyInput);
            return;
        }

        // 老端在这里走平台 SDK 校验敏感词；本工程没有 SDK 层，本轮不做过滤
        this.busy = true;
        try {
            const id = isPrivate ? Number(this.privateRoleId || 0) : 0;
            const result = await this.repo.sendMessage(this.channel, id, content, this);
            if (!this.alive) return;
            if (result !== 'ok') {
                FW.showTip(result === 'offline' ? CHAT_TEXTS.offline : CHAT_TEXTS.requestFailed);
                return;
            }
            this.inputBox.string = '';
            this.privateInputBox.string = '';
            await this.reload();
        } finally {
            this.busy = false;
        }
    }

    private onEmojiClick(): void {
        this.emojiPopup.active = true;
        this.maskButton.active = true;
        this.atPopup.active = false;
        this.emojiList.refreshList(emojiTags());
    }

    /** 表情插进两个输入框（哪条输入条可见由页签决定）。 */
    private onEmojiPick(index: number): void {
        const tag = `[:${index}]`;
        this.inputBox.string += tag;
        this.privateInputBox.string += tag;
    }

    private onAtClick(): void {
        this.atRows = normalizeFriends(this.friendRows());
        this.atPopup.active = true;
        this.maskButton.active = true;
        this.emojiPopup.active = false;
        this.roleList.refreshList(this.atRows as IChatRole[]);
    }

    private onAtPick(index: number): void {
        const row = this.atRows[index];
        if (!row) return;
        // 只往公共频道输入框追加，并顺手关掉弹窗
        this.inputBox.string += atTag(row.name);
        this.closeSubPopup();
    }

    private onMaskClick(): void {
        this.closeSubPopup();
    }

    /** 关掉表情 / 艾特弹窗 + 遮罩。 */
    private closeSubPopup(): void {
        this.emojiPopup.active = false;
        this.atPopup.active = false;
        this.maskButton.active = false;
    }

    // ============================================================
    // 交互 —— 列表
    // ============================================================

    private async onHeadSelect(index: number): Promise<void> {
        const row = this.headRows[index];
        if (!row || row.roleId === this.privateRoleId) return;
        this.privateRoleId = row.roleId;
        await this.reload();
    }

    private async onHeadRemove(index: number): Promise<void> {
        const row = this.headRows[index];
        if (!row) return;
        const result = await this.repo.delTarget(row.roleId, this);
        if (!this.alive) return;
        if (result !== 'ok') {
            FW.showTip(result === 'offline' ? CHAT_TEXTS.offline : CHAT_TEXTS.requestFailed);
            return;
        }
        if (this.privateRoleId === row.roleId) this.privateRoleId = '';
        await this.reload();
    }

    /**
     * 招募「点击加入」。
     *
     * 这一包目前发不出去：老端入队要带战前属性快照（`CmdBattleRoleAttr`），
     * 本工程尚未接入该体系，所以只做本地判据 —— 「不能加入自己的队伍」。
     */
    private onRecruitJoin(index: number): void {
        const row = this.recruitRows[index];
        if (!row) return;
        if (isSelfRecruit(row, this.selfId)) {
            FW.showTip(CHAT_TEXTS.cannotJoinSelf);
            return;
        }
        FW.showTip(CHAT_TEXTS.joinUnavailable);
    }

    /**
     * 点头像看资料：本工程没有对应界面；系统播报（`roleId < 1e4`）先按老端判据拦一道。
     */
    private onPlayerInfo(roleId: string): void {
        if (!roleId) return;
        if (isSystemRoleId(roleId)) {
            FW.showTip(CHAT_TEXTS.noPointAtMe);
            return;
        }
        FW.showTip(CHAT_TEXTS.playerInfoUnavailable);
    }

    // ============================================================
    // 广播
    // ============================================================

    /**
     * 服务端推了一条新消息。
     *
     * 任何频道的广播都要整页刷新，否则私聊联系人列表的未读状态不会更新。
     */
    private async onBroadcast(): Promise<void> {
        if (!this.alive) return;
        await this.reload();
    }

    // ============================================================
    // 图与辅助
    // ============================================================

    private async loadStaticFrames(): Promise<void> {
        if (!this.tabFrames) {
            const [on, off] = await Promise.all([
                loadArt(CHAT_SHARED_TAB_ON, CHAT_SHARED_TAB_ROOT),
                loadArt(CHAT_SHARED_TAB_OFF, CHAT_SHARED_TAB_ROOT),
            ]);
            this.tabFrames = { on, off };
        }
        if (this.emojiFrames.length === 0) {
            this.emojiFrames = await Promise.all(
                Array.from({ length: EMOJI_COUNT }, (_, index) => loadArt(emojiArtName(index), CHAT_ART_ROOT)),
            );
        }
    }

    /** 好友行（艾特弹窗用）—— 与好友模块同一张缓存。 */
    private friendRows(): unknown[] {
        try {
            return CacheMgr.instance.getTlCmdFriend() ?? [];
        } catch (error) {
            console.warn('[Chat] 读 CmdFriend 缓存失败', error);
            return [];
        }
    }

    private get selfId(): string {
        return this.snapshot?.selfId ?? '';
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private bind(node: Node, handler: () => void): void {
        const button = node.getComponent(Button);
        if (!button) {
            console.warn(`[Chat] ${node.name} 上没有 cc.Button，点击不会生效`);
            return;
        }
        button.node.on(Button.EventType.CLICK, handler, this);
    }

    private get alive(): boolean {
        return this.isPopupOpen && (!this.node || this.node.isValid);
    }
}
