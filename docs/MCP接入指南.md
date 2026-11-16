# Funplay Cocos MCP 与蓝湖 MCP 接入指南

> 更新：2026-11-16　适用工程：`D:\City1001\Demo3.8`（Cocos Creator 3.8.8）

本工程接入两个 MCP 服务，供 AI 客户端（豆包工作、Claude Code、Codex、Cursor 等）直接调用：

| 名称 | 用途 | 传输 | 端点 |
| :--- | :--- | :--- | :--- |
| **Funplay Cocos MCP**（`extensions/funplay-cocos-mcp`，v0.7.2） | 操控 Cocos Creator 编辑器：场景/Prefab/资源/组件/截图/构建预览，`core` 39 项、`full` 106 项工具 | Streamable HTTP | `http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/` |
| **蓝湖 MCP**（`D:\City1001\tools\lanhu-mcp`） | 读取蓝湖需求文档与设计稿、导出切图 | STDIO / HTTP | stdio 按需拉起；HTTP `http://localhost:8000/mcp` |

工程根目录 `.mcp.json` 已写好两份服务配置（Claude Code、CodeBuddy 等支持项目级配置的客户端自动识别）。扩展自身配置在根目录 `funplay-cocos-mcp.config.json`。

> 旧接入方式（`extensions/cocos-mcp-server`、`http://127.0.0.1:3000/mcp`）已下线，对应扩展目录与 `settings/mcp-server.json`、`settings/tool-manager.json` 均已删除。

---

## 一、地址怎么来的

Funplay 扩展把 MCP Server 内嵌在 Cocos Creator 里，端口按**工程路径派生**（`20000–29999`），同一工程每次启动端口稳定：

| 项 | 当前值 |
| :--- | :--- |
| 工程标识（projectIdentity） | `644af1bc1c3b8c68dbd10723` |
| 派生端口 | `23148` |
| 端口模式 | `project`（可在面板「Pin Current Port」改为固定端口） |
| MCP 端点 | `http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/` |
| 只读调试端点 | `http://127.0.0.1:23148/health`、`http://127.0.0.1:23148/tools` |
| 自动启动 | 开启（`autostart: true`） |

带 `/mcp/project/<projectIdentity>/` 的 scoped 地址会把请求绑定到本工程，写操作无需每次附带 `expected_context`；legacy 根地址 `/` 或 `/mcp` 仍可读，但写操作必须带会话上下文。多工程并行调试时优先用 scoped 地址。

**端口被占用时扩展会自动顺延到下一个可用端口**，此时以编辑器面板显示的 URL 为准，并同步更新 `.mcp.json` 与各客户端配置。

---

## 二、豆包工作客户端接入（推荐主路径）

豆包工作通过「自定义连接器」接入 MCP：打开豆包客户端 → 左侧 **插件·技能·伙伴** → 插件页右上角 **+ 添加** → **新建自定义连接器**。

> 注意：自定义连接器仅支持在本地电脑中使用，请在本机（Windows）运行豆包工作。

### 1. Funplay Cocos MCP（HTTP 类型）

| 字段 | 填写值 |
| :--- | :--- |
| 服务器名称 | `Funplay Cocos MCP` |
| 传输类型 | `HTTP` |
| 服务器 URL | `http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/` |
| 自定义 Headers | 无需添加 |

**前置条件**：用 Cocos Creator 3.8.8 打开本工程 → 顶部菜单 **Funplay → MCP Server** → 面板确认服务器已启动（默认随编辑器自动启动），并核对面板显示的 URL 与上方一致。

### 2. 蓝湖 MCP（STDIO 类型，推荐）

| 字段 | 填写值 |
| :--- | :--- |
| 服务器名称 | `蓝湖 MCP` |
| 传输类型 | `STDIO` |
| 命令 | `D:\City1001\tools\lanhu-mcp\venv\Scripts\python.exe` |
| 参数 | `D:\City1001\tools\lanhu-mcp\lanhu_mcp_server.py` |
| 环境变量 | 名称 `MCP_TRANSPORT`，值 `stdio` |

说明：
- 服务器会自动从 `D:\City1001\tools\lanhu-mcp\.env` 加载 `LANHU_COOKIE` 等凭证，无需手工粘贴 Cookie（`.env` 已配置且不入 git）。
- STDIO 模式由客户端按需拉起，无需常驻进程。

### 3. 蓝湖 MCP（HTTP 类型，备选）

若希望服务常驻（多客户端共享），可改用 HTTP：

1. 手动启动服务（保持运行）：
   ```
   D:\City1001\tools\lanhu-mcp\venv\Scripts\python.exe D:\City1001\tools\lanhu-mcp\lanhu_mcp_server.py
   ```
   （默认监听 `0.0.0.0:8000`，端点 `http://localhost:8000/mcp`）
2. 连接器配置：传输类型 `HTTP`，服务器 URL `http://localhost:8000/mcp?role=Developer&name=YourName`（`role`/`name` 可按需修改）。

---

## 三、其他客户端接入

### 1. 项目级 `.mcp.json`（Claude Code / CodeBuddy 等）

工程根目录 `.mcp.json` 内容：

```json
{
  "mcpServers": {
    "funplay-cocos-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/"
    },
    "lanhu-mcp": {
      "command": "D:\\City1001\\tools\\lanhu-mcp\\venv\\Scripts\\python.exe",
      "args": [
        "D:\\City1001\\tools\\lanhu-mcp\\lanhu_mcp_server.py"
      ],
      "env": {
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

- **Claude Code / CodeBuddy**：在工程目录启动时自动加载，首次使用需在客户端内批准该 MCP 服务器。
- Funplay 面板的 **Configure + Skills** 可一键写入同类配置，并顺带把内置 Skills 装到 `.claude/skills`、`.codex/skills` 等目录（已按 `.gitignore` / `svn:ignore` 过滤，不入版本库）。
- 蓝湖 stdio 模式无需设置工作目录：`.env` 按脚本绝对路径自动定位加载。

### 2. Codex（`~/.codex/config.toml`）

```toml
[mcp_servers.funplay-cocos-mcp]
url = "http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/"
```

### 3. 可选：stdio 包装器

客户端只支持 STDIO 时，先启动编辑器内服务器，再走 npm 包装器：

```powershell
npm install -g funplay-cocos-mcp
```

```json
{
  "mcpServers": {
    "funplay-cocos-mcp": {
      "command": "funplay-cocos-mcp",
      "env": {
        "FUNPLAY_COCOS_MCP_URL": "http://127.0.0.1:23148/mcp/project/644af1bc1c3b8c68dbd10723/"
      }
    }
  }
}
```

---

## 四、验证

编辑器与客户端都就绪后，依次跑：

```powershell
# 服务器存活与工程身份
Invoke-RestMethod http://127.0.0.1:23148/health

# 工具清单（core 39 / full 106，取决于 toolProfile）
Invoke-RestMethod http://127.0.0.1:23148/tools
```

客户端侧可以用几条只读请求自检：`get_project_info`、`get_editor_state`、`get_hierarchy`，或资源 `cocos://project/context`。

`/health` 返回的 `projectIdentity` 应为 `644af1bc1c3b8c68dbd10723`、`projectName` 为 `Demo3.8`、`version` 为当前扩展版本；返回的 `instance_id` 每次编辑器重启都会变，不要写进配置。

---

## 五、故障排查

| 现象 | 原因与处理 |
| :--- | :--- |
| 连接器保存后调用报「无法连接」 | Cocos Creator 未打开工程，或服务器未启动：**Funplay → MCP Server** 面板确认状态与 URL |
| 端口不是 23148 | 端口被占用后自动顺延：以面板 URL 为准，同步更新 `.mcp.json`、Codex 配置与连接器 |
| 写操作报 `PROJECT_CONTEXT_REQUIRED` | 用的是 legacy 地址（`/`、`/mcp`）：改用 `/mcp/project/<projectIdentity>/`，或按面板「一键配置」重写客户端条目 |
| 调用报 `PROJECT_CONTEXT_MISMATCH` / `EDITOR_INSTANCE_CHANGED` | 地址里的工程标识与实际工程不符，或编辑器重启过：重新读取 `/health` 并更新配置 |
| 工具数量比预期少 | `toolProfile` 为 `core`（39 项）：在 **Funplay → MCP Settings** 切到 `full`（106 项）或自定义 |
| 菜单里没有 Funplay | 扩展未加载：确认 `extensions/funplay-cocos-mcp` 存在，重启 Cocos Creator 或重载扩展 |
| 蓝湖 stdio 拉起失败 | 确认 `venv\Scripts\python.exe` 存在；首次使用建议先在终端手动跑一遍：`venv\Scripts\python.exe lanhu_mcp_server.py` 查看报错 |
| 蓝湖 HTTP 8000 端口冲突 | 用 `--port` 指定其它端口：`python lanhu_mcp_server.py --port 8010`，并同步更新连接器 URL |
| 蓝湖读取文档 401/无权限 | `.env` 中 `LANHU_COOKIE` 过期，按 `D:\City1001\tools\lanhu-mcp\GET-COOKIE-TUTORIAL.md` 重新获取并更新 |

---

## 六、与旧扩展的差异

| 项 | 旧（`cocos-mcp-server` v1.5.4） | 现（`funplay-cocos-mcp` v0.7.2） |
| :--- | :--- | :--- |
| 端口 | 固定 `3000` | 按工程派生 `23148`（可固定） |
| 菜单入口 | 扩展 → Cocos MCP Server | Funplay → MCP Server |
| 工具组织 | 50 项按分类启用 | `execute_javascript` 主打 + 39/106 项档位 |
| 配置文件 | `settings/mcp-server.json`、`settings/tool-manager.json` | 根目录 `funplay-cocos-mcp.config.json` |
| 主执行方式 | 分类工具逐项调用 | `execute_javascript`（`scene` / `editor` 双上下文） |
