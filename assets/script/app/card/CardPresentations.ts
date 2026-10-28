import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type {
    LineupBoardData
} from './CardRepository';
import type { ZCArmySkill } from './CardSkillList';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import { LineupDraftStore } from './LineupDraftStore';


export interface LineupBoardPresentation extends LineupBoardData {
    readonly draft: LineupDraftStore;
}


/**
 * 从卡牌页打开升级弹窗时带的业务数据。
 *
 * **不带回调**：升级成功走 `CardLineupEvent.HeroUpgraded` 事件（见 `CardLineupEvents`），
 * 弹窗只负责「我升成功了」，不关心外面谁想听。
 */
export interface ICardUpgradeOpenData {
    readonly card: ZCDeckCard | null;
    readonly cardId: string;
    readonly level: number;
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



