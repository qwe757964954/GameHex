/**
 * 客户端自算型红点变量 —— 老端 `model/expr/RD/Client/*` 的移植。
 *
 * 与 `RdServerVar` 的区别：值不是服务端给的数字，而是**客户端按各模块自己的数据算出来**的
 * （「有可领的任务吗」「好友申请条数」「聊天未读」）。
 *
 * ## 监听怎么写（这一层最容易写错）
 * 新工程各模块的数据**几乎都落在 `CacheMgr`**（`getTlCmdActivity` / `getCmdBattleToken` /
 * `getTlCmdFriend` / `getTlCmdFirstRechargeNew` …），所以 `GetWatchCacheNames()` 返回
 * 缓存名即可拿到变化通知 —— 不必去各 Repository 造事件（它们大多是一次性 `load()`，没有事件源）。
 *
 * ⚠️ **例外**：`SevenDayRepository` 的服务器状态**不走 CacheMgr**（`protoCache.json` 里没有
 * `CmdSevenDayInfo`，它是随响应体回来的内存快照，见该文件头注释）。七日这一路要用
 * 服务端的 `[RDSevenday]`（`CmdRedDotCache.SEVEN_DAY`），别去监听 `CmdSevenDayInfo`（监听不到）。
 */

import { FW } from '../../framework/FW';
import { normalizeRdCount } from './RdTypes';
import { RdVarBase } from './RdVarBase';

export abstract class RdClientVar extends RdVarBase {
    static __cname: string = 'RdClientVar';

    /**
     * 本变量依赖哪些服务端缓存 —— 变了就标脏。空数组 = 值只跟本地状态走（那就要自己想办法标脏）。
     */
    protected GetWatchCacheNames(): readonly string[] {
        return [];
    }

    protected OnEnter(): void {
        for (const cacheName of this.GetWatchCacheNames()) {
            this.listenCache(cacheName);
        }
        this.MarkDirty();
    }
}

/**
 * 聚合型变量 —— 老端 `RDClientSet`。
 *
 * 值 = **别的变量拼出来的表达式**的求值结果，自己不写判定逻辑：
 * ```
 * RDTabGem.GetScript() = "[RDGemHaveBetter]+([RDGemCompose])"
 * ```
 * `OnEnter` 把自己这段表达式注册进 `ExprMgr` 并**监听它**，于是任一子变量变脏都会顺着
 * 表达式传播上来、回调本变量 `MarkDirty()`，再由外层（界面上挂的那个表达式）收到通知。
 *
 * ⚠️ 表达式**不许引用自己**（`[RDTabGem]` 里出现 `RDTabGem`）：监听自己 = 自己触发自己，
 * 每帧标脏。守卫见 `RdTypes.validateRdAggregation()`。
 */
export abstract class RdSetVar extends RdVarBase {
    static __cname: string = 'RdSetVar';

    abstract GetScript(): string;

    protected OnEnter(): void {
        const script = this.GetScript();
        if (script) {
            this.toolSet.AddScriptListener(script, () => this.MarkDirty(), this);
        } else {
            // 没有表达式 = 恒 0（老端 RDClientSet.OnEnter 的 else 分支就是这么写的）
            this.MarkDirty();
        }
    }

    protected OnComputeResult(): number {
        const script = this.GetScript();
        if (!script) return 0;
        return normalizeRdCount(FW.ExprMgr.GetResult(script));
    }
}

/**
 * 空实现变量 —— 玩法在新工程**还没做**时占位。
 *
 * 为什么不留着「不注册」：`ExprVarMgr.AddRef` 找不到类名会 `FW.Log.error("尚未注册该值")`
 * 然后退化成 `close`，若 `close` 也没注册就 `new undefined()` 抛异常被 catch ——
 * 结果是**红点静默不亮**，界面无感。所以名字必须注册，值给 0。
 *
 * ❗ 补数据源时把 `RdRegistry` 里对应那一行换掉即可（`RD_CLIENT_VARS` 的 `impl` 字段
 * 从 `'stub'` 改 `'ready'`，并写个真类）。
 */
export abstract class RdStubVar extends RdVarBase {
    static __cname: string = 'RdStubVar';

    protected OnEnter(): void {
        this.MarkDirty();
    }

    protected OnComputeResult(): number {
        return 0;
    }
}

/**
 * 异步快照型客户端变量 —— Demo3.8 特有的一层（老端没有）。
 *
 * ## 为什么需要它
 * - `OnComputeResult()` 是**同步**的（引擎每帧求值，不能 await）；
 * - 而新工程各模块的数据要 `await repository.load()` 才拿得到（读表 + 读缓存）。
 *
 * 所以拆成两拍：`OnEnter` 先返回 0（红点不亮），异步快照到了再 `MarkDirty()` 让引擎重算。
 * 中间那一帧不亮是**可接受**的（方向安全：宁可不亮，不能亮了错点）。
 *
 * ⚠️ 两个必须守的点：
 * 1. `await` 回来后**必须判 `this.destroyed`** —— 快照还没回来变量就被 `ExprVarMgr.DecRef`
 *    销毁了（界面关闭 / 退出登录），往死对象上写状态没意义；
 * 2. `loadSnapshot()` 里**不许**读 `this` 的其他可变字段再 await（规则：异步预加载禁在
 *    `await` 之后依赖 await 之前读到的成员）—— 要用的数据在 await 前后各取一次。
 */
export abstract class RdAsyncClientVar extends RdClientVar {
    static __cname: string = 'RdAsyncClientVar';

    /** 快照是否已装载成功（失败保持 false，下次 `OnEnter` 会重试）。 */
    private snapshotReady = false;
    private loading = false;

    protected OnEnter(): void {
        // ⚠️ 刻意**不用**父类的 `super.OnEnter()`：父类给缓存挂的是「只标脏」的监听，
        //    而本类重算时读的是内存快照 ⇒ 缓存变了必须**重新装载**，否则红点永远停在旧值。
        for (const cacheName of this.GetWatchCacheNames()) {
            this.listenCache(cacheName, () => {
                this.invalidateSnapshot();
                void this.ensureSnapshot();
            });
        }
        // 首帧：快照还没到 ⇒ 返回 0（红点不亮），装载完再 MarkDirty 重算
        this.MarkDirty();
        void this.ensureSnapshot();
    }

    /** 装载一次快照（读表 / 读缓存）。返回是否成功 —— 失败下次会重试。 */
    protected abstract loadSnapshot(): Promise<boolean>;

    /** 手动作废快照（数据大变时不用；一般靠缓存监听标脏即可）。 */
    protected invalidateSnapshot(): void {
        this.snapshotReady = false;
    }

    private async ensureSnapshot(): Promise<void> {
        if (this.loading || this.snapshotReady) return;
        this.loading = true;
        try {
            const ok = await this.loadSnapshot();
            if (this.destroyed) return;
            this.snapshotReady = ok;
            this.MarkDirty();
        } catch (error) {
            console.warn(`[RdVar] ${this.constructor.name} 装载快照失败`, error);
        } finally {
            this.loading = false;
        }
    }
}

/** 按变量名现造一个空实现类。 */
export function makeStubVarClass(varName: string): new () => RdStubVar {
    class GeneratedRdStubVar extends RdStubVar {
        static __cname: string = 'RdStubVar_' + varName;
    }
    return GeneratedRdStubVar;
}
