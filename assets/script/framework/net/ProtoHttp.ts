import { Http } from './Http';
import { NetFunc } from './NetFunc';
import { HttpRequest } from './HttpRequest';
import { ScriptObject } from '../base/ScriptObject';
import { ResourceMgr } from '../../engine/ResourceMgr';

export class ProtoHttp extends ScriptObject {
    public static __cname: string = "ProtoHttp";
    /**主协议 */
    private cmdMessage: any;

    /**请求Map<messageId,proto解析类> */
    private readonly reqMap: { [key: number]: any } = {};

    /**响应Map<messageId,proto解析类> */
    readonly rspMap: { [key: number]: any } = {};

    /**名字对应的messageId<name,messageId> */
    private readonly _reqNameIdMap: { [key: string]: number } = {};
    private index: number = 1;
    /**协议包 */
    private protoPackage: any = null;

    async init() {
        let t = this
        if (t.protoPackage != null) {
            return
        }
        let protobuf = globalThis.protobuf;
        let protoJson = "config/gcprotoCompiled.json"
        let protoData = await ResourceMgr.loadJson(protoJson);
        let root = protobuf.Root.fromJSON(protoData)
        let protoPackage = root.nested.e;
        t.protoPackage = root.nested.g;
        t.cmdMessage = protoPackage["CmdMessage"];
        t.initMessage();
    }

    encode(message: string, data: any): any {
        let t = this
        let messageId = t._reqNameIdMap[message];
        if (messageId == null) {
            console.error("ProtoHttp encode messageId null: " + message);
        }
        let dataType = t.reqMap[messageId];

        let reqData: any = dataType.encode(dataType.create(data)).finish();

        t.index++;

        let cmdMsg: any = t.cmdMessage.create({
            index: t.index,
            messageId: messageId,
            data: reqData,
            result: true
        });

        let retData: any = t.cmdMessage.encode(cmdMsg).finish();
        return retData;
    }

    post(url: string, message: string, reqData: any, sendEvent: boolean = true): Promise<any> {
        let t = this
        let encodeData = t.encode(message, reqData);

        let data = encodeData.buffer.slice(encodeData.byteOffset, encodeData.byteOffset + encodeData.byteLength);
        console.log(url)
        if (sendEvent) {
            Http.msgEventProxy.execute("send", url, reqData);
        }

        return new Promise((resolve, reject) => {
            let hr: HttpRequest = new HttpRequest();
            hr.eventProxy.addListener("progress", this, (e) => {
                console.log("progress : " + e);
            });
            hr.eventProxy.addListener("complete", this, (e) => {
                let arrayBuffer: ArrayBuffer = e;
                let uint8Array: Uint8Array = new Uint8Array(arrayBuffer);
                let cmdMessage = t.cmdMessage.decode(uint8Array);

                if (cmdMessage.result) {
                    let dataType = t.rspMap[cmdMessage.messageId];
                    let rsp = dataType.decode(cmdMessage.data);
                    let p = { result: true, rsp: rsp };
                    resolve(p);
                } else {
                    let rsp = NetFunc.utf8ArrayToStr(cmdMessage.data);
                    let p = { result: false, rsp: rsp };
                    resolve(p);
                }
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            });
            hr.eventProxy.addListener("error", this, (e) => {
                let httpErrorMsg = Http.httpError(e)
                let p = { result: false, rsp: httpErrorMsg };
                resolve(p);
                if (sendEvent) {
                    Http.msgEventProxy.execute("receive", url);
                }
            });
            hr.send(url, data, Http.mpost, Http.responseType_arraybuffer, Http.headers_json);
        });
    }

    private initMessage(): void {
        let t = this
        let tmMessageId: any = t.protoPackage["MessageId"];
        let keys = Object.keys(tmMessageId);
        let name: string;
        let key: string;
        for (let i = 0, len = keys.length; i < len; i++) {
            key = keys[i];
            name = key.replace("RspMsg", "");
            t.addMessage(tmMessageId[key], name);
        }
    }

    private addMessage(messageId: number, name: string): void {
        let t = this
        let reqName = name + "ReqMsg";
        t.reqMap[messageId] = t.protoPackage[reqName];
        t._reqNameIdMap[reqName] = messageId;

        t.rspMap[messageId] = t.protoPackage[name + "RspMsg"];
    }
}