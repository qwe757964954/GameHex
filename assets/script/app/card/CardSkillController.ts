import { ControllerBase, type IControllerContext } from '../../framework/controller/ControllerBase';
import type { ICardRepository, CardSkillListData, UpgradeHeroSkillResult } from './CardRepository';
import type {
    CardSkillListPresentation,
    CardSkillUpgradePhase,
    ICardSkillOpenData,
} from './CardPresentations';
import { resolveCardSkills, resolveSkillLevel, skillLevelRow, skillLevelUnlocked, skillMaxLevel } from './CardSkillList';
import type { ZCArmySkill } from './CardSkillList';
import { CardPopupEvent } from './CardPopupEvents';

/** 一行技能的会话状态：技能本体 + 服务端确认档 + 当前（预览）档位。 */
interface SkillRowState {
    readonly skill: ZCArmySkill;
    /** 服务端已确认的档位。 */
    serverLevel: number;
    /** 当前预览档位（「↑」按下后立刻 +1，失败时回退到 `serverLevel`）。 */
    level: number;
}

export interface ICardSkillControllerOptions {
    readonly owner: object;
    /** 所选英雄与技能。 */
    readonly data: ICardSkillOpenData;
    readonly repository: Pick<ICardRepository, 'loadSkillList' | 'upgradeHeroSkill'>;
    readonly view: {
        /** 只读 ViewState；未加载完传 `null`。 */
        readonly render: (state: CardSkillListPresentation | null) => void;
        readonly close: () => void;
        /** 一次性展示命令：文案由 View 决定，Controller 不碰 Toast / cc。 */
        readonly notify: (kind: 'offline' | 'failed') => void;
    };
    readonly requests: { readonly removeCaller: (caller: object) => void };
    readonly failed: (error: unknown) => void;
}

/** 单技能会话由组合层持有，关闭时解除意图与在途请求。 */
export class CardSkillController extends ControllerBase {
    private readonly heroId: number;
    private readonly cardId: string;
    private rows: SkillRowState[] = [];
    private heroLevel = 0;
    private busy = false;
    private phase: 'idle' | CardSkillUpgradePhase = 'idle';
    private loaded = false;
    private revision = 0;
    private started = false;
    private skillData: CardSkillListData | null = null;

    constructor(context: IControllerContext, private readonly options: ICardSkillControllerOptions) {
        super(context, 'card-skill');
        this.heroId = Math.floor(Number(options.data.heroId) || 0);
        this.cardId = String(this.heroId);
        //  在途请求的 caller 是本控制器；组合层 dispose 时统一解除。
        this.own(() => options.requests.removeCaller(this));
    }

    async start(): Promise<void> {
        if (this.started || this.isDisposed) return;
        this.started = true;
        this.listen(CardPopupEvent.SkillIntent, this.onUpgradeIntent);
        if (!Number.isSafeInteger(this.heroId) || this.heroId <= 0
            || !Number.isSafeInteger(this.options.data.skillId) || this.options.data.skillId <= 0) {
            this.options.failed(new Error('[CardSkillController] 缺少合法 heroId / skillId'));
            this.options.view.close();
            return;
        }
        this.rows = [];
        this.heroLevel = 0;
        this.busy = false;
        this.phase = 'idle';
        this.loaded = false;
        this.publish();
        await this.refresh();
    }

    private publish(): void {
        this.options.view.render(this.buildPresentation());
    }

    private buildPresentation(): CardSkillListPresentation | null {
        if (!this.loaded) return null;
        const row = this.rows[0];
        const next = row ? skillLevelRow(row.skill, row.serverLevel + 1) : undefined;
        const costs = (next?.costs ?? []).map(cost => ({
            ...cost, ...(this.skillData?.costItems?.get(cost.itemId) ?? {
                itemId: cost.itemId, name: String(cost.itemId), owned: 0, frame: null,
            }),
        }));
        const meta = this.skillData?.skillDetails?.get(this.options.data.skillId);
        return {
            skillKind: meta?.kind ?? '',
            cooldown: meta?.cooldown ?? 0,
            costs,
            canUpgrade: !!next && !this.busy && this.heroLevel >= next.unlockHeroLevel
                && costs.every(cost => cost.owned >= cost.need),
            heroId: this.heroId,
            heroLevel: this.heroLevel,
            busy: this.busy,
            phase: this.phase,
            rows: this.rows.map((row) => {
                const levelRow = skillLevelRow(row.skill, row.level);
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

    /**
     * 重刷技能列表。取表失败不外抛（`onSkillStep` 是 `void` 调用），
     * 且只要会话还活着、轮次没被抢就 `publish()` 一次，保证 `busy = false` 落到视图。
     */
    private async refresh(): Promise<void> {
        const revision = ++this.revision;
        let data: CardSkillListData | null = null;
        try {
            data = await this.options.repository.loadSkillList(this.heroId);
        } catch (error) {
            this.options.failed(error);
        }
        if (this.isDisposed || revision !== this.revision) return;
        if (!data) {
            //  保留已有行，只把状态刷下去，列表不会变成空态。
            this.publish();
            return;
        }
        const skills = resolveCardSkills(data.table, data.skillIds, this.cardId)
            .filter(skill => skill.skillId === this.options.data.skillId);
        if (skills.length === 0) {
            this.options.failed(new Error('[CardSkillController] 技能不属于当前英雄或缺少配置'));
            this.options.view.close();
            return;
        }
        this.skillData = data;
        const previous = new Map(this.rows.map((row) => [row.skill.skillId, row]));
        this.rows = skills.map((skill) => {
            const known = data.levels.some((item) => item.skillId === skill.skillId);
            const kept = previous.get(skill.skillId);
            //  服务端给了等级才覆盖；没给就保留现有档位，避免刷新把刚升的档冲回第 1 档。
            const level = known ? resolveSkillLevel(skill, data.levels) : (kept ? kept.level : resolveSkillLevel(skill, []));
            return { skill, serverLevel: level, level };
        });
        this.heroLevel = data.heroLevel;
        this.loaded = true;
        this.publish();
    }

    private onUpgradeIntent(event: { readonly owner: object }): void {
        if (event.owner !== this.options.owner) return;
        void this.step(this.options.data.skillId, 1).catch(error => this.options.failed(error));
    }

    /**
     * 「↑ / ↓」。`direction = -1` 只改本地预览档；`+1` 且预览档已追上服务端档时才发包。
     *
     * 口径与迁移前的 `CardSkillPage.step` 完全一致，行为护栏见
     * `tests/card-runtime-regression.test.ts`（不复制算法，直接跑本方法）。
     */
    async step(skillId: number, direction: 1 | -1): Promise<void> {
        if (this.busy) return;
        const row = this.rows.find((item) => item.skill.skillId === skillId);
        if (!row) {
            console.warn(`[CardSkillController] 找不到技能 ${skillId} 的行`);
            return;
        }
        const maxLevel = skillMaxLevel(row.skill);
        const target = row.level + direction;
        if (target < 1 || target > maxLevel) return;
        if (!skillLevelRow(row.skill, target)) return;

        if (direction < 0 || target <= row.serverLevel) {
            //  ↓ 本地往回看，或预览档还落后服务端档时 ↑ 只是回到当前档：都不发包。
            row.level = target;
            this.phase = 'idle';
            this.publish();
            return;
        }
        if (!skillLevelUnlocked(row.skill, target, this.heroLevel)) return;
        if (!this.buildPresentation()?.canUpgrade) return;
        row.level = target;
        this.busy = true;
        this.phase = 'idle';
        this.publish();

        const revision = this.revision;
        let result: UpgradeHeroSkillResult;
        try {
            result = await this.options.repository.upgradeHeroSkill(this.heroId, skillId, this);
        } catch (error) {
            console.warn('[CardSkillController] 技能升级请求异常', error);
            result = { kind: 'failed' };
        }
        if (this.isDisposed || revision !== this.revision) {
            //  会话已结束 / 轮次已变：复位可变状态，不让在途请求留下脏 busy。
            this.busy = false;
            row.level = row.serverLevel;
            return;
        }
        this.busy = false;
        if (result.kind !== 'success') {
            row.level = row.serverLevel;
            this.phase = result.kind;
            this.publish();
            this.options.view.notify(result.kind);
            return;
        }
        //  服务端确认档优先，不猜 `target`：服务端可能连升 / 只升半档。
        const confirmed = Math.min(Math.floor(Number(result.level) || row.serverLevel), maxLevel);
        row.serverLevel = confirmed;
        row.level = confirmed;
        await this.refresh();
    }
}
