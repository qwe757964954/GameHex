/**状态 pending:待定 fulfilled:已兑现 rejected:已拒绝 */
type PromiseState=
    "pending"|"fulfilled"|"rejected"

/**
 * 扩展Promise
 */
interface Promise<T>{
    // state:PromiseState
    // resolve: (value: T | PromiseLike<T>) => void
    reject?: (reason?: any) => void
}