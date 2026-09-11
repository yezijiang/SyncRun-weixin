#!/usr/bin/env python3
"""生成小程序 tabBar 图标（纯标准库，无需 PIL）。

小程序 tabBar 的 iconPath 只接受 png/jpg，不支持 svg，
所以这里用最小 PNG 编码器 + 简易光栅化画出线性图标。

用法：python3 tools/gen_tabicons.py
输出：miniprogram/assets/tabbar/*.png（81x81，含 @2x 思路的实心描边）
"""

import os
import struct
import zlib

SIZE = 81
S = 2.4                      # 24x24 设计网格 -> 81px
OFF = (SIZE - 24 * S) / 2
INACTIVE = (154, 160, 180, 255)
ACTIVE = (124, 92, 255, 255)


class Canvas:
    def __init__(self, size=SIZE):
        self.n = size
        self.buf = [[(0, 0, 0, 0)] * size for _ in range(size)]

    def _t(self, x, y):
        return OFF + x * S, OFF + y * S

    def stamp(self, cx, cy, r, color):
        """以 (cx,cy) 为心、r 为半径填充圆（用于描边与实心）。"""
        x0, x1 = int(cx - r - 1), int(cx + r + 1)
        y0, y1 = int(cy - r - 1), int(cy + r + 1)
        for py in range(max(0, y0), min(self.n, y1 + 1)):
            for px in range(max(0, x0), min(self.n, x1 + 1)):
                dx, dy = px + 0.5 - cx, py + 0.5 - cy
                if dx * dx + dy * dy <= r * r:
                    self.buf[py][px] = color

    def dot(self, x, y, r, color):
        cx, cy = self._t(x, y)
        self.stamp(cx, cy, r * S, color)

    def line(self, x0, y0, x1, y1, w=1.8, color=INACTIVE):
        ax, ay = self._t(x0, y0)
        bx, by = self._t(x1, y1)
        steps = int(max(abs(bx - ax), abs(by - ay)) * 3) + 1
        r = w * S / 2
        for i in range(steps + 1):
            t = i / steps
            self.stamp(ax + (bx - ax) * t, ay + (by - ay) * t, r, color)

    def ring(self, cx, cy, r, w=1.8, color=INACTIVE, a0=0, a1=360):
        import math
        steps = int(r * S * 8) + 24
        for i in range(steps + 1):
            deg = a0 + (a1 - a0) * i / steps
            x = cx + r * math.cos(math.radians(deg))
            y = cy + r * math.sin(math.radians(deg))
            self.dot(x, y, w / 2, color)

    def tri(self, p0, p1, p2, color):
        """填充三角形。"""
        pts = [self._t(*p) for p in (p0, p1, p2)]
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]

        def sign(a, b, c):
            return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

        for py in range(int(min(ys)), int(max(ys)) + 1):
            for px in range(int(min(xs)), int(max(xs)) + 1):
                p = (px + 0.5, py + 0.5)
                d1, d2, d3 = sign(pts[0], pts[1], p), sign(pts[1], pts[2], p), sign(pts[2], pts[0], p)
                has_neg = d1 < 0 or d2 < 0 or d3 < 0
                has_pos = d1 > 0 or d2 > 0 or d3 > 0
                if not (has_neg and has_pos):
                    if 0 <= py < self.n and 0 <= px < self.n:
                        self.buf[py][px] = color

    def save(self, path):
        raw = bytearray()
        for row in self.buf:
            raw.append(0)
            for r, g, b, a in row:
                raw += bytes((r, g, b, a))

        def chunk(tag, data):
            c = struct.pack('>I', len(data)) + tag + data
            return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = b'\x89PNG\r\n\x1a\n'
        png += chunk(b'IHDR', struct.pack('>IIBBBBB', self.n, self.n, 8, 6, 0, 0, 0))
        png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        png += chunk(b'IEND', b'')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(png)


def icon_home(c):            # 发现：罗盘
    c.ring(12, 12, 9, 1.8, c.color)
    # 指针：两个共底三角形拼成一个菱形，指向东北
    c.tri((16.2, 7.8), (11.0, 11.0), (13.0, 13.0), c.color)
    c.tri((7.8, 16.2), (13.0, 13.0), (11.0, 11.0), c.color)


def icon_run(c):             # 去跑：开始
    c.ring(12, 12, 9, 1.8, c.color)
    c.tri((10, 7.6), (10, 16.4), (17.2, 12), c.color)


def icon_friends(c):         # 跑友：两人
    for cx, r in ((8.2, 3.0), (15.8, 3.0)):
        c.dot(cx, 8.4, r, c.color)
        c.ring(cx, 15.6, 3.9, 1.9, c.color, a0=180, a1=360)


def icon_feed(c):            # 动态：列表
    for y in (6.6, 12, 17.4):
        c.line(5, y, 19, y, 2.0, c.color)


def icon_me(c):              # 我的：人像
    c.dot(12, 8.2, 3.4, c.color)
    c.ring(12, 18.6, 6.2, 1.9, c.color, a0=180, a1=360)


ICONS = {
    'home': icon_home,
    'run': icon_run,
    'friends': icon_friends,
    'feed': icon_feed,
    'me': icon_me,
}


def build(name, draw, color, out):
    c = Canvas()
    c.color = color
    draw(c)
    c.save(out)


def main():
    base = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'assets', 'tabbar')
    base = os.path.abspath(base)
    for name, draw in ICONS.items():
        build(name, draw, INACTIVE, os.path.join(base, f'{name}.png'))
        build(name, draw, ACTIVE, os.path.join(base, f'{name}_on.png'))
    print('tabbar icons ->', base)
    for f in sorted(os.listdir(base)):
        print(' ', f, os.path.getsize(os.path.join(base, f)), 'bytes')


if __name__ == '__main__':
    main()
