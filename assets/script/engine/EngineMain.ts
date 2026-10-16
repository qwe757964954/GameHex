
import { view, _decorator, assetManager, macro } from 'cc';
import * as env from 'cc/env';

export type saveType = boolean | string | number;


export class EngineMain {
    static readonly __cname: string = "EngineMain";

    // static readonly instance = new EngineMain();
    static instance: EngineMain;

    static readonly engineName: string = "CocosCreator"
    static readonly engineVersion: string = '3.8.8';

    /**平台标志,如:pc: Windows */
    static readonly os: string = "";

    /**pc电脑平台 */
    static readonly isPC: boolean = (env as any).WINDOWS === true;

    /**手机平台 */
    static readonly isMobile: boolean = (env as any).ANDROID || (env as any).IOS;

    /**ios系统 */
    static readonly isIOS: boolean = (env as any).IOS === true;
    /**android系统 */
    static readonly isAndroid: boolean = (env as any).ANDROID === true;
    /**linux系统 */
    static readonly isLinux: boolean = (env as any).LINUX === true;
    /**windos系统 */
    static readonly isWindows: boolean = (env as any).WINDOWS === true;
    /**是否是app版本 */
    static readonly isNative: boolean = !((env as any).EDITOR || (env as any).HTML5);
    /**浏览器 */
    static readonly isBrowser: boolean = !!((env as any).HTML5);

    static readonly isMiniGameWeiXin: boolean = !!(env as any).WECHAT;

    static readonly isMiniGameVivo: boolean = !!(env as any).VIVO

    static readonly isMiniGameOppo: boolean = !!(env as any).OPPO

    static readonly isMiniGameXiaoMi: boolean = !!(env as any).XIAOMI

    static readonly isMiniGameDouyin: boolean = !!(env as any).BYTEDANCE

    static readonly isMiniGame: boolean = EngineMain.isMiniGameVivo || EngineMain.isMiniGameOppo || EngineMain.isMiniGameXiaoMi || EngineMain.isMiniGameWeiXin || EngineMain.isMiniGameDouyin

    /**微信-IOS高性能模式 */
    static isIOSHighPerformanceMode: boolean = false;

    static isFullPhone: boolean = false;

    static liuhaiHeight: number = 0;

    static indicatorHeight: number = 0;

    static sDeviceInfo: string = ""

    static fpsFrameRate: number = 60;
    static fpsFrameRateMax: number = 60;
    static fpsFrameRateMin: number = 39;// 因为ios微信 >= 40 就是60

    static isWebHttps: boolean = false;
    static webUrl?: string;// 网页版链接,其它平台没有这个参数
    static webUrlParam?: string;// 网页版链接参数
    static tmUrlParam?: any;

    static wxScreenWidth: number;
    static wxScreenHeight: number;
    static wxWindowWidth: number;
    static wxWindowHeight: number;

    static wxInfoPlatform: string;


    static xToWeiXin(x: number) {
        let wxX = x / view.getVisibleSize().width * EngineMain.wxScreenWidth;
        return wxX
    }
    static yToWeiXin(y: number) {
        let wxY = y / view.getVisibleSize().height * EngineMain.wxScreenHeight;
        return wxY
    }

    /**是否需要刘海适配 */
    static isNeedLiuHaiAdjust() {
        // if (EngineMain.isMiniGameWeiXin) {
        //     return true
        // }
        if (EngineMain.isFullPhone) {
            // if (EngineMain.isFullPhone && EngineMain.isMobile) {
            return true
        }
        return false
    }

    init() {
        let eng = EngineMain;
        // let t = this;

        let safeAreaRect = ({x:0,y:0,width:0,height:0} as any)
        console.log("getSafeAreaRect")
        console.log(safeAreaRect)

        if (EngineMain.isMiniGame) {

            let maxFps = 50
            let minFps = 39
            EngineMain.fpsFrameRateMax = maxFps
            EngineMain.fpsFrameRateMin = minFps

            if (EngineMain.isMiniGameWeiXin || EngineMain.isMiniGameDouyin) {
                let wx = window["wx"] || window["tt"];
                if (EngineMain.isIOS) {
                    maxFps = 39
                    minFps = 30
                    let gGame = window["GameGlobal"];
                    if (gGame?.isIOSHighPerformanceMode) {
                        EngineMain.isIOSHighPerformanceMode = true
                        maxFps = 50
                        minFps = 39
                    }
                    EngineMain.fpsFrameRateMax = maxFps
                    EngineMain.fpsFrameRateMin = minFps

                    // 在 iOS 上，当微信客户端在一定时间间隔内（目前是 5 秒）连续收到两次及以上系统内存告警时，会主动进行小程序的销毁
                    // if (EngineMain.isIOS) {
                    // if (wx && wx.onMemoryWarning) {
                    //     wx.onMemoryWarning(function () {
                    //         console.log('Memory Warning')
                    //         EngineMain.triggerGC()
                    //     })
                    // }
                    // }
                }

                if (wx) {
                    try {
                        const winInfo = wx.getSystemInfoSync()
                        console.log("getSystemInfoSync")
                        console.log(winInfo)

                        EngineMain.wxInfoPlatform = winInfo.platform;
                        EngineMain.wxScreenWidth = winInfo.screenWidth;
                        EngineMain.wxScreenHeight = winInfo.screenHeight;
                        EngineMain.wxWindowWidth = winInfo.windowWidth;
                        EngineMain.wxWindowHeight = winInfo.windowHeight;

                    } catch (e) {
                        // Do something when catch error
                        let winSizeWidth = view.getVisibleSize().width
                        let winSizeHeight = view.getVisibleSize().height

                        EngineMain.wxScreenWidth = winSizeWidth;
                        EngineMain.wxScreenHeight = winSizeWidth;
                        EngineMain.wxWindowWidth = winSizeHeight;
                        EngineMain.wxWindowHeight = winSizeHeight;
                    }
                }

            }
        }

        EngineMain.fpsFrameRate = EngineMain.getDefFPS()

        console.log("")
        console.log("微信平台默认开启,: ", macro.CLEANUP_IMAGE_CACHE);
        console.log("engine name: ", eng.engineName);
        console.log("engine version: ", eng.engineVersion);
        console.log("os: ", eng.os);
        console.log("isPC: ", eng.isPC);
        console.log("isMobile: ", eng.isMobile);
        console.log("isIOS: ", eng.isIOS);
        console.log("isAndroid: ", eng.isAndroid);
        console.log("isLinux: ", eng.isLinux);
        console.log("isNative: ", eng.isNative);
        console.log("isBrowser: ", eng.isBrowser);
        // console.log("CC_WECHATGAME: ", CC_WECHATGAME);
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)

        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)
        // removed: cc.sys X (CC 3.x removes platform constant)

        let tlInfo: string[] = [eng.engineVersion, eng.os, "unknown"]
        if (eng.isPC) { tlInfo.push("isPC") }
        if (eng.isMobile) { tlInfo.push("isMobile") }
        if (eng.isIOS) { tlInfo.push("isIOS") }
        if (eng.isAndroid) { tlInfo.push("isAndroid") }
        if (eng.isLinux) { tlInfo.push("isLinux") }
        if (eng.isNative) { tlInfo.push("isNative") }
        if (eng.isBrowser) { tlInfo.push("isBrowser") }
        if (eng.isMiniGameWeiXin) { tlInfo.push("wx-mng") }

        if (!!(env as any).WECHAT) { tlInfo.push("wc-g") }
        if (!!(env as any).WECHAT_GAME_SUB) { tlInfo.push("wc-gs") }

        if (macro.CLEANUP_IMAGE_CACHE) { tlInfo.push("CIC") }

        let sDeviceInfo = tlInfo.join("_")
        EngineMain.sDeviceInfo = sDeviceInfo

        EngineMain.getFPSFrameRate()

        console.log(sDeviceInfo)
        console.log("")

    }

    static webHttpUrlFix(url: string) {
        return url
        if (url) {
            if (EngineMain.isBrowser) {
                if (EngineMain.isWebHttps) {
                    if (url.indexOf("https") < 0 && url.indexOf("http") >= 0) {
                        url = url.replace("http", "https")
                    }
                } else {
                    if (url.indexOf("https") >= 0) {
                        url = url.replace("https", "http")
                    }
                }
            }
        }
        return url
    }

    static saveLocalStorage(key: string, value: saveType) {
        if (!key) {
            console.error("saveLocalStorage key null")
            return
        }
        globalThis.localStorage.setItem(key, value);
    }

    static readLocalStorage(key: string, defaultValue?: saveType) {
        if (!key) {
            console.error("readLocalStorage key null")
            return
        }

        let value = globalThis.localStorage.getItem(key)
        if (value == null || value === "") {
            if (defaultValue == null && key == "account_num") {
                defaultValue = "account_num"
                console.warn("还没有账号信息")
            }
            return defaultValue;
        }
        return value;
    }

    /**
     * 清空数据
        当我们不再需要已存储的用户数据时，可以通过下面的接口将其清空：
     * @param key 
     */
    static removeLocalStorage(key: string) {
        if (!key) {
            console.error("removeLocalStorage key null")
            return
        }
        let v = globalThis.localStorage.getItem(key)
        if (v != null) {
            globalThis.localStorage.removeItem(key)
        }
    }

    static clearLocalStorage() {
        if (EngineMain.isMiniGameWeiXin) {
            try {
                let wx = window["wx"];
                if (wx.clearStorageSync) {
                    wx.clearStorageSync()
                }
            } catch (e) {
                console.error(e)
            }
        } else if (EngineMain.isMiniGameDouyin) {
            try {
                let wx = window["tt"] || window["wx"];
                if (wx.clearStorageSync) {
                    wx.clearStorageSync()
                }
            } catch (e) {
                console.error(e)
            }
        }
        globalThis.localStorage.clear()
    }

    static onClearCache: Function
    static clearCache() {
        try {
            if (this.onClearCache) {
                this.onClearCache()
            }
            if (!!((env as any).HTML5) == false) {
                cc.assetManager.cacheManager?.clearCache()
            }
        } catch (e) {
            console.error(e)
        }
    }

    // 默认fps
    private static getDefFPS() {
        // if (EngineMain.isIOS && EngineMain.isMiniGameWeiXin) {
        //     if (EngineMain.isIOSHighPerformanceMode) {
        //         return EngineMain.fpsFrameRateMax
        //     }
        //     return EngineMain.fpsFrameRateMin
        // }
        return EngineMain.fpsFrameRateMax
    }

    private static tmFps: { [key in number]: number; };
    private static isFpsOK(fpsFrameRate: number) {
        if (!fpsFrameRate) { return false }
        let tmFps = EngineMain.tmFps
        if (!tmFps) {
            tmFps = {}
            let tlFps = [25, 30, 35, 39, 40, 45, 50, 60, EngineMain.fpsFrameRateMin, EngineMain.fpsFrameRateMax];
            for (let i = 0, len = tlFps.length; i < len; i++) {
                let f = tlFps[i];
                if (tmFps[f] == null) {
                    tmFps[f] = f;
                }
            }
            EngineMain.tmFps = tmFps
        }
        return tmFps[fpsFrameRate] != null;
    }

    private static fixFps(fpsFrameRate: number) {
        if (!EngineMain.isFpsOK(fpsFrameRate)) {
            fpsFrameRate = EngineMain.getDefFPS()
        }
        return fpsFrameRate
    }

    private static fpsFrameRateKey = "fpsFrameRate3";
    static getFPSFrameRate() {
        let fpsFrameRate = EngineMain.readLocalStorage(EngineMain.fpsFrameRateKey)
        if (!fpsFrameRate || isNaN(fpsFrameRate)) {
            fpsFrameRate = EngineMain.getDefFPS()
        } else {
            fpsFrameRate = Number(fpsFrameRate)
        }
        if (!EngineMain.isFpsOK(fpsFrameRate)) {
            fpsFrameRate = EngineMain.getDefFPS()
            EngineMain.setFPSFrameRate(fpsFrameRate)
        }
        EngineMain.fpsFrameRate = fpsFrameRate;
        return fpsFrameRate
    }

    static setFPSFrameRate(fpsFrameRate: number) {
        fpsFrameRate = EngineMain.fixFps(fpsFrameRate)

        EngineMain.fpsFrameRate = fpsFrameRate
        EngineMain.saveLocalStorage(EngineMain.fpsFrameRateKey, fpsFrameRate)
        return fpsFrameRate
    }

    // public static async newGImage(url: string, resolve?: Function): Promise<fgui.GImage> {
    //     let t = this
    //     let image = new fgui.GImage();
    //     image.blendMode = 0
    //     let spf: cc.SpriteFrame = await ResourceMgr.load(url, (spf: cc.SpriteFrame) => {
    //     }, t, cc.SpriteFrame)
    //     let _originalSize = spf.getOriginalSize()
    //     image.sourceWidth = _originalSize.width;
    //     image.sourceHeight = _originalSize.height;
    //     image.initWidth = image.sourceWidth;
    //     image.initHeight = image.sourceHeight;
    //     image._content.spriteFrame = spf;
    //     image.setSize(_originalSize.width, _originalSize.height)
    //     image.blendMode = 0
    //     if (resolve) {
    //         resolve(image)
    //     }
    //     return image
    // }

    // public static async newGImageFrameAtlas(spriteFrameName: string, url: string, resolve?: Function): Promise<fgui.GImage> {
    //     let t = this
    //     let image = new fgui.GImage()
    //     image.blendMode = 0
    //     let spatlas: cc.SpriteAtlas = await ResourceMgr.load(url, () => { }, t, cc.SpriteAtlas)
    //     if (spatlas) {
    //         let extname = cc.path.extname(spriteFrameName);
    //         if (extname) {
    //             spriteFrameName = spriteFrameName.replace(extname, "");
    //         }
    //         let spf: cc.SpriteFrame = spatlas.getSpriteFrame(spriteFrameName)
    //         image._content.spriteFrame = spf;
    //         let _originalSize = spf.getOriginalSize()
    //         image.sourceWidth = _originalSize.width;
    //         image.sourceHeight = _originalSize.height;
    //         image.initWidth = image.sourceWidth;
    //         image.initHeight = image.sourceHeight;
    //         image._content.spriteFrame = spf;
    //         image.setSize(_originalSize.width, _originalSize.height)
    //         image.blendMode = 0
    //         if (resolve) {
    //             resolve(image)
    //         }
    //     }
    //     return image
    // }

    public static newGImageByTexture2D(texture2D: any, rect: any) {
        // FGUI 已剔除：构建 SpriteFrame 并直接返回，业务层用 cc.Sprite 渲染
        let spf = new cc.SpriteFrame();
        spf.setTexture(texture2D, new cc.Rect(rect.x, rect.y, rect.w, rect.h));
        return spf;
    }

    public static getTotalFrames() {
        return (cc.game as any).frameCount;
    }

    static triggerGC() {
        if (!EngineMain.isMiniGameWeiXin) {
            return
        }
        let wx = window["wx"];
        if (wx && wx.triggerGC) {
            console.log('Memory triggerGC')
            wx.triggerGC();
        }
    }

}