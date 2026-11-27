import { _decorator, Button, Component, Event, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

export class EquipDecomposeFilterPickEvent extends Event {
    static readonly TYPE = 'equip-decompose-filter-pick';

    constructor(readonly value: number) {
        super(EquipDecomposeFilterPickEvent.TYPE, true);
    }
}

@ccclass('EquipDecomposeFilterRow')
export class EquipDecomposeFilterRow extends Component {
    @property({ type: Label, tooltip: '筛选选项标题' })
    private title: Label = null!;

    @property({ type: Node, tooltip: '筛选选项勾选标记' })
    private check: Node = null!;

    private optionValue = -1;

    get value(): number {
        return this.optionValue;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this.onClick, this);
    }

    protected onDestroy(): void {
        this.node.off(Button.EventType.CLICK, this.onClick, this);
    }

    render(text: string, value: number): void {
        this.optionValue = value;
        this.title.string = text;
    }

    renderSelection(selectedValue: number): void {
        this.check.active = this.optionValue === selectedValue;
    }

    private onClick(): void {
        this.node.dispatchEvent(new EquipDecomposeFilterPickEvent(this.optionValue));
    }
}
