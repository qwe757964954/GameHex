import { _decorator, Button, EditBox, Label, Node, Sprite, SpriteFrame, UITransform } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { Toast } from '../common/Toast';
import { HeadArt } from '../HeadArt';
import { ChangeHeadPage } from './ChangeHeadPage';
import { expProgressOf, formatExpRatio, formatLevel, formatServer, formatUid, writeFailText } from './PlayerInfoTable';
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';
import { playerInfoRepository } from './PlayerInfoRepository';
import type { IPlayerInfoRepository, IPlayerInfoSnapshot } from './PlayerInfoRepository';
import { RenamePage } from './RenamePage';
import { SettingPage } from './SettingPage';

const { ccclass, property } = _decorator;

/**
 * 「个人信息」弹窗 —— 老端 `LayerPlayerInfo`（`LayerPlayerInfoUI`），
 * FGUI `个人信息/组件/组件_个人信息_主界面.xml`（720×1280，与画布 1:1）。
 *
 * 版面：公共弹窗底 626×601（标题「个人信息」+ 关闭）
 * → 头像框 110×110 + 「更换头像」按钮 → 名字底条 + 改名铅笔
 * → 等级 / 经验条 / uid / 区服 → 小标题条 → 兑换码输入框 + 「确定」 → 「切换角色」。
 *
 * ## 与老端的三处有意偏离（都写在对应方法上）
 *
 * ① **`自己` 控制器恒取「是」**：老端同一份 FGUI 既当自己面板又当他人面板
 *    （`setSelectedPage("自己", isMySelf ? "是" : "否")`，会切掉改名入口）。本工程把
 *    「他人信息」拆成独立 prefab `PlayerInfoOther`（老端另有 `组件_查看信息_界面`）⇒
 *    本页**只服务自己**，生成器烘的就是「是」那一页，运行时不切页。
 * ② **红点不接 `RDExprType.RDHead`**：老端的头像红点由红点系统变量驱动；本工程的红点
 *    框架（`app/rd/**`）还没有「头像」这个变量类。这里**无条件写 `active = false`**
 *    （规则 82），留一个明确的接线口而不是烘一个永远亮着的红点。
 * ③ **「切换角色」只提示**：老端走 `SDKMgr.switchRole()`（平台 SDK 的选角页）；本工程登录
 *    链路没有等价出口 ⇒ 与主线任务「前往」同一处置：留点击口 + 提示，不硬编路由。
 *
 * ## 数据来源
 *
 * 老端 `enterAsync()` 每次现调 `UpdateData()` 取 `ModelRole.GetRole()`（自己那份缓存），
 * 所以本页 `onOpen` 里也**自己读**（`repo.loadSelf()`，不发请求、离线可用），不从入口接快照。
 */
@ccclass('PlayerInfoPage')
export class PlayerInfoPage extends PopupBase {
    /**
     * 弹窗预制体在 resources 下的路径。
     * ⚠️ 目录名必须与磁盘一致（`assets/resources/ui/PlayerInfo/`）——热更新 zip 内路径
     * 大小写敏感，写错编辑器里照样能跑、真机才 `resources.load` 失败变空弹窗。
     */
    static prefabPath = 'ui/PlayerInfo/PlayerInfo';

    // ---------- 弹窗框 ----------
    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮（挂 cc.Button）' })
    closeButton: Node = null;

    // ---------- 头像区 ----------
    @property({ type: Sprite, tooltip: 'HeadBox/HeadIcon：头像图（90×90）' })
    headIcon: Sprite = null;

    @property({ type: Node, tooltip: 'ChangeHeadBtn：「更换头像」按钮' })
    changeHeadButton: Node = null;

    @property({ type: Node, tooltip: 'ChangeHeadBtn/RedDot：新头像红点（本工程恒隐藏，见文件头 ②）' })
    changeHeadDot: Node = null;

    @property({ type: Node, tooltip: 'SettingBtn：「设置」按钮' })
    settingButton: Node = null;

    // ---------- 名字区 ----------
    @property({ type: Label, tooltip: 'NameLabel：玩家名（`text_name`）' })
    nameLabel: Label = null;

    @property({ type: Node, tooltip: 'RenameBtn：改名铅笔（`btn_rename`）' })
    renameButton: Node = null;

    // ---------- 数值区 ----------
    @property({ type: Label, tooltip: 'LevelLabel：等级（`text_level`）' })
    levelLabel: Label = null;

    @property({ type: Node, tooltip: 'ExpBar/ExpBg：经验条底（满宽，用来取宽度上限）' })
    expBg: Node = null;

    @property({ type: Node, tooltip: 'ExpBar/ExpFill：经验条填充（锚点 (0,1)，只改宽度）' })
    expFill: Node = null;

    @property({ type: Label, tooltip: 'ExpBar/ExpLabel：经验数值（老端漏写，本工程补上 `当前/上限`）' })
    expLabel: Label = null;

    @property({ type: Label, tooltip: 'UidLabel：玩家 ID（`text_uid`）' })
    uidLabel: Label = null;

    @property({ type: Label, tooltip: 'ServerLabel：区服名（`text_serverid`）' })
    serverLabel: Label = null;

    // ---------- 兑换码 ----------
    @property({ type: EditBox, tooltip: 'RedeemInput/RedeemEditBox：兑换码输入框' })
    redeemInput: EditBox = null;

    @property({ type: Node, tooltip: 'RedeemBtn：兑换码「确定」' })
    redeemButton: Node = null;

    // ---------- 底部 ----------
    @property({ type: Node, tooltip: 'LogoutBtn：「切换角色」（本工程只提示，见文件头 ③）' })
    logoutButton: Node = null;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IPlayerInfoRepository = playerInfoRepository;
    /** 当前快照。 */
    private snapshot: IPlayerInfoSnapshot | null = null;
    /** 头像图（异步取回，`present` 时用）。 */
    private headFrame: SpriteFrame | null = null;
    /** 每次取数递增，丢弃过期结果。 */
    private loadRevision = 0;
    /** 兑换码请求进行中（防连点重复发请求）。 */
    private redeeming = false;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.changeHeadButton, () => { void this.onChangeHead(); });
        this.bindButton(this.settingButton, () => { void this.onSetting(); });
        this.bindButton(this.renameButton, () => { void this.onRename(); });
        this.bindButton(this.redeemButton, () => { void this.onRedeem(); });
        this.bindButton(this.logoutButton, () => this.onLogout());
    }

    protected async onOpen(): Promise<void> {
        this.snapshot = null;
        this.headFrame = null;
        await this.reload();
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.loadRevision += 1;
        this.snapshot = null;
        this.headFrame = null;
        this.redeeming = false;
    }

    /** 供测试 / 探针注入替身 Repository。 */
    setRepository(repository: IPlayerInfoRepository): void {
        this.repo = repository;
    }

    /** 重跑一遍「取数 → 铺界面」。 */
    async refresh(): Promise<void> {
        await this.reload();
    }

    /** 弹窗还活着吗（异步回来时页面可能已被关掉）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid && this.isPopupOpen;
    }

    /**
     * 绑按钮。
     *
     * ⚠️ FGUI `<loader>` / `<image>` 迁过来**只有 `cc.Sprite`、没有 `cc.Button`**（规则 81b）：
     * 那种节点上绑 `Button.EventType.CLICK` 是**静默死按钮**。反过来 `<component extention="Button">`
     * 形态的按钮迁过来**有** `cc.Button`，绑 `TOUCH_END` 会绕过 `interactable`。按实际组件分流。
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
        this.snapshot = snapshot;

        // 图必须先 **await 完**再铺界面（与 `MainTaskDetailPage.present` 同一口径）：
        // 铺界面是同步的，在里面现加载会先闪一帧空图；更糟的是漏进预加载集合时**静默留白**。
        this.headFrame = await this.loadHeadFrameOf(snapshot);
        if (!this.alive || revision !== this.loadRevision) return;

        this.present(snapshot);
    }

    /**
     * 按 `platformImg` / `img` 取头像图 —— 与老端 `UpdateView` 的分支同序：
     * ```js
     * if (img == 0 && platformImg != "") head.SetUrl(platformImg)      // 远端 url
     * else head.SetUrlByIcon(GetPlayerIcon(img))                       // 表内资源名
     * ```
     *
     * ⚠️ 本工程**没有远端贴图加载器**（`platformImg` 是微信 / 抖音的头像 url）⇒ 平台头像分支
     * 落回表里第一张头像占位，保证「有头像框、有图」而不是空白。这是已知缺口，
     * 接平台头像加载器时只需改这里。
     */
    private async loadHeadFrameOf(snapshot: IPlayerInfoSnapshot): Promise<SpriteFrame | null> {
        const direct = await this.loadHeadFrameBy(String(snapshot.img));
        if (direct || !snapshot.platformImg) return direct;

        const heads = await this.repo.loadHeads();
        const first = heads.find((entry) => entry.id > 0);
        return first ? this.loadHeadFrameBy(String(first.id)) : null;
    }

    /**
     * `head` 表 `resId` → 图。
     * 走 `HeadArt.loadHeadFrame`（`head.json → icon.json → icons/head/<资源名>` 两级映射，
     * 且该函数**内部已 catch**，表读不到只 warn 不会抛）。
     */
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

        // 全部**无条件写**（规则 82）——同一实例会被不同角色复用。
        if (this.nameLabel) this.nameLabel.string = snapshot.roleName;
        if (this.levelLabel) this.levelLabel.string = formatLevel(snapshot.level);
        if (this.uidLabel) this.uidLabel.string = formatUid(snapshot.roleId);
        if (this.serverLabel) this.serverLabel.string = formatServer(snapshot.serverName);

        this.presentExp(snapshot);
        this.presentRedDots();
    }

    /**
     * 经验条。
     *
     * ⚠️ **不用 `cc.ProgressBar`**（规则 83）：它会回写 `barSprite.contentSize.width` 并把锚点
     * 强制成 `(0, 0.5)`。这里底槽与填充在 prefab 里**同盒同锚点 `(0,1)`**（左缘重合），
     * 所以「改填充宽度」就是全部动作。
     *
     * 老端 `pr.max = expMax || 1; pr.value = exp || 0`。
     */
    private presentExp(snapshot: IPlayerInfoSnapshot): void {
        const full = this.expBg?.getComponent(UITransform)?.contentSize.width ?? 0;
        const fillUi = this.expFill?.getComponent(UITransform);
        if (fillUi && full > 0) {
            const ratio = expProgressOf(snapshot.exp, snapshot.expMax);
            fillUi.setContentSize(full * ratio, fillUi.contentSize.height);
        }
        // 有意偏离：FGUI 的 `经验值_进度.title` 节点存在但老端从不写它（恒空），
        // 这里补上 `当前/上限` —— 节点语义明确，且不影响任何几何。
        if (this.expLabel) this.expLabel.string = formatExpRatio(snapshot.exp, snapshot.expMax);
    }

    /** 红点：本工程不接头像红点变量类，一律隐藏（见文件头 ②）。 */
    private presentRedDots(): void {
        if (this.changeHeadDot) this.changeHeadDot.active = false;
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 头像框 / 「更换头像」→ 换头像弹窗。 */
    private async onChangeHead(): Promise<void> {
        await ChangeHeadPage.open();
        // 换完头像可能已经改了 `img` ⇒ 静默重刷一次（老端靠 `VORoleBag.OnChanged` 事件）。
        if (this.alive) await this.reload();
    }

    /** 「设置」→ 设置面板。 */
    private async onSetting(): Promise<void> {
        await SettingPage.open();
        if (this.alive) await this.reload();
    }

    /** 改名铅笔 → 改名弹窗。 */
    private async onRename(): Promise<void> {
        const current = this.snapshot?.roleName ?? '';
        await RenamePage.open({ userData: { currentName: current } });
        if (this.alive) await this.reload();
    }

    /**
     * 兑换码「确定」。
     *
     * 老端 `LayerPlayerInfoUI`：
     * ```js
     * let s = com.tm("组件_兑换码输入框.兑换码").text
     * if (s != "" && s != null) { await RequestCodeExchange(s); setText("") }
     * else { FW.showTip(G_W("LayerSetting_1")) }        // 「兑换码不能为空」
     * ```
     */
    private async onRedeem(): Promise<void> {
        if (this.redeeming) return;
        const raw = this.redeemInput?.string ?? '';
        if (!raw || raw.trim().length === 0) {
            Toast.show(PLAYER_INFO_TEXTS.redeemEmpty);
            return;
        }
        this.redeeming = true;
        try {
            const code = raw.trim();
            const result = await this.repo.redeem(code);
            if (!this.alive) return;
            if (result === 'ok') {
                if (this.redeemInput) this.redeemInput.string = '';
                // 老端服务端直发奖励、客户端不弹成功提示；这里给一句明确反馈（v1 已写进文案表）。
                Toast.show(PLAYER_INFO_TEXTS.redeemSuccess);
            } else {
                Toast.show(writeFailText(result, PLAYER_INFO_TEXTS.redeemFailed));
            }
        } finally {
            this.redeeming = false;
        }
    }

    /** 「切换角色」——只提示（见文件头 ③）。 */
    private onLogout(): void {
        Toast.show(PLAYER_INFO_TEXTS.logoutNotWired);
    }

    /** 探针用：当前输入框里的兑换码。 */
    get redeemCode(): string {
        return this.redeemInput?.string ?? '';
    }
}
