import { ComponentController } from '../../framework/controller/ComponentController';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { MAP_DIRECTORY, ZCGame } from '../zcds/ZCGame';
import { ZCGameLoader, ZCGamePreparedResources } from '../zcds/application/ZCGameLoader';
import type { IZCGameEntry } from '../zcds/application/ZCGameEntry';
import type { ZCGameEntryParams } from '../zcds/application/ZCGamePreload';
import { buildZCClientCombatConfig } from '../zcds/application/ZCClientCombatConfig';
import { buildZCPveEnemyDecks } from '../zcds/application/ZCPveCombatConfig';
import { createTerritorySaveStore } from '../territory/application/TerritorySaveStoreAdapter';
import { buildSeatProfiles, buildSeatUnitIds } from '../zcds/model/ZCRankBoard';

/**
 * 对局流程。
 *
 * 生命周期：
 *   onPreload  优先等待匹配期间的预加载，直接进入对局时由 ZCGameLoader 准备资源
 *   onEnter    资源全部就绪后才切出匹配界面，挂载 ZCGame 并同步渲染首屏
 *   onLeave    移除 ZCGame 组件
 *
 * 说明：登录流程的 LoginPage 登录成功后切换到本流程；本流程不再由 LoginPage
 * 直接 destroy()+addComponent(ZCGame)。
 */
export class ProcedureGame extends ProcedureBase {
    public static __cname: string = 'ProcedureGame';

    /**
     * 当前**进行中**的对局控制器；不在对局流程里就是 `null`。
     *
     * 给「只想读数据」的调用方用（`ProcedureGame.current?.model…`）。它拿到的就是 `game` 的引用，
     * 所以时序要自己兜：`onEnter` 之后才有、`onLeave` 就没了（那时 `shutdown()` 已经跑过）。
     *
     * ⚠️ **流程动作不要从这个出口调**（`shutdown` / `openSettlement` / `returnToMain` …）——
     * 那会把「谁在什么时候改流程」变成隐式耦合；界面意图一律走事件中控（`EventMgr`）。
     *
     * 为什么做成静态访问器，而不是把 `game` 放开成 public / 挂到 `ProcedureManager` 上：
     *  ① `ProcedureManager` 在 framework，**不许** import app 的 `ProcedureGame`（分层红线）；
     *  ② `instanceof` 收窄比调用方自己 `as ProcedureGame` 安全 —— 别的流程实现不会被误当成对局流程。
     */
    static get current(): ZCGame | null {
        const procedure = ProcedureManager.instance?.currentProcedure;
        return procedure instanceof ProcedureGame ? procedure.game : null;
    }

    private game: ZCGame | null = null;
    private preparedResources: ZCGamePreparedResources | null = null;

    async onPreload(params?: ZCGameEntryParams, context?: ProcedurePreloadContext): Promise<void> {
        const warmup = this.sessionAssets.warmupProgress;
        if (warmup) console.info(`[BattleLoading] 静默准备 下载${warmup.completed}/${warmup.total} 累计解析${warmup.parsed} 缓存${warmup.cached} 核心保留${warmup.pinned ?? 0}`);
        this.sessionAssets.pauseWarmup?.();
        if (params?.preload) {
            if (!context) throw new Error('移交匹配预加载资源需要流程资源作用域');
            const preload = params.preload;
            context.resources.defer(() => preload.releaseFromMatching());
            const prepared = await preload.ready;
            if (context.cancelled || context.resources.disposed) return;
            preload.transferTo(context.resources);
            this.preparedResources = prepared;
            this.log('复用匹配期间准备的对局资源');
            return;
        }
        let playerCount: 2 | 3 | 4 | undefined = params?.pve?.playerCount;
        if (params?.slgBattleType) {
            const count = params.battle?.units.length;
            if (count !== 2 && count !== 3 && count !== 4) throw new Error('SLG 开战数据缺少有效参战人数');
            playerCount = count;
        }
        if (!context) throw new Error('对局预加载需要流程资源作用域');
        const controller = new ComponentController('battle:direct-preload');
        context.resources.defer(() => controller.dispose());
        const loader = new ZCGameLoader(
            controller.resources,
            MAP_DIRECTORY,
            Math.random,
            playerCount,
        );
        const prepared = await loader.prepare(context.resources, params?.battle, params?.pve?.waves.map((wave) => wave.pvpCardId));
        if (context.cancelled || context.resources.disposed) return;
        this.preparedResources = prepared;
        this.log('对局配置、地图与显示资源预加载完成');
    }

    onEnter(_params?: ZCGameEntryParams): void {
        const sceneStartedAt = Date.now();
        if (!this.preparedResources) {
            this.error('对局资源尚未准备完成，拒绝进入空白对局');
            throw new Error('对局资源尚未准备完成，无法初始化 ZCGame');
        }
        // 服务端「开始游戏」的数据由匹配流程随 params 带进来（可能为 null）。
        //  `seed` 是**对局随机源**的种子：`ZCGameModel` 的初始地块分布 / 抽地块与保底 /
        //  AI 选格 / 单位出生抖动全由它派生，随下方单局 entry 一起交给对局。
        //  `battleId` 仍是「协议真的通了」的现场证据，也方便排查"这一局对的是谁"。
        const entry = _params;
        const battle = entry?.battle ?? null;
        const pve = entry?.pve;
        this.log(battle
            ? `对局开始：battleId=${battle.battleId} seed=${battle.seed} unitInfos=${battle.units.length}`
            : '对局开始：本局没有服务端数据（本地对局）');
        // 自选主城地图此时只构筑阵容与修改器，主城坐标会由 ZCGame 的开局选点阶段补齐。
        // 这里显式放行未解析的 select；选点完成后 resolveZCSpawnMatchConfig 会转成 fixed，
        // ZCGameModel 建模前仍会经过严格 capture，避免 -1 主城坐标泄漏到战斗逻辑。
        const captureOptions = { allowUnresolvedSelect: true } as const;
        const baseConfig = this.preparedResources.baseMatchConfig;
        const requestedEnemyCards = new Set((pve?.enemyCardIds ?? []).map(String));
        // 本地关卡名单仅供离线使用；提前裁剪会让正式回包中的英雄在构筑前就被丢掉。
        const pveEnemyDeck = !battle && requestedEnemyCards.size > 0
            ? baseConfig.enemyDeck.filter((card) => requestedEnemyCards.has(card.id))
            : baseConfig.enemyDeck;
        const pveDefence = pve?.mode === 'defence' && pve.waves.length > 0 ? {
            waves: pve.waves
                .filter((wave) => wave.monsterCount > 0 && wave.showAtSeconds >= 0)
                .sort((a, b) => a.showAtSeconds - b.showAtSeconds || a.waveId - b.waveId)
                .map((wave) => ({
                    waveId: wave.waveId,
                    showAtSeconds: wave.showAtSeconds,
                    cardId: String(wave.pvpCardId),
                    monsterCount: wave.monsterCount,
                    // 波次只决定出怪计划；战斗倍率统一来自服务端 buffInfo。
                    tier: 1,
                })),
        } : undefined;
        let matchConfig = baseConfig;
        if (pve) {
            matchConfig = Object.assign({}, baseConfig);
            if (pveEnemyDeck.length > 0) matchConfig.enemyDeck = pveEnemyDeck;
            if (!battle && pve.mode === 'match' && pve.enemyTeamCardIds.length > 0) {
                matchConfig.ownerDecks = buildZCPveEnemyDecks(baseConfig.enemyDeck, pve.enemyTeamCardIds);
            }
            if (pveDefence?.waves.length) matchConfig.pveDefence = pveDefence;
        }
        const clientCombat = buildZCClientCombatConfig(
            matchConfig,
            battle,
            entry?.selfRoleId,
            captureOptions,
        );
        if (clientCombat.skipped.length) {
            console.warn('[ProcedureGame] 尚未完成移植的客户端武将构筑已跳过', clientCombat.skipped);
        }
        const selfRoleId = entry?.selfRoleId;
        let playerAvatars: IZCGameEntry['playerAvatars'] = null;
        let seatProfiles: IZCGameEntry['seatProfiles'] = [];
        let seatUnitIds: IZCGameEntry['seatUnitIds'] = [];
        if (battle?.units?.length) {
            const sorted = battle.units.slice().sort((a, b) => a.campId - b.campId);
            const self = (selfRoleId ? sorted.find((u) => u.roleId === selfRoleId) : undefined) ?? sorted[0];
            const foe = sorted.find((u) => u !== self) ?? sorted[1];
            playerAvatars = { player: self?.avatarId ?? '', enemy: foe?.avatarId ?? '' };
            // 对局内排行榜按 2~4 席逐行渲染，必须把全量档案随 entry 一起交接。
            // `buildSeatProfiles` 返回 Map：release 构建会把 `[...map]` 降级成 `[].concat(map)`，
            // 而 concat 不展开迭代器 ⇒ 变成 `[Map]` ⇒ `new Map([[Map]])` 的**值是 undefined**
            // ⇒ HUD 里 `profile.headKey` 崩，整局停在空白（报错点在 setSeatProfiles，真凶在这行）。
            // ⚠️ 展开源是**函数返回值**，不是 `.keys()/.values()/.entries()`，正则判据容易漏。
            seatProfiles = Array.from(buildSeatProfiles(battle.units, selfRoleId ?? null));
            // 战斗统计要按**服务端单元 id** 归属，同一份席位分配逻辑派生（见 buildSeatUnitIds）。
            seatUnitIds = Array.from(buildSeatUnitIds(battle.units, selfRoleId ?? null));
        } else if (pve) {
            this.log(`领地 PVE：chapter=${pve.chapterId} level=${pve.levelId} mode=${pve.mode} players=${pve.playerCount} enemyCards=${pveEnemyDeck.length} waves=${pveDefence?.waves.length ?? 0}`);
        }
        const pveContext = pve ? {
            chapterId: pve.chapterId,
            territoryCellId: pve.territoryCellId,
            levelId: pve.levelId,
            onResult: (victory) => {
                createTerritorySaveStore(pve.territorySaveOwner).resolveBattle(
                    pve.chapterId,
                    pve.territoryCellId,
                    pve.levelId,
                    victory,
                );
            },
        } : null;
        const gameEntry: IZCGameEntry = {
            resources: this.preparedResources,
            battleSeed: battle?.seed ?? null,
            matchConfig: clientCombat.config,
            playerAvatars,
            seatProfiles,
            seatUnitIds,
            pveContext,
            slgBattleType: entry?.slgBattleType ?? null,
        };
        this.game = this.host.addComponent(ZCGame);
        this.game.initialize(gameEntry);
        this.preparedResources = null;
        this.log(`[BattleLoading] 场景创建完成 ${Math.max(0, Date.now() - sceneStartedAt)}ms`);
    }

    onPreloadCancelled(): void {
        this.preparedResources = null;
    }

    onLeave(): void {
        if (this.game) {
            this.game.shutdown();
            this.game.destroy();
            this.game = null;
        }
        this.preparedResources = null;
        this.releaseResourceScope();
        this.log('离开对局流程');
    }
}
