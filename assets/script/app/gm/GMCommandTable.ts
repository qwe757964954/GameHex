import { game, profiler } from 'cc';
import { GameRoute } from '../../core/runtime/GameRoute';
import { Log } from '../../framework/log/Log';
import { ProcedureManager } from '../../framework/procedure/ProcedureManager';
import { RequestGmList, RequestSystemGm } from '../generated/requestMsg/RequestSystemMsg';
import { GameNet } from '../net/GameNet';
import { GMUtils } from './GMUtils';

/** GM 指令项（对齐 client 的 { gm, desc } 结构）。 */
export interface GMCommandDef {
    gm: string;
    desc: string;
}

export type GMHandler = (args: string[]) => void | Promise<void>;

/**
 * GM 指令表。
 *
 * 从 client 的 TabGMCommand / TabGMClient 同步并适配 Demo3.8：
 * - 本地指令：在当前进程内执行（帧率、日志、断线测试、返回登录等）；
 * - 其它指令：原样发往游戏服（RequestSystemGm），保留 addItem / addGem 等服务器 GM 能力；
 * - 可选拉取服务器下发的 GM 指令列表（RequestGmList）。
 *
 * 塔防战斗类指令（tfbattle / speed / gmSkill / battleLevel / checkSkillConfig 等）依赖
 * client 的 tf_battle 模块，Demo3.8 未迁移，故不移植；微信小游戏相关逻辑同理。
 */
export class GMCommandTable {
    /** 上次输入的命令，下次打开面板时回填（对齐 client 的 static initText）。 */
    static lastInput: string = 'addItem';

    private static _inited = false;
    private static _handlers = new Map<string, GMHandler>();
    private static _list: GMCommandDef[] = [];
    private static _serverList: GMCommandDef[] = [];

    /** 提示回调（由 GMPanel 注入，显示到面板状态栏）。 */
    static onTip: ((message: string) => void) | null = null;
    /** GM 入口显隐回调（由 GMManager 注入）。 */
    static onToggleEntrance: ((visible: boolean) => void) | null = null;

    static tip(message: string): void {
        if (GMCommandTable.onTip) GMCommandTable.onTip(message);
        else console.log('[GM]', message);
    }

    /** 初始化指令表（幂等，任意入口调用一次即可）。 */
    static init(): void {
        if (GMCommandTable._inited) return;
        GMCommandTable._inited = true;
        GMCommandTable._handlers.clear();
        GMCommandTable._list = [];
        GMCommandTable._serverList = [];

        // ===================== 本地指令 =====================
        // 帧率（cc 2.x: cc.debug.setDisplayStats → 3.8: profiler.showStats/hideStats）
        this.registerLocal('fps', () => {
            if (profiler.isShowingStats()) profiler.hideStats();
            else profiler.showStats();
            GMCommandTable.tip(`fps显示:${profiler.isShowingStats() ? '开' : '关'} 帧率:${game.frameRate}`);
        });

        // 关闭打印（对齐 client 的 hideLog）
        this.registerLocal('hideLog', () => {
            Log.hideLog();
            GMCommandTable.tip('已关闭打印（console.log/info/debug/trace）');
        });

        // log <名字>：切换 framework/log/Log 对应实例的开关（对齐 client 的 log 指令）
        this.registerLocal('log', (args) => {
            const name = (args[1] ?? '').trim();
            const log = Log.tmLogsss.get(name);
            if (!log) {
                GMCommandTable.tip(`未找到日志 ${name}，可用:${Array.from(Log.tmLogsss.keys()).join('，')}`);
                return;
            }
            const next = !log.getEnabled();
            log.setEnabled(next);
            GMCommandTable.tip(`log ${name} -> ${next ? '打开' : '关闭'}`);
        });

        // 显示/隐藏物品ID（对齐 client 的 changeShowGoodsId / GMUtils.showGoodsId）
        this.registerLocal('changeShowGoodsId', () => {
            GMUtils.showGoodsId = !GMUtils.showGoodsId;
            GMCommandTable.tip(GMUtils.showGoodsId ? '显示物品ID' : '隐藏物品ID');
        });

        // 隐藏/显示 GM 入口按钮（对齐 client LayerGMEntrance 的 SetGMHide）
        this.registerLocal('hideGMEntrance', () => {
            if (GMCommandTable.onToggleEntrance) GMCommandTable.onToggleEntrance(false);
            GMCommandTable.tip('已隐藏 GM 入口');
        });
        this.registerLocal('showGMEntrance', () => {
            if (GMCommandTable.onToggleEntrance) GMCommandTable.onToggleEntrance(true);
            GMCommandTable.tip('已显示 GM 入口');
        });

        // 断线 / 重连测试（对齐 client TabGMClient 的 TestCloseSocket / TestReconnectSocket）
        this.registerLocal('TestCloseSocket', () => {
            const net = GameNet.instance;
            if (!net.isConnected) {
                GMCommandTable.tip('当前未连接 socket');
                return;
            }
            net.closeSocket();
            GMCommandTable.tip('已关闭 socket');
        });

        this.registerLocal('TestReconnectSocket', async () => {
            const net = GameNet.instance;
            const socket = net.netSocket;
            if (!socket) {
                GMCommandTable.tip('网络未初始化');
                return;
            }
            const ok = await socket.reconnect();
            GMCommandTable.tip(ok ? 'Socket 重连成功' : 'Socket 重连失败');
        });

        // 返回登录（对齐 client 的 testLogin / switchRole）
        this.registerLocal('testLogin', () => {
            ProcedureManager.navigate(GameRoute.Login);
        });

        // ===================== 指令列表 =====================
        GMCommandTable._list = [
            { gm: '3经验 6钻石 7金币 8洗炼石 9体力 10充值币', desc: '常见资源ID（服务器指令）' },
            { gm: 'addItem 10001 1', desc: '发道具、资源' },
            { gm: 'add 10001 1', desc: '加道具（addItem 别名）' },
            { gm: 'addGem 1000000 1 1', desc: '发宝石 resId 品质 数量' },
            { gm: 'addCoin 100000', desc: '加金币' },
            { gm: 'addDiamond 100000', desc: '加钻石' },
            { gm: 'addExp 100000', desc: '加经验' },
            { gm: 'superRole', desc: '超级账号，加各种资源' },
            { gm: 'consume 10001 1', desc: '消耗物品' },
            { gm: 'clearRole', desc: '清号（服务器）' },
            { gm: 'fps', desc: '本地：显示/隐藏帧率' },
            { gm: 'hideLog', desc: '本地：关闭打印' },
            { gm: 'log main', desc: '本地：切换日志开关' },
            { gm: 'changeShowGoodsId', desc: '本地：显示/隐藏物品ID' },
            { gm: 'hideGMEntrance', desc: '本地：隐藏GM入口' },
            { gm: 'showGMEntrance', desc: '本地：显示GM入口' },
            { gm: 'TestCloseSocket', desc: '本地：测试断Socket' },
            { gm: 'TestReconnectSocket', desc: '本地：测试Socket重连' },
            { gm: 'testLogin', desc: '本地：返回登录' },
        ];
    }

    /** 合并后的指令列表（本地 + 服务器下发）。 */
    static getCommandList(): GMCommandDef[] {
        return GMCommandTable._list.concat(GMCommandTable._serverList);
    }

    static registerLocal(cmd: string, handler: GMHandler): void {
        GMCommandTable._handlers.set(cmd, handler);
    }

    /**
     * 执行一条指令。
     * 命中本地处理器 → 本地执行；否则发往游戏服（CmdSystemGmReqMsg）。
     * @returns 是否被本地处理器接管
     */
    static async execute(text: string): Promise<boolean> {
        const trimmed = (text ?? '').trim();
        if (!trimmed) return false;
        GMCommandTable.lastInput = trimmed;

        const parts = trimmed.split(/\s+/);
        const head = parts[0];

        const local = GMCommandTable._handlers.get(head);
        if (local) {
            try {
                await local(parts);
            } catch (error) {
                console.error('[GM] 本地指令执行失败', head, error);
                GMCommandTable.tip(`指令执行失败:${String(error)}`);
            }
            return true;
        }

        // 服务器指令：保留 addItem 等客户端无法本地执行的能力
        const net = GameNet.instance;
        if (!net.isConnected) {
            GMCommandTable.tip('未连接游戏服，服务器指令无法发送');
            return false;
        }
        const ok = await net.send(
            new RequestSystemGm(
                { cmd: trimmed },
                GMCommandTable,
                () => GMCommandTable.tip('GM指令发送成功'),
                () => GMCommandTable.tip('GM指令发送失败'),
            ),
            false,
        );
        if (!ok) GMCommandTable.tip('GM指令未发出（网络忙/未就绪）');
        return true;
    }

    /** 请求服务器 GM 指令列表（对齐 client 的 RequestGmList），完成后回调合并后的列表。 */
    static requestServerList(onDone: (list: GMCommandDef[]) => void): void {
        const net = GameNet.instance;
        if (!net.isConnected) {
            onDone(GMCommandTable.getCommandList());
            return;
        }
        void net.send(
            new RequestGmList({}, GMCommandTable, (rsp: CmdGmListRspMsg) => {
                if (rsp && Array.isArray(rsp.cmd)) {
                    GMCommandTable._serverList = rsp.cmd.map((item) => ({ gm: item.cmd, desc: item.desc ?? '' }));
                }
                onDone(GMCommandTable.getCommandList());
            }),
            false,
        );
    }
}
