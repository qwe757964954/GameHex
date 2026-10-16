import { ScriptObject } from "../base/ScriptObject";
import { Pool } from "../pool/Pool";
import { UpdateBeat, UpdateClass } from "./UpdateBeat";
/**
 * 帧计时器
 */
export class FrameTimer extends ScriptObject {
    public static __cname: string = "FrameTimer";

    private static pool = new Pool<FrameTimer, () => void, destroyable, number, number>(() => {
        return new FrameTimer();
    }, (ret) => {
        ret.destroy()
    }, (ret, func: () => void, caller?: destroyable, duration?: number, loop?: number) => {
        ret.init(func, caller, duration, loop)
    }, (ret) => {
        ret.bePoolReturn()
        return true
    });

    /**
     * 开放创建帧计时器接口
     * @param func 回调函数
     * @param caller 回调对象
     * @param nFrame 间隔多少帧
     * @param loop 定时器执行次数 < 0 时循环重复执行直到调用stop才停止
     * @returns 
     */
    static getFrameTimer(func: () => void, caller?: destroyable, nFrame?: number, loop: number = 1) {
        let _frameTime = FrameTimer.pool.getFromPool(func, caller, nFrame, loop)
        return _frameTime
    }


    /**计时器回调函数 */
    private func: () => void;
    /**计时器回调对象 */
    private caller: destroyable;
    /**计时器下次执行帧数 */
    private nFrame: number;
    /**记录计时器间隔多少帧 */
    private duration: number;
    /**执行次数 */
    private loop: number;
    private _updateClass: UpdateClass;
    /**计时器是否在运行 */
    private running: boolean;

    init(func: () => void, caller?: destroyable, nFrame?: number, loop?: number) {
        let t = this;
        t.func = func;
        t.caller = caller;
        let c = (cc.game as any).frameCount;
        t.nFrame = c;
        t.duration = nFrame;
        t.loop = loop;
        t.running = false;
    }

    destroy() {
        this.bePoolReturn()
        super.destroy();
    }

    bePoolReturn(): boolean {
        let t = this;
        t.running = false;
        let _updateClass = t._updateClass;
        if (_updateClass) {
            UpdateBeat.removeListener(_updateClass);
        }
        t._updateClass = null;
        t.func = null;
        t.caller = null;
        t.nFrame = null;
        t.duration = null;
        t.loop = null;
        t.running = null;
        return true
    }

    /**启动计时器 */
    start() {
        let t = this;
        let _updateClass = t._updateClass
        if (t._updateClass == null) {
            _updateClass = UpdateBeat.addListener(this.update, this);
            t._updateClass = _updateClass;
        }
        t.running = true;
    }

    /**停止计时器 */
    stop() {
        let t = this
        FrameTimer.pool.returnToPool(t)
    }

    /**计时器工作函数 */
    update() {
        let t = this;
        if (t.running) {
            let frameCount = (cc.game as any).frameCount;
            if (frameCount >= t.nFrame) {
                t.func.call(t.caller)
                if (t.loop == null) {
                    return
                }
                if (t.loop > 1) {
                    t.loop--;
                    t.nFrame = frameCount + t.duration;
                }
                else if (t.loop == 1) {
                    t.stop();
                } else {
                    t.nFrame = frameCount + t.duration;
                }
            }
        }
    }
}