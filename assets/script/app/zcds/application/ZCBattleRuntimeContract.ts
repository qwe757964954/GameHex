import type { Prefab, SpriteFrame } from 'cc';
import type { IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ZCGameModel } from '../model/ZCGameModel';
import type { ZCGameRenderFrame, ZCBattlePresentationEvents } from '../model/ZCGameRenderFrame';
import type { ZCMatchConfig } from '../model/ZCMatchConfig';
import type { ZCSpawnSelection } from '../model/ZCSpawnSelection';
import type { IZCGameEntry } from './ZCGameEntry';
import type { IZCBarracksInfoPresentation } from '../model/ZCBarracksInfo';

export type { IZCDamageStatsSeats, IZCDamageStatsUnit } from '../model/ZCDamageStats';

/**
 * 确认框入参。文案由调用方（控制器）给，弹窗层不写业务句子 ——
 * 同一句话在「投降」「撤退」两处若是各写一份，改文案必漏一处。
*/
export interface IZCBattleConfirmOptions {
    readonly content: string;
    readonly title?: string;
    readonly sureText?: string;
    readonly cancelText?: string;
}

/** 阻塞式确认弹窗端口；底层 Popup 实例与开关竞态留在组合层。*/
export interface IZCBattleDialogPort {
    confirm(options: IZCBattleConfirmOptions): Promise<boolean>;
    cancel(): void;
}

/** 展示适配器持有的单局资源表；视图只读，补载结果原位合并。*/
export interface IZCBattlePresentationArt {
    readonly unitVisualPrefabs: ReadonlyMap<string, Prefab>;
    readonly cardArtFrames: ReadonlyMap<string, SpriteFrame>;
    readonly legendRoleArtFrames: ReadonlyMap<string, SpriteFrame>;
    readonly buildingFramesByCardId: ReadonlyMap<string, SpriteFrame>;
    readonly buildingFrames: ReadonlyMap<string, SpriteFrame>;
    readonly legendPortraitFrames: ReadonlyMap<string, SpriteFrame>;
    /**
     * 大招通报预制体（`units/effects/大招技能提示特效/大招技能提示特效`）。
     *
     * 给的是读函数而不是值：`presentationArt` 在 `createGame` 里一次性快照，而该预制体是
     * 异步加载的，避免固化初始 `null`。
     */
    readonly skillAnnouncePrefab?: () => Prefab | null;
}

/** 只暴露渲染会读取的模型查询，禁止组件通过展示引用推进规则。*/
export type IZCBattleRenderModel = Pick<ZCGameModel, 'snapshot' | 'mapConfig' | 'owners' | 'defenceWaveProgress' | 'remainingSeconds' | 'territoryCountOf' | 'artifactChargeFull' | 'artifactCooldownDuration' | 'artifactMaxStored' | 'unitCap'>;
export interface IZCBattleView {
    readonly dragMoved: boolean;
    applyUnitPrefab(unitId: string, prefab: Prefab): void;
    /**
     * 按需补载到货的技能特效 prefab 回填（路径 = `effectVisualPrefabs` 的 key）。
     *
     * 与 `applyUnitPrefab` 成对：本局美术清单按后端英雄名单过滤，名单外的兵（兵营产兵 / 波次 /
     * GM 加兵）模型与特效都会缺，模型有 `RequestUnitArt` 补，特效此前没有 ⇒ 子弹永久不出现。
    */
    applyEffectPrefab(path: string, prefab: Prefab): void;
    initialize(entry: IZCGameEntry, resources: IControllerResources, model: IZCBattleRenderModel | null, selection: ZCSpawnSelection | null): void;
    startPlaying(model: IZCBattleRenderModel, config: ZCMatchConfig, selection: ZCSpawnSelection, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents): void;
    renderBattle(model: IZCBattleRenderModel, frame: ZCGameRenderFrame, events: ZCBattlePresentationEvents, mode: 'all' | 'dynamic' | 'static'): void;
    renderSpawnSelection(selection: ZCSpawnSelection, hints: boolean): void;
    /**
     * 推进结算演出，`true` = 还在演（调用方先别弹结算）。
     *
     * 模型入参只用于**起手那一帧**把最终血量刷进塔防首领条（并演完这次扣血），
     * 之后结算期不再回读模型 —— 与「结算后模型不再推进」的既有口径一致。
    */
    advanceSettlementPresentation(model: IZCBattleRenderModel, frame: ZCGameRenderFrame, dt: number): boolean;
    flashSpawn(message: string): void;
    flashInsufficientGold(): void;
    resetCamera(): void;
    /** 点击兵营：在战斗 HUD 左上角展开兵营信息（数据由模型层装配）。*/
    showBarracksInfo(info: IZCBarracksInfoPresentation): void;
    /** 点击非兵营格 / 退出时收起兵营信息。*/
    hideBarracksInfo(): void;
}
/** 服务只提供外部能力，流程状态与释放句柄仍由运行期持有。*/
export interface IZCBattleRuntimeServices {
    readonly audio?: {
        readonly playSound: (key: string) => void;
    };
    readonly art: {
        loadUnitPrefab(path: string): Promise<Prefab | null>;
        /** 同 `loadUnitPrefab`，只是语义上给技能特效用（bundle 路由一样走 `bundleForPath`）。*/
        loadEffectPrefab(path: string): Promise<Prefab | null>;
    };
    readonly dialogs: IZCBattleDialogPort;
    readonly clock: {
        schedule(callback: () => void, seconds: number): () => void;
    };
    /**
     * 屏幕中央飘字（吐司）出口，真实实现是 `common/Toast.show`。
     *
     * 🔴 之所以是注入而不是本层直接 import：`Toast` 顶层 `import 'cc'`，
     * 而 application 层的**运行期**依赖图必须保持 cc-free —— `tests/helpers/battle-runtime.ts`
     * 直接 import `ZCBattleRuntimeController`，一旦这条链上出现 `cc` 就整份用例加载失败。
     * 装配点在 `BattleComposition.createRuntimeServices`；不注入就静默丢弃，
     * 与 `FW.showTip` 的"注入前丢掉"同口径。
     */
    readonly toast?: (message: string) => void;
    failed(error: unknown): void;
}
