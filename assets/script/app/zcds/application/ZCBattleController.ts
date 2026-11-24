import { ZCDC_LOG_WARNINGS } from '../ZCDCLogSwitch';
import { ControllerBase, type IControllerContext, type IControllerResources } from '../../../framework/controller/ControllerBase';
import type { ProcedurePreloadContext } from '../../../framework/procedure/ProcedureBase';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type { IZCGamePreparedResources } from './ZCGamePreparedResources';
import type { IZCGameEntry } from './ZCGameEntry';
import type { ZCGameEntryParams } from './ZCGameEntry';
import { buildZCBattleEntry } from './ZCBattleEntryBuilder';
import { ZC_BATTLE_EVENTS, type IZCBattleResult } from './ZCBattleEvents';

export const ZCBattlePhase = {
    Idle: 'idle',
    SpawnSelection: 'spawn-selection',
    Playing: 'playing',
    SettlementPresentation: 'settlement-presentation',
    Settlement: 'settlement',
    Leaving: 'leaving',
} as const;
export type ZCBattlePhase = (typeof ZCBattlePhase)[keyof typeof ZCBattlePhase];

export type IZCBattlePhase = Pick<ZCBattleController<IZCBattleRuntime>,
    'currentPhase' | 'isPlaying' | 'isLeaving' | 'isSettled' | 'startSpawnSelection' |
    'startPlaying' | 'beginSettlementPresentation' | 'openSettlement' | 'leave'>;

export interface IZCBattleRuntime {
    shutdown(): void;
    destroy(): void;
}

/** 资源准备服务契约：明确携带真实 caller 宿主 */
export interface IZCBattleResourceLoader {
    prepare(scope: ResourceScope, params: ZCGameEntryParams | undefined, resources: IControllerResources, caller: object): Promise<IZCGamePreparedResources>;
}

/** PVE 结果裁决服务契约：明确携带真实 caller 宿主 */
export interface IZCBattlePveResolver {
    resolvePveResult(pve: NonNullable<ZCGameEntryParams['pve']>, victory: boolean, caller: object): void;
}

/** 组合层注入给单局会话的标准服务契约；buildEntry 缺省使用领域纯函数 buildZCBattleEntry。*/
export interface IZCBattleControllerServices {
    readonly loader: IZCBattleResourceLoader;
    readonly pveResolver?: IZCBattlePveResolver;
    readonly buildEntry?: (prepared: IZCGamePreparedResources, params?: ZCGameEntryParams) => IZCGameEntry;
}

/** 兼容旧版选项接口（便于轻量桩与过渡平滑演进） */
export interface IZCBattleControllerOptions {
    readonly prepareDirect: (scope: ResourceScope, params: ZCGameEntryParams | undefined, resources: IControllerResources, caller?: object) => Promise<IZCGamePreparedResources>;
    readonly resolvePveResult?: (pve: ZCGameEntryParams['pve'], victory: boolean, caller?: object) => void;
    readonly buildEntry?: (prepared: IZCGamePreparedResources, params?: ZCGameEntryParams) => IZCGameEntry;
}

function normalizeBattleServices(input: IZCBattleControllerServices | IZCBattleControllerOptions): IZCBattleControllerServices {
    if ('loader' in input) return input;
    return {
        loader: {
            prepare(scope, params, resources, caller) {
                return input.prepareDirect(scope, params, resources, caller);
            },
        },
        pveResolver: input.resolvePveResult ? {
            resolvePveResult(pve, victory, caller) {
                input.resolvePveResult!(pve, victory, caller);
            },
        } : undefined,
        buildEntry: input.buildEntry,
    };
}

export interface IZCBattleSessionInput {
    readonly owner: ResourceScope;
    readonly params?: ZCGameEntryParams;
    readonly battle?: Promise<ZCBattleStart | null>;
}
/** 组合层返回的运行期归属句柄；会话先持有，再启动，最后统一释放。*/
export interface IZCBattleRuntimeController {
    start(entry: IZCGameEntry, resources: IControllerResources): void;
    dispose(): void;
}
export interface IZCBattleRuntimeOptions<T extends IZCBattleRuntime> {
    readonly createRuntime: () => T;
    readonly createRuntimeController: (runtime: T, entry: IZCGameEntry, resources: IControllerResources) => IZCBattleRuntimeController;
}

/** 单局会话拥有对局阶段、运行期与显示资源；流程取消、初始化失败和正常离开走同一收尾路径。*/
export class ZCBattleController<T extends IZCBattleRuntime> extends ControllerBase {
    private phase: ZCBattlePhase = ZCBattlePhase.Idle;
    private runtime: T | null = null;
    private prepared: IZCGamePreparedResources | null = null;
    private params: ZCGameEntryParams | undefined;
    private resultRecorded = false;
    readonly ready: Promise<IZCGamePreparedResources>;
    private detachOwner: (() => void) | null = null;
    private adopted = false;
    private runtimeController: IZCBattleRuntimeController | null = null;
    private readonly services: IZCBattleControllerServices;
    get current(): T | null { return this.runtime; }
    constructor(context: IControllerContext, servicesOrOptions: IZCBattleControllerServices | IZCBattleControllerOptions, input: IZCBattleSessionInput) {
        super(context, 'battle-session');
        this.services = normalizeBattleServices(servicesOrOptions);
        this.listen(ZC_BATTLE_EVENTS.PVE_RESULT, this.onPveResult);
        this.listen(ZC_BATTLE_EVENTS.RUNTIME_DESTROYED, this.onRuntimeDestroyed);
        this.params = input.params;
        this.detachOwner = input.owner.defer(() => this.dispose());
        this.ready = this.prepareResources(input.battle);
        // 后台失败立即收尾，同时让接管方仍可等待原始错误。
        void this.ready.catch(() => {});
    }
    get currentPhase(): ZCBattlePhase {
        return this.phase;
    }

    get isPlaying(): boolean {
        return this.phase === ZCBattlePhase.Playing;
    }

    get isLeaving(): boolean {
        return this.phase === ZCBattlePhase.Leaving;
    }

    get isSettled(): boolean {
        return this.phase === ZCBattlePhase.Settlement || this.phase === ZCBattlePhase.Leaving;
    }

    startSpawnSelection(): boolean {
        return this.transition(ZCBattlePhase.Idle, ZCBattlePhase.SpawnSelection);
    }

    startPlaying(): boolean {
        if (this.phase === ZCBattlePhase.SpawnSelection) {
            return this.transition(ZCBattlePhase.SpawnSelection, ZCBattlePhase.Playing);
        }
        return this.transition(ZCBattlePhase.Idle, ZCBattlePhase.Playing);
    }

    beginSettlementPresentation(): boolean {
        return this.transition(ZCBattlePhase.Playing, ZCBattlePhase.SettlementPresentation);
    }

    /** 撤退可从 playing 直接进入结算；正常终局从演出阶段进入。*/
    openSettlement(): boolean {
        if (this.phase === ZCBattlePhase.Playing) {
            return this.transition(ZCBattlePhase.Playing, ZCBattlePhase.Settlement);
        }
        return this.transition(ZCBattlePhase.SettlementPresentation, ZCBattlePhase.Settlement);
    }

    leave(): boolean {
        if (this.phase === ZCBattlePhase.Leaving) return false;
        this.phase = ZCBattlePhase.Leaving;
        return true;
    }

    private transition(from: ZCBattlePhase, to: ZCBattlePhase): boolean {
        if (this.phase !== from) return false;
        this.phase = to;
        return true;
    }

    private async prepareResources(battle?: Promise<ZCBattleStart | null>): Promise<IZCGamePreparedResources> {
        try {
            if (battle) {
                const result = await battle;
                this.params = Object.assign({}, this.params, { battle: result });
            }
            if (this.isDisposed) throw new Error('对局准备已取消');
            const prepared = await this.services.loader.prepare(this.scope, this.params, this.resources, this);
            if (this.isDisposed) throw new Error('对局准备已取消');
            this.prepared = prepared;
            return prepared;
        } catch (error) { this.dispose(); throw error; }
    }
    async adopt(params: ZCGameEntryParams | undefined, context: ProcedurePreloadContext): Promise<void> {
        if (this.adopted) throw new Error('对局会话不可重复接管');
        if (context.cancelled || context.resources.disposed) { this.dispose(); return; }
        if (this.isDisposed) {
            // 已失败的准备保留原始错误，不退化成重复加载。
            await this.ready;
            throw new Error('对局准备已取消');
        }
        this.adopted = true;
        if (this.detachOwner) {
            this.detachOwner();
            this.detachOwner = null;
        }
        this.detachOwner = context.resources.defer(() => this.dispose());
        const entryParams = Object.assign({}, params);
        delete entryParams.session;
        this.params = Object.assign({}, this.params, entryParams);
        try {
            await this.ready;
        } catch (error) {
            if (context.cancelled || context.resources.disposed) return;
            throw error;
        }
    }
    mount(options: IZCBattleRuntimeOptions<T>): void {
        if (this.runtime) return;
        if (this.isDisposed || !this.prepared) throw new Error('对局资源尚未准备完成，无法初始化 ZCGame');
        try {
            const buildEntry = this.services.buildEntry ?? buildZCBattleEntry;
            const entry = buildEntry(this.prepared, this.params);
            const runtime = options.createRuntime();
            this.runtime = runtime;
            const controller = options.createRuntimeController(runtime, entry, this.resources);
            this.runtimeController = controller;
            controller.start(entry, this.resources);
            this.prepared = null;
        } catch (error) {
            try { this.dispose(); }
            catch (cleanupError) { if (ZCDC_LOG_WARNINGS) console.error('[ZCBattleController] 初始化失败后的清理失败', cleanupError); }
            throw error;
        }
    }
    private onPveResult({ victory }: IZCBattleResult, source: object): void {
        const pve = this.params ? this.params.pve : undefined;
        if (source !== this.runtime || !pve || this.resultRecorded) return;
        this.resultRecorded = true;
        this.services.pveResolver?.resolvePveResult(pve, victory, this);
    }
    private onRuntimeDestroyed(_payload: undefined, source: object): void {
        if (source === this.runtime) this.dispose();
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.leave();
        this.releaseInputs();
        if (this.detachOwner) {
            this.detachOwner();
            this.detachOwner = null;
        }
        const runtime = this.runtime;
        this.runtime = null;
        this.prepared = null;
        this.params = undefined;
        const controller = this.runtimeController;
        this.runtimeController = null;
        try {
            if (controller) controller.dispose();
        } finally {
            try {
                if (runtime) runtime.shutdown();
            } finally {
                try {
                    if (runtime) runtime.destroy();
                } finally {
                    super.dispose();
                }
            }
        }
    }
}
