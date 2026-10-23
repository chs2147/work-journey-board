"""render_icons.mjs가 만든 크기별 PNG를 Tauri 아이콘 파일로 묶는다 — 디자인 시점 도구.
실행: python3 scripts/brand/pack_icons.py <PNG 폴더> src-tauri/icons
  32x32.png · 128x128.png · 128x128@2x.png · icon.png(512) · icon.ico(16·24·32 작은 판 + 48·64·256) · icon.icns
"""

import shutil
import sys
from pathlib import Path

from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
png = lambda n: Image.open(src / f"{n}.png").convert("RGBA")  # noqa: E731

for name, size in [("32x32.png", 32), ("128x128.png", 128), ("128x128@2x.png", 256), ("icon.png", 512)]:
    shutil.copyfile(src / f"{size}.png", dst / name)

# .ico: 크기마다 따로 그린 그림을 그대로 넣는다(작은 크기를 큰 그림에서 줄이지 않게)
ico_sizes = [256, 16, 24, 32, 48, 64]
png(256).save(dst / "icon.ico", format="ICO", sizes=[(s, s) for s in ico_sizes], append_images=[png(s) for s in ico_sizes[1:]])
png(1024).save(dst / "icon.icns", format="ICNS")
print(f"packed icons → {dst}")
