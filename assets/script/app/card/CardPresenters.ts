import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type {
    CardLineupData,
    CardSkillListData,
    ICardRepository,
    LineupBoardData,
} from './CardRepository';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { FormationSaveResult } from './FormationService';
import { LineupDraftStore } from './LineupDraftStore';
import { buildPresetDecks } from './LineupPresets';
import { resolveCardSkills, resolveSkillLevel } from './CardSkillList';
import type { ZCArmySkill } from './CardSkillList';

export interface CardLineupView {
    isAlive(): boolean;
    presentLineup(data: CardLineupData): void | Promise<void>;
}

export class CardLineupPresenter {
    private revision = 0;
    constructor(private readonly repository: ICardRepository) {}

    async refresh(autoLoadDecks: boolean, view: CardLineupView): Promise<void> {
        const revision = ++this.revision;
        const data = await this.repository.loadLineup(autoLoadDecks);
        if (revision !== this.revision || !view.isAlive()) return;
        await view.presentLineup(data);
    }

    dispose(): void { this.revision += 1; }
}

export interface LineupBoardPresentation extends LineupBoardData {
    readonly draft: LineupDraftStore;
}

export interface LineupBoardView {
    isAlive(): boolean;
    presentBoard(data: LineupBoardPresentation): void | Promise<void>;
}

export class LineupBoardPresenter {
    private revision = 0;
    constructor(private readonly repository: ICardRepository) {}

    async refresh(
        autoLoadDecks: boolean,
        presetCount: number,
        selectedPreset: number,
        view: LineupBoardView,
    ): Promise<void> {
        const revision = ++this.revision;
        const data = await this.repository.loadBoard(autoLoadDecks);
        if (revision !== this.revision || !view.isAlive()) return;
        // 每个页签的初始卡组来自后端阵型（`formationId = 页签下标 + 1`）；
        // 没有后端数据时 `buildPresetDecks` 会让所有页签都用本地卡组。
        const decks = buildPresetDecks(data, presetCount);
        // 优先用服务端返回的选中阵型，没有再用默认页签
        let initialPreset = selectedPreset;
        if (data.formations) {
            const selectedFormation = data.formations.find((f) => f.selected);
            if (selectedFormation) {
                initialPreset = selectedFormation.formationId - 1;
            }
        }
        await view.presentBoard({
            ...data,
            draft: new LineupDraftStore(data.deck, 8, presetCount, initialPreset, decks),
        });
    }

    /**
     * 保存（覆盖）一个阵型。返回服务端确认后的结果，由 View 决定怎么提示。
     *
     *  这里不做「先发后到丢弃」—— 保存是用户动作、页面同时只允许一笔（View 用 saving 锁），
     * 与 `refresh()` 的竞态语义不同，硬套 revision 反而会把结果吞掉。
     */
    submit(formationId: number, heroIds: readonly number[], caller?: unknown): Promise<FormationSaveResult> {
        return this.repository.saveFormation(formationId, heroIds, caller);
    }

    dispose(): void { this.revision += 1; }
}

/** 从卡牌页打开升级弹窗时带的业务数据。 */
export interface ICardUpgradeOpenData {
    readonly card: ZCDeckCard | null;
    readonly cardId: string;
    readonly level: number;
    readonly onUpgraded?: (heroId: number, level: number) => void;
}

/** 打开技能面板时带的业务数据（只要英雄 id，其余从配表与后端缓存读）。 */
export interface ICardSkillOpenData {
    readonly heroId: number;
    /** 卡名（可选，只用于标题下方那行文字）。 */
    readonly cardName?: string;
}

export type CardUpgradePhase = 'loading' | 'ready' | 'submitting' | 'offline' | 'failed';

/** 一行技能：技能本体 + 当前（预览）档位 + 这一档的描述。 */
export interface CardSkillRowPresentation {
    readonly skill: ZCArmySkill;
    /** 当前显示的档位（预览值；「↑」按下后立刻变化，不等服务端）。 */
    readonly level: number;
    /** 该档描述的兜底文案（表里当行为空时用最后一档的）。 */
    readonly desc: string;
    /** 该技能的等级来自哪里：`server` = 后端已确认；`local` = 纯本地预览。 */
    readonly source: 'server' | 'local';
}

export interface CardSkillListPresentation {
    readonly heroId: number;
    readonly heroLevel: number;
    /** 是否正在发技能升级请求（期间四个按钮全置灰）。 */
    readonly busy: boolean;
    /** 最近一次的请求结果；`undefined` = 还没请求过。 */
    readonly phase: 'idle' | CardSkillUpgradePhase;
    readonly rows: readonly CardSkillRowPresentation[];
}

/** 技能升级请求的结果（不含 `idle`）。 */
export type CardSkillUpgradePhase = Exclude<CardUpgradePhase, 'loading'>;

export interface CardUpgradePresentation {
    readonly data: ICardUpgradeOpenData;
    readonly cardId: string;
    readonly level: number;
    readonly status: ZCUpgradeStatus | null;
    readonly phase: CardUpgradePhase;
}

export interface CardUpgradeView {
    isAlive(): boolean;
    presentUpgrade(data: CardUpgradePresentation): void;
}

/** 一个技能行的可变状态（档位是预览值）。 */
interface SkillRowState {
    readonly skill: ZCArmySkill;
    /** 服务端已确认的档位。 */
    serverLevel: number;
    /** 当前预览档位（「↑」按下后立刻 +1，失败时回退到 `serverLevel`）。 */
    level: number;
}

/**
 * 技能面板状态机（独立弹窗 `CardSkillPage` / `CardSkill.prefab`）。
 *
 * 为什么不塞进 `CardUpgradePresenter`：升级弹窗的纵向空间已被卡面 / 消耗 / 经验 /
 * 提示 / 升级按钮占满，硬塞技能区会与「卡牌」「经验」两行文字重叠（实测截图已确认）。
 * 拆开后两者互不干扰：升级弹窗只管等级与材料，技能面板只管技能档位。
 */
export class CardSkillPresenter {
    private revision = 0;
    private heroId = 0;
    private cardId = '';
    private rows: SkillRowState[] = [];
    private heroLevel = 0;
    private busy = false;
    private phase: 'idle' | CardSkillUpgradePhase = 'idle';
    private loaded = false;

    constructor(private readonly repository: ICardRepository) {}

    /** 打开：拉技能表 + 该英雄技能等级，一次画全。 */
    async open(heroId: number, view: CardSkillView): Promise<void> {
        this.heroId = Math.floor(Number(heroId) || 0);
        this.cardId = String(this.heroId);
        this.rows = [];
        this.heroLevel = 0;
        this.busy = false;
        this.phase = 'idle';
        this.loaded = false;
        this.emit(view);
        await this.refresh(view);
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
    async step(skillId: number, direction: 1 | -1, caller: unknown, view: CardSkillView): Promise<void> {
        console.log(`[CardSkillPresenter] step skill=${skillId} dir=${direction} busy=${this.busy} rows=${this.rows.length} heroLevel=${this.heroLevel}`);
        if (this.busy) return;
        const row = this.rows.find((item) => item.skill.skillId === skillId);
        if (!row) {
            console.warn(`[CardSkillPresenter] 找不到技能 ${skillId} 的行（当前行：${this.rows.map((r) => r.skill.skillId).join(',')}）`);
            return;
        }

        const maxLevel = row.skill.levels.length > 0
            ? row.skill.levels[row.skill.levels.length - 1].level : 0;
        const target = row.level + direction;
        if (target < 1 || target > maxLevel) {
            console.warn(`[CardSkillPresenter] 目标档 ${target} 越界（当前 ${row.level}，满级 ${maxLevel}）`);
            return;
        }

        if (direction < 0) {
            row.level = target;
            this.phase = 'idle';
            this.emit(view);
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
            console.warn(`[CardSkillPresenter] 表里没有 ${skillId} 的第 ${target} 档（表内档位：${row.skill.levels.map((l) => l.level).join(',')}）`);
            return;
        }
        /*
         * **不再在客户端拦「英雄等级不足」**：`CmdPvpHeroInfo.level` 与配表的
         * `unlockarmylevel` 口径对不上（实测日志 hero=1 / 需 14），拦在这里会让技能
         * 永远升不动。门槛由服务端判，失败会以 rsp 的状态返回、由面板提示。
         */

        const previous = row.level;
        row.level = target;
        this.busy = true;
        this.phase = 'idle';
        this.emit(view);

        console.log(`[CardSkillPresenter] 发包 heroId=${this.heroId} skillId=${skillId}`);
        const result = await this.repository.upgradeHeroSkill(this.heroId, skillId, caller);
        console.log('[CardSkillPresenter] 回包', result.kind);
        if (!view.isAlive()) return;

        this.busy = false;
        if (result.kind !== 'success') {
            row.level = previous;
            this.phase = result.kind;
            this.emit(view);
            return;
        }
        row.serverLevel = target;
        await this.refresh(view);
    }

    dispose(): void { this.revision += 1; }

    private async refresh(view: CardSkillView): Promise<void> {
        const revision = ++this.revision;
        const data = await this.repository.loadSkillList(this.heroId);
        if (revision !== this.revision || !view.isAlive()) return;

        const skills = resolveCardSkills(data.table, data.skillIds, this.cardId);
        const previous = new Map(this.rows.map((row) => [row.skill.skillId, row]));
        this.rows = skills.map((skill) => {
            const known = data.levels.some((item) => item.skillId === skill.skillId);
            const kept = previous.get(skill.skillId);
            //  服务端**给了**这个技能的等级才覆盖；没给（响应没带 / 老数据）就保留现有档位，
            //  否则每次刷新都会把「刚升上去的档」按第 1 档兜底冲掉。
            const level = known ? resolveSkillLevel(skill, data.levels) : (kept ? kept.level : resolveSkillLevel(skill, []));
            return { skill, serverLevel: level, level };
        });
        this.heroLevel = data.heroLevel;
        this.loaded = true;
        this.emit(view);
    }

    private presentation(): CardSkillListPresentation | null {
        if (!this.loaded) return null;
        return {
            heroId: this.heroId,
            heroLevel: this.heroLevel,
            busy: this.busy,
            phase: this.phase,
            rows: this.rows.map((row) => {
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

    private emit(view: CardSkillView): void {
        if (!view.isAlive()) return;
        view.presentSkills(this.presentation());
    }
}

/** 技能面板视图契约。 */
export interface CardSkillView {
    isAlive(): boolean;
    presentSkills(data: CardSkillListPresentation | null): void;
}

/** 升级弹窗状态机；网络与表读取都经 Repository，View 只负责把状态铺到节点。 */
export class CardUpgradePresenter {
    private revision = 0;
    private data: ICardUpgradeOpenData | null = null;
    private cardId = '';
    private level = 0;
    private status: ZCUpgradeStatus | null = null;
    private phase: CardUpgradePhase = 'loading';

    constructor(private readonly repository: ICardRepository) {}

    async open(data: ICardUpgradeOpenData, view: CardUpgradeView): Promise<void> {
        this.data = data;
        this.cardId = String(data.cardId);
        this.level = Math.max(0, Math.floor(Number(data.level) || 0));
        this.status = null;
        this.phase = 'loading';
        this.emit(view);
        await this.refresh(view);
    }

    async submit(caller: unknown, view: CardUpgradeView): Promise<void> {
        if (!this.data || this.phase === 'submitting' || !this.status?.canUpgrade) return;
        this.phase = 'submitting';
        this.emit(view);
        const result = await this.repository.upgradeHero(Number(this.cardId), caller);
        if (!view.isAlive()) return;
        if (result.kind === 'offline' || result.kind === 'failed') {
            this.phase = result.kind;
            this.emit(view);
            return;
        }
        this.level = result.level;
        this.repository.applyHeroLevel(result.heroId, result.level);
        this.data.onUpgraded?.(result.heroId, result.level);
        await this.refresh(view);
    }

    dispose(): void {
        this.revision += 1;
    }

    private async refresh(view: CardUpgradeView): Promise<void> {
        if (!this.data) return;
        const revision = ++this.revision;
        const status = await this.repository.loadUpgradeStatus(this.cardId, this.level);
        if (revision !== this.revision || !view.isAlive()) return;
        this.status = status;
        this.phase = 'ready';
        this.emit(view);
    }

    private emit(view: CardUpgradeView): void {
        if (!this.data || !view.isAlive()) return;
        view.presentUpgrade({
            data: this.data,
            cardId: this.cardId,
            level: this.level,
            status: this.status,
            phase: this.phase,
        });
    }
}
