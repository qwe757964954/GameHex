import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
# 热更新发布链在 tools/hotupdate/ 子目录下（曾散在 tools/ 顶层，已收拢）
HOTUPDATE_TOOLS = PROJECT_ROOT / "tools" / "hotupdate"
SCRIPT = HOTUPDATE_TOOLS / "publish_hotupdate.py"
BAT_SCRIPT = HOTUPDATE_TOOLS / "publish_hotupdate.bat"
MANIFEST_GENERATOR = HOTUPDATE_TOOLS / "hotupdate_manifest.js"
SMOKE_HOOK = PROJECT_ROOT / "tests" / "smoke_hotupdate_hook.mjs"
RELEASE_ID = "20260918-190000-android"
BASE_URL = "http://127.0.0.1:5000/hotupdate"


def load_publish_module():
    """直接加载发布脚本，让断言用的常量和实现同源（避免两边各写一份字符串）。"""
    spec = importlib.util.spec_from_file_location("city1001_publish_hotupdate", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PUBLISH = load_publish_module()
INJECTION_MARKER = PUBLISH.INJECTION_MARKER
PACKAGED_MANIFEST_NAME = PUBLISH.PACKAGED_MANIFEST


def find_node() -> str | None:
    return os.environ.get("NODE_EXE") or shutil.which("node")


def seed_build(root: Path) -> Path:
    """造一个最小原生构建数据目录（src / assets / jsb-adapter）。"""
    data = root / "build" / "android" / "data"
    (data / "src" / "chunks").mkdir(parents=True)
    (data / "assets" / "main").mkdir(parents=True)
    (data / "jsb-adapter").mkdir(parents=True)
    (data / "main.js").write_text("// SystemJS support.\n", encoding="utf-8")
    (data / "application.js").write_text("export const Application = 1;\n", encoding="utf-8")
    (data / "src" / "chunks" / "bundle.js").write_text('console.log("bundle");\n', encoding="utf-8")
    (data / "src" / "settings.json").write_text('{"a":1}\n', encoding="utf-8")
    (data / "assets" / "main" / "index.js").write_text("export default {};\n", encoding="utf-8")
    (data / "jsb-adapter" / "jsb-builtin.js").write_text("// builtin\n", encoding="utf-8")
    return data


def write_fake_gradle_wrapper(proj: Path, *, produce_apk: bool = True, module: str = "zhanchengmaster") -> None:
    """写一个假的 gradlew.bat：记录被调用时的参数与环境，并按需"产出"一个 APK。

    为什么用假的：真 gradle 走一遍要十几分钟（还要过 CMake），单测里跑不起。
    假脚本能验的是**编排**那部分 —— 任务名拼得对不对、JAVA_HOME 有没有被显式覆盖、
    产物怎么定位与归档 —— 这几处恰恰是最容易静默出错的地方。
    """
    lines = [
        "@echo off",
        "setlocal",
        r'set "LOG=%~dp0gradle-invocation.txt"',
        r'echo ARGS=%* > "%LOG%"',
        r'echo JAVA_HOME=%JAVA_HOME% >> "%LOG%"',
        r'echo ANDROID_HOME=%ANDROID_HOME% >> "%LOG%"',
        r'echo ANDROID_SDK_ROOT=%ANDROID_SDK_ROOT% >> "%LOG%"',
        r'set "VARIANT=release"',
        r'echo %* | findstr /C:"assembleDebug" >nul',
        r'if not errorlevel 1 set "VARIANT=debug"',
        rf'set "OUT=%~dp0build\{module}\outputs\apk\%VARIANT%"',
        r'if not exist "%OUT%" mkdir "%OUT%"',
    ]
    if produce_apk:
        lines.append(rf'echo fake-apk-payload > "%OUT%\{module}-release.apk"')
    lines.append("exit /b 0")
    # 必须是 ASCII + CRLF：cmd 按字节解析 bat，两种都会踩（见 test_bat_entry_is_ascii_only）
    (proj / "gradlew.bat").write_bytes(("\r\n".join(lines) + "\r\n").encode("ascii"))


def seed_fake_gradle(root: Path, *, produce_apk: bool = True, module: str = "zhanchengmaster") -> Path:
    """造一个假的 gradle 工程 + 假 SDK，让整条 APK 链路能在几秒内跑完。"""
    proj = root / "build" / "android" / "proj"
    proj.mkdir(parents=True, exist_ok=True)
    sdk = root / "fake-sdk"
    (sdk / "ndk" / "23.0.7196353").mkdir(parents=True, exist_ok=True)
    (proj / "settings.gradle").write_text(
        f"include ':app'\nproject(':app').name = \"{module}\"\n", encoding="utf-8",
    )
    # 故意写成 Cocos 模板里那种带 -beta2 的版本号，而 SDK 目录名没有后缀 ——
    # 这是真实现状，脚本要容错而不是卡住。
    (proj / "gradle.properties").write_text("PROP_NDK_VERSION=23.0.7196353-beta2\n", encoding="utf-8")
    # local.properties 里的 Windows 路径是 Java properties 转义写法（`\` 要写成 `\\`）
    escaped_sdk = str(sdk).replace("\\", "\\\\")
    (proj / "local.properties").write_text(f"sdk.dir={escaped_sdk}\n", encoding="utf-8")
    write_fake_gradle_wrapper(proj, produce_apk=produce_apk, module=module)
    return proj


class PublishHotUpdateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.node = find_node()
        if not self.node:
            self.skipTest("找不到 node；请设置 NODE_EXE 或把 node 加进 PATH")

    def command(self, root: Path, extra: list[str] | None = None) -> list[str]:
        command = [
            sys.executable,
            str(SCRIPT),
            "android",
            "--project-root",
            str(root),
            "--skip-build",
            "--publish-root",
            str(root / "share"),
            "--base-url",
            BASE_URL,
            "--client-version",
            "1.2.3.4",
            "--release-id",
            RELEASE_ID,
            "--node",
            self.node,
            "--no-http-check",
        ]
        return command + list(extra or [])

    def publish(self, root: Path, data: Path, extra: list[str] | None = None) -> Path:
        publish_root = root / "share"
        subprocess.run(self.command(root, extra), check=True, cwd=PROJECT_ROOT)
        return publish_root

    def test_publishes_official_full_build_tree_release(self) -> None:
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            publish_root = self.publish(root, data)

            platform_root = publish_root / "hotupdate" / "android"
            release = platform_root / RELEASE_ID
            channel = platform_root / "dev"

            # 1) 完整构建目录被发布（官方方案的服务端保存完整版本）
            for relative in ("src/chunks/bundle.js", "assets/main/index.js", "jsb-adapter/jsb-builtin.js"):
                self.assertTrue((release / relative).is_file(), relative)

            # 2) release 清单：packageUrl 指向本 release，文件表覆盖三个子目录
            manifest = json.loads((release / "project.manifest").read_text(encoding="utf-8"))
            self.assertEqual(manifest["packageUrl"], f"{BASE_URL}/android/{RELEASE_ID}/")
            self.assertEqual(manifest["version"], RELEASE_ID)
            self.assertEqual(manifest["searchPaths"], [])
            self.assertIn("src/chunks/bundle.js", manifest["assets"])
            self.assertIn("assets/main/index.js", manifest["assets"])
            self.assertIn("jsb-adapter/jsb-builtin.js", manifest["assets"])
            entry = manifest["assets"]["src/chunks/bundle.js"]
            self.assertEqual(len(entry["md5"]), 32)
            self.assertIsInstance(entry["size"], int)

            # 3) main.js / application.js 绝不进清单 —— 它们要在热更之前就恢复搜索路径
            self.assertNotIn("main.js", manifest["assets"])
            self.assertNotIn("application.js", manifest["assets"])

            # 4) version.manifest 不含文件表，只留版本信息
            version_manifest = json.loads((release / "version.manifest").read_text(encoding="utf-8"))
            self.assertNotIn("assets", version_manifest)
            self.assertNotIn("searchPaths", version_manifest)
            self.assertEqual(version_manifest["version"], RELEASE_ID)

            # 5) 渠道清单是同一份内容（远端清单走渠道地址，packageUrl 仍指向不可变 release）
            self.assertEqual(
                (channel / "project.manifest").read_bytes(),
                (release / "project.manifest").read_bytes(),
            )

            # 6) latest.json v2：控制面只描述"清单在哪"，不描述文件
            latest = json.loads((channel / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(latest["schemaVersion"], 2)
            self.assertEqual(latest["releaseId"], RELEASE_ID)
            self.assertEqual(latest["platform"], "android")
            self.assertEqual(latest["channel"], "dev")
            self.assertEqual(latest["minClientVersion"], "1.2.3.4")
            self.assertEqual(latest["packageUrl"], f"{BASE_URL}/android/{RELEASE_ID}/")
            self.assertEqual(latest["remoteManifestUrl"], f"{BASE_URL}/android/dev/project.manifest")
            self.assertEqual(latest["remoteVersionUrl"], f"{BASE_URL}/android/dev/version.manifest")
            self.assertNotIn("bundles", latest)
            self.assertEqual(latest["fileCount"], len(manifest["assets"]))

            # 7) 哈希与控制文件实际内容一致（发布纪律：先传文件、后切 latest）
            self.assertEqual(
                latest["projectManifestSha256"],
                "sha256:" + hashlib.sha256((channel / "project.manifest").read_bytes()).hexdigest(),
            )
            self.assertEqual(
                latest["versionManifestSha256"],
                "sha256:" + hashlib.sha256((channel / "version.manifest").read_bytes()).hexdigest(),
            )

            # 8) 随包清单写进构建目录：指向渠道（可变指针），文件表与远端一致
            packaged = json.loads((data / "project.manifest").read_text(encoding="utf-8"))
            self.assertEqual(packaged["packageUrl"], f"{BASE_URL}/android/dev/")
            self.assertEqual(packaged["remoteManifestUrl"], f"{BASE_URL}/android/dev/project.manifest")
            self.assertEqual(packaged["assets"], manifest["assets"])
            # 版本必须是**客户端版本号**而不是 releaseId：它描述"打进安装包的那份内容"，
            # 与构建扩展（hook.js）写的那份保持一致。用 releaseId 会让首次启动直接
            # 判定 ALREADY_UP_TO_DATE —— 虽然内容恰好一致，但语义上把"包"等同于"某个 release"，
            # 后续一旦 release 内容与包内容不同就会出现判断歧义。
            self.assertEqual(packaged["version"], "1.2.3.4")
            self.assertNotEqual(packaged["version"], manifest["version"])

    def test_rejects_release_id_without_timestamp_prefix(self) -> None:
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "android",
                    "--project-root",
                    str(root),
                    "--skip-build",
                    "--publish-root",
                    str(root / "share"),
                    "--base-url",
                    BASE_URL,
                    "--client-version",
                    "1.2.3.4",
                    "--release-id",
                    "android-r1",
                    "--node",
                    self.node,
                    "--no-http-check",
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("YYYYMMDD-HHMMSS", result.stdout + result.stderr)

    def test_injects_search_path_restore_into_main_js(self) -> None:
        """发布前必须保证 main.js 有恢复片段：缺了它热更会"下载成功但永不生效"。"""
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            self.publish(root, data)

            main_js = (data / "main.js").read_text(encoding="utf-8")
            self.assertIn("CITY1001_HOTUPDATE_INJECT_START", main_js)
            self.assertIn("HotUpdateSearchPaths", main_js)
            self.assertIn("setSearchPaths", main_js)
            # 必须排在 SystemJS 引导之前 —— 否则加载到的还是包内旧脚本
            self.assertLess(main_js.index("CITY1001_HOTUPDATE_INJECT_START"), main_js.index("// SystemJS support."))
            # 幂等：重复注入不叠加
            subprocess.run(
                [
                    self.node,
                    str(PROJECT_ROOT / "extensions" / "hot-update" / "builder" / "inject.js"),
                    str(data / "main.js"),
                ],
                check=True,
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            again = (data / "main.js").read_text(encoding="utf-8")
            self.assertEqual(again, main_js)

    def test_refuses_to_republish_same_release(self) -> None:
        """同一个 release-id 二次发布必须被拒绝（先撞本地 staging，再撞不可变 Release 目录）。"""
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            publish_root = self.publish(root, data)
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "android",
                    "--project-root",
                    str(root),
                    "--skip-build",
                    "--publish-root",
                    str(publish_root),
                    "--base-url",
                    BASE_URL,
                    "--client-version",
                    "1.2.3.4",
                    "--release-id",
                    RELEASE_ID,
                    "--node",
                    self.node,
                    "--no-http-check",
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("已存在", result.stdout + result.stderr)
            self.assertIn(RELEASE_ID, result.stdout + result.stderr)

    def test_rejects_web_platform(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "web", "--skip-build"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid choice", result.stderr)

    def test_manifest_generator_requires_native_build_tree(self) -> None:
        with tempfile.TemporaryDirectory(prefix="city1001-manifest-") as temporary:
            empty = Path(temporary) / "empty"
            empty.mkdir()
            result = subprocess.run(
                [
                    self.node,
                    str(MANIFEST_GENERATOR),
                    "--src",
                    str(empty),
                    "--version",
                    RELEASE_ID,
                    "--package-url",
                    f"{BASE_URL}/android/{RELEASE_ID}/",
                    "--dest",
                    str(Path(temporary) / "out"),
                ],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("没有找到任何待清单化目录", result.stderr)

    def test_build_extension_hooks_resolve_under_any_base(self) -> None:
        """构建扩展的 hooks 声明必须解析到真文件上，否则是「构建全绿、功能全无」的静默故障。

        解析基准只有一条能与两处官方产物同时自洽：**dirname(contributions.builder)**。
          - 官方 hot-update 范例：端点 `"./builder"`（目录）+ `'./builder/hook.js'`
            → dirname='.'  → `<ext>/builder/hook.js` ✓
          - 官方构建扩展模板：端点 `"./dist/builder.js"` + `'./hooks'`
            → dirname='./dist' → `<ext>/dist/hooks.js` ✓（dist/ 里确实有 hooks.js）
        换成「扩展根目录」解释会让模板的 `'./hooks'` 落空，换成「端点文件所在目录」
        解释会让范例的目录端点落空，两者都只有这一条能同时成立。

        因此端点必须写目录形式 `"./builder"`。一旦有人改成 `"./builder/index.js"`，
        dirname 变成 `builder/`，hooks 会被解析到 `builder/builder/hook.js` ——
        构建**照样成功、零报错**，只是注入与随包清单静默不做，真机上表现为热更新永不生效。
        """
        extension = PROJECT_ROOT / "extensions" / "hot-update"
        package = json.loads((extension / "package.json").read_text(encoding="utf-8"))
        contribution = package["contributions"]["builder"]
        resolved = (extension / contribution).resolve()
        self.assertTrue(resolved.exists(), f"contributions.builder 指向不存在的路径：{contribution}")

        entry = resolved if resolved.is_file() else resolved / "index.js"
        self.assertTrue(entry.is_file(), f"端点脚本不存在：{entry}")

        # 从入口脚本里读出真正的 hooks 声明，避免测试和实现各写一份字符串
        probe = subprocess.run(
            [self.node, "-e", f"process.stdout.write(JSON.stringify(require({json.dumps(str(entry))}).configs))"],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(probe.returncode, 0, probe.stderr)
        hooks = json.loads(probe.stdout)["*"]["hooks"]

        # 权威基准：端点路径所在目录
        self.assertTrue(
            (resolved.parent / hooks).resolve().is_file(),
            f"按 dirname(contributions.builder) 解析 hooks 得到 {(resolved.parent / hooks).resolve()}，文件不存在",
        )
        # 额外保险：写成目录形式时 dirname 就等于扩展根目录，两种解释同时成立
        self.assertTrue(
            (extension / hooks).resolve().is_file(),
            f"按扩展根目录解析 hooks 得到 {(extension / hooks).resolve()}，文件不存在",
        )

    def test_build_extension_hook_injects_and_writes_manifest(self) -> None:
        """直接驱动扩展的 hook，确认注入 + 随包清单两件事都真的发生了。"""
        extension = PROJECT_ROOT / "extensions" / "hot-update"
        smoke = SMOKE_HOOK
        # 这个脚本现在跟仓库一起走（tests/ 下）。缺了就是真出问题，不能再 skip：
        # 它以前躺在 tmp/ 里，而 tmp/ 是 SVN 忽略的临时目录 —— 清一次就静默跳过，
        # 测试全绿但其实一行 hook 都没验。skip 在这里比失败更危险。
        self.assertTrue(smoke.is_file(), f"缺少 {smoke}")
        result = subprocess.run(
            [self.node, str(smoke)],
            cwd=PROJECT_ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("FAIL", result.stdout, result.stdout)
        self.assertIn("[hot-update] 已注入搜索路径恢复片段", result.stdout)
        self.assertIn("[hot-update] 已生成随包 project.manifest", result.stdout)

    def test_warns_when_build_extension_did_not_run(self) -> None:
        """构建时扩展没生效必须在发布日志里喊出来。

        发布脚本会在发布前补注入片段与随包清单，这会把「构建时扩展没跑」盖住：
        发布树是好的，但装进 APK 的那份 main.js 仍是旧的，真机上热更不了。
        """
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)  # 造出来的 main.js 没有注入片段，也没有随包清单
            result = subprocess.run(self.command(root), cwd=PROJECT_ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("构建扩展当时没生效", result.stdout)
            self.assertIn("main.js 里没有搜索路径恢复片段", result.stdout)
            self.assertIn(f"没有随包 {PACKAGED_MANIFEST_NAME}", result.stdout)

    def test_no_warning_when_build_extension_ran(self) -> None:
        with tempfile.TemporaryDirectory(prefix="city1001-publisher-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            (data / "main.js").write_text(
                f"{INJECTION_MARKER}\n// 已由构建扩展注入\n// SystemJS support.\n",
                encoding="utf-8",
            )
            (data / "project.manifest").write_text("{}\n", encoding="utf-8")
            result = subprocess.run(self.command(root), cwd=PROJECT_ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("构建扩展当时没生效", result.stdout)


    def test_tooling_sits_under_tools_hotupdate_and_root_derivation_holds(self) -> None:
        """发布链必须都在 tools/hotupdate/ 下，且默认工程根仍解析到仓库根。

        脚本的 `--project-root` 默认值靠 `Path(__file__).parents[N]` 推；本文件从
        tools/ 搬进 tools/hotupdate/ 时这个 N 要从 1 改成 2。写错不会报错：
        根目录会落到 tools/，之后读 extensions/…、注入 main.js、找 gradle 工程全错，
        而报错信息指向一个"看起来存在"的目录 —— 搬家最容易踩，所以钉死。
        """
        for path in (
            SCRIPT,
            BAT_SCRIPT,
            MANIFEST_GENERATOR,
            HOTUPDATE_TOOLS / "build_hotupdate.mjs",
            HOTUPDATE_TOOLS / "verify_apk_contents.py",
        ):
            self.assertTrue(path.is_file(), f"发布链缺少 {path}")

        argv = sys.argv
        sys.argv = [str(SCRIPT)]
        try:
            args = PUBLISH.parse_args()
        finally:
            sys.argv = argv

        root = Path(args.project_root).resolve()
        self.assertEqual(root, PROJECT_ROOT.resolve(), "默认 --project-root 算错了（parents[] 层级数？）")
        self.assertEqual(
            Path(PUBLISH.PROJECT_ROOT).resolve(),
            PROJECT_ROOT.resolve(),
            "模块级 PROJECT_ROOT 常量算错了",
        )
        for target in (
            root / "extensions" / "hot-update" / "builder" / "inject.js",
            root / "tools" / "hotupdate" / "hotupdate_manifest.js",
        ):
            self.assertTrue(target.is_file(), f"默认工程根 {root} 下找不到 {target}")

        # 工程根只能有一处推导。散在多处就是"改一处漏一处"——
        # 这次搬家正是这么踩的：parse_args 改了，注入函数里那份 parents[1] 没改。
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertEqual(
            len(re.findall(r"parents\[\d+\]", source)),
            1,
            "工程根推导应当只剩 PROJECT_ROOT 这一处；新增的 parents[N] 请改用它",
        )

    def test_bat_entry_is_ascii_only(self) -> None:
        """bat 入口必须保持纯 ASCII，且 %~dp0 只能在 shift 之前出现。

        两条都是踩出来的：

        1) cmd 是按字节 + 当前代码页解析 bat 的。文件里只要有非 ASCII，
           `goto` 跳标签时会落在多字节字符中间，半行被当成命令执行，
           报出 `'lish_hotupdate.bat' is not recognized` 这类和真实原因无关的错。
           UTF-8（有/无 BOM）与 GBK 三种写法配 CRLF 实测都会踩，所以中文文案一律
           放 tools/hotupdate/publish_hotupdate.py（那边编码可控：chcp 65001 + PYTHONIOENCODING）。

        2) `shift` 连 %0 一起移。参数解析循环跑过 `shift` 之后，`%~dp0` 就变成了
           第一个参数的目录，`"%~dp0publish_hotupdate.py"` 会指向工程根 ——
           症状恰恰是"双击能用、带参数不行"。所有 %~dp0 必须在首次 shift 前取好。
        """
        raw = BAT_SCRIPT.read_bytes()
        self.assertFalse(raw.startswith(b"\xef\xbb\xbf"), "bat 不能带 UTF-8 BOM（会让 @echo off 失效）")
        try:
            text = raw.decode("ascii")
        except UnicodeDecodeError as error:
            offset = error.start
            snippet = raw[max(0, offset - 40):offset + 10].decode("utf-8", "replace")
            self.fail(
                "bat 入口必须保持纯 ASCII，中文文案请写进 tools/hotupdate/publish_hotupdate.py。"
                f"首个非 ASCII 出现在 …{snippet!r}"
            )

        lines = text.replace("\r\n", "\n").split("\n")
        shifts = [index for index, line in enumerate(lines) if re.match(r"\s*shift\b", line, re.IGNORECASE)]
        self.assertTrue(shifts, "bat 里应当有参数解析循环")
        late = [index + 1 for index, line in enumerate(lines) if "%~dp0" in line and index > shifts[0]]
        self.assertEqual(
            late,
            [],
            f"%~dp0 出现在首次 shift（第 {shifts[0] + 1} 行）之后的行 {late}；"
            "shift 会把 %0 也移掉，此时 %~dp0 指向第一个参数 —— 请在开头先存进变量",
        )
        self.assertIn("PUBLISH_PY", text, "调用 python 应使用 shift 之前存好的脚本路径变量")

    @unittest.skipUnless(os.name == "nt", "bat 双击路径只能在 Windows 上验")
    def test_bat_double_click_menu_cancels_cleanly(self) -> None:
        """无参数运行 bat（等价双击）应弹出菜单，选 0 能干净退出且什么都不改。"""
        bat = BAT_SCRIPT
        completed = subprocess.run(
            ["cmd", "/c", str(bat)],
            cwd=PROJECT_ROOT,
            input="0\n",
            capture_output=True,
            text=True,
            errors="replace",
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        for fragment in ("原生热更新", "请选择", "已取消"):
            self.assertIn(fragment, completed.stdout)
        self.assertNotIn("[ERROR] publish failed", completed.stdout)

    def test_interactive_flow_prints_plan_and_can_cancel(self) -> None:
        """--interactive 走完菜单后要给出计划；输入 n 取消时必须零副作用。"""
        with tempfile.TemporaryDirectory(prefix="city1001-interactive-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)
            command = self.command(root, ["--interactive"])
            command = [item for item in command if item != "--skip-build"]
            completed = subprocess.run(
                command,
                cwd=PROJECT_ROOT,
                # 3=仅发布；n=不编 APK；n=取消
                input="3\nn\nn\n",
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("仅发布", completed.stdout)
            self.assertIn("现有产物", completed.stdout)
            self.assertIn("release-id", completed.stdout)
            self.assertIn("是否同时编译 APK", completed.stdout)
            self.assertIn("已取消", completed.stdout)
            self.assertFalse((root / "share" / "hotupdate").exists(), "取消后不应留下任何发布内容")

    # --- APK 编译 ---------------------------------------------------------

    def find_jdk17(self) -> Path:
        java_home, note = PUBLISH.find_gradle_java_home(None)
        if java_home is None:
            self.skipTest(f"本机没有 JDK {PUBLISH.GRADLE_MIN_JDK}+，跳过 APK 编排测试：{note}")
        return java_home

    def test_parse_java_major_handles_legacy_and_modern(self) -> None:
        """`1.8.0_502` 必须还原成 8，否则会被当成 1 从而"通过" JDK 17 的校验。"""
        self.assertEqual(PUBLISH.parse_java_major('openjdk version "1.8.0_502"'), 8)
        self.assertEqual(PUBLISH.parse_java_major('openjdk version "11.0.32" 2026-07-21 LTS'), 11)
        self.assertEqual(PUBLISH.parse_java_major('java version "17.0.4" 2022-07-19 LTS'), 17)
        self.assertEqual(PUBLISH.parse_java_major('openjdk version "21" 2023-09-19'), 21)
        self.assertIsNone(PUBLISH.parse_java_major("no version here"))

    def test_builds_apk_alongside_hotfix_release(self) -> None:
        """一次运行同时产出热更 release 与 APK，且 APK 用的是显式指定的 JDK。"""
        java = self.find_jdk17()
        with tempfile.TemporaryDirectory(prefix="city1001-apk-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            proj = seed_fake_gradle(root)
            publish_root = self.publish(root, data, ["--apk", "--gradle-jdk", str(java)])

            # 1) gradle 真被调用：任务名按 settings.gradle 里的模块名拼，JDK 被显式覆盖
            log = (proj / "gradle-invocation.txt").read_text(encoding="utf-8", errors="replace")
            self.assertIn(":zhanchengmaster:assembleRelease", log)
            self.assertIn(f"JAVA_HOME={java}".lower(), log.lower())
            self.assertIn("ANDROID_SDK_ROOT=", log)

            # 2) APK 归档到 outputs/apk/<release-id>/，文件名带上 release 便于对账
            archived = root / "outputs" / "apk" / RELEASE_ID / f"zhanchengmaster-release-{RELEASE_ID}.apk"
            self.assertTrue(archived.is_file(), f"没有归档 APK：{archived}")

            # 3) release 报告里带 APK 的哈希与体积
            report = json.loads(
                (publish_root / "hotupdate" / "android" / RELEASE_ID / "release-report.json")
                .read_text(encoding="utf-8")
            )
            self.assertIsNotNone(report["apk"])
            self.assertEqual(report["apk"]["gradleTask"], ":zhanchengmaster:assembleRelease")
            self.assertEqual(report["apk"]["variant"], "release")
            self.assertTrue(report["apk"]["rebuilt"], "本次确实重新打包了")
            self.assertEqual(report["apk"]["sha256"], hashlib.sha256(archived.read_bytes()).hexdigest())
            self.assertEqual(report["apk"]["bytes"], archived.stat().st_size)
            self.assertIn("gradle-", report["apk"]["gradleLog"])

    def test_no_apk_flag_skips_gradle_entirely(self) -> None:
        with tempfile.TemporaryDirectory(prefix="city1001-apk-off-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            data = seed_build(root)
            proj = seed_fake_gradle(root)
            publish_root = self.publish(root, data, ["--no-apk"])

            self.assertFalse(
                (proj / "gradle-invocation.txt").exists(), "--no-apk 时不应调用 gradle"
            )
            report = json.loads(
                (publish_root / "hotupdate" / "android" / RELEASE_ID / "release-report.json")
                .read_text(encoding="utf-8")
            )
            self.assertIsNone(report["apk"])
            self.assertFalse((root / "outputs" / "apk").exists(), "不该凭空产生 APK 目录")

    def test_apk_requires_jdk_17(self) -> None:
        """显式指定了不可用的 JDK 目录必须直接失败，而不是悄悄换一个 —— 否则"以为用的是 17"。"""
        with tempfile.TemporaryDirectory(prefix="city1001-apk-jdk-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)
            seed_fake_gradle(root)
            result = subprocess.run(
                self.command(root, ["--apk", "--gradle-jdk", str(root / "not-a-jdk")]),
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("JDK 17", result.stderr)
            self.assertIn("gradle-jdk", result.stderr)

    def test_stale_apk_is_not_mistaken_for_a_fresh_build(self) -> None:
        """gradle 报成功但没产出新 APK 时必须失败。

        把上一次留下的 APK 当成本次产物，是这条链路最阴的静默故障：
        发布照常成功、APK 也在，但里面是旧代码。所以先预置一个"旧包"，
        再让假 gradle 什么都不产出，此时必须明确失败。
        """
        java = self.find_jdk17()
        with tempfile.TemporaryDirectory(prefix="city1001-apk-stale-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)
            stale_dir = (
                root / "build" / "android" / "proj" / "build"
                / "zhanchengmaster" / "outputs" / "apk" / "release"
            )
            stale_dir.mkdir(parents=True)
            (stale_dir / "zhanchengmaster-release.apk").write_bytes(b"stale-apk-from-last-time")
            seed_fake_gradle(root, produce_apk=False)

            result = subprocess.run(
                self.command(root, ["--apk", "--gradle-jdk", str(java)]),
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("没找到 APK 产物", result.stderr)
            self.assertFalse((root / "outputs" / "apk").exists(), "失败时不应归档任何 APK")

    def test_interactive_menu_asks_for_apk(self) -> None:
        """双击菜单要单独问一次 APK，并把选择带进计划里。"""
        java = self.find_jdk17()
        with tempfile.TemporaryDirectory(prefix="city1001-apk-menu-") as temporary:
            root = Path(temporary)
            (root / "assets").mkdir()
            seed_build(root)
            seed_fake_gradle(root)
            command = self.command(root, ["--interactive", "--gradle-jdk", str(java)])
            command = [item for item in command if item != "--skip-build"]
            completed = subprocess.run(
                command,
                cwd=PROJECT_ROOT,
                # 3=仅发布；y=要 APK；n=取消
                input="3\ny\nn\n",
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("是否同时编译 APK", completed.stdout)
            self.assertIn("APK 将使用", completed.stdout)
            self.assertIn("编译 release 变体", completed.stdout)
            self.assertIn("已取消", completed.stdout)


if __name__ == "__main__":
    unittest.main()
