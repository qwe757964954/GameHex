import { GameCache } from "./GameCache";

export class LocalGameCache extends GameCache {
    public static __cname: string = "LocalGameCache";
    constructor(cacheName: string) {
        super(cacheName);
    }

    init() {

    }

    get(key?: any): any {
        return this.dictionary.get(key);
    }

    /**
     * 添加缓存
     * @param obj 缓存对象
     */
    // add(obj: any): void {
    // 	//let key = this.hashKey(obj);
    // 	//this.dictionary.set(key, obj);
    // }

    // put(key: any, val: any) {
    // 	this.dictionary.set(key, val);
    // }

    /**
     * 添加或更新
     * @param obj  缓存对象
     */
    addOrUpdate(obj: any): void {
    }

    /**
     * 更新缓存
     * @param data 缓存对象
     */
    update(key: any, val: any): void {
        this.dictionary.set(key, val);
    }

    /**
     * 删除
     * @param key 缓存Key
     */
    delete(key: any): void {
        this.dictionary.remove(key);
    }

    /**
     * 删除多个
     * @param keys 缓存keys
     */
    deleteMany(keys: any[]): void {
        for (let i in keys) {
            this.dictionary.remove(keys[i]);
        }
    }

    /**
     * 清除所有
     */
    clear(): void {
        this.dictionary.clear();
    }
}