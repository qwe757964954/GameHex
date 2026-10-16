# ZC 状态结算迁移实施计划

> 本计划在当前工作区执行；对局行为与快照格式保持不变。

**目标：** 将 `tickStatusEffects`、周期效果换算、旧牵引、治疗和生命上限重算迁入无状态 `ZCStatusResolutionSystem`。

**边界：** System 接收快照、状态系统、单位索引、规则和少量跨系统回调；Model 保留固定步长编排、伤害提交和表现输出。沿用当前“清无效状态 → 记旧生命上限 → 牵引 → 周期效果 → 状态过期 → 重算生命上限 → 导出状态快照”的顺序。

**验证：** `npm.cmd run check:zcds`，状态、旧技能、快照及确定性相关测试。全仓测试已有失败，不将其用作唯一完成判据。

## 步骤

- [x] 为到期当拍周期伤害、治疗封顶、生命上限比例和牵引增加 System 行为测试，先确认缺失入口导致失败。
- [x] 实现 `ZCStatusResolutionSystem.tick(state, dt, context)` 并接入 `ZCGameModel.advance`，移除 Model 中对应实现。
- [x] 更新直接调用旧 Model 私有方法的测试，使其走新 System 入口。
- [x] 类型检查、相关回归、Cocos 资源刷新与结果核对。
