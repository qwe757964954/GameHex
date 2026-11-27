import { _decorator, Button, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import type { IZCBarracksInfoPresentation } from '../model/ZCBarracksInfo';
import { ZCBarracksSkillItemView } from './ZCBarracksSkillItemView';

const { ccclass, property } = _decorator;

/**
 * 战斗 HUD 左上角的「兵营信息」面板（点击地图兵营弹出）。
 *
 * 纯展示：数据由 `buildZCBarracksInfo` 装配后经 `show()` 灌进来，本组件不读配置、不碰模型。
 * 四个技能格由 `ZCBarracksSkillItemView` 各自渲染，prefab 上的 `cc.Button`（NONE、target=null）只监听 CLICK。
*/
@ccclass('ZCBarracksInfoView')
export class ZCBarracksInfoView extends Component {
    @property(Sprite) portraitSprite: Sprite = null!;
    @property(Label) nameLabel: Label = null!;
    @property([Label]) statValues: Label[] = [];
    @property([Label]) statGains: Label[] = [];
    @property([ZCBarracksSkillItemView]) skillItems: ZCBarracksSkillItemView[] = [];
    @property(Node) tipNode: Node = null!;
    @property(Label) tipTitle: Label = null!;
    @property(Label) tipDesc: Label = null!;

    private info: IZCBarracksInfoPresentation | null = null;

    onLoad(): void {
        for (let index = 0; index < this.skillItems.length; index++) {
            this.skillItems[index].node.on(Button.EventType.CLICK, () => this.showSkill(index), this);
        }
    }

    show(info: IZCBarracksInfoPresentation, portrait: SpriteFrame | null): void {
        this.info = info;
        this.node.active = true;
        this.portraitSprite.spriteFrame = portrait;
        this.nameLabel.string = info.name || '兵营';
        for (let index = 0; index < this.statValues.length; index++) {
            const row = info.stats[index];
            this.statValues[index].string = row?.value ?? '';
            const gain = this.statGains[index];
            if (gain) {
                gain.string = row?.gain ?? '';
                gain.node.active = !!row?.gain;
            }
        }
        for (let index = 0; index < this.skillItems.length; index++) {
            this.skillItems[index].render(info.skills[index]);
        }
        this.tipNode.active = false;
    }

    hide(): void {
        this.info = null;
        this.tipNode.active = false;
        this.node.active = false;
    }

    private showSkill(index: number): void {
        const skill = this.info?.skills[index];
        if (!skill || skill.empty) return;
        this.tipTitle.string = skill.name || '技能';
        if (!skill.unlocked) {
            this.tipDesc.string = `英雄等级 ${skill.unlockLevel} 级解锁`;
        } else {
            this.tipDesc.string = skill.description || '暂无技能说明';
        }
        this.tipNode.active = true;
    }
}
