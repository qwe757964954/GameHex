import { EventProxy } from "../event/EventProxy";
import { Utils } from "../utils/Utils";

export class HttpRequest {
    public static __cname: string = "HttpRequest";

    static readonly mpost = "post";
    static readonly mget = "get";
    static readonly responseType_arraybuffer: XMLHttpRequestResponseType = "arraybuffer";
    static readonly headers_json: string[] = ["Content-Type", "application/json"];

    static readonly DONE = 4;// 4 XMLHttpRequest.DONE
    static readonly LOADING = 3;// 3 XMLHttpRequest.LOADING
    static readonly HEADERS_RECEIVED = 2;// 2 XMLHttpRequest.HEADERS_RECEIVED
    static readonly OPENED = 1;// 1 XMLHttpRequest.OPENED
    static readonly UNSENT = 0;// 0 XMLHttpRequest.UNSENT

    // private static defCallback = function (e: any) { };
    private _isSend: boolean

    protected _responseType: string;
    /** 请求的地址。*/
    protected _url: string;
    public get url(): string {
        return this._url
    }
    /** 返回的数据。*/
    protected _data: any;
    public get data(): any {
        return this._data
    }
    /**
     * 本对象所封装的原生 XMLHttpRequest 引用。
     */
    protected _http: XMLHttpRequest;
    public get http(): XMLHttpRequest {
        return this._http
    }
    /**缓存事件 */
    private _eventProxy = new EventProxy<string>();
    get eventProxy() {
        return this._eventProxy;
    }


    event(type: string, data: any) {
        if (this._eventProxy) {
            this._eventProxy.execute(type, data);
        }
    }
    /**
    *HttpRequest 通过封装 HTML XMLHttpRequest 对象提供了对 HTTP 协议的完全的访问，包括做出 POST 和 HEAD 请求以及普通的 GET 请求的能力。 HttpRequest 只提供以异步的形式返回 Web 服务器的响应，并且能够以文本或者二进制的形式返回内容。</p>
    *注意：</b>建议每次请求都使用新的 HttpRequest 对象，因为每次调用该对象的send方法时，都会清空之前设置的数据，并重置 HTTP 请求的状态，这会导致之前还未返回响应的请求被重置，从而得不到之前请求的响应结果。</p>
    */
    constructor() {
        this._responseType = null;
        this._data = null;
        this._url = null;
        this._http = new XMLHttpRequest();
    }
    /**
     * 发送 HTTP 请求。
     * @param	url				请求的地址。大多数浏览器实施了一个同源安全策略，并且要求这个 URL 与包含脚本的文本具有相同的主机名和端口。
     * @param	data			(default = null)发送的数据。
     * @param	method			(default = "get")用于请求的 HTTP 方法。值包括 "get"、"post"、"head"。
     * @param	responseType	(default = "text")Web 服务器的响应类型，可设置为 "text"、"json"、"xml"、"arraybuffer"。
     * @param	headers			(default = null) HTTP 请求的头部信息。参数形如key-value数组：key是头部的名称，不应该包括空白、冒号或换行；value是头部的值，不应该包括换行。比如["Content-Type", "application/json"]。
     */
    send(url: string, data?: any, method?: string, responseType?: XMLHttpRequestResponseType, headers?: Array<any>): void {
        (method === void 0) && (method = "get");
        (responseType === void 0) && (responseType = "text");
        this._responseType = responseType;
        this._data = null;
        this._isSend = true

        if (false /* cc.sys.platform is removed in CC 3.8 */) { /* OPPO/VIVO/QQ_PLAY 平台判断失效 */ }

        this._url = url;
        let _this = this;
        let http = this._http;

        http.open(method, url, true);

        // if(AppCustomData.instance.isEdit() && AppCustomData.instance.isNeiWang() && EngineMain.isBrowser && EngineMain.isPC){
        //     let handleEvent = (e)=>{
        //         console.log( `http ${e.type}: ${e.loaded} bytes transferred\n`);
        //     }

        //     let xhr = http
        //     xhr.addEventListener("loadstart", handleEvent);
        //     xhr.addEventListener("load", handleEvent);
        //     xhr.addEventListener("loadend", handleEvent);
        //     xhr.addEventListener("progress", handleEvent);
        //     xhr.addEventListener("error", handleEvent);
        //     xhr.addEventListener("abort", handleEvent);
        // }

        http.ontimeout = function (e) {
            console.error("ontimeout", url);
            // _this.error("ontimeout");
            // _this.destroyEvent()
        }
        http.onerror = function (e) {
            _this._onError(e);
            _this.destroyEvent()
        }
        http.onabort = function (e) {
            _this._onAbort(e);
            _this.destroyEvent()
        }
        http.onprogress = function (e) {
            _this._onProgress(e);
        }
        http.onload = function (e) {
            _this._onLoad(e);
            _this.destroyEvent()
        }
        http.onloadend = function (e) {
            console.log("onloadend");
            _this.clear();
            _this.event("onloadend", "onloadend");
            _this.destroyEvent()
        }
        http.onreadystatechange = function () {
            if (http.readyState == 4 && (http.status >= 200 && http.status < 400)) {
                let response = http.responseText;
                if (response && typeof (response) == "string" && response.indexOf("loginUrl") > 0) {
                    console.log(url);
                } else {
                    console.log(url, response);
                }
            }
        };


        if (headers) {
            for (let i = 0; i < headers.length; i + 2) {
                http.setRequestHeader(headers[i], headers[i + 1]);
            }
        } else {
            if (!data || (typeof data == 'string')) {
                http.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
            }
            else {
                http.setRequestHeader("Content-Type", "application/json");
            }
        }
        let retType: XMLHttpRequestResponseType = responseType !== "arraybuffer" ? "text" : "arraybuffer";
        http.responseType = retType;

        //timeout有兼容性问题，交给父级类定时终止比较好
        // let timeout = this.GetTimeout()
        // if(timeout!=null){
        //     http.timeout = timeout
        // }

        http.send(data);
    }
    protected _onProgress(e: any): void {
        if (e && e.lengthComputable) {
            let progress = 0;
            if (e.total && e.total != 0) {
                progress = e.loaded / e.total
            }
            this.event("progress", progress);
        }
    }
    protected _onAbort(e: any): void {
        this.error("Request was aborted by user");
    }
    protected _onError(e: any): void {
        this.error("Request failed Status:" + this._http.status + " text:" + this._http.statusText);
    }
    protected _onLoad(e: any): void {
        let http = this._http;
        let readyState = http.readyState;
        let status = http.status !== undefined ? http.status : 200;

        if (status === 200 || status === 204 || status === 0) {
            this.complete();
        } else {
            this.error((readyState || "null") + "[" + http.status + "]" + http.statusText + ":" + http.responseURL);
        }
    }
    protected error(message: string): void {
        this.clear();
        console.warn(this.url, message);
        this.event("error", message);
    }
    protected complete(): void {
        this.clear();
        let flag = true;
        try {
            if (this._responseType === "json") {
                this._data = JSON.parse(this._http.responseText);
            } else if (this._responseType === "xml") {
                this._data = Utils.parseXMLFromString(this._http.responseText);
            } else {
                this._data = this._http.response || this._http.responseText;
            }
        } catch (e) {
            flag = false;
            this.error(e.message);
        }
        flag && this.event("complete", (this._data instanceof Array) ? [this._data] : this._data);
    }
    protected clear() {
        let xhr = this._http;
        if (!xhr) { return }
        // let defCallback = HttpRequest.defCallback;
        let defCallback = function () { };
        xhr.onerror = defCallback;
        xhr.onabort = defCallback;
        xhr.onprogress = defCallback;
        xhr.onload = defCallback;

        xhr.ontimeout = defCallback;
        xhr.onloadstart = defCallback;
        xhr.onloadend = defCallback;
        xhr.onreadystatechange = defCallback;
    }
    stop() {
        if (this._isSend == false) return
        let xhr = this._http
        this.destroyEvent()
        xhr.abort()
    }

    destroy() {
        this.clear()
        this.destroyEvent()
        this._http = null;
        this._data = null;
    }

    private destroyEvent() {
        if (this._eventProxy) {
            this._eventProxy.destroy()
            this._eventProxy = null;
        }
    }

}