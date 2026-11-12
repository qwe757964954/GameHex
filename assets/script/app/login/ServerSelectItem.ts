import { _decorator, Button, Color, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { EventMgr } from '../../framework/event/EventMgr';
import { LoginUiEvent } from './LoginEvents';
import { ServerInfoData, ServerStatus } from './LoginProtocol';

const { ccclass, property } = _decorator;

const NORMAL_STATUS_COLOR = new Color(132, 220, 67, 255);
const STATUS_COLORS: Record<number, Color> = {
    [ServerStatus.Maintenance]: new Color(145, 145, 145, 255),
    [ServerStatus.Full]: new Color(242, 90, 80, 255),
    [ServerStatus.New]: new Color(248, 205, 78, 255),
};

/**
 * 选服列表中的单个服务器条目。
 *
 * 对象池复用时全量更新展示与服务器 id；点击绑定仅随组件生命周期建立。
 */
@ccclass('ServerSelectItem')
export class ServerSelectItem extends Component {
    @property({ type: Sprite, tooltip: '服务器条目底图' })
    background: Sprite = null!;

    @property(SpriteFrame)
    normalFrame: SpriteFrame = null!;

    @property(SpriteFrame)
    selectedFrame: SpriteFrame = null!;

    @property(SpriteFrame)
    disabledFrame: SpriteFrame = null!;

    @property(Sprite)
    statusDot: Sprite = null!;

    @property(Node)
    selectedMark: Node = null!;

    @property({ type: Label, tooltip: '服务器名称' })
    nameLabel: Label = null!;

    @property({ type: Label, tooltip: '服务器状态（流畅 / 新服 / 爆满 / 维护）' })
    statusLabel: Label = null!;

    private selection: { readonly owner: object; readonly serverId: number } | null = null;

    onLoad(): void { this.node.on(Button.EventType.CLICK, this.handleSelect, this); }

    initialize(server: ServerInfoData, selected: boolean, owner: object): void {
        this.selection = { owner, serverId: Number(server.serverId) };
        const disabled = server.status === ServerStatus.Maintenance;
        this.node.name = `Server_${server.serverId}`;

        this.background.spriteFrame = disabled ? this.disabledFrame : selected ? this.selectedFrame : this.normalFrame;
        this.statusDot.color = serverStatusColor(server);
        this.selectedMark.active = selected && !disabled;
        this.nameLabel.string = server.name;
        this.statusLabel.string = serverStatusText(server);
        this.statusLabel.color = serverStatusColor(server);

    }

    onDestroy(): void { this.selection = null; }

    private readonly handleSelect = (): void => {
        const selection = this.selection;
        if (selection) EventMgr.instance.emit(LoginUiEvent.Intent, { ...selection, kind: 'select' });
    };

}

export function serverStatusColor(server: ServerInfoData): Color {
    return STATUS_COLORS[server.status] ?? NORMAL_STATUS_COLOR;
}

export function serverStatusText(server: ServerInfoData): string {
    if (server.status === ServerStatus.Maintenance) return '维护';
    if (server.status === ServerStatus.Full) return '爆满';
    if (server.status === ServerStatus.New) return '新服';
    return '流畅';
}
