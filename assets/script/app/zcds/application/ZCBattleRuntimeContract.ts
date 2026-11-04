import type { Prefab, SpriteFrame } from 'cc';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ZCGameModel } from '../model/ZCGameModel';
import type { ZCGameRenderFrame, ZCBattlePresentationEvents } from '../model/ZCGameRenderFrame';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCSpawnSelection } from '../model/ZCSpawnSelection';
import type { IZCGameEntry } from './ZCGameEntry';
import type { ZCGuidePreparedContent } from './ZCGuideLoader';
import type { buildRankSeats, RankSeatProfiles } from '../model/ZCRankBoard';
import type { IZCBattlePopup } from './ZCBattleSettlementController';

/** 展示适配器持有的单局资源表；视图只读，补载结果原位合并。 */
export interface IZCBattlePresentationArt {
    readonly unitVisualPrefabs: ReadonlyMap<string, Prefab>;
    readonly cardArtFrames: ReadonlyMap<string, SpriteFrame>;
    readonly legendRoleArtFrames: ReadonlyMap<string, SpriteFrame>;
    readonly buildingFramesByCardId: ReadonlyMap<string, SpriteFrame>;
    readonly buildingFrames: ReadonlyMap<string, SpriteFrame>;
    readonly legendPortraitFrames: ReadonlyMap<string, SpriteFrame>;
}

/** 只暴露渲染会读取的模型查询，禁止组件通过展示引用推进规则。 */
export type IZCBattleRenderModel = Pick<ZCGameModel, 'snapshot' | 'mapConfig' | 'owners' | 'defenceWaveProgress' | 'remainingSeconds' | 'territoryCountOf' | 'artifactChargeFull' | 'artifactCooldownDuration' | 'artifactMaxStored' | 'unitCap'>;
export interface IZCBattleView {
    readonly dragMoved: boolean;
    applyUnitPrefab(unitId: string, prefab: Prefab): void;
    /**
     * 按需补载到货的**技能特效** prefab 回填（路径 = `effectVisualPrefabs` 的 key）。
     *
     * 与 `applyUnitPrefab` 成对：本局美术清单按后端英雄名单过滤，名单外的兵（兵营产兵 / 波次 /
     * GM 加兵）模型与特效都会缺，模型有 `RequestUnitArt` 补，特效此前没有 ⇒ 子弹永久不出现。
     */
    applyEffectPrefab(path: string, prefab: Prefab): void;
    initialize(entry: IZCGameEntry, resources: IControllerResources, model: IZCBattleRenderModel | null, selection: ZCSpawnSelection | null): void;
    startPlaying(model: IZCBattleRenderModel, config: ZCMatchConfig, selection: ZCSpawnSelection, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void;
    renderBattle(model: IZCBattleRenderModel, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents, mode: 'all' | 'dynamic' | 'static'): void;
    renderSpawnSelection(selection: ZCSpawnSelection, hints: boolean): void;
    advanceSettlementPresentation(frame: ZCGameRenderFrame, dt: number): boolean;
    flashSpawn(message: string): void;
    flashInsufficientGold(): void;
    resetCamera(): void;
}
/** 服务只提供外部能力，流程状态与释放句柄仍由运行期持有。 */
export interface IZCBattleRuntimeServices {
    readonly art: {
        loadUnitPrefab(path: string): Promise<Prefab | null>;
        /** 同 `loadUnitPrefab`，只是语义上给技能特效用（bundle 路由一样走 `bundleForPath`）。 */
        loadEffectPrefab(path: string): Promise<Prefab | null>;
    };
    readonly popups: {
        openGuide(content: ZCGuidePreparedContent): Promise<IZCBattlePopup | null>;
        openDamage(summary: { mine: { name: string; damage: number; damageTaken: number }; enemy: { name: string; damage: number; damageTaken: number } }): Promise<IZCBattlePopup | null>;
        openRank(seats: ReturnType<typeof buildRankSeats>, profiles: RankSeatProfiles): Promise<IZCBattlePopup | null>;
    };
    readonly clock: {
        schedule(callback: () => void, seconds: number): () => void;
    };
    failed(error: unknown): void;
}
