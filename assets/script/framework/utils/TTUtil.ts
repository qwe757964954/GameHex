/**
* TTUtil 
*/
export class TTUtil {
    static __cname: string = "TTUtil";

    private static getEnvInfoSync() {
        let tt = window["tt"];
        if (!tt.getEnvInfoSync) {
            return {
                microapp: {
                    envType: "production"
                }
            }
        }
        return tt.getEnvInfoSync() as {
            microapp: {
                envType: "production" | "development" | "preview"
            }
        }
    }

    /**头条-正式服 */
    static isRelease() {
        return this.getEnvInfoSync()?.microapp?.envType == "production"
    }
    /**头条-体验服 */
    static isTrial() {
        return this.getEnvInfoSync()?.microapp?.envType == "development"
    }
    /**头条-开发服 */
    static isDevelop() {
        return this.getEnvInfoSync()?.microapp?.envType == "preview"
    }

    static getUserInfo(cb: Function) {
        let tt = window["tt"];
        console.log("获取用户信息")
        if (tt && tt.getUserInfo) {
            console.log("获取用户信息1")
            // 获取用户信息
            tt.getUserInfo({
                // withCredentials: true,
                // withRealNameAuthenticationInfo: true,
                success(res) {
                    console.log(`getUserInfo 调用成功`, JSON.stringify(res.userInfo));
                    if (cb) cb(res.userInfo);
                },
                fail(res) {
                    console.log(`getUserInfo 调用失败`, JSON.stringify(res.errMsg));
                },
            });
        }
    }
}