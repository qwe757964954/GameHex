import { ResourceScope } from '../../../core/asset/ResourceScope';
import type { ZCBattleStart } from '../../battle/BattleStartModel';
import type { MatchPlayerData } from '../../matching/MatchTypes';
import type { ZCGameLoader, ZCGamePreparedResources } from './ZCGameLoader';
import type { ITerritorySaveOwner } from '../../territory/model/TerritorySaveStore';

export interface ZCGameEntryParams {
    opponent?: MatchPlayerData;
    /** 领地/冒险绕过 PVP 匹配，携带关卡数据直接进入本地 PVE。 */
    pve?: {
        levelId: number;
        chapterId: number;
        stage: number;
        territoryCellId: number;
        /** 捕获发起战斗时的存档归属，结算不读取可能已切换的当前角色。 */
        territorySaveOwner: ITerritorySaveOwner | null;
        mode: 'match' | 'defence';
        enemyName: string;
        /** 关卡 NPC / 塔防波次投影出的 pvpCard ID；为空时沿用默认 AI 卡组。 */
        enemyCardIds: number[];
        /** One card list per matching NPC seat, in enemy/enemy2/enemy3 order. */
        enemyTeamCardIds: number[][];
        /** 领地关卡固定玩家与一名 NPC。 */
        playerCount: 2;
        hpRate: number;
        attackRate: number;
        /** 塔防关卡的确定性出怪表；空数组表示该关卡尚无可用波次，回退普通守军 AI。 */
        waves: Array<{
            waveId: number;
            showAtSeconds: number;
            pvpCardId: number;
            monsterCount: number;
            hpRate: number;
            attackRate: number;
        }>;
    };
    /**
     * 本局的服务端数据（`CmdStartBattleRspMsg` 归一化结果：`battleId` / `seed` / 双方单元）。
     *
     *  拿不到时是 `null` —— 对局照常按本地数据开，不要为它加前置校验。
     *  `seed` 已经接进对局随机源（`ProcedureGame` → `IZCGameEntry.battleSeed` →
     *  `ZCGameModel` 的 `random`）；单元信息由 `ZCClientCombatConfig` 收敛成本局敌我卡池与
     *  武将修改器，`battleId` 用于战绩。协议边界只在 BattleStartModel 解析一次。
     */
    battle?: ZCBattleStart | null;
    /** 本机角色 id，用于把服务端多方单元稳定映射到 player，其余按 campId 映射到本地 AI。 */
    selfRoleId?: string;
    preload?: ZCGamePreload;
}

export type ZCPveEntry = NonNullable<ZCGameEntryParams['pve']>;

/** 匹配期间启动一次加载，成功进入对局时移交资源所有权。 */
export class ZCGamePreload {
    readonly ready: Promise<ZCGamePreparedResources>;
    private readonly resources = new ResourceScope('battle:matching-preload');
    private transferred = false;

    constructor(loader: Pick<ZCGameLoader, 'prepare'>) {
        this.ready = loader.prepare(this.resources);
        // 后台加载可能在匹配回调前失败，立即释放已加载资源并处理拒绝。
        void this.ready.catch(() => this.resources.dispose());
    }

    transferTo(scope: ResourceScope): void {
        if (this.resources.disposed || scope.disposed) throw new Error('对局预加载已取消');
        if (this.transferred) throw new Error('对局预加载资源已移交');
        this.transferred = true;
        scope.defer(() => this.resources.dispose());
    }

    releaseFromMatching(): void {
        if (!this.transferred) this.resources.dispose();
    }
}
