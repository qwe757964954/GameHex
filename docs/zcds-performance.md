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


## 2026-11-03：单局展示资源与派生数据

资源链沿用 BattleComposition → ZCBattleRuntimeController → 单局 AssetService / ResourceScope。ZCGame 注入 `IZCBattlePresentationArt` 只读资源表，单位、卡牌和渲染世界不再读取 `ProcedureGame.current`。单位缺图意图带真实宿主及兵种 id，运行控制器按本局配置查路径、去重在途任务并忽略离场迟到结果；补载原位更新表。排行榜改用 PopupBase 本次打开的资源作用域，关闭、销毁和重开均隔离迟到资源。

模型以单局编译定义表直接提供兵种查询。地块投影在逻辑步、开发、神器成功或地形失效后重建，不足 0.05 秒的显示帧复用投影，插值余量继续逐帧更新。连通块的一次 BFS 结果登记给块内所有成员，沿用原有地形版本失效入口；成员顺序不构成契约。

### 测量方法

`tools/benchmark_zcds.ts` 的 schemaVersion 2 保留原有三个 20 Hz 场景及规则摘要，新增 60 Hz 的双人、三人、四人、密集远程弹道及持续开发场景。每场景 720 显示帧，四轮中首轮预热；分别计时 tick、createRenderFrame + drainPresentationEvents，以及二者合计的模型显示帧管线。主动开发在计时区间外执行，其后的缓存失效和模拟工作在区间内。

哈希在计时区间外生成，覆盖完整状态、伤害统计、瞬时表现、一次性通知及派生地块数据；连通成员排序后比较，兵种定义只比较真实在场单位会读取的条目。每轮重复检查确定性，再与修改前报告逐场景比较。查询表引用变化和弹道峰值在区间外计数，不能当作堆分配或 GC 次数。

本次在 Node v24.16.0 同机依次运行修改前模型与当前模型，未同时运行测试。修改前模型通过 `git show HEAD:assets/script/app/zcds/model/ZCGameModel.ts` 放入忽略目录，临时基准只替换模型入口，配置、系统及脚本口径保持一致。三个旧场景和五个新场景的规则/表现摘要均一致。报告存于 `.codex-artifacts/zcds-pipeline-before.json`、`.codex-artifacts/zcds-pipeline-after.json`。

| 60 Hz 场景 | 管线均值：前 → 后（ms） | 管线 p95：前 → 后（ms） | 投影均值：前 → 后（ms） | 地块表重建：前 → 后 / 720 帧 |
| --- | --- | --- | --- | --- |
| 双人，200 单位 | 0.1995 → 0.1786 | 0.7306 → 0.7430 | 0.0258 → 0.0070 | 720 → 240 |
| 三人，200 单位 | 0.2325 → 0.1919 | 1.0062 → 0.8857 | 0.0354 → 0.0068 | 720 → 187 |
| 四人，200 单位 | 0.2290 → 0.2222 | 0.8784 → 0.8810 | 0.0318 → 0.0091 | 720 → 240 |
| 密集远程，200 单位 | 0.1204 → 0.1074 | 0.4204 → 0.4254 | 0.0190 → 0.0058 | 720 → 240 |
| 持续开发，200 单位 | 0.2411 → 0.1980 | 0.8523 → 0.8216 | 0.0357 → 0.0102 | 720 → 245 |

五场景的兵种定义表引用变化均从每轮 720 次降为 0 次（不含初始化）。密集远程场景弹道峰值 200，持续开发场景观测到 50 次地形版本变化。单连通领地的合成场景中，200 格的成员数组由 200 份、40,000 个格子编号，降为 1 份、200 个编号。

索敌另用诊断轮次包装 `ZCTargetingSystem.acquire`，避免插桩污染主基准。五场景索敌合计约 10.7～39.6 ms / 12 秒模拟时间，占插桩 tick 时间约 19%～39%。当前保留全图最近及平局规则；这些数据不足以支持另改索敌算法。主基准均值下降，但部分场景 p95 略升，因此不承诺尾延迟下降或设备 FPS 提升。

重新运行并与本次同规则结果比较：

```powershell
npm.cmd run benchmark:zcds -- .codex-artifacts/zcds-pipeline-current.json .codex-artifacts/zcds-pipeline-after.json
```

这些结果只覆盖模型显示帧管线。真实 Cocos 的节点渲染、Spine、DrawCall、堆分配/GC 和真机帧率仍需在目标设备采样；节点复用、静止帧写入及插值由现有行为测试覆盖。本次通过 Cocos MCP 刷新 zcds 脚本后，编辑器错误日志查询为空，未将其视为实际战斗预览通过。

### 回归验证

新增 15 项资源生命周期、作用域、资源选图及投影缓存用例。最终重点验证集（含流程架构、资源作用域、状态一致性、表现队列及渲染行为）135 项全部通过，输出保存在 `.codex-artifacts/zcds-focused-final.log`；调用方式为 `npx.cmd tsx --test --test-concurrency=4` 加对应测试文件。扩大执行 zcds、battle、view-intent-events、callback-owner、popup-lifecycle 和 scoped-asset-cache：1,123 项中 1,074 通过、49 失败。将本次改动的源码及旧测试通过只读文件覆盖还原到 HEAD，在同环境复跑得到 51 个失败；统一文件路径后没有新增失败，排行榜必填引用护栏和特效池夹具缺 board 两项由失败变为通过。比较报告为 `.codex-artifacts/zcds-regression-comparison.json`，未改写仓库验证基线。

`npm.cmd run check:zcds` 通过；完整 `npx.cmd tsc --noEmit` 未通过，生产代码前后均为 284 条错误，错误指纹无新增（见 `.codex-artifacts/zcds-tsc-comparison.json`）。全工程配置还会扫描 tests/tmp，因此不以完整 tsc 退出码宣称工程通过。存量失败包括外部配表 secondarySkillId=0、旧初始化签名及资源绑定断言，未在本次扩展处理。
