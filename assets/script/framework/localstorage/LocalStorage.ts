// import { ScriptObject } from "../base/ScriptObject";
// import { EventProxy } from "../event/EventProxy";
// import { Func } from "../Func";
// import { FW } from "../FW";

// export enum LocalStorageEventType {
//     onAdd,      //添加
//     onUpdate,	//更新
//     onRemove,   //删除
//     onChange,   //发送变化后通知, 一帧最多一次
// }

// /**
// * LocalStorage 
// */
// export class LocalStorage extends ScriptObject{
//     static __cname: string = "LocalStorage";
    
//     /**使用hashKey保存数据 */
//     protected dictionary: Map<string, any> = new Map();
    
//     /**缓存key的类的字段列表 */
//     private tlKeyField: string[] = [];

//     private eventProxy = new EventProxy<LocalStorageEventType>()

//     GetEventProxy(){
//         return this.eventProxy
//     }
    
//     AddOrUpdate(obj:any){
//         let key = this.HashKey(obj)
//         let old = this.dictionary.get(key)
//         if(old != null){
//             this.Update(key, obj)
//         }else{
//             this.dictionary.set(key, obj)
//             this.eventProxy.execute(LocalStorageEventType.onAdd, obj)
//             this.ChangeOneFrame()
//         }
//         FW.Log.info("cache addOrUpdate", obj)
//     }

//     Update(key:string, obj:any){
//         //TODO:后续换成逐字段更新
//         let old = this.dictionary.get(key)
//         this.dictionary.set(key, obj)
//         this.eventProxy.execute(LocalStorageEventType.onUpdate, old, obj)
//         this.ChangeOneFrame()
//     }

//     Delete(keyOrVal: any){
//         let key = this.HashKey(keyOrVal)
//         let obj = this.dictionary.get(key)
//         if(obj != null){
//             this.dictionary.delete(key)
//             this.eventProxy.execute(LocalStorageEventType.onRemove, obj)
//             this.ChangeOneFrame()
//         }
//     }

//     HashKey(keyOrVal: any):string{
//         return Func.hashKey(keyOrVal, this.tlKeyField)
//     }

//     private _frame:number
//     ChangeOneFrame(){
//         let now = cc.director.getTotalFrames()
//         if(now != this._frame){
//             this._frame = now
//             this.eventProxy.execute(LocalStorageEventType.onChange)
//         }
//     }

//     Save(){
//         let dataStr = JSON.stringify(this.dictionary)
//         let key = ""
//         cc.sys.localStorage.setItem("",dataStr)
//     }

//     Load(){

//     }
// }