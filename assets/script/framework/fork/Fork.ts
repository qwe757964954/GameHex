import { ScriptObject } from "../base/ScriptObject";

/**
 * 类修饰器
 * 基类、派生类都需要加入此修饰器，确保此脚本最先加载
 * @param constructor 
 * @param key 留空则收集为基类，有key则用来判断代码分支
 */
export function forkClass<T extends Class<any>>(base: T, key:string | null) {
    return function(property:T){
        if(key == null){
            // ForkMgr.instance.__CollectBase(base)
        }else{
            ForkMgr.instance.__CollectClass(base, property, key)
        }
    }
}

/**
* Fork 
*/
export class ForkMgr extends ScriptObject{
    static __cname: string = "Fork";
    static _instance:ForkMgr
    static get instance(){
        return this._instance || (this._instance = new ForkMgr())
    }
    private constructor(){
        super()
    }
    private tmKey = new Map<string, boolean>()
    private _use:string
    Register(key:string){   
        this.tmKey.set(key, true)
    }
    Has(key:string){
        return this.tmKey.has(key)
    }
    Use(key:string){
        if(this.tmKey.has(key))
            this._use = key
    }
    IsUse(key:string){
        return this._use != null && this._use == key
    }

    __CollectClass(base:Class<any>, clazz:Class<any>, key:string){
        if(this.IsUse(key)){
            let base_prototype = base.prototype
            base.prototype = clazz.prototype
            base.prototype.constructor = base_prototype.constructor
            // base.prototype.constructor["__cname"] = base_prototype.constructor["__cname"]
        }
    }
}