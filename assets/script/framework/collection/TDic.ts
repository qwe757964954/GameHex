
/**
 * 字典
 * 索引签名参数类型必须为 "string" 或 "number"
 */
export class TDic<T extends string | number, V> {
    static __cname: string = "TDic";

    // private _dict: { [key: T]: V };
    private _dict: any;
    private _tlValue: V[]

    constructor() {
        this._dict = {}
        this._tlValue = []
    }

    get dict() {
        return this._dict
    }

    get keys(): string[] {
        return Object.keys(this._dict)
    }

    /**默认调用remove删除数据后,需要重新调用values获取新的values数据 */
    get values(): V[] {
        let values: V[] = this._tlValue

        if (!this._updateValues) {
            return values;
        }

        values.length = 0

        let _dict = this._dict

        let k: string;
        for (k in _dict) {
            values.push(_dict[k])
        }
		/*
		var hasOwn = Object.prototype.hasOwnProperty;
		let k;
		for (k in _dict) {
			if (hasOwn.call(_dict,  k)) {
				values.push(_dict[k])
			}
		}
        */

        this._updateValues = null;

        return values;
    }

    private _updateValues = true
    // getValues(updateValues: boolean = true): V[] {
    //     if (updateValues || this._updateValues) {
    //         this._updateValues = null
    //         let a = this.values
    //     }
    //     return this._tlValue
    // }

    get(k: T): V {
        return this._dict[k];
    }

    set(k: T, v: V) {
        this._dict[k] = v
        this._updateValues = true
    }

    /**默认删除数据,values不会即时更新,需要重新调用values获取 */
    remove(k: T, removeValue: boolean = false): boolean {
        let value = this._dict[k]
        if (value !== undefined) {
            delete this._dict[k]

            if (removeValue) {
                let _tlValue = this._tlValue
                if (_tlValue != null) {
                    for (let i = _tlValue.length - 1; i >= 0; i--) {
                        if (_tlValue[i] === value) {
                            _tlValue.splice(i, 1)
                            break
                        }
                    }
                }
            } else {
                this._updateValues = true
            }

            return true
        }
        return false
    }

    // 情况临时缓存
    clearTempValues() {
        this._tlValue.length = 0
        this._updateValues = true
    }

    clear() {
        let _dict = this._dict
        let k;
        for (k in _dict) {
            delete _dict[k]
        }
        this._tlValue.length = 0
        this._updateValues = true
    }

    work(func: (key: string | number, value: V) => void) {
        let _dict = this._dict
        let k;
        for (k in _dict) {
            func(k, _dict[k])
        }
    }

	/**
	 * 每一项是否满足
	 */
    every(func: (key: string | number, value: V) => boolean): boolean {
        let _dict = this._dict
        let k;
        for (k in _dict) {
            if (!func(k, _dict[k])) {
                return false
            }
        }
        return true
    }

	/**
	 * 有一项满足
	 */
    some(func: (key: string | number, value: V) => boolean): boolean {
        let _dict = this._dict
        let k;
        for (k in _dict) {
            if (func(k, _dict[k])) {
                return true
            }
        }
        return false
    }

	/**
	 * 过滤,返回满足条件的key数组
	 */
    filterKeys(func: (key: string | number, value: V) => boolean): string | number[] {
        let tlKey: string | number[] = []
        let _dict = this._dict
        let k;
        for (k in _dict) {
            if (func(k, _dict[k])) {
                tlKey.push(k)
            }
        }
        return tlKey
    }

	/**
	 * 过滤,返回满足条件的value数组
	 */
    filterValues(func: (key: string | number, value: V) => boolean): V[] {
        let tlValue: V[] = []
        let value_: V;
        let _dict = this._dict
        let k;
        for (k in _dict) {
            value_ = _dict[k]
            if (func(k, value_)) {
                tlValue.push(value_)
            }
        }
        return tlValue
    }
}