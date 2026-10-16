import { ScriptObject } from "../base/ScriptObject";
export class ResponseMsg<CmdRspMsg> extends ScriptObject {
    public static __cname: string = "ResponseMsg";
    /**成功回调 */
    public resolve: Function
    /**失败回调 */
    public reject: Function
    /**回调对象，可无 */
    public caller: destroyable;
    /**返回数据 */
    public fCallback: (rsp: CmdRspMsg) => void;
    /**错误回调 */
    public fErrorCallback: Function;
    destroy() {
        this.resolve = null;
        this.reject = null;
        this.caller = null;
        this.fCallback = null;
        this.fErrorCallback = null;
    }

}