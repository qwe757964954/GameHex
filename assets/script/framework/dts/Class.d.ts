
declare interface Class<T = unknown> {
    new(...args: any[]): T;
    /** 不要使用 name 压缩会导致类名修改 */
    // name: string
    __cname: string
}

/**
 * Constructor
 */
type ClassCtor<T = unknown> = new (...args: any[]) => T;

/**
 * 为 class 添加 className 属性, @classname("ClassName")
 * 
 * @param name
 */
function classname(name: string) {
    return (ctor: Function) => {
        Object.defineProperty(ctor, "__className", {
            value: __className,
            writable: false,
        });
    };
}

