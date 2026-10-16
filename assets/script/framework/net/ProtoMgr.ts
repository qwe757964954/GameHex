import { ScriptObject } from "../base/ScriptObject";
import { ProtoCoder } from "./ProtoCoder";

export class ProtoMgr extends ScriptObject {
    public static __cname: string = "ProtoMgr";
    private static tmProto: Map<string, ProtoMgr> = new Map<string, ProtoMgr>();
    private _protoCoder: ProtoCoder;
    public get protoCoder() {
        return this._protoCoder
    }
    constructor(name) {
        super()
        this._protoCoder = new ProtoCoder();
    }
    destroy() {
        let t = this;
        let _protoCoder = t._protoCoder
        if (_protoCoder) {
            _protoCoder.destroy();
            t._protoCoder = null;
        }

        super.destroy();
    }
    public static get(name?: string): ProtoMgr {
        name = name == undefined ? "main" : name;
        let tmProto = this.tmProto;
        for (let [_name, proto] of tmProto) {
            if (name == _name) {
                return proto;
            }
        }
        let proto = new ProtoMgr(name)
        tmProto.set(name, proto);
        return proto;
    }

    public encode<CmdXXX>(protoName: string, data: CmdXXX): Uint8Array {
        return this._protoCoder.encode<CmdXXX>(protoName, data);
    }

    public decode<CmdXXX>(data: CmdXXX): any {
        return this._protoCoder.decode<CmdXXX>(data);
    }

    public decodeDataById<CmdXXX>(messageId: number, data: CmdXXX) {
        return this._protoCoder.decodeDataById<CmdXXX>(messageId, data);
    }

    public decodeDataByName<CmdXXX>(className: string, data: CmdXXX) {
        return this._protoCoder.decodeDataByName<CmdXXX>(className, data);
    }

    public getMessageId(reqMsg: string) {
        return this._protoCoder.getMessageId(reqMsg);

    }

    public listReqMsgNames(): string[] {
        return this._protoCoder.listReqMsgNames();
    }

    public getProto(messageId: number) {
        return this._protoCoder.getProto(messageId);
    }

    public getRspMsg(messageId: number): string {
        return this._protoCoder.getRspNameById(messageId);
    }

    public getAppMsg(messageId: number): string {
        return ""
    }

    public getAppId(appMsg: string): number {
        return 0
    }

    public getEnum(protoName: string, enumId: number): string {
        return ""
    }

    public getEnumId<EnumType>(protoName: string, enumName: EnumType): number {
        return 0
    }

    public isBro(messageId: number): boolean {
        return this._protoCoder.isBro(messageId)
    }

    public isCacheApp(messageId: number): boolean {
        return this._protoCoder.isCacheApp(messageId)
    }


}