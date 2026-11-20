import { ControllerBase } from '../../../framework/controller/ControllerBase';
import type { IControllerContext } from '../../../framework/controller/ControllerBase';
import { reportGuideComplete } from '../../guide/application/GuideEvents';
import { GameNet } from '../../net/GameNet';
import { EventMgr } from '../../../framework/event/EventMgr';
import type { ResourceScope } from '../../../core/asset/ResourceScope';
import type {
    ITerritoryNavigateBattlePayload,
    TerritoryModel,
    TerritoryModelOutput,
} from './TerritoryModel';
import type { TerritoryCellRepository } from './TerritoryCellRepository';
import { TerritoryUiEvent, TerritoryViewEvent, type ITerritoryIntentEvent,
    type TerritoryViewCommand } from './TerritoryEvents';
import { buildTerritoryViewState, isTerritoryChestActionable } from './TerritoryViewState';
import { TERRITORY_TEXTS } from './TerritoryTexts';
import { isTerritoryBattleSite, type TerritorySite } from '../model/TerritoryMapConfig';

export interface ITerritoryControllerOptions {
    readonly context: IControllerContext;
    readonly roleCache: { subscribe(caller: object, callback: () => void): () => void };
    readonly cells: TerritoryCellRepository;
    readonly schedule: (callback: () => void, seconds: number) => () => void;
    readonly now?: () => number;
    readonly battle?: {
        prepare(payload: ITerritoryNavigateBattlePayload, owner: ResourceScope): Promise<unknown> | undefined;
        enter(payload: ITerritoryNavigateBattlePayload): void;
    };
}

/** Owns all business inputs and clocks. Views only send intents. */
export class TerritoryController extends ControllerBase {
    private ticking = false;
    private stopOutput: (() => void) | null = null;

    /** Model 由 `TerritoryEntry` 装配好传进来；Controller 只消费，不再参与构造。 */
    constructor(private readonly model: TerritoryModel, private readonly options: ITerritoryControllerOptions) {
        super(options.context, 'territory-controller');
    }

    start(): void {
        this.stopOutput = this.model.onOutput((output) => this.onOutput(output));
        this.bindNetworkEvents();
        this.own(() => GameNet.instance.removeCaller(this));
        this.own(this.options.roleCache.subscribe(this, () => {
            this.model.refreshWalletFromServer();
        }));
        this.bindUiEvents();
        this.model.start();
    }

    private bindNetworkEvents(): void {
        GameNet.instance.addEvent('CmdCityChapterPassCellBroMsg', this, this.onPassCellsBro);
        GameNet.instance.addEvent('CmdCityChapterCellInfoRspMsg', this, this.onCellInfo);
        // 写请求只发不等：回包全部走事件通道，解成结构化结果后回灌 Model。
        GameNet.instance.addEvent('CmdCityChapterUnlockCellRspMsg', this, this.onUnlockRsp);
        GameNet.instance.addEvent('CmdCityChapterPassCellRspMsg', this, this.onPassRsp);
        GameNet.instance.addEvent('CmdCityChapterSweepRspMsg', this, this.onSweepRsp);
        GameNet.instance.addEvent('CmdCityChapterIdleRewardRspMsg', this, this.onIdleRewardRsp);
        GameNet.instance.addEvent('CmdCityChapterUpMonsterBoxLvRspMsg', this, this.onMonsterBoxRsp);
    }
    private onUnlockRsp(message: unknown): void {
        this.model.applyUnlockRsp(this.options.cells.readUnlockRsp(message));
    }
    private onPassRsp(message: unknown): void {
        this.model.applyPassRsp(this.options.cells.readPassRsp(message));
    }
    private onSweepRsp(message: unknown): void {
        this.model.applySweepRsp(this.options.cells.readSweepRsp(message));
    }
    private onIdleRewardRsp(message: unknown): void {
        this.model.applyIdleRewardRsp(this.options.cells.readIdleRewardRsp(message));
    }
    private onMonsterBoxRsp(message: unknown): void {
        this.model.applyMonsterBoxRsp(this.options.cells.readMonsterBoxRsp(message));
    }
    private onPassCellsBro(message: unknown): void {
        const bro = this.options.cells.readPassCellsBro(message);
        if (bro) this.model.applyPassCellsBro(bro.levelChapter, bro.cellIds);
    }
    private onCellInfo(message: unknown): void {
        const state = this.options.cells.readCellInfo(message);
        if (state) this.model.applyCellInfoState(state);
    }
    private bindUiEvents(): void {
        this.listen(TerritoryUiEvent.Intent, this.onIntent);
        this.listen(TerritoryUiEvent.Ready, this.onReady);
        this.listen(TerritoryUiEvent.Disposed, this.onDisposed);
    }
    private onReady(): void {
        this.publish();
    }
    private onDisposed(): void {
        this.dispose();
    }
    private onIntent(event: ITerritoryIntentEvent): void {
        const intent = event.intent;
        switch (intent.kind) {
            case 'siteTap': {
                let site: TerritorySite | null = null;
                const sites = this.model.state.map?.sites;
                if (sites) {
                    for (let i = 0; i < sites.length; i++) {
                        if (sites[i].cellId === intent.cellId) {
                            site = sites[i];
                            break;
                        }
                    }
                }
                // 新手引导：关卡点击完成 siteTap；宝箱据点两步（翻出/点开）均完成 tileFlipped。
                // 必须在操作切实受理后上报，防止未响应时误推引导进度。
                const canFlip = isTerritoryChestActionable(this.model.state, intent.cellId);
                if (site && this.model.selectSite(site)) {
                    if (canFlip) reportGuideComplete('tileFlipped');
                    else if (isTerritoryBattleSite(site)) reportGuideComplete('siteTap');
                }
                break;
            }
            case 'randomTap': {
                // 新手引导：随机资源点开始翻开时上报 tileFlipped。
                if (this.model.selectRandomResource(intent.cellId)) reportGuideComplete('tileFlipped');
                break;
            }
            case 'claimIdleRewards': void this.model.claimIdleRewards(this.options.now?.() ?? Date.now()); break;
            case 'sweepChapter': void this.model.sweepIdleRewards(intent.times); break;
            // 升级怪物宝箱：消耗与成功判定全在服务端（`CmdCityChapterUpMonsterBoxLvReqMsg`）。
            case 'upgradeMonsterBox': void this.model.upgradeMonsterBox(intent.cellId); break;
            case 'chapter': this.model.switchChapter(intent.offset); break;
            case 'selectChapter': this.model.selectChapter(intent.chapterId); break;
            case 'enterBattle': {
                if (!this.options.battle) throw new Error('领地战斗入口尚未装配');
                this.options.battle.enter(intent.payload);
                break;
            }
            case 'battle':
                this.command({ kind: 'prepareBattle' });
                this.model.requestBattle();
                // 新手引导 5-2「进入战斗」：开战请求发出即上报。精确到「战斗场景加载完成」
                // 需要 Procedure* 侧配合，这里先用请求时机（与 5-1 的点击相隔一屏，不会连点穿过）。
                reportGuideComplete('battleStarted');
                break;
            case 'closeDetail': this.model.closeDetail(); break;
            case 'keepBattleRequest': this.model.keepBattleRequest(); break;
            case 'cancelBattleStart': this.model.cancelBattleStart(); break;
            case 'openLevelTip': this.model.openLevelTip(); break;
            case 'closeLevelTip': this.model.closeLevelTip(); break;
            case 'scout': this.command({ kind: 'tip', payload: { text: TERRITORY_TEXTS.asyncPlayerScoutUnavailable } }); break;
            case 'focusLevel': {
                const cellId = this.model.focusCurrentLevel();
                if (cellId !== null) this.command({ kind: 'focusCell', cellId });
                break;
            }
        }
    }
    private onOutput(output: TerritoryModelOutput): void {
        if (output.kind === 'navigate') {
            const ready = this.options.battle?.prepare(output.payload, this.scope);
            this.command({ ...output, ready });
        } else if (output.kind === 'changed') this.publish();
        else this.command(output);
    }
    private publish(): void {
        const state = this.model.state;
        if (state.ready && !this.ticking) {
            this.ticking = true;
            this.own(this.options.schedule(() => this.tick(false), 1));
            this.own(this.options.schedule(() => this.tick(true), 60));
        }
        EventMgr.instance.emit(TerritoryViewEvent.Render, { state: buildTerritoryViewState(state) });
    }
    private tick(slow: boolean): void {
        const now = this.options.now?.() ?? Date.now();
        if (slow) this.model.slowTick(now);
        else this.model.fastTick(now);
    }
    private command(command: TerritoryViewCommand): void {
        EventMgr.instance.emit(TerritoryViewEvent.Command, { command });
    }
    dispose(): void {
        if (this.isDisposed) return;
        this.releaseInputs();
        this.model.dispose();
        this.stopOutput?.();
        this.stopOutput = null;
        super.dispose();
    }
}
