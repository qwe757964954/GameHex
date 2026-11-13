import type { SpriteFrame } from 'cc';
import type { ZCDeckCard } from '../zcds/model/ZCCombatCatalog';
import type {
    LineupBoardData
} from './CardRepository';
import type { ZCArmySkill } from './CardSkillList';
import type { ZCUpgradeStatus } from './CardUpgradeCost';
import type { LineupDraftSnapshot } from './LineupDraftStore';
import type { CardDetailPresentation } from './CardDetailPresenter';
import type { ICardDetailArt } from './CardArtProvider';
import type { ICardLineupCatalog } from './CardArtConfig';


export interface LineupBoardPresentation extends LineupBoardData, LineupDraftSnapshot {
    readonly saving: boolean;
    readonly canSave: boolean;
    readonly saveText: string;
}


/**
 * 从卡牌页打开升级弹窗时带的业务数据。
 *
 * 不带回调：升级成功走 `CardLineupEvent.HeroUpgraded` 事件（见 `CardLineupEvents`），
 * 弹窗只负责「我升成功了」，不关心外面谁想听。
 */
export interface ICardUpgradeOpenData {
    readonly card: ZCDeckCard | null;
    readonly cardId: string;
    readonly level: number;
}

/** 单技能面板的身份；展示与升级条件从配置和服务端缓存读取。 */
export interface ICardSkillOpenData {
    readonly heroId: number;
    readonly skillId: number;
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
    /** 是否正在发技能升级请求。 */
    readonly busy: boolean;
    /** 最近一次的请求结果；`undefined` = 还没请求过。 */
    readonly phase: 'idle' | CardSkillUpgradePhase;
    readonly rows: readonly CardSkillRowPresentation[];
    readonly skillKind?: string;
    readonly cooldown?: number;
    readonly costs?: readonly ICardSkillCost[];
    readonly canUpgrade?: boolean;
}

export interface ICardSkillCost {
    readonly itemId: number;
    readonly name: string;
    readonly need: number;
    readonly owned: number;
    readonly frame: SpriteFrame | null;
}

/** 技能升级请求的结果（不含 `idle`）。 */
export type CardSkillUpgradePhase = Exclude<CardUpgradePhase, 'loading'>;

export interface CardUpgradePresentation {
    readonly data: ICardUpgradeOpenData;
    readonly cardId: string;
    readonly level: number;
    readonly status: ZCUpgradeStatus | null;
    readonly phase: CardUpgradePhase;
    /**
     * 详情页展示数据（六维 / 技能链 / 里程碑）。
     * `null` = 还没加载到或加载失败（详情区保持占位，不影响升级面板）。
     */
    readonly detail: CardDetailPresentation | null;
}

export interface ICardUpgradeViewState extends CardUpgradePresentation {
    readonly art: ICardDetailArt | null;
    /** 维度名称与 traits 归一化（表 `name` 列）；未加载到时为 null，标签区保持空。 */
    readonly lineup: ICardLineupCatalog | null;
}



