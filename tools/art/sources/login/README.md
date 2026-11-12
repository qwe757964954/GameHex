# 登录切图

`approved-mockup.png` 是本次采用的 1536×1024 效果图。保留原图用于复现，不作为运行时背景。

运行 `python tools/art/slice_login.py`，将 14 张 PNG 和 `login-slices.json` 导出到 `assets/resources/image/login/`。切片去除固定文字、圆点和勾选等内容，文字由 Label 显示，状态图标独立绑定。PNG 按原切片两倍尺寸输出，实际细节仍受原图分辨率限制。

`login-slices.json` 保存原图裁切坐标、输出尺寸、九宫格边距（左、右、上、下）。资源由 Cocos 导入并生成 meta；SpriteFrame 使用 CUSTOM 裁切、完整画布和清单中的九宫格边距，不手写 meta。沿用本目录原有 `auto-atlas.pac`。

三份消费资源的预制体是 `LoginRoot.prefab`、`ServerSelectPanel.prefab`、`ServerSelectItem.prefab`。输入框底图与内部 EditBox 分开，保留文字留白；渠道入口隐藏。登录、注册均要求勾选协议；本机首次无记录时不勾选，之后恢复 `login_agreed` 的显式选择，取消勾选同样保存，页面勾选与校验共用 Controller 状态。

本次实际验证：

```powershell
npx tsx --test tests/login-presentation.test.ts tests/login-page-lifecycle.test.ts tests/login-controller.test.ts tests/login-server-presentation.test.ts tests/server-select-panel.test.ts tests/view-intent-events.test.ts
python -m unittest discover -s tests -p test_login_slices.py
```

结果：34 项 TypeScript 测试通过，1 项 Python 测试通过（逐张比较 14 个切片的可复现输出、透明通道和 Cocos 边距）。三份 Prefab 均经 Cocos MCP 刷新、校验通过。浏览器预览确认账号页、密码遮罩、输入留白、选服行状态和选中勾选图标；未提交真实登录或注册请求，未做真机或正式构建验证。
