import { ScriptObject } from "../base/ScriptObject";

export abstract class YieldInstruction extends ScriptObject {
    public static __cname: string = "YieldInstruction"
    protected readonly _isYieldInstruction = true

    onInit() {
        this.destroyed = false
    }
    abstract isDone(): boolean
    abstract recover()
}