import { FW } from "../FW";
import { Log } from "../log/Log";
import { ScriptObject } from "../base/ScriptObject";
import { EngineMain } from "../../engine/EngineMain";

/**
 * 全局错误处理器
 * 用于捕获全局未处理的JavaScript异常和Promise拒绝
 */
export class GlobalErrorHandler extends ScriptObject {
    public static __cname: string = "GlobalErrorHandler";
    private static _instance: GlobalErrorHandler;
    
    // 错误回调函数列表
    private errorCallbacks: Array<(message: string, source?: string, error?: Error) => void> = [];
    // 是否已初始化
    private initialized: boolean = false;

    public static get instance(): GlobalErrorHandler {
        if (!GlobalErrorHandler._instance) {
            GlobalErrorHandler._instance = new GlobalErrorHandler();
        }
        return GlobalErrorHandler._instance;
    }

    /**
     * 初始化全局错误处理
     */
    public init(): void {
        if (this.initialized) return;
        this.initialized = true;
        let that = this

        // 捕获未处理的JavaScript异常
        window.onerror = (message: string | Event, source, lineno, colno, error) => {
            console.log("GlobalErrorHandler.onerror", message)
            const errorInfo = error// || new Error(message as string);
            if (errorInfo)
            {
                that.handleError(errorInfo.message, errorInfo.stack, 'window.onerror', errorInfo);
            }
            else 
            {
                if (typeof message === 'string') {
                    that.handleError(message, `${source}:${lineno}:${colno}`, 'window.onerror');
                }    
            }
                

            
            // 返回true阻止默认处理
            return false;
        };


        window["__errorHandler"] = (file:string, lineno: number, message:string, stack: string) => {
            console.log("GlobalErrorHandler.__errorHandler", message)
            that.handleError(message + `${file}:${lineno}`, stack, 'window.onerror');
                
            // 返回true阻止默认处理
            return false;
        };

        // 捕获未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            let error: Error;
            if (event.reason instanceof Error) {
                error = event.reason;
                that.handleError(error.message, error.stack, 'unhandledrejection', error);
            }

            console.log("GlobalErrorHandler.unhandledrejection", event.reason instanceof Error)
            // } else {
            // //     let promise = event.promise
            // //     promise
            // //     error = new Error(String(event.reason));
            // }
            
            // 阻止默认处理
       //     event.preventDefault();
        });

        
        // 小程序环境 window.onunhandledrejection 是只读属性，只在非小程序平台赋值
        if (!EngineMain.isMiniGame) {
            window.onunhandledrejection = function(event) {
                console.log("GlobalErrorHandler.onunhandledrejection", event.reason instanceof Error)
                let reason = event.reason;
                if (reason instanceof Error) {
                    that.handleError(reason.message, reason.stack, 'onunhandledrejection', reason);
                }
                else {
                    that.handleError('Unhandled Promise Rejection', event.reason?.stack);
                }
            }
        }

                

        // 捕获Cocos Creator引擎内部错误
        if (cc && cc.error) {
            const originalCcError = cc.error;
            cc.error = (...args: any[]) => {
                // 调用原始cc.error
                originalCcError.apply(cc, args);
                
                // 构造错误对象
                const errorMessage = args.map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg);
                        } catch (e) {
                            return String(arg);
                        }
                    }
                    return String(arg);
                }).join(' ');
                
                console.log("GlobalErrorHandler.cc.error", args.length)

                that.handleError(errorMessage, "", 'cc.error');
            };
        }

        if (window["jsb"])
        {
            window["jsb"]['onError'] = (location, message, stack)=>{
                console.log("GlobalErrorHandler.jsb.onError", location, message, stack)
                that.handleError(message, stack, location);
            };
        }
        



        FW.Log.log("GlobalErrorHandler initialized");
    }

    /**
     * 添加错误处理回调
     * @param callback 错误处理回调函数
     */
    public addErrorCallback(callback: (message: string, source?: string, error?: Error) => void): void {
        if (!this.errorCallbacks.includes(callback)) {
            this.errorCallbacks.push(callback);
        }
    }

    /**
     * 移除错误处理回调
     * @param callback 要移除的回调函数
     */
    public removeErrorCallback(callback: (message: string, source?: string, error?: Error) => void): void {
        const index = this.errorCallbacks.indexOf(callback);
        if (index !== -1) {
            this.errorCallbacks.splice(index, 1);
        }
    }

    /**
     * 处理捕获到的错误
     * @param error 错误对象
     * @param source 错误来源
     */
    public handleError(message: string, stack?: string, source?: string, error?:Error): void {

        // 记录到日志
    //    FW.Log.error(`[GlobalError][${source}] ${error.message}\n${error.stack}`);
        
        // 如果已配置ErrorLogMgr，则推送错误
        if (FW.ErrorLogMgr) {
            FW.ErrorLogMgr.PushError(source || 'global', message, stack);
        }
        
        // 调用所有注册的回调
        for (const callback of this.errorCallbacks) {
            try {
                callback(message, source, error);

            } catch (callbackError) {
                // 防止回调本身出错
                FW.Log.error(`Error in error callback: ${callbackError}`);
            }
        }
    }
}



function __errorHandler(file:string, lineno: number, message:string, stack: string) {
    console.log("GlobalErrorHandler.__errorHandler2", message)
    GlobalErrorHandler.instance.handleError(message + `${file}:${lineno}`, stack, 'window.onerror');
        
    // 返回true阻止默认处理
    return false;
};