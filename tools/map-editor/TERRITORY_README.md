# 章节领地地图编辑器

章节领地与对战地图是两套协议，入口为 `http://127.0.0.1:8787/territory.html`。

```powershell
node tools/map-editor/server.mjs --open
python tools/map-editor/copy_territory_maps.py --dry-run
python tools/map-editor/copy_territory_maps.py --id chapter_01
```

Windows 下也可以直接双击 `tools/map-editor/copy-territory-maps.bat`；支持把参数继续传给 Python 脚本，例如：

```powershell
tools\map-editor\copy-territory-maps.bat --dry-run
tools\map-editor\copy-territory-maps.bat --id chapter_02
```

编辑器保存到 `tools/map-editor/presets/territory/`，发布时把**同一份校验后的 JSON**写入三个目标：

| 目标 | 用途 | 是否生成 `.meta` |
| --- | --- | --- |
| `assets/resources/config/territory-maps/` | Cocos 资源（客户端读） | 是 |
| `doc/塔防数据配置/json/sever/` | 策划侧服务端表 | 否 |
| `doc/塔防数据配置/json/client/` | 策划侧客户端表 | 否 |

> `sever` 是仓库既有拼写（与 `tools/config/export_tafang.mjs` 一致），不是 `server` 的笔误。
> 两个策划目录不是 Cocos 资源目录，**不生成 `.meta`**。

发布前会检查地图尺寸、初始格、固定站点、前置依赖、站点重叠、随机候选格和资源字段；站点数量不是 10 个只提示 warning，不阻断保存。校验只跑一次，三份产物按字节相同。

固定资源点选中后，在右侧填写“固定资源奖励 ID”，对应策划“关卡地图格子奖励”表的正整数 ID。每个固定资源点可以独立填写，切换格子或点击保存时会提交当前输入，地图 JSON 记录在该站点的 `rewardId`；原有 `configId` 保持原义。旧地图没有 `rewardId` 时仍可加载，待策划给出具体 ID 后逐点补齐。
右侧“批量设置固定资源奖励”可输入一个正整数奖励 ID，一键覆盖当前地图全部固定资源格的 `rewardId`。该操作可一次撤销，仍需 Ctrl+S 保存；其他类型站点不受影响。

客户端静态模型位于 `assets/script/app/territory/model/TerritoryMapConfig.ts`。玩家占据、探索中、停用等进度状态不写进静态地图 JSON，应由后续 `TerritoryProgress` 运行时模型保存。
