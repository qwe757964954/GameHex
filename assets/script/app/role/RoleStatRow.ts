import { _decorator, Color, Component, Label, Node } from 'cc';

const { ccclass, property } = _decorator;

export type RoleStatTone = 'normal' | 'attack' | 'life' | 'defense' | 'gem';

const TONE_COLORS: Readonly<Record<RoleStatTone, Color>> = {
    normal: new Color(78, 51, 32, 255),
    attack: new Color(232, 144, 43, 255),
    life: new Color(78, 154, 78, 255),
    defense: new Color(77, 143, 176, 255),
    gem: new Color(140, 93, 158, 255),
};

/** 把「攻击 +12」拆成键与值；没有空格/冒号分隔时整行作为键。 */
export function splitStatLine(line: string): { key: string; value: string } {
    const text = line.trim();
    if (!text) return { key: '', value: '' };

    const colon = Math.max(text.lastIndexOf('：'), text.lastIndexOf(':'));
    if (colon > 0 && colon < text.length - 1) {
        return { key: text.slice(0, colon).trim(), value: text.slice(colon + 1).trim() };
    }

    const match = text.match(/^(.+?)\s+([+\-]?\d+(?:\.\d+)?%?)$/);
    if (match) return { key: match[1].trim(), value: match[2].trim() };
    return { key: text, value: '' };
}

/**
 * 装备弹窗里的一行属性。
 *
 * 行节点自带底边线、色点、键与值；宝石附加属性在末尾追加「宝石」小标签。
 * 所有子控件都在 Prefab 中绑定，运行时只做幂等赋值。
 */
@ccclass('RoleStatRow')
export class RoleStatRow extends Component {
    @property({ type: Label, tooltip: '属性名' })
    keyLabel: Label = null!;

    @property({ type: Label, tooltip: '属性值' })
    valueLabel: Label = null!;

    @property({ type: Label, tooltip: '左侧色点' })
    dotLabel: Label = null!;

    @property({ type: Node, tooltip: '行底边线' })
    lineNode: Node = null!;

    @property({ type: Node, tooltip: '「宝石」来源标签容器' })
    tagNode: Node = null!;

    @property({ type: Label, tooltip: '「宝石」来源标签文字' })
    tagLabel: Label = null!;

    public setData(key: string, value: string, tone: RoleStatTone = 'normal', tag?: string): void {
        this.node.active = true;
        this.keyLabel.string = key;
        this.valueLabel.string = value;

        const color = TONE_COLORS[tone] ?? TONE_COLORS.normal;
        this.valueLabel.color = color;
        this.dotLabel.color = color;
        this.dotLabel.string = '●';

        if (this.lineNode) this.lineNode.active = true;
        const hasTag = !!tag;
        if (this.tagNode) this.tagNode.active = hasTag;
        if (this.tagLabel && tag) this.tagLabel.string = tag;
    }

    public setLine(line: string, tone: RoleStatTone = 'normal', tag?: string): void {
        const parsed = splitStatLine(line);
        if (!parsed.key) {
            this.clear();
            return;
        }
        this.setData(parsed.key, parsed.value, tone, tag);
    }

    public clear(): void {
        this.node.active = false;
    }
}
