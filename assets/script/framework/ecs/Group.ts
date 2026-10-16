import { Com } from "./Com";
import { System } from "./System";

export abstract class Group extends System
{
    abstract tlComClazz:Class<Com>[]

    abstract onAddEntity(entityId:number)
    /**
     * 单位销毁时调用，引用计数已归零，数据还存在，下一刻清理
     * @param entityId 
     */
    abstract onRemoveEntity(entityId: number)

    /**
     * 此时单位已销毁，但不清理数据，等引用计数归零再清理
     * @param entityId 
     */
    beforeRemoveEntityData(entityId:number){

    }
}

