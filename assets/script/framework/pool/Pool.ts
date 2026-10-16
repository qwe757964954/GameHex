import { ScriptObject } from "../base/ScriptObject";
// import { Timer } from "../utils/Timer";

/**
 * 通用对象池, 用来复用各种对象
 */
export class Pool<T, T1 = any, T2 = any, T3 = any, T4 = any, T5 = any, T6 = any> extends ScriptObject {
    public static __cname: string = "Pool";

    // 记录修建过的缓存池.方便管理和检查缓存使用情况
    static tmPool = new Set<Pool<any>>();
    // static poolTimer: Timer;

    private _createCount = 0;
    get createCount() {
        return this._createCount;
    }

    /**创建 */
    private fCreate: () => T
    /**销毁 */
    private fDestroy: (ret: T) => void
    // 出池,可做初始化
    private fGet: (t: T, p1?: T1, p2?: T2, p3?: T3, p4?: T4, p5?: T5, p6?: T6) => void
    /**回池,可做移除处理 */
    private fReturn: (ret: T) => boolean

    private inCacheList: Array<T>
    private inUseList: Array<T>
    // 保存缓存信息(手池时间)
    private tmCache: Map<T, number>

    private _flag: string = "=";
    get flag() { return this._flag; };
    set flag(v: string) { this._flag = v; };
    public retainCount:number

    static getTimeNow() { return Date.now() }

    /**
     * @param fCreate 创建时调用
     * @param fDestroy 清理池时，会对池中所有对象进行fDestroy
     * @param fGet 从池里面拿出来（调用GetFromPool）的回调，参数1为对象，最多支持传3个参数
     * @param fReturn 回池触发的回调（调用ReturnToPool）的回调，如返回false将不回池
     * @param retainCount 定时触发清空对象池，需要保留的数量
    */
    constructor(fCreate: () => T, fDestroy: (ret: T) => void, fGet?: (t: T, p1?: T1, p2?: T2, p3?: T3, p4?: T4, p5?: T5, p6?: T6) => void, fReturn?: (ret: T) => boolean, retainCount: number = 10) {
        super()
        let t = this
        this._createCount = 0;
        this.fCreate = fCreate
        this.fDestroy = fDestroy
        this.fGet = fGet
        this.fReturn = fReturn

        this.inCacheList = new Array<T>()
        this.inUseList = new Array<T>()
        this.tmCache = new Map<T, number>()
        this.retainCount = retainCount

        Pool.tmPool.add(this)

        // if (!Pool.poolTimer) {
        //     // 一段时间检测一次,删除长时间不用的缓存
        //     let timer = Timer.getTimer(Pool.timeUpdate, null, 3000, -1)
        //     timer.start()
        //     Pool.poolTimer = timer
        // }
    }

    // private static timeUpdate() {
    //     let tmPool = Pool.tmPool;
    //     tmPool.forEach((v1, v2, s) => {
    //         v1.clear(3)
    //     })
    // }

    /**销毁前先全部回池 */
    destroy() {
        let useCount = this.inUseList.length;
        let cacheCount = this.inCacheList.length;
        let count = useCount + cacheCount;

        if (this.inUseList.length > 0) {
            // 没回池就销毁,有可能没有调用fReturn,fDestroy导致内存泄露
            // 可以调用returnAllToPool把使用中的先回池再销毁
            // .returnAllToPool();
            // .destroy();
            this.error("Pool没回池完毕,不会调用fReturn fDestroy,会导致内存泄露", this.flag, "缓存数量: " + this.getCount(), "使用数量: " + this.getUseCount())
        }
        if (count != this._createCount) {
            this.error("缓存数量异常: ", this._createCount, cacheCount, useCount)
        }
        this.clear()
        this.inUseList.length = 0;
        this.inUseList = null;
        this.inCacheList.length = 0;
        this.inCacheList = null;
        this.tmCache.clear()
        this.tmCache = null
        super.destroy()
        Pool.tmPool.delete(this)
    }

    /**
     * 从池里面拿一个对象
     * @param p1,p2,p3为传到fGet的参数
     * @return 返回对象
    */
    public getFromPool(p1?: T1, p2?: T2, p3?: T3, p4?: T4, p5?: T5, p6?: T6): T {
        let ret: T;
        let inCacheCount = this.inCacheList.length
        if (inCacheCount <= 0) {
            ret = this.fCreate()
            if (ret == null) { return null }
            if (this._flag === "=" && typeof (ret) == "object") {
                let flag = ret["poolFlag"] || ret["__className"] || ret["__proto__"]["constructor"]["__cname"] || ret["name"] || ret["resourceObjName"];
                if (!flag && ret?.constructor?.name != "Array") {
                    this.error("请设置一下缓存标志poolFlag,方便检查", ret)
                    flag = ""
                }
                this._flag = flag
            }
            this._createCount++;
        } else {
            ret = this.inCacheList.pop()
            this.tmCache.delete(ret)
        }
        if (this.fGet != null) {
            this.fGet(ret, p1, p2, p3, p4, p5, p6)
        }
        this.inUseList.push(ret)
        return ret
    }

    /**
     * 将一个对象回池
     * @param ret 对象
     * @returns 返回是否成功回池
     */
    public returnToPool(ret: T): boolean {
        if (ret == null) {
            this.error("returnToPool null", ret)
            return false
        }
        // 删除使用中的 (swap-with-last替代splice,避免O(n)数组移动)
        let index = this.inUseList.indexOf(ret)
        if (index == -1) {
            let isOK = false
            let inCacheList = this.inCacheList
            for (let cache of inCacheList) {
                if (ret == cache) {
                    isOK = true
                    break
                }
            }
            if (isOK) {
                this.error("该对象已回过池了,不需要重复回池", ret)
            } else {
                this.error("不是这里创建的,不能在这里回池", ret)
            }
            return false
        }
        // swap-with-last然后pop,O(1)替代splice的O(n)
        let lastIdx = this.inUseList.length - 1
        if (index !== lastIdx) {
            this.inUseList[index] = this.inUseList[lastIdx]
        }
        this.inUseList.pop()
        return this.returnToPoolHelp(ret)
    }

    /**
     * 回池并销毁,只是为了调用回池和销毁函数,对象不会回池
     * @param ret 对象
     * @returns 是否成功
     */
    public returnAndDestroy(ret: T) {
        let t = this
        let isOK = t.returnToPool(ret)
        if (isOK) {
            // swap-with-last替代splice,O(1)操作
            let index = t.inCacheList.indexOf(ret)
            if (index == -1) {
                t.error("找不到刚入池对象,离谱")
                return false
            }
            let lastIdx = t.inCacheList.length - 1
            if (index !== lastIdx) {
                t.inCacheList[index] = t.inCacheList[lastIdx]
            }
            t.inCacheList.pop()
            t.tmCache.delete(ret)
            if (t.fDestroy != null) {
                t.fDestroy(ret)
            }
            t._createCount--;
            return true
        }
        return false
    }

    /**
     * 将所有对象回池 (优化: 避免循环内 splice O(n²)，改为分批处理)
    */
    public returnAllToPool(callback?: (v: T) => boolean, caller?: any) {
        let t = this;
        let inUseList = t.inUseList;

        if (callback == null) {
            // 直接回池全部,避免splice → 先全部回池再清空
            for (let i = 0, len = inUseList.length; i < len; i++) {
                t.returnToPoolHelp(inUseList[i])
            }
            inUseList.length = 0
        } else {
            // 有callback时,收集不回池的索引,最后swap-remove
            let keepItems: T[] = []
            for (let i = 0, len = inUseList.length; i < len; i++) {
                let ret = inUseList[i]
                let shouldReturn = caller ? callback.call(caller, ret) : callback(ret)
                if (shouldReturn) {
                    t.returnToPoolHelp(ret)
                } else {
                    keepItems.push(ret)
                }
            }
            inUseList.length = 0
            for (let item of keepItems) {
                inUseList.push(item)
            }
        }
    }

    private returnToPoolHelp(ret: T): boolean {
        // 回池
        if (this.fReturn && !this.fReturn(ret)) {
            return false
        }
        // 放入内存池
        this.inCacheList.push(ret)
        this.tmCache.set(ret, Pool.getTimeNow())
        return true
    }

    /**
     * 清空池,清已经回池的对象
     * @param 保留的对象数量，不填为清空所有
    */
    public clear(retainCount?: number) {
        let t = this;
        if (retainCount == null) {
            retainCount = 0
        }
        let inCacheList = t.inCacheList
        if (retainCount >= inCacheList.length) {
            return
        }

        if (t.fDestroy != null) {
            while (inCacheList.length > retainCount) {
                // let ret = inCacheList.shift()
                let ret = inCacheList.pop()
                t.fDestroy(ret)
                t.tmCache.delete(ret)
                t._createCount--;
            }
        } else {
            while (inCacheList.length > retainCount) {
                let ret = inCacheList.pop()
                t.tmCache.delete(ret)
                t._createCount--;
            }
        }
    }

    /**
     * 池里面对象数量
     * @return 返回数量
    */
    public getCount(): number {
        return this.inCacheList.length
    }

    public getUseCount(): number {
        return this.inUseList.length
    }

    get getTlUseObj() {
        return this.inUseList
    }

    getCountAll() {
        let useCount = this.inUseList.length;
        let cacheCount = this.inCacheList.length;
        let count = useCount + cacheCount;
        return count;
    }

    static clearAllPool() {
        let tmPool = Pool.tmPool;
        tmPool.forEach((v1, v2, s) => {
            v1.clear()
        })
    }
}