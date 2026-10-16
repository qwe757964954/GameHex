import { ScriptObject } from "../base/ScriptObject"
import { Pool } from "../pool/Pool"

export abstract class Yieldable extends ScriptObject {
    isInit = false
    abstract OnInit(time: number): void
    abstract OnUpdate(time: number): [boolean, ...any]
    protected OnGetFromPool(...args: any[]) {}
    protected OnReturnToPool(): boolean {
        return true
    }
    Update(time: number): [boolean, ...any] {
        if (this.isInit == false) {
            this.isInit = true
            this.OnInit(time)
        }
        let [result, ...args] = this.OnUpdate(time)
        if (result) {
            Yieldable.ReturnToPool(this)
        }
        return [result, ...args]
    }

    //#region 对象池实现
    private static tmPool = new Map<Class<Yieldable>, Pool<Yieldable>>()
    private static tmObject2Clazz = new Map<Yieldable, Class<Yieldable>>()
    static GetOrCreate<T extends Yieldable>(clazz: Class<T>, ...args): T {
        let pool = this.tmPool.get(clazz)
        if (pool == null) {
            pool = new Pool<Yieldable>(
                () => {
                    return new clazz()
                },
                (object) => {
                    if (object) {
                        object.destroy()
                    }
                },
                (object, ...p) => {
                    object.GetFromPool(...p)
                },
                (object) => {
                    return object.ReturnToPool()
                }
            )
            this.tmPool.set(clazz, pool)
        }
        let obj = pool.getFromPool(...args)
        this.tmObject2Clazz.set(obj, clazz)
        return obj as T
    }
    static ReturnToPool(obj: Yieldable) {
        let clazz = this.tmObject2Clazz.get(obj)
        if (clazz == null) return false
        let pool = this.tmPool.get(clazz)
        if (pool) {
            return pool.returnToPool(obj)
        }
    }

    private GetFromPool(...args: any[]) {
        this.isInit = false
        this.OnGetFromPool(...args)
    }
    private ReturnToPool() {
        this.isInit = false
        return this.OnReturnToPool()
    }

    //#endregion
}
