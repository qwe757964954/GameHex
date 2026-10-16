import { ScriptObject } from "../base/ScriptObject";

export abstract class FSMState<T extends string> extends ScriptObject {
    public static __cname: string = "FSMState";
    private _stateName: T;
    public set stateName(_stateName: T) { this._stateName = _stateName; };
    public get stateName(): T { return this._stateName };
    constructor(_stateName: T) {
        super();
        this.stateName = _stateName;
    }

    abstract enter(p1?: any, p2?: any, p3?: any): void;
    abstract exit(p1?: any, p2?: any, p3?: any): void;
    abstract update(p1?: any, p2?: any, p3?: any): void;
}