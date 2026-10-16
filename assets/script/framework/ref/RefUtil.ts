import { AssetManager, assetManager, JsonAsset, path, resources } from 'cc';
import { ScriptObject } from "../base/ScriptObject";
import { FW } from "../FW";
import { HttpLoader } from "../utils/HttpLoader";
import { MergeKeyRefMgr } from "./MergeKeyRef";
import { RedirectRefMgr } from "./RedirectRef";

const REMOTE_REF_BUNDLE = 'remoteRef';
let remoteRefBundlePromise: Promise<AssetManager.Bundle> | null = null;

function getLoadedRemoteRefJson(assetPath: string): JsonAsset | null {
    const bundle = assetManager.getBundle(REMOTE_REF_BUNDLE);
    return bundle?.get(assetPath, JsonAsset) ?? null;
}

function loadRemoteRefBundle(): Promise<AssetManager.Bundle> {
    const loaded = assetManager.getBundle(REMOTE_REF_BUNDLE);
    if (loaded) return Promise.resolve(loaded);
    if (!remoteRefBundlePromise) {
        remoteRefBundlePromise = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(REMOTE_REF_BUNDLE, (error, bundle) => {
                if (error) reject(error);
                else resolve(bundle);
            });
        }).catch((error) => {
            remoteRefBundlePromise = null;
            throw error;
        });
    }
    return remoteRefBundlePromise;
}

async function loadRemoteRefJson(assetPath: string): Promise<JsonAsset> {
    const cached = getLoadedRemoteRefJson(assetPath);
    if (cached) return cached;
    const bundle = await loadRemoteRefBundle();
    return new Promise<JsonAsset>((resolve, reject) => {
        bundle.load(assetPath, JsonAsset, (error, asset) => {
            if (error) reject(error);
            else resolve(asset);
        });
    });
}

/**
let a = await RefUtil.instance.getRefAsync("hero", "resId", 620001)
let b = await RefUtil.instance.getRefAsync("hero", ["resId"], 620001)
let c = await RefUtil.instance.getRefAsync("hero", ["resId", "type"], 620001, 2)

let a = await RefUtil.instance.getRefAllAsync("hero")
let a = RefUtil.instance.getRefAll("hero")

let a = RefUtil.instance.getRef("hero", "resId", 620001)
let a = RefUtil.instance.getTlRef("hero", "resId", 620001)
let b = RefUtil.instance.getTlRef("hero", ["resId"], 620001)
let c = RefUtil.instance.getTlRef("hero", ["resId", "type"], 640001, 5)
 */

// {
//   "tileX": 512,
//   "tileY": 512,
//   "walkX": 32,
//   "walkY": 32,
//   "width": 5092,
//   "height": 5440,
//   "walk": []
// }

export class RefUtil extends ScriptObject {
    static __cname: string = "RefUtil"

    private static readonly _instance = new RefUtil()

    // private readonly defaultKey = 'resId'
    // private readonly defaultKeys: string[] = ['resId']

    // 多久检查一次
    private readonly timeout: number = 1 * 60 * 1000
    // 过期多久就删除
    private readonly refTimeout: number = 5 * 60 * 1000
    // 上次检查时间
    private lastCheckTime: number

    private tmCache: { [key: string]: RefAssetCache } = {}
    

    // 合并配置表数据
    // [合并后文件名] = [文件名列表]
    // static tmMergeRefAll: { [key in string]: string[]; } = {}
    // [文件名] = 合并后文件名
    static tmMergeRef: { [key in string]: string } = {}

    // 如果配置是合并的,返回合并后的配置表名字
    getAllRefFileName(resName: string) {
        let tmMergeRef = RefUtil.tmMergeRef
        return tmMergeRef[resName]
    }

    private _fixConfigCallback = (resName: string, data: any) => { }

    setFixConfigCallback(callback: (resName: string, data: any) => void) {
        this._fixConfigCallback = callback
    }

    constructor() {
        super()
        this.lastCheckTime = this.getNowTime()
    }

    static get instance() {
        return this._instance
    }

    /**
     * 提前加载配置数据,执行完这个后,后面获取就不需要调用异步函数了
     * @param resName 配置表名字,不需要后缀
     */
    public async preloadRef(resName: string) {
        // let refPath = FW.refPath + resName;
        if (resName == "idConfig") {
            FW.LWX.log("加载IDConfig")
        }
        if ("roleProperty" == resName) {
            let c = 0
        }
        let data = this.getAssetData(resName)
        if (data == null) {
            data = await this.loadRefAsset(resName)
        }
        if (data == null) {
            console.error("配置表无法加载", resName)
        }
        let refCache = this.createRefAssetCache(resName, data)
        if (refCache) this.tmCache[resName] = refCache
    }

    public isLoaded(resName: string) {
        return this.tmCache[resName] != null
    }

    /**
     * 返回配置表的原始数据
     * @param resName 配置表名字,不需要后缀
     */
    public getRefAll(resName: string): any[] {
        let refAsset = this.getRefAssetCache(resName)
        if (!refAsset) {
            return
        }
        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.data
    }

    public async getRefAllAsync(resName: string): Promise<any[]> {
        let refAsset = await this.getRefAssetCacheAsync(resName)
        if (!refAsset) {
            return
        }
        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.data
    }

    /**
     * 返回配置的某行数据
     * @param resName 配置表名字,不需要后缀
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[2]的值
     */
    public getRef(
        resName: string,
        keyFields: string[] | string,
        key1?: string | number,
        key2?: string | number,
        key3?: string | number
    ) {
        let refAsset = this.getRefAssetCache(resName)
        if (!refAsset) {
            return
        }

        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.getRef(keyFields, key1, key2, key3)
    }

    public async getRefAsync(
        resName: string,
        keyFields: string[] | string,
        key1?: string | number,
        key2?: string | number,
        key3?: string | number
    ): Promise<any> {
        let refAsset = await this.getRefAssetCacheAsync(resName)
        if (!refAsset) {
            return
        }
        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.getRef(keyFields, key1, key2, key3)
    }

    /**
     * 返回配置的多行数据
     * @param resName 配置表名字,不需要后缀
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[1]的值
     */
    public getTlRef(
        resName: string,
        keyFields: string[] | string,
        key1?: string | number,
        key2?: string | number,
        key3?: string | number
    ): any[] {
        let refAsset = this.getRefAssetCache(resName)
        if (!refAsset) {
            return
        }
        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.getTlRef(keyFields, key1, key2, key3)
    }

    public async getTlRefAsync(
        resName: string,
        keyFields: string[] | string,
        key1?: string | number,
        key2?: string | number,
        key3?: string | number
    ): Promise<any[]> {
        let refAsset = await this.getRefAssetCacheAsync(resName)
        if (!refAsset) {
            return
        }
        refAsset.updateUseTime()
        this.checkTimeout()
        return refAsset.getTlRef(keyFields, key1, key2, key3)
    }

    private getRefAssetCache(resName: string) {
        let refCache = this.tmCache[resName]
        if (!refCache) {
            // let refPath = FW.refPath + resName;
            let data = this.getAssetData(resName)
            refCache = this.createRefAssetCache(resName, data)
            if (refCache) {
                this.tmCache[resName] = refCache
            }
        }
        return refCache
    }

    private async getRefAssetCacheAsync(resName: string) {
        let refCache = this.tmCache[resName]
        if (!refCache) {
            // let refPath = FW.refPath + resName;
            let data = this.getAssetData(resName)
            if (!data) {
                data = await this.loadRefAsset(resName)
            }
            refCache = this.createRefAssetCache(resName, data)
            if (refCache) {
                this.tmCache[resName] = refCache
            }
        }
        return refCache
    }

    private createRefAssetCache(resName: string, data: { [key: string]: any }) {
        if (data == null) {
            console.error("配置还没有加载: " + resName)
            return
        }
        let refCache = new RefAssetCache()

        refCache.data = data
        refCache.path = resName
        return refCache
    }

    private tmJsonData = {}
    /**
     * 配置表原始数据
     * @param resName 配置文件名,不用后缀
     * @returns 返回配置表原始数据
     */
    private getAssetData(resName: string): any[] {
        let t = this
        // let data = this.tmJsonData[resName]
        // if (data != null) {
        //     return data
        // }
        let data = t.getAssetData_(resName)
        if (data != null) {
            return data
        }

        // let refPath = FW.refPath + resName;
        let resNameAll = t.getAllRefFileName(resName)
        if (resNameAll != null) {
            let refPathAll = FW.GetRefPath(resNameAll)
            // let tmAllData = t.getAssetData_(resNameAll)
            // let tmAllData: any
            // let jsonAsset = cc.resources.get<cc.JsonAsset>(refPathAll)
            // if (jsonAsset) {
            //     tmAllData = jsonAsset.json
            // }
            let tmAllData = this.getResData(refPathAll)
            if (!tmAllData) {
                return
            }

            let func = this._fixConfigCallback

            // 释放合并的配置
            for (let k in tmAllData) {
                let data_ = tmAllData[k]

                //尝试还原数据，如果没有就返回原数据
                let data2 = this.tryGetCompressKeyRefData(k, data_)

                func(k, data2)

                Object.freeze(data2)
                t.tmJsonData[k] = data2
            }

            data = t.tmJsonData[resName]
            if (data == null) {
                t.error("合并配置表中没有找到数据: " + resName + " " + resNameAll)
            } else {
            }
            resources.release(refPathAll, JsonAsset)
        }
        return data
    }
    private getAssetData_(resName: string): any[] {
        let data = this.tmJsonData[resName]
        if (data != null) {
            return data
        }
        let refPath = FW.GetRefPath(resName)
        // let jsonAsset = cc.resources.get<cc.JsonAsset>(refPath)
        let data_ = this.getResData(refPath)
        if (data_) {
            // let data_ = jsonAsset.json
            //尝试还原数据，如果没有就返回原数据
            data = this.tryGetCompressKeyRefData(resName, data_)

            let func = this._fixConfigCallback
            func(resName, data)

            resources.release(refPath, JsonAsset)
            Object.freeze(data)
            this.tmJsonData[resName] = data
        }
        return data
    }

    getResData(refPath: string) {
        // let jsonAsset = cc.resources.get<cc.JsonAsset>(refPath)

        let p = refPath.startsWith("ref/") ? refPath.replace("ref/", "") : refPath

        let resNameAll = this.getAllRefFileName(p)
        if (resNameAll != null) {
            return null;
        }

        let jsonasset = getLoadedRemoteRefJson(p)

        if (!jsonasset) {
            return null;
        }
        let res = jsonasset.json

        return res
    }

    private tryGetCompressKeyRefData(resName: string, data_: any) {
        let result
        let retData = this.compressKeyRefDataFix(resName, data_)
        if (retData) {
            result = retData
        } else {
            result = data_
        }
        //合并Ref数据
        result = MergeKeyRefMgr.inst().Merge(resName, result)

        //重定向Ref数据结构
        result = RedirectRefMgr.inst().Redirect(resName, result)
        return result
    }
    // static readonly tlEmpty = [];
    // static readonly tmEmpty = [];
    // 压缩key的配置表数据还原
    private compressKeyRefDataFix(resName: string, data_: any) {
        let data: any
        // 还原数据
        // let isOK = false
        if (data_ && typeof data_ == "object" && data_ instanceof Object && data_.c == 1) {
            let fixData = []
            let tlKey = data_.k
            if (tlKey && tlKey.length > 0) {
                let tltlValue = data_.v
                let tlSameValue = data_.sv // || RefUtil.tlEmpty
                let tmValueKey = data_.vk // || RefUtil.tmEmpty
                for (let i = 0, len = tltlValue.length; i < len; i++) {
                    let tlValue = tltlValue[i]
                    let kValue = {}
                    for (let j = 0, len2 = tlValue.length; j < len2; j++) {
                        let key = tlKey[j]
                        if (key != null) {
                            let v = tlValue[j]
                            if (tlSameValue) {
                                if (v && typeof v == "string" && v.length > 2 && v.indexOf(">}") == 0) {
                                    let num = Number(v.slice(2))
                                    if ((num && num > 0) || num == 0) {
                                        v = tlSameValue[num]
                                    }
                                }
                            }
                            if (tmValueKey) {
                                let tlValueKey = tmValueKey[key]
                                if (tlValueKey && tlValueKey.length > 0) {
                                    if (v?.length) {
                                        let x_len = v.length
                                        if (x_len > 0) {
                                            let vv = {}
                                            for (let x = 0; x < x_len; x++) {
                                                let v_t = v[x]
                                                vv[tlValueKey[x]] = v_t
                                            }
                                            v = vv
                                        }
                                    }
                                }
                            }
                            kValue[key] = v
                        } else {
                            console.error("压缩配置表key错误: " + resName)
                        }
                    }
                    fixData.push(kValue)
                }
                data = fixData
                // isOK = true
            }
        }
        // if (!isOK) {
        //     data = data_
        // }
        return data
    }

    static async loadRefSmallAll() {
        let tmMergeRef = RefUtil.tmMergeRef
        let refSmallAllName = "refSmallAll.json"
        let refSmallMainFileName = path.mainFileName(refSmallAllName)
        // let tmSmallAll = await ResourceMgr.loadJson(refSmallAllName);
        console.log("loading ref: " + refSmallMainFileName)
        let jsonasset = await loadRemoteRefJson(refSmallMainFileName)
        if (jsonasset) {
            let tmSmallAll = jsonasset.json

            if (tmSmallAll) {
                for (let refFileName in tmSmallAll) {
                    tmMergeRef[refFileName] = refSmallMainFileName
                }
            }
        }
    }

    private async loadRefAsset(resName: string): Promise<any> {
        // let rsp = await HttpLoader.RequestJson("https://emr-daqin-diguo.oss-cn-shanghai.aliyuncs.com/file-up/test/gmbackend-daqin2/notice//24/fengniao-fengniao.json")
        // FW.YWC.log(rsp.json)
        let resNameAll = this.getAllRefFileName(resName)
        if (resNameAll != null) {
            resName = resNameAll
        }
        let refPath = FW.GetRefPath(resName)
        let result: any[]
        if (FW.isRemoteRef) {
            FW.ZJJ.log("外部配置表:", refPath)
            let rsp = await HttpLoader.RequestJson(refPath, true)
            result = rsp.json

            //合并Ref数据
            result = MergeKeyRefMgr.inst().Merge(resName, result)
            //重定向Ref数据结构
            result = RedirectRefMgr.inst().Redirect(resName, result)
        } else {
            // let res = await ResourceMgr.loadJson(refPath)
            //改成从bundle获取
            let p = refPath.startsWith("ref/") ? refPath.replace("ref/", "") : refPath
            let jsonasset = await loadRemoteRefJson(p)
            let res = jsonasset?.json

            //尝试还原数据，如果没有就返回原数据
            let data = this.tryGetCompressKeyRefData(resName, res)
            result = data
        }

        return result
    }

    private getNowTime() {
        return Date.now()
    }

    private checkTimeout() {
        // 暂时屏蔽移除逻辑,现在有点问题,应该使用引用计数处理
        return
        const now = this.getNowTime()
        let time = now - this.timeout
        if (time < this.lastCheckTime) {
            return
        }
        this.lastCheckTime = now

        time = now - this.refTimeout

        let tmCache = this.tmCache
        for (let k in tmCache) {
            let refAsset = tmCache[k]
            if (time > refAsset.lastUseTime) {
                refAsset.destroy()
                delete tmCache[k]
                console.log("配置表缓存长时间未使用，移除出缓存: " + k)
            }
        }
    }
}


export class RefAssetCache {

    path: string;
    data: any;
    lastUseTime: number;

    private tmCachOne: { [key: string]: { [key: string]: any } } = {}
    private tmCachList: { [key: string]: { [key: string]: any[] } } = {}

    constructor() {
        this.updateUseTime()
    }

    destroy() {
        this.tmCachOne = null;
        this.tmCachList = null;
        this.data = null;
        this.path = null;
    }

    public updateUseTime() {
        this.lastUseTime = this.getNowTime()
    }

    /**
     * 返回配置的某行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[1]的值
     */
    getRef(keyFields: string[] | string, key1?: string | number, key2?: string | number, key3?: string | number) {
        if (!keyFields || keyFields.length <= 0) {
            console.error('getRef配置表获取异常keyFields null:' + this.path)
            // return this.data
        }
        if (key1 == null) {
            console.error('getRef配置表获取异常key1 null:' + this.path)
            return null
        }
        let fieldKey = this.getRefFieldKey(keyFields)
        let tmCache: { [key: string]: any } = this.tmCachOne[fieldKey];
        if (!tmCache) {
            tmCache = this.initCache(this.data, keyFields)
            this.tmCachOne[fieldKey] = tmCache
        }
        let valueKey = this.getRefValueKey(key1, key2, key3)
        let result = tmCache[valueKey];
        return result;
    }

    /**
     * 返回配置的多行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[1]的值
     */
    getTlRef(keyFields?: string[] | string, key1?: string | number, key2?: string | number, key3?: string | number): any[] {
        if (!keyFields || keyFields.length <= 0) {
            console.error('getTlRef配置表获取异常keyFields null:' + this.path)
            // return this.data
        }
        if (key1 == null) {
            console.error('getTlRef配置表获取异常key1 null:' + this.path)
            return null
        }
        let fieldKey = this.getRefFieldKey(keyFields)
        let tmTlCache: { [key: string]: any[] } = this.tmCachList[fieldKey];
        if (!tmTlCache) {
            tmTlCache = this.initCacheList(this.data, keyFields)
            this.tmCachList[fieldKey] = tmTlCache
        }
        let valueKey = this.getRefValueKey(key1, key2, key3)
        return tmTlCache[valueKey];
    }


    private initCache(data: { [key: string]: any }, keyFields: string[] | string, tmCache?: { [key: string]: any }) {
        if (tmCache == null) {
            tmCache = {}
        }
        let keyObj: string;
        let line: { [key: string]: any };
        let lastLine: { [key: string]: any };
        for (let i = 0, len = data.length; i < len; i++) {
            line = data[i]
            keyObj = this.getRefValueKeyByField(line, keyFields)
            if (keyObj) {
                lastLine = tmCache[keyObj]
                if (lastLine != null) {
                    FW.Log.log("有相同key的数据: " + this.path + " " + keyObj)
                }
                tmCache[keyObj] = line
            }
        }
        return tmCache
    }

    private initCacheList(data: { [key: string]: any }, keyFields: string[] | string, tmCache?: { [key: string]: any[] }) {
        if (tmCache == null) {
            tmCache = {}
        }
        let keyObj: string;
        let line: { [key: string]: any };
        let list: { [key: string]: any }[];
        for (let i = 0, len = data.length; i < len; i++) {
            line = data[i]
            keyObj = this.getRefValueKeyByField(line, keyFields)
            if (keyObj) {
                list = tmCache[keyObj]
                if (list == null) {
                    list = []
                    tmCache[keyObj] = list
                }
                list.push(line)
            }
        }
        return tmCache
    }

    private getRefFieldKey(args: string[] | string) {
        let hashKey: string;
        if (typeof (args) == "string") {
            hashKey = args
        } else {
            // } else if (typeof (args) == "object") {
            let len = args.length
            if (len == 1) {
                hashKey = args[0].toString()
            } else if (len > 1) {
                hashKey = args.join("_");
            } else {
                console.warn("getRefFieldKey args null");
            }
        }
        return hashKey;
    }

    private getRefValueKey(key1?: string | number, key2?: string | number, key3?: string | number): string | number {
        let hashKey: string;
        if (key2 != null) {
            let tlKey: (string | number)[] = [key1, key2];
            if (key3 != null) {
                tlKey.push(key3)
            }
            hashKey = tlKey.join("_")
        } else {
            hashKey = key1.toString()
        }
        return hashKey;
    }

    private getRefValueKeyByField(obj: { [key: string]: string | number }, keyFields: string[] | string): string {
        let keyObj: string | number;
        let keyField: string;
        if (typeof (keyFields) == "string") {
            keyField = keyFields
            keyObj = obj[keyField]
        } else {
            const keyLen = keyFields.length
            if (keyLen == 1) {
                keyField = keyFields[0]
                keyObj = obj[keyField].toString();
            } else {
                let tlKey: (string | number)[] = [];
                let val: | string | number;
                for (let i = 0; i < keyLen; i++) {
                    keyField = keyFields[i]
                    val = obj[keyField]
                    if (val != undefined || val != null) {
                        tlKey.push(val)
                    } else {
                        console.error('配置表key异常:' + this.path + " " + keyField)
                    }
                }
                keyObj = tlKey.join("_")
            }
        }
        if (keyObj == undefined || keyObj == null) {
            console.error('配置表key异常' + this.path + " " + keyField)
        }
        return keyObj.toString();
    }

    private getNowTime() {
        return Date.now()
    }

}

/*
https://www.cnblogs.com/snandy/p/5278474.html
扩展对象
不能再添加新的属性
Object.preventExtensions
Object.isExtensible

密封对象
不能添加新的属性，不能删除已有属性，以及不能修改已有属性的可枚举性、可配置性、可写性，但可以修改已有属性的值的对象。
Object.seal
Object.isSealed

冻结对象
不能添加新的属性，不能修改已有属性的值，不能删除已有属性，以及不能修改已有属性的可枚举性、可配置性、可写性的对象。也就是说，这个对象永远是不可变的
Object.freeze
Object.isFrozen
*/
