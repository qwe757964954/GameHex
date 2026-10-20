/**
 * 主界面顶部**资源栏**的**玩家信息块**（挂在 `ui/main/ArenaRoot.prefab`（竞技页）的 `ResBarLayer` 上）。
 *
 * ⚠️ 2026-09-24：从 `MainRoot.prefab` 搬来 —— 它是「竞技页自己的 HUD」，
 * 随竞技页一起实例化 / 销毁（切到角色页就收起来）。
 *
 * ⚠️ 2026-09-29：**货币三格已交给公共件 `common/ResBar`**。
 * 老端 `组件_资源栏` 本来就是一条完整的东西（`组件_玩家信息` + N 个 `组件_资源信息`），
 * 货币那块的数据层（`MainResBarTypes`）与槽组件（`MainResBarSlot`）早在二级页就复用了，
 * 没必要让 HUD 再自带一套货币渲染 ⇒ 现在 `ResBarLayer` 下**直接挂一个
 * `common/ResBar.prefab` 的嵌套实例**（名字 `ResBar`，`_lpos=(-84,587)`），
 * 与 `PlayerInfo` **平级**（原先夹在 `Mid` 里）；内部 `Res0`/`Res1`/`Res2` 由公共件带。
 * 本脚本只剩「头像 / 昵称 / LV / uid / 经验条」。
 * 两处共用同一个纯函数 `buildResBarView`，不各算一套。
 *
 * 货币顺序的真源 = 那个实例上覆盖的 `resKeys`（与 `MainResBarTypes.RES_BAR_KEYS` 对齐，
 * 由 `tests/main-resbar.test.ts` 焊死 —— 改一处必须改另一处，否则货币顺序漂移）。
 *
 * ## 蓝本
 *
 *  - 视觉：老客户端 FairyGUI 包「首页」的 `组件/资源栏/组件_资源栏`
 *    （`zarts/art/UIProject/trunk/UIProject/assets/首页/组件/资源栏/`）——
 *    `组件_玩家信息`（463×106，头像框 + 昵称 + LV + uid + 经验条）。
 *    同一份 XML 里那 3 个 `组件_资源信息`（132×40）归 `common/ResBar`。
 *  - 行为：`client/assets/script/app/game/ctrl/main/LayerMainResources.ts`
 *    （读 `CmdRole` 缓存 → 填昵称 / 等级 / uid / 经验条）。
 *
 * ## 数据链
 *
 * ```
 * CmdRole 缓存（CacheMgr.instance.getTlCmdRole()）
 *   → buildResBarView（MainResBarTypes，纯函数）
 *   → 本脚本的四个 Label / 经验条
 * 头像：CmdRole.img --head 表--> 资源名 --HeadArt.loadHeadFrame--> image/icon/head
 * ```
 *
 * ## 为什么读缓存而不发协议
 *
 *  `CmdRole` 是**服务端在角色登录时下发**的、且 `protoCache.json` 里已登记
 *  （`tlKey = ['id']`），登录成功就一定有行、还是服务端权威。
 *  主界面要的是"当前值"，重新发一次请求既多余又会与缓存打架。
 *  （同口径：`matching/MatchSelfProfile.ts` 读昵称与头像就是这么做的。）
 *
 * ## 拿不到数据时
 *
 *  一律**保留 prefab 里的占位**、只打 warn，不抛、不清空 ——
 *  编辑器直连预览 / 登录半途进主界面都会走到这条分支，
 *  界面该显示的是"还没数据"，不是"空壳"。
 */
import { _decorator, Button, Component, Label, Node, Sprite } from 'cc';
import { RefUtil } from '../../framework/ref/RefUtil';
import { CacheMgr } from '../net/CacheMgr';
import { HeadArt } from '../HeadArt';
import { PlayerInfoPage } from '../playerinfo/PlayerInfoPage';
import { readRoleRow } from './MainRoleRow';
import { buildResBarView, LevelRow, ResBarView } from './MainResBarTypes';

const { ccclass, property } = _decorator;

/** 等级表（角色等级 → 升到下一级所需经验）。键 = `remoteRef/level.json`。 */
const LEVEL_TABLE = 'level';

@ccclass('MainResBar')
export class MainResBar extends Component {
    @property({ type: Sprite, tooltip: 'AvatarIcon：玩家头像 80×80（走 head 表 + image/icon/head）' })
    avatarIcon: Sprite = null!;

    @property({ type: Label, tooltip: 'Name：昵称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: 'Level：`LV{等级}`' })
    levelLabel: Label = null!;

    @property({ type: Label, tooltip: 'Uid：`uid:{角色 id}`' })
    uidLabel: Label | null = null;

    @property({ type: Sprite, tooltip: 'ExpFill：经验条（FILLED / HORIZONTAL，代码只改 fillRange）' })
    expFill: Sprite = null!;

    /** 防止 `reload` 重入（缓存落地 / 资源变化都可能触发）。 */
    private loading = false;

    /**
     * CmdRole 缓存变化回调（GM 加经验、升级、资源变动等服务器推送）。
     * 箭头函数属性：引用稳定，供 onDestroy 精确摘除。
     */
    private onRoleCacheUpdate = (): void => {
        if (!this.isValid) return;
        void this.reload();
    };

    onLoad(): void {
        // 顺序要紧：`sizeMode` 早于第一次赋 `spriteFrame`（默认 TRIMMED 会被贴图
        // 改写宿主节点尺寸）。经验条同理——它靠 `fillRange` 表现进度，尺寸必须固定。
        this.avatarIcon.trim = false;
        this.avatarIcon.sizeMode = Sprite.SizeMode.CUSTOM;
        this.expFill.trim = false;
        this.expFill.sizeMode = Sprite.SizeMode.CUSTOM;

        // 点头像打开「个人信息」——对齐老端 `LayerMainResources.InitClick`。
        this.bindHeadClick();

        // 订阅 CmdRole 缓存更新：服务器推下来的经验/等级变化会走 cmdCaches
        // 更新缓存并触发 onUpdate，这里收到后重读缓存整条刷新（对齐旧客户端
        // LayerMainResources 的做法；不订阅的话界面只在创建时读一次，之后再也不更新）。
        // 注：货币格由同一条 bar 上的 `common/ResBar` 订阅，两个监听者互不干扰。
        CacheMgr.instance.setEventUpdate('CmdRole', this as unknown as destroyable, this.onRoleCacheUpdate);
        void this.reload();
    }

    onDestroy(): void {
        CacheMgr.instance.removeEventUpdate('CmdRole', this as unknown as destroyable, this.onRoleCacheUpdate);
    }

    /**
     * 点头像打开「个人信息」。
     *
     * 对齐老端 `LayerMainResources.InitClick`：
     * ```js
     * this.setFairyEvent(this.com.tm("组件_玩家信息.icon"), fgui.Event.CLICK, async () => {
     *     this.CtrlMgr.CtrlPlayer.LayerPlayerInfo.load();
     * });
     * ```
     * 即：只绑头像 icon（`HeadIcon`，80×80），点昵称 / 等级 / uid 不触发。
     *
     * ⚠️ `HeadIcon` 是 FGUI `<loader>` 迁来的**只有 `cc.Sprite`、没有 `cc.Button`**
     * （规则 81b）⇒ 按组件实际形态分流：有 Button 走 `CLICK`，否则走 `TOUCH_END`
     * （后者在无 Button 的节点上绑 `CLICK` 是**静默死按钮**）。
     */
    private bindHeadClick(): void {
        const head = this.avatarIcon?.node;
        if (!head) return;
        const button = head.getComponent(Button);
        if (button) {
            button.node.on(Button.EventType.CLICK, this.onClickHead, this);
        } else {
            head.on(Node.EventType.TOUCH_END, this.onClickHead, this);
        }
    }

    /** 点头像 → 打开「个人信息」弹窗。`PopupManager` 同类单实例 ⇒ 连点不会叠出第二个面板。 */
    private onClickHead(): void {
        void PlayerInfoPage.open();
    }

    /** 读缓存 + 读表 → 刷新玩家信息块。失败降级，**不抛**。 */
    async reload(): Promise<void> {
        if (this.loading) return;
        this.loading = true;
        try {
            const role = readRoleRow();
            const view = buildResBarView(role, await this.readLevelRows());
            if (!this.isValid) return;
            if (!view) {
                console.warn('[MainResBar] 拿不到 CmdRole 缓存（登录前 / 缓存未落地），保留占位数据');
                return;
            }
            this.applyView(view);
            await this.applyAvatar(view.avatarId);
        } catch (error) {
            console.error('[MainResBar] 资源栏刷新失败', error);
        } finally {
            this.loading = false;
        }
    }

    /** 等级表：只给经验条算比例用；读不到就按 0 处理（经验条空，其余照常）。 */
    private async readLevelRows(): Promise<LevelRow[] | null> {
        try {
            return (await RefUtil.instance.getRefAllAsync(LEVEL_TABLE)) as LevelRow[];
        } catch (error) {
            console.warn(`[MainResBar] ${LEVEL_TABLE} 表读取失败，经验条按 0 处理`, error);
            return null;
        }
    }

    /**
     * 文案与数值。
     *
     * ⚠️ 货币三格**不在这里渲染** —— 它们归同一条 bar 上的 `common/ResBar`
     * （`view.slots` 就是喂给它的那份数据，两边共用同一个 `buildResBarView`）。
     * 本脚本只写玩家信息块，`slots` 按设计忽略。
     */
    private applyView(view: ResBarView): void {
        this.nameLabel.string = view.name;
        this.levelLabel.string = view.levelText;
        if (this.uidLabel) this.uidLabel.string = view.uidText;
        this.expFill.fillRange = view.expRatio;
    }

    /**
     * 头像：`CmdRole.img` 是 `head` 表的 `resId`（70001+），**不是资源名**。
     *
     *  `0` = 老端口径的「用平台头像」（`platform_img`，本工程没接）⇒ 保留占位图。
     *  取不到真头像时同样保留占位图：失败只该表现为"头像没换"，不该把格子清空。
     */
    private async applyAvatar(avatarId: string): Promise<void> {
        if (!avatarId || avatarId === '0') return;
        const frame = await HeadArt.loadHeadFrame(avatarId);
        if (!this.isValid || !frame) return;
        this.avatarIcon.spriteFrame = frame;
    }
}
