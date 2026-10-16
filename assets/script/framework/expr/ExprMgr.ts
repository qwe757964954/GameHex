import { ScriptObject } from "../base/ScriptObject";
import { EventProxy } from "../event/EventProxy";
import { FW } from "../FW";
import { ToolSet } from "../utils/Toolset";
import { Expr } from "./Expr";
import { ExprVarBase } from "./ExprVarBase";
import { ExprVarMgr } from "./ExprVarMgr";

export type TExprScript = string
export type TExprHash = string
export type TExprVarName = string
/**
* ExprMgr 
* 即时计算返回值 ExprMgr.GetResult
* 持续监听 ExprMgr.GetEventproxy().listen
*/
export class ExprMgr extends ScriptObject {
    static __cname: string = "ExprMgr";
    static _instance: ExprMgr
    static get instance() {
        return this._instance || (this._instance = new ExprMgr())
    }

    ExprVarMgr: ExprVarMgr
    private tmExpr: Map<TExprScript, Expr> = new Map()
    // private eventproxy: EventProxy<string> = new EventProxy()
    private eventhandler: ExprEventProxy
    private tlDirtyExpr = new Set<Expr>()
    private toolSet: ToolSet

    constructor() {
        super()
        this.eventhandler = new ExprEventProxy()
        this.ExprVarMgr = new ExprVarMgr(this)
        this.toolSet = ToolSet.createToolSet()
        this.toolSet.addUpdateFrame((dt: number) => {
            this.Update()
        }, this)
    }

    protected onDestroy(): void {
        for (let [_, expr] of this.tmExpr) {
            expr.destroy()
        }
        this.ExprVarMgr.destroy()
        this.eventhandler.destroy()
        // this.eventproxy.destroy()
        ToolSet.destroyToolSet(this.toolSet)
        super.onDestroy()
    }

    private _tlChanged: Array<Expr> = []
    Update() {
        //检查脏数据
        let tlDirtyExpr = this.tlDirtyExpr
        if (tlDirtyExpr.size == 0)
            return
        //整理变化列表
        let tlChanged = this._tlChanged
        tlChanged.length = 0
        for (let expr of tlDirtyExpr) {
            let result = expr.GetResult()
            let lr = expr.GetLastResult()
            // if (result !== lr) {
                expr.SetLastResult(result)
                tlChanged.push(expr)
            // }
        }
        //清空脏数据
        tlDirtyExpr.clear()

        //分发变化
        if (tlChanged.length > 0) {
            for (let expr of tlChanged) {
                this.eventhandler.Execute(expr.GetScriptOrigin(), expr.GetLastResult())
            }
        }
    }

    /**
     * 获取监听
     * 因为使用了eventhandler，尽量不暴露出去
     * @returns script, oldValue 
     */
    // GetEventproxy(){
    //     return this.eventhandler.eventproxy
    // }

    /**
     * 允许同一script注册多个事件
     */
    AddScriptListener(script: string, listener: Function, caller: any) {
        return this.eventhandler.Add(script, listener, caller)
    }

    RemoveScriptListener(handler: ExprEventProxyHandler) {
        return this.eventhandler.Remove(handler)
    }


    /**
     * 注册变量方法
     * @param varName 
     * @param clazz 
     */
    RegistVarClass(varName: TExprVarName, clazz: Class<ExprVarBase>) {
        this.ExprVarMgr.SetVarClass(varName, clazz)
    }

    /**
     * 增加表达式引用
     * @param script 
     * @returns 
     */
    AddScriptRef(script: TExprScript) {
        // script = script.replace(/\s/g,"")
        let expr = this.tmExpr.get(script)
        if (expr == null) {
            expr = new Expr(this, this.ExprVarMgr, script)
            this.tmExpr.set(script, expr)
            expr.Enter()
        }
        expr.AddRef()
        return script
    }

    /**
     * 减少表达式引用
     * @param script 
     */
    RemoveScriptRef(script: TExprScript) {
        // script = script.replace(/\s/,"")
        let expr = this.tmExpr.get(script)
        if (expr == null) {
            return
        }
        if (expr.DecRef() <= 0) {
            expr.Exit()
            this.tmExpr.delete(script)
            this.tlDirtyExpr.delete(expr)
            expr.destroy()
        }
    }

    /**
     * 返回已注册的表达式，或临时计算表达式结果
     * @param script 
     * @param dump 是否打印节点树
     * @returns 
     */
    GetResult(script: TExprScript, dump = false) {
        // script = script.replace(/\s/,"")
        let expr = this.tmExpr.get(script)
        if (expr == null || expr == undefined) {
            //没有表达式，构造一个临时的返回结果
            let expr = new Expr(this, this.ExprVarMgr, script)
            let result = expr.GetResult()
            expr.destroy()
            if (dump) {
                expr.GetComputeNode().dump()
            }
            return result
        } else {
            if (dump) {
                expr.GetComputeNode().dump()
            }
            //直接获取缓存结果
            return expr.GetResult()
        }
    }

    MarkExprDirty(script: TExprScript) {
        let expr = this.tmExpr.get(script)
        if (expr) {
            this.tlDirtyExpr.add(expr)
        }
    }
}

export interface ExprEventProxyHandler {
    event: string,
    listener: Function,
    caller: any
}
class ExprEventProxy extends ScriptObject {
    static __cname = "ExprEventHandler"

    eventproxy: EventProxy<string>
    toolSet: ToolSet

    tmHandler = new Map<string, Set<ExprEventProxyHandler>>()
    tmEvent = new Map<string, ExprEventProxyHandler>()

    constructor() {
        super()
        this.toolSet = ToolSet.createToolSet()
        this.eventproxy = new EventProxy()
        this.toolSet.addDefer(() => {
            this.eventproxy.destroy()
        })
    }

    protected onDestroy(): void {
        this.toolSet.destroy()
    }

    private GetTlHandlerBy(event: string) {
        if (this.tmHandler.has(event) == false) {
            this.tmHandler.set(event, new Set())
        }
        if (this.tmEvent.has(event) == false) {
            let tmHandler = this.tmHandler
            let func = (...args) => {
                if (tmHandler.has(event)) {
                    let tl = tmHandler.get(event)
                    for (let handler of tl) {
                        handler.listener.call(handler.caller, ...args)
                    }
                }
            }
            let handler: ExprEventProxyHandler = {
                event: event,
                listener: func,
                caller: this
            }
            this.tmEvent.set(event, handler)
            this.eventproxy.add(event, func, this)
        }
        return this.tmHandler.get(event)
    }

    Add(event: string, listener: Function, caller: any) {
        let handler: ExprEventProxyHandler = {
            event: event,
            listener: listener,
            caller: caller
        }
        let tlHandler = this.GetTlHandlerBy(event)
        tlHandler.add(handler)
        return handler
    }

    Remove(handler: ExprEventProxyHandler) {
        let event = handler.event
        let result = false
        foo: {
            if (this.tmHandler.has(event) == false) break foo;
            if (this.tmEvent.has(event) == false) break foo;
            let tlHandler = this.GetTlHandlerBy(event)
            tlHandler.delete(handler)

            //如果队列为空就移除监听
            if (tlHandler.size == 0) {
                let handler = this.tmEvent.get(event)
                this.eventproxy.remove(handler.event, handler.listener, handler.caller)
                this.tmEvent.delete(event)
            }
            result = true
        }

        if (result == false) {
            FW.Log.log("表达式移除失败，可能重复移除，请检查:", handler)
        }
        return result
    }

    Execute(event: string, ...args) {
        this.eventproxy.execute(event, ...args)
    }
}