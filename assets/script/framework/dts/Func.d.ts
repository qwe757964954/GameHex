
/**
 * go.AddComponent(cs_typeof(UnityEngine.Camera))
 * @param this 
 * @param clazz 
 */
declare function cs_typeof<T>(this: void, clazz: Class<T>): System.Type<T>



/**
 当作为一个Lua函数的形参或者
 declare LoadAsset(path:string, callback:LuaFunction)

 当作为c#的委托
 class GList
 {
     onItemRenderer:LuaFunction
 }
 */
declare type LuaFunction<R = any, P1 = any, P2 = any, P3 = any, P4 = any, P5 = any, P6 = any> = (this: void, p1?: P1, p2?: P2, p3?: P3, p4?: P4, p5?: P5, p6?: P6) => R

declare type TSFunction<P1 = any, P2 = any, P3 = any, P4 = any, P5 = any, P6 = any> = (p1?: P1, p2?: P2, p3?: P3, p4?: P4, p5?: P5, p6?: P6) => any
declare type TSFunction2<R = any, P1 = any, P2 = any, P3 = any, P4 = any, P5 = any, P6 = any> = (p1?: P1, p2?: P2, p3?: P3, p4?: P4, p5?: P5, p6?: P6) => R


declare namespace jsb {
    export module reflection {
        // https://forum.cocos.org/t/topic/131028
        // 函数重写 解决TS下至少需要传递三个参数报错,可修改creator.d.ts
        export function callStaticMethod(className: string, methodName: string): any;
    }
}
