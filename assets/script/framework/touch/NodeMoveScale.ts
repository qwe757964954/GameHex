import { Vec2 } from "../../engine/Vec2";
import { ScriptObject } from "../base/ScriptObject";

export class NodeMoveScale extends ScriptObject {
    public static __cname: string = "NodeMoveScale";
    private scaleFactor: number

    // 地图最小显示的的缩放(正常显示时检测,手指缩放时不检测)
    private minScale: number
    private maxScale: number
    // 手指最小缩放(比这个还小就不能通过手指缩放了)
    private minCanScale: number
    private maxCanScale: number

    private _oldScale: number
    private nodeScale: number
    private nodeX: number
    private nodeY: number

    /**
     * 原点相对锚点的偏移
     */
    private _offsetPivotX: number = 0
    private _offsetPivotY: number = 0
    setOffsetPivot(x: number, y: number) {
        this._offsetPivotX = x
        this._offsetPivotY = y
    }

    private _downPoint: Vec2 = new Vec2(0, 0);
    private lastPointX: number
    private lastPointY: number
    private _stageCom: fgui.GComponent;
    private _isChange: boolean
    private _graph: fgui.GGraph
    constructor(stageCom?: fgui.GComponent) {
        super();
        let g = new fgui.GGraph();
        g.toFullCenterParent(stageCom)
        g.setSize(stageCom.width, stageCom.height);
        g.drawRect(1, cc.Color.RED, new cc.Color(255, 0, 0, 255));
        g.alpha = 0
        this._graph = g

        stageCom.setOn(fgui.Event.TOUCH_BEGIN, this.onTouchStart, this);
        stageCom.setOn(fgui.Event.TOUCH_MOVE, this.onTouchMove, this);
        stageCom.setOn(fgui.Event.TOUCH_END, this.onTouchEnd, this);
        stageCom.setOn(fgui.Event.MOUSE_WHEEL, this.onMouseWhell, this);
        this._isChange = true
        this._stageCom = stageCom
    }

    destroy() {
        if (this._stageCom) {
            let stageCom = this._stageCom
            stageCom.removeOn(fgui.Event.TOUCH_BEGIN, this.onTouchStart, this);
            stageCom.removeOn(fgui.Event.TOUCH_MOVE, this.onTouchMove, this);
            stageCom.removeOn(fgui.Event.TOUCH_END, this.onTouchEnd, this);
            stageCom.removeOn(fgui.Event.MOUSE_WHEEL, this.onMouseWhell, this);

            this._stageCom = null
        }
        if (this._graph) {
            this._graph.removeFromParent()
            this._graph = null
        }
        this._downPoint = null
        if (this._tlTouchesId) {
            this._tlTouchesId.length = 0
            this._tlTouchesId = null
        }

        this._mouseDownCallback = null
        this._mouseDownCaller = null
        this._mouseClickCallback = null
        this._mouseClickCaller = null
        this._mouseMoveCallback = null
        this._mouseMoveCaller = null
        this._mouseEndCallback = null
        this._mouseEndCaller = null
        this._scrollSystem = null
        this._owner = null
        super.destroy()
    }

    /**
     * 舞台大小(就是屏幕宽高)
     */
    private stageWidth: number
    private stageHeight: number

    /**
     * 使用区域大小(不偏移的话,就是节点大小)
     */
    private useWidth: number
    private useHeight: number

    private minX: number
    private minY: number
    private maxX: number
    private maxY: number

    private _mouseDownCallback: Function
    private _mouseDownCaller: destroyable
    setMouseDownCallback(callback: Function, caller: destroyable) {
        this._mouseDownCallback = callback
        this._mouseDownCaller = caller
    }



    private _mouseMoveCallback: Function
    private _mouseMoveCaller: destroyable
    setMouseMoveCallback(callback: Function, caller: destroyable) {
        this._mouseMoveCallback = callback
        this._mouseMoveCaller = caller
    }

    private _mouseClickCallback: Function
    private _mouseClickCaller: destroyable
    setMouseClickCallback(callback: Function, caller: destroyable) {
        this._mouseClickCallback = callback
        this._mouseClickCaller = caller
    }

    private _mouseEndCallback: Function
    private _mouseEndCaller: destroyable
    setMouseEndCallback(callback: Function, caller: destroyable) {
        this._mouseEndCallback = callback
        this._mouseEndCaller = caller
    }

    private _scrollSystem: { setInertiaFlag(flag: boolean): void }
    /**
     * 用来暂停惯性的，如有没有惯性接口可以不要注册
     * @param scrollSystem 
     */
    setScrollSystem(scrollSystem: { setInertiaFlag(flag: boolean): void }) {
        this._scrollSystem = scrollSystem
    }

    /**
     * 
     * @param enableScale 是否开启缩放
     * @param stageWidth 舞台宽(屏幕宽)
     * @param stageHeight 舞台高(屏幕高)
     * @param useWidth 使用区域宽(不偏移的话,就是节点宽)
     * @param useHeight 使用区域高(不偏移的话,就是节点高)
     * @param allWidth 节点宽(如果不偏移和useWidth相同)
     * @param allHeight 节点高(如果不偏移和useHeight相同)
     * @param scaleFactor 缩放因子
     * @param offSetX 偏移量
     * @param offSetY 偏移量
     */
    init(stageWidth: number, stageHeight: number
        , useWidth: number, useHeight: number, allWidth: number, allHeight: number
        , offSetX: number = 0, offSetY: number = 0, scaleFactor: number = 0.001
        , params?: any//参数太多了
    ) {

        let t = this
        t.scaleFactor = scaleFactor

        t.stageWidth = stageWidth
        t.stageHeight = stageHeight

        t.useWidth = useWidth
        t.useHeight = useHeight

        // 默认缩放焦点在屏幕中心
        t.scaleMidX = stageWidth * 0.5
        t.scaleMidY = stageHeight * 0.5

        let offsetOriginX = (allWidth - useWidth) * 0.5
        let offsetOriginY = (allHeight - useHeight) * 0.5

        t.minX = -(useWidth + offsetOriginX + offSetX)
        t.minY = -(useHeight + offsetOriginY + offSetY)

        t.maxX = -(offsetOriginX + offSetX)
        t.maxY = -(offsetOriginY + offSetY)

        // 4.游戏最小视角为0.6倍，当玩家将视角缩放到0.6倍之后，会缓缓向上恢复为0.7倍
        t.minCanScale = 0.6
        t.maxCanScale = 1.2

        t.minScale = 0.7
        t.maxScale = 1

        //参数设置
        if (params) {
            if (params.minCanScale) {
                t.minCanScale = params.minCanScale
            }
            if (params.maxCanScale) {
                t.maxCanScale = params.maxCanScale
            }
            if (params.minScale) {
                t.minScale = params.minScale
            }
            if (params.maxScale) {
                t.maxScale = params.maxScale
            }
        }

        let theMinScale = stageWidth / useWidth
        if (t.minScale < theMinScale) {
            t.minScale = theMinScale
        }
        if (t.minCanScale < theMinScale) {
            t.minCanScale = theMinScale
        }
        theMinScale = stageHeight / useHeight
        if (t.minScale < theMinScale) {
            t.minScale = theMinScale
        }
        if (t.minCanScale < theMinScale) {
            t.minCanScale = theMinScale
        }

        t._moveMinDistance = 20
        t._isMove = false
    }

    private _owner: fgui.GComponent;
    public setComNode(com: fgui.GComponent) {
        let t = this;
        t._owner = com;
        t.nodeScale = com.scaleX
        t.nodeX = com.x
        t.nodeY = com.y

        t._oldScale = t.nodeScale

        let allWidth = com.width
        let allHeight = com.height

        let offsetPivotX = allWidth * com.pivotX
        let offsetPivotY = allHeight * com.pivotY
        t.setOffsetPivot(offsetPivotX, offsetPivotY)
    }

    set moveMinDistance(value: number) {
        this._moveMinDistance = value
    }

    update(): boolean {
        let t = this;
        if (t._isChange) {
            t._isChange = false
            t.adjustPosAfterScale(t._oldScale, t.scaleMidX, t.scaleMidY)
            return true
        }
        let isChange = false
        let nowScale = t.getScale()
        t.updateCheckMapScale()
        let toScale = t.nodeScale
        if (nowScale != toScale) {
            isChange = true
        }
        if (t._oldScale != toScale) {
            t.adjustPosAfterScale(t._oldScale, t.scaleMidX, t.scaleMidY)
            isChange = true
        }

        let nowX = t.getX()
        let nowY = t.getY()
        let toX = t.nodeX
        let toY = t.nodeY

        if (nowX != toX || nowY != toY) {
            isChange = true
        }
        return isChange
    }

    updateToNode() {
        let t = this;

        let nowScale = t.getScale()
        let toScale = t.nodeScale
        if (nowScale != toScale) {
            t.setScale(toScale)
        }

        let nowX = t.getX()
        let nowY = t.getY()
        let toX = t.nodeX
        let toY = t.nodeY
        if (nowX != toX || nowY != toY) {
            t.setPos(toX, toY)
        }
    }

    reset() {
        let t = this;
        t.nodeScale = t.getScale()
        t.nodeX = t.getX()
        t.nodeY = t.getY()
    }

    // down: 2个点
    private isScale: boolean

    private lastDistance: number

    // 可以限制按下一定距离才触发移动
    private _moveMinDistance: number
    private _scaleAni: number = null;//进行缩放表现

    private _isMove: boolean = false
    public get isMove(): boolean {
        return this._isMove
    }
    public set isMove(is) {
        this._isMove = is
    }
    private scaleMidX: number
    private scaleMidY: number

    /**获取屏幕坐标的节点坐标 */
    getMapXByStageX(stageX: number, nowScale: number, offsetOriginX: number = 0) {
        let t = this
        let mapX = t.nodeX
        mapX /= nowScale

        let x = mapX - offsetOriginX

        x = -x + t._offsetPivotX - t._stageCom.x

        x += stageX / nowScale
        return x
    }

    getMapYByStageY(stageY: number, nowScale: number, offsetOriginY: number = 0) {
        let t = this
        let mapY = t.nodeY
        mapY /= nowScale

        let y = mapY - offsetOriginY

        y = -y + t._offsetPivotY - t._stageCom.y

        y += stageY / nowScale
        return y
    }

    getStageXByMapX(mapX: number, offsetOriginX: number = 0) {
        let t = this
        let nodeX = t.nodeX
        let nowScale = t.nodeScale
        nodeX = nodeX / nowScale
        let x = nodeX - offsetOriginX
        x = -x + t._offsetPivotX
        let stageX = (mapX - x) * nowScale
        return stageX
    }

    getStageYByMapY(mapY: number, offsetOriginY: number = 0) {
        let t = this
        let nodeY = t.nodeY
        let nowScale = t.nodeScale
        nodeY /= nowScale

        let y = nodeY - offsetOriginY

        y = -y + t._offsetPivotY
        let stageY = (mapY - y) * nowScale
        return stageY
    }

    private _tlTouchesId: Array<number> = new Array()
    private getAllTouches(evt: fgui.Event) {
        let t = this
        let tlTouchesId = t._tlTouchesId
        tlTouchesId.length = 0
        evt._processor.getAllTouches(tlTouchesId)
        return tlTouchesId
    }



    private onTouchStart(evt: fgui.Event) {
        let t = this
        evt.captureTouch()
        let tlTouchesId = t.getAllTouches(evt)
        let touchlen = tlTouchesId.length

        let downCount = 0
        if (touchlen > 1) {
            let curTouchId = evt.touchId
            if (tlTouchesId[0] != curTouchId && tlTouchesId[1] != curTouchId) {
                /**多指触摸，只处理双指触摸，后面的忽略 */
                return
            }
            t.isScale = true
            let firstTouchId = tlTouchesId[0]
            let firstPos = evt._processor.getTouchPosition(firstTouchId)

            let firstX = firstPos.x
            let firstY = firstPos.y

            let secondTouchId = tlTouchesId[1]
            let secondPos = evt._processor.getTouchPosition(secondTouchId)

            let secondX = secondPos.x
            let secondY = secondPos.y

            t.scaleMidX = (firstX + secondX) * 0.5;
            t.scaleMidY = (firstY + secondY) * 0.5;
            t.lastDistance = t.distance(firstPos, secondPos)
            downCount = 2
        } else {
            let x = evt.pos.x
            let y = evt.pos.y
            t.isScale = false
            t.lastPointX = x
            t.lastPointY = y
            downCount = 1
            t._downPoint.set(t.lastPointX, t.lastPointY)
        }
        if (t._mouseDownCallback && t._mouseDownCaller && !t._mouseDownCaller.destroyed) {
            t._mouseDownCallback.call(t._mouseDownCaller, evt, downCount)
        }
    }

    private readonly isClickMaxDistance = 20
    private onTouchMove(evt: fgui.Event) {
        let t = this
        evt.captureTouch()
        let tlTouchesId = t.getAllTouches(evt)
        let touchlen = tlTouchesId.length
        let downCount = 0
        let moveX: number = null
        let moveY: number = null
        let scale: number = null
        if (touchlen > 1) {
            /**多指触摸,缩放操作 */
            let curTouchId = evt.touchId
            if (tlTouchesId[0] != curTouchId && tlTouchesId[1] != curTouchId) {
                /**多指触摸，只处理双指触摸，后面的忽略 */
                return
            }
            if (t.lastDistance == null) {
                return
            }
            downCount = 2
            let firstTouchId = tlTouchesId[0]
            let firstPos = evt._processor.getTouchPosition(firstTouchId)

            let secondTouchId = tlTouchesId[1]
            let secondPos = evt._processor.getTouchPosition(secondTouchId)

            var distance: number = t.distance(firstPos, secondPos)

            let scale = distance - t.lastDistance

            let toScale = t.nodeScale + scale * t.scaleFactor

            t.lastDistance = distance
            t.setNodeScale(toScale, false)
        } else {
            if (t.isScale) {
                /**缩放过松开其他手指不再处理移动 */
                return
            }
            if (!t._isMove) {
                /**确定为移动后,下次开始才更新坐标 */
                let dis = t.distance({ x: t.lastPointX, y: t.lastPointY }, evt.pos)
                if (dis >= t._moveMinDistance) {
                    t._isMove = true
                    t.lastPointX = evt.pos.x
                    t.lastPointY = evt.pos.y
                    if (this._scrollSystem) {
                        this._scrollSystem.setInertiaFlag(true)
                    }
                }
                return false
            }
            downCount = 1
            if (t._isMove) {
                let stageX: number = evt.pos.x
                let stageY: number = evt.pos.y
                let nowX = t.nodeX;
                let nowY = t.nodeY;
                moveX = stageX - t.lastPointX
                moveY = stageY - t.lastPointY
                let x = nowX + moveX;
                let y = nowY + moveY;

                t.lastPointX = stageX;
                t.lastPointY = stageY;
                t._lastAdjustPosX = x
                t._lastAdjustPosY = y
                t.setAndAdjustPos(x, y, false);
            }
        }
        if (t._mouseMoveCallback && t._mouseMoveCaller && !t._mouseMoveCaller.destroyed) {
            t._mouseMoveCallback.call(t._mouseMoveCaller, evt, downCount, moveX, moveY)
        }
    }

    private onTouchEnd(evt: fgui.Event) {
        let t = this
        evt.captureTouch()
        let tlTouchesId = t.getAllTouches(evt)
        let touchlen = tlTouchesId.length
        let downCount = 1
        if (touchlen > 1) {
            /**多指触摸,缩放操作 */
            return
        }

        let isClick = true

        if (t._isMove) {
            if (t.distance(t._downPoint, evt.pos) > t.isClickMaxDistance) {
                isClick = false
            }
        } else if (t.isScale) {
            isClick = false
            downCount = 2
        }

        if (t._mouseClickCallback && t._mouseClickCaller && !t._mouseClickCaller.destroyed) {
            t._mouseClickCallback.call(t._mouseClickCaller, evt, downCount, isClick)
        }
        if (t._mouseEndCallback && t._mouseEndCaller && !t._mouseEndCaller.destroyed) {
            t._mouseEndCallback.call(t._mouseEndCaller, evt, downCount, isClick)
        }
        t.lastDistance = null;
        t.isScale = false
        t._isMove = false
    }


    private onMouseWhell(evt: fgui.Event) {
        if (this._scrollSystem) {
            this._scrollSystem.setInertiaFlag(false)
        }
        let value: number = evt.mouseWheelDelta;
        let t = this
        if (value > 0) {//滚轮滑动增量大于0,向上滚动
            t.setNodeScale(t.nodeScale + 0.05, false)
        } else {//滚轮滑动增量小于0,向下滚动
            t.setNodeScale(t.nodeScale - 0.05, false)
        }
    }

    /**设置节点中心到屏幕中心 */
    cameraToCenter(offsetX: number = 0, offsetY: number = 0) {
        let t = this
        t.cameraAt(t.useWidth * 0.5 + offsetX, t.useHeight * 0.5 + offsetY)
    }

    /**以节点坐标系移动某坐标到屏幕中心(地图左上角为[0,0]) */
    cameraAt(x: number, y: number) {
        let t = this
        t.setToMapPos(x, y, t.stageWidth * 0.5, t.stageHeight * 0.5)
    }

    cameraAtMapPos(x: number, y: number, ani: boolean = false) {
        let t = this
        t.setToMapPos(x, y, t.stageWidth * 0.5, t.stageHeight * 0.5)
    }

    //进行缩放表现
    setNodeScaleAni(scale?: number) {
        this._scaleAni = scale
    }
    /**
     * 设置缩放
     */
    setNodeScale(scale: number, setScale: boolean = false) {
        if (scale == null || isNaN(scale)) {
            this.log("scale == null || isNaN(scale)")
            return
        }
        let t = this
        //主动缩放，取消表现
        t.setNodeScaleAni();
        if (scale > t.maxCanScale) {
            this.log("scale = t.maxCanScale")
            scale = t.maxCanScale
        }
        if (scale < t.minCanScale) {
            this.log("scale = t.minCanScale")
            scale = t.minCanScale
        }
        if (t.nodeScale == scale) {
            this.log("t.nodeScale == scale")
            return
        }
        t.nodeScale = scale
        if (setScale) {
            t.setScale(scale)
        }
    }

    /**以地图坐标系设置坐标到屏幕坐标(原点在屏幕左上角) */
    private setToMapPos(x: number, y: number, stageX: number = 0, stageY: number = 0) {
        let t = this

        let nodeScale = t.nodeScale

        x = t._offsetPivotX - x
        y = t._offsetPivotY - y

        x *= nodeScale
        y *= nodeScale

        x += stageX
        y += stageY

        t.setAndAdjustPos(x, y)
    }


    private static tempPoint = new Vec2(0, 0)
    addPos(x: number, y: number) {
        let t = this
        let nowX = t.getX()
        let nowY = t.getY()
        let x1 = x + nowX
        let y1 = y + nowY

        t.setAndAdjustPos(x1, y1, true)

        //计算实际改变多少
        let _x = t.getX() - nowX
        let _y = t.getY() - nowY
        let mapScale = t.nodeScale

        NodeMoveScale.tempPoint.set(_x / mapScale, _y / mapScale);
        return NodeMoveScale.tempPoint;
    }

    public reset2lastAdjustPos() {
        let t = this
        if (t._lastAdjustPosY) {
            t.setAndAdjustPos(t._lastAdjustPosX, t._lastAdjustPosY)
        }
    }

    private _lastAdjustPosX: number
    private _lastAdjustPosY: number
    private setAndAdjustPos(x: number, y: number, setPos = false) {
        let t = this
        let mapScale = t.nodeScale

        let minX = t.minX + t._offsetPivotX
        let maxX = t.maxX + t._offsetPivotX
        minX *= mapScale
        maxX *= mapScale
        minX += t.stageWidth

        if (x < minX) {
            x = minX
        } else if (x > maxX) {
            x = maxX
        }

        let minY = t.minY + t._offsetPivotY
        let maxY = t.maxY + t._offsetPivotY
        minY *= mapScale
        maxY *= mapScale
        minY += t.stageHeight

        if (y < minY) {
            y = minY
        } else if (y > maxY) {
            y = maxY
        }

        t._oldScale = mapScale

        t.nodeX = x
        t.nodeY = y

        if (setPos) {
            t.setPos(x, y)
        }
    }

    private adjustPosAfterScale(oldScale: number, scaleMidX: number, scaleMidY: number) {
        let t = this
        let mapX = t.getMapXByStageX(scaleMidX, oldScale)
        let mapY = t.getMapYByStageY(scaleMidY, oldScale)
        t.setToMapPos(mapX, mapY, scaleMidX, scaleMidY)
    }

    /**计算两个触摸点之间的距离*/
    private distance(a: any, b: any): number {
        let x = b.x - a.x
        let y = b.y - a.y
        /**曼哈顿距离 */
        // let distance: number = x + y;
        /**欧氏距离 */
        let distance: number = Math.sqrt(x * x + y * y);
        return distance;
    }

    /**校验缩放 */
    private updateCheckMapScale() {
        let t = this
        if (t.isScale) {
            return
        }
        let nodeScale = t.nodeScale
        //进行缩放，无视最大最小
        let toScale = t._scaleAni
        if (toScale) {
            if (nodeScale < toScale) {
                nodeScale += 0.015
            } else {
                nodeScale -= 0.015
            }
            t.nodeScale = nodeScale
            return;
        }

        let minScale = t.minScale
        if (nodeScale < minScale) {
            nodeScale += 0.003
            if (nodeScale > minScale) {
                nodeScale = minScale
            }
        } else {
            let maxScale = t.maxScale
            if (nodeScale > maxScale) {
                nodeScale -= 0.02
                if (nodeScale < maxScale) {
                    nodeScale = maxScale
                }
            }
        }
        t.nodeScale = nodeScale
    }

    private setPos(x: number, y: number) {
        let t = this
        let com = this._owner
        if (com != null) {
            com.setPosition(x, y)
        }
    }

    private getX(): number {
        let com = this._owner
        if (com != null) {
            return com.x
        }
    }

    private getY(): number {
        let com = this._owner
        if (com != null) {
            return com.y
        }
    }

    private setScale(scale: number) {
        let com = this._owner
        if (com != null) {
            com.setScale(scale, scale)
        }
    }

    private getScale(): number {
        let com = this._owner
        if (com != null) {
            return com.scaleX
        }
    }

    getRealScale() {
        return this.nodeScale
    }

    getRealX() {
        return this.nodeX
    }

    getRealY() {
        return this.nodeY
    }



    updateStageSize(stageWidth: number, stageHeight: number) {
        let t = this
        t.stageWidth = stageWidth
        t.stageHeight = stageHeight
        t._isChange = true
    }

}