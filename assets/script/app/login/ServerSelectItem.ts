import { _decorator, Color, Component, Label, Node, Sprite } from 'cc';
import { ServerInfoData, ServerStatus } from './LoginProtocol';

const { ccclass, property } = _decorator;

/**
 * 条目底图的着色（唯一随状态变化的部分）。
 *
 * 其余样式 —— 字号 / 颜色 / 对齐 / SHRINK —— 全在 `ServerSelectItem.prefab` 上，
 * 本类不再覆盖，避免同一份配置散在代码和 prefab 两处。
 *
 * 底图是 `id_row_bg`（浅色九宫，与 `id_panel_bg` 同一套「道具详情包」皮），
 * 所以三档取值都是「在浅色底图上做乘法着色」，不是直接画深色块。
 */
const ITEM_COLORS = {
    normal: new Color(255, 255, 255, 255),
    selected: new Color(130, 225, 160, 255),
    disabled: new Color(185, 185, 185, 255),
};

/**
 * 选服列表中的单个服务器条目。
 *
 * 布局对齐老客户端 `ui://登录/组件_登录_选服_项`（左侧服务器名、右侧状态），
 * 只是把老端的状态图标换成了状态文字 —— 这批 `登录_服务器_*.png` 图标还没导进新工程。
 *
 * ⚠️ 由 `VirtualScrollView` 的**对象池**复用：同一个节点会被反复 `initialize()`。
 * 因此这里有两处不能按"一次性节点"写：
 *   ① 监听必须**先 `off` 再 `on`** —— 否则每复用一次多挂一个 TOUCH_END，
 *      用户点一下会按该槽位复用次数触发多次（点一次跳 N 次服）。
 *   ② 每次都要**把所有可变内容写满**（名字 + 状态 + 底图着色），
 *      因为槽位换索引时残留的是上一条服务器的数据。
 */
@ccclass('ServerSelectItem')
export class ServerSelectItem extends Component {
    @property({ type: Sprite, tooltip: '服务器条目底图（id_row_bg 九宫，按状态着色）' })
    background: Sprite = null;

    @property({ type: Label, tooltip: '服务器名称' })
    nameLabel: Label = null;

    @property({ type: Label, tooltip: '服务器状态（流畅 / 新服 / 爆满 / 维护）' })
    statusLabel: Label = null;

    private selectHandler: (() => void) | null = null;

    initialize(server: ServerInfoData, selected: boolean, onSelect: () => void): void {
        const disabled = server.status === ServerStatus.Maintenance;
        this.node.name = `Server_${server.serverId}`;

        this.background.color = selected ? ITEM_COLORS.selected : disabled ? ITEM_COLORS.disabled : ITEM_COLORS.normal;
        this.nameLabel.string = server.name;
        this.statusLabel.string = serverStatusText(server);

        this.node.off(Node.EventType.TOUCH_END, this.handleSelect, this);
        this.selectHandler = onSelect;
        this.node.on(Node.EventType.TOUCH_END, this.handleSelect, this);
    }

    onDestroy(): void {
        // 注意：不要手动 this.node.off(...) —— Cocos 在 destroy 子节点时会自动清理事件；
        // 在销毁阶段访问 .off() 会因为节点已被标记销毁而触发 null 错误。
        this.selectHandler = null;
    }

    private handleSelect(): void {
        this.selectHandler?.();
    }
}

export function serverStatusText(server: ServerInfoData): string {
    if (server.status === ServerStatus.Maintenance) return '维护';
    if (server.status === ServerStatus.Full) return '爆满';
    if (server.status === ServerStatus.New) return '新服';
    return '流畅';
}
