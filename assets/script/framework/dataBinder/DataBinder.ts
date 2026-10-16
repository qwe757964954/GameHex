import { ScriptObject } from "../base/ScriptObject";


export type BindListener<T = any> = (data: T) => void

/**
 * 数据绑定
 * 负责代理一个数据, 变化的时候 可以通知监听者
 */
export class DataBinder<T = any> extends ScriptObject {
    public static __cname: string = "DataBinder";
    private data: T = null
    private tmListener = new Set<BindListener<T>>()
    private init: T
    //移除对象的回调
    private removeCb: (v: T) => void = null
    constructor(init?: T, removeCb?: (v: T) => void) {
        super()
        this.init = init
        this.removeCb = removeCb
    }

    destroy() {
        this.tmListener.clear()
        this.tmListener = null
        super.destroy()
    }

    /**
     * 获取数据
     */
    get(): T {
        return this.data
    }

    /**
     * 修改数据
     * @param data 
     */
    set(data: T) {
        //移除旧数据
        if (this.data != data && this.removeCb != null) {
            this.removeCb(this.data)
        }
        this.data = data
        this.notify()
    }

    reset() {
        this.set(this.init)
    }

    /**
     * 添加监听
     * @param l 
     */
    addBindListener(l: BindListener<T>): BindListener<T> {
        if (this.tmListener.has(l)) {
            this.error("重复添加")
        }
        this.tmListener.add(l)
        l(this.data)
        return l
    }

    /**
     * 移除监听
     * @param l 
     */
    removeBindListener(l: BindListener<T>) {
        if (!this.tmListener.has(l)) {
            this.error("移除不存在的对象")
            return
        }
        this.tmListener.delete(l)
        return l
    }

    /**
     * 通知监听者发生变化
     */
    private notify() {
        for (let l of this.tmListener) {
            l(this.data)
        }
    }
}