import { NetworkRequest } from "../NetworkRequest";
import { BaseNetState } from "./BaseNetState";

export class IdleNetState extends BaseNetState {
    public static __cname: string = "IdleNetState";
    constructor() {
        super("idle");
    }

    enter(p1?: any, p2?: any, p3?: any) {
        super.enter(p1, p2, p3);
        this.socket.closeSocket();
    }
}