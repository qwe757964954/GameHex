import { FW } from "../FW"

interface Handler {
    resName: TRefName2
    primaryKey: string
    merge: string[]
}

/**
 * 合并Ref数据
 * @params resName 配置表名
 * @params primaryKey 主键一般是id或者key
 * @params merge 需要合并的字段
 */
export function MergeKeyRef<T extends Class<any>>(resName: TRefName2, primaryKey: string, merge: string[]) {
    return function (property: T) {
        let handler: Handler = {
            resName: resName,
            primaryKey: primaryKey,
            merge: merge,
        }
        MergeKeyRefMgr.inst().Collect(resName, handler)
    }
}

/**
 * 配置表合并管理器
 */
export class MergeKeyRefMgr {
    private static _instance: MergeKeyRefMgr
    public static inst() {
        return this._instance || (this._instance = new MergeKeyRefMgr())
    }

    private tmRedict = new Map<string, Handler>()
    Collect(resName: string, handler: Handler) {
        if (this.tmRedict.has(resName)) {
            FW.Log.error("重复收集：", resName, handler)
            return
        }
        this.tmRedict.set(resName, handler)
    }

    private _errors: string[] = []
    private _temp:any[] = []
    private _cache = new Map<string, any[]>()
    Merge(resName: string, data: any[]) {
        let handler = this.tmRedict.get(resName)
        let errors: string[] = this._errors
        let temp = this._temp

        temp.length = 0
        errors.length = 0

        if(handler == null){
            //没有修改器，直接返回原数据
            return data
        }

        if(this._cache.has(resName)){
            //直接返回缓存
            return this._cache.get(resName)
        }

        let result:any[] = []

        //清空旧数据
        // result.length = 0

        //开始筛选

        let lastPrimary: string | number
        let lastItem: any
        for (let i = 0; i < data.length; i++) {
            
            let item = data[i]
            
            let primary = item[handler.primaryKey]

            

            //异常，没有主键直接推
            if (primary == null) {
                //深拷贝
                let pitem = deepCopy(data[i])
                result.push(pitem)
                continue
            }

            if (lastPrimary != primary) {
                
                //深拷贝
                let pitem = deepCopy(data[i])

                //主键不一致，推
                lastPrimary = primary
                lastItem = pitem
                result.push(pitem)
                continue
            }

            //主键一致，尝试合并
            for (let key of handler.merge) {
                //检查字段是否存在
                if (item[key] == null) {
                    errors.push(`配置表  ${resName} 无法同ID合并: ${primary} ${key} 为空`)
                    continue
                }
                if (typeof item[key] == "string" || typeof item[key] == "number" || typeof item[key] == "boolean") {
                    errors.push(`配置表  ${resName} 无法同ID合并: ${primary} ${key} 类型必须为数组或对象`)
                    continue
                }
                //处理数组
                if (lastItem[key] instanceof Array) {
                    for (let j = 0; j < item[key].length; j++) {
                        lastItem[key].push(item[key][j])
                    }
                    continue
                }
                //处理obj
                for (let k of Object.keys(item[key])) {
                    lastItem[key][k] = item[key][k]
                }
            }
        }

        FW.Log.log(`配置表 ${resName} 同ID合并: 原长度${data.length} 现长度${result.length}`)
    

        if (errors.length > 0) {
            FW.Log.error("配置表同ID合并出错", errors.join("\r\n"))
        }
        errors.length = 0

        //缓存
        this._cache.set(resName, result)
        return result
            
    }
}

function deepCopy(data, hash = new WeakMap()) {
    if(typeof data !== 'object' || data === null){
          throw new TypeError('传入参数不是对象')
      }
    // 判断传入的待拷贝对象的引用是否存在于hash中
    if(hash.has(data)) {
          return hash.get(data)
      }
    let newData = {};
    const dataKeys = Object.keys(data);
    dataKeys.forEach(value => {
       const currentDataValue = data[value];
       // 基本数据类型的值和函数直接赋值拷贝 
       if (typeof currentDataValue !== "object" || currentDataValue === null) {
            newData[value] = currentDataValue;
        } else if (Array.isArray(currentDataValue)) {
           // 实现数组的深拷贝
          newData[value] = [...currentDataValue];
        } else if (currentDataValue instanceof Set) {
           // 实现set数据的深拷贝
           //  用 `Array.from` 而非 `[...set]`：release 构建会降级成 `[].concat(set)`，
           // concat 不展开迭代器 → 拷贝出来是个装着 Set 本身的单元素 Set。
           newData[value] = new Set(Array.from(currentDataValue));
        } else if (currentDataValue instanceof Map) {
           // 实现map数据的深拷贝
           newData[value] = new Map(Array.from(currentDataValue));
        } else { 
           // 将这个待拷贝对象的引用存于hash中
           hash.set(data,data)
           // 普通对象则递归赋值
           newData[value] = deepCopy(currentDataValue, hash);
        } 
     }); 
    return newData;
}