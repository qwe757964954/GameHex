import { ScriptObject } from "../base/ScriptObject";
import { ToolSet } from "../utils/Toolset";
import { Expr } from "./Expr";
import { TExprVarName } from "./ExprMgr";

/**
* ExprVarBase 
* 变量
*/

export abstract class ExprVarBase extends ScriptObject {
    static __cname: string = "ExprVarBase";

    //记录引用的Expr
    private tmExpr = new Set<Expr>()

    private dirty: boolean = false
    private isWatch = false
    private result: any

    protected toolSet: ToolSet

    //#region 
    Enter(expr: Expr) {
        this.tmExpr.add(expr)
        if (this.isWatch) return
        if (!this.toolSet) this.toolSet = ToolSet.createToolSet()
        this.dirty = true
        this.isWatch = true
        this.result = null
        this.OnEnter()
    }

    Exit(expr: Expr) {
        if (!this.isWatch) return
        this.tmExpr.delete(expr)
        if (this.tmExpr.size == 0) {
            if (this.isWatch) {
                this.dirty = true
                this.isWatch = false
                this.result = null
                this.OnExit()
                ToolSet.destroyToolSet(this.toolSet)
                this.toolSet = null
            }
        }
    }

    protected OnEnter() { }
    protected OnExit() { }

    //#endregion

    private varName: TExprVarName
    private p1: any
    private p2: any
    private p3: any
    private ref: number = 0

    GetVarName() { return this.varName }
    GetP1() { return this.p1 }
    GetP2() { return this.p2 }
    GetP3() { return this.p3 }

    Setup(varName: TExprVarName, p1: any, p2: any, p3: any) {
        this.varName = varName
        this.p1 = p1
        this.p2 = p2
        this.p3 = p3
    }

    AddRef() {
        return ++this.ref
    }

    DecRef() {
        return --this.ref
    }

    GetResult(): any {
        if (this.isWatch) {
            if (this.dirty) {
                this.dirty = false
                this.result = this.OnComputeResult()
            }
            return this.result
        } else {
            return this.OnComputeResult()
        }
    }

    MarkDirty() {
        this.dirty = true
        for (let expr of this.tmExpr) {
            expr.MarkDirty()
        }
    }

    /**
     * 计算过程
     */
    protected OnComputeResult(): any { }
}