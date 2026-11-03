# -*- coding: utf-8 -*-
"""画「云原地交接给匹配页」的时序图（离线验收用，不参与运行时）。

用法（仓库根目录）：

    C:/Users/Administrator/.workbuddy/binaries/python/envs/default/Scripts/python.exe tools/preview_battle_handover.py

和 `preview_battle_intro.py` 的分工：那一张画的是**云盖层长什么样**（真美术逐帧合成），
这一张画的是**谁在什么时候动**（泳道 + 事件线）。改流程先看这张，改观感才看那张。

时间轴上的数字全部取自真源，改了常量这张图就该重画：

    out       TERRITORY_BATTLE_INTRO_OUT_SECONDS         0.55s
    in        TERRITORY_BATTLE_INTRO_IN_SECONDS          0.45s
    跳转点    × TERRITORY_BATTLE_INTRO_NAVIGATE_RATIO    0.6 ⇒ 0.27s
    等资源    TERRITORY_BATTLE_INTRO_READY_MAX_SECONDS   12s（不判失败，到点也散）
    匹配动画  MatchingController 的 1.4s 定时器（示意值）

产物：docs/进战斗过场-交接时序.png
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', '进战斗过场-交接时序.png')

W, H = 1560, 800
PAD_L = 24
PAD_R = 40
LABEL_W = 306

BG = (250, 248, 244)
INK = (36, 30, 22)
SUB = (118, 106, 90)
FAINT = (230, 224, 214)

C_OUT = (210, 146, 68)
C_HOLD = (172, 166, 156)
C_HAND = (192, 68, 56)
C_MATCH = (68, 106, 166)
C_READY = (140, 110, 178)
C_RELEASE = (82, 146, 114)
C_BATTLE = (60, 64, 72)

# 时间轴（秒；T_D 起的等待是示意值）
T_A = 0.55     # out 结束
T_B = 1.35     # 服务器回包 ⇒ 交接给匹配页
T_C = 2.75     # 匹配成功 ⇒ 界面瞬间关（T_B + 1.4s 匹配动画）
T_D = 4.75     # 战场资源就绪 ⇒ 开始散（示意 2.0s）
T_E = T_D + 0.27   # in 走到 60% ⇒ navigate(Battle)
T_F = T_D + 0.45   # in 走完 ⇒ cover.clear()
T_END = 5.5

X0 = PAD_L + LABEL_W
X1 = W - PAD_R
LANE_H = 56
LANE_GAP = 14
LANE_TOP = 188


def make_font(size, bold=False):
    path = 'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc'
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def sx(t):
    return X0 + (X1 - X0) * (t / T_END)


def text_w(draw, s, fnt):
    box = draw.textbbox((0, 0), s, font=fnt)
    return box[2] - box[0]


F_TITLE = make_font(24, True)
F_SUB = make_font(14)
F_LANE = make_font(15, True)
F_HINT = make_font(11)
F_SEG = make_font(13)
F_SEG_S = make_font(11)
F_EVENT = make_font(12, True)
F_TICK = make_font(12)


def draw_lane(draw, y, name, hint, segments):
    """一条泳道 = 左侧标签（名称 + 说明）+ 右侧按时间排的色块。"""
    top, bottom = y, y + LANE_H
    draw.rounded_rectangle([X0, top, X1, bottom], radius=8, fill=(255, 255, 255),
                           outline=FAINT, width=1)

    for t0, t1, label, color in segments:
        left = sx(t0) + 1
        right = max(sx(t1), left + 3)
        draw.rounded_rectangle([left, top + 4, right, bottom - 4], radius=6, fill=color)
        fnt = F_SEG if text_w(draw, label, F_SEG) <= (right - left) - 12 else F_SEG_S
        if text_w(draw, label, fnt) <= (right - left) - 12:
            draw.text((left + 6, top + 20), label, font=fnt, fill=(255, 255, 255))

    draw.text((PAD_L, y + 4), name, font=F_LANE, fill=INK)
    for index, line in enumerate(hint):
        draw.text((PAD_L, y + 25 + index * 15), line, font=F_HINT, fill=SUB)


def main():
    image = Image.new('RGB', (W, H), BG)
    draw = ImageDraw.Draw(image)

    draw.text((PAD_L, 22), '进入关卡战斗过场：云「原地交接」给匹配页', font=F_TITLE, fill=INK)
    draw.text((PAD_L, 60),
              '普通关（pve.mode = match）云不散场：领地 hold 里收到 nav 就直接跳，不播 in。',
              font=F_SUB, fill=SUB)
    draw.text((PAD_L, 82),
              '匹配页把同一屏云重建在自己第 0 个子节点上；匹配成功 + 战场资源就绪 ⇒ 界面瞬间关 → 露云 → 云散 → 进战场。',
              font=F_SUB, fill=SUB)

    lanes = [
        ('领地页  MainTerritoryMap',
         ('out：推 UI · 缩地块 · 云合拢（0.55s）',
          'hold 等回包，收到 nav 就走（不播 in）'), [
             (0, T_A, 'out 0.55s', C_OUT),
             (T_A, T_B, 'hold 等回包', C_HOLD),
             (T_B, T_B + 0.22, '离开', C_BATTLE),
         ]),
        ('云层  TerritoryBattleCover',
         ('"活不过"流程切换（onLeave 销毁整页）⇒ 只能重建',
          '带三样：视口尺寸 · 待机步进 · 已就位'), [
             (0, T_A, '合拢+显形', C_OUT),
             (T_A, T_B, '待机循环', C_HOLD),
             (T_B, T_C, '★ 同一屏云重建：静止，压在匹配 UI 之下', C_HAND),
             (T_C, T_D, '露着，一帧不动（等资源）', C_HAND),
             (T_D, T_F, 'in 0.45s：散 + 逐朵淡 → clear()', C_RELEASE),
         ]),
        ('匹配页  MatchingPage',
         ('云是它的第 0 个子节点（setSiblingIndex(0)）',
          '关门只关自己的子节点：跳过云、不碰 opacity'), [
             (T_B, T_C, '匹配动画 1.4s', C_MATCH),
             (T_C, T_C + 0.10, '关', C_HAND),
         ]),
        ('战场资源  preload.ready',
         ('界面先没，资源后到（不阻塞关门）',
          '12s 兜底照样散；失败 ⇒ 回 main'), [
             (T_C, T_D, 'preload.ready（≤12s，示意 2s）', C_READY),
         ]),
        ('战场页  GameRoute.Battle',
         ('全流程唯一一次 navigate(Battle)',
          '两条路（资源先到 / 12s 兜底）共用一个出口'), [
             (T_E, T_END, 'Battle', C_BATTLE),
         ]),
    ]

    lane_y = {}
    for index, (name, hint, segments) in enumerate(lanes):
        y = LANE_TOP + index * (LANE_H + LANE_GAP)
        lane_y[index] = y
        draw_lane(draw, y, name, hint, segments)

    # 跳转竖线：匹配页 → 战场页（要跨两条泳道，只能在拿到全部坐标之后画）
    draw.line([sx(T_E), lane_y[2] + LANE_H, sx(T_E), lane_y[4]], fill=C_BATTLE, width=2)
    draw.polygon([(sx(T_E) - 5, lane_y[4] - 8), (sx(T_E) + 5, lane_y[4] - 8), (sx(T_E), lane_y[4])],
                 fill=C_BATTLE)

    bottom_y = LANE_TOP + len(lanes) * (LANE_H + LANE_GAP) - LANE_GAP

    # 事件线：贯穿所有泳道的虚线
    events = [
        (T_A, 'out 结束', C_OUT, 0),
        (T_B, '回包 ⇒ 交接', C_HAND, 0),
        (T_C, '匹配成功 ⇒ 界面瞬间关（0 帧）', C_HAND, 0),
        (T_D, '资源就绪 ⇒ 开始散（0.27s 跳转 / 0.45s 散完）', C_RELEASE, 1),
    ]
    for t, _label, color, _row in events:
        x = sx(t)
        y = LANE_TOP - 10
        while y < bottom_y:
            draw.line([x, y, x, min(y + 5, bottom_y)], fill=color, width=1)
            y += 9

    # 事件名：两行错开 + 右边界钳制，避免"资源就绪 / 0.27s / 散完"三个挤成一片
    row_y = (LANE_TOP - 62, LANE_TOP - 40)
    last_right = [-999, -999]
    for t, label, color, row in events:
        x = sx(t)
        width = text_w(draw, label, F_EVENT)
        left = x
        if left < last_right[row] + 10:
            left = last_right[row] + 10
        left = min(left, X1 - width)
        draw.line([x, row_y[row] + 8, left, row_y[row] + 8], fill=color, width=1)
        draw.text((left, row_y[row]), label, font=F_EVENT, fill=color)
        last_right[row] = left + width

    # 时间刻度
    tick_y = bottom_y + 8
    for step in range(0, 6):
        x = sx(float(step))
        draw.line([x, bottom_y, x, bottom_y + 5], fill=SUB, width=1)
        draw.text((x - 10, tick_y + 6), '%ds' % step, font=F_TICK, fill=SUB)

    # 底部：三条去向
    panel_y = tick_y + 34
    panel_h = 204
    draw.rounded_rectangle([PAD_L, panel_y, X1, panel_y + panel_h], radius=10,
                           fill=(255, 255, 255), outline=FAINT, width=1)
    draw.text((PAD_L + 16, panel_y + 12), '三条去向（谁散场、什么时候散）',
              font=make_font(16, True), fill=INK)

    rows = [
        ('普通关 match', [
            ('out', C_OUT), ('hold 等回包', C_HOLD), ('云交接→匹配页', C_HAND),
            ('匹配页 hold', C_HAND), ('瞬间关界面', C_HAND), ('云散 0.45s', C_RELEASE),
            ('战场', C_BATTLE),
        ], '云一直不散，直到"界面已经不在了"才散 —— 这就是本次要的观感'),
        ('塔防关 defence', [
            ('out', C_OUT), ('hold 等回包', C_HOLD), ('云自己散 0.45s', C_RELEASE),
            ('战场', C_BATTLE),
        ], 'boss 关没有匹配页，云必须自己散完再跳（老路，未变）'),
        ('宝箱 PVP', [
            ('out', C_OUT), ('hold 等回包', C_HOLD), ('云自己散 0.45s', C_RELEASE),
            ('匹配页', C_MATCH),
        ], '宝箱匹配自带进场演出，云在它进场之前散完（老路，未变）'),
    ]

    row_y = panel_y + 46
    for name, chips, note in rows:
        draw.text((PAD_L + 16, row_y + 5), name, font=make_font(13, True), fill=INK)
        x = PAD_L + 152
        for index, (label, color) in enumerate(chips):
            width = text_w(draw, label, F_SEG) + 18
            draw.rounded_rectangle([x, row_y, x + width, row_y + 26], radius=6, fill=color)
            draw.text((x + 9, row_y + 5), label, font=F_SEG, fill=(255, 255, 255))
            x += width
            if index < len(chips) - 1:
                draw.text((x + 4, row_y + 4), '›', font=make_font(14, True), fill=SUB)
                x += 14
        draw.text((PAD_L + 152, row_y + 30), note, font=F_HINT, fill=SUB)
        row_y += 54

    image.save(OUT)
    print('wrote', OUT)


if __name__ == '__main__':
    main()
