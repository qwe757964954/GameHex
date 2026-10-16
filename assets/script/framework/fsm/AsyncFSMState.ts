import { ScriptObject } from "../base/ScriptObject";
import { AsyncFSM } from "./AsyncFSM";

export abstract class AsyncFSMState extends ScriptObject {
    public static __cname: string = "AsyncFSMState";
    fsm: AsyncFSM<AsyncFSMState>;
    init(fsm: AsyncFSM<AsyncFSMState>) {
        this.fsm = fsm;
    }
    async enter(param?: any) { }
    async exit() { }
    LeaveShowLoading():boolean
    {
        return true
    }
    
    EnterHideLoading(): boolean
    {
        return true
    }
}