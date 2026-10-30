// import { Byte } from "../utils/Byte";

// 部分android浏览器中没有slice方法(subarray共用内存,slice新内存新对象)
if (!Uint8Array.prototype.slice) {
    Uint8Array.prototype.slice = function (begin: number, end?: number) {
        // return new Uint8Array(this).subarray(...arg);
        // let u = new Uint8Array(end - begin)
        // u.set(this.subarray(begin, end));
        // return u;
        return new Uint8Array(this.subarray(begin, end));
    }
};

export type SocketEvent = "open" | "close" | "error" | "msg" | "msgerror" | "flusherror" | "timeout";
// type endianType = "bigEndian" | "littleEndian";
export class SocketUtil {

    /**毫秒 */
    public static getNowTime() {
        // let time = cc.director.getTotalTime();
        let time = Date.now();
        return time;
    }

    // static LITTLE_ENDIAN: endianType = "littleEndian";// 将低序字节存储在起始地址
    // static BIG_ENDIAN: endianType = "bigEndian";// 将高序字节存储在起始地址

    static readonly CLOSED = 3;// 3 WebSocket.CLOSED // 连接已关闭或者没有链接成功
    static readonly CLOSING = 2;// 2 WebSocket.CLOSING // 连接正在进行关闭握手，或者该close()方法已被调用
    static readonly OPEN = 1;// 1 WebSocket.OPEN // 已经链接并且可以通讯
    static readonly CONNECTING = 0;// 0 WebSocket.CONNECTING // 正在链接中

    // WebSocketEventMap
    // static readonly wsEventClose = "close";
    // static readonly wsEventError = "error";
    // static readonly wsEventMessage = "message";
    // static readonly wsEventOpen = "open";

    private connectTime: number = 0;
    private _socketName: string;
    get socketName() {
        return this._socketName;
    }

    // protected url: string | URL;
    protected url: string;
    protected ws: WebSocket;
    protected binaryType?: BinaryType;
    /**
    * <p>子协议名称。子协议名称字符串，或由多个子协议名称字符串构成的数组。必须在调用 connect 或者 connectByUrl 之前进行赋值，否则无效。</p>
    * <p>指定后，只有当服务器选择了其中的某个子协议，连接才能建立成功，否则建立失败，派发 Event.ERROR 事件。</p>
    * @see https://html.spec.whatwg.org/multipage/comms.html#dom-websocket
    */
    protected protocols?: string | string[];

    private callback: (msgType: SocketEvent, errMsg: string, retData?: any) => void;

    // 心跳
    private _heartbeatCallback: () => boolean;
    setHeartbeatCallback(callback: () => boolean) {
        this._heartbeatCallback = callback
    }

    /**
     * 不再缓存服务端发来的数据，如果传输的数据为字符串格式，建议设置为true，减少二进制转换消耗。
     */
    private disableInput: boolean;

    /**
     * 缓存的服务端发来的数据。
     */
    // private _input: Byte;
    private _input: any;
    get input() {
        return this._input;
    }
    /**
     * 表示需要发送至服务端的缓冲区中的数据。
     */
    // private _output: Byte;
    private _output: any;
    get output() {
        return this._output;
    }
    /**
     * 表示此 Socket 对象目前是否已连接。
     */
    private _connected = false;
    get connected() {
        return this._connected
    }
    set connected(v: boolean) {
        this._connected = v
    }

    private _isLittleEndian: boolean = false;
    get isLittleEndian() {
        return this._isLittleEndian;
    }
    set isLittleEndian(v: boolean) {
        let t = this
        t._isLittleEndian = v
        if (t._input != null) t._input.isLittleEndian = v;
        if (t._output != null) t._output.isLittleEndian = v;
    }

    /**
     * 前端和服务器的endian要一致,否则会出现乱码
     * <p>主机字节序，是 CPU 存放数据的两种不同顺序，包括小端字节序和大端字节序。</p>
     * <p> littleEndian ：小端字节序，地址低位存储值的低位，地址高位存储值的高位。</p>
     * <p> bigEndian ：大端字节序，地址低位存储值的高位，地址高位存储值的低位。</p>
     */
    // private _endian: endianType;
    // get endian() {
    //     return this._endian;
    // }

    // set endian(value: endianType) {
    //     let t = this
    //     t._endian = value;
    //     if (t._input != null) t._input.endian = value;
    //     if (t._output != null) t._output.endian = value;
    // }

    // private _addInputPosition: number;
    /**
    *用来发送和接收数据的 <code>Byte</code> 类。
    */
    private _byteClass: any;

    /**默认超时 */
    // private static readonly defTimeout = 5000;

    // private timeoutId: number;
    // private stopTimeout() {
    //     if (this.timeoutId != null) {
    //         clearTimeout(this.timeoutId);
    //         this.timeoutId = null;
    //     }
    // }

    // if (host && port > 0 && port < 65535)this.connect(host,port);
    /**
     * @param host 服务器地址。
     * @param port 服务器端口。一般用到的是1到65535，其中0一般不使用
     * @param isWss 一般https的话socket要wss(微信小游戏)
     */
    static getUrlByHost(host: string, port: number, isWss?: boolean, other?: string) {
        if (other == null) { other = "" }
        // let url = (isWss ? "wss://" : "ws://") + host + ":" + port + other;
        let url = [(isWss ? "wss://" : "ws://"), host, ":", port, other].join("");
        return url
    }

    static createSocket() {
        let socket = new SocketUtil()
        return socket
    }

    constructor(socketName?: string) {

        console.log("WebSocket", window["WebSocket"] != null)
        console.log("websocket", window["websocket"] != null)
        console.log("Websocket", window["Websocket"] != null)

        // console.log("systemEndian", Byte.getSystemEndian())

        let t = this

        t._socketName = socketName || "main";
        t.connectTime = 0

        t.ws = null;

        // t._addInputPosition = 0;
        t.disableInput = false;

        t._connected = false;

        //
        // t._byteClass = Byte;
        // t._input = null;
        // t._output = null;
        // t._endian = null;
        // t.endian = SocketUtil.BIG_ENDIAN;
        t.isLittleEndian = false;

        // if (t._byteClass) {
        //     t._output = new t._byteClass();
        //     t._output.isLittleEndian = t.isLittleEndian;

        //     t._input = new t._byteClass();
        //     t._input.isLittleEndian = t.isLittleEndian;
        // }
    }

    // 连接前要先检查当前是否有正在连接的socket,要先停止
    async tryCloseSocket() {
        let t = this
        t._connected = false;
        t.clearCallback();
        let ws = t.ws
        if (ws) {
            if (ws.readyState != SocketUtil.CLOSED) {
                t.close(false)
                let waitTime = 0;
                while (waitTime < 5 && t.ws && t.ws.readyState != SocketUtil.CLOSED) {
                    waitTime = waitTime + 1
                    await new Promise((resolve, reject) => { setTimeout(resolve, ((waitTime == 1) ? 10 : 99)) });
                }
                t._connected = false;
                console.log("ws.readyState:", t.ws?.readyState, " waitTime:", waitTime)
            }
        }
    }

    // url: string | URL
    // 协议://地址:端口/资源，比如ws://echo.websocket.org
    setConnectInfo(url: string, callback?: (msgType: SocketEvent, errMsg: string, d?: any) => void, heartbeatCallback?: () => boolean, protocols?: string | string[], binaryType?: BinaryType) {
        let t = this

        if (binaryType == null) { binaryType = "arraybuffer"; }

        t.url = url
        t.binaryType = binaryType
        t.protocols = protocols
        t.callback = callback
        t._heartbeatCallback = heartbeatCallback
    }

    connect(): () => boolean {
        let t = this

        t.clearCallback();
        t._connected = false;

        let ws = t.ws
        let url = t.url
        let binaryType = t.binaryType;
        let protocols = t.protocols;
        // let callback = t.callback;

        let connectTime = t.connectTime + 1
        t.connectTime = connectTime

        // t._addInputPosition = 0;

        t.clearByte();

        let wSocket = WebSocket;
        if (!wSocket) {
            wSocket = window["websocket"] || window["Websocket"];
        }

        // SECURITY_ERR,正在尝试连接的端口被阻止
        // var aWebSocket = new WebSocket(url [, protocols]);

        if (!protocols || protocols.length <= 0) {
            ws = new wSocket(url);
        } else {
            ws = new wSocket(url, protocols);
        }
        t.ws = ws
        console.log(ws.url)

        function isThisSocket() {
            return ws === t.ws;
        }

        // type BinaryType = "arraybuffer" | "blob";// (默认"blob")
        ws.binaryType = binaryType;

        let startTime = SocketUtil.getNowTime()

        let isOpen = false;

        let connectState = -1;
        function isConnectFinish() {
            return connectState >= 0;
        }

        // 建立连接时触发, readyState 变为OPEN,1时调用;这意味着当前连接已经准备好发送和接受数据。
        ws.onopen = function (event) {
            if (!t.ws) {
                console.error("onopen ws null")
                return
            }
            if (!isThisSocket()) {
                console.error("onopen !isThisSocket")
                return
            }
            let costTime = SocketUtil.getNowTime() - startTime;
            console.log("socket连接耗时:" + costTime + " 毫秒", url);
            t.showState("onopen")
            t._connected = true;
            isOpen = true
            // console.log("Send Text WS was opened.");
            t.event("open", null, event);
            connectState = 0;
        };
        // 接收到新消息时被触发
        ws.onmessage = function (event) {
            if (!t.ws) {
                console.error("onmessage ws null")
                return
            }
            if (!isThisSocket()) {
                console.error("onmessage !isThisSocket")
                return
            }
            if (!isOpen) {
                console.error("onmessage ws not open")
                return
            }
            // console.log("response text msg: " + event.data);
            t.onmessage(event)
        };
        // 当websocket的连接由于一些错误事件的发生 (例如无法发送一些数据) 而被关闭时，一个error事件将被引发。
        ws.onerror = function (event) {
            if (!t.ws) {
                console.error("onerror ws null")
                return
            }
            if (!isThisSocket()) {
                console.error("onerror !isThisSocket")
                return
            }
            if (ws.readyState != SocketUtil.OPEN) {
                t._connected = false;
            }
            if (!isOpen) {
                t.clearCallback();
                console.error("onerror ws not open")
                connectState = 1;
                return
            }
            console.log("ws onerror:", event);
            t.eventError("onerror", true, "error", event);
        };
        // 当网络出错时，会先调用onerror再调用onclose，无论何种原因的连接关闭，onclose都会被调用。
        // readyState 变为 CLOSED时被调用
        ws.onclose = function (event) {
            if (!t.ws) {
                console.error("onclose ws null")
                return
            }
            if (!isThisSocket()) {
                console.error("onclose !isThisSocket")
                return
            }
            t.clearCallback();
            t._connected = false;
            if (!isOpen) {
                console.error("onclose ws not open")
                connectState = 2;
                return
            }
            console.log('ws onclose:', event);
            t.eventError("onclose", true, "close", event)
        };

        // ws.addEventListener('error', function (event) {
        //     console.log('ws onerror: ', event);
        // });

        // let timeout = 6000
        // if (timeout && timeout > 0) {
        //     t.timeoutId = setTimeout(() => {
        //         if (!t.ws) { return }
        //         t.clearCallback();
        //         t.closeSocket()
        //         t.timeoutId = null
        //         t.eventError("ontimeout", true, "timeout")
        //         // t.clear()
        //     }, timeout)
        // }

        return isConnectFinish;
    }

    isSocketConnected() {
        let t = this
        let ws = t.ws;
        if (!ws) { return false }
        if (ws.readyState != SocketUtil.OPEN) {
            return false
        }
        if (!t.connected) {
            return false
        }
        return true
    }

    isSocketClose() {
        let t = this
        let ws = t.ws;
        if (!ws) { return true }
        return ws.readyState == SocketUtil.CLOSED;
    }

    // 断线重连还是不能完全依赖onclose来触发 由于各个浏览器和手机的的参数不同，
    // 会导致onclose的触发时间不等(有可能会很长时间，尤其是手动断网的情况)，
    // 一般的游戏或者应用其实需要在你1-3次心跳时间内没有响应就需要确定是否掉线了，所以还是需要通过心跳来辅助判断。
    public closeSocket() {
        let t = this
        let ws = t.ws;
        if (!ws) { return }

        // t.stopTimeout();

        // 关闭连接或连接尝试, 如果连接已经关闭，则此方法不执行任何操作

        // INVALID_ACCESS_ERR, 一个无效的code
        // SYNTAX_ERR, reason 字符串太长（超过 123 字节）

        // let code: number;// 默认使用 1005
        // let reason: string;// 不能超过 123 个字节
        // ws.close(code, reason)

        try {
            ws.close();
        } catch (e) { }
    }

    close(event = true) {
        let t = this
        let ws = t.ws;
        if (!ws) { return }
        t._connected = false;
        t.clearCallback();
        t.closeSocket()
        if (event) {
            t.eventError("close", true, "close")
        }
    }

    // isCanSend() {
    //     let t = this
    //     let ws = t.ws
    //     if (!ws) { return false }
    //     let readyState = ws.readyState
    //     if (readyState != SocketUtil.OPEN) {
    //         return false
    //     }
    //     let bufferedAmount = ws.bufferedAmount
    //     if (bufferedAmount > 0) {
    //         return false
    //     }
    //     return true
    // }

    getBufferedAmount() {
        let t = this
        let ws = t.ws
        if (!ws) { return -1 }
        return ws.bufferedAmount
    }

    /**
     * 发送数据到服务器。
     * @param data 需要发送的数据，可以是String或者ArrayBuffer。
     */
    // send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    send(data: Uint8Array, checkBufferedAmount = true) {
        if (!data) {
            console.error("socket send data null:", data);
            return 9
        }
        let t = this
        let ws = t.ws;
        if (!ws) {
            console.warn("socket send fail ws null");
            return 1
        }
        if (!t.connected) {
            console.warn("socket send fail connected false");
            return 2
        }
        let readyState = ws.readyState
        if (readyState != SocketUtil.OPEN) {
            console.warn("socket send fail readyState not OPEN:", readyState);
            return 3
        }

        if (checkBufferedAmount) {
            // 若在发送过程中连接被关闭，则属性值不会重置为 0
            let lastBufferedAmount = ws.bufferedAmount
            if (lastBufferedAmount > 0) {
                console.warn("socket send fail bufferedAmount:", lastBufferedAmount);
                return 4
            }
        }

        // INVALID_STATE_ERR
        // 当前连接未处于 OPEN 状态。
        // SYNTAX_ERR
        // 数据是一个包含未配对代理(unpaired surrogates) 的字符串。

        // bufferedAmount会变大
        // 若数据无法传输（例如数据需要缓存而缓冲区已满）时，套接字会自行关闭。

        // 检测websocket对象的readyState是否为OPEN，是才进行send。
        // 检测websocket对象的bufferedAmount是否为0，是才进行send（为了避免消息堆积，该属性表示调用send后堆积在websocket缓冲区的还未真正发送出去的数据长度）。

        // 若数据无法传输（例如数据需要缓存而缓冲区已满）时，套接字会自行关闭。

        let evt: any;
        try {
            // 传Uint8Array微信小游戏有问题
            // ws.send(data);// Uint8Array微信不行
            // let a = data.slice(0, data.byteLength);// Uint8Array微信不行
            // let a = data.buffer.slice(0, data.byteLength);// ArrayBuffer pc不行

            // let a = data.slice(0, data.byteLength).buffer;// ArrayBufferLike 经测试,没问题
            let a = data.buffer;

            /*
            let len = data.byteLength;
            let newByteView = new Uint8Array(len);
            let dv = new DataView(newByteView.buffer);
            let uint8array = new Uint8Array(data);
            newByteView.set(uint8array.subarray(0, len), 0);
            let a = dv.buffer.slice(0, len);// ArrayBuffer
            */

            /*
            let len = data.byteLength;
            let dv = new DataView(data.slice(0, len).buffer);
            let a = dv.buffer.slice(0, len);// ArrayBuffer
            */

            ws.send(a);
        } catch (e) {
            evt = e;
        }
        if (evt) {
            console.log("socket fail send Exception");
            console.error(evt)
            return 13
        }

        // console.log("send还没发送字节数:" + lastBufferedAmount + " " + ws.bufferedAmount)

        return 0
    }

    // sendMsg(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    sendMsg(data: Uint8Array, checkBufferedAmount = true) {
        if (!data) {
            console.error("socket sendMsg data null:", data);
            return 9
        }
        let t = this
        let ws = t.ws;
        if (!ws) {
            console.warn("socket sendMsg fail ws null");
            return 1
        }
        if (!t.connected) {
            console.warn("socket sendMsg fail connected false");
            return 2
        }
        let readyState = ws.readyState
        if (readyState != SocketUtil.OPEN) {
            console.warn("socket sendMsg fail readyState not OPEN:", readyState);
            return 3
        }
        if (checkBufferedAmount) {
            // 若在发送过程中连接被关闭，则属性值不会重置为 0
            let lastBufferedAmount = ws.bufferedAmount
            if (lastBufferedAmount > 0) {
                console.warn("socket sendMsg fail bufferedAmount:", lastBufferedAmount);
                return 4
            }
        }

        let output = t._output
        if (!output) {
            console.warn("socket sendMsg fail output null");
            return 5
        }

        output.writeArrayBuffer(data.buffer);
        let retCode = t.flush();

        // console.log("sendMsg还没发送字节数:" + lastBufferedAmount + " " + ws.bufferedAmount)

        return retCode;
    }

    /**
     * 发送缓冲区中的数据到服务器。
     */
    flush() {
        /*
        /// 发送字符串格式：
        this.socket.send("hello world");//这是发送字符串的形式。
        /// 发送二进制格式的数据：
        this.byte.writeByte(1);//写入一个字节
        this.byte.writeInt16(20);//写入一个int16的数据
        this.byte.writeFloat32(20.5);//写入一个32位的浮点数据
        this.byte.writeUTFString("hello");// 写入一个字符串；
        var by:Laya.Byte = new Laya.Byte();//这里声明一个临时Byte类型
        by.endian = Laya.Byte.LITTLE_ENDIAN;//设置endian；
        by.writeInt32(5000);//写入一个int32数据
        by.writeUint16(16);//写入一个uint16 数据
        this.byte.writeArrayBuffer(by.buffer);//把临时字节数据的数据写入byte中，这里注意写入的是by.buffer;
        this.socket.send(this.byte.buffer);//这里是把字节数组的数据通过socket发送给服务器。
        this.byte.clear();//清除掉数据;方便下次读写；
        */
        let t = this
        let ws = t.ws;
        if (!ws) {
            console.warn("socket flush fail ws null");
            return 11
        }
        let output = t._output
        if (!output) {
            console.warn("socket flush fail output null");
            return 12
        }

        if (output.length > 0) {
            let evt: any;
            try {
                let a = output.__getBuffer().slice(0, output.length);
                // let a = output.buffer;
                ws.send(a);
            } catch (e) {
                evt = e;
            }
            // output.endian = t.endian;
            output.clear();
            if (evt) {
                console.warn("socket flush fail send Exception");
                // t.eventError("flusherror", true, "flusherror")
                return 13
            }
        } else {
            console.warn("socket flush fail output.length:", output.length);
        }
        return 0;
    }

    protected onmessage(event: MessageEvent<any>) {
        /*
        /// 接收到的是字符串我们不用读，拿来直接用就可以。但是接收到的是二进制的话我们需要读取出来，转成我们需要的类型
        private receiveHandler(msg: any = null): void {
        /// 接收到数据触发函数
        /// 这里我们假设收到的是二进制ArrayBuffer
        this.byte.clear();
        this.byte.writeArrayBuffer(msg);//把接收到的二进制数据读进byte数组便于解析。
        this.byte.pos = 0;//设置偏移指针；
        /// 下面开始读取数据，按照服务器传递过来的数据，按照顺序读取
        var a:number = this.byte.getByte();
        var b:number = this.byte.getInt16();
        var c:number = this.byte.getFloat32();
        var d:string = this.byte.getString();
        var e:string = this.byte.getUTFString();
        }
        */

        let t = this
        let data = event?.data
        if (!data) {
            console.error("socket message data null");
            return
        }

        if (t.disableInput && data) {
            t.event("msg", null, data);
            return;
        }

        /*
        let input = t._input;
    
        if (input.length > 0 && input.bytesAvailable < 1) {
            input.clear();
            t._addInputPosition = 0;
        }
        let pre = input.pos;
        if (!t._addInputPosition) {
            t._addInputPosition = 0
        }
        input.pos = t._addInputPosition;
        if (data) {
            if (typeof (data) == 'string') {
                input.writeUTFBytes(data);
            } else {
                input.writeArrayBuffer(data);
            }
            t._addInputPosition = input.pos;
            input.pos = pre;
        }
        */

        t.event("msg", null, data);
    }

    // 处理接收的数据
    getMessageUint8Array(data: ArrayBuffer | Uint8Array | any): Uint8Array {
        // let t = this
        if (!data) {
            return data;
        }

        let mbuffer: Uint8Array;

        if (data instanceof ArrayBuffer) {
            mbuffer = new Uint8Array(data);
        } else if (data instanceof Uint8Array) {
            mbuffer = data
        } else {
            console.error("socket message data type error");
            mbuffer = data
        }

        // 二进制ArrayBuffer
        // let input = t._input;
        // input.clear();
        // input.writeArrayBuffer(data);
        // input.pos = 0;

        // 下面开始读取数据，按照服务器传递过来的数据，按照顺序读取
        // var a: number = input.getByte();
        // var b: number = input.getInt16();
        // var c: number = input.getFloat32();
        // var d: string = input.getString();
        // var e: string = input.getUTFString();

        // const mbuffer: Uint8Array = input.getUint8Array(0, input.length);

        return mbuffer;
    }

    private event(msgType: SocketEvent, errMsg: string, data?: any) {
        let callback = this.callback;
        if (callback) {
            callback(msgType, errMsg, data);
        }
    }

    private eventError(msg: string = "", showInfo = false, msgType?: SocketEvent, data?: any) {
        let t = this
        if (showInfo) {
            t.showState(msg, true)
        }
        msg = t.getStatusInfo(msg)
        t.event(msgType || "error", msg, data);
    }

    public clear() {
        let t = this;
        t.clearCallback();
        t.callback = null;
        t._heartbeatCallback = null;
        // t.stopTimeout();
        t.closeSocket();

        t._connected = false;
        t.clearByte();
        t._input = null;
        t._output = null;
        // t._endian = null;
        t._byteClass = null;

        t.url = null
        t.binaryType = null
        t.protocols = null
        t.ws = null
    }

    private clearByte() {
        let t = this
        if (t._input) {
            t._input.clear()
        }
        if (t._output) {
            t._output.clear()
        }
    }

    private static nullCallback() {
    }

    public clearCallback() {
        let ws = this.ws;
        if (!ws) { return }

        if (ws.removeEventListener) {
            ws.removeEventListener("error", ws.onerror)
            ws.removeEventListener("message", ws.onmessage)
            ws.removeEventListener("open", ws.onopen)
            ws.removeEventListener("close", ws.onclose)
        }

        // let tFunc = null;
        let tFunc = SocketUtil.nullCallback;

        ws.onerror = tFunc;
        ws.onopen = tFunc;
        ws.onmessage = tFunc;
        ws.onclose = tFunc;
    }

    private showState(flag: string = "", isError = false) {
        let t = this
        let ws = t.ws
        if (!ws) { return }
        // let readyState = ws.readyState

        // if (!isError) {
        //     let statusMsg = t.getStatusCodeText(status);
        //     isError = statusMsg != null;
        // }

        let statusStr = t.getStatusInfo(flag);
        if (isError) {
            console.log(ws.url)
            console.error(statusStr)
        } else {
            console.log(statusStr)
        }
        // send加到队列,还没发送到网络的字节数,发送完会重置为0
        // console.log("还没发送字节数:", ws.bufferedAmount)
        // extensions,返回服务器已选择的扩展值。目前，链接可以协定的扩展值只有空字符串或者一个扩展列表。
        // console.log(ws.extensions)
        // protocol,返回服务器端选中的子协议的名字；这是一个在创建 WebSocket 对象时，在参数 protocols 中指定的字符串，当没有已建立的链接时为空串
        // console.log(ws.protocol)
    }


    private getStatusInfo(flag?: string) {
        let t = this

        let ws = t.ws
        if (!ws) { return "" }
        let readyState = ws.readyState
        let bufferedAmount = ws.bufferedAmount

        let tlInfo = ["ws ", flag || "", " readyState:", (readyState != null) ? readyState : "null", " bufferedAmount:", (bufferedAmount != null) ? bufferedAmount : "null", " connectTime:", t.connectTime]

        let statusMsg: string;
        if (readyState != null) {
            if (readyState == SocketUtil.CONNECTING) {
                statusMsg = "CONNECTING, 正在链接中"
            } else if (readyState == SocketUtil.OPEN) {
                statusMsg = "OPEN, 已经链接并且可以通讯"
            } else if (readyState == SocketUtil.CLOSING) {
                statusMsg = "CLOSING, 连接正在关闭"
            } else if (readyState == SocketUtil.CLOSED) {
                statusMsg = "CLOSED, 连接已关闭或者没有链接成功"
            } else {
                statusMsg = "readyState error:" + readyState
            }
        }
        if (statusMsg) {
            tlInfo.push(" ", statusMsg)
        }
        return tlInfo.join("");
    }

}
