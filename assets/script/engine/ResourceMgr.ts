// import { FW } from "../framework/FW"
import { FW } from "../framework/FW"
import { EngineMain } from "./EngineMain"

export class ResourceMgr {

    static tmUIIconPath: { [key in string]: string } = {}
    static maxLoadResNum: number = 15
    static tlLoadingRes: Array<string> = new Array()
    // private static tl_add_str_temp = []
    static handlePath(path: string): string {
        if (path == null || path === "") {
            FW.Log.log("handlePath null:", path)
            return null
        }

        // let mainFileName = cc.path.mainFileName(path);
        // let basename = cc.path.basename(path);
        // let dirname = cc.path.dirname(path);

        // 不同平台,有些资源要替换
        /*
        let tmFileName: any;
        if (EngineMain.isMiniGameWeiXin) {
            tmFileName = {
            }

            let testPath = path
            let extname = cc.path.extname(testPath);
            if (extname) {
                testPath = cc.path.mainFileName(testPath);
            } else {
                extname = ""
            }
            let tishenPath = testPath + "_tishen" + extname
            if (ResourceMgr.isHasFile(tishenPath)) {
                path = tishenPath
            }
        } else if (EngineMain.isNative) {
            tmFileName = {
            }
        }
        if (tmFileName) {
            let to_fn = tmFileName[path] || tmFileName[cc.path.basename(path)]
            if (to_fn) {
                path = to_fn
            }
        }
        */

        let tmPath = ResourceMgr.tmUIIconPath;

        let sub_path = tmPath[path]
        // if (sub_path == null) {
        //     if (cc.path.extname(path)) {
        //         let path_basename = cc.path.basename(path);
        //         if (path_basename && path_basename != path && tmPath[path_basename] != null) {
        //             path = path_basename
        //             sub_path = tmPath[path_basename]
        //         }
        //     }
        // }

        let extname = cc.path.extname(path);
        if (extname) {
            // path = path.replace(extname, "");
            path = cc.path.mainFileName(path);
        }

        if (sub_path) {
            path = cc.path.join(sub_path, path);
            /*
            let tl_str = ResourceMgr.tl_add_str_temp
            tl_str.push(sub_path, path)
            path = tl_str.join("/")
            tl_str.length = 0;
            */
        }

        return path
    }

    static isHasFile(fileName: string) {
        fileName = cc.path.basename(fileName);
        let sub_path = ResourceMgr.tmUIIconPath[fileName];
        return sub_path != null;
    }

    static getImgLucencyPath(): string {
        return "img_lucency.png";// 小游戏这张图会放本地
        // return ResourceMgr.handlePath("img_lucency.png")
    }

    static async initConfig() {
        if (EngineMain.isMiniGameWeiXin) {
            if (EngineMain.isIOS) {
                ResourceMgr.maxLoadResNum = 10
            }
        }

        let uiIconConfig: { [key in string]: string; };
        let fileName = "uiIconConfig.json";
        let maxRetry = 5  // 最大重试次数,防止死循环
        while (maxRetry > 0) {
            uiIconConfig = await ResourceMgr.loadJson(fileName);
            if (uiIconConfig) {
                break
            } else {
                maxRetry--
                FW.Log.error(fileName, "initUIIconConfig error, retry left:", maxRetry)
                if (maxRetry <= 0) {
                    break
                }
                let promise = new Promise<void>((resolve) => {
                    cc.director.getScheduler().schedule(() => {
                        resolve()
                    }, this, 0.5, 0, 0.5, false)
                })
                await promise;
            }
        }
        if (uiIconConfig) {
            let tmPath = ResourceMgr.tmUIIconPath;
            for (let sub_path in uiIconConfig) {
                let tl_fn = uiIconConfig[sub_path]
                for (let fn of tl_fn) {
                    tmPath[fn] = sub_path;
                }
            }
        }
    }

    public static async injectTTFFont(url: string, fontName: string) {
        return new Promise((resolve, reject) => {
            let path = ResourceMgr.handlePath(url);
            cc.resources.load(path, (err, asset) => {
                if (err) {
                    FW.Log.error("injectTTFFont error:", url, fontName, err)
                    reject(err)
                    return
                } else {
                    // FGUI 已剔除，registerFont 改走 CC Label.font 的全局字体路径（占位）
                    // 业务真要换字体时用 cc.Label 的 font 配置或 bmfont / TTFFont 资产
                    // fgui.registerFont(fontName, asset)
                    console.log("injectTTFFont success:", asset)
                    resolve(asset)
                }
            });
        })

    }

    public static async loadJson(path: string): Promise<any> {
        path = ResourceMgr.handlePath(path);
        let jsonAsset = cc.resources.get<cc.JsonAsset>(path)
        if (!jsonAsset) {
            let t = this
            let task = window["fw_task"]
            if (task) {
                jsonAsset = await t.loadTask(path)
            } else {
                jsonAsset = await t.loadAsset(path)
            }
        }
        if (jsonAsset) {
            return jsonAsset.json
        }
        return null;
    }

    public static async load(path: string, fCallback?: Function, caller?: object, assetType?: any): Promise<any> {
        path = ResourceMgr.handlePath(path);
        let asset = cc.resources.get(path, assetType);
        if (asset) {
            if (fCallback) { if (caller) { fCallback.call(caller, asset) } else { fCallback(asset) } }
            return asset
        }
        let t = this
        let task = window["fw_task"]
        if (task) {
            asset = await t.loadTask(path, t.maxLoadResNum, assetType)
        } else {
            asset = await t.loadAsset(path, assetType)
        }
        if (asset) {
            if (fCallback) { if (caller) { fCallback.call(caller, asset) } else { fCallback(asset) } }
            return asset
        }
        return null;
    }
    public static async load2(path: string, fCallback?: (...arg) => Promise<any>, caller?: object, assetType?: any): Promise<any> {
        path = ResourceMgr.handlePath(path);
        let asset = cc.resources.get(path, assetType);
        if (asset) {
            if (fCallback) {
                if (caller) {
                    await fCallback.call(caller, asset)
                } else {
                    await fCallback(asset)
                }
            }
            return asset
        }
        let t = this
        let task = window["fw_task"]
        if (task) {
            asset = await t.loadTask(path, t.maxLoadResNum, assetType)
        } else {
            asset = await t.loadAsset(path, assetType)
        }
        if (asset) {
            if (fCallback) {
                if (caller) {
                    await fCallback.call(caller, asset)
                } else {
                    await fCallback(asset)
                }
            }
            return asset
        }
        return null;
    }

    public static async loadGloaderUrl(url: string, fCallback?: Function, caller?: object, assetType?: any): Promise<any> {
        let useUrl = url
        //cc.resources.get 路径不包含resources://
        if (url.startsWith("resources://")) {
            useUrl = url.replace("resources://", "")
        }
        let asset = cc.resources.get(useUrl, assetType);
        if (asset) {
            if (fCallback) { if (caller) { fCallback.call(caller, asset) } else { fCallback(asset) } }
            return asset
        }
        let t = this
        let task = window["fw_task"]
        if (task) {
            asset = await t.loadTask(url, 1, assetType)
        } else {
            asset = await t.loadAsset(url, assetType)
        }
        if (asset) {
            if (fCallback) { if (caller) { fCallback.call(caller, asset) } else { fCallback(asset) } }
            return asset
        }
        return null;
    }

    private static _lastMusic: string = ""
    public static async openMusic(path: string, loop: boolean = true) {
        path = ResourceMgr.handlePath(path);
        let asset = cc.resources.get(path, cc.AudioClip);
        if (asset) {
            cc.audioEngine.playMusic(asset, loop)
            return asset
        }
        let t = this
        t._lastMusic = path
        let task = window["fw_task"]
        if (task) {
            asset = await t.loadTask(path, 1, cc.AudioClip)
        } else {
            asset = await t.loadAsset(path, cc.AudioClip)
        }
        if (asset) {
            if (t._lastMusic == path) {
                cc.audioEngine.playMusic(asset, loop)
            }
            return asset
        }
        return null;
    }

    public static async openSound(path: string, loop: boolean = false) {
        path = ResourceMgr.handlePath(path);
        let asset = cc.resources.get(path, cc.AudioClip);
        if (asset) {
            cc.audioEngine.playEffect(asset, loop)
            return asset
        }
        let t = this
        let task = window["fw_task"]
        if (task) {
            asset = await t.loadTask(path, t.maxLoadResNum, cc.AudioClip)
        } else {
            asset = await t.loadAsset(path, cc.AudioClip)
        }
        if (asset) {
            cc.audioEngine.playEffect(asset, loop)
            return asset
        }
        return null;
    }

    private static async loadTask(path: string, maxLoadResNum?: number, assetType?: any) {
        let t = this
        let asset = null
        let task = window["fw_task"]
        let tlLoadingRes = t.tlLoadingRes
        if (!maxLoadResNum) {
            maxLoadResNum = t.maxLoadResNum
        }
        if (tlLoadingRes.length >= maxLoadResNum) {
            await task.waitUntil(() => {
                return tlLoadingRes.length < maxLoadResNum
            })
        }
        if (tlLoadingRes.indexOf(path) != -1) {
            await task.waitUntil(() => {
                asset = cc.resources.get(path, assetType)
                if (!asset) {
                    if (tlLoadingRes.indexOf(path) == -1) {
                        return true
                    }
                    return false
                }
                return true
            })
        } else {
            asset = cc.resources.get(path, assetType)
            if (!asset) {
                tlLoadingRes.push(path)
                let logData = null
                let winModel = window["ModelCollectTimeConsumingLog"]
                if (winModel) {
                    let logType = "res"
                    if (path.indexOf("ref") != -1) {
                        logType = "ref"
                    }
                    logData = {
                        timeStamp: Date.now(),
                        logType: logType,
                        info: path
                    }
                }
                asset = await new Promise((resolve, reject) => {
                    console.log(path)
                    cc.resources.load(path, assetType, function (err, asset_) {
                        if (!err) {
                            resolve(asset_);
                        } else {
                            resolve(null);
                        }
                    });
                });
                let index = tlLoadingRes.indexOf(path)
                tlLoadingRes.splice(index, 1)
                if (winModel) {
                    let now = Date.now()
                    let timeConsuming = now - logData.timeStamp
                    logData.timeConsuming = timeConsuming
                    winModel.collectLog(logData, true)
                }
            }
        }
        return asset
    }

    private static async loadAsset(path: string, assetType?: any) {
        let asset = null
        let logData = null
        let winModel = window["ModelCollectTimeConsumingLog"]
        if (winModel) {
            logData = {
                timeStamp: Date.now(),
                logType: "res",
                info: path
            }
        }
        asset = await new Promise((resolve, reject) => {
            cc.resources.load(path, assetType, function (err, asset_) {
                if (!err) {
                    resolve(asset_);
                } else {
                    resolve(null);
                }
            });
        });
        if (winModel) {
            let now = Date.now()
            let timeConsuming = now - logData.timeStamp
            logData.timeConsuming = timeConsuming
            winModel.collectLog(logData, true)
        }
        return asset
    }

    public static release(path_: string, type?: typeof cc.Asset) {
        let path = ResourceMgr.handlePath(path_)
        if (type) {
            cc.resources.release(path, type)
        } else {
            cc.resources.release(path)
        }

        FW.Log.log("=======--------删除资源:", path_)
    }



    public static async unload() {

    }
}