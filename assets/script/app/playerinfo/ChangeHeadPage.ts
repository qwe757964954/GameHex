import { _decorator, Button, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { Toast } from '../common/Toast';
import { HeadArt } from '../HeadArt';
import { ChangeHeadItem } from './ChangeHeadItem';
import { HeadGridList } from './HeadGridList';
import { PLATFORM_HEAD_ID, writeFailText } from './PlayerInfoTable';
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';
import { playerInfoRepository } from './PlayerInfoRepository';
import type { IHeadEntry, IPlayerInfoRepository } from './PlayerInfoRepository';

const { ccclass, property } = _decorator;

/** `ChangeHeadPage.open()` 的 `userData`。 */
export interface IChangeHeadParams {
    /**
     * 已拥有的头像 `resId` 集合 —— 用来判「解锁 / 未解锁」。
     *
     * ⚠️ 不传就是「全解锁」：本工程 `CacheMgrGen` 里**没有背包 getter**，
     * `repo.loadHeads()` 拿不到 `touxiang` 类道具（见 `PlayerInfoRepository` 文件头缺口 ②）。
     * 留这个入口是为了让单测 / 端到端探针能喂假集合，把**灰化分支**真的跑一遍
     * —— 否则那条分支永远没人验过。
     */
    ownedResIds?: ReadonlySet<number> | readonly number[] | null;
}

/**
 * 「更换头像」弹窗 —— 老端 `LayerChangeHead`（`LayerChangeHeadUI`），
 * FGUI `个人信息/组件/更换头像/组件_个人信息_更换头像界面.xml`（720×1280；弹窗底 `popBg` 680×670）。
 *
 * 版面：弹窗底 + 标题「更换头像」+ 关闭 → 头像大预览 + 描述（`text_desc`）
 * → 4 列 × 2 行的头像网格（`list`，`scale=0.9`）→ 「确认」。
 *
 * ## 三处与老端一致的判定
 *
 * ① **选中态**：`item.setSelectedPage("选中", id == selectId && "是" || "否")` ⇒ `ChangeHeadItem.setSelected`
 * ② **解锁态**：`item.setSelectedPage("是否解锁", CheckHasHead(id) && "是" || "否")` ⇒ `ChangeHeadItem.setLocked`
 * ③ **确认**：未解锁 → 提示 `LayerChangeHead_1`；与当前头像相同 → **直接关**（老端 `nowId == selectId` 分支）。
 *
 * ## 已知缺口（有意留下，不造假）
 *
 * ① **平台头像（id 0）的图加载不了**：老端走 `head.SetUrl(platformImg)`（微信 / 抖音的远端头像 url），
 *    本工程**没有远端贴图加载器**，也没有 `platformImg` 落到 `loadHeads()` 里
 *    （`buildHeadIdList` 只在 `platformImg` 非空时才把 0 排进列表）。所以列表里实际只有
 *    `head` 表那 20 张；`PLATFORM_HEAD_ID` 分支保留是为了语义完整（接加载器时改这一处即可）。
 * ② **新头像红点恒灭**：老端 `com_rd` 由红点系统驱动（`ModelPlayer.GetIsNew(id)` / `ClickNew(id)`）；
 *    本工程的红点框架（`app/rd/**`）没有「头像」这个变量类 ⇒ 一律 `setNew(false)`（规则 82）。
 * ③ **不重复拉平台用户信息**：老端 `init` 里在 `GetPlatformHead()` 为空时去调
 *    `WxUtil.getUserInfo` / `TTUtil.getUserInfo` 拿昵称头像并回传；本工程没有平台 SDK 出口。
 */
@ccclass('ChangeHeadPage')
export class ChangeHeadPage extends PopupBase {
    /** 预制体路径（目录名必须与磁盘一致，热更新 zip 内大小写敏感）。 */
    static prefabPath = 'ui/PlayerInfo/ChangeHead';

    // ---------- 弹窗框 ----------
    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮' })
    closeButton: Node = null;

    // ---------- 预览区 ----------
    @property({ type: Sprite, tooltip: 'HeadBox/HeadIcon：当前选中头像的大预览（`com_head.icon`）' })
    headIcon: Sprite = null;

    @property({ type: Label, tooltip: 'DescLabel：头像名 / 「自定义头像」（`text_desc`）' })
    descLabel: Label = null;

    // ---------- 列表 ----------
    @property({ type: HeadGridList, tooltip: 'List：4 列 × 2 行头像网格' })
    grid: HeadGridList = null;

    // ---------- 底部 ----------
    @property({ type: Node, tooltip: 'ConfirmBtn：确认（FGUI `btn_confirm`，黄底）' })
    confirmButton: Node = null;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IPlayerInfoRepository = playerInfoRepository;
    /** 列表数据（顺序与 `HeadGridList` 的下标一致）。 */
    private entries: readonly IHeadEntry[] = [];
    /** `resId` → 图（**必须在本轮铺界面之前全部 await 完**，见 `reload()`）。 */
    private frames = new Map<number, SpriteFrame | null>();
    /** 当前选中（还没提交）。 */
    private selectId = PLATFORM_HEAD_ID;
    /** 服务端当前头像（用来判「有没有变」）。 */
    private currentId = PLATFORM_HEAD_ID;
    /** 解锁判定用的「已拥有」集合。 */
    private owned: ReadonlySet<number> | readonly number[] | null = null;
    /** 每次取数递增，丢弃过期结果。 */
    private loadRevision = 0;
    /** 确认请求进行中（防连点重复发请求）。 */
    private confirming = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.confirmButton, () => { void this.onConfirm(); });

        // ⚠️ Grid 的两个回调**只在这里绑一次**：`HeadGridList` 内部每次重绑槽位都会现调它们，
        //    回调体按 `dataIndex` **现取** `this.entries`（规则 55 —— 捕获入参会永远显示第一屏）。
        if (this.grid) {
            this.grid.renderItem = (node: Node, dataIndex: number) => this.renderItem(node, dataIndex);
            this.grid.onItemClick = (dataIndex: number) => this.onItemClick(dataIndex);
        }
    }

    protected async onOpen(userData?: IChangeHeadParams): Promise<void> {
        this.owned = userData?.ownedResIds ?? null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.loadRevision += 1;
        this.entries = [];
        this.frames.clear();
        this.owned = null;
        this.confirming = false;
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IPlayerInfoRepository): void {
        this.repo = repository;
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

    private async reload(): Promise<void> {
        const revision = ++this.loadRevision;

        const snapshot = await this.repo.loadSelf();
        if (!this.alive || revision !== this.loadRevision) return;

        const entries = await this.repo.loadHeads(this.owned);
        if (!this.alive || revision !== this.loadRevision) return;

        // 图**先全部 await 完**再铺界面：`HeadGridList.renderItem` 是同步回调，
        // 里面 `await` 只会漏进一帧空白格（与 `PlayerInfoPage.reload` 同一口径）。
        const frames = await this.loadAllFrames(entries);
        if (!this.alive || revision !== this.loadRevision) return;

        this.frames = frames;
        this.entries = entries;
        this.currentId = snapshot.img;
        this.selectId = snapshot.img;

        this.grid?.refreshList(this.entries.length);
        this.presentDesc();
        this.presentPreview();
    }

    /** 把列表里每一张头像的图都取回来（失败的记 `null`，格子留底框）。 */
    private async loadAllFrames(entries: readonly IHeadEntry[]): Promise<Map<number, SpriteFrame | null>> {
        const out = new Map<number, SpriteFrame | null>();
        await Promise.all(entries.map(async (entry) => {
            out.set(entry.id, await this.loadFrameOf(entry));
        }));
        return out;
    }

    /**
     * 一格的头像图。
     *
     * ⚠️ 平台头像（id 0）走的是远端 url（老端 `head.SetUrl(platformImg)`），本工程没有
     * 远端贴图加载器 ⇒ 恒 `null`（见文件头缺口 ①）。这里**不**拿别的头像顶替：
     * 「平台头像」和「表里头像」是两种东西，混着显示比空着更误导。
     */
    private async loadFrameOf(entry: IHeadEntry): Promise<SpriteFrame | null> {
        if (entry.id === PLATFORM_HEAD_ID) return null;
        return this.loadHeadFrameBy(String(entry.id));
    }

    /** `head` 表 `resId` → 图（走 `head.json → icon.json → icons/head/<资源名>` 两级映射，内部已 catch）。 */
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

    /**
     * 铺一格。
     *
     * ⚠️ 每一项都**无条件写**（规则 82）：槽位会被不同头像复用，
     * 「没数据就不动」会把上一屏的图 / 选中框留在屏幕上。
     */
    private renderItem(node: Node, dataIndex: number): void {
        const item = node.getComponent(ChangeHeadItem);
        if (!item) return;
        const entry = this.entries[dataIndex];
        if (!entry) return;

        item.dataIndex = dataIndex;
        item.setHead(this.frames.get(entry.id) ?? null);
        item.setSelected(entry.id === this.selectId);
        item.setLocked(!entry.unlocked);
        // 老端：`GetIsNew(id)` 驱动 `com_rd`；本工程不接红点变量类（见文件头缺口 ②）。
        item.setNew(false);
    }

    /** 点一格：只改选中，不提交（老端提交在 `btn_confirm`）。 */
    private onItemClick(dataIndex: number): void {
        const entry = this.entries[dataIndex];
        if (!entry) return;
        this.selectId = entry.id;
        this.presentDesc();
        this.presentPreview();
        // 重铺槽位让选中框跟上。用同一个 `total` 调 `refreshList` —— 它内部
        // `_topRow = min(_topRow, _maxTopRow)` **不会**把滚动位置重置回顶部。
        this.grid?.refreshList(this.entries.length);
    }

    /** 顶部大预览 = 当前选中的头像。 */
    private presentPreview(): void {
        if (!this.headIcon) return;
        this.headIcon.spriteFrame = this.frames.get(this.selectId) ?? null;
    }

    /**
     * 描述文案。
     * 老端 `UpdateHead()`：`selectId == 0` ⇒ `LayerChangeHead_2`（「自定义头像」），
     * 否则取 `GetRefHead(selectId).name`。
     */
    private presentDesc(): void {
        if (!this.descLabel) return;
        if (this.selectId === PLATFORM_HEAD_ID) {
            this.descLabel.string = PLAYER_INFO_TEXTS.changeHeadPlatformDesc;
            return;
        }
        const entry = this.entries.find((e) => e.id === this.selectId);
        this.descLabel.string = entry ? entry.name : PLAYER_INFO_TEXTS.changeHeadNoName;
    }

    // ============================================================
    // 交互
    // ============================================================

    /**
     * 确认。
     *
     * 老端 `btn_confirm`：
     * ```js
     * if (!CheckHasHead(selectId)) { FW.showTip(G_W("LayerChangeHead_1")); return }
     * let nowId = GetRole().GetImg()
     * if (nowId != selectId) {
     *     let result = await RequestChangeImg(selectId)
     *     if (result) this.unload()          // 成功才关
     * } else { this.unload() }               // 没变直接关
     * ```
     */
    private async onConfirm(): Promise<void> {
        if (this.confirming) return;

        const entry = this.entries.find((e) => e.id === this.selectId);
        if (!entry || !entry.unlocked) {
            Toast.show(PLAYER_INFO_TEXTS.changeHeadLocked);
            return;
        }
        if (this.selectId === this.currentId) {
            this.close(PopupCloseReason.Manual);
            return;
        }

        this.confirming = true;
        try {
            const result = await this.repo.changeHead(this.selectId);
            if (!this.alive) return;
            // ⚠️ `offline`（没连上服务器，包都没发）与 `failed`（发出去了没成）**分开提示** ——
            //    两态共用一句「更换头像失败」会把「网络断了」读成「这个功能坏了」（规则见 `writeFailText`）。
            if (result === 'ok') this.close(PopupCloseReason.Manual);
            else Toast.show(writeFailText(result, PLAYER_INFO_TEXTS.changeHeadFailed));
        } finally {
            this.confirming = false;
        }
    }

    /** 探针用：当前选中的头像 `resId`。 */
    get selectedId(): number {
        return this.selectId;
    }

    /** 探针用：列表条数。 */
    get headCount(): number {
        return this.entries.length;
    }
}
