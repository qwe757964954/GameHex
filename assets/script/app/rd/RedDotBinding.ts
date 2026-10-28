/**
 * 表达式 → 红点组件的**绑定器**：把 `RdExprResolver` 算出来的表达式接到 `RedDot` 上。
 *
 * ## 一条绑定的生命周期
 * ```
 * bind(expr)
 *   → ToolSet.AddScriptListener(expr, cb, redDot)
 *       ├ ExprMgr.AddScriptRef(expr)        ← 表达式进引擎、开始被监听（引用计数 +1）
 *       ├ ExprMgr.AddScriptListener(...)    ← 值变化回调
 *       └ 立即用当前值回调一次               ← 首帧就有正确状态，不用等第一次变化
 *   → cb(value) → RedDot.setRedDot(value)
 *
 * unbind()
 *   → ToolSet.RemoveScriptListener(handler)
 *       ├ ExprMgr.RemoveScriptListener
 *       └ ExprMgr.RemoveScriptRef(expr)     ← 引用计数 -1，归零则表达式出引擎
 *   → ToolSet.destroyToolSet
 * ```
 *
 * ⚠️ **必须 `unbind()`** 的两种场合：
 * 1. 宿主销毁（界面关闭）—— 不解绑则表达式引擎里留着指向已销毁 `RedDot` 的回调，
 *    下次值变化就往死对象上写（`setRedDot` 里 `this.node.active` 会炸）；
 * 2. 虚拟列表条目复用 —— 同一个 `RedDot` 换绑到别的入口，不先解绑会两条回调打同一个红点。
 *
 * ## 与老端 `GObjRD` 的对应
 * | 老端 | 这里 |
 * |---|---|
 * | `AddRdExpr(toolSet, rdExer)` | `bind(expr)` |
 * | `AddSystem(toolSet, sys)` | 先 `resolveRdExpr(refId, rows)` 再 `bind` |
 * | `OnRDUpdate(rdNum, rdType?)` | 回调里的 `RedDot.setRedDot(value, type)` |
 * | `ToolSet.RemoveAllScriptListener()` | `unbind()` |
 */

import { ToolSet } from '../../framework/utils/Toolset';
import { RedDot } from '../common/RedDot';
import { normalizeRedDotCount, RED_DOT_TYPE_ORDINARY, RedDotType } from '../common/RedDotState';

/** `ToolSet.AddScriptListener` 的返回句柄类型。 */
type ScriptHandler = ReturnType<ToolSet['AddScriptListener']>;

export class RdExprBinding {
    /** 当前表达式（空串 = 未绑定）。 */
    private expr = '';
    private toolSet: ToolSet | null = null;
    private handler: ScriptHandler | null = null;

    /**
     * @param redDot 目标红点组件
     * @param type   红点形态。入口红点一般是**普通红点**（`RED_DOT_TYPE_ORDINARY`，
     *               老端 `RDType.ordinaryRedDot`）；要显示数字就传 `RED_DOT_TYPE_NUMBER`。
     *               ⚠️ 只在 `bind` 时生效一次 —— 想中途换形态用 `RedDot.setRedDotType`。
     */
    constructor(
        private readonly redDot: RedDot,
        private readonly type: RedDotType = RED_DOT_TYPE_ORDINARY,
    ) {}

    get currentExpr(): string {
        return this.expr;
    }

    get bound(): boolean {
        return this.toolSet !== null && this.handler !== null;
    }

    /**
     * 绑定表达式。**会先解绑上一次**（幂等，可反复调用）。
     *
     * @returns 是否真的绑上了。`expr` 为空 / 红点已销毁 ⇒ 返回 `false` 并把红点收起。
     */
    bind(expr: string | null | undefined): boolean {
        this.unbind();

        const redDot = this.redDot;
        if (!redDot || !redDot.isValid) {
            console.warn('[RdExprBinding] 红点组件已销毁 / 未装配，跳过绑定');
            return false;
        }

        if (!expr) {
            // 没配表达式 = 这个入口没有红点（老端 AddRdExpr 的 else 分支也是直接 OnRDUpdate(0)）
            redDot.setRedDot(0);
            return false;
        }

        const handler = ToolSet.createToolSet();
        const type = this.type;
        const bound = handler.AddScriptListener(
            expr,
            (value: unknown) => {
                // 回调可能在解绑之前就被排进了事件队列，这里再判一次
                if (!redDot.isValid) return;
                redDot.setRedDot(normalizeRedDotCount(value as number), type);
            },
            redDot,
        );

        this.toolSet = handler;
        this.handler = bound;
        this.expr = expr;
        return true;
    }

    /** 解绑并释放表达式引用。可重复调用。 */
    unbind(): void {
        if (this.toolSet && this.handler) {
            this.toolSet.RemoveScriptListener(this.handler);
        }
        if (this.toolSet) {
            ToolSet.destroyToolSet(this.toolSet);
        }
        this.toolSet = null;
        this.handler = null;
        this.expr = '';
    }
}
