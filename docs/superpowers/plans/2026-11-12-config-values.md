# 对局与 SLG 配置校验落地计划

目标：复用配置入口的基础值校验，减少重复类型判断；内部继续消费现有强类型配置。

## 设计与边界

- `core/config/ConfigValue.ts` 只处理对象、数组、非空字符串、有限数字、安全整数；失败抛出包含字段路径和实际值的错误，无 I/O、引擎依赖或状态。
- `ZCPvpTableParser` 和 `ZCPvpConfigCompiler` 直接使用公共基础读取函数；正数等玩法范围仍留在原解析模块。
- `ZCStatSchema` 保留数字转换、字符串 trim、JSON 解析及缺值语义，复用转换之后的基础校验。
- `BigMapConfig` 保留旧表数字字符串、四舍五入、候选字段和缺列默认值；据点、野怪和显式队列参数仍严格校验，业务上下限由原调用处传入。
- 不修改配表、生成产物、运行时安装流程、资源归属或业务类型分发，不引入 schema 依赖或策略类。
- 比较：各模块继续复制会让基础契约分散；全量 schema 框架迁移超出当前需要；采用少量纯函数并接入现有入口。

## 实施

- [x] 新增公共读取函数的行为测试，覆盖合法零值、负数、小数、非有限数、错误类型、安全整数边界、对象/数组区分、字符串保持原值。
- [x] 新增真实入口测试，固定 PVP 严格数字、SLG 旧表转换/取整/默认值、新表严格整数及错误定位。
- [x] 实现公共函数，替换重复判断，同步实际调用方，不保留基础校验的 feature 再导出。
- [x] 补充架构规范的使用约定，跑配置回归、编译和分层守卫；检查差异并保留用户既有改动。

## 验证

- `npx tsx --test tests/config-value.test.ts tests/config-boundaries.test.ts`
- PVP 编译、技能配置与卡牌解析相关测试；SLG 配置、世界、基地、对局与 Model/Controller 绑定测试。
- `npx tsc --noEmit --target ES2020 --module commonjs --moduleResolution node --skipLibCheck` 对修改的纯 TS 模块编译。
- `tests/flow-architecture.test.ts`、`tests/isolated-compile-import.test.ts` 与 `git diff --check`。

## 执行结果

- 首轮上述相关配置、业务及分层测试共 326 项，325 项通过；唯一失败是 `zcds-model` 中直接比较配表文件的「remoteRef 与转表产物逐格一致」，`pvpSkillPlan` 两份产物有 12 处差异，本次未修改这些配表。
- 最终补充据点/野怪掉落元素定位测试后，配置及 SLG 相关测试 173/173 通过；公共校验与入口兼容测试共 9 项。
- 修改的五个纯 TS 模块定向 `tsc --noEmit`、跨文件导出定义检查与 `git diff --check` 通过。
- Cocos MCP 已刷新 `db://assets/script/core/config`，新脚本 `.meta` 由引擎生成。
- 未运行全仓门禁或引擎预览；共享工作区其他改动不纳入本轮验证结论。
