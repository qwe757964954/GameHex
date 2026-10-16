import { ScriptObject } from "../base/ScriptObject";
const assert = console.assert;

export function injectField(clazzOrAlias: string) {
    return function (prototype: any, fieldName: string) {
        // if(clazzOrAlias == "Net" && fieldName == "Net")
        // {
        //     cc.log("MyTest" + clazzOrAlias + fieldName)
        // }
        Container._addInjectField(prototype["constructor"], fieldName, clazzOrAlias);
    };
}

export class Container extends ScriptObject {
    static __cname: string = "Container";
    static _inst: Container;
    static inst() {
        if (this._inst == null) {
            this._inst = new Container();
        }
        return this._inst;
    }

    static isOK()
    {
        return this._inst != null
    }

    private parent: Container;

    SetParent(parent: Container) {
        if (parent !== this) {
            this.parent = parent;
        }
    }

    private collectObjAndAlias: { obj: any; alias?: string }[] = [];

    /**
     * 收集到的对象
     */
    private collectMap: Map<Class<any> | string, any> = new Map();

    /**
     * 收集到的对象
     */
    private collectClassMap: Map<Class<any>, any> = new Map();

    /**
     * 是否启动
     */
    private isStart = false;

    protected onDestroy(): void {
        this.traceBattle("onDestroy")
        this.collectObjAndAlias = null;
        this.collectMap = null;
        this.collectClassMap = null;
    }

    /**
     * 注入一个类
     * @param clazz 类
     * @param alias 别名
     */
    collectClass<T>(clazz: Class<T>, alias?: string): T {
        console.assert(this.isStart == false);
        //尝试在父级寻找，没有才构建
        let obj: T;
        if (this.parent != null) {
            obj = this.parent.getByClass(clazz);
        }
        if (obj == null) {
            clazz["_container"] = this;
            obj = new clazz();
        }
        return this.collectObj(obj, alias);
    }

    collectObj<T>(obj: T, alias?: string): T {
     //   this.log("collect " + obj["constructor"]["__cname"])
        this.assert(this.isStart == false, "container已启动，不能注册");
        this.collectObjAndAlias.push({ obj: obj, alias: alias });
        return obj;
    }

    /**
     * 通过别名访问
     * @param alias
     * @param field
     * @returns
     */
    getByAlias<T>(alias: string): T {
        return this.get(alias);
    }

    getByClass<T>(clazz: Class<T>): T {
        return this.get(clazz);
    }

    /**
     * 通过类型访问
     * @param clazz
     * @param alias
     */
    get<T>(classOrAlias: Class<any> | string): T {
        let inject = this.collectMap.get(classOrAlias);
        if (inject == null && this != Container.inst()) {
            inject = Container.inst().get(classOrAlias);
        }
        if (inject == null && this.parent != null) {
            inject = this.parent.get(classOrAlias);
        }
        return inject;
    }

    //注入的字段(包括父类)
    inject(obj) {
        let clazz = obj["constructor"];

        while (true) {
            if (Container.injectFieldMap.has(clazz)) {
                let injectField = Container.injectFieldMap.get(clazz);
                for (const [fieldName, classOrAlias] of injectField) {
                    obj[fieldName] = this.get(classOrAlias);
                }
            }

            clazz = clazz["__proto__"];
            if (clazz == null) {
                break;
            }
        }
    }

    /**
     * 启动容器, 并装配各个依赖字段
     */
    start() {
        this.traceBattle("start")
        this.isStart = true;

        for (let oa of this.collectObjAndAlias) {
            let obj = oa.obj;
            let alias = oa.alias;

            //创建
            let clazz = obj["constructor"] as Class;

            //储存prototype的映射
            this.collectClassMap.set(clazz, obj);

            //储存到collect中
            if (this.collectMap.has(clazz)) {
                throw clazz["__cname"];
            }
            this.collectMap.set(clazz, obj);

            let name = clazz["__cname"];
            if (name != alias && name) {
                if (this.collectMap.has(name)) {
                    throw name;
                }
                this.collectMap.set(name, obj);
            }
            if (alias != null) {
                if (this.collectMap.has(alias)) {
                    throw alias;
                }
                this.collectMap.set(alias, obj);
            }
        }

        for (const [clazz, obj] of this.collectClassMap) {
            this.inject(obj);
        }
    }

    //#region 装饰器收集的数据

    private static injectFieldMap: Map<Class<any>, Map<string, Class<any> | string>> = new Map();

    static _addInjectField(clazz: Class<any>, fieldName: string, exportClazz: Class<any> | string) {
        this.addHelper(clazz, fieldName, this.injectFieldMap, exportClazz);
    }

    private static addHelper<T>(prototype: any, fieldName: string, map: Map<any, Map<string, T>>, t: T) {
        let fieldMap: Map<string, T>;
        if (map.has(prototype)) {
            fieldMap = map.get(prototype);
        } else {
            fieldMap = new Map<string, T>();
            map.set(prototype, fieldMap);
        }
        console.assert(!fieldMap.has(fieldName));
        fieldMap.set(fieldName, t);
    }

    //#endregion
}
