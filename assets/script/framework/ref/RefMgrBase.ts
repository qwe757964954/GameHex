import { ScriptObject } from "../base/ScriptObject";
import { RefUtil } from "./RefUtil";

export default class RefMgrBase<RT extends IRefBase, RFT extends keyof RT = keyof RT, T extends refGen = refGen, RNT extends keyof T = keyof T> extends ScriptObject {
    static __cname: string = "RefMgrBase";

    protected refUtil = RefUtil.instance;

    /**配置表名 */
    protected _path: string;

    get fileName() {
        return this._path;
    }

    constructor(path?: RNT) {
        super()
        this._path = path as string;
    }

    /**
     * 提前加载配置数据,执行完这个后,后面获取就不需要调用异步函数了
     */
    async preloadRef() {
        await this.refUtil.preloadRef(this._path)
    }

    isLoaded() {
        return this.refUtil.isLoaded(this._path)
    }

    /**
     * 返回配置表原始数据
     */
    getRefAll(): RT[] {
        return this.refUtil.getRefAll(this._path)
    }
    /**
     * 异步返回配置表原始数据
     */
    async getRefAllAsync(): Promise<RT[]> {
        return this.refUtil.getRefAllAsync(this._path)
    }

    /**
     * 返回配置的某行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[2]的值
     */
    getRef(keyFields: RFT[] | RFT, key1?: string | number, key2?: string | number, key3?: string | number): RT {
        return this.refUtil.getRef(this._path, keyFields as string[], key1, key2, key3);
    }
    /**
     * 异步返回配置的某行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[2]的值
     */
    async getRefAsync(keyFields: RFT[] | RFT, key1?: string | number, key2?: string | number, key3?: string | number): Promise<RT> {
        return this.refUtil.getRefAsync(this._path, keyFields as string[], key1, key2, key3);
    }

    /**
     * 返回配置的多行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[1]的值
     */
    getTlRef(keyFields: RFT[] | RFT, key1?: string | number, key2?: string | number, key3?: string | number): RT[] {
        return this.refUtil.getTlRef(this._path, keyFields as string[], key1, key2, key3);
    }
    /**
     * 异步返回配置的多行数据
     * @param keyFields 做key的字段["resId"], ["resId", "type"]
     * @param key1 对应keyFields[0]的值
     * @param key2 对应keyFields[1]的值
     * @param key3 对应keyFields[1]的值
     */
    async getTlRefAsync(keyFields: RFT[] | RFT, key1?: string | number, key2?: string | number, key3?: string | number): Promise<RT[]> {
        return this.refUtil.getTlRefAsync(this._path, keyFields as string[], key1, key2, key3);
    }
}