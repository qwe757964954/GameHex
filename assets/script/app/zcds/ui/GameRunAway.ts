/**
 * 对局结算页（挂在 GameRunAway.prefab 根节点上）。
 *
 * 继承 PopupBase，由 PopupManager 统一调度：常驻 `Popup` 层、参与弹窗深度排序、
 * 点击内容区外空白自动关闭。两行统计是 `RunAwayPlayerItem` 实例，
 * 由 `apply` 按统一上限（双方较大值）一起刷新，进度条才可比。
 */

import { _decorator, Button, Label, SpriteFrame } from 'cc';
import { EventMgr } from '../../../framework/event/EventMgr';
import { PopupBase } from '../../../framework/ui/PopupBase';
import { PopupCloseReason } from '../../../framework/ui/PopupDef';
import { ZCGameUiEvent } from '../view/ZCGameHudEvents';
import { RunAwayPlayerInfo, RunAwayPlayerItem } from './RunAwayPlayerItem';

const { ccclass, property } = _decorator;

/** 标题缺省文案，与 prefab 里 Content/Label 的初始值一致。 */
const DEFAULT_TITLE = '伤害统计';

/** 一行的展示数据；headSpriteFrame 省略时保留 prefab 里的默认头像。 */
export interface GameRunAwayPlayer {
    name: string;
    headSpriteFrame?: SpriteFrame | null;
    /** 造成伤害。 */
    damage: number;
    /** 承受伤害。 */
    damageTaken: number;
}

/** GameRunAway.open 的 userData 结构。 */
export interface GameRunAwayOptions {
    /** 我方统计行；省略则该行保持 prefab 初始内容。 */
    mine?: GameRunAwayPlayer;
    /** 敌方统计行；省略则该行保持 prefab 初始内容。 */
    enemy?: GameRunAwayPlayer;
    /** 面板标题；省略用「伤害统计」。 */
    title?: string;
    /** 结算说明；统计预览时省略。 */
    summary?: string;
    /**
     * 显示「返回主界面」按钮（**数据开关，不是回调**）：置位时同时禁掉空白关闭
     * ——「返回」语义下误点空白跑掉不合适。
     * 点了只派发 `ZCGameUiEvent.ReturnToMain`，**是否真的回主界面由控制器决定**（视图不碰流程）。
     */
    showReturn?: boolean;
}

/** 两行进度条的**统一上限**（双方较大的值；让两条进度条可比）。 */
interface GameRunAwayMaxes {
    readonly maxDamage: number;
    readonly maxDamageTaken: number;
}

@ccclass('GameRunAway')
export class GameRunAway extends PopupBase {
    /** 预制体路径（PopupManager 据此加载）。 */
    static prefabPath = 'ui/game/GameRunAway';

    @property({ type: Label, group: '面板', tooltip: 'Content/Label：标题' })
    titleLabel: Label = null;

    // 两行统计是 RunAwayPlayerItem 的嵌套实例，引用由 PrefabInfo targetOverrides 注入，
    // prefab JSON 里读出为 null 属正常，别据此判断"没绑"。
    @property({ type: RunAwayPlayerItem, group: '统计', tooltip: 'Content/MinePlayerItem：我方一行' })
    mineItem: RunAwayPlayerItem = null;

    @property({ type: RunAwayPlayerItem, group: '统计', tooltip: 'Content/EnemyPlayerItem：敌方一行' })
    enemyItem: RunAwayPlayerItem = null;

    @property({ type: Button, group: '面板', tooltip: '（可选）关闭按钮；不绑也能关——点空白即可' })
    closeButton: Button | null = null;

    @property({ type: Button, group: '面板', tooltip: '返回主界面按钮' })
    returnButton: Button = null;

    /** 「返回主界面」模式（由 `open` 的 `showReturn` 数据决定显隐，动作走事件）。 */
    private showReturn = false;

    
    // PopupBase 生命周期
    

    /**
     * 按钮只在实例生命周期内绑一次：`PopupBase` 首次打开前调一次 `onInit`，
     * 节点失活 / 池化复用不会掉监听，补绑会叠出多份。
     */
    protected onInit(): void {
        // 关闭按钮是可选引用：未绑时跳过（点空白仍能关闭）。
        if (this.closeButton) this.closeButton.node.on(Button.EventType.CLICK, this.closeByButton, this);
        this.returnButton.node.on(Button.EventType.CLICK, this.returnByButton, this);
    }

    /** 套用标题并填充两行；每次打开都会走这里。 */
    protected onOpen(userData?: GameRunAwayOptions): void {
        this.showReturn = Boolean(userData?.showReturn);
        this.titleLabel.string = userData?.title ?? DEFAULT_TITLE;
        this.returnButton.node.active = this.showReturn;
        this.returnButton.interactable = true;
        // 关闭按钮是可选引用：不绑也能靠点空白关闭，所以这里保留判空。
        if (this.closeButton) this.closeButton.node.active = !this.showReturn;
        this.apply(userData ?? {});
    }

    /** 节点由 PopupManager 回收/销毁，这里只做业务侧收尾。 */
    protected onClose(reason: PopupCloseReason): void {
        this.showReturn = false;
    }

    protected canCloseOnBlank(): boolean {
        return !this.showReturn;
    }

    private returnByButton(): void {
        if (!this.showReturn) return;
        // 先收摊再派发：连点两下只发一次（收尾多半是切流程，重复发等于 navigate 两次）。
        this.showReturn = false;
        this.returnButton.interactable = false;
        this.close(PopupCloseReason.CloseButton);
        //  只派发意图：回不回主界面由控制器订阅后决定（视图不认识流程）。
        EventMgr.instance.emit(ZCGameUiEvent.ReturnToMain);
    }

    
    // 业务 API
    

    /** 只更新两行数据，不改标题。 */
    refresh(options: Pick<GameRunAwayOptions, 'mine' | 'enemy'> = {}): void {
        this.apply(options);
    }

    
    // 内部实现
    

    /**
     * 两行一起填：先取双方较大的伤害/承伤当统一上限，再分别刷新，
     * 这样两根进度条的满格长度含义一致，能直接比出谁打得更多。
     */
    private apply(options: Pick<GameRunAwayOptions, 'mine' | 'enemy'>): void {
        const mine = options.mine;
        const enemy = options.enemy;
        if (!mine && !enemy) return;

        const maxes: GameRunAwayMaxes = {
            maxDamage: Math.max(mine?.damage ?? 0, enemy?.damage ?? 0),
            maxDamageTaken: Math.max(mine?.damageTaken ?? 0, enemy?.damageTaken ?? 0),
        };

        if (mine) this.renderItem(this.mineItem, mine, maxes);
        if (enemy) this.renderItem(this.enemyItem, enemy, maxes);
    }

    private renderItem(item: RunAwayPlayerItem, player: GameRunAwayPlayer, maxes: Readonly<GameRunAwayMaxes>): void {
        const info: RunAwayPlayerInfo = {
            name: player.name,
            // 不传头像时沿用 prefab 里的默认头像，避免结算页出现空头像。
            headSpriteFrame: player.headSpriteFrame ?? item.avatar.spriteFrame,
            damage: player.damage,
            damageTaken: player.damageTaken,
            maxDamage: maxes.maxDamage,
            maxDamageTaken: maxes.maxDamageTaken,
        };
        item.refresh(info);
    }
}
