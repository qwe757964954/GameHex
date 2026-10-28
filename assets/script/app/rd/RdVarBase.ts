/**
 * 红点变量基类 —— 老端 `RDClientSet` / `RDServerBase` 的公共底座。
 *
 * ## 一个红点变量要回答的三件事
 * 1. **什么时候该重算**（`OnEnter` 里挂监听 → `MarkDirty()`）；
 * 2. **值是多少**（`OnComputeResult()` 返回**数字** —— 老端注释原文「都是红点类型，
 *    返回的结果要 number 类型，方便累加」）；
 * 3. **（可选）是不是别人的组合**（`GetScript()` 返回复合表达式，见 `RdSetVar`）。
 *
 * ## 脏值是怎么走到界面上的（这条链路不熟就写不对）
 * ```
 * 数据变了  → 变量.MarkDirty()
 *           → 该变量被引用到的每个 Expr.MarkDirty()      （ExprVarBase.MarkDirty 内部转发）
 *           → ExprMgr.MarkExprDirty(script) 收进脏集合
 *           → ExprMgr.Update()  ← 每帧（构造时 addUpdateFrame 注册，见 ExprMgr 构造函数）
 *           → 重算 → eventhandler.Execute(script, 新值)
 *           → ToolSet.AddScriptListener 注册的那些回调
 *           → RedDot.setRedDot(值)
 * ```
 * ⚠️ 所以「变量没挂监听」= 值只在第一次算一次，之后永不变 —— **不报错、不崩、红点就是不更新**。
 * 这是本项目最贵的一类静默失效，写新变量时 `OnEnter` 里必须挂上监听。
 *
 * ## 为什么可以直接用 `CacheMgr.instance`
 * `framework` 层不能反向依赖 `app` 层，所以框架侧只留了 `FW.CacheMgr` 的惰性兜底；
 * 业务侧（本目录就在 `app/` 下）直接用 `app/net/CacheMgr` 的单例即可 —— 与
 * `MainEntranceList` / `SevenDayRepository` 同一口径（它们也是 `CacheMgr.instance`）。
 */

import { ExprVarBase } from '../../framework/expr/ExprVarBase';
import { CacheMgr } from '../net/CacheMgr';

export abstract class RdVarBase extends ExprVarBase {
    static __cname: string = 'RdVarBase';

    /**
     * 聚合型变量返回自己的复合表达式（如 `"[RDGemHaveBetter]+([RDGemCompose])"`）；
     * 普通变量返回 `null`。只有 `RdSetVar` 会用到它。
     */
    GetScript(): string | null {
        return null;
    }

    /**
     * 监听某个**服务端缓存**的变化。
     *
     * `caller` 传 `this`（`ExprVarBase extends ScriptObject`）⇒ 变量被 `ExprVarMgr.DecRef`
     * 销毁时，`ScriptObject.scriptObjectDestroy` 钩子会 `FW.CacheMgr.removeEventCallerAllCache`
     * 把监听一起清掉（见 `FW.ts` 的钩子注册），**不需要**自己写 remove。
     *
     * @param onChanged 变化后的动作。默认只 `MarkDirty()`（值同步可算的变量够用）；
     *                  **异步快照型的变量必须传**「重新装载」的回调，否则重算时读到的还是旧快照
     *                  （`OnComputeResult` 是同步的，不会自己去 await）。
     */
    protected listenCache(cacheName: string, onChanged?: () => void): void {
        const mgr = CacheMgr.instance;
        if (!mgr) {
            console.warn(`[RdVar] CacheMgr 未就绪，${this.constructor.name} 无法监听 ${cacheName}`);
            return;
        }
        mgr.setEventUpdate(cacheName, this, () => {
            if (onChanged) onChanged();
            else this.MarkDirty();
        });
    }
}
