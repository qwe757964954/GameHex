# 塔防 Excel 命令行导表

策划仍然以 Excel 为唯一编辑入口。默认命令复用 `D:\City1001\doc\eson` 自带的 POI、fastjson 与导表规则，不需要打开 SWT 界面：

```powershell
npm run config:export
```

默认顺序：

1. eSon 批量读取 `D:\City1001\doc\塔防数据配置`。
2. 自动叠加 `outputs\skill_pipeline_20260926` 中的 J、K、PVP 三份闭环兼容表。
3. 把 `pvpSkillPlan` 投影到 K 表导出的 `armySkillLevelUp.modfiy`。
4. 在临时目录校验技能、状态、修改器、单位和服务端表；校验失败不会发布半套 JSON。
5. 更新 `doc\塔防数据配置\json`、客户端压缩 JSON 和 TypeScript 类型。

三份兼容表可以继续直接由策划修改；如果以后已经把它们覆盖回正式 Excel 目录，可关闭默认叠加：

```powershell
npm run config:export -- --no-default-overlays
```

也可以显式叠加任意单表或多表：

```powershell
npm run config:export -- --no-default-overlays `
  --overlay "D:\配置\J-技能表.xlsx" `
  --overlay "D:\配置\K-卡牌升级.xlsx"
```

只校验当前客户端导表结果：

```powershell
npm run config:validate
```

明确同步到本机已编译后端的配置目录：

```powershell
npm run config:export -- --sync-server-run
```

如果后端源码仓库存在，可另外提供其资源目录：

```powershell
npm run config:export -- --server-source-dir "D:\server-source\src\main\resources\tafang"
```

旧 `TFDocGenerator.exe` 仍可手动选择，但它当前对 J 表会报告导出失败，不能作为默认流水线：

```powershell
npm run config:export -- --engine tf
```

命令不会调用 `update-db`，也不会刷新或重启后端进程。配置同步完成后，由开发者选择热加载或重启时机。Proto 继续由后端维护；本流水线只发布双方共用的 JSON 字段契约。
