import { ScriptObject } from "../base/ScriptObject";
import { Pool } from "../pool/Pool";
import { Log } from './../log/Log';
import { UpdateBeat, UpdateClass } from "./UpdateBeat";
/**时间计时器 */
export class Timer extends ScriptObject {
    public static __cname: string = "Timer";

    private static pool = new Pool<Timer, () => void, destroyable, number, number>(() => {
        return new Timer();
    }, (ret) => {
        ret.destroy()
    }, (ret, func: (time?: Timer) => void, caller?: destroyable, nFrame?: number, loop?: number) => {
        ret.init(func, caller, nFrame, loop)
    }, (ret) => {
        ret.bePoolReturn()
        return true
    });

    /**
     * 开放创建时间计时器接口
     * @param func 回调函数
     * @param caller 回调对象
     * @param duration 间隔时间
     * @param loop 定时器执行次数 < 0 时循环重复执行直到调用stop才停止
     * @returns
     */
    static getTimer(func: (time?: Timer) => void, caller?: destroyable, duration?: number, loop: number = 1) {
        if (func == null) {
            Log.inst.error("getTimer func null")
            return
        }
        let _timer = Timer.pool.getFromPool(func, caller, duration, loop)
        return _timer
    }

    static stopTimerByCaller(caller: destroyable, executeCallback?: boolean) {
        if (caller == null) {
            Log.inst.warn("stopTimerByCaller caller null")
            return
        }
        if (executeCallback) {
            Timer.pool.returnAllToPool((_timer) => {
                if (_timer.caller == caller) {
                    _timer.stop(executeCallback, false)
                    return true
                }
                return false
            })
        } else {
            Timer.pool.returnAllToPool((_timer) => {
                return _timer.caller == caller
            })
        }
    }

    /**计时器回调函数 */
    private func: (time?: Timer) => void;
    /**计时器回调对象 */
    private caller: destroyable;
    /**记录计时器间隔多少秒 */
    private duration: number;
    /**计时器间隔多少秒 */
    private time: number;
    /**执行次数 */
    private loop: number;
    private _updateClass: UpdateClass;
    /**计时器是否在运行 */
    private running: boolean;

    init(func: (time?: Timer) => void, caller?: destroyable, duration?: number, loop?: number) {
        this.func = func;
        this.caller = caller;
        this.duration = duration;
        this.time = duration;
        this.loop = loop;
        this.running = false;
        this._updateClass = null;
    }

    destroy() {
        this.bePoolReturn()
        super.destroy();
    }

    private stopUpdateBeat() {
        let t = this;
        t.running = false;
        let _updateClass = t._updateClass
        if (_updateClass) {
            UpdateBeat.removeListener(_updateClass)
        }
        t._updateClass = null;
    }

    bePoolReturn(): boolean {
        let t = this;
        t.stopUpdateBeat()
        t.func = null;
        t.caller = null;
        t.duration = null;
        t.time = null;
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

    get stoped(): boolean {
        return !this.running
    }

    /**停止计时器 */
    stop(executeCallback?: boolean, toPool?: boolean) {
        let t = this
        t.stopUpdateBeat()
        if (executeCallback) {
            t.runCallback()
        }
        if (toPool !== false) {
            Timer.pool.returnToPool(t)
        }
    }

    runCallback() {
        let t = this
        if (t.func == null) {
            return
        }
        let caller = t.caller;
        if (caller) {
            t.func.call(t.caller, t)
        } else {
            t.func(t)
        }
    }

    /**计时器工作函数 */
    update(dt: number) {
        let t = this;
        if (t.running) {
            t.time = t.time - dt;
            if (t.time <= 0) {
                t.runCallback()
                if (t.running && t.time <= 0) {
                    if (t.loop > 1) {
                        t.loop--;
                        t.time += t.duration;
                    }
                    else if (t.loop == 1) {
                        t.stop();
                    }
                    else {
                        t.time += t.duration;
                    }
                }
            }
        }
    }
}

