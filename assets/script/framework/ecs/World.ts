import { TF_BattleTime } from "../../module/tf_battle/battle/utils/TF_BattleTime";
import { ScriptObject } from "../base/ScriptObject";
import { Container } from "../container/Container";
import { Utils } from "../utils/Utils";
import { CircularQueue } from "./CircularQueue";
import { Com } from "./Com";
import { Group } from "./Group";
import { System } from "./System";

const CACHE_FRAME = 5// id延迟5帧回池

export type EntityRef = [number,number]

export class World extends ScriptObject {

    protected container = new Container()
    getContainer(){return this.container}
    
    
    constructor(alias?:string)
    {
        super()
        this.freeEntity = new CircularQueue(200)
        this.traceBattle("constructor")
        this.container.collectObj(this,alias|| "World")
        this.container.collectObj(this.container, "Container")
    }

    protected onDestroy() {
        this.traceBattle("onDestroy")

        this.destroyCom()
        this.destroyEntity()
        this.destroySystem()
        
        
        this.tlCom  = null
        this.tmCom = null        
        this.entityEnable = null
        this.freeEntity = null
        this.entityVer = null
        this.addSet = null
        this.removeSet = null
        this.tlSystem = null
        this.tlGroup = null
        this.tmSystem = null
        this.container.destroy()
        this.container = null
        
    }

    start()
    {
        this.traceBattle("start")
        this.container.start()

        this.startSystem()
    }

    /**
     * 获取时间 毫秒
     * 用于清理数据等逻辑
     */
    GetCurTime(){
        return (cc.game as any).totalTime * 1000
    }

    //#region Com
    protected tlCom: Com[] = []
    protected tmCom = new Map<Class, Com>()
    addCom<T extends Com>(clazz:Class<T>)
    {
        //先从container通过别名获取，可以实现外部重载
        let com = this.container.collectClass(clazz)
        
        this.tlCom.push(com)
        this.tmCom.set(clazz,com)
    }

    protected destroyCom()
    {
        for (const com of this.tlCom) {
            com.destroy()
        }
        this.tlCom = null
        this.tmCom = null
    }
    //#endregion

    //#region Entity
    

    //Entity激活情况
    private entityEnable: boolean[] = [false]

    private freeEntity: CircularQueue = null

    //Entity版本号避免复用
    private entityVer: number[] = [0]

    private isModify:boolean = false
    private lastRemove:number = 0

    //记录新增EntityId
    protected addSet: Set<number> = new Set<number>()
    //记录延迟回收的EntityId
    private delayRecyleMap: Map<number,number> = new Map()
    //记录需要删除的EntityId
    private removeSet: Set<number> = new Set<number>()
    //已删除的id过一段时间再回池
    private cacheSet: Set<number> = new Set<number>()
    //检查超时队列
    private overtimeSet: Set<number> = new Set<number>()
    private overtimeMap: Map<number,number> = new Map()
    
    private destroyEntity()
    {
        this.traceBattle("destroyEntity")
        this.addSet = null
        this.removeSet = null
        this.cacheSet = null
        this.overtimeSet = null
        this.delayRecyleMap = null
    }

    GetCom<T extends Com>(clazz:Class<T>):T{
        return this.tmCom.get(clazz) as T
    }

    /**
     * 新增一个Entity,  this.ApplyModify后生效
     */
    addEntity<
        T1 extends Com,
        T2 extends Com,
        T3 extends Com,
        T4 extends Com,
        T5 extends Com,
        T6 extends Com,
        T7 extends Com,
        T8 extends Com,
        T9 extends Com,
        T10 extends Com,
        T11 extends Com,
        T12 extends Com,
        T13 extends Com>
        (...clazz: [Class<T1>?, Class<T2>?, Class<T3>?, Class<T4>?, Class<T5>?, Class<T6>?, Class<T7>?, Class<T8>?, Class<T9>?, Class<T10>?, Class<T11>?, Class<T12>?, Class<T13>?])
        : number
    {
        this.isModify = true
        let id = this.genEntityId()
        this.addSet.add(id)
        for (let i = 0; i < clazz.length; i++) {
            let com = this.tmCom.get(clazz[i])
            com.AddEntity(id)
        }
        return id;
    }

    /**暂时只支持新增 */
    AddEntityCom<T extends Com>(id:number, clazz:Class<T>):T{
        let com = this.tmCom.get(clazz)
        com.AddEntity(id);
        return com as T
    }

    /**
     * 新增一个Entity, 返回id和所有的Com,  this.ApplyModify()后才回调Group的onAddEntity,onRemoveEntity
     */
    addEntity2<
        T1 extends Com,
        T2 extends Com,
        T3 extends Com,
        T4 extends Com,
        T5 extends Com,
        T6 extends Com,
        T7 extends Com,
        T8 extends Com,
        T9 extends Com,
        T10 extends Com,
        T11 extends Com,
        T12 extends Com,
        T13 extends Com>
        (...clazz: [Class<T1>?, Class<T2>?, Class<T3>?, Class<T4>?, Class<T5>?, Class<T6>?, Class<T7>?, Class<T8>?, Class<T9>?, Class<T10>?, Class<T11>?, Class<T12>?, Class<T13>?])
        : [number, [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13]] 
    {

        let id = this.addEntity(...clazz)

        let coms = new Array(clazz.length)
        for (let i = 0; i < clazz.length; i++) {
            coms[i] = this.tmCom.get(clazz[i])
        }

        return [id, coms as [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13] ]
    }

    /**
     * 删除一个Entity,  this.ApplyModify()生效
     * @param id 
     * @returns 
     */
    removeEntity(id:number):boolean
    {
     //   console.log("world.removeEntity"+id, this.entityEnable[id])

        if(  !this.entityEnable[id] )
        {
            return false
        }
        this.isModify = true
        this.removeSet.add(id)
        return true;
    }

    public IsModified(){
        return this.isModify
    }


    /**
     * 应用之前addEntity和removeEntity
     */
    applyModify()
    {
        if(this.isModify)
        {
            this.isModify = false
        }

        let delayRecyleMap = this.delayRecyleMap
        let removeSet = this.removeSet
        let cacheSet = this.cacheSet
        let overtimeSet = this.overtimeSet
        let overtimeMap = this.overtimeMap
        
        let now = this.GetCurTime()
        for(let id of removeSet)
        {
            //清理
            removeSet.delete(id)

            //提前通知准备清理com
            for (const com of this.tlCom) {
                if( com._active[id] )
                {
                    com.OnBeforeRemoveStartWrap(id)
                }
            }

            //提前通知准备销毁
            for(let group of this.tlGroup)
            {
                let ingroup = true
                for(let clazz of group.tlComClazz)
                {
                    let com = this.tmCom.get(clazz)
                    if(!com._active[id])
                    {
                        ingroup = false
                        break
                    }
                }
                if(ingroup){
                    group.beforeRemoveEntityData(id)
                }
            }

            //检查引用
            let occupy = this.getEntityOccupy(id)
            if(occupy > 0){
                //移动到检查队列
                overtimeSet.add(id)
                overtimeMap.set(id, now)
            }else{
                //移到销毁队列
                cacheSet.add(id)
            }
        }

  //      let error:number[]
        for(let id of overtimeSet){
            // let diff = now - overtimeMap.get(id)
            // if(diff > CACHE_OVERTIME){
            //     error = error || []
            //     error.push(id)
            //     error.push(this.tmOccupyCaller.get(id) || 0)
            // }

            let occupy = this.getEntityOccupy(id)
            if(occupy > 0){
                continue
            }else{
                overtimeSet.delete(id)
                overtimeMap.delete(id)
                //移到销毁队列
                cacheSet.add(id)
            }
        }
        // if(error){
        //     console.warn("实体引用超时,请检查泄露:"+error.join(","))
        //     // console.log(this.tmOccupyCaller)
        // }

        
        
        let nowframe = (cc.game as any).frameCount

        for(let id of cacheSet){
         //   console.log("world.applyModify.RemoveEntity"+id, TF_BattleTime.time)
            for(let group of this.tlGroup)
            {
                let ingroup = true
                for(let clazz of group.tlComClazz)
                {
                    let com = this.tmCom.get(clazz)
                    if(!com._active[id])
                    {
                        ingroup = false
                        break
                    }
                }
                if(ingroup){
                    group.onRemoveEntity(id)
                }
            }
            //清理com
            for (const com of this.tlCom) {
                if( com._active[id] )
                {
                    com.RemoveEntity(id)
                }
            }
            //回收id
            // this.returnEntityId(id)
            delayRecyleMap.set(id, nowframe)

            cacheSet.delete(id)
        }

        //延迟回收id
        for(let [id, t] of delayRecyleMap){
            if(nowframe - t > CACHE_FRAME){
                //回收id
                this.returnEntityId(id)
                delayRecyleMap.delete(id)
            }
        }

        

        for(let id of this.addSet.keys())
        {
       //     Utils.trace("world.applyModify.addEntity"+id, TF_BattleTime.time)

            for (let group of this.tlGroup) {
                let ingroup = true
                this.assert(group.tlComClazz!=null, "Group尚未声明tlComClazz: "+group.className)
                for(let clazz of group.tlComClazz)
                {
                    let com = this.tmCom.get(clazz)
                    if(!com._active[id])
                    {
                        ingroup = false
                        break
                    }
                }
                if(ingroup)
                {
                    group.onAddEntity(id)
                }
            }
        }
        this.addSet.clear()

    }
    

    /**
     * 获取引用, 因为id会复用, 
     * @param id 
     * @param ref 可外部传入,防止频繁gc
     */
    getRef(id:number, ref?:EntityRef): EntityRef
    {
        if(ref==null)
        {
            ref = [0,0]
        }
        ref[0] = id
        ref[1] = this.entityVer[id]
        return ref
    }

    /**
     * 引用转id, 如果不存在则返回0
     * @param ref 
     * @returns 
     */
    ref2id(ref: EntityRef):number
    {
        if(!ref) return 0;
        let id = ref[0]
        let ver = ref[1]
        if( !this.entityEnable[ref[0]] )
        {
            return 0
        }

        if(this.entityVer[id] != ver)
        {
            return 0
        }
        return id
    }

    /**
     * 生成一个EntityId
     * @returns 
     */
    private genEntityId():number
    {
        
        let id
        
        //let head = this.head.nextId
        let head_nextId = this.freeEntity.dequeue()
        if (head_nextId)
        {
            //id = head.nextId
            id = head_nextId
            //entity.enable = true
            this.entityEnable[id] = true
        }
        else{

            //entity.id = id
            id = this.entityEnable.length

            //entity.enable = true
            this.entityEnable.push(true)

            //entity.ver = 0
            this.entityVer.push(0)
            
        }

    //    Utils.trace("genEntityId_"+id, TF_BattleTime.time)
        return id
    }

    /**
     * 回收一个EntityId
     * @param id 
     * @returns 
     */
    protected returnEntityId(id:number)
    {
     //   Utils.trace("world.returnEntityId" + id, TF_BattleTime.time)

        let count = this.entityEnable.length
        if (id <= 0 || id >= count) {
            Utils.error("returnEntityId id错误:"+id)
            return
        }

        //entity.ver++
        this.entityVer[id] = this.entityVer[id] + 1

        this.freeEntity.enqueue(id)
    }

    private _entityRef = []
    //private tmOccupyCaller = new Map<number, any>()
    /**
     * 占用eid，引用计数+1
     * @param eid 
     * @param caller 用来检查泄露
     */
    addEntityOccupy(eid:number, log?){
        let tmOccupy =  this._entityRef
        let count = tmOccupy[eid]||0
        let value = count + 1
        tmOccupy[eid] = value
    //    console.log("addEntityOccupy" + eid, value, log)

        // let arg = this.tmOccupyCaller.get(eid)
        // if(arg == null){
        //     this.tmOccupyCaller.set(eid, caller)
        //     console.log(`addEntityOccupy: eid=${eid}, caller=${caller}, value=${value}`)
        // }
    }

    /**
     * 解除占用eid，引用计数-1
     * @param eid 
     * @param caller 
     */
    decEntityOccupy(eid:number, log?){
        let tmOccupy =  this._entityRef
        let count = tmOccupy[eid]||0
        let value = count - 1
        tmOccupy[eid] = value
     //   console.log("decEntityOccupy" + eid, value, log)
        
        
        // if(value <= 0){
        //     let arg = this.tmOccupyCaller.get(eid)
        //     console.log(`decEntityOccupy: eid=${eid}, caller=${caller}, value=${value}, arg=${arg}`)
        //     if (arg != caller)
        //     {
        //         console.error(`decEntityOccupy 引用计数错误: eid=${eid}, arg=${arg}, value=${value}, caller=${caller}`)
        //     }
        //     this.tmOccupyCaller.delete(eid)
        // }
    }

    getEntityOccupy(eid:number){
        return this._entityRef[eid] || 0
    }
    
    //#endregion

    //#region System
    protected tlSystem = new Array<System>()
    protected tlGroup = new Array<Group>()
    protected tmSystem = new Map<Class<any>, System>()
    addSystem<T extends System>(clazz:Class<T>, alias?:string)
    {
        let system = this.container.collectClass(clazz, alias)

        system.init(this, this.container)
        this.tlSystem.push(system)
        this.tmSystem.set(clazz, system)
        if(system instanceof Group)
        {
            this.tlGroup.push(system)
        }
    }
 
    getSystem<T extends System>(clazz: Class<T>):T
    {
        // return this.tmSystem.get(clazz) as T
        //通过别名获取，支持重载
        return this.getSystemByAlias(clazz.__cname) as T
    }

    getSystemByAlias<T extends System>(alias:string):T{
        //通过别名获取，支持重载
        return this.container.getByAlias(alias) as T
    }

    private destroySystem()
    {
        for(let i=this.tlSystem.length-1; i>=0;i--)
        {
            this.tlSystem[i].destroy()
        }
        this.tlSystem = null
        this.tmSystem = null
    }

    protected startSystem()
    {
        for(let s of this.tlSystem)
        {
            s.Start()
        }
    }
    //#endregion


}