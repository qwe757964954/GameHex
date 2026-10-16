/**
 * 红点变量注册中心 —— 老端 `client/.../model/expr/ModelExpr.ts` 的 `Init()` 移植。
 *
 * 老端是一个 60 行的 `Init()` 里连写 58 条 `FW.ExprMgr.RegistVarClass("RDXxx", RDXxx)`；
 * Demo3.8 里改成**由 `RdTypes` 的表驱动**：加一个红点 = 表里加一行，不会漏注册。
 *
 * ## 为什么必须注册全（哪怕玩法还没做）
 * `ExprVarMgr.AddRef()` 拿不到类名时的行为是：
 * ```
 * FW.Log.error("ExprVarMgr 尚未注册该值:" + name)
 * clazz = this.GetVarClass("close")        // 退化成 close
 * new clazz()                              // close 若也没注册 ⇒ 抛异常 ⇒ 被 catch ⇒ 只 warn
 * ```
 * 结果是这个变量的 `GetResult()` 永远返回 undefined/0 —— **表达式不报错、红点不亮、界面无感**。
 * 所以未实现的玩法也要注册成「恒 0」的桩（`RdStubVar`），见 `RdClientVar` 文件头。
 *
 * ## 调用时机
 * `ProcedureBootstrap.onLoad()`（组合根）里调一次 —— 必须早于任何界面用表达式，
 * 且幂等（重复进场景不会重复注册；`SetVarClass` 本身就是覆盖写，重复也无害）。
 */

import { FW } from '../../framework/FW';
import { RD_CLIENT_VARS, RD_EXTRA_VAR_NAMES, RD_SET_VARS, validateRdAggregation } from './RdTypes';
import { makeStubVarClass, RdSetVar } from './RdClientVar';
import { buildServerVarClasses } from './RdServerVar';
import { RD_CLIENT_VAR_CLASSES } from './RdVars';

/** 按聚合表达式现造一个 `RdSetVar` 子类。 */
function makeSetVarClass(varName: string, script: string): new () => RdSetVar {
    class GeneratedRdSetVar extends RdSetVar {
        static __cname: string = 'RdSetVar_' + varName;
        GetScript(): string {
            return script;
        }
    }
    return GeneratedRdSetVar;
}

let registered = false;

/**
 * 把全部红点变量注册进表达式引擎。幂等。
 *
 * @returns 本次实际注册的变量名（第二次调用返回空数组）。
 */
export function registerRdVars(): string[] {
    if (registered) return [];
    registered = true;

    const done: string[] = [];
    const register = (name: string, clazz: unknown): void => {
        try {
            FW.ExprMgr.RegistVarClass(name, clazz as never);
            done.push(name);
        } catch (error) {
            // 注册本身不该失败；真失败了要吼出来，不能让它变成「红点莫名其妙不亮」
            console.error(`[RdRegistry] 注册变量失败：${name}`, error);
        }
    };

    // ① 服务端下发型（表驱动，见 RdServerVar.buildServerVarClasses）
    for (const [name, clazz] of buildServerVarClasses()) {
        register(name, clazz);
    }

    // ② 客户端真实现（RdVars.ts）
    for (const [name, clazz] of Object.entries(RD_CLIENT_VAR_CLASSES)) {
        register(name, clazz);
    }

    // ③ 聚合型（表达式在 RdTypes.RD_SET_VARS 里；先校验自引用 / 未注册引用）
    for (const [name, script] of Object.entries(RD_SET_VARS)) {
        for (const error of validateRdAggregation(name, script)) {
            console.error(`[RdRegistry] ${error}`);
        }
        register(name, makeSetVarClass(name, script));
    }

    // ④ 老端注册过但 open.json 当前没配的（留名，免得上线前策划一配就「尚未注册」）
    for (const name of RD_EXTRA_VAR_NAMES) {
        if (done.includes(name)) continue;
        register(name, makeStubVarClass(name));
    }

    // ⑤ 客户端型里还没实现的 → 恒 0 桩（名字必须注册，理由见文件头）
    for (const name of Object.keys(RD_CLIENT_VARS)) {
        if (done.includes(name)) continue;
        register(name, makeStubVarClass(name));
    }

    console.log(
        `[RdRegistry] 已注册红点变量 ${done.length} 个：` +
            done.filter((n) => !n.startsWith('RDStub')).join(','),
    );
    return done;
}

/** 测试 / 热重载用：允许重新注册。 */
export function resetRdRegistryForTest(): void {
    registered = false;
}
