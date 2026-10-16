import { ResourceMgr } from "../../engine/ResourceMgr";
import { ScriptObject } from "../base/ScriptObject";
import { TDic } from "../collection/TDic";
import { ProtoMgr } from "../net/ProtoMgr";
import { EventType, GameCache } from "./GameCache";

enum CacheOperaterType {
    CacheOperaterType_Update = 1,
    CacheOperaterType_Delete = 2,
    CacheOperaterType_UpdateByField = 3
}

export class GameCacheMgr extends ScriptObject {
    static __cname: string = "GameCacheMgr";

    // static instance: GameCacheMgr = new GameCacheMgr();

    // private static _instance: GameCacheMgr;
    // static get instance(): GameCacheMgr {
    //     if (!GameCacheMgr._instance) {
    //         GameCacheMgr._instance = new GameCacheMgr;
    //     }
    //     return GameCacheMgr._instance;
    // }

    /**
     * 协议的描述文件(协议字段名字,字段类型,字段位置)
     */
    private static readonly protoCacheFile = "config/protoCache";

    private _theCacheSubEnum: any;
    set theCacheSubEnum(value: any) {
        this._theCacheSubEnum = value;
    }

    /**是否是订阅数据 */
    isCacheSubEnumById(id: number) {
        return this._theCacheSubEnum[id] != null
    }
    /**是否是订阅数据 */
    isCacheSubEnumByKey(key: string) {
        return this._theCacheSubEnum[key] != null
    }

    /**缓存结构描述信息 */
    private static protoCacheMessage: any;

    /**所有缓存信息 */
    private cacheDictionary: TDic<string, GameCache>;
    getCacheDictionary() {
        return this.cacheDictionary;
    }
    /**逐字段更新proto解析类 */
    private cmdCacheUpdateByField_ProtoClass: any;
    constructor() {
        super()
        this.cacheDictionary = new TDic<string, GameCache>();
    }

    destroy() {
        this.destroyed = true
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        let k: string;
        let gameCache: GameCache;
        for (k in tmGameCache) {
            gameCache = tmGameCache[k]
            if (gameCache) {
                gameCache.destroy()
            }
        }
        this.cacheDictionary.clear()
        this.cacheDictionary = null
        super.destroy()
    }

    /**
     * 加载协议描述文件
     */
    async loadProtoCache(): Promise<boolean> {
        let refPath = GameCacheMgr.protoCacheFile;
        return await ResourceMgr.loadJson(refPath);
    }

    async init() {
        if (this.cmdCacheUpdateByField_ProtoClass) {
            return
        }
        GameCacheMgr.protoCacheMessage = await this.loadProtoCache()
        this.cmdCacheUpdateByField_ProtoClass = ProtoMgr.get().protoCoder.getCmdCacheUpdateByField();
    }

    /**
     * ⚠️ **解绑路径一律走"存在才操作"，禁止用 `getCache()`。**
     *
     * `getCache()` 会在缺缓存时 `new GameCache(name)`，而 `GameCache` 的构造会 `init()`
     * 去读协议描述表（`GameCacheMgr.protoCacheMessage`）。表还没加载时（热更态 / 未登录态 /
     * 断网）`getCacheMessage` 直接抛 `TypeError: Cannot read properties of undefined`。
     *
     * 这个异常如果抛在 `onDestroy` 里，后果被放大得很厉害：
     *   ① 节点拿不到"已销毁"标记 ⇒ **卡在 deferred destroy 队列里逐帧重试**（实测 163 次/2.5s）；
     *   ② 每次重试都对父节点发一次 `CHILD_REMOVED`；
     *   ③ Cocos 的 `Node._removeChild` 实现是 `splice(indexOf(child), 1)` —— 此时该子节点
     *      早已不在数组中，`indexOf === -1` ⇒ **`splice(-1, 1)` 会删掉父节点的最后一个子节点**。
     * ⇒ 表现成"刚切进来的页面下一帧自己消失了"，而且**一句错都不报**（错误被 onDestroy 吞进队列重试）。
     *
     * 语义上解绑也不该有副作用：没有缓存就说明从来没绑过，直接返回即可。
     */
    private peekCache(cacheName: string): GameCache | null {
        return this.cacheDictionary.get(cacheName) ?? null;
    }

    setEvent(cacheName: string, eventType: EventType, caller: destroyable, callback: Function) {
        let eventProxy = this.getCache(cacheName).eventProxy;
        eventProxy.removeListener(eventType, caller, callback)
        eventProxy.addListener(eventType, caller, callback)
    }

    removeEvent(cacheName: string, eventType: EventType, caller: destroyable, callback: Function) {
        const cache = this.peekCache(cacheName);
        if (cache == null) return;
        cache.eventProxy?.removeListener(eventType, caller, callback)
    }

    removeEventCaller(cacheName: string, caller: destroyable) {
        const cache = this.peekCache(cacheName);
        if (cache == null) return;
        cache.eventProxy?.removeCallerListener(caller)
    }

    removeEventAll(cacheName: string) {
        const cache = this.peekCache(cacheName);
        if (cache == null) return;
        cache.eventProxy?.removeAll()
    }

    removeEventCallerAllCache(caller: destroyable) {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        for (let k in tmGameCache) {
            tmGameCache[k].eventProxy.removeCallerListener(caller)
        }
    }

    removeEventAllCache() {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        for (let k in tmGameCache) {
            tmGameCache[k].eventProxy.removeAll()
        }
    }

    // update
    setEventUpdate(cacheName: string, caller: destroyable, callback: Function) {
        this.setEvent(cacheName, EventType.onUpdate, caller, callback)
    }

    removeEventUpdate(cacheName: string, caller: destroyable, callback: Function) {
        this.removeEvent(cacheName, EventType.onUpdate, caller, callback)
    }

    // change
    setEventChange(cacheName: string, caller: destroyable, callback: Function) {
        this.setEvent(cacheName, EventType.onChange, caller, callback)
    }

    removeEventChange(cacheName: string, caller: destroyable, callback: Function) {
        this.removeEvent(cacheName, EventType.onChange, caller, callback)
    }

    // add
    setEventAdd(cacheName: string, caller: destroyable, callback: Function) {
        this.setEvent(cacheName, EventType.onAdd, caller, callback)
    }

    removeEventAdd(cacheName: string, caller: destroyable, callback: Function) {
        this.removeEvent(cacheName, EventType.onAdd, caller, callback)
    }

    /**获取数据缓存 */
    getCache(cacheName: string): GameCache {
        let cacheDictionary = this.cacheDictionary
        let cache = cacheDictionary.get(cacheName);
        if (cache == null) {
            cache = new GameCache(cacheName);
            cacheDictionary.set(cacheName, cache);
        }
        return cache;
    }

    /**
     * 取单条缓存。
     *
     *  `key` 的类型用条件类型收敛：`Cmd.d.ts` 的 `CmdXxx_Key` 类与运行时真正吃键的
     * `protoCache.json.tlKey`（`GameCache.tlKeyField` → `Func.hashKey`）**在 12 张表上不一致**，
     * 其中 `CmdRole` / `CmdGameCircle` / `CmdFirstRechargeNew` 三张表 `_Key` 是空类
     * （`keyof TK` = never → 参数类型会塌成 `undefined`，任何实参都过不了编译）。
     * 这两套产物各有各的约定（protoCache 取 fieldNumber==1，`_Key` 取 proto 的 key 注记），
     * 生成方 `app/generated/netProto/CacheMgrGen.ts` 以 protoCache 为准 —— 以「_Key 没声明键」
     * 时退化成 `any` 兜住。运行时无影响，纯类型标注。
     *
     * @param cacheName 缓存名称
     * @param key 缓存key
     */
    protected get<T extends keyof protoCacheGen, TK extends protoCacheGen[T]["c_k"]>(cacheName: T, key?: [keyof TK] extends [never] ? any : TK[keyof TK]): protoCacheGen[T]["c"] {
        let cache = this.cacheDictionary.get(cacheName);
        if (cache != null) {
            return cache.get(key);
        }
        return null;
    }

    /**
     * 取单条缓存（多键 / 键值是对象时用）。
     *
     *  键值类型是 `any` 而不是 `string | number`：`CmdFirstRechargeNew` / `CmdDayWeekMonthGift`
     * 这两张表的 `protoCache.tlKey` 指向 repeated message 字段（见 `CacheMgrGen` 里各自方法上的
     * 注释），它们的键值就是一个数组 —— 收成标量类型的话生成文件过不了编译。
     * 运行时无影响：`Func.hashKey` 只按 `tlKeyField` 取字段名，不看值类型。
     *
     * @param cacheName 缓存名称
     * @param key 缓存key
     */
    protected get2<T extends keyof protoCacheGen, TK extends protoCacheGen[T]["c_k"]>(cacheName: T, key: { [key in string]: any; }): protoCacheGen[T]["c"] {
        let cache = this.cacheDictionary.get(cacheName);
        if (cache != null) {
            return cache.get(key);
        }
        return null;
    }

    /**
     * 
     * @param cacheName 缓存名称
     */
    static null_list = []
    protected getValues<T extends keyof protoCacheGen>(cacheName: T): protoCacheGen[T]["c"][] {
        let cache = this.cacheDictionary.get(cacheName);
        if (cache != null) {
            return cache.cacheDict.values;
        }
        // return null;
        return GameCacheMgr.null_list;
    }

    /**
     * 
     * @param cacheName 缓存名称
     */
    // getAll(cacheName: string) {
    // 	let cache = this.cacheDictionary.get(cacheName);
    // 	if (cache != null) {
    // 		return cache.getAll();
    // 	}
    // 	return null;
    // }

    /**
     * 清除某个缓存
     * @param cacheName 缓存名称
     */
    clearOne(cacheName: string): boolean {
        let cache: GameCache = this.cacheDictionary.get(cacheName);
        if (cache != null) {
            cache.clear();
            return true
        }
        return false
    }

    updateLastCacheKeyAll() {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        let k: string;
        let gameCache: GameCache;
        for (k in tmGameCache) {
            gameCache = tmGameCache[k]
            gameCache.updateLastCacheKey();
        }
    }

    fixCacheByLastCacheKeyAll() {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        let k: string;
        let gameCache: GameCache;
        for (k in tmGameCache) {
            gameCache = tmGameCache[k]
            gameCache.fixCacheByLastCacheKey();
        }
    }

    /**
     * 清除所有缓存
     */
    clearAll() {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        let k: string;
        let gameCache: GameCache;
        for (k in tmGameCache) {
            gameCache = tmGameCache[k]
            gameCache.clear();
        }
    }

    removeCallerListenerAll(caller: any) {
        let tmGameCache: GameCache[] = this.cacheDictionary.dict;
        let k: string;
        let gameCache: GameCache;
        for (k in tmGameCache) {
            gameCache = tmGameCache[k]
            gameCache.eventProxy.removeCallerListener(caller);
        }
    }

    /**模仿网络缓存数据,本地也可以创建数据缓存 */
    // getLocalCache(cacheName: string): LocalGameCache {
    //     let cacheDictionary = this.cacheDictionary
    //     let cache: LocalGameCache = cacheDictionary.get(cacheName);
    //     if (cache == null) {
    //         cache = new LocalGameCache(cacheName);
    //         cacheDictionary.set(cacheName, cache);
    //     }
    //     return cache;
    // }

    /**
     * 协议数据描述(协议字段名字,字段类型,字段位置)
     * @param name // "CmdHero"
     */
    static getCacheMessage(name: string): any {
        return GameCacheMgr.protoCacheMessage[name];
    }

    //缓存操作列表
    // message CmdCacheOperaterList{
    // 	required CacheEnum cacheEnum = 1;//缓存名称
    // 	repeated CmdCacheOperater tlCmdCacheOperater = 2;//缓存操作
    // }
    /**处理收到的数据 */
    handleCmdCache(cmdCache: CmdCache) {
        let gameCache = this.getCache(cmdCache.cacheName);

        /**订阅缓存,只有订阅过才保存缓存 */
        // if (rspMsgName == "CmdCacheSubRspMsg") {
        //     gameCache.isReq = true
        // } else if (!gameCache.isReq && this.isCacheSubEnumById(cacheEnum)) {
        //     return
        // }

        this.handleCache(gameCache, cmdCache);
    }

    /**处理收到的数据 */
    /*
    handleCmdCache(cacheName: string, cmdCacheOperater: any) {
        let cache = this.getCache(cacheName);
        this.handleCmdCacheOperater(cache, cmdCacheOperater);
    }
    */

    // private static readonly enterMsgName = "CmdPlayerEnterReqMsg"

    /**处理收到的数据 */
    private handleCache(gameCache: GameCache, cmdCache: CmdCache) {

        let type: number = cmdCache.type;
        let data = cmdCache.data
        let isOK = true;
//        console.log("handleCache", cmdCache.cacheName, type)
        if (type == CacheOperaterType.CacheOperaterType_Update) {
            for (let item of data) {
                gameCache.updateByUint8Array(item);
            }

            if (data.length == 0)
            {
                gameCache.notifyNone()
            }
        } else if (type == CacheOperaterType.CacheOperaterType_UpdateByField) {
            let cmdCacheUpdateByField;
            for (let item of data) {
                cmdCacheUpdateByField = this.cmdCacheUpdateByField_ProtoClass.decode(item);
                gameCache.updateByField(cmdCacheUpdateByField);
            }
        } else if (type == CacheOperaterType.CacheOperaterType_Delete) {
            for (let item of data) {
                gameCache.deleteByUint8Array(item);
            }
        } else {
            isOK = false
        }
        if (isOK) {
            gameCache.actionAfter();
        }
    }

    /*
    async getSubCache(cacheSubEnum: CacheSubEnum, isGet: boolean = false): Promise<GameCache> {
        let cacheName = ProtoCoder.getCacheSubName(cacheSubEnum)
        let gameCache = this.getCache(cacheName)
        if (!gameCache.isReq || isGet) {
            await Game.AppNetwork.send("CmdCacheSubReqMsg", { tlCacheSubEnum: [cacheSubEnum] }, (rsp: any) => {
                gameCache = this.getCache(cacheName)
                gameCache.cacheSubEnum = cacheSubEnum
            }, null, this)
        }
        return gameCache
    }
    */

    // CacheSubEnum
    getTheSubCache(cacheSubEnum: any): GameCache {
        let proto = ProtoMgr.get().protoCoder
        let cacheName: any = proto.getCacheSubName(cacheSubEnum)
        let gameCache = this.getCache(cacheName)
        if (gameCache.isReq) {
            return gameCache
        }
        return null
    }

    //处理缓存数据
    // parseCacheData(cmdCacheAppMsg: any) {
    //     let tlCmdCache = []
    //     if (cmdCacheAppMsg != null) {
    //         let cmdCacheOperaterList = cmdCacheAppMsg.cmdCacheOperaterList;
    //         if (cmdCacheOperaterList) {
    //             let tlCmdCacheOperater = cmdCacheOperaterList.tlCmdCacheOperater;
    //             let cacheEnum = cmdCacheOperaterList.cacheEnum;
    //             let cacheName = this.keyNameMap.get(cacheEnum);
    //             let proto = ProtoMgr.get().protoCoder
    //             for (let cmdCacheOperater of tlCmdCacheOperater) {
    //                 let tlData = cmdCacheOperater.tlData;
    //                 if (tlData == null || tlData.length <= 0) {
    //                     return
    //                 }
    //                 for (let data of tlData) {
    //                     let cmdCache = proto.decodeDataByName(cacheName, data);
    //                     if (cmdCache) {
    //                         tlCmdCache.push(cmdCache)
    //                     }
    //                 }
    //             }
    //         }

    //     }
    //     return tlCmdCache
    // }
}
