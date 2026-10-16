"""Validation and normalization for chapter territory maps.

This intentionally mirrors formats/territory-format.js so the publish script
cannot put a file into the client resource directory that the editor rejects.
"""
from __future__ import annotations

import re
from collections import deque
from typing import Any

TERRITORY_MAP_KIND = "territoryChapter"
TERRITORY_VERSION = 1
SITE_TYPES = {"stage", "boss", "asyncPvp", "fixedResource", "bonus"}
ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class TerritoryValidationError(ValueError):
    def __init__(self, issues: list[str]):
        self.issues = issues
        super().__init__("; ".join(issues))


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _cell_id(row: int, column: int, rows: int, columns: int) -> int:
    return row * columns + column if 0 <= row < rows and 0 <= column < columns else -1


def _neighbors(cell_id: int, rows: int, columns: int) -> list[int]:
    row, column = divmod(cell_id, columns)
    # 与 HexGridLayout.ts 一致：偶数列格 y 下移半行 ⇒ 斜邻居在下一行（左下/右下）；
    # 奇数列格 y 上移半行 ⇒ 斜邻居在上一行（左上/右上）。
    offsets = (
        [(-1, 0), (1, 0), (0, -1), (1, -1), (0, 1), (1, 1)]
        if column % 2 == 0
        else [(-1, 0), (1, 0), (0, -1), (-1, -1), (0, 1), (-1, 1)]
    )
    return [cell for dr, dc in offsets if (cell := _cell_id(row + dr, column + dc, rows, columns)) >= 0]


def _cells(value: Any, label: str, total: int, issues: list[str], required: bool = False) -> list[int]:
    if value is None and not required:
        return []
    if not isinstance(value, list):
        issues.append(f"{label} must be an array")
        return []
    result: list[int] = []
    seen: set[int] = set()
    for item in value:
        if not _is_int(item) or not 0 <= item < total:
            issues.append(f"{label} contains an out-of-bounds cell")
        elif item in seen:
            issues.append(f"{label} contains duplicate cell {item}")
        else:
            seen.add(item)
            result.append(item)
    return result


def _connected(cells: list[int], rows: int, columns: int) -> bool:
    if len(cells) <= 1:
        return True
    target = set(cells)
    seen = {cells[0]}
    queue = deque([cells[0]])
    while queue:
        current = queue.popleft()
        for neighbour in _neighbors(current, rows, columns):
            if neighbour in target and neighbour not in seen:
                seen.add(neighbour)
                queue.append(neighbour)
    return len(seen) == len(target)


def _non_negative(value: Any, label: str, issues: list[str], fallback: int = 0) -> int:
    if value is None:
        return fallback
    if not _is_int(value) or value < 0:
        issues.append(f"{label} must be a non-negative integer")
        return fallback
    return value


def validate_territory_map(data: Any, fallback_id: str | None = None) -> tuple[dict[str, Any], list[str]]:
    issues: list[str] = []
    if not isinstance(data, dict):
        raise TerritoryValidationError(["territory map must be an object"])
    map_id = data.get("id", fallback_id)
    if not isinstance(map_id, str) or not map_id or not ID_PATTERN.fullmatch(map_id):
        issues.append("id must contain only letters, numbers, _ or -")
        map_id = fallback_id or "invalid"
    if data.get("mapKind") != TERRITORY_MAP_KIND:
        issues.append(f"mapKind must be {TERRITORY_MAP_KIND}")
    if data.get("version") != TERRITORY_VERSION:
        issues.append(f"version must be {TERRITORY_VERSION}")
    rows, columns = data.get("rows"), data.get("columns")
    if not _is_int(rows) or not 4 <= rows <= 60:
        issues.append("rows must be an integer in [4, 60]")
        rows = 4
    if not _is_int(columns) or not 4 <= columns <= 60:
        issues.append("columns must be an integer in [4, 60]")
        columns = 4
    total = rows * columns
    start = data.get("startCellId")
    if not _is_int(start) or not 0 <= start < total:
        issues.append("startCellId is out of bounds")
        start = 0
    chapter = data.get("chapterId")
    if not _is_int(chapter) or not 1 <= chapter <= 9999:
        issues.append("chapterId must be an integer in [1, 9999]")
        chapter = 1
    defaults_input = data.get("defaults")
    if not isinstance(defaults_input, dict):
        issues.append("defaults must be an object")
        defaults_input = {}
    defaults = {
        "combatPower": _non_negative(defaults_input.get("combatPower"), "defaults.combatPower", issues),
        "silverCost": _non_negative(defaults_input.get("silverCost"), "defaults.silverCost", issues),
        "exploreSeconds": _non_negative(defaults_input.get("exploreSeconds"), "defaults.exploreSeconds", issues),
        "staminaCost": _non_negative(defaults_input.get("staminaCost"), "defaults.staminaCost", issues, 10),
    }
    sites_data = data.get("sites")
    if not isinstance(sites_data, list):
        issues.append("sites must be an array")
        sites_data = []
    sites: list[dict[str, Any]] = []
    site_ids: set[str] = set()
    occupied: dict[int, str] = {}
    for index, raw in enumerate(sites_data):
        label = f"sites[{index}]"
        if not isinstance(raw, dict):
            issues.append(f"{label} must be an object")
            continue
        site_id = raw.get("id")
        if not isinstance(site_id, str) or not site_id or not ID_PATTERN.fullmatch(site_id):
            issues.append(f"{label}.id is invalid")
            site_id = f"invalid_{index}"
        if site_id in site_ids:
            issues.append(f"duplicate site id {site_id}")
        site_ids.add(site_id)
        site_type = raw.get("type")
        if site_type not in SITE_TYPES:
            issues.append(f"{label}.type is invalid")
            site_type = "stage"
        cell_id = raw.get("cellId")
        if not _is_int(cell_id) or not 0 <= cell_id < total:
            issues.append(f"{label}.cellId is out of bounds")
            cell_id = 0
        footprint = _cells(raw.get("footprint", [cell_id]), f"{label}.footprint", total, issues, True)
        if cell_id not in footprint:
            issues.append(f"{label}.footprint must include cellId")
        if not _connected(footprint, rows, columns):
            issues.append(f"{label}.footprint must be contiguous")
        for occupied_cell in footprint:
            if occupied_cell in occupied:
                issues.append(f"site {site_id} overlaps site {occupied[occupied_cell]}")
            occupied[occupied_cell] = site_id
            if occupied_cell == start:
                issues.append(f"site {site_id} cannot occupy startCellId")
        unlock_input = raw.get("unlock") if isinstance(raw.get("unlock"), dict) else {}
        if raw.get("unlock") is not None and not isinstance(raw.get("unlock"), dict):
            issues.append(f"{label}.unlock must be an object")
        required = _cells(unlock_input.get("requiredCells", []), f"{label}.unlock.requiredCells", total, issues)
        if cell_id in required:
            issues.append(f"{label}.unlock.requiredCells cannot contain its own cellId")
        site = {
            "id": site_id,
            "type": site_type,
            "cellId": cell_id,
            "footprint": footprint,
            "unlock": {
                "requiredCells": required,
                "combatPower": _non_negative(unlock_input.get("combatPower"), f"{label}.unlock.combatPower", issues, defaults["combatPower"]),
                "silverCost": _non_negative(unlock_input.get("silverCost"), f"{label}.unlock.silverCost", issues, defaults["silverCost"]),
                "exploreSeconds": _non_negative(unlock_input.get("exploreSeconds"), f"{label}.unlock.exploreSeconds", issues, defaults["exploreSeconds"]),
                "staminaCost": _non_negative(unlock_input.get("staminaCost"), f"{label}.unlock.staminaCost", issues, defaults["staminaCost"]),
            },
        }
        for optional in ("configId", "buildingId"):
            if optional in raw:
                if not isinstance(raw[optional], str):
                    issues.append(f"{label}.{optional} must be a string")
                else:
                    site[optional] = raw[optional]
        if "rewardId" in raw:
            if site_type != "fixedResource":
                issues.append(f"{label}.rewardId is only valid for fixedResource sites")
            if not _is_int(raw["rewardId"]) or raw["rewardId"] <= 0:
                issues.append(f"{label}.rewardId must be a positive integer")
            elif site_type == "fixedResource":
                site["rewardId"] = raw["rewardId"]
        sites.append(site)
    site_by_cell = {site["cellId"]: site for site in sites}
    dependency_state: dict[str, int] = {}

    def visit_site(site: dict[str, Any]) -> None:
        state = dependency_state.get(site["id"], 0)
        if state == 1:
            issues.append(f"unlock dependency cycle at {site['id']}")
            return
        if state == 2:
            return
        dependency_state[site["id"]] = 1
        for required_cell in site["unlock"]["requiredCells"]:
            if required_cell == start:
                continue
            dependency = site_by_cell.get(required_cell)
            if dependency is None:
                issues.append(f"site {site['id']} requires cell {required_cell}, but no fixed site owns it")
            else:
                visit_site(dependency)
        dependency_state[site["id"]] = 2

    for site in sites:
        visit_site(site)
    random_sites = None
    if "randomSites" in data:
        raw_random = data.get("randomSites")
        if not isinstance(raw_random, dict):
            issues.append("randomSites must be an object")
            raw_random = {}
        candidates = _cells(raw_random.get("candidateCells", []), "randomSites.candidateCells", total, True)
        fixed = {start, *occupied.keys()}
        for candidate in candidates:
            if candidate in fixed:
                issues.append(f"randomSites.candidateCells cannot use fixed cell {candidate}")
        reward_pool = raw_random.get("rewardPoolId")
        if not isinstance(reward_pool, str) or not reward_pool:
            issues.append("randomSites.rewardPoolId must be a non-empty string")
            reward_pool = "invalid"
        max_active = raw_random.get("maxActive", 1)
        if not _is_int(max_active) or max_active < 1:
            issues.append("randomSites.maxActive must be a positive integer")
            max_active = 1
        random_sites = {
            "triggerSilver": _non_negative(raw_random.get("triggerSilver"), "randomSites.triggerSilver", issues),
            "rewardPoolId": reward_pool,
            "candidateCells": candidates,
            "maxActive": max_active,
        }
        # 可选字段：逐格建筑 ID（`{"<cellId>": "<建筑 ID>"}`）—— 建筑 ID 针对**单个随机据点**，
        # 所以是 cellId → 建筑 的映射。key 必须是候选格之一，否则那一格永远不会出现、这条配置等于
        # 静默失效。空串/纯空格 =「这一格没指定」，不写进产物（与 JS 侧 `trim()` 后再判的口径一致）。
        building_ids: dict[str, str] = {}
        raw_building_ids = raw_random.get("buildingIds")
        if raw_building_ids is not None:
            if not isinstance(raw_building_ids, dict):
                issues.append("randomSites.buildingIds must be an object")
            else:
                candidate_set = set(candidates)
                for raw_cell, raw_building in raw_building_ids.items():
                    label = f"randomSites.buildingIds.{raw_cell}"
                    # ⚠️ JSON 对象的 key **永远是字符串**（`"10"` 而不是 `10`），不能用 `_is_int` 判。
                    # 只接受十进制非负整数字符串，`"abc"` / `""` / `"1.5"` / `"-3"` 一律报错。
                    if not isinstance(raw_cell, str) or not raw_cell.isdigit():
                        issues.append(f"{label} must be a cell in [0, {total - 1}]")
                        continue
                    cell = int(raw_cell)
                    if not 0 <= cell < total:
                        issues.append(f"{label} must be a cell in [0, {total - 1}]")
                        continue
                    if cell not in candidate_set:
                        issues.append(f"{label} is not a candidate cell")
                        continue
                    if not isinstance(raw_building, str):
                        issues.append(f"{label} must be a string")
                        continue
                    stripped = raw_building.strip()
                    if stripped:
                        building_ids[str(cell)] = stripped
        # 按 cellId 升序输出，让同一份配置在不同机器上产物字节一致。
        sorted_building_ids = {key: building_ids[key] for key in sorted(building_ids, key=int)}
        if sorted_building_ids:
            random_sites["buildingIds"] = sorted_building_ids
    decorations: list[dict[str, Any]] = []
    if "decorations" in data:
        if not isinstance(data.get("decorations"), list):
            issues.append("decorations must be an array")
        else:
            for index, raw in enumerate(data["decorations"]):
                label = f"decorations[{index}]"
                if not isinstance(raw, dict):
                    issues.append(f"{label} must be an object")
                    continue
                cell = raw.get("cellId")
                art = raw.get("artId")
                if not _is_int(cell) or not 0 <= cell < total:
                    issues.append(f"{label}.cellId is out of bounds")
                if not isinstance(art, str) or not art:
                    issues.append(f"{label}.artId must be a non-empty string")
                decorations.append({"cellId": cell if _is_int(cell) else 0, "artId": art if isinstance(art, str) else "invalid"})
    if issues:
        raise TerritoryValidationError(issues)
    result: dict[str, Any] = {
        "version": TERRITORY_VERSION,
        "mapKind": TERRITORY_MAP_KIND,
        "id": map_id,
        "name": data.get("name") if isinstance(data.get("name"), str) and data.get("name") else map_id,
        "chapterId": chapter,
        "rows": rows,
        "columns": columns,
        "startCellId": start,
        "background": data.get("background") if isinstance(data.get("background"), str) else "",
        "defaults": defaults,
        "sites": sites,
    }
    if random_sites:
        result["randomSites"] = random_sites
    if decorations:
        result["decorations"] = decorations
    warnings = []
    if len(sites) != 10:
        warnings.append(f"chapter {chapter} has {len(sites)} fixed sites; expected 10 levels")
    if len(sites) > total // 2:
        warnings.append("fixed site occupancy exceeds half of the chapter map")
    return result, warnings
