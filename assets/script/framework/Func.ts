import { view } from 'cc';
import { FW } from "./FW";
import { Utils } from "./utils/Utils";
import { WxUtil } from "./utils/WxUtil";

export class Func {
    public static __cname: string = "Func"

    static utf8_decode(utfText) {
        let string = ""
        let i = 0
        let c = 0
        let c1 = 0
        let c2 = 0
        let c3 = 0
        while (i < utfText.length) {
            c = utfText.charCodeAt(i)
            if (c < 128) {
                string += String.fromCharCode(c)
                i++
            } else if (c > 191 && c < 224) {
                c2 = utfText.charCodeAt(i + 1)
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63))
                i += 2
            } else {
                c2 = utfText.charCodeAt(i + 1)
                c3 = utfText.charCodeAt(i + 2)
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63))
                i += 3
            }
        }
        return string
    }

    static decodebase64(input) {
        let output = ""
        let chr1, chr2, chr3
        let enc1, enc2, enc3, enc4
        let i = 0
        input = input.replace(/[^A-Za-z0-9+/=]/g, "")
        while (i < input.length) {
            enc1 = input.indexOf(input.charAt(i++))
            enc2 = input.indexOf(input.charAt(i++))
            enc3 = input.indexOf(input.charAt(i++))
            enc4 = input.indexOf(input.charAt(i++))
            chr1 = (enc1 << 2) | (enc2 >> 4)
            chr2 = ((enc2 & 15) << 4) | (enc3 >> 2)
            chr3 = ((enc3 & 3) << 6) | enc4
            output = output + String.fromCharCode(chr1)
            if (enc3 != 64) {
                output = output + String.fromCharCode(chr2)
            }
            if (enc4 != 64) {
                output = output + String.fromCharCode(chr3)
            }
        }
        output = Func.utf8_decode(output)
        return output
    }

    /**网页版加载脚本,也可以是远程的 */
    static loadScript(moduleName: string, cb: () => void) {
        function scriptLoaded() {
            document.body.removeChild(domScript)
            domScript.removeEventListener("load", scriptLoaded, false)
            cb && cb()
        }
        var domScript = document.createElement("script")
        domScript.async = true
        domScript.src = moduleName
        domScript.addEventListener("load", scriptLoaded, false)
        document.body.appendChild(domScript)
    }
    /**
     * 版本号格式检查
     * @param version (如: 0.0.0.1)
     * @param minCount 用点分隔的最少有几个
     */
    static checkFormatVersion(version: string, minCount: number, flag?: string) {
        if (version && version != "") {
            if (flag == null) { flag = "." }
            const tlVersion = version.split(flag);
            const len = tlVersion.length;
            if (len >= minCount) {
                for (let i = 0; i < len; i++) {
                    let vNum = Func.toNum(tlVersion[i])
                    if (vNum !== 0 && !vNum) {
                        return false
                    }
                }
                return true
            }
        }
        return false
    }

    // 当返回值大于 0 时，versionA > versionB
    // 当返回值等于 0 时，versionA = versionB
    // 当返回值小于 0 时，versionA < versionB
    static compareVersion(version1: string, version2: string, flag?: string) {
        if (version1 == null) { version1 = "" }
        if (version2 == null) { version2 = "" }
        if (flag == null) { flag = "." }
        try {
            const v1 = version1.split(flag);
            const v2 = version2.split(flag);
            let len = v1.length;
            if (v2.length > len) {
                len = v2.length
            }
            for (let i = 0; i < len; i++) {
                const num1 = +v1[i] || 0;
                const num2 = +v2[i] || 0;
                if (num1 !== num2) {
                    return num1 - num2;
                }
            }
        } catch (e) {
            return 0
        }
        return 0;
    }

    /**
     * 获取url中的参数
     * let webUrlHref = window?.location?.href;// 返回完整的 URL
     * let webUrlSearch = window?.location?.search;// 是从当前URL的?号开始的字符串
     * 例子: "https://www.xxx.com?name=elephant&age=25&sex=male&num=100"
     * @param url 链接
     * @returns 返回参数
     */
    public static getUrlParams(url: string) {
        let result = {}
        if (url) {
            let wenhaoIdx = url.indexOf("?")
            if (wenhaoIdx > 0) {
                url = url.substring(wenhaoIdx)
            }
        }
        let strParams: string
        if (url && url.startsWith("?")) {
            strParams = url.substring(1)
        } else {
            strParams = url
        }
        if (strParams && strParams != "") {
            let arrParams = strParams.split("&")
            if (arrParams && arrParams.length > 0) {
                arrParams.forEach((item) => {
                    let tlItem = item.split("=")
                    let temKey = tlItem[0]
                    if (temKey && temKey != "") {
                        let v = tlItem[1]
                        if (v != null) {
                            result[temKey] = decodeURIComponent(v)
                        }
                    }
                })
            }
        }
        return result
    }

    public static generateUUID() {
        let d = Date.now()
        if (window.performance && typeof window.performance.now === "function") {
            d += performance.now()
        }
        let winSize = view.getVisibleSize()
        let x = winSize.width
        let y = winSize.height
        let factory = !((env as any).EDITOR || (env as any).HTML5) ? 16 : 32
        d += x * y * factory
        let uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            let r = (d + Math.random() * 16) % 16 | 0
            d = Math.floor(d / 16)
            return (c == "x" ? r : (r & 0x3) | 0x8).toString(16)
        })
        return uuid
    }

    static getSizeByByte(byte: number) {
        let a = byte / 1024
        if (a > 1) {
            let b = byte / 1048576
            if (b > 1) {
                return b.toFixed(2) + "M"
            } else {
                return a.toFixed(2) + "KB"
            }
        } else {
            return byte + "B"
        }
    }

    static getSizeByteToKB(byte: number) {
        let a = byte / 1024
        if (a < 0.01) {
            a = 0.01
        }
        return a.toFixed(2) + "KB"
    }

    static getSizeByteToM(byte: number) {
        let a = byte / 1048576
        if (a < 0.01) {
            return a.toFixed(3) + "M"
        } else {
            return a.toFixed(2) + "M"
        }
    }

    /**
     * 获取文件后缀名
     * @param {String} filename
     */
    static getExt(filename: string) {
        if (typeof filename == "string") {
            return filename.split(".").pop().toLowerCase()
        } else {
            throw new Error("filename must be a string type")
        }
    }

    /**
     * 休眠xxxms
     * @param {Number} milliseconds
     */
    static sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    /**
     * 生成随机id
     * @param {*} length
     * @param {*} chars
     */
    static uuid(length: number, chars: string) {
        chars = chars || "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
        length = length || 8
        var result = ""
        for (var i = length; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)]
        return result
    }

    /**
     *深拷贝,只拷贝对象、数组以及对象数组
     * @export
     * @param {*} obj
     * @returns
     */
    static deepCopy(obj: any) {
        if (typeof obj != "object") {
            return obj
        }
        if (obj == null) {
            return obj
        }
        return JSON.parse(JSON.stringify(obj))
    }

    /**如果是字符串的json数据,自动转为json格式 */
    static getJsonDataByStr(jsonStr: string) {
        let jsonData: any = jsonStr
        if (jsonStr != null) {
            if (jsonStr == "") {
                jsonData = {}
            } else {
                let sType = typeof jsonStr
                if (sType == "string") {
                    let isJson = false
                    if (
                        (jsonStr.startsWith("{") && jsonStr.endsWith("}")) ||
                        (jsonStr.startsWith("[") && jsonStr.endsWith("]"))
                    ) {
                        isJson = true
                    } else if (
                        (jsonStr.indexOf("{") >= 0 && jsonStr.indexOf("}") > 0) ||
                        (jsonStr.indexOf("[") >= 0 && jsonStr.indexOf("]") > 0)
                    ) {
                        jsonStr = jsonStr.trim()
                        isJson = true
                    }
                    if (isJson) {
                        try {
                            jsonData = JSON.parse(jsonStr)
                        } catch (e) {
                            console.error(e)
                        }
                    }
                    // } else if (sType == "object") {
                    //     jsonData = jsonStr
                }
            }
        }
        return jsonData
    }

    /**
     * 数组去重,利用Set中不能出现重复元素的特性
     * @param {*} arr
     */
    static uniqueArray(arr) {
        if (!Array.isArray(arr)) {
            throw new Error("The first parameter must be an array")
        }
        if (arr.length == 1) {
            return arr
        }
        // release 构建会把 `[...new Set(arr)]` 降级成 `[].concat(new Set(arr))`，
        // concat 不展开 Set → 去重静默失效。必须走 `Array.from`。
        return Array.from(new Set(arr))
    }

    /**
     * 保留小数点以后几位，默认2位,小数的位数，是 0 ~ 20 之间的值
     */
    static cutNumber(number: number, no = 2) {
        if (typeof number != "number") {
            number = Number(number)
        }
        return Number(number.toFixed(no))
    }

    /**返回当前时间（年、月、日、时、分、秒） */
    static getDateTime() {
        var date = new Date(),
            year = date.getFullYear(),
            month = date.getMonth() + 1,
            day = date.getDate(),
            hour = date.getHours() + 1,
            minute = date.getMinutes(),
            second = date.getSeconds()
        month = checkTime(month)
        day = checkTime(day)
        hour = checkTime(hour)
        minute = checkTime(minute)
        second = checkTime(second)
        function checkTime(i) {
            if (i < 10) {
                i = "0" + i
            }
            return i
        }
        return (
            "" + year + "year" + month + "month" + day + "day" + hour + "hour" + minute + "minute" + second + "second"
        )
    }

    /**是否是有效的obj */
    static isValidObject(obj: any) {
        if (typeof obj == "object" && (obj["disabled"] || obj["startDestroyed"] || obj["destroyed"])) {
            return false
        }
        return true
    }

    static runFunc(callback: Function, caller?: any, ...args: any) {
        if (callback == null) {
            return
        }
        if (caller != null) {
            if (!Func.isValidObject(caller)) {
                return
            }
            return callback.call(caller, ...args)
        } else {
            return callback(...args)
        }
    }

    static toString(v: any): string {
        if (v === null) {
            v = "null"
        } else if (v === "undefined") {
            v = "undefined"
        } else if (v && v.toString) {
            return v.toString()
        }
        console.log(v)
        return "toString fail"
    }

    static isEmptyObject(obj: any) {
        if (!obj) {
            return true
        }
        for (let n in obj) {
            return false
        }
        return true
    }

    // static tlKeyStr: string[] = []
    static concatStr(...items: string[]) {
        let str = items.join("")
        return str
    }

    /**删除数组某项数据 */
    removeTlValue(_tlValue: any[], value: any, same: boolean = false) {
        if (_tlValue != null) {
            let _value: any
            for (let i = _tlValue.length - 1; i >= 0; i--) {
                _value = _tlValue[i]
                if ((!same && _value == value) || (same && _value === value)) {
                    _tlValue.splice(i, 1)
                    return true
                }
            }
        }
        return false
    }

    static toNum(v: any, def?: number) {
        if (typeof v == "number") {
            return v
        }
        if (v == null || v === "") {
            return def
        }
        if (typeof v == "string") {
            v = v.trim()
        }
        let num = Number(v)
        if (isNaN(num)) {
            return def
        }
        return num
    }

    /**
     * random()返回一个[0,1)的随机数
     * 获取指定区间范围随机数，包括lowerValue和upperValue
     * @param lowerValue
     * @param upperValue
     */
    static random(lowerValue: number, upperValue: number) {
        if (upperValue <= lowerValue) {
            return lowerValue
        }
        return Math.floor(Utils.random() * (upperValue - lowerValue + 1) + lowerValue)
    }

    /**区域内随机坐标 */
    static randomRectPos2(
        x: number,
        y: number,
        w: number,
        h: number,
        offsetX: number = 0,
        offsetY: number = 0
    ): [number, number] {
        let x3 = Func.random(x + offsetX, x + w - offsetX)
        let y3 = Func.random(y + offsetY, y + h - offsetY)
        return [x3, y3]
    }

    /**区域内随机坐标 */
    static randomRectPos(bound: cc.Rect, offsetX: number = 0, offsetY: number = 0) {
        return Func.randomRectPos2(bound.x, bound.y, bound.width, bound.height, offsetX, offsetY)
    }

    private static readonly _defHashKey: string = "0"
    private static _temp_tlHashKey: string[] = []
    /**
     * hashKey(1), hashKey("1"), hashKey({id:1}), hashKey({id:1,level:2}), hashKey(obj:{id:number,level:number})
     * 缓存key
     * @param keyOrval 键或者值:number | string | object
     */
    static hashKey(keyOrval?: any, tlKeyField?: string[]): string {
        if (keyOrval == null || tlKeyField == null) {
            return Func._defHashKey
        }

        let keyLen = tlKeyField.length
        if (keyLen == 0) {
            return Func._defHashKey
        }

        let sType = typeof keyOrval
        let key: string
        if (keyLen == 1) {
            if (sType == "object") {
                key = keyOrval[tlKeyField[0]]
            } else if (sType == "number") {
                key = keyOrval.toString()
            } else {
                key = keyOrval
            }
        } else {
            if (sType != "object") {
                console.error("Func hashKey key not object")
                return null
            }

            let tlKeyStr = Func._temp_tlHashKey
            tlKeyStr.length = 0
            let field: string
            let fieldKey
            for (let i = 0; i < keyLen; i++) {
                field = tlKeyField[i]
                fieldKey = keyOrval[field]
                if (fieldKey == null) {
                    console.error("Func hashKey key n null:" + field)
                    return null
                }
                tlKeyStr.push("__", field, "_", fieldKey)
            }
            key = tlKeyStr.join("")

            tlKeyStr.length = 0
        }
        return key
    }

    /**
     * 向量AC与向量AB的外积(叉积)。
     * 如果结果为正数，表明点C在直线AB（直线方向为从A到B）的右侧;
     * 如果结果为负数，表明点C在直线AB（直线方向为从A到B）的左侧；如果结果为0，表明点C在直线AB上.
     * A 两个向量的公共起点
     * B 第一个向量的终点
     * C 第二个向量的终点
     */
    static mathCross(A: { x: number; y: number }, B: { x: number; y: number }, C: { x: number; y: number }): number {
        let cross1 = (C.x - A.x) * (B.y - A.y)
        let cross2 = (C.y - A.y) * (B.x - A.x)
        return cross1 - cross2
    }

    /**
     * 两个线段组成的矩形区域是否相交(线段为矩形对角线)
     */
    static rectsIntersect(
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
        d: { x: number; y: number }
    ): boolean {
        let min = Math.min
        let max = Math.max
        if (
            min(a.x, b.x) <= max(c.x, d.x) &&
            max(a.x, b.x) >= min(c.x, d.x) &&
            min(a.y, b.y) <= max(c.y, d.y) &&
            max(a.y, b.y) >= min(c.y, d.y)
        ) {
            return true
        }
        return false
    }
    /**
     * 两线段是否相交
     * 线段ab和线段cd
     */
    static segmentsIntersect(
        a: { x: number; y: number },
        b: { x: number; y: number },
        c: { x: number; y: number },
        d: { x: number; y: number }
    ): boolean {
        let t = Func
        if (t.rectsIntersect(a, b, c, d)) {
            let u = t.mathCross(a, b, c)
            let v = t.mathCross(a, b, d)
            let w = t.mathCross(c, d, a)
            let z = t.mathCross(c, d, b)
            return u * v <= 0.00000001 && w * z <= 0.00000001
        }
        return false
    }

    /**四个值同为正或者同为负，则点P在ABCD内部，否则在外部 */
    static isPointInRect(
        A: { x: number; y: number },
        B: { x: number; y: number },
        C: { x: number; y: number },
        D: { x: number; y: number },
        P: { x: number; y: number }
    ) {
        let t = Func
        let a = t.mathCross(A, B, P)
        let b = t.mathCross(B, C, P)
        let c = t.mathCross(C, D, P)
        let d = t.mathCross(D, A, P)
        if ((a > 0 && b > 0 && c > 0 && d > 0) || (a < 0 && b < 0 && c < 0 && d < 0)) {
            return true
        }
        return false
    }

    /**判断(x,y)是否在矩形内部 */
    static isPointInRect2(x1: number, y1: number, x2: number, y2: number, px: number, py: number) {
        return x1 <= px && px < x2 && y1 <= py && py < y2
    }

    /**2个四边形是否相交 */
    static isRectIntersect(
        x01: number,
        y01: number,
        x02: number,
        y02: number,
        x11: number,
        y11: number,
        x12: number,
        y12: number
    ) {
        let zx = Math.abs(x01 + x02 - x11 - x12)
        let x = Math.abs(x01 - x02) + Math.abs(x11 - x12)
        let zy = Math.abs(y01 + y02 - y11 - y12)
        let y = Math.abs(y01 - y02) + Math.abs(y11 - y12)
        if (zx <= x && zy <= y) return true
        else return false
    }

    /**圆形矩形相交 */
    static isCircRectIntersectOld(cx, cy, r, x, y, w, h) {
        let x1 = x
        let y1 = y
        let x2 = x + w
        let y2 = y + h
        //找出x方向与cx最接近的
        let minx = Math.min(Math.abs(x1 - cx), Math.abs(x2 - cx))
        //找出y方向与cy最接近的
        let miny = Math.min(Math.abs(y1 - cy), Math.abs(y2 - cy))
        if (minx * minx + miny * miny < r * r) return true

        //条件2
        let x0 = (x1 + x2) / 2
        let y0 = (y1 + y2) / 2
        if (Math.abs(x0 - cx) < Math.abs(x2 - x1) / 2 + r && Math.abs(cy - y0) < Math.abs(y2 - y1) / 2) return true
        if (Math.abs(y0 - cy) < Math.abs(y2 - y1) / 2 + r && Math.abs(cx - x0) < Math.abs(x2 - x1) / 2) return true

        return false
    }

    static isCircRectIntersect(
        ncx: number, 
        ncy: number, 
        radius: number,
        sx: number, 
        sy: number, 
        sw: number, 
        sh: number
    ): boolean {
        const minX = sx;
        const maxX = sx + sw;
        const minY = sy;
        const maxY = sy + sh;
        
        const closestX = ncx < minX ? minX : (ncx > maxX ? maxX : ncx);
        const closestY = ncy < minY ? minY : (ncy > maxY ? maxY : ncy);
        
        const dx = ncx - closestX;
        const dy = ncy - closestY;
        return dx * dx + dy * dy <= radius * radius;
    }


    /**
     * 点是否在扇形内
     * @param px 点
     * @param py
     * @param ax 角A
     * @param ay
     * @param bx 点B
     * @param by
     * @param cx 点C
     * @param cy
     */
    static isPointInFan(px, py, ax, ay, bx, by, cx, cy) {
        let ap_x = px - ax
        let ap_y = py - ay
        let ab_x = bx - ax
        let ab_y = by - ay
        let ac_x = cx - ax
        let ac_y = cy - ay
        //0点没有方向
        if (px == ax && py == ay) return true
        //距离
        if (ap_x * ap_x + ap_y * ap_y > ab_x * ab_x + ab_y * ab_y) {
            return false
        }
        //夹角
        let u = 0,
            v = 0
        u = (ap_x * ac_y - ac_x * ap_y) / (ab_x * ac_y - ac_x * ab_y)
        v = (ap_x * ab_y - ab_x * ap_y) / (ac_x * ab_y - ab_x * ac_y)
        return u >= 0 && v >= 0
    }

    /**
     * 判断两个矩形是否相交
        (x1,y1) (x2,y2)为第一个矩形左下和右上角的两个点
        (x3,y3) (x4,y4)为第二个矩形左下角和右上角的两个点
     */
    static isRectCross(x1, y1, x2, y2, x3, y3, x4, y4) {
        if (Math.max(x1, x3) <= Math.min(x2, x4) && Math.max(y1, y3) <= Math.min(y2, y4)) return true
        else return false
    }

    /**
     *  计算两个矩形的交集
         (x1,y1) (x2,y2)为第一个矩形左下和右上角的两个点
         (x3,y3) (x4,y4)为第二个矩形左下角和右上角的两个点
     */
    static crossRectOfTwoRects(x1, y1, x2, y2, x3, y3, x4, y4): [boolean, number?, number?, number?, number?] {
        if (this.isRectCross(x1, y1, x2, y2, x3, y3, x4, y4)) {
            let tx1 = Math.max(x1, x3)
            let ty1 = Math.max(y1, y3)
            let tx2 = Math.min(x2, x4)
            let ty2 = Math.min(y2, y4)
            return [true, tx1, ty1, tx2, ty2]
        } else return [false]
    }

    // 返回2个向量的夹角
    // let angel = Func.getVectorAngel(endX - x, endY - y)
    static getVectorAngel(x1: number, y1: number, x2: number = 1, y2: number = 0) {
        let math = Math
        let pi = math.PI
        let angel: number = math.atan2(y1, x1) - math.atan2(y2, x2)
        if (angel > pi) {
            angel -= 2 * pi
        } else if (angel < -pi) {
            angel += 2 * pi
        }
        angel = (angel * 180) / pi
        return angel
    }

    // emoji
    static replaceEmojiCharacter(text: string) {
        // if (!text || typeof (text) != "string" || Func.isAppEmojiStr(text)) {
        //     return text;
        // }
        //扩展处理特殊字符的bug
        //过滤0300-036F Combining Diacritical Marks
        //过滤0590-1FFF-206f 很多种类型  中文位于\u4E00-\u9FA5
        // var regRule = /[^\w\u0000-\u02FF\u0370-\u058A\u2070-\uFFFD]/g
        // if (text.match(regRule)) {
        //     text = text.replace(regRule, "*");
        // }
        // text = text.replace(/\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]|\uD83D[\ude80-\udeff]/g, "E");
        // text = text.replace(/\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F\ude80-\udeff]|[\u2600-\u2B55]/g, "E");

        // if (Func.isEmojiCharacter(text)) {
        //     text = "^-^";
        // }
        return text
    }

    static fixStrToShowEmojiText(text: string) {
        return text
    }

    static fixStrToShowEmojiText2(text: string) {
        if (!text || typeof text != "string" || Func.isAppEmojiStr(text)) {
            return text
        }
        text = text.replace(/\&/g, "&amp;")
        text = text.replace(/\</g, "&lt;")
        text = text.replace(/\>/g, "&gt;")
        text = text.replace(/\<\=/g, "&le;")
        text = text.replace(/\>\=/g, "&ge;")
        return text
    }

    static fixBackStrToShowEmojiText(text: string) {
        return text
    }

    private static readonly tlIgnoreStr = ["<", ">", "&"]
    static isRichTextNoCanShowStr(text: string) {
        if (!text || typeof text != "string") {
            return false
        }
        if (Func.isAppEmojiStr(text)) {
            return false
        }
        for (let str_ of this.tlIgnoreStr) {
            if (text.indexOf(str_) >= 0) {
                return true
            }
        }
        return false
    }

    static isAppEmojiStr(text: string) {
        if (!text || typeof text != "string") {
            return false
        }

        var pattern = /^E(\d{1,})i$/
        if (pattern.test(text)) {
            return true
        }

        let regRule = /(<img .*?\/>)/g
        let regList = text.match(regRule)
        if (regList && regList.length > 0) {
            return true
        }
        return false
    }

    //去空格包括中文空格
    static trim(text: string): string {
        text = text.trim()
        text = text.replace(/^\u3164+|\u3164+$/g, "")
        text = text.replace(/^\u3000+|\u3000+$/g, "")
        text = text.replace(/^\u008d+|\u008d+$/g, "")
        return text
    }

    //校验身份证号码正确性
    static checkIdentityId(id: string, now_time?: number) {
        if (id == null || id == "") {
            return false
        }
        if (typeof id !== "string") {
            return false
        }
        // if (id.length > 18) {
        //     return false
        // }
        var format =
            /^(([1][1-5])|([2][1-3])|([3][1-7])|([4][1-6])|([5][0-4])|([6][1-5])|([7][1])|([8][1-2]))\d{4}(([1][9]\d{2})|([2]\d{3}))(([0][1-9])|([1][0-2]))(([0][1-9])|([1-2][0-9])|([3][0-1]))\d{3}[0-9xX]$/
        //号码规则校验
        if (!format.test(id)) {
            return false
        }
        //区位码校验
        //出生年月日校验   前正则限制起始年份为1900;
        var sYear = id.substr(6, 4) //身份证年
        var year = Func.toNum(sYear)
        if (year == null) {
            return false
        }
        var sMonth = id.substr(10, 2) //身份证月
        var month = Func.toNum(sMonth) // 0-11
        if (month == null || month > 11) {
            return false
        }
        var sDate = id.substr(12, 2) //身份证日
        var date = Func.toNum(sDate) // 1-31
        if (date == null || date > 31) {
            return false
        }
        var dates = new Date(year, month, 0).getDate() //身份证当月天数
        if (date > dates) {
            return false
        }
        // 毫秒
        if (now_time != null) {
            // if (now_time == null) {
            //     now_time = Date.now()
            // }
            let idTime = new Date(year, month, date).getTime()
            if (idTime > now_time) {
                return false
            }
        }
        //校验码判断
        var c = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] //系数
        var b = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"] //校验码对照表
        var id_array = id.split("")
        var sum = 0
        for (var k = 0; k < 17; k++) {
            sum += parseInt(id_array[k]) * c[k]
        }
        return id_array[17].toUpperCase() === b[sum % 11].toUpperCase()
    }
    /*
     * 判断平年闰年
     * y:年份数字，四位
     * */
    static isOrdinaryYear(y: number) {
        if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) {
            return false
        }
        return true
    }
    /*
     * 判断是否满足n岁
     * time : 毫秒级时间戳，用户选中日期的时间戳
     * */
    static isTimeOK(time: number, checkYear: number, nowTime?: number) {
        if (nowTime == null) {
            nowTime = Date.now()
        }
        var nowDate = new Date(nowTime)
        // 0 ~ 11
        var month = nowDate.getMonth()
        // 1 ~ 31
        var date = nowDate.getDate()
        // 四位数字返回年份
        var year = nowDate.getFullYear() - checkYear
        // 2月要处理
        if (month == 1 && date >= 28) {
            date = Func.isOrdinaryYear(year) ? 28 : 29
        }
        let oldTime = new Date(year, month, date).getTime()
        return time <= oldTime
    }

    static isFindStr(str_: string, tlStr: string[]) {
        if (tlStr == null || tlStr.length <= 0) {
            return false
        }
        for (let i = 0, len = tlStr.length; i < len; i++) {
            if (str_.indexOf(tlStr[i]) >= 0) {
                return true
            }
        }
        return false
    }
    static isTheStr(str_: string, tlStr: string[]) {
        if (tlStr == null || tlStr.length <= 0) {
            return false
        }
        for (let i = 0, len = tlStr.length; i < len; i++) {
            if (str_ == tlStr[i]) {
                return true
            }
        }
        return false
    }

    static isStartswithStr(str_: string, tlStr: string[]) {
        if (tlStr == null || tlStr.length <= 0) {
            return false
        }
        for (let i = 0, len = tlStr.length; i < len; i++) {
            if (str_.indexOf(tlStr[i]) == 0) {
                return true
            }
        }
        return false
    }

    /**打开网页 */
    static openUrl(str: string) {
        let platform = null
        switch (platform) {
            case "WECHAT_GAME":
            case "WECHAT_GAME_SUB":
                //微信不能打开浏览器，使用复制功能
                Func.copy(str)
                break
            default:
                globalThis.open(str)
        }
    }

    /**复制文本 */
    static copy(str: string) {
        try {
            let platform = null
            switch (platform) {
                case "WECHAT_GAME":
                case "WECHAT_GAME_SUB":
                    WxUtil.Copy(str)
                    FW.showTip(FW.G_W("Func_1"))
                    break
                case "ANDROID":
                    FW.LWX.error("安卓平台复制功能还未实现")
                    break
                default:
                    if (
                        document == null ||
                        document.body == null ||
                        document.createElement == null ||
                        document.execCommand == null
                    ) {
                        FW.showTip(FW.G_W("Func_2"))
                        return false
                    }
                    // 'textarea'
                    let input = document.createElement("input")
                    if (input == null || input.select == null) {
                        FW.showTip(FW.G_W("Func_1"))
                        return false
                    }
                    input.value = str
                    document.body.appendChild(input)
                    input.select()
                    input.setSelectionRange(0, input.value.length)
                    document.execCommand("Copy")
                    document.body.removeChild(input)
                    FW.showTip(FW.G_W("Func_1"))
                    break
            }
            return true
        } catch (err) {
            FW.showTip(FW.G_W("Func_2"))
            FW.LWX.error("复制失败：" + err)
        }
    }

    /**保持弧度为正数 */
    static radAbs(rad: number) {
        if (rad < 0) return rad + Math.PI
        else return rad
    }

    /**计算弧度差距，是否顺时针 */
    static radDis(base: number, target: number, isRight: boolean = true) {
        let rad = Func.radAbs(base)
        let rad2 = Func.radAbs(target)
        if (isRight) {
            if (rad2 < rad) return Math.abs(rad2 - rad)
            else return rad + Math.PI * 2 - rad2
        } else {
            if (rad2 > rad) return Math.abs(rad2 - rad)
            else return Math.PI * 2 - rad + rad2
        }
    }

    //#region 坐标变换
    /**
     * 坐标围绕一个点旋转后的坐标
     * @param cx
     * @param cy
     * @param px
     * @param py
     * @param rad
     * @returns
     */
    static PointRotate(cx: number, cy: number, px: number, py: number, rad: number) {
        let vcos = Math.cos(rad)
        let vsin = Math.sin(rad)
        let x1 = (px - cx) * vcos - (py - cy) * vsin + cx
        let y1 = (px - cx) * vsin + (py - cy) * vcos + cy
        return [x1, y1]
    }
    //#endregion

    // 保留多少位小数
    static roundNum(value: number, n: number) {
        const decimals = Math.pow(10, n);
        return Math.round(value * decimals) / decimals;
    }
}