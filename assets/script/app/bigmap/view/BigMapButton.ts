import { _decorator, Color, Component, Label, Sprite, SpriteFrame } from 'cc';
import { BIGMAP_COLORS, type IBigMapButton } from './BigMapTheme';

const { ccclass, property } = _decorator;

@ccclass('BigMapButton')
export class BigMapButton extends Component implements IBigMapButton {
    @property(Label) label: Label = null!;
    @property(Sprite) skin: Sprite = null!;
    @property(SpriteFrame) whiteFrame: SpriteFrame = null!;
    @property primary = false;
    private enabledForInput = true;
    private foreground: Color | null = null;

    get interactable(): boolean { return this.enabledForInput; }
    setEnabled(enabled: boolean): void {
        this.enabledForInput = enabled;
        const fallbackText = this.primary ? new Color(48, 34, 22) : BIGMAP_COLORS.text;
        this.label.color = enabled ? (this.foreground ?? fallbackText)
            : this.foreground ? new Color(167, 159, 143) : BIGMAP_COLORS.muted;
        this.skin.color = this.foreground
            ? (enabled ? Color.WHITE : new Color(140, 140, 140))
            : enabled ? (this.primary ? BIGMAP_COLORS.gold : BIGMAP_COLORS.panelLight) : BIGMAP_COLORS.panel;
    }
    setText(text: string): void { this.label.string = text; }
    setSkin(frame: SpriteFrame | null, foreground: Color): void {
        this.skin.spriteFrame = frame ?? this.whiteFrame;
        this.skin.node.active = true;
        this.foreground = frame ? foreground : null;
        this.setEnabled(this.enabledForInput);
    }
}
