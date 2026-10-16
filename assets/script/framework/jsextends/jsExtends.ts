/**
* jsExtends 
*/
export class jsExtends {
    /**打印异常堆栈 */
    static enableStackTrace = false
    static init() {
        //重写日期函数兼容iphone
        
        let Date_parse = Date.parse
        Date.parse = function (s: string): number {
            if (typeof s == "string") {
                s = s.replace(/-/g, "/")
            }
            return Date_parse(s)
        }

        //重写console.log 避免在IOS平台打印对象
        if ((env as any).IOS === true){
            let console_log = console.log
            console.log = function (...args) {
                let params = args
                if ((env as any).IOS === true) {
                    params = args.map(item => {
                        if (typeof item == "string") return item
                        if (typeof item == "number") return item
                        if (typeof item == "boolean") return item
                        return "[IOS不支持打印对象]"
                    })
                }
                console_log.call(this, ...params)
            }
        }

        //重写console.error 避免在IOS平台打印对象
        let console_error = console.error
        console.error = function (...args) {
            let params = args
            if ((env as any).IOS === true) {
                params = args.map(item => {
                    if (typeof item == "string") return item
                    if (typeof item == "number") return item
                    if (typeof item == "boolean") return item
                    return "[IOS不支持打印对象]"
                })
            }
            //打印异常堆栈
            if(jsExtends.enableStackTrace){
                for(let item of params){
                    if(item instanceof Error){
                        throw item
                    }
                }
            }
            console_error.call(this, ...params)
        }
    }
}