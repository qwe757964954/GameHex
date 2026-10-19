"""Shared validation for editor presets and the resource copy command."""

import math
import re


ID_PATTERN = re.compile(r"[A-Za-z0-9_-]+")

# 各版本字符画允许的 token；`#` / `-` / `N` 是 v1/v2 的分区别名。
TOKEN_PATTERN = {
    1: re.compile(r"[^.#-]"),
    2: re.compile(r"[^.#N-]"),
    3: re.compile(r"[^.#N01234-]"),
}
ALLOWED_TEXT = {1: ".#-", 2: ".#N-", 3: ".01234（# / - / N 为别名）"}


def valid_id(value):
    return isinstance(value, str) and ID_PATTERN.fullmatch(value) is not None


def validate_preset(data, preset_id):
    if not isinstance(data, dict) or data.get("id") != preset_id:
        raise ValueError("地图 id 与文件名不一致")

    version = data.get("version", 1)
    if type(version) is not int or version not in (1, 2, 3):
        raise ValueError("地图版本只支持 1、2 或 3")

    rows = data.get("rows")
    columns = data.get("columns")
    max_columns = 60 if version >= 3 else 30
    if (type(rows) is not int or not 4 <= rows <= 60 or (version <= 2 and rows % 2)
            or type(columns) is not int or not 4 <= columns <= max_columns):
        raise ValueError("地图尺寸必须为 4~60 列、4~60 行" if version >= 3
                         else "地图尺寸必须为 4~30 列、4~60 偶数行")

    player_count = data.get("playerCount", 2)
    if type(player_count) is not int or player_count not in (2, 3, 4):
        raise ValueError("对局人数必须是 2、3 或 4")
    city_mode = data.get("cityMode", "fixed")
    if city_mode not in ("fixed", "select"):
        raise ValueError("主城模式必须是 fixed（固定主城）或 select（自选主城）")

    mirror_vertical = data.get("mirrorVertical") is True
    mirror_horizontal = data.get("mirrorHorizontal") is True
    mirror_180 = data.get("mirror180") is True
    if mirror_180 and (mirror_vertical or mirror_horizontal):
        raise ValueError("不能同时使用 180° 旋转镜像与上下 / 左右镜像")

    # 3 人必须不镜像。与编辑器 app.js 的 forcedMirror 同口径 —— 编辑器、网页服务、预设生成
    # 三处都要守，否则绕开编辑器就能塞进不合规的图。
    # 2 人**不锁**：上下镜像默认开、可自行关闭（摆非对称装饰时要关得掉）。关掉时 ascii 存整场，
    # 下面的 expected_rows 按 mirror_vertical 现算，两种都成立。
    forced = {3: (False, False)}.get(player_count)
    if forced and ((mirror_vertical, mirror_horizontal) != forced or mirror_180):
        raise ValueError("3 人地图必须关闭镜像（3 是奇数，翻转配不出第三块分区）")
    # 2 人的 180° 与"锁不锁镜像"无关，单独拦：它把 1 区转到对角，不是上下对折。
    if player_count == 2 and mirror_180:
        raise ValueError("2 人地图不能用 180° 旋转镜像（会把 1 区转到对角，要用就用上下镜像）")

    # 镜像开启时只存 1 区所在的象限；列压缩自 v3 起生效。
    ascii_rows = data.get("ascii")
    if mirror_180:
        expected_rows = rows // 2
    elif mirror_vertical:
        expected_rows = math.ceil(rows / 2)
    else:
        expected_rows = rows
    expected_columns = math.ceil(columns / 2) if (version >= 3 and mirror_horizontal) else columns
    invalid = TOKEN_PATTERN[version]
    if (not isinstance(ascii_rows, list) or len(ascii_rows) != expected_rows
            or any(not isinstance(line, str) or len(line) != expected_columns or invalid.search(line)
                   for line in ascii_rows)):
        raise ValueError(f"字符画必须是 {expected_rows} 行 × {expected_columns} 列的 {ALLOWED_TEXT[version]}")

    homes = []
    listed = data.get("homes") if isinstance(data.get("homes"), list) and data["homes"] else None
    if city_mode == "fixed":
        if listed is None:
            legacy = (data.get("playerHome"), data.get("enemyHome"))
            listed = list(legacy) if all(isinstance(item, dict) for item in legacy) else []
        if len(listed) != player_count:
            raise ValueError(f"固定主城模式每方恰好一座主城，本图应为 {player_count} 座")
    # select 模式下 homes 是可选的「默认主城」：玩家超时未选 / AI 自动确认时落到这里；
    # 缺省则随机选合法格。
    if listed is not None and len(listed) not in (0, player_count):
        raise ValueError(f"自选主城模式的默认主城应为 {player_count} 座（或留空）")
    for home in listed or []:
        if home is None:
            # select 模式下 null 占位，下标对应分区；fixed 模式不允许。
            if city_mode == "fixed":
                raise ValueError("主城坐标不在地图内")
            homes.append(None)
            continue
        if (not isinstance(home, dict) or type(home.get("row")) is not int
                or type(home.get("column")) is not int
                or not 0 <= home["row"] < rows or not 0 <= home["column"] < columns):
            raise ValueError("主城坐标不在地图内")
        homes.append({"row": home["row"], "column": home["column"]})

    art = data.get("art")
    free_decor = art.get("freeDecor") if isinstance(art, dict) else None
    if free_decor is not None:
        if not isinstance(free_decor, list):
            raise ValueError("art.freeDecor 必须是数组")

        def finite_number(value):
            return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)

        for index, item in enumerate(free_decor):
            if not isinstance(item, dict):
                raise ValueError(f"自由装饰 {index} 必须是对象")
            if not isinstance(item.get("art"), str) or not item["art"].strip():
                raise ValueError(f"自由装饰 {index} 缺少资源名")
            if not finite_number(item.get("x")) or not finite_number(item.get("y")):
                raise ValueError(f"自由装饰 {index} 坐标无效")
            if (not finite_number(item.get("width")) or item["width"] <= 0
                    or not finite_number(item.get("height")) or item["height"] <= 0):
                raise ValueError(f"自由装饰 {index} 尺寸无效")
            if "rotation" in item and not finite_number(item["rotation"]):
                raise ValueError(f"自由装饰 {index} 角度无效")
            if (("flipX" in item and not isinstance(item["flipX"], bool))
                    or ("flipY" in item and not isinstance(item["flipY"], bool))):
                raise ValueError(f"自由装饰 {index} 翻转值无效")

    name = data.get("name")
    preset = {
        "id": preset_id,
        "name": name.strip() if isinstance(name, str) and name.strip() else preset_id,
        "version": 3,
        "rows": rows,
        "columns": columns,
        "playerCount": player_count,
        "cityMode": city_mode,
        "mirrorVertical": mirror_vertical,
        "mirrorHorizontal": mirror_horizontal,
        "mirror180": False,
        "ascii": ascii_rows,
    }
    if city_mode == "fixed" or homes:
        preset["homes"] = homes
    # 玩法配置先原样透传（regions / resourcePoints / spacing / art）；合法性以游戏侧校验为准，
    # 编辑器只保证结构不被写坏。
    for key in ("regions", "resourcePoints", "spacing", "art"):
        if key in data:
            preset[key] = data[key]
    return preset
