#!/usr/bin/env python3
"""构建并发布原生（Android / iOS）全构建目录热更新。

对齐 Cocos Creator 官方 `native.AssetsManager` 方案：

1. 用 Creator 构建原生包（**必须关闭 MD5 Cache**）；
2. 遍历构建产物里的 `src` / `assets` / `jsb-adapter`，逐文件算 md5，
   生成 `project.manifest`（含文件表）与 `version.manifest`（不含文件表）；
3. 把整份构建目录作为**不可变 release** 发布到静态根目录；
4. 写渠道控制文件（`project.manifest` / `version.manifest` / `latest.json`），
   最后一步才原子切换 `latest.json`。

清单生成复用 `tools/hotupdate/hotupdate_manifest.js`，与构建扩展共用同一实现，
避免"构建时随包清单"和"发布时远端清单"两边算法漂移。
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


NAME_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
RELEASE_ID_PATTERN = re.compile(r"^\d{8}-\d{6}-[A-Za-z0-9._-]+$")
PLATFORMS = ("android", "ios")
# 与 assets/script/core/update/HotUpdateTypes.ts 的 HOT_UPDATE_NATIVE_SCHEMA_VERSION 对齐
NATIVE_SCHEMA_VERSION = 2
MANIFEST_DIRECTORIES = ("src", "assets", "jsb-adapter")
SCHEMA_VERSION_FIELD = "schemaVersion"
# 与 extensions/hot-update/builder/inject.js 的 START_MARKER 必须一致
INJECTION_MARKER = "/* CITY1001_HOTUPDATE_INJECT_START */"
PACKAGED_MANIFEST = "project.manifest"

# --- 路径推导（全脚本唯一一处） ---------------------------------------------
# 本文件在 tools/hotupdate/ 下，工程根是"上上级"。
# 以前工程根在 parse_args 和注入函数里各推一次（都按 tools/ 顶层写的 parents 下标 1），
# 收进子目录时只改了一处、另一处静默指向 tools/ —— 报错里那个路径还"看起来存在"。
# 所以这里只留一个常量，凡是要工程根的地方都用它。
PROJECT_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = PROJECT_ROOT / "tools" / "hotupdate"

# --- Android APK 编译 -------------------------------------------------------
# Gradle 工程由 Creator 生成在 <build_dir>/proj，APK 里打进的就是 <build_dir>/data
# （见 native/engine/android/app/build.gradle 的 `assets.srcDir "${RES_PATH}/data"`）。
# 因此注入 main.js / 生成随包清单**必须排在 gradle 之前**，否则 APK 里那份是旧的。
GRADLE_PROJ_DIRNAME = "proj"
GRADLE_WRAPPER = "gradlew.bat"
# AGP 8.10.1（native/engine/android/build.gradle）+ Gradle 8.11.1 的兼容性表要求 JDK 17；
# Cocos 官方《v3.8 Android 工程升级》同样要求「将 JDK 升级到 17」。JDK 8/11 一律不行。
GRADLE_MIN_JDK = 17
DEFAULT_GRADLE_TIMEOUT = 3600.0
GRADLE_VARIANTS = ("release", "debug")
APK_VARIANT_TASK = {"release": "assembleRelease", "debug": "assembleDebug"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="构建并发布 Android/iOS 原生全构建目录热更新（官方 native.AssetsManager 方案）",
    )
    parser.add_argument("platform", nargs="?", choices=PLATFORMS, help="只允许 android 或 ios；省略时默认 android")
    parser.add_argument("--project-root", type=Path, default=PROJECT_ROOT)
    parser.add_argument("--creator", type=Path, help="CocosCreator 可执行文件；也可设置 COCOS_CREATOR_EXE")
    parser.add_argument("--skip-build", action="store_true", help="复用 Creator 中已经完成的构建")
    parser.add_argument("--build-dir", type=Path, help="目标平台构建目录，默认 build/<platform>")
    parser.add_argument("--publish-root", type=Path, help="静态服务器根目录，默认 HOTUPDATE_PUBLISH_ROOT 或 D:\\Share")
    parser.add_argument("--base-url", help="热更新 URL 根目录，默认从 hot_update.json 推导")
    parser.add_argument("--channel", default="dev")
    parser.add_argument("--release-id", help="默认自动生成 YYYYMMDD-HHMMSS-<platform>（时间戳前缀保证可比大小）")
    parser.add_argument("--client-version", help="默认读取 hot_update.json 的 clientVersion")
    parser.add_argument("--rollout", type=float, default=100.0, help="灰度百分比，0~100")
    parser.add_argument("--node", type=Path, help="node 可执行文件；也可设置 NODE_EXE")
    # 默认 None = 自动：构建目录里有 gradle 工程就编 APK。
    # 显式传 --apk 表示「必须编出来」，编不出直接失败；--no-apk 则完全跳过。
    parser.add_argument(
        "--apk",
        action=argparse.BooleanOptionalAction,
        default=None,
        help="是否同时编译 APK（默认：检测到 build/<platform>/proj 就编；--apk 强制必须成功、--no-apk 跳过）",
    )
    parser.add_argument("--apk-variant", choices=GRADLE_VARIANTS, default="release")
    parser.add_argument("--apk-out", type=Path, help="APK 归档目录，默认 <project_root>/outputs/apk/<release-id>")
    parser.add_argument("--gradle-jdk", type=Path, help=f"编译 APK 用的 JDK（必须 >= {GRADLE_MIN_JDK}）；也可设置 HOTUPDATE_GRADLE_JDK")
    parser.add_argument("--gradle-arg", action="append", default=[], help="追加给 gradle 的参数，可重复")
    parser.add_argument("--gradle-timeout", type=float, default=DEFAULT_GRADLE_TIMEOUT, help="gradle 编译超时（秒）")
    parser.add_argument("--keystore", type=Path, help="release 签名库；不传则用 gradle.properties 里已有的配置")
    parser.add_argument("--store-password", help="签名库口令（配合 --keystore）")
    parser.add_argument("--key-alias", help="签名别名（配合 --keystore）")
    parser.add_argument("--key-password", help="签名别名口令（配合 --keystore）")
    parser.add_argument("--android-sdk", type=Path, help="Android SDK 根目录；默认读 local.properties / ANDROID_HOME")
    parser.add_argument("--no-http-check", action="store_true", help="发布时不检查 HTTP 可访问性")
    parser.add_argument("--http-timeout", type=float, default=8.0)
    parser.add_argument(
        "--interactive",
        action="store_true",
        help="发布前先做环境预检并弹出选择菜单（tools\\hotupdate\\publish_hotupdate.bat 双击时自动带上）",
    )
    parser.add_argument("--pause", action="store_true", help="由 tools\\hotupdate\\publish_hotupdate.bat 使用，本脚本忽略")
    parser.add_argument("--no-pause", action="store_true", help="由 tools\\hotupdate\\publish_hotupdate.bat 使用，本脚本忽略")
    return parser.parse_args()


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def validate_name(value: str, label: str) -> str:
    if not NAME_PATTERN.fullmatch(value):
        fail(f"{label} 只能包含字母、数字、点、下划线和连字符：{value}")
    return value


def load_project_config(project_root: Path) -> dict:
    path = project_root / "assets" / "resources" / "config" / "hot_update.json"
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as stream:
        value = json.load(stream)
    return value if isinstance(value, dict) else {}


def derive_base_url(config: dict) -> str | None:
    template = config.get("latestUrlTemplate")
    suffix = "/{platform}/{channel}/latest.json"
    if isinstance(template, str) and template.endswith(suffix):
        return template[: -len(suffix)].rstrip("/")
    return None


def validate_base_url(value: str) -> str:
    value = value.rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        fail(f"base-url 必须是 HTTP(S) URL：{value}")
    if parsed.scheme == "http":
        host = parsed.hostname
        is_local = host == "localhost"
        if not is_local:
            try:
                is_local = ipaddress.ip_address(host).is_private or ipaddress.ip_address(host).is_loopback
            except ValueError:
                is_local = False
        if not is_local:
            fail("公网发布必须使用 HTTPS；HTTP 只允许 localhost 或局域网 IP")
    return value


def locate_creator(explicit: Path | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(explicit)
    env_value = os.environ.get("COCOS_CREATOR_EXE")
    if env_value:
        candidates.append(Path(env_value))
    if os.name == "nt":
        editor_root = Path(r"C:\ProgramData\cocos\editors\Creator")
        if editor_root.is_dir():
            candidates.extend(sorted(editor_root.glob("*/CocosCreator.exe"), reverse=True))
    else:
        candidates.extend(
            [
                Path("/Applications/Cocos/Creator/3.8.8/CocosCreator.app/Contents/MacOS/CocosCreator"),
                Path("/Applications/CocosCreator.app/Contents/MacOS/CocosCreator"),
            ]
        )
    for candidate in candidates:
        resolved = candidate.expanduser().resolve()
        if resolved.is_file():
            return resolved
    fail("找不到 CocosCreator。请使用 --creator 指定路径，或设置 COCOS_CREATOR_EXE")


def locate_node(explicit: Path | None) -> str:
    if explicit:
        resolved = explicit.expanduser().resolve()
        if not resolved.is_file():
            fail(f"--node 指向的文件不存在：{resolved}")
        return str(resolved)
    env_value = os.environ.get("NODE_EXE")
    if env_value and Path(env_value).is_file():
        return env_value
    found = shutil.which("node")
    if found:
        return found
    fail("找不到 node。请使用 --node 指定路径，或设置 NODE_EXE")


def resolve_build_data_root(build_dir: Path) -> Path:
    """原生构建里 main.js / src / assets / jsb-adapter 所在的那一层。"""
    if not build_dir.is_dir():
        fail(f"构建目录不存在：{build_dir}")
    candidates = [build_dir, build_dir / "data", build_dir / "assets"]
    for candidate in candidates:
        if (candidate / "main.js").is_file() and (candidate / "src").is_dir():
            return candidate
    fail(
        f"未在 {build_dir} 找到原生构建数据目录（需要含 main.js 与 src/）；"
        "请确认平台为 android/ios 且已构建成功"
    )


def newest_artifact_mtime(build_dir: Path) -> float | None:
    values = [path.stat().st_mtime for path in build_dir.rglob("main.js") if path.is_file()]
    return max(values) if values else None


def run_creator_build(creator: Path, project_root: Path, platform: str, build_dir: Path) -> None:
    before = newest_artifact_mtime(build_dir) if build_dir.exists() else None
    # 官方明确要求：原生热更新不能开 MD5 Cache，否则清单里的文件名会对不上产物。
    command = [
        str(creator),
        "--project",
        str(project_root),
        "--build",
        f"platform={platform};debug=false;md5Cache=false",
    ]
    print("[1/8] Creator 构建：", subprocess.list2cmdline(command))
    completed = subprocess.run(command, cwd=project_root, check=False)
    if completed.returncode != 0:
        fail(f"Creator 构建失败，退出码 {completed.returncode}")
    after = newest_artifact_mtime(build_dir) if build_dir.exists() else None
    if after is None or (before is not None and after <= before):
        fail(
            "Creator 命令结束后没有发现新的构建产物。若项目正在 Creator 中打开，"
            "请在编辑器内先构建，再加 --skip-build 运行发布。"
        )


# ---------------------------------------------------------------------------
# Android APK 编译
#
# 顺序上的硬约束：Creator 生成的 gradle 工程把 **<build_dir>/data 直接当作 APK 的
# assets**（native/engine/android/app/build.gradle 里的 `assets.srcDir "${RES_PATH}/data"`），
# 所以「注入 main.js + 生成随包清单」必须排在 gradle 之前，否则 APK 里打进的是旧脚本 ——
# 装到机器上就会「资源能下载、脚本永不生效」。
# ---------------------------------------------------------------------------

JAVA_VERSION_PATTERN = re.compile(r'version "(\d+)(?:\.(\d+))?')
GRADLE_PROGRESS_PATTERN = re.compile(r"^(> Task |BUILD SUCCESSFUL|BUILD FAILED|FAILURE:|.* error: )")


def parse_java_major(output: str) -> int | None:
    """从 `java -version` 输出里取主版本号。

    `17.0.4` -> 17；`1.8.0_502` 这种老写法要还原成 8，否则会被当成 1 而误判为「够新」。
    """
    match = JAVA_VERSION_PATTERN.search(output)
    if not match:
        return None
    major = int(match.group(1))
    if major == 1 and match.group(2):
        return int(match.group(2))
    return major


def java_major_of(java_home: Path) -> int | None:
    executable = java_home / "bin" / ("java.exe" if os.name == "nt" else "java")
    if not executable.is_file():
        return None
    try:
        completed = subprocess.run(
            [str(executable), "-version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return parse_java_major((completed.stderr or "") + (completed.stdout or ""))


def gradle_java_candidates() -> list[Path]:
    """按优先级列出候选 JDK 目录（不含 --gradle-jdk，那条是硬约束、单独处理）。

    JDK 版本要求见 GRADLE_MIN_JDK 的注释：AGP 8.10.1 硬性要求 17，
    而本机常见环境里 JAVA_HOME 恰恰是个 JDK 8（Cocos 编辑器旧配置遗留），
    直接交给 gradle 只会抛一句很难读的错，所以这里先把候选都试一遍。
    """
    candidates: list[Path] = []
    for name in ("HOTUPDATE_GRADLE_JDK", "GRADLE_JDK"):
        value = os.environ.get(name)
        if value:
            candidates.append(Path(value).expanduser())
    if os.environ.get("JAVA_HOME"):
        candidates.append(Path(os.environ["JAVA_HOME"]).expanduser())
    home = Path.home()
    patterns = (
        "Program Files/Java/jdk-*",
        "Program Files/Eclipse Adoptium/jdk-*",
        "Program Files/Microsoft/jdk-*",
        "Program Files/Android/Android Studio/jbr",
        ".jdks/*",
    )
    for pattern in patterns:
        for base in (home, Path("C:/"), Path("D:/")):
            try:
                candidates.extend(sorted(base.glob(pattern)))
            except OSError:
                continue
    seen: set[str] = set()
    unique: list[Path] = []
    for candidate in candidates:
        if not candidate.is_dir():
            continue
        key = os.path.normcase(str(candidate.resolve())) if candidate.exists() else str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def find_gradle_java_home(explicit: Path | None) -> tuple[Path | None, str]:
    """找满足 >= GRADLE_MIN_JDK 的 JDK。返回 (路径 或 None, 说明)。

    `--gradle-jdk` 是**硬约束**：显式指定了却不可用，就直接报错而不是偷偷换一个 ——
    否则「我以为用的是 17」和「实际用的是别的」会悄悄错开，排查起来很费劲。
    环境变量与自动扫描出来的候选则允许跳过无效项。
    """
    if explicit is not None:
        candidate = explicit.expanduser()
        major = java_major_of(candidate)
        if major is None:
            return None, f"--gradle-jdk 指向的目录里没有可用的 bin/java：{candidate}"
        if major < GRADLE_MIN_JDK:
            return None, f"--gradle-jdk 指定的是 JDK {major}，低于要求的 {GRADLE_MIN_JDK}：{candidate}"
        return candidate, f"JDK {major}：{candidate}"
    tried: list[str] = []
    for candidate in gradle_java_candidates():
        major = java_major_of(candidate)
        if major is None:
            tried.append(f"{candidate}（没有 bin/java）")
            continue
        if major >= GRADLE_MIN_JDK:
            return candidate, f"JDK {major}：{candidate}"
        tried.append(f"{candidate}（JDK {major}，低于 {GRADLE_MIN_JDK}）")
    detail = "；".join(tried) if tried else "没找到任何候选目录"
    return None, detail


JAVA_PROPERTY_ESCAPE_PATTERN = re.compile(r"\\(.)")


def read_java_properties(path: Path) -> dict[str, str]:
    """读 Java properties（gradle.properties / local.properties）。

    只取裸 `key=value`，够用；值里的 `\\:` 与 `\\\\` 要反转义 ——
    `local.properties` 里 Windows 路径就写成 `sdk.dir=D\\:\\\\Android\\\\Sdk`。
    """
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", "!")):
            continue
        key, separator, value = line.partition("=")
        if not separator:
            continue
        values[key.strip()] = JAVA_PROPERTY_ESCAPE_PATTERN.sub(r"\1", value.strip())
    return values


def read_app_module_name(proj: Path) -> str:
    """gradle 里的 app 模块名。

    settings.gradle 会把它改成 `project(':app').name = "zhanchengmaster"`，
    任务要写成 `:zhanchengmaster:assembleRelease`。
    """
    settings = proj / "settings.gradle"
    if settings.is_file():
        text = settings.read_text(encoding="utf-8", errors="replace")
        match = re.search(r"project\(':app'\)\.name\s*=\s*[\"']([^\"']+)[\"']", text)
        if match:
            return match.group(1)
    return "app"


def resolve_gradle_proj(build_dir: Path) -> Path:
    proj = build_dir / GRADLE_PROJ_DIRNAME
    if not (proj / GRADLE_WRAPPER).is_file():
        fail(f"没找到 gradle 工程（{proj / GRADLE_WRAPPER} 不存在），无法编译 APK")
    return proj


def resolve_android_sdk(proj: Path, explicit: Path | None) -> Path:
    """定位 Android SDK：显式参数 > local.properties > 环境变量 > 常见路径。"""
    candidates: list[tuple[str, Path]] = []
    if explicit is not None:
        candidates.append(("--android-sdk", explicit.expanduser()))
    declared = read_java_properties(proj / "local.properties").get("sdk.dir")
    if declared:
        candidates.append(("local.properties", Path(declared)))
    for name in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        value = os.environ.get(name)
        if value:
            candidates.append((name, Path(value)))
    candidates.append(("默认路径", Path(r"D:\Android\Sdk" if os.name == "nt" else "~/Android/Sdk")))
    tried: list[str] = []
    for label, candidate in candidates:
        if candidate.is_dir():
            return candidate.resolve()
        tried.append(f"{label}={candidate}")
    fail("找不到 Android SDK，请用 --android-sdk 指定，或设置 ANDROID_HOME。已尝试：" + "；".join(tried))


def resolve_android_ndk(sdk: Path, declared: str | None) -> tuple[Path | None, str]:
    """核对 gradle.properties 声明的 NDK 版本在 SDK 里是否真的存在。

    只用来提前给出人话告警：Cocos 模板写的是 `23.0.7196353-beta2`，
    而 SDK 目录名往往没有 `-beta2` 后缀，正式版目录也算命中。
    """
    ndk_root = sdk / "ndk"
    if not ndk_root.is_dir():
        return None, f"{ndk_root} 不存在"
    if not declared:
        return None, "gradle.properties 里没有 PROP_NDK_VERSION"
    for name in (declared, declared.split("-")[0]):
        candidate = ndk_root / name
        if candidate.is_dir():
            return candidate, ""
    available = sorted(entry.name for entry in ndk_root.iterdir() if entry.is_dir())
    return None, f"声明 {declared}，但 {ndk_root} 下只有：{', '.join(available) or '（空）'}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stash_stale_apks(proj: Path, module: str, variant: str) -> float | None:
    """把上一次的 APK 从 gradle 输出目录里挪走，返回它们中最新的 mtime。

    两个作用：
    1. gradle 的 up-to-date 判定包含「输出文件是否存在」，挪走旧包能确保打包任务真的重跑，
       而不是因为输入 hash 没变就跳过（跳过时我们会拿不到新包）；
    2. 之后若就地又出现一个 APK，它的 mtime 比这里的旧包新，才说明本次确实重新打包了。
    挪走而不是删除：万一 gradle 这轮失败，旧包还在，不至于什么都没有。
    """
    stale_root = proj / "build" / "_stale-apk"
    newest: float | None = None
    moved: list[Path] = []
    for directory in apk_search_dirs(proj, module, variant):
        if not directory.is_dir():
            continue
        for path in directory.glob("*.apk"):
            newest = path.stat().st_mtime if newest is None else max(newest, path.stat().st_mtime)
            moved.append(path)
    for index, path in enumerate(moved):
        try:
            stale_root.mkdir(parents=True, exist_ok=True)
            target = stale_root / f"{index}-{path.name}"
            if target.exists():
                target.unlink()
            path.replace(target)
        except OSError:
            pass
    if moved:
        print(f"        已挪开 {len(moved)} 个旧 APK 产物，确保本次重新打包")
    return newest


def apk_search_dirs(proj: Path, module: str, variant: str) -> list[Path]:
    return [
        proj / "build" / module / "outputs" / "apk" / variant,
        proj / "build" / module / "intermediates" / "apk" / variant,
    ]


def run_gradle_assemble(
    proj: Path,
    module: str,
    variant: str,
    java_home: Path,
    sdk: Path,
    gradle_args: list[str],
    timeout: float,
    log_path: Path,
    signing: dict[str, str],
) -> float:
    """跑 `gradlew :<module>:assemble<Release|Debug>`，返回耗时秒数。"""
    wrapper = proj / GRADLE_WRAPPER
    comspec = os.environ.get("COMSPEC") or "cmd.exe"
    task = f":{module}:{APK_VARIANT_TASK[variant]}"
    # --console=plain：关掉 ANSI 与进度条，日志更适合落盘与被 GRADLE_PROGRESS_PATTERN 过滤
    command = [comspec, "/c", str(wrapper), task, "--console=plain", *gradle_args]
    for key, value in signing.items():
        command.append(f"-P{key}={value}")
    env = dict(os.environ)
    # 关键：显式覆盖 JAVA_HOME。系统里那个 JAVA_HOME 很可能是指向 JDK 8 的，
    # gradle 会跟着它启动，然后在加载 AGP 时失败。
    env["JAVA_HOME"] = str(java_home)
    env["ANDROID_HOME"] = str(sdk)
    env["ANDROID_SDK_ROOT"] = str(sdk)
    print("[5/8] 编译 APK：", subprocess.list2cmdline(command))
    print(f"        JDK：{java_home}")
    print(f"        SDK：{sdk}")
    print(f"        日志：{log_path}")
    print("        （首次或改动过 C++ 时会比较久，请耐心等）", flush=True)

    log_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    deadline = started + timeout
    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        process = subprocess.Popen(
            command,
            cwd=str(proj),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        stream = process.stdout
        try:
            if stream is not None:
                for line in stream:
                    log.write(line)
                    stripped = line.rstrip()
                    if GRADLE_PROGRESS_PATTERN.match(stripped):
                        print(f"        {stripped[:140]}", flush=True)
                    if time.monotonic() > deadline:
                        process.kill()
                        fail(f"gradle 编译超过 {timeout:.0f} 秒仍未结束，已终止；日志：{log_path}")
        finally:
            if stream is not None:
                stream.close()
        returncode = process.wait()
    elapsed = time.monotonic() - started
    if returncode != 0:
        tail = "\n".join(log_path.read_text(encoding="utf-8", errors="replace").splitlines()[-25:])
        fail(f"gradle 编译失败（退出码 {returncode}，耗时 {elapsed:.0f}s）；完整日志：{log_path}\n{tail}")
    return elapsed


def locate_apk(proj: Path, module: str, variant: str, stale_mtime: float | None) -> tuple[Path, bool]:
    """找到刚编出来的 APK。返回 (路径, 是否是本次真正重新打包的)。

    正常情况下旧包已经被 stash_stale_apks 挪走，所以出现的一定是新的；
    万一 gradle 把包又从缓存里搬回来（没有真正跑打包），mtime 不会比旧包新，
    这时把 `fresh=False` 如实报出来，免得「以为重新编过了其实用的是旧包」。
    """
    found: list[Path] = []
    searched: list[str] = []
    for directory in apk_search_dirs(proj, module, variant):
        searched.append(str(directory))
        if not directory.is_dir():
            continue
        for path in directory.glob("*.apk"):
            name = path.name.lower()
            if "unaligned" in name or "androidtest" in name:
                continue
            found.append(path)
    if not found:
        fail("gradle 报成功，但没找到 APK 产物。已查找：\n  " + "\n  ".join(searched))
    found.sort(key=lambda path: path.stat().st_mtime, reverse=True)
    newest = found[0]
    if stale_mtime is None or newest.stat().st_mtime > stale_mtime:
        return newest, True
    stamp = datetime.fromtimestamp(newest.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    print(f"        gradle 判定输入没变、跳过了打包，沿用现有 APK（构建于 {stamp}）")
    return newest, False


def archive_apk(apk: Path, out_dir: Path, release_id: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{apk.stem}-{release_id}.apk"
    shutil.copy2(apk, target)
    return target


def resolve_signing(args: argparse.Namespace) -> dict[str, str]:
    """把签名参数转成 gradle `-P` 覆盖项（与 app/build.gradle 的属性名一致）。"""
    if args.keystore is None:
        if any((args.store_password, args.key_alias, args.key_password)):
            fail("只用 --store-password / --key-alias / --key-password 不生效，请一并传 --keystore")
        return {}
    keystore = args.keystore.expanduser()
    if not keystore.is_file():
        fail(f"签名库不存在：{keystore}")
    signing = {"RELEASE_STORE_FILE": str(keystore)}
    if args.store_password:
        signing["RELEASE_STORE_PASSWORD"] = args.store_password
    if args.key_alias:
        signing["RELEASE_KEY_ALIAS"] = args.key_alias
    if args.key_password:
        signing["RELEASE_KEY_PASSWORD"] = args.key_password
    return signing


def build_apk(
    project_root: Path,
    build_dir: Path,
    release_id: str,
    variant: str,
    java_home: Path,
    sdk_override: Path | None,
    apk_out: Path | None,
    gradle_args: list[str],
    timeout: float,
    signing: dict[str, str],
) -> dict:
    """编译 APK 并归档。返回写进 release-report 的 apk 段。"""
    proj = resolve_gradle_proj(build_dir)
    module = read_app_module_name(proj)
    properties = read_java_properties(proj / "gradle.properties")
    sdk = resolve_android_sdk(proj, sdk_override)
    ndk, ndk_note = resolve_android_ndk(sdk, properties.get("PROP_NDK_VERSION"))
    if ndk_note:
        print(f"        提示：NDK 未确认（{ndk_note}）")
        print("              若编译停在 CMake 阶段，先按 gradle.properties 的 PROP_NDK_VERSION 补装 NDK")
    stale = stash_stale_apks(proj, module, variant)
    log_path = project_root / "outputs" / "hotupdate-logs" / f"gradle-{release_id}.log"
    elapsed = run_gradle_assemble(
        proj, module, variant, java_home, sdk, gradle_args, timeout, log_path, signing,
    )
    apk, rebuilt = locate_apk(proj, module, variant, stale)
    out_dir = (apk_out.expanduser() if apk_out else project_root / "outputs" / "apk" / release_id)
    fresh_out_dir = not out_dir.exists()
    archived = archive_apk(apk, out_dir, release_id)
    digest = sha256_file(archived)
    size = archived.stat().st_size
    suffix = "" if rebuilt else "（gradle 判定无需重打包，沿用现有产物）"
    print(f"        APK：{archived}{suffix}")
    print(f"        {format_size(size)} / sha256 {digest[:16]}… / gradle 用时 {elapsed:.0f}s")
    if fresh_out_dir:
        # APK 是 100 MB 量级，进版本库就下不来了（SVN 删历史很难），第一次生成时提醒一次。
        print(f"        提示：{out_dir.parent} 若是受版本控制的目录，建议先执行")
        print(f'              svn propset svn:ignore apk "{out_dir.parent}"')
    return {
        "variant": variant,
        "module": module,
        "gradleTask": f":{module}:{APK_VARIANT_TASK[variant]}",
        "jdk": str(java_home),
        "sdk": str(sdk),
        "ndk": str(ndk) if ndk else None,
        "rebuilt": rebuilt,
        "gradleSeconds": round(elapsed, 1),
        "gradleLog": str(log_path),
        "source": str(apk),
        "path": str(archived),
        "bytes": size,
        "sha256": digest,
        "signed": bool(signing.get("RELEASE_STORE_FILE")),
    }


def inject_main_js(node: str, data_root: Path) -> dict:
    """确保 main.js 里有搜索路径恢复片段。

    构建扩展会在构建时注入；但 `--skip-build` 复用的可能是别人（或旧版扩展）产出的目录，
    缺了这一段热更会"下载成功但永不生效"，所以在发布前再兜一次，幂等。

    返回值里带 `injectedByBuild`：这一步动手**之前**产物里有没有片段。
    False 说明本次构建时构建扩展没生效（没装 / 没启用 / hooks 路径没解析到），
    这时发布树是好的，但**打进安装包的那份 main.js 是旧的**，装到机器上也热更不了 ——
    调用方需要把这件事喊出来。
    """
    script = PROJECT_ROOT / "extensions" / "hot-update" / "builder" / "inject.js"
    if not script.is_file():
        fail(f"缺少注入脚本：{script}")
    main_js = data_root / "main.js"
    injected_by_build = main_js.is_file() and INJECTION_MARKER in main_js.read_text(encoding="utf-8", errors="replace")
    targets = [main_js]
    legacy = data_root / "data" / "main.js"
    if legacy.is_file():
        targets.append(legacy)
    completed = subprocess.run(
        [node, str(script)] + [str(target) for target in targets],
        cwd=str(script.parent.parent.parent),
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.returncode != 0:
        fail(f"注入 main.js 失败：{completed.stderr.strip() or completed.stdout.strip()}")
    try:
        outcome = json.loads(completed.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        fail(f"注入脚本输出无法解析：{completed.stdout.strip()}")
    outcome["injectedByBuild"] = injected_by_build
    print(f"[3/8] main.js 恢复片段：新注入 {len(outcome.get('injected', []))} 个，已存在 {len(outcome.get('unchanged', []))} 个")
    return outcome


def warn_if_build_extension_skipped(injection: dict, packaged_manifest_by_build: bool) -> None:
    """构建扩展没生效时把话说清楚。

    本脚本会在发布前补上注入片段与随包清单，**这恰好会把「构建时扩展没跑」这件事盖住**：
    发布树是完整可用的，但安装包（APK / IPA）里那份 main.js 仍然没有恢复片段、
    也没有随包 project.manifest。装到机器上的表现是：
      - 没有随包清单 -> 客户端直接报「找不到随包 project.manifest，无法进行原生热更」；
      - 没有恢复片段 -> 即使资源下载成功，引擎仍从安装包读旧脚本，改了代码不生效。
    这种包只能靠**重新构建**救，重发资源救不了，所以要在这里喊出来。
    """
    missing: list[str] = []
    if not injection.get("injectedByBuild"):
        missing.append("main.js 里没有搜索路径恢复片段")
    if not packaged_manifest_by_build:
        missing.append(f"没有随包 {PACKAGED_MANIFEST}")
    if not missing:
        return
    print("\n".join([
        "",
        "=" * 78,
        "[警告] 本次构建产物说明：构建扩展当时没生效 —— " + "；".join(missing),
        "       本脚本已经把这两样补进构建目录，所以**发布树是好的**；",
        "       但安装包（APK / IPA）里那份是构建当时的，装到机器上无法热更，",
        "       而且这个故障只会在真机运行时暴露，构建过程完全无报错。",
        "       请依次检查：",
        "         1) 扩展是否已被编辑器加载：扩展 -> 扩展管理器 -> 项目 -> hot-update；",
        "         2) 是否处于启用状态，以及是否点过「重新载入」；",
        "         3) 新装扩展后是否重启过编辑器（主进程脚本只在编辑器启动时加载）。",
        "       正常构建日志里应当能看到这三行：",
        "         [hot-update] 构建钩子已载入（hook.js 被构建进程 require 成功）",
        "         [hot-update] 已注入搜索路径恢复片段：build/<platform>/data/main.js",
        "         [hot-update] 已生成随包 project.manifest：<文件数> 个文件 / <字节> 字节 / 版本 <版本>",
        "=" * 78,
        "",
    ]))


def generate_manifests(
    node: str,
    data_root: Path,
    release_id: str,
    release_base: str,
    channel_base: str,
    output_dir: Path,
    client_version: str,
) -> dict:
    """调用共享的 Node 生成器，一次产出 release / channel / 随包三份清单所需的全部内容。"""
    # 生成器跟着本脚本走（而不是跟着 --project-root），这样发布脚本可以被复用到任意工程根。
    script = TOOLS_DIR / "hotupdate_manifest.js"
    if not script.is_file():
        fail(f"缺少清单生成器：{script}")
    command = [
        node,
        str(script),
        "--src",
        str(data_root),
        "--version",
        release_id,
        "--package-url",
        release_base,
        # 用来看"远端清单"的地址是渠道目录：客户端每次启动都从渠道目录取最新清单，
        # 而 packageUrl 指向不可变 release 目录，已下载文件才能被复用。
        "--remote-manifest-url",
        f"{channel_base}project.manifest",
        "--remote-version-url",
        f"{channel_base}version.manifest",
        # 随包清单指向渠道目录，而不是某个 release。
        "--local-package-url",
        channel_base,
        # 随包清单的版本用**客户端版本号**，不是 releaseId：它描述的是"打进安装包的那份内容"。
        # 两者都走 release-stamp 全序比较，包内版本恒早于后续 release，首次启动照常进文件级比对。
        "--local-version",
        client_version,
        "--in-place",
        "true",
        "--dest",
        str(output_dir),
    ]
    print(f"[4/8] 生成官方清单：{len(MANIFEST_DIRECTORIES)} 个子目录逐文件 md5")
    completed = subprocess.run(command, cwd=str(script.parent.parent), capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        fail(f"清单生成失败：{completed.stderr.strip() or completed.stdout.strip()}")
    try:
        return json.loads(completed.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        fail(f"清单生成器输出无法解析：{completed.stdout.strip()}")


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def write_json(path: Path, value: object) -> bytes:
    data = json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch_bytes(url: str, timeout: float) -> bytes:
    request = urllib.request.Request(
        f"{url}{'&' if '?' in url else '?'}_publish_check={time.time_ns()}",
        headers={"Cache-Control": "no-cache", "User-Agent": "City1001-HotUpdate-Publisher/2.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            fail(f"HTTP 校验失败：{response.status} {url}")
        return response.read()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{uuid.uuid4().hex}")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def publish_release(publish_root: Path, platform: str, release_id: str, data_root: Path) -> Path:
    """把整份构建目录搬到不可变 release 目录；已存在即拒绝，保证可回滚。"""
    platform_root = publish_root / "hotupdate" / platform
    release_dir = platform_root / release_id
    if release_dir.exists():
        fail(f"发布目录已存在，不允许覆盖不可变 Release：{release_dir}")
    platform_root.mkdir(parents=True, exist_ok=True)
    temporary = platform_root / f".{release_id}.tmp-{uuid.uuid4().hex}"
    try:
        shutil.copytree(data_root, temporary)
        os.replace(temporary, release_dir)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return release_dir


def publish_channel(channel_root: Path, release_dir: Path, latest_path: Path, latest_data: bytes) -> None:
    """先铺渠道清单，最后一步才原子切 latest.json —— 保证玩家拉到的清单一定对应已存在的文件。"""
    channel_root.mkdir(parents=True, exist_ok=True)
    for name in ("project.manifest", "version.manifest"):
        source = release_dir / name
        if not source.is_file():
            fail(f"Release 目录缺少 {name}：{source}")
        shutil.copy2(source, channel_root / name)
    atomic_write(latest_path, latest_data)


def main() -> int:
    args = parse_args()
    project_root = args.project_root.expanduser().resolve()
    if not (project_root / "assets").is_dir():
        fail(f"无效的 Cocos 工程目录：{project_root}")
    channel = validate_name(args.channel, "channel")
    if not 0 <= args.rollout <= 100:
        fail("rollout 必须在 0~100 之间")

    config = load_project_config(project_root)
    client_version = args.client_version or config.get("clientVersion")
    if not isinstance(client_version, str) or not client_version.strip():
        fail("缺少 client-version；请配置 hot_update.json 或传入 --client-version")
    client_version = client_version.strip()
    base_url = validate_base_url(args.base_url or derive_base_url(config) or "")
    publish_root = (
        args.publish_root
        or Path(os.environ.get("HOTUPDATE_PUBLISH_ROOT", r"D:\Share" if os.name == "nt" else "./publish"))
    ).expanduser().resolve()

    # 平台 / release-id 都要等交互式菜单（bat 双击）选完才能定下来，
    # 所以这里先解出"非交互"的默认值，再让菜单覆盖。
    platform: str | None = args.platform
    skip_build = args.skip_build
    apk_request = args.apk
    interactive_release_id: str | None = None
    if args.interactive:
        selection = run_interactive(
            project_root=project_root,
            base_url=base_url,
            publish_root=publish_root,
            client_version=client_version,
            requested_release_id=args.release_id,
            channel=channel,
            build_dir_override=args.build_dir,
            apk_default=args.apk is not False,
        )
        if selection is None:
            return 0
        platform, skip_build, interactive_release_id, apk_request = selection
    if not platform:
        platform = "android"

    release_id = validate_name(
        interactive_release_id or args.release_id or default_release_id(platform),
        "release-id",
    )
    # 客户端按 releaseId 的时间戳前缀比较"包内 / 已缓存 / 远端"谁更新，
    # 命名不带时间戳前缀会让缓存复用判错（每次启动全量重下）。
    if not RELEASE_ID_PATTERN.fullmatch(release_id):
        fail(f"release-id 必须是 YYYYMMDD-HHMMSS-<后缀> 形式（保证可比大小）：{release_id}")

    build_dir = (args.build_dir or project_root / "build" / platform).expanduser().resolve()

    release_base = f"{base_url}/{platform}/{release_id}/"
    channel_base = f"{base_url}/{platform}/{channel}/"

    # APK 只能在 android 上编（iOS 要走 Xcode，本脚本暂不接）。
    gradle_java: Path | None = None
    want_apk = False
    apk_skip_reason = "本次不编译（--no-apk 或菜单里选了否）"
    if apk_request is not False:
        if platform != "android":
            apk_skip_reason = f"{platform} 平台不编译 APK（iOS 出 IPA 需要 Xcode，本脚本暂未接入）"
            if apk_request:
                print(f"[提示] {apk_skip_reason}")
        elif apk_request is None and not (build_dir / GRADLE_PROJ_DIRNAME / GRADLE_WRAPPER).is_file():
            # 自动模式：没有 gradle 工程就跳过 —— --skip-build 复用别人给的数据目录时很常见。
            apk_skip_reason = "自动模式：构建目录里没有 gradle 工程（要强制编译请显式加 --apk）"
        else:
            # JDK 与构建产物无关，能提前判掉 —— 免得 Creator 白构建一轮才报错。
            gradle_java, java_note = find_gradle_java_home(args.gradle_jdk)
            if gradle_java is None:
                if apk_request:
                    fail(
                        f"要编译 APK，但没有找到 JDK {GRADLE_MIN_JDK} 或更高版本。检查结果：{java_note}\n"
                        f"  AGP 8.10.1 + Gradle 8.11.1 要求 JDK {GRADLE_MIN_JDK}"
                        "（Cocos 官方《v3.8 Android 工程升级》同口径）。\n"
                        r'  可用 --gradle-jdk "C:\Program Files\Java\jdk-17" 指定，或设置 HOTUPDATE_GRADLE_JDK'
                    )
                apk_skip_reason = f"没有找到 JDK {GRADLE_MIN_JDK}+（{java_note}）"
            else:
                want_apk = True
                print(f"APK 使用 {java_note}")

    if skip_build:
        print(f"[1/8] 跳过 Creator 构建，使用：{build_dir}")
    else:
        run_creator_build(locate_creator(args.creator), project_root, platform, build_dir)

    data_root = resolve_build_data_root(build_dir)
    staging_root = project_root / "outputs" / "hotupdate-staging" / release_id
    if staging_root.exists():
        fail(f"本地 staging 已存在，请更换 release-id：{staging_root}")
    staging_root.mkdir(parents=True, exist_ok=False)

    print(f"[2/8] 构建数据根目录：{data_root}")
    # 同理：这一步动手之前产物里有没有随包清单，代表构建扩展有没有跑过
    packaged_manifest_by_build = (data_root / PACKAGED_MANIFEST).is_file()
    node = locate_node(args.node)
    injection = inject_main_js(node, data_root)
    outcome = generate_manifests(
        node,
        data_root,
        release_id,
        release_base,
        channel_base,
        staging_root,
        client_version.strip(),
    )
    warn_if_build_extension_skipped(injection, packaged_manifest_by_build)

    # --- [5/8] APK ---------------------------------------------------------
    # 必须排在这一步：gradle 工程把 <build_dir>/data 直接当作 APK 的 assets，
    # 所以上面的注入与随包清单必须先落地，APK 里打进去的才是同一份内容。
    apk_report: dict | None = None
    if want_apk:
        assert gradle_java is not None
        apk_report = build_apk(
            project_root=project_root,
            build_dir=build_dir,
            release_id=release_id,
            variant=args.apk_variant,
            java_home=gradle_java,
            sdk_override=args.android_sdk,
            apk_out=args.apk_out,
            gradle_args=list(args.gradle_arg),
            timeout=args.gradle_timeout,
            signing=resolve_signing(args),
        )
    else:
        print(f"[5/8] 跳过 APK 编译：{apk_skip_reason}")

    project_manifest_bytes = (staging_root / "project.manifest").read_bytes()
    version_manifest_bytes = (staging_root / "version.manifest").read_bytes()
    project_sha = sha256_bytes(project_manifest_bytes)
    version_sha = sha256_bytes(version_manifest_bytes)

    latest = {
        SCHEMA_VERSION_FIELD: NATIVE_SCHEMA_VERSION,
        "releaseId": release_id,
        "platform": platform,
        "channel": channel,
        "minClientVersion": client_version.strip(),
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "packageUrl": release_base,
        "remoteManifestUrl": f"{channel_base}project.manifest",
        "remoteVersionUrl": f"{channel_base}version.manifest",
        "projectManifestSha256": f"sha256:{project_sha}",
        "versionManifestSha256": f"sha256:{version_sha}",
        "rolloutPercentage": args.rollout,
        "rolloutSalt": release_id,
        "fileCount": outcome.get("fileCount"),
        "totalBytes": outcome.get("totalBytes"),
    }
    latest_data = json_bytes(latest)
    write_json(staging_root / "release-report.json", {
        "platform": platform,
        "releaseId": release_id,
        "clientVersion": client_version.strip(),
        "dataRoot": str(data_root),
        "releaseBase": release_base,
        "channelBase": channel_base,
        "projectManifestSha256": project_sha,
        "versionManifestSha256": version_sha,
        "fileCount": outcome.get("fileCount"),
        "totalBytes": outcome.get("totalBytes"),
        "directories": list(MANIFEST_DIRECTORIES),
        "apk": apk_report,
    })

    print(f"[6/8] 发布不可变 Release（完整 src/assets/jsb-adapter）：{release_root_hint(publish_root, platform, release_id)}")
    release_dir = publish_release(publish_root, platform, release_id, data_root)
    for name in ("project.manifest", "version.manifest", "release-report.json"):
        shutil.copy2(staging_root / name, release_dir / name)

    channel_root = publish_root / "hotupdate" / platform / channel
    latest_path = channel_root / "latest.json"
    print(f"[7/8] 写渠道控制文件并原子切换 latest.json：{channel_root}")
    publish_channel(channel_root, release_dir, latest_path, latest_data)

    if not args.no_http_check:
        print("[8/8] HTTP 校验")
        remote_latest = json.loads(fetch_bytes(f"{channel_base}latest.json", args.http_timeout))
        if remote_latest.get("releaseId") != release_id:
            fail("latest.json HTTP 校验失败：releaseId 不一致")
        if sha256_bytes(fetch_bytes(f"{channel_base}project.manifest", args.http_timeout)) != project_sha:
            fail("服务器上的 channel/project.manifest 与本地不一致")
        if sha256_bytes(fetch_bytes(f"{channel_base}version.manifest", args.http_timeout)) != version_sha:
            fail("服务器上的 channel/version.manifest 与本地不一致")
    else:
        print("[8/8] 跳过 HTTP 校验")

    print()
    print("发布完成")
    print(f"  platform  : {platform}")
    print(f"  release   : {release_id}")
    print(f"  channel   : {channel}")
    print(f"  files     : {release_dir}")
    print(f"  随包清单   : {data_root / 'project.manifest'}（已写入构建目录，随包发给客户端）")
    if apk_report:
        rebuilt = "" if apk_report["rebuilt"] else "（未重新打包，沿用现有产物）"
        print(f"  APK       : {apk_report['path']}{rebuilt}")
        print(f"              {format_size(apk_report['bytes'])} / sha256 {apk_report['sha256'][:16]}…")
    else:
        print("  APK       : 本次未编译")
    print(f"  latest    : {channel_base}latest.json")
    print(f"  体积       : {outcome.get('fileCount')} 个文件 / {outcome.get('totalBytes')} 字节")
    return 0


def release_root_hint(publish_root: Path, platform: str, release_id: str) -> Path:
    return publish_root / "hotupdate" / platform / release_id


# ---------------------------------------------------------------------------
# 交互式预检：只有 bat 双击（无参数）时才会进来
#
# 为什么这一段在 Python 而不在 bat 里：cmd 是按字节 + 当前代码页解析 bat 的，
# 文件里只要出现非 ASCII，`goto` 跳标签时就会落在多字节字符中间，半行被当成命令，
# 报出 `'lish_hotupdate.bat' 不是内部或外部命令` 这类和真实原因完全无关的错。
# UTF-8（含/不含 BOM）与 GBK 三种写法、配 CRLF，实测都会踩。
# 所以 tools\hotupdate\publish_hotupdate.bat 保持纯 ASCII，中文交互全部交给这里。
# 守卫用例：tests/test_publish_hotupdate.py  test_bat_entry_is_ascii_only
# ---------------------------------------------------------------------------


def default_release_id(platform: str) -> str:
    return f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{platform}"


def format_size(value: float) -> str:
    if value < 1024:
        return f"{int(value)} B"
    if value < 1024 ** 2:
        return f"{value / 1024:.1f} KB"
    if value < 1024 ** 3:
        return f"{value / 1024 ** 2:.1f} MB"
    return f"{value / 1024 ** 3:.1f} GB"


def probe_editor_running() -> bool:
    """CocosCreator.exe 是否在跑。

    编辑器开着的时候用命令行构建会去抢同一个工程，所以这个信息决定智能模式
    是"复用现有产物"还是"先构建"。
    """
    if os.name != "nt":
        return False
    try:
        completed = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq CocosCreator.exe", "/NH"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return "CocosCreator.exe" in (completed.stdout or "")


def probe_server(base_url: str, timeout: float = 1.5) -> bool:
    """热更地址上的静态服务是否在监听（发布后的 HTTP 校验依赖它）。"""
    parsed = urlparse(base_url)
    if not parsed.hostname:
        return False
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((parsed.hostname, port), timeout=timeout):
            return True
    except OSError:
        return False


def survey_publish_root(publish_root: Path, platform: str) -> tuple[int, int, float | None]:
    """统计 (release 目录数, 渠道目录数, 剩余磁盘字节)。

    发布根里的 release 很大（实测一份约 100 MB），发之前先说清容量，
    免得撞上磁盘满 —— 那时脚本会以"复制失败"的形式挂掉，很难归因。
    """
    platform_root = publish_root / "hotupdate" / platform
    releases = 0
    channels = 0
    if platform_root.is_dir():
        for entry in sorted(platform_root.iterdir()):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            if RELEASE_ID_PATTERN.fullmatch(entry.name):
                releases += 1
            else:
                channels += 1
    probe = publish_root
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    free: float | None = None
    try:
        free = float(shutil.disk_usage(probe).free)
    except OSError:
        free = None
    return releases, channels, free


def describe_artifact(build_dir: Path) -> str:
    """现有构建产物的描述；没有可用产物时返回空串。"""
    try:
        data_root = resolve_build_data_root(build_dir)
    except RuntimeError:
        return ""
    main_js = data_root / "main.js"
    try:
        stamp = datetime.fromtimestamp(main_js.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
    except OSError:
        return str(data_root)
    return f"{main_js}   构建于 {stamp}"


MODE_LABEL_BUILD = "重新构建后再发布"
MODE_LABEL_REUSE = "仅发布（复用现有产物）"


def run_interactive(
    project_root: Path,
    base_url: str,
    publish_root: Path,
    client_version: str,
    requested_release_id: str | None,
    channel: str,
    build_dir_override: Path | None,
    apk_default: bool = True,
) -> tuple[str, bool, str, bool] | None:
    """弹菜单 + 预检 + 让用户确认。返回 (platform, skip_build, release_id, want_apk)，取消则返回 None。"""
    editor = probe_editor_running()
    server = probe_server(base_url)

    while True:
        print()
        print("=" * 78)
        print("  占城大师 · 原生热更新 打包发布")
        print("=" * 78)
        print(f"  工程目录      ：{project_root}")
        print(f"  热更地址      ：{base_url}/<平台>/{channel}/")
        print(f"  发布根目录    ：{publish_root}")
        print(f"  编辑器        ：{'正在运行' if editor else '未运行'}")
        if editor:
            print("                  （命令行构建会与编辑器抢工程，智能模式因此改为复用现有产物）")
        print(f"  静态服务器    ：{'在监听，发布后有 HTTP 校验' if server else '没在监听，发布后的 HTTP 校验会失败'}")
        print(f"  客户端版本    ：{client_version}")
        print("-" * 78)
        print("  [1] Android 智能模式（推荐）：编辑器开着就复用现有产物，没开就先构建")
        print("  [2] Android 强制重新构建后再发布")
        print("  [3] Android 仅发布，复用 build 目录里现有产物")
        print("  [4] iOS 智能模式")
        print("  [0] 退出")
        print("-" * 78)
        try:
            choice = input("请选择 [1]: ").strip() or "1"
        except EOFError:
            choice = "0"

        if choice == "0":
            print("已取消，未做任何改动。")
            return None
        if choice == "1":
            platform, mode = "android", "auto"
        elif choice == "2":
            platform, mode = "android", "build"
        elif choice == "3":
            platform, mode = "android", "reuse"
        elif choice == "4":
            platform, mode = "ios", "auto"
        else:
            print("  输入无法识别，请重新选择。")
            continue

        build_dir = (build_dir_override or project_root / "build" / platform).expanduser().resolve()
        artifact = describe_artifact(build_dir)

        if mode == "auto":
            if editor and not artifact:
                print(f"  编辑器正在运行，而 {build_dir} 里没有可复用产物 —— 请先在编辑器里构建一次，")
                print("  或者直接选 [2] 让命令行构建去试（编辑器开着时可能失败）。")
                continue
            mode = "reuse" if editor else "build"

        if mode == "reuse" and not artifact:
            print(f"  {build_dir} 里没有可复用的原生产物（需要含 main.js 与 src\\），请改用构建模式。")
            continue
        if mode == "build" and editor:
            print("  提醒：编辑器正在运行，命令行构建可能抢不到工程；若失败请改用 [3]。")

        releases, channels, free = survey_publish_root(publish_root, platform)
        release_id = requested_release_id or default_release_id(platform)
        label = MODE_LABEL_REUSE if mode == "reuse" else MODE_LABEL_BUILD
        if mode == "build" and artifact:
            label = f"{MODE_LABEL_BUILD}（会覆盖上面那份旧产物）"

        # APK 编译很费时间（首次要过一遍 C++ 的 CMake），所以单独问一次，
        # 而不是闷头跑十几分钟。
        want_apk = False
        if platform == "android":
            try:
                apk_answer = input(f"是否同时编译 APK？[{'Enter=是' if apk_default else 'Enter=否'}/y/n]: ").strip().lower()
            except EOFError:
                apk_answer = ""
            if apk_answer in ("", "enter"):
                want_apk = apk_default
            else:
                want_apk = apk_answer in ("y", "yes", "1")
            if want_apk:
                java_home, java_note = find_gradle_java_home(None)
                if java_home is None:
                    print(f"  没找到 JDK {GRADLE_MIN_JDK}+，无法编译 APK：{java_note}")
                    print("  本机可用的 JDK 17 一般在 \"C:\\Program Files\\Java\\jdk-17\" 或 %USERPROFILE%\\.jdks\\ 下。")
                    want_apk = False
                else:
                    print(f"  APK 将使用 {java_note}")

        print()
        print("-" * 78)
        print(f"  平台          ：{platform}")
        print(f"  方式          ：{label}")
        print(f"  现有产物      ：{artifact or '没有，本次会新建'}")
        print(f"  发布根目录    ：{publish_root}")
        print(f"  渠道          ：{channel}   本次会改写该渠道的 latest.json 指针")
        print(f"  已有内容      ：{releases} 个 release / {channels} 个渠道目录")
        if free is not None:
            print(f"  剩余空间      ：{format_size(free)}")
        print(f"  release-id    ：{release_id}")
        if platform == "android":
            print(f"  APK           ：{'编译 release 变体（含注入后的 main.js 与随包清单）' if want_apk else '不编译'}")
        print("-" * 78)
        if mode == "reuse":
            print("  复用模式下，发布内容完全取决于上面那份产物的时间戳，请确认就是它。")

        try:
            answer = input("按上面的设置执行 [Enter 继续 / N 取消]: ").strip().lower()
        except EOFError:
            answer = "n"
        if answer in ("n", "no", "0", "q"):
            print("已取消，未做任何改动。")
            return None
        return platform, mode == "reuse", release_id, want_apk


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"\n发布失败：{error}", file=sys.stderr)
        raise SystemExit(1)
