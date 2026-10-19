# Cocos MCP 与蓝湖 MCP 接入指南

> 更新：2026-10-16　适用工程：`D:\City1001\Demo3.8`（Cocos Creator 3.8）

本工程已接入两个 MCP 服务，供 AI 客户端（豆包工作、Cursor、Claude Code 等）直接调用：

| 名称 | 用途 | 传输 | 端点 |
| :--- | :--- | :--- | :--- |
| **Cocos MCP**（`extensions/cocos-mcp-server`） | 操控 Cocos Creator 编辑器（Prefab/场景/资源/组件等 231 项操作） | Streamable HTTP | `http://127.0.0.1:3000/mcp` |
| **蓝湖 MCP**（`D:\City1001\tools\lanhu-mcp`） | 读取蓝湖需求文档与设计稿、导出切图 | STDIO / HTTP | stdio 按需拉起；HTTP `http://localhost:8000/mcp` |

工程根目录 `.mcp.json` 已写好两份服务配置（Cursor / Claude Code 等支持项目级配置的客户端自动识别）。

---

## 一、豆包工作客户端接入（推荐主路径）

豆包工作通过「自定义连接器」接入 MCP：打开豆包客户端 → 左侧 **插件·技能·伙伴** → 插件页右上角 **+ 添加** → **新建自定义连接器**。

> 注意：自定义连接器仅支持在本地电脑中使用，请在本机（Windows）运行豆包工作。

### 1. Cocos MCP（HTTP 类型）

| 字段 | 填写值 |
| :--- | :--- |
| 服务器名称 | `Cocos MCP` |
| 传输类型 | `HTTP` |
| 服务器 URL | `http://127.0.0.1:3000/mcp` |
| 自定义 Headers | 无需添加 |

**前置条件（每次使用前）**：用 Cocos Creator 3.8.6+ 打开本工程 → 菜单 **扩展 → Cocos MCP Server → 打开面板** → 面板中 **启动服务器**（可勾选「编辑器启动时自动启动」）。启动后端点即为 `http://127.0.0.1:3000/mcp`。

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

## 二、其他客户端使用 `.mcp.json`

工程根目录 `.mcp.json` 内容：

```json
{
  "mcpServers": {
    "cocos-mcp": {
      "url": "http://127.0.0.1:3000/mcp"
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

- **Claude Code / Cursor / Windsurf**：在工程目录启动时自动加载 `.mcp.json`（Cocos 需先启动编辑器内服务器，见上）。
- 蓝湖 stdio 模式无需设置工作目录：`.env` 按脚本绝对路径自动定位加载。

---

## 三、状态验证记录（2026-10-16）

| 项目 | 结果 |
| :--- | :--- |
| 蓝湖 MCP HTTP 启动 | ✅ 端口 8000 正常监听（FastMCP 3.4.7，Lanhu Axure Extractor） |
| 蓝湖 MCP MCP 握手（initialize） | ✅ POST `/mcp` 返回 200，SSE 协议响应正常，支持 tools/resources |
| Cocos MCP 扩展编译产物 | ✅ `dist/` 齐全（main.js / mcp-server.js / tools 等） |
| Cocos MCP 运行时 | ⚠️ 当前 Cocos Creator 未运行，3000 端口未监听——需在 Creator 内启动服务器 |
| 蓝湖 venv 依赖 | ✅ fastmcp / httpx / bs4 / playwright / dotenv 导入正常 |

---

## 四、故障排查

| 现象 | 原因与处理 |
| :--- | :--- |
| 连接器保存后调用报「无法连接」 | Cocos Creator 未打开工程或服务器未启动：扩展面板 → 启动服务器，确认 `http://127.0.0.1:3000/mcp` 可访问 |
| 3000 端口被占用 | 关闭占用进程，或在 Cocos MCP 面板修改端口后同步更新连接器 URL 与 `.mcp.json` |
| 蓝湖 stdio 拉起失败 | 确认 `venv\Scripts\python.exe` 存在；首次使用建议先在终端手动跑一遍：`venv\Scripts\python.exe lanhu_mcp_server.py` 查看报错 |
| 蓝湖 HTTP 8000 端口冲突 | 用 `--port` 指定其它端口：`python lanhu_mcp_server.py --port 8010`，并同步更新连接器 URL |
| 蓝湖读取文档 401/无权限 | `.env` 中 `LANHU_COOKIE` 过期，按 `D:\City1001\tools\lanhu-mcp\GET-COOKIE-TUTORIAL.md` 重新获取并更新 |
