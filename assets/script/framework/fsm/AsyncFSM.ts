import { GameLoading } from "../../app/game/gamestate/state/GameLoading";
import { ScriptObject } from "../base/ScriptObject";
import { TaskQueue } from "../task/TaskQueue";
import { AsyncFSMState } from "./AsyncFSMState";

export class AsyncFSM<T extends AsyncFSMState> extends ScriptObject {
    public static __cname: string = "AsyncFSM";
    protected taskQueue: TaskQueue = new TaskQueue();
    // 状态集合
    protected tmState: Map<any, T> = new Map<any, T>();
    // 当前状态
    protected _current: T;
    public set current(c: T) { this._current = c; };
    public get current(): T { return this._current; };
    // 下个状态
    protected next: T;
    // 下个状态参数
    protected nextParam: any;
    // 是否正在切换
    protected _isSwitching = false;
    public set isSwitching(is: boolean) { this._isSwitching = is; };
    public get isSwitching(): boolean { return this._isSwitching; };
    destroy() {
        let t = this;
        let tmState = t.tmState;
        t.tmState = null;
        let taskQueue = t.taskQueue;
        t.taskQueue = null;
        taskQueue.queue(t, async () => {
            if (t.current != null) {
                await t.current.exit();
                t.current = null;
            }
            for (let [_, state] of tmState) {
                state.destroy();
            }
            tmState.clear()
            taskQueue.destroy()
        })
        super.destroy();
    }

    /**
     * 添加一个状态
     * @param clazz 
     */
    addState(clazz: Class<T>):T {
        let t = this;
        t.assert(t.tmState.get(clazz) == null, "无法重复添加同一种状态");
        let state = new clazz();
        state.init(t);
        t.tmState.set(clazz, state);
        return state
    }
    /**
     * 获取当前运行的状态
     * @returns 
     */
    getRunning(): T {
        if (this.isSwitching) {
            return null;
        }
        return this.current;
    }
    /**
     * 切换状态
     * @param clazz 
     * @param param 
     */
    switchTo(clazz: Class<T>, param?: any) {
        let t = this;
        if (t.destroyed) {
            return;
        }
        let state = t.tmState.get(clazz)
        t.assert(state != null, "无法切换")
        t.next = state;
        t.nextParam = param;
        t.log("switchTo")
        t.taskQueue.queue(t, async () => {
            t.isSwitching = true;
            try{
                
                await t.switchToSync();
            }catch(e){
                if(e)console.error(e)
            }
            t.isSwitching = false;
        })
    }
    async switchToSync() {
        let t = this;
        while (true) {
            let next = t.next;
            let param = t.nextParam;
            if (next == null) {
                break;
            }
            t.next = null;
            t.nextParam = null
            
            if (t.current != null) {
                t.log(t.current.className, "exit start")
                await t.current.exit();
                t.log(t.current.className, "exit end")
            }
            t.current = next;
            t.log(t.current.className, "enter start")
            await t.current.enter(param);
          
            t.log(t.current.className, "enter end")
        }
    }
}