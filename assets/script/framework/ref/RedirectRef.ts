/**
 * 重定向Ref数据结构
 */
export function RedirectRef<T extends Class<any>>(resName:TRefName2) {
    return function(property:T){
        RedirectRefMgr.inst().Collect(resName, property)
    }
}

/**
 * 配置表重定向管理器
 */
export class RedirectRefMgr {
    private static _instance:RedirectRefMgr;
    public static inst(){
        return this._instance || (this._instance = new RedirectRefMgr())
    }

    private tmRedict = new Map<string, any>()
    Collect(resName:string, redictObj:any){
        if(this.tmRedict.has(resName)){
            console.error("重复收集：",resName, redictObj)
            return
        }
        //实例化之后，可以获取属性/方法
        //这样当作prototype的值可以更全面
        let obj = new redictObj()
        this.tmRedict.set(resName, obj)
    }

    Redirect(resName:string, data:any[]){
        let redictObj = this.tmRedict.get(resName)
        let result = data
        if(redictObj != null){
            for(let i = 0; i < data.length; i++){
                let item = data[i]
                if(item){
                    //设置item的prototype，以此达到重定向的目的
                    Object.setPrototypeOf(item, redictObj)
                }
            }
        }
        return result
    }
}