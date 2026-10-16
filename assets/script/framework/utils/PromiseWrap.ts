type IResolve<T> = (value: T | PromiseLike<T>) => void
type IReject = (reason?: any) => void
/**状态 pending:待定 fulfilled:已兑现 rejected:已拒绝 */
// export type IPromiseState = "pending" | "fulfilled" | "rejected";
enum IPromiseState {
    pending = "pending",
    fulfilled = "fulfilled",
    rejected = "rejected"
}

/**
* PromiseWrap
*/
export class PromiseWrap<T>{
    static __cname: string = "PromiseWrap";
    promise: Promise<T>;
    resolve: IResolve<T>;
    reject: IReject;
    state: IPromiseState;
    constructor(task?: (resolve: IResolve<T>, reject: IReject) => void) {
        let t = this;
        t.promise = new Promise((resolve, reject) => {
            t.state = IPromiseState.pending
            t.resolve = resolve
            t.reject = reject
            if (task) {
                task(resolve, reject)
            }
        }).then((v: any) => {
            t.state = IPromiseState.fulfilled
            return v
        }).catch((reason: any) => {
            t.state = IPromiseState.rejected
            throw reason
        })
    }
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
        return this.promise.then(onfulfilled, onrejected)
    }
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): Promise<T | TResult> {
        return this.promise.catch(onrejected)
    }
    // es2018
    // finally(onfinally?: (() => void) | undefined | null): Promise<T> {
    //     return this.promise.finally(onfinally)
    // }

    isPending() {
        return this.state == IPromiseState.pending;
    }
    isFulfilled() {
        return this.state == IPromiseState.fulfilled;
    }
    isRejected() {
        return this.state == IPromiseState.rejected;
    }
}
