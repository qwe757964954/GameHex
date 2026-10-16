import { _decorator, Button, Component, Label } from 'cc';

const { ccclass, property } = _decorator;

/** 弹窗上的动作（页面注入；监听只在 `initialize` 里绑一次）。 */
export interface ITerritorySiteDetailActions {
    readonly onClose: () => void;
    readonly onStart: () => void;
}

/** 弹窗内容。`canStart=false` 时收起操作按钮。 */
export interface ITerritorySiteDetailContent {
    readonly title: string;
    readonly subtitle: string;
    readonly info: string;
    readonly canStart: boolean;
    readonly startCaption: string;
    readonly startEnabled: boolean;
    readonly isLoading: boolean;
}

/**
 * 领地站点详情弹窗，由 `ui/territory/TerritorySiteDetail.prefab` 拥有。
 *
 *  合并了旧实现的两个弹窗（`openDetail` 有关卡 / `openUnboundSiteDetail` 待配置）：
 *  它们的差异只有「有没有开战按钮」，用 `canStart` 一个开关表达比维护两棵代码搭的节点树划算。
 *
 *  **不走 `PopupManager`**：它挂在页面根下、跟着页面一起销毁（页面切走时不该留下孤立的弹窗），
 *  层级语义是「页面内弹层」而不是全局弹窗 —— 与 `GameRunAway` 那种全屏结算页不同。
 *  与页面的接口只有 `open` / `close` 两个方法，页面不需要知道它内部有几个节点。
 */
@ccclass('TerritorySiteDetailPanel')
export class TerritorySiteDetailPanel extends Component {
    @property({ type: Button, group: '节点引用', tooltip: 'Dim：全屏暗底，点击关闭' })
    dimButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/Title' })
    titleLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/Subtitle：关卡 ID 这类次要信息' })
    subtitleLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/Info：多行详情（左对齐）' })
    infoLabel: Label = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/Close：返回地图' })
    closeButton: Button = null!;

    @property({ type: Button, group: '节点引用', tooltip: 'Panel/Start：开战 / 探索中 / 尚未解锁' })
    startButton: Button = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'Panel/Start 的文案' })
    startLabel: Label = null!;

    /** 绑一次点击（页面在 `onLoad` 里调）。 */
    initialize(actions: ITerritorySiteDetailActions): void {
        this.dimButton.node.on(Button.EventType.CLICK, actions.onClose, this);
        this.closeButton.node.on(Button.EventType.CLICK, actions.onClose, this);
        this.startButton.node.on(Button.EventType.CLICK, actions.onStart, this);
    }

    /** 打开并全量赋值。幂等：连续两次 `open` 与一次等价。 */
    open(content: ITerritorySiteDetailContent): void {
        this.setLabel(this.titleLabel, content.title);
        this.setLabel(this.subtitleLabel, content.subtitle);
        this.setLabel(this.infoLabel, content.info);
        this.setLabel(this.startLabel, content.startCaption);
        this.startLabel.node.active = !content.isLoading;
        this.startButton.node.active = content.canStart;
        this.startButton.interactable = content.startEnabled && !content.isLoading;
        this.node.active = true;
    }

    close(): void {
        this.node.active = false;
    }

    get isOpen(): boolean {
        return this.node.active;
    }

    /** 开战按钮的开/关与文案（`startPve` 载入战场时会用它锁按钮）。 */
    setStartState(caption: string, enabled: boolean): void {
        this.setLabel(this.startLabel, caption);
        this.startButton.interactable = enabled;
    }

    private setLabel(label: Label, value: string): void {
        if (label.string !== value) label.string = value;
    }
}
