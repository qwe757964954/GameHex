import { ScriptObject } from "../base/ScriptObject";

export class RequestMsg<CmdReqMsg, CmdRspMsg> extends ScriptObject {
    public static __cname: string = "RequestMsg";
    /**回调对象，可无 */
    public caller: object | null | undefined;
    /**返回数据 */
    public fCallback: (rsp: CmdRspMsg) => void;
    /**错误回调 */
    public fErrorCallback: Function;
    /**请求协议 */
    public cmdReqMsg: CmdReqMsg;
    /** 非幂等写操作可关闭超时重发及重连恢复；默认保留旧行为。 */
    public allowRetry = true;
    /** 实际出队前检查请求所属会话与有效期。 */
    public canSend: (() => boolean) | null = null;
    constructor(cmdReqMsg: CmdReqMsg, caller?: object, fCallback?: (rsp: CmdRspMsg) => void, fErrorCallback?: Function) {
        super();
        this.cmdReqMsg = cmdReqMsg
        this.caller = caller;
        this.fCallback = fCallback;
        this.fErrorCallback = fErrorCallback;
    }
    destroy() {
        this.caller = null;
        this.fCallback = null;
        this.fErrorCallback = null;
        this.cmdReqMsg = null;
        this.canSend = null;
        super.destroy();
    }
    getReqMsgProtoName(): string {
        return "CmdPlayerLoginReqMsg"
    }
}
