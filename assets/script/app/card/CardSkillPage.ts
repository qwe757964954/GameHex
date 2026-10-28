import { _decorator, Button, Label, Node } from 'cc';
import { PopupBase } from '../../framework/ui/PopupBase';
import { Toast } from '../common/Toast';
import { cardRepository } from './CardRepository';
import { CARD_LINEUP_TEXTS } from './CardLineupTexts';
import type {
    CardSkillListPresentation,
    CardSkillUpgradePhase,
    ICardSkillOpenData,
} from './CardPresentations';
import { CardSkillListView } from './CardSkillListView';
import type { ISkillStepPayload } from './CardLineupEvents';
import { CardLineupEvent } from './CardLineupEvents';
import { EventMgr } from '../../framework/event/EventMgr';
import { resolveCardSkills, resolveSkillLevel } from './CardSkillList';
import type { ZCArmySkill } from './CardSkillList';

export type { ICardSkillOpenData } from './CardPresentations';

const { ccclass, property } = _decorator;

/** 一行技能的可变状态：技能本体 + 当前（预览）档位 + 这一档的描述。 */
interface SkillRowState {
    readonly skill: ZCArmySkill;
    /** 服务端已确认的档位。 */
    serverLevel: number;
    /** 当前预览档位（「↑」按下后立刻 +1，失败时回退到 `serverLevel`）。 */
    level: number;
}

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
 *
 * ## 取数 / 状态机为什么在本组件里
 *
 * 原来这些在 `CardSkillPresenter`（144 行、6 个私有字段），弹窗只负责订阅事件。
 * 现在没有 Presenter 层：**取数、预览档、防重入、发包全在本组件**，因为这几样都是
 * 跨多次调用的会话状态，搬进来就不再需要"把状态推给视图"的那一跳。
 */
@ccclass('CardSkillPage')
export class CardSkillPage extends PopupBase {
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

    private skillList: CardSkillListView | null = null;
    private cardName = '';

    /** 取数轮次：`open()` 那次与升级成功后的重刷会交错，慢的回来不许覆盖快的。 */
    private skillRevision = 0;
    private skillHeroId = 0;
    private skillCardId = '';
    private skillRows: SkillRowState[] = [];
    private skillHeroLevel = 0;
    private skillBusy = false;
    private skillPhase: 'idle' | CardSkillUpgradePhase = 'idle';
    private skillLoaded = false;

    /**
     * 初始化。
     *
     * ⚠️ 取技能列表组件时用**字符串组件名**而不是 `getComponent(CardSkillListView)`：
     * 本文件与 `CardSkillListView` 存在循环 import（都经 `CardPresentations`），
     * 加载顺序不利时 `CardSkillListView` 在 `onInit` 那一刻还是 `undefined`，
     * `getComponent(undefined)` 直接抛错 —— `onInit` 就此中断，列表拿不到，
     * 四个箭头全部点了没反应。按名字取则与模块加载顺序无关。
     */
    protected onInit(): void {
        const title = this.titleNode?.getComponent(Label);
        if (title) title.string = CARD_LINEUP_TEXTS.skillTitle;
        this.closeButton?.on(Button.EventType.CLICK, this.onCloseClick, this);
        const listNode = this.skillListNode?.getComponent(CardSkillListView);
        this.skillList = listNode ?? null;
        if (!this.skillList) console.warn('[CardSkillPage] 未取到 CardSkillListView，技能列表不会渲染');
    }

    protected onOpen(userData?: ICardSkillOpenData): void | Promise<void> {
        if (!userData) return;
        this.cardName = userData.cardName ?? '';
        //  行只派发 `SkillStep`，本页订阅（见 `CardSkillRowView.step`）。
        EventMgr.instance.on(CardLineupEvent.SkillStep, this.onSkillStep, this);
        return this.loadSkills(userData.heroId);
    }

    protected onClose(): void {
        EventMgr.instance.offTarget(this);
        //  让在途的 `loadSkills()` 结果作废。
        this.skillRevision += 1;
    }

    /** 组件所在节点是否仍然有效（面板随时可能被关掉，`close()` 是直接 destroy）。 */
    private get alive(): boolean {
        return !!this.node && this.node.isValid;
    }

    /** 打开：拉技能表 + 该英雄技能等级，一次画全。 */
    private async loadSkills(heroId: number): Promise<void> {
        this.skillHeroId = Math.floor(Number(heroId) || 0);
        this.skillCardId = String(this.skillHeroId);
        this.skillRows = [];
        this.skillHeroLevel = 0;
        this.skillBusy = false;
        this.skillPhase = 'idle';
        this.skillLoaded = false;
        this.emit();
        await this.refreshSkills();
    }

    private async refreshSkills(): Promise<void> {
        const revision = ++this.skillRevision;
        const data = await cardRepository.loadSkillList(this.skillHeroId);
        if (revision !== this.skillRevision) return;
        if (!this.alive) return;

        const skills = resolveCardSkills(data.table, data.skillIds, this.skillCardId);
        const previous = new Map(this.skillRows.map((row) => [row.skill.skillId, row]));
        this.skillRows = skills.map((skill) => {
            const known = data.levels.some((item) => item.skillId === skill.skillId);
            const kept = previous.get(skill.skillId);
            //  服务端**给了**这个技能的等级才覆盖；没给（响应没带 / 老数据）就保留现有档位，
            //  否则每次刷新都会把「刚升上去的档」按第 1 档兜底冲掉。
            const level = known ? resolveSkillLevel(skill, data.levels) : (kept ? kept.level : resolveSkillLevel(skill, []));
            return { skill, serverLevel: level, level };
        });
        this.skillHeroLevel = data.heroLevel;
        this.skillLoaded = true;
        this.emit();
    }

    /**
     * 「↑ / ↓」。
     *
     * `direction = -1` 只改**本地预览档**：`CmdPvpHeroUpSkillReqMsg` 只有「升一级」，
     * 没有降级协议，往回看是纯展示行为，不发包、不消耗。
     *
     * `direction = +1` 才发包，且**先本地把预览档 +1 再发**（按钮立刻有反馈），
     * 失败时回退到服务端确认值。响应回来后整份重刷，新档位以服务端为准，不猜 `level + 1`。
     */
    async step(skillId: number, direction: 1 | -1, caller: object): Promise<void> {
        console.log(`[CardSkillPage] step skill=${skillId} dir=${direction} busy=${this.skillBusy} rows=${this.skillRows.length} heroLevel=${this.skillHeroLevel}`);
        if (this.skillBusy) return;
        const row = this.skillRows.find((item) => item.skill.skillId === skillId);
        if (!row) {
            console.warn(`[CardSkillPage] 找不到技能 ${skillId} 的行（当前行：${this.skillRows.map((r) => r.skill.skillId).join(',')}）`);
            return;
        }

        const maxLevel = row.skill.levels.length > 0
            ? row.skill.levels[row.skill.levels.length - 1].level : 0;
        const target = row.level + direction;
        if (target < 1 || target > maxLevel) {
            console.warn(`[CardSkillPage] 目标档 ${target} 越界（当前 ${row.level}，满级 ${maxLevel}）`);
            return;
        }

        if (direction < 0) {
            row.level = target;
            this.skillPhase = 'idle';
            this.emit();
            return;
        }
        const next = row.skill.levels.find((level) => level.level === target);
        /*
         * 目标档必须存在于表里；解锁等级**只在英雄等级已知时**才拦。
         *
         * `heroLevel = 0` 的含义是「后端还没给这个英雄的数据」，不是「英雄 0 级」。
         * 按 0 级拦会把所有技能锁死、点了毫无反应（实测就是这个坑）。
         * 门槛本来就该由服务端判：客户端只需把请求发出去，让 rsp 决定成败。
         */
        if (!next) {
            console.warn(`[CardSkillPage] 表里没有 ${skillId} 的第 ${target} 档（表内档位：${row.skill.levels.map((l) => l.level).join(',')}）`);
            return;
        }
        /*
         * **不再在客户端拦「英雄等级不足」**：`CmdPvpHeroInfo.level` 与配表的
         * `unlockarmylevel` 口径对不上（实测日志 hero=1 / 需 14），拦在这里会让技能
         * 永远升不动。门槛由服务端判，失败会以 rsp 的状态返回、由面板提示。
         */

        const previous = row.level;
        row.level = target;
        this.skillBusy = true;
        this.skillPhase = 'idle';
        this.emit();

        console.log(`[CardSkillPage] 发包 heroId=${this.skillHeroId} skillId=${skillId}`);
        const result = await cardRepository.upgradeHeroSkill(this.skillHeroId, skillId, caller);
        console.log('[CardSkillPage] 回包', result.kind);

        this.skillBusy = false;
        if (result.kind !== 'success') {
            row.level = previous;
            this.skillPhase = result.kind;
            this.emit();
            return;
        }
        row.serverLevel = target;
        await this.refreshSkills();
    }

    /** 把内部状态组装成展示模型（未加载完时是 `null`，列表据此清空）。 */
    private buildPresentation(): CardSkillListPresentation | null {
        if (!this.skillLoaded) return null;
        return {
            heroId: this.skillHeroId,
            heroLevel: this.skillHeroLevel,
            busy: this.skillBusy,
            phase: this.skillPhase,
            rows: this.skillRows.map((row) => {
                const levelRow = row.skill.levels.find((level) => level.level === row.level);
                const lastLevel = row.skill.levels[row.skill.levels.length - 1];
                return {
                    skill: row.skill,
                    level: row.level,
                    desc: levelRow?.desc || lastLevel?.desc || '',
                    source: row.level === row.serverLevel ? 'server' : 'local',
                };
            }),
        };
    }

    private emit(): void {
        this.presentSkills(this.buildPresentation());
    }

    private presentSkills(data: CardSkillListPresentation | null): void {
        if (!this.skillList) {
            console.warn('[CardSkillPage] skillList 为空，技能列表不会渲染');
            return;
        }
        console.log(`[CardSkillPage] presentSkills rows=${data?.rows.length ?? 0}`);
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

    /** `SkillStep` 的订阅端：行派发意图，本页决定发不发包（`step` 自己防重入）。 */
    private onSkillStep(payload: ISkillStepPayload): void {
        if (!this.alive) return;
        void this.step(payload.skillId, payload.direction, this);
    }

    private onCloseClick(): void {
        this.close();
    }
}
