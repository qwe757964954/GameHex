"""Build the woodland detail layout from imported slices, preserving its asset UUID.

Run after slice_card_detail.py and Cocos asset refresh. All coordinates below refer
to the approved 887x1774 image; dynamic data stays in CardUpgradePage.
"""
import copy
import json
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / 'assets/bundles/main-pages/ui/card/CardUpgrade.prefab'
ART = ROOT / 'assets/bundles/main-pages/image/carddetail'
SX, SY = 720 / 887, 1280 / 1774
DARK, IVORY, GREEN = (62, 38, 19), (255, 239, 202), (63, 156, 23)

def color(rgb):
    return dict(__type__='cc.Color', r=rgb[0], g=rgb[1], b=rgb[2], a=255)

def main():
    old = json.loads(PATH.read_text(encoding='utf-8'))
    templates = {}
    for obj in old:
        templates.setdefault(obj['__type__'], obj)
    for path in (ROOT / 'assets/bundles/main-pages/ui').rglob('*.prefab'):
        for obj in json.loads(path.read_text(encoding='utf-8')):
            if obj['__type__'] in ('cc.Mask', '544earF5qRLB4JTuTnSr11+'):
                templates.setdefault(obj['__type__'], obj)
        if '544earF5qRLB4JTuTnSr11+' in templates and 'cc.Mask' in templates:
            break
    page_type = next(o['__type__'] for o in old if 'closeButton' in o)
    hex_type = next(o['__type__'] for o in old if 'hexSprite' in o)
    row_type = next(o['__type__'] for o in old if 'rowBg' in o)
    output = [copy.deepcopy(old[0])]
    centers = {}

    def append(obj):
        output.append(obj)
        return len(output) - 1

    def ref(i):
        return {'__id__': i}

    def component(node, kind, **values):
        obj = copy.deepcopy(templates[kind])
        obj['node'] = ref(node)
        obj['__prefab'] = ref(append({'__type__': 'cc.CompPrefabInfo', 'fileId': uuid.uuid4().hex[:22]}))
        obj.update(values)
        index = append(obj)
        output[node]['_components'].append(ref(index))
        return index

    def make(name, parent, rect):
        x0, y0, x1, y1 = rect
        cx, cy = (x0+x1)/2, (y0+y1)/2
        pcx, pcy = centers.get(parent, (443.5, 887))
        obj = copy.deepcopy(templates['cc.Node'])
        obj.update(_name=name, _parent=ref(parent) if parent is not None else None,
                   _children=[], _components=[], _active=True, _id='')
        obj['_lpos'].update(x=(cx-pcx)*SX, y=(pcy-cy)*SY, z=0)
        obj['_lscale'].update(x=1, y=1, z=1)
        index = append(obj)
        centers[index] = (cx, cy)
        if parent is not None:
            output[parent]['_children'].append(ref(index))
        obj['_prefab'] = ref(append(dict(__type__='cc.PrefabInfo', root=ref(1), asset=ref(0),
                                       fileId=uuid.uuid4().hex[:22], instance=None,
                                       targetOverrides=None, nestedPrefabInstanceRoots=None)))
        transform = component(index, 'cc.UITransform',
                              _contentSize=dict(__type__='cc.Size', width=(x1-x0)*SX, height=(y1-y0)*SY),
                              _anchorPoint=dict(__type__='cc.Vec2', x=.5, y=.5))
        return index, transform

    def frame(name):
        meta = json.loads((ART / f'{name}.png.meta').read_text(encoding='utf-8'))
        return {'__uuid__': meta['uuid']+'@f9941', '__expectedType__': 'cc.SpriteFrame'}

    def sprite(name, parent, rect, art):
        n, t = make(name, parent, rect)
        s = component(n, 'cc.Sprite', _spriteFrame=frame(art) if art else None,
                      _sizeMode=0, _type=0, _isTrimmedMode=False, _color=color((255,255,255)))
        return n, t, s

    def label(name, parent, rect, text='', size=24, rgb=DARK, align=1, outline=False, wrap=False, overflow=2):
        n, t = make(name, parent, rect)
        l = component(n, 'cc.Label', _string=text, _fontSize=size, _actualFontSize=size,
                      _lineHeight=size+5, _color=color(rgb), _horizontalAlign=align,
                      _verticalAlign=1, _overflow=overflow, _enableWrapText=wrap,
                      _isBold=True, _enableOutline=outline, _outlineColor=color(DARK),
                      _outlineWidth=2 if outline else 0, _fontFamily='Microsoft YaHei')
        return n, t, l

    def button(name, parent, rect):
        n, _ = make(name, parent, rect)
        b = component(n, 'cc.Button', _transition=0, _target=None, _interactable=True, clickEvents=[])
        return n, b

    def widget(node, flags, top=0, bottom=0, left=0, right=0):
        return component(node, 'cc.Widget', _alignFlags=flags, _top=top, _bottom=bottom,
                         _left=left, _right=right, _target=None, _alignMode=1,
                         _isAbsTop=True, _isAbsBottom=True, _isAbsLeft=True, _isAbsRight=True)

    root, root_t = make('CardUpgrade', None, (0,0,887,1774))
    component(root, 'cc.BlockInputEvents')
    component(root, 'cc.Widget', _alignFlags=45, _left=0, _right=0, _top=0, _bottom=0, _target=None)
    layout, _ = make('Layout', root, (0,0,887,1774))
    widget(layout, 45)
    top, _ = make('TopRegion', layout, (0,0,887,1774))
    widget(top, 41)
    bottom, _ = make('BottomRegion', layout, (0,0,887,1774))
    widget(bottom, 44)
    page = copy.deepcopy(next(o for o in old if 'closeButton' in o))
    for key in ['rewardLabel','detailRoot','upgradePanel','folderTabButton','folderTabLabel','backButton','layoutRoot','rootTransform','milestonesRoot','milestoneContentTransform']:
        page.pop(key, None)
    bindings = {}
    bg, _, _ = sprite('Bg', layout, (0,0,887,1774), 'wood')
    widget(bg, 45)
    # Full background must render behind both fixed regions.
    output[layout]['_children'].remove(ref(bg))
    output[layout]['_children'].insert(0, ref(bg))
    sprite('TitleBar', top, (0,0,887,92), 'title_bar')
    label('Title', top, (180,4,707,83), '卡牌详情', 45, IVORY, outline=True)
    _, bindings['closeButton'] = button('CloseBtn', top, (17,5,103,85))
    header, _, _ = sprite('Header', top, (0,92,887,606), 'forest')
    _, _, bindings['nameLabel'] = label('NameLabel', header, (26,112,238,174), '椰蛋战士', 35, IVORY, 0, True)
    quality, _, bindings['qualitySprite'] = sprite('QualityDiamond', header, (242,101,330,189), 'quality_purple')
    _, _, bindings['qualityLabel'] = label('QualityLabel', quality, (247,125,323,165), '紫品', 23, IVORY, outline=True)
    camp_tag, _, _ = sprite('TagCamp', header, (25,188,147,242), 'tag_camp')
    bindings['campTagRoot'] = camp_tag
    class_tag, _, _ = sprite('TagClass', header, (152,188,277,242), 'tag_class')
    _, _, bindings['tagCampLabel'] = label('TagCampLabel', camp_tag, (71,193,141,236), '植物', 23)
    _, _, bindings['tagClassLabel'] = label('TagClassLabel', class_tag, (202,193,271,236), '战士', 23)
    # Reuse the project's actual card portrait, never bake a hero or sample values into the skin.
    _, bindings['heroTransform'], bindings['heroSprite'] = sprite('Hero', header, (224,100,674,606.25), None)
    hero_size = output[bindings['heroTransform']]['_contentSize']
    hero_size['height'] = hero_size['width']
    sprite('LevelPlaque', header, (309,537,577,606), 'level_plaque')
    _, _, bindings['levelBigLabel'] = label('LevelLabel', header, (356,548,530,592), 'Lv.1', 30, IVORY, outline=True)
    previous, _, _ = sprite('PreviousBtn', header, (57,349,136,428), 'arrow_left')
    bindings['previousButton'] = component(previous, 'cc.Button', _transition=0, _target=None, clickEvents=[])
    following, _, _ = sprite('NextBtn', header, (750,349,829,428), 'arrow_right')
    bindings['nextButton'] = component(following, 'cc.Button', _transition=0, _target=None, clickEvents=[])
    sprite('PowerBar', top, (0,606,887,700), 'power_bar')
    _, _, bindings['powerLabel'] = label('PowerLabel', top, (114,622,376,678), '战力 --', 31, IVORY, outline=True)
    team, bindings['teamButton'] = button('BtnTeam', top, (612,615,858,684))
    label('BtnTeamLabel', team, (688,623,850,678), '队伍编辑', 28, IVORY, outline=True)
    stats, _, _ = sprite('StatsPanel', top, (0,700,887,1018), 'stats_panel')
    label('StatsTitle', stats, (61,709,254,762), '基础属性', 30, IVORY, outline=True)
    for field, name, text, left, y in [
        ('Hp','StatHp','兵种血量',0,807), ('Attack','StatAttack','攻击力',420,807),
        ('BuildHp','StatBuildHp','建筑血量',0,879), ('Spawn','StatSpawn','生产时间',420,879),
        ('Range','StatRange','攻击范围',0,954), ('Speed','StatSpeed','移动速度',420,954),
    ]:
        group, _ = make(name, stats, (left+40,y-30,left+437,y+30))
        label('NameLabel', group, (left+130,y-24,left+269,y+24), text, 23, align=0)
        _, _, bindings[f'stat{field}Value'] = label('ValueLabel', group, (left+269,y-24,left+355,y+24), '--', 26, align=2)
        if field != 'Spawn':
            _, _, bindings[f'stat{field}Gain'] = label('GainLabel', group, (left+355,y-24,left+428,y+24), '', 22, GREEN, 0)
    skills, _, skills_sprite = sprite('SkillsPanel', layout, (0,1018,887,1528), 'skills_panel')
    output[skills_sprite]['_type'] = 1  # SLICED: one continuous outer frame.
    widget(skills, 45, top=1018*SY, bottom=(1774-1528)*SY)
    skill_header, _ = make('SkillHeader', skills, (0,1018,887,1276))
    widget(skill_header, 41)
    label('SkillsTitle', skill_header, (60,1030,254,1083), '技能天赋', 30, IVORY, outline=True)
    chain, _ = make('SkillChain', skill_header, (39,1093,847,1268))
    bindings['chainRoot'] = chain
    for i, cx in enumerate([132,292,451,606,761]):
        slot, _ = make(f'Hex{i}', chain, (cx-79,1093,cx+79,1265))
        _, _, hs = sprite('HexSprite', slot, (cx-79,1093,cx+79,1219), 'hex_lock')
        _, _, nl = label('NameLabel', slot, (cx-73,1221,cx+73,1263), '未解锁', 19, IVORY, wrap=True)
        badge, _, bs = sprite('Badge', slot, (cx+35,1093,cx+69,1127), 'hex_num_badge')
        _, _, bl = label('BadgeLabel', badge, (cx+35,1093,cx+69,1127), '', 16, IVORY, outline=True)
        component(slot, hex_type, hexSprite=ref(hs), nameLabel=ref(nl), badgeSprite=ref(bs),
                  badgeLabel=ref(bl), _transition=0, _target=None, _interactable=False,
                  clickEvents=[], unlockedColor=color(IVORY))
    viewport, viewport_t = make('MilestoneViewport', skills, (39,1276,847,1500))
    output[viewport_t]['_anchorPoint']['y'] = 1
    output[viewport]['_lpos']['y'] += 224*SY/2
    widget(viewport, 45, top=(1276-1018)*SY, bottom=28*SY, left=39*SX, right=40*SX)
    component(viewport, 'cc.Mask', _type=0, _inverted=False)
    content, content_t = make('Milestones', viewport, (39,1276,847,1500))
    output[content_t]['_anchorPoint']['y'] = 1
    output[content]['_lpos']['y'] = 0
    template_host, _ = make('Templates', layout, (0,0,887,1774))
    output[template_host]['_active'] = False
    rows = []
    for i in range(1):
        row, rt = make(f'Row{i}', template_host, (39,1276+i*76,847,1347+i*76))
        output[row]['_lpos']['y'] = 0
        rows.append(ref(row))
        _, bt, bg = sprite('RowBg', row, (39,1276+i*76,847,1347+i*76), 'milestone_row')
        _, _, ll = label('LevelLabel', row, (59,1290+i*76,170,1336+i*76), '', 22, IVORY, outline=True)
        _, dt, dl = label('DescLabel', row, (186,1284+i*76,828,1340+i*76), '', 20, DARK, 0, wrap=True, overflow=3)
        component(row, row_type, rowBg=ref(bg), levelLabel=ref(ll), descLabel=ref(dl),
                  rowTransform=ref(rt), backgroundTransform=ref(bt), descTransform=ref(dt),
                  unlockedColor=color(DARK), lockedColor=color((124,106,83)))
    scroll = component(viewport, '544earF5qRLB4JTuTnSr11+', content=ref(content),
                       useVirtualList=True, direction=0, itemCreationMode=0, useDynamicSize=True,
                       itemNode=None, itemPrefab=None, itemNodes=rows, itemPrefabs=[],
                       spacing=4, headerSpacing=0, footerSpacing=0, totalCount=0, buffer=1,
                       enableItemClickEffect=False, enablePullRefresh=False, enableLoadMore=False)
    bindings['milestoneScroll'] = scroll
    footer, _, _ = sprite('UpgradePanel', bottom, (8,1568,879,1755), 'footer_panel')
    sprite('MaterialWell', footer, (31,1586,439,1741), 'wood')
    _, _, bindings['matCardCountLabel'] = label('MatCardCount', footer, (25,1673,171,1713), '', 23, IVORY, outline=True)
    _, _, bindings['matCardItemLabel'] = label('MatCardName', footer, (25,1714,171,1741), '卡牌', 16, IVORY)
    _, _, bindings['matCardIcon'] = sprite('CardIcon', footer, (60,1597,139,1672), None)
    _, _, bindings['matExpCountLabel'] = label('MatExpCount', footer, (185,1673,451,1713), '', 23, IVORY, outline=True)
    _, _, bindings['matExpItemLabel'] = label('MatExpName', footer, (174,1714,457,1741), '', 14, IVORY)
    _, _, bindings['matExpIcon'] = sprite('ExpIcon', footer, (277,1597,358,1673), None)
    upgrade, _, _ = sprite('BtnUpgrade', footer, (492,1587,860,1733), 'upgrade_button')
    bindings['upgradeButton'] = component(upgrade, 'cc.Button', _transition=0, _target=None, _interactable=False, clickEvents=[])
    _, _, bindings['upgradeLabel'] = label('Label', upgrade, (511,1593,840,1675), '升级', 50)
    _, _, bindings['levelTransitionLabel'] = label('LevelTransition', upgrade, (510,1675,843,1719), '', 24, IVORY, outline=True)
    _, _, bindings['hintLabel'] = label('Hint', bottom, (31,1528,856,1563), '', 17, IVORY, outline=True)
    page.update({key:ref(value) for key,value in bindings.items()})
    page.update(closeOnBlank=False, contentNodes=[ref(layout)], skillButton=None,
                enoughColor=color((115,211,47)), lackColor=color((244,94,72)), idleColor=color((176,168,150)))
    page['node'] = ref(root)
    page['__prefab'] = ref(append({'__type__':'cc.CompPrefabInfo','fileId':uuid.uuid4().hex[:22]}))
    output[root]['_components'].append(ref(append(page)))
    output[0]['data'] = ref(root)
    PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Built {PATH}: {len(output)} serialized objects')

if __name__ == '__main__':
    main()
