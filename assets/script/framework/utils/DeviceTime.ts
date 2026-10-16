import { ScriptObject } from "../base/ScriptObject";
import { UpdateBeat, UpdateClass } from "./UpdateBeat";

/**
* DeviceTime 
*/
export class DeviceTime extends ScriptObject{
    static __cname: string = "DeviceTime";
    private static _inst:DeviceTime
    static get instance(){return this._inst || (this._inst = new DeviceTime())}

    protected onDestroy(): void {
        this.stop()
    }

    private _updateClass:UpdateClass;
    private running:boolean = false
    private delta:number
    private last:number
    private totalTime:number
    start(){
        let _updateClass = this._updateClass
        if(_updateClass == null){
            _updateClass = UpdateBeat.addListener(this.update,this)
            this._updateClass = _updateClass
        }
        this.last = this.getTotalTime()
        this.running = true
    }
    stop(){
        this.running = false
        if(this._updateClass){
            let _updateClass = this._updateClass
            this._updateClass = null
            UpdateBeat.removeListener(_updateClass)
        }
    }
    private update(dt){
        let now = Date.now()
        let last = this.last || now

        this.last = now
        this.totalTime = now
        this.delta = now - last
    }
    /**
     * 获取设备时间，跟引擎无关
     * @returns 
     */
    getTotalTime(){
        return this.totalTime
    }
    /**
     * 获取设备上次更新用时，跟引擎无关
     * @returns 
     */
    getDeltaTime(){
        return this.delta
    }
}