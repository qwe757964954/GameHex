import { ScriptObject } from "../base/ScriptObject";
import { Container } from "../container/Container";
import { FW } from "../FW";
import { ToolSet } from "../utils/Toolset";
import { ExprMgr, TExprHash, TExprVarName } from "./ExprMgr";
import { ExprVarBase } from "./ExprVarBase";

/**
* ExprVarMgr 
*/
export class ExprVarMgr extends ScriptObject {
    static __cname: string = "ExprVarMgr";

    private exprMgr: ExprMgr
    private tmVar = new Map<TExprHash, ExprVarBase>() //HashMap
    private tmVarClass = new Map<TExprVarName, Class<ExprVarBase>>()
    private toolSet: ToolSet

    constructor(exprMgr: ExprMgr) {
        super()
        this.exprMgr = exprMgr
        this.toolSet = ToolSet.createToolSet()
    }

    protected onDestroy(): void {
        for (let [_, Var] of this.tmVar) {
            Var.destroy()
        }
        ToolSet.destroyToolSet(this.toolSet)
        super.onDestroy()
    }

    Hash(...args): TExprHash {
        let result = ""
        for (let item of args) {
            if (item != null) {
                if (result == "")
                    result += item
                else
                    result += "_" + item
            }
        }
        return result as TExprHash
    }

    SetVarClass(name: TExprVarName, clazz: Class<ExprVarBase>) {
        this.tmVarClass.set(name, clazz)
    }

    GetVarClass(name: TExprVarName) {
        return this.tmVarClass.get(name)
    }

    AddRef(name: TExprVarName, p1?: any, p2?: any, p3?: any) {
        let hash = this.Hash(name, p1, p2, p3)
        let Var = this.tmVar.get(hash)
        if (Var == null) {
            let clazz = this.GetVarClass(name)
            if (clazz == null) {
                FW.Log.error("ExprVarMgr 尚未注册该值:" + name)
                clazz = this.GetVarClass("close")
            }
            try {
                Var = new clazz()
                Var.Setup(name, p1, p2, p3)
                this.tmVar.set(hash, Var)

                // 注入
                Container.inst().inject(Var)
            } catch (e) {
                FW.Log.warn(`初始化 ExprVar 失败, ${[name, p1, p2, p3].join(",")}`)
                if (e) FW.Log.error(e)
            }

        }
        Var.AddRef()
        return Var
    }

    DecRef(Var: ExprVarBase) {
        let ref = Var.DecRef()
        if (ref <= 0) {
            let hash = this.Hash(Var.GetVarName(), Var.GetP1(), Var.GetP2(), Var.GetP3())
            this.tmVar.delete(hash)
            Var.destroy()
        }
    }
}