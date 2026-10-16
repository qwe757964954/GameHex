# 空地占领规则

小兵脚点进入或经过敌方空地后开始累计控制进度，达到 `0.1` 秒才改变归属。双方规则相同。每增加一个同阵营小兵，占领速度增加 `25%`，最多为基础速度的 `2` 倍。系统以 `0.05` 秒固定步长运行，因此单兵需要 2 拍，达到 2 倍加速的兵群可在 1 拍完成。

双方同时驻留时进度暂停。格内无人时，已有进度按正常速度衰减；只有原地块所属方驻留时，以 `2` 倍速度清除敌方进度。另一进攻阵营接管已有进度时，也必须先清零旧进度，下一逻辑步才能累计自己的进度。死亡单位和尸体不参与人数统计。

占领目标必须与进攻方从主城出发、沿同阵营地块形成的连通领地相邻。孤军进入敌方腹地不会产生进度；随着前线地块依次占领，补给线会自然向前延伸。

系统把连续坐标 `freeX/freeY` 视为小兵脚底逻辑坐标，并在每个 20 Hz 逻辑步的战斗和弹道结算后统一处理占领。公共单位预制体的根节点就是脚点，兵种美术通过 `VisualRoot` 上移校准，`FootPoint` 节点用于编辑器检查；占领模型不会反向读取表现节点。判定会覆盖脚点从本拍起点到终点经过的全部六边形，不只检查最终落点；同一个小兵在同一拍内对同一格最多计数一次。

存在建筑、尚未击破的城墙或永久废墟的地块不参与驻留占领。占领成功后更新领地、地块状态和寻路缓存；已经消费过开发机会的空地继续保持 `developmentResolved = true`，易手不会刷新抽卡机会。

地块的 `captureOwner` 和 `captureSeconds` 保存当前计时阵营及控制进度。存档恢复后继续累计，旧存档缺字段时补空阵营及零进度，重开对局全部清零。阈值和倍率来自 `pvpGlobal.json`：

- `captureSeconds`
- `captureExtraUnitRate`
- `captureMaxSpeedMultiplier`
- `captureDecayMultiplier`
- `captureDefendMultiplier`
- `captureRequireSupply`

验证：

```powershell
node --import tsx --test tests/zcds-state-consistency.test.ts
npm.cmd run check:zcds
```
