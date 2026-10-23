# -*- coding: utf-8 -*-
"""把 prefab 里的 SpriteFrame uuid 反查成资源名，用于「照着领地页抄 UI 皮肤」。

Cocos 3.x 的 `.prefab` 是一个**扁平数组**（对象之间靠 `{"__id__": n}` 互相引用），
所以这里先按 `__id__` 建索引，再从根节点（`__id__: 0` 的 `_children`）递归。

用法：python tools/inspect_prefab_art.py assets/resources/ui/main/ArenaRoot.prefab
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def build_uuid_index() -> dict:
    """扫描 assets 下所有 .meta，建 uuid → 资源相对路径。"""
    index = {}
    for base, _dirs, files in os.walk(os.path.join(ROOT, 'assets')):
        for name in files:
            if not name.endswith('.meta'):
                continue
            path = os.path.join(base, name)
            try:
                with open(path, 'r', encoding='utf-8') as handle:
                    meta = json.load(handle)
            except (OSError, ValueError):
                continue
            uuid = meta.get('uuid')
            if not uuid:
                continue
            asset = os.path.relpath(path[:-len('.meta')], ROOT).replace('\\', '/')
            index[uuid] = asset
    return index


def resolve(data: list, ref) -> dict | None:
    if isinstance(ref, dict) and '__id__' in ref:
        return data[ref['__id__']]
    return None


def walk(data: list, node: dict, depth: int, index: dict, out: list) -> None:
    name = node.get('_name', '?')
    art = []
    for component_ref in node.get('_components', []):
        component = resolve(data, component_ref)
        if not component:
            continue
        if component.get('__type__') == 'cc.Sprite':
            frame = component.get('_spriteFrame')
            if isinstance(frame, dict) and '__uuid__' in frame:
                # 贴图是 atlas/图集的**子资源**，uuid 带 `@f9941` 这类后缀，查表要剥掉。
                uuid = frame['__uuid__'].split('@')[0]
                art.append(index.get(uuid, frame['__uuid__'][:10]))
            art.append(f'sizeMode={component.get("_sizeMode")}')
            art.append(f'type={component.get("_type")}')
    text = ''
    for component_ref in node.get('_components', []):
        component = resolve(data, component_ref)
        if component and component.get('__type__') == 'cc.Label':
            text = f'「{component.get("_string", "")}」'
    if art or text:
        out.append(('  ' * depth) + f'{name}{text}: ' + ' | '.join(art))
    for child_ref in node.get('_children', []):
        child = resolve(data, child_ref)
        if child:
            walk(data, child, depth + 1, index, out)


def main() -> None:
    target = sys.argv[1] if len(sys.argv) > 1 else 'assets/resources/ui/main/ArenaRoot.prefab'
    with open(os.path.join(ROOT, target), 'r', encoding='utf-8') as handle:
        data = json.load(handle)
    index = build_uuid_index()
    out = []
    # `.prefab` 的第 0 项是 `cc.Prefab`，真正的根节点是第一个带 `_children` 的项。
    root = next((entry for entry in data if '_children' in entry), None)
    if root is None:
        raise SystemExit('没找到根节点')
    walk(data, root, 0, index, out)
    print('\n'.join(out))
    print(f'\n# uuid 索引 {len(index)} 条', file=sys.stderr)


if __name__ == '__main__':
    main()
