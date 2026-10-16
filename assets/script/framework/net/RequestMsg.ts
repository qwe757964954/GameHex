import { ScriptObject } from "../base/ScriptObject";

export class RequestMsg<CmdReqMsg, CmdRspMsg> extends ScriptObject {
    public static __cname: string = "RequestMsg";
    /**回调对象，可无 */
    public caller: destroyable;
    /**返回数据 */
    public fCallback: (rsp: CmdRspMsg) => void;
    /**错误回调 */
    public fErrorCallback: Function;
    /**请求协议 */
    public cmdReqMsg: CmdReqMsg;
    constructor(cmdReqMsg: CmdReqMsg, caller?: destroyable, fCallback?: (rsp: CmdRspMsg) => void, fErrorCallback?: Function) {
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
        super.destroy();
    }
    getReqMsgProtoName(): string {
        return "CmdPlayerLoginReqMsg"
    }
}