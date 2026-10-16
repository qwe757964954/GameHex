
// tlGobject：点击这组gobject外会触发fOutSide
import { ScriptObject } from "../base/ScriptObject";
import { FW } from "../FW";

export class PopUtil extends ScriptObject {
    static __cname: string = "PopUtil";

    private fInside: () => void
    private fOutSide: () => void
    private tlGobject: Array<fgui.GObject>
    private tlGCom: fgui.GComponent[]
    private tmCB: Map<fgui.GComponent, Function>
    /**
     * 
     * @param gCom 需要监听点击的多个界面，获取点击位置
     * @param tlGobject 需要判断的多个组件，判断点击位置在不在这个组件内
     * @param fOutside 出界干吗
     * @param fInside 没出界干吗
     * @returns 
     */
    public Init(gCom: fgui.GComponent[], tlGobject: Array<fgui.GObject>, fOutside: () => void, fInside?: () => void) {
        if (tlGobject == null || tlGobject.length < 1) return
        this.tlGCom = gCom
        this.fInside = fInside
        this.fOutSide = fOutside
        this.tlGobject = tlGobject

        let tmCB = new Map()
        for (let gcom of this.tlGCom) {
            this.log("panel 注册点击gcom:", gcom._name)
            if (gcom != null) {
                let cb = (evt: fgui.Event) => {
                    this.log("panel注册的gcom触发点击事件回调:", gcom._name)
                    this.GetCB(evt)
                }
                tmCB.set(gcom, cb)
                gcom.on(fairygui.Event.TOUCH_BEGIN, cb, this)
            }
        }
        this.tmCB = tmCB
    }

    GetCB(evt: fgui.Event) {
        let inputPos = new cc.Vec2(evt.pos.x, evt.pos.y)
        this.OnClick(inputPos)
    }

    protected onDestroy() {
        if (this.tlGCom) {
            for (let gcom of this.tlGCom) {
                if (gcom == null) {
                    FW.Log.error("监听对象已经被删除")
                } else {
                    let cb = this.tmCB.get(gcom)
                    gcom.off(fairygui.Event.TOUCH_BEGIN, cb, this)
                }
            }
        }
    }

    protected CallInside() {
        if (this.fInside) { this.fInside() }
    }

    protected CallOutside() {
        if (this.fOutSide) {
            this.fOutSide()
        }
    }

    OnClick(inputPos: cc.Vec2) {
        let [isClickInside, isDispose] = this.CheckInside(inputPos)
        // 未被释放才能触发
        if (!isDispose) {
            if (isClickInside) {
                this.CallInside()
            }
            else {
                this.CallOutside()
            }

        }
    }

    /**
     * 判断inputPos输入的位置是否在组件内部
     * @param inputPos 
     * @tupleReturn
     */
    private CheckInside(inputPos: cc.Vec2): [boolean, boolean] {
        let isInside = false
        let isDispose = false
        // 检测是否点中这一组对象
        for (let gobject of this.tlGobject) {
            this.log("panel 点击判断的对象 gobject:", gobject)
            // 其中一个对象被dispose，那么这个popUtil不应该触发回调了，直接跳出本次检测
            if (gobject == null || gobject.destroyed) {
                this.destroy()
                isDispose = true
                break
            }
            else {
                if (this.InSideRect(inputPos, gobject)) {
                    isInside = true
                }
            }
        }
        this.log("isInside:", isInside)
        return [isInside, isDispose]
    }

    private InSideRect(inputPos: cc.Vec2, gobject: fgui.GObject): boolean {
        let vec2 = gobject.globalToLocal(inputPos.x, inputPos.y)
        if (gobject.visible && vec2.x > 0 && vec2.x < gobject.width && vec2.y > 0 && vec2.y < gobject.height) {
            return true
        }
        return false
    }
}
