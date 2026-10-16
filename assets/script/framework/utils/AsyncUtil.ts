import { FW } from "../FW";

export class AsyncUtil {
    public static __cname: string = "AsyncUtil";

    /**
     * 执行异步函数,直到成功或达到最大次数
     * @param callback 异步函数,可返回errMsg, 可返回boolean
     * @param maxTimes 执行的最大次数,默认1,(<=0, 直到成功)
     * @param waitTime 执行错误后,开始下次执行前的等待时间(秒)
     * @param errorCallback 错误回调
     */
    private static readonly runUntil_errMsg = "fail runUntil";
    static async runUntil(callback: (idx?: number) => Promise<any>, maxTimes: number, waitTime: number = 1000, errorCallback: Function = null, caller: any = null): Promise<string> {
        let errMsg = null;
        let isOK: boolean = true;
        let isTimeOK: boolean = true;
        let i = 0;
        do {
            if (caller == null) {
                errMsg = await callback(i + 1);
            } else {
                errMsg = await callback.call(caller);
            }
            i += 1;
            isTimeOK = (maxTimes <= 0 || i < maxTimes);
            if (!(errMsg == null || errMsg === true || (errMsg !== false && typeof (errMsg) != 'string'))) {
                isOK = false;
                if (errorCallback) {
                    errorCallback(i, errMsg);
                }
                if (isTimeOK) {
                    if (waitTime > 0) {
                        await FW.Task.delay(waitTime, caller)
                    }
                }
            } else {
                isOK = true;
            }
        } while (!isOK && isTimeOK);

        if (errMsg === true) {
            errMsg = null
        } else if (errMsg === false) {
            errMsg = AsyncUtil.runUntil_errMsg
        }
        if (!(errMsg == null || typeof (errMsg) == 'string')) {
            console.warn("runUntil errMsg other type")
            errMsg = null
        }

        return errMsg;
    }

    /**
     * 检查多个同时执行的Promise的进度
     * @param tlPromise Promise数组,可返回errMsg, 可返回boolean
     * @param isCheck 是否检查返回值,如果Promise返回errMsg,或者false,就执行失败
     * @param callback 进度回调
     */
    private static readonly runTlPromise_errMsg = "fail runTlPromise";
    static async runTlPromise(tlPromise: Promise<any>[], isCheck: boolean = true, callback: (progress: number, max: number) => void = null): Promise<string> {
        let errMsg = null;
        let count = tlPromise.length
        if (count > 0) {
            let j = 0;
            let errMsg2 = null;
            let errMsg_com = null;
            let isFinish: boolean = false;
            let promise = null
            do {
                promise = tlPromise[j]
                if (promise != null) {
                    errMsg2 = await promise;
                    if (!(errMsg2 == null || errMsg2 === true || (errMsg2 !== false && typeof (errMsg2) != 'string'))) {
                        let errMsg_ = errMsg2
                        if (typeof (errMsg2) != 'string') {
                            errMsg_ = AsyncUtil.runTlPromise_errMsg;
                            errMsg_com = errMsg_
                        } else {
                            errMsg = (errMsg == null ? errMsg2 : (errMsg + " " + errMsg2))
                        }
                        console.log(errMsg_)
                        if (isCheck) {
                            return errMsg_;
                        }
                    }
                }
                j += 1;
                isFinish = (j < count)
                if (callback != null) {
                    callback(j, count)
                }
            } while (isFinish)

            if (errMsg_com != null) {
                errMsg = errMsg == null ? errMsg_com : (errMsg_com + " " + errMsg)
            }

            if (!(errMsg == null || typeof (errMsg) == 'string')) {
                console.warn("runTlPromise errMsg other type")
                errMsg = null
            }
        }
        return errMsg
    }

    /**
     * 按顺序执行异步函数
     * @param tlPromise 异步函数数组,可返回errMsg, 可返回boolean
     * @param isCheck 是否检查返回值,如果Promise返回errMsg,或者false,就执行失败
     * @param callback 进度回调
     * @param delay 下一个异步执行前的等待时间(秒)
     */
    private static readonly runTlPromiseFunc_errMsg = "fail runTlPromiseFunc";
    static async runTlPromiseFunc(tlPromise: (() => Promise<any>)[], isCheck: boolean = true, callback: (progress: number, max: number) => void = null, delay: number = 0): Promise<string> {
        let errMsg = null;
        let count = tlPromise.length
        if (count > 0) {
            let j = 0;
            let errMsg2 = null;
            let errMsg_com = null;
            let isFinish: boolean = false;
            let promise = null
            do {
                promise = tlPromise[j]
                if (promise != null) {
                    errMsg2 = await promise();
                    if (!(errMsg2 == null || errMsg2 === true || (errMsg2 !== false && typeof (errMsg2) != 'string'))) {
                        let errMsg_ = errMsg2
                        if (typeof (errMsg2) != 'string') {
                            errMsg_ = AsyncUtil.runTlPromiseFunc_errMsg;
                            errMsg_com = errMsg_
                        } else {
                            errMsg = (errMsg == null ? errMsg2 : (errMsg + " " + errMsg2))
                        }
                        console.log(errMsg_)
                        if (isCheck) {
                            return errMsg_;
                        }
                    }
                }

                j += 1;
                isFinish = (j < count)
                if (callback != null) {
                    callback(j, count)
                }

                if (delay > 0 && isFinish && promise != null) {
                    await FW.Task.delay(delay)
                }
            } while (isFinish);

            if (errMsg_com != null) {
                errMsg = errMsg == null ? errMsg_com : (errMsg_com + " " + errMsg)
            }

            if (!(errMsg == null || typeof (errMsg) == 'string')) {
                console.warn("runTlPromiseFunc errMsg other type")
                errMsg = null
            }

        }
        return errMsg;
    }
}