import { FW } from "../FW"
import { StringUtil } from "../utils/StringUtil"

type ConditionCombineType = "||" | "&&"

export interface Condition {
    expr: string //计算用表达式
    tip: string //失败提示语句
}

//条件集
export class ConditionSet {
    private reasonScript: string
    private boolScript: string
    private constructor(reasonScript: string) {
        this.reasonScript = reasonScript
        //表达式reasonScript满足IsNullReason的话，返回true 也就是没有表达式，默认开启
        this.boolScript = StringUtil.format("({0})==false", reasonScript)
    }

    private static CombineInner(tlReasonScript: Array<string>, type: ConditionCombineType) {
        let reasonScript: string

        //由于tlScript每一项都取了反, 所以And和Or也取反
        if (type == "&&") {
            reasonScript = tlReasonScript.join("||")
        }
        else {
            reasonScript = tlReasonScript.join("&&")
        }
        return new ConditionSet(reasonScript)
    }

    static CombineCondition(tlCondition: Array<Condition>, type: ConditionCombineType,) {
        let tlReasonScript = []
        // 转换为 condition.expr() and null or condition.tip
        // 满足条件返回null 不满足 返回失败提示
        let template = `((!({0}))&&[=[{1}]=])`
        for (let condition of tlCondition) {
            let reason = condition.tip
            let script = StringUtil.format(template, condition.expr, reason)
            tlReasonScript.push(script)
        }

        return ConditionSet.CombineInner(tlReasonScript, type)
    }

    GetBoolScript(): string {
        return this.boolScript
    }

    /**
     * 获取条件的真假
     */
    GetBool(): boolean {
        let reason = this.GetReason()
        // return reason
        if (reason == "") {
            return true
        }
        return reason == "false"
    }

    GetReasonScript(): string {
        return this.reasonScript
    }
    /**
     * 获取条件为假的原因
     */
    GetReason(): string {
        return String(FW.ExprMgr.GetResult(this.GetReasonScript()))
    }

    IsNullReason(): boolean {
        if (this.reasonScript == null) {
            return true
        }
        if (this.reasonScript == "") {
            return true
        }
        return false
    }

}