import { ScriptObject } from "../base/ScriptObject";
import { Pool } from "../pool/Pool";
import { Yieldable } from "./Yieldable";
import { IYieldableUntil_Func, YieldableUntil } from "./YieldableUntil";

/**
* Yield 
设计目的：
1. 通过Update驱动迭代器(Generator)，实现暂停
1. 通过对象池管理Yield实例，destroy即可回收

How to Use:

Class Test{
    Init(){
        let yield = new Yield();
        yield.Start(this.MainLoop());
        toolSet.addTimer(1000, ()=>{
            yield.Update(1000)
        })

        //destroy 
        toolSet.addDelay(5000,()=>{
            yield.destroy()
        })
    }
    * MainLoop(now:number){
        //do something
        let [suc, msg] = yield Yield.Until(()=>{
            now = sys.gettime()
            if(now > 5){
                return [true, "msg"]
            }
            return [false]
        })

        console.log(suc, msg)
    }
}


*/
export class Yield extends ScriptObject{
    static __cname: string = "Yield";

    //#region 暴露静态方法
    static Until(callback: IYieldableUntil_Func){
        return YieldableUntil.Create(callback)
    }
    //#endregion
    
    private _realDestroy:()=>void
    private constructor(){
        super()
        this._realDestroy = super.destroy
    }

    destroy(): void {
        Yield.pool.returnToPool(this)
    }

    private destroyForce(){
        if(this._realDestroy){
            this._realDestroy.call(this)
        }
    }

    private onGetfromPool(){

    }

    private onReturnToPool(){
        this.ClearGenerator()
    }

    //#region 对象池实现
    private static _pool:Pool<Yield>
    private static get pool (){
        let pool = this._pool
        if(pool == null){
            let fCreate =()=>new Yield
            let fDestroy =(t:Yield)=> t.destroyForce()
            let fGet = (t:Yield)=>t.onGetfromPool()
            let fReturn = (t:Yield)=>{
                t.onReturnToPool();
                return true
            }
            pool = new Pool(fCreate, fDestroy, fGet, fReturn)
            this._pool = pool
        }
        return pool
    }
    static Create(){
        return this.pool.getFromPool()
    }
    //#endregion

    //#region 管理Generator部分
    private generator:Generator
    private _yieldable: Yieldable;
    private _temp: any[] = [];

    private ClearGenerator(){
        this.generator = null
        this._yieldable = null
        this._temp.length = 0
    }

    /**
     * 外部驱动，停止Update相当于暂停
     * @param now 当前时间，不是dt！
     * @returns 
     */
    Update(now:number):boolean{

        if(this.generator){
            let result = this.RunLoop(now, this.generator)
            return result
        }
        return true
    }

    /**
     * 执行
     * @param generator 
     */
    Start(generator:Generator){
        this.generator = generator
    }

    /**
     * 终止
     */
    Stop(){
        this._yieldable = null
        this.generator = null
    }
    
    private RunLoop(now, gen:Generator):boolean{
        //透传参数
        let p: any[] = this._temp;
        p.length = 0;
        p[0] = now;

        if (this._yieldable) {
            let [suc, ...args] = this._yieldable.Update(now);
            if (suc) {
                p.push(...args);
                this._yieldable = null;
            } else {
                return false;
            }
        }

        let iter = gen.next(p);
        let value = iter.value;
        let mainResult = false;
        if (value instanceof Yieldable) {
            this._yieldable = value;
            return false;
        }

        mainResult = iter.done;

        return mainResult;
    }
    //#endregion
}