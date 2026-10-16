# ZCGameModel 后续拆分

1. 为攻击出手、投射物命中和胜负结算建立行为测试，先记录当前输出。
2. 将攻击与命中流程移入 `ZCAttackResolutionSystem`，以本局快照和显式上下文传入依赖；`ZCGameModel` 只保留原有入口和时序编排。
3. 将旧技能公式、命中状态和 Buff 施加移入 `ZCLegacyCombatSystem`。
4. 将计分、超时比较和胜负判定移入 `ZCOutcomeSystem`，模型负责提交最终状态。
5. 将飘字、卡牌揭示和地块激活的瞬时队列移入 `ZCBattlePresentationQueue`。
6. 跑相关测试、`check:zcds`，复查模型行数和变更边界。

不变量：随机数调用顺序、帧事件、伤害与飘字、状态快照、投射物及区域生成、胜负文案保持原样。
