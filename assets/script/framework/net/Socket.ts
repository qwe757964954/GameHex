
import { ScriptObject } from "../base/ScriptObject";
import { EventProxy } from "../event/EventProxy";
import { Byte } from "../utils/Byte";

export type SocketEventType = "open" | "message" | "close" | "error"
type endianType = "bigEndian" | "littleEndian"
export class Socket extends ScriptObject {
    public static __cname: string = "Socket";
    protected _socket: any;
    /**
     * 不再缓存服务端发来的数据，如果传输的数据为字符串格式，建议设置为true，减少二进制转换消耗。
     */
    disableInput: boolean;
    /**
     * <p>子协议名称。子协议名称字符串，或由多个子协议名称字符串构成的数组。必须在调用 connect 或者 connectByUrl 之前进行赋值，否则无效。</p>
     * <p>指定后，只有当服务器选择了其中的某个子协议，连接才能建立成功，否则建立失败，派发 Event.ERROR 事件。</p>
     * @see https://html.spec.whatwg.org/multipage/comms.html#dom-websocket
     */
    protocols: any;
    /**
     * 缓存的服务端发来的数据。
     */
    private _input: any;
    get input(): any {
        return this._input;
    }
    /**
     * 表示需要发送至服务端的缓冲区中的数据。
     */
    private _output: any;
    get output(): any {
        return this._output;
    }
    /**
     * 表示此 Socket 对象目前是否已连接。
     */
    private _connected: boolean;
    get connected(): boolean {
        return this._connected
    }
    /**
     * <p>主机字节序，是 CPU 存放数据的两种不同顺序，包括小端字节序和大端字节序。</p>
     * <p> littleEndian ：小端字节序，地址低位存储值的低位，地址高位存储值的高位。</p>
     * <p> bigEndian ：大端字节序，地址低位存储值的高位，地址高位存储值的低位。</p>
     */
    private _endian: endianType;
    get endian(): endianType {
        return this._endian;
    }

    set endian(value: endianType) {
        this._endian = value;
        if (this._input != null) this._input.endian = value;
        if (this._output != null) this._output.endian = value;
    }

    private _addInputPosition: number;
    private _byteClass: any;
    /**缓存事件 */
    private _eventProxy = new EventProxy<SocketEventType>();
    get eventProxy() {
        return this._eventProxy;
    }

    destroy() {
        let t = this;
        t.disableInput = null;
        t.protocols = null;
        t._input = null;
        t._output = null;
        t._endian = null;
        t._addInputPosition = null;
        t._byteClass = null;
        t._eventProxy = null;
        t.close();
        super.destroy()
    }

    event(type: SocketEventType, data: any) {
        this._eventProxy.execute(type, data);
    }
    /**
     * <p>创建新的 Socket 对象。默认字节序为 Socket.BIG_ENDIAN 。若未指定参数，将创建一个最初处于断开状态的套接字。若指定了有效参数，则尝试连接到指定的主机和端口。</p>
     * @param host		服务器地址。
     * @param port		服务器端口。
     * @param byteClass	用于接收和发送数据的 Byte 类。如果为 null ，则使用 Byte 类，也可传入 Byte 类的子类。
     * @param protocols	子协议名称。子协议名称字符串，或由多个子协议名称字符串构成的数组
     */
    constructor(host?: string, port?: number, protocols?: Array<any>) {
        super();
        /**@private */
        this._endian = null;
        /**@private */
        this._socket = null;
        /**@private */
        this._connected = false;
        /**@private */
        this._addInputPosition = 0;
        /**@private */
        this._input = null;
        /**@private */
        this._output = null;
        /**
        *不再缓存服务端发来的数据，如果传输的数据为字符串格式，建议设置为true，减少二进制转换消耗。
        */
        this.disableInput = false;
        /**
        *用来发送和接收数据的 <code>Byte</code> 类。
        */
        this._byteClass = null;
        /**
        *<p>子协议名称。子协议名称字符串，或由多个子协议名称字符串构成的数组。必须在调用 connect 或者 connectByUrl 之前进行赋值，否则无效。</p>
        *<p>指定后，只有当服务器选择了其中的某个子协议，连接才能建立成功，否则建立失败，派发 Event.ERROR 事件。</p>
        *@see https://html.spec.whatwg.org/multipage/comms.html#dom-websocket
        */
        this.protocols = [];

        (port === void 0) && (port = 0);
        this._byteClass = Byte;
        this.protocols = protocols;
        this.endian = "bigEndian";
        if (host && port > 0 && port < 65535) this.connect(host, port);
    }
    /**
     * <p>连接到指定的主机和端口。</p>
     * <p>连接成功派发 Event.OPEN 事件；连接失败派发 Event.ERROR 事件；连接被关闭派发 Event.CLOSE 事件；接收到数据派发 Event.MESSAGE 事件； 除了 Event.MESSAGE 事件参数为数据内容，其他事件参数都是原生的 HTML DOM Event 对象。</p>
     * @param host	服务器地址。
     * @param port	服务器端口。
     */
    connect(host: string, port: number): void {
        let url = "ws://" + host + ":" + port;
        this.connectByUrl(url);
    }
    /**
     * <p>连接到指定的服务端 WebSocket URL。 URL 类似 ws://yourdomain:port。</p>
     * <p>连接成功派发 Event.OPEN 事件；连接失败派发 Event.ERROR 事件；连接被关闭派发 Event.CLOSE 事件；接收到数据派发 Event.MESSAGE 事件； 除了 Event.MESSAGE 事件参数为数据内容，其他事件参数都是原生的 HTML DOM Event 对象。</p>
     * @param url	要连接的服务端 WebSocket URL。 URL 类似 ws://yourdomain:port。
     */
    connectByUrl(url: string): void {
        let t = this;
        let socket = t._socket
        if (socket != null) {
            this.close(true);
        }

        {
            let wSocket = WebSocket;
            if (!wSocket) {
                wSocket = window["websocket"] || window["Websocket"];
            }

            if (!this.protocols || this.protocols.length == 0) {
                socket = new wSocket(url);
            } else {
                socket = new wSocket(url, this.protocols);
            }
            t._socket = socket
        }

        t._socket.binaryType = "arraybuffer";
        t._output = new t._byteClass();
        t._output.endian = t.endian;
        t._input = new t._byteClass();
        t._input.endian = t.endian;
        t._addInputPosition = 0;

        t._socket.onopen = (e) => {
            t._onOpen(e);
        };
        t._socket.onmessage = (msg) => {
            t._onMessage(msg);
        };
        t._socket.onclose = (e) => {
            t._onClose(e);
        };
        t._socket.onerror = (e) => {
            t._onError(e);
        };
    }

    /**
     * 关闭连接。
     */
    close(notEvent: boolean = false): void {
        let t = this
        if (t._socket != null) {
            let socket = t._socket
            t._socket = null;

            const nullCallback = () => { }

            socket.onopen = nullCallback
            socket.onmessage = nullCallback
            socket.onerror = nullCallback
            if (notEvent) {
                this._connected = false;
                socket.onclose = nullCallback
            } else {
                socket.onclose = (e) => {
                    t._onClose(e)
                    socket.onclose = nullCallback
                }
            }

            try {
                socket.close();
            } catch (e) {
                console.error("socket.close catch:", e)
            }
        }
        t._connected = null;
    }

    protected _onOpen(e: any): void {
        this._connected = true;
        this.event("open", e);
    }
    protected _onMessage(msg: any): void {
        if (!msg || !msg.data) return;
        let data = msg.data;
        if (this.disableInput && data) {
            this.event("message", data);
            return;
        }
        if (this._input.length > 0 && this._input.bytesAvailable < 1) {
            this._input.clear();
            this._addInputPosition = 0;
        };
        let pre = this._input.pos;
        !this._addInputPosition && (this._addInputPosition = 0);
        this._input.pos = this._addInputPosition;
        if (data) {
            if ((typeof data == 'string')) {
                this._input.writeUTFBytes(data);
            } else {
                this._input.writeArrayBuffer(data);
            }
            this._addInputPosition = this._input.pos;
            this._input.pos = pre;
        }
        this.event("message", data);
    }
    protected _onClose(e: any): void {
        this._connected = false;
        this.event("close", e)
    }
    protected _onError(e: any): void {
        this.event("error", e)
    }
    /**
     * 发送数据到服务器。
     * @param	data 需要发送的数据，可以是String或者ArrayBuffer。
     */
    send(data: any): void {
        this._socket.send(data);
    }
    /**
     * 发送缓冲区中的数据到服务器。
     */
    flush(): void {
        if (this._output && this._output.length > 0) {
            let evt;
            try {
                this._socket && this._socket.send(this._output.__getBuffer().slice(0, this._output.length));
            } catch (e) {
                evt = e;
            }
            this._output.endian = this.endian;
            this._output.clear();
            if (evt) this.event("error", evt);
        }
    }

}