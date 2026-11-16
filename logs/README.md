# 运行日志目录

根目录禁止出现 `*.log`；所有命令输出统一写这里。

## 结构

```text
logs/
├── 2026-11-16/           # 当天活跃日志
│   └── zcds-progress.log
└── archive/2026-11-16/   # 过期归档（.gitignore 忽略）
```

日志文件由 `.gitignore` 的 `*.log` 忽略；本 README 入库。SVN 侧 `logs/` 已纳入版本控制，`archive`、`2026-*`、`*.log` 由 `logs` 目录的 `svn:ignore` 忽略。

## 命名

- 测试：`tests-<模块>-<阶段>.log`，例如 `tests-territory-progress.log`
- 类型检查：`tsc-<模块>.log`
- 验证：`verify-<范围>.log`
- 禁止 `tests_territory.log` 这类无日期、无阶段名、容易与旧文件混淆的命名。

## 跑命令

PowerShell 用 `*>` 合并 stdout/stderr：

```powershell
npx tsx --test tests/zcds-progress.test.ts *> logs/2026-11-16/tests-zcds-progress.log
npm run verify *> logs/2026-11-16/verify.log
```

bash 用 `> ... 2>&1`。

## 保留与清理

- 活跃日志保留 14 天；归档保留 90 天。
- 清理前确认没有进程在写；移动或删除后用 `npm run verify:hygiene` 复查根目录。
- 根目录出现日志时，先移到 `logs/archive/<日期>/`，不要直接删除正在写入的文件。
