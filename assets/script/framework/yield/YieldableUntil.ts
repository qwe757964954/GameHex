import { Yieldable } from "./Yieldable";

export type IYieldableUntil_Func = () => [boolean, ...any[]]
/**
* YieldableUntil 
*/
export class YieldableUntil extends Yieldable{
    static __cname: string = "YieldableUntil";

    static Create(callback: IYieldableUntil_Func) {
        let obj = Yieldable.GetOrCreate(YieldableUntil, callback)
        return obj
    }

    private callback: IYieldableUntil_Func
    protected OnGetFromPool(callback: IYieldableUntil_Func): void {
        this.callback = callback
    }

    protected OnReturnToPool(): boolean {
        this.callback = null
        return true
    }
    OnInit(time: number): void {}

    private _temp = [true]
    OnUpdate(time: number): [boolean, ...any[]] {
        let temp: any = this._temp
        let result: [boolean, ...any[]] = temp
        let callback = this.callback
        if (callback) {
            result = callback()
        }
        return result
    }
}