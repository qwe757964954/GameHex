import { _decorator, Component, Label, Sprite } from 'cc';
import type { SpriteFrame } from 'cc';
import type { MatchStat } from './MatchTypes';

const { ccclass, property } = _decorator;

/** 统计条目可复用；缺失资源必须清除旧图。 */
@ccclass('MatchStatItem')
export class MatchStatItem extends Component {
    @property({ type: Sprite, tooltip: 'Icon：小图标（SizeMode 用 RAW）' })
    icon: Sprite = null;

    @property({ type: Label, tooltip: 'Value：数值' })
    valueLabel: Label = null;

    render(stat: MatchStat | null, frame: SpriteFrame | null): void {
        const visible = !!stat;
        this.icon.node.active = visible;
        this.valueLabel.node.active = visible;
        this.icon.spriteFrame = stat ? frame : null;
        this.valueLabel.string = stat ? String(Math.max(0, Math.floor(stat.value))) : '';
    }
}
