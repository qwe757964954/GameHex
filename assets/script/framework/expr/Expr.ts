import { ScriptObject } from "../base/ScriptObject";
import { EventProxy } from "../event/EventProxy";
import { ExprMgr, TExprHash, TExprScript, TExprVarName } from "./ExprMgr";
import { ExprVarBase } from "./ExprVarBase";
import { ExprVarMgr } from "./ExprVarMgr";

/**
* ExprBase 
* 表达式，管理变量的运算过程
* example:   
* 支持符号：`/` `*` `-` `+` `>` `<` `>=` `<=` `!=` `==` `&&` `||`
* 支持函数:[time:1,2,3]最多3个参数
* 例子脚本： "5<[time:1,2]&&[time]<10"
* 根据运算符优先级，解析成二叉树： 
    {
        script:"5<[time:1,2]&&[time]<10"
        l:{
            script:"5<[time:1,2]"
            l:{script:"5"},
            r:{script:"[time:1,2]"},
            t:"<"},
        r:{
            script:"[time]<10"
            l:{script:"[time]"},
            r:{script:"10"}
            t""<"},
        t:"&&"
    }
* 遍历二叉树，获取所用到的函数:
    ["time","1","2"]
    ["time"]
* 求值时从根节点开始GetValue()
*/
export class Expr extends ScriptObject {
    static __cname: string = "Expr";

    private ExprMgr: ExprMgr
    private VarMgr: ExprVarMgr
    private tmVar: Map<TExprHash, ExprVarBase> = new Map()
    private eventProxy: EventProxy<any> = new EventProxy()
    private computeNode: Wrap
    private script: TExprScript
    private scriptOrigin: TExprScript

    private isWatch: boolean
    private isDirty: boolean
    private result: any
    private __ref: number = 0
    private lastResult: any

    //#region 生命周期
    /**
     * 
     * @param exprMgr 
     * @param varMgr 
     * @param script 必须去除空格
     */
    constructor(exprMgr: ExprMgr, varMgr: ExprVarMgr, script: TExprScript) {
        super()
        this.ExprMgr = exprMgr
        this.VarMgr = varMgr
        this.scriptOrigin = script
        this.script = script.replace(/\s/g, "")
        this.computeNode = this.Compile()
    }

    protected onDestroy(): void {
        for (let [_, Var] of this.tmVar) {
            this.VarMgr.DecRef(Var)
        }
        this.eventProxy.destroy()
    }

    /**
     * 开始监听
     * 只有注册到ExprMgr的表达式会触发，临时表达式不会
     */
    Enter() {
        if (this.isWatch) return
        this.isWatch = true
        this.isDirty = true
        this.result = null
        this.lastResult = null
        for (let [_, Var] of this.tmVar) {
            Var.Enter(this)
        }
    }

    /**
     * 停止监听
     * 只有注册到ExprMgr的表达式会触发，临时表达式不会
     */
    Exit() {
        if (!this.isWatch) return
        this.isWatch = false
        this.isDirty = true
        this.lastResult = null
        for (let [_, Var] of this.tmVar) {
            Var.Exit(this)
        }
    }

    protected OnEnter() { }
    protected OnExit() { }
    //#endregion

    AddRef() {
        return ++this.__ref
    }

    DecRef() {
        return --this.__ref
    }

    GetScriptOrigin() {
        return this.scriptOrigin
    }

    GetScript() {
        return this.script
    }

    /**
     * 表达式求值
     * @returns 
     */
    GetResult() {
        if (this.computeNode == null) {
            return null
        }
        if (this.isWatch) {
            //监听状态，脏才重算
            if (this.isDirty) {
                this.isDirty = false
                this.result = this.computeNode.getValue()
            }
            return this.result
        } else {
            //非监听状态，每次重算
            return this.computeNode.getValue()
        }
    }

    /**
     * 解析脚本后把函数注册一下
     * @param varName 
     * @param p1 
     * @param p2 
     * @param p3 
     */
    OnRegistVar(varName: string, p1, p2, p3) {
        let hash = this.VarMgr.Hash(varName, p1, p2, p3)
        if (this.tmVar.has(hash) == false) {
            let Var = this.VarMgr.AddRef(varName, p1, p2, p3)
            this.tmVar.set(hash, Var)
        }
    }

    /**
     * 尝试解析脚本,并更新tmVar
     */
    Compile(): Wrap {
        let script = this.script
        let VarMgr = this.VarMgr
        let tmVar = this.tmVar

        //解析成二叉树
        let getValue = (varName, p1, p2, p3) => {
            let hash = VarMgr.Hash(varName, p1, p2, p3)
            let Var = tmVar.get(hash)
            if (Var) {
                return Var.GetResult()
            }
            return null
        }
        let wrapGlobal: WrapGlobal = {
            getVar: getValue,
            parenthesis: []
        }
        let wrap = process(script, wrapGlobal)

        //分析函数及其参数
        let out: string[][] = []
        //遍历根节点
        process_fun(wrap, out)
        for (let varParams of out) {
            this.OnRegistVar.apply(this, varParams)
        }

        return wrap
    }

    MarkDirty() {
        this.isDirty = true
        this.ExprMgr.MarkExprDirty(this.scriptOrigin)
    }

    SetLastResult(result: any) {
        this.lastResult = result
    }

    GetLastResult() {
        return this.lastResult
    }

    GetComputeNode() {
        return this.computeNode
    }
}

//#region 表达式计算

type WrapGetValue = (varName: TExprVarName, p1?, p2?, p3?) => any
const RegMatchFunc = /\[([\w_:,]+)\]/
const RegSplitFunc = /[:,]/
const RegParenthesis = /\[=\[(((?!\[=\[|\]=\]).)+)\]=\]/
const RegParenthesisRep = /__(\d+)__/

class WrapGlobal {
    parenthesis: Wrap[]
    getVar: WrapGetValue
}

/**
 * 分析表达式，拆成二叉树
 */
class Wrap {
    //调试
    debug = true

    scriptOrigin: string
    script: string
    l: Wrap
    r: Wrap
    t: string
    global: WrapGlobal
    params: any[] //函数参数
    //优先计算表达式参数
    splitSubWrapParams: [start: number, index: number, id: number, script: string][] = []

    constructor(script: string, global: WrapGlobal) {
        this.scriptOrigin = script
        this.script = script
        this.global = global
    }

    UpdateFunParam() {
        this.params = this.GetFunParam()
    }

    /**
     * 分析函数
     * [func:p1,p2,p3]
     * @returns 
     */
    GetFunParam() {
        let copy = this.script.replace(new RegExp(RegParenthesis, "g"), "")
        let funcs = copy.match(new RegExp(RegMatchFunc, "g"))
        if (funcs != null) {
            for (let item of funcs) {
                let args = item.match(RegMatchFunc)
                if (args) {
                    let varname = args[1]
                    let params = varname?.split(RegSplitFunc) || []
                    return params.map(value => this.parseValue(value))
                }
            }
        }
        return null
    }

    getValue() {
        //终点
        if (this.l == null && this.r == null) {
            return this.calValue()
        }

        //单一操作数
        if (this.l && this.r == null) {
            return this.l.getValue()
        }

        //两个操作数
        let lvalue = this.l.getValue()
        let rvalue = this.r.getValue()

        let result = (() => {
            switch (this.t) {
                case "||": return lvalue || rvalue
                case "&&": return lvalue && rvalue
                case "==": return lvalue == rvalue
                case "!=": return lvalue != rvalue
                case "<=": return lvalue <= rvalue
                case ">=": return lvalue >= rvalue
                case "<": return lvalue < rvalue
                case ">": return lvalue > rvalue
                case "+": return lvalue + rvalue
                case "-": return lvalue - rvalue
                case "*": return lvalue * rvalue
                case "/": return lvalue / rvalue
                default: throw new Error(`不支持的操作符: ${this.t} in ${this.script}`)
            }
        })()
        return result
    }

    //遍历优先公式
    walkParenthesis(script: string, callback: (start: number, length: number, wrap: Wrap) => void) {
        //优先计算的公式
        let reg = new RegExp(RegParenthesisRep, "g")
        let array1: any[]
        while ((array1 = reg.exec(script)) !== null) {
            let match = array1[0]
            let id = Number(array1[1])
            let index = reg.lastIndex

            let length = match.length
            let start = index - length
            let wrap = this.global.parenthesis[id]
            callback(start, length, wrap)
            // let value = this.global.parenthesis[id].getValue()
            // values.push([start, length, value])
        }
    }

    calValue() {
        let invert = this.script.charAt(0) == "!"
        let script = this.script.substring(invert ? 1 : 0)
        let result = (() => {
            //操作数直接求值
            if (this.params) {
                let args = this.params
                return this.global.getVar.apply(this, args)
            }

            //优先计算的公式
            let values: [start: number, len: number, value: any][] = []
            this.walkParenthesis(script, (start, length, wrap) => {
                let value = wrap.getValue()
                values.push([start, length, value])
            })
            if (values.length > 0) {
                //长度一致，直接返回值
                if (values[0][1] == script.length) {
                    return values[0][2]
                } else {
                    //长度不一致，拼接结果
                    let offset = 0
                    for (let [start, length, value] of values) {
                        start += offset
                        let str = String(value)
                        script = script.substring(0, start) + str + script.substring(start + length)
                        offset += str.length - length
                    }
                    return this.parseValue(script)
                }
            }

            return this.parseValue(script)
        })()
        result = invert ? !result : result
        return result
    }

    parseValue(value: string) {
        // 空字符串
        if (value == "") {
            return value
        }

        //数字
        if (!isNaN(value as any)) {
            return Number(value)
        }

        //布尔
        if (value == "true") {
            return true
        }

        if (value == "false") {
            return false
        }

        //Null
        if (value == "null") {
            return null
        }

        //否则返回原值
        return value
    }

    /**
     * 增加优先计算表达式
     * @param index 
     * @param length 
     * @param script 
     * @returns 
     */
    addSubWrap(index: number, length: number, script: string, wrap: Wrap) {
        let id = this.global.parenthesis.length
        this.global.parenthesis.push(wrap)
        this.splitSubWrapParams.push([index, length, id, script])
        return id
    }

    applySubWrap() {
        let offset = 0
        for (let [start, length, id] of this.splitSubWrapParams) {
            let str = this.script
            let replace = `__${id}__`
            start += offset
            offset += (replace.length - length)
            this.script = str.substring(0, start) + replace + str.substring(start + length)
        }
        this.splitSubWrapParams.length = 0
    }

    get_dump_str(tag: string = "") {
        let logstr = "\r\n"
        logstr += tag + `origin: ${this.scriptOrigin}\r\n`
        logstr += tag + `script: ${this.script}\r\n`
        logstr += tag + `param: ${this.params?.join()}\r\n`
        logstr += tag + `result: ${this.getValue()}\r\n`
        logstr += tag + `opera: ${this.t}\r\n`

        if (this.l) {
            let item = this.l
            logstr += item.get_dump_str(tag + "\t")
        }
        if (this.r) {
            let item = this.r
            logstr += item.get_dump_str(tag + "\t")
        }

        this.walkParenthesis(this.script, (start, length, wrap) => {
            logstr += wrap.get_dump_str(tag + "\t\t")
        })



        return logstr
    }
    dump() {
        if (this.debug == false) return
        let logstr = this.get_dump_str()

        console.log(logstr)
    }

}

function process(script: string, global: WrapGlobal) {
    let wrap = new Wrap(script, global)
    while (true) {
        //提取文本模板
        process_text(wrap)

        //提取括号
        process_parents(wrap)


        //逻辑操作符分割，要支持多个表达式
        // if (process_opera(wrap, "||")) break
        // if (process_opera(wrap, "&&")) break
        if (process_opera_sample(wrap, ["||", "&&"])) break

        //操作符分割,必须保证结构是： 表达式 操作符 表达式 这样的结构
        //也就是必须确保两个表达式
        if (process_opera(wrap, "==")) break
        if (process_opera(wrap, "!=")) break
        if (process_opera(wrap, "<=")) break
        if (process_opera(wrap, ">=")) break
        if (process_opera(wrap, "<")) break
        if (process_opera(wrap, ">")) break
        if (process_opera(wrap, "+")) break
        if (process_opera(wrap, "-")) break
        if (process_opera(wrap, "*")) break
        if (process_opera(wrap, "/")) break
        break
    }

    //更新函数参数
    wrap.UpdateFunParam()

    return wrap
}

/**
 * 操作符切割流程 支持多个同级 操作符
 * @param wrap 
 * @param operas 
 */
function process_opera_sample(wrap: Wrap, operas: string[]) {
    let opera: string
    let index: number
    for (let cur of operas) {
        let cur_index = wrap.script.indexOf(cur)
        if (cur_index > -1) {
            if (index == null || cur_index < index) {
                opera = cur
                index = cur_index
            }
        }
    }
    if (opera) {
        return process_opera(wrap, opera)
    } else {
        return false
    }
}

/**
 * 操作符切割流程
 * @param wrap 
 * @param opera 
 * @returns 
 */
function process_opera(wrap: Wrap, opera: string) {
    //切割节点数2，同时可以确保opera不会触发正则
    //比如`+`是正则符号，`xx.split("+")`是匹配不了`+`的，而`xx.split("+",2)`可以

    let args = wrap.script.split(opera, 2)

    let len = args.length
    if (len > 1) {
        // 新版，支持多个表达式
        wrap.l = process(args[0], wrap.global)
        wrap.r = process(wrap.script.substring(args[0].length + opera.length), wrap.global)
        wrap.t = opera

        // 旧版，只支持两个表达式
        //   wrap.l = process(args[0], wrap.global)
        //   wrap.r = process(args[1], wrap.global)
        //   wrap.t = opera
        return true
    }
    return false
}

/**
 * 括号流程
 * @param wrap 
 */
function process_parents(wrap: Wrap) {
    let count = 9999
    let RegParenthesis = /\(([^\(\)]*)\)/g
    while (true) {
        if (!RegParenthesis.test(wrap.script)) break
        RegParenthesis.test(null)//重置计数
        if (count-- < 0) throw new Error("超时1")
        let array1: string[]
        while ((array1 = RegParenthesis.exec(wrap.script)) !== null) {
            if (count-- < 0) throw new Error("超时2")
            let match = array1[0]
            let target = array1[1]

            let index = RegParenthesis.lastIndex

            let length = match.length
            let start = index - length
            let sub = process(target, wrap.global)

            wrap.addSubWrap(start, length, target, sub)
        }

        wrap.applySubWrap()
    }
}

/**
 * 文本模板流程
 */
function process_text(wrap: Wrap) {
    let count = 9999
    let reg = new RegExp(RegParenthesis, "g")

    while (true) {
        if (!reg.test(wrap.script)) break
        reg.test(null)//重置计数
        if (count-- < 0) throw new Error("超时1")
        let array1: string[]
        while ((array1 = reg.exec(wrap.script)) !== null) {
            if (count-- < 0) throw new Error("超时2")
            let match = array1[0]
            let target = array1[1]

            let index = reg.lastIndex

            let length = match.length
            let start = index - length
            let sub = new Wrap(target, wrap.global)

            wrap.addSubWrap(start, length, target, sub)
        }

        wrap.applySubWrap()
    }
}

/**
 * 遍历所需函数
 * @param wrap 
 */
function process_fun(wrap: Wrap, out: string[][]) {
    if (wrap.params) {
        out.push(wrap.params)
    }
    //遍历子节点
    if (wrap.l)
        process_fun(wrap.l, out)

    if (wrap.r)
        process_fun(wrap.r, out)

    //遍历公共优先公式
    wrap.walkParenthesis(wrap.script, (start, length, wrap) => {
        process_fun(wrap, out)
    })
}

//#endregion