import { Pool } from "../pool/Pool";
import { YieldInstruction } from "./YieldInstruction";

export class YieldUntil extends YieldInstruction {
    public static __cname: string = "YieldUntil";
    private static pool: Pool<YieldUntil> = null
    static getOrCreate(caller: any, condition: (p1?: any, p2?: any, p3?: any) => boolean, p1?: any, p2?: any, p3?: any) {
        if (!YieldUntil.pool) {
            YieldUntil.pool = new Pool<YieldUntil>(() => {
                return new YieldUntil()
            }, (object) => {
                if (object) {
                    object.destroy()
                }
            })
        }
        let yi: YieldUntil = YieldUntil.pool.getFromPool()
        yi.init(caller, condition, p1, p2, p3)
        return yi
    }

    caller: any
    condition: (p1?: any, p2?: any, p3?: any) => boolean
    p1: any
    p2: any
    p3: any

    private constructor() {
        super()
    }

    init(caller: any, condition: (p1?: any, p2?: any, p3?: any) => boolean, p1?: any, p2?: any, p3?: any) {
        this.onInit()
        this.caller = caller
        this.condition = condition
        this.p1 = p1
        this.p2 = p2
        this.p3 = p3
    }
    destroy() {
        this.caller = null
        this.condition = null
        this.p1 = null
        this.p2 = null
        this.p3 = null
        super.destroy()
    }

    isDone(): boolean {
        let t = this
        let ret = t.condition.call(t.caller, t.p1, t.p2, t.p3) as boolean
        return ret
    }

    recover() {
        YieldUntil.pool.returnToPool(this)
    }

}