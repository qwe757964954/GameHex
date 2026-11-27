import { _decorator, Component, Label, sp, Sprite } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 大招通报的预制体视图绑定（挂在 `大招技能提示特效.prefab` 根节点）。
 *
 * 布局、字号、描边、默认骨架与节点层级全部由 prefab 声明，
 * 运行时只通过这里的 @property 注入卡面帧、技能名与动画状态。
 */
@ccclass('ZCSkillAnnounceView')
export class ZCSkillAnnounceView extends Component {
    @property({ type: sp.Skeleton })
    glowSpine: sp.Skeleton = null!;

    @property({ type: Sprite })
    headSprite: Sprite = null!;

    @property({ type: Label })
    nameLabel: Label = null!;
}
