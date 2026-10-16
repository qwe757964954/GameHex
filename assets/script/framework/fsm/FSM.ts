import { ScriptObject } from "../base/ScriptObject";
import { FSMState } from "./FSMState";

export class FSM<K extends string, V extends FSMState<K>> extends ScriptObject {
    public static __cname: string = "FSM";
    protected tmState: Map<K, V> = new Map();
    protected curent: V;
    constructor(...args: V[]) {
        super();
        for (let state of args) {
            let _key = state.stateName;
            if (this.tmState.has(_key)) {
                throw "重复类型";
            }
            this.tmState.set(_key, state);
        }
    }

    destroy() {
        let tmState = this.tmState
        if (tmState) {
            for (let [k, v] of tmState) {
                v.destroy();
            }
            tmState.clear();
            this.tmState = null;
        }
        super.destroy();
    }

    getState(k?: K): V {
        if (k == null) {
            return this.curent;
        } else {
            return this.tmState.get(k);
        }
    }

    update(p1?: any, p2?: any, p3?: any) {
        let curent = this.curent;
        if (curent != null) {
            curent.update(p1, p2, p3);
        }
    }

    async switchTo(type: K, p1?: any, p2?: any, p3?: any) {
        let t = this;
        let oldState = t.curent;
        let newState = t.tmState.get(type);
        if (oldState == newState) {
            return;
        }
        if (oldState != null) {
            // 参数必须透传给 exit：网络状态机的 ConnectedNetState.exit 依赖 p1 === "reconnect"
            // 决定把在途请求移回待发队列（DoReconnectNet），无参调用会导致重连丢请求。
            oldState.exit(p1, p2, p3);
        }
        t.curent = newState;
        if (newState) {
            newState.enter(p1, p2, p3);
        }
        await t.onSwitch(oldState, newState);
    }

    protected async onSwitch(from: V, to: V) { }
}