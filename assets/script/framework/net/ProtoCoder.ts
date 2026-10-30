
import { NetFunc } from "./NetFunc";
// 协议运行时 = 随包的**静态模块**，由 tools/proto/gen_static_module.mjs 用
// `pbjs -t static-module` 预生成。
//
// ⚠️ 不要改回 `protobufjs/light` + `Root.fromJSON`（反射模式）：protobufjs 的
// 构造器 / encode / decode 都是运行时用 `util.codegen()` 里的 `Function(...)` 现场造的，
// 而微信小游戏禁止动态执行 JS（eval / new Function），会在构造阶段就抛
// `Function(...) is not a function`。详见 app/login/ProtocolCodec.ts 顶部说明。
import protobufRoot from "../../lib/protobuf/protoCompiledStatic";

export class ProtoCoder {
    public static __cname: string = "ProtoCoder";


    /**请求Map<messageId,proto解析类> */
    private reqMap: { [key: number]: any } = {};
    /**响应Map<messageId,proto解析类> */
    private rspMap: { [key: number]: any } = {};

    /**广播Map<messageId,proto解析类> */
    private broMap: { [key: number]: boolean } = {};

    /**缓存Map<messageId,proto解析类> */
    private cacheAppMap: { [key: number]: boolean } = {};

    /**响应Map<messageId,name,proto解析类名称> */
    private _rspIdNameMap: { [key: number]: string } = {};
    public getRspNameById(messageId: number): string {
        return this._rspIdNameMap[messageId]
    }
    /**名字对应的messageId<name,messageId> */
    private _reqNameIdMap: { [key: string]: number } = {};


    /**apppend响应Map<apppendMessageId,proto解析类> */
    private appendMap: { [key: number]: any } = {};

    /**append命令附加信息缓存Id */
    private _appendCacheMsgId: number;
    public get appendCacheMsgId() {
        return this._appendCacheMsgId
    }

    /**字段类型proto解析类<字段类型名称,proto解析类> */
    private tmBaseType: { [key: string]: any } = {};

    /** 客户端向服务端发送的proto解析类*/
    private clientCmdData: any;

    /** 接收服务端的proto解析类*/
    private serverCmdData: any;

    /** 缓存按字段修改数据*/
    private cmdCacheUpdateByField: any;

    /**订阅缓存 */
    private cacheSubMap: { [key: number]: string } = {};

    /**协议包 */
    private protoPackage: any;//

    /**是否需要加密 */
    needEncrypt = false;

    private readonly cryptoKey = "7177656173647a786331323334353637";
    private cryptoKeyParse = null;

    private readonly cryptoIv = "7177656173647a786331323334353637";
    private cryptoIvParse = null;

    destroy() {
        let t = this;
        t.reqMap = null;
        t.rspMap = null;
        t.broMap = null;
        t.cacheAppMap = null;
        t._rspIdNameMap = null;
        t._reqNameIdMap = null;
        t.appendMap = null;
        t._appendCacheMsgId = null;
        t.tmBaseType = null;
        t.clientCmdData = null;
        t.cmdCacheUpdateByField = null;
        t.serverCmdData = null;
        t.cacheSubMap = null;
        t.protoPackage = null;
        t.needEncrypt = null;
        t.cryptoKeyParse = null;
        t.cryptoIvParse = null;
    }

    /**连接网络前要先初始化 */
    async init() {
        let t = this
        if (t.protoPackage != null) {
            return
        }

        // 静态模块的命名空间是**普通属性**（pbjs static-module 的形态），
        // 所以可以直接 `protobufRoot.com.xkhy.tafang.cmd`，不再需要 fromJSON + buildProtoRoot。
        let protoEnginepPackage: any = protobufRoot.com.cca.core.network.cmd;
        t.protoPackage = protobufRoot.com.xkhy.tafang.cmd;
        if (protoEnginepPackage == null || t.protoPackage == null) {
            throw new Error("协议静态模块结构异常：缺少 com.cca.core.network.cmd / com.xkhy.tafang.cmd");
        }

        t.clientCmdData = protoEnginepPackage['ClientCmdData'];
        t.serverCmdData = protoEnginepPackage['ServerCmdData'];
        t.cmdCacheUpdateByField = protoEnginepPackage['CmdCacheUpdateByField'];

        let tmBaseType = t.tmBaseType
        tmBaseType["int32"] = protoEnginepPackage['CmdInt32'];
        tmBaseType["sint32"] = protoEnginepPackage['CmdInt32'];
        tmBaseType["int64"] = protoEnginepPackage['CmdInt64'];
        tmBaseType["sint64"] = protoEnginepPackage['CmdInt64'];
        tmBaseType["float"] = protoEnginepPackage['CmdFloat'];
        tmBaseType["double"] = protoEnginepPackage['CmdDouble'];

        t.initMessage();
        t.initCacheSub();
        //AppendMessage.init();
    }

    /**
     * 发送数据前数据转换
     * @param clientIndex 客户端消息标识
     * @param message 协议名(如:CmdPlayerEnterReqMsg)
     * @param data 发送的数据
     * @param appendData 附加数据(Uint8Array)
     */
    encode<CmdXXX>(message: string, cmdData: CmdXXX): Uint8Array {
        let t = this;
        if (message == "ClientCmdData") {
            let clientCmdData = t.clientCmdData
            let cmdMsg = clientCmdData.create(cmdData)
            let data: any = clientCmdData.encode(cmdMsg).finish();
            return data;
        }
        let messageId = t._reqNameIdMap[message];
        if (messageId == null) {
            console.error("ProtoCoder encode messageId null: " + message);
        }
        let proto = this.getProto(messageId);
        let data: any = proto.encode(proto.create(cmdData)).finish();
        if (t.needEncrypt) {
            data = t.encrypted(data)
        }
        return data
    }

    encodeReqMgs<CmdXXX>(message: string, data: CmdXXX): Uint8Array {
        let t = this;
        let messageId = t._reqNameIdMap[message];
        if (messageId == null) {
            console.error("ProtoCoder encode messageId null: " + message);
        }
        let dataType = t.reqMap[messageId];

        let reqData: any = dataType.encode(dataType.create(data)).finish();
        if (t.needEncrypt) {
            reqData = t.encrypted(reqData)
        }
        return reqData
    }


    encrypted(data: Uint8Array) {
        if (window["_crypto_net_"] != 1) {
            return data;
        }
        let cryptoJS_ = globalThis.CryptoJS;
        if (!cryptoJS_) {
            return data;
        }
        let t = this;

        let key = t.cryptoKeyParse;
        if (key == null) {
            key = cryptoJS_.enc.Hex.parse(t.cryptoKey);
            t.cryptoKeyParse = key;
        }
        let iv = t.cryptoIvParse;
        if (iv == null) {
            iv = cryptoJS_.enc.Hex.parse(t.cryptoIv);
            t.cryptoIvParse = iv;
        }

        let src = cryptoJS_.lib.WordArray.create(data).toString();
        const enc = cryptoJS_.AES.encrypt(src, key, { iv: iv, mode: cryptoJS_.mode.CBC, padding: cryptoJS_.pad.Pkcs7 })
        const enced = enc.ciphertext.toString();
        const uint8Array = NetFunc.TextEncoder_encode(enced);
        return uint8Array;
    }

    /**
     * 解释客户端的数据为可以发送的服务器数据
     * @param className 
     * @param data 
     */
    encodeDataByName(className: string, data: any): Uint8Array {
        let cls: any = this.protoPackage[className];//com.gzyouai.hummingbird.gz.cmd.XXXXX
        return cls.encode(data).finish()
    }

    /**
     * 把收到的服务器数据转换为客户端数据
     * @param data 
     * 
     */
    decode<CmdXXX>(data: CmdXXX): any {
        return this.serverCmdData.decode(data);
    }

    /**
     * 解释服务器数据为客户端数据
     * @param messageId 
     * @param data 
     */
    decodeDataById<CmdXXX>(messageId: number, data: CmdXXX): any {
        let dataType: any = this.rspMap[messageId];
        if (dataType != null) {
            return dataType.decode(data);
        } else {
            // 客户端找不到协议号对应的协议
            console.error("ProtoCoder decodeDataById messageId rspClass null: " + messageId);
        }
        return null;
    }

    /**
     * 解释服务器数据为客户端数据
     * @param className 
     * @param data 
     */
    decodeDataByName<CmdXXX>(className: string, data: CmdXXX): any {
        let cls: any = this.protoPackage[className];//com.gzyouai.hummingbird.gz.cmd.XXXXX
        return cls.decode(data);
    }

    // static decodeDataByFullName(className:string, data:Uint8Array):any{
    //     let cls:any = ProtobufAnalyzer.protoRoot.lookup(className);
    //     let obj = cls.decode(data);
    //     return obj;
    // }

    decodeAppend(messageId: number, data: Uint8Array): any {
        let dataType: any = this.appendMap[messageId];
        if (dataType != null) {
            return dataType.decode(data);
        } else {
            // 客户端找不到协议号对应的协议
            console.error("ProtoCoder decodeAppend messageId rspClass null: " + messageId);
        }
        return null;
    }

    decodeBaseType(typeName: string, data: Uint8Array): any {
        let obj;
        let dataType: any = this.tmBaseType[typeName];
        if (dataType != null) {
            obj = dataType.decode(data);
        } else if (typeName == "string") {
            obj = NetFunc.utf8ArrayToStr(data)
        } else {
            console.error("ProtoCoder decodeBaseType dataType null: " + typeName);
        }
        return obj;
    }

    lookupClass(className: string): any {
        let cls: any = this.protoPackage[className];//com.gzyouai.hummingbird.gz.cmd.XXXXX
        return cls;
    }

    public getMessageId(reqMsg: string) {
        let t = this;
        let messageId = t._reqNameIdMap[reqMsg];
        return messageId;
    }

    /**
     * 全部可发送请求协议名（浏览器控制台 `GameSocket.protocols` 枚举用）。
     * `_reqNameIdMap` 是内部表，只读暴露，避免调试桥直接触达私有结构。
     */
    public listReqMsgNames(): string[] {
        return Object.keys(this._reqNameIdMap);
    }

    public getProto(messageId: number) {
        let t = this;
        let proto = t.reqMap[messageId];
        return proto;
    }

    private initMessage(): void {
        let t = this
        let tmMessageId: any = t.protoPackage.MessageId;
        let keys = Object.keys(tmMessageId);
        let name: string;
        let key: string;
        for (let i = 0, len = keys.length; i < len; i++) {
            key = keys[i];
            name = key.replace("RspMsg", "");
            t.addMessage(tmMessageId[key], name);
        }
    }

    private initCacheSub() {
        let t = this
        let cacheSubEnum: any = t.protoPackage.CacheSubEnum;
        if (cacheSubEnum != null) {
            let keys = Object.keys(cacheSubEnum);
            let name: string;
            let key: string;
            for (let i = 0, len = keys.length; i < len; i++) {
                key = keys[i];
                name = key.replace("Sub_", "").replace("Enum", "");
                t.cacheSubMap[cacheSubEnum[key]] = name
            }
        }
    }

    private addMessage(messageId: number, name: string): void {
        let t = this
        let protoPackage = t.protoPackage;

        if (name.lastIndexOf("BroMsg") > -1) {
            t.rspMap[messageId] = protoPackage[name];
            t._rspIdNameMap[messageId] = name;
            t.broMap[messageId] = true;
        } else if (name.lastIndexOf("CacheAppMsg") > -1) {
            t.rspMap[messageId] = protoPackage[name];
            t._rspIdNameMap[messageId] = name;
            t.cacheAppMap[messageId] = true;
        } else {
            let reqName = name + "ReqMsg";
            t.reqMap[messageId] = protoPackage[reqName];
            t._reqNameIdMap[reqName] = messageId;

            let rspName = name + "RspMsg";
            t.rspMap[messageId] = protoPackage[rspName];
            t._rspIdNameMap[messageId] = rspName;
        }
    }

    public getCacheSubName(key: number): string {
        return this.cacheSubMap[key]
    }

    public isBro(messageId: number): boolean {
        return this.broMap[messageId] == true
    }

    public isCacheApp(messageId: number): boolean {
        return this.cacheAppMap[messageId] == true
    }

    public getCmdCacheUpdateByField(): any {
        return this.cmdCacheUpdateByField
    }
}