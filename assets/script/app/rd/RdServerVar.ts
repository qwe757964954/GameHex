/**
 * 服务端下发型红点变量 —— 老端 `model/expr/RD/Server/*` 的移植。
 *
 * ## 值从哪来
 * 服务端下发的 `CmdRedDotCache`（已在 `assets/resources/config/protoCache.json` 登记，
 * `CacheMgrGen.getCmdRedDotCache(redDotType)` 已生成）：
 * ```
 * CmdRedDotCache { number, redDotType, nextRefreshTime }
 * CmdRedDotType  { TEST=1, MAil=2, continuity_days=3, GEM_COMPOSE=4,
 *                  SEVEN_DAY=5, limit_time_activity=6, signin=7,
 *                  SPIRIT_ANIMAL_BOX=8, FIRST_RECHARGE=9 }
 * ```
 * 一个 `redDotType` 一条记录，`number` 就是红点数字。
 *
 * ## 为什么这类变量最好先接
 * 它**不依赖玩法在新工程做没做** —— 服务端该下发照样下发，客户端只要按类型取。
 * 所以「签到 / 累充 / 限时活动」这些新工程还没做的系统，红点也是真的（数字来自服务端），
 * 差别只是点进去没有界面（`MainEntranceRoute` 会 warn「还没有界面」）。
 *
 * ## ⚠️ 必须挂缓存监听
 * 只在 `OnEnter` 里算一次 = 第一次登录时的值永久冻结。`listenCache('CmdRedDotCache')`
 * 负责在推送到达后标脏（见 `RdVarBase` 文件头那条链路）。
 */

import { CmdRedDotType } from '../generated/netProto/CmdInterface';
import { CacheMgr } from '../net/CacheMgr';
import { RD_SERVER_VAR_TYPES, normalizeRdCount } from './RdTypes';
import { RdVarBase } from './RdVarBase';

/** 服务端红点缓存名（`CacheMgrGen` 的 `getCmdRedDotCache` 用的就是它）。 */
export const RD_CACHE_NAME = 'CmdRedDotCache';

/** 取某个 `CmdRedDotType` 当前的数字；取不到 / 读坏一律 `0`（红点收起，不抛）。 */
export function readServerRedDot(type: CmdRedDotType): number {
    const mgr = CacheMgr.instance;
    if (!mgr) return 0;
    try {
        const row = mgr.getCmdRedDotCache(type);
        if (!row) return 0;
        return normalizeRdCount(row.number);
    } catch (error) {
        console.warn(`[RdServerVar] 读 CmdRedDotCache(${String(type)}) 失败`, error);
        return 0;
    }
}

export abstract class RdServerVar extends RdVarBase {
    static __cname: string = 'RdServerVar';

    /** 本变量对应哪个 `CmdRedDotType`。 */
    abstract GetRedDotType(): CmdRedDotType;

    protected OnEnter(): void {
        this.listenCache(RD_CACHE_NAME);
        // 首帧也要算一次：缓存可能在本变量 Enter 之前就到了，等推送会一直等到下次刷新
        this.MarkDirty();
    }

    protected OnComputeResult(): number {
        return readServerRedDot(this.GetRedDotType());
    }
}

/**
 * 按变量名现造一个服务端型变量类。
 *
 * 老端是每个 `RD*` 一个文件（`RDSevenday.ts` 只有三行：继承 + 返回一个枚举），
 * 在 Demo3.8 里照抄 7 个文件没有信息量，改由 `RD_SERVER_VAR_TYPES` 这张表驱动生成 ——
 * **加一个服务端红点 = 表里加一行**，不会再出现「忘了写类 / 忘了注册」。
 *
 * @param type `CmdRedDotType` 数值
 */
export function makeServerVarClass(type: number): new () => RdServerVar {
    class GeneratedRdServerVar extends RdServerVar {
        static __cname: string = 'RdServerVar_' + type;
        GetRedDotType(): CmdRedDotType {
            return type as CmdRedDotType;
        }
    }
    return GeneratedRdServerVar;
}

/** 变量名 → 服务端型变量类（供 `RdRegistry` 遍历注册）。 */
export function buildServerVarClasses(): Map<string, new () => RdServerVar> {
    const out = new Map<string, new () => RdServerVar>();
    for (const varName of Object.keys(RD_SERVER_VAR_TYPES)) {
        out.set(varName, makeServerVarClass(RD_SERVER_VAR_TYPES[varName]));
    }
    return out;
}
