import { _decorator, Button, CCInteger, Component, Sprite, SpriteFrame, UITransform } from 'cc';

const { ccclass, property } = _decorator;

/**
 * 底栏**一个页签按钮**（FGUI `组件/底菜单/按钮_首页_菜单.xml` 的 Cocos 简化版）。
 *
 * 战令接入原稿中这 4 组图标，用图标自带的文字，不再叠一层 Label。
 * 图标与累充的 `活动_图标_充值` 统一放在 `resources/ui/Gift/art`。
 *
 * ⚠️ FGUI 里这 4 个按钮**没写 `size`**（用组件默认尺寸），但 `xy` 是 240/360/480/600
 * ⇒ 间距 120 ⇒ 实际按钮宽 120。移植时按 120×111 摆（与礼包页签一致）。
 *
 * ⚠️ 选中态必须**绝对赋值**（规则 10）：切换页签时 4 个按钮会依次 `setSelected`，
 * 只写「选中」不写「取消」的话，会出现多个同时高亮。
 */
@ccclass('BattleTokenTabButton')
export class BattleTokenTabButton extends Component {
    @property({ type: Sprite, tooltip: '页签底图（由 prefab 声明）' })
    bg: Sprite = null!;

    @property({ type: Sprite, tooltip: '页签图标（图内已含文字）' })
    icon: Sprite = null!;

    @property({ type: Button, tooltip: '按钮本体（点击切页）' })
    button: Button = null!;

    @property({ type: SpriteFrame, tooltip: '底图·未选（生成器写入）' })
    offFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '底图·选中（生成器写入）' })
    onFrame: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '图标·未选（生成器写入）' })
    offIcon: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: '图标·选中（生成器写入）' })
    onIcon: SpriteFrame = null!;

    @property({ type: CCInteger, tooltip: '对应的 `CmdBattleTokenType`（1 通行证 / 2 七日登录 / 3 等级基金 / 4 过关令）' })
    tabType = 1;

    private _onSelect: (() => void) | null = null;

    bindSelect(handler: (() => void) | null): void {
        this._onSelect = handler;
    }

    protected onLoad(): void {
        this.node.on(Button.EventType.CLICK, this._handleClick, this);
    }

    protected onDestroy(): void {
        if (this.node && this.node.isValid) this.node.off(Button.EventType.CLICK, this._handleClick, this);
    }

    private _handleClick(): void {
        if (this._onSelect) this._onSelect();
    }

    /** 选中态（**两态都写**）。 */
    setSelected(selected: boolean): void {
        if (this.bg) {
            const frame = selected ? this.onFrame : this.offFrame;
            if (frame) this.bg.spriteFrame = frame;
        }
        if (this.icon) {
            const frame = selected ? this.onIcon : this.offIcon;
            if (frame) {
                this.icon.spriteFrame = frame;
                const size = frame.originalSize;
                this.icon.node.getComponent(UITransform)?.setContentSize(size.width, size.height);
            }
            this.icon.node.setPosition(this.icon.node.position.x, selected ? 33.5 : -2.5, this.icon.node.position.z);
        }
    }
}
