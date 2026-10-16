# zcds 性能优化

逻辑保持 20 Hz 固定步长和全图最近索敌。单位坐标在相邻逻辑帧间插值；特效和飘字使用逻辑时间加当前步长余量，每帧更新。地块和 HUD 每 0.15 秒刷新，地块图片、价格和阵营内容仅在变化时写入。

城墙使用地形版本缓存，占领、开发、破墙、摧毁建筑及重开对局时失效。墙段坐标、旋转、长度及相邻格对应关系按地图缓存。索敌复用上下文和坐标容器，缓存可攻击建筑与暴露城墙；寻路复用访问标记和队列，缓存按目标格排序的邻居。范围查询只缓存格子列表，单位仍从实时索引读取。

单位和特效按视觉类型复用节点，飘字使用独立节点类型。闲置节点总上限 192，每类型上限 32；超出部分销毁，退出场景销毁全部节点。复用时恢复显示、位置、缩放和绘制顺序，重置攻击动画计数并重新播放视觉动画。弹道后备图形只在首次显示时绘制。

## 本地逻辑基准

Node v24.16.0，固定地图与随机种子，每场景 240 步、12 秒模拟时间，运行 6 次，首轮不计耗时。每一步核对完整状态、伤害统计与瞬时表现事件的 SHA-256；优化前后所有场景一致。

| 场景 | 平均耗时：优化前 → 后 | p95：优化前 → 后 |
| --- | --- | --- |
| 空战局 | 0.0151 → 0.0109 ms | 0.0381 → 0.0225 ms |
| 200 小兵分散战斗 | 0.3171 → 0.2389 ms | 1.0835 → 0.6419 ms |
| 200 小兵密集战斗 | 0.1092 → 0.0753 ms | 0.5851 → 0.3109 ms |

这是本机纯逻辑耗时，包含完整战局中单位逐渐减少的过程。场景渲染、设备帧率和 DrawCall 尚未纳入测量；以上数字不代表设备 FPS 提升比例。节点复用和重绘次数由自动化测试验证。

重新运行并保存报告：

```powershell
npm.cmd run benchmark:zcds -- .codex-artifacts/zcds-performance-current.json
```

弹道碰撞及 0.1 秒控制占领（含脚点轨迹、兵力倍率与补给线）上线后，战局结果会改变。上面的性能对比属于这些规则改动之前的记录。当前版本的报告为 `.codex-artifacts/zcds-capture-footprint-performance.json`，后续同规则优化可核对该基准：

```powershell
npm.cmd run benchmark:zcds -- .codex-artifacts/zcds-performance-current.json .codex-artifacts/zcds-capture-footprint-performance.json
```

原始报告保存在 `.codex-artifacts/zcds-performance-before.json` 和 `.codex-artifacts/zcds-performance-after.json`。相关测试为 `tests/zcds-render-performance.test.ts`、`tests/zcds-state-consistency.test.ts` 及 `tests/zcds-progress.test.ts`。
