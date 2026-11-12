"""给 `ui/main/ChestDetailPanel.prefab` 补「加速」态的播放 icon 节点与三处绑定。

2026-11-11 需求：详情弹窗右侧主按钮在加速态要变绿 + 文案前带播放 icon，
解锁/开启态保持原黄色。新增对象一律 **append 到数组末尾**，不动任何既有
`__id__`（prefab 里全是下标引用，插中间会整体错位）。

跑完会自检：节点树 / 组件绑定 / UI_2D / 引用闭环。
用法：python tools/patch_chest_detail_speed_up_prefab.py
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFAB = ROOT / 'assets/resources/ui/main/ChestDetailPanel.prefab'
SLOT = ROOT / 'assets/resources/ui/main/ChestSlot.prefab'

PANEL_CID = 'fba93mSlUVEQ4N0/mw7tcEZ'
GREEN_UUID = 'b6c1e904-3a75-4b18-9a6c-d2f0e18b47a5@f9941'
BOLT_UUID = '31c7e2c7-7dee-4402-b641-980f775118ea@f9941'

BTN_PRIMARY_ID = 137
PRIMARY_SPRITE_ID = 158
PANEL_COMP_ID = 172
ROOT_NODE_ID = 1
PREFAB_ASSET_ID = 0

ICON_WIDTH = 42
ICON_HEIGHT = 44
ICON_X = -34
ICON_Y = 21.5


def main() -> None:
    data = json.loads(PREFAB.read_text(encoding='utf-8'))
    slot = json.loads(SLOT.read_text(encoding='utf-8'))
    base = len(data)

    # 模板取自 ChestSlot 的 SpeedUpIcon（同一张 chest_bolt 图、同样的 Sprite 配置）。
    src_tf = next(o for o in slot if o.get('__type__') == 'cc.UITransform'
                  and o.get('node', {}).get('__id__') == 77)
    src_sprite = next(o for o in slot if o.get('__type__') == 'cc.Sprite'
                      and o.get('node', {}).get('__id__') == 77)
    # PrefabInfo 直接按 id 取（cc.PrefabInfo 没有 node 反查字段）。
    src_info = slot[slot[77]['_prefab']['__id__']]

    node_id = base
    tf_id = base + 1
    tf_info_id = base + 2
    sprite_id = base + 3
    sprite_info_id = base + 4
    info_id = base + 5

    node = {
        '__type__': 'cc.Node',
        '_name': 'SpeedUpIcon',
        '_objFlags': 0,
        '__editorExtras__': {},
        '_parent': {'__id__': BTN_PRIMARY_ID},
        '_children': [],
        '_active': False,
        '_components': [{'__id__': tf_id}, {'__id__': sprite_id}],
        '_prefab': {'__id__': info_id},
        '_lpos': {'__type__': 'cc.Vec3', 'x': ICON_X, 'y': ICON_Y, 'z': 0},
        '_lrot': {'__type__': 'cc.Quat', 'x': 0, 'y': 0, 'z': 0, 'w': 1},
        '_lscale': {'__type__': 'cc.Vec3', 'x': 1, 'y': 1, 'z': 1},
        '_mobility': 0,
        '_layer': 33554432,
        '_euler': {'__type__': 'cc.Vec3', 'x': 0, 'y': 0, 'z': 0},
        '_id': '',
    }
    tf = copy.deepcopy(src_tf)
    tf['node'] = {'__id__': node_id}
    tf['__prefab'] = {'__id__': tf_info_id}
    tf['_contentSize']['width'] = ICON_WIDTH
    tf['_contentSize']['height'] = ICON_HEIGHT

    sprite = copy.deepcopy(src_sprite)
    sprite['node'] = {'__id__': node_id}
    sprite['__prefab'] = {'__id__': sprite_info_id}
    sprite['_spriteFrame'] = {'__uuid__': BOLT_UUID, '__expectedType__': 'cc.SpriteFrame'}

    info = copy.deepcopy(src_info)
    info['root'] = {'__id__': ROOT_NODE_ID}
    info['asset'] = {'__id__': PREFAB_ASSET_ID}
    info['fileId'] = 'chestDetailSpeedUpIconNode'
    info['instance'] = None
    info['targetOverrides'] = None

    data.extend([
        node,
        tf,
        {'__type__': 'cc.CompPrefabInfo', 'fileId': 'chestDetailSpeedUpIconTf'},
        sprite,
        {'__type__': 'cc.CompPrefabInfo', 'fileId': 'chestDetailSpeedUpIconSprite'},
        info,
    ])

    primary = data[BTN_PRIMARY_ID]
    assert primary['_name'] == 'BtnPrimary'
    primary['_children'].append({'__id__': node_id})

    comp = data[PANEL_COMP_ID]
    assert comp['__type__'] == PANEL_CID
    comp['openFrame'] = {'__id__': PRIMARY_SPRITE_ID}
    comp['openSpeedUpFrame'] = {'__uuid__': GREEN_UUID, '__expectedType__': 'cc.SpriteFrame'}
    comp['openSpeedUpIcon'] = {'__id__': node_id}

    # 自检：fileId 不重复；所有 __id__ 指向存在的对象。
    file_ids = [o['fileId'] for o in data if isinstance(o, dict) and 'fileId' in o]
    assert len(file_ids) == len(set(file_ids)), 'fileId 重复'
    for obj in data:
        if not isinstance(obj, dict):
            continue
        for value in obj.values():
            if isinstance(value, dict) and '__id__' in value:
                assert 0 <= value['__id__'] < len(data), f'悬空 __id__: {value}'
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict) and '__id__' in item:
                        assert 0 <= item['__id__'] < len(data), f'悬空 __id__: {item}'

    # ⚠️ prefab 是 LF；Windows 上 write_text 默认把 \n 转 \r\n，会产出整份文件的大 diff。
    with PREFAB.open('w', encoding='utf-8', newline='\n') as fp:
        fp.write(json.dumps(data, ensure_ascii=False, indent=2))
    print(f'patched {PREFAB.relative_to(ROOT)}: {len(data)} objects, '
          f'SpeedUpIcon node={node_id}, green={GREEN_UUID}')


if __name__ == '__main__':
    main()
