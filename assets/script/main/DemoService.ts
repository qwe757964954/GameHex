import { Container } from '../framework/container/Container';
import { Log } from '../framework/log/Log';

/**
 * DemoService
 * ------------------------------------------------------------------
 * 最小 IoC 注册示例。被 DemoMain 注册到 Container，并被 DemoChildService 注入。
 * 注意：DemoChildService 在 DemoMain.ts 里定义（同 demo 验证），避免循环依赖
 * ------------------------------------------------------------------
 */
export class DemoService implements destroyable {
    public static __cname: string = 'DemoService';

    destroyed: boolean = false;

    constructor() {
        Log.log('[DemoService] constructed');
    }

    greet(): string {
        return 'Hello from DemoService!';
    }

    destroy(): void {
        this.destroyed = true;
        console.log('[DemoService] destroyed');
    }
}