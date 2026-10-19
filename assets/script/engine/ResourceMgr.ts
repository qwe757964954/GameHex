import { resources, JsonAsset } from "cc";
import { FW } from "../framework/FW"

/**
 * resources 目录的薄加载封装。
 *
 * 只保留三条活路径：`load`（按类型取资源）、`loadJson`（取 JsonAsset 内容）、
 * `handlePath`（剥扩展名，resources 路径不带后缀）。
 *
 * 老 2.x 端照抄过来的分支已全部删除：
 * · `cc.audioEngine.playMusic/playEffect` —— 3.8 已删除该模块，音频统一走
 *   `framework/audio/AudioMgr`（AudioSource）；
 * · `initConfig`（uiIconConfig 子路径映射 + scheduler 重试）、`injectTTFFont`
 *   （fgui.registerFont）、`load2`、`loadGloaderUrl`、`release`、`unload`、
 *   `isHasFile`、`getImgLucencyPath` —— 均无调用方。
 */
export class ResourceMgr {

    static maxLoadResNum: number = 15
    static tlLoadingRes: Array<string> = new Array()

    /**
     * resources 路径不带扩展名：剥掉最后一段目录名之后的 `.ext`。
     * 点号出现在目录段内（如 `a.b/c`）时不动。
     */
    static handlePath(rawPath: string): string {
        if (rawPath == null || rawPath === "") {
            FW.Log.log("handlePath null:", rawPath)
            return null
        }

        const slash = rawPath.lastIndexOf("/")
        const dot = rawPath.lastIndexOf(".")
        if (dot > slash) {
            return rawPath.slice(0, dot)
        }
        return rawPath
    }

    public static async loadJson(path: string): Promise<any> {
        path = ResourceMgr.handlePath(path);
        let jsonAsset = resources.get<JsonAsset>(path)
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
        let asset = resources.get(path, assetType);
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
                asset = resources.get(path, assetType)
                if (!asset) {
                    if (tlLoadingRes.indexOf(path) == -1) {
                        return true
                    }
                    return false
                }
                return true
            })
        } else {
            asset = resources.get(path, assetType)
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
                    resources.load(path, assetType, function (err, asset_) {
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
            resources.load(path, assetType, function (err, asset_) {
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
}
