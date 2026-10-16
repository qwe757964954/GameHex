import { ScriptObject } from "../base/ScriptObject";

export type TmBindEvent = "OnAdd" | "OnRemove" | "OnReplace" | "OnUpdate"
export type TmBindListener<K = any, V = any, E = any> = (k: K, v: V, event: TmBindEvent, extra?: E) => void

/**
 * Map类型数据绑定
 * 负责代理一个Map数据, 变化的时候 可以通知监听者
 */
export class TmDataBinder<K = any, V = any, E = any> extends ScriptObject {
    public static __cname: string = "TmDataBinder";
    //缓存所有数据
    private tm: Map<K, V> = new Map<K, V>()
    //缓存监听者
    private tmListener = new Set<TmBindListener<K, V, E>>()
    //移除对象的回调
    private removeCb: (k: K, v: V) => void = null
    constructor(removeCb?: (k: K, v: V) => void) {
        super()
        this.removeCb = removeCb
    }

    destroy() {
        if (this.removeCb) {
            for (let [k, v] of (this.tm)) {
                this.removeCb(k, v)
            }
        }

        this.tm.clear()
        this.tm = null

        this.tmListener.clear()
        this.tmListener = null

        super.destroy()
    }

    /**
     * 获取全部数据
     */
    getTm(): Map<K, V> {
        return this.tm
    }

    /**
     * 获取一项数据
     * @param k 
     */
    get(k: K): V {
        return this.tm.get(k)
    }

    removeAll(extra?: E) {
        if (this.removeCb) {
            for (let [k, v] of (this.tm)) {
                this.notify(k, v, 'OnRemove', extra)
                this.removeCb(k, v)
            }
        } else {
            for (let [k, v] of (this.tm)) {
                this.notify(k, v, 'OnRemove', extra)
            }
        }
        this.tm.clear()
    }

    /**
     * 添加或更新一个数据
     * @param k 主键
     * @param v 
     * @param extra 
     */
    addOrReplace(k: K, v: V, extra?: E) {
        if (v == null) {
            this.error('添加空对象')
            return;
        }
        let tm = this.tm
        let old = tm.get(k)
        if (old) {
            if (this.removeCb) {
                this.removeCb(k, old)
            }
            tm.set(k, v)
            this.notify(k, v, "OnReplace", extra)
        } else {
            tm.set(k, v)
            this.notify(k, v, "OnAdd", extra)
        }
    }

    /**
     * 添加一个对象
     * @param k 主键
     * @param v 对象
     * @param extra Notify的透传
     */
    add(k: K, v: V, extra?: E) {
        if (v == null) {
            this.error('添加空对象')
            return;
        }

        let tm = this.tm
        if (tm.get(k)) {
            this.error("重复添加", k, v)
            return
        } else {
            tm.set(k, v)
            this.notify(k, v, "OnAdd", extra)
        }
    }

    /**
     * 删除一个对象
     * @param k 主键
     * @param extra Notify的透传
     */
    remove(k: K, extra?: E) {
        let tm = this.tm
        let v = tm.get(k)
        if (v == null) {
            this.error("删除不存在的对象", (k), (v))
            return
        }

        tm.set(k, null)
        this.notify(k, v, "OnRemove", extra)
        if (this.removeCb) {
            this.removeCb(k, v)
        }
    }

    /**
     * 标记某个对象发送变化
     * @param k 
     */
    update(k: K, extra?: E) {
        let tm = this.tm
        let v = tm.get(k)
        if (v == null) {
            this.error("更新一个不存在的对象", (k))
            return
        }

        this.notify(k, v, "OnUpdate", extra)
    }

    /**
     * 添加监听
     * @param l 
     * @param 透传
     */
    addListener(l: TmBindListener<K, V, E>, extra?: E) {
        this.tmListener.add(l)
        for (let [k, v] of (this.tm)) {
            //this.notify(k,v, "OnAdd", extra)
            l(k, v, "OnAdd", extra)
        }
        return l
    }

    removeListener(l: TmBindListener<K, V, E>) {
        this.tmListener.delete(l)
    }

    /**
     * 通知监听
     * @param k 
     * @param v 
     * @param event 
     * @param extra 
     */
    protected notify(k: K, v: V, event: TmBindEvent, extra?: any) {
        for (let l of this.tmListener) {
            l(k, v, event, extra)
        }
    }

}