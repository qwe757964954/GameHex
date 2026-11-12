---
name: codebase-design
description: Use when evaluating complex interfaces, low-value wrappers, testability, or Controller, Repository and Gateway boundaries in this Cocos TypeScript project.
license: MIT
---

# Codebase Design

基于 Matt Pocock 的 deep-module 方法进行项目适配。目标是让调用方理解更少、实现细节集中、行为容易测试；以调用方需要知道的概念衡量复杂度，不以文件数、代码行数或类数量打分。

先遵守 [工程入口](../../../AGENTS.md) 与 [MVC 设计规范](../../../docs/agent/MVC设计规范.md)。本技能用于已有设计问题或明确的模块设计任务，不因普通改动自动启动架构重构。

## 评估方法

1. 明确本次功能与变更范围；有 CodeGraph 索引时先查询目标符号、调用方及调用链。列出实际接口：输入输出、调用顺序、错误与取消、状态和资源归属，而不只列 TypeScript 方法签名。
2. 找出调用方为使用接口必须知道的实现细节：是否自行维护内部状态、重复组合调用、识别具体适配器，或依赖未表达的时序。
3. 对每个包装层做删除推演：删除后复杂度是消失，还是扩散到调用方？协议转换、依赖隔离、资源作用域和替换测试实现都是实际价值，不能因代码薄就删除。
4. 评估改动是否让知识和验证集中到正确职责层。优先复用现有接口与规则；有明确收益时，提出最小接口调整，核对全部受影响调用方与测试。
5. 用公开行为验证接口。测试直接 import 实现，不复制算法；保持必要的分层、caller、异步取消和资源生命周期回归。

## 判断接口是否有价值

| 检查对象 | 需要回答的问题 |
| --- | --- |
| 接口复杂度 | 调用方要记住多少前提、模式和先后顺序？哪些可以由拥有该职责的模块处理？ |
| 包装层 | 它是否承担协议、依赖、错误、资源归属或测试替换的实际职责？ |
| 可测试性 | 能否通过现有接口验证结果、不变量、失败与取消，而不观察 Cocos 节点或复制内部算法？ |
| 改动局部性 | 一个规则变化是否只需修改其拥有者，还是必须同步修改多个调用方？ |

Controller 编排，Model 保留业务真源和规则，Repository/Gateway 处理外部数据和边界归一化，Composition/Entry 装配。减少接口复杂度应发生在这些职责之内。已有接口即使暂时只有一个实现，也可能承担真实的架构隔离，不采用“至少两个 adapter”作为保留门槛。

例如，一个只转发请求的 Gateway 若统一了协议映射和真实 caller 的取消归属，就有保留价值；若两个辅助包装层只重复传参、没有独立契约，则评估去掉它们能否让调用链更清楚，同时保留原有校验与错误处理。

## 按需深入与交付

- 需要判断依赖如何影响接口和测试时，读 [DEEPENING.md](DEEPENING.md)。
- 确有互斥设计需要比较时，读 [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md)；普通评估无需多方案流程。
- 结论说明现状证据、调用方负担、最小建议、受影响边界和验证方式。保持现状也是有效结论。
- 分析请求只交付分析；实施须在任务授权范围内，按项目风险和验证路由执行，不顺带重构。

适配来源：[mattpocock/skills](https://github.com/mattpocock/skills/tree/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d/skills/engineering/codebase-design)，提交 `4ae2317ddb22b046e26455e4f9c9b3aaaf62212d`。本目录三个 Markdown 文件均为项目适配版，许可证见 [LICENSE.mattpocock](../LICENSE.mattpocock)。
