import { Node } from "cc";
import type { AssetService } from "../../core/asset/AssetService";
import type { SessionAssetService } from "../../core/asset/SessionAssetService";
import { ResourceScope } from "../../core/asset/ResourceScope";
import type { ConfigService } from "../../core/config/ConfigService";
import type { NetworkTransport } from "../../core/network/NetworkTransport";
import { ScriptObject } from "../base/ScriptObject";
import { ProcedureManager } from "./ProcedureManager";

export interface ProcedurePreloadContext {
    readonly resources: ResourceScope;
    cancelled: boolean;
}

/**
 * 游戏流程基类（对齐 GameFramework 的 ProcedureBase）。
 *
 * 一个「流程」代表游戏运行到某个阶段时的完整处理逻辑，例如：
 *   - ProcedureLaunch    启动流程（加载配置、热更检查）
 *   - ProcedureLogin     登录流程
 *   - ProcedureGame      对局流程
 *   - ProcedureQuit      退出流程
 *
 * 生命周期（由 ProcedureManager 驱动）：
 *   onInit(manager)                        仅一次，流程注册进管理器后调用
 *   onPreload(params)                      切入前异步预加载（可 await 资源加载等）
 *   onPreloadCancelled()                   预加载失败或被更新的导航覆盖
 *   onEnter(params)                        预加载完成后切入本流程
 *   onUpdate(elapseSeconds, realElapseSeconds)  每帧调用（只驱动当前流程）
 *   onLeave()                              每次切出本流程时调用
 *
 * 说明：流程本身继承 ScriptObject（非 cc.Component），不具备 node。
 * 需要挂载 UI / 组件时，通过 this.host 访问流程宿主节点（即 ProcedureManager
 * 所挂载的常驻节点），在其下 instantiate prefab 或 addComponent。
 *
 * 子类通过 changeProcedure(target, params) 切换到其他流程。
 */
export abstract class ProcedureBase extends ScriptObject {
    public static __cname: string = "ProcedureBase";

    private manager: ProcedureManager | null = null;
    private resourceScope: ResourceScope | null = null;

    /** 由 ProcedureManager 在注册时调用，只执行一次。 */
    onInit(manager: ProcedureManager): void {
        this.manager = manager;
    }

    /** 流程宿主节点（ProcedureManager 所挂载的常驻节点），供流程挂载 UI/组件。 */
    protected get host(): Node {
        const node = this.manager?.node;
        if (!node) {
            throw new Error(`${this.className} 尚未挂载到 ProcedureManager，无法访问 host 节点`);
        }
        return node;
    }

    /** 切入前异步预加载，可返回 Promise 以等待资源就绪。默认立即完成。 */
    onPreload(_params?: any, _context?: ProcedurePreloadContext): Promise<void> | void { }

    /** 切入本流程时调用。 */
    onEnter(_params?: any): void { }

    /** 预加载失败或被更新的导航覆盖时调用。 */
    onPreloadCancelled(_context?: ProcedurePreloadContext): void { }

    /** 每帧调用，只针对当前流程。elapseSeconds = 逻辑帧间隔，realElapseSeconds = 真实帧间隔。 */
    onUpdate(_elapseSeconds: number, _realElapseSeconds: number): void { }

    /** 切出本流程时调用。 */
    onLeave(): void { }

    /** 切换到目标流程。 */
    protected changeProcedure(target: new (...args: any[]) => ProcedureBase, params?: any): void {
        this.manager?.changeProcedure(target, params);
    }

    /** 使用应用路由切换流程，避免业务模块互相 import 具体流程类。 */
    protected navigate(route: string, params?: any): void {
        this.manager?.navigate(route, params);
    }

    protected get assets(): AssetService {
        if (!this.manager) {
            throw new Error(`${this.className} 尚未挂载到 ProcedureManager，无法访问资源服务`);
        }
        return this.manager.context.assets;
    }

    protected get sessionAssets(): SessionAssetService {
        if (!this.manager) {
            throw new Error(`${this.className} 尚未挂载到 ProcedureManager，无法访问会话资源服务`);
        }
        return this.manager.context.sessionAssets;
    }

    protected get configs(): ConfigService {
        if (!this.manager) {
            throw new Error(`${this.className} 尚未挂载到 ProcedureManager，无法访问配置服务`);
        }
        return this.manager.context.configs;
    }

    protected get network(): NetworkTransport {
        if (!this.manager) {
            throw new Error(`${this.className} 尚未挂载到 ProcedureManager，无法访问网络服务`);
        }
        return this.manager.context.network;
    }

    /** 仅供 ProcedureManager：把本次成功预加载的资源所有权移交给流程。 */
    _adoptResourceScope(scope: ResourceScope): void {
        this.releaseResourceScope();
        this.resourceScope = scope;
    }

    /** 子类应先销毁使用资源的节点，再调用本方法。 */
    protected releaseResourceScope(): void {
        this.resourceScope?.dispose();
        this.resourceScope = null;
    }

    protected onDestroy(): void {
        this.releaseResourceScope();
        this.manager = null;
    }

    protected get managerRef(): ProcedureManager | null {
        return this.manager;
    }
}
