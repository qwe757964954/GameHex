import Ref from "../../app/ref/Ref";
import { ScriptObject } from "../base/ScriptObject";
import { FW } from "../FW";
import { Task } from "../task/Task";
import { PromiseWrap } from "../utils/PromiseWrap";
import { ToolSet } from "../utils/Toolset";

// function abortWrapper(p1:Promise<any>) {
//     let abort:(reason?: any) => void
//     let p2 = new Promise((resolve, reject) => (abort = reject))
//     let p = Promise.race([p1, p2])
//     p.reject = abort
//     return p
// }

export type CorFunc = (cor:Cor)=>Promise<void>
export type CorTrigger = ()=>boolean
export class Cor extends ScriptObject
{
    static __cname = "Cor"
    
    private stoping:boolean


    private trigger:CorTrigger
    private trigger_func:CorFunc
    private func:CorFunc
    private defer:(stopping:boolean)=>void
    private func_next:CorFunc
    private defer_next:(stopping:boolean)=>void

    protected onDestroy(): void {
        if(this.defer){
            this.defer(false)
        }
        if(this.promise)
            this.promise.reject()
    }

    /**
     * 每帧调用
     * @param cor 
     * @param trigger 
     */
    static async Wait_cor(cor:Cor, trigger:CorTrigger)
    {
        cor.trigger = trigger
        cor.trigger_func = cor.func
        await cor.Yield().promise

    }

    /**
     * 等待Promise
     * @param cor 
     * @param promise 
     * @returns 
     */
    static async WaitPromise_cor(cor:Cor, promise:PromiseWrap<void>)
    {
        await Cor.Wait_cor(cor, ()=>{
            return promise.state != "pending"
        })
        return promise
    }

    /**
     * 等待一段时间
     * @params waitTime 秒
     */
    static async WaitTime_cor(cor:Cor, waitTime:number)
    {
        if (waitTime<=0 ){
            return
        }
        let time = (cc.game as any).totalTime * 1000 + waitTime*1000
        await Cor.Wait_cor(cor, ()=>{
            let now = (cc.game as any).totalTime * 1000
            return now >= time
        })
    }
    
    /**
     * 等待指定帧数
     * @params waitTime 秒
     */
    static async WaitFrame_cor(cor:Cor, waitFrame:number)
    {
        if (waitFrame<=0 ){
            return
        }
        let time = (cc.game as any).frameCount + waitFrame
        await Cor.Wait_cor(cor, ()=>{
            let now = (cc.game as any).frameCount
            return now >= time
        })
    }

    /**
     * 等待值为真
     * @param cor 
     * @param func 
     */
    static async WaitUntil_cor(cor:Cor, func:()=>boolean){
        await Cor.Wait_cor(cor, ()=>{
            return func()
        })
    }
    

    private promise:PromiseWrap<any>


    GetIsWait()
    {
        return this.promise != null
    }
    GetCanResume(){
        return this.trigger_func == this.func
    }

    private Yield():PromiseWrap<any>
    {
        if(this.GetIsWait())
        {
            throw "error"
        }
        this.promise = new PromiseWrap<void>()

        return this.promise
    }

    Update()
    {
        if(this.promise)
        {
            let trigger = this.trigger
            if(trigger!=null)
            {
                let defer = ()=>{
                    this.promise = null
                    this.trigger = null
                    this.trigger_func = null
                }
                if(!this.GetCanResume()){

                    // 外部中断
                    this.promise.reject("协程外部中断")
                    defer()
                    return
                }
                let ret = this.trigger()
                if(ret){
                    this.promise.resolve(null)
                    defer()
                }
            }
            
        }
            
    }

    Resume(func_cor:CorFunc)
    {
        let promise = new PromiseWrap<boolean>()
        this.func_next = func_cor
        this.defer_next = (isStop)=>{
            promise.resolve(!isStop)
        }
        //恢复协程
        this.ResumeInner(false)
        //判断是否正常恢复
        this.assert(this.func_next == this.func)
        this.func_next = null
        this.defer_next = null
        return promise
    }

    /**协程外部终止 */
    Stop(){
        this.ResumeInner(true)
        return true
    }
    private ResumeInner(isstop:boolean){
        //清理旧的
        if(this.func){
            this.defer(isstop)
            this.func = null
            this.defer = null
        }

        //构造新的
        if(this.func_next){
            this.func = this.func_next
            this.defer = this.defer_next

            let defer = ()=>{
                this.func = null
                this.defer = null
            }
            this.func(this)
                .then(()=>{
                    this.defer(false)
                    defer()
                })
                .catch(e=>{
                    FW.ZJJ.error(e)
                    this.defer(true)
                    defer()
                })
        }
    }
}

// let cor = new Cor()

// function OnUpdate()
// {
//     cor.Update()
// }

// function OnDispose()
// {
//     cor.Dipspose()
// }

// cor.Resume(Main_COR)


// async function  Main_COR(cor:Cor)
// {
//     let toolSet =  ToolSet.createToolSet()
//     try {
//         MainInner_cor(cor, toolSet)
//     } catch (error) {
//         ToolSet.destroyToolSet(toolSet)
//         throw error
//     }
//     finally
//     {
//         ToolSet.destroyToolSet(toolSet)
//     }

// }
// async function MainInner_cor(cor:Cor, toolSet:ToolSet)
// {
//     toolSet.addDefer(()=>{

//     })
//     Cor.Wait_cor(cor, ()=>{
//         //一些条件
//         return true
//     })
// }