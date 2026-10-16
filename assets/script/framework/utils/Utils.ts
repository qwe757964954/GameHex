import { view } from 'cc';
import { EngineMain } from "../../engine/EngineMain";
import { Vec2 } from "../../engine/Vec2";

export class Utils {
    public static __cname: string = "Utils";
    static parseXMLFromString(value) {
        var rst;
        value = value.replace(/>\s+</g, '><');
        rst = (new DOMParser()).parseFromString(value, 'text/xml');
        if (rst.firstChild.textContent.indexOf("This page contains the following errors") > -1) {
            if (value && value.indexOf("&") >= 0) {
                value = value.replace(/\&/g, '&amp;');
                rst = (new DOMParser()).parseFromString(value, 'text/xml');
                if (rst.firstChild.textContent.indexOf("This page contains the following errors") > -1) {
                    console.error(value);
                    rst = null;
                }
            } else {
                console.error(value);
                rst = null;
            }
        }
        return rst;
    }

    private static _gfx:any
    /**
     * 动态网格创建需要提前拿到gfx
     * 参考地址:https://docs.cocos.com/creator/2.4/manual/zh/3d/mesh.html
     */
    static GetGFX(){
        //微信下没有cc.renderEngine
        //看源码cocos初始化之后会有一个 cc.gfx的变量
        let result = this._gfx
        result = result || cc['gfx']
        result = result || cc.renderer.renderEngine.gfx
        return result
    }

    public static log(...data: any)
    {
		console.log(Date.now(), ...data)
    }

    public static trace(...data: any[])
	{
		let stack = new Error((data).join(" ")).stack
		console.log(stack)
	}

    public static error(...data: any[])
	{
		let stack = new Error((data).join(" ")).stack
		console.error(stack)
	}

    public static GetStackName(level: number)
    {
        let stack = new Error("empty").stack
        let arr = stack.split("\n")
        let name = arr[level + 2]
        if (!name)
        {
            name = ""
        }
        // else
        // {
        //     let arr = name.split("\\/")
        //     return arr[arr.length - 1]
        // }
        return name
    }


    private static _seed: number = 0;
    public static SetRandom(seed: number):void {
        this._seed = Math.abs(seed)
        //console.log("SetRandom:", seed)
    }



    public static random(): number {
        let seed = this._seed
        seed = (1664525 * seed + 1013904223) % 2147483648;
        if (seed < 0)
        {
            debugger
        }
        this._seed = seed
        
        return seed / 2147483648;
    };
    /**
     * 
     * @param min 
     * @param max 
     * @returns [min, max]
     */
    public static randomRange(min: number, max: number): number {
        return Math.floor(this.random() * (max - min + 1)) + min;
    };

    public static calcDirection(rad)
    {
        let degree = (rad * 180)/ Math.PI// % 180//  - 90
        let scaleX = degree <= 90 && degree >= -90 ?  -1 : 1
        return scaleX
    }

    /**
     * 纯随机
     */
    public static randomRangeMath(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    };
    private static CalcScaleX()
    {
        let scaleW = 1
        let designSize = cc.view.getDesignResolutionSize() // 设计窗口大小 720x1280
        let winsize = view.getVisibleSize()
        let liuhaiHeight = EngineMain.liuhaiHeight;
        let realWinSize = new cc.Size(winsize.width, winsize.height - liuhaiHeight) // 去除刘海影响的实际尺寸
        
        scaleW = realWinSize.width / designSize.width
        let newHeight = scaleW * designSize.height
        if (newHeight > realWinSize.height) {
            scaleW = realWinSize.height/designSize.height
        }
        return scaleW
    }

    /**
     * 计算 战场根节点的 x y 和 缩放. 
     * 设计坐标系为720x1280, 等比放大到尽可能大, 放大根节点, 这样战斗中所有实体点所有都是1280x720的坐标和计算
     * @returns 缩放, x 和 y
     */
    public static CalcScale()
    {
        let x = Utils.CalcScaleX()
        return new cc.Vec2(x, x)
    }


    /**
     * 计算 战场根节点的 x y 和 缩放. 
     * 设计坐标系为720x1280, 等比放大到尽可能大, 放大根节点, 这样战斗中所有实体点所有都是1280x720的坐标和计算
     * @returns 缩放, x 和 y
     */
    public static CalcGroundInfo()
    {
        let scaleX = 1
        let designSize = cc.view.getDesignResolutionSize() // 设计窗口大小 720x1280
        let winSize = view.getVisibleSize()
        let liuhaiHeight = EngineMain.liuhaiHeight;
        let realWinSize = new cc.Size(winSize.width, winSize.height - liuhaiHeight) // 去除刘海影响的实际尺寸
        
        scaleX = realWinSize.width / designSize.width
        let newHeight = scaleX * designSize.height
        if (newHeight > realWinSize.height) {
            scaleX = realWinSize.height/designSize.height
        }

        let scaleY = scaleX // 等比缩放
        let x = (winSize.width - designSize.width * scaleX)/2// x居中
        let y = 0 // y最下面

        return new cc.Vec4(x, y, scaleX, scaleY)

    }


    public static FixFullScreen(obj: fgui.GObject | cc.Node)
    {
        let w = view.getVisibleSize().width
        let h = view.getVisibleSize().height
        let scale: number = 1
        // base width
        if (h >= w * 1280 / 720)
        {
            scale = w/obj.width
            obj.scaleX = scale
            obj.scaleY = scale
        }
        else
        {
            // base height
            scale = h/obj.height
            obj.scaleX = scale
            obj.scaleY = scale
        }

    }

}