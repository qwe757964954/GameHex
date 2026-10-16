import { ScriptObject } from "../base/ScriptObject";
import { Func } from "../Func";
import { FrameTimer } from "../utils/FrameTimer";
import { Timer } from "../utils/Timer";
/**
 * 计时器管理对象
 */
export class Task extends ScriptObject {
    public static __cname: string = "Task";
    private static _instance: Task;
    static get instance(): Task {
        if (Task._instance == null) {
            Task._instance = new Task();
            window["fw_task"] = Task._instance
        }
        return Task._instance
    }


    destroy() {
        super.destroy()
    }

    /**
     * 返回一个延时time秒的Promise
     * 使用方法：await FW.Task.delay(time)
     * @param time 延时时间(毫秒)
     * @param caller 回调对象，可无！
     * @returns 返回一个Promise,需要await
     */
    delay(time: number, caller?: destroyable): Promise<void> {
        return new Promise<void>((resolve) => {
            let frameTimer = Timer.getTimer(() => {
                resolve();
                frameTimer.stop();
                frameTimer = null;
            }, caller, time, 1)
            frameTimer.start()
        })
    }

    /**
     * 返回一个间隔nFrame帧后执行的Promise
     * 使用方法：await FW.Task.delayFrame(nFrame)
     * @param nFrame 延时帧数
     * @param caller 回调对象，可无！
     * @returns 返回一个Promise,需要await
     */
    delayFrame(nFrame: number, caller?: destroyable): Promise<void> {
        return new Promise<void>((resolve) => {
            let frameTimer = FrameTimer.getFrameTimer(() => {
                resolve();
                frameTimer.stop();
                frameTimer = null;
            }, caller, nFrame)
            frameTimer.start()
        })
    }

    /**
     * 返回一个一直等待condition返回真的Promise
     * @param condition 定时执行函数
     * @param caller 调用对象
     * @param nFrame 间隔多少帧，默认1帧
     * @param timeout 是否设置超时(毫秒)
     * @returns 返回一个Promise,需要await
     */
    waitUntil(condition: () => boolean, caller?: destroyable, nFrame: number = 1, timeout?: number): Promise<void> {
        let ret: boolean;
        if (caller != null) { ret = condition.call(caller); } else { ret = condition(); }
        if (ret) {
            return Promise.resolve()
        }
        let timeNow: number;
        if (timeout != null && timeout > 0) {
            timeNow = Date.now()
        }
        return new Promise<void>((resolve) => {
            let frameTimer = FrameTimer.getFrameTimer(() => {
                if (caller != null) { ret = condition.call(caller); } else { ret = condition(); }
                if (ret || (timeNow != null && (Date.now() - timeNow) > timeout)) {
                    frameTimer.stop();
                    frameTimer = null;
                    resolve();
                }
            }, caller, nFrame, -1)
            frameTimer.start();
        })
    }

    waitUntilTest(condition: () => boolean, caller: destroyable, nFrame: number = 1, timeout?: number): Promise<void> {
        return new Promise<void>((resolve) => {
            console.log((cc.game as any).frameCount);
            resolve();
            // let frameTimer = FrameTimer.getFrameTimer(() => {
            //     if (frameTimer) {
            //         console.log((cc.game as any).frameCount);
            //         resolve();
            //         console.log((cc.game as any).frameCount);
            //         frameTimer = null;
            //         console.log((cc.game as any).frameCount);
            //         console.log("----------------------------------");
            //     }
            // }, caller, nFrame, -1)
            // frameTimer.start();
        })
    }

    async waitSuccess(callback: Function, caller?: destroyable, interval?: number) {
        while (true) {
            if (Func.runFunc(callback, caller)) {
                break
            } else if (interval != null) {
                await this.delay(interval)
            }
        }
    }
}
