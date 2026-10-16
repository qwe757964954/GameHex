import { Log } from "../log/Log";
import { Utils } from "../utils/Utils";


export abstract class ScriptObject implements destroyable {
    public static __cname: string = "ScriptObject";
    public readonly isScriptObject = true;

    private __className: string;
    get className(): string { return this.__className; }

    disabled: boolean = true;
    /**异步销毁,这个会先为true */
    startDestroyed: boolean = true;
    destroyed: boolean = true;
    /**是否可用 */
    get isValid() {
        let t = this;
        return t.disabled === false && t.startDestroyed === false && t.destroyed === false;
    }

    private static _log: Log = Log.inst;
    static _suid: number = 0
    __uid: number

    constructor() {
        this.__uid = ScriptObject._suid++

        let t = this;
        let cls = t["__proto__"]["constructor"];
        let className = cls["__cname"]
        if (className == null) {
            console.error("className error", "please setting __cname: ", t.constructor.name)
        } else {
            if (Log.editLog) {
                let constructorName = t.constructor.name
                if (constructorName && className != constructorName && constructorName.length > 1) {
                    if (constructorName.indexOf("RefMgr") == 0 || constructorName.indexOf("Request") == 0) {
                    } else {
                        console.error("类名异常: ", constructorName, className)
                    }
                }
            }
        }
        t.__className = className

        t.disabled = false;
        t.startDestroyed = false;
        t.destroyed = false;
    }

    destroy() {
        let t = this
        t.objectDestroy()

        t.disabled = true
        t.startDestroyed = true
        t.destroyed = true
        
        t.onDestroy()
        t.showDestroyValueLog()
    }

    destroyWrap(): void {
        this.destroy()
    }

    protected onDestroy()
    {

    }

    public static scriptObjectDestroy: (t: ScriptObject) => void;
    protected objectDestroy() {
        let func = ScriptObject.scriptObjectDestroy
        if (func) {
            func(this)
        }
    }

    logBattle(message: any, ...params: any[]) {
        Utils.log(this.className, this.__uid, message, ...params)
    }

    traceBattle(message: any, ...params: any[]) {
        
      //  Utils.trace(this.className, this.__uid, message, ...params)
    }

     errorBattle(message: any, ...params: any[]) {
      //  Utils.error(this.className, this.__uid, message, ...params)
    }

    debug(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).debug(message, ...params);
    }

    log(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).log(message, ...params);
    }

    error(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).error(message, ...params);
    }

    trace(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).trace(message, ...params);
    }

    info(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).info(message, ...params);
    }

    warn(message: any, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).warn(message, ...params);

    }

    assert(test: boolean, message?: string, ...params: any[]) {
        ScriptObject._log.setFlag(this.className).assert(test, message, ...params);
    }

    /**耗时打印 */
    collectTimeConsuming(collectKey: string) {
        ScriptObject._log.setFlag(this.className).collectTimeConsuming(collectKey);
    }

    /**编辑期间输出log */
    public static editLog: boolean;
    private showDestroyValueLog() {
        if (ScriptObject.editLog) {
            let t = this;
            // 属性清除检测,防止内存泄露
            for (let k in t) {
                let v = t[k]
                if (v != null) {
                    if (k == "_log") {
                    } else {
                        let k_type = typeof (v);
                        if (k_type == "boolean" || k_type == "string" || k_type == "number") {
                            // t.log("对象销毁,属性没清除: ", k, k_type, v)
                        } else {
                            if (k_type == "function") {
                                // let kLower = k.toLowerCase()
                                // if (kLower.indexOf("runcallback") >= 0) {
                                // } else if (k.indexOf("_") >= 0 || kLower.indexOf("callback") >= 0 || kLower.indexOf("func") >= 0) {
                                //     t.error("对象销毁,函数没清除: ", k, k_type, v)
                                // }
                            } else {
                                // t.error("对象销毁,属性没清除: ", k, k_type, v)
                            }
                        }
                    }
                }
            }
        }
    }
}
