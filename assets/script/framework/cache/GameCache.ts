import { ScriptObject } from "../base/ScriptObject";
import { TDic } from "../collection/TDic";
import { EventProxy } from "../event/EventProxy";
import { Func } from "../Func";
import { FW } from "../FW";
import { ProtoMgr } from "../net/ProtoMgr";
import { GameCacheMgr } from "./GameCacheMgr";

export enum EventType {
    onAdd,      //添加
    onUpdate,	//更新
    onRemove,   //删除
    onChange,   //发送变化后通知, 一帧最多一次
    onNotify,// 发送后通知, 没数据, 单纯表示服务器发送了
    onRemoveNoCache// 删除一个不存在的缓存
}

/**字段信息 */
interface FieldInfo {
    fieldNumber: number;
    name: string;
    type: string;
}

export class GameCache extends ScriptObject {
    public static __cname: string = "GameCache";
    private _isReq: boolean;
    /**是否订阅了缓存
     * 如果还没有订阅的数据,收到缓存也不要保存
     */
    get isReq(): boolean {
        return this._isReq;
    }
    set isReq(value: boolean) {
        this._isReq = value;
    }

    // CacheSubEnum
    cacheSubEnum: any

    /**缓存名称 */
    protected cacheName: string;

    /**缓存key的类名
     * "CmdHero_Key"
     */
    protected cacheKeyName: string;

    /**缓存key的类的字段列表 */
    private tlKeyField: string[];

    /**缓存key的proto类 */
    private keyClass: any;

    /**使用hashKey保存数据 */
    protected dictionary: TDic<string, any>;
    get cacheDict() {
        return this.dictionary;
    }

    /**缓存所有数据key(主要是在清除所有数据前先保存一下key,更新完数据后已经没有的key要删除) */
    protected tlLastCacheKey: string[]
    /**本次更新的是key */
    protected tmNowCacheKey: TDic<string, boolean>;

    /**
     * 描述字段字典<字段序号,字段描述类>, 字段序号:field["fieldNumber"]
     * "exp": {
        "fieldNumber": 5, 
        "name": "exp", 
        "type": "int32"
    }
     */
    protected fieldDictionary: TDic<number, FieldInfo>;

    /**缓存事件 */
    eventProxy = new EventProxy<EventType>();

    // private changeFieldMap:any = {};

    /**
     * @param cacheName 缓存名称 CmdPlayer
     * @param keyClass key类模型
     */
    constructor(cacheName: string) {
        super()
        this.cacheName = cacheName;
        /*
        --protoName   -- 缓存数据的protoName
        --protoName_Key   -- 缓存数据的删除Key的protoName
        --protoName_Update  -- 缓存数据的更新数据的 protoName
        --protoName_UpdateByField  -- 缓存数据的更新数据的 protoName
        --protoName_Delete  -- 缓存数据的删除的 protoName
        */

        this.tlLastCacheKey = []
        this.tmNowCacheKey = new TDic<string, boolean>();

        this.dictionary = new TDic<string, any>();
        this.fieldDictionary = new TDic<number, FieldInfo>();

        this.init();
    }

    destroy() {
        this.destroyed = true

        this.tlLastCacheKey.length = 0
        this.tlLastCacheKey = null

        this.tmNowCacheKey.clear()
        this.tmNowCacheKey = null

        this.dictionary.clear()
        this.dictionary = null
        this.fieldDictionary.clear()
        this.fieldDictionary = null
        this.eventProxy.destroy()
        this.eventProxy = null
        this._isReq = null

        super.destroy()
    }

    init() {
        let cacheName = this.cacheName

        let message = GameCacheMgr.getCacheMessage(cacheName);
        if (message == null) {
            this.error("error 协议不对应 GameCache cacheName:", cacheName)
        }
        let fieldDictionary = this.fieldDictionary;
        let tmField = message["tmField"];
        let tlfieldName = Object.keys(tmField);
        let field: FieldInfo;
        for (let i = 0, len = tlfieldName.length; i < len; i++) {
            field = tmField[tlfieldName[i]];
            fieldDictionary.set(field["fieldNumber"], field);
        }

        this.cacheKeyName = cacheName + "_Key"
        this.keyClass = ProtoMgr.get().protoCoder.lookupClass(this.cacheKeyName);

        this.tlKeyField = message.tlKey;
    }

    /**
     * 获取单个数据推荐使用 FW.CacheMgr.get
     * 获取缓存(没有缓存key的不需要传key如:CmdPlayer)
     * @param key 缓存Key 
     */
    get<T>(keyOrval?: any): T {
        let key = this.hashKey(keyOrval);
        return this.dictionary.get(key);
    }

    /**
     * 获取所有
     */
    // getValues<T>() {
    // 屏蔽getValues,直接使用mgr的就行,FW.CacheMgr.getValues("CmdHero")
    // getValues() {
    //     return this.dictionary.values;
    // }

    /**
     * 更新缓存
     * @param data 缓存对象
     */
    updateByUint8Array(data: Uint8Array) {
        let obj = ProtoMgr.get().decodeDataByName(this.cacheName, data);
 //       console.log("updateByUint8Array", this.cacheName, obj)
        this.addOrUpdate(obj);
        if (this.cacheName == "CmdTask") {
            return
        }
        // FW.LWX.info("cache updateByUint8Array", obj, ", cacheName:" + this.cacheName)
    }

    /**
     * 删除缓存
     * @param data
     */
    deleteByUint8Array(data: Uint8Array) {
        let obj = ProtoMgr.get().decodeDataByName(this.cacheKeyName, data);
        let hashKey = this.hashKey(obj)
    //    console.log("deleteByUint8Array", this.cacheName)
        this.tmNowCacheKey.set(hashKey, true)
        this.delete(obj);
        // FW.LWX.info("cache delete", obj)
    }
    /**
     * 添加或更新
     * @param obj  缓存对象
     */
    addOrUpdate(obj: any) {
        let key = this.hashKey(obj)
        let old = this.dictionary.get(key)
        this.tmNowCacheKey.set(key, true)
  //      console.log("deaddOrUpdateleteByUint8Array", this.cacheName, key, obj)
        if (old != null) {
            this.update(key, obj)
        } else {
            this.dictionary.set(key, obj);
            this.eventProxy.execute(EventType.onAdd, obj);
        }
        if (this.cacheName == "CmdTask") {
            return
        }
        FW.LWX.info("cache addOrUpdate", obj, ",cacheName:" + this.cacheName)
    }

    /**
     * 数据提示
     */

    notifyNone()
    {
        this.eventProxy.execute(EventType.onNotify);
    }


    /**
     * 部分更新
     * @param keyData 缓存Key
     * @param part 缓存部分字段
     */
    updateByField(cmdCacheUpdateByField: any) {
        let keyData: Uint8Array = cmdCacheUpdateByField.key;
        let oldObj = null;

        let keyData_: string
        if (keyData == null) {
            keyData_ = null
        } else {
            keyData_ = this.keyClass.decode(keyData);
        }
        let hashKey_ = this.hashKey(keyData_);
        oldObj = this.dictionary.get(hashKey_);

        if (oldObj == null) {
            //服务器发的update有可能在add之前，直接抛弃这个update
            // this.error("updateByField fail oldObj null: " + this.cacheName)
            return
        }

        // let tlCmdCacheFieldData: { fieldNumber: number, data: any }[] = cmdCacheUpdateByField.tlCmdCacheFieldData;
        let tlCmdCacheFieldData: { fieldNumber: number, data: any }[] = cmdCacheUpdateByField.fields;
        if (tlCmdCacheFieldData == null) {
            this.error("updateByField fail tlCmdCacheFieldData null: " + this.cacheName)
            return
        }
        let len = tlCmdCacheFieldData.length
        if (len <= 0) {
            this.error("updateByField fail tlCmdCacheFieldData lenght=0: " + this.cacheName)
            return
        }

        this.tmNowCacheKey.set(hashKey_, true)

        let cmdCacheFieldData: { fieldNumber: number, data: any };
        let oldValue;
        let newValue;
        let name: string;
        let fieldObj: FieldInfo;

        let fieldDictionary = this.fieldDictionary
        let fieldNumber: number;

        let changeFieldMap = {};
        let changeFieldMapOld = {};
        let obj;
        for (let i = 0; i < len; i++) {
            cmdCacheFieldData = tlCmdCacheFieldData[i];
            fieldNumber = cmdCacheFieldData.fieldNumber
            fieldObj = fieldDictionary.get(fieldNumber);
            if (fieldObj != null) {
                name = fieldObj.name
                obj = ProtoMgr.get().protoCoder.decodeBaseType(fieldObj.type, cmdCacheFieldData.data)
                newValue = obj.value;
                if (newValue === undefined) {
                    newValue = obj
                }
                oldValue = oldObj[name];
                if (oldValue != newValue) {
                    oldObj[name] = newValue;
                    changeFieldMap[name] = newValue;
                    changeFieldMapOld[name] = oldValue;
                }
            } else {
                this.error("updateByField fail fieldObj null: " + this.cacheName + " " + fieldNumber)
            }
        }


        // FW.LWX.info("cache updateByField", oldObj, changeFieldMap, changeFieldMapOld)
        this.eventProxy.execute(EventType.onUpdate, oldObj, changeFieldMap, changeFieldMapOld);
    }

    /**
     * 更新缓存
     * @param data 缓存对象
     */
    update(key: any, obj: any) {
        let oldObj = this.dictionary.get(key)
        if (oldObj == null) {
            this.warn("GameCache update fail oldObj null")
            return
        }
        let changeFieldMap: { [key: string]: any } = {};
        let changeFieldMapOld: { [key: string]: any } = {};
        let oldValue;
        let newValue;
        let name: string;
        let fieldObj: FieldInfo;

        let fieldDictionary = this.fieldDictionary
        let tlFieldKey = fieldDictionary.keys
        let fieldNumber: number;

        let NumberFunc = Number

        for (let sFieldNumber of tlFieldKey) {
            fieldNumber = NumberFunc(sFieldNumber)
            fieldObj = fieldDictionary.get(fieldNumber);
            if (fieldObj != null) {

                name = fieldObj.name
                oldValue = oldObj[name];
                newValue = obj[name];

                // oldObj[name] = newValue;

                let isChange = false

                //如果新值是object 就在多做深一层的对比处理
                if (newValue instanceof Object) {
                    for (let i in oldValue) {
                        if (oldValue[i] != newValue[i]) {
                            isChange = true
                            break
                        }
                    }
                    if (!isChange && oldValue) {
                        for (let i in newValue) {
                            if (oldValue[i] != newValue[i]) {
                                isChange = true
                                break
                            }
                        }
                    }

                    if (!oldValue) {
                        isChange = true
                    }
                } else {
                    isChange = oldValue != newValue
                }

                if (isChange) {
                    oldObj[name] = newValue;

                    changeFieldMap[name] = newValue;
                    changeFieldMapOld[name] = oldValue;
                }
            } else {
                this.error("update fail fieldObj null: " + this.cacheName + " " + fieldNumber)
            }
        }

        // FW.LWX.info("cache onUpdate", oldObj, changeFieldMap, changeFieldMapOld)
        this.eventProxy.execute(EventType.onUpdate, oldObj, changeFieldMap, changeFieldMapOld);
    }

    /**
     * 删除多个
     * @param keys 缓存keys
     */
    deleteMany(tlHashKey: string[]) {
        let key: string;
        let oldObj: any;
        let dictionary = this.dictionary
        let eventProxy = this.eventProxy
        for (let i = 0, len = tlHashKey.length; i < len; i++) {
            key = tlHashKey[i];
            oldObj = dictionary.get(key);
            if (oldObj != null) {
                dictionary.remove(key);
                eventProxy.execute(EventType.onRemove, oldObj)
            }
        }
    }

    /**
     * 删除
     * @param keyOrval 
     */
    delete(keyOrval?: any) {
        let hashKey = this.hashKey(keyOrval)

        let dictionary = this.dictionary
        let oldObj = dictionary.get(hashKey);
        if (oldObj != null) {
            dictionary.remove(hashKey);
            this.eventProxy.execute(EventType.onRemove, oldObj)
        } else {
            this.eventProxy.execute(EventType.onRemoveNoCache, keyOrval)
        }
    }

    /**
     * 清除所有
     */
    clear() {
        let keys = this.dictionary.keys;
        let tlKey: string[] = []
        for (let key of keys) {
            tlKey.push(key)
        }
        this.deleteMany(tlKey);
        this._isReq = false
        this.cacheSubEnum = null
    }

    updateLastCacheKey() {
        let tlLastCacheKey = this.tlLastCacheKey
        tlLastCacheKey.length = 0

        this.tmNowCacheKey.clear()

        let tlHashKey = this.dictionary.keys;
        for (let key of tlHashKey) {
            tlLastCacheKey.push(key)
        }
    }

    fixCacheByLastCacheKey() {
        let tmNowCacheKey = this.tmNowCacheKey

        let keys = this.dictionary.keys;
        let tlKey: string[] = []
        for (let key of keys) {
            if (!tmNowCacheKey.get(key)) {
                tlKey.push(key)
            }
        }
        this.deleteMany(tlKey);
    }

    public actionAfter() {
        // new_ 下一帧执行，未实现
        this.eventProxy.execute(EventType.onChange)
    }

    public hashKey(keyOrval: any): string {
        return Func.hashKey(keyOrval, this.tlKeyField)
    }

}