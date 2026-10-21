"""ホーム画面用アイコンを生成する（Pillowが必要）。python3 scripts/make_icons.py

元画像: scripts/icon-master-1024.png（1024x1024・不透明）を縮小するだけで、描き直しや角丸加工はしない。
maskable版だけは、Androidの円形マスクで図柄が欠けないよう、同じ画像を縮めて背景色の上に置く。
"""
from PIL import Image
import os

HERE = os.path.dirname(__file__)
MASTER = os.path.join(HERE, 'icon-master-1024.png')
OUT = os.path.join(HERE, '..', 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

# 元画像の背景色（四隅・辺の中央のサンプル値がほぼ一定）
BG = (252, 106, 121)
# maskable: 図柄の最遠点が安全領域（直径80%の円）に収まる縮小率
MASKABLE_SCALE = 0.84

master = Image.open(MASTER).convert('RGB')


def plain(size):
    return master.resize((size, size), Image.LANCZOS)


def maskable(size):
    canvas = Image.new('RGB', (size, size), BG)
    inner = round(size * MASKABLE_SCALE)
    offset = (size - inner) // 2
    canvas.paste(master.resize((inner, inner), Image.LANCZOS), (offset, offset))
    return canvas


plain(192).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
plain(512).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
maskable(512).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
plain(180).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
print('icons written to', os.path.abspath(OUT))
