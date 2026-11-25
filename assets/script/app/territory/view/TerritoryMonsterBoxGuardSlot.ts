/**
 * 「巡逻宝箱」守护怪单格组件 —— 负责单个守护怪槽位的卡底、头像、未解锁锁标与解锁文案渲染。
 *
 * 与预制体 `Panel/GuardRow/Guard_i` 绑定，消灭运行时 `getChildByName` 与可空断言。
 *
 * ## 未解锁态（2026-11-24 改版）
 *
 * 旧版是「深棕纯色底 + 白锁居中 + 格内文案」。新版改成**提前披露**：
 *
 * - 卡底**恒为米黄**（不再有深棕 `LockBg` 这一层）；
 * - 头像**照常画**（锁定也要看得见是哪只怪），锁标压在人像正中；
 * - 「N 级解锁」文案挪到**头像下方**，与「数量：NN」同一位置、同一字号与颜色
 *   （两者互斥：解锁后显示数量、未解锁显示解锁条件，所以共用同一行不会打架）。
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
    @property({ type: Node, group: '节点引用', tooltip: 'CardBg：米黄卡底（锁定态也是这张，不再换深棕底）' })
    private cardBg: Node = null!;

    @property({ type: Sprite, group: '节点引用', tooltip: 'Icon：守护怪头像（锁定态也画，提前披露样式）' })
    private icon: Sprite = null!;

    @property({ type: Node, group: '节点引用', tooltip: 'Lock：锁标（居中压在头像上）' })
    private lock: Node = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'UnlockLabel：解锁文案（头像下方，与 CountLabel 同一行）' })
    private unlockLabel: Label = null!;

    @property({ type: Label, group: '节点引用', tooltip: 'CountLabel：数量文案（如「数量：44」）' })
    private countLabel: Label = null!;

    /**
     * 渲染单格守护怪（幂等、全量赋值）。
     *
     * 锁定态**不换底、不藏头像** —— 只在头像中央叠一把锁 + 下方写解锁条件；
     * 头像缺失（配置没配够 / 图还没加载到）时清空帧并收起 `Icon`，避免槽位复用时串上一只怪，
     * 此时锁定格只剩米黄卡底 + 锁 + 文案（降级不崩）。
     */
    render(guard?: ITerritoryMonsterBoxGuard): void {
        if (!guard) {
            this.node.active = false;
            return;
        }
        this.node.active = true;
        this.cardBg.active = true;
        // 已解锁恒显示（沿用旧行为，图晚到时不会先闪一下空）；未解锁要有图才显示
        this.icon.spriteFrame = guard.icon;
        this.icon.node.active = guard.unlocked || guard.icon !== null;
        this.lock.active = !guard.unlocked;
        this.unlockLabel.string = guard.unlockText;
        this.unlockLabel.node.active = guard.unlockText !== '';
        this.countLabel.string = guard.countText;
        this.countLabel.node.active = guard.countText !== '';
    }
}
