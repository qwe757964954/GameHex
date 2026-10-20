import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { Toast } from '../common/Toast';
import { cardRepository } from './CardRepository';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import { CardSkillPresenter } from './CardPresenters';
import type { CardSkillListPresentation, ICardSkillOpenData } from './CardPresenters';
import { CardSkillListView } from './CardSkillListView';
import type { ICardSkillRowHost } from './CardSkillRowView';

export type { ICardSkillOpenData } from './CardPresenters';

const { ccclass, property } = _decorator;

/**
 * 「卡牌技能」独立弹窗（`assets/resources/ui/card/CardSkill.prefab`）。
 *
 * 为什么独立成弹窗：升级弹窗（`CardUpgrade.prefab`）的纵向已被卡面 / 信息 /
 * 卡牌消耗 / 经验 / 提示 / 升级按钮占满，硬塞技能区会与「卡牌」「经验」两行文字重叠。
 *
 * 用法（卡牌阵容页点卡时的入口）：
 *   `popupManager.show(CardSkillPage, { heroId })` —— 只带英雄 id，其余全从配表与
 *   后端缓存读（技能表 `armySkillLevelUp` + `pvpCard.skillList` + `CmdPvpHeroInfo.skills`）。
 *
 * 一条技能一行（左侧名字 / 等级 / 解锁提示，右侧 ↓ ↑ 两个按钮），
 * 最多 4 行 —— 用 `VirtualScrollView` 之外的做法：技能数恒定 ≤ 4，直接铺静态行节点。
 */
@ccclass('CardSkillPage')
export class CardSkillPage extends PopupBase implements ICardSkillRowHost {
    /**
     * 弹窗预制体在 `resources` 下的路径（`PopupManager` 用它加载）。
     *
     * 少了这一行，`PopupManager` 会在打开时报「未声明 static prefabPath，无法定位预制体」。
     * 路径与文件位置 `assets/resources/ui/card/CardSkill.prefab` 对应，**不带扩展名**。
     */
    static prefabPath = 'ui/card/CardSkill';

    @property({ type: Node, tooltip: 'CloseBtn：右上角关闭按钮（挂 cc.Button）' })
    closeButton: Node = null!;

    //  文字位一律绑**节点**、用时 `getComponent(Label)`：组件类型的属性对序列化值要求更严
    //  （存成节点就整字段被丢弃 → 运行时 undefined），节点引用则宽容得多。
    @property({ type: Node, tooltip: 'TitleLabel：弹窗标题节点（挂 Label）' })
    titleNode: Node = null!;

    @property({ type: Node, tooltip: 'NameLabel：卡名节点（挂 Label）' })
    nameNode: Node = null!;

    @property({ type: Node, tooltip: 'Skills：技能列表根节点（挂 CardSkillListView）' })
    skillListNode: Node = null!;

    private readonly presenter = new CardSkillPresenter(cardRepository);
    private skillList: CardSkillListView | null = null;
    private cardName = '';

    /**
     * 初始化。
     *
     * ⚠️ 取技能列表组件时用**字符串组件名**而不是 `getComponent(CardSkillListView)`：
     * 本文件与 `CardSkillListView` 存在循环 import（都经 `CardPresenters`），
     * 加载顺序不利时 `CardSkillListView` 在 `onInit` 那一刻还是 `undefined`，
     * `getComponent(undefined)` 直接抛错 —— `onInit` 就此中断，`host` 永不注入，
     * 四个箭头全部点了没反应。按名字取则与模块加载顺序无关。
     */
    protected onInit(): void {
        const title = this.titleNode?.getComponent(Label);
        if (title) title.string = CARD_LINEUP_TEXTS.skillTitle;
        this.closeButton?.on(Button.EventType.CLICK, this.onCloseClick, this);
        const listNode = this.skillListNode?.getComponent(CardSkillListView);
        this.skillList = listNode ?? null;
        if (this.skillList) this.skillList.host = this;
        else console.warn('[CardSkillPage] 未取到 CardSkillListView，技能按钮将无响应');
    }

    protected onOpen(userData?: ICardSkillOpenData): void | Promise<void> {
        if (!userData) return;
        this.cardName = userData.cardName ?? '';
        return this.presenter.open(userData.heroId, this.cardskillView());
    }

    protected onClose(): void {
        this.presenter.dispose();
    }

    /** 组件所在节点是否仍然有效（面板随时可能被关掉，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    private cardskillView() {
        return {
            isAlive: () => this.alive,
            presentSkills: (data: CardSkillListPresentation | null) => this.presentSkills(data),
        };
    }

    private presentSkills(data: CardSkillListPresentation | null): void {
        if (!this.skillList) {
            console.warn('[CardSkillPage] skillList 为空，技能列表不会渲染');
            return;
        }
        console.log(`[CardSkillPage] presentSkills rows=${data?.rows.length ?? 0} host=${this.skillList.host === this}`);
        this.skillList.render(data);
        // 卡名由打开时带进来（`ICardSkillOpenData.cardName`），没带就留 prefab 原文案。
        const name = this.nameNode?.getComponent(Label);
        if (name && this.cardName) name.string = this.cardName;
        const phase = data?.phase;
        if (phase === 'offline' || phase === 'failed') {
            Toast.show(phase === 'offline'
                ? CARD_LINEUP_TEXTS.skillUpgradeOffline
                : CARD_LINEUP_TEXTS.skillUpgradeFailed);
        }
    }

    onSkillStep(skillId: number, direction: 1 | -1): void {
        if (!this.alive) return;
        void this.presenter.step(skillId, direction, this, this.cardskillView());
    }

    private onCloseClick(): void {
        this.close();
    }
}
