# -*- coding: utf-8 -*-
"""技能设计案2.xlsx 第 130 行（68026 麻辣铁锅「喷射火焰」102603）：换美术后重写 O 列。

背景（2026-11-13 用户口径）：
  「【麻辣铁锅】的喷火技能使用新的特效图片 ph_00~ph_13，循环帧改为 ph_03~ph_09，
    替换成功后删除旧的资源，新的特效已经调整了喷火的角度是平行线，这个角度容易适配瞄准目标的角度」

O130 原来写的是旧美术那套数（39 帧 / 第 11~17 帧重复 3 遍 / 缩放 1.278207），换图后逐条失效，
所以整格重写（保留「滞空 + 对准头部」那半句，它是施法姿态，与美术无关）。

🔴 正文是共享字符串（`t="s"`）：读回必须 `html.unescape`，否则 `set_cell` 会把 `&#10;`
二次转义成 `&amp;#10;` 字面量写回去（第十轮踩过）。
"""
import html
import re
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sync_treant_excel import read_zip_rows, set_cell, write_zip  # noqa: E402

PATH = 'D:/Alan/占城玩法/策划文档/战斗系统/技能设计案2.xlsx'
MEMBER = 'xl/worksheets/sheet1.xml'
BACKUP_DIR = 'D:/Alan/占城玩法/策划文档/战斗系统/_backup'

ROW = 130
CHAIN = 102603

O_TEXT = (
    '播放攻击动画时角色美术根节点上移 30px（判定坐标不动），滞空期间循环播攻击动作，特效生成点对准角色头部 / '
    '使用 units/projectiles/麻辣铁锅_喷射火焰（38 帧 @12fps = 3.167s；帧序 = ph_00~ph_09 走一遍 + 循环帧 '
    'ph_03~ph_09 × 4 圈），尾部锚在角色头部、向身前喷出到触发距离 350 逻辑 px'
    '（与火焰视觉长度等长，缩放 1.474315 由此反算）；敌人进入 350px 内才会释放\r\n'
    '\r\n'
    '【2026-11-13 第十三轮换美术】用户口径：「使用新的特效图片 ph_00~ph_13，循环帧改为 ph_03~ph_09，'
    '替换成功后删除旧的资源，新的特效已经调整了喷火的角度是平行线，这个角度容易适配瞄准目标的角度」。\r\n'
    '· 旧美术 18 张 `146-1-attack_064~081`（845×615，火焰朝右下约 26°）连同图集整块删除，'
    '换成 `ph_00~ph_13`（519×437，轴线拉平成水平 ⇒ 宿主按 `angleDegrees` 转到朝向即可对准目标）；\r\n'
    '· 可见长度 365 源 px（各帧左缘中位 50 → 最右缘 415）⇒ 画布 **194×186**、烘焙缩放 **1.474315**'
    '（350 逻辑 px 反算），根节点 `_lpos = (-0.368579, +29.486301)`：尾部钉在本地 y=0，'
    '竖直抬到头部仍由 `auraVisualLiftPx = 97` 在视图层补；\r\n'
    '· 🔴 `ph_10~ph_13` 是**收火**帧（可见宽 278→197→169→40），不进 clip —— '
    '`cc.AnimationClip` 一个 clip 只有一个 `wrapMode`，播不出「先循环再收火」，'
    '塞进循环段会每 1.17 秒缩成小火苗再「嘭」地涨回来（一次喷火闪三下）；'
    '收火由 3 秒到期时 `holdVisual` 事件整体摘掉、节点直接销毁来完成；\r\n'
    '· 判定一个数没动：矩形 `auraRadius 175` / `auraForward 175` / `auraRectHalfHeight 70` / '
    '`auraTriggerRange 350` —— 换图只重算「多长 = 350」，不改打法。'
)


def load_shared_strings():
    with zipfile.ZipFile(PATH) as archive:
        raw = archive.read('xl/sharedStrings.xml').decode('utf-8')
    items = re.findall(r'<si>(.*?)</si>', raw, re.S)
    return [''.join(re.findall(r'<t[^>]*>(.*?)</t>', item, re.S)) for item in items]


def read_cell(xml, ref, shared):
    match = re.search(r'<c r="%s"([^>]*)>(.*?)</c>' % ref, xml, re.S)
    if not match:
        return ''
    attrs, inner = match.group(1), match.group(2)
    if 't="s"' in attrs:
        index = re.search(r'<v>(\d+)</v>', inner)
        return html.unescape(shared[int(index.group(1))]) if index else ''
    value = re.search(r'<v>(.*?)</v>', inner, re.S)
    if value:
        return html.unescape(value.group(1))
    return html.unescape(''.join(re.findall(r'<t[^>]*>(.*?)</t>', inner, re.S)))


def main():
    xml = read_zip_rows(PATH, MEMBER)
    shared = load_shared_strings()

    #  守卫：这一行必须还是 102603「喷射火焰」，免得行号漂了改错卡
    if read_cell(xml, 'G%d' % ROW, shared).strip() != str(CHAIN):
        raise SystemExit('[fail] G%d 不是 %d' % (ROW, CHAIN))
    if read_cell(xml, 'H%d' % ROW, shared).strip() != '喷射火焰':
        raise SystemExit('[fail] H%d 不是「喷射火焰」' % ROW)

    current = read_cell(xml, 'O%d' % ROW, shared)
    if '2026-11-13 第十三轮换美术' in current:
        print('[skip] O%d 已是新口径' % ROW)
    else:
        xml = set_cell(xml, 'O%d' % ROW, O_TEXT)
        print('  O%d  %s' % (ROW, O_TEXT.split('\r\n')[0][:110]))

    backup = write_zip(PATH, MEMBER, xml, BACKUP_DIR)
    print('[ok] 写回 %s' % PATH)
    print('[ok] 备份 %s' % backup)

    check = read_zip_rows(PATH, MEMBER)
    text = read_cell(check, 'O%d' % ROW, load_shared_strings())
    for needle in ('ph_00~ph_13', 'ph_03~ph_09', '1.474315', '194×186', '第十三轮换美术'):
        if needle not in text:
            raise SystemExit('[fail] O%d 缺关键词 %s' % (ROW, needle))
    if '1.278207' in text or '39 帧' in text:
        raise SystemExit('[fail] O%d 还留着旧美术的数（39 帧 / 1.278207）' % ROW)
    if 'amp;#' in text or '&#10;' in text:
        raise SystemExit('[fail] O%d 有二次转义的字面量' % ROW)
    if text.count('第十三轮换美术') != 1:
        raise SystemExit('[fail] O%d 的第十三轮复盘重复了' % ROW)
    print('[ok] 回读通过：O%d 已换成新美术口径（旧数已清）' % ROW)


if __name__ == '__main__':
    main()
