"""ホーム画面用アイコンを生成する（Pillowが必要）。python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

def draw(size, maskable=False):
    s = size / 512
    img = Image.new('RGBA', (size, size), (255, 253, 247, 255))
    d = ImageDraw.Draw(img)
    inset = 70 if maskable else 0
    def R(x0, y0, x1, y1):
        k = (512 - 2 * inset) / 512
        return [ (inset + x0 * k) * s, (inset + y0 * k) * s, (inset + x1 * k) * s, (inset + y1 * k) * s ]
    # 重なった付箋（ラベンダー・グリーン・イエロー）
    d.rounded_rectangle(R(150, 92, 420, 362), radius=26*s, fill=(221, 214, 247))
    d.rounded_rectangle(R(118, 124, 388, 394), radius=26*s, fill=(205, 236, 214))
    d.rounded_rectangle(R(86, 156, 356, 426), radius=26*s, fill=(255, 240, 168))
    # 罫線
    for i, y in enumerate((236, 284, 332)):
        w = 220 if i < 2 else 150
        d.rounded_rectangle(R(126, y, 126 + w, y + 14), radius=7*s, fill=(196, 170, 120))
    # ピンクのしおり
    d.polygon([tuple(R(300, 156, 0, 0)[:2]), tuple(R(336, 156, 0, 0)[:2]), tuple(R(336, 214, 0, 0)[:2]), tuple(R(318, 198, 0, 0)[:2]), tuple(R(300, 214, 0, 0)[:2])], fill=(247, 182, 201))
    return img

draw(192).save(os.path.join(OUT, 'icon-192.png'))
draw(512).save(os.path.join(OUT, 'icon-512.png'))
draw(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
draw(180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', os.path.abspath(OUT))
