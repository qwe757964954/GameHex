import { EngineMain } from "../../engine/EngineMain";

let tmLogsss: Map<string, Log> = new Map()
export const LOG_MAIN_NAME = "%c log"
export class Log {
    public static inst: Log = new Log(LOG_MAIN_NAME);
    public static tmLogsss: Map<string, Log> = tmLogsss

    static editLog = false;

    private isEnabled: boolean = true;
    private name: string = "";
    private color = "color: #43bb88";
    private _flag: string = "";
    private _tmCollectInfo: Map<string, number>

    private static _logCollectTime: boolean = false

    constructor(name: string) {
        tmLogsss.set(name, this)
        this.name = name
        this._tmCollectInfo = new Map()
    }

    public setEnabled(isEnabled: boolean): Log {
        this.isEnabled = isEnabled;
        return this;
    }

    getEnabled() {
        // return this.isEnabled && Log.editLog
        return this.isEnabled
    }

    setName(name: string): Log {
        this.name = "%c " + name;
        return this;
    }

    setFlag(_flag: string): Log {
        this._flag = _flag;
        return this;
    }

    debug(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (params == null || params.length <= 0) {
            console.debug(this.name, this.color, this._flag, message)
        } else {
            console.debug(this.name, this.color, this._flag, message, ...params)
        }
        this._flag = "";
    }

    log(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (Log._logCollectTime) {
            if (typeof (message) == "string") {
                if (message.indexOf("========collect==========>") == -1) {
                    return
                }
            } else {
                return
            }
        } else {
            if (typeof (message) == "string") {
                if (message.indexOf("========collect==========>") != -1) {
                    return
                }
            }
        }

        //主Log内iphone不能打印对象
        if (EngineMain.isNative) {
            while (true) {
                if (typeof (message) == "string") break
                if (typeof (message) == "number") break
                if (typeof (message) == "boolean") break
                console.log(this.name, this.color, this._flag, "不能打印对象")
                return
            }
        }

        if (params == null || params.length <= 0) {
            console.log(this.name, this.color, this._flag, message)
        } else {
            console.log(this.name, this.color, this._flag, message, ...params)
        }

        this._flag = "";
    }

    private _errorCallback: (flag: string, msg: string) => void
    setErrorCallback(callback: (flag: string, msg: string) => void) {
        this._errorCallback = callback
    }
    error(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (this._errorCallback != null) {
            this._errorCallback(this._flag, message)
        }
        if (params == null || params.length <= 0) {
            console.error("console", this._flag, message)
        } else {
            console.error(this._flag, message, ...params)
        }
        this._flag = "";
    }

    trace(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (params == null || params.length <= 0) {
            console.trace(this.name, this.color, this._flag, message)
        } else {
            console.trace(this.name, this.color, this._flag, message, ...params)
        }
        this._flag = "";
    }

    info(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (params == null || params.length <= 0) {
            console.info(this.name, this.color, this._flag, message)
        } else {
            console.info(this.name, this.color, this._flag, message, ...params)
        }
        this._flag = "";
    }

    warn(message: any, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (params == null || params.length <= 0) {
            console.warn(this._flag, message)
        } else {
            console.warn(this._flag, message, ...params)
        }
        this._flag = "";
    }

    assert(test: boolean, message?: string, ...params: any[]) {
        if (!this.getEnabled()) {
            this._flag = "";
            return
        }
        if (!test) {
            if (typeof (console.assert) != "function") {
                this.error(message, params)
                return
            }
            if (params == null || params.length <= 0) {
                console.assert(test, this.name, this.color, this._flag, message)
            } else {
                console.assert(test, this.name, this.color, this._flag, message, ...params)
            }
        }
        this._flag = "";
    }

    collectTimeConsuming(collectKey: string) {
        let _tmCollectInfo = this._tmCollectInfo
        let now = Date.now()
        let lastCollectTime = _tmCollectInfo.get(collectKey)
        if (lastCollectTime) {
            this.log(collectKey + "========collect==========>", "耗时:" + (now - lastCollectTime) + "毫秒")
            _tmCollectInfo.delete(collectKey)
        } else {
            _tmCollectInfo.set(collectKey, now)
            this.log(collectKey + "========collect==========>", "开始统计:" + now + "毫秒")
        }
    }

    collectTimeClear() {
        this._tmCollectInfo.clear()
    }

    private static _init: boolean = false
    public static hideLog() {
        if (this._init) {
            return
        }
        // if (window['system_log']) {
        //     return
        // }
        this._init = true

        const func = () => { };
        console.log = func;
        console.info = func;
        console.assert = func;
        // console.error = func;
        // console.warn = func;
        console.debug = func;
        console.trace = func;
    }


    // ============================================================
    // 静态便捷方法（CC 2.x 老代码 `Log.log(...)` 风格兼容）
    // 全部转发到 inst 实例对应方法
    // ============================================================
    public static log(message?: any, ...params: any[]) {
        Log.inst.log(message, ...params);
    }
    public static info(message?: any, ...params: any[]) {
        Log.inst.info(message, ...params);
    }
    public static warn(message?: any, ...params: any[]) {
        Log.inst.warn(message, ...params);
    }
    public static error(message?: any, ...params: any[]) {
        Log.inst.error(message, ...params);
    }
    public static trace(message?: any, ...params: any[]) {
        Log.inst.trace(message, ...params);
    }
    public static debug(message?: any, ...params: any[]) {
        Log.inst.debug(message, ...params);
    }
    public static assert(value: any, message?: string, ...params: any[]) {
        Log.inst.assert(value, message, ...params);
    }
}

