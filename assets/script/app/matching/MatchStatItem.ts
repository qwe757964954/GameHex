import { _decorator, Component, Label, Sprite, SpriteFrame } from 'cc';
import { MatchStat } from './MatchTypes';

const { ccclass, property } = _decorator;

/** 匹配信息条里的「小图标 + 数值」条目。SpriteFrame 由宿主预加载传入。 */
@ccclass('MatchStatItem')
export class MatchStatItem extends Component {
    @property({ type: Sprite, tooltip: 'Icon：小图标（SizeMode 用 RAW）' })
    icon: Sprite = null!;

    @property({ type: Label, tooltip: 'Value：数值' })
    valueLabel: Label = null!;

    /** @param stat null = 整条隐藏；frame null = 保留当前图。 */
    render(stat: MatchStat | null, frame: SpriteFrame | null): void {
        const visible = !!stat;
        this.icon.node.active = visible;
        this.valueLabel.node.active = visible;
        if (!stat) return;

        this.valueLabel.string = String(Math.max(0, Math.floor(stat.value)));
        if (frame) this.icon.spriteFrame = frame;
    }
}
