import { ScriptObject } from "../base/ScriptObject";
import { BindListener, DataBinder } from "../dataBinder/DataBinder";
import { TmBindListener, TmDataBinder } from "../dataBinder/TmDataBinder";
import { EventCallback } from "../event/EventCallback";
import { EventProxy } from "../event/EventProxy";
import { TExprScript } from "../expr/ExprMgr";
import { FW } from "../FW";
import { Pool } from "../pool/Pool";
import { Timer } from "./Timer";
import { UpdateBeat, UpdateClass } from "./UpdateBeat";

/**
let toolSet = ToolSet.createToolSet();

ToolSet.destroyToolSet(toolSet);

* 整合一些列工具,方便使用, 定时器, 监听事件, 等
*/
export class ToolSet extends ScriptObject {
    public static __cname: string = "ToolSet"

    static createToolSet() {
        return ToolSet.pool.getFromPool()
    }

    static destroyToolSet(v: ToolSet) {
        if (v == null) {
            console.log("destroyToolSet v null")
            return
        }
        v._checkDestroy = 1;
        ToolSet.pool.returnAndDestroy(v)
    }

    private _checkDestroy: number;
    private static pool = new Pool<ToolSet>(() => {
        let tool = new ToolSet();
        return tool
    }, (ret) => {
        ret.destroy()
    });


    /**
     * 创建
     *
    let toolset = ToolSet.createToolSet();
    */
    private constructor() {
        super()
    }

    destroy() {
        if (this._checkDestroy != 1) {
            this.error("请使用 ToolSet.destroyToolSet(v) 销毁")
        }
        this._checkDestroy = null;
        this.removeAll()
        super.destroy()
    }

    public removeAll() {
        this.removeAllTimer()
        this.removeAllDelay()
        this.stopAllUpdateFrame()

        this.removeAllListener()
        this.removeAllDefer(true)

        this.removeAllBindListener()
        this.removeAllTmBindListener()

        this.removeAllCallback()

        this.RemoveAllScriptListener()
    }

    returnPool() {
    }

    // 定时器
    // private _tmTimer: Map<Timer, Timer>;
    // private _tmDelay: Map<Timer, Timer>;
    private _tmTimer: Set<Timer>;
    private _tmDelay: Set<Timer>;

    /**
    let timer = toolset.addTimer(1, (time: Timer) => {
    }, this)
    toolSet.removeTimer(timer)

    toolSet.removeAllTimer()

     * 新增一个定时器, 每隔一定时间调用,直到removeTimer
     * @param delta 间隔时间,单位毫秒
     * @param func 回调函数
     * @param caller this
     * @returns Timer
     */
    addTimer(delta: number, func: (time?: Timer) => void, caller?: destroyable): Timer {
        if (func == null) {
            return
        }
        if (this._tmTimer == null) {
            // this._tmTimer = new Map()
            this._tmTimer = new Set()
        }
        let timer = Timer.getTimer(func, caller, delta, -1)
        // this._tmTimer.set(timer, timer)
        this._tmTimer.add(timer)
        timer.start()
        return timer
    }

    /**
     * 删除一个定时器
     * @param timer AddTimer的返回值
     */
    removeTimer(timer: Timer) {
        if (this._tmTimer == null) {
            return
        }
        // timer = this._tmTimer.get(timer)
        // if (timer == null) {
        //     return
        // }
        if (!this._tmTimer.has(timer)) {
            return
        }
        timer.stop()
        this._tmTimer.delete(timer)
    }

    /**
     * 删除所有定时器
     */
    removeAllTimer() {
        if (this._tmTimer == null) {
            return
        }
        for (let v of this._tmTimer.values()) {
            v.stop()
        }
        this._tmTimer.clear()
        this._tmTimer = null
    }

    /**
     let timer = toolset.addDelay(1, (time: Timer) => {
    }, this)

    toolSet.removeDelay(timer)// 默认执行一次后,就自动删除,不需要手动调用removeDelay

    toolSet.removeAllDelay()

     * 延迟执行
     * @param delay 延迟时间,单位毫秒
     * @param func 执行函数
     */
    addDelay(delay: number, func: (time?: Timer) => void, caller?: destroyable): Timer {
        if (func == null) {
            return
        }
        if (this._tmDelay == null) {
            // this._tmDelay = new Map()
            this._tmDelay = new Set()
        }
        let timer = Timer.getTimer(() => {
            this.removeDelay(timer)
            if (caller) {
                func.call(caller, timer)
            } else {
                func(timer)
            }
        }, this, delay, 1)
        // this._tmDelay.set(timer, timer)
        this._tmDelay.add(timer)
        timer.start()
        return timer
    }

    /**
     * 移除一个延迟函数
     */
    removeDelay(timer: Timer) {
        if (timer == null || this._tmDelay == null) {
            return
        }
        // timer = this._tmDelay.get(timer)
        // if (timer == null) {
        //     return
        // }
        if (!this._tmDelay.has(timer)) {
            return
        }
        timer.stop()
        this._tmDelay.delete(timer)
    }

    /**
     * 移除全部的延迟执行函数
     */
    removeAllDelay() {
        if (this._tmDelay == null) {
            return
        }
        for (let v of this._tmDelay) {
            v.stop()
        }
        this._tmDelay.clear()
        this._tmDelay = null
    }


    //#region EventBeat
    private tmBeat: Set<UpdateClass>

    /**
    let updateClass = toolSet.addUpdateFrame((dt: number) => {
    }, this)
    toolSet.stopUpdateFrame(updateClass)

    toolSet.stopAllUpdateFrame()

     * 启动一个帧事件, 每帧回调
     * @param eventBeat 帧事件, UpdateBeat LateUpdateBeat 等
     * @param func 
     */
    addUpdateFrame(fCallback: (dt: number) => void, caller?: destroyable) {
        if (fCallback == null) {
            return
        }
        if (this.tmBeat == null) {
            this.tmBeat = new Set()
        }
        let updateClass = UpdateBeat.addListener(fCallback, caller)
        this.tmBeat.add(updateClass)
        return updateClass
    }

    /**
     * 屏蔽一个帧事件
     * @param eventBeat  帧事件, UpdateBeat LateUpdateBeat 等
     */
    stopUpdateFrame(updateClass: UpdateClass) {
        if (this.tmBeat == null) {
            return
        }
        if (!this.tmBeat.has(updateClass)) {
            return
        }
        UpdateBeat.removeListener(updateClass)
        this.tmBeat.delete(updateClass)
    }

    /**
     * 屏蔽所以帧事件
     */
    stopAllUpdateFrame() {
        if (this.tmBeat == null) {
            return
        }
        for (let k of this.tmBeat.keys()) {
            UpdateBeat.removeListener(k)
        }
        this.tmBeat.clear()
        this.tmBeat = null
    }


    // 事件
    private _tmEventHandler: Map<any, any>
    /**
    let eventHandler = toolSet.addListener(FW.FWEventCenter.eventProxy, FWEventType.theNextDay, () => {
    }, this)

    toolSet.removeListener(eventHandler)

    toolSet.removeAllListener()

     * 注册一个事件监听, 返回handler
     * @param proxy 
     * @param event 
     * @param caller 
     * @param listener 
     * @returns 
     */
    addListener<T extends string | number>(proxy: EventProxy<T>, event: T, listener: Function, caller?: destroyable) {
        if (this._tmEventHandler == null) {
            this._tmEventHandler = new Map()
        }

        proxy.add(event, listener, caller)

        let handler = {
            proxy: proxy,
            event: event,
            listener: listener,
            caller: caller
        }

        this._tmEventHandler.set(handler, handler)
        return handler
    }

    /**
     * 删除一个事件监听
     * @param handler 
     */
    removeListener(handler: {
        proxy: EventProxy<any>,
        event: any,
        listener: Function,
        caller: destroyable
    }) {
        if (this._tmEventHandler == null) {
            return
        }
        let ret = this._tmEventHandler.get(handler)
        if (ret == null) {
            return
        }

        // 清理
        this._tmEventHandler.delete(handler)

        let proxy: EventProxy<any> = handler.proxy
        if (proxy) {
            proxy.remove(handler.event, handler.listener, handler.caller)
        }
    }

    /**
     * 移除全部的监听
     */
    removeAllListener() {
        if (this._tmEventHandler == null) {
            return
        }
        for (let handler of this._tmEventHandler.values()) {
            if (handler.proxy) {
                let proxy: EventProxy<any> = handler.proxy
                // proxy.removeListener(handler.event, handler.caller, handler.listener)
                proxy.remove(handler.event, handler.listener, handler.caller)
            }
        }
        this._tmEventHandler.clear()
        this._tmEventHandler = null
    }


    //#region DataBinder
    private tmBindListener: Map<any, any>

    /**
    let initData = {}

    let dataBinder = new DataBinder(initData)

    let dataBinderHandler = toolSet.addBindListener(dataBinder, (data) => {
    })

    toolSet.removeBindListener(dataBinderHandler)

    toolSet.removeAllBindListener()

     * 添加一个数据绑定监听, 并返回监听句柄
     * @param binder 
     * @param listener 
     */
    addBindListener<T>(binder: DataBinder<T>, listener: BindListener<T>) {
        if (this.tmBindListener == null) {
            this.tmBindListener = new Map()
        }
        let handler = {
            binder: binder,
            listener: listener
        }

        this.tmBindListener.set(handler, handler)
        binder.addBindListener(listener)
        return handler
    }

    /**
     * 移除数据绑定监听
     * @param handler 
     */
    removeBindListener(handler: {
        binder: DataBinder,
        listener: BindListener
    }) {
        if (this.tmBindListener == null) {
            return
        }
        let binder: DataBinder = handler.binder
        let ret = this.tmBindListener.get(handler)
        if (ret == null) {
            this.error("删除不存在的监听")
            return
        }
        this.tmBindListener.delete(handler)
        if (binder != null) {
            let listener: BindListener = handler.listener
            binder.removeBindListener(listener)
        }
    }

    removeAllBindListener() {
        if (this.tmBindListener == null) {
            return
        }
        // for (const [i, handler] of this.tmBindListener) {
        //     this.removeBindListener(handler)
        // }
        for (let v of this.tmBindListener.values()) {
            let binder: DataBinder = v.binder
            let listener: BindListener = v.listener
            binder.removeBindListener(listener)
        }
        this.tmBindListener.clear()
        this.tmBindListener = null
    }



    //#region tmDataBinder
    private tmTmBindListener: Map<any, any>;

    /**
    let tmDataBinderPlayerBuild = new TmDataBinder<keyType, valueType, extraType>((k, v) => {
    })

    let tmDataBinderHandler = toolSet.addTmBindListener(tmDataBinderPlayerBuild, (k, v, event, extra) => {
    }, "extra")

    toolSet.removeTmBindListener(tmDataBinderHandler)

    toolSet.removeAllTmBindListener()

     * 监听一个tmDataBinder
     * @param binder 
     * @param listener 
     */
    addTmBindListener<K, V, E>(binder: TmDataBinder<K, V, E>, listener: TmBindListener<K, V, E>, extra?: E) {
        if (this.tmTmBindListener == null) {
            this.tmTmBindListener = new Map()
        }
        let handler = {
            binder: binder,
            listener: listener
        }

        this.tmTmBindListener.set(handler, handler)
        binder.addListener(listener, extra)
        return handler
    }

    /**
     * 移除监听
     * @param handler 
     */
    removeTmBindListener(handler: {
        binder: TmDataBinder,
        listener: TmBindListener
    }) {
        if (this.tmTmBindListener == null) {
            return
        }
        let binder: TmDataBinder = handler.binder

        let ret = this.tmTmBindListener.get(handler)
        if (ret == null) {
            this.error("删除不存在的监听")
            return
        }
        this.tmTmBindListener.delete(handler)
        if (binder != null) {
            let listener: TmBindListener = handler.listener
            binder.removeListener(listener)
        }
    }

    /**
     * 移除全部的tmBind监听
     */
    removeAllTmBindListener() {
        if (this.tmTmBindListener == null) {
            return
        }
        // for (const [i, handler] of this.tmTmBindListener) {
        //     this.removeTmBindListener(handler)
        // }
        for (let v of this.tmTmBindListener.values()) {
            let binder: TmDataBinder = v.binder
            let listener: BindListener = v.listener
            binder.removeListener(listener)
        }
        this.tmTmBindListener.clear()
        this.tmTmBindListener = null
    }



    //#region 通过AddDefer加入函数, OnDispose的时候统一执行, 主要是方便写一些销毁逻辑
    tlDefer: Set<() => void>

    /**
    let defFunc = toolSet.addDefer(() => {
        xxx.destroy()
    })
    toolSet.removeDefer(defFunc, false)

    toolSet.removeAllDefer(false)
     * @param defer
     */
    addDefer(defer: () => void) {
        if (this.tlDefer == null) {
            this.tlDefer = new Set()
        }
        this.tlDefer.add(defer)
        return defer
    }

    removeDefer(defer: () => void, execute: boolean) {
        if (defer == null) {
            return
        }
        if (execute) {
            defer()
        }
        if (this.tlDefer == null) {
            return
        }
        this.tlDefer.delete(defer)
    }

    removeAllDefer(execute: boolean) {
        if (this.tlDefer == null) {
            return;
        }
        if (execute) {
            for (let v of this.tlDefer) {
                v()
            }
        }
        this.tlDefer.clear()
        this.tlDefer = null
    }


    //#region Callback
    private tmEventCallback: Map<any, any>

    /**
    let eventCallback0 = new EventCallback()

    let eventCallback = new EventCallback<"OnShopShowChange">()

    let cmdGoodsCallback = new EventCallback<CmdGoods, string, string>()

    let callbackHandler = toolSet.addCallback(cmdGoodsCallback, (cmdGoods, s1, s2) => {
    })

    eventCallback.execute("OnShopShowChange")
    toolSet.removeCallback(callbackHandler)

    toolSet.removeAllCallback()
     * 添加一个回调
     * @param eventCallback 
     * @param callback 
     */
    addCallback<P1, P2, P3, P4, P5, P6>(eventCallback: EventCallback<P1, P2, P3, P4, P5, P6>, callback: TSFunction<P1, P2, P3, P4, P5, P6>): any {
        if (this.tmEventCallback == null) {
            this.tmEventCallback = new Map()
        }
        let handler = {
            eventCallback: eventCallback,
            callback: callback
        }
        this.tmEventCallback.set(handler, handler)
        eventCallback.addCallback(callback)
        return handler
    }

    /**
     * 删除一个回调
     * @param handler 
     */
    removeCallback(handler: {
        eventCallback: EventCallback,
        callback: TSFunction
    }) {
        if (this.tmEventCallback == null) {
            return
        }
        let eventCallback: EventCallback = handler.eventCallback
        if (eventCallback != null) {
            let callback = handler.callback
            eventCallback.removeCallback(callback)
        }
        this.tmEventCallback.delete(handler)
    }

    removeAllCallback() {
        let tm = this.tmEventCallback
        if (tm == null) {
            return
        }
        // for (let [handler, _] of tm) {
        //     this.removeCallback(handler)
        // }
        for (let v of tm.values()) {
            let eventCallback: EventCallback = v.eventCallback
            let callback = v.callback
            eventCallback.removeCallback(callback)
        }
        tm.clear()
        this.tmEventCallback = null
    }

    //#region Script
    private _tmScriptListener: Map<any, any>
    // 在注册时自动调用一次(有可能会响应过早导致实际数据还没有，会报空，需要做报空处理)
    AddScriptListener(script: TExprScript, listener: Function, caller: destroyable) {

        if (this._tmScriptListener == null) {
            this._tmScriptListener = new Map()
        }

        FW.ExprMgr.AddScriptRef(script)
        let handler = FW.ExprMgr.AddScriptListener(script, listener, caller)
        this._tmScriptListener.set(handler, handler)
        let result = FW.ExprMgr.GetResult(script)
        listener.call(caller, result)
        return handler
    }
    RemoveScriptListener(handler: ReturnType<ToolSet['AddScriptListener']>) {
        if (this._tmScriptListener == null) {
            return
        }
        let ret = this._tmScriptListener.get(handler)
        if (ret == null) {
            return
        }

        // 清理
        this._tmScriptListener.delete(handler)

        FW.ExprMgr.RemoveScriptListener(handler)
        FW.ExprMgr.RemoveScriptRef(handler.event)

    }
    RemoveAllScriptListener() {
        if (this._tmScriptListener == null) {
            return
        }
        for (let handler of this._tmScriptListener.values()) {
            if (handler) {
                FW.ExprMgr.RemoveScriptListener(handler)
                FW.ExprMgr.RemoveScriptRef(handler.event)
            }
        }
        this._tmScriptListener.clear()
        this._tmScriptListener = null
    }
    //#endregion
}