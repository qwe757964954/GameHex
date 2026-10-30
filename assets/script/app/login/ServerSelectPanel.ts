import { _decorator, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { VirtualScrollView } from '../../vscrollview/VScrollView';
import { canEnterServer, ServerInfoData } from './LoginProtocol';
import { ServerSelectItem } from './ServerSelectItem';

const { ccclass, property } = _decorator;

export interface ServerSelectOptions {
    servers: ServerInfoData[];
    selectedServerId: number | null;
    recentServerIds?: number[];
    onSelect: (server: ServerInfoData) => void;
    onReject?: (message: string) => void;
    onClose?: () => void;
}

/**
 * 选服弹窗（`ui/login/ServerSelectPanel`）。
 *
 * 走工程的统一弹窗框架 `PopupBase` / `PopupManager`，与 MailDetail / ItemDetail 同一套：
 * 黑遮罩、点击空白关闭、栈式深度、层自动纠正都由基类负责，本类只管业务。
 *
 * 布局对齐 `ItemDetail.prefab` 那套皮（`id_panel_bg` 底板 + `id_title_gray` 标题条 +
 * `公用_按钮_关闭01`），列表是 `VirtualScrollView`（layout item + 对象池）：
 * 格子数跟服务器条数走，不再预摆固定数量的槽位。
 */
@ccclass('ServerSelectPanel')
export class ServerSelectPanel extends PopupBase {
    static prefabPath = 'ui/login/ServerSelectPanel';

    @property({ type: Node, tooltip: '关闭按钮 CloseBtn' })
    closeButton: Node = null;

    @property({ type: VirtualScrollView, tooltip: '服务器列表（Layout item + 对象池）' })
    serverList: VirtualScrollView = null;

    private options: ServerSelectOptions | null = null;
    /** 本趟要铺的服务器（新服优先）。renderItemFn 按 index 现取，禁闭包捕获。 */
    private servers: ServerInfoData[] = [];

    protected onInit(): void {
        this.closeButton.on(Node.EventType.TOUCH_END, () => this.closeByButton(), this);
        // ⚠️ renderItemFn 只在这里绑一次；回调里禁止捕获"本趟"的数据快照
        //    （否则第二次打开还停在上一次那份服务器列表上）。
        this.serverList.renderItemFn = (node, index) => this.renderItem(node, index);
    }

    protected async onOpen(userData?: any): Promise<void> {
        this.options = userData as ServerSelectOptions | null;
        // 新服优先；**不按宿主槽位数截断** —— 虚拟列表按真实条数铺，多出来的靠滚动。
        this.servers = (this.options?.servers ?? []).slice().sort((a, b) => b.serverOpenTime - a.serverOpenTime);

        // 列表的槽位 / 视口尺寸都在 `VirtualScrollView.start()` 里建，而 onOpen 早于 start
        // （规则 108：出厂 active=false 的容器里的组件，生命周期会推迟到第一次激活）
        // ⇒ 必须等一帧再喂数据，否则列表一片空白且**一条日志都不打**。
        await this.nextPopupFrame();
        if (!this.isValid) return;
        this.serverList.refreshList(this.servers.length);
    }

    protected onClose(): void {
        const onClose = this.options?.onClose;
        this.options = null;
        this.servers = [];
        onClose?.();
    }

    private renderItem(node: Node, index: number): void {
        const server = this.servers[index];
        const options = this.options;
        if (!server || !options) return;
        node.getComponent(ServerSelectItem).initialize(
            server,
            Number(server.serverId) === options.selectedServerId,
            () => this.select(server),
        );
    }

    private select(server: ServerInfoData): void {
        const options = this.options;
        if (!options) return;
        const check = canEnterServer(server, options.recentServerIds || []);
        if (!check.ok) {
            options.onReject?.(check.reason || '当前服务器不可进入');
            return;
        }

        options.onSelect(server);
        this.close();
    }
}
