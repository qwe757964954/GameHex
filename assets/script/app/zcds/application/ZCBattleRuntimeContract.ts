import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ZCGameModel } from '../model/ZCGameModel';
import type { ZCGameRenderFrame, ZCBattlePresentationEvents } from '../model/ZCGameRenderFrame';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCSpawnSelection } from '../model/ZCSpawnSelection';
import type { IZCGameEntry } from './ZCGameEntry';
import type { ZCGuidePreparedContent } from './ZCGuideLoader';
import type { buildRankSeats, RankSeatProfiles } from '../model/ZCRankBoard';
import type { IZCBattlePopup } from './ZCBattleSettlementController';

/** 只暴露渲染会读取的模型查询，禁止组件通过展示引用推进规则。 */
export type IZCBattleRenderModel = Pick<ZCGameModel, 'snapshot' | 'mapConfig' | 'owners' | 'defenceWaveProgress' | 'remainingSeconds' | 'territoryCountOf' | 'artifactChargeFull' | 'artifactCooldownDuration' | 'artifactMaxStored' | 'unitCap'>;
export interface IZCBattleView {
    readonly dragMoved: boolean;
    initialize(entry: IZCGameEntry, resources: IControllerResources, model: IZCBattleRenderModel | null, selection: ZCSpawnSelection | null): void;
    startPlaying(model: IZCBattleRenderModel, config: ZCMatchConfig, selection: ZCSpawnSelection, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void;
    renderBattle(model: IZCBattleRenderModel, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents, mode: 'all' | 'dynamic' | 'static'): void;
    renderSpawnSelection(selection: ZCSpawnSelection, hints: boolean): void;
    advanceSettlementPresentation(frame: ZCGameRenderFrame, dt: number): boolean;
    flashSpawn(message: string): void;
    flashInsufficientGold(): void;
    resetCamera(): void;
}
export interface IZCBattleAuxiliaryPorts {
    readonly openGuide: (content: ZCGuidePreparedContent) => Promise<IZCBattlePopup | null>;
    readonly openDamage: (summary: { mine: { name: string; damage: number; damageTaken: number }; enemy: { name: string; damage: number; damageTaken: number } }) => Promise<IZCBattlePopup | null>;
    readonly openRank: (seats: ReturnType<typeof buildRankSeats>, profiles: RankSeatProfiles) => Promise<IZCBattlePopup | null>;
    readonly schedule: (callback: () => void, seconds: number) => () => void;
    readonly failed: (error: unknown) => void;
}
