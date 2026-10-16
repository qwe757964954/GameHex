import protobufRoot from '../../lib/protobuf/protoCompiledStatic';

export interface ProtocolValidation {
    requestCount: number;
    responseCount: number;
    broadcastCount: number;
    hasClientEnvelope: boolean;
    hasServerEnvelope: boolean;
    hasRoleLogin: boolean;
}

export interface DecodedServerPacket {
    clientIndex: number;
    messageIds: number[];
    splits: number[];
    data: Uint8Array;
    result: boolean;
    compress: boolean;
}

/** pbjs static-module 产物的形状：命名空间以**普通属性**挂载（`root.com.xkhy.tafang.cmd`）。 */
export type ProtobufStaticNamespace = { [name: string]: any };
/** 静态枚举：`name -> value` 是自有键，`value -> name` 在其原型上。 */
export type ProtobufStaticEnum = { [name: string]: number };
export interface ProtobufStaticRoot {
    com: ProtobufStaticNamespace;
}

/**
 * 协议编解码器 —— 全部基于**预生成的静态模块**，不使用 protobufjs 的反射模式。
 *
 * ==================================================================
 * ⚠️ 不要改回 `protobufjs` 的 `Root.fromJSON()` + `lookupType().encode()`
 * ==================================================================
 * protobufjs 的构造器 / encode / decode / verify 都是运行时用 `util.codegen()`
 * 里的 `Function.apply(...)` / `Function(src)()` **现场生成**的。
 * 而微信小游戏禁止动态执行 JS（`eval` 与 `new Function` 都不可用，官方文档
 * https://developers.weixin.qq.com/minigame/dev/guide/runtime/js-support ），
 * 于是在微信包里连**构造**都过不去：
 *
 *     [LoginPage] protobuf protocol invalid
 *     TypeError: Function(...) is not a function
 *         at util/codegen ← Type.get(generateConstructor) ← Field.resolve ← resolveAll
 *
 * 实测（`tmp/probe_protobuf_codegen.mjs`）：只调一次 `Root.fromJSON(schema)`
 * 就命中 **649 次** codegen，整份 schema 一轮 664 次 —— 不是「等到 encode 才炸」。
 *
 * `lib/protobuf/protoCompiledStatic.ts` 由 `tools/proto/gen_static_module.mjs`
 * 用 `pbjs -t static-module` 预生成，全文件 0 处 `codegen` / 0 处 `Function(`，
 * 且与反射模式的编码结果**逐字节一致**（`tmp/probe_static_module_check.mjs`）。
 */
export class ProtocolCodec {
    private readonly gameNamespace = 'com.xkhy.tafang.cmd';
    private readonly engineNamespace = 'com.cca.core.network.cmd';
    /** 业务协议命名空间：com.xkhy.tafang.cmd */
    private readonly game: ProtobufStaticNamespace;
    /** 引擎信封命名空间：com.cca.core.network.cmd */
    private readonly engine: ProtobufStaticNamespace;
    /** 协议号枚举（`Object.keys` 拿协议名，下标取值拿协议号）。 */
    private readonly messageIds: ProtobufStaticEnum;
    /** 协议号 → 协议名（自建，不依赖 protobufjs 内部形状）。 */
    private readonly responseNameById: { [id: number]: string } = {};

    constructor(root: ProtobufStaticRoot = protobufRoot as unknown as ProtobufStaticRoot) {
        this.game = root?.com?.xkhy?.tafang?.cmd;
        this.engine = root?.com?.cca?.core?.network?.cmd;
        this.messageIds = this.game?.MessageId;
        if (!this.messageIds || !this.engine) {
            throw new Error('protobuf 静态模块结构异常：缺少 com.xkhy.tafang.cmd / com.cca.core.network.cmd');
        }
        for (const name of Object.keys(this.messageIds)) {
            this.responseNameById[this.messageIds[name]] = name;
        }
    }

    validate(): ProtocolValidation {
        const names = Object.keys(this.messageIds);
        return {
            requestCount: names.filter((name) => name.endsWith('RspMsg') && this.hasType(name.replace(/RspMsg$/, 'ReqMsg'))).length,
            responseCount: names.filter((name) => name.endsWith('RspMsg')).length,
            broadcastCount: names.filter((name) => name.endsWith('BroMsg')).length,
            hasClientEnvelope: this.hasEngineType('ClientCmdData'),
            hasServerEnvelope: this.hasEngineType('ServerCmdData'),
            hasRoleLogin: this.hasType('CmdRoleLoginReqMsg') && this.hasType('CmdRoleLoginRspMsg'),
        };
    }

    getMessageId(requestName: string): number {
        const responseName = requestName.replace(/ReqMsg$/, 'RspMsg');
        const id = this.messageIds[responseName];
        if (id == null) throw new Error(`MessageId 未定义：${requestName}`);
        return id;
    }

    encodeRequest(requestName: string, payload: Record<string, unknown>, clientIndex: number): Uint8Array {
        const messageId = this.getMessageId(requestName);
        const requestType = this.lookupType(requestName);
        // 静态产物是按 `--no-verify` 生成的（省下的体积直接决定微信主包大小），
        // 这里用 encode 兜底：字段类型不对时 encode 一样会抛，只是信息没 verify 那么精确。
        let data: Uint8Array;
        try {
            data = requestType.encode(requestType.create(payload)).finish();
        } catch (error) {
            throw new Error(`${requestName} 参数错误：${this.errorText(error)}`);
        }
        const envelope = this.engine.ClientCmdData;
        return envelope.encode(envelope.create({ messageId, clientIndex, data })).finish();
    }

    /**
     * 解开服务端外层信封。
     *
     * 静态产物按 `--no-convert` 生成（不含 `toObject`），所以这里按字段手工摊平；
     * 字段命名与 proto 一致（camelCase），缺省值与 `--no-convert` 之前的
     * `toObject(..., { defaults: true, arrays: true })` 口径保持一致。
     */
    decodeServerPacket(data: Uint8Array): DecodedServerPacket {
        const message = this.engine.ServerCmdData.decode(data);
        return {
            clientIndex: message.clientIndex ?? 0,
            messageIds: message.messageIds ?? [],
            splits: message.splits ?? [],
            data: message.data ?? new Uint8Array(0),
            result: message.result ?? false,
            compress: message.compress ?? false,
        };
    }

    /**
     * 按协议号解码响应体。
     *
     * 返回 decode 出来的消息对象（字段齐全、可当普通对象读）。
     * 与 `ProtoCoder.decodeDataById` 同一口径 —— 项目里真正的收包路径走 `ProtoCoder`。
     */
    decodeResponse<T extends Record<string, unknown>>(messageId: number, data: Uint8Array): T {
        const responseName = this.responseNameById[messageId];
        if (!responseName) throw new Error(`未知响应协议号：${messageId}`);
        const type = this.lookupType(responseName);
        return type.decode(data) as T;
    }

    private lookupType(name: string): any {
        const type = this.game[name];
        if (!type) throw new Error(`${this.gameNamespace} 未定义消息：${name}`);
        return type;
    }

    private hasType(name: string): boolean {
        return typeof this.game[name]?.encode === 'function';
    }

    private hasEngineType(name: string): boolean {
        return typeof this.engine[name]?.encode === 'function';
    }

    private errorText(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
