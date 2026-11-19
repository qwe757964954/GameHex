# -*- coding: utf-8 -*-
"""Spine 骨架动画时长提取（只读，不改资源）。

工程内 `.skel` 的两个非常规之处（所以不能直接套官方库）：

1. **浮点是大端存放**（标准 spine binary 是小端）；
2. 头部带**字符串表**，attachment 用 `rstringref()` 取名字。

皮肤 / 附件段不解析（各版本差异大，且与时长无关）：直接逐个字节尝试「从约束段之后
开始读动画段」，以**刚好消费到文件末尾**作为命中判据。

duration 口径与 Spine 导出 JSON 一致 = 该动画所有 timeline 最后一帧 time 的最大值。

用法：
    python tools/spine_dur.py <file.skel> [...]
    python tools/spine_dur.py --attack <file.skel> [...]      # 只打 attack 的秒数
"""
import os
import struct
import sys


class BI:
    def __init__(self, data, strings=None, i=0):
        self.d = data
        self.i = i
        self.strings = strings if strings is not None else []

    def byte(self):
        value = struct.unpack_from('b', self.d, self.i)[0]
        self.i += 1
        return value

    def ubyte(self):
        value = self.d[self.i]
        self.i += 1
        return value

    def int32(self):
        value = struct.unpack_from('>i', self.d, self.i)[0]
        self.i += 4
        return value

    def f32(self):
        value = struct.unpack_from('>f', self.d, self.i)[0]
        self.i += 4
        return value

    def boolean(self):
        return self.byte() != 0

    def rint(self, positive=True):
        b = self.byte()
        value = b & 0x7F
        if b & 0x80:
            b = self.byte(); value |= (b & 0x7F) << 7
            if b & 0x80:
                b = self.byte(); value |= (b & 0x7F) << 14
                if b & 0x80:
                    b = self.byte(); value |= (b & 0x7F) << 21
                    if b & 0x80:
                        b = self.byte(); value |= (b & 0x7F) << 28
        if positive:
            return value
        return (value >> 1) ^ -(value & 1)

    def rstring(self):
        length = self.rint(True)
        if length == 0:
            return None
        if length == 1:
            return ''
        length -= 1
        text = self.d[self.i:self.i + length].decode('utf-8', 'replace')
        self.i += length
        return text

    def rstringref(self):
        index = self.rint(True)
        return None if index == 0 else self.strings[index - 1]


def read_curve(inp):
    kind = inp.ubyte()
    if kind == 2:
        inp.f32(); inp.f32(); inp.f32(); inp.f32()


def read_animation(inp):
    name = inp.rstring()
    last = 0.0

    # ① 旋转 / 位移 / 缩放 / 剪切
    for _ in range(inp.rint(True)):
        inp.rint(True)
        for _ in range(inp.rint(True)):
            kind = inp.ubyte()
            frames = inp.rint(True)
            for frame in range(frames):
                last = max(last, inp.f32())
                if kind == 0:
                    inp.rstringref()
                elif kind == 1:
                    inp.int32()
                    if frame < frames - 1:
                        read_curve(inp)
                elif kind == 2:
                    inp.int32(); inp.int32()
                    if frame < frames - 1:
                        read_curve(inp)

    # ② 锚点 / 颜色 / IK / 变换约束
    for _ in range(inp.rint(True)):
        inp.rint(True)
        for _ in range(inp.rint(True)):
            kind = inp.ubyte()
            frames = inp.rint(True)
            for frame in range(frames):
                last = max(last, inp.f32())
                if kind == 0:
                    inp.f32()
                else:
                    inp.f32(); inp.f32()
                if frame < frames - 1:
                    read_curve(inp)

    # ③ IK 约束
    for _ in range(inp.rint(True)):
        inp.rint(True)
        frames = inp.rint(True)
        for frame in range(frames):
            last = max(last, inp.f32())
            inp.f32(); inp.f32(); inp.byte(); inp.boolean(); inp.boolean()
            if frame < frames - 1:
                read_curve(inp)

    # ④ 变换约束
    for _ in range(inp.rint(True)):
        inp.rint(True)
        frames = inp.rint(True)
        for frame in range(frames):
            last = max(last, inp.f32())
            for _ in range(4):
                inp.f32()
            if frame < frames - 1:
                read_curve(inp)

    # ⑤ 路径约束
    for _ in range(inp.rint(True)):
        inp.rint(True)
        for _ in range(inp.rint(True)):
            kind = inp.ubyte()
            frames = inp.rint(True)
            for frame in range(frames):
                last = max(last, inp.f32())
                if kind == 2:
                    inp.f32(); inp.f32()
                else:
                    inp.f32()
                if frame < frames - 1:
                    read_curve(inp)

    # ⑥ 变形（附件顶点）
    for _ in range(inp.rint(True)):
        inp.rint(True)
        for _ in range(inp.rint(True)):
            inp.rint(True)
            for _ in range(inp.rint(True)):
                inp.rstringref()
                frames = inp.rint(True)
                for frame in range(frames):
                    last = max(last, inp.f32())
                    end = inp.rint(True)
                    if end != 0:
                        inp.rint(True)
                        inp.i += 4 * end
                    if frame < frames - 1:
                        read_curve(inp)

    # ⑦ 绘制顺序
    count = inp.rint(True)
    if count > 0:
        for _ in range(count):
            last = max(last, inp.f32())
            for _ in range(inp.rint(True)):
                inp.rint(True); inp.rint(True)

    # ⑧ 事件
    count = inp.rint(True)
    if count > 0:
        for _ in range(count):
            last = max(last, inp.f32())
            inp.rint(True); inp.rint(False); inp.f32()
            if inp.boolean():
                inp.rstring()

    return name, last


def parse_header(inp):
    """读到路径约束段结束，返回 (版本, fps)。皮肤段不解析。"""
    inp.rstring(); version = inp.rstring()
    inp.f32(); inp.f32(); inp.f32(); inp.f32()
    nonessential = inp.boolean()
    fps = 30.0
    if nonessential:
        fps = inp.f32()
        inp.rstring(); inp.rstring()
    for _ in range(inp.rint(True)):
        inp.strings.append(inp.rstring())
    for index in range(inp.rint(True)):
        inp.rstring()
        if index != 0:
            inp.rint(True)
        for _ in range(8):
            inp.f32()
        inp.rint(True); inp.boolean()
        if nonessential:
            inp.int32()
    for _ in range(inp.rint(True)):
        inp.rstring(); inp.rint(True); inp.int32(); inp.int32()
        inp.rstringref(); inp.rint(True)
    for _ in range(inp.rint(True)):
        inp.rstring(); inp.rint(True); inp.boolean()
        for _ in range(inp.rint(True)):
            inp.rint(True)
        inp.rint(True)
        inp.f32(); inp.f32(); inp.byte(); inp.boolean(); inp.boolean(); inp.boolean()
    for _ in range(inp.rint(True)):
        inp.rstring(); inp.rint(True); inp.boolean()
        for _ in range(inp.rint(True)):
            inp.rint(True)
        inp.rint(True); inp.boolean(); inp.boolean()
        for _ in range(6):
            inp.f32()
        for _ in range(4):
            inp.f32()
    for _ in range(inp.rint(True)):
        inp.rstring(); inp.rint(True); inp.boolean()
        for _ in range(inp.rint(True)):
            inp.rint(True)
        inp.rint(True); inp.rint(True); inp.rint(True); inp.rint(True)
        inp.f32(); inp.f32(); inp.f32(); inp.f32(); inp.f32()
    return version, fps


def find_animations(data, strings, start):
    size = len(data)
    for position in range(start, size - 4):
        inp = BI(data, strings, position)
        try:
            count = inp.rint(True)
            if count < 1 or count > 40:
                continue
            animations = []
            for _ in range(count):
                animations.append(read_animation(inp))
        except Exception:
            continue
        if inp.i != size:
            continue
        if not all(name and all(32 <= ord(ch) < 0x3000 for ch in name) for name, _ in animations):
            continue
        return position, animations
    return None, None


def parse(path):
    with open(path, 'rb') as handle:
        data = handle.read()
    inp = BI(data)
    version, fps = parse_header(inp)
    position, animations = find_animations(data, inp.strings, inp.i)
    if animations is None:
        raise RuntimeError('animation block not found (from %d)' % inp.i)
    return {'version': version, 'fps': fps, 'pos': position, 'anims': dict(animations),
            'order': [name for name, _ in animations]}


def attack_duration(path):
    return parse(path)['anims'].get('attack')


if __name__ == '__main__':
    argv = sys.argv[1:]
    only_attack = '--attack' in argv
    for path in [item for item in argv if not item.startswith('--')]:
        try:
            result = parse(path)
        except Exception as error:  # noqa: BLE001
            print('FAIL %-14s %r' % (os.path.basename(path), error))
            continue
        if only_attack:
            print('%-34s %s' % (path, result['anims'].get('attack')))
            continue
        print('OK   %-12s %s fps=%.0f' % (os.path.basename(path), result['version'], result['fps']))
        for name in result['order']:
            print('      %-24s %.3fs' % (name, result['anims'][name]))
