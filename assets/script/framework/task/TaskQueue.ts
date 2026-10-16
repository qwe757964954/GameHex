import { ScriptObject } from "../base/ScriptObject";

export class TaskQueue extends ScriptObject {
    public static __cname: string = "TaskQueue";
    // 任务队列
    private _queue = [];
    private _resolve: (value?: void) => void = null;
    private _stopping = false;

    // 队列长度为0了,但可能最后一个还在运行await,所以加入busy判断更准确
    private _isBusy = false;
    get isBusy() {
        return this._isBusy;
    }

    constructor() {
        super();
        this.onStart();
    }

    destroy(): void {
        let t = this;
        t.onStop();
        t._queue = null;
        t._resolve = null;
        t._stopping = null;
        t._isBusy = null;
        super.destroy();
    }

    getQueueCount() {
        return this._queue.length;
    }

    isQueueEmpty() {
        return this._queue.length <= 0;
    }

    isStopping() {
        return this._stopping;
    }

    private static _isStop = { taskQueueIsStop: true };
    private stopRace(taskWrap: any) {
        let t = this;
        return new Promise<any>((resolve) => {
            let isOK = false;
            if (!t._isBusy || t._stopping) {
                isOK = true;
            }
            else if (taskWrap && (taskWrap.destroyed || taskWrap.isFulfilled)) {
                isOK = true;
            }
            else if (t.destroyed) {
                isOK = true;
            }
            if (isOK) {
                resolve(TaskQueue._isStop)
            }
        })
    }

    private runQueue() {
        let t = this;
        // 唤醒任务队列
        if (t._resolve) {
            t._resolve()
            t._resolve = null
        }
    }

    private runTaskCancel(taskWrap: any) {
        if (!taskWrap) {
            return
        }
        let ret: any;
        let cancelCallback_ = taskWrap.cancelCallback
        if (cancelCallback_ != null) {
            let cancelCaller = taskWrap._cancelCaller
            if (cancelCaller == null || (cancelCaller != null && cancelCaller.destroyed !== true)) {
                ret = cancelCallback_.call(cancelCaller, taskWrap.p1, taskWrap.p2, taskWrap.p3, taskWrap.p4, taskWrap.p5, taskWrap.p6)
            }
        }
        return ret;
    }

    private async onStart() {
        let t = this;
        while (true) {
            //等待被唤醒
            await new Promise<void>((resolve) => {
                t._resolve = resolve
            })

            //唤醒函数设置为空
            t._resolve = null

            //此时有可能已经被回收
            if (this.isValid == false || t._queue == null) {
                return
            }

            if (t._queue.length > 0) {
                t._isBusy = true;
            }

            //执行队列里面的所有任务
            while (t._queue && t._queue.length > 0) {
                let taskWrap = t._queue.shift()
                let ret: any
                let task = taskWrap.task as Function
                let caller = taskWrap._caller
                if (caller == null || (caller != null && caller.destroyed !== true)) {
                    if (t._stopping || t.destroyed) {
                        ret = t.runTaskCancel(taskWrap);
                    } else {

                        let p1 = await task.call(caller, taskWrap.p1, taskWrap.p2, taskWrap.p3, taskWrap.p4, taskWrap.p5, taskWrap.p6)
                        //此时有可能已经被回收
                        if (!!t.isValid == false) {
                            return
                        }
                        let p2 = t.stopRace(taskWrap)
                        let temp = await Promise.race([p1, p2]);
                        //此时有可能已经被回收
                        if (!!t.isValid == false) {
                            return
                        }
                        if (temp && temp.taskQueueIsStop) {
                            taskWrap.destroyed = true;
                            ret = t.runTaskCancel(taskWrap);
                        } else {
                            ret = temp;
                            taskWrap.isFulfilled = true;
                        }
                    }
                }
                taskWrap.destroyed = true;
                if (taskWrap.resolve) {
                    taskWrap.resolve(ret)
                    taskWrap = null;
                }
            }
            if (t._stopping) {
                t._stopping = false;
            }
            t._isBusy = false;
        }
    }

    /**
     * 插入一个任务到队列
     */
    queue(caller: any, task: (p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any) => Promise<any>, p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any): Promise<any> {
        if (this._queue == null) {
            return
        }
        return this.queue2(caller, task, null, null, p1, p2, p3, p4, p5, p6)
    }

    /**
     * 插入一个任务到队列(支持中途取消任务,取消后执行取消回调)
     */
    queue2(caller: any, task: (p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any) => Promise<any>, cancelCaller: any, cancelCallback: () => Promise<any>, p1?: any, p2?: any, p3?: any, p4?: any, p5?: any, p6?: any): Promise<any> {
        let t = this;
        if (t._queue == null) {
            return
        }
        return new Promise<any>((resolve) => {
            //插入任务队列
            let taskWrap: any = {}
            taskWrap.task = task
            taskWrap._caller = caller
            taskWrap._cancelCaller = cancelCaller
            taskWrap.cancelCallback = cancelCallback
            taskWrap.resolve = resolve
            taskWrap.p1 = p1
            taskWrap.p2 = p2
            taskWrap.p3 = p3
            taskWrap.p4 = p4
            taskWrap.p5 = p5
            taskWrap.p6 = p6
            t._queue.push(taskWrap)

            t.runQueue()
        })
    }

    private onStop() {
        let t = this;
        if (!t.getIsRunning()) {
            return
        }
        t._stopping = true;

        if (t._queue == null) {
            return
        }

        while (t._queue.length > 0) {
            let taskWrap = t._queue.shift()
            let ret: any
            let caller = taskWrap._caller
            if (caller == null || (caller != null && caller.destroyed !== true)) {
                ret = t.runTaskCancel(taskWrap);
            }
            taskWrap.destroyed = true;
            if (taskWrap.resolve) {
                taskWrap.resolve(ret)
                taskWrap = null;
            }
        }

        t.runQueue()
    }
    getIsRunning(): boolean {
        if (this._queue == null) {
            return false
        }
        return this._isBusy || this._queue.length > 0;
    }

    // 队列已经为空,但await中
    isQueueEmptyButBusy() {
        if (this._queue == null) {
            return this._isBusy
        }
        return this._isBusy && this._queue.length <= 0;
    }
}
