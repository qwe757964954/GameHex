import { EngineMain } from "../../engine/EngineMain";
const IMG_EXT = "(png|jpg|jpeg|gif|bmp|webp)";
const IMG_EXT_LIST = new RegExp(`.*\.${IMG_EXT}`);
export class HttpLoader {
    public static __cname: string = "HttpLoader"

    static randomMin = 100000;
    static randomMax = 999999;

    /**
     * 远程 url 带图片后缀名,不带后缀统一按jpg处理
     * @param url 
     * @returns 
     */
    public static RequestTexture(url: string, options?:Record<string, any>): Promise<cc.Texture2D> {
        let promise = new Promise<cc.Texture2D>((resolve, reject) => {
            //判断后缀
            if(options == null && !IMG_EXT_LIST.test(url)){
                options = {ext: ".jpg"}
            }
            cc.assetManager.loadRemote(url, options, function (err, texture: cc.Texture2D) {
                resolve(texture)
            });
        })
        return promise
    }

    /**
     * 远程 url 不带图片后缀名，此时必须指定远程图片文件的类型
     * @param url 
     * @param ext 
     * @returns 
     */
    public static RequestTextureWith(url: string, ext: '.png' | '.jpb' | '.gif'): Promise<cc.Texture2D> {
        let promise = new Promise<cc.Texture2D>((resolve, reject) => {
            cc.assetManager.loadRemote(url, { ext: ext }, function (err, texture: cc.Texture2D) {
                resolve(texture)
            });
        })
        return promise
    }

    /**
     * 远程音频文件
     * @param url 
     * @returns 
     */
    public static RequestAudioClip<T extends cc.AudioClip>(url: string): Promise<T> {
        let promise = new Promise<T>((resolve, reject) => {
            cc.assetManager.loadRemote(url, function (err, asset: T) {
                resolve(asset)
            });
        })
        return promise
    }

    /**
     * 远程Json文件 cacheManager不兼容web，web采用url拼接随机数
     * @param url 
     * @returns 
     */
    public static RequestJson<T extends cc.JsonAsset>(url: string, clearCache?: boolean): Promise<T> {
        if (clearCache || EngineMain.isBrowser) {
            let randomNum = Math.floor(Math.random() * (HttpLoader.randomMax - HttpLoader.randomMin + 1) + HttpLoader.randomMin);
            url = url + "?v=" + randomNum
            clearCache = false
        }
        let promise = new Promise<T>((resolve, reject) => {
            cc.assetManager.loadRemote(url, function (err, asset: T) {
                if (clearCache && asset) {
                    cc.assetManager.cacheManager.removeCache(asset.nativeUrl)
                }
                resolve(asset)
            });
        })
        return promise
    }

    /**
     * 远程文本文件
     * @param url 
     * @returns 
     */
    public static RequestText<T extends cc.TextAsset>(url: string): Promise<T> {
        let promise = new Promise<T>((resolve, reject) => {
            cc.assetManager.loadRemote(url, function (err, asset: T) {
                resolve(asset)
            });
        })
        return promise
    }
}