import { _decorator, Component, Label, Node, Sprite } from 'cc';
import type { IZCBarracksSkillInfo } from '../model/ZCBarracksInfo';

const { ccclass, property } = _decorator;

/**
 * 兵营信息面板中的单个技能格视图（挂在 `Skill0..Skill3` 节点）。
 *
 * 交互由同节点 prefab 上的 `cc.Button`（NONE、target=null）提供，本组件只负责单格显示状态。
 */
@ccclass('ZCBarracksSkillItemView')
export class ZCBarracksSkillItemView extends Component {
    @property(Sprite) goldSprite: Sprite = null!;
    @property(Node) emptyNode: Node = null!;
    @property(Label) nameLabel: Label = null!;
    @property(Node) lockNode: Node = null!;
    @property(Node) passiveNode: Node = null!;

    render(skill: IZCBarracksSkillInfo | undefined): void {
        const empty = !skill || skill.empty;
        this.node.active = true;
        this.goldSprite.enabled = !empty && skill.unlocked;
        this.emptyNode.active = empty || !skill.unlocked;
        // 设计稿的技能格只有图标 + 「被动」标签；技能名放说明气泡标题，格子里不再叠字。
        this.nameLabel.node.active = false;
        if (empty) {
            this.lockNode.active = false;
            this.passiveNode.active = false;
            return;
        }
        this.lockNode.active = !skill.unlocked;
        this.passiveNode.active = skill.passive && skill.unlocked;
    }
}
