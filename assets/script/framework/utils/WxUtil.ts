import { FW } from "../FW";

/**
* WxUtil 
*/
export class WxUtil {
    static __cname: string = "WxUtil";
    static get wx() { return window["wx"] as WechatMiniprogram.Wx }

    /**微信-IOS高性能模式 */
    static get isIOSHighPerformanceMode() {
        return window["GameGlobal"]?.isIOSHighPerformanceMode || false
    }

    /**微信-正式服 */
    static isRelease() {
        let result = false
        result = window["__wxConfig"]?.envVersion == "release"
        return result
    }
    /**微信-体验服 */
    static isTrial() {
        let result = false
        result = window["__wxConfig"]?.envVersion == "trial"
        return result
    }
    /**微信-开发服 */
    static isDevelop() {
        let result = false
        result = window["__wxConfig"]?.envVersion == "develop"
        return result
    }

    // 如果用户之前已经同意过隐私授权，会立即返回success回调，不会触发 wx.onNeedPrivacyAuthorization 事件。
    private static _isPrivacy: boolean = false
    /**检查隐私协议 */
    static CheckPrivacySetting(callback: Function) {

        if (this._isPrivacy == false) {
            let deffer = () => {
                this._isPrivacy = true
                callback()
            }
            let wx = this.wx
            if (!wx.getPrivacySetting) {
                deffer()
                return
            }
            wx.getPrivacySetting({// 查询隐私授权情况
                success: (res) => {
                    console.log(res)
                    // 返回结果为: res = { needAuthorization: true/false, privacyContractName: '《xxx隐私保护指引》' }
                    if (res) {
                        if (res.needAuthorization) {
                            // 声明了隐私收集，且用户还没同意过则返回true,如果用户之前同意过、但后来小程序又新增了隐私收集类型也会返回true
                            if (wx.requirePrivacyAuthorize) {
                                wx.requirePrivacyAuthorize({// 模拟隐私接口调用，并触发隐私弹窗逻辑
                                    success: () => {
                                        deffer()
                                    },
                                    // fail: () => { },
                                    // complete: () => { }
                                })
                            }
                        } else {
                            console.log("没声明(后台-设置-服务内容声明-用户隐私保护指引), 或 声明了，且用户之前同意过隐私协议")
                            if (res.privacyContractName === undefined) {
                                console.log("没有协议名字")
                            } else {
                                deffer()
                            }
                        }
                    }
                },
                // fail: () => { },
                // complete: () => { }
            })
        } else {
            callback()
        }
    }

    /** 微信复制脚本 */
    static Copy(str: string) {
        let wx = WxUtil.wx
        this.CheckPrivacySetting(() => {
            wx.setClipboardData({
                "data": str, "success": () => {
                    FW.showTip(FW.G_W("Func_1"))
                }, "fail": (errMsg) => {
                    FW.LWX.log("错误原因：" + errMsg)
                    FW.showTip("复制失败")
                }
            })
        })
    }

    static getUserInfo(cb, withCredentials = false) {
        let wx = window["wx"];
        if (wx && wx.getUserInfo && wx.getSetting) {
            WxUtil.getSetting((setRet) => {
                let hasAuth = setRet == 1
                if (!hasAuth) {
                    return
                }
                wx.getUserInfo({
                    complete: undefined,
                    success: function (res) {
                        console.log("wxAuthRes getUserInfo:", withCredentials)
                        console.log(res)
                        if (cb) cb(res.userInfo);
                    },
                    fail: function () {
                        console.log("fail wx.getUserInfo")
                    },
                    withCredentials: withCredentials
                })

            })
        }
    }

    static async createUserInfoButton(btnUrl: string, width: number, height: number, x: number, y: number, callback: Function, caller = null) {
        let wx = window["wx"];
        let result = false;
        await new Promise((resolve, reject) => {
            wx.getSetting({
                success(res) {
                    if (res.authSetting['scope.userInfo']) {
                        console.log("用户已授权")
                        result = true;
                        resolve(true);
                    } else {
                        console.log("用户未授权")
                        reject()
                    }
                }
            })
        })
        if (result) {
            return;
        }
        if (wx?.createUserInfoButton == null) {
            console.warn("微信版本没有用户信息")
            return
        }

        if (btnUrl) {
            if (btnUrl.indexOf(".png") < 0) {
                btnUrl = btnUrl + ".png"
            }
        }
        console.log("用户信息btnUrl:", btnUrl)
        console.log("wx.createUserInfoButton 用户信息:", x, y, width, height)
        let button = wx.createUserInfoButton({
            type: 'image',
            image: btnUrl,// 按钮的背景图片，仅当 type 为 image 时有效
            style: {
                left: x,
                top: y,
                width: width,
                height: height,
                lineHeight: 40,
                backgroundColor: '#ff0000',
                color: '#ffffff',
                textAlign: 'center',
                fontSize: 16,
                borderRadius: 4
            },
            withCredentials: false,
        });

        const listener = function (res) {
            console.log("createUserInfoButton onTap:");
            console.log(res);
            let userData = res;
            if (callback) {
                if (caller) {
                    callback.call(caller, userData)
                } else {
                    callback(userData)
                }
            }

            destroyCallback();
        }
        button.onTap(listener)

        const destroyCallback = function () {
            if (button) {
                button.offTap(listener)
                button.destroy()
                button = null
            }
        }
        return { button: button, destroy: destroyCallback, x: x, y: y }
    }


    /**创建游戏圈按钮 */
    static createGameClubButton(btnUrl: string, width: number, height: number, x: number, y: number, callback = null, caller = null, openlink?: string, hasRedDot?: boolean) {
        // if (!EngineMain.isMiniGameWeiXin) {
        //     return
        // }
        let wx = window["wx"];
        if (wx?.createGameClubButton == null) {
            console.warn("微信版本没有游戏圈")
            return
        }

        if (btnUrl) {
            if (btnUrl.indexOf(".png") < 0) {
                btnUrl = btnUrl + ".png"
            }
        }

        if (hasRedDot == null) {
            hasRedDot = true
        }

        // let appScale = 1;

        // x *= appScale;
        // y *= appScale;

        // width *= appScale
        // height *= appScale

        console.warn("游戏圈hasRedDot:", hasRedDot)
        console.log("游戏圈openlink:", openlink)
        console.log("游戏圈btnUrl:", btnUrl)
        console.log("wx.createGameClubButton 游戏圈xy:", x, y, width, height)
        let button = wx.createGameClubButton({
            type: 'image',
            image: btnUrl,// 按钮的背景图片，仅当 type 为 image 时有效
            // icon: 'green',// 游戏圈按钮的图标，仅当 object.type 参数为 image 时有效。
            style: {
                // left: Laya.Browser.clientWidth * 0.5 - width * 0.5,
                // top: Laya.Browser.clientHeight * 0.5 - height * 0.5,
                left: x,
                top: y,
                width: width,
                height: height,
            },
            hasRedDot: hasRedDot,
            openlink: openlink// 默认为true
        });

        const listener = function (res) {
            console.log("createGameClubButton onTap:");
            console.log(res);
            let userData = res;
            if (callback) {
                if (caller) {
                    callback.call(caller, userData)
                } else {
                    callback(userData)
                }
            }
        }
        button.onTap(listener)
        const hide = function () {
            if (button) {
                button.hide()
            }
        }
        const show = function () {
            if (button) {
                button.show()
            }
        }
        const destroyCallback = function () {
            if (button) {
                button.offTap(listener)
                button.destroy()
                button = null
            }
        }
        return { button: button, destroy: destroyCallback, hide: hide, show: show, x: x, y: y }
    }


    static getSetting(callback: (ret: number) => void) {
        let wx = window["wx"];
        if (wx?.getSetting == null) {
            console.warn("微信版本没有getSetting")
            return
        }
        console.log("wx.getSetting 授权查询")
        wx.getSetting({
            complete: undefined,
            success: function (setInfo) {
                console.log(setInfo)
                let authSetting = setInfo.authSetting
                if (authSetting['scope.userInfo'] === true) {
                    console.log("wx.getSetting 已经授权")
                    callback(1)
                } else if (authSetting['scope.userInfo'] === false) {
                    // 用户已拒绝授权，再调用相关 API 或者 wx.authorize 会失败，需要引导用户到设置页面打开授权开关
                    console.log("wx.getSetting 用户已拒绝授权")
                    callback(-1)
                } else {
                    // 未询问过用户授权，调用相关 API 或者 wx.authorize 会弹窗询问用户
                    // that.getAuthor();
                    console.log("wx.getSetting 未询问过用户授权")
                    callback(0)
                }
            },
            fail: function () {
                console.log("fail wx.getSetting f")
                callback(null)
            },
        });
    }

    /**创建微信授权按钮 */
    static createUserInfoButton__(btnUrl: string, width: number, height: number, x: number, y: number, callback = null, caller = null, withCredentials: boolean = false) {
        let wx = window["wx"];
        if (wx?.createUserInfoButton == null) {
            console.warn("微信版本没有手动授权")
            if (callback) {
                if (caller) {
                    callback.call(caller)
                } else {
                    callback()
                }
            }
            return
        }

        let appScale = 1;

        x *= appScale;
        y *= appScale;

        width *= appScale
        height *= appScale

        console.log("wx.getSetting 按钮主动授权")
        let button = wx.createUserInfoButton({
            // type: 'text',
            type: 'image',
            image: btnUrl,// 按钮的背景图片，仅当 type 为 image 时有效
            text: '',// 按钮上的文本，仅当 type 为 text 时有效
            style: {
                // left: Laya.Browser.clientWidth * 0.5 - width * 0.5,
                // top: Laya.Browser.clientHeight * 0.5 - height * 0.5,
                left: x,
                top: y,
                width: width,
                height: height,
                lineHeight: height,
                // backgroundColor: '#04BE02',
                color: '#ffffff',
                textAlign: 'center',
                fontSize: 16,
                borderRadius: 4
            },
            withCredentials: withCredentials
        });
        button.onTap(function (res) {
            // button.destroy();
            console.log("createUserInfoButton res:");
            console.log(res);
            let userData = null;
            // errMsg: "getUserInfo:ok"
            if (res && res.userInfo && (!res.errMsg || !(res.errMsg.indexOf('auth deny') > -1 || res.errMsg.indexOf('auth denied') > -1 || res.errMsg.indexOf('auth cancel') > -1))) {
                // RoleModel.getInstance().setWXUserInfo(res.userInfo)
                // WxSdkBase._instance.playerName = res.userInfo.nickName
                // var nickName = userInfo.nickName
                userData = res
                // var nickName = userInfo.nickName
                // var avatarUrl = userInfo.avatarUrl
                // var gender = userInfo.gender //性别 0：未知、1：男、2：女
                // var province = userInfo.province
                // var city = userInfo.city
                // var country = userInfo.country
                console.log("wx授权成功")
                console.log(res.userInfo)
            } else {
                console.log("wx拒绝授权")
            }
            // userData.userInfo
            if (callback) {
                if (caller) {
                    callback.call(caller, userData)
                } else {
                    callback(userData)
                }
            }
        })

        return button
    }

}