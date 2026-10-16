/**
* 字典型的数据存取类,如果key是string或者number建议使用TDic类创建字典
*/
export class TMap<K, V>{
    static __cname: string = "TMap";

    private _values: V[];
    private _keys: K[];

    constructor() {
        this._values = [];
        this._keys = [];
    }

    /**
    *给指定的键名设置值。
    *@param key 键名。
    *@param value 值。
    */
    set(key: K, value: V) {
        var index = this.indexOf(key);
        if (index >= 0) {
            this._values[index] = value;
            return;
        }
        this._keys.push(key);
        this._values.push(value);
    }


    /**
    *获取指定对象的键名索引。
    *@param key 键名对象。
    *@return 键名索引。
    */
    indexOf(key: K) {
        //  indexOf Internet Explorer 8 及 更早IE版本不支持该方法
        // var index = this._keys.indexOf(key);
        // if (index >= 0) {
        //     return index;
        // }
        // return index;
        return this._keys.indexOf(key);
    }

    /**
    *返回指定键名的值。
    *@param key 键名对象。
    *@return 指定键名的值。
    */
    get(key: K) {
        var index = this.indexOf(key);
        return index < 0 ? null : this._values[index];
    }

    /**
    *移除指定键名的值。
    *@param key 键名对象。
    *@return 是否成功移除。
    */
    remove(key: K) {
        var index = this.indexOf(key);
        if (index >= 0) {
            this._keys.splice(index, 1);
            this._values.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
    *清除此对象的键名列表和键值列表。
    */
    clear() {
        this._values.length = 0;
        this._keys.length = 0;
    }

    /**
    *获取所有的子元素列表。
    */
    getList(): V[] {
        return this.values;
    }
    get values(): V[] {
        return this._values;
    }

    /**
    *获取所有的子元素键名列表。
    */
    get keys(): K[] {
        return this._keys;
    }

    work(func: (key: K, value: V) => void, caller?: any) {
        let keys = this._keys
        let values = this._values
        if (caller != null) {
            for (let i = 0, len = keys.length; i < len; i++) {
                func.call(caller, keys[i], values[i])
            }
        } else {
            for (let i = 0, len = keys.length; i < len; i++) {
                func(keys[i], values[i])
            }
        }
    }

    /**
     * 每一项是否满足
     */
    every(func: (key: K, value: V) => boolean): boolean {
        let keys = this._keys
        let values = this._values
        let len = keys.length
        if (len <= 0) {
            return false
        }
        for (let i = 0; i < len; i++) {
            if (!func(keys[i], values[i])) {
                return false
            }
        }
        return true
    }

    /**
     * 有一项满足
     */
    some(func: (key: K, value: V) => boolean): boolean {
        let keys = this._keys
        let values = this._values
        for (let i = 0, len = keys.length; i < len; i++) {
            if (func(keys[i], values[i])) {
                return true
            }
        }
        return false
    }

    /**
     * 过滤,返回满足条件的key数组
     */
    filterKeys(func: (key: K, value: V) => boolean): K[] {
        let tlKey: K[] = []
        let key_: K;
        let keys = this._keys
        let values = this._values
        for (let i = 0, len = keys.length; i < len; i++) {
            key_ = keys[i]
            if (func(key_, values[i])) {
                tlKey.push(key_)
            }
        }
        return tlKey
    }

    /**
     * 过滤,返回满足条件的value数组
     */
    filterValues(func: (key: K, value: V) => boolean): V[] {
        let tlValue: V[] = []
        let value_: V;
        let keys = this._keys
        let values = this._values
        for (let i = 0, len = keys.length; i < len; i++) {
            value_ = values[i]
            if (func(keys[i], value_)) {
                tlValue.push(value_)
            }
        }
        return tlValue
    }
}