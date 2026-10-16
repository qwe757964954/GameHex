
export class StringUtil {
    public static __cname: string = "StringUtil";

    private static _staticStringPool: Map<number, string> = new Map<number, string>()
    public static GetHurtTypeName(type: number)
    {
        let pool = StringUtil._staticStringPool
        let name = pool.get(type)
        if (name) return name
        name = type.toString()
        pool.set(type, name)
        return name

    }

    /** 是否只包含0-9 */
    static isPositiveInteger(str: string): boolean {
        return /^[0-9]\d*$/.test(str);
    }

    static formatNumberToZH(num: number): string {
        if (num < 1e4) {
            return Math.floor(num).toString();
        }
        if (num < 1e8) {
            return (Math.floor(num / 1e3) / 10).toString() + "万";
        }
        return (Math.floor(num / 1e7) / 10).toString() + "亿";
    }

    static formatNumberToKMBT(num: number): string {
        if (num < 1e4) {
            return Math.floor(num).toString();
        }

        const units = [
            { value: 1e12, symbol: 'T' },
            { value: 1e9, symbol: 'B' },
            { value: 1e6, symbol: 'M' },
            { value: 1e3, symbol: 'K' }
        ];

        for (const unit of units) {
            if (num >= unit.value) {
                const divided = num / unit.value;
                return Math.floor(divided) + unit.symbol;
            }
        }

        return Math.floor(num).toString();
    }
    /**
     *
     * @param str 类似 "{0}年{1}月{2}日"
     * @param args 类似 "2018","2","14"
     */
    static format(str, ...args: any[]): string {
        let reg = /{(\d+)}/gm;
        return str.replace(reg, function (match, name) {
            return args[~~name];
        });
    }

    // 截取一定长度字符串,多于的以...代替 (不包含))
    static cutString(str: string, count: number) {
        let length = str.length
        if (length > count) {
            str = str.substr(0, count)
            str = str + "..."
        }
        return str
    }

    //截取字符串 包含中文处理
    //(串,长度,增加...)
    static cutString2(str: string, len: number, hasDot: boolean = true) {
        var newLength = 0;
        var newStr = "";
        var chineseRegex = /[^\x00-\xff]/g;
        var singleChar = "";
        var strLength = str.replace(chineseRegex, "**").length;
        for (var i = 0; i < strLength; i++) {
            singleChar = str.charAt(i).toString();
            if (singleChar.match(chineseRegex) != null) {
                newLength += 2;
            }
            else {
                newLength++;
            }
            if (newLength > len) {
                break;
            }
            newStr += singleChar;
        }

        if (hasDot && strLength > len) {
            newStr += "...";
        }
        return newStr;
    }

    //字符是否有中文
    static isCharHaveZH(str: string) {
        let chineseRegex = /[^\x00-\xff]/g;
        return str.match(chineseRegex)
    }
    //一个中文算两个长度
    static getCharLength(str: string) {
        let chineseRegex = /[^\x00-\xff]/g;
        let length = str.replace(chineseRegex, "**").length
        // console.log(length)
        return length
    }

    //一个中文算三个长度
    static getCharLength2(str: string) {
        let chineseRegex = /[^\x00-\xff]/g;
        let length = str.replace(chineseRegex, "***").length
        // console.log(length)
        return length
    }

    /**
     *
     * @param str 类似 "%s年%s月%s日"
     * @param args 类似 "2018","2","14"
     */
    static formatS(str: string, tlStr: string[]) {
        if (str == null || str == "" || tlStr == null) {
            return str
        }

        let tlStr_ = str.split("%s")
        let length = tlStr_.length

        let tlStr_new = []

        for (let i = 0; i < length; i++) {
            tlStr_new.push(tlStr_[i])
            if (tlStr[i] != null && i < length - 1) {
                tlStr_new.push(tlStr[i])
            }
        }

        return tlStr_new.join("")

    }


    static numberFormat(num: number, retain: number): string {
        return num.toString().match(/^\d+(?:\.\d{0,1})?/).toString();
        //return num.toString().match(format).toString();
    }

    static numbebrToFloatStr(num: number, count: number = null): string {
        let numStr = num.toString()
        if (count != null) {
            let index = numStr.indexOf(".")
            if (index != -1) {
                if (count == 0) {
                    count = -1
                }
                numStr = numStr.substr(0, index + 1 + count)
            }
        }
        return numStr
    }

    static handleSpecialStr(str: string): string {
        // str = str.replace(/\</g, "&lt;")
        // str = str.replace(/\>/g, "&gt;")
        // str = str.replace(/\[/g, "\\[")
        // str = str.replace(/\&/g, "&amp;")
        return str
    }

    //pc过滤 手机emoji
    static forbidEmoji(str: string): string {
        if (str && str != "") {
            let regRule = /[^~`!@#$%^&*()_+-=\[\]{},.<>;:?\|'"\/\\\s\w\u4E00-\u9FA5《》？、。，：；“”‘’——……%￥！·【】]/g
            if (str.match(regRule)) {
                str = str.replace(regRule, "*")
            }
        }
        return str
    }

    /**
     * 过滤数组字 例如：forbidNumber（110000，100000，10000）=》 11万 （数字大于10万过滤）
     * @param num  数字
     * @param limitNumb 限制都少
     * @param convertNumber 转换值 （目前支持万，千） 默认 万
     */
    static forbidNumber(num: number, limitNum: number = 10000, convertNumber: number = 1000): string {
        if (num >= limitNum) {
            let limitStr: string
            if (convertNumber == 10000) {
                limitStr = "W"
            } else if (convertNumber == 1000) {
                limitStr = "K"
            } else {
                convertNumber = 10000
                limitStr = "W"
            }
            if (num >= convertNumber) {
                let n = Math.floor(num / convertNumber)
                return n.toString() + limitStr
            }
        }
        return num.toString()
    }

    /**不够位数,在前面填充0 */
    static paddingNum(num: number, length: number): string {
        let len = (num + "").length;
        let diff = length - len;
        if (diff > 0) {
            return Array(diff + 1).join("0") + num;
        }
        return num.toString();
    }

    static getNumValue(num_: string | number): number {
        if (typeof (num_) == 'string') {
            return parseInt(num_)
        }
        return num_;
    }

    /**自动换行 */
    static autoNewLine(str: string, length: number): string {
        let stringArray = []
        for (let i = 0; i < 10; i++) {
            let len = str.length
            if (len > length) {
                let _str = str.substr(0, length)
                str = str.replace(_str, "")
                stringArray.push(_str)
            }
            else {
                let _str = str.substr(0, len)
                str = str.replace(_str, "")
                stringArray.push(_str)
                break
            }
        }
        let len = str.length
        if (len > 0) {
            stringArray.push(str)
        }
        return stringArray.join("\n")
    }

    /**数字转大写字符 0 ~ 9*/
    static numberToBigNumberStr(num: number): string {
        let bigString: string = "";
        let tlTag: string[] = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        bigString = tlTag[num];
        return bigString;
    }

    static numAbbr(num: number): string {
        const trillion = 1e10; // 1兆 = 1万亿
        const billion = 1e7;   // 1亿
        const tenThousand = 1e4; // 1万

        if (Math.abs(num) >= trillion) {
            return Math.floor((num / 1e9)) + 'G';
        } else if (Math.abs(num) >= billion) {
            return Math.floor((num / 1e6)) + 'M';
        } else if (Math.abs(num) >= tenThousand) {
            return Math.floor((num / 1e3)) + 'k';
        } else {
            return Math.floor(num).toString();
        }
    }
}
