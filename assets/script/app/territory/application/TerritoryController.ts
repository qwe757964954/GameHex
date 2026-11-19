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
import { isTerritoryBattleSite } from '../model/TerritoryMapConfig';

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
                const site = this.model.state.map?.sites.find((site) => site.cellId === intent.cellId);
                // 新手引导 5-1「攻打第一关」的判据：设计案要「进入关卡列表」，但主界面的关卡列表
                // 入口还不存在；改为「点地图上的关卡格」（地图上那个 1-1 红标）⇒ 一样能进战斗。
                // 只在上报**真的受理**时报（`selectSite` 返回 false 的三种情况：在途 / 未 reveal /
                // 防连点）。无条件上报会让玩家点一个"点不动的格子"也把引导推过去。
                // 5-1 的 maskType 是 `full`（用户 2026-11-17 第 21 条：全屏遮罩 + 高亮地块与气泡），
                // 但这不会吃掉这一下：`GuideDialogView.needsFullScreenBlock()` 只对 `completeCond === 'click'`
                // 铺满屏，5-1 是 `siteTap` ⇒ 点击区只盖对话条，孔里的点击照旧落到地块上。
                // 2-1「翻第1块地」/ 2-2「打开宝箱」走的就是这条：资源据点是两步
                // （`unlockCell` 翻出箱子 → `passCell` 点开箱子），两下都算 `tileFlipped`；
                // 判据与 `guideMapFocusCells('Map/Chest_N')` 共用 `isTerritoryChestActionable`。
                // 🔴 只判 `siteOpenableCells` 的话，第二步（已解锁）永远上报不了 ⇒ 2-2 卡死。
                const canFlip = isTerritoryChestActionable(this.model.state, intent.cellId);
                if (site && this.model.selectSite(site)) {
                    if (canFlip) reportGuideComplete('tileFlipped');
                    else if (isTerritoryBattleSite(site)) reportGuideComplete('siteTap');
                }
                break;
            }
            case 'randomTap': {
                // 新手引导 2-1/3-1/4-1/7-1 的判据：设计案写「进入翻开动画 / 地块进入通关态」。
                // 只在**校验通过、真的开始翻**时上报（`selectRandomResource` 返回 false 的情况：
                // 在途 / 非候选格 / 银币·体力·相邻格不满足 / 已开启）。无条件上报会让
                // "钱不够点一下"也算翻了一格，引导直接跳步。
                // 精确到"服务端确认翻格成功"要 Model 暴露 `runCellWrite` 的完成回调，属后续项。
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
