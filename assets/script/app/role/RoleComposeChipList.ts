import { _decorator, Component, instantiate, isValid, Label, Node, Sprite, UITransform } from 'cc';
import { loadRoleBagIconSprite, loadRoleQualityFrame } from './RoleArtLoader';
import type { IRoleComposeChip } from './RoleComposeView';
import { ROLE_TEXTS } from './RoleTexts';

const { ccclass, property } = _decorator;

@ccclass('RoleComposeChipList')
export class RoleComposeChipList extends Component {
    @property({ type: Node, tooltip: '合成棋子模板' })
    private chipTemplate: Node = null!;

    @property({ tooltip: '相邻棋子的最大间距' })
    private maxStep = 112;

    @property({ tooltip: '棋子距底板的最小左右边距' })
    private sidePadding = 8;

    render(chips: readonly IRoleComposeChip[]): void {
        for (const child of this.node.children.slice()) {
            child.removeFromParent();
            child.destroy();
        }

        const count = chips.length;
        if (!count) return;

        const width = this.node.getComponent(UITransform).width;
        const chipWidth = this.chipTemplate.getComponent(UITransform).width;
        const step = count > 1
            ? Math.min(this.maxStep, Math.floor((width - chipWidth - 2 * this.sidePadding) / (count - 1)))
            : 0;

        for (const [index, data] of chips.entries()) {
            const chip = instantiate(this.chipTemplate);
            chip.setPosition((index - (count - 1) / 2) * step, 0, 0);
            this.renderChip(chip, data);
            this.node.addChild(chip);
            chip.active = true;
        }
    }

    private renderChip(chip: Node, data: IRoleComposeChip): void {
        const frame = chip.getChildByName('Frame').getComponent(Sprite);
        const icon = chip.getChildByName('Icon').getComponent(Sprite);
        const count = chip.getChildByName('Count').getComponent(Label);
        count.string = ROLE_TEXTS.gemComposeChipCount(data.count);
        icon.node.active = data.iconKey !== '';

        void loadRoleQualityFrame(data.quality).then(asset => {
            if (asset && isValid(chip, true)) frame.spriteFrame = asset;
        });
        if (data.iconKey) {
            void loadRoleBagIconSprite('gem', data.iconKey).then(asset => {
                if (asset && isValid(chip, true)) icon.spriteFrame = asset;
            });
        }
    }
}
