import { EngineMain } from "../../engine/EngineMain";
import { ScriptObject } from "../base/ScriptObject";
import { EventProxy } from "../event/EventProxy";
import { FW } from "../FW";
import { Timer } from "../utils/Timer";
import { ToolSet } from "../utils/Toolset";
import { HttpRequest } from "./HttpRequest";
export class Http extends ScriptObject {
    public static __cname: string = "Http";
    private static _instance: Http;
    static get instance(): Http {
        if (!Http._instance) {
            Http._instance = new Http;
        }
        return Http._instance;
    }

    static readonly maxTime: number = 3000

    static readonly mpost = "post";
    static readonly mget = "get";

    static readonly responseType_arraybuffer = "arraybuffer";

    static readonly headers_json?: Array<any> = ["Content-Type", "application/json"];
    /**
     * 命令协议事件
     */
    static readonly msgEventProxy = new EventProxy<string>();

    private _toolSet: ToolSet
    constructor() {
        super();
        this._toolSet = ToolSet.createToolSet();
    }

    destroy() {
        ToolSet.destroyToolSet(this._toolSet)
        this._toolSet = null
        super.destroy()
    }

    /**
     * 使用post请求http接口
     * 使用时候需要await
     * await FW.Http.post()
     * @param url 请求接口
     * @param args 请求参数
     * @param rspJson 
     * @param sendEvent 
     * @returns 返回请求数据
     */
    async post(url: string, args?: { [key: string]: any }, responseType?: XMLHttpRequestResponseType, rspJson?: boolean, sendEvent: boolean = true, timeout?: number) {
        let t = this;
        let data
        url = EngineMain.webHttpUrlFix(url)
        if (responseType == "json") {
            data = JSON.stringify(args)
            console.log(data)
        } else {
            data = t.handlePostData(args)
        }
        let tlUrl: string[] = [url]
        if (url.indexOf("?") == -1) {
            tlUrl.push("?")
        } else {
            tlUrl.push("&")
        }
        tlUrl.push(encodeURIComponent("h5t"), "=", encodeURIComponent(Date.now().toString()))
        url = tlUrl.join("")
        this.log(url)
        if (sendEvent) {
            Http.msgEventProxy.execute("send", url, data);
        }
        let logData = null
        let winModel = window["ModelCollectTimeConsumingLog"]
        if (winModel) {
            logData = {
                timeStamp: Date.now(),
                logType: "http",
                info: url
            }
        }
        let msgResult = await t.httpRequestAsync(url, data, Http.mpost, responseType, null, sendEvent, rspJson, timeout);
        if (winModel) {
            let now = Date.now()
            let timeConsuming = now - logData.timeStamp
            logData.timeConsuming = timeConsuming
            winModel.collectLog(logData)
        }
        let rsp = null;
        if (msgResult['result']) {
            rsp = msgResult['rsp']
        } else if (msgResult['rsp']) {
            // 打印日志?
        }
        return rsp
    }

    private handlePostData(args?: { [key: string]: any }) {
        let data: string = null;
        if (args != null) {
            let keys = Object.keys(args)
            if (keys.length > 0) {
                let tlData: string[] = [];
                let element: string;
                for (let i = 0, len = keys.length; i < len; i++) {
                    element = keys[i]
                    if (tlData.length > 0) {
                        tlData.push("&");
                    }
                    tlData.push(encodeURIComponent(element), "=", encodeURIComponent(args[element]))
                }
                data = tlData.join("")
            }
        }
        this.log("Http post data = ", data);
        return data
    }

    /**
     * Http get请求数据
     * @param url 地址
     * @param args 参数（Dictionary）
     */
    async get(url: string, args?: { [key: string]: any }, sendEvent: boolean = true, isRandom: boolean = true, rspJson: boolean = true, timeout?: number) {
        let t = this;
        url = EngineMain.webHttpUrlFix(url)
        if (isRandom) {
            url = t.handleRandomGetUrl(url, args);
        } else {
            url = t.handleGetUrl(url, args);
        }
        if (sendEvent) {
            Http.msgEventProxy.execute("send", url);
        }

        let logData = null
        let winModel = window["ModelCollectTimeConsumingLog"]
        if (winModel) {
            logData = {
                timeStamp: Date.now(),
                logType: "http",
                info: url
            }
        }
        FW.Log.log("url request:" + url)
        let msgResult = await t.httpRequestAsync(url, null, Http.mget, null, null, sendEvent, rspJson, timeout);
        if (winModel) {
            let now = Date.now()
            let timeConsuming = now - logData.timeStamp
            logData.timeConsuming = timeConsuming
            winModel.collectLog(logData)
        }

        let rsp = null;
        if (msgResult['result']) {
            rsp = msgResult['rsp']
        } else {
            if (msgResult['rsp']) {
                // 打印日志?
                // throw new Error(msgResult['rsp'])
                FW.Log.error("http get rsp err:", msgResult['rsp'])
            } else {
                // throw new Error(null)
                FW.Log.error("http get err")
            }
        }
        return rsp
    }

    private handleGetUrl(url: string, args?: { [key: string]: any }, isRandom: boolean = true) {
        let newUrl = url;

        if (args != null) {
            let keys = Object.keys(args)
            if (keys.length > 0) {
                let tlUrl: string[] = [url]

                if (url.indexOf("?") == -1) {
                    tlUrl.push("?")
                } else {
                    tlUrl.push("&")
                }
                let element: string;
                for (let i = 0, len = keys.length; i < len; i++) {
                    element = keys[i]
                    if (i > 0) {
                        tlUrl.push("&")
                    }
                    tlUrl.push(encodeURIComponent(element), "=", encodeURIComponent(args[element]))
                }

                newUrl = tlUrl.join("")
            }
        }
        return newUrl;
    }

    private handleRandomGetUrl(url: string, args?: { [key: string]: any }) {
        let tlUrl: string[] = [url]
        if (url.indexOf("?") == -1) {
            tlUrl.push("?")
        } else {
            tlUrl.push("&")
        }
        if (args != null) {
            let keys = Object.keys(args)
            if (keys.length > 0) {
                let element: string
                for (let i = 0, len = keys.length; i < len; i++) {
                    element = keys[i]
                    tlUrl.push(encodeURIComponent(element), "=", encodeURIComponent(args[element]), "&")
                }
            }
        }
        tlUrl.push(encodeURIComponent("h5t"), "=", encodeURIComponent(Date.now().toString()))
        let newUrl = tlUrl.join("")
        return newUrl;
    }

    async posBuffer(url, data, rspJson?: boolean) {
        let t = this;
        this.log(url)
        let msgResult = await t.httpRequestAsync(url, data, Http.mpost, null,
            ["Content-Type", "application/octet-stream"], false, rspJson);
        let rsp = null;
        if (msgResult['result']) {
            rsp = msgResult['rsp']
        } else if (msgResult['rsp']) {
            // 打印日志?
        }
        return rsp
    }

    private httpRequestAsync(url: string, data: any, method?: string, responseType?: XMLHttpRequestResponseType, headers?: Array<any>, sendEvent: boolean = true, rspJson: boolean = true, timeout?: number): Promise<any> {
        let t = this;
        return new Promise<any>((resolve, reject) => {
            timeout = timeout ?? Http.maxTime;
            let delayTimer: Timer = null;
            let hr: HttpRequest = new HttpRequest();

            let defer = () => {
                if (delayTimer) {
                    t._toolSet.removeDelay(delayTimer)
                    delayTimer = null
                }
                hr?.destroy()
                hr = null;
            }
            hr.eventProxy.addListener("progress", t, (e) => {
                t.log("progress : ", e);
            });
            hr.eventProxy.addListener("complete", t, (e) => {
                defer()
                if (rspJson && (typeof e == 'string')) {
                    let p = { result: true, rsp: rspJson ? JSON.parse(e) : e };
                    resolve(p);
                } else {
                    resolve(e);
                }
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            });
            hr.eventProxy.addListener("error", t, (e) => {
                defer()
                let httpErrorMsg = Http.httpError(e)
                let p = { result: false, rsp: httpErrorMsg };
                resolve(p);
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            });
            hr.eventProxy.addListener("onloadend", t, (e) => {
                defer()
                let p = { result: false, rsp: "onloadend" };
                resolve(p);
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            });
            delayTimer = t._toolSet.addDelay(timeout, () => {
                t.error("http timeout:", url);
                hr?.stop()
                defer()
                let p = { result: false, rsp: null };
                resolve(p);
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            }, t);
            hr.send(url, data, method, responseType, headers);
        });
    }

    static httpError(e: any): any {
        // console.error(e);
        let error = e.toString();
        console.error(error);
        return error;
    }
}