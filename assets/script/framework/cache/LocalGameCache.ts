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
        // let key = this.hashKey(obj)
        // let old = this.dictionary.get(key)
        // if (old != null) {
        // 	this.update(key, obj)
        // } else {
        // 	this.dictionary.set(key, obj);
        // }
    }

    /**
     * 更新缓存
     * @param data 缓存对象
     */
    update(key: any, val: any): void {
        // let oldObj = this.dictionary.get(key)
        // let changeFieldMap = {};
        // if (oldObj == null) {
        // 	return
        // }

        // let oldOne;
        // let newOne;
        // for (let fieldNumber of this.fieldDictionary.keys) {
        // 	let field = this.fieldDictionary.get(fieldNumber);
        // 	oldOne = oldObj[field.name];
        // 	newOne = obj[field.name];
        // 	oldObj[field.name] = newOne;
        // 	if(oldOne != newOne){
        // 		changeFieldMap[field.name] = newOne;
        // 	}else{
        // 		delete changeFieldMap[field.name];
        // 	}
        // }
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