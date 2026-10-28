import { instantiate, Node, Prefab, Vec3 } from 'cc';
import { ProcedureBase } from '../../framework/procedure/ProcedureBase';
import type { ProcedurePreloadContext } from '../../framework/procedure/ProcedureBase';
import { LoginGateway } from '../login/LoginProtocol';
import { LoginPage } from '../login/LoginPage';

const LOGIN_ROOT_URL = 'ui/login/LoginRoot';

/**
 * 登录流程。
 *
 * 生命周期：
 *   onPreload  异步预加载 LoginRoot 预制体（含 LoginPage 组件及其 @property 绑定）
 *   onEnter    实例化 LoginRoot 挂到 host 节点下
 *   onLeave    销毁登录节点
 *
 * LoginPage 登录成功后按 GameRoute 切换到主界面，页面不再依赖具体流程类。
 */
export class ProcedureLogin extends ProcedureBase {
    public static __cname: string = 'ProcedureLogin';

    /** 预加载得到的 LoginRoot 预制体（缓存，重进登录时复用）。 */
    private loginPrefab: Prefab | null = null;

    /** 当前登录节点实例（切出时销毁）。 */
    private loginNode: Node | null = null;

    async onPreload(_params?: any, context?: ProcedurePreloadContext): Promise<void> {
        if (this.loginPrefab) return;
        const prefab = await this.assets.load(LOGIN_ROOT_URL, Prefab, { scope: context?.resources });
        if (context?.cancelled) return;
        this.loginPrefab = prefab;
        this.log('LoginRoot 预加载完成');
    }

    onEnter(_params?: any): void {
        if (!this.loginPrefab) {
            this.error('LoginRoot 尚未预加载，无法进入登录流程');
            return;
        }
        this.loginNode = instantiate(this.loginPrefab);
        const page = this.loginNode.getComponent(LoginPage)!;
        page.configureGateway(new LoginGateway(this.network));
        this.loginNode.setParent(this.host);
        this.loginNode.setPosition(Vec3.ZERO);
        this.log('进入登录流程');
    }

    onPreloadCancelled(): void {
        this.loginPrefab = null;
    }

    onLeave(): void {
        if (this.loginNode) {
            this.loginNode.destroy();
            this.loginNode = null;
        }
        this.loginPrefab = null;
        this.releaseResourceScope();
        this.log('离开登录流程');
    }
}
