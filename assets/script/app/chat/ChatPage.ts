/**
 * 「聊天」弹窗（老端 `LayerChat`，`assets/resources/ui/Chat/Chat.prefab`）。
 *
 * ## 版面（真源 = FGUI `聊天/组件/组件_聊天_界面.xml`，720×1280）
 *
 * ```
 * Chat (720×1280)
 * ├─ PanelBg / TitleBg / Title / CloseBtn     共用弹窗框（`组件_公共弹窗_新`）
 * ├─ BottomBg        n90  黑色九宫底（页签 0/2/4）
 * ├─ RowView         消息列表（页签 1/2/4 且有数据）
 * ├─ Empty          n63「暂无聊天」（数据=空）
 * ├─ TabBar          5 个频道页签（横滚）
 * ├─ ApplyList       招募列表（页签 0）
 * ├─ PrivateList     私聊消息（页签 3）
 * ├─ HeadList        私聊联系人（页签 3）
 * ├─ SilentLabel    n98「该频道不可发言」（页签 0）
 * ├─ PrivateBottomBg n106 黑色九宫底（页签 3 且有数据）
 * ├─ InputBar        n75 输入条（页签 2/4：底图 / 输入框 / 表情 / 艾特 / 发送）
 * ├─ PrivateInputBar n105 输入条（页签 3 且有数据）
 * ├─ Mask            按钮_遮罩（表情 / 艾特弹窗打开时）
 * ├─ EmojiPopup      表情弹窗（44 格）
 * └─ AtPopup         艾特弹窗（好友列表）
 * ```
 *
 * ## 四个 controller 在 Cocos 里的等价物
 *
 * FGUI 的 `数据` / `页签` / `显示表情` / `艾特弹窗` 四个 controller（共 15 条
 * `gearDisplay` / `gearDisplay2`）全部收进 `presentChannel()` 一个方法：
 * 每个受控节点一行 `active = ...` 的**绝对赋值**。
 * 漏掉一条**不会报错**，只会让某个控件出现在错误的页签下 —— 所以那张表在
 * `tests/chat.test.ts` 里有独立的开关断言。
 *
 * ⚠️ `gearDisplay2` 的 `condition`：`0` = 与（AND）、`1` = 或（OR）。
 *    最容易漏的是 `按钮_遮罩`（`condition="1"` = **或**）：
 *    写成「与」的话遮罩只在两个弹窗同时打开时才亮 —— 而它们永远不会同时开 ⇒ 遮罩永不生效
 *    （点空白关不掉弹窗，且**不报错**）。
 *
 * ## 两条静默失效的时序铁律（本类已按正解写）
 *
 * ① 7 个列表的 `renderItemFn` **只在 `onInit` 里绑一次**，回调按 `index` 现取
 *    `this.xxxRows[index]` —— 回调里禁闭包捕获本趟数据，否则「点第 3 行删掉第 1 个」。
 * ② **异步预加载必须在铺行之前 `await` 完**，且预加载内容**不能**依赖 `this.xxxRows`
 *    （那一刻它是上一帧的行）。本类预加载的是「页签两态底图 + 44 张表情帧」，
 *    与行无关，天然安全；头像由行组件自己的 `FriendAvatarLoader` 异步补。
 *
 * ## 层序（`_children` 序 = 渲染序，照抄 FGUI 的 displayList）
 *
 * `PanelBg → BottomBg → RowView → Empty → TabBar → ApplyList → PrivateList → HeadList
 *  → SilentLabel → PrivateBottomBg → InputBar → PrivateInputBar → Mask → EmojiPopup → AtPopup`
 *
 * ⚠️ 三个列表必须排在 `TabBar` **之前**（FGUI 原稿如此）：页签在列表之下，
 *    列表的 `cc.Mask` 不会把页签裁掉、页签也收得到触摸。
 *    （本项目栽过这条：只改几何不改层序 ⇒ 页签被裁、点不动，单测看不出来。）
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
import { chatRepository, isChannelInited, isRecruitsFetched } from './ChatRepository';
import type { IChatRepository, IChatSnapshot, IRecruitView } from './ChatRepository';
import {
    atTag,
    ChatChannel,
    CHAT_DEFAULT_CHANNEL,
    CHAT_THEATER_HEAD_ID,
    channelsFor,
    emojiTags,
    IChatMessage,
    IChatRole,
    isPrivateChannel,
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

/**
 * 页签**组件类**直接复用好友模块的 `FriendTabButton`。
 *
 * 理由：两者的 FGUI 模板是**同一个**（`共用组件/组件/页签/组件_弹窗_页签.xml`，160×72）。
 * 模板同源再落一份实现 ⇒ 两份会各自漂移（本项目在「编辑器与客户端两份实现必须同改」上
 * 已经吃过亏）。`FriendTabButton` 的 `bind(index, handler)` / `render(text, selected, off, on)`
 * 接口本来就与业务无关，直接拿来用。
 */
type ChatTabLike = FriendTabButton;

@ccclass('ChatPage')
export class ChatPage extends PopupBase {
    /**
     * ⚠️ 目录名**必须**与磁盘一致（`assets/resources/ui/Chat/`，C 大写）：
     * Android / iOS 热更新 zip 内的路径**大小写敏感**，写成 `ui/chat/...`
     * 在 Windows 编辑器里照样能跑，真机上才会 `resources.load` 失败、变成一个空弹窗。
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

    /** 本趟列表数据（`renderItemFn` 按 index **现取**，禁闭包捕获）。 */
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
        const close = this.closeButton.getComponent(Button);
        close?.node.on(Button.EventType.CLICK, this.onCloseClick, this);

        this.bind(this.maskButton, this.onMaskClick);
        this.bind(this.atButton, this.onAtClick);
        this.bind(this.emojiButton, this.onEmojiClick);
        this.bind(this.privateEmojiButton, this.onEmojiClick);
        this.bind(this.sendButton, () => void this.onSendClick());
        this.bind(this.privateSendButton, () => void this.onSendClick());

        // ⚠️ 7 个回调只在 onInit 接一次（放 onOpen 会随每次打开重复叠加）
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
     * `userData`（都可省）：
     *   `{ channel?: number, roleId?: string | number }`
     * —— 主界面按钮在有新消息时带 `channel` / `speaker` 进来（老端 `gotoChat` 同款）。
     * 注意**私聊 id 必须转成字符串**（`uint64` ⇒ `toIdString` 口径），传数字会被 `Long` 吃掉精度。
     */
    protected async onOpen(userData?: any): Promise<void> {
        this.busy = false;
        this.revision += 1;

        const channel = Number(userData?.channel);
        this.channel = Number.isInteger(channel) && channel >= 0 && channel <= ChatChannel.Union
            ? (channel as ChatChannel)
            : CHAT_DEFAULT_CHANNEL;
        this.privateRoleId = userData?.roleId === undefined || userData?.roleId === null
            ? ''
            : String(userData.roleId);

        this.closeSubPopup();
        this.repo.listen(this, () => void this.onBroadcast());
        await this.reload();
    }

    protected onClose(): void {
        this.repo.unlisten(this);
        // 老端 `LayerChat.exit`：关界面时把已读时间落盘
        this.repo.saveRead();
        // 关掉后在飞的异步结果一律作废（否则会往已回收的 Label 上写）
        this.revision += 1;
    }

    onDestroy(): void {
        this.repo.unlisten(this);
        this.revision += 1;
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

        // 首进该频道 ⇒ 补拉一页（老端 `initMap`：每频道只拉一次）
        if (this.shouldInitChannel(snapshot)) {
            const id = isPrivateChannel(this.channel) ? Number(snapshot.selectedRoleId || 0) : 0;
            const result = await this.repo.initChannel(this.channel, id, 1, this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'offline') FW.showTip(CHAT_TEXTS.offline);
            snapshot = await this.repo.load(this.channel, this.privateRoleId);
            if (!this.alive || revision !== this.revision) return;
        }

        // 招募是**另一条协议**（`CmdTeamRecruitInitReqMsg`），同样每个会话只拉一次
        if (this.channel === ChatChannel.Recruit && !isRecruitsFetched(this.repo)) {
            const result = await this.repo.initRecruits(this);
            if (!this.alive || revision !== this.revision) return;
            if (result === 'offline') FW.showTip(CHAT_TEXTS.offline);
            snapshot = await this.repo.load(this.channel, this.privateRoleId);
            if (!this.alive || revision !== this.revision) return;
        }

        this.privateRoleId = snapshot.selectedRoleId;
        this.snapshot = snapshot;

        // 静态帧 + 表情帧先备好，再铺界面（避免「先出框后补图」的闪烁）
        await this.loadStaticFrames();
        if (!this.alive || revision !== this.revision) return;

        // ⚠️ `VirtualScrollView` 在 `start()` 里建槽位，而 `onOpen` 早于 `start()`
        //    ⇒ 不 defer 一帧的话 `refreshList` 落在「槽位还没建」的空档，表现为列表空白。
        await this.nextPopupFrame();
        if (!this.alive || revision !== this.revision) return;

        this.present();
    }

    /** 这个频道要不要补发一次 `Init`。 */
    private shouldInitChannel(snapshot: IChatSnapshot): boolean {
        if (isPrivateChannel(this.channel)) {
            // 老端 `if (privateRoleid > 0 && !initMap.get(...))` —— 没对象就不发
            const id = Number(snapshot.selectedRoleId || 0);
            if (id <= 0) return false;
            return !isChannelInited(this.repo, this.channel, id);
        }
        return !isChannelInited(this.repo, this.channel, 0);
    }

    private present(): void {
        const snapshot = this.snapshot;
        if (!snapshot) return;
        this.presentTabs(snapshot);
        this.presentChannel(snapshot);
        this.presentBodies(snapshot);
    }

    /**
     * 四个 controller 的等价物（**唯一入口**，全部绝对赋值）。
     *
     * ⚠️ `数据` 在本类按**实际能显示几条**算（`hasDataOf`），与老端有一处**有意偏离**：
     *    老端私聊分支用的是**未过滤**的 `VOChatRoleBag.GetBagAsArray().length`
     *    （`LayerChat.upDateHeadList` 里的那句 `setSelectedPage("数据", data && data.length > 0 ...)`），
     *    而列表用的是过滤后的 `others`。⇒ 若服务端只推了自己一条，老端会「数据=有 + 空列表」。
     *    这里统一用过滤后的条数，语义是「这一页有没有内容」，不会出现空列表。
     */
    private presentChannel(snapshot: IChatSnapshot): void {
        const channel = this.channel;
        const hasData = this.hasDataOf(snapshot);

        // n90：页签 0/2/4
        this.bottomBg.active = channel === ChatChannel.Recruit
            || channel === ChatChannel.World
            || channel === ChatChannel.Union;
        // n63：数据=空
        this.emptyLabel.string = CHAT_TEXTS.empty;
        this.emptyLabel.node.active = !hasData;
        // n98：页签 0（招募不可发言）
        this.silentLabel.active = channel === ChatChannel.Recruit;

        // n75 输入条：页签 2/4；其中的「艾特」自身是 pages=1,2,4 ⇒ 交集 = 2/4
        this.inputBar.active = channel === ChatChannel.World || channel === ChatChannel.Union;
        this.atButton.active = channel === ChatChannel.World || channel === ChatChannel.Union;
        this.setPlaceholder(this.inputBox, CHAT_TEXTS.inputPrompt);

        // n106 + n105：页签 3 且 数据=有（没对象时连输入框都不给）
        const privateReady = isPrivateChannel(channel) && hasData;
        this.privateBottomBg.active = privateReady;
        this.privateInputBar.active = privateReady;
        this.setPlaceholder(this.privateInputBox, CHAT_TEXTS.inputPrompt);

        // 换频道就清输入（老端 `refreshView` 第一句就是清两个输入框）
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
            // 老端 `list.scrollPane.scrollBottom()` —— 进来先看到最新一条
            this.rowList.scrollToBottom(false);
        }

        this.applyList.node.active = hasData && channel === ChatChannel.Recruit;
        if (this.applyList.node.active) {
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
    // 行渲染（槽位被 clone 复用 ⇒ 回调里按 index **现取**）
    // ============================================================

    private renderTabNode(node: Node, index: number): void {
        const button = node.getComponent(FriendTabButton) as ChatTabLike | null;
        const channel = this.channels[index];
        if (!button || channel === undefined) {
            node.active = false;
            return;
        }
        node.active = true;
        // ⚠️ 每次都要重设 index（节点会被复用到别的下标）
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
        if (!bubble) return;
        if (!message) {
            bubble.hide();
            return;
        }
        node.active = true;
        const selfId = this.snapshot?.selfId ?? '';
        // 战区整块换成系统头像（老端 `if (selectType === CHAT_CHANNEL_THEATER) headIcon = 70003`）
        const avatarId = this.channel === ChatChannel.Theater
            ? CHAT_THEATER_HEAD_ID
            : message.speaker.img;
        bubble.render(
            isSelfMessage(message, selfId),
            message.speaker.name,
            parseEmoji(message.content, emojiRichSrc),
            avatarId,
        );
    }

    private renderPrivateNode(node: Node, index: number): void {
        const bubble = node.getComponent(ChatPrivateBubble);
        const message = this.privateRows[index];
        if (!bubble) return;
        if (!message) {
            bubble.hide();
            return;
        }
        node.active = true;
        const selfId = this.snapshot?.selfId ?? '';
        bubble.render(
            isSelfMessage(message, selfId),
            message.speaker.name,
            parseEmoji(message.content, emojiRichSrc),
            message.speaker.img,
        );
    }

    private renderRecruitNode(node: Node, index: number): void {
        const row = node.getComponent(ChatRecruitRow);
        const view = this.recruitRows[index];
        if (!row) return;
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        const selfId = this.snapshot?.selfId ?? '';
        row.onJoin = () => this.dispatchIndex(index, (i) => this.onRecruitJoin(i));
        row.onHead = () => this.dispatchIndex(index, (i) => this.onPlayerInfo(this.recruitRows[i]?.roleId ?? ''));
        row.render(
            view.name,
            view.stageName,
            formatText(CHAT_TEXTS.powerTemplate, view.power),
            view.img,
            isSelfRecruit(view, selfId),
            CHAT_TEXTS.joinTeam,
        );
    }

    private renderHeadNode(node: Node, index: number): void {
        const row = node.getComponent(ChatPrivateHead);
        const view = this.headRows[index];
        if (!row) return;
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.onSelect = () => this.dispatchIndex(index, (i) => void this.onHeadSelect(i));
        row.onRemove = () => this.dispatchIndex(index, (i) => void this.onHeadRemove(i));
        row.render(view.name, view.img);
    }

    private renderEmojiNode(node: Node, index: number): void {
        const item = node.getComponent(ChatEmojiItem);
        if (!item) return;
        const frame = this.emojiFrames[index] ?? null;
        if (index >= this.emojiFrames.length) {
            item.hide();
            return;
        }
        node.active = true;
        item.onPick = () => this.onEmojiPick(index);
        // ⚠️ 绝对赋值：`null` 也要写（否则复用的节点会留着上一格的图）
        item.render(frame);
    }

    private renderAtNode(node: Node, index: number): void {
        const row = node.getComponent(ChatAtRow);
        const view = this.atRows[index];
        if (!row) return;
        if (!view) {
            row.hide();
            return;
        }
        node.active = true;
        row.onPick = () => this.dispatchIndex(index, (i) => this.onAtPick(i));
        row.render(view.name, this.serverNameOf(view), view.img);
    }

    /** 回调里 `index` 可能已经越界（列表刚变短）—— 取不到就什么都不做。 */
    private dispatchIndex(index: number, action: (index: number) => void): void {
        if (index < 0) return;
        action(index);
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
        const content = (input?.string ?? '').trim();
        if (!content) {
            FW.showTip(CHAT_TEXTS.emptyInput);
            return;
        }

        // ⚠️ 老端在这里 `await this.SDKMgr.checkMessage(content, true)`；
        //    Demo3.8 **没有 SDK 层** ⇒ 本轮不做任何过滤（不假装校验过）。
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

    /** 老端：往**两个**输入框都追加 `[:N]`。 */
    private onEmojiPick(index: number): void {
        const tag = `[:${index}]`;
        this.inputBox.string = `${this.inputBox.string ?? ''}${tag}`;
        this.privateInputBox.string = `${this.privateInputBox.string ?? ''}${tag}`;
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
        // 老端只往**公共频道**输入框追加，并且顺手关掉弹窗
        this.inputBox.string = `${this.inputBox.string ?? ''}${atTag(row.name)}`;
        this.closeSubPopup();
    }

    private onMaskClick(): void {
        this.closeSubPopup();
    }

    /** 关掉表情 / 艾特弹窗 + 遮罩（老端 `closeInfo()`）。 */
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
     * ⚠️ **本轮发不出这一包**：老端 `ModelTeam.RequestTeamJoin(roleId, true)` 最终发的是
     *    `CmdTeamReplyInviteReqMsg{ inviteId, agree, attr }`，其中 `attr: CmdBattleRoleAttr`
     *    是**战前属性快照**（卡组 + 属性 + 改造列表）；Demo3.8 全工程没有一处构造过它
     *    （卡牌养成 / 战力结算体系尚未接入）⇒ 如实提示，**不假装加入了队伍**。
     *    「自己不能加入自己」这条**本地判据仍然生效**（老端 `onClickJoin` 第一句）。
     */
    private onRecruitJoin(index: number): void {
        const row = this.recruitRows[index];
        if (!row) return;
        const selfId = this.snapshot?.selfId ?? '';
        if (isSelfRecruit(row, selfId)) {
            FW.showTip(CHAT_TEXTS.cannotJoinSelf);
            return;
        }
        FW.showTip(CHAT_TEXTS.joinUnavailable);
    }

    /**
     * 点头像看资料 —— Demo3.8 没有 `CtrlPlayer.openOtherPlayerInfo` 对应的界面。
     *
     * 但「`roleId < 1e4` 是系统播报、不可查看」这条判据**照抄老端**（`onClickPlayerInfo`）。
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
     * 服务端推了一条新消息（`CmdChatBroMsg`）。
     *
     * 老端是「任何频道的广播都 `refreshView()`」—— 别偷懒只刷当前频道，
     * 否则私聊对象列表里的未读红点永远不更新（本轮红点未接，但刷新口径照抄）。
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
                emojiTags().map((tag) => loadArt(emojiArtName(Number(tag)), CHAT_ART_ROOT)),
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

    /**
     * 区服名。
     *
     * 老端 `ModelServer.getServerInfo(selectServerId).name`；Demo3.8 **没有区服表**
     * （`assets/remoteRef` 下只有 `serverRank`）⇒ 按老端自己的 fallback 显示 id：
     * `serverInfo ? serverInfo.name : selectServerId`。
     */
    private serverNameOf(row: IChatRole): string {
        return String(row.selectServerId);
    }

    private setPlaceholder(box: EditBox, text: string): void {
        if (box) box.placeholder = text;
    }

    private onCloseClick(): void {
        this.closeByButton();
    }

    private bind(node: Node, handler: () => void): void {
        const button = node?.getComponent(Button);
        if (!button) {
            console.warn(`[Chat] ${node?.name ?? '?'} 上没有 cc.Button，点击不会生效`);
            return;
        }
        button.node.on(Button.EventType.CLICK, handler, this);
    }

    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }
}
