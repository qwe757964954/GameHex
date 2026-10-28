import { ScriptObject } from '../base/ScriptObject';
import { TMap } from '../collection/TMap';
import { Log } from '../log/Log';
import { Utils } from '../utils/Utils';

/*
事件代理  使用事例
enum A
{
    a,b,c
}

let eventProxy = new fnevent.EventProxy<A>()
eventProxy.add(A.a, this.test, this)

this.debug("派发一次")
eventProxy.execute(A.a)

eventProxy.remove(A.a, this.test, this)

this.debug("派发二次")
eventProxy.execute(A.a)
*/

export class EventProxy<T extends number | string> extends ScriptObject {
    public static __cname: string = "EventProxy";

    private _tmEvent: TMap<T, EventHelp>;
    // private _tmEventCaller: TMap<any, number>;
    tmEventCaller = new TMap<any, number>();
    private readonly callerCleanups = new Map<object, Set<() => void>>();

    addCallerCleanup(caller: object, cleanup: () => void): () => void {
        if (this.destroyed) {
            cleanup();
            return () => {};
        }
        const cleanups = this.callerCleanups.get(caller) ?? new Set<() => void>();
        cleanups.add(cleanup);
        this.callerCleanups.set(caller, cleanups);
        return () => {
            cleanups.delete(cleanup);
            if (cleanups.size === 0 && this.callerCleanups.get(caller) === cleanups) {
                this.callerCleanups.delete(caller);
            }
        };
    }

    private releaseCallerCleanups(caller: object): void {
        const cleanups = this.callerCleanups.get(caller);
        if (!cleanups) return;
        this.callerCleanups.delete(caller);
        for (const cleanup of cleanups) cleanup();
    }

    constructor() {
        super()
        this._tmEvent = new TMap<T, EventHelp>();
        // this._tmEventCaller = new TMap<any, number>();
    }

    destroy() {
        this.removeAll()
        this._tmEvent = null;
        // this._tmEventCaller = null;
        super.destroy()
    }

    addListener(event: T, caller: object, listener: Function): void {
        this.addWithCaller(event, listener, caller)
    }

    removeListener(event: T, caller: object, listener: Function): void {
        this.removeWithCaller(event, listener, caller)
    }

    removeCallerListener(caller: object) {
        let t = this;
        if (t.destroyed) {
            return
        }
        t.assert(caller != null)

        let num = t.tmEventCaller.get(caller)
        if (num == null || num <= 0) {
            t.releaseCallerCleanups(caller);
            return
        }

        let _tmEvent = t._tmEvent
        let keys = _tmEvent.keys
        for (let i = 0, len = keys.length; i < len; i++) {
            let eventHelp = _tmEvent.get(keys[i])
            eventHelp.removeCallerListener(caller)
        }

        num = t.tmEventCaller.get(caller)
        if (num != null && num > 0) {
            t.error("有事件没清理removeCallerListener", num)
        }
        t.releaseCallerCleanups(caller);
    }


    /**
     * 派发一个事件,在执行事件中的某个事件又添加了监听,本次不会被触发
     * @param event 事件
     * @param pn 事件的数据
     */
    execute(event: T, p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any) {
        if (this.destroyed) {
            return
        }

        let eventHelp = this._tmEvent.get(event)

        if (!eventHelp) {
            return
        }

        eventHelp.execute(p1, p2, p3, p4, p5, p6)
    }

    /**
     * 添加对象归属的监听；归属失效后停止派发，持有方仍须显式解绑。
     * @param event 事件类型
     * @param listener 回调
    * @param caller 对象,可以传空
     */
    add(event: T, listener: Function, caller?: object) {
        if (this.destroyed) {
            return
        }
        if (listener == null) {
            this.error("add listener null")
            return
        }
        let eventHelp = this._tmEvent.get(event)
        if (eventHelp == null) {
            eventHelp = new EventHelp(this.tmEventCaller)
            // eventHelp._tmEventCaller = this._tmEventCaller;
            this._tmEvent.set(event, eventHelp)
        }
        return eventHelp.add(listener, caller)
    }
    addWithCaller(event: T, listener: Function, caller: object) {
        this.assert(caller != null)
        this.add(event, listener, caller)
    }

    /**
     * 通过原处理函数与原归属对象解除监听。
     * @param event 事件类型
     * @param listener 回调
    * @param caller 对象,可以传空
    */
    remove(event: T, listener: Function, caller?: object) {
        if (this.destroyed) {
            return
        }
        if (listener == null) {
            this.error("remove listener null")
            return
        }

        let eventHelp = this._tmEvent.get(event)
        if (eventHelp == null) {
            return
        }
        eventHelp.remove(listener, caller)
    }

    removeWithCaller(event: T, listener: Function, caller: object) {
        if (this.destroyed) {
            return
        }
        this.assert(caller != null)
        this.remove(event, listener, caller)
    }

    removeEvent(event: T) {
        if (this.destroyed) {
            return
        }
        let eventHelp = this._tmEvent.get(event)
        if (eventHelp == null) {
            return
        }
        eventHelp.removeAll()
        if (eventHelp.destroyed) {
            this._tmEvent.remove(event)
        }
    }

    removeAll() {
        if (this.destroyed) return;
        let t = this;
        if (t.destroyed) {
            return
        }
        let keys = t._tmEvent.keys
        for (let i = 0, len = keys.length; i < len; i++) {
            t.removeEvent(keys[i])
        }
        t._tmEvent.clear()

        // 清理tmEventCaller残留引用,避免僵尸引用累积
        t.tmEventCaller.clear()
        for (const caller of [...t.callerCleanups.keys()]) t.releaseCallerCleanups(caller);

        let count = t.tmEventCaller.keys.length
        if (count > 0) {
            t.error("有事件没清理removeAll", count)
        }
    }
}

class EventHelp {

    tlEventListenerLater: EventListener[] = []
    tlEventListener: EventListener[] = []

    tlEventListenerTemp: EventListener[] = []

    // tmEventCaller = new TMap<any, EventListener>();
    tmEventCaller: TMap<any, number>;

    // dirty = false
    private executing = false
    destroyed = false

    constructor(tmEventCaller: TMap<any, number>) {
        this.tmEventCaller = tmEventCaller
    }

    execute(p1: any, p2: any, p3: any, p4?: any, p5?: any, p6?: any) {
        let t = this;
        let tlEventListener = t.tlEventListener;
        let count = tlEventListener.length
        if (count <= 0) {
            return
        }

        t.executing = true

        if (count == 1) {
            let eventListener = tlEventListener[0]
            if (!eventListener.destroyed) {
                eventListener.execute(p1, p2, p3, p4, p5, p6)
                if (t.destroyed) {
                    t.executing = false
                    return
                }
            }
        } else {
            let tlEventListenerTemp = t.tlEventListenerTemp
            tlEventListenerTemp.length = 0;
            for (let i = 0; i < count; i++) {
                tlEventListenerTemp.push(tlEventListener[i])
            }

            for (let i = 0; i < count; i++) {
                let eventListener = tlEventListenerTemp[i]
                if (!eventListener.destroyed) {
                    eventListener.execute(p1, p2, p3, p4, p5, p6)
                    // if (eventListener.autoremove) {
                    // t.destroyEventListener(eventListener)
                    // t.remove(eventListener.callback, eventListener.caller)
                    // }
                    // --可能在执行listener的过程中回调执行了remove，所以需要检测一次是否退出
                    if (t.destroyed) {
                        t.executing = false
                        t.tlEventListenerTemp.length = 0
                        return
                    }
                }
            }

            t.tlEventListenerTemp.length = 0
        }

        // 触发完后，再执行缓存的塞入检测
        // if (t.dirty) {
        let tlEventListenerLater = this.tlEventListenerLater;
        for (let i = 0, len = tlEventListenerLater.length; i < len; i++) {
            let eventListener = tlEventListenerLater[i]
            t.tlEventListener.push(eventListener)
        }
        tlEventListenerLater.length = 0;
        //     t.dirty = false
        // }

        t.executing = false
    }

    add(callback: Function, caller: any) {
        let eventListener = this.has(callback, caller)
        if (eventListener == null) {
            if (caller != null) {
            }
            eventListener = EventListener.create()
            eventListener.add(callback, caller)

            if (this.executing) {
                // this.dirty = true
                this.tlEventListenerLater.push(eventListener)
            } else {
                this.tlEventListener.push(eventListener)
            }
            this.addTmEventListener(eventListener)

            // if (caller != null) {
            //     let num = this._tmEventCaller.get(caller)
            //     if (num == null) {
            //         num = 1
            //     } else {
            //         num++;
            //     }
            //     this._tmEventCaller.set(caller, num)
            // }

            return eventListener
        } else {
            Utils.error("事件重复添加")
        }
        return null;
    }

    remove(callback: Function, caller?: any) {
        let t = this;
        let tlEventListener = t.tlEventListener;

        let isOK = false

        for (let i = tlEventListener.length - 1; i >= 0; i--) {
            let eventListener = tlEventListener[i]
            if (eventListener.callback == callback && eventListener.caller == caller) {
                t.destroyEventListener(eventListener)
                tlEventListener.splice(i, 1)
                isOK = true
                break
            }
        }

        if (!isOK) {
            let tlEventListenerLater = t.tlEventListenerLater;
            for (let i = tlEventListenerLater.length - 1; i >= 0; i--) {
                let eventListener = tlEventListenerLater[i]
                if (eventListener.callback == callback && eventListener.caller == caller) {
                    t.destroyEventListener(eventListener)
                    tlEventListenerLater.splice(i, 1)
                    isOK = true
                    break
                }
            }
        }

        return isOK
    }

    removeCallerListener(caller: any) {
        if (!caller) {
            return
        }
        let t = this;
        let tlEventListener = t.tlEventListener;

        for (let i = tlEventListener.length - 1; i >= 0; i--) {
            let eventListener = tlEventListener[i]
            if (eventListener.caller == caller) {
                t.destroyEventListener(eventListener)
                tlEventListener.splice(i, 1)
            }
        }

        let tlEventListenerLater = t.tlEventListenerLater;
        for (let i = tlEventListenerLater.length - 1; i >= 0; i--) {
            let eventListener = tlEventListenerLater[i]
            if (eventListener.caller == caller) {
                t.destroyEventListener(eventListener)
                tlEventListenerLater.splice(i, 1)
            }
        }
    }

    removeAll() {
        let t = this
        let tlEventListener = t.tlEventListener;
        for (let i = tlEventListener.length - 1; i >= 0; i--) {
            t.destroyEventListener(tlEventListener[i])
        }
        t.tlEventListener.length = 0;
        // t.tlEventListener = null;

        let tlEventListenerLater = t.tlEventListenerLater;
        for (let i = tlEventListenerLater.length - 1; i >= 0; i--) {
            t.destroyEventListener(tlEventListenerLater[i])
        }
        t.tlEventListenerLater.length = 0;
        // t.tlEventListenerLater = null;

        t.tlEventListenerTemp.length = 0

        // t.dirty = false
        // t.executing = false
        t.destroyed = true  // 修复: 标记已销毁,使EventProxy.removeEvent可以正确从tmEvent中移除
    }

    has(callback: Function, caller: any) {
        // 有caller,caller是唯一的(一样的事件,同样的caller只能添加一次)
        let tlEventListener = this.tlEventListener;
        for (let i = 0, len = tlEventListener.length; i < len; i++) {
            let eventListener = tlEventListener[i]
            if (caller != null) {
                if (eventListener.caller == caller) {
                    return eventListener
                }
            } else {
                if (eventListener.callback == callback && eventListener.caller == caller) {
                    return eventListener
                }
            }
        }
        let tlEventListenerLater = this.tlEventListenerLater;
        for (let i = 0, len = tlEventListenerLater.length; i < len; i++) {
            let eventListener = tlEventListenerLater[i]
            if (caller != null) {
                if (eventListener.caller == caller) {
                    return eventListener
                }
            } else {
                if (eventListener.callback == callback && eventListener.caller == caller) {
                    return eventListener
                }
            }
        }
        return null;
    }

    private addTmEventListener(eventListener: EventListener) {
        let caller = eventListener.caller
        if (caller != null) {
            // this.tmEventCaller.set(caller, eventListener)
            let num = this.tmEventCaller.get(caller)
            if (num == null) {
                num = 1
            } else {
                num = num + 1;
            }
            this.tmEventCaller.set(caller, num)
        }
    }

    private removeTmEventListener(eventListener: EventListener) {
        let caller = eventListener.caller
        if (caller != null) {
            let num = this.tmEventCaller.get(caller)
            num = num - 1;
            if (num > 0) {
                this.tmEventCaller.set(caller, num)
            } else {
                this.tmEventCaller.remove(caller)
            }
        }
    }

    private destroyEventListener(eventListener: EventListener) {
        if (eventListener) {
            this.removeTmEventListener(eventListener)
            eventListener.destroy()
        }
    }
}


class EventListener {
    static idx = 0;

    static tlEventListenerPool: EventListener[] = []

    static create() {
        let eventListener = EventListener.tlEventListenerPool.pop()
        if (eventListener == null) {
            eventListener = new EventListener()
        }
        return eventListener
    }

    id: number;
    //自动移除
    // autoremove: boolean
    destroyed = true

    //调用者
    caller: any
    callback: Function

    destroy() {
        let t = this
        t.destroyed = true
        t.caller = null;
        t.callback = null;
        // t.autoremove = null;
        t.id = null;
        EventListener.tlEventListenerPool.push(t)
    }

    add(callback: Function, caller: any) {
        EventListener.idx++;
        let t = this
        t.id = EventListener.idx;
        t.callback = callback
        t.caller = caller
        // t.autoremove = false
        t.destroyed = false
    }

    execute(p1: any, p2: any, p3: any, p4: any, p5: any, p6: any): boolean {
        let t = this;
        if (t.destroyed) {
            return false
        }
        if (t.caller != null) {
            if (t.caller.destroyed === true) {
                return false
            }
            t.callback.call(t.caller, p1, p2, p3, p4, p5, p6)
        } else {
            t.callback(p1, p2, p3, p4, p5, p6)
        }
        return true;
    }
}

