/**
 * 「巡逻宝箱」守护怪单格组件 —— 负责单个守护怪槽位的卡底、头像、未解锁锁标与解锁文案渲染。
 *
 * 与预制体 `Panel/GuardRow/Guard_i` 绑定，消灭运行时 `getChildByName` 与可空断言。
 */
import { _decorator, Component, Label, Node, Sprite, type SpriteFrame } from 'cc';

const { ccclass, property } = _decorator;

/** 一个守护怪格：头像 + 是否已解锁 + 解锁条件 / 数量文案。 */
export interface ITerritoryMonsterBoxGuard {
    readonly icon: SpriteFrame | null;
    readonly unlocked: boolean;
    /** 解锁条件（如「4 级解锁」）；空串 = 整行隐藏。 */
    readonly unlockText: string;
    /** 数量文案（如「数量：44」）；空串 = 整行隐藏。 */
    readonly countText: string;
}

@ccclass('TerritoryMonsterBoxGuardSlot')
export class TerritoryMonsterBoxGuardSlot extends Component {
    @property({ type: Node, group: '节点引用', tooltip: 'CardBg：已解锁米黄卡底' })
    private cardBg: Node = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'LockBg：未解锁深棕卡底' })
    private lockBg: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：守护怪头像' })
    private icon: Sprite = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Lock：未解锁锁标' })
    private lock: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'UnlockLabel：解锁文案（如「4 级解锁」）' })
    private unlockLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'CountLabel：数量文案（如「数量：44」）' })
    private countLabel: Label = null!;

    /**
     * 渲染单格守护怪（幂等、全量赋值）。
     *
     * 锁定态用深棕 `LockBg` 顶掉卡底并收起头像 —— 与设计稿「翻面锁卡」一致；
     * 未锁定态恢复米黄卡底与头像。头像缺失时清空帧，避免槽位复用时串上一只怪。
     */
    render(guard?: ITerritoryMonsterBoxGuard): void {
        if (!guard) {
            this.node.active = false;
            return;
        }
        this.node.active = true;
        this.cardBg.active = guard.unlocked;
        this.lockBg.active = !guard.unlocked;
        this.icon.node.active = guard.unlocked;
        this.icon.spriteFrame = guard.icon;
        this.lock.active = !guard.unlocked;
        this.unlockLabel.string = guard.unlockText;
        this.unlockLabel.node.active = guard.unlockText !== '';
        this.countLabel.string = guard.countText;
        this.countLabel.node.active = guard.countText !== '';
    }
}
