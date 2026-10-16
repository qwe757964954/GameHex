import { EngineMain } from "../../engine/EngineMain";
import { FW } from "../FW";
import { ScriptObject } from "../base/ScriptObject";
import { Timer } from "../utils/Timer";


interface ErrorMapStruct {
    errorLog: string,
    msg: string,
    stack: string
    hash: number
}

interface ErrorInfo {
    errorId: string,
    platform: string,
    gameId: string,
    content: ErrorMapStruct[],        //报错日志
}

export class ErrorLogMgr extends ScriptObject {
    public static __cname: string = "ErrorLogMgr";
    private static _instance: ErrorLogMgr;
    public static get instance(): ErrorLogMgr {
        if (!ErrorLogMgr._instance) {
            ErrorLogMgr._instance = new ErrorLogMgr();
        }
        return ErrorLogMgr._instance;
    }

    private errorMap: Map<string, ErrorMapStruct[]>
    private tlPush: Array<ErrorMapStruct>
    private timer: Timer;

    //跟业务层相关的，需要等业务初始化后由业务调用初始化
    //todo 后续读取后台发送的报错上报地址
    private url: string //= "http://10.21.210.122:9503/center/clientLog"
    private errorId: string
    private gameId: string

    constructor() {
        super()
        this.errorMap = new Map()
        this.tlPush = []
        this.timer = Timer.getTimer(() => {
            this.update()
        }, null, 6000, -1)
        this.timer.start()
    }

    private update() {
        if (this.tlPush.length <= 0) {
            return
        }
        if (this.url == null || this.errorId == null || this.gameId == null) {
            return
        }
        let data: ErrorInfo = {
            "errorId": this.errorId,
            "platform": EngineMain.os,
            "gameId": this.gameId,
            "content": this.tlPush,
        }
        FW.Http.post(this.url, data, "json")

        this.tlPush.length = 0
    }


    private hash(str: string) {
        let sum = 0
        let i = 0
        for (let s of str) {
            i += 1
            sum += (Math.pow(s.charCodeAt(0), 2) + i)
        }
        return sum
    }

    public InitData(url: string, errorId: string, gameId: number) {
        this.url = url
        this.errorId = errorId
        this.gameId = gameId.toString()
    }

    public PushError(errorLog: string, message: string, stack?:string, error?: Error) {
        let key = errorLog + message
        let value = stack || ""
        let strCompare = value.slice(0, 6000)
        console.log("strCompare:", strCompare)
        //方法堆栈筛选 ios不支持正则中的断言匹配
        let regex: RegExp = /at [a-zA-Z0-9]+.[a-zA-Z0-9]+/gim;
        //行数筛选
        let regex2: RegExp = /[0-9]+:[0-9]+/gim;
        let regExpMatchArray = strCompare.match(regex)
        let regExpMatchArray2 = strCompare.match(regex2)
        if (!regExpMatchArray)
            return

        if (!regExpMatchArray2)
            return
        
        // console.log(regex)
        // console.log(regex2)
        let str = ""
        // console.log("==========================")
        for (let regExpMatch of regExpMatchArray) {
            // console.log(regExpMatch)
            str += regExpMatch
        }
        // console.log("==========================")
        // console.log("---------------------------")

        for (let regExpMatch2 of regExpMatchArray2) {
            // console.log(regExpMatch2)
            str += regExpMatch2
        }
        // console.log("-----------------------------")

        let hash = this.hash(str)
        let tlStruct = this.errorMap.get(key)
        if (tlStruct == null) {
            tlStruct = []
        }
        let has = false
        for (let struct of tlStruct) {
            if (hash == struct.hash) {
                has = true
                break
            }
        }
        if (has) {
            return
        }
        let struct = { stack: value, hash: hash, errorLog: errorLog, msg: message }
        tlStruct.push(struct)
        this.errorMap.set(key, tlStruct)
        this.tlPush.push(struct)
    }

}