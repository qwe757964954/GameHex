import { _decorator, Button, Label, Sprite, SpriteFrame } from 'cc';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { EventMgr } from '../../../framework/event/EventMgr';
import { BigMapUiEvent, type BigMapIntent } from '../application/BigMapEvents';

const { ccclass, property } = _decorator;
export interface IBigMapInfoPopupContent {
    readonly title: string;
    readonly body: string;
    readonly icon: SpriteFrame | null;
    readonly primary: { readonly text: string; readonly enabled: boolean } | null;
    readonly secondary: { readonly text: string; readonly enabled: boolean } | null;
}

/** 野怪与基地建筑详情；生命周期、模态及空白关闭统一交给 PopupBase。 */
@ccclass('BigMapInfoPopup')
export class BigMapInfoPopup extends PopupBase {
    static prefabPath = 'ui/bigmap/BigMapInfoPopup';
    @property(Label) private infoTitle: Label = null!;
    @property(Label) private infoBody: Label = null!;
    @property(Sprite) private infoThumbnail: Sprite = null!;
    @property(Button) private closeButton: Button = null!;
    @property(Button) private primaryButton: Button = null!;
    @property(Button) private secondaryButton: Button = null!;

    @property(Label) private primaryLabel: Label = null!;
    @property(Label) private secondaryLabel: Label = null!;

    protected onInit(): void {
        this.closeButton.node.on(Button.EventType.CLICK, this.onCloseClick, this);
        this.primaryButton.node.on(Button.EventType.CLICK, this.onPrimary, this);
        this.secondaryButton.node.on(Button.EventType.CLICK, this.onSecondary, this);
    }
    protected onOpen(content: IBigMapInfoPopupContent): void { this.render(content); }
    protected onClose(reason: PopupCloseReason): void {
        if (reason !== PopupCloseReason.Force) this.sendIntent({ kind: 'clear' });
    }
    private onCloseClick(): void { this.close(PopupCloseReason.CloseButton); }
    private onPrimary(): void { this.sendIntent({ kind: 'primary' }); }
    private onSecondary(): void { this.sendIntent({ kind: 'secondary' }); }
    private sendIntent(intent: BigMapIntent): void { EventMgr.instance.emit(BigMapUiEvent.Intent, { intent }); }

    render(content: IBigMapInfoPopupContent): void {
        this.infoTitle.string = content.title;
        this.infoBody.string = content.body;
        this.infoThumbnail.spriteFrame = content.icon;
        this.infoThumbnail.node.active = !!content.icon;
        this.renderButton(this.primaryButton, this.primaryLabel, content.primary);
        this.renderButton(this.secondaryButton, this.secondaryLabel, content.secondary);
    }
    private renderButton(button: Button, label: Label, action: IBigMapInfoPopupContent['primary']): void {
        button.node.active = action !== null;
        label.string = action?.text ?? '';
        button.interactable = action?.enabled ?? false;
    }
}
