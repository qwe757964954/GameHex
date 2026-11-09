import { _decorator, Button, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import type { ServerInfoData } from './LoginProtocol';
import { EventMgr } from '../../framework/event/EventMgr';
import { LoginUiEvent, type IServerSelectContent } from './LoginEvents';
import { ServerSelectItem } from './ServerSelectItem';

const { ccclass, property } = _decorator;

/**
 * 选服弹窗（`ui/login/ServerSelectPanel`）。
 *
 * 走工程的统一弹窗框架 `PopupBase` / `PopupManager`，与 MailDetail / ItemDetail 同一套：
 * 黑遮罩、点击空白关闭、栈式深度、层自动纠正都由基类负责，本类只管业务。
 *
 * 布局与 `ItemDetail.prefab` 同一套皮，只不过图片都收在 `image/common`
 * 通用套件里（`id_panel_bg` 底板 + `id_title_gray` 标题条 + `cu_btn_close_01` 关闭），
 * 列表是 `VirtualScrollView`（layout item + 对象池）：
 * 格子数跟服务器条数走，不再预摆固定数量的槽位。
 */
@ccclass('ServerSelectPanel')
export class ServerSelectPanel extends PopupBase {
    static prefabPath = 'ui/login/ServerSelectPanel';

    @property({ type: Node, tooltip: '关闭按钮 CloseBtn' })
    closeButton: Node = null!;

    @property({ type: VirtualScrollView, tooltip: '服务器列表（Layout item + 对象池）' })
    serverList: VirtualScrollView = null!;

    private owner: object | null = null;
    private selectedServerId: number | null = null;
    /** 本趟要铺的服务器（新服优先）。renderItemFn 按 index 现取，禁闭包捕获。 */
    private servers: ServerInfoData[] = [];

    protected onInit(): void {
        this.closeButton.on(Button.EventType.CLICK, () => this.closeByButton(), this);
        // ⚠️ renderItemFn 只在这里绑一次；回调里禁止捕获"本趟"的数据快照
        //    （否则第二次打开还停在上一次那份服务器列表上）。
        this.serverList.renderItemFn = (node, index) => this.renderItem(node, index);
    }

    protected async onOpen(userData?: IServerSelectContent): Promise<void> {
        if (!userData) throw new Error('选服弹窗缺少展示数据');
        this.owner = userData.owner;
        this.selectedServerId = userData.selectedServerId;
        // 新服优先；**不按宿主槽位数截断** —— 虚拟列表按真实条数铺，多出来的靠滚动。
        this.servers = userData.servers.slice().sort((a, b) => b.serverOpenTime - a.serverOpenTime);

        // 列表的槽位 / 视口尺寸都在 `VirtualScrollView.start()` 里建，而 onOpen 早于 start
        // （规则 108：出厂 active=false 的容器里的组件，生命周期会推迟到第一次激活）
        // ⇒ 必须等一帧再喂数据，否则列表一片空白且**一条日志都不打**。
        await this.nextPopupFrame();
        if (!this.isValid) return;
        this.serverList.refreshList(this.servers.length);
    }

    protected onClose(): void {
        const owner = this.owner;
        this.owner = null;
        this.servers = [];
        if (owner) EventMgr.instance.emit(LoginUiEvent.ServerClosed, { owner, panel: this });
    }

    private renderItem(node: Node, index: number): void {
        const server = this.servers[index];
        const owner = this.owner;
        if (!server || !owner) return;
        node.getComponent(ServerSelectItem).initialize(server, Number(server.serverId) === this.selectedServerId, owner);
    }
}
