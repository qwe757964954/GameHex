import { ScriptObject } from "../base/ScriptObject";
import { Pool } from "./Pool";

/*
createPool = (objectName:string){
    pool = new Pool<fgui.GObject>(
        //创建
        () => {
            return this.poolCreateObject(objectName)
        },
        //销毁
        (ret) => {
            ret.destroy()
        },
        //出池
        null,
        //回池
        (ret) => {
            ret.removeFromParent()
            return true
        }
    )
    return pool;
}
*/

/**
 * 缓存池管理
 */
export class PoolMap<T, K extends string | number = string> extends ScriptObject {
    public static __cname: string = "PoolMap";

    private tmPool: Map<K, Pool<T>>;
    private createPool: (name: K) => Pool<T>;
    private caller: any;


    constructor(fCreate: (name: K) => T, fDestroy: (ret: T) => void, fGet?: (t: T, p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any) => void, fReturn?: (ret: T) => boolean) {
        // constructor(createPool: (name: K) => Pool<T>, caller?: any) {
        super()

        this.tmPool = new Map<K, Pool<T>>();

        // this.createPool = createPool
        this.caller = this
        this.createPool = (name) => {
            let pool = new Pool<T>(() => {
                return fCreate(name)
            }, fDestroy, fGet, fReturn)
            return pool
        }
    }

    /**销毁前先全部回池 */
    destroy() {
        for (let [k, v] of this.tmPool) {
            if (v) {
                v.destroy()
            }
        }
        this.tmPool.clear()
        this.tmPool = null;
        this.createPool = null;
        this.caller = null;
        super.destroy()
    }

    /**把使用中的对象全部回池 */
    public returnAllToPool(name?: K, callback?: (v: T) => boolean, caller?: any) {
        if (name == null) {
            if (this.tmPool) {
                for (let [k, v] of this.tmPool) {
                    if (v && v.returnAllToPool != null) {
                        v.returnAllToPool(callback, caller)
                    }
                }
            }
        } else {
            let pool = this.getPool(name)
            if (pool) {
                return pool.returnAllToPool(callback, caller)
            }
        }
    }

    public clear(retainCount?: number, name?: K) {
        if (name == null) {
            for (let [k, v] of this.tmPool) {
                if (v) {
                    v.clear(retainCount)
                }
            }
        } else {
            let pool = this.getPool(name)
            return pool.clear()
        }
    }

    /**返回对象池 */
    public getPool(name: K) {
        let pool = this.tmPool.get(name)
        if (pool == null) {
            if (this.caller != null) { pool = this.createPool.call(this.caller, name) } else { pool = this.createPool(name) }
            this.tmPool.set(name, pool)
        }
        return pool
    }

    isEmpty() {
        let count = 0;
        for (let [k, v] of this.tmPool) {
            if (v) {
                count = count + v.getCountAll();
            }
        }
        return count <= 0;
    }

}