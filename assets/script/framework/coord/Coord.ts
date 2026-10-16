import { view } from 'cc';

/**
* Coord 
*/
export class Coord {
    static __cname: string = "Coord";
    //fgui根节点（FGUI 已剔除，原 fgui.GRoot.inst 替换为返回 null，业务用 framework/ui 自建 UIRoot）
    static get fguiRoot(): any { return null; }
    /**
     * 游戏窗口尺寸
     * 注意，这是设备尺寸，不是逻辑尺寸
     */
    static get winSize() { return view.getVisibleSize() }

    private static _logicSize: cc.Size
    /**
     * 游戏窗口逻辑尺寸
     * 计算了镜头缩放
     */
    static get logicSize() {
        if (this._logicSize == null) {
            this._logicSize = this.winSize.clone()
        }
        return this._logicSize
    }


    private static _uiSize: cc.Size
    /**
     * ui窗口尺寸
     */
    static get uiSize() {
        if (this._uiSize == null) {
            let designSize = cc.view.getDesignResolutionSize()
            let winSize = view.getVisibleSize()
            //维持宽度，高度随设备缩放
            let scaleX = winSize.width / designSize.width
            let scaleY = winSize.height / designSize.height

            //根据高度缩放决定宽度
            let mapWidth = scaleY * designSize.width
            let mapHeight = winSize.height
            this._uiSize = new cc.Size(mapWidth, mapHeight)
        }
        return this._uiSize
    }

    private static _cameraRate: number = 1
    /**
     * 镜头缩放
     */
    static get cameraRate() { return this._cameraRate }
    static set cameraRate(value: number) {
        this._cameraRate = value
        let logicSize = this.logicSize
        let w = this.winSize
        logicSize.width = w.width * value
        logicSize.height = w.height * value
    }

    private static _uiCamera: cc.Camera
    //UI摄像机
    static get uiCamera() {
        let camera = this._uiCamera
        if (camera == null) {
            for (let c of cc.Camera.cameras) {
                if (c.name == "UI Camera")
                    camera = c
            }
            this._uiCamera = camera
        }
        return camera
    }

    //主摄像机
    static get mainCamera() { return cc.Camera.main }


    private static _uitoworld: cc.Vec2 = new cc.Vec2()
    static UIToWorld(point: cc.Vec2, out: cc.Vec2) {
        //相反
        let temp = this._uitoworld

        temp.y = this.winSize.height - point.y
        temp.x = point.x

        //直接当屏幕坐标
        this.mainCamera.getScreenToWorldPoint(temp, out)
        return out
    }

    static WorldToUI(point: cc.Vec2, out: cc.Vec2) {
        //世界坐标转屏幕坐标
        this.mainCamera.getWorldToScreenPoint(point, out)
        //相反
        out.y = this.winSize.height - out.y
        return out
    }
}