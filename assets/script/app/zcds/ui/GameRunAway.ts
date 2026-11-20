import { _decorator, Button, Label, Node, SpriteFrame } from 'cc';
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

export interface GameRunAwayOptions {
    readonly players?: readonly IZCDamageStatsPlayer[];
    readonly title?: string;
    readonly showReturn?: boolean;
}

/** 本局逐玩家统计；数据由运行控制器推送，点击内容外空白关闭。*/
@ccclass('GameRunAway')
export class GameRunAway extends PopupBase {
    static prefabPath = 'ui/game/GameRunAway';

    /**
     * 不播统一离场过渡（与 `ZCSettlementPage` 同一条口径，见 `PopupBase.motionEnabled`）。
     *
     * 离场过渡会把节点寿命延长 0.16s，而 `_internalClose` 同步 dispose 资源作用域，
     * 头像 / 图标在 `EVENT_AFTER_DRAW` 就被销毁 ⇒ 淡出期间每帧崩
     * `frame should not be invalid, it may have been released`。
     */
    motionEnabled = false;

    @property(Label)
    titleLabel: Label = null!;
    @property(Label)
    footerLabel: Label = null!;
    @property([RunAwayPlayerItem])
    items: RunAwayPlayerItem[] = [];
    @property(Button)
    returnButton: Button = null!;

    private showReturn = false;
    /** Return 按钮的占位区（GameRunAway.prefab 的 ReturnArea，高度 84 由 prefab Layout 决定）。 */
    private returnArea: Node | null = null;
    private players: readonly IZCDamageStatsPlayer[] = [];
    private readonly heads = new Map<string, SpriteFrame>();
    private defaultHeads: (SpriteFrame | null)[] = [];

    protected onInit(): void {
        this.defaultHeads = this.items.map(item => item.avatar.spriteFrame);
        this.returnArea = this.returnButton.node.parent;
        this.returnButton.node.on(Button.EventType.CLICK, this.returnByButton, this);
    }

    protected async onOpen(userData?: GameRunAwayOptions): Promise<void> {
        if (userData) {
            this.showReturn = Boolean(userData.showReturn);
            this.titleLabel.string = userData.title ?? DEFAULT_TITLE;
            this.refresh(userData.players ?? []);
        } else {
            this.showReturn = false;
            this.titleLabel.string = DEFAULT_TITLE;
            this.refresh([]);
        }
        if (this.returnArea) this.returnArea.active = this.showReturn;
        this.returnButton.interactable = true;
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

    protected canCloseOnBlank(): boolean {
        return !this.showReturn;
    }

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
        if (this.returnArea) this.returnArea.active = this.showReturn;
        for (let index = 0; index < this.items.length; index++) {
            const item = this.items[index], player = players[index];
            item.node.active = index < count;
            if (!player) continue;
            item.refresh({
                ...player, headSpriteFrame: this.heads.get(player.headKey) ?? this.defaultHeads[index],
                maxDamage, maxDamageTaken,
            });
        }
    }
}
