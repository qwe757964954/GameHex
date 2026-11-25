import { _decorator, Button, Component, Label, Sprite } from 'cc';
import { loadRoleBagIconSprite } from './RoleArtLoader';
import { roleRepository } from './RoleRepository';
import type { IRoleGemSocket } from './RoleTypes';

const { ccclass, property } = _decorator;

/**
 * 装备详情弹窗中的单个宝石孔位项组件。
 *
 * 遵循 MVC 与组件化设计：
 *   - 视图引用：所有子控件（文本、按钮、图标）均通过 `@property` 在 Prefab 中直接绑定，
 *     彻底消除运行时 `getChildByName` 和 `getComponent` 查找；
 *   - 纯粹渲染：根据传入的 `IRoleGemSocket` 数据进行幂等展示；
 *   - 交互解耦：卸下操作通过回调派发给宿主弹窗处理。
 */
@ccclass('RoleEquipGemItem')
export class RoleEquipGemItem extends Component {
    @property({ type: Label, tooltip: '宝石描述/效果文字' })
    descLabel: Label = null!;

    @property({ type: Button, tooltip: '卸下按钮' })
    btnDown: Button = null!;

    @property({ type: Sprite, tooltip: '宝石图标' })
    iconSprite: Sprite = null!;

    private currentSocket: IRoleGemSocket | null = null;
    private onDownCallback?: (socket: IRoleGemSocket) => void;

    protected onLoad(): void {
        if (this.btnDown?.node) {
            this.btnDown.node.on(Button.EventType.CLICK, this.onDownClick, this);
        }
    }

    /**
     * 渲染宝石孔位数据。
     *
     * @param socket 槽位数据（若为 null / undefined 则隐藏本槽位）
     * @param onDown 卸下按钮点击回调
     */
    setData(socket: IRoleGemSocket | null | undefined, onDown?: (socket: IRoleGemSocket) => void): void {
        this.currentSocket = socket ?? null;
        this.onDownCallback = onDown;

        if (!socket) {
            this.node.active = false;
            return;
        }

        this.node.active = true;
        const gem = socket.gemId ? roleRepository.findGem(socket.gemId) : null;
        if (gem) {
            if (this.descLabel) this.descLabel.string = gem.desc || gem.name;
            if (this.btnDown?.node) this.btnDown.node.active = true;
            if (this.iconSprite) {
                this.iconSprite.node.active = true;
                if (gem.iconKey) {
                    void loadRoleBagIconSprite('gem', gem.iconKey).then(sf => {
                        if (this.isValid && sf) {
                            this.iconSprite.spriteFrame = sf;
                        }
                    });
                }
            }
        } else {
            if (this.descLabel) this.descLabel.string = '暂未镶嵌宝石';
            if (this.btnDown?.node) this.btnDown.node.active = false;
            if (this.iconSprite) {
                this.iconSprite.spriteFrame = null;
                this.iconSprite.node.active = false;
            }
        }
    }

    private onDownClick(): void {
        if (this.currentSocket && this.onDownCallback) {
            this.onDownCallback(this.currentSocket);
        }
    }
}
