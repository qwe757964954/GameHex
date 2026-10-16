
export class PromiseExtends{
    static init(){
        // Promise.prototype.state = "pending"

        // let Promise_constructor = Promise.prototype.constructor
        // function Promise_constructor2 <T>(this:Promise<any>,executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>{
        //     console.log("promise!!!!")
        //     let _executor:(resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void
        //     _executor = (resolve, reject)=>{
        //         let _resolve: (value: T | PromiseLike<T>) => void = (value)=>{
        //             this.state = "fulfilled"
        //             resolve(value)
        //         }

        //         let _reject: (reason?: any) => void = (reason)=>{
        //             this.state = "rejected"
        //             reject(reason)
        //         }

        //         this.resolve = _resolve
        //         this.reject = _reject
        //         if(executor){
        //             executor(_resolve, _reject)
        //         }
        //     }
        //     return Promise_constructor(_executor)
        // }
        // Promise.prototype.constructor = Promise_constructor2
        // let Origin = Promise
        
        // function Func<T>(this:Promise<any>,executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>{

        // }
        // Func.prototype = Object.create(Promise.prototype)
        // // Func = Object.assign(Func)
        // // Promise = Func
        // console.dir(Func)
    }
}