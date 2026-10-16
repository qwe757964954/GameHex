import { CacheMgrGen } from "../generated/netProto/CacheMgrGen";

/**
 * 缓存读取的业务入口（对齐老客户端 `client/assets/script/app/net/CacheMgr.ts`）。
 *
 * 与老客户端的唯一差别是装配方式：老客户端在 `App.initFWFunc()` 里走 DI 容器
 * （`FW.CacheMgr = Container.inst().get("CacheMgr")`），Demo3.8 没有容器 →
 * 由 `GameNet.doPrepare()` 显式把一个实例交给 `FW.CacheMgr`，**保证收包写缓存
 * 和业务读缓存用的是同一个实例**（两个实例会各自持一份 GameCache，读永远为空）。
 *
 * 类型化取值方法（`getCmdItem(resId)` / `getTlCmdItem()` 等 78 张表）都在 `CacheMgrGen` 里，
 * 由 `tmp/gen_cachemgr.py` 从 `config/protoCache.json` 生成。
 */
export class CacheMgr extends CacheMgrGen {
    static __cname: string = "CacheMgr";

    static instance: CacheMgr = new CacheMgr();

    /** 返回不包括 0 数量物品的新数组 */
    getTlCmdItemNew(): CmdItem[] {
        let tlCmdItem = this.getValues("CmdItem");
        let tlData: CmdItem[] = [];
        for (const cmdItem of tlCmdItem) {
            if (cmdItem.number > 0) {
                tlData.push(cmdItem);
            }
        }
        return tlData;
    }
}
