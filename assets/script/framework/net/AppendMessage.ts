import { ProtoMgr } from "./ProtoMgr";

/**缓存附加信息 */
export class AppendMessage {
    public static __cname: string = "AppendMessage";

    /**
     * 附加数据对应处理函数
     */
    private static tmAppendFun: { [key: number]: Function; } = {};

    static init() {
        AppendMessage.add(ProtoMgr.get().protoCoder.appendCacheMsgId, AppendMessage.cmdCacheAppMsg);
    }

    // message CmdAppendItem{
    // 	required int32 id = 1;//附加数据ID
    // 	required bytes data = 2;//附加单元数据
    // }
    /**
     * 处理缓存附加信息
     * @param appendMsg 
     */
    static handler(appendMsg: any, rspMsgName: string, messageName?: string) {
        let messageId: number = appendMsg.id
        let cmdCacheAppMsg = ProtoMgr.get().protoCoder.decodeAppend(messageId, appendMsg.data);
        let fun = AppendMessage.tmAppendFun[messageId];
        if (fun != null) {
            fun(cmdCacheAppMsg, rspMsgName, messageName);
        } else {
            console.error("AppendMessage handler fun null: " + messageId);
        }
    }

    private static cmdCacheAppMsg(cmdCacheAppMsg, rspMsgName: string, messageName?: string) {
        let tlCmdCacheOperaterList: any[] = cmdCacheAppMsg.tlCmdCacheOperaterList;
        // let item;
        // let cacheMgr = FW.CacheMgr;
        // for (let i = 0, len = tlCmdCacheOperaterList.length; i < len; i++) {
        //     item = tlCmdCacheOperaterList[i];
        //     cacheMgr.handleCmdCacheOperaterList(item, rspMsgName, messageName);
        // }
    }

    private static add(appendMsgId: number, appendFun: Function) {
        AppendMessage.tmAppendFun[appendMsgId] = appendFun;
    }
}