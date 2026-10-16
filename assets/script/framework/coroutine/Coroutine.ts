import { Pool } from "../pool/Pool";
import { YieldInstruction } from "./YieldInstruction";

export class Coroutine extends YieldInstruction {
    public static __cname: string = "Coroutine"
    private static pool: Pool<Coroutine> = null
    static getOrCreate(iir: IterableIterator<any>, caller?: destroyable, destoryCallback?: () => void) {
        if (!Coroutine.pool) {
            Coroutine.pool = new Pool<Coroutine>(() => {
                return new Coroutine()
            }, (object) => {
                if (object) {
                    object.destroy()
                }
            }, null, (object) => {
                if (object) {
                    object.destroy()
                }
                return true
            })
        }
        let yi: Coroutine = Coroutine.pool.getFromPool()
        yi.init(iir, caller, destoryCallback)
        return yi
    }

    iir: IterableIterator<any>
    iirResult: IteratorResult<any>
    isStart: boolean
    caller: destroyable
    destoryCallback: () => void

    private constructor() {
        super()
    }

    init(iir: IterableIterator<any>, caller?: destroyable, destoryCallback?: () => void) {
        this.onInit()
        this.iir = iir
        this.isStart = false
        this.caller = caller
        this.destoryCallback = destoryCallback
    }

    destroy() {
        if (this.destroyed == true) {
            return
        }
        if (this.iirResult != null) {
            let value = this.iirResult.value
            // if (value != null && value.isDone != null && value.current != null) {
            if (value != null && value._isYieldInstruction === true) {
                let yi = value as YieldInstruction
                if (yi.destroyed != true) {
                    yi.recover()
                }
            }
        }
        let destoryCallback = this.destoryCallback
        this.destoryCallback = null
        if (destoryCallback != null) {
            destoryCallback.apply(this.caller)
        }
        this.iir = null
        this.iirResult = null
        this.isStart = null
        this.caller = null
        super.destroy()
    }

    recover() {
        Coroutine.pool.returnToPool(this)
    }

    start() {
        this.assert(this.isStart == false)
        this.iirResult = this.iir.next()
        this.isStart = true
        return this
    }

    update() {
        if (this.destroyed == true) {
            return
        }
        let ret = this.isDone()
        if (ret) {
            let destoryCallback = this.destoryCallback
            this.destoryCallback = null
            if (destoryCallback != null) {
                destoryCallback.apply(this.caller)
            }
        }
    }

    isDone(): boolean {
        if (this.destroyed == true) {
            return true
        }
        if (this.iirResult.done) {
            return true
        }
        let value = this.iirResult.value

        // if (value != null && value.isDone != null && value.current != null) {
        if (value != null && value._isYieldInstruction === true) {

            let yi = value as YieldInstruction

            if (yi.isDone()) {
                yi.recover()
                this.iirResult = this.iir.next()
            }
        } else {
            this.iirResult = this.iir.next(value)
        }
        return false
    }
}