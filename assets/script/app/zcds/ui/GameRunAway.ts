import { _decorator, Button, Label, Node, SpriteFrame, UITransform } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { HeadArt } from '../../HeadArt';
import { createIconLoader } from '../../common/SpriteFrameCache';
import { ZCGameUiEvent } from '../view/ZCGameHudEvents';
import type { IZCDamageStatsPlayer } from '../application/ZCBattleRuntimeContract';
import { RunAwayPlayerItem } from './RunAwayPlayerItem';

const { ccclass, property } = _decorator;
const DEFAULT_TITLE = '伤害统计';
const ROW_HEIGHT = 116;
const HEADER_HEIGHT = 70;
const FOOTER_HEIGHT = 42;
const RETURN_HEIGHT = 84;

export interface GameRunAwayOptions {
    readonly players?: readonly IZCDamageStatsPlayer[];
    readonly title?: string;
    readonly showReturn?: boolean;
}

/** 本局逐玩家统计；数据由运行控制器推送，点击内容外空白关闭。 */
@ccclass('GameRunAway')
export class GameRunAway extends PopupBase {
    static prefabPath = 'ui/game/GameRunAway';

    @property(Label)
    titleLabel: Label = null!;
    @property(UITransform)
    panelTransform: UITransform = null!;
    @property(UITransform)
    backgroundTransform: UITransform = null!;
    @property(Node)
    header: Node = null!;
    @property(Label)
    footerLabel: Label = null!;
    @property([RunAwayPlayerItem])
    items: RunAwayPlayerItem[] = [];
    @property(Button)
    returnButton: Button = null!;

    private showReturn = false;
    private players: readonly IZCDamageStatsPlayer[] = [];
    private readonly heads = new Map<string, SpriteFrame>();
    private defaultHeads: (SpriteFrame | null)[] = [];

    protected onInit(): void {
        this.defaultHeads = this.items.map(item => item.avatar.spriteFrame);
        this.returnButton.node.on(Button.EventType.CLICK, this.returnByButton, this);
    }

    protected async onOpen(userData?: GameRunAwayOptions): Promise<void> {
        this.showReturn = Boolean(userData?.showReturn);
        this.titleLabel.string = userData?.title ?? DEFAULT_TITLE;
        this.returnButton.node.active = this.showReturn;
        this.returnButton.interactable = true;
        this.refresh(userData?.players ?? []);
        const scope = this.resourceScope;
        const keys = Array.from(new Set(this.players.map(player => player.headKey).filter(Boolean)));
        if (!keys.length) return;
        const loadIcon = createIconLoader(this.assets, scope);
        const resolver = await HeadArt.loadHeadArtResolver(this.configs);
        if (!this.isValid || scope.disposed) return;
        const frames = await Promise.all(keys.map(key => HeadArt.loadHeadFrame(key, loadIcon, resolver)));
        if (!this.isValid || scope.disposed) return;
        keys.forEach((key, index) => { if (frames[index]) this.heads.set(key, frames[index]); });
        this.refresh(this.players);
    }

    protected onClose(): void {
        this.showReturn = false;
        this.players = [];
        this.heads.clear();
    }

    protected canCloseOnBlank(): boolean { return !this.showReturn; }

    private returnByButton(): void {
        if (!this.showReturn) return;
        this.showReturn = false;
        this.returnButton.interactable = false;
        this.close(PopupCloseReason.CloseButton);
        EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    }

    refresh(players: readonly IZCDamageStatsPlayer[]): void {
        this.players = players;
        let maxDamage = 0, maxDamageTaken = 0;
        for (const player of players) {
            maxDamage = Math.max(maxDamage, player.damage);
            maxDamageTaken = Math.max(maxDamageTaken, player.damageTaken);
        }
        const count = Math.min(players.length, this.items.length);
        const height = HEADER_HEIGHT + ROW_HEIGHT * count + FOOTER_HEIGHT + (this.showReturn ? RETURN_HEIGHT : 0);
        this.panelTransform.setContentSize(this.panelTransform.width, height);
        this.backgroundTransform.setContentSize(this.backgroundTransform.width, height - 4);
        this.header.setPosition(0, height / 2 - HEADER_HEIGHT / 2);
        this.footerLabel.node.setPosition(0, -height / 2 + FOOTER_HEIGHT / 2 + (this.showReturn ? RETURN_HEIGHT : 0));
        this.returnButton.node.setPosition(0, -height / 2 + RETURN_HEIGHT / 2);
        for (let index = 0; index < this.items.length; index++) {
            const item = this.items[index], player = players[index];
            item.node.active = index < count;
            if (!player) continue;
            item.node.setPosition(0, height / 2 - HEADER_HEIGHT - ROW_HEIGHT * (index + 0.5));
            item.refresh({
                ...player, headSpriteFrame: this.heads.get(player.headKey) ?? this.defaultHeads[index],
                maxDamage, maxDamageTaken,
            });
        }
    }
}
