import { _decorator, Button, EditBox, Label, Node, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../framework/ui/PopupDef';
import { CommonTips } from '../common/CommonTips';
import { Toast } from '../common/Toast';
import { loadItemIconArt } from '../itemdetail/ItemDetailArtLoader';
import {
    checkRenameInput,
    formatFreeRenameTips,
    formatRenameCostConfirm,
    isFreeRenamePage,
    RenameInputState,
    sanitizePlayerName,
    writeFailText,
} from './PlayerInfoTable';
import { PLAYER_INFO_TEXTS } from './PlayerInfoTexts';
import { playerInfoRepository } from './PlayerInfoRepository';
import type { IRenameCostInfo, IPlayerInfoRepository } from './PlayerInfoRepository';

const { ccclass, property } = _decorator;

/** `RenamePage.open()` 的 `userData`。 */
export interface IRenameParams {
    /**
     * 当前昵称（首屏初值）。
     *
     * 不传也会自己 `loadSelf()` 取一遍 —— 这个入口只是让 `PlayerInfoPage` 打开它时
     * 输入框第一帧就有字，而不是先空一帧再填。
     */
    currentName?: string;
}

/**
 * 「改名」弹窗 —— 老端 `LayerRename`（`LayerRenameUI`），
 * FGUI `个人信息/组件/更换昵称/组件_个人信息_更换昵称界面.xml`（720×1280；弹窗底 `popBg` 680×441）。
 *
 * 版面：弹窗底 + 标题「改名」+ 关闭 → 姓名输入框 + 输入说明
 * → 「免费」（绿底）/「确定」（带消耗图标 + `xN`）→ 底部「剩余免费次数：N」
 * → （不可见但可点的）`组件_GM开关`。
 *
 * ## 判定链（照抄老端 `按钮_确定` 的回调）
 *
 * ```text
 * 过滤非法字符（sanitizePlayerName）
 *   → 空        ⇒ LayerRename_2「昵称不能为空哦~」
 *   → 与原名相同 ⇒ LayerRename_3「请填写新的昵称~」
 *   → 敏感词     ⇒ ROLE_NAME_CONTAIN_SENSITIVE_WORD「玩家名称包含敏感字」（并把输入框清成 ***）
 *   → 发请求     ⇒ 成功 LayerRename_1「修改成功」+ 关闭；失败给一句明确提示
 * ```
 * 老端在「发请求」之前还有一段**金币判定**：手上有改名卡（`renameItemId`）就走免费，
 * 否则比 `renameCostGem` 与金币数，不够弹 `LayerRename_5`，够则弹二次确认（`LayerRename_4`）。
 * 本工程见下面缺口 ①，金币那一支**直接发请求、由服务端拒**，不再本地拦。
 *
 * ## 已知缺口（有意留下，不造假）
 *
 * ① **本地不判「买得起」**：老端 `ModelGoods.GetGoodsNumberByRefId(...)` 查背包；
 *    本工程 `CacheMgrGen` **没有背包 getter** ⇒ 拿不到改名卡数量与金币数量。
 *    所以 `按钮_确定` 上的图标 / 数量按**配置表常量**显示（金币 `x500`），
 *    真实扣费以服务端为准（不够时服务端会拒，走 `renameRequestFailed`）。
 * ② **敏感词走服务端**：老端 `SDKMgr.checkMessage(name)` 是平台内容安全接口；
 *    本工程没有等价出口 ⇒ 默认**放行**（`sensitiveChecker` 留注入点，探针 / 单测可喂假实现
 *    把 `***` 那条分支跑通）。
 * ③ **GM 开关只计数**：老端连点 5 次 `gmgmgm+-` 会打开 `LayerGMEntrance`；本工程没有 GM 面板 ⇒
 *    计数逻辑保留（行为一致），达标时给一句「未接入」提示，不硬编路由。
 * ④ **不拉平台昵称**：老端 `init` 里在微信 / 抖音环境下拿平台昵称预填（`wxrename` / `ttrename`
 *    存档做一次性）。本工程没有平台 SDK 出口。
 */
@ccclass('RenamePage')
export class RenamePage extends PopupBase {
    /** 预制体路径（目录名必须与磁盘一致，热更新 zip 内大小写敏感）。 */
    static prefabPath = 'ui/PlayerInfo/Rename';

    // ---------- 弹窗框 ----------
    @property({ type: Node, tooltip: 'PopBg/CloseBtn：关闭按钮' })
    closeButton: Node = null;

    // ---------- 输入 ----------
    @property({ type: EditBox, tooltip: 'NameInput：姓名输入框（FGUI `文本_输入姓名`）' })
    nameInput: EditBox = null;

    // ---------- 按钮 ----------
    @property({ type: Node, tooltip: 'FreeBtn：「免费」（FGUI `按钮_免费`，绿底，免费页显示）' })
    freeButton: Node = null;

    @property({ type: Node, tooltip: 'ConfirmBtn：「确定」（FGUI `按钮_确定`，付费页显示）' })
    confirmButton: Node = null;

    @property({ type: Sprite, tooltip: 'ConfirmBtn/CostIcon：消耗图标（改名卡 / 金币）' })
    confirmCostIcon: Sprite = null;

    @property({ type: Label, tooltip: 'ConfirmBtn/CostLabel：消耗数量（`x1` / `x500`）' })
    confirmCostLabel: Label = null;

    // ---------- 底部 ----------
    @property({ type: Label, tooltip: 'TipsLabel：「剩余免费次数：N」（FGUI `text_tips`，原稿是 UBB）' })
    tipsLabel: Label = null;

    @property({ type: Node, tooltip: 'GmBtn：彩蛋按钮（FGUI `组件_GM开关`），不挂也不影响主流程' })
    gmButton: Node = null;

    /**
     * 敏感词检查器（注入点）。
     * `null` = 本工程没有内容安全出口 ⇒ **放行**（见文件头缺口 ②）。
     * 返回 `false` 表示命中敏感词。
     */
    sensitiveChecker: ((name: string) => Promise<boolean>) | null = null;

    /** 数据端口；测试 / 探针可替换。 */
    private repo: IPlayerInfoRepository = playerInfoRepository;
    /** 当前昵称（服务端那一份）。 */
    private currentName = '';
    /** 服务端给的免费改名次数（决定「免费 / 付费」两页）。 */
    private freeRenameCount = 0;
    /** 改名消耗配置。 */
    private cost: IRenameCostInfo | null = null;
    /** 两种消耗图标（预加载，避免铺界面时现加载闪一帧）。 */
    private costIcons = new Map<string, SpriteFrame | null>();
    /** 每次取数递增，丢弃过期结果。 */
    private loadRevision = 0;
    /** 发请求进行中（老端 `renameing`）。 */
    private renaming = false;
    /** GM 彩蛋连点计数。 */
    private gmClicks = 0;

    // ============================================================
    // 生命周期
    // ============================================================

    protected onInit(): void {
        this.bindButton(this.closeButton, () => this.close(PopupCloseReason.CloseButton));
        this.bindButton(this.freeButton, () => { void this.onFree(); });
        this.bindButton(this.confirmButton, () => { void this.onConfirm(); });
        this.bindButton(this.gmButton, () => this.onGmClick());

        // 老端 `文本_输入姓名` 是 FGUI TextInput，监听 `EDITING_END`（失焦）做过滤 + 敏感词检查。
        // Cocos 的等价事件是 `EDITING_DID_ENDED`。
        const input = this.nameInput?.node;
        if (input) input.on(EditBox.EventType.EDITING_DID_ENDED, this.onEditingEnd, this);
    }

    protected async onOpen(userData?: IRenameParams): Promise<void> {
        this.loadRevision += 1;
        const revision = this.loadRevision;

        const [snapshot, cost] = await Promise.all([
            this.repo.loadSelf(),
            this.repo.loadRenameCost(),
        ]);
        if (!this.alive || revision !== this.loadRevision) return;

        const icons = await this.loadCostIcons(cost);
        if (!this.alive || revision !== this.loadRevision) return;

        this.cost = cost;
        this.costIcons = icons;
        this.currentName = userData?.currentName ?? snapshot.roleName;
        this.freeRenameCount = snapshot.freeRenameCount;
        this.gmClicks = 0;

        // 老端 `init`：`文本_输入姓名.setText(GetRole().GetName())`。
        if (this.nameInput) this.nameInput.string = this.currentName;
        this.present();
    }

    protected onClose(_reason: PopupCloseReason): void {
        this.loadRevision += 1;
        this.cost = null;
        this.costIcons.clear();
        this.renaming = false;
        this.gmClicks = 0;
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
    // 图标与铺界面
    // ============================================================

    /** 预加载两种消耗图标（拿不到就留空，不阻断流程）。 */
    private async loadCostIcons(cost: IRenameCostInfo): Promise<Map<string, SpriteFrame | null>> {
        const out = new Map<string, SpriteFrame | null>();
        const one = async (key: string, path: string): Promise<void> => {
            if (!path) {
                out.set(key, null);
                return;
            }
            try {
                // `loadItemIconArt` 收的就是**相对 `assets/resources/` 的路径**（内部拼 `/spriteFrame`），
                // 改名卡（`icons/common/…`）与金币（`icons/resource/…`）都是这个口径。
                out.set(key, await loadItemIconArt(path));
            } catch (error) {
                console.warn('[PlayerInfo] 改名消耗图标加载失败', path, error);
                out.set(key, null);
            }
        };
        await Promise.all([
            one('item', cost.itemIconPath),
            one('coin', cost.coinIconPath),
        ]);
        return out;
    }

    /**
     * 铺界面。**无条件写**（规则 82）。
     *
     * 「免费 / 付费」两页：老端用 `setSelectedPage("类型", renameNum > 0 && "免费" || "付费")`
     * 切控制器，FGUI 里两个按钮的矩形是**重叠的**（`按钮_免费 275,658,160,60` /
     * `按钮_确定 275,699,170,60`）—— 也就是说设计上它们本来就不打算同时出现。
     * 本工程用 `active` 做同一条互斥（谁在上层就谁能被点到，显式互斥比靠层序可靠）。
     */
    private present(): void {
        const free = isFreeRenamePage(this.freeRenameCount);
        if (this.freeButton) this.freeButton.active = free;
        if (this.confirmButton) this.confirmButton.active = !free;

        // 老端 `UpdateView`：`text_tips.setVar("count", renameNum).flushVars()`
        // —— 原稿是 UBB 富文本，Cocos 的 cc.Label 不认，折算成纯文本（见 `formatFreeRenameTips`）。
        if (this.tipsLabel) {
            this.tipsLabel.string = formatFreeRenameTips(this.freeRenameCount);
        }

        // 消耗图标 + 数量。老端按「手上有几张改名卡」分流；本工程没有背包 ⇒ 走金币那支（缺口 ①）。
        const icon = this.costIcons.get('coin') ?? null;
        if (this.confirmCostIcon) this.confirmCostIcon.spriteFrame = icon;
        if (this.confirmCostLabel) {
            this.confirmCostLabel.string = `x${this.cost?.gemCost ?? 0}`;
        }
    }

    // ============================================================
    // 交互
    // ============================================================

    /** 输入框失焦：过滤非法字符 + 写回 + 敏感词检查（老端 `onNameEditingEnd`）。 */
    private async onEditingEnd(): Promise<void> {
        if (!this.alive) return;
        const raw = this.nameInput?.string ?? '';
        const name = sanitizePlayerName(raw);
        if (name !== raw && this.nameInput) this.nameInput.string = name;
        if (!name) return;

        const passed = await this.checkSensitive(name);
        // 检查期间玩家可能又改了输入 —— 与老端一样，只对「还是这串」的结果做处理。
        if (!this.alive || (this.nameInput?.string ?? '') !== name) return;
        if (!passed) this.showSensitiveNameTip(name);
    }

    /**
     * 「免费」按钮。
     * 老端 `按钮_免费` 的回调：三态校验后**直接** `renameHelper(text)`（不做金币判定）。
     */
    private async onFree(): Promise<void> {
        const name = this.validatedName();
        if (!name) return;
        await this.doRename(name);
    }

    /**
     * 「确定」按钮。
     *
     * 老端在发请求前先判「买得起」：`num > 0`（有改名卡）直接走 `renameHelper`；
     * 否则 `renameCostGem <= 金币数` 才弹二次确认（`LayerRename_4`），不够弹 `LayerRename_5`。
     * 本工程拿不到背包（缺口 ①）⇒ **跳过判断，直接发请求让服务端拒**，
     * 但保留二次确认这一步 —— 它是「花 500 金币」这种不可逆操作该有的确认。
     */
    private async onConfirm(): Promise<void> {
        const name = this.validatedName();
        if (!name) return;

        const gemCost = this.cost?.gemCost ?? 0;
        await CommonTips.open({
            userData: {
                content: formatRenameCostConfirm(PLAYER_INFO_TEXTS.renameCostConfirm, gemCost),
                onSure: () => { void this.doRename(name); },
            },
        });
    }

    /** 三态校验（空 / 未改 / 通过），命中前两态时弹提示并返回 `''`。 */
    private validatedName(): string {
        const raw = this.nameInput?.string ?? '';
        const state = checkRenameInput(raw, this.currentName);
        if (state === RenameInputState.Empty) {
            Toast.show(PLAYER_INFO_TEXTS.renameEmpty);
            return '';
        }
        if (state === RenameInputState.Unchanged) {
            Toast.show(PLAYER_INFO_TEXTS.renameSame);
            return '';
        }
        return sanitizePlayerName(raw);
    }

    /** 敏感词检查：没接检查器就放行（缺口 ②）。 */
    private async checkSensitive(name: string): Promise<boolean> {
        if (!this.sensitiveChecker) return true;
        try {
            return await this.sensitiveChecker(name);
        } catch (error) {
            console.warn('[PlayerInfo] 敏感词检查失败，按放行处理', error);
            return true;
        }
    }

    /**
     * 命中敏感词：把输入框清成 `***` 并提示（老端 `showSensitiveNameTip`）。
     * 已经是 `***` 就不重复写（老端同一处判断）。
     */
    private showSensitiveNameTip(checkedName: string): void {
        if (this.alive && this.nameInput && this.nameInput.string === checkedName) {
            this.nameInput.string = PLAYER_INFO_TEXTS.renameSensitiveMask;
        }
        Toast.show(PLAYER_INFO_TEXTS.renameSensitive);
    }

    /** 真正的改名：敏感词 → 发请求 → 成功提示 + 关闭。 */
    private async doRename(name: string): Promise<void> {
        if (this.renaming) return;
        this.renaming = true;
        try {
            const passed = await this.checkSensitive(name);
            if (!this.alive) return;
            if (!passed) {
                this.showSensitiveNameTip(name);
                return;
            }

            const result = await this.repo.rename(name);
            if (!this.alive) return;
            if (result === 'ok') {
                Toast.show(PLAYER_INFO_TEXTS.renameSuccess);
                this.close(PopupCloseReason.Manual);
            } else {
                Toast.show(writeFailText(result, PLAYER_INFO_TEXTS.renameRequestFailed));
            }
        } finally {
            this.renaming = false;
        }
    }

    /**
     * GM 彩蛋：输入框里是 `gmgmgm+-` 时连点 5 次触发（老端 `组件_GM开关` 的 click）。
     * 本工程没有 GM 面板 ⇒ 达标时给一句「未接入」（缺口 ③）。
     */
    private onGmClick(): void {
        const text = this.nameInput?.string ?? '';
        this.gmClicks = text === 'gmgmgm+-' ? this.gmClicks + 1 : 0;
        if (this.gmClicks >= 5) {
            this.gmClicks = 0;
            Toast.show(PLAYER_INFO_TEXTS.jumpNotWired);
        }
    }

    /** 探针用：输入框里的原始字符串。 */
    get inputText(): string {
        return this.nameInput?.string ?? '';
    }
}
