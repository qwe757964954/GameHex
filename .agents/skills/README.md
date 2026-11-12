# 项目开源技能

本目录是 Codex 的项目级技能入口，只补充本项目需要的专项方法。工程约束仍以 [AGENTS.md](../../AGENTS.md) 为准。

## 已接入

| 技能 | 适用场景 | 本项目用法 |
| --- | --- | --- |
| [variant-analysis](variant-analysis/SKILL.md) | 已确认一个 bug，查找其他位置的相同根因 | 可用于 caller 未解除、取消后 Promise 不落定、状态重置遗漏、相似协议处理错误等；每个候选都要核实调用链，不能只凭文本相似判定 |
| [property-based-testing](property-based-testing/SKILL.md) | 编解码、规范化、数值和状态转换存在明确不变量 | 按实际契约选择 roundtrip、幂等、守恒等性质；测试 import 真实实现，避免复制算法或只断言“不崩溃” |
| [api-and-interface-design](api-and-interface-design/SKILL.md) | 新增或变更模块公开契约 | 明确输入、输出、错误、取消和重试语义；复用既有类型、Repository/Gateway，不按 REST 示例改写游戏协议 |
| [codebase-design](codebase-design/SKILL.md) | 接口复杂、包装层价值不明、模块难以测试或职责边界需要评估 | 项目适配版：评估调用方负担和改动局部性，在现有 MVC 内提出最小设计调整 |
| [code-review-and-quality](code-review-and-quality/SKILL.md) | 审查 diff、PR、修复或重构 | 项目适配版：正确性、可读性、架构、安全、性能五维审查，复用现有严重度、基线和验证路由 |

下一轮对话可显式使用：

```text
用 $variant-analysis 检查这个已确认的 caller 泄漏是否还有其他实例，按项目规范验证候选。
用 $property-based-testing 评估这段协议编解码值得补哪些性质测试，先复用现有测试设施。
用 $api-and-interface-design 检查这个模块的输入输出、错误、取消和重试契约，遵守项目现有 MVC 与网络协议。
用 $codebase-design 评估这个 Controller、Repository 和 Gateway 的接口负担、包装层价值及可测试性，只交付设计建议。
用 $code-review-and-quality 审查本次改动，按现有审查规范区分新增回归与历史问题，并说明验证边界。
```

Codex 会自动发现本目录的技能；未出现时重启 Codex。发现技能不等于每次任务都加载全部技能。

## 与仓库规则的衔接

- 默认单 Agent，直接执行技能步骤；上游提到的 Claude 插件命令 `/variant-analysis:variants` 没有随本次安装接入，不调用，也不因此自动启用并行代理。
- 理解和定位源码先用现有 CodeGraph；缺失或过期结果再用 `rg`，不另建索引。
- 不因上游提到 CI 规则而新增 CI、Git hook 或另一套门禁。确有必要的回归约束接入现有测试和验证路由。
- 本项目当前使用 `tsx` + `node:test`，没有安装 `fast-check`。先评估明确性质与现有边界/组合测试能否满足需求；需要生成、缩减反例时再说明依赖收益，不把普通枚举测试称为完整 PBT。
- 不为满足技能示例而新增业务需求、反向 API、包装层或无关重构。MVC、资源归属、Cocos MCP、Inspector 引用和取消语义遵守工程规范。
- 接口技能中的 REST 路由、HTTP 状态码、分页、可选字段、枚举命名和品牌类型都是其场景下的示例，不升级为本工程通用要求。已有游戏协议、配置及命名先核实双侧契约；取消仍须解除真实 caller 并按既有约定以 `false` 落定，不能统一改成抛错。
- 服务端幂等要求不能在客户端凭空实现。超时可能代表结果未知；按现有请求协议处理，不擅自给扣费、领取等奖励操作增加自动重试、幂等键或服务端状态机。
- 按 [规范路由与最小验证](../../docs/agent/规范路由与最小验证.md) 选最小验证集，按 [代码审查规范](../../docs/agent/代码审查规范.md) 区分已有失败和本次新增失败。不把安装成功等同于项目质量已提升。
- 模块设计和代码审查技能采用项目适配版。前者不强制词汇替换、合并 MVC 职责或删除旧测试；后者不复制审查门禁、不以行数或抽象次数设硬门槛，审查默认只读。

## 来源、许可和更新

- 作者与仓库：[Trail of Bits / skills](https://github.com/trailofbits/skills)。
- 接入日期：2026-11-11。
- 固定提交：`e4dd0bb5b15535f7c5a0834187dffba6ac37e4ff`。
- 上游目录：`plugins/variant-analysis/skills/variant-analysis`、`plugins/property-based-testing/skills/property-based-testing`。
- 两个技能目录保留上游原文、参考资料、规则样例、图标和 Codex UI 元数据，未修改其内容。
- 上游许可：CC-BY-SA-4.0，原文见 [LICENSE.trailofbits](LICENSE.trailofbits)。本说明是项目接入说明。
- 新增接口技能来源：[Addy Osmani / agent-skills](https://github.com/addyosmani/agent-skills)，固定提交 `301b02b12bff98e4688e6984af6556802322bbde`，目录 `skills/api-and-interface-design`。完整技能仅含 `SKILL.md`，保留原文，许可见 [LICENSE.addyosmani](LICENSE.addyosmani)。文中提到的其他兄弟技能没有自动接入。
- 模块设计技能来源：[Matt Pocock / skills](https://github.com/mattpocock/skills)，固定提交 `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`，目录 `skills/engineering/codebase-design`。本地 `SKILL.md`、`DEEPENING.md`、`DESIGN-IT-TWICE.md` 均为项目适配版，MIT 许可见 [LICENSE.mattpocock](LICENSE.mattpocock)。
- 五维审查技能来源为同一 Addy Osmani 固定提交的 `skills/code-review-and-quality`；本地 `SKILL.md` 为项目适配版，共用 [LICENSE.addyosmani](LICENSE.addyosmani)。保留五维评估、调用方核实、结构建议和验证证据要求；以项目规范替代上游门禁、模板、严重度及仓库外参考。
- 技能安装仅复制技能文件，没有执行上游脚本、安装游戏项目 npm/Python 依赖、增加 hook 或改动业务源码。
- 更新时先检查目标提交的技能正文、引用、元数据和许可证，在临时目录验证后再替换；不要直接跟随 `main` 自动覆盖。记录新提交和本地差异。

本次没有重复安装已具备的 Superpowers、Ponytail、Cocos 技能，也未接入与游戏客户端无关的 Web 框架、智能合约及完整安全审计套件。

## 插件与兼容性评估

完整检查结论、插件版本、安装作用域和验证结果见 [开源技能与插件兼容性评估](../../docs/agent/开源技能与插件兼容性评估.md)。Chrome DevTools 通过用户级 MCP 配置接入，Context7 通过插件目录安装；二者与本目录的技能安装方式不同。
