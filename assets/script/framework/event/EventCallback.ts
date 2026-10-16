import { ScriptObject } from "../base/ScriptObject";

export class EventCallback<P1 = any, P2 = any, P3 = any, P4 = any, P5 = any, P6 = any> extends ScriptObject {
    public static __cname: string = "EventCallback";

    private tmCallback = new Set<TSFunction<P1, P2, P3, P4, P5, P6>>()
    private tmCallbackLater = new Set<TSFunction<P1, P2, P3, P4, P5, P6>>()
    private tmCallbackTemp = new Set<TSFunction<P1, P2, P3, P4, P5, P6>>()

    private isDispatching = false
    destroy() {
        this.removeAllCallback()
        this.tmCallback = null
        this.tmCallbackLater = null
        this.tmCallbackTemp = null
        super.destroy()
    }

    getIsEmpty(): boolean {
        return this.tmCallback.size <= 0 && this.tmCallbackLater.size <= 0;
    }

    removeAllCallback() {
        // this.assert(!this.isDispatching)
        this.tmCallback.clear()
        this.tmCallbackLater.clear()
        this.tmCallbackTemp.clear()
    }

    /**
     * 在执行过程中添加的回调,在下一次执行才会调用
     * @param callback 
     * @returns 
     */
    addCallback(callback: TSFunction<P1, P2, P3, P4, P5, P6>) {
        let has = this.tmCallback.has(callback)
        if (!has) {
            if (this.isDispatching) {
                this.tmCallbackLater.add(callback)
            } else {
                this.tmCallback.add(callback)
            }
        } else {
            this.error("回调重复添加")
        }

        return callback
    }
    removeCallback(callback: TSFunction<P1, P2, P3, P4, P5, P6>) {
        // this.assert(!this.isDispatching)
        this.tmCallback.delete(callback)
        this.tmCallbackLater.delete(callback)
    }

    // invoke execute
    execute(p1?: P1, p2?: P2, p3?: P3, p4?: P4, p5?: P5, p6?: P6) {
        let t = this
        t.isDispatching = true

        let tmCallbackTemp = t.tmCallbackTemp
        tmCallbackTemp.clear();
        t.tmCallback.forEach((v, k, m) => {
            tmCallbackTemp.add(v)
        })
        tmCallbackTemp.forEach((v, k, m) => {
            v(p1, p2, p3, p4, p5, p6)
        })
        tmCallbackTemp.clear();

        t.tmCallbackLater.forEach((v, k, m) => {
            t.tmCallback.add(v)
        })
        t.tmCallbackLater.clear();

        t.isDispatching = false
    }
}