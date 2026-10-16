

import { ScriptObject } from "../base/ScriptObject";
import { Pool } from "../pool/Pool";
import { Utils } from "../utils/Utils";

type TComtlNumStr = number|string|boolean
type TComtlObject = TComtlNumStr | any
type TComtlNumStrFunc = (eid:number)=>TComtlObject
export abstract class Com extends ScriptObject
{
   
    //记录当前长度
    private length = 0;
    //记录Num和Str的数组
    private tlNumStr: Array<[TComtlNumStr|TComtlNumStrFunc, Array<TComtlNumStr>]> = new Array()
    //tlObject
    private tlObject: Array<[Pool<any>, Array<any>]> = new Array()

    /**World内部使用，外部请勿调用 */
    _active: boolean[] = []

    protected onDestroy() {
        for(let obj of this.tlObject )
        {
            obj[0].destroy()
        }
        this.tlObject = null
        this.tlNumStr =null
        this._active = null
        
    }

    public AddEntity(entityId:number)
    {
  //      Utils.trace("Com.AddEntity"+entityId, TF_BattleTime.time)
        while(entityId >= this.length)
        {
            this._active.push(false)
            for (const n of this.tlNumStr) {
                if(typeof n[0] == "function"){
                    n[1].push(n[0](entityId))
                }else{
                    n[1].push(n[0])
                }
                
            }
            for (const n of this.tlObject) {
                n[1].push(null)
            }
            
            this.length++  
        }

        this._active[entityId] = true

        for (const n of this.tlNumStr) {
            if(typeof n[0] == "function"){
                n[1][entityId] = n[0](entityId)
            }else{
                n[1][entityId] = n[0]
            }
        }
        for (const n of this.tlObject) {
            n[1][entityId] = n[0].getFromPool()
        }
        

        this.OnAddEntity(entityId)
    }

    public OnBeforeRemoveStartWrap(entityId:number){
        this.BeforeRemoveStart(entityId)
    }

    public RemoveEntity(entityId: number)
    {
    //    Utils.trace("Com.RemoveEntity"+entityId, TF_BattleTime.time)

        this.BeforeRemoveData(entityId)
        for (const n of this.tlNumStr) {
            
            if(typeof n[0] == "function"){
                n[1][entityId] = n[0](entityId)
            }else{
                n[1][entityId] = n[0]
            }
        }
        for (const n of this.tlObject) {
            n[0].returnToPool(n[1][entityId])
            n[1][entityId] = null
        }
        this._active[entityId] = false

        this.OnRemoveEntity(entityId)
    }

    /**
     * 创建一个string属性
     * @param init 默认值
     * @returns 
     */
    protected CreateString(init:string=""):string[]
    {
        let ret = new Array<string>()
        this.tlNumStr.push([init , ret])
        return ret
    }

    /*
     * 创建一个数字属性 
     * @param init 默认值
     * @returns 
     */
    protected CreateNumber(init:number=0):number[]
    {
        let ret = new Array<number>()
        this.tlNumStr.push([init, ret])
        return ret
    }

    protected CreateNumberProxy(init:number=0):number[]
    {
        let ret = new Array<number>()
        ret = this.createTrackedArray(ret)
        this.tlNumStr.push([init, ret])
        return ret
    }

    private createTrackedArray(arr: number[]): number[] {
        const handler: ProxyHandler<number[]> = {
            set: (target, property, value) => {
                if ((typeof property === 'number' || typeof property === 'string') && value == null) {
                    Utils.trace(`数组索引_${property} 被修改为 ${value}`);
                }
                target[property] = value;
                return true;
            },
            apply: (target, thisArg, argArray) => {
           //     console.trace(`数组方法 ${(target as any).name} 被调用，参数：`, argArray);
                return (target as any).apply(thisArg, argArray);
            }
        };

        const methodsToProxy = ['push', 'pop', 'shift', 'unshift', 'splice', 'reverse', 'sort'];
        methodsToProxy.forEach(method => {
            const originalMethod = arr[method];
            arr[method] = function (...args: any[]) {
             //   console.trace(`数组方法 ${method} 被调用，参数：`, args);
                return originalMethod.apply(this, args);
            } as any;
        });

        return new Proxy(arr, handler);
    }

    /**
     * 创建一个布尔属性
     * @param init 默认值
     * @returns 
     */
    protected CreateBoolean(init: boolean = false): boolean[] {
        let ret = new Array<boolean>()
        this.tlNumStr.push([init, ret])
        return ret
    }

    /**
     * 创建任意类型的属性
     * @param init 默认值
     * @returns 
     */
    protected Create<T extends TComtlObject>(init: T|(TComtlNumStrFunc) = null): T[] {
        let ret = new Array<T>()
        this.tlNumStr.push([init, ret] as any)
        return ret
    }

    /**
     * 创建一个ScriptObject属性, 池化管理
     * @param clazz 类
     * @param OnGet 出池回调
     * @param OnReturn 回池回调
     * @returns 
     */
    protected CreateScriptObject<T extends ScriptObject>(clazz:Class<T>, OnGet?:(t:T)=>void, OnReturn?:(t:T)=>void):T[]
    {
        let ret = new Array<T>()
        let pool = new Pool(
            ()=>{
                return new clazz()
            },
            (t:T) => {
                return t.destroy()
            },
            (t:T) =>{
                if(OnGet!=null)
                {
                    OnGet(t)
                }
            },
            (t: T) => {
                if (OnReturn != null) {
                    OnReturn(t)
                }
                return true
            }
        )

        this.tlObject.push([pool,ret])
        return ret
    }

    //#region 子类重写



    protected OnAddEntity(entityId: number) {

    }

    /**
     * 注意，此时数据已被移除，要数据请使用BeforeRemoveEntity
     * @param entityId 
     */
    protected OnRemoveEntity(entityId: number) {

    }
    /**
     * 实体移除，此时因为引用计数未归零有可能过几帧才销毁
     * 小技巧：
     * 在这个方法调用清理不会被其他系统索引
     * @param entityId 
     */
    protected BeforeRemoveStart(entityId: number) {

    }

    /**
     * 实体移除数据前回调
     * 小技巧：
     * 在这个方法调用清理会因为计数未归零而保留
     * @param entityId 
     */
    protected BeforeRemoveData(entityId: number) {

    }
    
    
    //#endregion
    
}
