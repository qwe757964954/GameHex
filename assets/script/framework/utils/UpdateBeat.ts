import { ScriptObject } from "../base/ScriptObject";
import { Log } from "../log/Log";
import { Pool } from "../pool/Pool";

export class UpdateClass extends ScriptObject {
    public static __cname: string = "UpdateClass";
    /**回调对象，可无 */
    public caller: destroyable;
    /**回调 */
    public fCallback: (dt: number) => void;

    init(caller: destroyable, fCallback: (dt: number) => void) {
        this.destroyed = false;
        this.caller = caller;
        this.fCallback = fCallback;
    }
    destroy() {
        this.caller = null;
        this.fCallback = null;
        super.destroy();
    }
    runCallback(dt: number) {
        let t = this
        if (t.destroyed) {
            return
        }
        let caller = t.caller
        let fCallback = t.fCallback
        if (caller) {
            if (typeof (caller) == "object" && caller["destroyed"]) {
                return
            }
            fCallback.call(caller, dt);
        } else {
            fCallback(dt)
        }
    }
    protected objectDestroy() {
    }
}

/**
 * 每帧渲染的时候回调用UpdateBeat的loop函数
 * 添加游戏帧回调处理调用createListener函数后调用添加addListener函数
 * let updateClass = UpdateBeat.createListener(this, this.update)
 * UpdateBeat.addListener(updateClass)
 * 移出游戏帧回调处理调用removeListenerByCaller函数
 * UpdateBeat.removeListenerByCaller(this)
 * 使用对象需要implements框架的destroyable接口
 */
export class UpdateBeat {
    public static __cname: string = "UpdateBeat";

    private static pool = new Pool<UpdateClass, destroyable, (dt: number) => void>(() => {
        return new UpdateClass()
    }, (ret) => {
        ret.destroy()
    }, (ret, caller: destroyable, fCallback: (dt: number) => void) => {
        ret.init(caller, fCallback)
    }, (ret) => {
        ret.destroy()
        return true
    });

    /**
     * 外部游戏的主循环loop每帧调用
     * @param dt 上一帧至此时所用时间
     */
    static loop(dt: number) {
        let tlUpdate = UpdateBeat.pool.getTlUseObj;
        for (let _updateClass of tlUpdate) {
            _updateClass.runCallback(dt)
        }
    }

    /**
     * 创建每帧回调的对象
     * @param caller 调用对象
     * @param fCallback 回调函数
     * @returns UpdateBeat
     */
    static addListener(fCallback: (dt: number) => void, caller?: destroyable) {
        let _updateClass = UpdateBeat.getUpdateClass(caller, fCallback);
        return _updateClass;
    }

    /**
     * 删除对象
     * @param _Class UpdateBeat
     */
    static removeListener(_updateClass: UpdateClass) {
        if (!_updateClass) {
            return;
        }
        UpdateBeat.pool.returnToPool(_updateClass)
    }

    /**
     * 根据回调对象移出所有的回调函数对象
     * @param caller 调用对象
     */
    static removeListenerByCaller(caller: destroyable) {
        if (caller == null) {
            Log.inst.error("removeListenerByCaller caller null")
            return
        }
        UpdateBeat.pool.returnAllToPool((_updateClass) => {
            return _updateClass.caller == caller
        })
    }

    /**
     * 创建回调每帧回调对象，未实现优先级，以后可以考虑加入优先级
     * @param caller 调用对象 
     * @param fCallback 回调函数
     * @returns 
     */
    private static getUpdateClass(caller: destroyable, fCallback: (dt: number) => void) {
        let _updateClass = UpdateBeat.pool.getFromPool(caller, fCallback)
        return _updateClass
    }

}

