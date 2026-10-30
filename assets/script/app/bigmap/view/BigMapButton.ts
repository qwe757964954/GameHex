import { _decorator, Color, Component, Label, Sprite, SpriteFrame } from 'cc';
import { BigMapPanel } from './BigMapPanel';
import { BIGMAP_COLORS, type IBigMapButton } from './BigMapTheme';

const { ccclass, property } = _decorator;

@ccclass('BigMapButton')
export class BigMapButton extends Component implements IBigMapButton {
    @property(Label) label: Label = null;
    @property(Sprite) skin: Sprite = null;
    @property(BigMapPanel) fallback: BigMapPanel = null;
    @property primary = false;
    private enabledForInput = true;
    private foreground: Color | null = null;

    get interactable(): boolean { return this.enabledForInput; }
    setEnabled(enabled: boolean): void {
        this.enabledForInput = enabled;
        this.fallback.fill = enabled ? (this.primary ? BIGMAP_COLORS.gold : BIGMAP_COLORS.panelLight) : BIGMAP_COLORS.panel;
        this.fallback.border = enabled ? (this.primary ? new Color(66, 42, 19) : BIGMAP_COLORS.border) : BIGMAP_COLORS.muted;
        this.fallback.redraw();
        const fallbackText = this.primary ? new Color(48, 34, 22) : BIGMAP_COLORS.text;
        this.label.color = enabled ? (this.foreground ?? fallbackText)
            : this.foreground ? new Color(167, 159, 143) : BIGMAP_COLORS.muted;
        this.skin.color = enabled ? Color.WHITE : new Color(140, 140, 140);
    }
    setText(text: string): void { this.label.string = text; }
    setSkin(frame: SpriteFrame | null, foreground: Color): void {
        this.skin.spriteFrame = frame;
        this.skin.node.active = !!frame;
        this.fallback.graphics.enabled = !frame;
        this.foreground = frame ? foreground : null;
        this.setEnabled(this.enabledForInput);
    }
}
