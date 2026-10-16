from PIL import Image, ImageDraw
import os

src = r'C:\Users\hedao\Desktop\2026-09-20\物件输出'
files = sorted(f for f in os.listdir(src) if f.lower().endswith('.png'))

tw, th = 320, 320
cells = []
for f in files:
    im = Image.open(os.path.join(src, f)).convert('RGBA')
    print(f, im.size)
    im.thumbnail((tw, th))
    canvas = Image.new('RGBA', (tw, th + 44), (50, 50, 50, 255))
    canvas.paste(im, ((tw - im.width) // 2, (th - im.height) // 2), im)
    cells.append((f, canvas))

cols = 2
rows = (len(cells) + cols - 1) // cols
sheet = Image.new('RGBA', (cols * tw, rows * (th + 44)), (25, 25, 25, 255))
d = ImageDraw.Draw(sheet)
for i, (f, c) in enumerate(cells):
    r, col = divmod(i, cols)
    x, y = col * tw, r * (th + 44)
    sheet.paste(c, (x, y))
    d.text((x + 6, y + th + 6), f, fill=(255, 230, 80, 255))

out = r'D:\City1001\Demo3.8\tools\decor_overview.png'
sheet.save(out)
print('SAVED', out)
