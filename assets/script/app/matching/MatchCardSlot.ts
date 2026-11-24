import { _decorator, Component, Sprite } from 'cc';
import type { SpriteFrame } from 'cc';
import { ICON_ART_ROOT, MATCH_ART_ROOT, MATCH_CARD_FRAME_ART } from '../ArtPaths';
import type { IIconLoader } from '../common/SpriteFrameCache';
import type { MatchCardData } from './MatchTypes';

const { ccclass, property } = _decorator;

@ccclass('MatchCardSlot')
export class MatchCardSlot extends Component {
    @property(Sprite)
    hero: Sprite = null!;

    @property(Sprite)
    frame: Sprite = null!;

    @property(Sprite)
    badge: Sprite = null!;

    private revision = 0;

    async render(card: MatchCardData, loader: IIconLoader | { readonly load: IIconLoader }): Promise<void> {
        const load = typeof loader === 'function' ? loader : loader.load;
        const revision = ++this.revision;
        this.applyArt(null, null, null);

        const [frame, hero, badge] = await Promise.all([
            load(MATCH_CARD_FRAME_ART[card.rarity], MATCH_ART_ROOT),
            load(card.headIcon, card.headRoot),
            load(card.roleIcon, ICON_ART_ROOT),
        ]);
        if (!this.isValid || revision !== this.revision) return;
        this.applyArt(frame, hero, badge);
    }

    private applyArt(frame: SpriteFrame | null, hero: SpriteFrame | null, badge: SpriteFrame | null): void {
        const visible = frame !== null && hero !== null;
        this.frame.spriteFrame = visible ? frame : null;
        this.hero.spriteFrame = visible ? hero : null;
        this.badge.spriteFrame = visible ? badge : null;
        this.badge.node.active = visible && badge !== null;
    }
}
