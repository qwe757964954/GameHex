import { ScriptObject } from "../base/ScriptObject";
import { EventProxy } from "./EventProxy";


/**如果要执行异步操作,事件的使用要慎重 */
export enum FWEventType {
    /** 服务器的重置时间 */
    theNextDay,

    onHide,
    onShow,

    /**窗口大小变化 */
    viewResize
}


export class FWEventCenter extends ScriptObject {
    public static __cname: string = "FWEventCenter";
    static _instance: FWEventCenter
    static get instance(): FWEventCenter {
        if (FWEventCenter._instance == null) {
            FWEventCenter._instance = new FWEventCenter()
        }
        return FWEventCenter._instance
    }

    private _eventProxy: EventProxy<FWEventType>
    get eventProxy() {
        return this._eventProxy
    }

    constructor() {
        super()
        this._eventProxy = new EventProxy<FWEventType>()
    }

    destroy() {
        if (this._eventProxy) {
            this._eventProxy.destroy()
            this._eventProxy = null
        }
        super.destroy()
    }

    public removeCallerListener(caller: object) {
        this._eventProxy?.removeCallerListener(caller)
    }

    public dispatchNextDayEvent() {
        this._eventProxy.execute(FWEventType.theNextDay)
    }

    public setViewResizeEvent(caller: object, listener: Function) {
        this._eventProxy.addListener(FWEventType.viewResize, caller, listener)
    }
    public removeViewResizeEvent(caller: object, listener: Function) {
        this._eventProxy.removeListener(FWEventType.viewResize, caller, listener)
    }
    public dispatchViewResizeEvent() {
        this._eventProxy.execute(FWEventType.viewResize)
    }

    public addOnHide(caller: object, listener: Function) {
        this._eventProxy.addListener(FWEventType.onHide, caller, listener)
    }
    public removeOnHide(caller: object, listener: Function) {
        this._eventProxy.removeListener(FWEventType.onHide, caller, listener)
    }
    public dispatchOnHide() {
        this._eventProxy.execute(FWEventType.onHide)
    }

    public addOnShow(caller: object, listener: Function) {
        this._eventProxy.addListener(FWEventType.onShow, caller, listener)
    }
    public removeOnShow(caller: object, listener: Function) {
        this._eventProxy.removeListener(FWEventType.onShow, caller, listener)
    }
    public dispatchOnShow() {
        this._eventProxy.execute(FWEventType.onShow)
    }

}
